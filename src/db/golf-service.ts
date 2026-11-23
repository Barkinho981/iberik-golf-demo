import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { db } from './index.ts';
import {
  academyBookings,
  courses,
  teeTimeReservations,
  users,
  vehicleReservations,
  vehicles,
} from './schema.ts';
import {
  ACADEMY_ALL_SLOTS,
  ACADEMY_INSTRUCTOR,
  ACADEMY_MAX_STUDENTS,
  MAX_PLAYERS_PER_FLIGHT,
  TEE_TIME_SLOTS,
  addMinutesToTime,
  isValidIsoDate,
  isValidTeeTimeSlot,
  isWednesdayIsoDate,
  timeToMinutes,
  timesOverlap,
} from '../lib/golf-schedule.ts';

export class ConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
  }
}

export class ValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
  }
}

export async function getCourses() {
  try {
    return await db.select().from(courses).orderBy(asc(courses.holes));
  } catch (error) {
    console.error('Error fetching courses:', error);
    throw new Error('Error al obtener los campos de golf', { cause: error });
  }
}

export async function getCourseAvailability(courseSlug: string, date: string) {
  if (!isValidIsoDate(date)) {
    throw new ValidationError('Fecha no válida. Usa formato YYYY-MM-DD.');
  }
  try {
    const courseList = await db
      .select()
      .from(courses)
      .where(eq(courses.slug, courseSlug))
      .limit(1);

    if (courseList.length === 0) {
      throw new NotFoundError('Campo de golf no encontrado.');
    }
    const course = courseList[0];

    const [dayTeeTimes, courseVehicles, dayVehicleRes] = await Promise.all([
      db
        .select({
          slotTime: teeTimeReservations.slotTime,
          playersCount: teeTimeReservations.playersCount,
        })
        .from(teeTimeReservations)
        .where(
          and(
            eq(teeTimeReservations.courseId, course.id),
            eq(teeTimeReservations.date, date),
            ne(teeTimeReservations.status, 'cancelled')
          )
        ),
      db
        .select()
        .from(vehicles)
        .where(eq(vehicles.courseId, course.id))
        .orderBy(asc(vehicles.code)),
      db
        .select()
        .from(vehicleReservations)
        .where(
          and(
            eq(vehicleReservations.courseId, course.id),
            eq(vehicleReservations.date, date),
            ne(vehicleReservations.status, 'cancelled')
          )
        ),
    ]);

    const playersBySlot = new Map<string, number>();
    for (const row of dayTeeTimes) {
      playersBySlot.set(row.slotTime, (playersBySlot.get(row.slotTime) || 0) + row.playersCount);
    }

    const operationalBuggies = courseVehicles.filter(
      (v) => v.type === 'buggy' && v.status === 'operational'
    );
    const operationalTrolleys = courseVehicles.filter(
      (v) => v.type === 'electric_trolley' && v.status === 'operational'
    );

    const slots = TEE_TIME_SLOTS.map((slotTime) => {
      const bookedPlayers = playersBySlot.get(slotTime) || 0;
      const remainingPlayers = Math.max(0, MAX_PLAYERS_PER_FLIGHT - bookedPlayers);
      const windowEnd = addMinutesToTime(slotTime, course.roundDurationMinutes);

      const busyVehicleIds = new Set(
        dayVehicleRes
          .filter((r) => timesOverlap(slotTime, windowEnd, r.startTime, r.endTime))
          .map((r) => r.vehicleId)
      );

      const availableBuggies = operationalBuggies.filter((v) => !busyVehicleIds.has(v.id)).length;
      const availableTrolleys = operationalTrolleys.filter(
        (v) => !busyVehicleIds.has(v.id)
      ).length;

      return {
        slotTime,
        bookedPlayers,
        remainingPlayers,
        availableBuggies,
        availableTrolleys,
      };
    });

    return {
      course,
      date,
      fleetTotals: {
        buggiesOperational: operationalBuggies.length,
        buggiesTotal: course.buggiesCount,
        trolleysOperational: operationalTrolleys.length,
        trolleysTotal: course.trolleysCount,
      },
      slots,
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
    console.error('Error fetching course availability:', error);
    throw new Error('Error al consultar la disponibilidad en tiempo real', { cause: error });
  }
}

export async function createTeeTimeReservation(input: {
  courseSlug: string;
  userId: number;
  date: string;
  slotTime: string;
  playersCount: number;
  playerNames?: string;
  buggiesRequested: number;
  trolleysRequested: number;
  mewsReference?: string;
  notes?: string;
}) {
  if (!isValidIsoDate(input.date)) {
    throw new ValidationError('Fecha no válida.');
  }
  if (!isValidTeeTimeSlot(input.slotTime)) {
    throw new ValidationError('Horario de salida fuera de rango (08:30 a 19:00 cada 10 minutos).');
  }
  if (!Number.isInteger(input.playersCount) || input.playersCount < 1 || input.playersCount > 4) {
    throw new ValidationError('El número de jugadores por salida debe estar entre 1 y 4.');
  }
  if (
    !Number.isInteger(input.buggiesRequested) ||
    input.buggiesRequested < 0 ||
    input.buggiesRequested > 2
  ) {
    throw new ValidationError('Cantidad de buggies solicitada no válida.');
  }
  if (
    !Number.isInteger(input.trolleysRequested) ||
    input.trolleysRequested < 0 ||
    input.trolleysRequested > 4
  ) {
    throw new ValidationError('Cantidad de carros eléctricos solicitada no válida.');
  }

  try {
    return await db.transaction(async (tx) => {
      const courseRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.slug, input.courseSlug))
        .limit(1);
      if (courseRows.length === 0) {
        throw new NotFoundError('Campo de golf no encontrado.');
      }
      const course = courseRows[0];

      const existingFlights = await tx
        .select()
        .from(teeTimeReservations)
        .where(
          and(
            eq(teeTimeReservations.courseId, course.id),
            eq(teeTimeReservations.date, input.date),
            eq(teeTimeReservations.slotTime, input.slotTime),
            ne(teeTimeReservations.status, 'cancelled')
          )
        );

      const currentPlayers = existingFlights.reduce((sum, f) => sum + f.playersCount, 0);
      if (currentPlayers + input.playersCount > MAX_PLAYERS_PER_FLIGHT) {
        throw new ConflictError(
          `El tee time de las ${input.slotTime} solo dispone de ${Math.max(
            0,
            MAX_PLAYERS_PER_FLIGHT - currentPlayers
          )} plaza(s).`
        );
      }

      const endTime = addMinutesToTime(input.slotTime, course.roundDurationMinutes);
      let chosenBuggies: (typeof vehicles.$inferSelect)[] = [];
      let chosenTrolleys: (typeof vehicles.$inferSelect)[] = [];

      if (input.buggiesRequested > 0 || input.trolleysRequested > 0) {
        const [courseVehicles, dayVehicleRes] = await Promise.all([
          tx
            .select()
            .from(vehicles)
            .where(and(eq(vehicles.courseId, course.id), eq(vehicles.status, 'operational')))
            .orderBy(asc(vehicles.code)),
          tx
            .select()
            .from(vehicleReservations)
            .where(
              and(
                eq(vehicleReservations.courseId, course.id),
                eq(vehicleReservations.date, input.date),
                ne(vehicleReservations.status, 'cancelled')
              )
            ),
        ]);

        const busyIds = new Set(
          dayVehicleRes
            .filter((r) => timesOverlap(input.slotTime, endTime, r.startTime, r.endTime))
            .map((r) => r.vehicleId)
        );

        const freeBuggies = courseVehicles.filter(
          (v) => v.type === 'buggy' && !busyIds.has(v.id)
        );
        const freeTrolleys = courseVehicles.filter(
          (v) => v.type === 'electric_trolley' && !busyIds.has(v.id)
        );

        if (freeBuggies.length < input.buggiesRequested) {
          throw new ConflictError(
            `Solo quedan ${freeBuggies.length} buggy(s) disponibles en ${course.name} para las ${input.slotTime}.`
          );
        }
        if (freeTrolleys.length < input.trolleysRequested) {
          throw new ConflictError(
            `Solo quedan ${freeTrolleys.length} carro(s) eléctrico(s) disponibles en ${course.name} para las ${input.slotTime}.`
          );
        }

        chosenBuggies = freeBuggies.slice(0, input.buggiesRequested);
        chosenTrolleys = freeTrolleys.slice(0, input.trolleysRequested);
      }

      const inserted = await tx
        .insert(teeTimeReservations)
        .values({
          courseId: course.id,
          userId: input.userId,
          date: input.date,
          slotTime: input.slotTime,
          playersCount: input.playersCount,
          playerNames: (input.playerNames || '').trim(),
          buggiesRequested: input.buggiesRequested,
          trolleysRequested: input.trolleysRequested,
          paymentMethod: 'RECEPTION_MEWS',
          mewsStatus: 'PENDING_RECEPTION',
          mewsReference: (input.mewsReference || '').trim(),
          notes: (input.notes || '').trim(),
          status: 'confirmed',
        })
        .returning();

      const reservation = inserted[0];
      const assignedVehicles = [...chosenBuggies, ...chosenTrolleys];

      if (assignedVehicles.length > 0) {
        await tx.insert(vehicleReservations).values(
          assignedVehicles.map((v) => ({
            vehicleId: v.id,
            courseId: course.id,
            userId: input.userId,
            teeTimeReservationId: reservation.id,
            date: input.date,
            startTime: input.slotTime,
            endTime,
            mewsStatus: 'PENDING_RECEPTION',
            status: 'reserved',
            notes: `Asignado a salida ${input.slotTime}`,
          }))
        );
      }

      return {
        reservation,
        assignedVehicles,
      };
    });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    console.error('Error creating tee time reservation:', error);
    throw new Error('Error al registrar la reserva de tee time', { cause: error });
  }
}

