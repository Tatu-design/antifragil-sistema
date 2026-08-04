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
}: {
  clienteId: string;
  nombre: string;
  estado: Estado;
}) {
  const [valores, setValores] = useState({ nombre, estado });
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
      </div>

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
