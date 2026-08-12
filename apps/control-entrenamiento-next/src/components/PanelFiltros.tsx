"use client";

import { useEffect, useRef } from "react";

import { FILTROS_INICIALES, type Filtros } from "@/domain/filtros";
import { ETIQUETAS, MODALIDADES } from "@/domain/modalidades";
import type { Estado } from "@/domain/tipos";
import type { PerfilVisible } from "@/lib/foto-perfil";
import { Icono } from "./Iconos";

/**
 * El panel de filtros, que sube desde abajo.
 *
 * Sustituye a las dos filas de botones que había encima de la lista (decisión
 * de Fernando, 2026-08-10). El problema no era que filtrar estuviera mal
 * resuelto: era que había tanta maquinaria antes del primer cliente que la
 * pantalla parecía un formulario en vez de una lista.
 *
 * Fuera del panel se quedan las dos cosas que se usan a diario: buscar por
 * nombre y el aviso de quién debe dinero. Todo lo demás vive aquí dentro.
 *
 * SE APLICA AL INSTANTE, no al pulsar «aplicar». Cada toque se ve en el
 * contador del botón de abajo, así que no hace falta cerrar para saber si el
 * filtro deja algo. El botón solo cierra.
 *
 * Sube desde abajo a propósito: se usa con el pulgar, de pie en el gimnasio.
 */

const ESTADOS: Array<{ valor: Estado; texto: string }> = [
  { valor: "activo", texto: "Activos" },
  { valor: "pausado", texto: "Pausados" },
  { valor: "cancelado", texto: "Cancelados" },
];

export function PanelFiltros({
  abierto,
  alCerrar,
  filtros,
  alCambiar,
  profesionales,
  cuantos,
}: {
  abierto: boolean;
  alCerrar: () => void;
  filtros: Filtros;
  alCambiar: (filtros: Filtros) => void;
  /** Vacío para un entrenador: solo tiene clientes suyos que filtrar. */
  profesionales: PerfilVisible[];
  /** Cuántos clientes quedan con lo elegido. Se ve antes de cerrar. */
  cuantos: number;
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Escape cierra, y al abrirse el foco entra en el panel: quien navega con
  // teclado no se queda dando tabulaciones por la lista de atrás.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", alPulsar);
    panel.current?.focus();
    // Con el panel abierto, lo de detrás no se desplaza.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPulsar);
      document.body.style.overflow = overflow;
    };
  }, [abierto, alCerrar]);

  if (!abierto) return null;

  /** Marcar y desmarcar dentro de un grupo. Lista vacía = «todos». */
  function alternar<T>(lista: T[], valor: T): T[] {
    return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
  }

  return (
    <div className="panel-fondo" onClick={alCerrar} role="presentation">
      <div
        ref={panel}
        className="panel-filtros"
        role="dialog"
        aria-modal="true"
        aria-label="Filtrar clientes"
        tabIndex={-1}
        // Tocar dentro no cierra; tocar el fondo oscuro, sí.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-cabecera">
          <span className="panel-titulo">
            <Icono nombre="i-filter" pequeno />
            Filtrar
          </span>
          <button type="button" className="panel-cerrar" onClick={alCerrar} aria-label="Cerrar">
            <Icono nombre="i-x" pequeno />
          </button>
        </div>

        <div className="panel-cuerpo">
          {/* Solo tiene sentido si hay entre quién elegir: un entrenador ve
              únicamente a los suyos, así que este grupo no le aparece. */}
          {profesionales.length > 1 && (
            <Grupo titulo="Profesional">
              <Opcion
                texto="Todos"
                marcada={filtros.profesional === "todos"}
                alPulsar={() => alCambiar({ ...filtros, profesional: "todos" })}
              />
              {profesionales.map((p) => (
                <Opcion
                  key={p.id}
                  texto={p.nombre}
                  marcada={filtros.profesional === p.id}
                  alPulsar={() => alCambiar({ ...filtros, profesional: p.id })}
                />
              ))}
            </Grupo>
          )}

          <Grupo titulo="Estado del cliente">
            {ESTADOS.map(({ valor, texto }) => (
              <Opcion
                key={valor}
                texto={texto}
                marcada={filtros.estados.includes(valor)}
                alPulsar={() => alCambiar({ ...filtros, estados: alternar(filtros.estados, valor) })}
              />
            ))}
          </Grupo>

          <Grupo titulo="Tipo de programa">
            {MODALIDADES.map((m) => (
              <Opcion
                key={m}
                texto={ETIQUETAS[m]}
                marcada={filtros.modalidades.includes(m)}
                alPulsar={() =>
                  alCambiar({ ...filtros, modalidades: alternar(filtros.modalidades, m) })
                }
              />
            ))}
          </Grupo>
        </div>

        <div className="panel-pie">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => alCambiar(FILTROS_INICIALES)}
          >
            Quitar filtros
          </button>
          <button type="button" className="boton" onClick={alCerrar}>
            {cuantos === 1 ? "Ver 1 cliente" : `Ver ${cuantos} clientes`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel-grupo">
      <legend className="panel-grupo-titulo">{titulo}</legend>
      <div className="panel-opciones">{children}</div>
    </fieldset>
  );
}

/**
 * Una opción del panel.
 *
 * Es un botón con estado marcado, no una casilla: se toca con el pulgar y el
 * área entera responde. Lo dice también con texto (`aria-pressed`), para que
 * no dependa solo del color.
 */
function Opcion({
  texto,
  marcada,
  alPulsar,
}: {
  texto: string;
  marcada: boolean;
  alPulsar: () => void;
}) {
  return (
    <button
      type="button"
      className={`panel-opcion${marcada ? " marcada" : ""}`}
      aria-pressed={marcada}
      onClick={alPulsar}
    >
      {texto}
    </button>
  );
}
