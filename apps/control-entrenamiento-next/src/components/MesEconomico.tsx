import type { ResumenMes } from "@/domain/economia";
import { eurosPlano, mesEs } from "@/lib/formato";

/**
 * Un mes de Economía: su nombre y sus tres cifras.
 *
 * `destacado` es el mes en curso, que va arriba y con más peso visual. Los
 * anteriores usan el mismo lenguaje, más compacto.
 *
 * **No es pulsable a propósito.** El detalle de cada mes será otra iteración;
 * mientras tanto no debe parecer un botón que no lleva a ningún sitio.
 */
export function MesEconomico({ mes, destacado = false }: { mes: ResumenMes; destacado?: boolean }) {
  return (
    <section className={`mes-economico${destacado ? " destacado" : ""}`}>
      <h2 className="mes-economico-titulo">
        <span>
          {mesEs(mes.mes)} {mes.anio}
        </span>
        {/* Queda una parte del mes por facturar (Kids). Se dice en una
            palabra: la explicación larga vivía aquí y sobraba — quien la
            necesita entra en la ficha de CrossFit Kids. */}
        {!mes.precioMedioFiable && <span className="pill provisional">Provisional</span>}
      </h2>

      <div className="mes-economico-cifras">
        <div className="cifra">
          <span className="etiqueta">Facturación</span>
          <span className="valor">{eurosPlano(mes.facturacionTotal)}</span>
        </div>
        <div className="cifra">
          <span className="etiqueta">Horas</span>
          <span className="valor">{mes.horasTotales}</span>
        </div>
        <div className="cifra">
          <span className="etiqueta">€ / hora</span>
          {/* Un guion, no un número inventado: sin horas no hay media, y con
              Kids sin facturar la media saldría a la baja. */}
          <span className="valor">
            {mes.horasTotales > 0 && mes.precioMedioFiable ? eurosPlano(mes.precioMedioHora) : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}
