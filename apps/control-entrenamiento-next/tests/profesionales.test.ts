/**
 * Dar de alta y de baja a los profesionales del equipo.
 *
 * Lo que se prueba aquí NO es que la pantalla se dibuje: es que alguien creado
 * desde la aplicación tenga **exactamente** los permisos de Rafa, ni uno más,
 * y que dar de baja a alguien no le quite ni una línea a su histórico.
 *
 * La regla de fondo (Fernando, 2026-08-30): un profesional nuevo hereda las
 * reglas que ya existen, no unas propias. No hay un segundo sistema de
 * usuarios.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { BONO, CUENTA, MENSUALIDAD, ErrorDeNegocio } from "@/domain/modalidades";
import { modalidadesPermitidas, puedeLlevarModalidad } from "@/domain/atribucion";
import { claveTemporal, normalizarCorreo, puedeDesactivarse, revisarAlta } from "@/domain/profesionales";
import { puedeVerCliente } from "@/lib/permisos";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import { obtenerCalendario } from "@/services/calendario";
import { obtenerEconomia } from "@/services/economia";
import { crearCliente } from "@/services/clientes";
import { firmarSesion } from "@/services/sesiones";

const ADMIN = "per-admin";
const RAFA = "per-rafa";
const RAIZ = path.join(process.cwd(), "src", "app");

/** Da de alta a alguien como lo haría la pantalla. */
async function altaDe(nombre: string, correo: string) {
  return repositorio().crearProfesional({ nombre, correo, clave: claveTemporal() });
}

// ---------------------------------------------------------------------------
// Las reglas del alta
// ---------------------------------------------------------------------------

