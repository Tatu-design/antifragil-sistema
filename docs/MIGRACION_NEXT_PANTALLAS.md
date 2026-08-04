# Equivalencia visual y operativa con la app Flask

> Fase de clonado, 2026-08-04. La fuente de verdad de esta fase **no es la
> versión Next anterior**: son las plantillas de `webapp/templates/`, la hoja
> `webapp/static/style.css` y las rutas de `webapp/app.py`.

## Principio

Si una pantalla de Flask funciona bien, no se reinterpreta: se copia. Mismas
clases CSS, mismo orden de la información, mismos textos, mismos estados y las
mismas confirmaciones.

## La hoja de estilos es la misma, no una parecida

`webapp/static/style.css` está copiada literalmente a
`apps/control-entrenamiento-next/public/style.css`. Solo cambian las rutas de
las fuentes (`/fonts/…`) y se añade al final un bloque `.boton-texto`, marcado
como añadido de Next (lo usa la puerta de pruebas del login, que en Flask no
existe). Tailwind se ha retirado del proyecto: no queda ni configuración ni
clases utilitarias.

Se enlaza a mano desde `layout.tsx` a propósito. Pasarla por el empaquetador la
reescribiría, y entonces ya no sería la misma hoja.

## Pantalla por pantalla

| # | Pantalla | Plantilla Flask | Archivo Next |
|---|----------|-----------------|--------------|
| 1 | Login | `login.html` | `app/login/page.tsx` + `components/FormularioLogin.tsx` |
| 2 | Lista de clientes | `index.html` | `app/clientes/page.tsx` + `components/ListaClientes.tsx` |
| 3 | Ficha del cliente | `perfil_cliente.html` | `app/clientes/[id]/page.tsx` + `PerfilHero`, `AccionesPerfil`, `HistorialProgramas` |
| 4 | Firmar sesión | `perfil_cliente.html` (bloque `.accion-principal`) | `accionFirmar` + `BotonFirmar` |
| 5 | Nuevo cliente | `nuevo.html` + `confirmar_nuevo.html` | `app/clientes/nuevo/page.tsx` + `components/FormularioAlta.tsx` |
| 6 | Editar datos | `editar_datos.html` + `confirmar.html` | `app/clientes/[id]/datos/page.tsx` + `components/FormularioDatos.tsx` |
| 6b | Editar programa | `editar.html` + `confirmar_servicio.html` | `app/clientes/[id]/programa/page.tsx` + `FormularioServicio`, `CamposServicio` |
| 7 | Historial y corrección de sesiones | `perfil_cliente.html` (`.lista.historial`) y `editar_historial.html` | `HistorialProgramas` + `app/clientes/[id]/sesion/[sesionId]/page.tsx` |
| 8 | Economía | `economia.html` | `app/economia/page.tsx` + `Metricas`, `BotonesClase` |
| 9 | Avisos | `avisos.html` | `app/avisos/page.tsx` |
| 10 | Enlace público del cliente | `mi_perfil.html` | `app/mi/[token]/page.tsx` |
| — | Borrar cliente | `eliminar_cliente.html` | `app/clientes/[id]/eliminar/page.tsx` |

Los iconos son los mismos 16 SVG de `_iconos.html`, incrustados en
`components/Iconos.tsx`. Se incrustan, y no se enlazan desde un archivo, por la
misma razón que en Flask: los navegadores de móvil no dibujan referencias SVG
externas.

## Flujos igualados

- **Todo lo que escribe termina en una redirección con el mensaje en la
  dirección**, igual que Flask. Así la pantalla se pinta ya actualizada y
  recargar no repite la operación.
- **Firmar** apaga el botón y lo cambia a «Guardando…» nada más pulsarlo, y
  lleva una clave de un solo uso por carga contra el doble envío.
- **El QR solo aparece justo después de firmar** y mientras esa sesión siga sin
  confirmar. El resto de las veces, si el cliente ya confirmó hoy, sale la línea
  «✓ Confirmada hoy a las …». No hay ningún botón para abrirlo a voluntad:
  confirmar pasa delante de Fernando (decisión del 2026-07-29).
- **Deshacer una clase de CrossFit y borrar una sesión preguntan antes.**
- **Cambiar el estado de cobro pregunta antes** y no toca sesiones, horas,
  historial ni economía.
- **Cambiar de modalidad** enseña «antes → después» con los números concretos
  del cliente antes de guardar.
- **El enlace público es de solo lectura.** El cliente no crea sesiones nunca;
  `/mi/<token>/confirmar` solo se alcanza escaneando el QR.

## Diferencias que quedan, y por qué

1. **El login pide correo además de contraseña**, y su subtítulo dice «Introduce
   tus datos para continuar» en vez de «Introduce tu contraseña para
   continuar». La contraseña compartida dejó de ser el acceso: ahora hay cuentas
   de verdad, una por persona. Con dos campos, el texto de Flask sería falso.
2. **Los pasos de confirmación ocurren sin cambiar de página.** Flask navega a
   `confirmar_nuevo.html`, `confirmar.html` y `confirmar_servicio.html`; aquí el
   mismo contenido, con los mismos textos y la misma comparativa, se pinta en el
   sitio. Los datos ya están en el navegador, así que no hay que reenviarlos
   escondidos en campos ocultos.
3. **El alta describe las condiciones del servicio** (modalidad, sesiones,
   precio…) en vez de elegir un programa de un catálogo. La tabla `programas` de
   SQLite no se ha traído: en el modelo nuevo las condiciones viven en el ciclo,
   que es lo que hace que las tarifas históricas no se puedan reescribir.
4. **Las cifras de Economía se escriben como en Flask** (`1234.56 €`, con punto
   decimal), porque esa pantalla no usa el filtro `|euros`. El resto de la app
   sí lo usa y escribe `1.234,56 €`. Es una incoherencia heredada de Flask que
   se ha copiado a propósito para no cambiar lo que Fernando ve.
5. **No hay pantalla para introducir la facturación de CrossFit Kids**, igual
   que en Flask.
6. **Peso de la primera visita**: Flask descarga 106,7 KB y ningún framework;
   Next añade ~103 KB de JavaScript compartido. Es el coste propio de React y
   estaba asumido al elegir el destino de la migración; la hoja de estilos, las
   fuentes y las imágenes son exactamente las mismas.

## Cómo se comprueba

`npm run test`, `npm run type-check`, `npm run lint` y `npm run build`, más un
recorrido por HTTP real de las diez pantallas que comprueba que salen con las
mismas clases y los mismos textos que las plantillas de Flask.
