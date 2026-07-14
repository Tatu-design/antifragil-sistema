"""Punto de entrada de la aplicación.

Paso 1 del sistema: seleccionar una semana y ver un resumen de las sesiones
detectadas en Google Calendar. Solo lectura, no escribe en ningún sitio.
"""

from datetime import datetime

import streamlit as st

from calendar_integration.auth import get_calendar_service
from calendar_integration.client import get_events_for_week, get_week_range
from calendar_integration.config import cargar_calendar_id, guardar_calendar_id
from calendar_integration.summary import resumir_semana

st.set_page_config(page_title="Antifrágil — Resumen semanal", page_icon="🏋️")
st.title("Resumen semanal de entrenamientos")

calendar_id = st.text_input(
    "ID de tu calendario (normalmente tu email de Google)",
    value=cargar_calendar_id(),
    help="Lo encuentras en Google Calendar → Configuración → tu calendario → 'Integrar calendario' → 'ID de calendario'.",
)

dia = st.date_input("Elige cualquier día de la semana que quieras revisar", value=datetime.now().date())

if st.button("Cargar semana"):
    if not calendar_id:
        st.error("Falta el ID de tu calendario.")
        st.stop()
    guardar_calendar_id(calendar_id)

    try:
        service = get_calendar_service()
    except FileNotFoundError as error:
        st.error(str(error))
        st.stop()

    inicio, fin = get_week_range(datetime.combine(dia, datetime.min.time()))
    st.caption(f"Semana del {inicio.date()} al {fin.date()}")

    eventos = get_events_for_week(service, datetime.combine(dia, datetime.min.time()), calendar_id)
    resumen = resumir_semana(eventos)

    st.subheader("Entrenamiento personal")
    if resumen["sesiones_pt"]:
        st.table(
            {
                "Cliente": list(resumen["sesiones_pt"].keys()),
                "Sesiones esta semana": list(resumen["sesiones_pt"].values()),
            }
        )
    else:
        st.write("No se detectaron sesiones de PT esta semana.")

    st.subheader("CrossFit")
    st.write(f"CrossFit Lidomare: {resumen['crossfit_lidomare']} clases")
    st.write(f"CrossFit Kids: {resumen['crossfit_kids']} clases")

    if resumen["no_reconocidos"]:
        st.subheader("Eventos no reconocidos")
        st.caption("Revisa si estos títulos deberían contar como una sesión. Si el formato no coincide, lo ajustamos.")
        for titulo in resumen["no_reconocidos"]:
            st.write(f"- {titulo}")
