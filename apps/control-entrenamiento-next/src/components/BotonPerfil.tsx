"use client";

import { useState } from "react";

import type { PerfilVisible } from "@/lib/foto-perfil";
import { Avatar, PanelPerfil } from "./PanelPerfil";

/**
 * La puerta a «lo mío»: la propia foto, arriba a la derecha.
 *
 * Es donde todo el mundo busca su cuenta, así que no hace falta explicarlo.
 * Sustituye a los chips «Mi cuenta» y «Salir» que estaban sueltos en la
 * cabecera — cerrar sesión también vive ahora dentro del panel, que es lo que
 * corresponde: es una acción sobre tu cuenta, no sobre la lista.
 */
export function BotonPerfil({ usuario }: { usuario: PerfilVisible & { correo: string } }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        className="boton-perfil"
        onClick={() => setAbierto(true)}
        aria-label={`Mi perfil, ${usuario.nombre}`}
      >
        <Avatar nombre={usuario.nombre} foto={usuario.fotoUrl} />
      </button>

      <PanelPerfil abierto={abierto} alCerrar={() => setAbierto(false)} usuario={usuario} />
    </>
  );
}
