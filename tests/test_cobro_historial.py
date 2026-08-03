"""Cobrar un servicio ya cerrado, y que la lista lo sepa (2026-08-04).

Dos huecos que encontró Fernando con el caso real de Samanta:

1. Una cuenta de cliente del mes pasado quedó a deber. Al cerrarse el
   periodo, su estado de cobro quedaba congelado y **no había forma de
   marcarla como pagada** cuando el cliente pagara. En el negocio real se
   cobra después: una cuenta al acabar el mes, un bono al agotarse.

2. La lista de clientes solo miraba el pago del servicio EN CURSO, así que
   un cliente con una deuda anterior pero el servicio de ahora al día
   **no salía como pendiente de pago**.

Nada de esto puede mover la economía: cobrar más tarde no cambia lo que se
produjo ni cuándo se trabajó.
"""

import os
import re
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra
from servicios.modalidades import BONO, CUENTA, MENSUALIDAD


class BaseCobro(unittest.TestCase):
    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES ('Base', 45.0, 4)")

        import webapp.app as webapp

        self.webapp = webapp
        bd = self.ruta
        self._originales = {
            n: getattr(webapp, n)
            for n in ("leer_clientes", "obtener_historial", "obtener_programas_cliente",
                      "obtener_ciclo_actual", "avisar_confirmaciones_pendientes", "contar_no_leidos",
                      "hay_sesion_pendiente_de_confirmar", "confirmaciones_de_hoy",
                      "asegurar_ciclos_mensuales", "marcar_pago_del_ciclo")
        }
        webapp.leer_clientes = lambda r=bd: cr.leer_clientes(bd)
        webapp.obtener_historial = lambda n, r=bd: cr.obtener_historial(n, ruta=bd)
        webapp.obtener_programas_cliente = lambda n, r=bd: cr.obtener_programas_cliente(n, ruta=bd)
        webapp.obtener_ciclo_actual = lambda n, conexion=None, r=bd: cr.obtener_ciclo_actual(n, ruta=bd)
        webapp.avisar_confirmaciones_pendientes = lambda r=bd: None
        webapp.contar_no_leidos = lambda r=bd: 0
        webapp.hay_sesion_pendiente_de_confirmar = lambda n, r=bd: False
        webapp.confirmaciones_de_hoy = lambda n, r=bd: []
        webapp.asegurar_ciclos_mensuales = lambda anio, mes, r=bd: None
        webapp.marcar_pago_del_ciclo = lambda n, pagado, ciclo=None, r=bd: (
            cr.marcar_pago_del_ciclo(n, pagado, ciclo=ciclo, ruta=bd)
        )
        self.addCleanup(self._restaurar)

        webapp.app.config["TESTING"] = True
        self.cliente = webapp.app.test_client()
        with self.cliente.session_transaction() as sesion:
            sesion["autenticado"] = True
            sesion["csrf"] = "t"

    def _restaurar(self):
        for nombre, funcion in self._originales.items():
            setattr(self.webapp, nombre, funcion)
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                pass

    def alta(self, nombre):
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, "
                "ciclo_bono, estado, token) VALUES (?, 'Base', 0, 0, 1, 'activo', ?)",
                (nombre, "tok-" + nombre),
            )

    def firmar(self, nombre, veces=1, cuando=date(2026, 8, 3)):
        for _ in range(veces):
            ra.registrar_sesion_pt(nombre, fecha=cuando, ruta=self.ruta)

    def samanta(self):
        """El caso real: una cuenta de cliente de julio que quedó a deber, y
        la de agosto ya abierta."""
        self.alta("Samanta")
        cr.configurar_servicio("Samanta", CUENTA, nombre_servicio="Cuenta", tarifa=35,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        self.firmar("Samanta", 8, cuando=date(2026, 7, 5))
        # Julio se queda sin cobrar y llega agosto.
        cr.marcar_pago_del_ciclo("Samanta", False, ruta=self.ruta)
        self.firmar("Samanta", 2, cuando=date(2026, 8, 3))
        # El de agosto sí está al día.
        cr.marcar_pago_del_ciclo("Samanta", True, ruta=self.ruta)

    def texto(self, ruta_web):
        html = self.cliente.get(ruta_web).get_data(as_text=True)
        html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
        html = re.sub(r"<svg.*?</svg>", " ", html, flags=re.S)
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


class TestCobrarUnCicloCerrado(BaseCobro):
    def test_el_caso_de_samanta_deja_dos_ciclos_uno_a_deber(self):
        self.samanta()
        ciclos = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        self.assertEqual(ciclos[0]["pagado"], 1)   # agosto, al día
        self.assertEqual(ciclos[1]["pagado"], 0)   # julio, a deber

    def test_se_puede_marcar_pagado_un_ciclo_ya_cerrado(self):
        self.samanta()
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]

        cr.marcar_pago_del_ciclo("Samanta", True, ciclo=cerrado, ruta=self.ruta)

        ciclos = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)
        self.assertEqual(ciclos[1]["pagado"], 1)

    def test_cobrar_un_ciclo_antiguo_no_toca_el_actual(self):
        self.samanta()
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]

        cr.marcar_pago_del_ciclo("Samanta", False, ciclo=cerrado, ruta=self.ruta)

        # El servicio de ahora sigue al día: la deuda antigua es suya, no del actual.
        self.assertEqual(cr.leer_clientes(self.ruta)["Samanta"]["pendiente_pago"], "No")
        self.assertEqual(cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[0]["pagado"], 1)

    def test_cobrar_no_mueve_ni_un_euro_ni_una_hora(self):
        self.samanta()
        julio_antes = er.obtener_mes(2026, 7, self.ruta)
        agosto_antes = er.obtener_mes(2026, 8, self.ruta)
        historial_antes = cr.obtener_historial("Samanta", ruta=self.ruta)
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]

        for pagado in (True, False, True):
            cr.marcar_pago_del_ciclo("Samanta", pagado, ciclo=cerrado, ruta=self.ruta)
            self.assertEqual(er.obtener_mes(2026, 7, self.ruta), julio_antes)
            self.assertEqual(er.obtener_mes(2026, 8, self.ruta), agosto_antes)
            self.assertEqual(cr.obtener_historial("Samanta", ruta=self.ruta), historial_antes)

    def test_funciona_en_las_tres_modalidades(self):
        # Bono agotado que quedó a deber.
        self.alta("Ana")
        cr.configurar_servicio("Ana", BONO, sesiones_totales=4, precio_total=180,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        self.firmar("Ana", 5, cuando=date(2026, 7, 5))
        # Mensualidad de julio sin cobrar.
        self.alta("Pareja")
        cr.configurar_servicio("Pareja", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        cr.marcar_pago_del_ciclo("Pareja", False, ruta=self.ruta)
        self.firmar("Pareja", 1, cuando=date(2026, 8, 3))
        # Cuenta de julio sin cobrar.
        self.samanta()

        for quien in ("Ana", "Pareja", "Samanta"):
            cerrado = cr.obtener_programas_cliente(quien, ruta=self.ruta)[1]["ciclo_bono"]
            cr.marcar_pago_del_ciclo(quien, True, ciclo=cerrado, ruta=self.ruta)
            self.assertEqual(
                cr.obtener_programas_cliente(quien, ruta=self.ruta)[1]["pagado"], 1,
                f"no se pudo cobrar el servicio cerrado de {quien}",
            )

    def test_la_cuota_de_una_mensualidad_tambien_queda_marcada(self):
        self.alta("Pareja")
        cr.configurar_servicio("Pareja", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        cr.marcar_pago_del_ciclo("Pareja", False, ruta=self.ruta)
        ciclo = cr.obtener_ciclo_actual("Pareja", ruta=self.ruta)["ciclo_bono"]

        cr.marcar_pago_del_ciclo("Pareja", True, ciclo=ciclo, ruta=self.ruta)

        with basedatos.conectar(self.ruta) as conexion:
            cargo = conexion.execute(
                "SELECT pagado FROM cargos_mensuales WHERE cliente = 'Pareja'"
            ).fetchone()
        self.assertEqual(cargo["pagado"], 1)
        # Y la facturación de julio no se ha movido.
        self.assertEqual(er.obtener_mes(2026, 7, self.ruta)["facturacion_total"], 720.0)

    def test_un_ciclo_inventado_se_rechaza(self):
        self.samanta()
        with self.assertRaises(ValueError):
            cr.marcar_pago_del_ciclo("Samanta", True, ciclo=99, ruta=self.ruta)


class TestCobrarDesdeLaWeb(BaseCobro):
    def test_el_historial_ofrece_marcar_cobrado_cada_servicio(self):
        self.samanta()
        html = self.cliente.get("/cliente/Samanta").get_data(as_text=True)
        ciclos = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)
        for ciclo in ciclos:
            self.assertIn(f"/cliente/Samanta/ciclo/{ciclo['ciclo_bono']}/pago", html)

    def test_el_historial_dice_cual_esta_sin_cobrar(self):
        self.samanta()
        texto = self.texto("/cliente/Samanta")
        self.assertIn("Pendiente de cobro", texto)
        self.assertIn("Marcar cobrado", texto)

    def test_marcar_cobrado_desde_la_web(self):
        self.samanta()
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]

        respuesta = self.cliente.post(
            f"/cliente/Samanta/ciclo/{cerrado}/pago", data={"csrf": "t", "pagado": "si"}
        )
        self.assertEqual(respuesta.status_code, 302)
        self.assertEqual(cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["pagado"], 1)

    def test_marcar_cobrado_desde_la_web_no_toca_la_economia(self):
        self.samanta()
        julio = er.obtener_mes(2026, 7, self.ruta)
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]

        self.cliente.post(f"/cliente/Samanta/ciclo/{cerrado}/pago", data={"csrf": "t", "pagado": "si"})

        self.assertEqual(er.obtener_mes(2026, 7, self.ruta), julio)
        self.assertEqual(len(cr.obtener_historial("Samanta", ruta=self.ruta)), 10)

    def test_sin_token_csrf_no_se_cobra_nada(self):
        self.samanta()
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]
        respuesta = self.cliente.post(f"/cliente/Samanta/ciclo/{cerrado}/pago", data={"pagado": "si"})
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["pagado"], 0)


