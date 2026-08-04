/**
 * Fechas en hora de Madrid, nunca la del servidor.
 *
 * Vercel corre en UTC. Entre medianoche y las 2 de la madrugada en Madrid, un
 * servidor en UTC todavía estaría en «ayer» — y firmaría la sesión con la
 * fecha equivocada. Es el mismo motivo por el que el sistema Python tiene
 * `zona_horaria.py`.
 */

export const ZONA = "Europe/Madrid";

function partes(fecha: Date): Record<string, string> {
  const formato = new Intl.DateTimeFormat("es-ES", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(formato.formatToParts(fecha).map((p) => [p.type, p.value]));
}

/** `AAAA-MM-DD` de hoy en Madrid. */
export function hoyNegocio(ahora: Date = new Date()): string {
  const p = partes(ahora);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `HH:MM` de ahora en Madrid. */
export function horaNegocio(ahora: Date = new Date()): string {
  const p = partes(ahora);
  return `${p.hour}:${p.minute}`;
}

export function anioDe(fechaIso: string): number {
  return Number(fechaIso.slice(0, 4));
}

export function mesDe(fechaIso: string): number {
  return Number(fechaIso.slice(5, 7));
}

/**
 * El lunes y el domingo de la semana que contiene esa fecha.
 *
 * La semana del negocio empieza en lunes, igual que en el sistema actual.
 * Se calcula en UTC a propósito: la fecha ya viene resuelta a día de Madrid,
 * así que aquí solo se hace aritmética de calendario y no puede desplazarse.
 */
export function rangoSemana(fechaIso: string): { inicio: string; fin: string } {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  const diaSemana = (fecha.getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(fecha);
  lunes.setUTCDate(fecha.getUTCDate() - diaSemana);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  return { inicio: lunes.toISOString().slice(0, 10), fin: domingo.toISOString().slice(0, 10) };
}
