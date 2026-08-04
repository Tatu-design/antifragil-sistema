import Image from "next/image";
import { redirect } from "next/navigation";

import { accionResolverAviso, accionResolverTipo } from "@/app/actions";
import { BarraInferior } from "@/components/BarraInferior";
import { Iconos } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { haySesion } from "@/lib/auth";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos, listarAvisos, marcarTodosLeidos } from "@/services/avisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Avisos" };

/** Misma estructura que `webapp/templates/avisos.html`. */
export default async function PaginaAvisos() {
  if (!(await haySesion())) redirect("/login");

  let avisos;
  let sinLeer = 0;
  try {
    avisos = await listarAvisos();
    // El punto de la barra se lee ANTES de marcarlos: si no, entrar aquí lo
    // apagaría antes de dibujarlo.
    sinLeer = await contarNoLeidos();
    // Entrar aquí los marca como VISTOS, no como resueltos: verlo no lo arregla.
    await marcarTodosLeidos();
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const conteoPorTipo = new Map<string, number>();
  for (const aviso of avisos) conteoPorTipo.set(aviso.tipo, (conteoPorTipo.get(aviso.tipo) ?? 0) + 1);

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

        <h1>Avisos</h1>
        <p className="subtitulo">Cosas que la actualización diaria no pudo procesar sola</p>

        {/* Un mismo motivo puede generar muchos avisos seguidos: limpiarlos de
            uno en uno es inviable — le pasó a Fernando con 28 de golpe. */}
        {conteoPorTipo.size > 0 && (
          <div className="acciones-perfil" style={{ flexWrap: "wrap" }}>
            {[...conteoPorTipo.entries()].map(([tipo, n]) =>
              n > 1 ? (
                <form action={accionResolverTipo} key={tipo}>
                  <input type="hidden" name="tipo" value={tipo} />
                  <button type="submit" className="boton-secundario">
                    Descartar todos — {tipo.replaceAll("_", " ")} ({n})
                  </button>
                </form>
              ) : null,
            )}
          </div>
        )}

        <div className="lista">
          {avisos.length === 0 ? (
            <p className="empty">No hay avisos pendientes.</p>
          ) : (
            avisos.map((aviso) => (
              <div className="fila" key={aviso.id}>
                <div className="cabecera">
                  <span className="nombre">{aviso.fecha}</span>
                  {!aviso.leido && <span className="pill aldia">Nuevo</span>}
                </div>
                <div className="programa">{aviso.tipo.replaceAll("_", " ")}</div>
                <div className="meta">{aviso.detalle}</div>
                <form action={accionResolverAviso} style={{ marginTop: "0.5rem" }}>
                  <input type="hidden" name="id" value={aviso.id} />
                  <button
                    type="submit"
                    className="editar"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                  >
                    Descartar →
                  </button>
                </form>
              </div>
            ))
          )}
        </div>
      </div>

      <BarraInferior activa="avisos" sinLeer={sinLeer} />
    </>
  );
}
