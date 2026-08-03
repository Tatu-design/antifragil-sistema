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

import type { CargoMensual, Ciclo, Cliente, Sesion } from "@/domain/tipos";

export interface SemanaEconomica {
  inicio: string;
  fin: string;
  facturacion: number;
  horas: number;
  /** Horas trabajadas que no aportan dinero a la semana (mensualidades).
   *  Corrección H-01: sin esto la semana perdía esas horas. */
  horasSinImporte: number;
}

export interface Repositorio {
  listarClientes(): Promise<Cliente[]>;
  obtenerCliente(id: string): Promise<Cliente | null>;
  obtenerClientePorToken(token: string): Promise<Cliente | null>;
  crearCliente(cliente: Cliente, cicloInicial: Ciclo): Promise<void>;
  actualizarCliente(cliente: Cliente): Promise<void>;

  cicloActual(clienteId: string): Promise<Ciclo | null>;
  listarCiclos(clienteId: string): Promise<Ciclo[]>;
  guardarCiclo(ciclo: Ciclo): Promise<void>;

  listarSesiones(clienteId: string): Promise<Sesion[]>;
  contarSesionesDelCiclo(clienteId: string, ciclo: number): Promise<number>;
  guardarSesion(sesion: Sesion): Promise<void>;
  eliminarSesion(sesionId: string): Promise<Sesion | null>;

  cargoDelMes(clienteId: string, anio: number, mes: number): Promise<CargoMensual | null>;
  guardarCargo(cargo: CargoMensual): Promise<void>;
  listarCargos(clienteId: string): Promise<CargoMensual[]>;

  sumarASemana(fecha: string, tarifa: number | null, sesiones: number): Promise<void>;
  listarSemanas(): Promise<SemanaEconomica[]>;

  /** ¿Ya se procesó esta petición? Cuarta capa contra duplicados. */
  registrarIdempotencia(clave: string): Promise<boolean>;

  /** Ejecuta todo o nada. */
  transaccion<T>(operacion: () => Promise<T>): Promise<T>;
}
