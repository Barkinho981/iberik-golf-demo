import nodemailer from 'nodemailer';
import { COURSE_TIME_ZONE, formatEuropeanDate } from './golf-schedule.ts';

export type EmailDispatchStatus = 'sent' | 'pending_smtp' | 'failed';

export interface EmailSendOutcome {
  status: EmailDispatchStatus;
  subject: string;
  bodyPreview: string;
  errorMessage: string;
}

export interface EmailAttachmentVehicle {
  code: string;
  brand?: string | null;
  type?: string;
  startTime: string;
  endTime: string;
}

const SIMPLE_EMAIL_REGEX = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"']+$/;

export function sanitizeEmailAddress(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || /[\r\n]/.test(trimmed)) return '';
  return SIMPLE_EMAIL_REGEX.test(trimmed) ? trimmed : '';
}

export function isValidEmailAddress(raw: unknown): boolean {
  return sanitizeEmailAddress(raw).length > 0;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getMadridClockParts(now: Date = new Date()): {
  isoDate: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COURSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));

  return {
    isoDate: `${year}-${month}-${day}`,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const secureEnv = (process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureEnv === 'true' || port === 465;
  const from =
    (process.env.SMTP_FROM || '').trim() ||
    (user ? `Golf Iberik Hoteles <${user}>` : 'Golf Iberik Hoteles <no-reply@iberikhoteles.com>');

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user,
    pass,
    from,
  };
}

function renderHtmlEnvelope(params: {
  title: string;
  subtitle: string;
  badgeText: string;
  rows: Array<{ label: string; value: string }>;
  footerNote?: string;
}): string {
  const rowsHtml = params.rows
    .map(
      (r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #EBEEF3;color:#555C68;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(
            r.label
          )}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #EBEEF3;color:#111827;font-size:13px;font-weight:600;vertical-align:top;">${escapeHtml(
            r.value
          )}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#F4F6F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <table role="presentation" style="max-width:600px;width:100%;margin:0 auto;background:#FFFFFF;border:1px solid #E2E5EB;border-radius:12px;overflow:hidden;border-collapse:collapse;">
      <tr>
        <td style="background:#0B1B3B;color:#FFFFFF;padding:20px 24px;">
          <div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#CBD5E1;">Iberik Hoteles · Golf Guitiriz &amp; Aguas Santas</div>
          <div style="margin-top:6px;font-size:20px;font-weight:700;">${escapeHtml(params.title)}</div>
          <div style="margin-top:4px;font-size:13px;color:#E2E8F0;">${escapeHtml(params.subtitle)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;">
          <div style="display:inline-block;padding:5px 10px;border-radius:6px;background:#EEF2FF;color:#003087;font-size:12px;font-weight:600;margin-bottom:16px;">
            ${escapeHtml(params.badgeText)}
          </div>
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #EBEEF3;border-radius:8px;">
            ${rowsHtml}
          </table>
          <div style="margin-top:16px;padding:12px 14px;background:#F8FAFC;border:1px solid #E2E5EB;border-radius:8px;font-size:12px;color:#404854;line-height:1.5;">
            ${escapeHtml(
              params.footerNote ||
                'Pago directamente en recepción del campo de golf el día de juego o con cargo a habitación.'
            )}
          </div>
          <div style="margin-top:16px;font-size:12px;color:#555C68;line-height:1.6;">
            Teléfonos de contacto del club:<br/>
            · Golf Guitiriz: <strong>+34 644 981 463</strong><br/>
            · Golf Aguas Santas: <strong>+34 684 712 321</strong>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTextBody(
  title: string,
  subtitle: string,
  rows: Array<{ label: string; value: string }>,
  footerNote?: string
): string {
  const lines = [
    `IBERIK HOTELES · GOLF GUITIRIZ & AGUAS SANTAS`,
    title,
    subtitle,
    '----------------------------------------',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '----------------------------------------',
    footerNote ||
      'Pago directamente en recepción del campo de golf el día de juego o con cargo a habitación.',
    'Teléfonos de contacto: Guitiriz +34 644 981 463 · Aguas Santas +34 684 712 321',
  ];
  return lines.join('\n');
}

export function buildTeeTimeConfirmationContent(params: {
  kind: 'instant_confirmation' | 'daily_0700';
  reservationId: number;
  courseName: string;
  courseHoles: number;
  date: string;
  slotTime: string;
  titularName: string;
  titularPhone: string;
  titularLicense: string;
  playersCount: number;
  playerNames: string;
  buggiesRequested: number;
  trolleysRequested: number;
  assignedVehicles: EmailAttachmentVehicle[];
  mewsReference: string;
  notes: string;
  confirmationEmail: string;
}) {
  const euDate = formatEuropeanDate(params.date);
  const isMorning = params.kind === 'daily_0700';
  const subject = isMorning
    ? `[Recordatorio 07:00] Confirmación Tee Time hoy ${euDate} · ${params.slotTime} (${params.courseName})`
    : `Confirmación Tee Time #${params.reservationId} · ${euDate} ${params.slotTime} · ${params.courseName}`;

  const vehiclesSummary =
    params.assignedVehicles.length > 0
      ? params.assignedVehicles
          .map(
            (v) =>
              `${v.code}${v.brand ? ` (${v.brand})` : ''} ${v.startTime}–${v.endTime}`
          )
          .join(', ')
      : `${params.buggiesRequested} buggy(s) · ${params.trolleysRequested} carro(s)`;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Reserva', value: `#${params.reservationId} · Tee Time` },
    { label: 'Campo', value: `${params.courseName} (${params.courseHoles} hoyos)` },
    { label: 'Fecha (DD-MM-AAAA)', value: euDate },
    { label: 'Hora de salida', value: params.slotTime },
    { label: 'Titular', value: params.titularName },
    { label: 'Correo de confirmación', value: params.confirmationEmail },
    { label: 'Teléfono / Licencia', value: `${params.titularPhone || '—'} · ${params.titularLicense || 'Sin licencia'}` },
    {
      label: 'Jugadores',
      value: `${params.playersCount} ${params.playersCount === 1 ? 'jugador' : 'jugadores'}${
        params.playerNames ? ` (${params.playerNames})` : ''
      }`,
    },
    { label: 'Vehículos asignados', value: vehiclesSummary },
  ];

  if (params.mewsReference) {
    rows.push({ label: 'Folio / Habitación', value: params.mewsReference });
  }
  if (params.notes) {
    rows.push({ label: 'Observaciones', value: params.notes });
  }

  const title = isMorning ? 'Recordatorio matinal 07:00 · Tu salida de hoy' : 'Confirmación de Reserva de Tee Time';
  const subtitle = `${params.courseName} · ${euDate} a las ${params.slotTime}`;
  const badgeText = isMorning
    ? `Envío automático de las 07:00 h · Reserva #${params.reservationId}`
    : `Reserva confirmada #${params.reservationId}`;

  return {
    subject,
    html: renderHtmlEnvelope({ title, subtitle, badgeText, rows }),
    text: buildTextBody(title, subtitle, rows),
  };
}

