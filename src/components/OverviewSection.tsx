import React, { useEffect, useState } from 'react';
import { ArrowRight, Calendar, Clock, MapPin } from 'lucide-react';
import { ResilientImage } from './ResilientImage';
import type { Course, CourseAvailabilityResponse } from '../types/golf';
import { getTodayIsoDate } from '../lib/golf-schedule';

export type ActiveTab = 'inicio' | 'tee-times' | 'academia' | 'flota' | 'jugadores';

interface OverviewSectionProps {
  courses: Course[];
  onNavigate: (tab: ActiveTab, courseSlug?: string) => void;
}

export const OverviewSection: React.FC<OverviewSectionProps> = ({ courses, onNavigate }) => {
  const [guitirizSummary, setGuitirizSummary] = useState<CourseAvailabilityResponse | null>(null);
  const [aguasSummary, setAguasSummary] = useState<CourseAvailabilityResponse | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    const today = getTodayIsoDate();
    let cancelled = false;

    async function load() {
      setLoadingSummary(true);
      try {
        const [gRes, aRes] = await Promise.all([
          fetch(`/api/availability?course=guitiriz&date=${today}`),
          fetch(`/api/availability?course=aguas-santas&date=${today}`),
        ]);
        if (!cancelled) {
          if (gRes.ok) setGuitirizSummary(await gRes.json());
          if (aRes.ok) setAguasSummary(await aRes.json());
        }
      } catch (err) {
        console.error('Error loading course summaries:', err);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const guitiriz = courses.find((c) => c.slug === 'guitiriz');
  const aguasSantas = courses.find((c) => c.slug === 'aguas-santas');

  const countOpenSlots = (summary: CourseAvailabilityResponse | null) =>
    summary ? summary.slots.filter((s) => s.remainingPlayers > 0).length : 64;

  return (
    <div className="space-y-16 pb-16">
      {/* Hero Split */}
      <section className="border-b border-[#E2E5EB] bg-white">
        <div className="max-w-[1320px] mx-auto px-6 lg:px-10 py-10 lg:py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between py-2">
              <div className="space-y-6">
                <p className="text-xs font-medium tracking-wide text-[#555C68]">
                  Lugo, Galicia · Guitiriz 9 hoyos y Aguas Santas 18 hoyos
                </p>
                <h1
                  className="font-display text-[clamp(2.4rem,4.2vw,3.85rem)] leading-[1.06] font-semibold tracking-tight text-[#111827]"
                  style={{ textWrap: 'balance' }}
                >
                  Reserva en Guitiriz &amp; Aguas Santas
                </h1>
                <p className="text-base leading-relaxed text-[#404854] max-w-[54ch]">
                  Consulta salidas cada 10 minutos entre las 08:30 y las 19:00, reserva clases los
                  miércoles con Víctor López en Guitiriz y coordina de forma centralizada los 21
                  vehículos de ambos campos con cobro directo en la recepción del hotel.
                </p>
              </div>

              <div className="pt-8 flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={() => onNavigate('tee-times', 'guitiriz')}
                  className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003087]"
                >
                  <span>Reservar Tee Time</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('flota')}
                  className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-[#111827] hover:text-[#003087] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Ver vehículos centralizados</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 min-h-[320px] lg:min-h-[440px]">
              <div className="relative h-full w-full overflow-hidden rounded-xl border border-[#E2E5EB]">
                <ResilientImage
                  src="/src/assets/images/hero_galicia_golf_1795383816859.jpg"
                  alt="Calle del campo de golf en Galicia al amanecer con muros de granito y hotel balneario"
                  fallbackTitle="Guitiriz & Aguas Santas Golf"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-6 text-white">
                  <p className="text-xs font-medium text-white/85">
                    Pago exclusivo en la recepción del hotel
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4-Column Operational Summary Strip */}
        <div className="border-t border-[#E2E5EB] bg-[#F8FAFC]">
          <div className="max-w-[1320px] mx-auto px-6 lg:px-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#E2E5EB]">
            <div className="py-5 sm:pr-6">
              <p className="font-hours text-lg font-semibold tabular-nums text-[#111827]">
                08:30 – 19:00
              </p>
              <p className="mt-1 text-xs text-[#555C68]">
                Salidas cada 10 minutos · 64 franjas diarias
              </p>
            </div>
            <div className="py-5 sm:px-6">
              <p className="font-mono text-lg font-medium tabular-nums text-[#111827]">
                9 y 18 hoyos
              </p>
              <p className="mt-1 text-xs text-[#555C68]">
                Guitiriz y Aguas Santas sincronizados en directo
              </p>
            </div>
            <div className="py-5 sm:px-6">
              <p className="font-mono text-lg font-medium tabular-nums text-[#111827]">
                21 vehículos
              </p>
              <p className="mt-1 text-xs text-[#555C68]">
                7 buggies y 14 carros eléctricos centralizados
              </p>
            </div>
            <div className="py-5 sm:pl-6">
              <p className="font-mono text-lg font-medium text-[#111827]">
                Pago en recepción
              </p>
              <p className="mt-1 text-xs text-[#555C68]">
                Sin pasarela online · Facturación en hotel
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Two Courses Showcase */}
      <section className="max-w-[1320px] mx-auto px-6 lg:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E2E5EB]">
          <div>
            <p className="text-xs font-medium text-[#555C68]">01. Nuestros campos</p>
            <h2 className="mt-1 font-display text-3xl lg:text-4xl font-semibold text-[#111827]">
              Dos campos un abono
            </h2>
          </div>
          <p className="text-sm text-[#555C68] max-w-md">
            Selecciona cualquiera de los campos para consultar salidas disponibles hoy y asignar
            buggies o carros eléctricos en la misma operación.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Guitiriz */}
          <article className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] w-full overflow-hidden border-b border-[#E2E5EB]">
              <ResilientImage
                src="/src/assets/images/course_guitiriz_1795383817065.jpg"
                alt="Green y casa club de piedra del campo de golf de Guitiriz, 9 hoyos"
                fallbackTitle="Golf Guitiriz · 9 Hoyos"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 lg:p-8 flex-1 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#555C68]">
                  <span>9 hoyos</span>
                  <span aria-hidden="true">·</span>
                  <span>Par {guitiriz?.par ?? 35}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    Guitiriz, Lugo
                  </span>
                </div>
                <h3 className="font-display text-2xl font-semibold text-[#111827]">
                  Campo de Golf Guitiriz
                </h3>
                <p className="text-sm leading-relaxed text-[#404854]">
                  Recorrido parkland técnico de 9 hoyos junto al Hotel Balneario de Guitiriz. Sede
                  de la escuela de golf de Víctor López los miércoles y equipado con 2 buggies y 7
                  carros eléctricos propios.
                </p>
              </div>

              <div className="pt-4 border-t border-[#EBEEF3] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 text-xs text-[#555C68] font-mono tabular-nums">
                  <p>
                    Hoy:{' '}
                    <span className="text-[#111827] font-medium">
                      {loadingSummary ? 'Cargando...' : `${countOpenSlots(guitirizSummary)}/64 salidas`}
                    </span>
                  </p>
                  <p>
                    Vehículos:{' '}
                    <span className="text-[#111827] font-medium">
                      {guitirizSummary?.fleetTotals.buggiesOperational ?? 2} buggies ·{' '}
                      {guitirizSummary?.fleetTotals.trolleysOperational ?? 7} carros eléctricos
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('tee-times', 'guitiriz')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Ver salidas Guitiriz
                </button>
              </div>
            </div>
          </article>

          {/* Aguas Santas */}
          <article className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden flex flex-col">
            <div className="aspect-[4/3] w-full overflow-hidden border-b border-[#E2E5EB]">
              <ResilientImage
                src="/src/assets/images/course_aguas_santas_1795383816769.jpg"
                alt="Campo de golf de 18 hoyos Aguas Santas en la Ribeira Sacra"
                fallbackTitle="Golf Aguas Santas · 18 Hoyos"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 lg:p-8 flex-1 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#555C68]">
                  <span>18 hoyos</span>
                  <span aria-hidden="true">·</span>
                  <span>Par {aguasSantas?.par ?? 71}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    Pantón · Ribeira Sacra
                  </span>
                </div>
                <h3 className="font-display text-2xl font-semibold text-[#111827]">
                  Campo de Golf Aguas Santas
                </h3>
                <p className="text-sm leading-relaxed text-[#404854]">
                  Trazado completo de 18 hoyos rodeado de valles, lagos y búnkeres amplios en el
                  corazón de la Ribeira Sacra. Cuenta con 5 buggies y 7 carros eléctricos con
                  control horario de ronda completa.
                </p>
              </div>

              <div className="pt-4 border-t border-[#EBEEF3] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1 text-xs text-[#555C68] font-mono tabular-nums">
                  <p>
                    Hoy:{' '}
                    <span className="text-[#111827] font-medium">
                      {loadingSummary ? 'Cargando...' : `${countOpenSlots(aguasSummary)}/64 salidas`}
                    </span>
                  </p>
                  <p>
                    Vehículos:{' '}
                    <span className="text-[#111827] font-medium">
                      {aguasSummary?.fleetTotals.buggiesOperational ?? 5} buggies ·{' '}
                      {aguasSummary?.fleetTotals.trolleysOperational ?? 7} carros eléctricos
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('tee-times', 'aguas-santas')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Ver salidas Aguas Santas
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* Academy Feature Section */}
      <section className="max-w-[1320px] mx-auto px-6 lg:px-10">
        <div className="bg-white border border-[#E2E5EB] rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-5 min-h-[280px]">
            <ResilientImage
              src="/src/assets/images/academy_golf_practice_1795383817171.jpg"
              alt="Clase de golf en el campo de prácticas de Guitiriz con el profesor Víctor López"
              fallbackTitle="Academia Guitiriz · Víctor López"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="lg:col-span-7 p-8 lg:p-12 flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <p className="text-xs font-medium text-[#555C68]">
                02. Academia en Guitiriz · Solo miércoles
              </p>
              <h2 className="font-display text-3xl font-semibold text-[#111827]">
                Clases de golf con Víctor López
              </h2>
              <p className="text-sm leading-relaxed text-[#404854] max-w-[58ch]">
                Sesiones prácticas de 30 minutos en grupos reducidos de un máximo de 4 alumnos en
                las instalaciones de Guitiriz. El pago se realiza en la recepción del hotel tras la
                confirmación de plaza.
              </p>

              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#EBEEF3]">
                <div className="pt-3 flex items-start gap-2.5">
                  <Calendar className="w-4 h-4 text-[#003087] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#111827]">Turno de mañana</p>
                    <p className="text-xs font-hours font-medium tabular-nums text-[#555C68]">
                      Miércoles · 11:00 a 14:00 (30 min)
                    </p>
                  </div>
                </div>
                <div className="pt-3 flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-[#003087] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#111827]">Turno de tarde</p>
                    <p className="text-xs font-hours font-medium tabular-nums text-[#555C68]">
                      Miércoles · 16:00 a 18:00 (30 min)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => onNavigate('academia')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#003087] hover:bg-[#002266] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>Consultar horarios de miércoles</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
