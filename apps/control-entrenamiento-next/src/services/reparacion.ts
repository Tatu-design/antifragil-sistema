/**
 * Diagnóstico y reparación de la numeración de sesiones (2026-08-04).
 *
 * Portado de `reparar_numeracion.py` del sistema Flask, donde el problema
 * apareció primero: el contador de un servicio se calculaba con el NÚMERO de
 * la última sesión que quedaba, no con cuántas sesiones había. Borrada la nº 1
 * de 7, la última seguía siendo la nº 7 → el contador se quedaba en 7 con solo
 * 6 sesiones, y la ficha se contradecía con su propio historial.
 *
 * El comportamiento ya está corregido en `services/sesiones.ts`: al borrar, las
 * posteriores del mismo ciclo bajan un número. Esto arregla lo que quedó
 * descuadrado antes de esa corrección.
 *
 * **Regla de trabajo (Fernando, 2026-08-04):** nada de esto se aplica solo
 * sobre datos reales. `diagnosticar()` no escribe nunca y devuelve exactamente
 * qué filas cambiarían, con su estado antes y después. `reparar()` solo se
 * ejecuta cuando alguien lo pide explícitamente, y devuelve lo aplicado.
 *
 * Qué NO toca, nunca: ni una fecha, ni una hora, ni una tarifa, ni un importe,
 * ni las semanas, ni los cargos mensuales. La facturación, las horas y el
 * precio medio salen intactos — el número de sesión es una etiqueta y no entra
 * en ningún cálculo económico.
 */

import type { Ciclo, Sesion } from "@/domain/tipos";
import { repositorio } from "@/repositories";

/** Un cambio concreto sobre una sesión, para poder enseñarlo antes de nada. */
export interface CambioDeSesion {
  sesionId: string;
  fecha: string;
  cicloAntes: number;
  cicloDespues: number;
  numeroAntes: number;
  numeroDespues: number;
}

export interface ArregloDeCliente {
  clienteId: string;
  nombre: string;
  /** `true` cuando el ciclo tenía más sesiones que el bono y hay que repartirlo. */
  repartirEnCiclos: boolean;
  tope: number;
  numerosAntes: number[];
  numerosDespues: number[];
  contadorAntes: number;
  contadorDespues: number;
  cicloActualAntes: number;
  cicloActualDespues: number;
  cambios: CambioDeSesion[];
  /** Ciclos que habría que crear o cerrar al repartir. */
  ciclosAfectados: { ciclo: number; desde: string; hasta: string | null; sesiones: number }[];
}

/** Ordena de más antigua a más reciente: es el orden en que se numeran. */
function porFecha(sesiones: Sesion[]): Sesion[] {
  return [...sesiones].sort((a, b) =>
    a.fecha === b.fecha ? a.id.localeCompare(b.id, "es", { numeric: true }) : a.fecha.localeCompare(b.fecha),
  );
}

