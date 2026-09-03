"use client";

import Link from "next/link";
import { useState } from "react";

import { DIAS_SEMANA, tituloDelDia, type Dia, type Mes } from "@/domain/calendario";
import type { ActividadDelCalendario } from "@/domain/tipos";

/**
 * El mes, y debajo —o al lado, si hay sitio— el día que se toque.
 *
 * PULSAR UN DÍA NO VUELVE AL SERVIDOR. Las sesiones del mes entero llegan ya
 * con la página: son unas decenas de líneas de texto, y a cambio moverse por
 * el mes es instantáneo. Lo que sí va al servidor es cambiar de mes o de
 * profesional, que son enlaces de verdad: así recargar mantiene lo que estabas
 * mirando y no hay estado que se pierda.
 *
 * Solo llegan aquí las sesiones que quien mira puede ver. El filtro por
 * profesional se aplica en la consulta, no en esta pantalla.
 */
export function Calendario({
  mes,
  sesiones,
  hoy,
  nombresDeProfesionales,
  agruparPorProfesional,
}: {
  mes: Mes;
  sesiones: ActividadDelCalendario[];
  hoy: string;
  /** `id → nombre`, para poder decir de quién es cada sesión. */
  nombresDeProfesionales: Record<string, string>;
  /** Solo cuando se está mirando a todo el equipo a la vez. */
  agruparPorProfesional: boolean;
}) {
  // Al entrar se abre el día de hoy si está en este mes. Si se está mirando
  // otro mes no se elige ninguno: inventar uno sería enseñar un día al azar.
  const hoyEsteMes = mes.semanas.some((s) => s.some((d) => d.delMes && d.fecha === hoy));
  const [elegido, setElegido] = useState<string | null>(hoyEsteMes ? hoy : null);

  const delDia = sesiones.filter((s) => s.fecha === elegido);

  return (
    <div className="calendario">
      <div className="calendario-cuadricula">
        <div className="calendario-cabecera" aria-hidden="true">
          {DIAS_SEMANA.map((dia, i) => (
            <span key={i}>{dia}</span>
          ))}
        </div>

        {mes.semanas.map((semana, i) => (
          <div className="calendario-semana" key={i}>
            {semana.map((dia) => (
              <Celda
                key={dia.fecha}
                dia={dia}
                elegido={dia.fecha === elegido}
                alPulsar={() => setElegido(dia.fecha)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="calendario-detalle">
        {elegido === null ? (
          <p className="calendario-vacio">Toca un día para ver sus sesiones.</p>
        ) : (
          <DetalleDelDia
            fecha={elegido}
            sesiones={delDia}
            nombresDeProfesionales={nombresDeProfesionales}
            agruparPorProfesional={agruparPorProfesional}
          />
        )}
      </div>
    </div>
  );
}

function Celda({ dia, elegido, alPulsar }: { dia: Dia; elegido: boolean; alPulsar: () => void }) {
  const clases = [
    "calendario-dia",
    dia.delMes ? "" : "fuera",
    dia.esHoy ? "hoy" : "",
    elegido ? "elegido" : "",
    dia.sesiones > 0 ? "con-sesiones" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Lo que oye quien usa lector de pantalla, que no ve ni el punto ni el
  // número de al lado.
  const cuantas =
    dia.sesiones === 0
      ? "sin sesiones"
      : `${dia.sesiones} ${dia.sesiones === 1 ? "sesión" : "sesiones"}`;

  return (
    <button
      type="button"
      className={clases}
      onClick={alPulsar}
      aria-pressed={elegido}
      aria-label={`${dia.numero}, ${cuantas}${dia.esHoy ? ", hoy" : ""}`}
    >
      <span className="calendario-numero">{dia.numero}</span>
      {dia.sesiones > 0 && (
        <span className="calendario-cuenta" aria-hidden="true">
          {dia.sesiones}
        </span>
      )}
    </button>
  );
}

function DetalleDelDia({
  fecha,
  sesiones,
  nombresDeProfesionales,
  agruparPorProfesional,
}: {
  fecha: string;
  sesiones: ActividadDelCalendario[];
  nombresDeProfesionales: Record<string, string>;
  agruparPorProfesional: boolean;
}) {
  return (
    <>
      <h2 className="calendario-dia-titulo">{tituloDelDia(fecha)}</h2>
      <p className="calendario-dia-cuenta">
        {sesiones.length === 0
          ? "No hay sesiones firmadas este día."
          : `${sesiones.length} ${sesiones.length === 1 ? "sesión firmada" : "sesiones firmadas"}`}
      </p>

      {agruparPorProfesional
        ? agrupar(sesiones).map(([id, suyas]) => (
            <section className="calendario-grupo" key={id}>
              <h3 className="calendario-grupo-titulo">
                {nombresDeProfesionales[id] ?? "Sin profesional"}
                <span className="calendario-grupo-cuenta">{suyas.length}</span>
              </h3>
              <ul className="calendario-sesiones">
                {suyas.map((s) => (
                  <Fila key={s.id} sesion={s} />
                ))}
              </ul>
            </section>
          ))
        : sesiones.length > 0 && (
            <ul className="calendario-sesiones">
              {sesiones.map((s) => (
                <Fila key={s.id} sesion={s} />
              ))}
            </ul>
          )}
    </>
  );
}

/** Por profesional, y dentro de cada uno en el orden que ya traían. */
function agrupar(sesiones: ActividadDelCalendario[]): Array<[string, ActividadDelCalendario[]]> {
  const grupos = new Map<string, ActividadDelCalendario[]>();
  for (const sesion of sesiones) {
    const clave = sesion.profesionalId ?? "";
    const suyas = grupos.get(clave);
    if (suyas) suyas.push(sesion);
    else grupos.set(clave, [sesion]);
  }
  return [...grupos.entries()];
}

function Fila({ sesion }: { sesion: ActividadDelCalendario }) {
  const contenido = (
    <>
      {/* La mitad del histórico no tiene hora guardada, y las clases de grupo
          no la tienen nunca. No se inventa. */}
      <span className="calendario-hora">{sesion.hora ?? "—"}</span>
      <span className="calendario-sesion-quien">
        <span className="calendario-cliente">{sesion.titulo}</span>
        {sesion.detalle && <span className="calendario-servicio">{sesion.detalle}</span>}
      </span>
    </>
  );

  // UNA CLASE DE GRUPO NO ES DE NADIE: no puede llevar a la ficha de un cliente
  // que no existe. Se pinta igual, pero sin enlace (2026-09-03).
  if (!sesion.clienteId) {
    return (
      <li>
        <div className="calendario-sesion es-grupo">{contenido}</div>
      </li>
    );
  }

  return (
    <li>
      {/* Lleva a la ficha del cliente: desde el calendario lo que se quiere
          saber es quién es y cómo va, no editar la sesión. */}
      <Link href={`/clientes/${sesion.clienteId}`} className="calendario-sesion">
        {contenido}
      </Link>
    </li>
  );
}
