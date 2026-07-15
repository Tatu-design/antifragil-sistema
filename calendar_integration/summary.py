"""Agrupa las sesiones clasificadas de una semana en un resumen por cliente/tipo."""

from collections import Counter

from calendar_integration.parser import SesionDetectada, clasificar_evento


def resumir_semana(eventos: list[dict]) -> dict:
    """A partir de eventos crudos de Google Calendar, devuelve:

    - sesiones_pt: Counter {nombre_cliente: nº sesiones}
    - crossfit_lidomare: nº de clases
    - crossfit_kids: nº de clases
    - no_reconocidos: lista de títulos que no encajan en ningún tipo conocido
      (para que Fernando pueda revisarlos y ajustar el formato de sus eventos)
    """
    sesiones_pt: Counter = Counter()
    crossfit_lidomare = 0
    crossfit_kids = 0
    no_reconocidos: list[str] = []

    for evento in eventos:
        titulo = evento.get("summary", "")
        sesion = clasificar_evento(titulo)

        if sesion is None:
            no_reconocidos.append(titulo)
            continue

        if sesion.tipo == "pt":
            sesiones_pt[sesion.cliente] += 1
        elif sesion.tipo == "crossfit_lidomare":
            crossfit_lidomare += 1
        elif sesion.tipo == "crossfit_kids":
            crossfit_kids += 1

    return {
        "sesiones_pt": sesiones_pt,
        "crossfit_lidomare": crossfit_lidomare,
        "crossfit_kids": crossfit_kids,
        "no_reconocidos": no_reconocidos,
    }
