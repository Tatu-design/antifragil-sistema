import Link from "next/link";

import { Icono } from "./Iconos";

/** Copia exacta de la barra de `webapp/templates/index.html`, con su halo. */
const PESTANAS = [
  { clave: "clientes", href: "/clientes", texto: "Clientes", icono: "i-users" },
  { clave: "economia", href: "/economia", texto: "Economía", icono: "i-euro" },
  { clave: "avisos", href: "/avisos", texto: "Avisos", icono: "i-bell" },
] as const;

export function BarraInferior({
  activa,
  sinLeer = 0,
  soloClientes = false,
}: {
  activa: "clientes" | "economia" | "avisos";
  sinLeer?: number;
  /**
   * Un entrenador no tiene Economía ni Avisos: son del administrador. Sin
   * esto vería dos pestañas que le responderían «no existe» al pulsarlas.
   *
   * Esconderlas es cortesía, no seguridad: lo que impide entrar es
   * `exigirAdmin()` en cada una de esas pantallas.
   */
  soloClientes?: boolean;
}) {
  const pestanas = soloClientes ? PESTANAS.filter((p) => p.clave === "clientes") : PESTANAS;

  return (
    <nav className="barra" aria-label="Secciones">
      <div className="barra-interior">
        <div className="barra-halo" aria-hidden="true" />
        <div className="barra-pestanas">
          {pestanas.map(({ clave, href, texto, icono }) => (
            <Link key={clave} className={`pestana${clave === activa ? " activa" : ""}`} href={href}>
              <Icono nombre={icono} />
              {clave === "avisos" && sinLeer > 0 && <span className="pestana-punto">{sinLeer}</span>}
              <span>{texto}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
