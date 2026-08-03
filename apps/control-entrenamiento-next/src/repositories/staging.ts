/**
 * Repositorio de staging: persiste en un archivo JSON del servidor.
 *
 * **Por qué en archivo y no en memoria.** Un repositorio en memoria se vacía en
 * cada recarga del servidor de desarrollo, así que no se puede comprobar de
 * verdad que firmar una sesión descuenta el bono y que sigue descontado al
 * volver a entrar. Con un archivo, el recorrido completo se puede probar.
 *
 * **Nunca toca datos reales.** Escribe en `.data/staging.json`, que está
 * ignorado por Git. Los datos de arranque son ficticios (`Cliente A`,
 * `Pareja C`…), los mismos nombres que usan las fixtures del proyecto.
 *
 * Este archivo es lo único que habrá que sustituir por `RepositorioSupabase`.
 * Ni las pantallas ni las reglas de negocio saben que existe.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import type { CargoMensual, Ciclo, Cliente, Sesion } from "@/domain/tipos";
import { rangoSemana } from "@/lib/fechas";
import type { Repositorio, SemanaEconomica } from "./tipos";

interface Almacen {
  clientes: Cliente[];
  ciclos: Ciclo[];
  sesiones: Sesion[];
  cargos: CargoMensual[];
  semanas: SemanaEconomica[];
  idempotencia: string[];
  siguienteSesion: number;
}

const RUTA = path.join(process.cwd(), ".data", "staging.json");

function semilla(): Almacen {
  const clientes: Cliente[] = [
    { id: "cli-a", nombre: "Cliente A", estado: "activo", token: "tok-cliente-a", pendientePago: false, sesionesCompletadas: 6, cicloActual: 1 },
    { id: "cli-b", nombre: "Cliente B", estado: "activo", token: "tok-cliente-b", pendientePago: true, sesionesCompletadas: 0, cicloActual: 1 },
    { id: "cli-c", nombre: "Pareja C", estado: "activo", token: "tok-pareja-c", pendientePago: false, sesionesCompletadas: 3, cicloActual: 1 },
    { id: "cli-d", nombre: "Cliente D", estado: "activo", token: "tok-cliente-d", pendientePago: false, sesionesCompletadas: 0, cicloActual: 1 },
    { id: "cli-e", nombre: "Cliente E", estado: "pausado", token: "tok-cliente-e", pendientePago: false, sesionesCompletadas: 2, cicloActual: 1 },
  ];

  const ciclos: Ciclo[] = [
    // Un bono a punto de agotarse: firmar dos veces enseña la renovación.
    { clienteId: "cli-a", ciclo: 1, modalidad: BONO, servicio: "Bono 8 sesiones", tarifa: 45, sesionesTotales: 8, precioTotal: 360, cuotaMensual: null, sesionesReferencia: null, anio: null, mes: null, fechaInicio: "2026-07-13", fechaFin: null, pagado: true },
    { clienteId: "cli-b", ciclo: 1, modalidad: MENSUALIDAD, servicio: "Mensualidad", tarifa: null, sesionesTotales: 0, precioTotal: null, cuotaMensual: 720, sesionesReferencia: 12, anio: 2026, mes: 8, fechaInicio: null, fechaFin: null, pagado: false },
    { clienteId: "cli-c", ciclo: 1, modalidad: BONO, servicio: "Bono pareja 10", tarifa: 60, sesionesTotales: 10, precioTotal: 600, cuotaMensual: null, sesionesReferencia: null, anio: null, mes: null, fechaInicio: "2026-07-20", fechaFin: null, pagado: true },
    { clienteId: "cli-d", ciclo: 1, modalidad: CUENTA, servicio: "Cuenta de cliente", tarifa: 35, sesionesTotales: 0, precioTotal: null, cuotaMensual: null, sesionesReferencia: null, anio: 2026, mes: 8, fechaInicio: null, fechaFin: null, pagado: false },
    { clienteId: "cli-e", ciclo: 1, modalidad: BONO, servicio: "Bono 4 sesiones", tarifa: 50, sesionesTotales: 4, precioTotal: 200, cuotaMensual: null, sesionesReferencia: null, anio: null, mes: null, fechaInicio: "2026-06-15", fechaFin: null, pagado: true },
  ];

  const sesiones: Sesion[] = [];
  let n = 1;
  const anotar = (clienteId: string, fecha: string, numero: number, totales: number, tarifa: number | null, servicio: string) => {
    sesiones.push({ id: `ses-${n++}`, clienteId, fecha, hora: "10:00", numeroSesion: numero, sesionesTotales: totales, tarifa, ciclo: 1, servicio });
  };
  ["2026-07-13", "2026-07-15", "2026-07-20", "2026-07-22", "2026-07-27", "2026-07-29"].forEach((f, i) =>
    anotar("cli-a", f, i + 1, 8, 45, "Bono 8 sesiones"),
  );
  ["2026-07-20", "2026-07-23", "2026-07-27"].forEach((f, i) =>
    anotar("cli-c", f, i + 1, 10, 60, "Bono pareja 10"),
  );
  ["2026-06-15", "2026-06-17"].forEach((f, i) => anotar("cli-e", f, i + 1, 4, 50, "Bono 4 sesiones"));

  const cargos: CargoMensual[] = [
    { clienteId: "cli-b", anio: 2026, mes: 8, concepto: "mensualidad", ciclo: 1, importe: 720, pagado: false },
  ];

  const semanas: SemanaEconomica[] = [];
  for (const sesion of sesiones) {
    const { inicio, fin } = rangoSemana(sesion.fecha);
    let semana = semanas.find((s) => s.inicio === inicio);
    if (!semana) {
      semana = { inicio, fin, facturacion: 0, horas: 0, horasSinImporte: 0 };
      semanas.push(semana);
    }
    if (sesion.tarifa === null) semana.horasSinImporte += 1;
    else {
      semana.facturacion += sesion.tarifa;
      semana.horas += 1;
    }
  }

  return { clientes, ciclos, sesiones, cargos, semanas, idempotencia: [], siguienteSesion: n };
}

/**
 * El estado vive en `globalThis`, no en una variable del módulo.
 *
 * Next.js empaqueta el código del servidor en varios grafos: el que ejecuta
 * una Server Action y el que renderiza la página pueden ser copias distintas
 * del mismo archivo. Con `let cache` cada copia tenía la suya, así que firmar
 * guardaba bien en disco pero la pantalla seguía enseñando lo anterior —
 * encontrado probando el recorrido real contra el servidor, no en las pruebas.
 *
 * `globalThis` es el sitio compartido entre todas esas copias. Es el mismo
 * patrón que se usa para no abrir dos clientes de base de datos.
 */
