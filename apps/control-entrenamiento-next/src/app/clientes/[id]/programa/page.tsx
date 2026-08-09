import Link from "next/link";
import { notFound } from "next/navigation";

import { FormularioServicio } from "@/components/FormularioServicio";
import { Iconos, Icono } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { ETIQUETAS } from "@/domain/modalidades";
import { euros } from "@/lib/formato";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerPerfil } from "@/services/clientes";

import { exigirAdmin } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar programa — Antifrágil" };

/** Misma estructura que `webapp/templates/editar.html`. */
export default async function PaginaPrograma({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await exigirAdmin();

  const { id } = await params;
  let perfil;
  try {
    perfil = await obtenerPerfil(id);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  if (!perfil) notFound();

  const { cliente, ficha, ciclo, servicios } = perfil;
  const { error: fallo } = await searchParams;

  const sesionesCiclo = servicios.find((s) => s.esActual)?.sesiones.length ?? 0;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href={`/clientes/${cliente.id}`}>
          <Icono nombre="i-arrow-left" pequeno />
          {cliente.nombre}
        </Link>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <FormularioServicio
          clienteId={cliente.id}
          nombre={cliente.nombre}
          iniciales={{
            modalidad: ficha.modalidad,
            servicio: ciclo?.servicio ?? "",
            sesionesTotales: ciclo?.sesionesTotales ? String(ciclo.sesionesTotales) : "",
            precioTotal: ciclo?.precioTotal ? String(ciclo.precioTotal) : "",
            cuotaMensual: ciclo?.cuotaMensual ? String(ciclo.cuotaMensual) : "",
            tarifa: ficha.modalidad === "cuenta" && ciclo?.tarifa ? String(ciclo.tarifa) : "",
            sesionesReferencia: ciclo?.sesionesReferencia ? String(ciclo.sesionesReferencia) : "",
          }}
          antes={{
            etiqueta: ETIQUETAS[ficha.modalidad],
            servicio: ciclo?.servicio ?? null,
            detalle: detalleActual(ficha.modalidad, ciclo),
            sesionesCiclo,
            pendientePago: ficha.pendientePago,
          }}
        />
      </div>
    </>
  );
}

/** La línea «antes» del repaso, con las condiciones que hay ahora mismo. */
function detalleActual(
  modalidad: string,
  ciclo: { sesionesTotales: number; precioTotal: number | null; cuotaMensual: number | null; tarifa: number | null; sesionesReferencia: number | null } | null,
): string {
  if (!ciclo) return "sin servicio asignado";
  if (modalidad === "mensualidad") {
    const referencia = ciclo.sesionesReferencia ? ` · ref. ${ciclo.sesionesReferencia}` : "";
    return `Cuota ${euros(ciclo.cuotaMensual)} al mes${referencia}`;
  }
  if (modalidad === "cuenta") return `${euros(ciclo.tarifa)} por sesión · sin tope`;
  const porSesion = ciclo.tarifa ? ` · ${euros(ciclo.tarifa)}/sesión` : "";
  return `${ciclo.sesionesTotales} sesiones · ${euros(ciclo.precioTotal)}${porSesion}`;
}