export async function listTeeTimeReservations(filters: {
  date?: string;
  courseSlug?: string;
  userId?: number;
}) {
  try {
    const rows = await db
      .select({
        id: teeTimeReservations.id,
        date: teeTimeReservations.date,
        slotTime: teeTimeReservations.slotTime,
        playersCount: teeTimeReservations.playersCount,
        playerNames: teeTimeReservations.playerNames,
        buggiesRequested: teeTimeReservations.buggiesRequested,
        trolleysRequested: teeTimeReservations.trolleysRequested,
        paymentMethod: teeTimeReservations.paymentMethod,
        mewsStatus: teeTimeReservations.mewsStatus,
        mewsReference: teeTimeReservations.mewsReference,
        notes: teeTimeReservations.notes,
        status: teeTimeReservations.status,
        createdAt: teeTimeReservations.createdAt,
        courseId: courses.id,
        courseSlug: courses.slug,
        courseName: courses.name,
        courseHoles: courses.holes,
        userId: users.id,
        userEmail: users.email,
        userNombre: users.nombre,
        userApellidos: users.apellidos,
        userLicencia: users.licencia,
        userTelefono: users.telefono,
      })
      .from(teeTimeReservations)
      .innerJoin(courses, eq(teeTimeReservations.courseId, courses.id))
      .innerJoin(users, eq(teeTimeReservations.userId, users.id))
      .orderBy(desc(teeTimeReservations.date), asc(teeTimeReservations.slotTime));

    return rows.filter((row) => {
      if (filters.date && row.date !== filters.date) return false;
      if (filters.courseSlug && row.courseSlug !== filters.courseSlug) return false;
      if (filters.userId && row.userId !== filters.userId) return false;
      return true;
    });
  } catch (error) {
    console.error('Error listing tee time reservations:', error);
    throw new Error('Error al obtener las reservas de tee times', { cause: error });
  }
}

