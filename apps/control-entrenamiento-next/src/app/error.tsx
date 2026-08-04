"use client";

export default function ErrorGlobal({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page sin-barra">
      <h1>Algo ha fallado</h1>
      <p className="subtitulo">No se ha guardado nada. Puedes intentarlo otra vez.</p>
      <button type="button" onClick={reset} className="boton">
        Reintentar
      </button>
    </div>
  );
}
