import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AccionesClase, BorrarClase } from "@/components/AccionesClase";
import { BarraInferior } from "@/components/BarraInferior";
import { Iconos, Icono } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { NOMBRES_CLASE } from "@/domain/clases";
import type { TipoClase } from "@/domain/economia";
import { haySesion } from "@/lib/auth";
import { fechaEs, mesEs } from "@/lib/formato";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerCuenta } from "@/services/clases";

export const dynamic = "force-dynamic";

const TIPOS: TipoClase[] = ["lidomare", "kids"];

export async function generateMetadata({ params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  return { title: `${NOMBRES_CLASE[tipo as TipoClase] ?? "CrossFit"} — Antifrágil` };
}

/**
 * La ficha de una cuenta de actividad: CrossFit Lidomare o CrossFit Kids.
 *
 * Una sola pantalla para las dos, porque el 80 % es igual: el mes, las clases
 * dadas, firmar, deshacer y el historial. Lo que cambia se decide con la
 * ficha que devuelve el dominio — Lidomare enseña su tarifa fija y Kids su
 * referencia mensual y su facturación.
 */
export default async function PaginaClase({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ firmada?: string; borrada?: string; facturado?: string; error?: string }>;
}) {
  if (!(await haySesion())) redirect("/login");

  const { tipo } = await params;
  if (!TIPOS.includes(tipo as TipoClase)) notFound();

  let vista;
  let sinLeer = 0;
  try {
    const [cuenta, avisos] = await Promise.all([obtenerCuenta(tipo as TipoClase), contarNoLeidos()]);
    vista = cuenta;
    sinLeer = avisos;
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const { ficha, historial } = vista;
  const { firmada, borrada, facturado, error: fallo } = await searchParams;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clientes">
          <Icono nombre="i-arrow-left" pequeno />
          Clientes
        </Link>

        <div className="ficha-titulo">
          <h1>{ficha.nombre}</h1>
          <span className="pill cuenta-actividad">CrossFit</span>
        </div>

        {firmada && <div className="aviso-guardado">✔ Clase firmada — {fechaEs(firmada)}</div>}
        {borrada && <div className="aviso-guardado">✔ Clase borrada — {fechaEs(borrada)}</div>}
        {fallo && <div className="aviso-error">{fallo}</div>}
        {facturado && <div className="aviso-guardado">✔ Facturación guardada — {facturado}</div>}

        <div className="perfil-hero">
          <div className="programa-nombre">
            {mesEs(ficha.mes)} {ficha.anio}
          </div>

          {ficha.referencia ? (
            <>
              {/* Kids: la referencia mensual, con su barra. Superarla es
                  normal y se enseña tal cual («9 de 8»). */}
              <div className="perfil-progreso">
                <div className="perfil-progreso-numeros">
                  <span className="grande">{ficha.sesiones}</span>
                  <span className="de">de {ficha.referencia} sesiones</span>
                </div>
                <div className="perfil-progreso-barra">
                  <span style={{ width: `${ficha.porcentaje ?? 0}%` }} />
                </div>
                <div className="perfil-progreso-restantes">
                  {ficha.sesiones > ficha.referencia
                    ? `${ficha.sesiones - ficha.referencia} por encima de la referencia`
                    : `Quedan ${ficha.restantes}`}
                </div>
              </div>

              <dl className="datos-servicio">
                <div>
                  <dt>Facturación del mes</dt>
                  <dd className={ficha.facturacionPendiente ? "" : "acumulado"}>
                    {ficha.facturacion !== null ? euros(ficha.facturacion) : "Pendiente de introducir"}
                  </dd>
                </div>
                {ficha.precioHora !== null && (
                  <div>
                    <dt>Precio medio</dt>
                    <dd>{euros(ficha.precioHora)}/h</dd>
                  </div>
                )}
              </dl>

              {ficha.facturacionPendiente && (
                <p className="meta">
                  Las {ficha.sesiones} {ficha.sesiones === 1 ? "hora" : "horas"} ya cuentan como trabajo
                  en Economía. Falta el importe para saber a cuánto salió cada una.
                </p>
              )}
            </>
          ) : (
            <>
              {/* Lidomare: sin tope ni barra. Cada clase son 15 € y una hora. */}
              <div className="perfil-progreso">
                <div className="perfil-progreso-numeros">
                  <span className="grande">{ficha.sesiones}</span>
                  <span className="de">
                    {ficha.sesiones === 1 ? "sesión este mes" : "sesiones este mes"}
                  </span>
                </div>
              </div>

              <dl className="datos-servicio">
                <div>
                  <dt>Por sesión</dt>
                  <dd>{euros(ficha.tarifa ?? 0)}</dd>
                </div>
                <div>
                  <dt>Facturación del mes</dt>
                  <dd className="acumulado">{euros(ficha.facturacion ?? 0)}</dd>
                </div>
              </dl>

              <p className="meta calculo-total">
                {ficha.sesiones} {ficha.sesiones === 1 ? "sesión" : "sesiones"} ×{" "}
                {euros(ficha.tarifa ?? 0)} = {euros(ficha.facturacion ?? 0)}
              </p>
            </>
          )}
        </div>

        <AccionesClase tipo={ficha.tipo} esKids={ficha.referencia !== null} />

        <div className="lista historial">
          <div className="cabecera-seccion">
            <span>
              Clases de {mesEs(ficha.mes).toLowerCase()} · {historial.length}
            </span>
          </div>

          {historial.length === 0 ? (
            <p className="empty">Todavía no hay ninguna clase este mes.</p>
          ) : (
            historial.map((clase, indice) => (
              <div key={clase.id} className="fila">
                <div className="sesion-fila">
                  <div className="sesion-badge">{historial.length - indice}</div>
                  <div className="sesion-info" style={{ flex: 1 }}>
                    <div className="fecha">{fechaEs(clase.fecha)}</div>
                    <div className="tipo">{ficha.nombre}</div>
                  </div>
                  <BorrarClase id={clase.id} tipo={ficha.tipo} fecha={fechaEs(clase.fecha)} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <BarraInferior activa="clientes" sinLeer={sinLeer} />
    </>
  );
}

function euros(valor: number): string {
  return `${valor.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
