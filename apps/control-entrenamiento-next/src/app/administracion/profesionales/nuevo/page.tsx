import Link from "next/link";

import { FormularioProfesional } from "@/components/AdminProfesionales";
import { Iconos } from "@/components/Iconos";
import { exigirAdmin } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Nuevo profesional" };

/**
 * Dar de alta a alguien del equipo.
 *
 * SOLO EL ADMINISTRADOR, comprobado aquí y otra vez dentro de la acción que
 * escribe: llegar a la pantalla y poder crear son dos permisos distintos y los
 * dos se exigen por separado.
 */
export default async function PaginaNuevoProfesional() {
  await exigirAdmin();

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link href="/administracion/profesionales" className="volver">
          ← Profesionales
        </Link>

        <h1>Nuevo profesional</h1>
        <p className="subtitulo">
          Podrá entrar con su propio acceso y llevar sus clientes con bono, como Rafa.
        </p>

        <FormularioProfesional />
      </div>
    </>
  );
}
