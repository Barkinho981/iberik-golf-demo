import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { users } from './src/db/schema.ts';
import { listUsers, upsertPlayerRecord } from './src/db/users.ts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createAcademyBooking,
  createStandaloneVehicleReservation,
  createTeeTimeReservation,
  getAcademyAvailability,
  getCentralFleetOverview,
  getCourseAvailability,
  getCourses,
  listAcademyBookings,
  listTeeTimeReservations,
  updateAcademyBookingStatus,
  updateTeeTimeReservationStatus,
  updateVehicleReservationStatus,
  updateVehicleStatus,
} from './src/db/golf-service.ts';
import { type AuthRequest, requireAuth, requireStaff } from './src/middleware/auth.ts';
import { getNextWednesdayIsoDate, getTodayIsoDate } from './src/lib/golf-schedule.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function handleRouteError(res: express.Response, error: unknown, fallbackMsg: string) {
  if (
    error instanceof ValidationError ||
    error instanceof ConflictError ||
    error instanceof NotFoundError
  ) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(fallbackMsg, error);
  const message = error instanceof Error ? error.message : fallbackMsg;
  return res.status(500).json({ error: message });
}

async function resolveBookingUser(
  requester: NonNullable<AuthRequest['appUser']>,
  targetUserId: unknown
) {
  const isStaff = ['admin', 'reception'].includes(requester.role);
  if (targetUserId === undefined || targetUserId === null || targetUserId === '') {
    return requester;
  }
  if (!isStaff) {
    throw new ValidationError('Solo administración o recepción puede reservar en nombre de otro usuario.');
  }
  const parsedId = Number(targetUserId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new ValidationError('Usuario titular no válido.');
  }
  if (parsedId === requester.id) {
    return requester;
  }
  const rows = await db.select().from(users).where(eq(users.id, parsedId)).limit(1);
  if (rows.length === 0) {
    throw new NotFoundError('Usuario titular no encontrado.');
  }
  return rows[0];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Public read-only endpoints (non-PII course info & real-time slot occupancy)
  app.get('/api/courses', async (_req, res) => {
    try {
      const list = await getCourses();
      res.json(list);
    } catch (error) {
      handleRouteError(res, error, 'Error al cargar los campos');
    }
  });

  app.get('/api/availability', async (req, res) => {
    try {
      const courseSlug = String(req.query.course || 'guitiriz');
      const date = String(req.query.date || getTodayIsoDate());
      const availability = await getCourseAvailability(courseSlug, date);
      res.json(availability);
    } catch (error) {
      handleRouteError(res, error, 'Error al consultar disponibilidad');
    }
  });

  app.get('/api/academy/availability', async (req, res) => {
    try {
      const date = String(req.query.date || getNextWednesdayIsoDate());
      const availability = await getAcademyAvailability(date);
      res.json(availability);
    } catch (error) {
      handleRouteError(res, error, 'Error al consultar la academia');
    }
  });

  app.get('/api/fleet/public-summary', async (req, res) => {
    try {
      const date = String(req.query.date || getTodayIsoDate());
      const startTime = String(req.query.startTime || '10:00');
      const overview = await getCentralFleetOverview(date, startTime);
      // Strip PII from public summary
      const safeVehicles = overview.vehicles.map((v) => ({
        id: v.id,
        courseId: v.courseId,
        courseSlug: v.courseSlug,
        courseName: v.courseName,
        code: v.code,
        type: v.type,
        label: v.label,
        status: v.status,
        busyAtSelectedTime: v.busyAtSelectedTime,
        reservationsCountToday: v.reservationsToday.length,
        occupiedWindows: v.reservationsToday.map((r) => ({
          startTime: r.startTime,
          endTime: r.endTime,
        })),
      }));
      res.json({
        date: overview.date,
        checkStartTime: overview.checkStartTime,
        courses: overview.courses,
        vehicles: safeVehicles,
      });
    } catch (error) {
      handleRouteError(res, error, 'Error al consultar flota');
    }
  });

  // Authenticated user profile routes
  app.get('/api/me', requireAuth, async (req: AuthRequest, res) => {
    res.json(req.appUser);
  });

  app.put('/api/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const { nombre, apellidos, telefono, licencia, poblacion } = req.body ?? {};
      const updated = await db
        .update(users)
        .set({
          nombre: typeof nombre === 'string' ? nombre.trim() : req.appUser.nombre,
          apellidos: typeof apellidos === 'string' ? apellidos.trim() : req.appUser.apellidos,
          telefono: typeof telefono === 'string' ? telefono.trim() : req.appUser.telefono,
          licencia:
            typeof licencia === 'string' ? licencia.trim().toUpperCase() : req.appUser.licencia,
          poblacion: typeof poblacion === 'string' ? poblacion.trim() : req.appUser.poblacion,
        })
        .where(eq(users.id, req.appUser.id))
        .returning();
      res.json(updated[0]);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar el perfil');
    }
  });

  // Staff / Reception User Directory Management
  app.get('/api/users', requireAuth, requireStaff, async (_req: AuthRequest, res) => {
    try {
      const list = await listUsers();
      res.json(list);
    } catch (error) {
      handleRouteError(res, error, 'Error al listar usuarios');
    }
  });

  app.post('/api/users', requireAuth, requireStaff, async (req: AuthRequest, res) => {
    try {
      const { email, nombre, apellidos, telefono, licencia, poblacion, role } = req.body ?? {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'El correo electrónico es obligatorio.' });
      }
      if (!nombre || !apellidos) {
        return res.status(400).json({ error: 'Nombre y apellidos son obligatorios.' });
      }
      const allowedRoles = ['player', 'reception', 'admin'];
      const safeRole = allowedRoles.includes(role) ? role : 'player';
      const record = await upsertPlayerRecord({
        email,
        nombre: String(nombre),
        apellidos: String(apellidos),
        telefono: String(telefono || ''),
        licencia: String(licencia || ''),
        poblacion: String(poblacion || ''),
        role: safeRole,
      });
      res.status(201).json(record);
    } catch (error) {
      handleRouteError(res, error, 'Error al guardar jugador');
    }
  });

  app.put('/api/users/:id', requireAuth, requireStaff, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de usuario no válido.' });
      }
      const { email, nombre, apellidos, telefono, licencia, poblacion, role } = req.body ?? {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'El correo electrónico es obligatorio.' });
      }
      const allowedRoles = ['player', 'reception', 'admin'];
      const safeRole = allowedRoles.includes(role) ? role : undefined;
      const record = await upsertPlayerRecord({
        id,
        email,
        nombre: String(nombre || ''),
        apellidos: String(apellidos || ''),
        telefono: String(telefono || ''),
        licencia: String(licencia || ''),
        poblacion: String(poblacion || ''),
        role: safeRole,
      });
      if (!record) {
        return res.status(404).json({ error: 'Jugador no encontrado.' });
      }
      res.json(record);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar jugador');
    }
  });

  // Tee Time Reservations
  app.get('/api/tee-times', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
      const courseSlug =
        typeof req.query.course === 'string' && req.query.course ? req.query.course : undefined;

      const rows = await listTeeTimeReservations({
        date,
        courseSlug,
        userId: isStaff ? undefined : req.appUser.id,
      });
      res.json(rows);
    } catch (error) {
      handleRouteError(res, error, 'Error al listar reservas de tee time');
    }
  });

  app.post('/api/tee-times', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const {
        courseSlug,
        date,
        slotTime,
        playersCount,
        playerNames,
        buggiesRequested,
        trolleysRequested,
        mewsReference,
        notes,
        targetUserId,
      } = req.body ?? {};

      const bookingUser = await resolveBookingUser(req.appUser, targetUserId);

      const result = await createTeeTimeReservation({
        courseSlug: String(courseSlug || ''),
        userId: bookingUser.id,
        date: String(date || ''),
        slotTime: String(slotTime || ''),
        playersCount: Number(playersCount || 1),
        playerNames: typeof playerNames === 'string' ? playerNames : '',
        buggiesRequested: Number(buggiesRequested || 0),
        trolleysRequested: Number(trolleysRequested || 0),
        mewsReference: typeof mewsReference === 'string' ? mewsReference : '',
        notes: typeof notes === 'string' ? notes : '',
      });
      res.status(201).json({
        ...result,
        titular: {
          id: bookingUser.id,
          nombre: bookingUser.nombre,
          apellidos: bookingUser.apellidos,
          email: bookingUser.email,
          licencia: bookingUser.licencia,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Error al crear la reserva de tee time');
    }
  });

  app.patch('/api/tee-times/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de reserva no válido.' });
      }
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const { status, mewsStatus, mewsReference } = req.body ?? {};
      const updated = await updateTeeTimeReservationStatus({
        id,
        requesterId: req.appUser.id,
        isStaff,
        status: typeof status === 'string' ? status : undefined,
        mewsStatus: typeof mewsStatus === 'string' ? mewsStatus : undefined,
        mewsReference: typeof mewsReference === 'string' ? mewsReference : undefined,
      });
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar la reserva');
    }
  });

  // Academy Bookings (Víctor López · Guitiriz · Miércoles)
  app.get('/api/academy/bookings', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
      const rows = await listAcademyBookings({
        date,
        userId: isStaff ? undefined : req.appUser.id,
      });
      res.json(rows);
    } catch (error) {
      handleRouteError(res, error, 'Error al listar reservas de clases');
    }
  });

  app.post('/api/academy/bookings', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const { date, slotTime, studentsCount, level, notes, targetUserId } = req.body ?? {};
      const bookingUser = await resolveBookingUser(req.appUser, targetUserId);

      const created = await createAcademyBooking({
        userId: bookingUser.id,
        date: String(date || ''),
        slotTime: String(slotTime || ''),
        studentsCount: Number(studentsCount || 1),
        level: typeof level === 'string' ? level : 'Perfeccionamiento',
        notes: typeof notes === 'string' ? notes : '',
      });
      res.status(201).json({
        ...created,
        titular: {
          id: bookingUser.id,
          nombre: bookingUser.nombre,
          apellidos: bookingUser.apellidos,
          email: bookingUser.email,
          licencia: bookingUser.licencia,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Error al reservar la clase');
    }
  });

  app.patch('/api/academy/bookings/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID no válido.' });
      }
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const { status, mewsStatus } = req.body ?? {};
      const updated = await updateAcademyBookingStatus({
        id,
        requesterId: req.appUser.id,
        isStaff,
        status: typeof status === 'string' ? status : undefined,
        mewsStatus: typeof mewsStatus === 'string' ? mewsStatus : undefined,
      });
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar reserva de clase');
    }
  });

  // Centralized Fleet Management
  app.get('/api/fleet', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const date = String(req.query.date || getTodayIsoDate());
      const startTime = String(req.query.startTime || '10:00');
      const overview = await getCentralFleetOverview(date, startTime);

      if (!isStaff) {
        // Only reveal details for user's own vehicle reservations
        const filteredVehicles = overview.vehicles.map((v) => ({
          ...v,
          reservationsToday: v.reservationsToday.map((r) =>
            r.userId === req.appUser!.id
              ? r
              : {
                  id: r.id,
                  vehicleId: r.vehicleId,
                  courseId: r.courseId,
                  userId: 0,
                  teeTimeReservationId: null,
                  date: r.date,
                  startTime: r.startTime,
                  endTime: r.endTime,
                  mewsStatus: r.mewsStatus,
                  status: r.status,
                  notes: 'Ocupado',
                  userNombre: 'Reservado',
                  userApellidos: '',
                  userEmail: '',
                }
          ),
        }));
        return res.json({ ...overview, vehicles: filteredVehicles });
      }

      res.json(overview);
    } catch (error) {
      handleRouteError(res, error, 'Error al consultar flota centralizada');
    }
  });

  app.post('/api/fleet/reservations', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const { courseSlug, vehicleType, vehicleId, date, startTime, notes, targetUserId } =
        req.body ?? {};

      if (vehicleType !== 'buggy' && vehicleType !== 'electric_trolley') {
        return res.status(400).json({ error: 'Tipo de vehículo no válido.' });
      }

      const bookingUser = await resolveBookingUser(req.appUser, targetUserId);

      const result = await createStandaloneVehicleReservation({
        courseSlug: String(courseSlug || ''),
        vehicleType,
        vehicleId: vehicleId ? Number(vehicleId) : undefined,
        userId: bookingUser.id,
        date: String(date || ''),
        startTime: String(startTime || ''),
        notes: typeof notes === 'string' ? notes : '',
      });
      res.status(201).json({
        ...result,
        titular: {
          id: bookingUser.id,
          nombre: bookingUser.nombre,
          apellidos: bookingUser.apellidos,
          email: bookingUser.email,
          licencia: bookingUser.licencia,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Error al reservar vehículo');
    }
  });

  app.patch('/api/fleet/vehicles/:id', requireAuth, requireStaff, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de vehículo no válido.' });
      }
      const { status, notes } = req.body ?? {};
      if (status !== 'operational' && status !== 'maintenance') {
        return res.status(400).json({ error: 'Estado de vehículo no válido.' });
      }
      const updated = await updateVehicleStatus({
        vehicleId: id,
        status,
        notes: typeof notes === 'string' ? notes : undefined,
      });
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar vehículo');
    }
  });

  app.patch('/api/fleet/reservations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.appUser) return res.status(401).json({ error: 'No autenticado' });
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID no válido.' });
      }
      const isStaff = ['admin', 'reception'].includes(req.appUser.role);
      const { status, mewsStatus } = req.body ?? {};
      const updated = await updateVehicleReservationStatus({
        id,
        requesterId: req.appUser.id,
        isStaff,
        status: typeof status === 'string' ? status : undefined,
        mewsStatus: typeof mewsStatus === 'string' ? mewsStatus : undefined,
      });
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, 'Error al actualizar reserva de vehículo');
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
