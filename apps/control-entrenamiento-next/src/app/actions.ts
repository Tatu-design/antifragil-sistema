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
import { claveTemporal, normalizarCorreo, puedeDesactivarse, revisarAlta } from "@/domain/profesionales";
import { cerrarSesion, entrar, entrarConClaveUnica } from "@/lib/auth";
import { cambiarClave, verificarCredenciales } from "@/repositories/usuarios";
import { esAdmin, exigirAccesoACliente, exigirAdmin, exigirUsuario } from "@/lib/permisos";
import { repositorio } from "@/repositories";
import { listarProfesionales } from "@/repositories/perfiles";
import {
  desdeFormulario,
  esquemaAlta,
  esquemaBorrarClase,
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
  esquemaClave,
  esquemaPerfil,
  esquemaClaveUnica,
  esquemaLogin,
  esquemaServicio,
  esquemaProfesional,
  esquemaEstadoProfesional,
} from "@/schemas/formularios";
import {
  cambiarEstado,
  configurarServicio,
  crearCliente,
  marcarCobro,
  renombrarCliente,
  traspasarCliente,
} from "@/services/clientes";
import {
  editarSesion,
  eliminarClienteConHistorial,
  eliminarSesion,
  firmarSesion,
} from "@/services/sesiones";
import { resolverAviso, resolverPorTipo } from "@/services/avisos";
import { borrarClase, confirmarFacturacionKids } from "@/services/clases";
import {
  registrarClase,
} from "@/services/economia";

export interface Resultado {
  ok: boolean;
  mensaje: string;
  /** Para que la pantalla pueda darle otro tono a lo que ha ido bien. */
  tono?: "exito" | "aviso" | "error";
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
  await exigirUsuario();
  const validado = esquemaFirma.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  const quien = await exigirAccesoACliente(id);
  let mensaje: string;
  try {
    // Queda anotado quién la firmó. No cambia nada del bono, del historial ni
    // de la economía: solo permite saber después qué hizo cada profesional.
    const r = await firmarSesion(id, {
      claveIdempotencia: validado.data.claveIdempotencia,
      firmadaPor: quien.id,
    });
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
  // Desde el 2026-08-10 un entrenador también da de alta a sus clientes: si
  // capta a alguien, no tiene por qué esperar a que se lo cree el
  // administrador. Lo que NO puede es crearlo a nombre de otro.
  const quien = await exigirUsuario();
  const validado = esquemaAlta.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    const texto = validado.error.issues[0]?.message ?? "revisa los datos";
    redirect(`/clientes/nuevo?error=${encodeURIComponent(texto)}`);
  }

