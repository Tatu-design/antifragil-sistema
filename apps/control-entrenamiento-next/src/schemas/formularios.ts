/**
 * Validación de todo lo que llega del navegador.
 *
 * Nada que venga de un formulario se usa sin pasar por aquí: un `<select>` con
 * tres opciones no impide mandar una cuarta a mano.
 */

import { z } from "zod";

import { ESTADOS } from "@/domain/tipos";
import { MODALIDADES } from "@/domain/modalidades";

/** Un número que llega como texto de un formulario. Acepta coma decimal, que
 *  es como Fernando escribe los precios. */
const numeroOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .refine((v) => v === null || Number.isFinite(v), { message: "Tiene que ser un número" });

export const esquemaLogin = z.object({
  correo: z.string().trim().email("Escribe un correo válido"),
  password: z.string().min(1, "Escribe la contraseña"),
});

/** Puerta de emergencia: solo contraseña, sin correo. */
export const esquemaClaveUnica = z.object({
  password: z.string().min(1, "Escribe la contraseña"),
});

export const esquemaFirma = z.object({
  clienteId: z.string().min(1),
  /** Valor de un solo uso por carga de página, para que un reintento de red o
   *  dos pestañas no guarden la misma firma dos veces. */
  claveIdempotencia: z.string().min(1),
});

export const esquemaAlta = z.object({
  nombre: z.string().trim().min(1, "El nombre del cliente no puede estar vacío").max(80),
  modalidad: z.enum(MODALIDADES),
  servicio: z.string().trim().max(80).default(""),
  sesionesTotales: numeroOpcional,
  precioTotal: numeroOpcional,
  cuotaMensual: numeroOpcional,
  tarifa: numeroOpcional,
  sesionesReferencia: numeroOpcional,
  /** Quién lo va a llevar. Vacío = el propio administrador. */
  entrenadorId: z.string().trim().default(""),
});

export const esquemaServicio = z.object({
  clienteId: z.string().min(1),
  modalidad: z.enum(MODALIDADES),
  servicio: z.string().trim().max(80).default(""),
  sesionesTotales: numeroOpcional,
  precioTotal: numeroOpcional,
  cuotaMensual: numeroOpcional,
  tarifa: numeroOpcional,
  sesionesReferencia: numeroOpcional,
});

export const esquemaEstado = z.object({
  clienteId: z.string().min(1),
  estado: z.enum(ESTADOS),
});

export const esquemaRenombrar = z.object({
  clienteId: z.string().min(1),
  nombre: z.string().trim().min(1, "El nombre del cliente no puede estar vacío").max(80),
});

export const esquemaClase = z.object({
  tipo: z.enum(["lidomare", "kids"]),
});

export const esquemaBorrarClase = z.object({
  id: z.string().min(1),
  tipo: z.enum(["lidomare", "kids"]),
});

export const esquemaKids = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
  importe: z
    .string()
    .trim()
    .min(1, "Escribe el importe")
    .transform((v) => Number(v.replace(",", ".")))
    .refine((v) => Number.isFinite(v) && v > 0, { message: "Tiene que ser un importe positivo" }),
});

export const esquemaAviso = z.object({
  id: z.string().min(1),
});

export const esquemaTipoAviso = z.object({
  tipo: z.string().min(1),
});

export const esquemaEditarSesion = z.object({
  clienteId: z.string().min(1),
  sesionId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  numeroSesion: z.coerce.number().int().min(1),
});

/** Datos del cliente: quién es y en qué situación está. El servicio se edita
 *  aparte, igual que en `editar_datos.html`. */
export const esquemaDatos = z.object({
  clienteId: z.string().min(1),
  nombre: z.string().trim().min(1, "El nombre del cliente no puede estar vacío").max(80),
  estado: z.enum(ESTADOS),
});

/** La pantalla de borrado ES la confirmación, como en Flask: no se pide además
 *  escribir nada. */
export const esquemaBorrarCliente = z.object({
  clienteId: z.string().min(1),
});

export const esquemaCobro = z.object({
  clienteId: z.string().min(1),
  ciclo: z.coerce.number().int().min(0),
  pagado: z.enum(["si", "no"]).transform((v) => v === "si"),
});

export const esquemaBorrarSesion = z.object({
  clienteId: z.string().min(1),
  sesionId: z.string().min(1),
});

/** Convierte un `FormData` en un objeto plano para que Zod lo valide. */
export function desdeFormulario(datos: FormData): Record<string, string> {
  const objeto: Record<string, string> = {};
  for (const [clave, valor] of datos.entries()) {
    if (typeof valor === "string") objeto[clave] = valor;
  }
  return objeto;
}
