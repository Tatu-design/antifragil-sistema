import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { ListaAvisos } from "@/components/ListaAvisos";
import { haySesion } from "@/lib/auth";
import { listarAvisos, marcarTodosLeidos } from "@/services/avisos";

export const dynamic = "force-dynamic";

export default async function PaginaAvisos() {
  if (!(await haySesion())) redirect("/login");

  const avisos = await listarAvisos();
  // Entrar aquí los marca como VISTOS, no como resueltos: verlo no lo arregla.
  await marcarTodosLeidos();

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Avisos</h1>
      <ListaAvisos avisos={avisos} />
      <BarraInferior activa="avisos" />
    </main>
  );
}
