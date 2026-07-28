"""Suite de regresión del sprint de integridad y fiabilidad (2026-07-28).

Cada prueba trabaja sobre un archivo SQLite temporal propio (nunca sobre
`datos/antifragil.db`) — se crea en `setUp` y se borra en `tearDown`.

Ejecutar con:
    python -m unittest discover -s tests -v
"""

import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp
from unittest.mock import patch

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra


class BaseIntegridadTestCase(unittest.TestCase):
    def setUp(self) -> None:
        descriptor, ruta_str = mkstemp(suffix=".db")
        import os

        os.close(descriptor)
        self.ruta = Path(ruta_str)
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Test 40 x4", 40.0, 4, ruta=self.ruta)
        cr.crear_cliente("Cliente", "Test 40 x4", 0, False, ruta=self.ruta)

    def tearDown(self) -> None:
        # En Windows, SQLite puede tardar un instante en soltar el archivo
        # tras la última conexión — no es un fallo real de la app, solo de
        # limpieza del test, así que se ignora si el archivo sigue
        # bloqueado (el sistema operativo limpiará la carpeta temporal
        # igualmente).
        for sufijo in ("", "-wal", "-shm"):
            candidato = Path(str(self.ruta) + sufijo)
            try:
                if candidato.exists():
                    candidato.unlink()
            except PermissionError:
                pass


class TestRenovacionYSesionesMismoDia(BaseIntegridadTestCase):
    def test_renovacion_normal(self):
        resultado = None
        for i in range(4):
            resultado = ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3 + i), ruta=self.ruta)
        self.assertTrue(resultado["renovado"])
        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 0)
        self.assertEqual(cliente["pendiente_pago"], "Sí")

    def test_varias_sesiones_mismo_dia(self):
        r1 = ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 10), ruta=self.ruta)
        r2 = ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 10), ruta=self.ruta)
        self.assertEqual(r1["numero_sesion"], 1)
        self.assertEqual(r2["numero_sesion"], 2)
        hist = cr.obtener_historial("Cliente", ruta=self.ruta)
        entradas_ese_dia = [h for h in hist if h["fecha"] == "2026-08-10"]
        self.assertEqual(len(entradas_ese_dia), 2)
        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 2)


class TestBorradoYEdicion(BaseIntegridadTestCase):
    def test_borrar_deja_todo_como_antes(self):
        self.assertIsNone(er.obtener_semana("2026-08-03", ruta=self.ruta))
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=self.ruta)
        hist = cr.obtener_historial("Cliente", ruta=self.ruta)
        ra.eliminar_sesion_pt(hist[0]["id"], ruta=self.ruta)

        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 0)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=self.ruta), [])
        # La fila de la semana puede seguir existiendo (creada al firmar),
        # pero sus valores económicos deben quedar en cero — no debe
        # quedar ningún resto de la sesión borrada.
        semana_despues = er.obtener_semana("2026-08-03", ruta=self.ruta)
        self.assertAlmostEqual(semana_despues["facturacion_total"], 0.0)
        self.assertEqual(semana_despues["horas_totales"], 0)

    def test_editar_numero_sesion(self):
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=self.ruta)
        hist = cr.obtener_historial("Cliente", ruta=self.ruta)
        ra.editar_sesion_pt(hist[0]["id"], "2026-08-03", 1, ruta=self.ruta)
        hist2 = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(hist2[0]["numero_sesion"], 1)


class TestTarifaHistorica(BaseIntegridadTestCase):
    def test_tarifa_historica_al_mover_y_borrar(self):
        ruta = self.ruta
        cr.guardar_programa("Programa 37.5", 37.5, 8, ruta=ruta)
        cr.guardar_programa("Programa 40", 40.0, 8, ruta=ruta)
        cr.crear_cliente("Ana", "Programa 37.5", 0, False, ruta=ruta)

        # Firma a 37,50 € (lunes 3 de agosto)
        ra.registrar_sesion_pt("Ana", fecha=date(2026, 8, 3), ruta=ruta)
        self.assertAlmostEqual(er.obtener_semana("2026-08-03", ruta=ruta)["facturacion_total"], 37.5)

        # Sube el precio del cliente a 40 € — la sesión ya firmada NO debe
        # recalcularse con la tarifa nueva.
        cr.actualizar_cliente("Ana", "Ana", "Programa 40", 0, False, ruta=ruta)
        entrada_id = cr.obtener_historial("Ana", ruta=ruta)[0]["id"]
        self.assertAlmostEqual(cr.obtener_historial("Ana", ruta=ruta)[0]["tarifa"], 37.5)

        # Mover la sesión antigua a otra semana (lunes 10 de agosto)
        ra.editar_sesion_pt(entrada_id, "2026-08-10", 1, ruta=ruta)
        self.assertAlmostEqual(er.obtener_semana("2026-08-03", ruta=ruta)["facturacion_total"], 0.0)
        self.assertAlmostEqual(er.obtener_semana("2026-08-10", ruta=ruta)["facturacion_total"], 37.5)

        # Borrarla debe restar exactamente 37,50 €, no 40
        ra.eliminar_sesion_pt(entrada_id, ruta=ruta)
        self.assertAlmostEqual(er.obtener_semana("2026-08-10", ruta=ruta)["facturacion_total"], 0.0)


