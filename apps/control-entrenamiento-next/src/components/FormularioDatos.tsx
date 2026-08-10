"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { accionGuardarDatos } from "@/app/actions";
import { ESTADOS, type Estado } from "@/domain/tipos";

const mayuscula = (texto: string) => texto[0]!.toUpperCase() + texto.slice(1);

/**
 * Editar datos y su confirmación, juntas.
 *
 * Es la unión de `webapp/templates/editar_datos.html` y `confirmar.html`:
 * mismos campos, misma comparativa «antes → después» y los mismos avisos antes
 * de guardar.
 */
export function FormularioDatos({
  clienteId,
  nombre,
  estado,
  profesionalId = "",
  profesionales = [],
}: {
  clienteId: string;
  nombre: string;
  estado: Estado;
  /** Quién lo lleva ahora. */
  profesionalId?: string | null;
  /**
   * Entre quiénes se puede elegir. Llega vacío para un entrenador: cambiar de
   * profesional es traspasar un cliente, y eso lo decide el administrador.
   */
  profesionales?: Array<{ id: string; nombre: string }>;
}) {
  const [valores, setValores] = useState({ nombre, estado, profesionalId: profesionalId ?? "" });
  const puedeTraspasar = profesionales.length > 1;
  const comoSeLlama = (id: string) => profesionales.find((p) => p.id === id)?.nombre ?? "sin asignar";
  const [revisando, setRevisando] = useState(false);

  if (!revisando) {
    return (
      <>
        <h1>Editar datos</h1>
        <p className="subtitulo">Quién es el cliente y en qué situación está. El bono se edita aparte.</p>

        <form
          className="formulario"
          onSubmit={(evento) => {
            evento.preventDefault();
            setRevisando(true);
          }}
        >
          <label className="campo">
            <span>Nombre del cliente</span>
            <input
              type="text"
              name="nombre"
              required
              value={valores.nombre}
              onChange={(e) => setValores({ ...valores, nombre: e.target.value })}
            />
          </label>

          <label className="campo">
            <span>Estado del cliente</span>
            <select
              name="estado"
              value={valores.estado}
              onChange={(e) => setValores({ ...valores, estado: e.target.value as Estado })}
            >
              {ESTADOS.map((opcion) => (
                <option value={opcion} key={opcion}>
                  {mayuscula(opcion)}
                </option>
              ))}
            </select>
            <span className="meta">
              Pausado o cancelado archiva al cliente sin perder nada: conserva bono, sesiones, historial,
              deuda y su enlace personal. Puede volver a activo cuando quieras.
            </span>
          </label>

          {puedeTraspasar && (
            <label className="campo">
              <span>Profesional</span>
              <select
                value={valores.profesionalId}
                onChange={(e) => setValores({ ...valores, profesionalId: e.target.value })}
              >
                {profesionales.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <span className="meta">
                Cambiarlo traspasa el cliente: pasará a verlo el profesional nuevo y dejará de verlo el
                anterior. No se pierde nada — bono, sesiones, historial y enlace personal siguen igual.
              </span>
            </label>
          )}

          <button type="submit" className="boton">
            Revisar cambios
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1>Confirmar cambios</h1>
      <p className="subtitulo">Todavía no se ha guardado nada. Revisa:</p>

      <div className="lista comparativa">
        <div className="fila">
          <span className="etiqueta">Nombre</span>
          <span className="antes">{nombre}</span>
          <span className="flecha">→</span>
          <span className="despues">{valores.nombre}</span>
        </div>
        <div className="fila">
          <span className="etiqueta">Estado</span>
          <span className="antes">{mayuscula(estado)}</span>
          <span className="flecha">→</span>
          <span className="despues">{mayuscula(valores.estado)}</span>
        </div>
        {puedeTraspasar && (
          <div className="fila">
            <span className="etiqueta">Profesional</span>
            <span className="antes">{comoSeLlama(profesionalId ?? "")}</span>
            <span className="flecha">→</span>
            <span className="despues">{comoSeLlama(valores.profesionalId)}</span>
          </div>
        )}
      </div>

      {puedeTraspasar && (profesionalId ?? "") !== valores.profesionalId && (
        <p className="aviso-texto">
          ⚠ Vas a traspasar este cliente a {comoSeLlama(valores.profesionalId)}. Dejará de aparecer en la
          lista de {comoSeLlama(profesionalId ?? "")} y aparecerá en la suya, con todo su historial.
        </p>
      )}

      {estado !== valores.estado && valores.estado !== "activo" && (
        <p className="aviso-texto">
          ⚠ Al pasar a {valores.estado}, este cliente dejará de poder firmar sesiones. No se borra nada:
          conserva su ficha, su programa, sus sesiones, su historial y su enlace personal.
        </p>
      )}

      {nombre !== valores.nombre && (
        <p className="aviso-texto">
          ⚠ Vas a cambiar el nombre. Recuerda renombrar también las sesiones en Google Calendar.
        </p>
      )}

      <form action={accionGuardarDatos}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="nombre" value={valores.nombre} />
        <input type="hidden" name="estado" value={valores.estado} />
        <input type="hidden" name="profesionalId" value={valores.profesionalId} />
        <Guardar />
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

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Guardando…" : "Confirmar y guardar"}
    </button>
  );
}
