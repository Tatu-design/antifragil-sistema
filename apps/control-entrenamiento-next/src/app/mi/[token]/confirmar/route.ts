import { NextResponse, type NextRequest } from "next/server";

import { confirmarSesion } from "@/services/publico";

/**
 * Confirmar escaneando el código QR.
 *
 * Acepta `GET` a propósito, saltándose la norma de que un GET no cambia nada:
 * al escanear el QR el móvil simplemente abre esta dirección, y así el cliente
 * no tiene que pulsar nada después. Es asumible porque **repetirlo es
 * inofensivo** (como mucho ya estaba confirmada) y porque el token de la
 * propia URL hace de autorización.
 */
export async function GET(peticion: NextRequest, contexto: { params: Promise<{ token: string }> }) {
  const { token } = await contexto.params;
  const resultado = await confirmarSesion(token);

  const destino = new URL(`/mi/${token}`, peticion.url);
  destino.searchParams.set(
    "confirmado",
    resultado.ok ? (resultado.yaEstaba ? "ya" : "si") : "no",
  );
  return NextResponse.redirect(destino);
}

export const POST = GET;
