/**
 * Los mismos filtros que usan las plantillas de Flask (`webapp/app.py`), para
 * que los textos salgan escritos igual.
 */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** `|euros` — 45 → «45,00 €». */
export function euros(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(valor);
}

/**
 * `"%.2f"|format(x) €` — 1234.5 → «1234.50 €».
 *
 * La pantalla de Economía no usa el filtro `|euros`, escribe el número en
 * crudo. Se copia tal cual para que las cifras salgan idénticas.
 */
export function eurosPlano(valor: number | null | undefined): string {
  return `${(valor ?? 0).toFixed(2)} €`;
}

/** `|mes_es` — 8 → «Agosto», con mayúscula como en la plantilla. */
export function mesEs(mes: number | null | undefined): string {
  if (!mes) return "";
  const nombre = MESES[mes - 1] ?? "";
  return nombre ? nombre[0]!.toUpperCase() + nombre.slice(1) : "";
}

export function mesMinuscula(mes: number | null | undefined): string {
  return mes ? (MESES[mes - 1] ?? "") : "";
}

/** `|fecha_es` — 2026-08-03 → «03/08/2026», que es como se lee en España. */
export function fechaEs(fechaIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) return fechaIso;
  const [a, m, d] = fechaIso.split("-");
  return `${d}/${m}/${a}`;
}
