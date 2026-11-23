import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Wrench } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { FleetOverviewResponse, FleetVehicleItem, UserProfile } from '../types/golf';
import { TEE_TIME_SLOTS, getTodayIsoDate } from '../lib/golf-schedule';
import { AdminPlayerSelector } from './AdminPlayerSelector';

interface FleetViewProps {
  initialTargetUserId?: string;
}

export const FleetView: React.FC<FleetViewProps> = ({ initialTargetUserId = '' }) => {
  const { firebaseUser, profile, isStaff, signInWithGoogle, authFetch } = useAuth();
  const [date, setDate] = useState<string>(getTodayIsoDate());
  const [checkStartTime, setCheckStartTime] = useState<string>('10:00');
  const [courseFilter, setCourseFilter] = useState<'all' | 'guitiriz' | 'aguas-santas'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'buggy' | 'electric_trolley'>('all');

  const [overview, setOverview] = useState<FleetOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Direct standalone reservation form
  const [reserveCourse, setReserveCourse] = useState<'guitiriz' | 'aguas-santas'>('guitiriz');
  const [reserveType, setReserveType] = useState<'buggy' | 'electric_trolley'>('buggy');
  const [reserveTime, setReserveTime] = useState<string>('10:00');
  const [reserveVehicleId, setReserveVehicleId] = useState<string>('');
  const [reserveNotes, setReserveNotes] = useState('');
  const [staffTargetUserId, setStaffTargetUserId] = useState(initialTargetUserId);
  const [playersDirectory, setPlayersDirectory] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (initialTargetUserId !== undefined) {
      setStaffTargetUserId(initialTargetUserId);
    }
  }, [initialTargetUserId]);

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmedMsg, setConfirmedMsg] = useState<string | null>(null);

  const fetchFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = firebaseUser
        ? `/api/fleet?date=${encodeURIComponent(date)}&startTime=${encodeURIComponent(checkStartTime)}`
        : `/api/fleet/public-summary?date=${encodeURIComponent(date)}&startTime=${encodeURIComponent(
            checkStartTime
          )}`;
      const res = firebaseUser ? await authFetch(url) : await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo cargar el estado de los vehículos.');
      }
      const payload: FleetOverviewResponse = await res.json();
      setOverview(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, authFetch, date, checkStartTime]);

  useEffect(() => {
    fetchFleet();
  }, [fetchFleet]);

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

  const filteredVehicles = useMemo(() => {
    if (!overview) return [];
    return overview.vehicles.filter((v) => {
      if (courseFilter !== 'all' && v.courseSlug !== courseFilter) return false;
      if (typeFilter !== 'all' && v.type !== typeFilter) return false;
      return true;
    });
  }, [overview, courseFilter, typeFilter]);

  const summaryStats = useMemo(() => {
    const vehicles = overview?.vehicles || [];
    const byCourse = (slug: string, type: string) => {
      const subset = vehicles.filter((v) => v.courseSlug === slug && v.type === type);
      const freeNow = subset.filter(
        (v) => v.status === 'operational' && !v.busyAtSelectedTime
      ).length;
      return { total: subset.length, freeNow };
    };
    return {
      guitirizBuggies: byCourse('guitiriz', 'buggy'),
      guitirizTrolleys: byCourse('guitiriz', 'electric_trolley'),
      aguasBuggies: byCourse('aguas-santas', 'buggy'),
      aguasTrolleys: byCourse('aguas-santas', 'electric_trolley'),
    };
  }, [overview]);

  const availableUnitsForForm = useMemo(() => {
    if (!overview) return [];
    return overview.vehicles.filter(
      (v) =>
        v.courseSlug === reserveCourse &&
        v.type === reserveType &&
        v.status === 'operational' &&
        !v.busyAtSelectedTime
    );
  }, [overview, reserveCourse, reserveType]);

  const handleReserveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setConfirmedMsg(null);

    if (!firebaseUser) {
      await signInWithGoogle();
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/fleet/reservations', {
        method: 'POST',
        body: JSON.stringify({
          courseSlug: reserveCourse,
          vehicleType: reserveType,
          vehicleId: reserveVehicleId ? Number(reserveVehicleId) : undefined,
          date,
          startTime: reserveTime,
          notes: reserveNotes,
          ...(isStaff && staffTargetUserId ? { targetUserId: Number(staffTargetUserId) } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'No se pudo reservar el vehículo.');
      }
      const titularName = body.titular
        ? `${body.titular.nombre || ''} ${body.titular.apellidos || ''}`.trim() || body.titular.email
        : '';
      setConfirmedMsg(
        `Unidad ${body.vehicle?.code || ''} reservada el ${date} desde las ${reserveTime}${
          titularName ? ` a nombre de ${titularName}` : ''
        }. Pago en la recepción del hotel.`
      );
      setReserveVehicleId('');
      setReserveNotes('');
      await fetchFleet();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al reservar vehículo');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleMaintenance = async (v: FleetVehicleItem) => {
    setActionError(null);
    const nextStatus = v.status === 'operational' ? 'maintenance' : 'operational';
    try {
      const res = await authFetch(`/api/fleet/vehicles/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo actualizar la unidad.');
      }
      await fetchFleet();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al actualizar estado');
    }
  };

  const handleUpdateVehicleReservation = async (
    resId: number,
    patch: { status?: string; mewsStatus?: string }
  ) => {
    setActionError(null);
    try {
      const res = await authFetch(`/api/fleet/reservations/${resId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo actualizar la reserva.');
      }
      await fetchFleet();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error al actualizar reserva');
    }
  };

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#E2E5EB]">
        <div>
          <p className="text-xs font-medium text-[#555C68]">
            Control unificado de vehículos · Guitiriz (2 buggies + 7 carros) y Aguas Santas (5 buggies
            + 7 carros)
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl font-semibold text-[#111827]">
            Gestión Centralizada de Vehículos
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Fecha de consulta de vehículos"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3.5 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
          />

          <select
            aria-label="Hora de consulta de disponibilidad"
            value={checkStartTime}
            onChange={(e) => {
              setCheckStartTime(e.target.value);
              setReserveTime(e.target.value);
            }}
            className="px-3.5 py-2 text-xs font-hours font-medium bg-white border border-[#E2E5EB] rounded-lg text-[#111827]"
          >
            {TEE_TIME_SLOTS.map((s) => (
              <option key={s} value={s}>
                Franja {s}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={fetchFleet}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-[#E2E5EB] rounded-lg text-[#111827] hover:bg-[#F4F6F9] whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Centralized Fleet Availability Strip */}
      <div className="bg-white border border-[#E2E5EB] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E2E5EB]">
        <div className="p-5">
          <p className="text-xs text-[#555C68]">Guitiriz · Buggies (9 hoyos)</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#111827]">
            {summaryStats.guitirizBuggies.freeNow} / {summaryStats.guitirizBuggies.total || 2}
          </p>
          <p className="mt-1 text-[11px] text-[#555C68]">
            Disponibles a las <span className="font-hours font-semibold text-[#111827]">{checkStartTime}</span> (bloqueo 2h15m)
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#555C68]">Guitiriz · Carros eléctricos</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#111827]">
            {summaryStats.guitirizTrolleys.freeNow} / {summaryStats.guitirizTrolleys.total || 7}
          </p>
          <p className="mt-1 text-[11px] text-[#555C68]">
            Disponibles a las <span className="font-hours font-semibold text-[#111827]">{checkStartTime}</span>
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#555C68]">Aguas Santas · Buggies (18 hoyos)</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#111827]">
            {summaryStats.aguasBuggies.freeNow} / {summaryStats.aguasBuggies.total || 5}
          </p>
          <p className="mt-1 text-[11px] text-[#555C68]">
            Disponibles a las <span className="font-hours font-semibold text-[#111827]">{checkStartTime}</span> (bloqueo 4h15m)
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#555C68]">Aguas Santas · Carros eléctricos</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#111827]">
            {summaryStats.aguasTrolleys.freeNow} / {summaryStats.aguasTrolleys.total || 7}
          </p>
          <p className="mt-1 text-[11px] text-[#555C68]">
            Disponibles a las <span className="font-hours font-semibold text-[#111827]">{checkStartTime}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Split: 21-Unit Inventory Table + Direct Reservation Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg">
              {[
                { id: 'all', label: 'Ambos campos (21)' },
                { id: 'guitiriz', label: 'Guitiriz (9)' },
                { id: 'aguas-santas', label: 'Aguas Santas (12)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCourseFilter(tab.id as 'all' | 'guitiriz' | 'aguas-santas')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    courseFilter === tab.id
                      ? 'bg-white text-[#111827] shadow-xs'
                      : 'text-[#555C68] hover:text-[#111827]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg">
              {[
                { id: 'all', label: 'Todos los equipos' },
                { id: 'buggy', label: 'Buggies' },
                { id: 'electric_trolley', label: 'Carros eléctricos' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id as 'all' | 'buggy' | 'electric_trolley')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    typeFilter === tab.id
                      ? 'bg-white text-[#111827] shadow-xs'
                      : 'text-[#555C68] hover:text-[#111827]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory Table */}
          <div className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E5EB] bg-[#F8FAFC] text-[11px] font-semibold text-[#555C68]">
                    <th className="py-3 px-4">Unidad</th>
                    <th className="py-3 px-4">Campo</th>
                    <th className="py-3 px-4">Tipo</th>
                    <th className="py-3 px-4">
                      Estado a las <span className="font-hours">{checkStartTime}</span>
                    </th>
                    <th className="py-3 px-4">Reservas del día ({date})</th>
                    {isStaff && <th className="py-3 px-4 text-right">Operación</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EBEEF3] text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={isStaff ? 6 : 5} className="py-10 text-center text-[#555C68]">
                        Cargando inventario de vehículos...
                      </td>
                    </tr>
                  ) : filteredVehicles.length === 0 ? (
                    <tr>
                      <td colSpan={isStaff ? 6 : 5} className="py-10 text-center text-[#555C68]">
                        No hay unidades para el filtro seleccionado.
                      </td>
                    </tr>
                  ) : (
                    filteredVehicles.map((v) => {
                      const isMaint = v.status === 'maintenance';
                      const stateLabel = isMaint
                        ? 'En mantenimiento'
                        : v.busyAtSelectedTime
                        ? 'Ocupado en franja'
                        : 'Disponible';
                      const stateColor = isMaint
                        ? 'text-[#B91C1C]'
                        : v.busyAtSelectedTime
                        ? 'text-[#B45309]'
                        : 'text-[#15803D]';

                      const windows = v.reservationsToday?.length
                        ? v.reservationsToday
                        : (v.occupiedWindows || []).map((w, i) => ({
                            id: i,
                            startTime: w.startTime,
                            endTime: w.endTime,
                            status: 'reserved',
                            mewsStatus: 'PENDING_RECEPTION',
                            userNombre: '',
                            userApellidos: '',
                          }));

                      return (
                        <tr key={v.id} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-[#111827] whitespace-nowrap">
                            {v.code}
                          </td>
                          <td className="py-3 px-4 text-[#404854] whitespace-nowrap">
                            {v.courseName}
                          </td>
                          <td className="py-3 px-4 text-[#404854] whitespace-nowrap">
                            {v.type === 'buggy' ? 'Buggy' : 'Carro eléctrico'}
                          </td>
                          <td className={`py-3 px-4 font-medium whitespace-nowrap ${stateColor}`}>
                            {stateLabel}
                          </td>
                          <td className="py-3 px-4 tabular-nums text-[#555C68]">
                            {windows.length === 0 ? (
                              <span>Sin reservas</span>
                            ) : (
                              <div className="space-y-1">
                                {windows.map((w) => (
                                  <div
                                    key={w.id}
                                    className="flex flex-wrap items-center justify-between gap-2"
                                  >
                                    <span>
                                      <span className="font-hours font-medium text-[#111827]">
                                        {w.startTime}–{w.endTime}
                                      </span>
                                      {w.userNombre || w.userApellidos
                                        ? ` · ${w.userNombre} ${w.userApellidos}`.trim()
                                        : ''}
                                    </span>
                                    {isStaff && w.id > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        {w.status === 'reserved' && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleUpdateVehicleReservation(w.id, {
                                                status: 'in_use',
                                              })
                                            }
                                            className="px-2 py-0.5 text-[11px] bg-[#EBEEF3] text-[#111827] rounded hover:bg-[#E2E5EB]"
                                          >
                                            Entregar
                                          </button>
                                        )}
                                        {w.status === 'in_use' && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleUpdateVehicleReservation(w.id, {
                                                status: 'returned',
                                              })
                                            }
                                            className="px-2 py-0.5 text-[11px] bg-emerald-100 text-emerald-900 rounded hover:bg-emerald-200"
                                          >
                                            Devuelto
                                          </button>
                                        )}
                                        {w.mewsStatus === 'PENDING_RECEPTION' && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleUpdateVehicleReservation(w.id, {
                                                mewsStatus: 'BILLED_MEWS',
                                              })
                                            }
                                            className="px-2 py-0.5 text-[11px] bg-[#003087] text-white rounded hover:bg-[#002266]"
                                          >
                                            Cobrado
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          {isStaff && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleToggleMaintenance(v)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[#E2E5EB] rounded-md hover:bg-[#EBEEF3] text-[#111827]"
                              >
                                <Wrench className="w-3 h-3" />
                                <span>{isMaint ? 'Habilitar' : 'Mantenimiento'}</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Standalone Equipment Booking Form */}
        <aside className="lg:col-span-4 bg-white border border-[#E2E5EB] rounded-xl p-6 space-y-5">
          <div className="pb-4 border-b border-[#EBEEF3]">
            <p className="text-xs text-[#555C68]">Reserva directa de equipo</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-[#111827]">
              Asignar buggy o carro eléctrico
            </h2>
          </div>

          {confirmedMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>{confirmedMsg}</span>
            </div>
          )}

          {actionError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleReserveVehicle} className="space-y-4">
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
              <label className="block text-xs font-medium text-[#404854] mb-1.5">Campo</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReserveCourse('guitiriz');
                    setReserveVehicleId('');
                  }}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                    reserveCourse === 'guitiriz'
                      ? 'bg-[#003087] text-white border-[#003087]'
                      : 'bg-white text-[#111827] border-[#E2E5EB]'
                  }`}
                >
                  Guitiriz (9h)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReserveCourse('aguas-santas');
                    setReserveVehicleId('');
                  }}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                    reserveCourse === 'aguas-santas'
                      ? 'bg-[#003087] text-white border-[#003087]'
                      : 'bg-white text-[#111827] border-[#E2E5EB]'
                  }`}
                >
                  Aguas Santas (18h)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#404854] mb-1.5">
                Tipo de vehículo
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReserveType('buggy');
                    setReserveVehicleId('');
                  }}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                    reserveType === 'buggy'
                      ? 'bg-[#003087] text-white border-[#003087]'
                      : 'bg-white text-[#111827] border-[#E2E5EB]'
                  }`}
                >
                  Buggy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReserveType('electric_trolley');
                    setReserveVehicleId('');
                  }}
                  className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
                    reserveType === 'electric_trolley'
                      ? 'bg-[#003087] text-white border-[#003087]'
                      : 'bg-white text-[#111827] border-[#E2E5EB]'
                  }`}
                >
                  Carro eléctrico
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="fleet-start-time"
                className="block text-xs font-medium text-[#404854] mb-1.5"
              >
                Hora de recogida
              </label>
              <select
                id="fleet-start-time"
                value={reserveTime}
                onChange={(e) => {
                  setReserveTime(e.target.value);
                  setCheckStartTime(e.target.value);
                }}
                className="w-full px-3 py-2 text-xs font-hours font-medium bg-white border border-[#E2E5EB] rounded-lg"
              >
                {TEE_TIME_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="fleet-unit-select"
                className="block text-xs font-medium text-[#404854] mb-1.5"
              >
                Unidad ({availableUnitsForForm.length} libres a las{' '}
                <span className="font-hours font-semibold">{reserveTime}</span>)
              </label>
              <select
                id="fleet-unit-select"
                value={reserveVehicleId}
                onChange={(e) => setReserveVehicleId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg"
              >
                <option value="">Asignación automática disponible</option>
                {availableUnitsForForm.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} · {u.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="fleet-notes"
                className="block text-xs font-medium text-[#404854] mb-1.5"
              >
                Referencia / Nota
              </label>
              <input
                id="fleet-notes"
                type="text"
                value={reserveNotes}
                onChange={(e) => setReserveNotes(e.target.value)}
                placeholder="Salida ya reservada, batería completa..."
                className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg"
              />
            </div>

            <div className="p-3.5 bg-[#F4F6F9] border border-[#E2E5EB] rounded-lg text-xs text-[#404854]">
              Pago en la recepción del hotel con cargo a habitación o factura directa.
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] disabled:opacity-60 rounded-lg transition-colors"
            >
              {!firebaseUser
                ? 'Acceder con Google para reservar'
                : submitting
                ? 'Reservando unidad...'
                : 'Confirmar reserva de vehículo'}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};
