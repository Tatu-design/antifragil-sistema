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
import { abrirSesion, cerrarSesion, contrasenaCorrecta, haySesion } from "@/lib/auth";
import {
  desdeFormulario,
  esquemaAlta,
  esquemaBorrarSesion,
  esquemaCobro,
  esquemaEstado,
  esquemaFirma,
  esquemaLogin,
  esquemaRenombrar,
  esquemaServicio,
} from "@/schemas/formularios";
import {
  cambiarEstado,
  configurarServicio,
  crearCliente,
  marcarCobro,
  renombrarCliente,
} from "@/services/clientes";
import { eliminarSesion, firmarSesion } from "@/services/sesiones";

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
    return { ok: false, mensaje: "Escribe la contraseña.", tono: "error" };
  }
  if (!contrasenaCorrecta(validado.data.password)) {
    return { ok: false, mensaje: "Contraseña incorrecta.", tono: "error" };
  }
  await abrirSesion();
  redirect("/clientes");
}

export async function accionSalir(): Promise<void> {
  await cerrarSesion();
  redirect("/login");
}

export async function accionFirmar(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaFirma.safeParse(desdeFormulario(datos));
  if (!validado.success) return { ok: false, mensaje: "Petición incompleta.", tono: "error" };

  try {
    const resultado = await firmarSesion(validado.data.clienteId, {
      claveIdempotencia: validado.data.claveIdempotencia,
    });
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");

    if (resultado.duplicado) {
      return { ok: true, mensaje: "Esa sesión ya estaba firmada. No se ha duplicado.", tono: "aviso" };
    }
    if (resultado.renovado) {
      return {
        ok: true,
        mensaje:
          `Sesión ${resultado.numeroSesion} de ${resultado.sesionesTotales} firmada. ` +
          "El servicio se ha completado y se ha abierto uno nuevo, pendiente de pago.",
        tono: "exito",
      };
    }
    if (resultado.modalidad === "bono") {
      const aviso = resultado.avisoUltimaSesion ? " Queda 1 sesión: la próxima toca renovar." : "";
      return {
        ok: true,
        mensaje: `Sesión ${resultado.numeroSesion} de ${resultado.sesionesTotales} firmada.${aviso}`,
        tono: "exito",
      };
    }
    return { ok: true, mensaje: `Sesión ${resultado.numeroSesion} del mes registrada.`, tono: "exito" };
  } catch (error) {
    return comoMensaje(error);
  }
}

export async function accionCrearCliente(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaAlta.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos.", tono: "error" };
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
    return comoMensaje(error);
  }
  revalidatePath("/clientes");
  redirect(`/clientes/${id}`);
}

export async function accionConfigurarServicio(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaServicio.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos.", tono: "error" };
  }

  try {
    const resultado = await configurarServicio(validado.data.clienteId, {
      modalidad: validado.data.modalidad,
      servicio: validado.data.servicio,
      sesionesTotales: validado.data.sesionesTotales,
      precioTotal: validado.data.precioTotal,
      cuotaMensual: validado.data.cuotaMensual,
      tarifa: validado.data.tarifa,
      sesionesReferencia: validado.data.sesionesReferencia,
    });
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");

    return {
      ok: true,
      tono: "exito",
      mensaje: resultado.cerroCiclo
        ? "Servicio anterior cerrado y servicio nuevo abierto. Las sesiones ya hechas no se han tocado."
        : "Condiciones actualizadas. Las sesiones ya firmadas conservan su precio.",
    };
  } catch (error) {
    return comoMensaje(error);
  }
}

export async function accionCambiarEstado(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaEstado.safeParse(desdeFormulario(datos));
  if (!validado.success) return { ok: false, mensaje: "Estado no válido.", tono: "error" };

  try {
    await cambiarEstado(validado.data.clienteId, validado.data.estado);
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");
    return { ok: true, mensaje: `Cliente marcado como ${validado.data.estado}.`, tono: "exito" };
  } catch (error) {
    return comoMensaje(error);
  }
}

export async function accionRenombrar(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaRenombrar.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Nombre no válido.", tono: "error" };
  }

  try {
    await renombrarCliente(validado.data.clienteId, validado.data.nombre);
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");
    return { ok: true, mensaje: "Nombre actualizado. Su historial y su enlace no cambian.", tono: "exito" };
  } catch (error) {
    return comoMensaje(error);
  }
}

export async function accionMarcarCobro(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaCobro.safeParse(desdeFormulario(datos));
  if (!validado.success) return { ok: false, mensaje: "Petición incompleta.", tono: "error" };

  try {
    await marcarCobro(validado.data.clienteId, validado.data.ciclo, validado.data.pagado);
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");
    return {
      ok: true,
      mensaje: validado.data.pagado
        ? "Marcado como cobrado. No se ha movido ninguna cifra de facturación."
        : "Marcado como pendiente de cobro.",
      tono: "exito",
    };
  } catch (error) {
    return comoMensaje(error);
  }
}

export async function accionBorrarSesion(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirSesion();
  const validado = esquemaBorrarSesion.safeParse(desdeFormulario(datos));
  if (!validado.success) return { ok: false, mensaje: "Petición incompleta.", tono: "error" };

  try {
    await eliminarSesion(validado.data.clienteId, validado.data.sesionId);
    revalidatePath(`/clientes/${validado.data.clienteId}`);
    revalidatePath("/clientes");
    return { ok: true, mensaje: "Sesión borrada y su importe descontado.", tono: "exito" };
  } catch (error) {
    return comoMensaje(error);
  }
}
