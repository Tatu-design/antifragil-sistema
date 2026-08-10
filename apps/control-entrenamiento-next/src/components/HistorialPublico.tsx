"use client";

import { useState } from "react";

import { fechaEs } from "@/lib/formato";
import type { ProgramaPublico } from "@/services/publico";
import { Icono } from "./Iconos";

/**
 * El historial de sesiones del cliente, agrupado por programa.
 *
 * **Plegado por defecto** (Fernando, 2026-08-10), como el de la ficha interna.
 * Con dieciséis sesiones, la lista entera empujaba hacia abajo justo lo que el
 * cliente abre a mirar: cuántas lleva y cuántas le quedan.
 *
 * **Agrupado por programa**, con el que tiene en curso primero. Cada programa
 * se identifica por sus fechas y sus sesiones, NO por su nombre: los nombres
 * son etiquetas internas de Fernando y llevan la tarifa dentro («Nuevo 45€
 * x4»).
 *
 * **Solo fecha y hora en cada línea.** Recibe `ProgramaPublico`, no los ciclos
 * y sesiones completos: la tarifa y el nombre se quedan en el servidor. Dejar
 * de pintarlos no bastaba —Next incrusta en la página lo que recibe el
 * navegador— y se veían en el código fuente.
 */
export function HistorialPublico({ programas }: { programas: ProgramaPublico[] }) {
  const [abierto, setAbierto] = useState(false);

  const total = programas.reduce((n, p) => n + p.sesiones.length, 0);
  const anteriores = programas.filter((p) => !p.esActual);

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
              // El primero de los anteriores lleva el separador, para que se
              // vea dónde acaba lo de ahora y empieza lo de antes.
              separador={!programa.esActual && programa === anteriores[0]}
            />
          ))
        ))}
    </div>
  );
}

function Programa({ programa, separador }: { programa: ProgramaPublico; separador: boolean }) {
  return (
    <>
      {separador && <div className="separador-programas">Programas anteriores</div>}

      <div className="grupo-programa">
        <div className="grupo-programa-cabecera">
          <span className="etiqueta-suave">
            {programa.esActual ? "Programa actual" : "Programa terminado"}
          </span>
          <span className="grupo-programa-fechas">{periodo(programa)}</span>
        </div>

        {programa.sesiones.length === 0 ? (
          <p className="meta grupo-programa-vacio">Todavía sin sesiones.</p>
        ) : (
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
          ))
        )}
      </div>
    </>
  );
}

/**
 * Cuándo empezó y cuándo terminó, en una línea.
 *
 * Sin fechas —hay programas migrados que no las tienen— se dice cuántas
 * sesiones tuvo, que siempre es verdad. No se inventa ninguna fecha.
 */
function periodo(programa: ProgramaPublico): string {
  const n = programa.sesiones.length;
  const sesiones = `${n} ${n === 1 ? "sesión" : "sesiones"}`;

  if (programa.desde && programa.hasta) {
    return `Del ${fechaEs(programa.desde)} al ${fechaEs(programa.hasta)} · ${sesiones}`;
  }
  if (programa.desde) return `Desde el ${fechaEs(programa.desde)} · ${sesiones}`;
  return sesiones;
}
