/**
 * Las cosas del negocio, tal y como las entiende la aplicación.
 *
 * Nada aquí depende de dónde estén guardadas: el mismo tipo vale para el
 * repositorio de staging y para Supabase.
 *
 * **Sobre el identificador.** El sistema actual usa el NOMBRE del cliente como
 * clave, y de él cuelgan historial, ciclos y cargos. Aquí cada cliente tiene un
 * `id` estable e interno, y el nombre pasa a ser un dato editable más. El
 * `token` público se conserva tal cual para que los enlaces y los QR que los
 * clientes ya tienen sigan funcionando.
 */

import type { Modalidad } from "./modalidades";

export const ESTADOS = ["activo", "pausado", "cancelado"] as const;
export type Estado = (typeof ESTADOS)[number];

export interface Cliente {
  id: string;
  nombre: string;
  estado: Estado;
  /** Enlace público del cliente. NO se regenera nunca: hay QR repartidos. */
  token: string;
  /** Describe el ciclo EN CURSO. Las deudas antiguas viven en cada ciclo. */
  pendientePago: boolean;
  /** Contador del bono en curso. Fernando puede corregirlo a mano. */
  sesionesCompletadas: number;
  cicloActual: number;
}

export interface Ciclo {
  clienteId: string;
  ciclo: number;
  modalidad: Modalidad;
  /** Etiqueta libre del servicio. No apunta a ningún catálogo. */
  servicio: string;
  /** Tarifa HISTÓRICA, congelada al contratar. `null` en una mensualidad. */
  tarifa: number | null;
  /** 0 significa SIN LÍMITE, no «cero sesiones». */
  sesionesTotales: number;
  precioTotal: number | null;
  cuotaMensual: number | null;
  sesionesReferencia: number | null;
  anio: number | null;
  mes: number | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  /**
   * Estado de COBRO de este servicio. Solo dos valores, nunca nulo
   * (decisión de Fernando, 2026-08-05): `false` = pendiente de pago,
   * `true` = pagado.
   *
   * No existe «no se sabe». Un servicio del que no consta el cobro está
   * pendiente, que es lo que significa: nadie ha dicho que se pagara.
   *
   * Es un eje INDEPENDIENTE del estado del cliente. Un pausado o un
   * cancelado pueden deber dinero, y su deuda no desaparece por dejar de
   * entrenar.
   */
  pagado: boolean;
}

export interface Sesion {
  id: string;
  clienteId: string;
  /** ISO `AAAA-MM-DD`, en hora de Madrid. */
  fecha: string;
  /** `HH:MM`, o `null` en sesiones antiguas. No se inventa. */
  hora: string | null;
  numeroSesion: number;
  sesionesTotales: number;
  /** `null` = cuenta como hora trabajada y no aporta dinero. No es 0 €. */
  tarifa: number | null;
  ciclo: number;
  servicio: string;
}

export interface CargoMensual {
  clienteId: string;
  anio: number;
  mes: number;
  concepto: "mensualidad";
  ciclo: number;
  importe: number;
  /** En una mensualidad, ESTE es el estado de cobro que manda. */
  pagado: boolean;
}

/** Todo lo que la ficha del cliente necesita enseñar, ya resuelto.
 *  La pantalla no decide nada: pinta lo que hay aquí. */
export interface FichaServicio {
  modalidad: Modalidad;
  etiqueta: string;
  servicio: string | null;
  ciclo: number | null;
  anio: number | null;
  mes: number | null;
  tarifa: number | null;
  precioTotal: number | null;
  cuotaMensual: number | null;
  sesionesReferencia: number | null;
  sesionesHechas: number;
  sesionesTotales: number | null;
  sesionesRestantes: number | null;
  muestraBarra: boolean;
  porcentaje: number | null;
  facturacion: number | null;
  precioEfectivo: number | null;
  pendientePago: boolean;
  etiquetaPago: string;
  estado: Estado;
  /** Qué le falta al servicio para poder usarse, en lenguaje llano. */
  faltan: string[];
  completo: boolean;
  puedeFirmar: boolean;
}

/** Resultado de firmar, para poder decir en pantalla qué ha pasado. */
export interface ResultadoFirma {
  numeroSesion: number;
  sesionesTotales: number;
  renovado: boolean;
  avisoUltimaSesion: boolean;
  duplicado: boolean;
  modalidad: Modalidad;
  anio: number;
  mes: number;
}
