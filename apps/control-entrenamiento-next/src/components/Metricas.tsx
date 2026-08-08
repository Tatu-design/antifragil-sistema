import { eurosPlano } from "@/lib/formato";

/** Las tres cifras de una semana o un mes, en el mismo orden que Flask. */
export function Metricas({
  facturacion,
  horas,
  medio,
  medioFiable = true,
  compacta = false,
}: {
  facturacion: number;
  horas: number;
  medio: number;
  /** `false` cuando falta el importe de Kids: sus horas ya cuentan y su dinero
   *  todavía no, así que el medio saldría a la baja. Se enseña un guion en vez
   *  de un número que no se sostiene (2026-08-08). */
  medioFiable?: boolean;
  compacta?: boolean;
}) {
  return (
    <div className="metricas" style={compacta ? { padding: "0.5rem 0 0" } : undefined}>
      <div className="metrica">
        <span className="label">Facturación</span>
        <span className="valor">{eurosPlano(facturacion)}</span>
      </div>
      <div className="metrica">
        <span className="label">Horas</span>
        <span className="valor">{horas}</span>
      </div>
      <div className="metrica">
        <span className="label">€ / hora</span>
        <span className="valor">{medioFiable ? eurosPlano(medio) : "—"}</span>
      </div>
    </div>
  );
}
