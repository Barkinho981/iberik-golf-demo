import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  CourseAvailabilityResponse,
  TeeTimeSlotAvailability,
  UserProfile,
} from '../types/golf';
import { formatSpanishDate, getTodayIsoDate, timeToMinutes } from '../lib/golf-schedule';
import { AdminPlayerSelector } from './AdminPlayerSelector';

interface TeeTimesViewProps {
  initialCourseSlug?: string;
  initialTargetUserId?: string;
}

export const TeeTimesView: React.FC<TeeTimesViewProps> = ({
  initialCourseSlug = 'guitiriz',
  initialTargetUserId = '',
}) => {
  const { firebaseUser, profile, isStaff, signInWithGoogle, authFetch } = useAuth();
  const [courseSlug, setCourseSlug] = useState<string>(initialCourseSlug);
  const [date, setDate] = useState<string>(getTodayIsoDate());
  const [sessionFilter, setSessionFilter] = useState<'all' | 'morning' | 'afternoon'>('all');
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const [data, setData] = useState<CourseAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<TeeTimeSlotAvailability | null>(null);
  const [playersCount, setPlayersCount] = useState(2);
  const [playerNames, setPlayerNames] = useState('');
  const [buggiesRequested, setBuggiesRequested] = useState(0);
  const [trolleysRequested, setTrolleysRequested] = useState(0);
  const [mewsReference, setMewsReference] = useState('');
  const [notes, setNotes] = useState('');
  const [staffTargetUserId, setStaffTargetUserId] = useState<string>(initialTargetUserId);
  const [playersDirectory, setPlayersDirectory] = useState<UserProfile[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    slotTime: string;
    courseName: string;
    vehicles: string[];
    titularLabel?: string;
  } | null>(null);

  useEffect(() => {
    if (initialCourseSlug) {
      setCourseSlug(initialCourseSlug);
    }
  }, [initialCourseSlug]);

  useEffect(() => {
    if (initialTargetUserId !== undefined) {
      setStaffTargetUserId(initialTargetUserId);
    }
  }, [initialTargetUserId]);

  const fetchAvailability = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/availability?course=${encodeURIComponent(courseSlug)}&date=${encodeURIComponent(date)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar la parrilla de salidas.');
      }
      const payload: CourseAvailabilityResponse = await res.json();
      setData(payload);
      setSelectedSlot((prev) => {
        if (!prev) {
          return payload.slots.find((s) => s.remainingPlayers > 0) || payload.slots[0] || null;
        }
        return payload.slots.find((s) => s.slotTime === prev.slotTime) || payload.slots[0] || null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [courseSlug, date]);

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

  const filteredSlots = useMemo(() => {
    if (!data) return [];
    return data.slots.filter((slot) => {
      const mins = timeToMinutes(slot.slotTime);
      if (sessionFilter === 'morning' && mins >= 14 * 60) return false;
      if (sessionFilter === 'afternoon' && mins < 14 * 60) return false;
      if (onlyAvailable && slot.remainingPlayers === 0) return false;
      return true;
    });
  }, [data, sessionFilter, onlyAvailable]);

  const handleSelectSlot = (slot: TeeTimeSlotAvailability) => {
    setSelectedSlot(slot);
    setConfirmation(null);
    setSubmitError(null);
    setPlayersCount((prev) => Math.max(1, Math.min(prev, slot.remainingPlayers || 1)));
    setBuggiesRequested((prev) => Math.min(prev, slot.availableBuggies));
    setTrolleysRequested((prev) => Math.min(prev, slot.availableTrolleys));
  };

  const handleReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !data) return;
    setSubmitError(null);
    setConfirmation(null);

    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/tee-times', {
        method: 'POST',
        body: JSON.stringify({
          courseSlug,
          date,
          slotTime: selectedSlot.slotTime,
          playersCount,
          playerNames,
          buggiesRequested,
          trolleysRequested,
          mewsReference,
          notes,
          ...(isStaff && staffTargetUserId ? { targetUserId: Number(staffTargetUserId) } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'No se pudo completar la reserva.');
      }

      const assignedCodes: string[] = Array.isArray(body.assignedVehicles)
        ? body.assignedVehicles.map((v: { code: string }) => v.code)
        : [];
      const titularName = body.titular
        ? `${body.titular.nombre || ''} ${body.titular.apellidos || ''}`.trim() || body.titular.email
        : undefined;

      setConfirmation({
        slotTime: selectedSlot.slotTime,
        courseName: data.course.name,
        vehicles: assignedCodes,
        titularLabel: titularName,
      });
      setPlayerNames('');
      setBuggiesRequested(0);
      setTrolleysRequested(0);
      setMewsReference('');
      setNotes('');
      await fetchAvailability();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error al procesar la reserva');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-10 space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#E2E5EB]">
        <div>
          <p className="text-xs font-medium text-[#555C68]">
            Parrilla en tiempo real · Salidas de 08:30 a 19:00 cada 10 minutos
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl font-semibold text-[#111827]">
            Reservas de Tee Time
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Course Segmented Selector */}
          <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg border border-[#E2E5EB]">
            <button
              type="button"
              onClick={() => {
                setCourseSlug('guitiriz');
                setConfirmation(null);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                courseSlug === 'guitiriz'
                  ? 'bg-white text-[#111827] shadow-xs'
                  : 'text-[#555C68] hover:text-[#111827]'
              }`}
            >
              Guitiriz · 9 hoyos
            </button>
            <button
              type="button"
              onClick={() => {
                setCourseSlug('aguas-santas');
                setConfirmation(null);
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                courseSlug === 'aguas-santas'
                  ? 'bg-white text-[#111827] shadow-xs'
                  : 'text-[#555C68] hover:text-[#111827]'
              }`}
            >
              Aguas Santas · 18 hoyos
            </button>
          </div>

          <input
            type="date"
            aria-label="Fecha de reserva"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirmation(null);
            }}
            className="px-3.5 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg text-[#111827] focus-visible:outline-2 focus-visible:outline-[#003087]"
          />

          <button
            type="button"
            onClick={fetchAvailability}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-[#E2E5EB] rounded-lg text-[#111827] hover:bg-[#F4F6F9] transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg">
            {[
              { id: 'all', label: 'Toda la jornada (64)' },
              { id: 'morning', label: 'Mañana · 08:30–13:50' },
              { id: 'afternoon', label: 'Tarde · 14:00–19:00' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSessionFilter(item.id as 'all' | 'morning' | 'afternoon')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sessionFilter === item.id
                    ? 'bg-white text-[#111827] shadow-xs'
                    : 'text-[#555C68] hover:text-[#111827]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[#404854] cursor-pointer select-none px-2">
            <input
              type="checkbox"
              checked={onlyAvailable}
              onChange={(e) => setOnlyAvailable(e.target.checked)}
              className="rounded border-[#C8CCC4] text-[#003087] focus:ring-[#003087]"
            />
            <span>Ocultar salidas completas</span>
          </label>
        </div>

        {data && (
          <div className="text-xs text-[#555C68] font-mono tabular-nums">
            <span>{formatSpanishDate(data.date)}</span>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            <span>
              Vehículos operativos: {data.fleetTotals.buggiesOperational}/{data.fleetTotals.buggiesTotal}{' '}
              buggies · {data.fleetTotals.trolleysOperational}/{data.fleetTotals.trolleysTotal}{' '}
              carros
            </span>
          </div>
        )}
      </div>

      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Main Two-Column Grid: Tee Sheet + Booking Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Tee Sheet Grid */}
        <div className="lg:col-span-7 xl:col-span-8">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 16 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-24 rounded-xl bg-white border border-[#E2E5EB] animate-pulse"
                />
              ))}
            </div>
          ) : filteredSlots.length === 0 ? (
            <div className="p-10 bg-white border border-[#E2E5EB] rounded-xl text-center space-y-3">
              <p className="text-sm font-medium text-[#111827]">
                No hay salidas disponibles con el filtro actual.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSessionFilter('all');
                  setOnlyAvailable(false);
                }}
                className="px-4 py-2 text-xs font-medium bg-[#EBEEF3] text-[#111827] rounded-lg hover:bg-[#E2E5EB]"
              >
                Mostrar todas las franjas
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredSlots.map((slot) => {
                const isFull = slot.remainingPlayers === 0;
                const isSelected = selectedSlot?.slotTime === slot.slotTime;
                const isPartial = !isFull && slot.remainingPlayers < 4;

                return (
                  <button
                    key={slot.slotTime}
                    type="button"
                    onClick={() => handleSelectSlot(slot)}
                    className={`text-left p-3.5 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-[#003087] text-white border-[#003087]'
                        : isFull
                        ? 'bg-[#EEF1F6] text-[#7A828E] border-[#E2E5EB] hover:border-[#C9CBC2]'
                        : 'bg-white text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-hours text-base font-semibold tabular-nums">
                        {slot.slotTime}
                      </span>
                      <span
                        className={`text-[11px] font-medium whitespace-nowrap ${
                          isSelected
                            ? 'text-white/90'
                            : isFull
                            ? 'text-[#B91C1C]'
                            : isPartial
                            ? 'text-[#B45309]'
                            : 'text-[#15803D]'
                        }`}
                      >
                        {isFull ? 'Completo' : `${slot.remainingPlayers}/4 libres`}
                      </span>
                    </div>

                    <div
                      className={`mt-2.5 pt-2 border-t text-[11px] font-mono tabular-nums flex items-center justify-between ${
                        isSelected
                          ? 'border-white/20 text-white/85'
                          : 'border-[#EBEEF3] text-[#555C68]'
                      }`}
                    >
                      <span>{slot.availableBuggies} bug.</span>
                      <span>{slot.availableTrolleys} car.</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky Reservation Panel */}
        <aside className="lg:col-span-5 xl:col-span-4 bg-white border border-[#E2E5EB] rounded-xl p-6 lg:sticky lg:top-24 space-y-5">
          {selectedSlot && data ? (
            <>
              <div className="pb-4 border-b border-[#EBEEF3]">
                <p className="text-xs text-[#555C68]">
                  {data.course.name} · {data.course.holes} hoyos
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-2xl font-semibold text-[#111827]">
                    Salida <span className="font-hours font-semibold tabular-nums">{selectedSlot.slotTime}</span>
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-[#555C68]">
                    {date}
                  </span>
                </div>
              </div>

              {confirmation && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      Reserva confirmada en {confirmation.courseName} a las{' '}
                      <span className="font-hours font-semibold">{confirmation.slotTime}</span>
                    </span>
                  </div>
                  {confirmation.titularLabel && (
                    <p className="text-[11px] font-medium text-emerald-900">
                      Titular: {confirmation.titularLabel}
                    </p>
                  )}
                  {confirmation.vehicles.length > 0 && (
                    <p className="font-mono text-[11px]">
                      Equipo asignado: {confirmation.vehicles.join(', ')}
                    </p>
                  )}
                  <p className="text-emerald-800">
                    Pendiente de abono en la recepción del hotel.
                  </p>
                </div>
              )}

              {submitError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {selectedSlot.remainingPlayers === 0 ? (
                <div className="py-6 text-center space-y-2">
                  <p className="text-sm font-medium text-[#B91C1C]">
                    Esta franja de salida ya tiene las 4 plazas completas.
                  </p>
                  <p className="text-xs text-[#555C68]">
                    Elige otro intervalo de 10 minutos en la parrilla.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleReserve} className="space-y-4">
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
                      Jugadores en la partida (máx. {selectedSlot.remainingPlayers} disponibles)
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {[1, 2, 3, 4].map((n) => {
                        const disabled = n > selectedSlot.remainingPlayers;
                        return (
                          <button
                            key={n}
                            type="button"
                            disabled={disabled}
                            onClick={() => setPlayersCount(n)}
                            className={`py-2 text-xs font-mono font-medium rounded-lg border transition-colors ${
                              playersCount === n
                                ? 'bg-[#003087] text-white border-[#003087]'
                                : disabled
                                ? 'bg-[#EEF1F6] text-[#A2AAA4] border-[#E2E5EB] cursor-not-allowed'
                                : 'bg-white text-[#111827] border-[#E2E5EB] hover:border-[#003087]'
                            }`}
                          >
                            {n} {n === 1 ? 'jug.' : 'jug.'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="player-names"
                      className="block text-xs font-medium text-[#404854] mb-1.5"
                    >
                      Acompañantes / Licencias (opcional)
                    </label>
                    <input
                      id="player-names"
                      type="text"
                      value={playerNames}
                      onChange={(e) => setPlayerNames(e.target.value)}
                      placeholder="Ej. Carlos Pérez (GA001245), Ana Vila"
                      className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg text-[#111827] focus-visible:outline-2 focus-visible:outline-[#003087]"
                    />
                  </div>

                  {/* Vehicle Allocation */}
                  <div className="pt-3 border-t border-[#EBEEF3] space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[#111827]">
                        Reserva de vehículos para esta salida
                      </p>
                      <span className="text-[11px] font-mono text-[#555C68]">
                        Bloqueo {data.course.roundDurationMinutes} min
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="buggies-select"
                          className="block text-[11px] text-[#555C68] mb-1"
                        >
                          Buggies ({selectedSlot.availableBuggies} disp.)
                        </label>
                        <select
                          id="buggies-select"
                          value={buggiesRequested}
                          onChange={(e) => setBuggiesRequested(Number(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                        >
                          {Array.from({
                            length: Math.min(2, selectedSlot.availableBuggies) + 1,
                          }).map((_, idx) => (
                            <option key={idx} value={idx}>
                              {idx} {idx === 1 ? 'buggy' : 'buggies'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="trolleys-select"
                          className="block text-[11px] text-[#555C68] mb-1"
                        >
                          Carros eléct. ({selectedSlot.availableTrolleys} disp.)
                        </label>
                        <select
                          id="trolleys-select"
                          value={trolleysRequested}
                          onChange={(e) => setTrolleysRequested(Number(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                        >
                          {Array.from({
                            length: Math.min(4, selectedSlot.availableTrolleys) + 1,
                          }).map((_, idx) => (
                            <option key={idx} value={idx}>
                              {idx} {idx === 1 ? 'carro' : 'carros'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="mews-ref"
                        className="block text-xs font-medium text-[#404854] mb-1.5"
                      >
                        Habitación / Referencia
                      </label>
                      <input
                        id="mews-ref"
                        type="text"
                        value={mewsReference}
                        onChange={(e) => setMewsReference(e.target.value)}
                        placeholder="Opcional (ej. Hab. 204)"
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="tee-notes"
                        className="block text-xs font-medium text-[#404854] mb-1.5"
                      >
                        Observaciones
                      </label>
                      <input
                        id="tee-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Alquiler de palos, etc."
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
                      />
                    </div>
                  </div>

                  <div className="p-3.5 bg-[#F4F6F9] border border-[#E2E5EB] rounded-lg text-xs text-[#404854]">
                    <p className="font-semibold text-[#111827]">
                      Pago en recepción del hotel
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#555C68]">
                      La reserva queda confirmada al instante sin cobro online; el pago se realiza
                      directamente en la recepción del hotel.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {!firebaseUser
                      ? 'Acceder con Google para confirmar'
                      : submitting
                      ? 'Confirmando reserva...'
                      : (
                        <>
                          Confirmar salida a las{' '}
                          <span className="font-hours tabular-nums">{selectedSlot.slotTime}</span>
                        </>
                      )}
                  </button>
                </form>
              )}
            </>
          ) : (
            <p className="text-xs text-[#555C68]">Cargando detalles de la salida...</p>
          )}
        </aside>
      </div>
    </div>
  );
};
