/**
 * Cómo se llama cada tipo de aviso en pantalla.
 *
 * Vive en el dominio y no en el servicio porque lo usa un componente del
 * navegador: el servicio abre la base de datos y no puede acabar ahí.
 */
export const ETIQUETAS_AVISO: Record<string, string> = {
  servicio_terminado: "Servicio terminado",
  ultima_sesion: "Última sesión",
  descuadre: "Descuadre económico",
};

export function etiquetaAviso(tipo: string): string {
  return ETIQUETAS_AVISO[tipo] ?? tipo;
}
