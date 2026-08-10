"use client";

import { useFormStatus } from "react-dom";

import { accionMarcarCobro } from "@/app/actions";
import type { FichaServicio } from "@/domain/tipos";
import { euros, mesEs } from "@/lib/formato";
import { Icono } from "./Iconos";

/**
 * El servicio en curso. Copia de `.perfil-hero` de la plantilla Flask.
 *
 * Todo sale de `ficha`, que se construye desde el ciclo en curso: este
 * componente no decide nada ni mezcla dos fuentes.
 */
export function PerfilHero({ clienteId, ficha }: { clienteId: string; ficha: FichaServicio }) {
  const plural = (n: number) => (n === 1 ? "sesión" : "sesiones");

  return (
    <div className="perfil-hero">
      <div className="programa-nombre">
        {ficha.servicio ?? "sin servicio asignado"}
        {ficha.modalidad !== "bono" && <span className="etiqueta-modalidad">{ficha.etiqueta}</span>}
      </div>

      {ficha.modalidad === "bono" && (
        <>
          {ficha.sesionesTotales ? (
            <div className="perfil-progreso">
              <div className="perfil-progreso-numeros">
                <span className="grande">{ficha.sesionesHechas}</span>
                <span className="de">de {ficha.sesionesTotales} sesiones</span>
              </div>
              <div className="perfil-progreso-barra">
                <span style={{ width: `${ficha.porcentaje ?? 0}%` }} />
              </div>
              <div className="perfil-progreso-restantes">Quedan {ficha.sesionesRestantes}</div>
            </div>
          ) : null}
          <dl className="datos-servicio">
            {ficha.precioTotal ? (
              <div>
                <dt>Precio del bono</dt>
                <dd>{euros(ficha.precioTotal)}</dd>
              </div>
            ) : null}
            {ficha.tarifa ? (
              <div>
                <dt>Por sesión</dt>
                <dd>{euros(ficha.tarifa)}</dd>
              </div>
            ) : null}
          </dl>
        </>
      )}

      {ficha.modalidad === "mensualidad" && (
        <>
          {/* Sin barra ni sesiones restantes: no hay nada que agotar. */}
          <div className="perfil-progreso">
            <div className="perfil-progreso-numeros">
              <span className="grande">{ficha.sesionesHechas}</span>
              <span className="de">
                {plural(ficha.sesionesHechas)} este mes
                {ficha.sesionesReferencia ? ` · ${ficha.sesionesReferencia} de referencia` : ""}
              </span>
            </div>
          </div>
          <dl className="datos-servicio">
            <div>
              <dt>Cuota del mes</dt>
              <dd>{euros(ficha.cuotaMensual)}</dd>
            </div>
            <div>
              <dt>Sale a</dt>
              <dd>{ficha.precioEfectivo ? `${euros(ficha.precioEfectivo)}/h` : "—"}</dd>
            </div>
            {ficha.mes ? (
              <div>
                <dt>Periodo</dt>
                <dd>
                  {mesEs(ficha.mes)} {ficha.anio}
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      )}

      {ficha.modalidad === "cuenta" && (
        <>
          <div className="perfil-progreso">
            <div className="perfil-progreso-numeros">
              <span className="grande">{ficha.sesionesHechas}</span>
              <span className="de">{plural(ficha.sesionesHechas)} este mes</span>
            </div>
          </div>
          <dl className="datos-servicio">
            <div>
              <dt>Precio por sesión</dt>
              <dd>{euros(ficha.tarifa)}</dd>
            </div>
            <div>
              <dt>Total del mes</dt>
              <dd className="acumulado">{euros(ficha.facturacion)}</dd>
            </div>
            {ficha.mes ? (
              <div>
                <dt>Periodo</dt>
                <dd>
                  {mesEs(ficha.mes)} {ficha.anio}
                </dd>
              </div>
            ) : null}
          </dl>
          {/* El cálculo a la vista, para que el total no haya que creérselo. */}
          <p className="meta calculo-total">
            {ficha.sesionesHechas} {plural(ficha.sesionesHechas)} × {euros(ficha.tarifa)} ={" "}
            {euros(ficha.facturacion)}
          </p>
          <p className="meta">Es lo producido este periodo, no necesariamente lo ya cobrado.</p>
        </>
      )}

      {/* El cobro se cambia desde aquí mismo, con confirmación previa. Solo
          toca el estado de COBRO: no altera sesiones, horas, historial ni
          economía, ni hacia adelante ni hacia atrás. */}
      <form
        action={accionMarcarCobro}
        className="estado"
        onSubmit={(evento) => {
          const pregunta = ficha.pendientePago
            ? `¿Marcar ${ficha.etiqueta.toLowerCase()} como cobrada?`
            : `¿Volver a marcar ${ficha.etiqueta.toLowerCase()} como pendiente de cobro?`;
          if (!confirm(pregunta)) evento.preventDefault();
        }}
      >
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="ciclo" value={ficha.ciclo ?? 1} />
        <input type="hidden" name="pagado" value={ficha.pendientePago ? "si" : "no"} />
        <BotonPago etiqueta={ficha.etiquetaPago} pendiente={ficha.pendientePago} />
      </form>
    </div>
  );
}

function BotonPago({ etiqueta, pendiente }: { etiqueta: string; pendiente: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`pill ${pendiente ? "pendiente" : "aldia"} pill-boton`}
      disabled={pending}
    >
      {pending ? "Guardando…" : etiqueta}
      <Icono nombre="i-chevron-right" pequeno />
    </button>
  );
}