export async function updateTeeTimeReservationStatus(input: {
  id: number;
  requesterId: number;
  isStaff: boolean;
  status?: string;
  mewsStatus?: string;
  mewsReference?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(teeTimeReservations)
        .where(eq(teeTimeReservations.id, input.id))
        .limit(1);

      if (existing.length === 0) {
        throw new NotFoundError('Reserva de tee time no encontrada.');
      }
      const resRow = existing[0];

      if (!input.isStaff && resRow.userId !== input.requesterId) {
        throw new ValidationError('No tienes permiso para modificar esta reserva.');
      }
      if (!input.isStaff && input.status && input.status !== 'cancelled') {
        throw new ValidationError('Solo recepción puede cambiar el estado operativo.');
      }
      if (!input.isStaff && (input.mewsStatus || input.mewsReference !== undefined)) {
        throw new ValidationError('Solo recepción puede actualizar el estado de cobro.');
      }

      const nextStatus = input.status ?? resRow.status;
      const nextMewsStatus =
        nextStatus === 'cancelled'
          ? 'CANCELLED'
          : input.mewsStatus ?? resRow.mewsStatus;

      const updated = await tx
        .update(teeTimeReservations)
        .set({
          status: nextStatus,
          mewsStatus: nextMewsStatus,
          mewsReference:
            input.mewsReference !== undefined ? input.mewsReference.trim() : resRow.mewsReference,
        })
        .where(eq(teeTimeReservations.id, input.id))
        .returning();

      if (nextStatus === 'cancelled') {
        await tx
          .update(vehicleReservations)
          .set({ status: 'cancelled', mewsStatus: 'CANCELLED' })
          .where(eq(vehicleReservations.teeTimeReservationId, input.id));
      } else if (input.mewsStatus) {
        await tx
          .update(vehicleReservations)
          .set({ mewsStatus: nextMewsStatus })
          .where(eq(vehicleReservations.teeTimeReservationId, input.id));
      }

      return updated[0];
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Error updating tee time reservation:', error);
    throw new Error('Error al actualizar la reserva', { cause: error });
  }
}

