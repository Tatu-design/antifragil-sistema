/* Señal de "está cargando" para Antifrágil.
 *
 * Por qué existe: cada pantalla tarda ~0,5-0,7 s en responder (el suelo del
 * plan de alojamiento, no del código). Sin ninguna señal, ese rato se
 * percibe como que la app se ha quedado colgada.
 *
 * Cómo funciona: al pulsar un enlace o enviar un formulario, el navegador
 * sigue mostrando ESTA página hasta que llega la siguiente. Ese es
 * justamente el hueco que hay que rellenar. La página nueva llega limpia,
 * así que no hace falta apagar nada.
 *
 * Tres señales a la vez, porque una sola no se veía (2026-08-01):
 *   1. Barra de progreso arriba, que aparece de golpe (sin desvanecido) y
 *      lleva un brillo recorriéndola.
 *   2. Un girador sobre el elemento que has tocado — es donde estás
 *      mirando, así que es la señal que antes se percibe.
 *   3. La página deja de aceptar toques, para que un segundo golpe
 *      impaciente no dispare otra cosa.
 *
 * Rendimiento: todo se anima con `transform`, que resuelve la tarjeta
 * gráfica sin repintar. Es deliberado — este proyecto acaba de quitar los
 * efectos que costaban trabajo en cada fotograma (ver style.css).
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

  function arrancar(origen) {
    if (origen && origen.classList) origen.classList.add("cargando-origen");
    if (reloj) return; // ya está en marcha

    document.documentElement.classList.add("esperando");
    crearBarra();
    // Salto inicial grande y visible: con esperas de medio segundo, empezar
    // en el 8% hacía que la barra no llegara a leerse.
    avance = 0.35;
    pintar();

    // Sigue avanzando, cada vez más despacio, sin llegar nunca al final: el
    // 100% lo marca la llegada de la página, no un temporizador que se lo
    // inventaría (una barra que se completa y te deja esperando, miente).
    reloj = setInterval(function () {
      avance += (0.92 - avance) * 0.18;
      pintar();
    }, 90);
  }

  function parar() {
    if (reloj) {
      clearInterval(reloj);
      reloj = null;
    }
    avance = 0;
    document.documentElement.classList.remove("esperando");
    var marcado = document.querySelector(".cargando-origen");
    if (marcado) marcado.classList.remove("cargando-origen");
    if (barra) barra.style.transform = "scaleX(0)";
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
    if (enlace && esNavegacionNormal(evento, enlace)) arrancar(enlace);
  });

  document.addEventListener("submit", function (evento) {
    if (evento.defaultPrevented) return;
    var formulario = evento.target;
    var boton = formulario.querySelector("button[type=submit], button:not([type])");
    arrancar(boton || formulario);
  });

  // Al volver con el botón "atrás", el navegador puede restaurar esta misma
  // página tal cual la dejamos, a medio cargar. Se limpia.
  window.addEventListener("pageshow", parar);
  window.addEventListener("pagehide", parar);
})();
