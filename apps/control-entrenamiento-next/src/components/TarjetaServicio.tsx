import type { FichaServicio } from "@/domain/tipos";
import { nombreMes } from "@/lib/fechas";

const euros = (valor: number | null) =>
  valor === null || valor === undefined
    ? "—"
    : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(valor);

/**
 * El servicio en curso.
 *
 * Este componente **no decide nada**: `fichaServicio()` ya ha resuelto qué
 * enseñar según la modalidad. Es la lección del 2026-08-04 aplicada — cuando
 * la plantilla decidía, un `if` escrito para bonos borró el botón de firmar en
 * las otras dos modalidades sin que ninguna prueba lo viera.
 */
export function TarjetaServicio({ ficha }: { ficha: FichaServicio }) {
  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Servicio en curso">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">{ficha.servicio ?? ficha.etiqueta}</h2>
        <span className="text-xs text-tinta-suave">{ficha.etiqueta}</span>
      </div>

      {ficha.muestraBarra && ficha.sesionesTotales !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-sm">
            <span>
              {ficha.sesionesHechas} de {ficha.sesionesTotales} sesiones
            </span>
            <span className="text-tinta-suave">quedan {ficha.sesionesRestantes}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-borde"
            role="progressbar"
            aria-valuenow={ficha.porcentaje ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Sesiones consumidas del bono"
          >
            <div className="h-full rounded-full bg-acento" style={{ width: `${ficha.porcentaje ?? 0}%` }} />
          </div>
        </div>
      )}

      {!ficha.muestraBarra && (
        <p className="text-sm">
          {ficha.sesionesHechas} {ficha.sesionesHechas === 1 ? "sesión" : "sesiones"}
          {ficha.mes ? ` de ${nombreMes(ficha.mes)}` : ""}
          {ficha.sesionesReferencia ? ` · ${ficha.sesionesReferencia} de referencia` : ""}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm">
        {ficha.modalidad === "mensualidad" ? (
          <Dato titulo="Cuota del mes" valor={euros(ficha.cuotaMensual)} />
        ) : (
          <Dato titulo="Precio por sesión" valor={euros(ficha.tarifa)} />
        )}
        <Dato titulo="Total del periodo" valor={euros(ficha.facturacion)} />
        {ficha.modalidad === "mensualidad" && (
          <Dato titulo="Sale a" valor={ficha.precioEfectivo ? `${euros(ficha.precioEfectivo)}/h` : "—"} />
        )}
        {ficha.anio && ficha.mes && (
          <Dato titulo="Periodo" valor={`${nombreMes(ficha.mes)} ${ficha.anio}`} />
        )}
      </dl>

      <p className="text-xs text-tinta-suave">
        «Total del periodo» es lo <strong>producido</strong>, no necesariamente lo ya cobrado.
      </p>

      <p
        className={`rounded-tarjeta px-3 py-2 text-sm font-medium ${
          ficha.pendientePago ? "bg-aviso/10 text-aviso" : "bg-acento/10 text-acento-oscuro"
        }`}
      >
        {ficha.etiquetaPago}
      </p>
    </section>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{titulo}</dt>
      <dd className="font-medium tabular-nums">{valor}</dd>
    </div>
  );
}
