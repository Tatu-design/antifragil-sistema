import Link from "next/link";
import { notFound } from "next/navigation";

import { accionBorrarCliente } from "@/app/actions";
import { BotonBorrar } from "@/components/BotonBorrar";
import { Iconos } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerPerfil } from "@/services/clientes";

import { exigirAdmin } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Borrar cliente — Antifrágil" };

/** Misma estructura que `webapp/templates/eliminar_cliente.html`. */
export default async function PaginaEliminar({
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

  const { cliente, servicios } = perfil;
  const { error: fallo } = await searchParams;

  const sesiones = servicios.flatMap((s) => s.sesiones);
  const importe = sesiones.reduce((suma, s) => suma + (s.tarifa ?? 0), 0);

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href={`/clientes/${cliente.id}`}>
          ← Volver a {cliente.nombre}
        </Link>
        <h1>Borrar a {cliente.nombre}</h1>
        <p className="subtitulo">Todavía no se ha borrado nada. Esto es lo que va a pasar:</p>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <div className="lista comparativa">
          <div className="fila">
            <span className="etiqueta">Ficha del cliente</span>
            <span className="despues">Se borra</span>
          </div>
          <div className="fila">
            <span className="etiqueta">Sesiones en su historial</span>
            <span className="despues">{sesiones.length}</span>
          </div>
          <div className="fila">
            <span className="etiqueta">Se descontará de la economía</span>
            <span className="despues">{importe.toFixed(0)} €</span>
          </div>
        </div>

        <p className="aviso-error">
          Esto no se puede deshacer. Sus {sesiones.length} sesiones desaparecen del historial y su
          facturación se resta de las semanas correspondientes.
        </p>

        <form action={accionBorrarCliente}>
          <input type="hidden" name="clienteId" value={cliente.id} />
          <BotonBorrar nombre={cliente.nombre} />
        </form>
      </div>
    </>
  );
}
