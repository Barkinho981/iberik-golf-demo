import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AcademyBookingRow, TeeTimeReservationRow, UserProfile } from '../types/golf';

interface PlayersAndReceptionViewProps {
  onBookForPlayer?: (tab: 'tee-times' | 'academia' | 'flota', userId: string) => void;
}

export const PlayersAndReceptionView: React.FC<PlayersAndReceptionViewProps> = ({
  onBookForPlayer,
}) => {
  const { firebaseUser, profile, isStaff, signInWithGoogle, refreshProfile, authFetch } = useAuth();

  // Personal Profile State
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [telefono, setTelefono] = useState('');
  const [licencia, setLicencia] = useState('');
  const [poblacion, setPoblacion] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Reservations & Reception State
  const [teeTimes, setTeeTimes] = useState<TeeTimeReservationRow[]>([]);
  const [academyBookings, setAcademyBookings] = useState<AcademyBookingRow[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Staff filters & sub-tabs
  const [subTab, setSubTab] = useState<'reservations' | 'directory'>('reservations');
  const [searchQuery, setSearchQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState<'all' | 'guitiriz' | 'aguas-santas'>('all');
  const [mewsRefDrafts, setMewsRefDrafts] = useState<Record<number, string>>({});

  // Staff Player Modal
  const [playerModalOpen, setPlayerModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<UserProfile | null>(null);
  const [pEmail, setPEmail] = useState('');
  const [pNombre, setPNombre] = useState('');
  const [pApellidos, setPApellidos] = useState('');
  const [pTelefono, setPTelefono] = useState('');
  const [pLicencia, setPLicencia] = useState('');
  const [pPoblacion, setPPoblacion] = useState('');
  const [pRole, setPRole] = useState('player');
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [playerFormError, setPlayerFormError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setNombre(profile.nombre || '');
      setApellidos(profile.apellidos || '');
      setTelefono(profile.telefono || '');
      setLicencia(profile.licencia || '');
      setPoblacion(profile.poblacion || '');
    }
  }, [profile]);

  const loadWorkspaceData = useCallback(async () => {
    if (!firebaseUser) return;
    setLoadingData(true);
    setDataError(null);
    try {
      const requests: Promise<Response>[] = [
        authFetch('/api/tee-times'),
        authFetch('/api/academy/bookings'),
      ];
      if (isStaff) {
        requests.push(authFetch('/api/users'));
      }
      const responses = await Promise.all(requests);
      if (responses[0].ok) {
        const rows: TeeTimeReservationRow[] = await responses[0].json();
        setTeeTimes(rows);
        const drafts: Record<number, string> = {};
        rows.forEach((r) => {
          drafts[r.id] = r.mewsReference || '';
        });
        setMewsRefDrafts(drafts);
      }
      if (responses[1].ok) {
        setAcademyBookings(await responses[1].json());
      }
      if (isStaff && responses[2] && responses[2].ok) {
        setUsersList(await responses[2].json());
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Error al cargar los registros');
    } finally {
      setLoadingData(false);
    }
  }, [firebaseUser, isStaff, authFetch]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedMsg(null);
    setProfileError(null);
    try {
      const res = await authFetch('/api/me', {
        method: 'PUT',
        body: JSON.stringify({ nombre, apellidos, telefono, licencia, poblacion }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo guardar tu ficha.');
      }
      await refreshProfile();
      setProfileSavedMsg('Ficha de jugador actualizada correctamente.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Error al guardar perfil');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdateTeeTime = async (
    id: number,
    patch: { status?: string; mewsStatus?: string; mewsReference?: string }
  ) => {
    try {
      const res = await authFetch(`/api/tee-times/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo actualizar la reserva.');
      }
      await loadWorkspaceData();
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Error al actualizar');
    }
  };

  const handleUpdateAcademy = async (
    id: number,
    patch: { status?: string; mewsStatus?: string }
  ) => {
    try {
      const res = await authFetch(`/api/academy/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo actualizar la clase.');
      }
      await loadWorkspaceData();
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Error al actualizar');
    }
  };

  const openPlayerModal = (existing: UserProfile | null) => {
    setEditingPlayer(existing);
    setPEmail(existing?.email || '');
    setPNombre(existing?.nombre || '');
    setPApellidos(existing?.apellidos || '');
    setPTelefono(existing?.telefono || '');
    setPLicencia(existing?.licencia || '');
    setPPoblacion(existing?.poblacion || '');
    setPRole(existing?.role || 'player');
    setPlayerFormError(null);
    setPlayerModalOpen(true);
  };

  const handleSavePlayerRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlayer(true);
    setPlayerFormError(null);
    try {
      const endpoint = editingPlayer ? `/api/users/${editingPlayer.id}` : '/api/users';
      const method = editingPlayer ? 'PUT' : 'POST';
      const res = await authFetch(endpoint, {
        method,
        body: JSON.stringify({
          email: pEmail,
          nombre: pNombre,
          apellidos: pApellidos,
          telefono: pTelefono,
          licencia: pLicencia,
          poblacion: pPoblacion,
          role: pRole,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'No se pudo guardar el jugador.');
      }
      setPlayerModalOpen(false);
      await loadWorkspaceData();
    } catch (err) {
      setPlayerFormError(err instanceof Error ? err.message : 'Error al guardar jugador');
    } finally {
      setSavingPlayer(false);
    }
  };

  const filteredTeeTimes = useMemo(() => {
    return teeTimes.filter((r) => {
      if (courseFilter !== 'all' && r.courseSlug !== courseFilter) return false;
      return true;
    });
  }, [teeTimes, courseFilter]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter((u) =>
      [u.nombre, u.apellidos, u.email, u.licencia, u.telefono, u.poblacion]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [usersList, searchQuery]);

  if (!firebaseUser) {
    return (
      <div className="max-w-[920px] mx-auto px-6 lg:px-10 py-16">
        <div className="bg-white border border-[#E2E5EB] rounded-xl p-10 text-center space-y-5">
          <p className="text-xs font-medium text-[#555C68]">
            Área personal de jugadores y recepción
          </p>
          <h1 className="font-display text-3xl font-semibold text-[#111827]">
            Inicia sesión para gestionar tu ficha y tus reservas
          </h1>
          <p className="text-sm text-[#404854] max-w-lg mx-auto">
            Accede con tu cuenta de Google para completar tu licencia federativa, teléfono y
            población, consultar tus salidas y gestionar reservas en Guitiriz y Aguas Santas.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={signInWithGoogle}
              className="px-6 py-3 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg transition-colors"
            >
              Acceder con Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-10 space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E2E5EB]">
        <div>
          <p className="text-xs font-medium text-[#555C68]">
            {isStaff
              ? 'Administración y Recepción del Hotel'
              : 'Ficha de Jugador y Mis Reservas'}
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl font-semibold text-[#111827]">
            Jugadores, Reservas y Recepción
          </h1>
        </div>

        {isStaff && (
          <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg border border-[#E2E5EB]">
            <button
              type="button"
              onClick={() => setSubTab('reservations')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'reservations'
                  ? 'bg-white text-[#111827] shadow-xs'
                  : 'text-[#555C68] hover:text-[#111827]'
              }`}
            >
              Agenda y Cobros
            </button>
            <button
              type="button"
              onClick={() => setSubTab('directory')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'directory'
                  ? 'bg-white text-[#111827] shadow-xs'
                  : 'text-[#555C68] hover:text-[#111827]'
              }`}
            >
              Directorio de Jugadores ({usersList.length})
            </button>
          </div>
        )}
      </div>

      {/* Personal Player Card */}
      <section className="bg-white border border-[#E2E5EB] rounded-xl p-6 lg:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#EBEEF3]">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#111827]">
              Mi ficha de jugador
            </h2>
            <p className="text-xs text-[#555C68]">
              Correo vinculado: <span className="font-mono text-[#111827]">{profile?.email}</span>
              {' · '}Rol: <span className="font-medium text-[#111827]">{profile?.role}</span>
            </p>
          </div>
        </div>

        {profileSavedMsg && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{profileSavedMsg}</span>
          </div>
        )}
        {profileError && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{profileError}</span>
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          <div>
            <label htmlFor="my-nombre" className="block text-xs font-medium text-[#404854] mb-1">
              Nombre
            </label>
            <input
              id="my-nombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="my-apellidos" className="block text-xs font-medium text-[#404854] mb-1">
              Apellidos
            </label>
            <input
              id="my-apellidos"
              type="text"
              value={apellidos}
              onChange={(e) => setApellidos(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="my-telefono" className="block text-xs font-medium text-[#404854] mb-1">
              Teléfono
            </label>
            <input
              id="my-telefono"
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="600 000 000"
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E2E5EB] rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="my-licencia" className="block text-xs font-medium text-[#404854] mb-1">
              Licencia federativa
            </label>
            <input
              id="my-licencia"
              type="text"
              value={licencia}
              onChange={(e) => setLicencia(e.target.value)}
              placeholder="GA00123456"
              className="w-full px-3 py-2 text-xs font-mono uppercase bg-white border border-[#E2E5EB] rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="my-poblacion" className="block text-xs font-medium text-[#404854] mb-1">
              Población
            </label>
            <input
              id="my-poblacion"
              type="text"
              value={poblacion}
              onChange={(e) => setPoblacion(e.target.value)}
              placeholder="Guitiriz / Lugo"
              className="w-full px-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={savingProfile}
              className="w-full py-2 px-4 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              {savingProfile ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
      </section>

      {dataError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{dataError}</span>
        </div>
      )}

      {/* Staff Directory Sub-Tab */}
      {isStaff && subTab === 'directory' ? (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#7A828E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre, correo, licencia, teléfono o población..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E2E5EB] rounded-lg"
              />
            </div>

            <button
              type="button"
              onClick={() => openPlayerModal(null)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo jugador</span>
            </button>
          </div>

          <div className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E5EB] bg-[#F8FAFC] text-[11px] font-semibold text-[#555C68]">
                    <th className="py-3 px-4">Nombre y Apellidos</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Teléfono</th>
                    <th className="py-3 px-4">Licencia</th>
                    <th className="py-3 px-4">Población</th>
                    <th className="py-3 px-4">Rol</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EBEEF3] text-xs">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#555C68]">
                        No se encontraron jugadores con ese criterio.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[#F8FAFC]">
                        <td className="py-3 px-4 font-medium text-[#111827] whitespace-nowrap">
                          {u.nombre || u.apellidos
                            ? `${u.nombre} ${u.apellidos}`.trim()
                            : 'Sin nombre'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[#404854] whitespace-nowrap">
                          {u.email}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#404854] whitespace-nowrap">
                          {u.telefono || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#111827] whitespace-nowrap">
                          {u.licencia || '—'}
                        </td>
                        <td className="py-3 px-4 text-[#404854] whitespace-nowrap">
                          {u.poblacion || '—'}
                        </td>
                        <td className="py-3 px-4 text-[#555C68] whitespace-nowrap">{u.role}</td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {onBookForPlayer && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onBookForPlayer('tee-times', String(u.id))}
                                  className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-md transition-colors"
                                >
                                  Tee Time
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onBookForPlayer('academia', String(u.id))}
                                  className="px-2.5 py-1 text-[11px] font-medium text-[#003087] border border-[#003087]/30 rounded-md hover:bg-[#003087]/5 transition-colors"
                                >
                                  Clase
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onBookForPlayer('flota', String(u.id))}
                                  className="px-2.5 py-1 text-[11px] font-medium text-[#003087] border border-[#003087]/30 rounded-md hover:bg-[#003087]/5 transition-colors"
                                >
                                  Vehículo
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => openPlayerModal(u)}
                              className="px-3 py-1 text-xs font-medium border border-[#E2E5EB] rounded-md hover:bg-[#EBEEF3]"
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : (
        /* Reservations & Reception Ledger */
        <div className="space-y-8">
          {/* Tee Times Table */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold text-[#111827]">
                {isStaff ? 'Salidas de Tee Time y Cobros en Recepción' : 'Mis salidas de Tee Time'}
              </h2>
              <div className="inline-flex items-center p-1 bg-[#EBEEF3] rounded-lg">
                {[
                  { id: 'all', label: 'Todos los campos' },
                  { id: 'guitiriz', label: 'Guitiriz' },
                  { id: 'aguas-santas', label: 'Aguas Santas' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCourseFilter(f.id as 'all' | 'guitiriz' | 'aguas-santas')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      courseFilter === f.id
                        ? 'bg-white text-[#111827] shadow-xs'
                        : 'text-[#555C68] hover:text-[#111827]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E2E5EB] bg-[#F8FAFC] text-[11px] font-semibold text-[#555C68]">
                      <th className="py-3 px-4">Fecha y Hora</th>
                      <th className="py-3 px-4">Campo</th>
                      <th className="py-3 px-4">Jugador / Licencia</th>
                      <th className="py-3 px-4">Partida y Vehículos</th>
                      <th className="py-3 px-4">Cobro en recepción</th>
                      <th className="py-3 px-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBEEF3] text-xs">
                    {loadingData ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-[#555C68]">
                          Cargando reservas...
                        </td>
                      </tr>
                    ) : filteredTeeTimes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-[#555C68]">
                          No hay reservas de tee time registradas todavía.
                        </td>
                      </tr>
                    ) : (
                      filteredTeeTimes.map((r) => {
                        const isCancelled = r.status === 'cancelled';
                        const isBilled = r.mewsStatus === 'BILLED_MEWS';
                        return (
                          <tr key={r.id} className="hover:bg-[#F8FAFC]">
                            <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                              <span className="font-semibold text-[#111827]">{r.date}</span>
                              <span className="mx-1.5 text-[#7A828E]">·</span>
                              <span className="font-hours text-[#003087] font-semibold">{r.slotTime}</span>
                            </td>
                            <td className="py-3 px-4 text-[#111827] whitespace-nowrap">
                              {r.courseName} ({r.courseHoles}h)
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-[#111827]">
                                {`${r.userNombre} ${r.userApellidos}`.trim() || r.userEmail}
                              </p>
                              <p className="font-mono text-[11px] text-[#555C68]">
                                {r.userLicencia || 'Sin licencia'} · {r.userTelefono || r.userEmail}
                              </p>
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-[#404854]">
                              {r.playersCount} jug. · {r.buggiesRequested} bug. ·{' '}
                              {r.trolleysRequested} car.
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`font-medium ${
                                  isCancelled
                                    ? 'text-[#B91C1C]'
                                    : isBilled
                                    ? 'text-[#15803D]'
                                    : 'text-[#B45309]'
                                }`}
                              >
                                {isCancelled
                                  ? 'Cancelada'
                                  : isBilled
                                  ? 'Pagado en recepción'
                                  : 'Pendiente en recepción'}
                              </span>
                              {isStaff && !isCancelled ? (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={mewsRefDrafts[r.id] ?? ''}
                                    onChange={(e) =>
                                      setMewsRefDrafts((prev) => ({
                                        ...prev,
                                        [r.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Folio / Hab."
                                    className="w-28 px-2 py-1 text-[11px] font-mono bg-white border border-[#E2E5EB] rounded"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateTeeTime(r.id, {
                                        mewsReference: mewsRefDrafts[r.id] ?? '',
                                      })
                                    }
                                    className="px-2 py-1 text-[11px] bg-[#EBEEF3] rounded hover:bg-[#E2E5EB]"
                                  >
                                    Folio
                                  </button>
                                </div>
                              ) : r.mewsReference ? (
                                <p className="text-[11px] font-mono text-[#555C68]">
                                  Ref: {r.mewsReference}
                                </p>
                              ) : null}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                              {isStaff && !isCancelled && !isBilled && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateTeeTime(r.id, {
                                      status: 'checked_in',
                                      mewsStatus: 'BILLED_MEWS',
                                      mewsReference: mewsRefDrafts[r.id] ?? r.mewsReference,
                                    })
                                  }
                                  className="px-3 py-1 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-md"
                                >
                                  Marcar cobrado
                                </button>
                              )}
                              {!isCancelled && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTeeTime(r.id, { status: 'cancelled' })}
                                  className="px-3 py-1 text-xs font-medium text-[#B91C1C] border border-red-200 hover:bg-red-50 rounded-md"
                                >
                                  Cancelar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Academy Bookings Table */}
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#111827]">
              {isStaff
                ? 'Clases de Golf con Víctor López (Guitiriz)'
                : 'Mis clases con Víctor López'}
            </h2>
            <div className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E2E5EB] bg-[#F8FAFC] text-[11px] font-semibold text-[#555C68]">
                      <th className="py-3 px-4">Miércoles y Hora</th>
                      <th className="py-3 px-4">Alumno</th>
                      <th className="py-3 px-4">Plazas / Enfoque</th>
                      <th className="py-3 px-4">Cobro en recepción</th>
                      <th className="py-3 px-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBEEF3] text-xs">
                    {academyBookings.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-[#555C68]">
                          No hay clases reservadas todavía.
                        </td>
                      </tr>
                    ) : (
                      academyBookings.map((b) => {
                        const isCancelled = b.status === 'cancelled';
                        const isBilled = b.mewsStatus === 'BILLED_MEWS';
                        return (
                          <tr key={b.id} className="hover:bg-[#F8FAFC]">
                            <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                              <span className="font-semibold text-[#111827]">{b.date}</span>
                              <span className="mx-1.5 text-[#7A828E]">·</span>
                              <span className="font-hours text-[#003087] font-semibold">{b.slotTime}</span>
                            </td>
                            <td className="py-3 px-4">
                              <p className="font-medium text-[#111827]">
                                {`${b.userNombre} ${b.userApellidos}`.trim() || b.userEmail}
                              </p>
                              <p className="font-mono text-[11px] text-[#555C68]">{b.userEmail}</p>
                            </td>
                            <td className="py-3 px-4 text-[#404854]">
                              {b.studentsCount} {b.studentsCount === 1 ? 'alumno' : 'alumnos'} ·{' '}
                              {b.level}
                            </td>
                            <td
                              className={`py-3 px-4 font-medium ${
                                isCancelled
                                  ? 'text-[#B91C1C]'
                                  : isBilled
                                  ? 'text-[#15803D]'
                                  : 'text-[#B45309]'
                              }`}
                            >
                              {isCancelled
                                ? 'Cancelada'
                                : isBilled
                                ? 'Pagado en recepción'
                                : 'Pendiente en recepción'}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                              {isStaff && !isCancelled && !isBilled && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateAcademy(b.id, {
                                      status: 'completed',
                                      mewsStatus: 'BILLED_MEWS',
                                    })
                                  }
                                  className="px-3 py-1 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-md"
                                >
                                  Marcar cobrado
                                </button>
                              )}
                              {!isCancelled && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAcademy(b.id, { status: 'cancelled' })}
                                  className="px-3 py-1 text-xs font-medium text-[#B91C1C] border border-red-200 hover:bg-red-50 rounded-md"
                                >
                                  Cancelar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Modal for Creating / Editing Player Record (Staff Only) */}
      {playerModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ficha de jugador"
        >
          <div className="bg-white border border-[#E2E5EB] rounded-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#EBEEF3]">
              <h3 className="font-display text-2xl font-semibold text-[#111827]">
                {editingPlayer ? 'Editar jugador' : 'Alta de nuevo jugador'}
              </h3>
              <button
                type="button"
                onClick={() => setPlayerModalOpen(false)}
                className="p-1.5 rounded-lg text-[#555C68] hover:bg-[#EBEEF3]"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {playerFormError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {playerFormError}
              </div>
            )}

            <form onSubmit={handleSavePlayerRecord} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">Nombre *</label>
                  <input
                    type="text"
                    required
                    value={pNombre}
                    onChange={(e) => setPNombre(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E2E5EB] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">
                    Apellidos *
                  </label>
                  <input
                    type="text"
                    required
                    value={pApellidos}
                    onChange={(e) => setPApellidos(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E2E5EB] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#404854] mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={pEmail}
                  onChange={(e) => setPEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-[#E2E5EB] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">Teléfono</label>
                  <input
                    type="tel"
                    value={pTelefono}
                    onChange={(e) => setPTelefono(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#E2E5EB] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">
                    Licencia federativa
                  </label>
                  <input
                    type="text"
                    value={pLicencia}
                    onChange={(e) => setPLicencia(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-[#E2E5EB] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">Población</label>
                  <input
                    type="text"
                    value={pPoblacion}
                    onChange={(e) => setPPoblacion(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E2E5EB] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#404854] mb-1">Rol</label>
                  <select
                    value={pRole}
                    onChange={(e) => setPRole(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E2E5EB] rounded-lg bg-white"
                  >
                    <option value="player">Jugador</option>
                    <option value="reception">Recepción Hotel</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPlayerModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-[#555C68] hover:text-[#111827]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingPlayer}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg"
                >
                  {savingPlayer ? 'Guardando...' : 'Guardar jugador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