interface EstadoGlobal {
  cache: Almacen | null;
  /** Las escrituras se encadenan: dos peticiones simultáneas no pueden leer el
   *  mismo estado y pisarse. Es el equivalente aquí al `BEGIN IMMEDIATE` de
   *  SQLite; en Supabase lo hará la propia base de datos. */
  cola: Promise<unknown>;
}

const CLAVE = Symbol.for("antifragil.staging");
const global = globalThis as unknown as Record<symbol, EstadoGlobal | undefined>;

function estado(): EstadoGlobal {
  if (!global[CLAVE]) global[CLAVE] = { cache: null, cola: Promise.resolve() };
  return global[CLAVE];
}

async function cargar(): Promise<Almacen> {
  const g = estado();
  if (g.cache) return g.cache;
  try {
    g.cache = JSON.parse(await readFile(RUTA, "utf8")) as Almacen;
  } catch {
    g.cache = semilla();
    await volcar();
  }
  return g.cache;
}

async function volcar(): Promise<void> {
  const g = estado();
  if (!g.cache) return;
  await mkdir(path.dirname(RUTA), { recursive: true });
  await writeFile(RUTA, JSON.stringify(g.cache, null, 2), "utf8");
}

function clonar<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

export class RepositorioStaging implements Repositorio {
  async listarClientes(): Promise<Cliente[]> {
    const datos = await cargar();
    return clonar(datos.clientes).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  async obtenerCliente(id: string): Promise<Cliente | null> {
    const datos = await cargar();
    return clonar(datos.clientes.find((c) => c.id === id) ?? null);
  }

  async obtenerClientePorToken(token: string): Promise<Cliente | null> {
    const datos = await cargar();
    return clonar(datos.clientes.find((c) => c.token === token) ?? null);
  }

  async crearCliente(cliente: Cliente, cicloInicial: Ciclo): Promise<void> {
    const datos = await cargar();
    if (datos.clientes.some((c) => c.nombre.toLowerCase() === cliente.nombre.toLowerCase())) {
      throw new Error(`Ya existe un cliente llamado «${cliente.nombre}»`);
    }
    datos.clientes.push(clonar(cliente));
    datos.ciclos.push(clonar(cicloInicial));
    await volcar();
  }

  async actualizarCliente(cliente: Cliente): Promise<void> {
    const datos = await cargar();
    const indice = datos.clientes.findIndex((c) => c.id === cliente.id);
    if (indice < 0) throw new Error("Ese cliente ya no existe");
    datos.clientes[indice] = clonar(cliente);
    await volcar();
  }

  async cicloActual(clienteId: string): Promise<Ciclo | null> {
    const datos = await cargar();
    const cliente = datos.clientes.find((c) => c.id === clienteId);
    if (!cliente) return null;
    const ciclo = datos.ciclos.find((c) => c.clienteId === clienteId && c.ciclo === cliente.cicloActual);
    return ciclo ? this.conCobroReal(datos, clonar(ciclo)) : null;
  }

  async listarCiclos(clienteId: string): Promise<Ciclo[]> {
    const datos = await cargar();
    return datos.ciclos
      .filter((c) => c.clienteId === clienteId)
      .sort((a, b) => b.ciclo - a.ciclo)
      .map((c) => this.conCobroReal(datos, clonar(c)));
  }

  /**
   * En una MENSUALIDAD manda el cargo del mes, no la columna del ciclo
   * (corrección H-02). Si no hay cargo se conserva lo guardado, `null`
   * incluido: `null` significa «no se sabe», nunca «no pagado».
   */
  private conCobroReal(datos: Almacen, ciclo: Ciclo): Ciclo {
    if (ciclo.modalidad !== MENSUALIDAD || ciclo.anio === null || ciclo.mes === null) return ciclo;
    const cargo = datos.cargos.find(
      (c) => c.clienteId === ciclo.clienteId && c.anio === ciclo.anio && c.mes === ciclo.mes,
    );
    return cargo ? { ...ciclo, pagado: cargo.pagado } : ciclo;
  }

  async guardarCiclo(ciclo: Ciclo): Promise<void> {
    const datos = await cargar();
    const indice = datos.ciclos.findIndex((c) => c.clienteId === ciclo.clienteId && c.ciclo === ciclo.ciclo);
    if (indice < 0) datos.ciclos.push(clonar(ciclo));
    else datos.ciclos[indice] = clonar(ciclo);
    await volcar();
  }

  async listarSesiones(clienteId: string): Promise<Sesion[]> {
    const datos = await cargar();
    // De la más reciente a la más antigua, como en el sistema actual.
    return clonar(datos.sesiones.filter((s) => s.clienteId === clienteId)).sort((a, b) =>
      a.fecha === b.fecha ? b.id.localeCompare(a.id, "es", { numeric: true }) : b.fecha.localeCompare(a.fecha),
    );
  }

  async contarSesionesDelCiclo(clienteId: string, ciclo: number): Promise<number> {
    const datos = await cargar();
    return datos.sesiones.filter((s) => s.clienteId === clienteId && s.ciclo === ciclo).length;
  }

  async guardarSesion(sesion: Sesion): Promise<void> {
    const datos = await cargar();
    datos.sesiones.push(clonar(sesion));
    await volcar();
  }

  async eliminarSesion(sesionId: string): Promise<Sesion | null> {
    const datos = await cargar();
    const indice = datos.sesiones.findIndex((s) => s.id === sesionId);
    if (indice < 0) return null;
    const [sesion] = datos.sesiones.splice(indice, 1);
    await volcar();
    return clonar(sesion);
  }

  async cargoDelMes(clienteId: string, anio: number, mes: number): Promise<CargoMensual | null> {
    const datos = await cargar();
    return clonar(
      datos.cargos.find((c) => c.clienteId === clienteId && c.anio === anio && c.mes === mes) ?? null,
    );
  }

  async guardarCargo(cargo: CargoMensual): Promise<void> {
    const datos = await cargar();
    const indice = datos.cargos.findIndex(
      (c) => c.clienteId === cargo.clienteId && c.anio === cargo.anio && c.mes === cargo.mes,
    );
    // La clave (cliente, año, mes, concepto) es lo que impide cobrar dos veces
    // el mismo mes. Aquí lo garantiza esta búsqueda; en Postgres, la clave
    // primaria — que es mejor, porque no depende de que nadie la olvide.
    if (indice < 0) datos.cargos.push(clonar(cargo));
    else datos.cargos[indice] = clonar(cargo);
    await volcar();
  }

  async listarCargos(clienteId: string): Promise<CargoMensual[]> {
    const datos = await cargar();
    return clonar(datos.cargos.filter((c) => c.clienteId === clienteId));
  }

  async sumarASemana(fecha: string, tarifa: number | null, sesiones: number): Promise<void> {
    const datos = await cargar();
    const { inicio, fin } = rangoSemana(fecha);
    let semana = datos.semanas.find((s) => s.inicio === inicio);
    if (!semana) {
      semana = { inicio, fin, facturacion: 0, horas: 0, horasSinImporte: 0 };
      datos.semanas.push(semana);
    }
    if (tarifa === null) {
      // Una sesión sin importe cuenta como HORA trabajada y solo como hora
      // (corrección H-01). Antes no se contaba en ningún sitio.
      semana.horasSinImporte = Math.max(semana.horasSinImporte + sesiones, 0);
    } else {
      semana.horas = Math.max(semana.horas + sesiones, 0);
      semana.facturacion = Math.round((semana.facturacion + sesiones * tarifa) * 100) / 100;
    }
    await volcar();
  }

  async listarSemanas(): Promise<SemanaEconomica[]> {
    const datos = await cargar();
    return clonar(datos.semanas).sort((a, b) => b.inicio.localeCompare(a.inicio));
  }

  async registrarIdempotencia(clave: string): Promise<boolean> {
    const datos = await cargar();
    if (datos.idempotencia.includes(clave)) return false;
    datos.idempotencia.push(clave);
    await volcar();
    return true;
  }

  /**
   * Todo o nada. Se guarda una copia del estado antes de empezar y se
   * restaura si algo falla, para que un error a mitad no deje la sesión
   * escrita y el dinero sin sumar — el descuadre exacto que costó una
   * auditoría entera en el sistema actual.
   *
   * Las operaciones se encolan, así que dos peticiones simultáneas no pueden
   * leer el mismo estado.
   */
  async transaccion<T>(operacion: () => Promise<T>): Promise<T> {
    const g = estado();
    const ejecutar = async (): Promise<T> => {
      const datos = await cargar();
      const copia = clonar(datos);
      try {
        const resultado = await operacion();
        await volcar();
        return resultado;
      } catch (error) {
        // Todo o nada: se vuelve al estado anterior. Un fallo a mitad no puede
        // dejar la sesión escrita y el dinero sin sumar.
        g.cache = copia;
        await volcar();
        throw error;
      }
    };
    const siguiente = g.cola.then(ejecutar, ejecutar);
    g.cola = siguiente.catch(() => undefined);
    return siguiente;
  }
}

/** Solo para las pruebas: vuelve al estado de partida. */
export function reiniciarStagingParaPruebas(): void {
  estado().cache = semilla();
}
