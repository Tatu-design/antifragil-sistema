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

import { conConexion, conexionEnCurso } from "./conexion-en-curso";

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
import { DESDE_QUE_HAY_PROFESIONALES } from "@/domain/atribucion";
import { MENSUALIDAD, type Modalidad, ErrorDeNegocio } from "@/domain/modalidades";
import type { CargoMensual, Ciclo, Cliente, Estado, Sesion, SesionDelCalendario } from "@/domain/tipos";
import { TARIFA_LIDOMARE } from "@/domain/economia";
import { rangoSemana } from "@/lib/fechas";
import type { Aviso, ClaseGrupo, DatosDeLaLista, DatosMes, Perfil, Repositorio, SemanaEconomica } from "./tipos";

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
      // CINCO CONEXIONES POR INSTANCIA (2026-09-02).
      //
      // Estuvo en 1 desde el 2026-08-27, cuando el pooler iba en modo sesión y
      // solo aceptaba 15 clientes para TODA la aplicación: con tres por
      // instancia, cinco instancias agotaban el cupo. Bajarlo a una arregló
      // aquello.
      //
      // Pero el 2026-08-30 la base pasó a modo transacción, donde ya no hay
      // ese techo —medido: 45 conexiones a la vez sin un fallo—, y quedarse en
      // una salió caro: con una sola conexión, todas las consultas de una
      // pantalla van EN FILA aunque el código las lance a la vez. Los
      // `Promise.all` de toda la aplicación no servían de nada.
      //
      // Medido contra la base real, siete consultas como las de la lista de
      // clientes, con las conexiones ya abiertas:
      //
      //     max: 1 → 332 ms     max: 4 → 95 ms     max: 7 → 51 ms
      //
      // Cinco cubre de sobra la pantalla más pesada y deja margen: aunque
      // hubiera seis instancias a la vez serían treinta conexiones, muy por
      // debajo de lo que aguanta el pooler.
      max: 5,
      // Abrir una conexión nueva cuesta unos 700 ms (saludo TCP + cifrado +
      // autenticación) ANTES de la primera consulta. Con los 10 segundos de
      // antes, cualquier pausa normal —mirar un cliente, guardar el móvil,
      // volver a los dos minutos— cerraba la conexión y la siguiente pantalla
      // pagaba otra vez esos 700 ms. Un minuto cubre el uso real sin acaparar
      // conexiones del plan gratuito (2026-08-08).
      // Bajado de 60 s a 25 s (2026-08-27). Un minuto entero agarrando una
      // conexión sin usarla es justo lo que dejaba sin cupo a los demás. A los
      // 25 segundos sigue cubriendo el uso normal —mirar un cliente, firmar,
      // pasar a otro— y suelta mucho antes cuando se deja el móvil.
      idleTimeoutMillis: 25_000,
      connectionTimeoutMillis: 15_000,
      // NINGUNA CONSULTA PUEDE ESPERAR PARA SIEMPRE (2026-08-24). Sin esto,
      // una conexión que muere en silencio deja la promesa colgada: la
      // pantalla se queda en «Guardando…» y no hay nada que la despierte. Con
      // solo tres conexiones, tres cuelgues bloquean la aplicación entera.
      //
      // Ocho segundos son muchísimo —una consulta normal tarda medio segundo—
      // y quedan por debajo del límite de la propia página, así que si algo va
      // mal se ve un error, que se entiende, en vez de una espera infinita.
      statement_timeout: 8_000,
      query_timeout: 8_000,
      // Que la red no dé por muerta una conexión que solo está en silencio.
      keepAlive: true,
    });
  }
  return g.pool;
}

/**
 * Dentro de una transacción se usa su conexión; fuera, el pool.
 *
 * **Es por petición, no del módulo** (2026-08-24). Cuando era una variable
 * suelta, dos peticiones a la vez compartían la misma nota y la segunda
 * acababa mandando sus consultas por la conexión de la primera; ver
 * `conexion-en-curso.ts`.
 */
const conexionDeLaTransaccion = () => conexionEnCurso<PoolClient>();

