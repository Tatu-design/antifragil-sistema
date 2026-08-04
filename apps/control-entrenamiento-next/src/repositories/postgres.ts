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
import type { Repositorio, SemanaEconomica } from "./tipos";

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
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
  }
  return g.pool;
}

/** Dentro de una transacción se usa su conexión; fuera, el pool. */
let enCurso: PoolClient | null = null;

async function consultar<T = Record<string, unknown>>(sql: string, valores: unknown[] = []): Promise<T[]> {
  const ejecutor = enCurso ?? pool();
  const resultado = await ejecutor.query(sql, valores);
  return resultado.rows as T[];
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
    // Se conserva el tri-estado: `null` es «no se sabe», no «sin pagar».
    pagado: f.pagado === null ? null : Boolean(f.pagado),
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
    return filas[0] ? this.conCobroReal(await this.cargosDe(clienteId), aCiclo(filas[0])) : null;
  }

  async listarCiclos(clienteId: string): Promise<Ciclo[]> {
    const filas = await consultar(
      `select ${CAMPOS_CICLO} from ciclos where cliente_id = $1 order by ciclo desc`,
      [clienteId],
    );
    const cargos = await this.cargosDe(clienteId);
    return filas.map((f) => this.conCobroReal(cargos, aCiclo(f)));
  }

  private async cargosDe(clienteId: string): Promise<CargoMensual[]> {
    return this.listarCargos(clienteId);
  }

  /**
   * En una MENSUALIDAD manda el cargo del mes, no la columna del ciclo
   * (corrección H-02). Si no hay cargo se conserva lo guardado, `null`
   * incluido: `null` significa «no se sabe», nunca «no pagado».
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

  async datosDelMes(anio: number, mes: number) {
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const sesiones = await consultar(
      `select s.fecha, s.tarifa, coalesce(c.modalidad::text, 'bono') as modalidad
         from sesiones s
         left join ciclos c on c.cliente_id = s.cliente_id and c.ciclo = s.ciclo
        where s.fecha >= $1::date and s.fecha < ($1::date + interval '1 month')`,
      [desde],
    );
    const cuotas = await consultar(
      "select importe from cargos_mensuales where anio = $1 and mes = $2",
      [anio, mes],
    );
    const clases = await consultar<{ tipo: TipoClase; n: number }>(
      `select tipo, count(*)::int as n from clases_grupo
        where fecha >= $1::date and fecha < ($1::date + interval '1 month') group by tipo`,
      [desde],
    );
    const ajustes = await consultar(
      "select origen, importe, horas, motivo from ajustes_mensuales where anio = $1 and mes = $2 order by origen",
      [anio, mes],
    );

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
      facturacionKids: await this.facturacionKids(anio, mes),
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
