/**
 * Repositorio contra la base de datos real (Supabase / PostgreSQL).
 *
 * Implementa el MISMO contrato que `RepositorioStaging`, así que ni las
 * pantallas ni las reglas de negocio notan el cambio.
 *
 * POR QUÉ CONEXIÓN DIRECTA Y NO `supabase-js`
 *
 * Todo el acceso a datos de esta aplicación ocurre en el servidor: no hay una
 * sola consulta desde el navegador. Y la operación crítica —firmar— vive
 * dentro de PostgreSQL como función (decisión D-03), justamente para que sus
 * cinco escrituras sean atómicas. Llamarla a través de `supabase-js` sería
 * envolver la misma llamada en una capa más, sin ganar nada.
 *
 * `@supabase/ssr` entrará cuando entre Supabase Auth, que es para lo que
 * sirve: gestionar la sesión del usuario. Hoy la sesión es una cookie firmada,
 * igual que en la aplicación Flask.
 *
 * SOBRE LA SEGURIDAD
 *
 * Esta conexión entra como dueño de la base de datos, así que **se salta la
 * protección por fila**. Es aceptable porque:
 *   - la cadena de conexión vive solo en el servidor, nunca en el navegador;
 *   - toda escritura pasa por una Server Action que exige sesión;
 *   - las políticas siguen instaladas y volverán a ser la primera línea de
 *     defensa en cuanto haya usuarios de verdad.
 * No es la situación final, y está anotado como tal.
 */

import "server-only";

import pg, { Pool, type PoolClient } from "pg";

/**
 * Una fecha se lee tal cual está escrita, sin convertirla a nada.
 *
 * Por defecto la librería convierte las columnas `date` en objetos de fecha a
 * medianoche **local**. Al pasarlas luego a texto en horario universal, agosto
 * en Madrid va dos horas por delante, así que `2026-08-04` se convertía en
 * `2026-08-03`: **todas las fechas retrocedían un día**. Se detectó al probar
 * contra Supabase de verdad; con el repositorio de archivo no podía pasar
 * porque ahí las fechas ya eran texto.
 *
 * 1082 es `date` y 1114 es `timestamp` sin zona. Se devuelven como texto y las
 * interpreta el dominio, que ya sabe que la fecha del negocio es la de Madrid.
 */
pg.types.setTypeParser(1082, (valor) => valor);
pg.types.setTypeParser(1114, (valor) => valor);

import type { TipoClase } from "@/domain/economia";
import { MENSUALIDAD, type Modalidad } from "@/domain/modalidades";
import type { CargoMensual, Ciclo, Cliente, Estado, Sesion } from "@/domain/tipos";
import { TARIFA_LIDOMARE } from "@/domain/economia";
import { rangoSemana } from "@/lib/fechas";
import type { Aviso, ClaseGrupo, DatosDeLaLista, DatosMes, Repositorio, SemanaEconomica } from "./tipos";

// -----------------------------------------------------------------------------
// Conexión
// -----------------------------------------------------------------------------
// El pool vive en `globalThis` por el mismo motivo que la caché del staging:
// Next puede cargar este módulo varias veces, y abrir un pool por copia agotaría
// las conexiones del plan gratuito.

interface Global {
  pool?: Pool;
}
const CLAVE = Symbol.for("antifragil.postgres");
const global = globalThis as unknown as Record<symbol, Global | undefined>;

function pool(): Pool {
  if (!global[CLAVE]) global[CLAVE] = {};
  const g = global[CLAVE];
  if (!g.pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    g.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      // El plan gratuito de Supabase da pocas conexiones y esto puede correr
      // en varias instancias a la vez.
      max: 3,
      // Abrir una conexión nueva cuesta unos 700 ms (saludo TCP + cifrado +
      // autenticación) ANTES de la primera consulta. Con los 10 segundos de
      // antes, cualquier pausa normal —mirar un cliente, guardar el móvil,
      // volver a los dos minutos— cerraba la conexión y la siguiente pantalla
      // pagaba otra vez esos 700 ms. Un minuto cubre el uso real sin acaparar
      // conexiones del plan gratuito (2026-08-08).
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 15_000,
      // Que la red no dé por muerta una conexión que solo está en silencio.
      keepAlive: true,
    });
  }
  return g.pool;
}

