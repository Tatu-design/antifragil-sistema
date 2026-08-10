import type { Modalidad } from "./modalidades";
import type { Estado } from "./tipos";

/**
 * Qué clientes se ven con los filtros puestos.
 *
 * Vive aparte del componente para poder probarlo: es una regla con cinco
 * condiciones que se cruzan, y de esas no se detecta a ojo cuál se ha roto.
 *
 * **Esto NO es seguridad.** Un entrenador nunca recibe los clientes de otro:
 * eso se resuelve filtrando en la consulta, mucho antes de llegar aquí. Esto
 * solo decide qué se enseña de lo que ya se tiene derecho a ver.
 */

export interface Filtros {
  /** `"todos"` o el identificador de un profesional. */
  profesional: string;
  /** Vacío = cualquier estado. */
  estados: Estado[];
  /** Vacío = cualquier modalidad. */
  modalidades: Modalidad[];
}

export interface Filtrable {
  nombre: string;
  estado: Estado;
  debe: boolean;
  profesionalId: string | null;
  modalidad: Modalidad;
}

/**
 * Sin acentos y en minúsculas.
 *
 * Buscar «rocio» tiene que encontrar a «Rocío»: nadie escribe acentos en el
 * buscador del móvil con prisa. `NFD` separa la letra de su tilde y el rango
 * borra las tildes sueltas.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Los filtros se SUMAN: pedir «los de Rafa» y «pendientes de pago» deja solo
 * los que cumplen las dos cosas, no la suma de ambos grupos.
 */
export function coincide(
  cliente: Filtrable,
  {
    busqueda = "",
    soloPendientes = false,
    filtros,
  }: { busqueda?: string; soloPendientes?: boolean; filtros: Filtros },
): boolean {
  const buscado = normalizar(busqueda.trim());
  if (buscado !== "" && !normalizar(cliente.nombre).includes(buscado)) return false;
  if (soloPendientes && !cliente.debe) return false;
  if (filtros.profesional !== "todos" && cliente.profesionalId !== filtros.profesional) return false;
  if (filtros.estados.length > 0 && !filtros.estados.includes(cliente.estado)) return false;
  if (filtros.modalidades.length > 0 && !filtros.modalidades.includes(cliente.modalidad)) return false;
  return true;
}

/** Con qué se abre la pantalla: los activos, que es lo que se mira casi siempre. */
export const FILTROS_INICIALES: Filtros = {
  profesional: "todos",
  estados: ["activo"],
  modalidades: [],
};

/**
 * Cuántos filtros hay puestos, para avisarlo en el botón.
 *
 * Abrir en «activos» es el punto de partida, no un filtro: no cuenta. Si
 * contara, el botón diría siempre «1» y el aviso dejaría de significar nada.
 */
export function filtrosPuestos(filtros: Filtros): number {
  return (
    (filtros.profesional !== "todos" ? 1 : 0) +
    (filtros.estados.length === 1 && filtros.estados[0] === "activo" ? 0 : 1) +
    (filtros.modalidades.length > 0 ? 1 : 0)
  );
}
