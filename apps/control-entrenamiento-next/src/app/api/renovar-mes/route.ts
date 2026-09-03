import { NextResponse } from "next/server";

import { renovarMeses } from "@/services/renovacion";

/**
 * La tarea que abre el mes nuevo. La llama Vercel una vez al día.
 *
 * NO ES UNA PUERTA PÚBLICA. Pide un secreto que solo conocen Vercel y el
 * servidor (`CRON_SECRET`). Sin él —o con uno que no coincida— responde «no
 * autorizado» y no mira ni un dato. Vercel lo manda solo en las tareas
 * programadas del propio proyecto.
 *
 * SE EJECUTA TODOS LOS DÍAS a propósito, no solo el 1. Como no hace nada
 * cuando ya está hecho, correr a diario significa que si un día falla —la base
 * no responde, se corta la red— al día siguiente se arregla solo. Un proceso
 * que solo corre el día 1 y falla ese día deja el mes entero roto.
 *
 * Con `?simular=si` no escribe nada y devuelve lo que haría. Sirve para mirar
 * antes de tocar.
 *
 * Lo que devuelve NO lleva nombres ni datos de nadie: solo identificadores
 * internos y cuentas. Esto acaba en el registro del servidor.
 */
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const secreto = process.env.CRON_SECRET;
  const cabecera = peticion.headers.get("authorization");

  // Sin secreto configurado no se abre igualmente: se cierra. Una tarea que se
  // ejecuta sola y escribe en la economía no puede quedar al aire por un
  // despiste de configuración.
  if (!secreto || cabecera !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const soloMirar = new URL(peticion.url).searchParams.get("simular") === "si";

  try {
    const resumen = await renovarMeses({ soloMirar });

    // Registro corto y sin datos personales, para poder mirar después qué pasó.
    console.log(
      `[renovar-mes] ${resumen.mes}${resumen.simulado ? " (simulacion)" : ""}: ` +
        `${resumen.renovados.length} renovados · ${resumen.alDia} al dia · ` +
        `${resumen.omitidos} omitidos · ${resumen.aRevisar.length} a revisar · ` +
        `${resumen.errores.length} errores`,
    );
    for (const e of resumen.errores) console.error(`[renovar-mes] cliente ${e.clienteId}: ${e.error}`);
    for (const r of resumen.aRevisar) console.warn(`[renovar-mes] revisar ${r.clienteId}: ${r.porque}`);

    return NextResponse.json(resumen, { status: 200 });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "error desconocido";
    console.error(`[renovar-mes] ha fallado entero: ${mensaje}`);
    return NextResponse.json({ error: mensaje }, { status: 500 });
  }
}