export async function getAcademyAvailability(date: string) {
  if (!isValidIsoDate(date)) {
    throw new ValidationError('Fecha no válida.');
  }
  try {
    const guitirizRows = await db
      .select()
      .from(courses)
      .where(eq(courses.slug, 'guitiriz'))
      .limit(1);
    if (guitirizRows.length === 0) {
      throw new NotFoundError('Campo de Guitiriz no configurado.');
    }
    const guitiriz = guitirizRows[0];
    const isWednesday = isWednesdayIsoDate(date);

    const dayBookings = isWednesday
      ? await db
          .select()
          .from(academyBookings)
          .where(
            and(
              eq(academyBookings.courseId, guitiriz.id),
              eq(academyBookings.date, date),
              ne(academyBookings.status, 'cancelled')
            )
          )
      : [];

    const countBySlot = new Map<string, number>();
    for (const b of dayBookings) {
      countBySlot.set(b.slotTime, (countBySlot.get(b.slotTime) || 0) + b.studentsCount);
    }

    const slots = ACADEMY_ALL_SLOTS.map((slotTime) => {
      const bookedStudents = countBySlot.get(slotTime) || 0;
      const remainingSpots = isWednesday
        ? Math.max(0, ACADEMY_MAX_STUDENTS - bookedStudents)
        : 0;
      const session = timeToMinutes(slotTime) < 15 * 60 ? 'morning' : 'afternoon';
      return {
        slotTime,
        endTime: addMinutesToTime(slotTime, 30),
        session,
        bookedStudents,
        remainingSpots,
        maxStudents: ACADEMY_MAX_STUDENTS,
      };
    });

    return {
      course: guitiriz,
      instructor: ACADEMY_INSTRUCTOR,
      date,
      isWednesday,
      slots,
    };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) throw error;
    console.error('Error fetching academy availability:', error);
    throw new Error('Error al consultar las clases de golf', { cause: error });
  }
}

