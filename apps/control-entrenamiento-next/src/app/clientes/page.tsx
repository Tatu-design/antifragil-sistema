import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { BotonSalir } from "@/components/BotonSalir";
import { FiltrosClientes } from "@/components/FiltrosClientes";
import { contarNoLeidos } from "@/services/avisos";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { haySesion } from "@/lib/auth";
import { listarClientes } from "@/services/clientes";

// El repositorio de staging escribe en disco, así que esta pantalla se calcula
// en cada petición: si se cacheara, firmar una sesión no se vería.
export const dynamic = "force-dynamic";

export default async function PaginaClientes() {
  if (!(await haySesion())) redirect("/login");

  let clientes;
  let sinLeer = 0;
  try {
    clientes = await listarClientes();
    sinLeer = await contarNoLeidos();
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  return (
    <main className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lista de clientes</h1>
        <Link
          href="/clientes/nuevo"
          aria-label="Nuevo cliente"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-tarjeta bg-acento text-white transition hover:bg-acento-oscuro"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </header>

      <FiltrosClientes clientes={clientes} />

      <BotonSalir />

      <BarraInferior activa="clientes" sinLeer={sinLeer} />
    </main>
  );
}
