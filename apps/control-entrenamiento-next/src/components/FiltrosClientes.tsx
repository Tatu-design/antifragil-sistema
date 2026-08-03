"use client";

import Link from "next/link";
import { useState } from "react";

import type { ClienteEnLista } from "@/services/clientes";

type Filtro = "activos" | "pendientes" | "pausados" | "cancelados";

/**
 * Los cuatro contadores son también los filtros.
 *
 * Muestran siempre el total general y **no cambian al filtrar**: dicen cuántos
 * hay, no cuántos se ven. El filtrado ocurre aquí, en el navegador, sin volver
 * a pedirle nada al servidor.
 */
export function FiltrosClientes({ clientes }: { clientes: ClienteEnLista[] }) {
  const [filtro, setFiltro] = useState<Filtro>("activos");

  const contadores: Record<Filtro, number> = {
    activos: clientes.filter((c) => c.estado === "activo").length,
    // Incluye a cualquiera que deba dinero, esté activo, pausado o cancelado.
    pendientes: clientes.filter((c) => c.debe).length,
    pausados: clientes.filter((c) => c.estado === "pausado").length,
    cancelados: clientes.filter((c) => c.estado === "cancelado").length,
  };

  const visibles = clientes.filter((c) => {
    if (filtro === "pendientes") return c.debe;
    if (filtro === "activos") return c.estado === "activo";
    if (filtro === "pausados") return c.estado === "pausado";
    return c.estado === "cancelado";
  });

  const etiquetas: Record<Filtro, string> = {
    activos: "Activos",
    pendientes: "Pendientes de pago",
    pausados: "Pausados",
    cancelados: "Cancelados",
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(etiquetas) as Filtro[]).map((clave) => {
          const activo = filtro === clave;
          return (
            <button
              key={clave}
              type="button"
              onClick={() => setFiltro(clave)}
              aria-pressed={activo}
              // El seleccionado se distingue por color, borde y una marca
              // lateral — no solo por color.
              className={`rounded-tarjeta border p-3 text-left transition ${
                activo
                  ? "border-acento bg-acento/10 border-l-4 border-l-acento"
                  : "border-borde bg-white/85 hover:border-acento/50"
              }`}
            >
              <span className="block text-2xl font-semibold tabular-nums">{contadores[clave]}</span>
              <span className="block text-xs text-tinta-suave">{etiquetas[clave]}</span>
            </button>
          );
        })}
      </div>

      <ul className="flex flex-col gap-2">
        {visibles.map((cliente) => (
          <li key={cliente.id}>
            <Link
              href={`/clientes/${cliente.id}`}
              className="tarjeta flex items-center justify-between gap-3 transition hover:border-acento"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{cliente.nombre}</span>
                <span className="block text-sm text-tinta-suave">
                  {cliente.ficha.etiqueta}
                  {cliente.ficha.sesionesRestantes !== null &&
                    ` · quedan ${cliente.ficha.sesionesRestantes}`}
                </span>
              </span>
              {cliente.debe && (
                <span className="shrink-0 rounded-full bg-aviso/10 px-2 py-1 text-xs font-medium text-aviso">
                  {etiquetaDeuda(cliente)}
                </span>
              )}
            </Link>
          </li>
        ))}
        {visibles.length === 0 && (
          <li className="tarjeta text-center text-sm text-tinta-suave">
            No hay clientes en «{etiquetas[filtro].toLowerCase()}».
          </li>
        )}
      </ul>
    </>
  );
}

/** Dice cuál es el caso, no solo que debe algo. */
function etiquetaDeuda(cliente: ClienteEnLista): string {
  const actual = cliente.ficha.pendientePago;
  if (actual && cliente.ciclosPendientes > 0) return `Pendiente +${cliente.ciclosPendientes}`;
  if (!actual && cliente.ciclosPendientes > 0) {
    return cliente.ciclosPendientes === 1 ? "1 sin cobrar" : `${cliente.ciclosPendientes} sin cobrar`;
  }
  return "Pendiente";
}
