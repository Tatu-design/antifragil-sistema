/**
 * Abrir el mes nuevo a quien va por meses.
 *
 * POR QUÉ EXISTE (2026-09-02)
 *
 * El sistema decía desde el principio que una mensualidad o una cuenta de
 * cliente se cierran al cambiar de mes. Lo decía `domain/modalidades.ts` y no
 * lo hacía nadie: el ciclo del mes nuevo solo aparecía si alguien entraba a
 * configurar el servicio a mano. El 1 de septiembre no lo hizo nadie y los
 * clientes se quedaron en agosto.
 *
 * CÓMO ESTÁ PENSADO
 *
 * - **Se puede ejecutar todos los días.** Si ya está hecho, no hace nada. Por
 *   eso puede correr a diario en vez de solo el día 1: si el día 1 falla, el 2
 *   se recupera solo.
 * - **Cada cliente va en su propia transacción.** Si uno falla, se deshace
 *   entero y los demás siguen. Un dato raro en un cliente no puede dejar a los
 *   otros sin su mes.
 * - **No inventa meses pasados.** Si alguien lleva más de un mes parado, no se
 *   le crean las cuotas de los meses de en medio: se marca para que lo mire
 *   una persona. Escribir historia económica que nadie ha visto es justo lo
 *   que no se hace en esta aplicación.
 * - **Nunca toca lo que ya está.** Las sesiones de agosto siguen siendo de
 *   agosto y del ciclo de agosto: aquí solo se abre uno nuevo.
 */

import { decidir, llevaCuota, ultimoDiaDelMes, type Decision } from "@/domain/renovacion";
import { MENSUALIDAD } from "@/domain/modalidades";
import type { Ciclo } from "@/domain/tipos";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";

export interface CasoDeRenovacion {
  /** El identificador interno. **Nunca el nombre**: esto acaba en registros. */
  clienteId: string;
  modalidad: string;
  cicloActual: number;
  desde: string;
  hasta: string;
  cicloNuevo: number;
  /** La cuota que se crearía. `null` en una cuenta de cliente. */
  cuota: number | null;
}

export interface Resumen {
  /** `AAAA-MM` al que se está llevando a todo el mundo. */
  mes: string;
  renovados: CasoDeRenovacion[];
  /** Ya estaban en el mes en curso: no había nada que hacer. */
  alDia: number;
  /** No les toca: bonos, pausados, cancelados. */
  omitidos: number;
  /** Necesitan que alguien los mire: desfase de más de un mes, datos raros. */
  aRevisar: Array<{ clienteId: string; porque: string; mesesDeDesfase: number }>;
  errores: Array<{ clienteId: string; error: string }>;
  /** `true` si solo se ha mirado, sin escribir nada. */
  simulado: boolean;
}

/**
 * Lleva al mes en curso a todo el que vaya por meses.
 *
 * Con `soloMirar` no escribe nada y devuelve lo que haría. Es lo que se usa
 * para enseñar la vista previa antes de tocar datos de verdad.
 */
export async function renovarMeses({ soloMirar = false } = {}): Promise<Resumen> {
  const repo = repositorio();
  const hoy = hoyNegocio();
  const ahora = { anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) };

  const resumen: Resumen = {
    mes: `${ahora.anio}-${String(ahora.mes).padStart(2, "0")}`,
    renovados: [],
    alDia: 0,
    omitidos: 0,
    aRevisar: [],
    errores: [],
    simulado: soloMirar,
  };

  const clientes = await repo.listarClientes();

  for (const cliente of clientes) {
    try {
      const ciclos = await repo.listarCiclos(cliente.id);
      const actual = ciclos.find((c) => c.ciclo === cliente.cicloActual);
      if (!actual) {
        resumen.errores.push({ clienteId: cliente.id, error: "no se encuentra su servicio en curso" });
        continue;
      }

      const decision: Decision = decidir(
        { estado: cliente.estado, modalidad: actual.modalidad, anio: actual.anio, mes: actual.mes },
        ahora,
      );

      if (decision.que === "nada") {
        if (decision.porque === "ya está en el mes en curso") resumen.alDia += 1;
        else resumen.omitidos += 1;
        continue;
      }

      if (decision.que === "revisar") {
        resumen.aRevisar.push({
          clienteId: cliente.id,
          porque: decision.porque,
          mesesDeDesfase: decision.mesesDeDesfase,
        });
        continue;
      }

      const caso: CasoDeRenovacion = {
        clienteId: cliente.id,
        modalidad: actual.modalidad,
        cicloActual: actual.ciclo,
        desde: `${actual.anio}-${String(actual.mes).padStart(2, "0")}`,
        hasta: `${decision.anio}-${String(decision.mes).padStart(2, "0")}`,
        cicloNuevo: actual.ciclo + 1,
        cuota: llevaCuota(actual.modalidad) ? actual.cuotaMensual : null,
      };

      if (soloMirar) {
        resumen.renovados.push(caso);
        continue;
      }

      // CADA CLIENTE, SU TRANSACCIÓN. Si algo falla aquí dentro, este cliente
      // se queda exactamente como estaba y los demás siguen su camino.
      await repo.transaccion(async () => {
        // Se vuelve a mirar DENTRO de la transacción: si otra ejecución se ha
        // adelantado mientras tanto, aquí se ve y no se hace nada. Y si las
        // dos llegasen a la vez, la segunda choca contra la clave del ciclo y
        // se deshace sola.
        const alDia = (await repo.listarCiclos(cliente.id)).some(
          (c) => c.anio === decision.anio && c.mes === decision.mes,
        );
        if (alDia) return;

        // El que se cierra: se le pone fin, y **no se le toca nada más**. Sus
        // sesiones siguen siendo suyas.
        //
        // El fin es el último día de SU mes, no el día en que se ejecuta esto.
        // Una mensualidad es un mes natural: agosto se cierra el 31 de agosto,
        // aunque la tarea corra el 2 de septiembre (2026-09-03).
        await repo.guardarCiclo({
          ...actual,
          fechaFin: actual.fechaFin ?? ultimoDiaDelMes(actual.anio!, actual.mes!),
        });

        const nuevo: Ciclo = {
          ...actual,
          ciclo: actual.ciclo + 1,
          anio: decision.anio,
          mes: decision.mes,
          fechaInicio: null,
          fechaFin: null,
          // Todo servicio nuevo nace pendiente de pago, como en el alta.
          pagado: false,
        };
        await repo.guardarCiclo(nuevo);

        // El contador visible vuelve a cero: es el del periodo EN CURSO.
        await repo.actualizarCliente({
          ...cliente,
          cicloActual: nuevo.ciclo,
          sesionesCompletadas: 0,
          pendientePago: true,
        });

        // Solo la mensualidad lleva cuota fija. En una cuenta de cliente el
        // dinero sale de las sesiones que se firmen, así que no hay nada que
        // cobrar por adelantado.
        if (actual.modalidad === MENSUALIDAD && actual.cuotaMensual) {
          await repo.guardarCargo({
            clienteId: cliente.id,
            anio: decision.anio,
            mes: decision.mes,
            concepto: "mensualidad",
            ciclo: nuevo.ciclo,
            importe: actual.cuotaMensual,
            pagado: false,
            profesionalId: cliente.profesionalId ?? null,
          });
        }
      });

      resumen.renovados.push(caso);
    } catch (error) {
      // Un cliente que falla no puede dejar a los demás sin su mes.
      resumen.errores.push({
        clienteId: cliente.id,
        error: error instanceof Error ? error.message : "error desconocido",
      });
    }
  }

  return resumen;
}
