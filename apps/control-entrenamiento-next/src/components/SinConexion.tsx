import { DatabaseZap } from "lucide-react";

/**
 * Qué se ve cuando la base de datos no responde.
 *
 * Pasa de verdad: el plan gratuito de Supabase corta conexiones y a veces
 * tarda en volver. Sin esto salía un «Algo ha fallado» genérico que no dice
 * si el problema es tuyo, del código o del servidor.
 */
export function SinConexion() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <DatabaseZap className="h-8 w-8 text-tinta-suave" aria-hidden />
      <h1 className="text-xl font-semibold">No se puede conectar ahora mismo</h1>
      <p className="max-w-xs text-sm text-tinta-suave">
        La base de datos no responde. No es culpa tuya y no se ha perdido nada: vuelve a intentarlo en
        un minuto.
      </p>
      <p className="text-xs text-tinta-suave">
        Si sigue pasando un buen rato, dímelo y lo miro.
      </p>
    </main>
  );
}