function trocear<T>(lista: T[], tamano: number): T[][] {
  const trozos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

/**
 * Revisa a todos los clientes y devuelve qué habría que arreglar. **No
 * escribe nada.** Es lo que hay que enseñar antes de tocar datos reales.
 */
export async function diagnosticar(): Promise<ArregloDeCliente[]> {
  const repo = repositorio();
  const arreglos: ArregloDeCliente[] = [];

  for (const cliente of await repo.listarClientes()) {
    const todas = await repo.listarSesiones(cliente.id);
    const delCiclo = porFecha(todas.filter((s) => s.ciclo === cliente.cicloActual));
    if (delCiclo.length === 0) continue;

    const ciclo = await repo.cicloActual(cliente.id);
    const tope = ciclo?.sesionesTotales ?? 0;

    const numerosAntes = delCiclo.map((s) => s.numeroSesion);
    const correcto = delCiclo.map((_, i) => i + 1);
    const yaEstaBien =
      numerosAntes.every((n, i) => n === correcto[i]) && cliente.sesionesCompletadas === delCiclo.length;
    if (yaEstaBien) continue;

    // Más sesiones que el bono: no es numeración, le faltó una renovación. Se
    // reparte con la MISMA regla que usa la app al firmar (las que pasan del
    // tamaño del bono empiezan uno nuevo), no con una invención de aquí.
    if (tope > 0 && delCiclo.length > tope) {
      const partes = trocear(delCiclo, tope);
      const cambios: CambioDeSesion[] = [];
      const ciclosAfectados: ArregloDeCliente["ciclosAfectados"] = [];

      partes.forEach((parte, i) => {
        const numeroDeCiclo = cliente.cicloActual + i;
        const esElUltimo = i === partes.length - 1;
        parte.forEach((sesion, j) => {
          if (sesion.ciclo !== numeroDeCiclo || sesion.numeroSesion !== j + 1) {
            cambios.push({
              sesionId: sesion.id,
              fecha: sesion.fecha,
              cicloAntes: sesion.ciclo,
              cicloDespues: numeroDeCiclo,
              numeroAntes: sesion.numeroSesion,
              numeroDespues: j + 1,
            });
          }
        });
        ciclosAfectados.push({
          ciclo: numeroDeCiclo,
          desde: parte[0].fecha,
          hasta: esElUltimo ? null : parte[parte.length - 1].fecha,
          sesiones: parte.length,
        });
      });

      arreglos.push({
        clienteId: cliente.id,
        nombre: cliente.nombre,
        repartirEnCiclos: true,
        tope,
        numerosAntes,
        numerosDespues: partes.flatMap((parte) => parte.map((_, j) => j + 1)),
        contadorAntes: cliente.sesionesCompletadas,
        contadorDespues: partes[partes.length - 1].length,
        cicloActualAntes: cliente.cicloActual,
        cicloActualDespues: cliente.cicloActual + partes.length - 1,
        cambios,
        ciclosAfectados,
      });
      continue;
    }

    arreglos.push({
      clienteId: cliente.id,
      nombre: cliente.nombre,
      repartirEnCiclos: false,
      tope,
      numerosAntes,
      numerosDespues: correcto,
      contadorAntes: cliente.sesionesCompletadas,
      contadorDespues: delCiclo.length,
      cicloActualAntes: cliente.cicloActual,
      cicloActualDespues: cliente.cicloActual,
      cambios: delCiclo
        .map((sesion, i) => ({
          sesionId: sesion.id,
          fecha: sesion.fecha,
          cicloAntes: sesion.ciclo,
          cicloDespues: sesion.ciclo,
          numeroAntes: sesion.numeroSesion,
          numeroDespues: i + 1,
        }))
        .filter((c) => c.numeroAntes !== c.numeroDespues),
      ciclosAfectados: [],
    });
  }

  return arreglos;
}

/**
 * Aplica los arreglos que devuelve `diagnosticar()`. Idempotente: al segundo
 * pase no hay nada que hacer, porque la numeración ya es correcta.
 *
 * Solo debe llamarse después de que Fernando haya visto el diagnóstico.
 */
export async function reparar(): Promise<ArregloDeCliente[]> {
  const repo = repositorio();
  const arreglos = await diagnosticar();
  if (arreglos.length === 0) return [];

  await repo.transaccion(async () => {
    for (const arreglo of arreglos) {
      for (const cambio of arreglo.cambios) {
        await repo.reubicarSesion(cambio.sesionId, cambio.cicloDespues, cambio.numeroDespues);
      }

      if (arreglo.repartirEnCiclos) {
        await repartirCiclos(arreglo);
      }

      const cliente = await repo.obtenerCliente(arreglo.clienteId);
      if (!cliente) continue;
      cliente.sesionesCompletadas = arreglo.contadorDespues;
      cliente.cicloActual = arreglo.cicloActualDespues;
      await repo.actualizarCliente(cliente);
    }
  });

  return arreglos;
}

/**
 * Deja una ficha por cada bono al repartir un ciclo que se pasó de tamaño.
 *
 * El bono que se llena queda cerrado con la fecha de su última sesión; el
 * último queda abierto. **El estado de cobro de un ciclo que ya existía NO se
 * toca**: si estaba marcado, se respeta. Los ciclos nuevos nacen con el mismo
 * estado de cobro que tenía el ciclo del que salen — no se inventa una deuda
 * ni se da por cobrado nada.
 */
async function repartirCiclos(arreglo: ArregloDeCliente): Promise<void> {
  const repo = repositorio();
  const plantilla = (await repo.listarCiclos(arreglo.clienteId)).find(
    (c) => c.ciclo === arreglo.cicloActualAntes,
  );
  if (!plantilla) return;

  const existentes = new Map((await repo.listarCiclos(arreglo.clienteId)).map((c) => [c.ciclo, c]));

  for (const parte of arreglo.ciclosAfectados) {
    const anterior = existentes.get(parte.ciclo);
    const ficha: Ciclo = anterior
      ? { ...anterior, fechaInicio: parte.desde, fechaFin: parte.hasta }
      : { ...plantilla, ciclo: parte.ciclo, fechaInicio: parte.desde, fechaFin: parte.hasta };
    await repo.guardarCiclo(ficha);
  }
}

/**
 * Comprobación de coherencia, para poder vigilarlo sin esperar a que alguien
 * lo note en pantalla. Devuelve una frase por cada problema encontrado.
 */
export async function comprobarCoherencia(): Promise<string[]> {
  const repo = repositorio();
  const problemas: string[] = [];

  for (const cliente of await repo.listarClientes()) {
    const todas = await repo.listarSesiones(cliente.id);
    const delCiclo = porFecha(todas.filter((s) => s.ciclo === cliente.cicloActual));
    if (delCiclo.length === 0) continue;

    const numeros = delCiclo.map((s) => s.numeroSesion);
    const hayHuecos = numeros.some((n, i) => i > 0 && n !== numeros[i - 1] + 1);
    if (hayHuecos) {
      problemas.push(`'${cliente.nombre}': su historial tiene huecos en la numeración (${numeros.join(", ")}).`);
    }

    if (cliente.sesionesCompletadas !== delCiclo.length) {
      problemas.push(
        `'${cliente.nombre}': el marcador dice ${cliente.sesionesCompletadas} pero su historial tiene ` +
          `${delCiclo.length} ${delCiclo.length === 1 ? "sesión" : "sesiones"}.`,
      );
    }

    const ciclo = await repo.cicloActual(cliente.id);
    const tope = ciclo?.sesionesTotales ?? 0;
    if (tope > 0 && delCiclo.length > tope) {
      problemas.push(
        `'${cliente.nombre}': tiene ${delCiclo.length} sesiones en un bono de ${tope} — le faltó una renovación.`,
      );
    }
  }

  return problemas;
}
