import Link from "next/link";
import { redirect } from "next/navigation";

import { FormularioAlta } from "@/components/FormularioAlta";
import { Iconos } from "@/components/Iconos";
import { haySesion } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nuevo cliente — Antifrágil" };

/** Misma estructura que `webapp/templates/nuevo.html`. */
export default async function PaginaNuevoCliente({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await haySesion())) redirect("/login");

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
