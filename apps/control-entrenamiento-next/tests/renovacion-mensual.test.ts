/**
 * El cambio de mes de las mensualidades y las cuentas de cliente.
 *
 * NACE DE UN FALLO REAL (2026-09-02). El sistema decía desde el principio que
 * una mensualidad se cierra al cambiar de mes, y no lo hacía nadie: el 1 de
 * septiembre los clientes se quedaron en agosto y Fernando se lo encontró al
 * entrar. La regla estaba escrita; el proceso que la ejecuta no existía.
 *
 * Lo que se prueba aquí es sobre todo lo que NO debe pasar: que no se dupliquen
 * cuotas, que no se inventen meses pasados, que no se renueve a quien no
 * entrena, y que las sesiones de agosto sigan siendo de agosto.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { decidir, llevaCuota, mesesEntre, vaPorMeses } from "@/domain/renovacion";
import { BONO, CUENTA, MENSUALIDAD } from "@/domain/modalidades";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { renovarMeses } from "@/services/renovacion";
import { firmarSesion } from "@/services/sesiones";

const MENSUAL = "cli-b"; // mensualidad de 720 €
const CUENTA_CLIENTE = "cli-f"; // cuenta de cliente
const HOY = hoyNegocio();
const ANIO = Number(HOY.slice(0, 4));
const MES = Number(HOY.slice(5, 7));

/** Deja a un cliente «en el mes pasado», que es de donde hay que sacarlo. */
async function dejarEnElMesAnterior(clienteId: string, mesesAtras = 1) {
  const repo = repositorio();
  const cliente = (await repo.obtenerCliente(clienteId))!;
  const ciclo = (await repo.listarCiclos(clienteId)).find((c) => c.ciclo === cliente.cicloActual)!;

  const total = (ANIO * 12 + (MES - 1)) - mesesAtras;
  const anterior = { anio: Math.floor(total / 12), mes: (total % 12) + 1 };

  await repo.guardarCiclo({ ...ciclo, anio: anterior.anio, mes: anterior.mes });
  return anterior;
}

// ---------------------------------------------------------------------------
// La regla, sin base de datos
// ---------------------------------------------------------------------------

