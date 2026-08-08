"use server";

/**
 * Todo lo que escribe pasa por aquí, y solo por aquí.
 *
 * Son Server Actions: se ejecutan en el servidor aunque las dispare un botón
 * del navegador. Ningún componente de React llama a los servicios ni al
 * repositorio directamente — así las reglas de negocio no pueden acabar
 * repartidas por la interfaz.
 *
 * Cada acción hace lo mismo, en este orden: comprobar sesión, validar la
 * entrada, llamar al servicio, y devolver un mensaje que la pantalla pueda
 * enseñar. Los errores se devuelven, no se lanzan: un error de negocio es
 * información para Fernando, no una pantalla rota.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ErrorDeNegocio } from "@/domain/modalidades";
import { cerrarSesion, entrar, entrarConClaveUnica, haySesion } from "@/lib/auth";
import {
  desdeFormulario,
  esquemaAlta,
  esquemaBorrarSesion,
  esquemaClase,
  esquemaAviso,
  esquemaBorrarCliente,
  esquemaCobro,
  esquemaDatos,
  esquemaEditarSesion,
  esquemaTipoAviso,
  esquemaKids,
  esquemaFirma,
  esquemaClaveUnica,
  esquemaLogin,
  esquemaServicio,
} from "@/schemas/formularios";
import {
  cambiarEstado,
  configurarServicio,
  crearCliente,
  marcarCobro,
  renombrarCliente,
} from "@/services/clientes";
import {
  editarSesion,
  eliminarClienteConHistorial,
  eliminarSesion,
  firmarSesion,
} from "@/services/sesiones";
import { resolverAviso, resolverPorTipo } from "@/services/avisos";
import { confirmarFacturacionKids } from "@/services/clases";
import {
  deshacerClase,
  registrarClase,
} from "@/services/economia";

export interface Resultado {
  ok: boolean;
  mensaje: string;
  /** Para que la pantalla pueda darle otro tono a lo que ha ido bien. */
  tono?: "exito" | "aviso" | "error";
}

async function exigirSesion(): Promise<void> {
  if (!(await haySesion())) redirect("/login");
}

/** Convierte cualquier fallo en un mensaje que se puede leer sin saber
 *  programar. Un error inesperado no se enseña en crudo. */
function comoMensaje(error: unknown): Resultado {
  if (error instanceof ErrorDeNegocio) return { ok: false, mensaje: error.message, tono: "error" };
  if (error instanceof Error && error.message) return { ok: false, mensaje: error.message, tono: "error" };
  return { ok: false, mensaje: "No se ha podido completar la operación.", tono: "error" };
}

export async function accionEntrar(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  const validado = esquemaLogin.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos.", tono: "error" };
  }

  const resultado = await entrar(validado.data.correo, validado.data.password);
  if (!resultado.ok) {
    return { ok: false, mensaje: resultado.mensaje ?? "No se ha podido entrar.", tono: "error" };
  }
  redirect("/clientes");
}

/** Puerta de emergencia de staging. Apagada salvo que se encienda a propósito. */
export async function accionEntrarClaveUnica(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const validado = esquemaClaveUnica.safeParse(desdeFormulario(datos));
  if (!validado.success) return { ok: false, mensaje: "Escribe la contraseña.", tono: "error" };

  const resultado = await entrarConClaveUnica(validado.data.password);
  if (!resultado.ok) {
    return { ok: false, mensaje: resultado.mensaje ?? "No se ha podido entrar.", tono: "error" };
  }
  redirect("/clientes");
}

export async function accionSalir(): Promise<void> {
  await cerrarSesion();
  redirect("/login");
}

/**
 * Firmar. Redirige al perfil con el mensaje en la dirección, igual que Flask:
 * así la pantalla se pinta ya actualizada y recargar no repite la acción.
 */
