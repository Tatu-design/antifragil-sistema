import { notFound } from "next/navigation";

import { ConfirmarSesion } from "@/components/ConfirmarSesion";
import { fechaEs, nombreMes } from "@/lib/fechas";
import { obtenerPerfilPublico } from "@/services/publico";

export const dynamic = "force-dynamic";

const euros = (v: number | null) =>
  v === null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

/**
 * El perfil que ve el propio cliente con su enlace.
 *
 * Es público a propósito: no pide contraseña. Lo que protege es el token, que
 * solo tiene esa persona. Deliberadamente NO se enseña nada de dinero
 * pendiente ni de otros clientes.
 */
export default async function PaginaMiPerfil({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const perfil = await obtenerPerfilPublico(token);
  if (!perfil) notFound();

  const { nombre, ficha, ultimas, pendientesHoy, confirmadasHoy } = perfil;

  return (
    <main className="flex flex-col gap-4">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{nombre}</h1>
        <p className="text-sm text-tinta-suave">Antifrágil · Entrenamiento personal</p>
      </header>

      <section className="tarjeta flex flex-col gap-3" aria-label="Tu servicio">
        <h2 className="font-medium">{ficha.servicio ?? ficha.etiqueta}</h2>

        {ficha.muestraBarra && ficha.sesionesTotales !== null ? (
          <>
            <div className="flex justify-between text-sm">
              <span>
                {ficha.sesionesHechas} de {ficha.sesionesTotales} sesiones
              </span>
              <span className="text-tinta-suave">te quedan {ficha.sesionesRestantes}</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-borde"
              role="progressbar"
              aria-valuenow={ficha.porcentaje ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Sesiones consumidas"
            >
              <div className="h-full rounded-full bg-acento" style={{ width: `${ficha.porcentaje ?? 0}%` }} />
            </div>
          </>
        ) : (
          <p className="text-sm">
            {ficha.sesionesHechas} {ficha.sesionesHechas === 1 ? "sesión" : "sesiones"}
            {ficha.mes ? ` en ${nombreMes(ficha.mes)}` : ""}
          </p>
        )}

        {ficha.modalidad === "mensualidad" && (
          <p className="text-sm text-tinta-suave">Cuota del mes: {euros(ficha.cuotaMensual)}</p>
        )}
      </section>

      <ConfirmarSesion
        token={token}
        pendientes={pendientesHoy.length}
        confirmadas={confirmadasHoy}
      />

      {ultimas.length > 0 && (
        <section className="tarjeta flex flex-col gap-2" aria-label="Tus últimas sesiones">
          <h2 className="font-medium">Tus últimas sesiones</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {ultimas.map((s) => (
              <li key={s.id} className="flex justify-between border-t border-borde pt-1 first:border-0 first:pt-0">
                <span>{fechaEs(s.fecha)}</span>
                <span className="text-tinta-suave tabular-nums">
                  sesión {s.numeroSesion}
                  {s.hora ? ` · ${s.hora}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