describe("a quién le toca cambiar de mes", () => {
  const activo = (modalidad: string, anio: number, mes: number) =>
    ({ estado: "activo", modalidad, anio, mes }) as never;

  it("una mensualidad de agosto pasa a septiembre", () => {
    expect(decidir(activo(MENSUALIDAD, 2026, 8), { anio: 2026, mes: 9 })).toEqual({
      que: "renovar",
      anio: 2026,
      mes: 9,
    });
  });

  it("una cuenta de cliente también", () => {
    expect(decidir(activo(CUENTA, 2026, 8), { anio: 2026, mes: 9 }).que).toBe("renovar");
  });

  it("un bono NO: se renueva al agotarse, no por el calendario", () => {
    const d = decidir(activo(BONO, 2026, 8), { anio: 2026, mes: 9 });
    expect(d.que).toBe("nada");
  });

  it("quien ya está en el mes en curso se queda como está", () => {
    // Es lo que hace que ejecutarlo dos veces no cambie nada.
    expect(decidir(activo(MENSUALIDAD, 2026, 9), { anio: 2026, mes: 9 }).que).toBe("nada");
  });

  it("de diciembre a enero cambia también el año", () => {
    expect(decidir(activo(MENSUALIDAD, 2026, 12), { anio: 2027, mes: 1 })).toEqual({
      que: "renovar",
      anio: 2027,
      mes: 1,
    });
    expect(mesesEntre({ anio: 2026, mes: 12 }, { anio: 2027, mes: 1 })).toBe(1);
  });

  it("un cliente pausado no se renueva", () => {
    const d = decidir({ estado: "pausado", modalidad: MENSUALIDAD, anio: 2026, mes: 8 } as never, {
      anio: 2026,
      mes: 9,
    });
    expect(d.que).toBe("nada");
    expect(d.que === "nada" && d.porque).toContain("pausado");
  });

  it("un cliente cancelado tampoco", () => {
    const d = decidir({ estado: "cancelado", modalidad: MENSUALIDAD, anio: 2026, mes: 8 } as never, {
      anio: 2026,
      mes: 9,
    });
    expect(d.que).toBe("nada");
  });

  it("más de un mes de retraso NO se arregla solo: se marca para mirarlo", () => {
    // Crear las cuotas de junio y julio en silencio sería inventar historia
    // económica que nadie ha visto.
    const d = decidir(activo(MENSUALIDAD, 2026, 6), { anio: 2026, mes: 9 });
    expect(d.que).toBe("revisar");
    expect(d.que === "revisar" && d.mesesDeDesfase).toBe(3);
  });

  it("un servicio mensual sin mes es un dato raro: también se mira", () => {
    const d = decidir({ estado: "activo", modalidad: MENSUALIDAD, anio: null, mes: null } as never, {
      anio: 2026,
      mes: 9,
    });
    expect(d.que).toBe("revisar");
  });

  it("solo la mensualidad lleva cuota fija", () => {
    expect(llevaCuota(MENSUALIDAD)).toBe(true);
    expect(llevaCuota(CUENTA)).toBe(false);
    expect(vaPorMeses(MENSUALIDAD)).toBe(true);
    expect(vaPorMeses(CUENTA)).toBe(true);
    expect(vaPorMeses(BONO)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// El cambio de mes, con datos
// ---------------------------------------------------------------------------

describe("abrir el mes nuevo", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la mensualidad pasa de mes y se le crea UNA cuota", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const antes = (await repo.obtenerCliente(MENSUAL))!;

    const r = await renovarMeses();

    const despues = (await repo.obtenerCliente(MENSUAL))!;
    const ciclos = await repo.listarCiclos(MENSUAL);
    const nuevo = ciclos.find((c) => c.anio === ANIO && c.mes === MES)!;

    expect(r.renovados.some((x) => x.clienteId === MENSUAL)).toBe(true);
    expect(despues.cicloActual).toBe(antes.cicloActual + 1);
    expect(nuevo.modalidad).toBe(MENSUALIDAD);
    expect(nuevo.pagado, "un servicio nuevo nace pendiente de pago").toBe(false);

    const cargo = await repo.cargoDelMes(MENSUAL, ANIO, MES);
    expect(cargo, "la mensualidad lleva su cuota del mes").not.toBeNull();
    expect(cargo!.importe).toBe(720);
    expect(cargo!.pagado).toBe(false);
  });

  it("conserva servicio, cuota, sesiones de referencia y profesional", async () => {
    const repo = repositorio();
    const anterior = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === 1)!;
    await dejarEnElMesAnterior(MENSUAL);

    await renovarMeses();

    const nuevo = (await repo.listarCiclos(MENSUAL)).find((c) => c.anio === ANIO && c.mes === MES)!;
    expect(nuevo.servicio).toBe(anterior.servicio);
    expect(nuevo.cuotaMensual).toBe(anterior.cuotaMensual);
    expect(nuevo.sesionesReferencia).toBe(anterior.sesionesReferencia);
    expect(nuevo.modalidad).toBe(anterior.modalidad);

    // El responsable del cliente no se toca.
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    expect(cliente.profesionalId).toBe("per-admin");
  });

  it("el contador del periodo vuelve a cero", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, sesionesCompletadas: 9 });

    await renovarMeses();

    expect((await repo.obtenerCliente(MENSUAL))!.sesionesCompletadas).toBe(0);
  });

  it("una cuenta de cliente cambia de mes pero SIN cuota", async () => {
    // Su dinero sale de las sesiones que se firmen, no de una cuota por
    // adelantado.
    const repo = repositorio();
    await dejarEnElMesAnterior(CUENTA_CLIENTE);

    await renovarMeses();

    const nuevo = (await repo.listarCiclos(CUENTA_CLIENTE)).find((c) => c.anio === ANIO && c.mes === MES);
    expect(nuevo, "tiene que tener su ciclo del mes").toBeDefined();
    expect(nuevo!.modalidad).toBe(CUENTA);
    expect(await repo.cargoDelMes(CUENTA_CLIENTE, ANIO, MES), "una cuenta no lleva cuota fija").toBeNull();
  });

  it("el ciclo anterior se cierra, y sus sesiones no se mueven", async () => {
    const repo = repositorio();
    const anterior = await dejarEnElMesAnterior(MENSUAL);
    const sesionesAntes = await repo.listarSesiones(MENSUAL);

    await renovarMeses();

    const cerrado = (await repo.listarCiclos(MENSUAL)).find(
      (c) => c.anio === anterior.anio && c.mes === anterior.mes,
    )!;
    expect(cerrado.fechaFin, "el mes que se va queda cerrado").not.toBeNull();
    expect(await repo.listarSesiones(MENSUAL), "las sesiones no se tocan").toEqual(sesionesAntes);
  });
});

