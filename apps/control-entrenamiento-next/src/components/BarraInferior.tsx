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
}: {
  activa: "clientes" | "economia" | "avisos";
  sinLeer?: number;
}) {
  return (
    <nav className="barra" aria-label="Secciones">
      <div className="barra-interior">
        <div className="barra-halo" aria-hidden="true" />
        <div className="barra-pestanas">
          {PESTANAS.map(({ clave, href, texto, icono }) => (
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
