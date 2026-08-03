"use client";

export default function ErrorGlobal({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-xl font-semibold">Algo ha fallado</h1>
      <p className="text-sm text-tinta-suave">
        No se ha guardado nada. Puedes intentarlo otra vez.
      </p>
      <button type="button" onClick={reset} className="boton max-w-xs">
        Reintentar
      </button>
    </main>
  );
}
