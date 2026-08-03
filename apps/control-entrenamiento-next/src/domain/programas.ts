/**
 * Descuento y renovación de bonos. Port de `programas/logica.py` y de la parte
 * de `programas/procesar.py` que decide qué número de sesión toca.
 *
 * Regla confirmada por Fernando: al agotarse un bono se inicia otro
 * automáticamente, con las mismas condiciones, y **el nuevo nace pendiente de
 * pago**. Las sesiones «de más» ya cuentan contra el bono nuevo.
 */

export interface ActualizacionPrograma {
  sesionesRestantes: number;
  renovado: boolean;
  pendientePago: boolean;
  avisoUltimaSesion: boolean;
}

export function actualizarPrograma(
  sesionesRestantes: number,
  sesionesTotales: number,
  sesionesConsumidas: number,
  pendientePago: boolean,
): ActualizacionPrograma {
  let restantes = sesionesRestantes - sesionesConsumidas;
  let renovado = false;
  let debe = pendientePago;

  // `while` y no `if`: si alguien firma más sesiones que un bono entero, se
  // renueva tantas veces como haga falta hasta que quede un resto positivo.
  while (restantes <= 0) {
    if (sesionesTotales <= 0) {
      // Sin tope no se renueva por consumo. No debería llegarse aquí (una
      // cuenta no pasa por esta función), pero un bucle infinito sería peor
      // que un error.
      break;
    }
    restantes += sesionesTotales;
    renovado = true;
    debe = true;
  }

  return {
    sesionesRestantes: restantes,
    renovado,
    pendientePago: debe,
    avisoUltimaSesion: restantes === 1,
  };
}

/**
 * Descuenta UNA sesión y dice qué número le corresponde.
 *
 * Si esta sesión agota el bono, es la ÚLTIMA de ese bono (`sesionesTotales`),
 * no la primera del que empieza justo después.
 */
export function procesarUnaSesion(programa: {
  sesionesRestantes: number;
  sesionesTotales: number;
  pendientePago: boolean;
}): { paso: ActualizacionPrograma; numeroSesion: number } {
  const paso = actualizarPrograma(
    programa.sesionesRestantes,
    programa.sesionesTotales,
    1,
    programa.pendientePago,
  );
  const numeroSesion = paso.renovado
    ? programa.sesionesTotales
    : programa.sesionesTotales - paso.sesionesRestantes;
  return { paso, numeroSesion };
}