/**
 * Fallos de red, no del código.
 *
 * El pooler del plan gratuito cierra conexiones inactivas, así que la primera
 * consulta tras un rato puede llegar cortada. Volver a intentarlo suele
 * bastar; insistir con un error de datos, no.
 */
const TRANSITORIOS = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "57P01",
  // Ojo: NO se pone aquí `XX000`. Es el cajón de sastre de PostgreSQL y
  // taparlo entero escondería errores de verdad. El caso que sí interesa —
  // quedarse sin cupo en el pooler— se reconoce por su mensaje, unas líneas
  // más abajo.
]);

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
  // SIN CUPO EN EL POOLER (2026-08-27). Hay 15 conexiones para toda la
  // aplicación y en ese instante estaban todas ocupadas. Es lo más transitorio
  // que existe —en cuanto otra instancia termina, sobra sitio—, así que
  // reintentar es justo lo que hay que hacer. Sin esto se le lanzaba el error
  // a la cara del usuario a la primera: le pasó a Fernando al firmar.
  "max clients reached",
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
  const dentroDeTransaccion = conexionDeLaTransaccion();
  const intentos = dentroDeTransaccion ? 1 : 3;

  for (let intento = 1; ; intento += 1) {
    try {
      const ejecutor = dentroDeTransaccion ?? pool();
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
    // La columna de la base se llama `entrenador_id` y el código dice
    // `profesionalId`: es la misma cosa. Fernando llama «profesional» a la
    // persona y «entrenador» al rol, que es una distinción útil. Renombrar la
    // columna exigiría una migración y no cambiaría nada de lo que se ve.
    profesionalId: (f.entrenador_id as string | null) ?? null,
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
    firmadaPor: (f.firmada_por as string | null) ?? null,
    profesionalId: (f.profesional_id as string | null) ?? null,
  };
}

/** «Este aviso es de un cliente de ese profesional». Se escribe una vez. */
const SUYOS =
  "cliente_id in (select id from clientes where entrenador_id = $1)";

const CAMPOS_CICLO = `cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
  precio_total, cuota_mensual, sesiones_referencia, anio, mes, fecha_inicio, fecha_fin, pagado`;

// -----------------------------------------------------------------------------

