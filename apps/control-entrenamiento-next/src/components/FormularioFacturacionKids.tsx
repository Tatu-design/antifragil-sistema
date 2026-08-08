"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionFacturacionKids } from "@/app/actions";

/**
 * Introducir lo facturado por CrossFit Kids en un mes.
 *
 * Dos pasos a propósito: se escribe el importe, se ve **a cuánto sale cada
 * clase** y solo entonces se guarda. Ese número es el que acabará en Economía
 * como precio por hora, así que conviene mirarlo antes y no después.
 *
 * El cálculo del avance se hace aquí mismo con lo que ya sabemos —el número
 * de clases del mes— sin pedirle nada al servidor: es una división.
 */
export function FormularioFacturacionKids({
  anio,
  mes,
  sesiones,
  etiquetaMes,
}: {
  anio: number;
  mes: number;
  sesiones: number;
  etiquetaMes: string;
}) {
  const [importe, setImporte] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, accion] = useActionState(accionFacturacionKids, null);

  const numero = Number(importe.replace(",", "."));
  const valido = Number.isFinite(numero) && numero > 0;
  const porClase = valido && sesiones > 0 ? numero / sesiones : null;

  if (resultado?.ok) {
    return (
      <>
        <div className="aviso-guardado">✔ {resultado.mensaje}</div>
        <Link className="boton" href="/clases/kids">
          Volver a CrossFit Kids
        </Link>
      </>
    );
  }

  return (
    <form action={accion} className="formulario">
      <input type="hidden" name="anio" value={anio} />
      <input type="hidden" name="mes" value={mes} />

      <label className="campo">
        <span>Facturación total de CrossFit Kids</span>
        <input
          type="text"
          inputMode="decimal"
          name="importe"
          value={importe}
          onChange={(evento) => {
            setImporte(evento.target.value);
            setConfirmando(false);
          }}
          placeholder="450"
          autoFocus
          required
        />
        <span className="meta">Lo que has cobrado este mes en total, no por clase.</span>
      </label>

      {resultado && !resultado.ok && <div className="aviso-error">{resultado.mensaje}</div>}

      {confirmando && valido ? (
        <>
          {/* La confirmación: los cuatro datos que importan, antes de guardar. */}
          <div className="lista">
            <div className="cabecera-seccion">
              <span>Vas a guardar esto</span>
            </div>
            <div className="fila">
              <dl className="datos-servicio">
                <div>
                  <dt>Mes</dt>
                  <dd>{etiquetaMes}</dd>
                </div>
                <div>
                  <dt>Clases registradas</dt>
                  <dd>{sesiones}</dd>
                </div>
                <div>
                  <dt>Facturación total</dt>
                  <dd>{formatear(numero)} €</dd>
                </div>
                <div>
                  <dt>Sale a</dt>
                  <dd className="acumulado">{formatear(porClase ?? 0)} €/hora</dd>
                </div>
              </dl>
            </div>
          </div>

          <BotonGuardar />
          <button
            type="button"
            className="boton-secundario"
            style={{ width: "100%", marginTop: "0.65rem" }}
            onClick={() => setConfirmando(false)}
          >
            Cambiar el importe
          </button>
        </>
      ) : (
        <button
          type="button"
          className="boton"
          disabled={!valido}
          onClick={() => setConfirmando(true)}
        >
          Revisar antes de guardar
        </button>
      )}
    </form>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Guardando…" : "Guardar facturación"}
    </button>
  );
}

function formatear(valor: number): string {
  return valor.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
