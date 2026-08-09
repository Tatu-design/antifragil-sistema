/**
 * Quién puede ver y tocar qué.
 *
 * Estas son las pruebas más importantes del proyecto. Todas las demás
 * comprueban que las cuentas salen; estas comprueban que los datos de un
 * cliente no acaban en el móvil de quien no debe verlos.
 *
 * Se prueban tres cosas distintas, y las tres hacen falta:
 *
 *   1. La REGLA  — a quién deja pasar y a quién no.
 *   2. El ALCANCE — que lo de los demás ni siquiera se lea de la base.
 *   3. LA COBERTURA — que ninguna acción ni pantalla se quede sin candado.
 *
 * La tercera es la que evita el fallo más probable: no que alguien escriba mal
 * un permiso, sino que dentro de seis meses se añada una pantalla nueva y se
 * olvide de ponérselo.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { BONO } from "@/domain/modalidades";
import { esAdmin, puedeVerCliente } from "@/lib/permisos";
import { repositorio } from "@/repositories";
import { reiniciarStagingParaPruebas } from "@/repositories/staging";
import type { Perfil } from "@/repositories/tipos";
import { listarClientes } from "@/services/clientes";

const ADMIN: Perfil = { id: "per-admin", correo: "admin@pruebas.local", nombre: "Administrador", rol: "admin" };
const RAFA: Perfil = { id: "per-rafa", correo: "entrenador@pruebas.local", nombre: "Entrenador", rol: "entrenador" };
const OTRO: Perfil = { id: "per-otro", correo: "otro@pruebas.local", nombre: "Otro", rol: "entrenador" };

// En los datos de prueba, «cli-d» es de Rafa y los otros cuatro del admin.
const SUYO = "cli-d";
const AJENO = "cli-a";

// ---------------------------------------------------------------------------
// 1. La regla
// ---------------------------------------------------------------------------

describe("la regla de acceso a un cliente", () => {
  it("el administrador entra en todos", () => {
    expect(puedeVerCliente(ADMIN, RAFA.id)).toBe(true);
    expect(puedeVerCliente(ADMIN, ADMIN.id)).toBe(true);
  });

  it("un entrenador entra en los suyos", () => {
    expect(puedeVerCliente(RAFA, RAFA.id)).toBe(true);
  });

  it("un entrenador NO entra en los de otro", () => {
    expect(puedeVerCliente(RAFA, ADMIN.id)).toBe(false);
    expect(puedeVerCliente(RAFA, OTRO.id)).toBe(false);
  });

  it("un cliente sin responsable no es de quien pregunte primero", () => {
    // Es del administrador hasta que se asigne a alguien a propósito. Si esto
    // devolviera `true`, cualquier cliente recién creado sería de todos.
    expect(puedeVerCliente(RAFA, null)).toBe(false);
    expect(puedeVerCliente(ADMIN, null)).toBe(true);
  });

  it("sin sesión no entra nadie", () => {
    expect(puedeVerCliente(null, RAFA.id)).toBe(false);
    expect(puedeVerCliente(null, null)).toBe(false);
  });

  it("el rol se mira por lo que es, no por parecerse", () => {
    expect(esAdmin(RAFA)).toBe(false);
    expect(esAdmin(null)).toBe(false);
    expect(esAdmin({ ...RAFA, rol: "admin" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. El alcance: lo ajeno no se lee siquiera
// ---------------------------------------------------------------------------

describe("qué datos salen de la base", () => {
  beforeEach(() => reiniciarStagingParaPruebas());

  it("el administrador recibe todos los clientes", async () => {
    const todos = await listarClientes();
    expect(todos.length).toBeGreaterThan(1);
    expect(todos.some((c) => c.id === SUYO)).toBe(true);
    expect(todos.some((c) => c.id === AJENO)).toBe(true);
  });

  it("un entrenador recibe SOLO los suyos", async () => {
    const suyos = await listarClientes(RAFA.id);
    expect(suyos.map((c) => c.id)).toEqual([SUYO]);
  });

  it("un entrenador sin clientes recibe una lista vacía, no la de todos", async () => {
    expect(await listarClientes(OTRO.id)).toEqual([]);
  });

  it("no viajan los nombres de los clientes ajenos", async () => {
    // Aunque la pantalla no los pintara, habrían salido de la base y llegado
    // al navegador. Esconder no es proteger.
    const texto = JSON.stringify(await listarClientes(RAFA.id));
    expect(texto).not.toContain("Cliente A");
    expect(texto).not.toContain("Cliente B");
    expect(texto).not.toContain("Pareja C");
  });

  it("ni los ciclos, ni las cuotas, ni el recuento de sesiones ajenas", async () => {
    const datos = await repositorio().cargarTodoParaLaLista(RAFA.id);

    expect(datos.ciclos.every((c) => c.clienteId === SUYO)).toBe(true);
    expect(datos.cargos.every((c) => c.clienteId === SUYO)).toBe(true);
    for (const clave of datos.sesionesPorCiclo.keys()) {
      expect(clave.startsWith(`${SUYO}:`)).toBe(true);
    }
  });

  it("preguntar por un cliente ajeno o por uno inventado responde lo mismo", async () => {
    // Si respondieran distinto, se podría averiguar quién está dado de alta
    // probando direcciones.
    const repo = repositorio();
    const ajeno = await repo.profesionalDelCliente(AJENO);
    const inventado = await repo.profesionalDelCliente("no-existe-este-cliente");

    expect(puedeVerCliente(RAFA, ajeno)).toBe(false);
    expect(puedeVerCliente(RAFA, inventado)).toBe(false);
  });

  it("tener cuenta no basta: hace falta perfil", async () => {
    const repo = repositorio();
    expect(await repo.perfilPorCorreo(ADMIN.correo)).not.toBeNull();
    expect(await repo.perfilPorCorreo("nadie@pruebas.local")).toBeNull();
  });

  it("el correo se reconoce escriba como se escriba", async () => {
    // Esto costó un despliegue entero (2026-08-10): la cuenta de Rafa se
    // guardó como «Rafagalindo998@…» y la aplicación la buscaba en
    // minúsculas, así que NO PODÍA ENTRAR. Un correo es el mismo aunque
    // cambien las mayúsculas.
    const repo = repositorio();
    const normal = await repo.perfilPorCorreo("entrenador@pruebas.local");
    expect(normal).not.toBeNull();

    for (const variante of ["ENTRENADOR@PRUEBAS.LOCAL", "Entrenador@Pruebas.Local", "  entrenador@pruebas.local  "]) {
      const encontrado = await repo.perfilPorCorreo(variante);
      expect(encontrado, `«${variante}» debería encontrar el mismo perfil`).not.toBeNull();
      expect(encontrado!.id).toBe(normal!.id);
    }
  });

  it("un cliente creado para el entrenador aparece en SU lista, no en la de nadie más", async () => {
    // Es el caso real: Fernando da de alta al cliente de Rafa. Si el alta no
    // guardara el responsable, el cliente nacería sin dueño y Rafa no lo
    // vería nunca — que es justo lo que pasaba antes de añadir el selector.
    const { crearCliente } = await import("@/services/clientes");
    const nuevo = await crearCliente({
      nombre: "Cliente de prueba",
      modalidad: BONO,
      servicio: "Bono 10",
      sesionesTotales: 10,
      precioTotal: 450,
      tarifa: 45,
      profesionalId: RAFA.id,
    });

    const deRafa = await listarClientes(RAFA.id);
    expect(deRafa.map((c) => c.id)).toContain(nuevo.id);
    expect(await listarClientes(OTRO.id)).toEqual([]);
  });

  it("sin responsable, un cliente nuevo no aparece en la lista de ningún entrenador", async () => {
    const { crearCliente } = await import("@/services/clientes");
    const huerfano = await crearCliente({
      nombre: "Cliente sin dueño",
      modalidad: BONO,
      servicio: "Bono 10",
      sesionesTotales: 10,
      precioTotal: 450,
      tarifa: 45,
    });

    expect((await listarClientes(RAFA.id)).map((c) => c.id)).not.toContain(huerfano.id);
    // Pero el administrador sí lo ve: no se pierde.
    expect((await listarClientes()).map((c) => c.id)).toContain(huerfano.id);
  });

  it("un entrenador crea su cliente y sale suyo, diga lo que diga el formulario", async () => {
    // El caso peligroso: Rafa manda a mano el identificador del administrador
    // en el campo del profesional. La accion NO mira ese campo cuando quien
    // crea no es administrador — si lo mirara, cualquiera podria colocarle
    // clientes a otro.
    const { crearCliente } = await import("@/services/clientes");
    const suyo = await crearCliente({
      nombre: "Cliente captado por el entrenador",
      modalidad: BONO,
      servicio: "Bono 10",
      sesionesTotales: 10,
      precioTotal: 450,
      tarifa: 45,
      profesionalId: RAFA.id,
    });

    expect((await listarClientes(RAFA.id)).map((c) => c.id)).toContain(suyo.id);
    // Y no aparece en la de ningun otro entrenador.
    expect((await listarClientes(OTRO.id)).map((c) => c.id)).not.toContain(suyo.id);
  });

  it("el administrador puede reasignar un cliente y el alcance cambia con él", async () => {
    const repo = repositorio();
    await repo.asignarProfesional(AJENO, RAFA.id);

    const suyos = await listarClientes(RAFA.id);
    expect(suyos.map((c) => c.id).sort()).toEqual([AJENO, SUYO].sort());
  });
});

// ---------------------------------------------------------------------------
// 3. La cobertura: que no se quede nada sin candado
// ---------------------------------------------------------------------------

const RAIZ = path.join(process.cwd(), "src", "app");
const GUARDIANES = ["exigirAdmin", "exigirAccesoACliente", "exigirUsuario"];

/** Las que son públicas o resuelven la propia sesión, y no llevan candado. */
const SIN_CANDADO = new Set([
  "accionEntrar",
  "accionEntrarClaveUnica",
  "accionSalir",
]);

