/* Señal de "está cargando" para Antifrágil.
 *
 * Por qué existe: cada pantalla tarda ~0,5-0,7 s en responder (el suelo del
 * plan de alojamiento, no del código). Sin ninguna señal, ese rato se
 * percibe como que la app se ha quedado colgada.
 *
 * Cómo funciona: al pulsar un enlace o enviar un formulario, el navegador
 * sigue mostrando ESTA página hasta que llega la siguiente. Ese hueco es el
 * que se rellena. La página nueva llega limpia, así que no hay que apagar
 * nada.
 *
 * Historia (2026-08-01), para no repetir los errores:
 *   - Primer intento: barra de 3px con desvanecido de entrada de 0,2s y
 *     avance desde el 8%. Con esperas de 0,6s no daba tiempo a verla.
 *   - Segundo intento: barra gorda + girador sobre lo pulsado + bloqueo de
 *     la pantalla. Demasiado ruidoso, y encima solo se veía en una
 *     navegación concreta: el fundido entre pantallas
 *     (`@view-transition`) congelaba la página vieja nada más pulsar, así
 *     que la animación se helaba justo al empezar. Ese fundido se retiró.
 *   - Ahora: una sola señal, discreta y siempre igual se toque lo que se
 *     toque.
 *
 * Rendimiento: se anima con `transform`, que resuelve la tarjeta gráfica
 * sin repintar. Deliberado: este proyecto acaba de quitar los efectos que
 * costaban trabajo en cada fotograma (ver style.css).
 */

(function () {
  "use strict";

  var barra = null;
  var salvavidas = null;

  function encender() {
    if (!barra) {
      barra = document.createElement("div");
      barra.className = "cargando";
      barra.setAttribute("role", "progressbar");
      barra.setAttribute("aria-label", "Cargando");
      (document.body || document.documentElement).appendChild(barra);
    }
    barra.classList.add("activa");

    // Si por lo que sea la navegación no llega a ocurrir (se cae la red, el
    // servidor no contesta), la señal se apaga sola en vez de quedarse
    // encendida para siempre dando la sensación de colgado.
    clearTimeout(salvavidas);
    salvavidas = setTimeout(apagar, 15000);
  }

  function apagar() {
    clearTimeout(salvavidas);
    if (barra) barra.classList.remove("activa");
  }

  /* La señal se enciende en cuanto tocas, ANTES de saber si la acción va a
     seguir adelante. Algunos formularios preguntan "¿seguro?" y, si dices
     que no, no se navega a ningún sitio: sin esto la barra se quedaba
     encendida indefinidamente. Se comprueba justo después, cuando ya se
     sabe si el evento fue cancelado. */
  function apagarSiSeCancelo(evento) {
    setTimeout(function () {
      if (evento.defaultPrevented) apagar();
    }, 0);
  }

  /* Sube por el árbol hasta encontrar el enlace. No se usa `closest` a
     secas porque al tocar un icono el elemento pulsado es un <svg>, y en
     algunos navegadores móviles ahí `closest` no se comporta igual. */
  function enlaceDe(elemento) {
    while (elemento && elemento !== document.documentElement) {
      if (elemento.tagName && elemento.tagName.toLowerCase() === "a") return elemento;
      elemento = elemento.parentNode;
    }
    return null;
  }

  function navegaDeVerdad(evento, enlace) {
    var destino = enlace.getAttribute("href");
    return (
      !evento.defaultPrevented &&
      !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey &&
      (evento.button === undefined || evento.button === 0) &&
      enlace.target !== "_blank" &&
      !enlace.hasAttribute("download") &&
      destino &&
      destino.charAt(0) !== "#" &&
      destino.indexOf("javascript:") !== 0 &&
      enlace.hostname === window.location.hostname
    );
  }

  // En fase de captura: así se enciende aunque algo más adelante en la
  // página decida detener el evento.
  document.addEventListener("click", function (evento) {
    var enlace = enlaceDe(evento.target);
    if (enlace && navegaDeVerdad(evento, enlace)) {
      encender();
      apagarSiSeCancelo(evento);
    }
  }, true);

  document.addEventListener("submit", function (evento) {
    if (evento.defaultPrevented) return;
    encender();
    apagarSiSeCancelo(evento);
  }, true);

  // Al volver con el botón "atrás" el navegador puede restaurar esta misma
  // página tal cual la dejamos, con la señal encendida. Se apaga.
  window.addEventListener("pageshow", apagar);
  window.addEventListener("pagehide", apagar);
})();