export class RepositorioPostgres implements Repositorio {
  async listarClientes(soloDe?: string | null): Promise<Cliente[]> {
    // Sin `soloDe` vienen todos: es lo que ve un administrador. Con él, solo
    // los suyos, y el filtro lo hace la base de datos — los demás ni salen.
    const filas = soloDe
      ? await consultar("select * from clientes where entrenador_id = $1 order by nombre", [soloDe])
      : await consultar("select * from clientes order by nombre");
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
      `insert into clientes (id, nombre, estado, token, pendiente_pago, sesiones_completadas,
                             ciclo_actual, entrenador_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cliente.id, cliente.nombre, cliente.estado, cliente.token,
        cliente.pendientePago, cliente.sesionesCompletadas, cliente.cicloActual,
        // Faltaba, y el cliente nacia sin profesional aunque se hubiera
        // elegido uno (2026-08-10). El fallo no lo vieron las pruebas porque
        // el repositorio de pruebas guarda el objeto entero y esta columna
        // sobrevivia sola; aqui habia que nombrarla y no estaba.
        cliente.profesionalId ?? null,
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
              sesiones_completadas = $5, ciclo_actual = $6, entrenador_id = $7
        where id = $1`,
      [
        cliente.id, cliente.nombre, cliente.estado, cliente.pendientePago,
        cliente.sesionesCompletadas, cliente.cicloActual, cliente.profesionalId ?? null,
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
  async cargarTodoParaLaLista(soloDe?: string | null): Promise<DatosDeLaLista> {
    // Los ciclos, las cuotas y las sesiones de OTROS clientes no se traen
    // siquiera. No es una optimización: es que el historial y el dinero de los
    // clientes de Fernando no deben salir de la base hacia el móvil de un
    // entrenador, ni aunque la pantalla luego no los pinte (2026-08-09).
    const suyos = "cliente_id in (select id from clientes where entrenador_id = $1)";
    const [filasCiclos, filasCargos, filasConteo] = await Promise.all([
      consultar(
        `select ${CAMPOS_CICLO} from ciclos${soloDe ? ` where ${suyos}` : ""} order by cliente_id, ciclo desc`,
        soloDe ? [soloDe] : [],
      ),
      consultar(
        `select * from cargos_mensuales${soloDe ? ` where ${suyos}` : ""}`,
        soloDe ? [soloDe] : [],
      ),
      consultar<{ cliente_id: string; ciclo: number; n: string }>(
        `select cliente_id, ciclo, count(*)::int as n from sesiones${soloDe ? ` where ${suyos}` : ""}
          group by cliente_id, ciclo`,
        soloDe ? [soloDe] : [],
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

  async sesionesEntre(
    desde: string,
    hasta: string,
    alcance: { soloDe?: string | null; adminId?: string | null } = {},
  ): Promise<SesionDelCalendario[]> {
    const soloDe = alcance.soloDe ?? null;

    // De quién es una sesión, con las MISMAS tres reglas que Economía
    // (`domain/atribucion.ts`): lo que se guardó al firmarla; si no, del
    // administrador cuando es anterior a que existieran los profesionales; y
    // si no, del responsable actual del cliente.
    //
    // Se calcula en SQL y se filtra en SQL: cuando se pide la de alguien, la
    // base NO devuelve las de los demás. Un entrenador que cambie el
    // identificador en la dirección no recibe filas de otro, aunque acierte.
    const duenio =
      "coalesce(s.profesional_id, case when s.fecha < $3::date then $4 else cl.entrenador_id end)";

    const filas = await consultar(
      `select s.id, s.cliente_id, cl.nombre as cliente,
              to_char(s.fecha,'YYYY-MM-DD') as fecha,
              to_char(s.hora,'HH24:MI') as hora,
              s.servicio,
              ${duenio} as duenio
         from sesiones s
         join clientes cl on cl.id = s.cliente_id
        where s.fecha >= $1::date and s.fecha <= $2::date
          ${soloDe ? `and ${duenio} = $5` : ""}
        order by s.fecha, s.hora nulls last, cl.nombre`,
      soloDe
        ? [desde, hasta, DESDE_QUE_HAY_PROFESIONALES, alcance.adminId ?? null, soloDe]
        : [desde, hasta, DESDE_QUE_HAY_PROFESIONALES, alcance.adminId ?? null],
    );

    return filas.map((f) => ({
      id: f.id as string,
      clienteId: f.cliente_id as string,
      cliente: f.cliente as string,
      fecha: f.fecha as string,
      hora: (f.hora as string | null) ?? null,
      servicio: f.servicio as string,
      profesionalId: (f.duenio as string | null) ?? null,
    }));
  }

  async resumenDeSesionesEntre(desde: string, hasta: string) {
    // Suma la base, no el servidor: no viaja ni una fila de sesión.
    const filas = await consultar<{ facturacion: string; horas: number; sin_importe: number }>(
      `select coalesce(sum(tarifa), 0)::float as facturacion,
              count(*) filter (where tarifa is not null)::int as horas,
              count(*) filter (where tarifa is null)::int as sin_importe
         from sesiones
        where fecha >= $1::date and fecha <= $2::date`,
      [desde, hasta],
    );
    const f = filas[0];
    return {
      facturacion: Number(f?.facturacion ?? 0),
      horas: Number(f?.horas ?? 0),
      horasSinImporte: Number(f?.sin_importe ?? 0),
    };
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
                             sesiones_totales, tarifa, servicio, firmada_por, profesional_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        sesion.id, sesion.clienteId, sesion.ciclo, sesion.fecha, sesion.hora,
        sesion.numeroSesion, sesion.sesionesTotales, sesion.tarifa, sesion.servicio,
        sesion.firmadaPor ?? null,
        // De quién es la producción. Ver `domain/tipos.ts`.
        sesion.profesionalId ?? null,
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
      profesionalId: (f.profesional_id as string | null) ?? null,
    };
  }

  async guardarCargo(cargo: CargoMensual): Promise<void> {
    // La clave (cliente, año, mes, concepto) es lo que impide cobrar dos veces
    // el mismo mes. Aquí solo se actualiza lo que puede cambiar de verdad.
    await consultar(
      `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado,
                                     profesional_id)
       values ($1,$2,$3,'mensualidad',$4,$5,$6,$7)
       on conflict (cliente_id, anio, mes, concepto) do update set
         importe = excluded.importe, pagado = excluded.pagado`,
      [cargo.clienteId, cargo.anio, cargo.mes, cargo.ciclo, cargo.importe, cargo.pagado,
       cargo.profesionalId ?? null],
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

  // ---------------------------------------------------------------------------
  // Quién usa la aplicación
  // ---------------------------------------------------------------------------

  /**
   * La cuenta de acceso vive en `auth.users` (la gestiona Supabase) y el rol
   * en `perfiles`. El vínculo es el mismo identificador en las dos.
   *
   * Se exige aquí, otra vez, que la cuenta esté confirmada y sin bloquear: la
   * cookie de sesión dura dos semanas y no debe sobrevivir a un bloqueo.
   */
  async perfilPorCorreo(correo: string): Promise<Perfil | null> {
    const filas = await consultar<{ id: string; email: string; nombre: string; rol: string; foto: string | null }>(
      `select p.id, u.email, p.nombre, p.rol, p.foto
         from public.perfiles p
         join auth.users u on u.id = p.id
        where lower(u.email) = $1
      -- En minusculas los dos lados: un correo es el mismo escribas la
      -- primera letra como la escribas. Sin esto, una cuenta dada de alta con
      -- mayusculas no podia entrar NUNCA (2026-08-10).
          and u.email_confirmed_at is not null
          and u.banned_until is null`,
      [correo.trim().toLowerCase()],
    );
    const f = filas[0];
    // Si la consulta ha devuelto algo es que la cuenta no está bloqueada: lo
    // exige ella misma. Por eso aquí `activo` es true por definición.
    return f
      ? {
          id: f.id,
          correo: f.email,
          nombre: f.nombre,
          rol: f.rol as Perfil["rol"],
          foto: f.foto ?? null,
          activo: true,
        }
      : null;
  }

  async profesionalDelCliente(clienteId: string): Promise<string | null> {
    const filas = await consultar<{ entrenador_id: string | null }>(
      "select entrenador_id from clientes where id = $1",
      [clienteId],
    );
    return filas[0]?.entrenador_id ?? null;
  }

  async perfilPorId(id: string | null): Promise<Perfil | null> {
    if (!id) return null;
    const filas = await consultar<{
      id: string;
      email: string;
      nombre: string;
      rol: string;
      foto: string | null;
      activo: boolean;
    }>(
      `select p.id, u.email, p.nombre, p.rol, p.foto,
              (u.banned_until is null or u.banned_until < now()) as activo
         from public.perfiles p
         join auth.users u on u.id = p.id
        where p.id = $1`,
      [id],
    );
    const f = filas[0];
    return f
      ? {
          id: f.id,
          correo: f.email,
          nombre: f.nombre,
          rol: f.rol as Perfil["rol"],
          foto: f.foto ?? null,
          activo: Boolean(f.activo),
        }
      : null;
  }

  async listarProfesionales(): Promise<Perfil[]> {
    const filas = await consultar<{
      id: string;
      email: string;
      nombre: string;
      rol: string;
      foto: string | null;
      activo: boolean;
    }>(
      `select p.id, u.email, p.nombre, p.rol, p.foto,
              (u.banned_until is null or u.banned_until < now()) as activo
         from public.perfiles p
         join auth.users u on u.id = p.id
        order by (p.rol = 'admin') desc, p.nombre`,
    );
    return filas.map((f) => ({
      id: f.id,
      correo: f.email,
      nombre: f.nombre,
      rol: f.rol as Perfil["rol"],
      foto: f.foto ?? null,
      activo: Boolean(f.activo),
    }));
  }

  async actualizarPerfil(id: string, datos: { nombre: string; foto: string | null }): Promise<void> {
    await consultar("update perfiles set nombre = $2, foto = $3 where id = $1", [
      id,
      datos.nombre,
      datos.foto,
    ]);
  }

  /**
   * Da de alta a un profesional con su acceso.
   *
   * Escribe en los tres sitios que hacen falta, y en una sola transacción: o
   * queda todo o no queda nada. Una cuenta sin identidad acepta la contraseña
   * pero no deja entrar, y una cuenta sin perfil entra y no puede hacer nada.
   *
   * ES EL MISMO CAMINO QUE SE USÓ PARA RAFA (`scripts/crear-usuario.mjs`), no
   * uno nuevo: la contraseña la cifra la base con `crypt` + `bcrypt`, que es
   * exactamente lo que hace Supabase al registrar a alguien. Así no hace falta
   * la clave de administrador de Supabase ni abrir el registro público.
   *
   * **La contraseña en claro no se guarda, ni se registra, ni se devuelve.**
   * Entra por aquí y solo sale de la base ya cifrada.
   */
  async crearProfesional(datos: { nombre: string; correo: string; clave: string }): Promise<{ id: string }> {
    return this.transaccion(async () => {
      const yaEsta = await consultar<{ id: string }>(
        "select id from auth.users where lower(email) = $1",
        [datos.correo],
      );
      if (yaEsta.length > 0) {
        throw new ErrorDeNegocio(`Ya hay alguien dado de alta con el correo ${datos.correo}`);
      }

      const creado = await consultar<{ id: string }>(
        `insert into auth.users
           (instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, created_at, updated_at,
            raw_app_meta_data, raw_user_meta_data)
         values
           ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            $1, crypt($2, gen_salt('bf')),
            -- Confirmado de entrada: lo da de alta el administrador a mano, no
            -- es un registro público que haya que verificar por correo.
            now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
         returning id`,
        [datos.correo, datos.clave],
      );
      const id = creado[0].id;

      // Sin la identidad, la contraseña es correcta y aun así no deja entrar.
      await consultar(
        `insert into auth.identities
           (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $2::text,
                 jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
                 'email', now(), now(), now())`,
        [id, id, datos.correo],
      );

      // El rol va en el perfil, no en la cuenta: `auth.users` dice quién eres
      // y `perfiles` dice qué puedes hacer. SIEMPRE entrenador — desde esta
      // pantalla no se crean administradores.
      await consultar(
        "insert into public.perfiles (id, nombre, rol) values ($1, $2, 'entrenador')",
        [id, datos.nombre],
      );

      return { id };
    });
  }

  /**
   * Da de baja o vuelve a dar de alta. **Nunca borra.**
   *
   * Se apoya en el bloqueo de cuenta de Supabase, que es lo que la
   * comprobación de acceso ya miraba desde el principio (`banned_until`). Dar
   * de baja no toca ni una sesión ni un cliente: el histórico sigue entero y
   * su economía sigue estando donde estaba.
   *
   * La fecha es lejana a propósito: «de baja» no es «castigado hasta el
   * viernes», es hasta que alguien lo vuelva a dar de alta.
   */
  async cambiarEstadoProfesional(id: string, activo: boolean): Promise<void> {
    await consultar(
      `update auth.users
          set banned_until = case when $2 then null else timestamptz '2999-12-31' end,
              updated_at = now()
        where id = $1`,
      [id, activo],
    );
  }

  async contarClientesActivosDe(profesionalId: string): Promise<number> {
    const filas = await consultar<{ n: number }>(
      "select count(*)::int as n from clientes where entrenador_id = $1 and estado = 'activo'",
      [profesionalId],
    );
    return Number(filas[0]?.n ?? 0);
  }

  async asignarProfesional(clienteId: string, profesionalId: string | null): Promise<void> {
    await consultar("update clientes set entrenador_id = $2 where id = $1", [clienteId, profesionalId]);
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
  /**
   * Con `soloDe`, la economía de UN profesional.
   *
   * A QUIÉN PERTENECE CADA COSA (2026-08-11):
   *
   *   sesión → `coalesce(s.profesional_id, cl.entrenador_id)`. Es decir: el
   *     responsable del cliente CUANDO se firmó y, si esa copia no existe
   *     —sesiones anteriores al 2026-08-11—, el responsable de hoy.
   *
   *     NO se usa `firmada_por`: dice quién pulsó el botón, no de quién es el
   *     cliente. Si Fernando firma excepcionalmente una sesión de un cliente
   *     de Rafa, esa producción es de Rafa.
   *
   *   cuota → igual, con su propia copia.
   *
   *   CrossFit y ajustes → del administrador, y no se reparten. Cuando se pide
   *     la economía de un entrenador, sus consultas ni se lanzan: no hay nada
   *     que traer.
   *
   * Siguen siendo como mucho cinco consultas, y no crecen con el número de
   * profesionales ni de clientes.
   */
  async datosDeTodosLosMeses(
    soloDe?: string | null,
    opciones: { esAdministrador?: boolean; adminId?: string | null } = {},
  ): Promise<Array<{ anio: number; mes: number } & DatosMes>> {
    const clave = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, "0")}`;

    // Lo del administrador —CrossFit y ajustes— solo se pide si se está
    // mirando la suya, o la global. A un entrenador no le corresponde nada de
    // eso, así que esas tres consultas ni se lanzan.
    const esAdmin = opciones.esAdministrador === true;
    const conComunes = !soloDe || esAdmin;
    const vacio = Promise.resolve([] as Record<string, unknown>[]);

    // De quién es una sesión, en SQL. Las mismas tres reglas que
    // `domain/atribucion.ts`, en el mismo orden:
    //   1. lo que guardó al firmarse;
    //   2. si no lo guardó y es anterior a que existieran los profesionales,
    //      del administrador;
    //   3. si no, del responsable actual del cliente.
    const duenio = (columna: string) =>
      `coalesce(${columna}, case when %FECHA% < $3::date then $2 else cl.entrenador_id end)`;

    // Las mensualidades y las cuentas de cliente son EXCLUSIVAS del
    // administrador (regla de Fernando, 2026-08-11): un entrenador solo lleva
    // bonos. Se filtra también aquí, no solo al dar de alta, para que una fila
    // antigua o mal metida no se le cuele en su economía.
    const soloBonos = soloDe && !esAdmin ? "and coalesce(c.modalidad::text,'bono') = 'bono'" : "";

    const argsAtribucion = [soloDe, opciones.adminId ?? null, DESDE_QUE_HAY_PROFESIONALES];

    const [sesiones, cargos, clases, ajustes, kids] = await Promise.all([
      consultar(
        `select to_char(s.fecha,'YYYY-MM-DD') as fecha, s.tarifa,
                coalesce(c.modalidad::text, 'bono') as modalidad
           from sesiones s
           join clientes cl on cl.id = s.cliente_id
           left join ciclos c on c.cliente_id = s.cliente_id and c.ciclo = s.ciclo
          ${soloDe ? `where ${duenio("s.profesional_id").replace("%FECHA%", "s.fecha")} = $1 ${soloBonos}` : ""}`,
        soloDe ? argsAtribucion : [],
      ),
      consultar(
        // La cuota de una mensualidad no puede ser de un entrenador: si se
        // pide la suya, esta consulta no devuelve nada por definición.
        soloDe && !esAdmin
          ? "select anio, mes, importe from cargos_mensuales where false"
          : `select g.anio, g.mes, g.importe
               from cargos_mensuales g
               join clientes cl on cl.id = g.cliente_id
              ${soloDe ? `where ${duenio("g.profesional_id").replace("%FECHA%", "make_date(g.anio, g.mes, 1)")} = $1` : ""}`,
        soloDe && !esAdmin ? [] : soloDe ? argsAtribucion : [],
      ),
      conComunes
        ? consultar(
            `select extract(year from fecha)::int as anio, extract(month from fecha)::int as mes,
                    tipo, count(*)::int as n
               from clases_grupo group by 1, 2, 3`,
          )
        : vacio,
      conComunes
        ? consultar("select anio, mes, origen, importe, horas, motivo from ajustes_mensuales order by origen")
        : vacio,
      conComunes ? consultar("select anio, mes, importe from facturacion_kids_mensual") : vacio,
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

  async registrarAviso(aviso: {
    fecha: string;
    tipo: string;
    detalle: string;
    clienteId?: string | null;
  }): Promise<void> {
    // El índice único sobre (tipo, detalle) de los no resueltos impide llenar
    // la bandeja de copias del mismo aviso mientras su causa siga ahí.
    await consultar(
      `insert into avisos (fecha, tipo, detalle, cliente_id) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [aviso.fecha, aviso.tipo, aviso.detalle, aviso.clienteId ?? null],
    );
  }

  /**
   * Un entrenador ve los avisos de SUS clientes y ninguno más.
   *
   * Los avisos del sistema (`cliente_id` nulo) quedan fuera: hablan del
   * conjunto del negocio, no de su trabajo.
   */
  async listarAvisos(soloDe?: string | null): Promise<Aviso[]> {
    const filas = await consultar(
      `select id, fecha, tipo, detalle, leido from avisos
        where not resuelto ${soloDe ? "and " + SUYOS : ""}
        order by creado desc`,
      soloDe ? [soloDe] : [],
    );
    return filas.map((f) => ({
      id: f.id as string,
      fecha: fecha(f.fecha)!,
      tipo: f.tipo as string,
      detalle: f.detalle as string,
      leido: Boolean(f.leido),
    }));
  }

  async contarNoLeidos(soloDe?: string | null): Promise<number> {
    const filas = await consultar<{ n: string }>(
      `select count(*)::int as n from avisos
        where not resuelto and not leido ${soloDe ? "and " + SUYOS : ""}`,
      soloDe ? [soloDe] : [],
    );
    return Number(filas[0]?.n ?? 0);
  }

  async marcarTodosLeidos(soloDe?: string | null): Promise<void> {
    await consultar(
      `update avisos set leido = true
        where not resuelto and not leido ${soloDe ? "and " + SUYOS : ""}`,
      soloDe ? [soloDe] : [],
    );
  }

  /**
   * Resolver un aviso ajeno no hace nada y lo dice: el `where` incluye la
   * condición del profesional, así que la base de datos no llega a tocar la
   * fila. No se comprueba antes y se escribe después — se comprueba AL
   * escribir, que es lo único que no se puede esquivar.
   */
  async resolverAviso(id: string, soloDe?: string | null): Promise<boolean> {
    const filas = await consultar(
      `update avisos set resuelto = true
        where id = $1 ${soloDe ? "and " + SUYOS.replace("$1", "$2") : ""}
        returning id`,
      soloDe ? [id, soloDe] : [id],
    );
    return filas.length > 0;
  }

  async resolverPorTipo(tipo: string, soloDe?: string | null): Promise<number> {
    const filas = await consultar(
      `update avisos set resuelto = true
        where tipo = $1 and not resuelto ${soloDe ? "and " + SUYOS.replace("$1", "$2") : ""}
        returning id`,
      soloDe ? [tipo, soloDe] : [tipo],
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
    // Ya estamos dentro de una: se comprueba en ESTA petición, no en una
    // variable que ven todas.
    if (conexionDeLaTransaccion()) return operacion();

    const conexion = await pool().connect();
    // Todo lo que pase dentro de `conConexion` —y solo eso— usa esta conexión.
    // Otra petición que llegue mientras tanto no la ve.
    return conConexion(conexion, async () => {
      try {
        await conexion.query("begin");
        const resultado = await operacion();
        await conexion.query("commit");
        return resultado;
      } catch (error) {
        await conexion.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        conexion.release();
      }
    });
  }
}
