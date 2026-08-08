/**
 * El contrato del almacén de datos.
 *
 * Todo lo que la aplicación necesita guardar o leer pasa por aquí. Ni las
 * pantallas ni las reglas de negocio saben si detrás hay un archivo de staging
 * o Supabase: se puede cambiar `RepositorioStaging` por `RepositorioSupabase`
 * sin tocar un solo componente.
 *
 * `transaccion` existe porque firmar una sesión no es una cosa, son cinco
 * (descontar el bono, escribir el historial, sumar a la semana, cerrar el ciclo
 * si se agotó, abrir el siguiente). O pasan las cinco o no pasa ninguna.
 */

import type { SesionEconomica, TipoClase } from "@/domain/economia";
import type { CargoMensual, Ciclo, Cliente, Sesion } from "@/domain/tipos";

export interface SemanaEconomica {
  inicio: string;
  fin: string;
  facturacion: number;
  horas: number;
  /** Horas trabajadas que no aportan dinero a la semana (mensualidades).
   *  Corrección H-01: sin esto la semana perdía esas horas. */
  horasSinImporte: number;
  sesionesKids: number;
  facturacionKids: number | null;
}

export interface Aviso {
  id: string;
  fecha: string;
  tipo: string;
  detalle: string;
  leido: boolean;
}

export interface ClaseGrupo {
  id: string;
  fecha: string;
  tipo: TipoClase;
}

export interface AjusteMensual {
  origen: string;
  importe: number;
  horas: number;
  motivo: string;
}

/** Todo lo que hace falta para calcular un mes, leído de una vez. */
export interface DatosMes {
  sesiones: SesionEconomica[];
  cuotas: number[];
  clasesLidomare: number;
  clasesKids: number;
  facturacionKids: number | null;
  ajustes: AjusteMensual[];
}

/** Los datos de todos los clientes a la vez, para componer la lista. */
export interface DatosDeLaLista {
  ciclos: Ciclo[];
  cargos: CargoMensual[];
  /** Sesiones por cliente y ciclo. Clave: `${clienteId}:${ciclo}`. */
  sesionesPorCiclo: Map<string, number>;
}

export interface Repositorio {
  listarClientes(): Promise<Cliente[]>;
  obtenerCliente(id: string): Promise<Cliente | null>;
  obtenerClientePorToken(token: string): Promise<Cliente | null>;
  crearCliente(cliente: Cliente, cicloInicial: Ciclo): Promise<void>;
  actualizarCliente(cliente: Cliente): Promise<void>;
  /** Solo la ficha. Sus sesiones se borran antes, una a una. */
  eliminarCliente(clienteId: string): Promise<void>;

  cicloActual(clienteId: string): Promise<Ciclo | null>;
  /**
   * Todo lo que la LISTA de clientes necesita, de una vez (2026-08-05).
   *
   * En Vercel cada consulta es un viaje de red a Supabase (~180 ms). Pedir
   * los ciclos, las cuotas y el recuento de sesiones cliente a cliente eran
   * 5 consultas por cliente: con 8 clientes, más de 40 viajes y varios
   * segundos de espera. Esto lo deja en tres, sea cual sea el número de
   * clientes.
   */
  cargarTodoParaLaLista(): Promise<DatosDeLaLista>;
  listarCiclos(clienteId: string): Promise<Ciclo[]>;
  guardarCiclo(ciclo: Ciclo): Promise<void>;

  listarSesiones(clienteId: string): Promise<Sesion[]>;
  contarSesionesDelCiclo(clienteId: string, ciclo: number): Promise<number>;
  guardarSesion(sesion: Sesion): Promise<void>;
  eliminarSesion(sesionId: string): Promise<Sesion | null>;
  guardarSesionEditada(sesionId: string, fecha: string, numeroSesion: number): Promise<void>;
  /**
   * Baja un número las sesiones de un ciclo que van por encima de `desde`.
   * Se usa al borrar: si se borra la 3 de 7, las que eran 4..7 pasan a 3..6.
   */
  renumerarPosteriores(clienteId: string, ciclo: number, desde: number): Promise<void>;
  /** Mueve una sesión a otro ciclo con otro número (reparación de datos). */
  reubicarSesion(sesionId: string, ciclo: number, numeroSesion: number): Promise<void>;

  cargoDelMes(clienteId: string, anio: number, mes: number): Promise<CargoMensual | null>;
  guardarCargo(cargo: CargoMensual): Promise<void>;
  listarCargos(clienteId: string): Promise<CargoMensual[]>;

  sumarASemana(fecha: string, tarifa: number | null, sesiones: number): Promise<void>;
  listarSemanas(): Promise<SemanaEconomica[]>;

  /** Clases de grupo: CrossFit Lidomare y Kids. No son de ningún cliente. */
  registrarClase(fecha: string, tipo: TipoClase): Promise<void>;
  /** Deshace la última de ese tipo. Devuelve su fecha, o null si no había. */
  deshacerUltimaClase(tipo: TipoClase): Promise<string | null>;
  /** Borra una clase concreta por su identificador. Devuelve su fecha, o
   *  `null` si ya no estaba. */
  borrarClase(id: string): Promise<{ fecha: string; tipo: TipoClase } | null>;
  contarClases(desde: string, hasta: string): Promise<Record<TipoClase, number>>;
  /**
   * Las clases de un tipo dadas en un mes natural, de la más reciente a la
   * más antigua. Es el historial que enseña la ficha de cada cuenta.
   */
  clasesDelMes(tipo: TipoClase, anio: number, mes: number): Promise<ClaseGrupo[]>;

  facturacionKids(anio: number, mes: number): Promise<number | null>;
  guardarFacturacionKids(anio: number, mes: number, importe: number): Promise<void>;

  /** Los meses con algo que enseñar, del más reciente al más antiguo. */
  mesesConDatos(): Promise<Array<{ anio: number; mes: number }>>;
  datosDelMes(anio: number, mes: number): Promise<DatosMes>;

  /** Sesiones de hoy de ese cliente que aún no ha confirmado. */
  sesionesSinConfirmarHoy(clienteId: string, hoy: string): Promise<Sesion[]>;
  confirmacionesDeHoy(clienteId: string, hoy: string): Promise<Array<{ hora: string }>>;
  /** Confirma la sesión más antigua de hoy sin confirmar. */
  confirmarSesion(clienteId: string, sesionId: string, hoy: string, hora: string): Promise<void>;

  /** Avisos: lo que Fernando debería mirar. */
  registrarAviso(aviso: { fecha: string; tipo: string; detalle: string }): Promise<void>;
  listarAvisos(): Promise<Aviso[]>;
  contarNoLeidos(): Promise<number>;
  marcarTodosLeidos(): Promise<void>;
  resolverAviso(id: string): Promise<void>;
  resolverPorTipo(tipo: string): Promise<number>;

  /** ¿Ya se procesó esta petición? Cuarta capa contra duplicados. */
  registrarIdempotencia(clave: string): Promise<boolean>;

  /** Ejecuta todo o nada. */
  transaccion<T>(operacion: () => Promise<T>): Promise<T>;
}
