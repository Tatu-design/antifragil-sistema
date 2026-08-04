import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { ClasesDeGrupo } from "@/components/ClasesDeGrupo";
import { ResumenMensual } from "@/components/ResumenMensual";
import { TarjetaSemana } from "@/components/TarjetaSemana";
import { contarNoLeidos } from "@/services/avisos";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { haySesion } from "@/lib/auth";
import { obtenerEconomia } from "@/services/economia";

export const dynamic = "force-dynamic";

export default async function PaginaEconomia() {
  if (!(await haySesion())) redirect("/login");

  let vista;
  let sinLeer = 0;
  try {
    vista = await obtenerEconomia();
    sinLeer = await contarNoLeidos();
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  const { semana, meses, clasesEstaSemana } = vista;

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Economía</h1>

      <TarjetaSemana semana={semana} />

      <ClasesDeGrupo clases={clasesEstaSemana} />

      <ResumenMensual meses={meses} />

      <BarraInferior activa="economia" sinLeer={sinLeer} />
    </main>
  );
}
