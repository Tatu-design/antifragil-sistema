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
import type { CargoMensual, Ciclo, Cliente, Sesion, SesionDelCalendario } from "@/domain/tipos";

/** Un profesional que usa la aplicación. Los clientes NO son perfiles. */
export interface Perfil {
  id: string;
  correo: string;
  nombre: string;
  rol: "admin" | "entrenador";
  /** Data URI ya encogida por el navegador. `null` = se enseñan sus iniciales. */
  foto?: string | null;
}

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
  /**
   * Los clientes. Con `soloDe`, únicamente los de ese profesional.
   *
   * El filtro va aquí y no en la pantalla a propósito: esconder tarjetas en el
   * navegador no es seguridad — los datos habrían viajado igual al móvil de
   * quien no debe verlos.
   */
  listarClientes(soloDe?: string | null): Promise<Cliente[]>;
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
  cargarTodoParaLaLista(soloDe?: string | null): Promise<DatosDeLaLista>;
  listarCiclos(clienteId: string): Promise<Ciclo[]>;
  guardarCiclo(ciclo: Ciclo): Promise<void>;

  listarSesiones(clienteId: string): Promise<Sesion[]>;
  /**
   * Las sesiones firmadas de un rango de fechas, con el nombre del cliente y
   * de quién es cada una. **Una sola consulta para todo el mes**: el
   * calendario no puede pedir un día cada vez.
   *
   * `soloDe` aplica las reglas de `domain/atribucion.ts`, las mismas que
   * Economía. Cuando viene, la base NO devuelve las de otros profesionales:
   * el filtro no es de pantalla.
   */
  sesionesEntre(
    desde: string,
    hasta: string,
    alcance?: { soloDe?: string | null; adminId?: string | null },
  ): Promise<SesionDelCalendario[]>;
  contarSesionesDelCiclo(clienteId: string, ciclo: number): Promise<number>;
  /**
   * Lo firmado en un rango de fechas, ya sumado por la base.
   *
   * **Una consulta, no una por cliente.** La comprobación de descuadre pedía
   * las sesiones cliente a cliente y las filtraba en memoria: nueve consultas
   * y ciento veintiuna sesiones descargadas para mirar las quince de una
   * semana, y una consulta más por cada cliente nuevo. Eso son casi cuatro
   * segundos pegados a CADA firma (2026-08-27).
   */
  resumenDeSesionesEntre(
    desde: string,
    hasta: string,
  ): Promise<{ facturacion: number; horas: number; horasSinImporte: number }>;
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

  // ---------------------------------------------------------------------------
  // Quién usa la aplicación
  // ---------------------------------------------------------------------------
  // Van en el mismo contrato que el resto para que las comprobaciones de
  // permisos se puedan probar con el repositorio de pruebas. La seguridad es
  // justo lo que no se puede dejar sin probar (2026-08-09).

  /** El profesional con ese correo, o `null` si no tiene perfil. */
  perfilPorCorreo(correo: string): Promise<Perfil | null>;
  /** De quién es ese cliente. `null` si no existe o si no tiene responsable. */
  profesionalDelCliente(clienteId: string): Promise<string | null>;
  /** Un profesional por su identificador. Lo usa la página del cliente para
   *  decirle quién le entrena. */
  perfilPorId(id: string | null): Promise<Perfil | null>;
  /** Todos los profesionales. Para el filtro del administrador. */
  listarProfesionales(): Promise<Perfil[]>;
  /** Cambia el nombre y la foto de un perfil. Cada uno el suyo. */
  actualizarPerfil(id: string, datos: { nombre: string; foto: string | null }): Promise<void>;
  /** Asigna el responsable de un cliente. Solo el administrador. */
  asignarProfesional(clienteId: string, profesionalId: string | null): Promise<void>;

  facturacionKids(anio: number, mes: number): Promise<number | null>;
  guardarFacturacionKids(anio: number, mes: number, importe: number): Promise<void>;

  /** Los meses con algo que enseñar, del más reciente al más antiguo. */
  mesesConDatos(): Promise<Array<{ anio: number; mes: number }>>;
  datosDelMes(anio: number, mes: number): Promise<DatosMes>;
  /**
   * Lo mismo que `datosDelMes`, pero de TODOS los meses de una vez.
   *
   * Existe por una razón de velocidad, no de comodidad. Economía enseña todos
   * los meses, y pedirlos uno a uno costaba cinco viajes de red por mes: con
   * cinco meses eran veinticinco, y en diciembre habrían sido sesenta. La
   * pantalla se iba haciendo más lenta sola, sin que nadie tocara nada.
   *
   * Así son cinco viajes en total, hoy y dentro de tres años.
   */
  /**
   * Con `soloDe`, la economía de ESE profesional; sin él, la de todo.
   *
   * `esAdministrador` decide si se incluye lo que no es de nadie en concreto
   * —CrossFit y ajustes—, que por ahora pertenece al administrador.
   */
  datosDeTodosLosMeses(
    soloDe?: string | null,
    opciones?: {
      /** Si es el administrador: le tocan CrossFit, ajustes y todas las modalidades. */
      esAdministrador?: boolean;
      /** Quién es el administrador, para atribuirle el histórico anterior a
       *  que existieran los profesionales. */
      adminId?: string | null;
    },
  ): Promise<Array<{ anio: number; mes: number } & DatosMes>>;

  /** Sesiones de hoy de ese cliente que aún no ha confirmado. */
  sesionesSinConfirmarHoy(clienteId: string, hoy: string): Promise<Sesion[]>;
  confirmacionesDeHoy(clienteId: string, hoy: string): Promise<Array<{ hora: string }>>;
  /** Confirma la sesión más antigua de hoy sin confirmar. */
  confirmarSesion(clienteId: string, sesionId: string, hoy: string, hora: string): Promise<void>;

  /** Avisos: lo que Fernando debería mirar. */
  /**
   * Anota un aviso. `clienteId` dice de quién es; sin él, es del sistema y
   * solo lo ve el administrador (un descuadre con Calendar, por ejemplo).
   */
  registrarAviso(aviso: {
    fecha: string;
    tipo: string;
    detalle: string;
    clienteId?: string | null;
  }): Promise<void>;
  /**
   * Los avisos pendientes. Con `soloDe`, únicamente los de los clientes de ese
   * profesional — los del sistema quedan fuera: no son suyos.
   */
  listarAvisos(soloDe?: string | null): Promise<Aviso[]>;
  contarNoLeidos(soloDe?: string | null): Promise<number>;
  marcarTodosLeidos(soloDe?: string | null): Promise<void>;
  /** Devuelve `false` si ese aviso no es de ese profesional: no se resuelve. */
  resolverAviso(id: string, soloDe?: string | null): Promise<boolean>;
  resolverPorTipo(tipo: string, soloDe?: string | null): Promise<number>;

  /** ¿Ya se procesó esta petición? Cuarta capa contra duplicados. */
  registrarIdempotencia(clave: string): Promise<boolean>;

  /** Ejecuta todo o nada. */
  transaccion<T>(operacion: () => Promise<T>): Promise<T>;
}
