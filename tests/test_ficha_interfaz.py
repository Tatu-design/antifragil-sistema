"""La ficha del cliente vista como la ve Fernando: HTML real (2026-08-04).

Estas pruebas nacen de un fallo que ninguna prueba de lógica detectó y que
encontró Fernando usando la app: el botón «Firmar sesión» dependía de
`sesiones_totales`, que vale 0 en mensualidad y cuenta de cliente porque no
consumen saldo. Resultado: las dos modalidades nuevas se podían configurar
pero NO se podían firmar.

Por eso aquí se pide la página y se comprueba lo que sale, no lo que
devuelven las funciones por dentro.
"""

import os
import re
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp
from urllib.parse import unquote_plus

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra
from servicios.modalidades import BONO, CUENTA, MENSUALIDAD


class BaseFichaWeb(unittest.TestCase):
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
                      "asegurar_ciclos_mensuales", "registrar_sesion_pt", "marcar_pago_del_ciclo")
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
        webapp.registrar_sesion_pt = lambda n, clave_idempotencia=None, r=bd: (
            ra.registrar_sesion_pt(n, clave_idempotencia=clave_idempotencia, ruta=bd)
        )
        webapp.marcar_pago_del_ciclo = lambda n, pagado, r=bd: cr.marcar_pago_del_ciclo(n, pagado, ruta=bd)
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

    # ----- ayudas -----

    def alta(self, nombre, estado="activo"):
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, "
                "ciclo_bono, estado, token) VALUES (?, 'Base', 0, 0, 1, ?, ?)",
                (nombre, estado, "tok-" + nombre),
            )

    def bono(self, nombre="Ana", sesiones=5, precio=225, estado="activo"):
        self.alta(nombre, estado)
        cr.configurar_servicio(nombre, BONO, nombre_servicio="Bono", sesiones_totales=sesiones,
                               precio_total=precio, hoy=date(2026, 8, 3), ruta=self.ruta)

    def mensualidad(self, nombre="Pareja", cuota=720, referencia=12, estado="activo"):
        self.alta(nombre, estado)
        cr.configurar_servicio(nombre, MENSUALIDAD, nombre_servicio="Mensualidad", cuota_mensual=cuota,
                               sesiones_referencia=referencia, hoy=date(2026, 8, 3), ruta=self.ruta)

    def cuenta(self, nombre="Sami", precio=35, estado="activo"):
        self.alta(nombre, estado)
        cr.configurar_servicio(nombre, CUENTA, nombre_servicio="Cuenta", tarifa=precio,
                               hoy=date(2026, 8, 3), ruta=self.ruta)

    def firmar(self, nombre, veces=1, cuando=date(2026, 8, 3)):
        for _ in range(veces):
            ra.registrar_sesion_pt(nombre, fecha=cuando, ruta=self.ruta)

    def html(self, nombre):
        return self.cliente.get(f"/cliente/{nombre}").get_data(as_text=True)

    def texto(self, nombre):
        html = self.html(nombre)
        html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
        html = re.sub(r"<svg.*?</svg>", " ", html, flags=re.S)
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))

    def hay_boton_firmar(self, nombre):
        return f"/cliente/{nombre}/firmar" in self.html(nombre)