class TestLaListaVeLasDeudasAntiguas(BaseCobro):
    def test_una_deuda_antigua_marca_al_cliente_como_pendiente(self):
        self.samanta()
        # El servicio de ahora está al día...
        self.assertEqual(cr.leer_clientes(self.ruta)["Samanta"]["pendiente_pago"], "No")
        # ...pero debe el de julio, así que la lista lo tiene que decir.
        texto = self.texto("/")
        self.assertIn("Samanta", texto)
        self.assertIn("sin cobrar", texto)

    def test_el_contador_de_pendientes_la_incluye(self):
        self.samanta()
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertRegex(html, r'data-filtro="pendientes"[\s\S]{0,200}?>1<')

    def test_el_filtro_de_pendientes_la_encuentra(self):
        self.samanta()
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertRegex(html, r'data-pendiente="si"[\s\S]{0,400}?Samanta')

    def test_al_cobrarla_deja_de_aparecer_como_pendiente(self):
        self.samanta()
        cerrado = cr.obtener_programas_cliente("Samanta", ruta=self.ruta)[1]["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Samanta", True, ciclo=cerrado, ruta=self.ruta)

        html = self.cliente.get("/").get_data(as_text=True)
        self.assertNotIn('data-pendiente="si"', html)
        self.assertRegex(html, r'data-filtro="pendientes"[\s\S]{0,200}?>0<')

    def test_un_cliente_al_dia_no_aparece_como_pendiente(self):
        self.alta("Rocio")
        cr.configurar_servicio("Rocio", CUENTA, tarifa=35, hoy=date(2026, 8, 1), ruta=self.ruta)
        cr.marcar_pago_del_ciclo("Rocio", True, ruta=self.ruta)
        html = self.cliente.get("/").get_data(as_text=True)
        self.assertNotIn('data-pendiente="si"', html)

    def test_los_servicios_sin_marcar_no_cuentan_como_deuda(self):
        """De los servicios anteriores a esta versión nunca se registró el
        pago. No se supone que se deben."""
        self.alta("Antiguo")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "sesiones_totales, pagado) VALUES ('Antiguo', 1, 'Bono', 'bono', 4, NULL)"
            )
        self.assertEqual(cr.leer_clientes(self.ruta)["Antiguo"]["ciclos_pendientes"], 0)
        self.assertNotIn('data-pendiente="si"', self.cliente.get("/").get_data(as_text=True))

    def test_deuda_pendiente_lista_los_servicios_a_deber(self):
        self.samanta()
        deudas = cr.deuda_pendiente("Samanta", ruta=self.ruta)
        self.assertEqual(len(deudas), 1)
        self.assertEqual(deudas[0]["modalidad"], CUENTA)
        self.assertEqual((deudas[0]["anio"], deudas[0]["mes"]), (2026, 7))


if __name__ == "__main__":
    unittest.main()