class TestCambioDeMesYAno(BaseIntegridadTestCase):
    def test_semana_a_caballo_entre_julio_y_agosto(self):
        # 2026-07-27 a 2026-08-02 es una semana real que cruza el mes.
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 7, 31), ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 1), ruta=self.ruta)

        mes_julio = er.obtener_mes(2026, 7, ruta=self.ruta)
        mes_agosto = er.obtener_mes(2026, 8, ruta=self.ruta)
        self.assertEqual(mes_julio["horas_totales"], 1)
        self.assertEqual(mes_agosto["horas_totales"], 1)
        self.assertAlmostEqual(mes_julio["facturacion_total"], 40.0)
        self.assertAlmostEqual(mes_agosto["facturacion_total"], 40.0)

        # La vista semanal sigue mostrando ambas sesiones juntas, en la
        # misma semana natural.
        semana = er.obtener_semana("2026-07-27", ruta=self.ruta)
        self.assertEqual(semana["horas_totales"], 2)

    def test_cambio_de_ano(self):
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 12, 31), ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", fecha=date(2027, 1, 1), ruta=self.ruta)
        mes_dic = er.obtener_mes(2026, 12, ruta=self.ruta)
        mes_ene = er.obtener_mes(2027, 1, ruta=self.ruta)
        self.assertEqual(mes_dic["horas_totales"], 1)
        self.assertEqual(mes_ene["horas_totales"], 1)


class TestCrossfitKids(BaseIntegridadTestCase):
    def test_provisional_hasta_introducir_facturacion(self):
        ruta = self.ruta
        ra.registrar_clase_grupo("kids", fecha=date(2026, 8, 3), ruta=ruta)
        ra.registrar_clase_grupo("kids", fecha=date(2026, 8, 10), ruta=ruta)  # otra semana, mismo mes

        mes = er.obtener_mes(2026, 8, ruta=ruta)
        self.assertTrue(mes["provisional"])
        self.assertEqual(mes["sesiones_kids"], 2)
        self.assertEqual(mes["horas_totales"], 0)  # no cuenta hasta facturar

        precio = er.registrar_facturacion_kids(2026, 8, 100.0, ruta=ruta)
        self.assertAlmostEqual(precio, 50.0)

        mes2 = er.obtener_mes(2026, 8, ruta=ruta)
        self.assertFalse(mes2["provisional"])
        self.assertEqual(mes2["horas_totales"], 2)
        self.assertAlmostEqual(mes2["facturacion_total"], 100.0)

    def test_deshacer_clase_de_grupo(self):
        ruta = self.ruta
        ra.registrar_clase_grupo("lidomare", fecha=date(2026, 8, 3), ruta=ruta)
        semana_con = er.obtener_semana("2026-08-03", ruta=ruta)
        self.assertEqual(semana_con["horas_totales"], 1)
        ra.eliminar_ultima_clase_grupo("lidomare", ruta=ruta)
        semana_sin = er.obtener_semana("2026-08-03", ruta=ruta)
        self.assertEqual(semana_sin["horas_totales"], 0)


class TestFalloAMitadDeTransaccion(BaseIntegridadTestCase):
    def test_fallo_revierte_todo(self):
        ruta = self.ruta
        cliente_antes = dict(cr.leer_clientes(ruta)["Cliente"])

        with patch("registrar_asistencia.registrar_historial", side_effect=RuntimeError("fallo simulado")):
            with self.assertRaises(RuntimeError):
                ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=ruta)

        cliente_despues = dict(cr.leer_clientes(ruta)["Cliente"])
        self.assertEqual(cliente_antes, cliente_despues)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=ruta), [])
        self.assertIsNone(er.obtener_semana("2026-08-03", ruta=ruta))