export async function accionFirmar(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaFirma.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  let mensaje: string;
  try {
    const r = await firmarSesion(id, { claveIdempotencia: validado.data.claveIdempotencia });
    if (r.duplicado) {
      mensaje = "esa sesión ya estaba firmada, no se ha duplicado";
    } else if (r.renovado) {
      mensaje = `sesión ${r.numeroSesion} de ${r.sesionesTotales}. El servicio se ha completado y se ha abierto uno nuevo, pendiente de pago`;
    } else if (r.modalidad === "bono") {
      mensaje =
        `sesión ${r.numeroSesion} de ${r.sesionesTotales}` +
        (r.avisoUltimaSesion ? ". Queda 1 sesión: la próxima toca renovar" : "");
    } else {
      mensaje = `sesión ${r.numeroSesion} del mes`;
    }
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido firmar";
    redirect(`/clientes/${id}?error=${encodeURIComponent(texto)}`);
  }

  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${id}?firmado=${encodeURIComponent(mensaje)}`);
}

/** «Confirmar y crear». Termina en la ficha del cliente nuevo, como Flask. */
export async function accionCrearCliente(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaAlta.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    const texto = validado.error.issues[0]?.message ?? "revisa los datos";
    redirect(`/clientes/nuevo?error=${encodeURIComponent(texto)}`);
  }

  let id: string;
  try {
    const cliente = await crearCliente({
      nombre: validado.data.nombre,
      modalidad: validado.data.modalidad,
      servicio: validado.data.servicio,
      sesionesTotales: validado.data.sesionesTotales,
      precioTotal: validado.data.precioTotal,
      cuotaMensual: validado.data.cuotaMensual,
      tarifa: validado.data.tarifa,
      sesionesReferencia: validado.data.sesionesReferencia,
    });
    id = cliente.id;
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido crear el cliente";
    redirect(`/clientes/nuevo?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${id}`);
}

/** «Guardar cambios» de Editar programa. Vuelve al perfil, como Flask. */
export async function accionConfigurarServicio(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaServicio.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  let mensaje: string;
  try {
    const resultado = await configurarServicio(id, {
      modalidad: validado.data.modalidad,
      servicio: validado.data.servicio,
      sesionesTotales: validado.data.sesionesTotales,
      precioTotal: validado.data.precioTotal,
      cuotaMensual: validado.data.cuotaMensual,
      tarifa: validado.data.tarifa,
      sesionesReferencia: validado.data.sesionesReferencia,
    });
    mensaje = resultado.cerroCiclo
      ? "servicio anterior cerrado y servicio nuevo abierto. Las sesiones ya hechas no se han tocado"
      : "condiciones actualizadas. Las sesiones ya firmadas conservan su precio";
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido guardar";
    redirect(`/clientes/${id}/programa?error=${encodeURIComponent(texto)}`);
  }

  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${id}?guardado=${encodeURIComponent(mensaje)}`);
}

/**
 * «Confirmar y guardar» de Editar datos: nombre y estado a la vez, igual que
 * la ruta `guardar` de Flask. Son los dos únicos campos de esa pantalla.
 */
export async function accionGuardarDatos(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaDatos.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  try {
    await renombrarCliente(id, validado.data.nombre);
    await cambiarEstado(id, validado.data.estado);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido guardar";
    redirect(`/clientes/${id}/datos?error=${encodeURIComponent(texto)}`);
  }

  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${id}?guardado=${encodeURIComponent("datos del cliente actualizados")}`);
}

/** Solo toca el estado de COBRO: no altera sesiones, horas, historial ni
 *  economía. Vuelve al perfil con el aviso, igual que Flask. */
export async function accionMarcarCobro(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaCobro.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  try {
    await marcarCobro(id, validado.data.ciclo, validado.data.pagado);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido guardar";
    redirect(`/clientes/${id}?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${id}?cobro=1`);
}

export async function accionBorrarSesion(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaBorrarSesion.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  const aviso = "su importe se ha descontado de la semana correspondiente";
  try {
    await eliminarSesion(id, validado.data.sesionId);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido borrar";
    redirect(`/clientes/${id}/sesion/${validado.data.sesionId}?error=${encodeURIComponent(texto)}`);
  }

  revalidatePath(`/clientes/${id}`);
  revalidatePath("/clientes");
  revalidatePath("/economia");
  redirect(`/clientes/${id}?borrado=${encodeURIComponent(aviso)}`);
}

// ---------------------------------------------------------------------------
// Economía
// ---------------------------------------------------------------------------

/**
 * Los cuatro botones de CrossFit redirigen con el mensaje en la dirección,
 * igual que `firmar_clase` y `deshacer_clase` en Flask: la pantalla se pinta ya
 * actualizada y recargar no vuelve a sumar la clase.
 */
/**
 * Firma una clase de CrossFit desde la ficha de su cuenta.
 *
 * Antes vivía en Economía; ahora se firma desde la ficha, igual que se le
 * firma a un cliente. La operación de debajo es la MISMA que ya había: no se
 * ha duplicado nada, solo ha cambiado desde dónde se llama y adónde vuelve.
 */
export async function accionFirmarClase(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaClase.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const destino = `/clases/${validado.data.tipo}`;
  let cuando: string;
  try {
    cuando = await registrarClase(validado.data.tipo);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido registrar la clase";
    redirect(`${destino}?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath(destino);
  revalidatePath("/clientes");
  revalidatePath("/economia");
  redirect(`${destino}?firmada=${encodeURIComponent(cuando)}`);
}