export async function createAcademyBooking(input: {
  userId: number;
  date: string;
  slotTime: string;
  studentsCount: number;
  level?: string;
  notes?: string;
}) {
  if (!isValidIsoDate(input.date) || !isWednesdayIsoDate(input.date)) {
    throw new ValidationError(
      'Las clases con Víctor López en Guitiriz se imparten únicamente los miércoles.'
    );
  }
  if (!ACADEMY_ALL_SLOTS.includes(input.slotTime)) {
    throw new ValidationError(
      'Horario no válido. Las clases son de 30 minutos de 11:00 a 14:00 y de 16:00 a 18:00.'
    );
  }
  if (!Number.isInteger(input.studentsCount) || input.studentsCount < 1 || input.studentsCount > 4) {
    throw new ValidationError('El máximo de alumnos por clase es de 4.');
  }

  try {
    return await db.transaction(async (tx) => {
      const guitirizRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.slug, 'guitiriz'))
        .limit(1);
      if (guitirizRows.length === 0) {
        throw new NotFoundError('Campo de Guitiriz no encontrado.');
      }
      const guitiriz = guitirizRows[0];

      const existing = await tx
        .select()
        .from(academyBookings)
        .where(
          and(
            eq(academyBookings.courseId, guitiriz.id),
            eq(academyBookings.date, input.date),
            eq(academyBookings.slotTime, input.slotTime),
            ne(academyBookings.status, 'cancelled')
          )
        );

      const currentStudents = existing.reduce((sum, b) => sum + b.studentsCount, 0);
      if (currentStudents + input.studentsCount > ACADEMY_MAX_STUDENTS) {
        throw new ConflictError(
          `Solo quedan ${Math.max(
            0,
            ACADEMY_MAX_STUDENTS - currentStudents
          )} plaza(s) en la clase de las ${input.slotTime}.`
        );
      }

      const inserted = await tx
        .insert(academyBookings)
        .values({
          courseId: guitiriz.id,
          userId: input.userId,
          instructor: ACADEMY_INSTRUCTOR,
          date: input.date,
          slotTime: input.slotTime,
          studentsCount: input.studentsCount,
          level: (input.level || 'Perfeccionamiento').trim(),
          mewsStatus: 'PENDING_RECEPTION',
          status: 'confirmed',
          notes: (input.notes || '').trim(),
        })
        .returning();

      return inserted[0];
    });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    console.error('Error creating academy booking:', error);
    throw new Error('Error al reservar la clase de golf', { cause: error });
  }
}

export async function listAcademyBookings(filters: { date?: string; userId?: number }) {
  try {
    const rows = await db
      .select({
        id: academyBookings.id,
        date: academyBookings.date,
        slotTime: academyBookings.slotTime,
        instructor: academyBookings.instructor,
        studentsCount: academyBookings.studentsCount,
        level: academyBookings.level,
        mewsStatus: academyBookings.mewsStatus,
        status: academyBookings.status,
        notes: academyBookings.notes,
        createdAt: academyBookings.createdAt,
        courseName: courses.name,
        userId: users.id,
        userEmail: users.email,
        userNombre: users.nombre,
        userApellidos: users.apellidos,
        userLicencia: users.licencia,
        userTelefono: users.telefono,
      })
      .from(academyBookings)
      .innerJoin(courses, eq(academyBookings.courseId, courses.id))
      .innerJoin(users, eq(academyBookings.userId, users.id))
      .orderBy(desc(academyBookings.date), asc(academyBookings.slotTime));

    return rows.filter((row) => {
      if (filters.date && row.date !== filters.date) return false;
      if (filters.userId && row.userId !== filters.userId) return false;
      return true;
    });
  } catch (error) {
    console.error('Error listing academy bookings:', error);
    throw new Error('Error al obtener las reservas de clases', { cause: error });
  }
}

