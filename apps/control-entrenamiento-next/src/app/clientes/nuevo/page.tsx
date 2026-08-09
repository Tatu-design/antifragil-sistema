import Link from "next/link";

import { FormularioAlta } from "@/components/FormularioAlta";
import { Iconos } from "@/components/Iconos";

import { exigirAdmin } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo cliente — Antifrágil" };

/** Misma estructura que `webapp/templates/nuevo.html`. */
export default async function PaginaNuevoCliente({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await exigirAdmin();

  const { error: fallo } = await searchParams;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clientes">
          ← Volver
        </Link>

        {fallo && <div className="aviso-error">{fallo}</div>}

        <FormularioAlta />
      </div>
    </>
  );
}
