import { redirect } from "next/navigation";

import { FormularioLogin } from "@/components/FormularioLogin";
import { haySesion } from "@/lib/auth";

export default async function PaginaLogin() {
  if (await haySesion()) redirect("/clientes");

  return (
    <main className="flex min-h-[80dvh] flex-col justify-center gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Antifrágil</h1>
        <p className="mt-1 text-sm text-tinta-suave">Control de entrenamiento personal</p>
      </header>
      <FormularioLogin />
      <p className="text-center text-xs text-tinta-suave">
        Entorno de pruebas con datos ficticios. No contiene información de clientes reales.
      </p>
    </main>
  );
}
