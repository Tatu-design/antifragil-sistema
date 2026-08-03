import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import type { Resultado } from "@/app/actions";

/** El resultado de una acción, dicho en una línea. Lleva `role="status"` para
 *  que un lector de pantalla lo anuncie sin tener que buscarlo. */
export function Aviso({ resultado }: { resultado: Resultado | null }) {
  if (!resultado) return null;

  const tono = resultado.tono ?? (resultado.ok ? "exito" : "error");
  const estilos = {
    exito: "border-acento/30 bg-acento/10 text-acento-oscuro",
    aviso: "border-aviso/30 bg-aviso/10 text-aviso",
    error: "border-red-300 bg-red-50 text-red-700",
  }[tono];
  const Icono = { exito: CheckCircle2, aviso: Info, error: AlertTriangle }[tono];

  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex items-start gap-2 rounded-tarjeta border px-3 py-2 text-sm ${estilos}`}
    >
      <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{resultado.mensaje}</span>
    </p>
  );
}