class TestRenombradoYValidaciones(BaseIntegridadTestCase):
    def test_renombrar_cliente_con_historial(self):
        ruta = self.ruta
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        cr.actualizar_cliente("Cliente", "Cliente Nuevo", "Test 40 x4", 1, False, ruta=ruta)

        self.assertEqual(len(cr.obtener_historial("Cliente Nuevo", ruta=ruta)), 1)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=ruta), [])

        with basedatos.conectar(ruta) as conexion:
            problemas = conexion.execute("PRAGMA foreign_key_check").fetchall()
        self.assertEqual(problemas, [])

    def test_valores_invalidos_rechazados(self):
        ruta = self.ruta
        with self.assertRaises(ValueError):
            cr.crear_cliente("Malo", "Test 40 x4", -1, False, ruta=ruta)
        with self.assertRaises(ValueError):
            cr.crear_cliente("Malo2", "Test 40 x4", 999, False, ruta=ruta)
        with self.assertRaises(ValueError):
            cr.guardar_programa("ProgramaMalo", -5, 4, ruta=ruta)
        with self.assertRaises(ValueError):
            cr.guardar_programa("ProgramaMalo2", 40, 0, ruta=ruta)

        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        entrada_id = cr.obtener_historial("Cliente", ruta=ruta)[0]["id"]
        with self.assertRaises(ValueError):
            ra.editar_sesion_pt(entrada_id, "2026-08-03", 99, ruta=ruta)
        with self.assertRaises(ValueError):
            ra.editar_sesion_pt(entrada_id, "fecha-no-valida", 1, ruta=ruta)


class TestComparacionHistorialEconomia(BaseIntegridadTestCase):
    def test_detecta_descuadre_provocado(self):
        ruta = self.ruta
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        self.assertEqual(er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), ruta=ruta), [])

        with basedatos.transaccion(ruta) as conexion:
            desglose = er.obtener_desglose_semana("2026-08-03", conexion=conexion)
            desglose[40.0]["sesiones"] += 5
            desglose[40.0]["facturacion"] += 200
            er.registrar_semana(date(2026, 8, 3), date(2026, 8, 9), desglose, 0, conexion=conexion)

        discrepancias = er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), ruta=ruta)
        self.assertTrue(len(discrepancias) > 0)


class TestCicloDeBono(BaseIntegridadTestCase):
    def setUp(self) -> None:
        super().setUp()
        cr.guardar_programa("Doce", 60.0, 12, ruta=self.ruta)
        cr.crear_cliente("Doce Cliente", "Doce", 0, False, ruta=self.ruta)
        # Las 11 primeras sesiones, firmadas de verdad (no solo puesto el
        # contador a mano) — si no, el historial no tendría con qué
        # reconstruir el ciclo anterior al borrar la sesión 12.
        for i in range(11):
            ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 7, 1 + i), ruta=self.ruta)

    def test_borrar_sesion_que_termina_el_bono_deshace_la_renovacion(self):
        ruta = self.ruta
        r = ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        self.assertTrue(r["renovado"])

        entrada_id = cr.obtener_historial("Doce Cliente", ruta=ruta)[0]["id"]
        ra.eliminar_sesion_pt(entrada_id, ruta=ruta)

        cliente = cr.leer_clientes(ruta)["Doce Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 11)
        self.assertEqual(cliente["pendiente_pago"], "No")

    def test_borrar_primera_sesion_del_bono_nuevo_no_revive_el_antiguo(self):
        """Reproduce el bug reportado: borrar la sesión 1 del bono nuevo NO
        debe hacer que el contador vuelva a mostrar "12" del bono anterior."""
        ruta = self.ruta
        ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 3), ruta=ruta)  # sesión 12, renueva
        r2 = ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 4), ruta=ruta)  # sesión 1 del nuevo
        self.assertFalse(r2["renovado"])
        self.assertEqual(r2["numero_sesion"], 1)

        entrada_id_1 = cr.obtener_historial("Doce Cliente", ruta=ruta)[0]["id"]
        ra.eliminar_sesion_pt(entrada_id_1, ruta=ruta)

        cliente = cr.leer_clientes(ruta)["Doce Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 0)  # no 12
        self.assertEqual(cliente["pendiente_pago"], "Sí")  # la renovación sigue en pie

        r3 = ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 5), ruta=ruta)
        self.assertEqual(r3["numero_sesion"], 1)
        self.assertFalse(r3["renovado"])

    def test_varias_sesiones_mismo_dia_alrededor_de_la_renovacion(self):
        ruta = self.ruta
        r1 = ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        r2 = ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        self.assertTrue(r1["renovado"])
        self.assertFalse(r2["renovado"])
        self.assertEqual(r2["numero_sesion"], 1)

    def test_editar_sesion_alrededor_del_limite(self):
        ruta = self.ruta
        ra.registrar_sesion_pt("Doce Cliente", fecha=date(2026, 8, 3), ruta=ruta)
        entrada_id = cr.obtener_historial("Doce Cliente", ruta=ruta)[0]["id"]
        ra.editar_sesion_pt(entrada_id, "2026-08-04", 12, ruta=ruta)
        cliente = cr.leer_clientes(ruta)["Doce Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 0)


if __name__ == "__main__":
    unittest.main()
