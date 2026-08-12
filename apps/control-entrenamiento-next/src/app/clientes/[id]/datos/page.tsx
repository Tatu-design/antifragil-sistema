import Link from "next/link";
import { notFound } from "next/navigation";

import { FormularioDatos } from "@/components/FormularioDatos";
import { Iconos, Icono } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerPerfil } from "@/services/clientes";

import { esAdmin, exigirAccesoACliente } from "@/lib/permisos";
import { listarProfesionales } from "@/repositories/perfiles";

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
  const { id } = await params;

  // El candado. Antes de leer nada de este cliente: un entrenador que
  // escriba la dirección a mano de un cliente ajeno recibe «no existe».
  const usuario = await exigirAccesoACliente(id);
  // Solo el administrador traspasa clientes entre profesionales.
  const profesionales = esAdmin(usuario) ? await listarProfesionales() : [];
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
  const sesiones = servicios.reduce((n, s) => n + s.sesiones.length, 0);
  const tieneHistorial = sesiones > 0;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href={`/clientes/${cliente.id}`}>
          <Icono nombre="i-arrow-left" pequeno />
          {cliente.nombre}
        </Link>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <FormularioDatos
          clienteId={cliente.id}
          nombre={cliente.nombre}
          estado={cliente.estado}
          profesionalId={cliente.profesionalId}
          profesionales={profesionales}
        />

        {/* Borrar es cosa del administrador y de nadie más. Un entrenador ni
            siquiera ve esta parte: antes veía el botón y al pulsarlo se le
            echaba, que es peor que no verlo (2026-08-12). */}
        {esAdmin(usuario) && (
          <div className="zona-peligrosa">
            <p className="zona-peligrosa-titulo">Zona peligrosa</p>
            <p className="meta">
              {tieneHistorial ? (
                <>
                  Este cliente tiene <strong>{sesiones} sesiones</strong> y su facturación se restará de la
                  economía. Si ha dejado de entrenar pero fue un cliente de verdad, es mejor ponerlo como{" "}
                  <strong>Cancelado</strong> aquí arriba: desaparece de la lista y conserva su historial.
                  Borrar es para las pruebas y los errores.
                </>
              ) : (
                <>
                  Este cliente no tiene ninguna sesión registrada, así que se borra sin perder nada.
                </>
              )}
            </p>
            <Link className="boton-secundario boton-peligro" href={`/clientes/${cliente.id}/eliminar`}>
              <Icono nombre="i-trash-2" pequeno />
              Borrar este cliente
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
