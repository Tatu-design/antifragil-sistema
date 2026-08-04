/** Mientras carga. La app Flask no tiene esqueleto: enseña una línea de
 *  progreso arriba (`carga.js`). Aquí basta con no enseñar nada roto. */
export default function Cargando() {
  return <div className="page" aria-busy="true" />;
}
