"use client";

import Link from "next/link";
import { useState } from "react";

import type { ClienteEnLista } from "@/services/clientes";

type Filtro = "activos" | "pendientes" | "pausados" | "cancelados";

/** Los mismos textos que `webapp/templates/index.html`. */
const VACIOS: Record<Filtro, string> = {
  activos: "No hay clientes activos.",
  pendientes: "No hay clientes pendientes de pago.",
  pausados: "No hay clientes pausados.",
  cancelados: "No hay clientes cancelados.",
};

const NOMBRES: Record<Filtro, string> = {
  activos: "Activos",
  pendientes: "Pendientes de pago",
  pausados: "Pausados",
  cancelados: "Cancelados",
};

/**
 * Los cuatro contadores son también los filtros. Muestran SIEMPRE el total
 * general de cada grupo: dicen cuántos clientes hay de cada cosa, no cuántos
 * se están viendo, así que no cambian al filtrar.
 *
 * El filtrado ocurre en el propio navegador: las tarjetas ya están todas en la
 * página, así que cambiar de filtro solo esconde y muestra.
 */
export function ListaClientes({ clientes }: { clientes: ClienteEnLista[] }) {
  const [filtro, setFiltro] = useState<Filtro>("activos");

  const conteos: Record<Filtro, number> = {
    activos: clientes.filter((c) => c.estado === "activo").length,
    // Incluye a cualquiera que deba dinero, esté activo, pausado o cancelado.
    pendientes: clientes.filter((c) => c.debe).length,
    pausados: clientes.filter((c) => c.estado === "pausado").length,
    cancelados: clientes.filter((c) => c.estado === "cancelado").length,
  };

  const visible = (c: ClienteEnLista) =>
    filtro === "pendientes" ? c.debe : c.estado === filtro.slice(0, -1);

  const visibles = clientes.filter(visible);

  return (
    <>
      <div className="filtros" role="group" aria-label="Filtrar clientes">
        {(Object.keys(NOMBRES) as Filtro[]).map((clave) => (
          <button
            key={clave}
            type="button"
            className={`filtro${filtro === clave ? " activo" : ""}${
              clave === "pendientes" && conteos.pendientes ? " filtro-alerta" : ""
            }`}
            data-filtro={clave}
            aria-pressed={filtro === clave}
            onClick={() => setFiltro(clave)}
          >
            <span className="filtro-nombre">{NOMBRES[clave]}</span>
            <span className="filtro-numero">{conteos[clave]}</span>
          </button>
        ))}
      </div>

      <div className="clientes-grid" id="lista-clientes">
        {clientes.map((cliente) => (
          <Link
            key={cliente.id}
            className="tarjeta-cliente"
            href={`/clientes/${cliente.id}`}
            data-estado={cliente.estado}
            data-pendiente={cliente.debe ? "si" : "no"}
            hidden={!visible(cliente)}
          >
            {/* Dos etiquetas para dos cosas distintas (2026-08-05): la
                continuidad del cliente y su deuda. Nunca se mezclan en una
                sola, y la de pago se ve SIEMPRE — un pausado o un cancelado
                que deba dinero tiene que notarse. */}
            <div className="cabecera">
              <span className="nombre">{cliente.nombre}</span>
              <span className="etiquetas">
                {cliente.estado === "pausado" && <span className="pill pausado">Pausado</span>}
                {cliente.estado === "cancelado" && <span className="pill cancelado">Cancelado</span>}
                {cliente.debe ? (
                  <span className="pill pendiente">{etiquetaDeuda(cliente)}</span>
                ) : (
                  <span className="pill aldia">Pagado</span>
                )}
              </span>
            </div>

            {cliente.ficha.sesionesTotales ? (
              <div className="progreso-mini">
                <div className="progreso-mini-numeros">
                  <span>
                    <strong>{cliente.ficha.sesionesHechas}</strong> de {cliente.ficha.sesionesTotales} sesiones
                  </span>
                  <span>quedan {cliente.ficha.sesionesRestantes}</span>
                </div>
                <div className="progreso-mini-barra">
                  <span style={{ width: `${cliente.ficha.porcentaje ?? 0}%` }} />
                </div>
              </div>
            ) : (
              <div className="meta">{sinBarra(cliente)}</div>
            )}
          </Link>
        ))}
      </div>

      <p className="empty" hidden={visibles.length > 0}>
        {VACIOS[filtro]}
      </p>
    </>
  );
}

/**
 * Dice CUÁL es el caso de deuda, no solo que debe algo.
 *
 * Habla únicamente de dinero: no menciona si el cliente está activo, pausado
 * o cancelado — eso es el otro eje y tiene su propia etiqueta.
 */
function etiquetaDeuda(cliente: ClienteEnLista): string {
  const actual = cliente.ficha.pendientePago;
  if (cliente.ciclosPendientes && !actual) return `${cliente.ciclosPendientes} sin pagar`;
  if (cliente.ciclosPendientes) return `Pendiente +${cliente.ciclosPendientes}`;
  return "Pendiente de pago";
}

/**
 * Qué se pone cuando no hay barra de progreso.
 *
 * En Flask siempre era «Faltan datos del programa», porque cuando se escribió
 * solo existían los bonos. Con mensualidad y cuenta ese texto sería falso: no
 * les falta nada, es que no tienen tope. Solo se dice que faltan datos cuando
 * de verdad faltan.
 */
function sinBarra(cliente: ClienteEnLista): string {
  if (!cliente.ficha.completo) return "Faltan datos del programa";
  const n = cliente.ficha.sesionesHechas;
  return `${n} ${n === 1 ? "sesión" : "sesiones"} este mes · ${cliente.ficha.etiqueta}`;
}
