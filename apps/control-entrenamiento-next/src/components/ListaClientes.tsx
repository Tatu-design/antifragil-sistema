"use client";

import Link from "next/link";
import { useState } from "react";

import type { FichaClase } from "@/domain/clases";
import type { ClienteEnLista } from "@/services/clientes";

type Filtro = "activos" | "pendientes" | "pausados" | "cancelados";

/** Los mismos textos que `webapp/templates/index.html`. */
const VACIOS: Record<Filtro, string> = {
  activos: "No hay nada activo.",
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
export function ListaClientes({
  clientes,
  cuentas = [],
}: {
  clientes: ClienteEnLista[];
  /** CrossFit Lidomare y Kids. No son clientes: son cuentas de actividad. */
  cuentas?: FichaClase[];
}) {
  const [filtro, setFiltro] = useState<Filtro>("activos");

  const conteos: Record<Filtro, number> = {
    // Las dos cuentas de CrossFit cuentan aquí: el número tiene que coincidir
    // con las tarjetas que se ven. Por eso el filtro se llama «Activos» y no
    // «Clientes activos» — hay dos tarjetas que no son clientes.
    activos: clientes.filter((c) => c.estado === "activo").length + cuentas.length,
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
        {/* Las cuentas de actividad van primero y SOLO en «Activos»: no
            tienen deuda, ni pausa, ni cancelación — esos tres estados
            pertenecen a clientes de verdad. */}
        {cuentas.map((cuenta) => (
          <TarjetaCuenta key={cuenta.tipo} cuenta={cuenta} oculta={filtro !== "activos"} />
        ))}

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

      <p className="empty" hidden={visibles.length > 0 || (filtro === "activos" && cuentas.length > 0)}>
        {VACIOS[filtro]}
      </p>
    </>
  );
}

/**
 * La tarjeta de CrossFit Lidomare o Kids.
 *
 * Se parece a la de un cliente para que la pantalla se lea igual, pero no
 * enseña nada que no le corresponda: ni bono, ni sesiones restantes, ni
 * pendiente de pago, ni «al día». Son cuentas de actividad, no clientes.
 *
 * Lidomare no lleva barra: no tiene tope, así que no hay nada que llenar.
 * Kids sí, porque tiene una referencia de clases al mes.
 */
function TarjetaCuenta({ cuenta, oculta }: { cuenta: FichaClase; oculta: boolean }) {
  return (
    <Link className="tarjeta-cliente tarjeta-cuenta" href={`/clases/${cuenta.tipo}`} hidden={oculta}>
      <div className="cabecera">
        <span className="nombre">{cuenta.nombre}</span>
        <span className="etiquetas">
          <span className="pill cuenta-actividad">CrossFit</span>
        </span>
      </div>

      {cuenta.referencia ? (
        <div className="progreso-mini">
          <div className="progreso-mini-numeros">
            <span>
              <strong>{cuenta.sesiones}</strong> de {cuenta.referencia} sesiones
            </span>
            <span>quedan {cuenta.restantes}</span>
          </div>
          <div className="progreso-mini-barra">
            <span style={{ width: `${cuenta.porcentaje ?? 0}%` }} />
          </div>
          <div className="meta">
            {cuenta.facturacionPendiente
              ? "Facturación pendiente de introducir"
              : cuenta.facturacion !== null
                ? `Facturación ${euros(cuenta.facturacion)}`
                : "Sin clases este mes"}
          </div>
        </div>
      ) : (
        <div className="meta">
          {cuenta.sesiones} {cuenta.sesiones === 1 ? "sesión" : "sesiones"} este mes ·{" "}
          {euros(cuenta.facturacion ?? 0)}
        </div>
      )}
    </Link>
  );
}

/** 1234.5 -> 1.234,50 €, como se escribe una cantidad en España. */
function euros(valor: number): string {
  return `${valor.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
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