/** Deshace la última clase de esa cuenta y devuelve a su ficha. */
export async function accionDeshacerClase(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaClase.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const destino = `/clases/${validado.data.tipo}`;
  let cuando: string;
  try {
    cuando = await deshacerClase(validado.data.tipo);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido deshacer";
    redirect(`${destino}?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath(destino);
  revalidatePath("/clientes");
  revalidatePath("/economia");
  redirect(`${destino}?deshecha=${encodeURIComponent(cuando)}`);
}

export async function accionFacturacionKids(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaKids.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa el importe.", tono: "error" };
  }

  try {
    const avance = await confirmarFacturacionKids(
      validado.data.anio,
      validado.data.mes,
      validado.data.importe,
    );
    revalidatePath("/economia");
    revalidatePath("/clases/kids");
    revalidatePath("/clientes");
    return {
      ok: true,
      tono: "exito",
      mensaje: avance.precioResultante
        ? `Guardado. Sale a ${avance.precioResultante.toFixed(2).replace(".", ",")} € por clase.`
        : "Guardado.",
    };
  } catch (error) {
    return comoMensaje(error);
  }
}

// ---------------------------------------------------------------------------
// Avisos, corrección de sesiones y baja de clientes
// ---------------------------------------------------------------------------

/** Descartar vuelve a la bandeja, igual que Flask: sin mensaje, la lista ya
 *  enseña el resultado. */
export async function accionResolverAviso(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaAviso.safeParse(desdeFormulario(datos));
  if (validado.success) await resolverAviso(validado.data.id);
  revalidatePath("/avisos");
  redirect("/avisos");
}

export async function accionResolverTipo(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaTipoAviso.safeParse(desdeFormulario(datos));
  if (validado.success) await resolverPorTipo(validado.data.tipo);
  revalidatePath("/avisos");
  redirect("/avisos");
}

export async function accionEditarSesion(datos: FormData): Promise<void> {
  await exigirSesion();
  const entrada = desdeFormulario(datos);
  const validado = esquemaEditarSesion.safeParse(entrada);
  if (!validado.success) {
    const texto = validado.error.issues[0]?.message ?? "revisa los datos";
    redirect(
      `/clientes/${entrada.clienteId}/sesion/${entrada.sesionId}?error=${encodeURIComponent(texto)}`,
    );
  }

  const { clienteId, sesionId, fecha, numeroSesion } = validado.data;
  try {
    await editarSesion(clienteId, sesionId, fecha, numeroSesion);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido guardar";
    redirect(`/clientes/${clienteId}/sesion/${sesionId}?error=${encodeURIComponent(texto)}`);
  }

  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/economia");
  redirect(`/clientes/${clienteId}?guardado=${encodeURIComponent("sesión corregida")}`);
}

export async function accionBorrarCliente(datos: FormData): Promise<void> {
  await exigirSesion();
  const validado = esquemaBorrarCliente.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  try {
    await eliminarClienteConHistorial(validado.data.clienteId);
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido borrar";
    redirect(`/clientes/${validado.data.clienteId}/eliminar?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath("/clientes");
  revalidatePath("/economia");
  redirect("/clientes");
}