  // Solo los que pueden entrar: a alguien de baja no se le asignan clientes
  // nuevos. Se comprueba aquí, no solo escondiéndolo del desplegable.
  const profesionales = esAdmin(quien)
    ? (await listarProfesionales()).filter((p) => p.activo !== false)
    : [];

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
      // Quién lo lleva. **Esta línea es la que impide que un entrenador cree
      // clientes a nombre de otro**, y por eso no mira el formulario cuando
      // no es administrador: da igual lo que venga escrito ahí.
      //
      // Un administrador sí elige, pero solo entre profesionales que existen
      // de verdad; cualquier otra cosa que llegue se ignora y el cliente es
      // suyo.
      profesionalId: esAdmin(quien)
        ? (profesionales.some((p) => p.id === validado.data.profesionalId)
            ? validado.data.profesionalId
            : quien.id)
        : quien.id,
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
  await exigirUsuario();
  const validado = esquemaServicio.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  // Un entrenador puede cambiar el programa de SUS clientes (2026-08-10). El
  // de otro, no: lo impide esta comprobación, no que no vea el botón.
  await exigirAccesoACliente(id);
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
  await exigirUsuario();
  const validado = esquemaDatos.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  const quien = await exigirAccesoACliente(id);
  try {
    await renombrarCliente(id, validado.data.nombre);
    await cambiarEstado(id, validado.data.estado);

    // Traspasar un cliente a otro profesional es cosa del administrador: un
    // entrenador podría quitárselo a un compañero, o quedárselo. Se comprueba
    // aquí y no solo escondiendo el desplegable.
    const traspaso = validado.data.profesionalId;
    if (traspaso && esAdmin(quien)) {
      const profesionales = await listarProfesionales();
      // Y no a alguien de baja: para devolverle clientes, primero se le
      // devuelve el acceso.
      if (profesionales.some((p) => p.id === traspaso && p.activo !== false)) {
        await traspasarCliente(id, traspaso);
      }
    }
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
  await exigirUsuario();
  const validado = esquemaCobro.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  await exigirAccesoACliente(id);
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
  await exigirUsuario();
  const validado = esquemaBorrarSesion.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const id = validado.data.clienteId;
  await exigirAccesoACliente(id);
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
  await exigirAdmin();
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

/**
 * Borra una clase concreta del historial de su cuenta.
 *
 * Sustituye al «deshacer la última»: se elige cuál, igual que con la sesión
 * de un cliente. Su importe sale de la semana en la misma operación.
 */
export async function accionBorrarClase(datos: FormData): Promise<void> {
  await exigirAdmin();
  const validado = esquemaBorrarClase.safeParse(desdeFormulario(datos));
  if (!validado.success) redirect("/clientes");

  const destino = `/clases/${validado.data.tipo}`;
  let cuando: string;
  try {
    cuando = (await borrarClase(validado.data.id)).fecha;
  } catch (error) {
    const texto = error instanceof Error ? error.message : "no se ha podido borrar";
    redirect(`${destino}?error=${encodeURIComponent(texto)}`);
  }
  revalidatePath(destino);
  revalidatePath("/clientes");
  revalidatePath("/economia");
  redirect(`${destino}?borrada=${encodeURIComponent(cuando)}`);
}

export async function accionFacturacionKids(_previo: Resultado | null, datos: FormData): Promise<Resultado> {
  await exigirAdmin();
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
  const quien = await exigirUsuario();
  // La condición del profesional va DENTRO del `update`: resolver un aviso
  // ajeno no toca la fila, en vez de comprobarlo antes y escribir después.
  const alcance = esAdmin(quien) ? null : quien.id;
  const validado = esquemaAviso.safeParse(desdeFormulario(datos));
  if (validado.success) await resolverAviso(validado.data.id, alcance);
  revalidatePath("/avisos");
  redirect("/avisos");
}

export async function accionResolverTipo(datos: FormData): Promise<void> {
  const quien = await exigirUsuario();
  const alcance = esAdmin(quien) ? null : quien.id;
  const validado = esquemaTipoAviso.safeParse(desdeFormulario(datos));
  if (validado.success) await resolverPorTipo(validado.data.tipo, alcance);
  revalidatePath("/avisos");
  redirect("/avisos");
}

export async function accionEditarSesion(datos: FormData): Promise<void> {
  await exigirUsuario();
  const entrada = desdeFormulario(datos);
  const validado = esquemaEditarSesion.safeParse(entrada);
  if (!validado.success) {
    const texto = validado.error.issues[0]?.message ?? "revisa los datos";
    redirect(
      `/clientes/${entrada.clienteId}/sesion/${entrada.sesionId}?error=${encodeURIComponent(texto)}`,
    );
  }

  const { clienteId, sesionId, fecha, numeroSesion } = validado.data;
  await exigirAccesoACliente(clienteId);
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
  await exigirAdmin();
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

/**
 * Cambiar la propia contraseña.
 *
 * Cada uno la suya y solo la suya: el correo sale de la sesión, NO del
 * formulario. Si viniera del formulario, cualquiera podría cambiarle la
 * contraseña a otro escribiendo su correo.
 *
 * Se exige la actual aunque ya haya sesión iniciada: una sesión olvidada en un
 * móvil no debe bastar para quedarse con la cuenta.
 */
export async function accionCambiarClave(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const quien = await exigirUsuario();

  const validado = esquemaClave.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos", tono: "error" };
  }

  try {
    const correcta = await verificarCredenciales(quien.correo, validado.data.actual);
    if (!correcta) {
      return { ok: false, mensaje: "La contraseña actual no es correcta.", tono: "error" };
    }

    await cambiarClave(quien.correo, validado.data.nueva);
  } catch {
    return { ok: false, mensaje: "No se ha podido cambiar ahora mismo. Inténtalo en un minuto.", tono: "error" };
  }

  // Sobre la sesión: no se cierra. La cookie no depende de la contraseña, así
  // que quien ya estuviera dentro en otro dispositivo sigue dentro hasta que
  // caduque. Para el caso normal —estrenar una contraseña temporal— es lo
  // deseable; si algún día hace falta echar a todos los dispositivos, habrá
  // que numerar las sesiones y comprobarlo en `abrirCookie`.
  return { ok: true, mensaje: "Contraseña cambiada. Úsala la próxima vez que entres.", tono: "exito" };
}

/**
 * Guardar el propio nombre y la propia foto.
 *
 * Como con la contraseña: **el perfil sale de la sesión, no del formulario**.
 * Si el identificador viniera de fuera, cualquiera podría cambiarle el nombre
 * y la foto a otro.
 */
export async function accionGuardarPerfil(
  _previo: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  const quien = await exigirUsuario();

  const validado = esquemaPerfil.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos", tono: "error" };
  }

  try {
    // Vacío significa «no la toques», no «bórrala»: la foto actual ya no se
    // manda al navegador, así que no puede reenviarla en cada guardado.
    const foto =
      validado.data.foto === ""
        ? (quien.foto ?? null)
        : validado.data.foto === "quitar"
          ? null
          : validado.data.foto;

    await repositorio().actualizarPerfil(quien.id, { nombre: validado.data.nombre, foto });
  } catch {
    return { ok: false, mensaje: "No se ha podido guardar ahora mismo.", tono: "error" };
  }

  // El nombre sale en el filtro por profesional y en la propia cabecera.
  revalidatePath("/clientes");
  revalidatePath("/avisos");
  revalidatePath("/economia");
  return { ok: true, mensaje: "Guardado.", tono: "exito" };
}

// -----------------------------------------------------------------------------
// Administración de profesionales
// -----------------------------------------------------------------------------

/**
 * Da de alta a un profesional y devuelve su contraseña **una sola vez**.
 *
 * SOLO EL ADMINISTRADOR. `exigirAdmin()` es la barrera de verdad: un
 * entrenador que llame a esta acción a mano —sin pasar por ninguna pantalla—
 * acaba en su lista de clientes. Que no vea el botón es cortesía.
 *
 * La contraseña se genera aquí, se le entrega al administrador para que se la
 * pase, y **no se guarda en ningún sitio en claro**: a la base llega ya
 * cifrada por ella misma. No se escribe en registros ni se vuelve a poder
 * consultar — si se pierde, se genera otra.
 *
 * El profesional nace SIEMPRE como entrenador, con los mismos permisos que
 * Rafa. Desde aquí no se crean administradores.
 */
export async function accionCrearProfesional(
  _anterior: ResultadoAlta | null,
  datos: FormData,
): Promise<ResultadoAlta> {
  await exigirAdmin();

  const validado = esquemaProfesional.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: validado.error.issues[0]?.message ?? "Revisa los datos", tono: "error" };
  }

  const correo = normalizarCorreo(validado.data.correo);
  const problemas = revisarAlta({ nombre: validado.data.nombre, correo });
  if (problemas.length > 0) {
    return { ok: false, mensaje: problemas[0].mensaje, tono: "error" };
  }

  const clave = claveTemporal();
  try {
    await repositorio().crearProfesional({ nombre: validado.data.nombre, correo, clave });
  } catch (error) {
    return comoMensaje(error);
  }

  // Aparece solo donde haga falta: los selectores y la economía leen la lista
  // real de profesionales, no una escrita a mano.
  revalidatePath("/administracion/profesionales");
  revalidatePath("/clientes");
  revalidatePath("/economia");
  revalidatePath("/calendario");

  return {
    ok: true,
    mensaje: `${validado.data.nombre} ya puede entrar.`,
    tono: "exito",
    acceso: { correo, clave },
  };
}

