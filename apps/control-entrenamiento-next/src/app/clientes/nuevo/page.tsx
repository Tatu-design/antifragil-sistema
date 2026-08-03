import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FormularioAlta } from "@/components/FormularioAlta";
import { haySesion } from "@/lib/auth";

export default async function PaginaNuevoCliente() {
  if (!(await haySesion())) redirect("/login");

  return (
    <main className="flex flex-col gap-4">
      <Link
        href="/clientes"
        className="inline-flex items-center gap-1 text-sm text-tinta-suave hover:text-acento"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Clientes
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Nuevo cliente</h1>
      <FormularioAlta />
    </main>
  );
}
