/**
 * Las mismas reglas, contra Supabase de verdad.
 *
 * Es la prueba que demuestra que `RepositorioPostgres` se comporta igual que
 * `RepositorioStaging`: si las dos pasan lo mismo, cambiar de uno a otro no
 * altera el negocio.
 *
 * Se salta sola si no hay `DATABASE_URL`, para que el proyecto siga
 * pudiéndose probar sin credenciales.
 *
 * **Nunca toca datos reales**: trabaja sobre los cinco clientes ficticios y se
 * niega a correr si encuentra a alguien que no reconoce.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// El .env.local no se carga solo fuera de Next.
const env = Object.fromEntries(
  (() => {
    try {
      return readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]);
    } catch {
      return [];
    }
  })(),
);
if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

const hayBase = Boolean(process.env.DATABASE_URL);
const cuando = hayBase ? describe : describe.skip;

const FICTICIOS = [
  "Cliente A",
  "Cliente A renombrado", // lo deja la prueba de renombrado
  "Cliente B",
  "Pareja C",
  "Cliente D",
  "Cliente E",
];

cuando("las reglas contra Supabase", () => {
  // Importación diferida: sin DATABASE_URL, el módulo no debe ni cargarse.
  let repo: typeof import("@/repositories").repositorio;
  let servicios: typeof import("@/services/clientes");
  let sesiones: typeof import("@/services/sesiones");
  let Cliente: { Pool: typeof import("pg").Pool };
  let pool: import("pg").Pool;
  let ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ repositorio: repo } = await import("@/repositories"));
    servicios = await import("@/services/clientes");
    sesiones = await import("@/services/sesiones");
    Cliente = await import("pg");
    pool = new Cliente.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });

    // El pooler del plan gratuito corta conexiones inactivas, y la primera
    // consulta tras un rato puede llegar cerrada (ECONNRESET). Se reintenta un
    // par de veces: es la red, no el código.
    let otros;
    for (let intento = 1; ; intento += 1) {
      try {
        otros = await pool.query("select nombre from clientes where nombre <> all($1::text[])", [FICTICIOS]);
        break;
      } catch (error) {
        if (intento >= 3) throw error;
        await new Promise((sigue) => setTimeout(sigue, 1500));
      }
    }
    if (otros.rowCount) {
      throw new Error(
        `Esta base tiene clientes que no son de prueba (${otros.rows
          .map((f) => f.nombre)
          .join(", ")}). No ejecuto nada.`,
      );
    }
  });

  afterAll(async () => {
    // Deja la base como estaba para que la aplicación desplegada siga
    // teniendo sus datos de demostración: si no, tras cada tanda de pruebas
    // el enlace público de los clientes dejaba de funcionar.
    const { execFile } = await import("node:child_process");
    await new Promise<void>((listo) => {
      execFile(process.execPath, ["scripts/sembrar.mjs"], { cwd: process.cwd() }, () => listo());
    });
    await pool?.end();
  });

  /** Vuelve al estado de partida antes de cada prueba.
   *
   *  Sin `begin`/`commit`: con un pool, esas dos sentencias pueden acabar en
   *  conexiones distintas y entonces no hay transacción ninguna. Aquí cada
   *  sentencia se confirma sola, que es justo lo que hace falta. */
  beforeEach(async () => {
    await pool.query("delete from clientes");
    await pool.query("delete from semanas");
    await pool.query("delete from idempotencia");

    ids = {};
    for (const [nombre, estado, pendiente, hechas, token] of [
      ["Cliente A", "activo", false, 6, "tok-a"],
      ["Cliente B", "activo", true, 0, "tok-b"],
      ["Cliente D", "activo", false, 0, "tok-d"],
      ["Cliente E", "pausado", false, 2, "tok-e"],
    ] as const) {
      const r = await pool.query(
        `insert into clientes (nombre, estado, token, pendiente_pago, sesiones_completadas, ciclo_actual)
         values ($1,$2,$3,$4,$5,1) returning id`,
        [nombre, estado, token, pendiente, hechas],
      );
      ids[nombre] = r.rows[0].id;
    }

    for (const [nombre, modalidad, servicio, tarifa, totales, precio, cuota, anio, mes, pagado] of [
      ["Cliente A", "bono", "Bono 8 sesiones", 45, 8, 360, null, null, null, true],
      ["Cliente B", "mensualidad", "Mensualidad", null, 0, null, 720, 2026, 8, false],
      ["Cliente D", "cuenta", "Cuenta de cliente", 35, 0, null, null, 2026, 8, false],
      ["Cliente E", "bono", "Bono 4 sesiones", 50, 4, 200, null, null, null, true],
    ] as const) {
      await pool.query(
        `insert into ciclos (cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
                             precio_total, cuota_mensual, anio, mes, pagado)
         values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ids[nombre], modalidad, servicio, tarifa, totales, precio, cuota, anio, mes, pagado],
      );
    }

    // Cliente A ya lleva 6 sesiones hechas de su bono de 8.
    for (let i = 1; i <= 6; i += 1) {
      await pool.query(
        `insert into sesiones (cliente_id, ciclo, fecha, hora, numero_sesion, sesiones_totales, tarifa, servicio)
         values ($1,1,$2,'10:00',$3,8,45,'Bono 8 sesiones')`,
        [ids["Cliente A"], `2026-07-${String(10 + i).padStart(2, "0")}`, i],
      );
    }
    await pool.query(
      `insert into cargos_mensuales (cliente_id, anio, mes, concepto, ciclo, importe, pagado)
       values ($1, 2026, 8, 'mensualidad', 1, 720, false)`,
      [ids["Cliente B"]],
    );
  });

  // -------------------------------------------------------------------------

  it("firmar descuenta exactamente una sesión", async () => {
    const r = await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
    expect(r.numeroSesion).toBe(7);
    expect(r.renovado).toBe(false);

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.ficha.sesionesHechas).toBe(7);
    expect(perfil!.ficha.sesionesRestantes).toBe(1);
  });

  it("la última sesión renueva y el ciclo nuevo nace pendiente de pago", async () => {
    await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
    const r = await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-04" });

    expect(r.renovado).toBe(true);
    expect(r.numeroSesion).toBe(8);

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.cliente.cicloActual).toBe(2);
    expect(perfil!.ficha.pendientePago).toBe(true);
    expect(perfil!.ficha.sesionesHechas).toBe(0);

    const nuevo = perfil!.servicios.find((s) => s.ciclo === 2)!;
    const viejo = perfil!.servicios.find((s) => s.ciclo === 1)!;
    expect(nuevo.tarifa).toBe(45);
    expect(nuevo.sesionesTotales).toBe(8);
    expect(nuevo.pagado).toBe(false);
    expect(viejo.fechaFin).toBe("2026-08-04");
  });

  it("suma su importe y su hora a la semana", async () => {
    await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
    const semana = (await repo().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(45);
    expect(semana.horas).toBe(1);
    expect(semana.horasSinImporte).toBe(0);
  });

  it("una sesión de mensualidad suma hora pero no dinero", async () => {
    await sesiones.firmarSesion(ids["Cliente B"], { fecha: "2026-08-03" });
    const semana = (await repo().listarSemanas()).find((s) => s.inicio === "2026-08-03")!;
    expect(semana.facturacion).toBe(0);
    expect(semana.horasSinImporte).toBe(1);

    const lista = await repo().listarSesiones(ids["Cliente B"]);
    expect(lista[0]!.tarifa).toBeNull();
  });

  it("la misma petición repetida no se guarda dos veces", async () => {
    const a = await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03", claveIdempotencia: "k1" });
    const b = await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03", claveIdempotencia: "k1" });
    expect(a.duplicado).toBe(false);
    expect(b.duplicado).toBe(true);

    const lista = await repo().listarSesiones(ids["Cliente A"]);
    expect(lista.filter((s) => s.fecha === "2026-08-03")).toHaveLength(1);
  });

  it("una cuenta de cliente no tiene tope", async () => {
    for (let i = 0; i < 12; i += 1) {
      await sesiones.firmarSesion(ids["Cliente D"], { fecha: "2026-08-03" });
    }
    const perfil = await servicios.obtenerPerfil(ids["Cliente D"]);
    expect(perfil!.cliente.cicloActual).toBe(1);
    expect(perfil!.ficha.facturacion).toBe(420); // 12 × 35
  });

  it("un cliente pausado no puede firmar y no se toca nada", async () => {
    const semanasAntes = await repo().listarSemanas();
    await expect(sesiones.firmarSesion(ids["Cliente E"], { fecha: "2026-08-03" })).rejects.toThrow(
      /pausado/i,
    );
    expect(await repo().listarSemanas()).toEqual(semanasAntes);
  });

  it("borrar una sesión devuelve la unidad y su importe", async () => {
    await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
    const lista = await repo().listarSesiones(ids["Cliente A"]);
    await sesiones.eliminarSesion(ids["Cliente A"], lista[0]!.id);

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.ficha.sesionesHechas).toBe(6);
    const semana = (await repo().listarSemanas()).find((s) => s.inicio === "2026-08-03");
    expect(semana?.facturacion ?? 0).toBe(0);
  });

  it("borrar la sesión que renovó deshace la renovación", async () => {
    await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
    await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-04" });
    const lista = await repo().listarSesiones(ids["Cliente A"]);
    await sesiones.eliminarSesion(ids["Cliente A"], lista[0]!.id);

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.cliente.cicloActual).toBe(1);
    expect(perfil!.ficha.pendientePago).toBe(false);
  });

  it("en una mensualidad manda el cargo del mes", async () => {
    const antes = await servicios.obtenerPerfil(ids["Cliente B"]);
    expect(antes!.ficha.pendientePago).toBe(true);

    await servicios.marcarCobro(ids["Cliente B"], 1, true);

    const despues = await servicios.obtenerPerfil(ids["Cliente B"]);
    const cargo = await repo().cargoDelMes(ids["Cliente B"], 2026, 8);
    expect(despues!.ficha.pendientePago).toBe(false);
    expect(cargo!.pagado).toBe(true);
  });

  it("cambiar de modalidad cierra el servicio y abre otro", async () => {
    const r = await servicios.configurarServicio(ids["Cliente A"], {
      modalidad: "mensualidad",
      servicio: "Mensualidad",
      cuotaMensual: 600,
    });
    expect(r.cerroCiclo).toBe(true);

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.servicios.find((s) => s.ciclo === 1)!.sesiones).toHaveLength(6);
    expect(perfil!.servicios.find((s) => s.ciclo === 2)!.cuotaMensual).toBe(600);
  });

  it("un fallo a mitad no deja nada escrito", async () => {
    const antes = await servicios.obtenerPerfil(ids["Cliente A"]);
    const semanasAntes = await repo().listarSemanas();

    await expect(
      repo().transaccion(async () => {
        await sesiones.firmarSesion(ids["Cliente A"], { fecha: "2026-08-03" });
        throw new Error("fallo provocado");
      }),
    ).rejects.toThrow("fallo provocado");

    const despues = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(despues!.ficha.sesionesHechas).toBe(antes!.ficha.sesionesHechas);
    expect(await repo().listarSemanas()).toEqual(semanasAntes);
  });

  it("el nombre se puede cambiar sin romper el historial ni el enlace", async () => {
    const antes = await repo().listarSesiones(ids["Cliente A"]);
    await servicios.renombrarCliente(ids["Cliente A"], "Cliente A renombrado");

    const perfil = await servicios.obtenerPerfil(ids["Cliente A"]);
    expect(perfil!.cliente.nombre).toBe("Cliente A renombrado");
    expect(perfil!.cliente.token).toBe("tok-a");
    expect(await repo().listarSesiones(ids["Cliente A"])).toEqual(antes);
  });
});
