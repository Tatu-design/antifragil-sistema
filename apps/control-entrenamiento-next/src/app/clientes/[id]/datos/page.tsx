import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormularioDatos } from "@/components/FormularioDatos";
import { Iconos, Icono } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { haySesion } from "@/lib/auth";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerPerfil } from "@/services/clientes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar datos — Antifrágil" };

/** Misma estructura que `webapp/templates/editar_datos.html`. */
export default async function PaginaDatos({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await haySesion())) redirect("/login");

  const { id } = await params;
  let perfil;
  try {
    perfil = await obtenerPerfil(id);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  if (!perfil) notFound();

  const { cliente, servicios } = perfil;
  const { error: fallo } = await searchParams;

  // Con sesiones ya firmadas no se borra: se cancela, que archiva sin perder
  // nada. Es la misma regla que en Flask.
  const tieneHistorial = servicios.some((s) => s.sesiones.length > 0);

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href={`/clientes/${cliente.id}`}>
          <Icono nombre="i-arrow-left" pequeno />
          {cliente.nombre}
        </Link>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <FormularioDatos clienteId={cliente.id} nombre={cliente.nombre} estado={cliente.estado} />

        <div className="zona-peligrosa">
          <p className="zona-peligrosa-titulo">Zona peligrosa</p>
          {tieneHistorial ? (
            <p className="meta">
              Este cliente tiene sesiones y datos económicos, así que no se puede borrar sin perderlos. Si
              ha dejado de entrenar, ponlo como <strong>Cancelado</strong> aquí arriba: desaparece de la
              lista de activos y conserva todo su historial.
            </p>
          ) : (
            <>
              <p className="meta">
                Este cliente no tiene ninguna sesión registrada, así que puede borrarse definitivamente. Si
                ya ha entrenado alguna vez, es preferible cancelarlo para no perder su historial.
              </p>
              <Link className="boton-secundario boton-peligro" href={`/clientes/${cliente.id}/eliminar`}>
                <Icono nombre="i-trash-2" pequeno />
                Borrar este cliente
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