// ---------------------------------------------------------------------------
// Se puede ejecutar mil veces
// ---------------------------------------------------------------------------

describe("ejecutarlo dos veces no cambia nada", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("la segunda vez no renueva a nadie", async () => {
    await dejarEnElMesAnterior(MENSUAL);
    await dejarEnElMesAnterior(CUENTA_CLIENTE);

    const primera = await renovarMeses();
    const segunda = await renovarMeses();

    expect(primera.renovados.length).toBe(2);
    expect(segunda.renovados.length, "la segunda no tiene nada que hacer").toBe(0);
    expect(segunda.errores).toEqual([]);
  });

  it("y no aparece una segunda cuota del mismo mes", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);

    await renovarMeses();
    await renovarMeses();
    await renovarMeses();

    const cargos = (await repo.listarCargos(MENSUAL)).filter((c) => c.anio === ANIO && c.mes === MES);
    expect(cargos, "una sola cuota, se ejecute lo que se ejecute").toHaveLength(1);
  });

  it("ni un ciclo de más", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);

    await renovarMeses();
    await renovarMeses();

    const delMes = (await repo.listarCiclos(MENSUAL)).filter((c) => c.anio === ANIO && c.mes === MES);
    expect(delMes).toHaveLength(1);
  });

  it("dos ejecuciones a la vez tampoco duplican", async () => {
    // El caso de verdad: Vercel reintenta, o dos instancias coinciden.
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);

    await Promise.all([renovarMeses(), renovarMeses()]);

    const delMes = (await repo.listarCiclos(MENSUAL)).filter((c) => c.anio === ANIO && c.mes === MES);
    const cargos = (await repo.listarCargos(MENSUAL)).filter((c) => c.anio === ANIO && c.mes === MES);
    expect(delMes, "un solo ciclo del mes").toHaveLength(1);
    expect(cargos, "una sola cuota del mes").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Lo que NO hace
// ---------------------------------------------------------------------------

describe("lo que no toca", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("no renueva a un cliente pausado", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, estado: "pausado" });

    const r = await renovarMeses();

    expect(r.renovados.some((x) => x.clienteId === MENSUAL)).toBe(false);
    // Sigue donde estaba: ni ciclo nuevo ni cambio de contador.
    expect((await repo.obtenerCliente(MENSUAL))!.cicloActual).toBe(cliente.cicloActual);
    expect((await repo.listarCiclos(MENSUAL)).filter((c) => c.anio === ANIO && c.mes === MES)).toHaveLength(0);
  });

  it("no renueva a un cliente cancelado", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    await repo.actualizarCliente({ ...cliente, estado: "cancelado" });

    const r = await renovarMeses();
    expect(r.renovados.some((x) => x.clienteId === MENSUAL)).toBe(false);
  });

  it("no toca los bonos", async () => {
    const repo = repositorio();
    const antes = await repo.listarCiclos("cli-a");

    await renovarMeses();

    expect(await repo.listarCiclos("cli-a")).toEqual(antes);
  });

  it("con varios meses de retraso NO inventa las cuotas de en medio", async () => {
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente(MENSUAL))!;
    const ciclo = (await repo.listarCiclos(MENSUAL)).find((c) => c.ciclo === cliente.cicloActual)!;
    // Tres meses atrás.
    const atras = MES > 3 ? { anio: ANIO, mes: MES - 3 } : { anio: ANIO - 1, mes: MES + 9 };
    await repo.guardarCiclo({ ...ciclo, anio: atras.anio, mes: atras.mes });
    const antesCuantos = (await repo.listarCiclos(MENSUAL)).length;

    const r = await renovarMeses();

    expect(r.renovados.some((x) => x.clienteId === MENSUAL), "no se renueva solo").toBe(false);
    expect(r.aRevisar.some((x) => x.clienteId === MENSUAL), "se marca para mirarlo").toBe(true);
    // Ni el mes en curso ni los de en medio: no se le abre ningún ciclo.
    expect((await repo.listarCiclos(MENSUAL)), "no se le crea ningún servicio").toHaveLength(
      antesCuantos,
    );
  });

  it("solo se puede mirar, sin escribir nada", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const antesCiclos = await repo.listarCiclos(MENSUAL);
    const antesCargos = await repo.listarCargos(MENSUAL);

    const r = await renovarMeses({ soloMirar: true });

    expect(r.simulado).toBe(true);
    expect(r.renovados.length, "dice lo que haría").toBeGreaterThan(0);
    expect(await repo.listarCiclos(MENSUAL), "pero no escribe").toEqual(antesCiclos);
    expect(await repo.listarCargos(MENSUAL)).toEqual(antesCargos);
  });

  it("el resumen no lleva nombres de clientes", async () => {
    // Esto acaba en el registro del servidor.
    await dejarEnElMesAnterior(MENSUAL);
    const r = await renovarMeses({ soloMirar: true });

    const texto = JSON.stringify(r);
    for (const nombre of ["Cliente A", "Cliente B", "Pareja C", "Cliente D"]) {
      expect(texto, `no puede aparecer «${nombre}»`).not.toContain(nombre);
    }
  });
});