export async function updateAcademyBookingStatus(input: {
  id: number;
  requesterId: number;
  isStaff: boolean;
  status?: string;
  mewsStatus?: string;
}) {
  try {
    const existing = await db
      .select()
      .from(academyBookings)
      .where(eq(academyBookings.id, input.id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError('Reserva de clase no encontrada.');
    }
    const row = existing[0];

    if (!input.isStaff && row.userId !== input.requesterId) {
      throw new ValidationError('No tienes permiso para modificar esta reserva.');
    }
    if (!input.isStaff && input.status && input.status !== 'cancelled') {
      throw new ValidationError('Solo recepción puede cambiar este estado.');
    }
    if (!input.isStaff && input.mewsStatus) {
      throw new ValidationError('Solo recepción puede actualizar el estado de cobro.');
    }

    const nextStatus = input.status ?? row.status;
    const nextMewsStatus =
      nextStatus === 'cancelled' ? 'CANCELLED' : input.mewsStatus ?? row.mewsStatus;

    const updated = await db
      .update(academyBookings)
      .set({
        status: nextStatus,
        mewsStatus: nextMewsStatus,
      })
      .where(eq(academyBookings.id, input.id))
      .returning();

    return updated[0];
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Error updating academy booking:', error);
    throw new Error('Error al actualizar la reserva de clase', { cause: error });
  }
}

export async function getCentralFleetOverview(date: string, checkStartTime = '10:00') {
  if (!isValidIsoDate(date)) {
    throw new ValidationError('Fecha no válida.');
  }
  try {
    const [allCourses, allVehicles, dayReservations] = await Promise.all([
      db.select().from(courses).orderBy(asc(courses.holes)),
      db.select().from(vehicles).orderBy(asc(vehicles.code)),
      db
        .select({
          id: vehicleReservations.id,
          vehicleId: vehicleReservations.vehicleId,
          courseId: vehicleReservations.courseId,
          userId: vehicleReservations.userId,
          teeTimeReservationId: vehicleReservations.teeTimeReservationId,
          date: vehicleReservations.date,
          startTime: vehicleReservations.startTime,
          endTime: vehicleReservations.endTime,
          mewsStatus: vehicleReservations.mewsStatus,
          status: vehicleReservations.status,
          notes: vehicleReservations.notes,
          userNombre: users.nombre,
          userApellidos: users.apellidos,
          userEmail: users.email,
        })
        .from(vehicleReservations)
        .innerJoin(users, eq(vehicleReservations.userId, users.id))
        .where(eq(vehicleReservations.date, date))
        .orderBy(asc(vehicleReservations.startTime)),
    ]);

    const courseMap = new Map(allCourses.map((c) => [c.id, c]));

    const vehiclesWithState = allVehicles.map((v) => {
      const course = courseMap.get(v.courseId);
      const checkEndTime = addMinutesToTime(
        checkStartTime,
        course ? course.roundDurationMinutes : 135
      );
      const activeReservations = dayReservations.filter(
        (r) => r.vehicleId === v.id && r.status !== 'cancelled'
      );
      const busyAtSelectedTime = activeReservations.some((r) =>
        timesOverlap(checkStartTime, checkEndTime, r.startTime, r.endTime)
      );

      return {
        ...v,
        courseSlug: course?.slug || '',
        courseName: course?.name || '',
        busyAtSelectedTime,
        reservationsToday: activeReservations,
      };
    });

    return {
      date,
      checkStartTime,
      courses: allCourses,
      vehicles: vehiclesWithState,
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    console.error('Error loading central fleet overview:', error);
    throw new Error('Error al consultar la flota centralizada', { cause: error });
  }
}

export async function createStandaloneVehicleReservation(input: {
  courseSlug: string;
  vehicleType: 'buggy' | 'electric_trolley';
  vehicleId?: number;
  userId: number;
  date: string;
  startTime: string;
  notes?: string;
}) {
  if (!isValidIsoDate(input.date)) {
    throw new ValidationError('Fecha no válida.');
  }
  if (timeToMinutes(input.startTime) < 8 * 60 + 30 || timeToMinutes(input.startTime) > 19 * 60) {
    throw new ValidationError('Horario de uso permitido entre 08:30 y 19:00.');
  }

  try {
    return await db.transaction(async (tx) => {
      const courseRows = await tx
        .select()
        .from(courses)
        .where(eq(courses.slug, input.courseSlug))
        .limit(1);
      if (courseRows.length === 0) {
        throw new NotFoundError('Campo de golf no encontrado.');
      }
      const course = courseRows[0];
      const endTime = addMinutesToTime(input.startTime, course.roundDurationMinutes);

      const candidateVehicles = await tx
        .select()
        .from(vehicles)
        .where(
          and(
            eq(vehicles.courseId, course.id),
            eq(vehicles.type, input.vehicleType),
            eq(vehicles.status, 'operational')
          )
        )
        .orderBy(asc(vehicles.code));

      const dayRes = await tx
        .select()
        .from(vehicleReservations)
        .where(
          and(
            eq(vehicleReservations.courseId, course.id),
            eq(vehicleReservations.date, input.date),
            ne(vehicleReservations.status, 'cancelled')
          )
        );

      const busyIds = new Set(
        dayRes
          .filter((r) => timesOverlap(input.startTime, endTime, r.startTime, r.endTime))
          .map((r) => r.vehicleId)
      );

      let chosen = input.vehicleId
        ? candidateVehicles.find((v) => v.id === input.vehicleId && !busyIds.has(v.id))
        : candidateVehicles.find((v) => !busyIds.has(v.id));

      if (!chosen) {
        const label = input.vehicleType === 'buggy' ? 'buggies' : 'carros eléctricos';
        throw new ConflictError(
          `No hay ${label} disponibles en ${course.name} en la franja ${input.startTime}–${endTime}.`
        );
      }

      const inserted = await tx
        .insert(vehicleReservations)
        .values({
          vehicleId: chosen.id,
          courseId: course.id,
          userId: input.userId,
          date: input.date,
          startTime: input.startTime,
          endTime,
          mewsStatus: 'PENDING_RECEPTION',
          status: 'reserved',
          notes: (input.notes || 'Reserva directa de equipo').trim(),
        })
        .returning();

      return {
        reservation: inserted[0],
        vehicle: chosen,
      };
    });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw error;
    }
    console.error('Error creating standalone vehicle reservation:', error);
    throw new Error('Error al reservar el vehículo', { cause: error });
  }
}

export async function updateVehicleStatus(input: {
  vehicleId: number;
  status: 'operational' | 'maintenance';
  notes?: string;
}) {
  try {
    const updated = await db
      .update(vehicles)
      .set({
        status: input.status,
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      })
      .where(eq(vehicles.id, input.vehicleId))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundError('Vehículo no encontrado.');
    }
    return updated[0];
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    console.error('Error updating vehicle status:', error);
    throw new Error('Error al actualizar el estado del vehículo', { cause: error });
  }
}