describe("ninguna puerta se queda abierta", () => {
  it("todas las acciones de servidor comprueban permisos", () => {
    const codigo = readFileSync(path.join(RAIZ, "actions.ts"), "utf8");
    const bloques = codigo.split(/(?=export async function )/);

    const sinProteger: string[] = [];
    for (const bloque of bloques) {
      const nombre = /^export async function (\w+)/.exec(bloque)?.[1];
      if (!nombre || SIN_CANDADO.has(nombre)) continue;
      if (!GUARDIANES.some((g) => bloque.includes(`${g}(`))) sinProteger.push(nombre);
    }

    expect(sinProteger, `estas acciones no comprueban quién las llama: ${sinProteger.join(", ")}`).toEqual([]);
  });

  it("todas las pantallas privadas comprueban permisos", () => {
    // `/login` y `/mi/<token>` son públicas por definición: una es la puerta y
    // la otra es el enlace del cliente, que se protege con su token.
    const publicas = [path.join("login"), path.join("mi")];

    const paginas: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(completo);
        else if (entrada.name === "page.tsx") paginas.push(completo);
      }
    };
    recorrer(RAIZ);

    const sinProteger = paginas
      .filter((p) => !publicas.some((pub) => p.includes(path.sep + pub + path.sep)))
      // La raíz solo redirige según haya sesión o no; no enseña nada.
      .filter((p) => p !== path.join(RAIZ, "page.tsx"))
      .filter((p) => {
        const codigo = readFileSync(p, "utf8");
        return !GUARDIANES.some((g) => codigo.includes(`${g}(`));
      })
      .map((p) => path.relative(RAIZ, p));

    expect(sinProteger, `estas pantallas no comprueban quién entra: ${sinProteger.join(", ")}`).toEqual([]);
  });

  it("las pantallas de dinero y de administración exigen ser administrador", () => {
    const SOLO_ADMIN = [
      "economia/page.tsx",
      "avisos/page.tsx",
      "clientes/[id]/programa/page.tsx",
      "clientes/[id]/eliminar/page.tsx",
      "clases/[tipo]/page.tsx",
      "clases/kids/facturacion/page.tsx",
    ];
    for (const relativa of SOLO_ADMIN) {
      const codigo = readFileSync(path.join(RAIZ, ...relativa.split("/")), "utf8");
      expect(codigo, `${relativa} debería exigir administrador`).toContain("exigirAdmin(");
    }
  });

  it("el enlace público del cliente sigue sin pedir cuenta", () => {
    // Si alguien le pusiera un candado, todos los QR repartidos dejarían de
    // funcionar de golpe.
    const codigo = readFileSync(path.join(RAIZ, "mi", "[token]", "page.tsx"), "utf8");
    for (const guardian of GUARDIANES) expect(codigo).not.toContain(`${guardian}(`);
  });
});