/** Dentro de una transacción se usa su conexión; fuera, el pool. */
let enCurso: PoolClient | null = null;

/**
 * Fallos de red, no del código.
 *
 * El pooler del plan gratuito cierra conexiones inactivas, así que la primera
 * consulta tras un rato puede llegar cortada. Volver a intentarlo suele
 * bastar; insistir con un error de datos, no.
 */
const TRANSITORIOS = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "57P01"]);

export class BaseNoDisponible extends Error {
  constructor() {
    super("No se ha podido conectar con la base de datos");
    this.name = "BaseNoDisponible";
  }
}

/** El pool avisa de algunos cortes sin código, solo con el texto. */
const TEXTOS_TRANSITORIOS = [
  "connection terminated",
  "connection ended",
  "server closed the connection",
  "timeout exceeded",
  "socket hang up",
];

function esTransitorio(error: unknown): boolean {
  const codigo = (error as { code?: string })?.code;
  if (codigo && TRANSITORIOS.has(codigo)) return true;
  const mensaje = String((error as { message?: string })?.message ?? "").toLowerCase();
  return TEXTOS_TRANSITORIOS.some((texto) => mensaje.includes(texto));
}

async function consultar<T = Record<string, unknown>>(sql: string, valores: unknown[] = []): Promise<T[]> {
  // Dentro de una transacción NO se reintenta: la conexión ya está en un
  // estado concreto y repetir una sentencia a medias sería peor que fallar.
  const intentos = enCurso ? 1 : 3;

  for (let intento = 1; ; intento += 1) {
    try {
      const ejecutor = enCurso ?? pool();
      const resultado = await ejecutor.query(sql, valores);
      return resultado.rows as T[];
    } catch (error) {
      if (!esTransitorio(error)) throw error;
      if (intento >= intentos) throw new BaseNoDisponible();
      await new Promise((sigue) => setTimeout(sigue, 300 * intento));
    }
  }
}

// -----------------------------------------------------------------------------
// Traducción entre las columnas y los tipos del dominio
// -----------------------------------------------------------------------------
// PostgreSQL devuelve `numeric` como texto para no perder precisión. Se
// convierte aquí, en un solo sitio, en vez de en cada consulta.

const numero = (valor: unknown): number | null =>
  valor === null || valor === undefined ? null : Number(valor);

const fecha = (valor: unknown): string | null =>
  valor instanceof Date ? valor.toISOString().slice(0, 10) : ((valor as string | null) ?? null);

function aCliente(f: Record<string, unknown>): Cliente {
  return {
    id: f.id as string,
    nombre: f.nombre as string,
    estado: f.estado as Estado,
    token: f.token as string,
    pendientePago: Boolean(f.pendiente_pago),
    sesionesCompletadas: Number(f.sesiones_completadas),
    cicloActual: Number(f.ciclo_actual),
  };
}

function aCiclo(f: Record<string, unknown>): Ciclo {
  return {
    clienteId: f.cliente_id as string,
    ciclo: Number(f.ciclo),
    modalidad: f.modalidad as Modalidad,
    servicio: f.servicio as string,
    tarifa: numero(f.tarifa),
    sesionesTotales: Number(f.sesiones_totales),
    precioTotal: numero(f.precio_total),
    cuotaMensual: numero(f.cuota_mensual),
    sesionesReferencia: f.sesiones_referencia === null ? null : Number(f.sesiones_referencia),
    anio: f.anio === null ? null : Number(f.anio),
    mes: f.mes === null ? null : Number(f.mes),
    fechaInicio: fecha(f.fecha_inicio),
    fechaFin: fecha(f.fecha_fin),
    // Dos estados y solo dos (2026-08-05). Un servicio del que no consta el
    // cobro está PENDIENTE: nadie ha dicho que se pagara.
    pagado: Boolean(f.pagado),
  };
}

function aSesion(f: Record<string, unknown>): Sesion {
  return {
    id: f.id as string,
    clienteId: f.cliente_id as string,
    fecha: fecha(f.fecha)!,
    hora: f.hora === null ? null : String(f.hora).slice(0, 5),
    numeroSesion: Number(f.numero_sesion),
    sesionesTotales: Number(f.sesiones_totales),
    tarifa: numero(f.tarifa),
    ciclo: Number(f.ciclo),
    servicio: f.servicio as string,
  };
}

