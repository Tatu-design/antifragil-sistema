"use client";

import { Copy, QrCode } from "lucide-react";
import { useState } from "react";

/**
 * El enlace personal del cliente y su código QR.
 *
 * El QR lleva a la dirección de confirmación, así que Fernando se lo enseña
 * justo después de firmar y el cliente confirma con solo escanearlo — sin
 * tener que pulsar nada ni entrar por su cuenta más tarde.
 *
 * El QR se genera en el servidor y llega ya dibujado: no se carga ninguna
 * librería en el navegador para esto.
 */
export function EnlaceDelCliente({ enlace, qr }: { enlace: string; qr: string }) {
  const [copiado, setCopiado] = useState(false);
  const [verQr, setVerQr] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Algunos navegadores no dejan copiar sin interacción directa. En ese
      // caso se enseña el enlace para copiarlo a mano, en vez de fingir que
      // ha funcionado.
      setVerQr(true);
    }
  }

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Enlace del cliente">
      <div className="flex gap-2">
        <button type="button" onClick={copiar} className="boton-suave">
          <Copy className="h-4 w-4" aria-hidden />
          {copiado ? "Copiado" : "Copiar enlace"}
        </button>
        <button
          type="button"
          onClick={() => setVerQr((v) => !v)}
          aria-expanded={verQr}
          className="boton-suave"
        >
          <QrCode className="h-4 w-4" aria-hidden />
          {verQr ? "Ocultar QR" : "Ver QR"}
        </button>
      </div>

      {verQr && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- es un
              dato incrustado, no un archivo que optimizar */}
          <img src={qr} alt="Código QR para que el cliente confirme su sesión" className="h-48 w-48" />
          <p className="text-center text-xs text-tinta-suave">
            Enséñaselo después de firmarle la sesión: al escanearlo la confirma.
          </p>
          <p className="break-all text-center text-xs text-tinta-suave">{enlace}</p>
        </div>
      )}
    </section>
  );
}
