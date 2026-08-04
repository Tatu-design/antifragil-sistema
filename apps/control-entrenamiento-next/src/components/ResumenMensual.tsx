"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionFacturacionKids, type Resultado } from "@/app/actions";
import { ETIQUETAS, type Modalidad } from "@/domain/modalidades";
import type { ResumenMes } from "@/domain/economia";
import { nombreMes } from "@/lib/fechas";
import { Aviso } from "./Aviso";

const euros = (v: number | null) =>
  v === null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

/**
 * Los meses, del más reciente al más antiguo.
 *
 * A diferencia de la semana, cada sesión cuenta en el mes de SU fecha: una
 * semana a caballo entre julio y agosto se reparte entre los dos.
 */
export function ResumenMensual({ meses }: { meses: ResumenMes[] }) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionFacturacionKids, null);

  if (meses.length === 0) {
    return (
      <section className="tarjeta text-sm text-tinta-suave" aria-label="Meses">
        Todavía no hay ningún mes con datos.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Resumen por meses">
      <h2 className="text-lg font-medium">Meses</h2>
      <Aviso resultado={resultado} />

      {meses.map((mes) => (
        <details key={`${mes.anio}-${mes.mes}`} className="tarjeta" open={mes === meses[0]}>
          <summary className="flex cursor-pointer items-baseline justify-between gap-2">
            <span className="font-medium capitalize">
              {nombreMes(mes.mes)} {mes.anio}
            </span>
            <span className="text-sm tabular-nums">
              {euros(mes.facturacionTotal)}
              {mes.provisional && <span className="ml-1 text-xs text-aviso">provisional</span>}
            </span>
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Cifra titulo="Facturado" valor={euros(mes.facturacionTotal)} />
              <Cifra titulo="Horas" valor={String(mes.horasTotales)} />
              <Cifra titulo="Media/hora" valor={euros(mes.precioMedioHora)} />
            </dl>

            <ul className="flex flex-col gap-1 border-t border-borde pt-2 text-sm">
              {Object.entries(mes.porModalidad).map(([modalidad, datos]) => (
                <Linea
                  key={modalidad}
                  texto={ETIQUETAS[modalidad as Modalidad] ?? modalidad}
                  detalle={`${datos.horas} h`}
                  importe={euros(datos.facturacion)}
                />
              ))}
              {mes.clasesLidomare > 0 && (
                <Linea
                  texto="CrossFit Lidomare"
                  detalle={`${mes.clasesLidomare} clases`}
                  importe={euros(mes.facturacionLidomare)}
                />
              )}
              {mes.sesionesKids > 0 && (
                <Linea
                  texto="CrossFit Kids"
                  detalle={`${mes.sesionesKids} clases`}
                  importe={mes.facturacionKids === null ? "sin importe" : euros(mes.facturacionKids)}
                />
              )}
              {/* Los ajustes se ven como línea propia con su motivo: la
                  diferencia nunca queda escondida dentro del total. */}
              {mes.ajustes.map((ajuste) => (
                <Linea
                  key={ajuste.origen}
                  texto="Ajuste"
                  detalle={ajuste.motivo}
                  importe={euros(ajuste.importe)}
                />
              ))}
            </ul>

            {mes.sesionesKids > 0 && (
              <form action={accion} className="flex flex-col gap-2 border-t border-borde pt-3">
                <input type="hidden" name="anio" value={mes.anio} />
                <input type="hidden" name="mes" value={mes.mes} />
                <label className="etiqueta" htmlFor={`kids-${mes.anio}-${mes.mes}`}>
                  Facturación de CrossFit Kids de este mes (€)
                </label>
                <div className="flex gap-2">
                  <input
                    id={`kids-${mes.anio}-${mes.mes}`}
                    name="importe"
                    inputMode="decimal"
                    defaultValue={mes.facturacionKids ?? ""}
                    className="campo"
                  />
                  <Guardar />
                </div>
                <p className="text-xs text-tinta-suave">
                  Se reparte entre las {mes.sesionesKids} clases de este mes.
                </p>
              </form>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}

function Cifra({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{titulo}</dt>
      <dd className="text-lg font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

function Linea({ texto, detalle, importe }: { texto: string; detalle: string; importe: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="min-w-0">
        <span className="font-medium">{texto}</span>
        <span className="ml-1 text-xs text-tinta-suave">{detalle}</span>
      </span>
      <span className="shrink-0 tabular-nums">{importe}</span>
    </li>
  );
}

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-tarjeta bg-acento px-4 text-sm font-medium text-white transition hover:bg-acento-oscuro disabled:opacity-60"
    >
      {pending ? "…" : "Guardar"}
    </button>
  );
}