// ---------------------------------------------------------------------------
// Cuando algo falla
// ---------------------------------------------------------------------------

describe("si algo va mal", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("el fallo de un cliente no deja a los demás sin su mes", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    await dejarEnElMesAnterior(CUENTA_CLIENTE);

    // Se rompe a propósito el primero que se toque.
    let rotas = 0;
    const guardar = repo.guardarCiclo.bind(repo);
    vi.spyOn(repo, "guardarCiclo").mockImplementation(async (ciclo) => {
      if (ciclo.clienteId === MENSUAL && rotas++ === 0) throw new Error("fallo de prueba");
      return guardar(ciclo);
    });

    const r = await renovarMeses();
    vi.restoreAllMocks();

    expect(r.errores.some((e) => e.clienteId === MENSUAL), "queda anotado el que falló").toBe(true);
    expect(
      r.renovados.some((x) => x.clienteId === CUENTA_CLIENTE),
      "y el otro sigue su camino",
    ).toBe(true);
  });

  it("un cliente que falla se queda EXACTAMENTE como estaba", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    const antesCliente = (await repo.obtenerCliente(MENSUAL))!;
    const antesCiclos = await repo.listarCiclos(MENSUAL);

    // Falla justo después de haber tocado el ciclo: la transacción tiene que
    // deshacerlo todo, no dejarlo a medias.
    vi.spyOn(repo, "actualizarCliente").mockRejectedValueOnce(new Error("fallo de prueba"));

    await renovarMeses();
    vi.restoreAllMocks();

    expect(await repo.obtenerCliente(MENSUAL)).toEqual(antesCliente);
    expect(await repo.listarCiclos(MENSUAL)).toEqual(antesCiclos);
  });
});