/** El alta devuelve además el acceso, para poder enseñarlo una vez. */
export interface ResultadoAlta extends Resultado {
  /** Solo en el momento de crearlo. Después no se puede volver a consultar. */
  acceso?: { correo: string; clave: string };
}

/**
 * Da de baja a un profesional, o lo vuelve a dar de alta.
 *
 * **Nunca borra a nadie.** Su histórico se queda entero: sus sesiones siguen
 * siendo suyas y su economía sigue estando donde estaba.
 *
 * Y no se le puede dar de baja si todavía lleva clientes activos: primero se
 * le pasan a otro. Un cliente activo sin responsable es un cliente al que
 * nadie firma ni de quien nadie recibe avisos.
 */
export async function accionCambiarEstadoProfesional(
  _anterior: Resultado | null,
  datos: FormData,
): Promise<Resultado> {
  await exigirAdmin();

  const validado = esquemaEstadoProfesional.safeParse(desdeFormulario(datos));
  if (!validado.success) {
    return { ok: false, mensaje: "Revisa los datos", tono: "error" };
  }
  const activo = validado.data.activo === "si";

  // El identificador NO se usa tal cual: se comprueba contra la lista real.
  const profesionales = await listarProfesionales();
  const quien = profesionales.find((p) => p.id === validado.data.profesionalId);
  if (!quien) return { ok: false, mensaje: "Ese profesional ya no existe", tono: "error" };

  try {
    if (!activo) {
      const clientes = await repositorio().contarClientesActivosDe(quien.id);
      const veredicto = puedeDesactivarse(quien, clientes);
      if (!veredicto.puede) return { ok: false, mensaje: veredicto.porQue!, tono: "error" };
    }
    await repositorio().cambiarEstadoProfesional(quien.id, activo);
  } catch (error) {
    return comoMensaje(error);
  }

  revalidatePath("/administracion/profesionales");
  revalidatePath("/clientes");
  revalidatePath("/economia");
  revalidatePath("/calendario");

  return {
    ok: true,
    mensaje: activo ? `${quien.nombre} vuelve a tener acceso.` : `${quien.nombre} ya no puede entrar.`,
    tono: "exito",
  };
}
