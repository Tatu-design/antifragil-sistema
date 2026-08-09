import Link from "next/link";

import { FormularioAlta } from "@/components/FormularioAlta";
import { Iconos } from "@/components/Iconos";

import { esAdmin, exigirUsuario } from "@/lib/permisos";
import { listarProfesionales } from "@/repositories/perfiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo cliente — Antifrágil" };

/** Misma estructura que `webapp/templates/nuevo.html`. */
export default async function PaginaNuevoCliente({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const quien = await exigirUsuario();
  // A un entrenador se le ofrece una sola opción —él— así que el selector no
  // llega a dibujarse. La decisión de verdad no está aquí: está en la acción,
  // que ignora lo que venga en el formulario si no es administrador.
  const profesionales = esAdmin(quien) ? await listarProfesionales() : [];

  const { error: fallo } = await searchParams;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clientes">
          ← Volver
        </Link>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <FormularioAlta profesionales={profesionales} porDefecto={quien.id} />
      </div>
    </>
  );
}
