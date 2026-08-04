"use client";

import { Check, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * El botón con el que el cliente confirma su sesión de hoy.
 *
 * **Solo aparece si Fernando ya ha firmado una sesión hoy.** Si no ha firmado
 * nada, no hay nada que confirmar y no se enseña ningún botón — así el cliente
 * no puede crear una sesión que no existe.
 */
export function ConfirmarSesion({
  token,
  pendientes,
  confirmadas,
}: {
  token: string;
  pendientes: number;
  confirmadas: Array<{ hora: string }>;
}) {
  const parametros = useSearchParams();
  const acabaDeConfirmar = parametros.get("confirmado");
  const [enviando, setEnviando] = useState(false);

  if (pendientes === 0) {
    return (
      <section className="tarjeta flex flex-col gap-2 text-center" aria-label="Confirmar sesión">
        {confirmadas.length > 0 ? (
          <>
            <CheckCircle2 className="mx-auto h-6 w-6 text-acento" aria-hidden />
            <p className="text-sm font-medium text-acento-oscuro">
              {confirmadas.length === 1
                ? `Sesión confirmada hoy a las ${confirmadas[0]!.hora}`
                : `${confirmadas.length} sesiones confirmadas hoy`}
            </p>
            <p className="text-xs text-tinta-suave">Gracias. No hace falta que hagas nada más.</p>
          </>
        ) : (
          <p className="text-sm text-tinta-suave">
            Hoy no tienes ninguna sesión registrada todavía.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Confirmar sesión">
      {acabaDeConfirmar === "ya" && (
        <p role="status" className="rounded-tarjeta bg-acento/10 px-3 py-2 text-sm text-acento-oscuro">
          Esa sesión ya estaba confirmada.
        </p>
      )}
      {/* Un formulario normal: funciona aunque el JavaScript no cargue. */}
      <form action={`/mi/${token}/confirmar`} method="post" onSubmit={() => setEnviando(true)}>
        <button type="submit" className="boton" disabled={enviando}>
          <Check className="h-5 w-5" aria-hidden />
          {enviando ? "Confirmando…" : "Confirmar mi sesión de hoy"}
        </button>
      </form>
      <p className="text-center text-xs text-tinta-suave">
        Confirmar no cambia tu bono ni tu historial: solo deja constancia de que la sesión es correcta.
      </p>
    </section>
  );
}
