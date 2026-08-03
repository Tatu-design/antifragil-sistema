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
  password: z.string().min(1, "Escribe la contraseña"),
});

export const esquemaFirma = z.object({
  clienteId: z.string().min(1),
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
});

export const esquemaEstado = z.object({
  clienteId: z.string().min(1),
  estado: z.enum(ESTADOS),
});

export const esquemaRenombrar = z.object({
  clienteId: z.string().min(1),
  nombre: z.string().trim().min(1, "El nombre del cliente no puede estar vacío").max(80),
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
