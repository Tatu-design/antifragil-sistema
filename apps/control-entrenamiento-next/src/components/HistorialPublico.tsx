"use client";

import { useState } from "react";

import { fechaEs } from "@/lib/formato";
import type { ProgramaPublico } from "@/services/publico";
import { Icono } from "./Iconos";

/**
 * El historial de sesiones del cliente, agrupado por programa.
 *
 * **Dos niveles, los dos plegables** (Fernando, 2026-08-10):
 *
 *   1. El historial entero, plegado de entrada. Con dieciséis sesiones, la
 *      lista completa empujaba hacia abajo justo lo que el cliente viene a
 *      mirar: cuántas lleva y cuántas le quedan.
 *   2. Dentro, **cada programa se despliega por separado**. Abrir el historial
 *      y encontrarse todas las sesiones de todos los programas de golpe es el
 *      mismo problema otra vez, solo que un toque más adentro.
 *
 * Es el mismo comportamiento que el historial de la ficha interna, para que
 * las dos pantallas se manejen igual.
 *
 * **Cada programa se identifica por sus fechas, NO por su nombre**: los
 * nombres son etiquetas internas de Fernando y llevan la tarifa dentro
 * («Nuevo 45€ x4»).
 *
 * **Solo fecha y hora en cada línea.** Recibe `ProgramaPublico`, no los ciclos
 * y sesiones completos: la tarifa y el nombre se quedan en el servidor. Dejar
 * de pintarlos no bastaba —Next incrusta en la página lo que recibe el
 * navegador— y se veían en el código fuente.
 */
export function HistorialPublico({ programas }: { programas: ProgramaPublico[] }) {
  const [abierto, setAbierto] = useState(false);
  const [desplegados, setDesplegados] = useState<number[]>([]);

  const total = programas.reduce((n, p) => n + p.sesiones.length, 0);
  const anteriores = programas.filter((p) => !p.esActual);

  const alternar = (ciclo: number) =>
    setDesplegados((previos) =>
      previos.includes(ciclo) ? previos.filter((c) => c !== ciclo) : [...previos, ciclo],
    );

  return (
    <div className="lista historial-cliente">
      <button
        type="button"
        className="cabecera-plegable"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span>Historial de sesiones {total > 0 && `· ${total}`}</span>
        <Icono nombre={abierto ? "i-chevron-down" : "i-chevron-right"} pequeno />
      </button>

      {abierto &&
        (total === 0 ? (
          <p className="empty">Todavía no hay sesiones registradas.</p>
        ) : (
          programas.map((programa) => (
            <Programa
              key={programa.ciclo}
              programa={programa}
              desplegado={desplegados.includes(programa.ciclo)}
              alPulsar={() => alternar(programa.ciclo)}
              // El primero de los anteriores lleva el separador, para que se
              // vea dónde acaba lo de ahora y empieza lo de antes.
              separador={!programa.esActual && programa === anteriores[0]}
            />
          ))
        ))}
    </div>
  );
}

function Programa({
  programa,
  desplegado,
  alPulsar,
  separador,
}: {
  programa: ProgramaPublico;
  desplegado: boolean;
  alPulsar: () => void;
  separador: boolean;
}) {
  const n = programa.sesiones.length;

  return (
    <>
      {separador && <div className="separador-programas">Programas anteriores</div>}

      <div className="grupo-programa">
        <button
          type="button"
          className="grupo-programa-cabecera"
          onClick={alPulsar}
          aria-expanded={desplegado}
          // Sin sesiones no hay nada que desplegar: no se deja pulsar para no
          // prometer algo que luego no pasa.
          disabled={n === 0}
        >
          <span className="grupo-programa-texto">
            <span className="etiqueta-suave">
              {programa.esActual ? "Programa actual" : "Programa terminado"}
            </span>
            <span className="grupo-programa-fechas">{periodo(programa)}</span>
          </span>
          {n > 0 && <Icono nombre={desplegado ? "i-chevron-down" : "i-chevron-right"} pequeno />}
        </button>

        {desplegado &&
          programa.sesiones.map((sesion) => (
            <div className="fila" key={sesion.id}>
              <div className="sesion-fila">
                <div className="sesion-badge">{sesion.numeroSesion}</div>
                <div className="sesion-info">
                  <div className="fecha">{fechaEs(sesion.fecha)}</div>
                  {sesion.hora && <div className="tipo">{sesion.hora}</div>}
                </div>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

/**
 * Cuándo empezó, cuándo terminó y cuántas sesiones tuvo, en una línea.
 *
 * Sin fechas —hay programas migrados que no las tienen— se dice solo lo
 * segundo, que siempre es verdad. No se inventa ninguna fecha.
 */
function periodo(programa: ProgramaPublico): string {
  const n = programa.sesiones.length;
  const sesiones = n === 0 ? "todavía sin sesiones" : `${n} ${n === 1 ? "sesión" : "sesiones"}`;

  if (programa.desde && programa.hasta) {
    return `Del ${fechaEs(programa.desde)} al ${fechaEs(programa.hasta)} · ${sesiones}`;
  }
  if (programa.desde) return `Desde el ${fechaEs(programa.desde)} · ${sesiones}`;
  return sesiones;
}
