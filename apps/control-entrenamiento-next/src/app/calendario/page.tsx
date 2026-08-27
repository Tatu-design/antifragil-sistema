import Image from "next/image";
import Link from "next/link";

import { BarraInferior } from "@/components/BarraInferior";
import { BotonPerfil } from "@/components/BotonPerfil";
import { Calendario } from "@/components/Calendario";
import { Iconos } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { alcanceDelCalendario } from "@/domain/atribucion";
import { claveDelMes, mesAnterior, mesPedido, mesSiguiente } from "@/domain/calendario";
import { paraLaInterfaz } from "@/lib/foto-perfil";
import { hoyNegocio } from "@/lib/fechas";
import { exigirUsuario } from "@/lib/permisos";
import { listarProfesionales } from "@/repositories/perfiles";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerCalendario } from "@/services/calendario";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Calendario" };

/**
 * Qué sesiones se firmaron cada día.
 *
 * No es una agenda: aquí no hay citas ni sesiones previstas. Es otra forma de
 * mirar las sesiones que YA están firmadas, y por eso no hay ninguna tabla
 * nueva — se leen las de siempre.
 *
 * El mes y el profesional viajan en la dirección (`?mes=2026-08&profesional=…`)
 * y el día se elige en el navegador. Así cambiar de mes recarga de verdad —y
 * recargar la página mantiene lo que estabas mirando—, pero tocar un día es
 * instantáneo: las sesiones del mes entero ya están.
 */
export default async function PaginaCalendario({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; profesional?: string }>;
}) {
  // Entran los dos: un entrenador también necesita ver lo que ha hecho. Lo que
  // cambia es de quién puede verlo, y eso lo decide `alcanceDelCalendario`.
  const usuario = await exigirUsuario();
  const { mes: mesTexto, profesional: pedido } = await searchParams;

  let profesionales;
  try {
    profesionales = await listarProfesionales();
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const hoy = hoyNegocio();
  const { anio, mes } = mesPedido(mesTexto, hoy);

  // LA BARRERA. A un entrenador le sale siempre su propio identificador,
  // escriba lo que escriba en la dirección; el filtro se aplica después en la
  // consulta, no en la pantalla.
  const alcance = alcanceDelCalendario(usuario, pedido, profesionales);

  let vista;
  let sinLeer = 0;
  try {
    [vista, sinLeer] = await Promise.all([
      obtenerCalendario({ anio, mes, profesionalId: alcance.profesionalId, adminId: alcance.adminId }),
      contarNoLeidos(),
    ]);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const conservando = alcance.profesionalId ? `&profesional=${alcance.profesionalId}` : "";
  const enlaceDelMes = (destino: { anio: number; mes: number }) =>
    `/calendario?mes=${claveDelMes(destino.anio, destino.mes)}${conservando}`;

  const nombres = Object.fromEntries(profesionales.map((p) => [p.id, p.nombre]));

  return (
    <>
      <Iconos />
      <div className="page-ancha">
        <header className="cabecera-app">
          <div className="cabecera-app-marca">
            <Image src="/logo-marca.png" alt="Antifrágil" className="logo-nav" width={120} height={32} priority />
            <BotonPerfil usuario={{ ...paraLaInterfaz(usuario), correo: usuario.correo }} />
          </div>
        </header>

        <h1>Calendario</h1>

        {/* Solo el administrador elige de quién. A un entrenador no se le
            enseña, y aunque se le enseñara no le serviría de nada. */}
        {alcance.puedeElegir && profesionales.length > 1 && (
          <div className="filtros-profesional" role="group" aria-label="Ver el calendario de">
            <Link
              href={`/calendario?mes=${claveDelMes(anio, mes)}`}
              className={`panel-opcion${alcance.profesionalId === null ? " marcada" : ""}`}
              aria-current={alcance.profesionalId === null ? "page" : undefined}
            >
              Todos
            </Link>
            {profesionales.map((p) => (
              <Link
                key={p.id}
                href={`/calendario?mes=${claveDelMes(anio, mes)}&profesional=${p.id}`}
                className={`panel-opcion${p.id === alcance.profesionalId ? " marcada" : ""}`}
                aria-current={p.id === alcance.profesionalId ? "page" : undefined}
              >
                {p.nombre}
              </Link>
            ))}
          </div>
        )}

        <div className="calendario-barra">
          <Link
            className="calendario-flecha"
            href={enlaceDelMes(mesAnterior(anio, mes))}
            aria-label="Mes anterior"
            rel="prev"
          >
            ‹
          </Link>
          <h2 className="calendario-mes">{vista.mes.titulo}</h2>
          <Link
            className="calendario-flecha"
            href={enlaceDelMes(mesSiguiente(anio, mes))}
            aria-label="Mes siguiente"
            rel="next"
          >
            ›
          </Link>
          {/* Vuelve al mes de hoy Y abre el día de hoy, que es lo que se quiere
              cuando se pulsa. Conserva de quién se está mirando. */}
          <Link className="calendario-hoy" href={`/calendario${conservando ? `?${conservando.slice(1)}` : ""}`}>
            Hoy
          </Link>
        </div>

        <p className="calendario-total">
          {vista.mes.total === 0
            ? "Sin sesiones firmadas este mes"
            : `${vista.mes.total} ${vista.mes.total === 1 ? "sesión firmada" : "sesiones firmadas"} este mes`}
        </p>

        <Calendario
          mes={vista.mes}
          sesiones={vista.sesiones}
          hoy={vista.hoy}
          nombresDeProfesionales={nombres}
          agruparPorProfesional={alcance.profesionalId === null}
        />
      </div>

      <BarraInferior activa="calendario" sinLeer={sinLeer} soloClientes={usuario.rol !== "admin"} />
    </>
  );
}
