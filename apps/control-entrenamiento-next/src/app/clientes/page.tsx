import Image from "next/image";
import Link from "next/link";

import { BarraInferior } from "@/components/BarraInferior";
import { Iconos, Icono } from "@/components/Iconos";
import { ListaClientes } from "@/components/ListaClientes";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerCuenta } from "@/services/clases";
import { listarClientes } from "@/services/clientes";

import { esAdmin, exigirUsuario } from "@/lib/permisos";
import { listarProfesionales } from "@/repositories/perfiles";
import type { Perfil } from "@/repositories/tipos";
import type { FichaClase } from "@/domain/clases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Clientes" };

/** Misma estructura que `webapp/templates/index.html`. */
export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ guardado?: string; eliminado?: string }>;
}) {
  const usuario = await exigirUsuario();
  const admin = esAdmin(usuario);

  let clientes;
  let cuentas: FichaClase[] = [];
  let sinLeer = 0;
  let profesionales: Perfil[] = [];
  try {
    // Las cuatro lecturas van a la vez: contra Supabase cada consulta es un
    // viaje de red, y esta es la pantalla que más se abre.
    // Un entrenador ve SOLO sus clientes, y el filtro llega hasta el SQL.
    // Tampoco se le piden los avisos ni las cuentas de CrossFit: son del
    // administrador, así que serían dos viajes de red para nada.
    if (admin) {
      const [lista, avisos, lidomare, kids] = await Promise.all([
        listarClientes(),
        contarNoLeidos(),
        obtenerCuenta("lidomare"),
        obtenerCuenta("kids"),
      ]);
      clientes = lista;
      sinLeer = avisos;
      cuentas = [lidomare.ficha, kids.ficha];
      profesionales = await listarProfesionales();
    } else {
      clientes = await listarClientes(usuario.id);
      cuentas = [];
    }
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const { guardado, eliminado } = await searchParams;

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

        <div className="cabecera-pagina">
          <h1>{admin ? "Lista de clientes" : "Mis clientes"}</h1>
          {/* Dar de alta es cosa del administrador. */}
          {admin && (
            <Link className="boton-nuevo" href="/clientes/nuevo">
              <Icono nombre="i-plus" pequeno />
              Nuevo
            </Link>
          )}
        </div>

        {guardado && <div className="aviso-guardado">✔ Guardado: {guardado}</div>}
        {eliminado && <div className="aviso-guardado">✔ Cliente borrado: {eliminado}</div>}

        <ListaClientes clientes={clientes} cuentas={cuentas} profesionales={profesionales} />
      </div>

      <BarraInferior activa="clientes" sinLeer={sinLeer} soloClientes={!admin} />
    </>
  );
}
