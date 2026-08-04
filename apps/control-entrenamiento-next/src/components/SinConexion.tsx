/**
 * Cuando la base de datos no responde.
 *
 * Pasa de verdad con el plan gratuito de Supabase. Sin esto salía un «Algo ha
 * fallado» genérico que no dice si el problema es tuyo, del código o del
 * servidor.
 */
export function SinConexion() {
  return (
    <div className="page sin-barra">
      <h1>No se puede conectar</h1>
      <p className="subtitulo">
        La base de datos no responde. No es culpa tuya y no se ha perdido nada:
        vuelve a intentarlo en un minuto.
      </p>
    </div>
  );
}
