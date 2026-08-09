"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { accionCrearCliente } from "@/app/actions";
import { ETIQUETAS } from "@/domain/modalidades";
import { CamposServicio, detalleServicio, valoresIniciales, type ValoresServicio } from "./CamposServicio";

/**
 * Alta de cliente y su confirmación, juntas.
 *
 * Es la unión de `webapp/templates/nuevo.html` y `confirmar_nuevo.html`. La
 * diferencia con Flask está en los campos del servicio: allí se elegía un
 * programa de un catálogo, aquí se describen las condiciones igual que en
 * «Editar programa» — el catálogo de programas no existe en el modelo nuevo.
 */
export function FormularioAlta({
  profesionales = [],
  porDefecto = "",
}: {
  /** Quiénes pueden llevarlo. Solo llega si hay más de uno. */
  profesionales?: Array<{ id: string; nombre: string }>;
  /** El administrador que está dando de alta: lo normal es que sea suyo. */
  porDefecto?: string;
}) {
  const [nombre, setNombre] = useState("");
  const [servicio, setServicio] = useState<ValoresServicio>(valoresIniciales());
  const [profesionalId, setEntrenadorId] = useState(porDefecto);
  const [revisando, setRevisando] = useState(false);

  // Con un solo profesional no hay nada que elegir: el campo sobra.
  const hayQueElegir = profesionales.length > 1;
  const responsable = profesionales.find((p) => p.id === profesionalId)?.nombre ?? "—";

  if (!revisando) {
    return (
      <>
        <h1>Nuevo cliente</h1>

        <form
          className="formulario"
          onSubmit={(evento) => {
            evento.preventDefault();
            setRevisando(true);
          }}
        >
          <label className="campo">
            <span>Nombre</span>
            <input
              type="text"
              name="nombre"
              required
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>

          {hayQueElegir && (
            <label className="campo">
              <span>Profesional</span>
              <select value={profesionalId} onChange={(e) => setEntrenadorId(e.target.value)}>
                {profesionales.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          <CamposServicio valores={servicio} alCambiar={setServicio} />

          <button type="submit" className="boton">
            Revisar y crear
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Confirmar cliente nuevo</h1>
      <p className="subtitulo">Todavía no se ha guardado nada. Revisa:</p>

      <div className="lista comparativa">
        <div className="fila">
          <span className="etiqueta">Nombre</span>
          <span className="despues">{nombre}</span>
        </div>
        <div className="fila">
          <span className="etiqueta">Modalidad</span>
          <span className="despues">{ETIQUETAS[servicio.modalidad]}</span>
        </div>
        <div className="fila">
          <span className="etiqueta">Servicio</span>
          <span className="despues">{servicio.servicio || ETIQUETAS[servicio.modalidad]}</span>
        </div>
        <div className="fila">
          <span className="etiqueta">Condiciones</span>
          <span className="despues">{detalleServicio(servicio)}</span>
        </div>
        {hayQueElegir && (
          <div className="fila">
            <span className="etiqueta">Profesional</span>
            <span className="despues">{responsable}</span>
          </div>
        )}
      </div>

      {servicio.modalidad === "mensualidad" && (
        <p className="aviso-texto">
          La cuota de este mes se registrará entera en la Economía en cuanto guardes, aunque todavía no se
          haya entrenado. Quedará pendiente de pago hasta que la marques como pagada.
        </p>
      )}

      <form action={accionCrearCliente}>
        <input type="hidden" name="nombre" value={nombre} />
        <input type="hidden" name="modalidad" value={servicio.modalidad} />
        <input type="hidden" name="servicio" value={servicio.servicio} />
        <input type="hidden" name="sesionesTotales" value={servicio.sesionesTotales} />
        <input type="hidden" name="precioTotal" value={servicio.precioTotal} />
        <input type="hidden" name="cuotaMensual" value={servicio.cuotaMensual} />
        <input type="hidden" name="sesionesReferencia" value={servicio.sesionesReferencia} />
        <input type="hidden" name="tarifa" value={servicio.tarifa} />
        <input type="hidden" name="profesionalId" value={profesionalId} />
        <Crear />
      </form>

      <button
        type="button"
        className="boton-secundario"
        style={{ width: "100%", marginTop: "0.65rem" }}
        onClick={() => setRevisando(false)}
      >
        Cancelar
      </button>
    </>
  );
}

function Crear() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Creando…" : "Confirmar y crear"}
    </button>
  );
}
