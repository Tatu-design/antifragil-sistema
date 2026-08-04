import { eurosPlano } from "@/lib/formato";

/** Las tres cifras de una semana o un mes, en el mismo orden que Flask. */
export function Metricas({
  facturacion,
  horas,
  medio,
  compacta = false,
}: {
  facturacion: number;
  horas: number;
  medio: number;
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
        <span className="valor">{eurosPlano(medio)}</span>
      </div>
    </div>
  );
}
