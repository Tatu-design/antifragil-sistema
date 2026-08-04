"use client";

import { Minus, Plus } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionDeshacerClase, accionRegistrarClase, type Resultado } from "@/app/actions";
import type { TipoClase } from "@/domain/economia";
import { Aviso } from "./Aviso";

const NOMBRES: Record<TipoClase, string> = {
  lidomare: "CrossFit Lidomare",
  kids: "CrossFit Kids",
};

/**
 * Las clases de grupo no son de ningún cliente concreto, así que se cuentan
 * aquí y no en una ficha.
 *
 * Cada clase se guarda por separado, no como un contador: por eso se puede
 * deshacer un toque de más.
 */
export function ClasesDeGrupo({ clases }: { clases: Record<TipoClase, number> }) {
  const [resultado, accionSumar] = useActionState<Resultado | null, FormData>(accionRegistrarClase, null);
  const [resDeshacer, accionQuitar] = useActionState<Resultado | null, FormData>(accionDeshacerClase, null);

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Clases de grupo">
      <h2 className="font-medium">Clases de grupo</h2>

      {(["lidomare", "kids"] as TipoClase[]).map((tipo) => (
        <div key={tipo} className="flex items-center justify-between gap-2 border-t border-borde pt-3 first:border-0 first:pt-0">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{NOMBRES[tipo]}</span>
            <span className="block text-xs text-tinta-suave">
              {clases[tipo]} esta semana
              {tipo === "kids" && " · se factura al acabar el mes"}
            </span>
          </span>
          <span className="flex shrink-0 gap-2">
            <form action={accionQuitar}>
              <input type="hidden" name="tipo" value={tipo} />
              <BotonQuitar nombre={NOMBRES[tipo]} />
            </form>
            <form action={accionSumar}>
              <input type="hidden" name="tipo" value={tipo} />
              <BotonSumar nombre={NOMBRES[tipo]} />
            </form>
          </span>
        </div>
      ))}

      <Aviso resultado={resultado} />
      <Aviso resultado={resDeshacer} />
    </section>
  );
}

function BotonSumar({ nombre }: { nombre: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Sumar una clase de ${nombre} hoy`}
      className="flex h-11 w-11 items-center justify-center rounded-tarjeta bg-acento text-white transition hover:bg-acento-oscuro disabled:opacity-60"
    >
      <Plus className="h-5 w-5" aria-hidden />
    </button>
  );
}

function BotonQuitar({ nombre }: { nombre: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Deshacer la última clase de ${nombre}`}
      className="flex h-11 w-11 items-center justify-center rounded-tarjeta border border-borde text-tinta-suave transition hover:border-acento hover:text-acento disabled:opacity-60"
    >
      <Minus className="h-5 w-5" aria-hidden />
    </button>
  );
}
