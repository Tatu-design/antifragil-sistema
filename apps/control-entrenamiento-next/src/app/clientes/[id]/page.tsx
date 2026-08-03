import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BotonFirmar } from "@/components/BotonFirmar";
import { CambiarEstado } from "@/components/CambiarEstado";
import { EditarServicio } from "@/components/EditarServicio";
import { HistorialServicios } from "@/components/HistorialServicios";
import { TarjetaServicio } from "@/components/TarjetaServicio";
import { haySesion } from "@/lib/auth";
import { obtenerPerfil } from "@/services/clientes";

export const dynamic = "force-dynamic";

export default async function PaginaPerfil({ params }: { params: Promise<{ id: string }> }) {
  if (!(await haySesion())) redirect("/login");

  const { id } = await params;
  const perfil = await obtenerPerfil(id);
  if (!perfil) notFound();

  const { cliente, ficha, servicios } = perfil;

  return (
    <main className="flex flex-col gap-4">
      <Link
        href="/clientes"
        className="inline-flex items-center gap-1 text-sm text-tinta-suave hover:text-acento"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Clientes
      </Link>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            cliente.estado === "activo" ? "bg-acento/10 text-acento-oscuro" : "bg-borde text-tinta-suave"
          }`}
        >
          {cliente.estado[0]!.toUpperCase() + cliente.estado.slice(1)}
        </span>
      </header>

      <TarjetaServicio ficha={ficha} />

      {/* La firma es la acción principal: va antes que nada editable. */}
      <BotonFirmar clienteId={cliente.id} ficha={ficha} />

      <CambiarEstado clienteId={cliente.id} estado={cliente.estado} nombre={cliente.nombre} />

      <EditarServicio clienteId={cliente.id} ficha={ficha} />

      <HistorialServicios clienteId={cliente.id} servicios={servicios} />
    </main>
  );
}
