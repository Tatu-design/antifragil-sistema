"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Icono } from "./Iconos";

/**
 * Copiar el enlace del cliente y, cuando toca, el QR de confirmación.
 *
 * Mismo comportamiento que el `<script>` de `webapp/templates/perfil_cliente.html`:
 * el texto del botón cambia a «✓ Enlace copiado» dos segundos, y el QR aparece
 * solo justo después de firmar y mientras la sesión siga sin confirmar —
 * confirmar es algo que pasa delante de Fernando, no algo que el cliente haga
 * por su cuenta más tarde (decisión del 2026-07-29).
 */
export function EnlaceYQr({
  nombre,
  enlace,
  qr,
  mostrarQr,
  confirmadas,
}: {
  nombre: string;
  enlace: string;
  qr: string;
  mostrarQr: boolean;
  confirmadas: Array<{ hora: string }>;
}) {
  const [copiado, setCopiado] = useState(false);
  const [verQr, setVerQr] = useState(mostrarQr);
  const campo = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!verQr) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVerQr(false);
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [verQr]);

  async function copiar() {
    // `navigator.clipboard` no existe sin HTTPS ni en navegadores antiguos, así
    // que hay un plan B con un campo de texto — funciona también en Safari de
    // iPhone.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(enlace);
      } else {
        alaAntigua();
      }
    } catch {
      alaAntigua();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  function alaAntigua() {
    const area = campo.current;
    if (!area) return;
    area.select();
    area.setSelectionRange(0, area.value.length); // iOS lo necesita
    try {
      document.execCommand("copy");
    } catch {
      /* nada que hacer */
    }
  }

  return (
    <>
      <button type="button" className={`boton-secundario boton-copiar${copiado ? " copiado" : ""}`} onClick={copiar}>
        <Icono nombre="i-link" pequeno />
        <span>{copiado ? "✓ Enlace copiado" : "Copiar enlace del cliente"}</span>
      </button>
      <textarea
        ref={campo}
        readOnly
        value={enlace}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: "fixed", top: "-1000px" }}
      />

      {verQr ? (
        <div
          className="qr-fondo"
          role="dialog"
          aria-modal="true"
          aria-label="Código QR del cliente"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVerQr(false);
          }}
        >
          <div className="qr-dialogo">
            <p className="qr-dialogo-titulo">{nombre}</p>
            <p className="qr-dialogo-cliente">Escanea para firmar tu sesión</p>
            <div className="qr-marco">
              {/* eslint-disable-next-line @next/next/no-img-element -- es un
                  dato incrustado, no un archivo que optimizar */}
              <img src={qr} alt="Código QR para confirmar la sesión" width={190} height={190} />
            </div>
            <button type="button" className="qr-cerrar" onClick={() => setVerQr(false)}>
              Cerrar
            </button>
          </div>
        </div>
      ) : confirmadas.length > 0 ? (
        <div className="qr-confirmado">
          <span>✓</span>
          <span>
            Confirmada{confirmadas.length > 1 ? "s" : ""} hoy a las{" "}
            {[...confirmadas].reverse().map((c) => c.hora).join(", ")}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** Primera capa anti-duplicado: el botón se apaga y cambia de texto nada más
 *  pulsarlo, igual que el `onsubmit` de la plantilla. */
export function BotonFirmar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-firmar" disabled={pending}>
      {pending ? "Guardando…" : "✓ Firmar sesión"}
    </button>
  );
}
