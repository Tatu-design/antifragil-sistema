"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionConfigurarServicio, type Resultado } from "@/app/actions";
import { BONO, CUENTA, ETIQUETAS, MENSUALIDAD, MODALIDADES, type Modalidad } from "@/domain/modalidades";
import type { FichaServicio } from "@/domain/tipos";
import { Aviso } from "./Aviso";

function Guardar({ cierraCiclo }: { cierraCiclo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cierraCiclo ? "boton" : "boton-suave"} disabled={pending}>
      {pending ? "Guardando…" : cierraCiclo ? "Cerrar el actual y empezar el nuevo" : "Guardar condiciones"}
    </button>
  );
}

/**
 * Editar programa.
 *
 * Dos cosas muy distintas según lo que se cambie, y la pantalla lo dice con
 * números concretos ANTES de tocar nada:
 *
 * - Corregir las condiciones del servicio actual (mismo tipo).
 * - Cambiar de tipo, que **cierra** el servicio en curso y abre otro.
 *
 * Lo segundo no se puede deshacer, así que se avisa en vez de dejar que
 * ocurra en silencio.
 */
export function EditarServicio({
  clienteId,
  ficha,
}: {
  clienteId: string;
  ficha: FichaServicio;
}) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionConfigurarServicio, null);
  const [abierto, setAbierto] = useState(!ficha.completo);
  const [modalidad, setModalidad] = useState<Modalidad>(ficha.modalidad);

  const cambiaDeTipo = modalidad !== ficha.modalidad;

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Editar programa">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="text-left text-sm font-medium hover:text-acento"
      >
        Editar programa {abierto ? "▴" : "▾"}
      </button>

      {abierto && (
        <form action={accion} className="flex flex-col gap-3">
          <input type="hidden" name="clienteId" value={clienteId} />

          <div>
            <label className="etiqueta" htmlFor="modalidad-editar">
              Tipo de servicio
            </label>
            <select
              id="modalidad-editar"
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

          {cambiaDeTipo && (
            <p className="rounded-tarjeta border border-aviso/30 bg-aviso/10 px-3 py-2 text-sm text-aviso">
              Vas a pasar de <strong>{ETIQUETAS[ficha.modalidad]}</strong> a{" "}
              <strong>{ETIQUETAS[modalidad]}</strong>. El servicio actual se cerrará con sus{" "}
              {ficha.sesionesHechas} {ficha.sesionesHechas === 1 ? "sesión" : "sesiones"} y empezará uno
              nuevo desde cero. Las sesiones ya hechas no se mueven ni cambian de precio.
            </p>
          )}

          <div>
            <label className="etiqueta" htmlFor="servicio-editar">
              Nombre del servicio
            </label>
            <input
              id="servicio-editar"
              name="servicio"
              maxLength={80}
              defaultValue={cambiaDeTipo ? "" : (ficha.servicio ?? "")}
              placeholder={ETIQUETAS[modalidad]}
              className="campo"
            />
          </div>

          {modalidad === BONO && (
            <>
              <div>
                <label className="etiqueta" htmlFor="sesionesTotales-editar">
                  Sesiones del bono
                </label>
                <input
                  id="sesionesTotales-editar"
                  name="sesionesTotales"
                  inputMode="numeric"
                  required
                  defaultValue={cambiaDeTipo ? "" : (ficha.sesionesTotales ?? "")}
                  className="campo"
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="precioTotal-editar">
                  Precio total del bono (€)
                </label>
                <input
                  id="precioTotal-editar"
                  name="precioTotal"
                  inputMode="decimal"
                  required
                  defaultValue={cambiaDeTipo ? "" : (ficha.precioTotal ?? "")}
                  className="campo"
                />
              </div>
            </>
          )}

          {modalidad === MENSUALIDAD && (
            <>
              <div>
                <label className="etiqueta" htmlFor="cuotaMensual-editar">
                  Cuota mensual (€)
                </label>
                <input
                  id="cuotaMensual-editar"
                  name="cuotaMensual"
                  inputMode="decimal"
                  required
                  defaultValue={cambiaDeTipo ? "" : (ficha.cuotaMensual ?? "")}
                  className="campo"
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="sesionesReferencia-editar">
                  Sesiones previstas al mes (opcional)
                </label>
                <input
                  id="sesionesReferencia-editar"
                  name="sesionesReferencia"
                  inputMode="numeric"
                  defaultValue={cambiaDeTipo ? "" : (ficha.sesionesReferencia ?? "")}
                  className="campo"
                />
              </div>
            </>
          )}

          {modalidad === CUENTA && (
            <div>
              <label className="etiqueta" htmlFor="tarifa-editar">
                Precio por sesión (€)
              </label>
              <input
                id="tarifa-editar"
                name="tarifa"
                inputMode="decimal"
                required
                defaultValue={cambiaDeTipo ? "" : (ficha.tarifa ?? "")}
                className="campo"
              />
            </div>
          )}

          <p className="text-xs text-tinta-suave">
            Cambiar el precio no reescribe las sesiones ya firmadas: cada una conserva el suyo.
          </p>

          <Aviso resultado={resultado} />
          <Guardar cierraCiclo={cambiaDeTipo} />
        </form>
      )}
    </section>
  );
}
