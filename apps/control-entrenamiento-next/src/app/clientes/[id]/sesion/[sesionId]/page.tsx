import Link from "next/link";
import { notFound } from "next/navigation";

import { accionEditarSesion } from "@/app/actions";
import { BorrarSesion } from "@/components/BorrarSesion";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerPerfil } from "@/services/clientes";

import { exigirAccesoACliente } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Editar sesión — Antifrágil" };

/** Misma estructura que `webapp/templates/editar_historial.html`. */
export default async function PaginaEditarSesion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sesionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, sesionId } = await params;

  // El candado. Antes de leer nada de este cliente: un entrenador que
  // escriba la dirección a mano de un cliente ajeno recibe «no existe».
  await exigirAccesoACliente(id);
  let perfil;
  try {
    perfil = await obtenerPerfil(id);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  if (!perfil) notFound();

  const { cliente, servicios } = perfil;
  const sesion = servicios.flatMap((s) => s.sesiones).find((s) => s.id === sesionId);
  if (!sesion) notFound();

  const { error: fallo } = await searchParams;

  return (
    <div className="page sin-barra">
      <Link className="volver" href={`/clientes/${cliente.id}`}>
        ← {cliente.nombre}
      </Link>
      <h1>Editar sesión</h1>
      <p className="subtitulo">{sesion.servicio}</p>

      {fallo && <div className="aviso-error">{fallo}</div>}

      <form className="formulario" action={accionEditarSesion}>
        <input type="hidden" name="clienteId" value={cliente.id} />
        <input type="hidden" name="sesionId" value={sesion.id} />
        <label className="campo">
          <span>Fecha</span>
          <input type="text" name="fecha" defaultValue={sesion.fecha} placeholder="AAAA-MM-DD" required />
        </label>

        <label className="campo">
          <span>
            Sesión número{sesion.sesionesTotales ? ` (de ${sesion.sesionesTotales})` : ""}
          </span>
          <input
            type="number"
            name="numeroSesion"
            defaultValue={sesion.numeroSesion}
            min="1"
            {...(sesion.sesionesTotales ? { max: sesion.sesionesTotales } : {})}
            required
          />
        </label>

        <button type="submit" className="boton">
          Guardar cambios
        </button>
      </form>

      <BorrarSesion clienteId={cliente.id} sesionId={sesion.id} />

      <p className="aviso-texto">
        Si cambias la fecha a otra semana distinta, la facturación se traslada automáticamente de una
        semana a la otra.
      </p>
    </div>
  );
}
