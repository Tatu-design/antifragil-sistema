"""Reglas de las tres modalidades de servicio (2026-08-03).

Lógica pura: no toca base de datos. Comprueba que cada modalidad calcula lo
que debe y, sobre todo, que rechaza las combinaciones imposibles antes de
que lleguen a la facturación.
"""

import unittest

from servicios.modalidades import (
    BONO, CUENTA, MENSUALIDAD,
    precio_efectivo, resumen_ciclo, tarifa_de_la_sesion,
    consume_sesiones, renueva_por_consumo, es_mensual, tiene_tope,
    validar_condiciones, validar_modalidad,
)


class TestValidacion(unittest.TestCase):
    def test_una_modalidad_inventada_se_rechaza(self):
        with self.assertRaises(ValueError):
            validar_modalidad("suscripcion")

    def test_bono_calcula_el_precio_por_sesion(self):
        # El caso del enunciado: 5 sesiones por 225 € son 45 € la sesión.
        condiciones = validar_condiciones(BONO, sesiones_totales=5, precio_total=225)
        self.assertEqual(condiciones["tarifa"], 45.0)
        self.assertEqual(condiciones["precio_total"], 225.0)
        self.assertEqual(condiciones["sesiones_totales"], 5)
        self.assertIsNone(condiciones["cuota_mensual"])

    def test_bono_sin_sesiones_se_rechaza(self):
        with self.assertRaises(ValueError):
            validar_condiciones(BONO, sesiones_totales=0, precio_total=225)

    def test_bono_sin_precio_se_rechaza(self):
        with self.assertRaises(ValueError):
            validar_condiciones(BONO, sesiones_totales=5, precio_total=None)

    def test_un_bono_no_puede_llevar_cuota_mensual(self):
        with self.assertRaises(ValueError):
            validar_condiciones(BONO, sesiones_totales=5, precio_total=225, cuota_mensual=720)

    def test_mensualidad_guarda_cuota_y_referencia(self):
        condiciones = validar_condiciones(MENSUALIDAD, cuota_mensual=720, sesiones_referencia=12)
        self.assertEqual(condiciones["cuota_mensual"], 720.0)
        self.assertEqual(condiciones["sesiones_referencia"], 12)
        # Clave: sus sesiones no llevan precio, o se cobraría dos veces.
        self.assertIsNone(condiciones["tarifa"])
        self.assertIsNone(condiciones["sesiones_totales"])

    def test_mensualidad_sin_cuota_se_rechaza(self):
        with self.assertRaises(ValueError):
            validar_condiciones(MENSUALIDAD, cuota_mensual=None)

    def test_la_referencia_es_opcional(self):
        condiciones = validar_condiciones(MENSUALIDAD, cuota_mensual=720)
        self.assertIsNone(condiciones["sesiones_referencia"])

    def test_una_mensualidad_no_puede_tener_tope_de_sesiones(self):
        with self.assertRaises(ValueError):
            validar_condiciones(MENSUALIDAD, cuota_mensual=720, sesiones_totales=12)

    def test_cuenta_guarda_el_precio_por_hora(self):
        condiciones = validar_condiciones(CUENTA, tarifa=35)
        self.assertEqual(condiciones["tarifa"], 35.0)
        self.assertIsNone(condiciones["sesiones_totales"])
        self.assertIsNone(condiciones["cuota_mensual"])

    def test_cuenta_sin_precio_se_rechaza(self):
        with self.assertRaises(ValueError):
            validar_condiciones(CUENTA, tarifa=0)

    def test_una_cuenta_no_puede_tener_tope(self):
        with self.assertRaises(ValueError):
            validar_condiciones(CUENTA, tarifa=35, sesiones_totales=10)


class TestComportamiento(unittest.TestCase):
    def test_solo_el_bono_consume_y_renueva(self):
        self.assertTrue(consume_sesiones(BONO))
        self.assertFalse(consume_sesiones(MENSUALIDAD))
        self.assertFalse(consume_sesiones(CUENTA))

        self.assertTrue(renueva_por_consumo(BONO))
        self.assertFalse(renueva_por_consumo(MENSUALIDAD))
        self.assertFalse(renueva_por_consumo(CUENTA))

    def test_mensualidad_y_cuenta_van_por_mes(self):
        self.assertFalse(es_mensual(BONO))
        self.assertTrue(es_mensual(MENSUALIDAD))
        self.assertTrue(es_mensual(CUENTA))

    def test_solo_el_bono_habla_de_sesiones_restantes(self):
        self.assertTrue(tiene_tope(BONO))
        self.assertFalse(tiene_tope(MENSUALIDAD))
        self.assertFalse(tiene_tope(CUENTA))

    def test_la_sesion_de_una_mensualidad_no_lleva_importe(self):
        self.assertIsNone(tarifa_de_la_sesion(MENSUALIDAD, 60.0))
        self.assertEqual(tarifa_de_la_sesion(BONO, 45.0), 45.0)
        self.assertEqual(tarifa_de_la_sesion(CUENTA, 35.0), 35.0)


class TestPrecioEfectivo(unittest.TestCase):
    def test_los_tres_casos_del_enunciado(self):
        self.assertEqual(precio_efectivo(720, 12), 60.0)
        self.assertEqual(precio_efectivo(720, 13), 55.38)
        self.assertEqual(precio_efectivo(720, 9), 80.0)

    def test_sin_sesiones_no_hay_precio_infinito(self):
        self.assertIsNone(precio_efectivo(720, 0))
        self.assertIsNone(precio_efectivo(720, None))


class TestResumenParaLaPantalla(unittest.TestCase):
    def test_bono(self):
        resumen = resumen_ciclo(
            {"modalidad": BONO, "sesiones_totales": 8, "tarifa": 45.0}, sesiones_reales=3
        )
        self.assertEqual(resumen["sesiones_restantes"], 5)
        self.assertEqual(resumen["facturacion"], 135.0)
        self.assertTrue(resumen["muestra_barra"])

    def test_mensualidad_no_enseña_restantes_ni_barra(self):
        resumen = resumen_ciclo(
            {"modalidad": MENSUALIDAD, "cuota_mensual": 720.0, "sesiones_referencia": 12},
            sesiones_reales=13,
        )
        self.assertIsNone(resumen["sesiones_restantes"])
        self.assertFalse(resumen["muestra_barra"])
        # Facture lo que facture el mes, la cuota no cambia con las sesiones.
        self.assertEqual(resumen["facturacion"], 720.0)
        self.assertEqual(resumen["precio_efectivo"], 55.38)

    def test_cuenta_acumula_lo_realmente_hecho(self):
        # El caso del enunciado: 8 sesiones a 35 € son 280 €.
        resumen = resumen_ciclo({"modalidad": CUENTA, "tarifa": 35.0}, sesiones_reales=8)
        self.assertEqual(resumen["facturacion"], 280.0)
        self.assertIsNone(resumen["sesiones_restantes"])
        self.assertFalse(resumen["muestra_barra"])

    def test_un_ciclo_antiguo_sin_modalidad_se_trata_como_bono(self):
        # Compatibilidad: los ciclos guardados antes de esta versión.
        resumen = resumen_ciclo({"sesiones_totales": 4, "tarifa": 45.0}, sesiones_reales=1)
        self.assertEqual(resumen["modalidad"], BONO)
        self.assertEqual(resumen["sesiones_restantes"], 3)


if __name__ == "__main__":
    unittest.main()
