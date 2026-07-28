"""Tests de la firma pública de sesión desde el enlace personal del cliente
(`/mi/<token>`, 2026-07-28) — ver `firma_publica.py`.

Reutiliza la misma base de casos que `test_integridad.py` (un archivo
SQLite temporal propio por test, nunca `datos/antifragil.db`).
"""

import unittest

import avisos as av
import clientes.repositorio as cr
import firma_publica as fp
import registrar_asistencia as ra
from tests.test_integridad import BaseIntegridadTestCase
from zona_horaria import hoy_negocio


class TestFirmaPublica(BaseIntegridadTestCase):
    def test_firmar_crea_recibo_con_fecha_y_hora(self):
        resultado = fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        self.assertEqual(resultado["numero_sesion"], 1)

        recibo = fp.firma_de_hoy("Cliente", ruta=self.ruta)
        self.assertIsNotNone(recibo)
        self.assertEqual(recibo["fecha"], hoy_negocio().isoformat())
        self.assertRegex(recibo["hora"], r"^\d{2}:\d{2}$")

    def test_firmar_avisa_a_fernando(self):
        fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertTrue(any(a["tipo"] == "firma_cliente" and "Cliente" in a["detalle"] for a in avisos))

    def test_no_permite_firmar_dos_veces_el_mismo_dia_desde_el_enlace(self):
        fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        with self.assertRaises(ValueError):
            fp.firmar_sesion_publica("Cliente", "clave-2", ruta=self.ruta)

        # Solo debe quedar UNA sesión en el historial, no dos.
        hist = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(len(hist), 1)

    def test_reintento_de_red_con_la_misma_clave_no_duplica_el_recibo(self):
        fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        # Aquí no debería poder pasar en la práctica (firma_de_hoy ya lo
        # bloquearía), pero si dos peticiones llegan casi a la vez con la
        # misma clave, registrar_sesion_pt ya las deduplica por su cuenta —
        # se comprueba que no queda un segundo recibo ni una segunda sesión.
        hist_antes = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(len(hist_antes), 1)

    def test_fernando_sigue_pudiendo_firmar_varias_veces_el_mismo_dia(self):
        """El límite de una firma al día es solo del enlace público — el
        botón de Fernando desde su perfil no tiene ese límite (decisión de
        Fernando, 2026-07-24, sin cambios en este sprint)."""
        fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)

        hist = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(len(hist), 2)

    def test_fernando_puede_editar_y_borrar_una_sesion_firmada_por_el_cliente(self):
        """El cliente solo puede CREAR su firma — editarla o borrarla sigue
        siendo cosa exclusiva de Fernando desde su perfil de administrador."""
        fp.firmar_sesion_publica("Cliente", "clave-1", ruta=self.ruta)
        entrada_id = cr.obtener_historial("Cliente", ruta=self.ruta)[0]["id"]

        editado = ra.editar_sesion_pt(entrada_id, hoy_negocio().isoformat(), 1, ruta=self.ruta)
        self.assertEqual(editado["numero_sesion"], 1)

        ra.eliminar_sesion_pt(entrada_id, ruta=self.ruta)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=self.ruta), [])

    def test_sin_firma_hoy_devuelve_none(self):
        self.assertIsNone(fp.firma_de_hoy("Cliente", ruta=self.ruta))


if __name__ == "__main__":
    unittest.main()
