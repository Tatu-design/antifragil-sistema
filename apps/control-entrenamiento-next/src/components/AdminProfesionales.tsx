"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionCambiarEstadoProfesional, accionCrearProfesional } from "@/app/actions";

/**
 * Dar de baja a un profesional, o volver a darle acceso.
 *
 * Dar de baja **no borra nada**: su histórico se queda entero y sus sesiones
 * siguen siendo suyas. Lo único que cambia es que deja de poder entrar y de
 * salir en la lista para asignarle clientes nuevos.
 *
 * Si todavía lleva clientes activos ni siquiera se ofrece: primero hay que
 * pasárselos a otro. Se dice aquí, antes de pulsar, en vez de dejar que lo
 * intente y le salte un error.
 */
export function EstadoProfesional({
  id,
  nombre,
  activo,
  clientesActivos,
}: {
  id: string;
  nombre: string;
  activo: boolean;
  clientesActivos: number;
}) {
  const [estado, enviar] = useActionState(accionCambiarEstadoProfesional, null);

  if (activo && clientesActivos > 0) {
    return (
      <p className="ficha-profesional-nota">
        Para quitarle el acceso, pásale antes sus clientes a otro profesional.
      </p>
    );
  }

  return (
    <form action={enviar} className="ficha-profesional-accion">
      <input type="hidden" name="profesionalId" value={id} />
      <input type="hidden" name="activo" value={activo ? "no" : "si"} />
      <BotonEstado activo={activo} nombre={nombre} />
      {estado && !estado.ok && (
        <p className="ficha-profesional-error" role="alert">
          {estado.mensaje}
        </p>
      )}
    </form>
  );
}

function BotonEstado({ activo, nombre }: { activo: boolean; nombre: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-texto" disabled={pending}>
      {pending ? "Guardando…" : activo ? "Quitar acceso" : "Devolver acceso"}
      <span className="solo-lectores"> a {nombre}</span>
    </button>
  );
}

/**
 * El alta de un profesional.
 *
 * Dos campos y ya. El rol no se pregunta porque no se elige: desde aquí solo
 * se crean entrenadores, con los mismos permisos que tiene Rafa.
 *
 * Al crearlo aparece su contraseña **una sola vez**. No se guarda en ningún
 * sitio donde se pueda volver a mirar, así que es el momento de copiarla.
 */
export function FormularioProfesional() {
  const [estado, enviar] = useActionState(accionCrearProfesional, null);

  if (estado?.ok && estado.acceso) {
    return <AccesoRecienCreado correo={estado.acceso.correo} clave={estado.acceso.clave} />;
  }

  return (
    <form action={enviar} className="tarjeta-formulario">
      <label className="campo">
        <span className="campo-etiqueta">Nombre</span>
        <input name="nombre" type="text" required maxLength={40} autoComplete="off" autoFocus />
      </label>

      <label className="campo">
        <span className="campo-etiqueta">Correo</span>
        <input
          name="correo"
          type="email"
          required
          maxLength={120}
          autoComplete="off"
          inputMode="email"
          placeholder="nombre@correo.com"
        />
        <span className="campo-ayuda">Con este correo entrará en la aplicación.</span>
      </label>

      {estado && !estado.ok && (
        <p className="ficha-profesional-error" role="alert">
          {estado.mensaje}
        </p>
      )}

      <BotonCrear />
    </form>
  );
}

function BotonCrear() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-principal" disabled={pending}>
      {pending ? "Creando…" : "Crear profesional"}
    </button>
  );
}

/**
 * Lo que hay que entregarle. Se enseña una vez y no se puede volver a ver.
 *
 * La contraseña no se guarda en claro en ninguna parte —a la base llega ya
 * cifrada—, así que aquí no hay nada que consultar después: si se pierde, se
 * crea otra.
 */
function AccesoRecienCreado({ correo, clave }: { correo: string; clave: string }) {
  return (
    <div className="tarjeta-formulario acceso-nuevo">
      <p className="acceso-nuevo-titulo">Ya puede entrar. Pásale estos datos:</p>

      <dl className="acceso-nuevo-datos">
        <dt>Dirección</dt>
        <dd>antifragil-sistema.vercel.app</dd>
        <dt>Correo</dt>
        <dd>{correo}</dd>
        <dt>Contraseña</dt>
        <dd className="acceso-nuevo-clave">{clave}</dd>
      </dl>

      <p className="acceso-nuevo-aviso">
        Apúntala ahora: por seguridad no se guarda en ningún sitio y no vas a poder volver a verla. Cuando
        entre, que se la cambie desde su foto de perfil.
      </p>

      <a href="/administracion/profesionales" className="boton-principal">
        Hecho
      </a>
    </div>
  );
}
