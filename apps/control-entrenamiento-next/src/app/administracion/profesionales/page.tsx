import Image from "next/image";
import Link from "next/link";

import { BarraInferior } from "@/components/BarraInferior";
import { BotonPerfil } from "@/components/BotonPerfil";
import { EstadoProfesional } from "@/components/AdminProfesionales";
import { Iconos } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { paraLaInterfaz } from "@/lib/foto-perfil";
import { exigirAdmin } from "@/lib/permisos";
import { listarProfesionales } from "@/repositories/perfiles";
import { repositorio } from "@/repositories";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Profesionales" };

/**
 * Quién trabaja en Antifrágil y quién puede entrar en la aplicación.
 *
 * SOLO EL ADMINISTRADOR. `exigirAdmin()` es la barrera: un entrenador que
 * escriba esta dirección a mano acaba en su lista de clientes. Y las dos
 * acciones —dar de alta y dar de baja— la exigen otra vez por su cuenta, así
 * que no basta con llegar a la pantalla.
 *
 * Deliberadamente pequeña: nombre, si puede entrar y su correo. Ni economía,
 * ni número de clientes, ni métricas. Eso ya está en sus pantallas.
 */
export default async function PaginaProfesionales({
  searchParams,
}: {
  searchParams: Promise<{ alta?: string }>;
}) {
  const usuario = await exigirAdmin();
  const { alta } = await searchParams;

  let profesionales;
  let sinLeer = 0;
  let clientesDe: Record<string, number> = {};
  try {
    [profesionales, sinLeer] = await Promise.all([listarProfesionales(), contarNoLeidos()]);
    // Cuántos clientes activos lleva cada uno: es lo que decide si se le puede
    // dar de baja, y decirlo antes evita el intento fallido.
    const cuentas = await Promise.all(
      profesionales.map(async (p) => [p.id, await repositorio().contarClientesActivosDe(p.id)] as const),
    );
    clientesDe = Object.fromEntries(cuentas);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  return (
    <>
      <Iconos />
      <div className="page-ancha">
        <header className="cabecera-app">
          <div className="cabecera-app-marca">
            <Image src="/logo-marca.png" alt="Antifrágil" className="logo-nav" width={120} height={32} priority />
            <BotonPerfil usuario={{ ...paraLaInterfaz(usuario), correo: usuario.correo }} />
          </div>
        </header>

        <h1>Profesionales</h1>
        <p className="subtitulo">Quién trabaja contigo y quién puede entrar en la aplicación.</p>

        {alta && (
          <p className="aviso-exito" role="status">
            {alta} ya puede entrar.
          </p>
        )}

        <Link href="/administracion/profesionales/nuevo" className="boton-principal boton-nuevo-profesional">
          + Nuevo profesional
        </Link>

        <ul className="lista-profesionales">
          {profesionales.map((p) => (
            <li key={p.id} className={`ficha-profesional${p.activo === false ? " de-baja" : ""}`}>
              <div className="ficha-profesional-quien">
                <span className="ficha-profesional-nombre">{p.nombre}</span>
                <span className="ficha-profesional-correo">{p.correo}</span>
                <span className="ficha-profesional-clientes">
                  {p.rol === "admin"
                    ? "Administrador"
                    : clientesDe[p.id] === 1
                      ? "1 cliente activo"
                      : `${clientesDe[p.id] ?? 0} clientes activos`}
                </span>
              </div>

              <div className="ficha-profesional-estado">
                <span className={`etiqueta-estado${p.activo === false ? " inactivo" : ""}`}>
                  {p.activo === false ? "Sin acceso" : "Activo"}
                </span>
                {/* Al administrador no se le ofrece darse de baja a sí mismo:
                    sin él nadie podría gestionar la aplicación. */}
                {p.rol !== "admin" && (
                  <EstadoProfesional
                    id={p.id}
                    nombre={p.nombre}
                    activo={p.activo !== false}
                    clientesActivos={clientesDe[p.id] ?? 0}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <BarraInferior activa="clientes" sinLeer={sinLeer} />
    </>
  );
}
