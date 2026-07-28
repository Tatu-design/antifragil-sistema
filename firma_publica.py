"""Firma pública de sesión de PT desde el enlace personal del cliente
(`/mi/<token>`) — decisión de Fernando, 2026-07-28: el propio cliente puede
confirmar que ha hecho su sesión de hoy, sin esperar a que lo haga Fernando
desde su perfil.

Reutiliza `registrar_sesion_pt` tal cual, sin tocar `registrar_asistencia.py`
ni el flujo de Fernando (que sigue pudiendo firmar varias veces al día si
hace falta). Esta capa solo añade lo específico del autoservicio:

- Como mucho una firma por día desde el enlace público (a diferencia de
  Fernando, que no tiene ese límite) — al ser autoservicio sin supervisión
  directa.
- Un recibo con fecha y hora (tabla `firmas_publicas`, aparte de
  `historial_sesiones`) que el cliente puede comprobar cada vez que vuelve
  a entrar a su enlace, como prueba de que quedó guardada.
- Un aviso para Fernando, para que vea pasar estas firmas y pueda detectar
  si algo no cuadra — la capa de supervisión que compensa que esta
  escritura ya no la hace él directamente."""

from pathlib import Path

from avisos import registrar_aviso
from basedatos import RUTA_POR_DEFECTO, conectar
from registrar_asistencia import registrar_sesion_pt
from zona_horaria import ahora_negocio, hoy_negocio


def firma_de_hoy(cliente: str, ruta: Path = RUTA_POR_DEFECTO) -> dict | None:
    """La firma que el propio cliente ha hecho hoy desde su enlace público,
    si la hay (fecha + hora) — para mostrar el recibo y para saber si el
    botón de firmar debe seguir visible."""
    with conectar(ruta) as conexion:
        fila = conexion.execute(
            "SELECT fecha, hora FROM firmas_publicas WHERE cliente = ? AND fecha = ? ORDER BY id DESC LIMIT 1",
            (cliente, hoy_negocio().isoformat()),
        ).fetchone()
    return dict(fila) if fila else None


def firmar_sesion_publica(cliente: str, clave_idempotencia: str | None, ruta: Path = RUTA_POR_DEFECTO) -> dict:
    """Confirma la sesión de PT de HOY para el propio cliente, desde su
    enlace público. Lanza `ValueError` si ya había firmado hoy desde aquí —
    la ruta que llama a esto debe volver a mostrar `/mi/<token>`, que ya
    sabe pintar ese estado como mensaje, no como error."""
    if firma_de_hoy(cliente, ruta) is not None:
        raise ValueError("Ya has firmado tu sesión de hoy")

    resultado = registrar_sesion_pt(cliente, clave_idempotencia=clave_idempotencia, ruta=ruta)
    if resultado.get("duplicado"):
        # Reintento de red de una petición que ya se guardó (misma
        # `clave_idempotencia`) — no se crea un segundo recibo.
        return firma_de_hoy(cliente, ruta) or resultado

    ahora = ahora_negocio()
    with conectar(ruta) as conexion:
        conexion.execute(
            "INSERT INTO firmas_publicas (cliente, fecha, hora) VALUES (?, ?, ?)",
            (cliente, ahora.date().isoformat(), ahora.strftime("%H:%M")),
        )

    registrar_aviso(
        ahora.date().isoformat(),
        "firma_cliente",
        f"'{cliente}' ha firmado su propia sesión de hoy desde su enlace personal",
        ruta,
    )

    return resultado
