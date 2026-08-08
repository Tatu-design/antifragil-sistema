import Image from "next/image";
import { redirect } from "next/navigation";

import { BarraInferior } from "@/components/BarraInferior";
import { Iconos } from "@/components/Iconos";
import { Metricas } from "@/components/Metricas";
import { SinConexion } from "@/components/SinConexion";
import { haySesion } from "@/lib/auth";
import { hoyNegocio } from "@/lib/fechas";
import { eurosPlano, mesEs } from "@/lib/formato";
import { BaseNoDisponible } from "@/repositories/postgres";
import { contarNoLeidos } from "@/services/avisos";
import { obtenerEconomia } from "@/services/economia";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antifrágil — Economía" };

const ETIQUETAS_MODALIDAD: Array<[string, string]> = [
  ["bono", "Bonos"],
  ["mensualidad", "Mensualidades"],
  ["cuenta", "Cuentas de cliente"],
];

/** Misma estructura que `webapp/templates/economia.html`. */
export default async function PaginaEconomia({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await haySesion())) redirect("/login");

  let vista;
  let sinLeer = 0;
  try {
    vista = await obtenerEconomia();
    sinLeer = await contarNoLeidos();
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }

  const { error: fallo } = await searchParams;
  const { semana, meses } = vista;

  const hoy = hoyNegocio();
  const anio = Number(hoy.slice(0, 4));
  const numeroMes = Number(hoy.slice(5, 7));
  const mes = meses.find((m) => m.anio === anio && m.mes === numeroMes) ?? null;
  const anteriores = meses.filter((m) => !(m.anio === anio && m.mes === numeroMes));

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

        <h1>Economía</h1>
        <p className="subtitulo">
          Facturación por sesiones hechas (no por pagos recibidos). Para firmar clases de
          CrossFit, entra en su ficha desde la lista de clientes.
        </p>

        {fallo && <div className="aviso-error">{fallo}</div>}

        {/* Las clases de CrossFit ya NO se firman aquí (2026-08-08). Economía
            es pantalla de consulta; se firman desde su propia ficha, igual que
            se le firma una sesión a un cliente. Tener dos sitios para lo mismo
            era pedir que un día se contara dos veces. */}

        <div className="economia-resumen-grid">
          <div className="lista">
            <div className="cabecera-seccion">
              <span>Última semana cerrada</span>
              {semana && <span className="fecha-seccion">desde {semana.inicio}</span>}
            </div>

            {semana ? (
              <>
                {semana.provisional && (
                  <p className="aviso-texto">
                    ⚠ Incompleto — quedan clases de CrossFit Kids sin facturación introducida. Sus
                    horas ya están contadas, pero su dinero todavía no.
                  </p>
                )}
                <Metricas
                  facturacion={semana.facturacionTotal}
                  horas={semana.horasTotales}
                  medio={semana.precioMedioHora}
                />
                {semana.sesionesKids > 0 && (
                  <p className="nota">
                    CrossFit Kids: {semana.sesionesKids} sesiones
                    {semana.facturacionKids === null &&
                      " (facturación pendiente de que indiques el importe mensual)"}
                  </p>
                )}
              </>
            ) : (
              <p className="empty">
                Todavía no se ha cerrado ninguna semana. Se registra al confirmar el cierre semanal.
              </p>
            )}
          </div>

          <div className="lista" style={{ marginTop: "1rem" }}>
            <div className="cabecera-seccion">
              <span>
                {mesEs(numeroMes)} {anio}
              </span>
            </div>

            {mes ? (
              <>
                {mes.provisional && (
                  <p className="aviso-texto">
                    ⚠ Incompleto — quedan clases de CrossFit Kids sin facturación introducida. Sus
                    horas ya están contadas, pero su dinero todavía no, así que el precio medio no se
                    puede dar por bueno. Introdúcelo desde la ficha de CrossFit Kids.
                  </p>
                )}
                <Metricas
                  facturacion={mes.facturacionTotal}
                  horas={mes.horasTotales}
                  medio={mes.precioMedioHora}
                  medioFiable={mes.precioMedioFiable}
                />

                {/* De dónde sale el dinero del mes. Una mensualidad factura su
                    cuota entera aunque sus sesiones no lleven importe, así que
                    sin este desglose los números no se explican solos. */}
                {Object.keys(mes.porModalidad).length > 0 && (
                  <div className="fila">
                    <div className="desglose-modalidad">
                      {ETIQUETAS_MODALIDAD.map(([clave, etiqueta]) => {
                        const datos = mes.porModalidad[clave];
                        if (!datos) return null;
                        return (
                          <div className="sesion-fila" key={clave}>
                            <div className="sesion-info" style={{ flex: 1 }}>
                              <div className="fecha">{etiqueta}</div>
                              <div className="tipo">{datos.horas} h reales</div>
                            </div>
                            <span className="cifra">{eurosPlano(datos.facturacion)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {mes.facturacionCuotas > 0 && (
                  <p className="meta" style={{ padding: "0 1.25rem 1rem" }}>
                    Incluye {eurosPlano(mes.facturacionCuotas)} de {mes.numeroCuotas}{" "}
                    {mes.numeroCuotas === 1 ? "cuota mensual" : "cuotas mensuales"}. Las sesiones de una
                    mensualidad suman horas, no dinero: su importe ya está en la cuota.
                  </p>
                )}

                {mes.ajusteImporte > 0 && (
                  <p className="aviso-texto">
                    Incluye un ajuste de {eurosPlano(mes.ajusteImporte)} y {mes.ajusteHoras} h de sesiones
                    facturadas antes de que se registraran las fechas.
                    {mes.ajustes.map((a) => (
                      <span key={a.origen}>
                        <br />
                        <span className="meta">{a.motivo}</span>
                      </span>
                    ))}
                  </p>
                )}
              </>
            ) : (
              <p className="empty">Todavía no hay ninguna sesión ni clase registrada este mes.</p>
            )}
          </div>
        </div>

        <div className="lista" style={{ marginTop: "1rem" }}>
          <div className="cabecera-seccion">
            <span>Historial de meses</span>
          </div>

          {anteriores.length === 0 ? (
            <p className="empty">Todavía no hay ningún mes anterior completado.</p>
          ) : (
            anteriores.map((m) => (
              <div className="fila" key={`${m.anio}-${m.mes}`}>
                <div className="cabecera">
                  <span className="nombre">
                    {mesEs(m.mes)} {m.anio}
                  </span>
                </div>
                {m.provisional && (
                  <p className="aviso-texto">
                    ⚠ Provisional — falta introducir la facturación de CrossFit Kids de este mes.
                  </p>
                )}
                <Metricas
                  facturacion={m.facturacionTotal}
                  horas={m.horasTotales}
                  medio={m.precioMedioHora}
                  medioFiable={m.precioMedioFiable}
                  compacta
                />
                {m.ajusteImporte > 0 && (
                  <p className="meta">
                    Incluye {eurosPlano(m.ajusteImporte)} y {m.ajusteHoras} h de sesiones facturadas antes del
                    registro de fechas.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <BarraInferior activa="economia" sinLeer={sinLeer} />
    </>
  );
}
