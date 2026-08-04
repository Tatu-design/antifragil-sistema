"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionResolverAviso, accionResolverTipo, type Resultado } from "@/app/actions";
import type { Aviso } from "@/repositories";
import { etiquetaAviso } from "@/domain/avisos";
import { fechaEs } from "@/lib/fechas";
import { Aviso as Mensaje } from "./Aviso";

/**
 * La bandeja de avisos.
 *
 * Se agrupan por tipo y cada grupo se puede descartar entero: un mismo motivo
 * puede generar muchos avisos seguidos, y limpiarlos de uno en uno es
 * inviable — le pasó a Fernando con 28 de golpe.
 */
export function ListaAvisos({ avisos }: { avisos: Aviso[] }) {
  const [resUno, resolverUno] = useActionState<Resultado | null, FormData>(accionResolverAviso, null);
  const [resTipo, resolverTipo] = useActionState<Resultado | null, FormData>(accionResolverTipo, null);

  if (avisos.length === 0) {
    return (
      <section className="tarjeta text-center text-sm text-tinta-suave">
        No hay ningún aviso pendiente.
      </section>
    );
  }

  const tipos = [...new Set(avisos.map((a) => a.tipo))];

  return (
    <section className="flex flex-col gap-3" aria-label="Avisos pendientes">
      <Mensaje resultado={resUno} />
      <Mensaje resultado={resTipo} />

      {tipos.map((tipo) => {
        const suyos = avisos.filter((a) => a.tipo === tipo);
        return (
          <div key={tipo} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">
                {etiquetaAviso(tipo)} <span className="text-tinta-suave">({suyos.length})</span>
              </h2>
              {suyos.length > 1 && (
                <form action={resolverTipo}>
                  <input type="hidden" name="tipo" value={tipo} />
                  <BotonTexto texto="Descartar todos" />
                </form>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {suyos.map((aviso) => (
                <li key={aviso.id} className="tarjeta flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm">{aviso.detalle}</span>
                    <span className="block text-xs text-tinta-suave">{fechaEs(aviso.fecha)}</span>
                  </span>
                  <form action={resolverUno} className="shrink-0">
                    <input type="hidden" name="id" value={aviso.id} />
                    <BotonTexto texto="Descartar" />
                  </form>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function BotonTexto({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-tarjeta border border-borde px-3 py-1 text-xs font-medium transition hover:border-acento hover:text-acento disabled:opacity-60"
    >
      {pending ? "…" : texto}
    </button>
  );
}