export function buildAcademyConfirmationContent(params: {
  kind: 'instant_confirmation' | 'daily_0700';
  bookingId: number;
  courseName: string;
  instructor: string;
  date: string;
  slotTime: string;
  endTime: string;
  titularName: string;
  studentName: string;
  studentPhone: string;
  studentsCount: number;
  level: string;
  isComplete: boolean;
  notes: string;
  confirmationEmail: string;
}) {
  const euDate = formatEuropeanDate(params.date);
  const isMorning = params.kind === 'daily_0700';
  const subject = isMorning
    ? `[Recordatorio 07:00] Clase de Golf hoy ${euDate} · ${params.slotTime} (${params.instructor})`
    : `Confirmación Clase de Golf #${params.bookingId} · ${euDate} ${params.slotTime} · ${params.courseName}`;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Reserva', value: `#${params.bookingId} · Academia de Golf` },
    { label: 'Campo y profesor', value: `${params.courseName} · ${params.instructor}` },
    { label: 'Fecha (DD-MM-AAAA)', value: euDate },
    { label: 'Horario de clase', value: `${params.slotTime} – ${params.endTime} (30 min)` },
    { label: 'Alumno(s)', value: `${params.studentName} (${params.studentsCount} ${params.studentsCount === 1 ? 'alumno' : 'alumnos'})` },
    { label: 'Titular / Correo confirmación', value: `${params.titularName} · ${params.confirmationEmail}` },
    { label: 'Teléfono de contacto', value: params.studentPhone || 'No indicado' },
    { label: 'Enfoque de sesión', value: params.level },
  ];

  if (params.isComplete) {
    rows.push({ label: 'Modalidad', value: 'Clase completa (franja exclusiva cerrada)' });
  }
  if (params.notes) {
    rows.push({ label: 'Notas', value: params.notes });
  }

  const title = isMorning ? 'Recordatorio matinal 07:00 · Tu clase de golf hoy' : 'Confirmación de Clase de Golf';
  const subtitle = `${params.courseName} · ${params.instructor} · ${euDate} (${params.slotTime}–${params.endTime})`;
  const badgeText = isMorning
    ? `Envío automático de las 07:00 h · Clase #${params.bookingId}`
    : `Plaza confirmada #${params.bookingId}`;

  return {
    subject,
    html: renderHtmlEnvelope({ title, subtitle, badgeText, rows }),
    text: buildTextBody(title, subtitle, rows),
  };
}

