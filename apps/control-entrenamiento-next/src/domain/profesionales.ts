/**
 * Las reglas de dar de alta y de baja a un profesional.
 *
 * Aquí no hay base de datos ni pantallas: solo lo que se puede y lo que no,
 * para poder comprobarlo sin montar nada.
 */

/** Lo mínimo para que alguien pueda entrar: un nombre y un correo. */
export interface DatosDeAlta {
  nombre: string;
  correo: string;
}

export interface Problema {
  campo: "nombre" | "correo";
  mensaje: string;
}

/**
 * Un correo válido, en minúsculas.
 *
 * Se guarda SIEMPRE en minúsculas, como hace Supabase. Guardarlo tal y como se
 * escriba deja la cuenta inaccesible: la aplicación busca en minúsculas y una
 * mayúscula de más la dejaba fuera para siempre (2026-08-10).
 */
export function normalizarCorreo(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Qué está mal, en el idioma de quien lo rellena. Vacío = se puede crear. */
export function revisarAlta(datos: DatosDeAlta): Problema[] {
  const problemas: Problema[] = [];
  const nombre = datos.nombre.trim();
  const correo = normalizarCorreo(datos.correo);

  if (nombre.length < 2) {
    problemas.push({ campo: "nombre", mensaje: "Escribe el nombre del profesional" });
  }
  // Deliberadamente flexible: lo que importa es que no se cuele un hueco o un
  // nombre suelto sin arroba. Validar correos a fondo con una expresión
  // rechaza direcciones legítimas y no evita ni un error real.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    problemas.push({ campo: "correo", mensaje: "Ese correo no parece válido" });
  }

  return problemas;
}

/**
 * Si se puede dar de baja a alguien, y si no, por qué.
 *
 * **Nunca se reasignan sus clientes solos** (regla de Fernando, 2026-08-30).
 * Un cliente activo sin nadie detrás es un cliente al que nadie le firma las
 * sesiones y del que nadie se entera cuando le queda una: el error se
 * descubriría semanas después. Primero se le busca responsable, después se da
 * de baja al profesional.
 */
export function puedeDesactivarse(
  profesional: { rol: "admin" | "entrenador"; nombre: string },
  clientesActivos: number,
): { puede: boolean; porQue?: string } {
  if (profesional.rol === "admin") {
    return {
      puede: false,
      porQue: "El administrador no puede darse de baja a sí mismo. Sin él nadie podría gestionar la aplicación.",
    };
  }
  if (clientesActivos > 0) {
    const cuantos =
      clientesActivos === 1 ? "1 cliente activo" : `${clientesActivos} clientes activos`;
    return {
      puede: false,
      porQue:
        `«${profesional.nombre}» todavía lleva ${cuantos}. Pásaselos antes a otro profesional: ` +
        "si se queda de baja con clientes a su nombre, nadie les firma las sesiones ni recibe sus avisos.",
    };
  }
  return { puede: true };
}

/**
 * Una contraseña temporal que se pueda dictar por teléfono sin equivocarse.
 *
 * Fuera las letras y los números que se confunden al leerlos en voz alta o en
 * una pantalla pequeña: la O y el 0, la l y el 1, la I. Con 28 caracteres a
 * elegir y 12 de largo hay de sobra para lo que es: una clave de un solo uso
 * que el profesional cambia en cuanto entra.
 *
 * **No se guarda en ningún sitio en claro.** Se enseña una vez al
 * administrador y a la base solo llega ya cifrada por ella misma.
 */
const LETRAS = "abcdefghjkmnpqrstuvwxyz23456789";

export function claveTemporal(azar: (n: number) => number[] = porDefecto): string {
  const bytes = azar(12);
  return Array.from(bytes, (b) => LETRAS[b % LETRAS.length]).join("");
}

function porDefecto(n: number): number[] {
  // `crypto` del entorno, que es el que sirve para esto. `Math.random` no.
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes);
}
