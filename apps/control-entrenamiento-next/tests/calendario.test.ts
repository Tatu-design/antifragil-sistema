/**
 * El calendario de sesiones firmadas.
 *
 * No es una agenda: no hay citas ni sesiones previstas ni una tabla nueva. Es
 * otra forma de mirar las sesiones que YA están firmadas, así que lo que hay
 * que probar es que cuenta bien, que sitúa cada día donde toca, y —sobre
 * todo— que un entrenador no puede ver el trabajo de otro.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { alcanceDelCalendario } from "@/domain/atribucion";
import {
  claveDelMes,
  construirMes,
  diasDelMes,
  mesAnterior,
  mesPedido,
  mesSiguiente,
  rangoDelMes,
  tituloDelDia,
  tituloDelMes,
} from "@/domain/calendario";
import { Calendario } from "@/components/Calendario";
import { hoyNegocio } from "@/lib/fechas";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerCalendario } from "@/services/calendario";
import { firmarSesion } from "@/services/sesiones";

const ADMIN = { id: "per-admin", rol: "admin" as const };
const RAFA = { id: "per-rafa", rol: "entrenador" as const };
const OTRO = { id: "per-otro", rol: "entrenador" as const };
const PERFILES = [ADMIN, RAFA, OTRO];

const sin = new Map<string, number>();

// ---------------------------------------------------------------------------
// La cuadrícula
// ---------------------------------------------------------------------------

describe("los días de un mes", () => {
  it("cuenta bien los días, incluidos los febreros bisiestos", () => {
    expect(diasDelMes(2026, 8)).toBe(31);
    expect(diasDelMes(2026, 4)).toBe(30);
    expect(diasDelMes(2026, 2)).toBe(28);
    expect(diasDelMes(2028, 2)).toBe(29); // bisiesto
    expect(diasDelMes(2100, 2)).toBe(28); // 2100 NO es bisiesto
  });

  it("la semana empieza en lunes, como en el resto del sistema", () => {
    // El 1 de agosto de 2026 es sábado: la primera fila lleva cinco días del
    // mes anterior antes de él.
    const mes = construirMes(2026, 8, "2026-08-24", sin);
    const primera = mes.semanas[0];

    expect(primera).toHaveLength(7);
    expect(primera.filter((d) => !d.delMes)).toHaveLength(5);
    expect(primera[5].fecha).toBe("2026-08-01");
    expect(primera[5].delMes).toBe(true);
  });

  it("todas las filas tienen siete días, sin huecos", () => {
    // Se comprueban dos años enteros: los meses raros son los que empiezan en
    // domingo o tienen 31 días arrancando en fin de semana.
    for (const anio of [2026, 2027]) {
      for (let mes = 1; mes <= 12; mes += 1) {
        const construido = construirMes(anio, mes, "2026-08-24", sin);
        for (const semana of construido.semanas) {
          expect(semana, `${anio}-${mes}`).toHaveLength(7);
        }
        const delMes = construido.semanas.flat().filter((d) => d.delMes);
        expect(delMes, `${anio}-${mes}`).toHaveLength(diasDelMes(anio, mes));
      }
    }
  });

  it("los días de relleno se marcan como de fuera", () => {
    const mes = construirMes(2026, 8, "2026-08-24", sin);
    const fuera = mes.semanas.flat().filter((d) => !d.delMes);
    // Los de julio van antes que los de septiembre.
    expect(fuera[0].fecha.startsWith("2026-07")).toBe(true);
    expect(fuera.every((d) => d.sesiones === 0)).toBe(true);
  });

  it("hoy viene marcado, y solo hoy", () => {
    const mes = construirMes(2026, 8, "2026-08-24", sin);
    const marcados = mes.semanas.flat().filter((d) => d.esHoy);
    expect(marcados).toHaveLength(1);
    expect(marcados[0].fecha).toBe("2026-08-24");
  });

  it("mirando otro mes no hay ningún día marcado como hoy", () => {
    const mes = construirMes(2026, 3, "2026-08-24", sin);
    expect(mes.semanas.flat().filter((d) => d.esHoy)).toHaveLength(0);
  });
});

describe("moverse por los meses", () => {
  it("hacia atrás y hacia delante, cambiando de año donde toca", () => {
    expect(mesAnterior(2026, 8)).toEqual({ anio: 2026, mes: 7 });
    expect(mesAnterior(2026, 1)).toEqual({ anio: 2025, mes: 12 });
    expect(mesSiguiente(2026, 8)).toEqual({ anio: 2026, mes: 9 });
    expect(mesSiguiente(2026, 12)).toEqual({ anio: 2027, mes: 1 });
  });

  it("se pide a la base solo ese mes, ni un día más", () => {
    // Descargar el histórico entero para pintar treinta casillas sería
    // exactamente lo que no hay que hacer.
    expect(rangoDelMes(2026, 8)).toEqual({ desde: "2026-08-01", hasta: "2026-08-31" });
    expect(rangoDelMes(2026, 2)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });

  it("un mes inventado en la dirección cae en el de hoy", () => {
    // Escribir a mano `?mes=2026-13` no puede pintar una cuadrícula absurda.
    for (const malo of ["2026-13", "2026-00", "hola", "", "1800-05", undefined]) {
      expect(mesPedido(malo, "2026-08-24"), String(malo)).toEqual({ anio: 2026, mes: 8 });
    }
  });

  it("y uno válido se respeta", () => {
    expect(mesPedido("2026-07", "2026-08-24")).toEqual({ anio: 2026, mes: 7 });
    expect(claveDelMes(2026, 7)).toBe("2026-07");
  });

  it("los títulos van en español", () => {
    expect(tituloDelMes(2026, 8)).toBe("Agosto 2026");
    expect(tituloDelDia("2026-08-27")).toBe("Jueves, 27 de agosto");
  });
});

// ---------------------------------------------------------------------------
// Las cuentas
// ---------------------------------------------------------------------------

describe("cuántas sesiones tiene cada día", () => {
  it("pone el número en su día y deja los demás a cero", () => {
    const mes = construirMes(2026, 8, "2026-08-24", new Map([["2026-08-27", 4], ["2026-08-03", 1]]));
    const dias = mes.semanas.flat();

    expect(dias.find((d) => d.fecha === "2026-08-27")!.sesiones).toBe(4);
    expect(dias.find((d) => d.fecha === "2026-08-03")!.sesiones).toBe(1);
    expect(dias.find((d) => d.fecha === "2026-08-04")!.sesiones).toBe(0);
    expect(mes.total).toBe(5);
  });

  it("un mes sin actividad se pinta igual, solo que sin números", () => {
    const mes = construirMes(2026, 3, "2026-08-24", sin);
    expect(mes.total).toBe(0);
    expect(mes.semanas.flat().every((d) => d.sesiones === 0)).toBe(true);
    expect(mes.semanas.length).toBeGreaterThan(0);
  });

  it("lo de un día de relleno no se suma a este mes", () => {
    // El 31 de julio sale en la cuadrícula de agosto, pero no es de agosto.
    const mes = construirMes(2026, 8, "2026-08-24", new Map([["2026-07-31", 3]]));
    expect(mes.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// De quién es cada calendario
// ---------------------------------------------------------------------------

describe("quién puede ver qué", () => {
  it("un entrenador ve SIEMPRE lo suyo, escriba lo que escriba", () => {
    // ESTA ES LA PRUEBA DE SEGURIDAD. No es que no se le enseñe el selector:
    // es que no hay forma de que le salga otro identificador.
    for (const intento of [ADMIN.id, OTRO.id, "inventado", null, undefined, ""]) {
      const alcance = alcanceDelCalendario(RAFA, intento, PERFILES);
      expect(alcance.profesionalId, String(intento)).toBe(RAFA.id);
      expect(alcance.puedeElegir, String(intento)).toBe(false);
    }
  });

  it("el administrador sin elegir nada ve a todo el equipo", () => {
    const alcance = alcanceDelCalendario(ADMIN, undefined, PERFILES);
    expect(alcance.profesionalId).toBeNull();
    expect(alcance.puedeElegir).toBe(true);
  });

  it("el administrador puede mirar el de uno concreto", () => {
    expect(alcanceDelCalendario(ADMIN, RAFA.id, PERFILES).profesionalId).toBe(RAFA.id);
    expect(alcanceDelCalendario(ADMIN, ADMIN.id, PERFILES).profesionalId).toBe(ADMIN.id);
  });

  it("un identificador inventado no devuelve el calendario de nadie", () => {
    expect(alcanceDelCalendario(ADMIN, "per-que-no-existe", PERFILES).profesionalId).toBeNull();
    expect(alcanceDelCalendario(ADMIN, "-- bórralo todo", PERFILES).profesionalId).toBeNull();
  });

  it("siempre se sabe quién es el administrador", () => {
    // Sin ese dato, el histórico anterior a que hubiera profesionales se
    // quedaría sin dueño y desaparecería del calendario.
    expect(alcanceDelCalendario(RAFA, null, PERFILES).adminId).toBe(ADMIN.id);
    expect(alcanceDelCalendario(ADMIN, null, PERFILES).adminId).toBe(ADMIN.id);
  });
});

// ---------------------------------------------------------------------------
// Con datos de verdad
// ---------------------------------------------------------------------------

describe("el calendario con sesiones reales", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  const firmar = (cliente: string, fecha: string) => firmarSesion(cliente, { fecha });

  const delMes = () =>
    obtenerCalendario({ anio: 2026, mes: 9, profesionalId: null, adminId: ADMIN.id });

  it("cuenta las sesiones del día en que se firmaron", async () => {
    // «cli-a» es del administrador; «cli-d», de Rafa.
    await firmar("cli-a", "2026-09-10");
    await firmar("cli-d", "2026-09-10");
    await firmar("cli-a", "2026-09-15");

    const { mes } = await delMes();
    const dias = mes.semanas.flat();

    expect(dias.find((d) => d.fecha === "2026-09-10")!.sesiones).toBe(2);
    expect(dias.find((d) => d.fecha === "2026-09-15")!.sesiones).toBe(1);
    expect(mes.total).toBe(3);
  });

  it("cada profesional ve solo las suyas", async () => {
    await firmar("cli-a", "2026-09-10"); // del administrador
    await firmar("cli-d", "2026-09-10"); // de Rafa

    const deRafa = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: RAFA.id, adminId: ADMIN.id });
    const deAdmin = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: ADMIN.id, adminId: ADMIN.id });

    expect(deRafa.sesiones).toHaveLength(1);
    expect(deRafa.sesiones[0].titulo).toBe("Cliente D");
    expect(deAdmin.sesiones).toHaveLength(1);
    expect(deAdmin.sesiones[0].titulo).toBe("Cliente A");
  });

  it("las de un profesional NO llegan al navegador de otro", async () => {
    // No es que se pinten o no: es que no salen de la base.
    await firmar("cli-a", "2026-09-10");
    await firmar("cli-d", "2026-09-10");

    const deRafa = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: RAFA.id, adminId: ADMIN.id });

    expect(JSON.stringify(deRafa.sesiones)).not.toContain("Cliente A");
    expect(deRafa.sesiones.every((s) => s.profesionalId === RAFA.id)).toBe(true);
  });

  it("solo se piden las del mes que se está mirando", async () => {
    await firmar("cli-a", "2026-09-10");
    await firmar("cli-a", "2026-10-05");

    const septiembre = await delMes();
    expect(septiembre.sesiones).toHaveLength(1);
    expect(septiembre.sesiones[0].fecha).toBe("2026-09-10");
  });

  it("trae lo justo para reconocer la sesión, y nada de dinero", async () => {
    // La tarifa no pinta nada en un calendario y no tiene por qué viajar hasta
    // el navegador.
    await firmar("cli-a", "2026-09-10");
    const { sesiones } = await delMes();

    expect(Object.keys(sesiones[0]).sort()).toEqual(
      ["clase", "cliente" + "Id", "detalle", "fecha", "hora", "id", "profesionalId", "titulo"].sort(),
    );
  });

  it("un mes sin nada no falla: se puede seguir navegando", async () => {
    const { mes, sesiones } = await obtenerCalendario({
      anio: 2019,
      mes: 1,
      profesionalId: null,
      adminId: ADMIN.id,
    });
    expect(sesiones).toHaveLength(0);
    expect(mes.total).toBe(0);
    expect(mes.titulo).toBe("Enero 2019");
  });

  it("un profesional sin ninguna sesión también puede mirar su calendario", async () => {
    await firmar("cli-a", "2026-09-10");
    const suyo = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: OTRO.id, adminId: ADMIN.id });

    expect(suyo.sesiones).toHaveLength(0);
    expect(suyo.mes.total).toBe(0);
    expect(suyo.mes.semanas.length).toBeGreaterThan(0);
  });

  it("una sesión del último día del mes se queda en su día", async () => {
    // La fecha se guarda como día de Madrid y se lee como texto: no pasa por
    // ninguna conversión horaria que pueda moverla. Ver `lib/fechas.ts`.
    await firmar("cli-a", "2026-09-30");

    const { mes, sesiones } = await delMes();

    expect(sesiones).toHaveLength(1);
    expect(sesiones[0].fecha).toBe("2026-09-30");
    expect(mes.semanas.flat().find((d) => d.fecha === "2026-09-30")!.sesiones).toBe(1);
    // Y no se ha ido al 1 de octubre, que sale en la cuadrícula como relleno.
    expect(mes.semanas.flat().find((d) => d.fecha === "2026-10-01")!.sesiones).toBe(0);
  });

  it("firmar a las once y media de la noche no la manda al día siguiente", () => {
    // EL CASO QUE IMPORTA. El servidor de Vercel va en horario universal: a
    // las 23:30 de Madrid allí ya es el día siguiente. La fecha con la que se
    // firma sale de `hoyNegocio`, que mira el reloj de Madrid.
    //
    // 2026-09-30 a las 23:30 en Madrid son las 21:30 universales.
    expect(hoyNegocio(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09-30");
    // Y al revés: la medianoche y media de Madrid son las 22:30 del día
    // anterior en universal. La sesión es del día 1, no del 30.
    expect(hoyNegocio(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
  });

  it("dentro del día van por hora", async () => {
    await firmar("cli-a", "2026-09-10");
    await firmar("cli-c", "2026-09-10");

    const { sesiones } = await delMes();
    const horas = sesiones.map((s) => s.hora ?? "99:99");

    expect([...horas].sort()).toEqual(horas);
  });
});

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

describe("el calendario dibujado", () => {
  const mes = construirMes(2026, 8, "2026-08-24", new Map([["2026-08-24", 2], ["2026-08-27", 4]]));
  const sesiones = [
    {
      id: "s1",
      clase: "sesion_cliente" as const,
      clienteId: "cli-a",
      titulo: "Cliente A",
      fecha: "2026-08-24",
      hora: "09:00",
      detalle: "Bono 8 sesiones",
      profesionalId: "per-admin",
    },
    {
      id: "s2",
      clase: "sesion_cliente" as const,
      clienteId: "cli-d",
      titulo: "Cliente D",
      fecha: "2026-08-24",
      hora: null,
      detalle: "Bono 8 sesiones",
      profesionalId: "per-rafa",
    },
  ];

  const pintar = (agrupar = false) =>
    renderToStaticMarkup(
      createElement(Calendario, {
        mes,
        sesiones,
        hoy: "2026-08-24",
        nombresDeProfesionales: { "per-admin": "Tatu", "per-rafa": "Rafa Galindo" },
        agruparPorProfesional: agrupar,
      }),
    );

  it("al entrar se abre el día de hoy", () => {
    // Sin tener que tocar nada: es la pregunta que se hace al abrirlo.
    const html = pintar();
    expect(html).toContain("Lunes, 24 de agosto");
    expect(html).toContain("2 sesiones firmadas");
  });

  it("hoy y el día elegido se distinguen a la vista y también sin ella", () => {
    const html = pintar();
    expect(html).toContain("calendario-dia hoy elegido con-sesiones");
    expect(html).toContain('aria-pressed="true"');
    // Quien no ve la pantalla oye cuántas hay.
    expect(html).toContain('aria-label="27, 4 sesiones"');
    expect(html).toContain('aria-label="24, 2 sesiones, hoy"');
  });

  it("un día sin sesiones no mete ruido", () => {
    // El 25 no tiene nada: sale el número y ya, sin fondo ni contador.
    expect(pintar()).toContain('aria-label="25, sin sesiones"');
  });

  it("los días de otro mes se ven apagados", () => {
    expect(pintar()).toContain("calendario-dia fuera");
  });

  it("cada sesión se reconoce: hora, cliente y servicio", () => {
    const html = pintar();
    expect(html).toContain("09:00");
    expect(html).toContain("Cliente A");
    expect(html).toContain("Bono 8 sesiones");
    // La que no tiene hora no se la inventa.
    expect(html).toContain("—");
  });

  it("se puede ir a la ficha del cliente desde la sesión", () => {
    expect(pintar()).toContain('href="/clientes/cli-a"');
  });

  it("mirando a todo el equipo, cada sesión dice de quién es", () => {
    const html = pintar(true);
    expect(html).toContain("Tatu");
    expect(html).toContain("Rafa Galindo");
    expect(html).toContain("calendario-grupo-titulo");
  });

  it("mirando a uno solo no se repite su nombre en cada línea", () => {
    expect(pintar(false)).not.toContain("calendario-grupo-titulo");
  });

  it("la cuadrícula son filas de siete, no una tabla", () => {
    // Una tabla en un móvil se sale de la pantalla a lo ancho.
    const html = pintar();
    expect(html).not.toContain("<table");
    expect((html.match(/calendario-semana/g) ?? []).length).toBe(mes.semanas.length);
  });
});