// ---------------------------------------------------------------------------
// Las sesiones se quedan donde estaban
// ---------------------------------------------------------------------------

describe("las sesiones no cambian de mes", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("una sesión del mes pasado sigue siendo del mes pasado", async () => {
    const repo = repositorio();
    const anterior = await dejarEnElMesAnterior(MENSUAL);
    const diaDeAntes = `${anterior.anio}-${String(anterior.mes).padStart(2, "0")}-15`;
    await firmarSesion(MENSUAL, { fecha: diaDeAntes });
    const cicloDeEntonces = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === diaDeAntes)!.ciclo;

    await renovarMeses();

    const despues = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === diaDeAntes)!;
    expect(despues.ciclo, "sigue en el ciclo del mes en que se hizo").toBe(cicloDeEntonces);
  });

  it("y una sesión de este mes entra en el ciclo de este mes", async () => {
    const repo = repositorio();
    await dejarEnElMesAnterior(MENSUAL);
    await renovarMeses();

    await firmarSesion(MENSUAL, { fecha: HOY });

    const nueva = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === HOY)!;
    const cicloDelMes = (await repo.listarCiclos(MENSUAL)).find((c) => c.anio === ANIO && c.mes === MES)!;
    expect(nueva.ciclo).toBe(cicloDelMes.ciclo);
  });

  it("firmar una fecha del mes pasado después de renovar la manda a su mes", async () => {
    // Es la regla del mes natural, que ya existía. Renovar no la rompe.
    const repo = repositorio();
    const anterior = await dejarEnElMesAnterior(MENSUAL);
    await renovarMeses();

    const diaDeAntes = `${anterior.anio}-${String(anterior.mes).padStart(2, "0")}-20`;
    await firmarSesion(MENSUAL, { fecha: diaDeAntes });

    const sesion = (await repo.listarSesiones(MENSUAL)).find((s) => s.fecha === diaDeAntes)!;
    const cicloViejo = (await repo.listarCiclos(MENSUAL)).find(
      (c) => c.anio === anterior.anio && c.mes === anterior.mes,
    )!;
    expect(sesion.ciclo).toBe(cicloViejo.ciclo);
  });
});

// ---------------------------------------------------------------------------
// La puerta por la que entra la tarea
// ---------------------------------------------------------------------------

describe("la tarea automática", () => {
  it("sin el secreto no se ejecuta", async () => {
    const { GET } = await import("@/app/api/renovar-mes/route");
    process.env.CRON_SECRET = "el-secreto";

    const sinNada = await GET(new Request("https://x.test/api/renovar-mes"));
    expect(sinNada.status).toBe(401);

    const conUnoMalo = await GET(
      new Request("https://x.test/api/renovar-mes", { headers: { authorization: "Bearer otro" } }),
    );
    expect(conUnoMalo.status).toBe(401);
  });

  it("y si no hay secreto configurado, tampoco", async () => {
    // Un despiste de configuración no puede dejar al aire algo que escribe en
    // la economía.
    const { GET } = await import("@/app/api/renovar-mes/route");
    delete process.env.CRON_SECRET;

    const r = await GET(
      new Request("https://x.test/api/renovar-mes", { headers: { authorization: "Bearer lo-que-sea" } }),
    );
    expect(r.status).toBe(401);
  });

  it("con el secreto correcto, funciona", async () => {
    await reiniciarStagingParaPruebas();
    const { GET } = await import("@/app/api/renovar-mes/route");
    process.env.CRON_SECRET = "el-secreto";

    const r = await GET(
      new Request("https://x.test/api/renovar-mes?simular=si", {
        headers: { authorization: "Bearer el-secreto" },
      }),
    );
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.simulado).toBe(true);
    expect(cuerpo.mes).toBe(`${ANIO}-${String(MES).padStart(2, "0")}`);
  });
});
