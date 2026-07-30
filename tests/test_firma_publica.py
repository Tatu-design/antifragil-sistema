"""Tests de la confirmación pública desde el enlace personal del cliente
(`/mi/<token>`, 2026-07-29) — ver `firma_publica.py`.

Diseño: el cliente nunca crea una sesión, solo confirma la que Fernando ya
firmó. Cada sesión se confirma por separado (por su `id`), no una vez por
día, para que firmar varias sesiones el mismo cliente el mismo día se
pueda confirmar sesión a sesión. Reutiliza la misma base de casos que
`test_integridad.py`.
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
        self.assertFalse(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

    def test_confirmar_tras_firmar_crea_recibo_con_fecha_y_hora(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)  # Fernando firma, fecha de hoy
        self.assertTrue(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))

        resultado = fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertEqual(resultado["fecha"], hoy_negocio().isoformat())
        self.assertRegex(resultado["hora"], r"^\d{2}:\d{2}$")

        confirmaciones = fp.confirmaciones_de_hoy("Cliente", ruta=self.ruta)
        self.assertEqual(len(confirmaciones), 1)

    def test_confirmar_no_toca_el_bono_ni_el_historial(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        hist_antes = cr.obtener_historial("Cliente", ruta=self.ruta)
        cliente_antes = cr.leer_clientes(self.ruta)["Cliente"]

        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

        hist_despues = cr.obtener_historial("Cliente", ruta=self.ruta)
        cliente_despues = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(hist_antes, hist_despues)
        self.assertEqual(cliente_antes["sesiones_completadas"], cliente_despues["sesiones_completadas"])

    def test_no_permite_confirmar_dos_veces_la_misma_sesion(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertFalse(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

    def test_confirmar_avisa_a_fernando(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertTrue(any(a["tipo"] == "confirmacion_cliente" and "Cliente" in a["detalle"] for a in avisos))

    def test_dos_sesiones_el_mismo_dia_se_confirman_una_a_una(self):
        """El bug real que reportó Fernando: firmar dos sesiones el mismo
        cliente el mismo día (algo que ya podía hacer) debía poder
        confirmarse dos veces, una por sesión — no "gastar" el turno de
        confirmar con la primera."""
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 2)

        # Primera confirmación: queda pendiente la segunda sesión.
        self.assertTrue(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertTrue(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))

        # Segunda confirmación: ya no queda ninguna pendiente.
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertFalse(fp.hay_sesion_pendiente_de_confirmar("Cliente", ruta=self.ruta))

        self.assertEqual(len(fp.confirmaciones_de_hoy("Cliente", ruta=self.ruta)), 2)
        with self.assertRaises(ValueError):
            fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)

    def test_fernando_puede_firmar_sin_limite_independiente_de_confirmaciones(self):
        """El límite de "una sesión pendiente a la vez" es solo de cara al
        cliente — Fernando sigue sin ningún límite (decisión del
        2026-07-24, sin cambios)."""
        for _ in range(4):
            ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 4)


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
        entrada_id = cr.obtener_historial("Cliente", ruta=self.ruta)[0]["id"]
        from basedatos import conectar

        with conectar(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO firmas_publicas (cliente, fecha, hora, sesion_id) VALUES (?, ?, ?, ?)",
                ("Cliente", dia_sesion.isoformat(), "10:00", entrada_id),
            )

        with patch("firma_publica.hoy_negocio", return_value=manana):
            fp.avisar_confirmaciones_pendientes(ruta=self.ruta)

        avisos = av.listar_avisos_pendientes(ruta=self.ruta)
        self.assertFalse(any(a["tipo"] == "confirmacion_pendiente" for a in avisos))

    def test_dos_sesiones_mismo_dia_una_confirmada_avisa_solo_de_la_otra(self):
        dia_sesion = fp.FECHA_INICIO_CONFIRMACIONES
        manana = dia_sesion + timedelta(days=1)
        ra.registrar_sesion_pt("Cliente", fecha=dia_sesion, ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", fecha=dia_sesion, ruta=self.ruta)
        primera_id = min(h["id"] for h in cr.obtener_historial("Cliente", ruta=self.ruta))
        from basedatos import conectar

        with conectar(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO firmas_publicas (cliente, fecha, hora, sesion_id) VALUES (?, ?, ?, ?)",
                ("Cliente", dia_sesion.isoformat(), "10:00", primera_id),
            )

        with patch("firma_publica.hoy_negocio", return_value=manana):
            fp.avisar_confirmaciones_pendientes(ruta=self.ruta)

        avisos = [a for a in av.listar_avisos_pendientes(ruta=self.ruta) if a["tipo"] == "confirmacion_pendiente"]
        self.assertEqual(len(avisos), 1)
        self.assertIn("sesión 2", avisos[0]["detalle"])

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


class TestBorradoDeCliente(BaseIntegridadTestCase):
    """Borrar un cliente debe descontar también su facturación de las
    semanas afectadas — si no, su dinero seguiría contado para siempre sin
    ninguna sesión detrás (decisión de Fernando, 2026-07-29, al retirar los
    clientes de prueba, cuyas sesiones inflaban la semana en curso)."""

    def test_borrar_cliente_revierte_su_economia(self):
        import economia.registro as er

        for dia in (3, 4):
            ra.registrar_sesion_pt("Cliente", fecha=__import__("datetime").date(2026, 8, dia), ruta=self.ruta)

        semana = er.obtener_semana("2026-08-03", ruta=self.ruta)
        self.assertAlmostEqual(semana["facturacion_total"], 80.0)

        resultado = ra.eliminar_cliente_con_historial("Cliente", ruta=self.ruta)
        self.assertEqual(resultado["sesiones_borradas"], 2)
        self.assertAlmostEqual(resultado["importe_descontado"], 80.0)

        semana_despues = er.obtener_semana("2026-08-03", ruta=self.ruta)
        self.assertAlmostEqual(semana_despues["facturacion_total"], 0.0)
        self.assertEqual(semana_despues["horas_totales"], 0)
        self.assertNotIn("Cliente", cr.leer_clientes(self.ruta))

    def test_borrar_cliente_sin_sesiones(self):
        resultado = ra.eliminar_cliente_con_historial("Cliente", ruta=self.ruta)
        self.assertEqual(resultado["sesiones_borradas"], 0)
        self.assertNotIn("Cliente", cr.leer_clientes(self.ruta))

    def test_borrar_cliente_borra_tambien_sus_confirmaciones(self):
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        self.assertEqual(len(fp.confirmaciones_de_hoy("Cliente", ruta=self.ruta)), 1)

        ra.eliminar_cliente_con_historial("Cliente", ruta=self.ruta)
        self.assertEqual(fp.confirmaciones_de_hoy("Cliente", ruta=self.ruta), [])

    def test_no_deja_borrar_la_ficha_si_quedan_sesiones(self):
        """Salvaguarda de bajo nivel: `eliminar_cliente` por su cuenta no
        debe poder dejar sesiones huérfanas con su dinero contado."""
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        with self.assertRaises(ValueError):
            cr.eliminar_cliente("Cliente", ruta=self.ruta)

    def test_cliente_inexistente(self):
        with self.assertRaises(ValueError):
            cr.eliminar_cliente("No existe", ruta=self.ruta)

    def test_borrar_una_sesion_ya_confirmada(self):
        """Bug encontrado por los tests el 2026-07-29: si el cliente había
        confirmado la sesión, `firmas_publicas.sesion_id` apuntaba a ella y
        el borrado fallaba con un error de clave foránea — no solo al
        borrar el cliente entero, también al borrar a mano esa sesión desde
        el perfil de administrador."""
        ra.registrar_sesion_pt("Cliente", ruta=self.ruta)
        fp.confirmar_sesion_publica("Cliente", ruta=self.ruta)
        entrada_id = cr.obtener_historial("Cliente", ruta=self.ruta)[0]["id"]

        ra.eliminar_sesion_pt(entrada_id, ruta=self.ruta)

        self.assertEqual(cr.obtener_historial("Cliente", ruta=self.ruta), [])
        self.assertEqual(fp.confirmaciones_de_hoy("Cliente", ruta=self.ruta), [])
