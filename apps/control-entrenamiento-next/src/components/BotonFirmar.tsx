"use client";

import { Check } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionFirmar, type Resultado } from "@/app/actions";
import type { FichaServicio } from "@/domain/tipos";
import { Aviso } from "./Aviso";

function Boton() {
  // Primera capa anti-duplicado: el botón se apaga nada más pulsarlo, así un
  // doble toque físico no llega a mandar la segunda petición.
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      <Check className="h-5 w-5" aria-hidden />
      {pending ? "Firmando…" : "Firmar sesión"}
    </button>
  );
}

export function BotonFirmar({
  clienteId,
  ficha,
  clave,
}: {
  clienteId: string;
  ficha: FichaServicio;
  /** Valor de un solo uso, distinto en CADA carga de la página. Lo genera el
   *  servidor: `useId()` parecía servir pero devuelve siempre lo mismo, así
   *  que la segunda sesión de un cliente se tomaba por un duplicado y no se
   *  guardaba nunca. Encontrado probando el recorrido de punta a punta. */
  clave: string;
}) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionFirmar, null);

  if (!ficha.puedeFirmar) {
    return (
      <section className="tarjeta flex flex-col gap-2" aria-label="Firmar sesión">
        {ficha.estado !== "activo" ? (
          <p className="text-sm text-tinta-suave">
            Este cliente está <strong>{ficha.estado}</strong>. Reactívalo para poder firmarle sesiones.
          </p>
        ) : (
          <>
            <p className="text-sm text-tinta-suave">
              No se puede firmar todavía: falta <strong>{ficha.faltan.join(" y ")}</strong>.
            </p>
            <p className="text-xs text-tinta-suave">
              Rellénalo en «Editar programa», justo debajo.
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Firmar sesión">
      <form action={accion}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="claveIdempotencia" value={clave} />
        <Boton />
      </form>
      <Aviso resultado={resultado} />
    </section>
  );
}