class TestBotonFirmar(BaseFichaWeb):
    """El fallo que encontró Fernando: el botón faltaba en dos de tres."""

    def test_un_bono_activo_ensena_el_boton(self):
        self.bono("Ana")
        self.assertTrue(self.hay_boton_firmar("Ana"))
        self.assertIn("Firmar sesión", self.texto("Ana"))

    def test_una_mensualidad_activa_ensena_el_boton(self):
        self.mensualidad("Pareja")
        self.assertTrue(self.hay_boton_firmar("Pareja"),
                        "una mensualidad no tiene sesiones_totales y aun así debe poder firmar")

    def test_una_cuenta_activa_ensena_el_boton(self):
        self.cuenta("Sami")
        self.assertTrue(self.hay_boton_firmar("Sami"),
                        "una cuenta no tiene sesiones_totales y aun así debe poder firmar")

    def test_un_pausado_no_ensena_el_boton_en_ninguna_modalidad(self):
        self.bono("Ana", estado="pausado")
        self.mensualidad("Pareja", estado="pausado")
        self.cuenta("Sami", estado="pausado")
        for nombre in ("Ana", "Pareja", "Sami"):
            self.assertFalse(self.hay_boton_firmar(nombre), f"{nombre} está pausado")

    def test_un_cancelado_no_ensena_el_boton_en_ninguna_modalidad(self):
        self.bono("Ana", estado="cancelado")
        self.mensualidad("Pareja", estado="cancelado")
        self.cuenta("Sami", estado="cancelado")
        for nombre in ("Ana", "Pareja", "Sami"):
            self.assertFalse(self.hay_boton_firmar(nombre), f"{nombre} está cancelado")

    def test_una_mensualidad_sin_cuota_dice_exactamente_que_falta(self):
        self.alta("Pareja")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "sesiones_totales, anio, mes) VALUES ('Pareja', 1, 'Mensualidad', 'mensualidad', 0, 2026, 8)"
            )
        self.assertFalse(self.hay_boton_firmar("Pareja"))
        self.assertIn("la cuota mensual", self.texto("Pareja"))

    def test_una_cuenta_sin_precio_dice_exactamente_que_falta(self):
        self.alta("Sami")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "sesiones_totales, anio, mes) VALUES ('Sami', 1, 'Cuenta', 'cuenta', 0, 2026, 8)"
            )
        self.assertFalse(self.hay_boton_firmar("Sami"))
        self.assertIn("el precio por sesión", self.texto("Sami"))

    def test_un_bono_sin_sesiones_dice_exactamente_que_falta(self):
        self.alta("Ana")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "sesiones_totales) VALUES ('Ana', 1, 'Bono', 'bono', 0)"
            )
        self.assertFalse(self.hay_boton_firmar("Ana"))
        self.assertIn("el número de sesiones del bono", self.texto("Ana"))


class TestServidorBloquea(BaseFichaWeb):
    """Esconder el botón no basta: la ruta POST también tiene que negarse."""

    def _post_firmar(self, nombre):
        return self.cliente.post(f"/cliente/{nombre}/firmar",
                                 data={"csrf": "t", "clave_idempotencia": "k"})

    def test_pausado_rechazado_y_sin_tocar_nada(self):
        self.mensualidad("Pareja", estado="pausado")
        antes = er.obtener_mes(2026, 8, self.ruta)
        respuesta = self._post_firmar("Pareja")

        self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(cr.obtener_historial("Pareja", ruta=self.ruta), [])
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta), antes)

    def test_cancelado_rechazado_y_sin_tocar_nada(self):
        self.cuenta("Sami", estado="cancelado")
        respuesta = self._post_firmar("Sami")
        self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(cr.obtener_historial("Sami", ruta=self.ruta), [])

    def test_servicio_incompleto_rechazado_por_el_servidor(self):
        self.alta("Pareja")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "sesiones_totales, anio, mes) VALUES ('Pareja', 1, 'Mensualidad', 'mensualidad', 0, 2026, 8)"
            )
        respuesta = self._post_firmar("Pareja")
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn("cuota mensual", respuesta.get_data(as_text=True))
        self.assertEqual(cr.obtener_historial("Pareja", ruta=self.ruta), [])

    def test_una_mensualidad_activa_si_puede_firmar_por_la_ruta(self):
        self.mensualidad("Pareja")
        respuesta = self._post_firmar("Pareja")
        self.assertEqual(respuesta.status_code, 302)
        self.assertEqual(len(cr.obtener_historial("Pareja", ruta=self.ruta)), 1)

    def test_una_cuenta_activa_si_puede_firmar_por_la_ruta(self):
        self.cuenta("Sami")
        respuesta = self._post_firmar("Sami")
        self.assertEqual(respuesta.status_code, 302)
        self.assertEqual(len(cr.obtener_historial("Sami", ruta=self.ruta)), 1)


class TestMensajeTrasFirmar(BaseFichaWeb):
    def _mensaje(self, nombre):
        respuesta = self.cliente.post(f"/cliente/{nombre}/firmar",
                                      data={"csrf": "t", "clave_idempotencia": "k"})
        # `unquote` no deshace los '+' que la URL usa como espacios.
        return unquote_plus(respuesta.headers["Location"])

    def test_bono_dice_sesion_x_de_y(self):
        self.bono("Ana", sesiones=5, precio=225)
        self.firmar("Ana", 2)
        self.assertIn("sesión 3 de 5", self._mensaje("Ana"))

    def test_mensualidad_no_dice_de_cero(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 2)
        mensaje = self._mensaje("Pareja")
        self.assertIn("sesión 3", mensaje)
        self.assertIn("agosto", mensaje)
        self.assertNotRegex(mensaje, r"de 0", "nunca debe salir «de 0»")

    def test_cuenta_no_dice_de_cero(self):
        self.cuenta("Sami")
        self.firmar("Sami", 2)
        mensaje = self._mensaje("Sami")
        self.assertIn("sesión 3", mensaje)
        self.assertIn("agosto", mensaje)
        self.assertNotRegex(mensaje, r"de 0", "nunca debe salir «de 0»")


