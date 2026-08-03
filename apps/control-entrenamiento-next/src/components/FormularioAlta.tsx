"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionCrearCliente, type Resultado } from "@/app/actions";
import { BONO, CUENTA, ETIQUETAS, MENSUALIDAD, MODALIDADES, type Modalidad } from "@/domain/modalidades";
import { Aviso } from "./Aviso";

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Creando…" : "Crear cliente"}
    </button>
  );
}

/**
 * Alta de cliente.
 *
 * Solo se piden los campos que SU modalidad necesita: un bono no lleva cuota
 * mensual y una cuenta no lleva tope de sesiones. La validación de verdad está
 * en el servidor (`validarCondiciones`); esto solo evita enseñar campos que no
 * tienen sentido.
 */
export function FormularioAlta() {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionCrearCliente, null);
  const [modalidad, setModalidad] = useState<Modalidad>(BONO);

  return (
    <form action={accion} className="tarjeta flex flex-col gap-3">
      <div>
        <label className="etiqueta" htmlFor="nombre">
          Nombre
        </label>
        <input id="nombre" name="nombre" required maxLength={80} autoFocus className="campo" />
      </div>

      <div>
        <label className="etiqueta" htmlFor="modalidad">
          Modalidad
        </label>
        <select
          id="modalidad"
          name="modalidad"
          value={modalidad}
          onChange={(e) => setModalidad(e.target.value as Modalidad)}
          className="campo"
        >
          {MODALIDADES.map((valor) => (
            <option key={valor} value={valor}>
              {ETIQUETAS[valor]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="etiqueta" htmlFor="servicio">
          Nombre del servicio
        </label>
        <input
          id="servicio"
          name="servicio"
          maxLength={80}
          placeholder={modalidad === BONO ? "Bono 8 sesiones" : ETIQUETAS[modalidad]}
          className="campo"
        />
      </div>

      {modalidad === BONO && (
        <>
          <div>
            <label className="etiqueta" htmlFor="sesionesTotales">
              Sesiones del bono
            </label>
            <input
              id="sesionesTotales"
              name="sesionesTotales"
              inputMode="numeric"
              required
              className="campo"
            />
          </div>
          <div>
            <label className="etiqueta" htmlFor="precioTotal">
              Precio total del bono (€)
            </label>
            <input id="precioTotal" name="precioTotal" inputMode="decimal" required className="campo" />
            <p className="mt-1 text-xs text-tinta-suave">
              El precio por sesión se calcula solo, para que no pueda contradecir al total.
            </p>
          </div>
        </>
      )}

      {modalidad === MENSUALIDAD && (
        <>
          <div>
            <label className="etiqueta" htmlFor="cuotaMensual">
              Cuota mensual (€)
            </label>
            <input id="cuotaMensual" name="cuotaMensual" inputMode="decimal" required className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="sesionesReferencia">
              Sesiones previstas al mes (opcional)
            </label>
            <input id="sesionesReferencia" name="sesionesReferencia" inputMode="numeric" className="campo" />
            <p className="mt-1 text-xs text-tinta-suave">
              Solo orientativas: la cuota se factura entera aunque se hagan más o menos.
            </p>
          </div>
        </>
      )}

      {modalidad === CUENTA && (
        <div>
          <label className="etiqueta" htmlFor="tarifa">
            Precio por sesión (€)
          </label>
          <input id="tarifa" name="tarifa" inputMode="decimal" required className="campo" />
          <p className="mt-1 text-xs text-tinta-suave">
            Sin tope de sesiones: se cobra al final por lo realmente hecho.
          </p>
        </div>
      )}

      <Aviso resultado={resultado} />
      <Boton />
    </form>
  );
}