export async function updateVehicleReservationStatus(input: {
  id: number;
  requesterId: number;
  isStaff: boolean;
  status?: string;
  mewsStatus?: string;
}) {
  try {
    const existing = await db
      .select()
      .from(vehicleReservations)
      .where(eq(vehicleReservations.id, input.id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError('Reserva de vehículo no encontrada.');
    }
    const row = existing[0];

    if (!input.isStaff && row.userId !== input.requesterId) {
      throw new ValidationError('No tienes permiso para modificar esta reserva.');
    }
    if (!input.isStaff && input.status && input.status !== 'cancelled') {
      throw new ValidationError('Solo recepción puede cambiar el estado operativo.');
    }
    if (!input.isStaff && input.mewsStatus) {
      throw new ValidationError('Solo recepción puede actualizar el estado de cobro.');
    }

    const nextStatus = input.status ?? row.status;
    const nextMewsStatus =
      nextStatus === 'cancelled' ? 'CANCELLED' : input.mewsStatus ?? row.mewsStatus;

    const updated = await db
      .update(vehicleReservations)
      .set({
        status: nextStatus,
        mewsStatus: nextMewsStatus,
      })
      .where(eq(vehicleReservations.id, input.id))
      .returning();

    return updated[0];
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Error updating vehicle reservation:', error);
    throw new Error('Error al actualizar la reserva de vehículo', { cause: error });
  }
}
