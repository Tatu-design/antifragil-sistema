"use client";

import Link from "next/link";
import { useState } from "react";

import type { FichaClase } from "@/domain/clases";
import { FILTROS_INICIALES, coincide, filtrosPuestos, normalizar, type Filtros } from "@/domain/filtros";
import type { Perfil } from "@/repositories/tipos";
import type { ClienteEnLista } from "@/services/clientes";
import { Icono } from "./Iconos";
import { PanelFiltros } from "./PanelFiltros";

/**
 * La lista de clientes.
 *
 * Hasta el 2026-08-10 tenía dos filas de botones encima —cuatro contadores de
 * estado y una fila de profesionales— y había que bajar bastante para ver al
 * primer cliente. Fernando lo cortó: la pantalla parecía un formulario en vez
 * de una lista.
 *
 * Fuera solo quedan las dos cosas que se usan a diario:
 *
 *   1. **Buscar por nombre**, siempre a mano.
 *   2. **El aviso de quién debe dinero**, que es información y no solo un
 *      filtro: tiene que verse al abrir la app, sin abrir nada.
 *
 * El resto —profesional, estado del cliente y tipo de programa— vive en un
 * panel que sube desde abajo, y **los filtros se suman**: se puede pedir «los
 * de Rafa que están pendientes de pago».
 *
 * Todo ocurre en el navegador: las tarjetas ya están en la página, así que
 * filtrar solo esconde y muestra. Lo que un entrenador NO debe ver nunca llega
 * hasta aquí — eso se resuelve en la consulta, no escondiendo tarjetas.
 */
export function ListaClientes({
  clientes,
  cuentas = [],
  profesionales = [],
}: {
  clientes: ClienteEnLista[];
  /** CrossFit Lidomare y Kids. No son clientes: son cuentas de actividad. */
  cuentas?: FichaClase[];
  /** Para el filtro por profesional. Llega vacío para un entrenador: solo
   *  tiene clientes suyos, así que no habría nada que separar. */
  profesionales?: Perfil[];
}) {
  // Se abre en «activos», que es lo que se mira casi siempre. Un cancelado de
  // hace medio año no debe aparecer sin haberlo pedido.
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [busqueda, setBusqueda] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const deudores = clientes.filter((c) => c.debe).length;
  const buscado = normalizar(busqueda.trim());

  const visible = (c: ClienteEnLista) =>
    coincide(
      { ...c, profesionalId: c.profesionalId, modalidad: c.ficha.modalidad },
      { busqueda, soloPendientes, filtros },
    );

  const visibles = clientes.filter(visible);

  const puestos = filtrosPuestos(filtros);

  // Las cuentas de CrossFit no tienen dueño, ni deuda, ni modalidad. Se
  // enseñan solo cuando no se está preguntando algo que ellas no pueden
  // contestar; si no, saldrían siempre y mentirían sobre el filtro.
  const verCuentas =
    buscado === "" &&
    !soloPendientes &&
    filtros.profesional === "todos" &&
    filtros.modalidades.length === 0 &&
    filtros.estados.includes("activo");

  const cuantos = visibles.length + (verCuentas ? cuentas.length : 0);

  return (
    <>
      <div className="barra-busqueda">
        <Icono nombre="i-search" pequeno />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar cliente"
          aria-label="Buscar cliente por nombre"
        />
        <button
          type="button"
          className={`boton-filtrar${puestos ? " con-filtros" : ""}`}
          onClick={() => setAbierto(true)}
          aria-label={puestos ? `Filtrar, ${puestos} puestos` : "Filtrar"}
        >
          <Icono nombre="i-filter" pequeno />
          {puestos > 0 && <span className="boton-filtrar-numero">{puestos}</span>}
        </button>
      </div>

      {/* El único contador que se queda fuera del panel. Si alguien debe
          dinero hay que verlo al abrir la app, no después de dos toques. */}
      {deudores > 0 && (
        <button
          type="button"
          className={`aviso-deuda${soloPendientes ? " activo" : ""}`}
          aria-pressed={soloPendientes}
          onClick={() => setSoloPendientes((v) => !v)}
        >
          <span className="aviso-deuda-numero">{deudores}</span>
          <span>{deudores === 1 ? "cliente pendiente de pago" : "clientes pendientes de pago"}</span>
        </button>
      )}

      <PanelFiltros
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        filtros={filtros}
        alCambiar={setFiltros}
        profesionales={profesionales}
        cuantos={cuantos}
      />

      <div className="clientes-grid" id="lista-clientes">
        {cuentas.map((cuenta) => (
          <TarjetaCuenta key={cuenta.tipo} cuenta={cuenta} oculta={!verCuentas} />
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

      <p className="empty" hidden={cuantos > 0}>
        {buscado ? "No hay ningún cliente con ese nombre." : "No hay nada con esos filtros."}
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
