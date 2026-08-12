import Image from "next/image";

import { BarraInferior } from "@/components/BarraInferior";
import { BotonPerfil } from "@/components/BotonPerfil";
import { paraLaInterfaz } from "@/lib/foto-perfil";
import { Iconos } from "@/components/Iconos";
import { MesEconomico } from "@/components/MesEconomico";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { SelectorProfesional } from "@/components/SelectorProfesional";
import { listarProfesionales } from "@/repositories/perfiles";
import { obtenerEconomia } from "@/services/economia";
import { alcanceEconomico } from "@/domain/atribucion";

import { exigirAdmin } from "@/lib/permisos";

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
export default async function PaginaEconomia({
  searchParams,
}: {
  searchParams: Promise<{ profesional?: string }>;
}) {
  // Economía sigue siendo SOLO del administrador. Que ahora pueda mirarse por
  // profesional no le da acceso a nadie más: un entrenador que escriba la
  // dirección a mano acaba en su lista de clientes, como antes.
  const usuario = await exigirAdmin();

  const profesionales = await listarProfesionales();
  const { profesional: pedido } = await searchParams;

  // La regla de qué se está mirando vive en el dominio, no aquí: sin nadie
  // elegido se enseña el negocio entero, y un identificador inventado cae
  // también ahí. Ver `alcanceEconomico`.
  const alcance = alcanceEconomico(pedido, profesionales);

  let vista;
  let sinLeer = 0;
  try {
    const [economia, avisos] = await Promise.all([
      // Sin `profesionalId` es la economía del negocio entero. Es la MISMA
      // función y las mismas reglas: lo único que cambia es cuántas filas
      // entran, así que un profesional nuevo aparece en el total el día que se
      // le firma la primera sesión, sin tocar nada aquí.
      obtenerEconomia(alcance),
      contarNoLeidos(),
    ]);
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
            {/* Tu foto abre «lo tuyo»: nombre, foto, contraseña y cerrar
                sesión. Antes eran dos chips sueltos aquí mismo. */}
            <BotonPerfil usuario={{ ...paraLaInterfaz(usuario), correo: usuario.correo }} />
          </div>
        </header>

        <h1>Economía</h1>

        {/* Solo si hay entre quién elegir. Con un profesional, un selector de
            un botón sería ruido. */}
        {profesionales.length > 1 && (
          <SelectorProfesional
            profesionales={profesionales.map(paraLaInterfaz)}
            elegido={alcance.profesionalId}
          />
        )}

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