export function buildVehicleConfirmationContent(params: {
  kind: 'instant_confirmation' | 'daily_0700';
  reservationId: number;
  courseName: string;
  vehicleCode: string;
  vehicleBrand: string;
  vehicleType: string;
  date: string;
  startTime: string;
  endTime: string;
  titularName: string;
  titularPhone: string;
  notes: string;
  confirmationEmail: string;
}) {
  const euDate = formatEuropeanDate(params.date);
  const isMorning = params.kind === 'daily_0700';
  const typeLabel = params.vehicleType === 'buggy' ? 'Buggy' : 'Carro eléctrico';
  const vehicleFull = `${params.vehicleCode} · ${typeLabel}${params.vehicleBrand ? ` (${params.vehicleBrand})` : ''}`;

  const subject = isMorning
    ? `[Recordatorio 07:00] Vehículo ${params.vehicleCode} hoy ${euDate} · ${params.startTime}`
    : `Confirmación Vehículo ${params.vehicleCode} · ${euDate} ${params.startTime} · ${params.courseName}`;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Reserva', value: `#${params.reservationId} · Vehículo` },
    { label: 'Campo', value: params.courseName },
    { label: 'Unidad asignada', value: vehicleFull },
    { label: 'Fecha (DD-MM-AAAA)', value: euDate },
    { label: 'Franja de uso (4h)', value: `${params.startTime} – ${params.endTime}` },
    { label: 'Titular', value: params.titularName },
    { label: 'Correo de confirmación', value: params.confirmationEmail },
    { label: 'Teléfono', value: params.titularPhone || 'No indicado' },
  ];

  if (params.notes) {
    rows.push({ label: 'Referencia / Nota', value: params.notes });
  }

  const title = isMorning ? 'Recordatorio matinal 07:00 · Vehículo reservado hoy' : 'Confirmación de Reserva de Vehículo';
  const subtitle = `${vehicleFull} · ${params.courseName} · ${euDate}`;
  const badgeText = isMorning
    ? `Envío automático de las 07:00 h · Vehículo #${params.reservationId}`
    : `Unidad confirmada #${params.reservationId}`;

  return {
    subject,
    html: renderHtmlEnvelope({ title, subtitle, badgeText, rows }),
    text: buildTextBody(title, subtitle, rows),
  };
}

export async function dispatchEmailMessage(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailSendOutcome> {
  const safeTo = sanitizeEmailAddress(params.to);
  const preview = params.text.slice(0, 500);

  if (!safeTo) {
    return {
      status: 'failed',
      subject: params.subject,
      bodyPreview: preview,
      errorMessage: 'Dirección de correo de confirmación no válida o vacía.',
    };
  }

  const smtp = getSmtpConfig();
  if (!smtp) {
    return {
      status: 'pending_smtp',
      subject: params.subject,
      bodyPreview: preview,
      errorMessage:
        'SMTP pendiente de configuración en variables de entorno (SMTP_HOST, SMTP_USER, SMTP_PASS).',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    await transporter.sendMail({
      from: smtp.from,
      to: safeTo,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });

    return {
      status: 'sent',
      subject: params.subject,
      bodyPreview: preview,
      errorMessage: '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido al enviar correo';
    console.error(`SMTP send error to ${safeTo}:`, err);
    return {
      status: 'failed',
      subject: params.subject,
      bodyPreview: preview,
      errorMessage: message,
    };
  }
}
