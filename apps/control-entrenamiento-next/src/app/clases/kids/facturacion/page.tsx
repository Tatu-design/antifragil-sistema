import Link from "next/link";
import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { FormularioFacturacionKids } from "@/components/FormularioFacturacionKids";
import { Iconos, Icono } from "@/components/Iconos";
import { SinConexion } from "@/components/SinConexion";
import { haySesion } from "@/lib/auth";
import { euros, mesEs } from "@/lib/formato";
import { BaseNoDisponible } from "@/repositories/postgres";
import { obtenerCuenta } from "@/services/clases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facturación de CrossFit Kids — Antifrágil" };

/**
 * Registrar lo facturado por CrossFit Kids este mes.
 *
 * El importe no se sabe hasta que acaba el mes: Fernando lo introduce aquí y
 * el sistema calcula a cuánto sale cada clase. Antes de guardar se enseña el
 * resultado, porque de ahí sale el precio por hora que verá en Economía.
 */
export default async function PaginaFacturacionKids() {
  if (!(await haySesion())) redirect("/login");

  let vista;
  try {
    vista = await obtenerCuenta("kids");
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const { ficha } = vista;
  const sinClases = ficha.sesiones === 0;

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clases/kids">
          <Icono nombre="i-arrow-left" pequeno />
          CrossFit Kids
        </Link>

        <h1>Facturación del mes</h1>
        <p className="subtitulo">
          {mesEs(ficha.mes)} {ficha.anio}
        </p>

        {sinClases ? (
          // No se puede repartir un importe entre cero clases: el precio por
          // hora no existiría. Se dice por qué, no solo que no se puede.
          <div className="aviso-texto">
            Este mes todavía no hay ninguna clase de CrossFit Kids registrada, así que no hay entre
            qué repartir la facturación. Firma primero las clases que hayas dado y vuelve aquí.
          </div>
        ) : (
          <>
            <div className="perfil-hero">
              <dl className="datos-servicio">
                <div>
                  <dt>Clases registradas</dt>
                  <dd>{ficha.sesiones}</dd>
                </div>
                {ficha.facturacion !== null && (
                  <div>
                    <dt>Ya registrado</dt>
                    <dd>{euros(ficha.facturacion)}</dd>
                  </div>
                )}
              </dl>
              {ficha.facturacion !== null && (
                <p className="meta">
                  Ya hay un importe guardado para este mes. Si escribes otro, lo sustituye.
                </p>
              )}
            </div>

            <FormularioFacturacionKids
              anio={ficha.anio}
              mes={ficha.mes}
              sesiones={ficha.sesiones}
              etiquetaMes={`${mesEs(ficha.mes)} ${ficha.anio}`}
            />
          </>
        )}
      </div>

      <BarraInferior activa="clientes" sinLeer={0} />
    </>
  );
}
