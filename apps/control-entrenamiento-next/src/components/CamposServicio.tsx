"use client";

import { ETIQUETAS, MODALIDADES, type Modalidad } from "@/domain/modalidades";

export interface ValoresServicio {
  modalidad: Modalidad;
  servicio: string;
  sesionesTotales: string;
  precioTotal: string;
  cuotaMensual: string;
  tarifa: string;
  sesionesReferencia: string;
}

/**
 * Los campos del servicio, tal cual `webapp/templates/editar.html`.
 *
 * Solo se ven los de la modalidad elegida, y el precio por sesión de un bono
 * no se pide: se calcula, para que no pueda contradecir al precio total.
 */
export function CamposServicio({
  valores,
  alCambiar,
}: {
  valores: ValoresServicio;
  alCambiar: (valores: ValoresServicio) => void;
}) {
  const poner = (campo: keyof ValoresServicio, valor: string) =>
    alCambiar({ ...valores, [campo]: valor });

  const n = Number(valores.sesionesTotales.replace(",", "."));
  const t = Number(valores.precioTotal.replace(",", "."));
  const calculado =
    n > 0 && t >= 0 && Number.isFinite(n) && Number.isFinite(t)
      ? `Sale a ${(t / n).toFixed(2).replace(".", ",")} € por sesión.`
      : "El precio por sesión se calcula solo.";

  return (
    <>
      {/* La modalidad va primero: de ella depende todo lo demás. */}
      <label className="campo">
        <span>Modalidad del servicio</span>
        <select
          name="modalidad"
          required
          value={valores.modalidad}
          onChange={(e) => poner("modalidad", e.target.value)}
        >
          {MODALIDADES.map((clave) => (
            <option value={clave} key={clave}>
              {ETIQUETAS[clave]}
            </option>
          ))}
        </select>
      </label>

      {valores.modalidad === "bono" && (
        <p className="meta ayuda-modalidad">
          El cliente paga por adelantado un paquete de sesiones. Cada sesión firmada descuenta una; al
          agotarse, se abre otro bono igual pendiente de pago.
        </p>
      )}
      {valores.modalidad === "mensualidad" && (
        <p className="meta ayuda-modalidad">
          El cliente paga una cuota fija cada mes por tener sus plazas reservadas. Haga las sesiones que
          haga, la factura del mes es la misma. Se renueva al cambiar de mes, nunca por sesiones.
        </p>
      )}
      {valores.modalidad === "cuenta" && (
        <p className="meta ayuda-modalidad">
          El cliente paga al final por las sesiones que realmente haya hecho, a un precio por hora. Sin
          tope de sesiones. El periodo se cierra al cambiar de mes.
        </p>
      )}

      <label className="campo">
        <span>
          Nombre del servicio <span className="meta">(opcional)</span>
        </span>
        <input
          type="text"
          name="servicio"
          maxLength={60}
          placeholder="p. ej. Bono 8 mañanas"
          value={valores.servicio}
          onChange={(e) => poner("servicio", e.target.value)}
        />
      </label>

      {valores.modalidad === "bono" && (
        <div className="campos-modalidad">
          <label className="campo">
            <span>Número de sesiones</span>
            <input
              type="number"
              name="sesionesTotales"
              min="1"
              step="1"
              value={valores.sesionesTotales}
              onChange={(e) => poner("sesionesTotales", e.target.value)}
            />
          </label>
          <label className="campo">
            <span>Precio total del bono (€)</span>
            <input
              type="number"
              name="precioTotal"
              min="0"
              step="0.01"
              value={valores.precioTotal}
              onChange={(e) => poner("precioTotal", e.target.value)}
            />
          </label>
          <p className="meta">{calculado}</p>
        </div>
      )}

      {valores.modalidad === "mensualidad" && (
        <div className="campos-modalidad">
          <label className="campo">
            <span>Cuota mensual (€)</span>
            <input
              type="number"
              name="cuotaMensual"
              min="0"
              step="0.01"
              value={valores.cuotaMensual}
              onChange={(e) => poner("cuotaMensual", e.target.value)}
            />
          </label>
          <label className="campo">
            <span>
              Sesiones al mes de referencia <span className="meta">(opcional)</span>
            </span>
            <input
              type="number"
              name="sesionesReferencia"
              min="0"
              step="1"
              value={valores.sesionesReferencia}
              onChange={(e) => poner("sesionesReferencia", e.target.value)}
            />
            <span className="meta">
              Solo informativo: no es un límite, no se consume y no provoca renovación.
            </span>
          </label>
        </div>
      )}

      {valores.modalidad === "cuenta" && (
        <div className="campos-modalidad">
          <label className="campo">
            <span>Precio por sesión (€)</span>
            <input
              type="number"
              name="tarifa"
              min="0"
              step="0.01"
              value={valores.tarifa}
              onChange={(e) => poner("tarifa", e.target.value)}
            />
          </label>
        </div>
      )}
    </>
  );
}

/** Los mismos valores, listos para leerlos con `useState`. */
export function valoresIniciales(parcial: Partial<ValoresServicio> = {}): ValoresServicio {
  return {
    modalidad: "bono",
    servicio: "",
    sesionesTotales: "",
    precioTotal: "",
    cuotaMensual: "",
    tarifa: "",
    sesionesReferencia: "",
    ...parcial,
  };
}

/** La línea que describe unas condiciones, para las pantallas de repaso. */
export function detalleServicio(v: ValoresServicio): string {
  const importe = (texto: string) => (texto ? `${Number(texto.replace(",", ".")).toFixed(2)} €` : "—");
  if (v.modalidad === "mensualidad") {
    const referencia = v.sesionesReferencia ? ` · ref. ${v.sesionesReferencia}` : "";
    return `Cuota ${importe(v.cuotaMensual)} al mes${referencia}`;
  }
  if (v.modalidad === "cuenta") return `${importe(v.tarifa)} por sesión · sin tope`;
  const porSesion =
    v.sesionesTotales && v.precioTotal
      ? ` · ${(Number(v.precioTotal.replace(",", ".")) / Number(v.sesionesTotales)).toFixed(2)} €/sesión`
      : "";
  return `${v.sesionesTotales || "—"} sesiones · ${importe(v.precioTotal)}${porSesion}`;
}