describe("dar de alta", () => {
  it("hace falta nombre y un correo con pinta de correo", () => {
    expect(revisarAlta({ nombre: "Carlos Pérez", correo: "carlos@correo.com" })).toEqual([]);
    expect(revisarAlta({ nombre: "", correo: "carlos@correo.com" })[0].campo).toBe("nombre");
    expect(revisarAlta({ nombre: "Carlos", correo: "carlos" })[0].campo).toBe("correo");
    expect(revisarAlta({ nombre: "Carlos", correo: "" })[0].campo).toBe("correo");
  });

  it("el correo se guarda en minúsculas", () => {
    // Guardarlo tal cual se escriba deja la cuenta inaccesible: la aplicación
    // busca en minúsculas. Le pasó a Rafa el 2026-08-10.
    expect(normalizarCorreo("  Carlos@Correo.COM ")).toBe("carlos@correo.com");
    expect(revisarAlta({ nombre: "Carlos", correo: "  Carlos@Correo.COM " })).toEqual([]);
  });

  it("la contraseña temporal se puede dictar sin equivocarse", () => {
    // Sin las letras y números que se confunden al leerlos: O/0, l/1, I.
    for (let i = 0; i < 200; i += 1) {
      const clave = claveTemporal();
      expect(clave).toHaveLength(12);
      expect(clave).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]+$/);
    }
  });

  it("y no sale dos veces la misma", () => {
    const vistas = new Set(Array.from({ length: 300 }, () => claveTemporal()));
    expect(vistas.size).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Un profesional nuevo es exactamente como Rafa
// ---------------------------------------------------------------------------

describe("un profesional recién creado", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("nace como entrenador y puede entrar", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");

    const perfil = await repo.perfilPorCorreo("carlos@correo.com");
    expect(perfil).not.toBeNull();
    expect(perfil!.id).toBe(id);
    expect(perfil!.rol).toBe("entrenador");
    expect(perfil!.activo).not.toBe(false);
  });

  it("entra escriba su correo como lo escriba", async () => {
    await altaDe("Carlos Pérez", "carlos@correo.com");
    expect(await repositorio().perfilPorCorreo("CARLOS@correo.com")).not.toBeNull();
    expect(await repositorio().perfilPorCorreo("  carlos@Correo.COM ")).not.toBeNull();
  });

  it("no puede haber dos con el mismo correo", async () => {
    await altaDe("Carlos Pérez", "carlos@correo.com");
    await expect(altaDe("Otro Carlos", "carlos@correo.com")).rejects.toThrow(ErrorDeNegocio);
  });

  it("empieza sin ningún cliente", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const suyos = (await repositorio().listarClientes()).filter((c) => c.profesionalId === id);
    expect(suyos).toHaveLength(0);
  });

  it("solo ve los clientes que sean suyos", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const carlos = { id, rol: "entrenador" as const, correo: "carlos@correo.com", nombre: "Carlos Pérez" };

    expect(puedeVerCliente(carlos, id)).toBe(true);
    expect(puedeVerCliente(carlos, RAFA)).toBe(false);
    expect(puedeVerCliente(carlos, ADMIN)).toBe(false);
    expect(puedeVerCliente(carlos, null)).toBe(false);
  });

  it("puede dar de alta clientes suyos, y con bono", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const cliente = await crearCliente({
      nombre: "Cliente de Carlos",
      modalidad: BONO,
      servicio: "Bono 8 sesiones",
      tarifa: 40,
      sesionesTotales: 8,
      precioTotal: 320,
      cuotaMensual: null,
      sesionesReferencia: null,
      profesionalId: id,
    });

    expect((await repositorio().obtenerCliente(cliente.id))!.profesionalId).toBe(id);
  });

  it("puede firmar las sesiones de sus clientes", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente("cli-d"))!;
    await repo.actualizarCliente({ ...cliente, profesionalId: id });

    const r = await firmarSesion("cli-d", { firmadaPor: id });
    expect(r.numeroSesion).toBeGreaterThan(0);
  });

  it("SOLO puede llevar bonos, igual que Rafa", () => {
    // La regla no cambia por ser nuevo: se hereda, no se reinventa.
    expect(modalidadesPermitidas(false)).toEqual([BONO]);
    expect(puedeLlevarModalidad(false, BONO)).toBe(true);
    expect(puedeLlevarModalidad(false, MENSUALIDAD)).toBe(false);
    expect(puedeLlevarModalidad(false, CUENTA)).toBe(false);
  });

  it("no puede crear un cliente con mensualidad ni con cuenta", async () => {
    // Y falla POR EL MOTIVO CORRECTO, no por cualquier otro: la regla mira el
    // rol del responsable del cliente, así que un cliente a nombre de un
    // entrenador no puede llevar más que bono.
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");

    // Los datos son VÁLIDOS para cada modalidad a propósito: si no, la
    // creación fallaría antes por otro motivo y esta prueba no estaría
    // comprobando el permiso, que es lo que importa. Pasó al escribirla.
    const casos = [
      {
        modalidad: MENSUALIDAD,
        datos: { cuotaMensual: 500, sesionesReferencia: 10, tarifa: null, sesionesTotales: 0, precioTotal: null },
      },
      {
        modalidad: CUENTA,
        datos: { cuotaMensual: null, sesionesReferencia: null, tarifa: 40, sesionesTotales: 0, precioTotal: null },
      },
    ] as const;

    for (const caso of casos) {
      await expect(
        crearCliente({
          nombre: `Cliente ${caso.modalidad}`,
          modalidad: caso.modalidad,
          servicio: "Lo que sea",
          profesionalId: id,
          ...caso.datos,
        }),
        caso.modalidad,
      ).rejects.toThrow(/solo puede llevar clientes con bono/i);
    }
  });

  it("en su economía solo entra lo suyo, y sin CrossFit ni cuotas", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const suya = await obtenerEconomia({ profesionalId: id, adminId: ADMIN });
    expect(suya.mesActual.facturacionTotal).toBe(0);
    expect(suya.mesActual.horasTotales).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Aparece solo donde tiene que aparecer
// ---------------------------------------------------------------------------

describe("se integra sin tocar código", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("sale en la lista de profesionales para asignarle clientes", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const lista = await repositorio().listarProfesionales();
    expect(lista.map((p) => p.id)).toContain(id);
  });

  it("su producción entra sola en la economía del administrador", async () => {
    // Sin tocar una línea: el total se calcula sobre la lista real.
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente("cli-d"))!;
    await repo.actualizarCliente({ ...cliente, profesionalId: id });

    const antes = (await obtenerEconomia({ profesionalId: null, esAdministrador: true, adminId: ADMIN }))
      .mesActual;
    await firmarSesion("cli-d", { firmadaPor: id });
    const despues = (await obtenerEconomia({ profesionalId: null, esAdministrador: true, adminId: ADMIN }))
      .mesActual;
    const suya = (await obtenerEconomia({ profesionalId: id, adminId: ADMIN })).mesActual;

    expect(suya.horasTotales).toBe(1);
    expect(despues.horasTotales).toBe(antes.horasTotales + 1);
    expect(despues.facturacionTotal).toBe(antes.facturacionTotal + suya.facturacionTotal);
  });

  it("y su trabajo sale en el calendario del administrador", async () => {
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const repo = repositorio();
    const cliente = (await repo.obtenerCliente("cli-d"))!;
    await repo.actualizarCliente({ ...cliente, profesionalId: id });
    await firmarSesion("cli-d", { fecha: "2026-09-10", firmadaPor: id });

    const suyo = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: id, adminId: ADMIN });
    expect(suyo.sesiones).toHaveLength(1);
  });

  it("ningún sitio lleva escritos los profesionales a mano", () => {
    // Si mañana se crea a alguien desde la pantalla, tiene que aparecer sin
    // tocar código. Una lista escrita a mano lo dejaría fuera en silencio.
    const fuentes = [
      "economia/page.tsx",
      "calendario/page.tsx",
      "clientes/nuevo/page.tsx",
      "administracion/profesionales/page.tsx",
    ];
    for (const relativa of fuentes) {
      const codigo = readFileSync(path.join(RAIZ, relativa), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(codigo, relativa).toContain("listarProfesionales()");
      expect(codigo.toLowerCase(), relativa).not.toContain("rafa");
      expect(codigo, relativa).not.toMatch(/["'`]per-[a-z]/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Dar de baja
// ---------------------------------------------------------------------------

describe("dar de baja a un profesional", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("deja de poder entrar", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    expect(await repo.perfilPorCorreo("carlos@correo.com")).not.toBeNull();

    await repo.cambiarEstadoProfesional(id, false);

    expect(await repo.perfilPorCorreo("carlos@correo.com")).toBeNull();
  });

  it("y vuelve a entrar si se le devuelve el acceso", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    await repo.cambiarEstadoProfesional(id, false);
    await repo.cambiarEstadoProfesional(id, true);

    expect(await repo.perfilPorCorreo("carlos@correo.com")).not.toBeNull();
  });

  it("NO se le borra: sigue en la lista, marcado", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    await repo.cambiarEstadoProfesional(id, false);

    const suyo = (await repo.listarProfesionales()).find((p) => p.id === id);
    expect(suyo, "sigue existiendo").toBeDefined();
    expect(suyo!.activo).toBe(false);
  });

  it("su histórico no se mueve ni un milímetro", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const cliente = (await repo.obtenerCliente("cli-d"))!;
    await repo.actualizarCliente({ ...cliente, profesionalId: id });
    await firmarSesion("cli-d", { fecha: "2026-09-10", firmadaPor: id });

    const antes = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: id, adminId: ADMIN });
    const economiaAntes = await obtenerEconomia({ profesionalId: id, adminId: ADMIN });

    // Se le quita el cliente —para poder darle de baja— y se le da de baja.
    await repo.actualizarCliente({ ...cliente, profesionalId: RAFA });
    await repo.cambiarEstadoProfesional(id, false);

    const despues = await obtenerCalendario({ anio: 2026, mes: 9, profesionalId: id, adminId: ADMIN });
    const economiaDespues = await obtenerEconomia({ profesionalId: id, adminId: ADMIN });

    expect(despues.sesiones).toHaveLength(antes.sesiones.length);
    expect(despues.sesiones[0].id).toBe(antes.sesiones[0].id);
    expect(economiaDespues.mesActual.facturacionTotal).toBe(economiaAntes.mesActual.facturacionTotal);
  });

  it("no se puede dar de baja a quien todavía lleva clientes activos", async () => {
    // La regla de Fernando: nunca se reasignan solos. Un cliente activo sin
    // responsable es un cliente al que nadie le firma.
    const veredicto = puedeDesactivarse({ rol: "entrenador", nombre: "Carlos Pérez" }, 3);
    expect(veredicto.puede).toBe(false);
    expect(veredicto.porQue).toContain("3 clientes activos");
    expect(veredicto.porQue).toContain("Pásaselos");
  });

  it("sin clientes activos, sí", () => {
    expect(puedeDesactivarse({ rol: "entrenador", nombre: "Carlos Pérez" }, 0).puede).toBe(true);
  });

  it("al administrador no se le puede dar de baja", () => {
    // Sin él nadie podría gestionar la aplicación.
    const veredicto = puedeDesactivarse({ rol: "admin", nombre: "Tatu" }, 0);
    expect(veredicto.puede).toBe(false);
    expect(veredicto.porQue).toContain("administrador");
  });

  it("los clientes de baja no cuentan para impedir la baja", async () => {
    const repo = repositorio();
    const { id } = await altaDe("Carlos Pérez", "carlos@correo.com");
    const cliente = (await repo.obtenerCliente("cli-e"))!; // viene pausado
    await repo.actualizarCliente({ ...cliente, profesionalId: id, estado: "pausado" });

    expect(await repo.contarClientesActivosDe(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Nada de esto le quita permisos a quien ya los tenía
// ---------------------------------------------------------------------------

describe("los de siempre siguen igual", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("Rafa sigue viendo lo suyo y solo lo suyo", async () => {
    const rafa = { id: RAFA, rol: "entrenador" as const, correo: "entrenador@pruebas.local", nombre: "Entrenador" };
    expect(puedeVerCliente(rafa, RAFA)).toBe(true);
    expect(puedeVerCliente(rafa, ADMIN)).toBe(false);
    expect(await repositorio().perfilPorCorreo("entrenador@pruebas.local")).not.toBeNull();
  });

  it("el administrador sigue viendo a todo el mundo", () => {
    const admin = { id: ADMIN, rol: "admin" as const, correo: "admin@pruebas.local", nombre: "Administrador" };
    expect(puedeVerCliente(admin, RAFA)).toBe(true);
    expect(puedeVerCliente(admin, ADMIN)).toBe(true);
    expect(puedeVerCliente(admin, "per-quien-sea")).toBe(true);
  });

  it("y sigue pudiendo con todas las modalidades", () => {
    expect(modalidadesPermitidas(true)).toEqual([BONO, MENSUALIDAD, CUENTA]);
  });
});

// ---------------------------------------------------------------------------
// Las tres barreras
// ---------------------------------------------------------------------------

describe("administración es SOLO del administrador", () => {
  const lista = readFileSync(path.join(RAIZ, "administracion", "profesionales", "page.tsx"), "utf8");
  const alta = readFileSync(path.join(RAIZ, "administracion", "profesionales", "nuevo", "page.tsx"), "utf8");
  const acciones = readFileSync(path.join(RAIZ, "actions.ts"), "utf8");

  it("la pantalla de la lista lo exige", () => {
    expect(lista).toContain("exigirAdmin(");
    expect(lista).not.toContain("exigirUsuario(");
  });

  it("la pantalla del alta lo exige", () => {
    expect(alta).toContain("exigirAdmin(");
    expect(alta).not.toContain("exigirUsuario(");
  });

  it("y las dos acciones que escriben lo exigen POR SU CUENTA", () => {
    // Llegar a la pantalla y poder crear son dos permisos distintos. Un
    // entrenador que llame a la acción a mano, sin pasar por ninguna pantalla,
    // tiene que estrellarse aquí.
    for (const accion of ["accionCrearProfesional", "accionCambiarEstadoProfesional"]) {
      const desde = acciones.indexOf(`export async function ${accion}`);
      expect(desde, accion).toBeGreaterThan(-1);
      const cuerpo = acciones.slice(desde, desde + 900);
      expect(cuerpo, accion).toContain("await exigirAdmin()");
    }
  });

  it("el identificador que llega en el formulario se comprueba contra la lista real", () => {
    const desde = acciones.indexOf("export async function accionCambiarEstadoProfesional");
    const cuerpo = acciones.slice(desde, desde + 1600);
    expect(cuerpo).toContain("listarProfesionales()");
    expect(cuerpo).toMatch(/profesionales\.find\(\(p\) => p\.id === validado\.data\.profesionalId\)/);
  });

  it("desde esta pantalla no se pueden crear administradores", () => {
    // El rol no se pide ni se lee del formulario: se fija a entrenador.
    const codigo = readFileSync(
      path.join(process.cwd(), "src", "repositories", "postgres.ts"),
      "utf8",
    );
    expect(codigo).toMatch(/values \(\$1, \$2, 'entrenador'\)/);
  });
});

// ---------------------------------------------------------------------------
// La contraseña
// ---------------------------------------------------------------------------

describe("la contraseña no se guarda en claro en ningún sitio", () => {
  it("la base la cifra ella misma", () => {
    // `crypt` + `bcrypt`, que es lo que hace Supabase al registrar a alguien.
    const codigo = readFileSync(path.join(process.cwd(), "src", "repositories", "postgres.ts"), "utf8");
    const desde = codigo.indexOf("async crearProfesional");
    const cuerpo = codigo.slice(desde, desde + 2600);
    expect(cuerpo).toContain("crypt($2, gen_salt('bf'))");
  });

  it("el repositorio de pruebas tampoco la guarda", async () => {
    // Guardarla en el archivo de pruebas sería coger justo el hábito que no se
    // quiere coger.
    const clave = "estaesmiclave";
    await reiniciarStagingParaPruebas();
    await repositorio().crearProfesional({ nombre: "Carlos", correo: "carlos@correo.com", clave });

    const guardado = JSON.stringify(await repositorio().listarProfesionales());
    expect(guardado).not.toContain(clave);
  });

  it("y no se escribe en ningún registro", () => {
    const acciones = readFileSync(path.join(RAIZ, "actions.ts"), "utf8");
    const desde = acciones.indexOf("export async function accionCrearProfesional");
    const cuerpo = acciones.slice(desde, desde + 1800);
    expect(cuerpo).not.toContain("console.");
  });
});
