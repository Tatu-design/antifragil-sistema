import Image from "next/image";
import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { Iconos } from "@/components/Iconos";
import { MesEconomico } from "@/components/MesEconomico";
import { SinConexion } from "@/components/SinConexion";
import { haySesion } from "@/lib/auth";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerEconomia } from "@/services/economia";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Economía" };

/**
 * Economía responde a una sola pregunta: cómo va la producción cada mes.
 *
 * Nada más (decisión de Fernando, 2026-08-08). Fuera la semana, el desglose
 * por modalidades, las cuotas, los ajustes y los párrafos explicativos: eran
 * respuestas a preguntas que no se estaban haciendo. Tres cifras por mes y el
 * mes en curso arriba, con más peso visual que los anteriores.
 *
 * Aquí no se firma nada. Las clases de CrossFit se firman en su ficha, igual
 * que las sesiones de un cliente en la suya.
 */
export default async function PaginaEconomia() {
  if (!(await haySesion())) redirect("/login");

  let vista;
  let sinLeer = 0;
  try {
    const [economia, avisos] = await Promise.all([obtenerEconomia(), contarNoLeidos()]);
    vista = economia;
    sinLeer = avisos;
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const { mesActual, anteriores } = vista;

  return (
    <>
      <Iconos />
      <div className="page-ancha">
        <header className="cabecera-app">
          <div className="cabecera-app-marca">
            <Image src="/logo-marca.png" alt="Antifrágil" className="logo-nav" width={120} height={32} priority />
            {/* Enlace normal, no `<Link>`: el enrutador precarga los enlaces
                a la vista, y precargar «Salir» cerraba la sesión sola. */}
            <a className="chip-cabecera" href="/salir">
              Salir
            </a>
          </div>
        </header>

        <h1>Economía</h1>

        <MesEconomico mes={mesActual} destacado />

        {anteriores.length > 0 && (
          <>
            <h2 className="titulo-seccion">Meses anteriores</h2>
            <div className="meses-anteriores">
              {anteriores.map((mes) => (
                <MesEconomico key={`${mes.anio}-${mes.mes}`} mes={mes} />
              ))}
            </div>
          </>
        )}
      </div>

      <BarraInferior activa="economia" sinLeer={sinLeer} />
    </>
  );
}
