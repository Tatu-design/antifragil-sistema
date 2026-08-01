/* Señal de "está cargando" para Antifrágil.
 *
 * Por qué existe: cada pantalla tarda ~0,5-0,7 s en responder (el suelo del
 * plan de alojamiento, no del código). Sin ninguna señal, ese rato se
 * percibe como que la app se ha quedado colgada. Con una barra que avanza,
 * se percibe como que está trabajando — la espera es la misma, la
 * sensación no.
 *
 * Cómo funciona: al pulsar un enlace o enviar un formulario, el navegador
 * sigue mostrando ESTA página hasta que llega la siguiente. Ese es
 * justamente el hueco que rellena la barra. La página nueva llega limpia,
 * sin barra, así que no hace falta ocultarla.
 *
 * Rendimiento: la barra se anima con `transform: scaleX()`, que la tarjeta
 * gráfica resuelve sin repintar nada. Es deliberado — este proyecto acaba
 * de quitar los efectos que iban por fotograma (ver style.css).
 */

(function () {
  "use strict";

  var barra;
  var avance = 0;
  var reloj = null;

  function crearBarra() {
    if (barra) return barra;
    barra = document.createElement("div");
    barra.className = "cargando";
    barra.setAttribute("role", "progressbar");
    barra.setAttribute("aria-label", "Cargando");
    document.body.appendChild(barra);
    return barra;
  }

  function pintar() {
    crearBarra().style.transform = "scaleX(" + avance + ")";
  }

  function arrancar() {
    if (reloj) return; // ya está en marcha
    crearBarra().classList.add("activa");
    avance = 0.08;
    pintar();

    // Avanza rápido al principio y cada vez más despacio, sin llegar nunca
    // al final: el 100% lo marca la llegada de la página nueva, no un
    // temporizador que se inventaría el momento.
    reloj = setInterval(function () {
      avance += (0.9 - avance) * 0.12;
      pintar();
    }, 120);
  }

  function parar() {
    if (!reloj) return;
    clearInterval(reloj);
    reloj = null;
    avance = 0;
    if (barra) {
      barra.classList.remove("activa");
      barra.style.transform = "scaleX(0)";
    }
  }

  function esNavegacionNormal(evento, enlace) {
    return (
      !evento.defaultPrevented &&
      evento.button === 0 &&
      !evento.metaKey && !evento.ctrlKey && !evento.shiftKey && !evento.altKey &&
      enlace.target !== "_blank" &&
      enlace.origin === window.location.origin &&
      !enlace.hasAttribute("download") &&
      // Un ancla dentro de la misma página no carga nada.
      enlace.getAttribute("href") &&
      enlace.getAttribute("href").charAt(0) !== "#"
    );
  }

  document.addEventListener("click", function (evento) {
    var enlace = evento.target.closest ? evento.target.closest("a[href]") : null;
    if (enlace && esNavegacionNormal(evento, enlace)) arrancar();
  });

  document.addEventListener("submit", function (evento) {
    if (!evento.defaultPrevented) arrancar();
  });

  // Al volver con el botón "atrás", el navegador puede restaurar esta misma
  // página tal cual la dejamos, con la barra a medias. Se limpia.
  window.addEventListener("pageshow", parar);
  window.addEventListener("pagehide", parar);
})();
