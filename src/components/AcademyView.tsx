import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AcademyAvailabilityResponse,
  AcademySlotAvailability,
  UserProfile,
} from '../types/golf';
import {
  formatSpanishDate,
  getNextWednesdayIsoDate,
  getUpcomingWednesdays,
} from '../lib/golf-schedule';
import { AdminPlayerSelector } from './AdminPlayerSelector';

interface AcademyViewProps {
  initialTargetUserId?: string;
}

export const AcademyView: React.FC<AcademyViewProps> = ({ initialTargetUserId = '' }) => {
  const { firebaseUser, profile, isStaff, signInWithGoogle, authFetch } = useAuth();
  const upcomingWednesdays = getUpcomingWednesdays(6);

  const [date, setDate] = useState<string>(upcomingWednesdays[0]);
  const [data, setData] = useState<AcademyAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<AcademySlotAvailability | null>(null);
  const [studentsCount, setStudentsCount] = useState(1);
  const [level, setLevel] = useState('Perfeccionamiento');
  const [notes, setNotes] = useState('');
  const [staffTargetUserId, setStaffTargetUserId] = useState(initialTargetUserId);
  const [playersDirectory, setPlayersDirectory] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (initialTargetUserId !== undefined) {
      setStaffTargetUserId(initialTargetUserId);
    }
  }, [initialTargetUserId]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedMsg, setConfirmedMsg] = useState<string | null>(null);

  const fetchAvailability = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/academy/availability?date=${encodeURIComponent(date)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo consultar la agenda de Víctor López.');
      }
      const payload: AcademyAvailabilityResponse = await res.json();
      setData(payload);
      setSelectedSlot((prev) => {
        if (!payload.isWednesday) return null;
        if (!prev) {
          return payload.slots.find((s) => s.remainingSpots > 0) || payload.slots[0] || null;
        }
        return payload.slots.find((s) => s.slotTime === prev.slotTime) || payload.slots[0] || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  useEffect(() => {
    if (!isStaff || !firebaseUser) return;
    let cancelled = false;
    authFetch('/api/users')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: UserProfile[]) => {
        if (!cancelled) setPlayersDirectory(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStaff, firebaseUser, authFetch]);

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !data?.isWednesday) return;
    setSubmitError(null);
    setConfirmedMsg(null);

    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/academy/bookings', {
        method: 'POST',
        body: JSON.stringify({
          date,
          slotTime: selectedSlot.slotTime,
          studentsCount,
          level,
          notes,
          ...(isStaff && staffTargetUserId ? { targetUserId: Number(staffTargetUserId) } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'No se pudo confirmar la plaza en clase.');
      }

      const titularName = body.titular
        ? `${body.titular.nombre || ''} ${body.titular.apellidos || ''}`.trim() || body.titular.email
        : '';

      setConfirmedMsg(
        `Clase reservada con Víctor López en Guitiriz el ${date} a las ${selectedSlot.slotTime} (${studentsCount} ${
          studentsCount === 1 ? 'alumno' : 'alumnos'
        })${titularName ? ` a nombre de ${titularName}` : ''}. Pago en la recepción del hotel.`
      );
      setNotes('');
      await fetchAvailability();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al reservar la clase');
    } finally {
      setSubmitting(false);
    }
  };

  const morningSlots = data?.slots.filter((s) => s.session === 'morning') || [];
  const afternoonSlots = data?.slots.filter((s) => s.session === 'afternoon') || [];

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#E2E5EB]">
        <div>
          <p className="text-xs font-medium text-[#555C68]">
            Golf Guitiriz · Profesor Víctor López · Miércoles · 30 minutos · Máx. 4 alumnos
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl font-semibold text-[#111827]">
            Academia de Golf en Guitiriz
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Fecha de clase"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirmedMsg(null);
            }}
            className="px-3.5 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
          />
          <button
            type="button"
            onClick={fetchAvailability}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-[#E2E5EB] rounded-lg text-[#111827] hover:bg-[#F4F6F9] whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Upcoming Wednesdays Quick Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[#555C68] mr-2">Próximos miércoles:</span>
        {upcomingWednesdays.map((wed) => (
          <button
            key={wed}
            type="button"
            onClick={() => {
              setDate(wed);
              setConfirmedMsg(null);
            }}
            className={`px-3 py-1.5 text-xs font-mono tabular-nums rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              date === wed
                ? 'bg-[#003087] text-white border-[#003087]'
                : 'bg-white text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
            }`}
          >
            {wed}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && !data.isWednesday ? (
        <div className="p-8 bg-white border border-[#E2E5EB] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-base font-semibold text-[#111827]">
              La fecha seleccionada ({formatSpanishDate(date)}) no es miércoles.
            </p>
            <p className="text-sm text-[#555C68]">
              Víctor López imparte sus clases en Guitiriz exclusivamente los miércoles de 11:00 a
              14:00 y de 16:00 a 18:00.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDate(getNextWednesdayIsoDate(date))}
            className="px-4 py-2.5 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg whitespace-nowrap shrink-0"
          >
            Ir al próximo miércoles
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Slots List */}
          <div className="lg:col-span-7 space-y-6">
            {/* Morning */}
            <div className="bg-white border border-[#E2E5EB] rounded-xl p-6 space-y-4">
              <div className="flex items-baseline justify-between border-b border-[#EBEEF3] pb-3">
                <h2 className="font-display text-2xl font-semibold text-[#111827]">
                  Turno de mañana
                </h2>
                <span className="text-xs font-hours font-medium tabular-nums text-[#555C68]">
                  11:00 – 14:00 · 6 sesiones de 30 min
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {morningSlots.map((slot) => {
                  const isFull = slot.remainingSpots === 0;
                  const isSelected = selectedSlot?.slotTime === slot.slotTime;
                  return (
                    <button
                      key={slot.slotTime}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot);
                        setStudentsCount((prev) =>
                          Math.max(1, Math.min(prev, slot.remainingSpots || 1))
                        );
                        setSubmitError(null);
                      }}
                      className={`p-3.5 rounded-xl border text-left transition-colors ${
                        isSelected
                          ? 'bg-[#003087] text-white border-[#003087]'
                          : isFull
                          ? 'bg-[#EEF1F6] text-[#7A828E] border-[#E2E5EB]'
                          : 'bg-[#F8FAFC] text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
                      }`}
                    >
                      <p className="font-hours text-sm font-semibold tabular-nums">
                        {slot.slotTime} – {slot.endTime}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          isSelected
                            ? 'text-white/85'
                            : isFull
                            ? 'text-[#B91C1C]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        {isFull
                          ? 'Grupo completo (4/4)'
                          : `${slot.remainingSpots}/4 plazas libres`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Afternoon */}
            <div className="bg-white border border-[#E2E5EB] rounded-xl p-6 space-y-4">
              <div className="flex items-baseline justify-between border-b border-[#EBEEF3] pb-3">
                <h2 className="font-display text-2xl font-semibold text-[#111827]">
                  Turno de tarde
                </h2>
                <span className="text-xs font-hours font-medium tabular-nums text-[#555C68]">
                  16:00 – 18:00 · 4 sesiones de 30 min
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {afternoonSlots.map((slot) => {
                  const isFull = slot.remainingSpots === 0;
                  const isSelected = selectedSlot?.slotTime === slot.slotTime;
                  return (
                    <button
                      key={slot.slotTime}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot);
                        setStudentsCount((prev) =>
                          Math.max(1, Math.min(prev, slot.remainingSpots || 1))
                        );
                        setSubmitError(null);
                      }}
                      className={`p-3.5 rounded-xl border text-left transition-colors ${
                        isSelected
                          ? 'bg-[#003087] text-white border-[#003087]'
                          : isFull
                          ? 'bg-[#EEF1F6] text-[#7A828E] border-[#E2E5EB]'
                          : 'bg-[#F8FAFC] text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
                      }`}
                    >
                      <p className="font-hours text-sm font-semibold tabular-nums">
                        {slot.slotTime} – {slot.endTime}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          isSelected
                            ? 'text-white/85'
                            : isFull
                            ? 'text-[#B91C1C]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        {isFull
                          ? 'Grupo completo (4/4)'
                          : `${slot.remainingSpots}/4 plazas libres`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Booking Form */}
          <aside className="lg:col-span-5 bg-white border border-[#E2E5EB] rounded-xl p-6 space-y-5">
            {selectedSlot ? (
              <>
                <div className="pb-4 border-b border-[#EBEEF3]">
                  <p className="text-xs text-[#555C68]">
                    Guitiriz · Profesor Víctor López
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-semibold text-[#111827]">
                    Clase{' '}
                    <span className="font-hours font-semibold tabular-nums">
                      {selectedSlot.slotTime} – {selectedSlot.endTime}
                    </span>
                  </h2>
                  <p className="mt-1 text-xs text-[#555C68] capitalize">
                    {formatSpanishDate(date)}
                  </p>
                </div>

                {confirmedMsg && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <span>{confirmedMsg}</span>
                  </div>
                )}

                {submitError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                {selectedSlot.remainingSpots === 0 ? (
                  <p className="text-sm text-[#B91C1C] py-4">
                    Este turno ya alcanzó el máximo de 4 alumnos. Selecciona otro horario de 30
                    minutos.
                  </p>
                ) : (
                  <form onSubmit={handleBook} className="space-y-4">
                    {isStaff && (
                      <AdminPlayerSelector
                        players={playersDirectory}
                        selectedUserId={staffTargetUserId}
                        onChange={setStaffTargetUserId}
                        onPlayerCreated={(created) =>
                          setPlayersDirectory((prev) =>
                            prev.some((u) => u.id === created.id)
                              ? prev.map((u) => (u.id === created.id ? created : u))
                              : [...prev, created]
                          )
                        }
                        authFetch={authFetch}
                        currentAdminLabel={
                          profile
                            ? `${profile.nombre} ${profile.apellidos}`.trim() || profile.email
                            : undefined
                        }
                      />
                    )}

                    <div>
                      <label className="block text-xs font-medium text-[#404854] mb-1.5">
                        Plazas a reservar (máx. {selectedSlot.remainingSpots} libres)
                      </label>
                      <div className="grid grid-cols-4 gap-2">
                        {[1, 2, 3, 4].map((n) => {
                          const disabled = n > selectedSlot.remainingSpots;
                          return (
                            <button
                              key={n}
                              type="button"
                              disabled={disabled}
                              onClick={() => setStudentsCount(n)}
                              className={`py-2 text-xs font-mono font-medium rounded-lg border transition-colors ${
                                studentsCount === n
                                  ? 'bg-[#003087] text-white border-[#003087]'
                                  : disabled
                                  ? 'bg-[#EEF1F6] text-[#A2AAA4] border-[#E2E5EB] cursor-not-allowed'
                                  : 'bg-white text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
                              }`}
                            >
                              {n} {n === 1 ? 'alum.' : 'alum.'}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="academy-level"
                        className="block text-xs font-medium text-[#404854] mb-1.5"
                      >
                        Enfoque de la sesión
                      </label>
                      <select
                        id="academy-level"
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                      >
                        <option value="Iniciación">Iniciación (toma de contacto)</option>
                        <option value="Perfeccionamiento">Perfeccionamiento de swing</option>
                        <option value="Juego corto y putt">Juego corto, approach y putt</option>
                        <option value="Salida al campo">Estrategia y salida a 9 hoyos</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="academy-notes"
                        className="block text-xs font-medium text-[#404854] mb-1.5"
                      >
                        Notas para Víctor López
                      </label>
                      <input
                        id="academy-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Hándicap actual, préstamo de palos..."
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                      />
                    </div>

                    <div className="p-3.5 bg-[#F4F6F9] border border-[#E2E5EB] rounded-lg text-xs text-[#404854]">
                      La clase se abona directamente en la recepción del hotel.
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] disabled:opacity-60 rounded-lg transition-colors"
                    >
                      {!firebaseUser
                        ? 'Acceder con Google para reservar clase'
                        : submitting
                        ? 'Reservando plaza...'
                        : (
                          <>
                            Reservar clase de las{' '}
                            <span className="font-hours tabular-nums">{selectedSlot.slotTime}</span>
                          </>
                        )}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <p className="text-xs text-[#555C68]">
                Selecciona una sesión de miércoles para ver los detalles.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
