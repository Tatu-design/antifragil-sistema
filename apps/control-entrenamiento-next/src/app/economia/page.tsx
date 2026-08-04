import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { ClasesDeGrupo } from "@/components/ClasesDeGrupo";
import { ResumenMensual } from "@/components/ResumenMensual";
import { TarjetaSemana } from "@/components/TarjetaSemana";
import { haySesion } from "@/lib/auth";
import { obtenerEconomia } from "@/services/economia";

export const dynamic = "force-dynamic";

export default async function PaginaEconomia() {
  if (!(await haySesion())) redirect("/login");

  const { semana, meses, clasesEstaSemana } = await obtenerEconomia();

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Economía</h1>

      <TarjetaSemana semana={semana} />

      <ClasesDeGrupo clases={clasesEstaSemana} />

      <ResumenMensual meses={meses} />

      <BarraInferior activa="economia" />
    </main>
  );
}
