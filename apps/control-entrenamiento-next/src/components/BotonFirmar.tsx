"use client";

import { Check } from "lucide-react";
import { useActionState, useId } from "react";
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

export function BotonFirmar({ clienteId, ficha }: { clienteId: string; ficha: FichaServicio }) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionFirmar, null);
  // Segunda capa: un valor de un solo uso por carga de página. Si la red
  // reintenta, o hay dos pestañas abiertas, la misma petición no se guarda dos
  // veces. Recargar genera otro, así que una segunda sesión real sí se puede
  // firmar.
  const clave = useId();

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
        <input type="hidden" name="claveIdempotencia" value={`${clienteId}:${clave}`} />
        <Boton />
      </form>
      <Aviso resultado={resultado} />
    </section>
  );
}
