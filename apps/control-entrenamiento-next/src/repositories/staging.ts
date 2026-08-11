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

import { TARIFA_LIDOMARE, type TipoClase } from "@/domain/economia";
import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import type { CargoMensual, Ciclo, Cliente, Sesion } from "@/domain/tipos";
import { rangoSemana } from "@/lib/fechas";
import type { Aviso, ClaseGrupo, DatosDeLaLista, Perfil, Repositorio, SemanaEconomica } from "./tipos";

interface Almacen {
  perfiles: Perfil[];
  clientes: Cliente[];
  ciclos: Ciclo[];
  sesiones: Sesion[];
  cargos: CargoMensual[];
  semanas: SemanaEconomica[];
  clases: Array<{ id: string; fecha: string; tipo: TipoClase }>;
  facturacionKids: Array<{ anio: number; mes: number; importe: number }>;
  ajustes: Array<{ anio: number; mes: number; origen: string; importe: number; horas: number; motivo: string }>;
  confirmaciones: Array<{ clienteId: string; sesionId: string; fecha: string; hora: string }>;
  avisos: Array<{
    id: string;
    fecha: string;
    tipo: string;
    detalle: string;
    leido: boolean;
    resuelto: boolean;
    /** De qué cliente es. Nulo = del sistema, y esos son del administrador. */
    clienteId?: string | null;
  }>;
  idempotencia: string[];
  siguienteSesion: number;
}

const RUTA = path.join(process.cwd(), ".data", "staging.json");