const CAMPOS_CICLO = `cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
  precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado`;

// -----------------------------------------------------------------------------

export class RepositorioPostgres implements Repositorio {
  async listarClientes(): Promise<Cliente[]> {
    const filas = await consultar("select * from clientes order by nombre");
    return filas.map(aCliente);
  }

  async obtenerCliente(id: string): Promise<Cliente | null> {
    const filas = await consultar("select * from clientes where id = $1", [id]);
    return filas[0] ? aCliente(filas[0]) : null;
  }

  async obtenerClientePorToken(token: string): Promise<Cliente | null> {
    const filas = await consultar("select * from clientes where token = $1", [token]);
    return filas[0] ? aCliente(filas[0]) : null;
  }

  async crearCliente(cliente: Cliente, cicloInicial: Ciclo): Promise<void> {
    await consultar(
      `insert into clientes (id, nombre, estado, token, pendiente_pago, sesiones_completadas, ciclo_actual)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cliente.id, cliente.nombre, cliente.estado, cliente.token,
        cliente.pendientePago, cliente.sesionesCompletadas, cliente.cicloActual,
      ],
    ).catch((error: { code?: string }) => {
      // El índice único sobre el nombre en minúsculas.
      if (error.code === "23505") throw new Error(`Ya existe un cliente llamado «${cliente.nombre}»`);
      throw error;
    });
    await this.guardarCiclo(cicloInicial);
  }

  async actualizarCliente(cliente: Cliente): Promise<void> {
    await consultar(
      `update clientes set nombre = $2, estado = $3, pendiente_pago = $4,
              sesiones_completadas = $5, ciclo_actual = $6
        where id = $1`,
      [
        cliente.id, cliente.nombre, cliente.estado, cliente.pendientePago,
        cliente.sesionesCompletadas, cliente.cicloActual,
      ],
    );
  }

  async cicloActual(clienteId: string): Promise<Ciclo | null> {
    const filas = await consultar(
      `select ${CAMPOS_CICLO} from ciclos c
        where c.cliente_id = $1
          and c.ciclo = (select ciclo_actual from clientes where id = $1)`,
      [clienteId],
    );
    if (!filas[0]) return null;
    return this.conCobroReal(await this.cargosDe(clienteId), aCiclo(filas[0]));
  }

  async listarCiclos(clienteId: string): Promise<Ciclo[]> {
    const [filas, cargos] = await Promise.all([
      consultar(`select ${CAMPOS_CICLO} from ciclos where cliente_id = $1 order by ciclo desc`, [clienteId]),
      this.cargosDe(clienteId),
    ]);
    return filas.map((f) => this.conCobroReal(cargos, aCiclo(f)));
  }

  private async cargosDe(clienteId: string): Promise<CargoMensual[]> {
    return this.listarCargos(clienteId);
  }

  /**
   * Los datos de TODOS los clientes en tres consultas (2026-08-05).
   *
   * Antes la lista pedía, por cada cliente, su ciclo en curso, sus cuotas,
   * sus ciclos y el recuento de sesiones: cinco viajes de red por cliente.
   * Contra Supabase cada viaje cuesta ~180 ms, así que ocho clientes eran
   * más de siete segundos de espera. Estas tres consultas no crecen con el
   * número de clientes.
   */
  async cargarTodoParaLaLista(): Promise<DatosDeLaLista> {
    const [filasCiclos, filasCargos, filasConteo] = await Promise.all([
      consultar(`select ${CAMPOS_CICLO} from ciclos order by cliente_id, ciclo desc`),
      consultar("select * from cargos_mensuales"),
      consultar<{ cliente_id: string; ciclo: number; n: string }>(
        "select cliente_id, ciclo, count(*)::int as n from sesiones group by cliente_id, ciclo",
      ),
    ]);

    const cargos = filasCargos.map((f) => this.aCargo(f));
    const porCliente = new Map<string, CargoMensual[]>();
    for (const cargo of cargos) {
      const lista = porCliente.get(cargo.clienteId) ?? [];
      lista.push(cargo);
      porCliente.set(cargo.clienteId, lista);
    }

    const ciclos = filasCiclos
      .map((f) => aCiclo(f))
      .map((c) => this.conCobroReal(porCliente.get(c.clienteId) ?? [], c));

    const sesionesPorCiclo = new Map<string, number>();
    for (const fila of filasConteo) {
      sesionesPorCiclo.set(`${fila.cliente_id}:${fila.ciclo}`, Number(fila.n));
    }

    return { ciclos, cargos, sesionesPorCiclo };
  }

  /**
   * En una MENSUALIDAD manda el cargo del mes, no la columna del ciclo
   * (corrección H-02). Si no hay cargo se conserva lo guardado, `null`
   * incluido.
   */
  private conCobroReal(cargos: CargoMensual[], ciclo: Ciclo): Ciclo {
    if (ciclo.modalidad !== MENSUALIDAD || ciclo.anio === null || ciclo.mes === null) return ciclo;
    const cargo = cargos.find((c) => c.anio === ciclo.anio && c.mes === ciclo.mes);
    return cargo ? { ...ciclo, pagado: cargo.pagado } : ciclo;
  }

  async guardarCiclo(ciclo: Ciclo): Promise<void> {
    await consultar(
      `insert into ciclos (${CAMPOS_CICLO})
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (cliente_id, ciclo) do update set
         modalidad = excluded.modalidad, servicio = excluded.servicio,
         tarifa = excluded.tarifa, sesiones_totales = excluded.sesiones_totales,
         precio_total = excluded.precio_total, cuota_mensual = excluded.cuota_mensual,
         sesiones_referencia = excluded.sesiones_referencia,
         anio = excluded.anio, mes = excluded.mes,
         fecha_inicio = excluded.fecha_inicio, fecha_fin = excluded.fecha_fin,
         pagado = excluded.pagado`,
      [
        ciclo.clienteId, ciclo.ciclo, ciclo.modalidad, ciclo.servicio, ciclo.tarifa,
        ciclo.sesionesTotales, ciclo.precioTotal, ciclo.cuotaMensual, ciclo.sesionesReferencia,
        ciclo.anio, ciclo.mes, ciclo.fechaInicio, ciclo.fechaFin, ciclo.pagado,
      ],
    );
  }

  async listarSesiones(clienteId: string): Promise<Sesion[]> {
    const filas = await consultar(
      `select * from sesiones where cliente_id = $1 order by fecha desc, creado desc, id desc`,
      [clienteId],
    );
    return filas.map(aSesion);
  }

  async contarSesionesDelCiclo(clienteId: string, ciclo: number): Promise<number> {
    const filas = await consultar<{ n: string }>(
      "select count(*)::int as n from sesiones where cliente_id = $1 and ciclo = $2",
      [clienteId, ciclo],
    );
    return Number(filas[0]?.n ?? 0);
  }

  async guardarSesion(sesion: Sesion): Promise<void> {
    await consultar(
      `insert into sesiones (id, cliente_id, ciclo, fecha, hora, numero_sesion,
                             sesiones_totales, tarifa, servicio)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        sesion.id, sesion.clienteId, sesion.ciclo, sesion.fecha, sesion.hora,
        sesion.numeroSesion, sesion.sesionesTotales, sesion.tarifa, sesion.servicio,
      ],
    );
  }

  async eliminarSesion(sesionId: string): Promise<Sesion | null> {
    const filas = await consultar("delete from sesiones where id = $1 returning *", [sesionId]);
    return filas[0] ? aSesion(filas[0]) : null;
  }

  async guardarSesionEditada(sesionId: string, fecha: string, numeroSesion: number): Promise<void> {
    await consultar("update sesiones set fecha = $2, numero_sesion = $3 where id = $1", [
      sesionId, fecha, numeroSesion,
    ]);
  }

  async renumerarPosteriores(clienteId: string, ciclo: number, desde: number): Promise<void> {
    await consultar(
      "update sesiones set numero_sesion = numero_sesion - 1 " +
        "where cliente_id = $1 and ciclo = $2 and numero_sesion > $3",
      [clienteId, ciclo, desde],
    );
  }

  async reubicarSesion(sesionId: string, ciclo: number, numeroSesion: number): Promise<void> {
    await consultar("update sesiones set ciclo = $2, numero_sesion = $3 where id = $1", [
      sesionId, ciclo, numeroSesion,
    ]);
  }

  async eliminarCliente(clienteId: string): Promise<void> {
    await consultar("delete from clientes where id = $1", [clienteId]);
  }

  async cargoDelMes(clienteId: string, anio: number, mes: number): Promise<CargoMensual | null> {
    const filas = await consultar(
      `select * from cargos_mensuales
        where cliente_id = $1 and anio = $2 and mes = $3 and concepto = 'mensualidad'`,
      [clienteId, anio, mes],
    );
    return filas[0] ? this.aCargo(filas[0]) : null;
  }

  private aCargo(f: Record<string, unknown>): CargoMensual {
    return {
      clienteId: f.cliente_id as string,
      anio: Number(f.anio),
      mes: Number(f.mes),
      concepto: "mensualidad",
      ciclo: Number(f.ciclo),
      importe: Number(f.importe),
      pagado: Boolean(f.pagado),
    };
  }

  async guardarCargo(cargo: CargoMensual): Promise<void> {
    // La clave (cliente, año, mes, concepto) es lo que impide cobrar dos veces
    // el mismo mes. Aquí solo se actualiza lo que puede cambiar de verdad.
    await consultar(
      `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado)
       values ($1,$2,$3,'mensualidad',$4,$5,$6)
       on conflict (cliente_id, anio, mes, concepto) do update set
         importe = excluded.importe, pagado = excluded.pagado`,
      [cargo.clienteId, cargo.anio, cargo.mes, cargo.ciclo, cargo.importe, cargo.pagado],
    );
  }

  async listarCargos(clienteId: string): Promise<CargoMensual[]> {
    const filas = await consultar("select * from cargos_mensuales where cliente_id = $1", [clienteId]);
    return filas.map((f) => this.aCargo(f));
  }

  async sumarASemana(fechaIso: string, tarifa: number | null, sesiones: number): Promise<void> {
    const { inicio, fin } = rangoSemana(fechaIso);
    // Una sesión sin importe suma HORA y solo hora (corrección H-01).
    const facturacion = tarifa === null ? 0 : sesiones * tarifa;
    const horas = tarifa === null ? 0 : sesiones;
    const sinImporte = tarifa === null ? sesiones : 0;

    // Los valores del INSERT van recortados a 0 y los del UPDATE llevan el
    // cambio real, que puede ser negativo al borrar una sesión. PostgreSQL
    // comprueba las restricciones sobre la fila que se intenta insertar antes
    // de resolver el conflicto, así que un -1 ahí rompería aunque la semana ya
    // existiera.
    await consultar(
      `insert into semanas (inicio, fin, facturacion, horas, horas_sin_importe)
       values ($1, $2, greatest($3::numeric, 0), greatest($4::int, 0), greatest($5::int, 0))
       on conflict (inicio) do update set
         facturacion       = greatest(semanas.facturacion + $3::numeric, 0),
         horas             = greatest(semanas.horas + $4::int, 0),
         horas_sin_importe = greatest(semanas.horas_sin_importe + $5::int, 0)`,
      [inicio, fin, facturacion, horas, sinImporte],
    );
  }

  async listarSemanas(): Promise<SemanaEconomica[]> {
    // Las clases de Kids de cada semana y el importe de SU mes se resuelven
    // aquí para no tener que ir consultando semana a semana desde arriba.
    const filas = await consultar(
      `select s.*,
              (select count(*) from clases_grupo c
                where c.tipo = 'kids' and c.fecha between s.inicio and s.fin)::int as kids,
              (select k.importe from facturacion_kids_mensual k
                where k.anio = extract(year from s.inicio)::int
                  and k.mes = extract(month from s.inicio)::int) as importe_kids
         from semanas s order by s.inicio desc`,
    );
    return filas.map((f) => ({
      inicio: fecha(f.inicio)!,
      fin: fecha(f.fin)!,
      facturacion: Number(f.facturacion),
      horas: Number(f.horas),
      horasSinImporte: Number(f.horas_sin_importe),
      sesionesKids: Number(f.kids ?? 0),
      facturacionKids: numero(f.importe_kids),
    }));
  }

  async registrarClase(fechaIso: string, tipo: TipoClase): Promise<void> {
    await consultar("insert into clases_grupo (fecha, tipo) values ($1, $2)", [fechaIso, tipo]);
    if (tipo === "lidomare") {
      // Lidomare tiene tarifa fija, así que suma a la semana como una sesión
      // más. Kids no: su dinero no se conoce hasta acabar el mes.
      await this.sumarASemana(fechaIso, TARIFA_LIDOMARE, 1);
    }
  }

  async deshacerUltimaClase(tipo: TipoClase): Promise<string | null> {
    const filas = await consultar(
      `delete from clases_grupo where id = (
         select id from clases_grupo where tipo = $1 order by fecha desc, creado desc limit 1
       ) returning fecha`,
      [tipo],
    );
    const cuando = filas[0] ? fecha(filas[0].fecha) : null;
    if (cuando && tipo === "lidomare") await this.sumarASemana(cuando, TARIFA_LIDOMARE, -1);
    return cuando;
  }

  async contarClases(desde: string, hasta: string): Promise<Record<TipoClase, number>> {
    const filas = await consultar<{ tipo: TipoClase; n: number }>(
      "select tipo, count(*)::int as n from clases_grupo where fecha between $1 and $2 group by tipo",
      [desde, hasta],
    );
    const cuenta: Record<TipoClase, number> = { lidomare: 0, kids: 0 };
    for (const f of filas) cuenta[f.tipo] = Number(f.n);
    return cuenta;
  }

  async borrarClase(id: string): Promise<{ fecha: string; tipo: TipoClase } | null> {
    const filas = await consultar(
      "delete from clases_grupo where id = $1 returning to_char(fecha,'YYYY-MM-DD') as fecha, tipo",
      [id],
    );
    if (!filas[0]) return null;
    const borrada = { fecha: String(filas[0].fecha), tipo: filas[0].tipo as TipoClase };
    // Igual que `deshacerUltimaClase`: si era de Lidomare, su dinero sale
    // también de la semana. Si no, quedarían 15 € contados sin clase detrás.
    if (borrada.tipo === "lidomare") await this.sumarASemana(borrada.fecha, TARIFA_LIDOMARE, -1);
    return borrada;
  }

  async clasesDelMes(tipo: TipoClase, anio: number, mes: number): Promise<ClaseGrupo[]> {
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const filas = await consultar(
      `select id, to_char(fecha,'YYYY-MM-DD') as fecha, tipo from clases_grupo
        where tipo = $1 and fecha >= $2::date and fecha < ($2::date + interval '1 month')
        order by fecha desc, id desc`,
      [tipo, desde],
    );
    return filas.map((f) => ({ id: String(f.id), fecha: String(f.fecha), tipo: f.tipo as TipoClase }));
  }

  async facturacionKids(anio: number, mes: number): Promise<number | null> {
    const filas = await consultar(
      "select importe from facturacion_kids_mensual where anio = $1 and mes = $2",
      [anio, mes],
    );
    return filas[0] ? Number(filas[0].importe) : null;
  }

  async guardarFacturacionKids(anio: number, mes: number, importe: number): Promise<void> {
    await consultar(
      `insert into facturacion_kids_mensual (anio, mes, importe) values ($1,$2,$3)
       on conflict (anio, mes) do update set importe = excluded.importe`,
      [anio, mes, importe],
    );
  }

  async mesesConDatos(): Promise<Array<{ anio: number; mes: number }>> {
    // Un mes puede existir solo por su cuota o por su ajuste, sin ninguna
    // sesión detrás. Si no se incluyeran, ese dinero desaparecería.
    const filas = await consultar<{ anio: number; mes: number }>(
      `select distinct extract(year from fecha)::int as anio, extract(month from fecha)::int as mes
         from sesiones
       union
       select distinct extract(year from fecha)::int, extract(month from fecha)::int from clases_grupo
       union select distinct anio, mes from cargos_mensuales
       union select distinct anio, mes from ajustes_mensuales
       order by 1 desc, 2 desc`,
    );
    return filas.map((f) => ({ anio: Number(f.anio), mes: Number(f.mes) }));
  }

  /**
   * Todos los meses de una vez, en cinco consultas fijas.
   *
   * Cada consulta trae su tabla entera agrupada por mes y el reparto se hace
   * aquí, en memoria. Es deliberado: contra Supabase lo caro no es la
   * consulta, es el viaje de ida y vuelta (unos 20 ms desde el servidor de
   * París, unos 110 ms desde un portátil en España). Cinco viajes largos
   * ganan siempre a sesenta cortos.
   *
   * El volumen no preocupa: son las sesiones de un entrenador personal, unos
   * pocos miles de filas en toda la historia del negocio.
   */
  async datosDeTodosLosMeses(): Promise<Array<{ anio: number; mes: number } & DatosMes>> {
    const clave = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, "0")}`;

    const [sesiones, cargos, clases, ajustes, kids] = await Promise.all([
      consultar(
        `select to_char(s.fecha,'YYYY-MM-DD') as fecha, s.tarifa,
                coalesce(c.modalidad::text, 'bono') as modalidad
           from sesiones s
           left join ciclos c on c.cliente_id = s.cliente_id and c.ciclo = s.ciclo`,
      ),
      consultar("select anio, mes, importe from cargos_mensuales"),
      consultar(
        `select extract(year from fecha)::int as anio, extract(month from fecha)::int as mes,
                tipo, count(*)::int as n
           from clases_grupo group by 1, 2, 3`,
      ),
      consultar("select anio, mes, origen, importe, horas, motivo from ajustes_mensuales order by origen"),
      consultar("select anio, mes, importe from facturacion_kids_mensual"),
    ]);

    // Un mes existe si algo lo menciona, aunque sea solo una cuota o un
    // ajuste: si no se incluyera, ese dinero desaparecería de la pantalla.
    const meses = new Map<string, { anio: number; mes: number } & DatosMes>();
    const mesDe = (anio: number, mes: number) => {
      const k = clave(anio, mes);
      let m = meses.get(k);
      if (!m) {
        m = {
          anio,
          mes,
          sesiones: [],
          cuotas: [],
          clasesLidomare: 0,
          clasesKids: 0,
          facturacionKids: null,
          ajustes: [],
        };
        meses.set(k, m);
      }
      return m;
    };

    for (const s of sesiones) {
      const f = fecha(s.fecha)!;
      mesDe(Number(f.slice(0, 4)), Number(f.slice(5, 7))).sesiones.push({
        fecha: f,
        tarifa: numero(s.tarifa),
        modalidad: s.modalidad as Modalidad,
      });
    }
    for (const c of cargos) mesDe(Number(c.anio), Number(c.mes)).cuotas.push(Number(c.importe));
    for (const c of clases) {
      const m = mesDe(Number(c.anio), Number(c.mes));
      if (c.tipo === "kids") m.clasesKids = Number(c.n);
      else if (c.tipo === "lidomare") m.clasesLidomare = Number(c.n);
    }
    for (const a of ajustes) {
      mesDe(Number(a.anio), Number(a.mes)).ajustes.push({
        origen: a.origen as string,
        importe: Number(a.importe),
        horas: Number(a.horas),
        motivo: a.motivo as string,
      });
    }
    for (const k of kids) mesDe(Number(k.anio), Number(k.mes)).facturacionKids = Number(k.importe);

    // Del más reciente al más antiguo, como los enseña la pantalla.
    return [...meses.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, m]) => m);
  }

  async datosDelMes(anio: number, mes: number) {
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    // Las cuatro consultas no dependen entre sí, así que van a la vez: contra
    // Supabase lo caro no es la consulta, es esperar una detrás de otra
    // (2026-08-05).
    const [sesiones, cuotas, clases, ajustes, importeKids] = await Promise.all([
      consultar(
      `select s.fecha, s.tarifa, coalesce(c.modalidad::text, 'bono') as modalidad
         from sesiones s
         left join ciclos c on c.cliente_id = s.cliente_id and c.ciclo = s.ciclo
        where s.fecha >= $1::date and s.fecha < ($1::date + interval '1 month')`,
      [desde],
      ),
      consultar("select importe from cargos_mensuales where anio = $1 and mes = $2", [anio, mes]),
      consultar<{ tipo: TipoClase; n: number }>(
        `select tipo, count(*)::int as n from clases_grupo
          where fecha >= $1::date and fecha < ($1::date + interval '1 month') group by tipo`,
        [desde],
      ),
      consultar(
        "select origen, importe, horas, motivo from ajustes_mensuales where anio = $1 and mes = $2 order by origen",
        [anio, mes],
      ),
      this.facturacionKids(anio, mes),
    ]);

    const porTipo: Record<string, number> = {};
    for (const c of clases) porTipo[c.tipo] = Number(c.n);

    return {
      sesiones: sesiones.map((s) => ({
        fecha: fecha(s.fecha)!,
        tarifa: numero(s.tarifa),
        modalidad: s.modalidad as Modalidad,
      })),
      cuotas: cuotas.map((c) => Number(c.importe)),
      clasesLidomare: porTipo.lidomare ?? 0,
      clasesKids: porTipo.kids ?? 0,
      facturacionKids: importeKids,
      ajustes: ajustes.map((a) => ({
        origen: a.origen as string,
        importe: Number(a.importe),
        horas: Number(a.horas),
        motivo: a.motivo as string,
      })),
    };
  }

  async sesionesSinConfirmarHoy(clienteId: string, hoy: string): Promise<Sesion[]> {
    const filas = await consultar(
      `select s.* from sesiones s
        where s.cliente_id = $1 and s.fecha = $2
          and not exists (select 1 from confirmaciones c where c.sesion_id = s.id)
        order by s.creado`,
      [clienteId, hoy],
    );
    return filas.map(aSesion);
  }

  async confirmacionesDeHoy(clienteId: string, hoy: string): Promise<Array<{ hora: string }>> {
    const filas = await consultar(
      "select hora from confirmaciones where cliente_id = $1 and fecha = $2 order by hora",
      [clienteId, hoy],
    );
    return filas.map((f) => ({ hora: String(f.hora).slice(0, 5) }));
  }

  async confirmarSesion(clienteId: string, sesionId: string, hoy: string, hora: string): Promise<void> {
    // `do nothing` sobre la clave única de la sesión: escanear el QR dos veces
    // no puede crear dos confirmaciones.
    await consultar(
      `insert into confirmaciones (cliente_id, sesion_id, fecha, hora) values ($1,$2,$3,$4)
       on conflict (sesion_id) do nothing`,
      [clienteId, sesionId, hoy, hora],
    );
  }

  async registrarAviso(aviso: { fecha: string; tipo: string; detalle: string }): Promise<void> {
    // El índice único sobre (tipo, detalle) de los no resueltos impide llenar
    // la bandeja de copias del mismo aviso mientras su causa siga ahí.
    await consultar(
      `insert into avisos (fecha, tipo, detalle) values ($1,$2,$3)
       on conflict do nothing`,
      [aviso.fecha, aviso.tipo, aviso.detalle],
    );
  }

  async listarAvisos(): Promise<Aviso[]> {
    const filas = await consultar(
      "select id, fecha, tipo, detalle, leido from avisos where not resuelto order by creado desc",
    );
    return filas.map((f) => ({
      id: f.id as string,
      fecha: fecha(f.fecha)!,
      tipo: f.tipo as string,
      detalle: f.detalle as string,
      leido: Boolean(f.leido),
    }));
  }

  async contarNoLeidos(): Promise<number> {
    const filas = await consultar<{ n: string }>(
      "select count(*)::int as n from avisos where not resuelto and not leido",
    );
    return Number(filas[0]?.n ?? 0);
  }

  async marcarTodosLeidos(): Promise<void> {
    await consultar("update avisos set leido = true where not resuelto and not leido");
  }

  async resolverAviso(id: string): Promise<void> {
    await consultar("update avisos set resuelto = true where id = $1", [id]);
  }

  async resolverPorTipo(tipo: string): Promise<number> {
    const filas = await consultar(
      "update avisos set resuelto = true where tipo = $1 and not resuelto returning id",
      [tipo],
    );
    return filas.length;
  }

  async registrarIdempotencia(clave: string): Promise<boolean> {
    // `do nothing` + `returning`: si ya estaba, no devuelve fila. Lo decide la
    // clave primaria, no el código.
    const filas = await consultar(
      "insert into idempotencia (clave) values ($1) on conflict (clave) do nothing returning clave",
      [clave],
    );
    return filas.length > 0;
  }

  /**
   * Todo o nada, de verdad: `begin` / `commit` / `rollback` de PostgreSQL.
   *
   * Se reserva una conexión para toda la operación, porque una transacción
   * repartida entre varias conexiones del pool no sería una transacción.
   */
  async transaccion<T>(operacion: () => Promise<T>): Promise<T> {
    if (enCurso) return operacion(); // Ya estamos dentro de una.

    const conexion = await pool().connect();
    enCurso = conexion;
    try {
      await conexion.query("begin");
      const resultado = await operacion();
      await conexion.query("commit");
      return resultado;
    } catch (error) {
      await conexion.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      enCurso = null;
      conexion.release();
    }
  }
}
