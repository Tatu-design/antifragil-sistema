/**
 * La cuadrícula de un mes. Solo calendario: aquí no se sabe qué es una sesión.
 *
 * Se calcula todo en UTC A PROPÓSITO. Las fechas del sistema ya vienen
 * resueltas a día de Madrid —la columna es `date` y se lee como texto, ver
 * `repositories/postgres.ts`—, así que aquí solo queda aritmética de
 * calendario. Usar la hora local del servidor sería justo lo que desplaza un
 * día las fechas cuando Vercel corre en UTC.
 */

/** La semana del negocio empieza en lunes, como en el resto del sistema. */
export const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"] as const;

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

const DIAS_LARGOS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export interface Dia {
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** El número que se pinta. */
  numero: number;
  /** `false` en los días de relleno que completan la primera y la última fila. */
  delMes: boolean;
  esHoy: boolean;
  /** Cuántas sesiones firmadas hay ese día dentro de lo que se está mirando. */
  sesiones: number;
}

export interface Mes {
  anio: number;
  mes: number;
  /** «Agosto 2026». */
  titulo: string;
  /** Seis filas como mucho, siempre de siete días. */
  semanas: Dia[][];
  /** Total del mes, sin contar los días de relleno. */
  total: number;
}

/** `AAAA-MM-DD` de un día concreto, sin pasar por la hora local. */
function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Cuántos días tiene el mes. El día 0 del siguiente es el último de este. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Qué día de la semana cae, con el lunes como 0. */
function diaSemana(fechaIso: string): number {
  return (new Date(`${fechaIso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function tituloDelMes(anio: number, mes: number): string {
  return `${MESES[mes - 1]} ${anio}`;
}

/** «Jueves, 27 de agosto». Para la cabecera del detalle de un día. */
export function tituloDelDia(fechaIso: string): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  const dia = DIAS_LARGOS[fecha.getUTCDay()];
  const numero = fecha.getUTCDate();
  const mes = MESES[fecha.getUTCMonth()].toLowerCase();
  return `${dia}, ${numero} de ${mes}`;
}

export function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

export function mesSiguiente(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

/** El primer y el último día del mes, para pedir solo ese rango a la base. */
export function rangoDelMes(anio: number, mes: number): { desde: string; hasta: string } {
  return { desde: iso(anio, mes, 1), hasta: iso(anio, mes, diasDelMes(anio, mes)) };
}

/**
 * Lee `2026-08` de la dirección. Cualquier cosa rara cae en el mes de hoy.
 *
 * No se acepta un mes inventado (`2026-13`) ni un año absurdo: el calendario
 * enseñaría una cuadrícula sin sentido y la consulta pediría un rango vacío.
 */
export function mesPedido(texto: string | undefined | null, hoy: string): { anio: number; mes: number } {
  const trozos = /^(\d{4})-(\d{2})$/.exec(texto?.trim() ?? "");
  if (trozos) {
    const anio = Number(trozos[1]);
    const mes = Number(trozos[2]);
    if (mes >= 1 && mes <= 12 && anio >= 2000 && anio <= 2100) return { anio, mes };
  }
  return { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) };
}

/** `2026-08`, tal y como viaja en la dirección. */
export function claveDelMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

/**
 * El mes entero, listo para pintar.
 *
 * `conteos` es `fecha → cuántas sesiones`. Se pasa ya hecho: construir la
 * cuadrícula no sabe de dónde salen los números, así que se puede comprobar
 * sin base de datos.
 */
export function construirMes(
  anio: number,
  mes: number,
  hoy: string,
  conteos: ReadonlyMap<string, number>,
): Mes {
  const cuantos = diasDelMes(anio, mes);
  const primero = iso(anio, mes, 1);
  const huecoInicial = diaSemana(primero);

  const dias: Dia[] = [];

  // Los últimos días del mes anterior, para que la primera fila empiece en su
  // día de la semana de verdad.
  const previo = mesAnterior(anio, mes);
  const cuantosPrevio = diasDelMes(previo.anio, previo.mes);
  for (let i = huecoInicial; i > 0; i -= 1) {
    const numero = cuantosPrevio - i + 1;
    const fecha = iso(previo.anio, previo.mes, numero);
    dias.push({ fecha, numero, delMes: false, esHoy: fecha === hoy, sesiones: 0 });
  }

  let total = 0;
  for (let numero = 1; numero <= cuantos; numero += 1) {
    const fecha = iso(anio, mes, numero);
    const sesiones = conteos.get(fecha) ?? 0;
    total += sesiones;
    dias.push({ fecha, numero, delMes: true, esHoy: fecha === hoy, sesiones });
  }

  // Y los primeros del siguiente, hasta completar la última fila.
  const siguiente = mesSiguiente(anio, mes);
  for (let numero = 1; dias.length % 7 !== 0; numero += 1) {
    const fecha = iso(siguiente.anio, siguiente.mes, numero);
    dias.push({ fecha, numero, delMes: false, esHoy: fecha === hoy, sesiones: 0 });
  }

  const semanas: Dia[][] = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));

  return { anio, mes, titulo: tituloDelMes(anio, mes), semanas, total };
}