class TestTarjetaPorModalidad(BaseFichaWeb):
    def test_bono_ensena_hechas_y_total_sin_de_cero(self):
        self.bono("Ana", sesiones=5, precio=225)
        self.firmar("Ana", 3)
        texto = self.texto("Ana")

        self.assertIn("3 de 5 sesiones", texto)
        self.assertIn("Quedan 2", texto)
        self.assertIn("225,00 €", texto)
        self.assertIn("45,00 €", texto)
        self.assertNotRegex(texto, r"de 0", "nunca debe salir «de 0»")

    def test_mensualidad_sin_barra_y_con_cuota(self):
        self.mensualidad("Pareja", cuota=720, referencia=12)
        self.firmar("Pareja", 3)
        texto = self.texto("Pareja")

        self.assertIn("3 sesiones este mes", texto)
        self.assertIn("12 de referencia", texto)
        self.assertIn("720,00 €", texto)
        self.assertNotIn("Quedan", texto)
        self.assertNotRegex(texto, r"de 0", "nunca debe salir «de 0»")
        self.assertNotIn("perfil-progreso-barra", self.html("Pareja"))

    def test_cuenta_ensena_total_del_mes_y_su_calculo(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        texto = self.texto("Sami")

        self.assertIn("Precio por sesión", texto)
        self.assertIn("Total del mes", texto)
        self.assertNotIn("Acumulado", texto)
        self.assertIn("280,00 €", texto)
        self.assertRegex(texto, r"8 sesiones\s*×\s*35,00 €\s*=\s*280,00 €")
        self.assertNotIn("Quedan", texto)
        self.assertNotIn("perfil-progreso-barra", self.html("Sami"))

    def test_un_servicio_nuevo_nace_pendiente_de_pago(self):
        """Nadie ha confirmado que se pagara: nace debiendo (2026-08-05).

        «Nuevo» es un servicio que se ABRE: un alta, un cambio de modalidad o
        una renovación. Aquí los clientes parten de un bono al día, así que
        cambiarles la modalidad abre uno nuevo y ese sí nace pendiente."""
        self.mensualidad("Pareja")   # el cliente venía de un bono: se abre una mensualidad
        self.cuenta("Sami")          # idem, se abre una cuenta

        self.assertIn("Pago pendiente", self.texto("Pareja"))
        self.assertIn("Pendiente de pago", self.texto("Sami"))

    def test_corregir_las_condiciones_no_reabre_la_deuda(self):
        """Cambiar el precio de un bono NO es un servicio nuevo: es la misma
        contratación con los números bien puestos. Si estaba cobrado, sigue
        cobrado — reabrir la deuda ahí sería inventar un impago."""
        self.bono("Ana", sesiones=5, precio=225)
        self.assertIn("Bono pagado", self.texto("Ana"))

        cr.configurar_servicio("Ana", BONO, nombre_servicio="Bono",
                               sesiones_totales=5, precio_total=250,
                               hoy=date(2026, 8, 10), ruta=self.ruta)

        self.assertIn("Bono pagado", self.texto("Ana"))

    def test_el_texto_del_pago_cambia_con_la_modalidad(self):
        self.bono("Ana")
        self.mensualidad("Pareja")
        self.cuenta("Sami")
        # Los tres nacen pendientes, así que hay que cobrarlos a mano: es
        # justamente la regla — un servicio solo pasa a pagado con una acción
        # explícita, nunca por nacer ni por heredarlo (2026-08-05).
        for quien in ("Ana", "Pareja", "Sami"):
            cr.marcar_pago_del_ciclo(quien, True, ruta=self.ruta)

        self.assertIn("Bono pagado", self.texto("Ana"))
        self.assertIn("Mensualidad pagada", self.texto("Pareja"))
        self.assertIn("Cuenta pagada", self.texto("Sami"))
        for nombre in ("Ana", "Pareja", "Sami"):
            self.assertNotIn("Programa pagado", self.texto(nombre))

    def test_el_texto_del_pago_pendiente_tambien(self):
        self.bono("Ana")
        self.cuenta("Sami")
        cr.marcar_pago_del_ciclo("Ana", False, ruta=self.ruta)
        cr.marcar_pago_del_ciclo("Sami", False, ruta=self.ruta)
        self.assertIn("Pago pendiente", self.texto("Ana"))
        self.assertIn("Pendiente de pago", self.texto("Sami"))

    def test_no_se_llama_bono_a_lo_que_no_lo_es(self):
        self.mensualidad("Pareja", estado="pausado")
        texto = self.texto("Pareja")
        self.assertIn("Su servicio y su historial se conservan intactos", texto)
        self.assertNotIn("Su bono y su historial", texto)


class TestLaFichaLeeDelCiclo(BaseFichaWeb):
    """Si el formulario guarda bien pero la pantalla lee lo viejo, no vale."""

    def test_cambiar_las_condiciones_se_ve_al_momento(self):
        self.bono("Ana", sesiones=5, precio=225)
        self.firmar("Ana", 2)
        self.assertIn("2 de 5 sesiones", self.texto("Ana"))

        cr.configurar_servicio("Ana", BONO, nombre_servicio="Bono ampliado",
                               sesiones_totales=10, precio_total=400,
                               hoy=date(2026, 8, 10), ruta=self.ruta)
        texto = self.texto("Ana")
        self.assertIn("2 de 10 sesiones", texto)
        self.assertIn("400,00 €", texto)
        self.assertIn("40,00 €", texto)   # 400 / 10
        self.assertIn("Bono ampliado", texto)

    def test_cambiar_de_modalidad_se_ve_al_momento(self):
        self.bono("Ana", sesiones=5, precio=225)
        self.firmar("Ana", 2)
        cr.configurar_servicio("Ana", MENSUALIDAD, nombre_servicio="Mensualidad",
                               cuota_mensual=600, hoy=date(2026, 8, 10), ruta=self.ruta)

        texto = self.texto("Ana")
        self.assertIn("Mensualidad", texto)
        self.assertIn("600,00 €", texto)
        self.assertNotIn("Quedan", texto)
        self.assertTrue(self.hay_boton_firmar("Ana"))

    def test_el_pago_no_puede_contradecirse_entre_ficha_y_ciclo(self):
        self.mensualidad("Pareja")
        cr.marcar_pago_del_ciclo("Pareja", False, ruta=self.ruta)

        self.assertEqual(cr.leer_clientes(self.ruta)["Pareja"]["pendiente_pago"], "Sí")
        self.assertEqual(cr.obtener_ciclo_actual("Pareja", ruta=self.ruta)["pagado"], 0)
        self.assertIn("Pago pendiente", self.texto("Pareja"))

        cr.marcar_pago_del_ciclo("Pareja", True, ruta=self.ruta)
        self.assertEqual(cr.obtener_ciclo_actual("Pareja", ruta=self.ruta)["pagado"], 1)
        self.assertIn("Mensualidad pagada", self.texto("Pareja"))


class TestEconomiaDeLosTresEjemplos(BaseFichaWeb):
    """Los tres casos exactos del encargo de Fernando."""

    def test_bono_tres_sesiones_de_225_entre_5(self):
        self.bono("Ana", sesiones=5, precio=225)
        self.firmar("Ana", 3)
        mes = er.obtener_mes(2026, 8, self.ruta)

        self.assertEqual(mes["horas_totales"], 3)
        self.assertEqual(mes["facturacion_total"], 135.0)
        self.assertIn("3 de 5 sesiones", self.texto("Ana"))

    def test_mensualidad_cuota_720_con_tres_firmas(self):
        self.mensualidad("Pareja", cuota=720)
        self.firmar("Pareja", 3)
        mes = er.obtener_mes(2026, 8, self.ruta)

        self.assertEqual(mes["horas_totales"], 3)
        self.assertEqual(mes["facturacion_total"], 720.0)
        self.assertEqual(len(cr.obtener_historial("Pareja", ruta=self.ruta)), 3)
        # Ni un euro de más por las firmas.
        for sesion in cr.obtener_historial("Pareja", ruta=self.ruta):
            self.assertIsNone(sesion["tarifa"])

    def test_cuenta_tres_firmas_a_35(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 3)
        mes = er.obtener_mes(2026, 8, self.ruta)

        self.assertEqual(mes["horas_totales"], 3)
        self.assertEqual(mes["facturacion_total"], 105.0)
        self.assertIn("105,00 €", self.texto("Sami"))

        # Cobrar o no cobrar no cambia esos 105 €.
        for pagado in (True, False, True):
            cr.marcar_pago_del_ciclo("Sami", pagado, ruta=self.ruta)
            self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_total"], 105.0)
            self.assertEqual(len(cr.obtener_historial("Sami", ruta=self.ruta)), 3)


if __name__ == "__main__":
    unittest.main()
