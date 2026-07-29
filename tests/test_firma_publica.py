"""Tests de la confirmación pública desde el enlace personal del cliente
(`/mi/<token>`, 2026-07-29) — ver `firma_publica.py`.

Diseño: el cliente nunca crea una sesión, solo confirma la que Fernando ya
firmó ese día. Reutiliza la misma base de casos que `test_integridad.py`.
"""

import unittest
from datetime import timedelta
from unittest.mock import patch

import avisos as av
import clientes.repositorio as cr
import firma_publica as fp
import registrar_asistencia as ra
from tests.test_integridad import BaseIntegridadTestCase
from zona_horaria import hoy_negocio


class TestConfirmacionPublica(BaseIntegridadTestCase):
    def test_sin_sesion_hoy_no_hay_nada_que_confirmar(self):
        self.assertFalse(fp.hay_sesion_hoy("Cliente", ruta=self.ruta))
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

    def test_confirmar_tras_firmar_crea_recibo_con_fecha_y_hora(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)  # Fernando firma, fecha de hoy
        self.assertTrue(fp.hay_sesion_hoy("Cliente", ruta=self.ruta))

        resultado = fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertEqual(resultado["fecha"], hoy_negocio().isoformat())
        self.assertRegex(resultado["hora"], r"^\d{2}:\d{2}$")

        recibo = fp.confirmacion_de_hoy("Cliente", ruta=self.ruta)
        self.assertIsNotNone(recibo)

    def test_confirmar_no_toca_el_bono_ni_el_historial(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        hist_antes = cr.obtener_historial("Cliente", ruta=self.ruta)
        cliente_antes = cr.leer_clientes(self.ruta)["Cliente"]

        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

        hist_despues = cr.obtener_historial("Cliente", ruta=self.ruta)
        cliente_despues = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(hist_antes, hist_despues)
        self.assertEqual(cliente_antes["sesiones_completadas"], cliente_despues["sesiones_completadas"])

    def test_no_permite_confirmar_dos_veces(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

    def test_confirmar_avisa_a_fernando(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertTrue(any(a["tipo"] == "confirmacion_cliente" and "Cliente" in a["detalle"] for a in avisos))

    def test_fernando_firma_varias_veces_cliente_confirma_una_sola_vez(self):
        """El límite de una confirmación al día es del cliente — Fernando
        sigue pudiendo firmar varias sesiones el mismo día sin límite
        (decisión del 2026-07-24, sin cambios)."""
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 2)

        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)


class TestAvisoConfirmacionesPendientes(BaseIntegridadTestCase):
    """`avisar_confirmaciones_pendientes` nunca mira sesiones anteriores a
    `FECHA_INICIO_CONFIRMACIONES` (el día en que se lanzó esta función) —
    si no, cada sesión antigua de toda la vida de la app aparecería como
    "sin confirmar" de golpe (lo que le pasó de verdad a Fernando: 28
    avisos el primer día). Por eso estos tests fijan el "hoy" del sistema
    al día siguiente al lanzamiento, y la sesión al día del lanzamiento —
    así el escenario es válido pase lo que pase con la fecha real."""

    def test_sesion_del_dia_de_lanzamiento_sin_confirmar_genera_aviso(self):
        dia_sesion = fp.FECHA_INICIO_CONFIRMACIONES
        manana = dia_sesion + timedelta(days=1)
        ra.registrar_sesion_pt("Cliente", fecha=dia_sesion, ruta=self.ruta)

        with patch("firma_publica.hoy_negocio", return_value=manana):
            fp.avisar_confirmaciones_pendientes(ruta=self.ruta)

        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertTrue(
            any(a["tipo"] == "confirmacion_pendiente" and dia_sesion.isoformat() in a["detalle"] for a in avisos)
        )

    def test_sesion_confirmada_no_genera_aviso(self):
        dia_sesion = fp.FECHA_INICIO_CONFIRMACIONES
        manana = dia_sesion + timedelta(days=1)
        ra.registrar_sesion_pt("Cliente", fecha=dia_sesion, ruta=self.ruta)
        # El cliente sí confirmó ese día (se simula insertando directamente,
        # ya que confirmar_sesion_publica solo entiende "hoy").
        from basedatos import conectar

        with conectar(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO firmas_publicas (cliente, fecha, hora) VALUES (?, ?, ?)",
                ("Cliente", dia_sesion.isoformat(), "10:00"),
            )

        with patch("firma_publica.hoy_negocio", return_value=manana):
            fp.avisar_confirmaciones_pendientes(ruta=self.ruta)

        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertFalse(any(a["tipo"] == "confirmacion_pendiente" for a in avisos))

    def test_sesion_anterior_al_lanzamiento_nunca_genera_aviso(self):
        """La causa exacta de los 28 avisos de golpe: sesiones firmadas
        antes de que esta función existiera no deben avisar nunca, por muy
        atrás que se mire."""
        antes_del_lanzamiento = fp.FECHA_INICIO_CONFIRMACIONES - timedelta(days=5)
        manana = fp.FECHA_INICIO_CONFIRMACIONES + timedelta(days=1)
        ra.registrar_sesion_pt("Cliente", fecha=antes_del_lanzamiento, ruta=self.ruta)

        with patch("firma_publica.hoy_negocio", return_value=manana):
            fp.avisar_confirmaciones_pendientes(ruta=self.ruta)

        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertFalse(any(a["tipo"] == "confirmacion_pendiente" for a in avisos))

    def test_sesion_de_hoy_sin_confirmar_no_genera_aviso_todavia(self):
        """No se avisa de hoy — el cliente todavía tiene toda la jornada
        para confirmar."""
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.avisar_confirmaciones_pendientes(ruta=self.ruta)
        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertFalse(any(a["tipo"] == "confirmacion_pendiente" for a in avisos))


if __name__ == "__main__":
    unittest.main()
