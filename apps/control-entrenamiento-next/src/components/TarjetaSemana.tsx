import type { ResumenSemana } from "@/domain/economia";
import { fechaEs } from "@/lib/fechas";

const euros = (v: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

/**
 * La última semana con movimiento.
 *
 * Una semana a caballo entre dos meses se muestra ENTERA: es lo que se espera
 * al mirar «esta semana». El reparto por meses lo hace la vista mensual.
 */
export function TarjetaSemana({ semana }: { semana: ResumenSemana | null }) {
  if (!semana) {
    return (
      <section className="tarjeta text-sm text-tinta-suave" aria-label="Semana">
        Todavía no hay ninguna semana con sesiones registradas.
      </section>
    );
  }

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Resumen de la semana">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">Semana</h2>
        <span className="text-xs text-tinta-suave">
          {fechaEs(semana.inicio)} – {fechaEs(semana.fin)}
        </span>
      </div>

      {semana.provisional && (
        <p className="rounded-tarjeta bg-aviso/10 px-3 py-2 text-xs text-aviso">
          Provisional: faltan por introducir los {semana.sesionesKids === 1 ? "datos de la clase" : "datos de las clases"} de
          CrossFit Kids de este mes, así que ni su dinero ni sus horas están contados todavía.
        </p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Cifra titulo="Facturado" valor={euros(semana.facturacionTotal)} />
        <Cifra titulo="Horas" valor={String(semana.horasTotales)} />
        <Cifra titulo="Media/hora" valor={euros(semana.precioMedioHora)} />
      </dl>
    </section>
  );
}

function Cifra({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{titulo}</dt>
      <dd className="text-lg font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}