function semilla(): Almacen {
  // Dos profesionales, para poder probar de verdad los permisos: uno que lo
  // ve todo y otro que solo debe ver a su cliente.
  const perfiles: Perfil[] = [
    { id: "per-admin", correo: "admin@pruebas.local", nombre: "Administrador", rol: "admin" },
    { id: "per-rafa", correo: "entrenador@pruebas.local", nombre: "Entrenador", rol: "entrenador" },
    // Un tercero, para comprobar que nada está atado a «dos profesionales».
    { id: "per-otro", correo: "otro@pruebas.local", nombre: "Otro", rol: "entrenador" },
  ];

  const clientes: Cliente[] = [
    { id: "cli-a", nombre: "Cliente A", estado: "activo", token: "tok-cliente-a", pendientePago: false, sesionesCompletadas: 6, cicloActual: 1, profesionalId: "per-admin" },
    { id: "cli-b", nombre: "Cliente B", estado: "activo", token: "tok-cliente-b", pendientePago: true, sesionesCompletadas: 0, cicloActual: 1, profesionalId: "per-admin" },
    { id: "cli-c", nombre: "Pareja C", estado: "activo", token: "tok-pareja-c", pendientePago: false, sesionesCompletadas: 3, cicloActual: 1, profesionalId: "per-admin" },
    { id: "cli-d", nombre: "Cliente D", estado: "activo", token: "tok-cliente-d", pendientePago: false, sesionesCompletadas: 0, cicloActual: 1, profesionalId: "per-rafa" },
    { id: "cli-e", nombre: "Cliente E", estado: "pausado", token: "tok-cliente-e", pendientePago: false, sesionesCompletadas: 2, cicloActual: 1, profesionalId: "per-otro" },
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
      semana = { inicio, fin, facturacion: 0, horas: 0, horasSinImporte: 0, sesionesKids: 0, facturacionKids: null };
      semanas.push(semana);
    }
    if (sesion.tarifa === null) semana.horasSinImporte += 1;
    else {
      semana.facturacion += sesion.tarifa;
      semana.horas += 1;
    }
  }

  return {
    perfiles, clientes, ciclos, sesiones, cargos, semanas,
    clases: [], facturacionKids: [], ajustes: [], confirmaciones: [], avisos: [],
    idempotencia: [], siguienteSesion: n,
  };
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
  async listarClientes(soloDe?: string | null): Promise<Cliente[]> {
    const datos = await cargar();
    const suyos = soloDe ? datos.clientes.filter((c) => c.profesionalId === soloDe) : datos.clientes;
    return clonar(suyos).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
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

  /** Ver `cargarTodoParaLaLista` en el repositorio de Postgres. */
  async cargarTodoParaLaLista(soloDe?: string | null): Promise<DatosDeLaLista> {
    const datos = await cargar();

    // Mismo alcance que en Postgres: lo de los demás clientes no se toca.
    const esSuyo = (clienteId: string) =>
      !soloDe || datos.clientes.some((c) => c.id === clienteId && c.profesionalId === soloDe);

    const cargos = clonar(datos.cargos.filter((c) => esSuyo(c.clienteId)));
    const porCliente = new Map<string, CargoMensual[]>();
    for (const cargo of cargos) {
      const lista = porCliente.get(cargo.clienteId) ?? [];
      lista.push(cargo);
      porCliente.set(cargo.clienteId, lista);
    }

    const ciclos = clonar(datos.ciclos.filter((c) => esSuyo(c.clienteId)))
      .sort((a, b) => (a.clienteId === b.clienteId ? b.ciclo - a.ciclo : a.clienteId.localeCompare(b.clienteId)))
      // `conCobroReal` de este repositorio recibe el almacén entero, no una
      // lista de cuotas: ya lo tenemos leído aquí, así que se le pasa tal cual.
      .map((c) => this.conCobroReal(datos, c));

    const sesionesPorCiclo = new Map<string, number>();
    for (const sesion of datos.sesiones) {
      if (!esSuyo(sesion.clienteId)) continue;
      const clave = `${sesion.clienteId}:${sesion.ciclo}`;
      sesionesPorCiclo.set(clave, (sesionesPorCiclo.get(clave) ?? 0) + 1);
    }

    return { ciclos, cargos, sesionesPorCiclo };
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
   * incluido.
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

  async guardarSesionEditada(sesionId: string, fecha: string, numeroSesion: number): Promise<void> {
    const datos = await cargar();
    const sesion = datos.sesiones.find((s) => s.id === sesionId);
    if (!sesion) return;
    sesion.fecha = fecha;
    sesion.numeroSesion = numeroSesion;
    await volcar();
  }

  async renumerarPosteriores(clienteId: string, ciclo: number, desde: number): Promise<void> {
    const datos = await cargar();
    for (const sesion of datos.sesiones) {
      if (sesion.clienteId === clienteId && sesion.ciclo === ciclo && sesion.numeroSesion > desde) {
        sesion.numeroSesion -= 1;
      }
    }
    await volcar();
  }

  async reubicarSesion(sesionId: string, ciclo: number, numeroSesion: number): Promise<void> {
    const datos = await cargar();
    const sesion = datos.sesiones.find((s) => s.id === sesionId);
    if (!sesion) return;
    sesion.ciclo = ciclo;
    sesion.numeroSesion = numeroSesion;
    await volcar();
  }

  async eliminarCliente(clienteId: string): Promise<void> {
    const datos = await cargar();
    datos.clientes = datos.clientes.filter((c) => c.id !== clienteId);
    datos.ciclos = datos.ciclos.filter((c) => c.clienteId !== clienteId);
    datos.cargos = datos.cargos.filter((c) => c.clienteId !== clienteId);
    datos.confirmaciones = datos.confirmaciones.filter((c) => c.clienteId !== clienteId);
    await volcar();
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
      semana = { inicio, fin, facturacion: 0, horas: 0, horasSinImporte: 0, sesionesKids: 0, facturacionKids: null };
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
    return clonar(datos.semanas)
      .map((s) => {
        const kids = datos.clases.filter(
          (c) => c.tipo === "kids" && c.fecha >= s.inicio && c.fecha <= s.fin,
        ).length;
        const anio = Number(s.inicio.slice(0, 4));
        const mes = Number(s.inicio.slice(5, 7));
        const importe = datos.facturacionKids.find((f) => f.anio === anio && f.mes === mes);
        return { ...s, sesionesKids: kids, facturacionKids: importe ? importe.importe : null };
      })
      .sort((a, b) => b.inicio.localeCompare(a.inicio));
  }

  async registrarClase(fecha: string, tipo: TipoClase): Promise<void> {
    const datos = await cargar();
    datos.clases.push({ id: `cls-${Date.now()}-${datos.clases.length}`, fecha, tipo });
    await volcar();
    // Lidomare tiene tarifa fija y suma a la semana como una sesión más. Kids
    // no: su dinero no se conoce hasta acabar el mes.
    if (tipo === "lidomare") await this.sumarASemana(fecha, TARIFA_LIDOMARE, 1);
    // Kids no suma dinero todavía, pero su semana tiene que existir igual:
    // si no, la clase no aparecería en ningún sitio hasta acabar el mes.
    else await this.sumarASemana(fecha, null, 0);
  }

  async deshacerUltimaClase(tipo: TipoClase): Promise<string | null> {
    const datos = await cargar();
    const suyas = datos.clases.filter((c) => c.tipo === tipo);
    const ultima = suyas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id)).at(-1);
    if (!ultima) return null;
    datos.clases = datos.clases.filter((c) => c.id !== ultima.id);
    await volcar();
    if (tipo === "lidomare") await this.sumarASemana(ultima.fecha, TARIFA_LIDOMARE, -1);
    return ultima.fecha;
  }

  async contarClases(desde: string, hasta: string): Promise<Record<TipoClase, number>> {
    const datos = await cargar();
    const cuenta: Record<TipoClase, number> = { lidomare: 0, kids: 0 };
    for (const c of datos.clases) if (c.fecha >= desde && c.fecha <= hasta) cuenta[c.tipo] += 1;
    return cuenta;
  }

  async borrarClase(id: string): Promise<{ fecha: string; tipo: TipoClase } | null> {
    const datos = await cargar();
    const indice = datos.clases.findIndex((c) => c.id === id);
    if (indice < 0) return null;
    const [clase] = datos.clases.splice(indice, 1);
    await volcar();
    // Igual que `deshacerUltimaClase`: si era de Lidomare, su dinero sale
    // también de la semana. Si no, quedarían 15 € contados sin clase detrás.
    if (clase.tipo === "lidomare") await this.sumarASemana(clase.fecha, TARIFA_LIDOMARE, -1);
    return { fecha: clase.fecha, tipo: clase.tipo };
  }

  async clasesDelMes(tipo: TipoClase, anio: number, mes: number): Promise<ClaseGrupo[]> {
    const datos = await cargar();
    const prefijo = `${anio}-${String(mes).padStart(2, "0")}`;
    return clonar(datos.clases)
      .filter((c) => c.tipo === tipo && c.fecha.startsWith(prefijo))
      .sort((a, b) => (a.fecha === b.fecha ? b.id.localeCompare(a.id) : b.fecha.localeCompare(a.fecha)));
  }

  // ---------------------------------------------------------------------------
  // Quién usa la aplicación
  // ---------------------------------------------------------------------------

  async perfilPorCorreo(correo: string): Promise<Perfil | null> {
    const datos = await cargar();
    const buscado = correo.trim().toLowerCase();
    return clonar(datos.perfiles.find((p) => p.correo.toLowerCase() === buscado) ?? null);
  }

  async profesionalDelCliente(clienteId: string): Promise<string | null> {
    const datos = await cargar();
    // El cliente que no existe y el que no tiene responsable responden igual:
    // así nadie averigua quién está dado de alta preguntando.
    return datos.clientes.find((c) => c.id === clienteId)?.profesionalId ?? null;
  }

  async perfilPorId(id: string | null): Promise<Perfil | null> {
    if (!id) return null;
    const datos = await cargar();
    return clonar(datos.perfiles.find((p) => p.id === id) ?? null);
  }

  async listarProfesionales(): Promise<Perfil[]> {
    const datos = await cargar();
    return clonar(
      [...datos.perfiles].sort((a, b) =>
        a.rol === b.rol ? a.nombre.localeCompare(b.nombre) : a.rol === "admin" ? -1 : 1,
      ),
    );
  }

  async actualizarPerfil(id: string, datos: { nombre: string; foto: string | null }): Promise<void> {
    const almacen = await cargar();
    const perfil = almacen.perfiles.find((p) => p.id === id);
    if (perfil) {
      perfil.nombre = datos.nombre;
      perfil.foto = datos.foto;
    }
    await volcar();
  }

  async asignarProfesional(clienteId: string, profesionalId: string | null): Promise<void> {
    const datos = await cargar();
    const cliente = datos.clientes.find((c) => c.id === clienteId);
    if (cliente) cliente.profesionalId = profesionalId;
    await volcar();
  }

  async facturacionKids(anio: number, mes: number): Promise<number | null> {
    const datos = await cargar();
    return datos.facturacionKids.find((f) => f.anio === anio && f.mes === mes)?.importe ?? null;
  }

  async guardarFacturacionKids(anio: number, mes: number, importe: number): Promise<void> {
    const datos = await cargar();
    const existente = datos.facturacionKids.find((f) => f.anio === anio && f.mes === mes);
    if (existente) existente.importe = importe;
    else datos.facturacionKids.push({ anio, mes, importe });
    await volcar();
  }

  async mesesConDatos(): Promise<Array<{ anio: number; mes: number }>> {
    const datos = await cargar();
    const claves = new Set<string>();
    for (const s of datos.sesiones) claves.add(s.fecha.slice(0, 7));
    for (const c of datos.clases) claves.add(c.fecha.slice(0, 7));
    for (const c of datos.cargos) claves.add(`${c.anio}-${String(c.mes).padStart(2, "0")}`);
    for (const a of datos.ajustes) claves.add(`${a.anio}-${String(a.mes).padStart(2, "0")}`);
    return [...claves]
      .sort((a, b) => b.localeCompare(a))
      .map((k) => ({ anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)) }));
  }

  /**
   * Todos los meses de una vez. Aquí no ahorra viajes de red —no los hay—
   * pero tiene que existir y dar exactamente el mismo resultado que en
   * Postgres, o las pruebas dejarían de comprobar lo que corre de verdad.
   *
   * No se apoya en `mesesConDatos` ni en `datosDelMes` a propósito: la
   * prueba de rendimiento cuenta llamadas al repositorio, y llamarse a sí
   * mismo por dentro le haría contar viajes que en Postgres no existen.
   */
  async datosDeTodosLosMeses(
    soloDe?: string | null,
    opciones: { esAdministrador?: boolean } = {},
  ) {
    const datos = await cargar();

    // Las mismas reglas que en Postgres: la sesión es de quien era responsable
    // del cliente cuando se firmó y, si no hay copia, del responsable de hoy.
    // Nunca de quien la firmó.
    const deQuienEs = (clienteId: string, profesionalId?: string | null) =>
      profesionalId ?? datos.clientes.find((c) => c.id === clienteId)?.profesionalId ?? null;
    const esSuya = (clienteId: string, profesionalId?: string | null) =>
      !soloDe || deQuienEs(clienteId, profesionalId) === soloDe;

    // CrossFit y ajustes son del administrador y no se reparten.
    const conComunes = !soloDe || opciones.esAdministrador === true;

    const sesiones = datos.sesiones.filter((s) => esSuya(s.clienteId, s.profesionalId));
    const cargos = datos.cargos.filter((c) => esSuya(c.clienteId, c.profesionalId));
    const clases = conComunes ? datos.clases : [];
    const ajustes = conComunes ? datos.ajustes : [];

    const claves = new Set<string>();
    for (const s of sesiones) claves.add(s.fecha.slice(0, 7));
    for (const c of clases) claves.add(c.fecha.slice(0, 7));
    for (const c of cargos) claves.add(`${c.anio}-${String(c.mes).padStart(2, "0")}`);
    for (const a of ajustes) claves.add(`${a.anio}-${String(a.mes).padStart(2, "0")}`);

    const modalidadDe = (clienteId: string, ciclo: number) =>
      datos.ciclos.find((c) => c.clienteId === clienteId && c.ciclo === ciclo)?.modalidad ?? BONO;

    return [...claves]
      .sort((a, b) => b.localeCompare(a))
      .map((prefijo) => {
        const anio = Number(prefijo.slice(0, 4));
        const mes = Number(prefijo.slice(5, 7));
        return {
          anio,
          mes,
          sesiones: sesiones
            .filter((s) => s.fecha.startsWith(prefijo))
            .map((s) => ({ fecha: s.fecha, tarifa: s.tarifa, modalidad: modalidadDe(s.clienteId, s.ciclo) })),
          cuotas: cargos.filter((c) => c.anio === anio && c.mes === mes).map((c) => c.importe),
          clasesLidomare: clases.filter((c) => c.tipo === "lidomare" && c.fecha.startsWith(prefijo)).length,
          clasesKids: clases.filter((c) => c.tipo === "kids" && c.fecha.startsWith(prefijo)).length,
          facturacionKids: conComunes
            ? (datos.facturacionKids.find((f) => f.anio === anio && f.mes === mes)?.importe ?? null)
            : null,
          ajustes: ajustes
            .filter((a) => a.anio === anio && a.mes === mes)
            .map((a) => ({ origen: a.origen, importe: a.importe, horas: a.horas, motivo: a.motivo })),
        };
      });
  }

  async datosDelMes(anio: number, mes: number) {
    const datos = await cargar();
    const prefijo = `${anio}-${String(mes).padStart(2, "0")}`;
    const modalidadDe = (clienteId: string, ciclo: number) =>
      datos.ciclos.find((c) => c.clienteId === clienteId && c.ciclo === ciclo)?.modalidad ?? BONO;

    return {
      sesiones: datos.sesiones
        .filter((s) => s.fecha.startsWith(prefijo))
        .map((s) => ({ fecha: s.fecha, tarifa: s.tarifa, modalidad: modalidadDe(s.clienteId, s.ciclo) })),
      cuotas: datos.cargos.filter((c) => c.anio === anio && c.mes === mes).map((c) => c.importe),
      clasesLidomare: datos.clases.filter((c) => c.tipo === "lidomare" && c.fecha.startsWith(prefijo)).length,
      clasesKids: datos.clases.filter((c) => c.tipo === "kids" && c.fecha.startsWith(prefijo)).length,
      // Se lee del almacén ya cargado, no con otra consulta: en el
      // repositorio real eso era un viaje de red más por cada mes.
      facturacionKids:
        datos.facturacionKids.find((f) => f.anio === anio && f.mes === mes)?.importe ?? null,
      ajustes: datos.ajustes
        .filter((a) => a.anio === anio && a.mes === mes)
        .map((a) => ({ origen: a.origen, importe: a.importe, horas: a.horas, motivo: a.motivo })),
    };
  }

  async sesionesSinConfirmarHoy(clienteId: string, hoy: string): Promise<Sesion[]> {
    const datos = await cargar();
    const confirmadas = new Set(datos.confirmaciones.map((c) => c.sesionId));
    return clonar(
      datos.sesiones.filter((s) => s.clienteId === clienteId && s.fecha === hoy && !confirmadas.has(s.id)),
    );
  }

  async confirmacionesDeHoy(clienteId: string, hoy: string): Promise<Array<{ hora: string }>> {
    const datos = await cargar();
    return datos.confirmaciones
      .filter((c) => c.clienteId === clienteId && c.fecha === hoy)
      .map((c) => ({ hora: c.hora }));
  }

  async confirmarSesion(clienteId: string, sesionId: string, hoy: string, hora: string): Promise<void> {
    const datos = await cargar();
    // Escanear el QR dos veces no puede crear dos confirmaciones.
    if (datos.confirmaciones.some((c) => c.sesionId === sesionId)) return;
    datos.confirmaciones.push({ clienteId, sesionId, fecha: hoy, hora });
    await volcar();
  }

  async registrarAviso(aviso: {
    fecha: string;
    tipo: string;
    detalle: string;
    clienteId?: string | null;
  }): Promise<void> {
    const datos = await cargar();
    // No se repite el mismo aviso mientras siga sin resolver.
    const repetido = datos.avisos.some(
      (a) => !a.resuelto && a.tipo === aviso.tipo && a.detalle === aviso.detalle,
    );
    if (repetido) return;
    datos.avisos.unshift({
      id: `avi-${Date.now()}-${datos.avisos.length}`,
      fecha: aviso.fecha,
      tipo: aviso.tipo,
      detalle: aviso.detalle,
      clienteId: aviso.clienteId ?? null,
      leido: false,
      resuelto: false,
    });
    await volcar();
  }

  /**
   * «Este aviso es de un cliente de ese profesional».
   *
   * Sin `soloDe` pasan todos, que es lo que ve el administrador. Los avisos
   * del sistema (sin cliente) NO son de ningún entrenador.
   */
  private async esSuyo(clienteId: string | null | undefined, soloDe?: string | null) {
    if (!soloDe) return true;
    if (!clienteId) return false;
    const datos = await cargar();
    return datos.clientes.some((c) => c.id === clienteId && c.profesionalId === soloDe);
  }

  async listarAvisos(soloDe?: string | null): Promise<Aviso[]> {
    const datos = await cargar();
    const pendientes = datos.avisos.filter((a) => !a.resuelto);
    const suyos = [];
    for (const a of pendientes) {
      if (await this.esSuyo(a.clienteId, soloDe)) suyos.push(a);
    }
    // `resuelto` no sale hacia fuera: quien lee la bandeja solo ve los que
    // siguen pendientes, así que el dato sobra.
    return clonar(suyos).map((a) => ({
      id: a.id,
      fecha: a.fecha,
      tipo: a.tipo,
      detalle: a.detalle,
      leido: a.leido,
    }));
  }

  async contarNoLeidos(soloDe?: string | null): Promise<number> {
    const datos = await cargar();
    let n = 0;
    for (const a of datos.avisos) {
      if (!a.resuelto && !a.leido && (await this.esSuyo(a.clienteId, soloDe))) n += 1;
    }
    return n;
  }

  async marcarTodosLeidos(soloDe?: string | null): Promise<void> {
    const datos = await cargar();
    for (const a of datos.avisos) {
      if (!a.resuelto && (await this.esSuyo(a.clienteId, soloDe))) a.leido = true;
    }
    await volcar();
  }

  async resolverAviso(id: string, soloDe?: string | null): Promise<boolean> {
    const datos = await cargar();
    const aviso = datos.avisos.find((a) => a.id === id);
    // Resolver un aviso ajeno no hace nada, y se dice.
    if (!aviso || !(await this.esSuyo(aviso.clienteId, soloDe))) return false;
    aviso.resuelto = true;
    await volcar();
    return true;
  }

  async resolverPorTipo(tipo: string, soloDe?: string | null): Promise<number> {
    const datos = await cargar();
    const afectados = [];
    for (const a of datos.avisos) {
      if (a.tipo === tipo && !a.resuelto && (await this.esSuyo(a.clienteId, soloDe))) afectados.push(a);
    }
    for (const a of afectados) a.resuelto = true;
    await volcar();
    return afectados.length;
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
