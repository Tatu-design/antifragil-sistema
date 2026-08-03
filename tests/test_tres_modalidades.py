"""Las tres modalidades de punta a punta: firma, ciclos, economía y
pantalla (2026-08-03).

Aquí se comprueba lo que de verdad importa del negocio:

- Un bono se consume y renueva; una mensualidad y una cuenta no.
- Una mensualidad factura su cuota entera aunque se hagan 9, 12 o 13
  sesiones, y sus sesiones suman HORAS pero no dinero.
- Una cuenta suma su precio por cada sesión, sin tope.
- Cambiar el estado de pago nunca mueve la facturación.
- Cambiar de modalidad cierra el ciclo y no toca nada del pasado.
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


class BaseModalidades(unittest.TestCase):
    """Base de datos nueva por prueba. Nunca la real."""

    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES ('Base', 45.0, 4)")
        self.addCleanup(self._borrar)

    def _borrar(self):
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                pass

    def alta(self, nombre: str, estado: str = "activo"):
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas, pendiente_pago, "
                "ciclo_bono, estado, token) VALUES (?, 'Base', 0, 0, 1, ?, ?)",
                (nombre, estado, "tok-" + nombre),
            )

    def bono(self, nombre, sesiones=8, precio=360, cuando=date(2026, 8, 3)):
        self.alta(nombre)
        cr.configurar_servicio(nombre, BONO, nombre_servicio="Bono", sesiones_totales=sesiones,
                               precio_total=precio, hoy=cuando, ruta=self.ruta)

    def mensualidad(self, nombre, cuota=720, referencia=12, cuando=date(2026, 8, 3), estado="activo"):
        self.alta(nombre, estado)
        cr.configurar_servicio(nombre, MENSUALIDAD, nombre_servicio="Mensualidad", cuota_mensual=cuota,
                               sesiones_referencia=referencia, hoy=cuando, ruta=self.ruta)

    def cuenta(self, nombre, precio=35, cuando=date(2026, 8, 3)):
        self.alta(nombre)
        cr.configurar_servicio(nombre, CUENTA, nombre_servicio="Cuenta", tarifa=precio,
                               hoy=cuando, ruta=self.ruta)

    def firmar(self, nombre, veces=1, cuando=date(2026, 8, 3)):
        for _ in range(veces):
            ra.registrar_sesion_pt(nombre, fecha=cuando, ruta=self.ruta)

    def mes(self, anio=2026, numero=8):
        return er.obtener_mes(anio, numero, self.ruta)


class TestBono(BaseModalidades):
    def test_firmar_consume_una_sesion(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        self.assertEqual(cr.leer_clientes(self.ruta)["Ana"]["sesiones_completadas"], 3)

    def test_firmar_suma_una_hora_y_su_tarifa(self):
        self.bono("Ana", sesiones=8, precio=360)  # 45 € la sesión
        self.firmar("Ana", 3)
        self.assertEqual(self.mes()["facturacion_total"], 135.0)
        self.assertEqual(self.mes()["horas_totales"], 3)

    def test_la_ultima_sesion_cierra_el_bono_y_abre_otro(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 4)
        ciclos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        self.assertIsNotNone(ciclos[1]["fecha_fin"])   # el que se agotó
        self.assertIsNone(ciclos[0]["fecha_fin"])      # el nuevo, abierto

    def test_el_bono_nuevo_nace_pendiente_de_pago(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 4)
        self.assertEqual(cr.leer_clientes(self.ruta)["Ana"]["pendiente_pago"], "Sí")

    def test_dos_bonos_iguales_seguidos_no_se_mezclan(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 6)
        ciclos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual([len(c["sesiones"]) for c in ciclos], [2, 4])

    def test_el_bono_nuevo_hereda_las_condiciones(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 5)
        actual = cr.obtener_ciclo_actual("Ana", ruta=self.ruta)
        self.assertEqual(actual["modalidad"], BONO)
        self.assertEqual(actual["tarifa"], 45.0)
        self.assertEqual(actual["sesiones_totales"], 4)

    def test_cambiar_el_pago_no_mueve_la_economia(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        antes = self.mes()
        cr.marcar_pendiente_pago("Ana", True, ruta=self.ruta)
        self.assertEqual(self.mes(), antes)


class TestMensualidad(BaseModalidades):
    def test_crear_el_ciclo_cobra_la_cuota_una_sola_vez(self):
        self.mensualidad("Pareja")
        self.assertEqual(self.mes()["facturacion_total"], 720.0)
        self.assertEqual(self.mes()["cuotas"], 1)

    def test_abrir_el_perfil_muchas_veces_no_duplica_la_cuota(self):
        self.mensualidad("Pareja")
        for _ in range(10):
            cr.asegurar_ciclo_mensual("Pareja", 2026, 8, ruta=self.ruta)
            cr.asegurar_ciclos_mensuales(2026, 8, ruta=self.ruta)
        self.assertEqual(self.mes()["facturacion_total"], 720.0)
        self.assertEqual(self.mes()["cuotas"], 1)

    def test_firmar_suma_hora_pero_no_dinero(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 5)
        # La cuota es la misma; lo único que sube son las horas.
        self.assertEqual(self.mes()["facturacion_total"], 720.0)
        self.assertEqual(self.mes()["horas_totales"], 5)

    def test_se_puede_firmar_la_sesion_trece_y_siguientes(self):
        self.mensualidad("Pareja", referencia=12)
        self.firmar("Pareja", 14)
        self.assertEqual(len(cr.obtener_historial("Pareja", ruta=self.ruta)), 14)
        self.assertEqual(self.mes()["facturacion_total"], 720.0)

    def test_no_hay_renovacion_por_numero_de_sesiones(self):
        self.mensualidad("Pareja", referencia=12)
        self.firmar("Pareja", 20)
        # Un solo ciclo: 20 sesiones no lo renuevan.
        self.assertEqual(len(cr.obtener_programas_cliente("Pareja", ruta=self.ruta)), 1)

    def test_las_sesiones_no_llevan_importe(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 3)
        for sesion in cr.obtener_historial("Pareja", ruta=self.ruta):
            self.assertIsNone(sesion["tarifa"], "una sesión de mensualidad no puede llevar precio")

    def test_precio_efectivo_con_9_12_y_13_sesiones(self):
        from servicios.modalidades import precio_efectivo
        self.assertEqual(precio_efectivo(720, 9), 80.0)
        self.assertEqual(precio_efectivo(720, 12), 60.0)
        self.assertEqual(precio_efectivo(720, 13), 55.38)

    def test_al_cambiar_de_mes_se_abre_otro_ciclo(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 12)
        self.firmar("Pareja", 1, cuando=date(2026, 9, 1))

        ciclos = cr.obtener_programas_cliente("Pareja", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        self.assertEqual((ciclos[0]["anio"], ciclos[0]["mes"]), (2026, 9))
        self.assertEqual((ciclos[1]["anio"], ciclos[1]["mes"]), (2026, 8))

    def test_el_mes_anterior_queda_congelado(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 12)
        agosto = self.mes()
        self.firmar("Pareja", 1, cuando=date(2026, 9, 1))

        self.assertEqual(self.mes(), agosto, "agosto no puede moverse al abrir septiembre")
        self.assertEqual(self.mes(2026, 9)["facturacion_total"], 720.0)

    def test_el_ciclo_cerrado_conserva_sus_sesiones_y_su_cuota(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 9)
        self.firmar("Pareja", 1, cuando=date(2026, 9, 1))

        anterior = cr.obtener_programas_cliente("Pareja", ruta=self.ruta)[1]
        self.assertEqual(len(anterior["sesiones"]), 9)
        self.assertEqual(anterior["cuota_mensual"], 720.0)
        self.assertEqual(anterior["sesiones_referencia"], 12)
        self.assertIsNotNone(anterior["fecha_fin"])

    def test_cambiar_el_pago_no_mueve_la_economia(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 4)
        antes = self.mes()
        cr.marcar_pendiente_pago("Pareja", True, ruta=self.ruta)
        self.assertEqual(self.mes(), antes)
        cr.marcar_pendiente_pago("Pareja", False, ruta=self.ruta)
        self.assertEqual(self.mes(), antes)

    def test_un_cliente_pausado_no_genera_cuota(self):
        """Cobrar a quien ha dejado de entrenar sería inventar ingresos."""
        self.mensualidad("Pareja", estado="pausado")
        self.assertIsNone(self.mes())

    def test_dos_llamadas_a_la_vez_no_crean_dos_mensualidades(self):
        """Lo impide la clave primaria de la tabla, no el código que llama."""
        self.mensualidad("Pareja")
        with basedatos.conectar(self.ruta) as conexion:
            with self.assertRaises(basedatos.sqlite3.IntegrityError):
                conexion.execute(
                    "INSERT INTO cargos_mensuales (cliente, anio, mes, concepto, ciclo, importe) "
                    "VALUES ('Pareja', 2026, 8, 'mensualidad', 99, 720)"
                )


class TestCuentaDeCliente(BaseModalidades):
    def test_cada_firma_suma_una_hora_y_su_precio(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 1)
        self.assertEqual(self.mes()["facturacion_total"], 35.0)
        self.assertEqual(self.mes()["horas_totales"], 1)

    def test_ocho_sesiones_a_35_son_280(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        self.assertEqual(self.mes()["facturacion_total"], 280.0)

    def test_diez_sesiones_a_35_son_350(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 10)
        self.assertEqual(self.mes()["facturacion_total"], 350.0)

    def test_no_hay_limite_de_sesiones(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 30)
        self.assertEqual(len(cr.obtener_programas_cliente("Sami", ruta=self.ruta)), 1)
        self.assertEqual(self.mes()["facturacion_total"], 1050.0)

    def test_al_cambiar_de_mes_se_abre_otro_periodo(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        self.firmar("Sami", 2, cuando=date(2026, 9, 1))

        ciclos = cr.obtener_programas_cliente("Sami", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        self.assertEqual(len(ciclos[0]["sesiones"]), 2)
        self.assertEqual(len(ciclos[1]["sesiones"]), 8)

    def test_el_periodo_anterior_conserva_su_total(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        self.firmar("Sami", 2, cuando=date(2026, 9, 1))

        self.assertEqual(self.mes(2026, 8)["facturacion_total"], 280.0)
        self.assertEqual(self.mes(2026, 9)["facturacion_total"], 70.0)

    def test_dos_periodos_consecutivos_no_se_mezclan(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 3)
        self.firmar("Sami", 3, cuando=date(2026, 9, 1))
        ciclos = cr.obtener_programas_cliente("Sami", ruta=self.ruta)
        self.assertEqual((ciclos[0]["anio"], ciclos[0]["mes"]), (2026, 9))
        self.assertEqual((ciclos[1]["anio"], ciclos[1]["mes"]), (2026, 8))

    def test_marcar_pagado_no_cambia_nada_economico(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        antes = self.mes()
        cr.marcar_pendiente_pago("Sami", False, ruta=self.ruta)
        self.assertEqual(self.mes(), antes)
        self.assertEqual(len(cr.obtener_historial("Sami", ruta=self.ruta)), 8)


class TestCambioDeModalidad(BaseModalidades):
    def test_de_bono_a_mensualidad_conserva_el_bono_historico(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        cr.configurar_servicio("Ana", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 8, 10), ruta=self.ruta)

        ciclos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        anterior = ciclos[1]
        self.assertEqual(anterior["modalidad"], BONO)
        self.assertEqual(len(anterior["sesiones"]), 3)
        self.assertEqual(anterior["tarifa"], 45.0)
        self.assertIsNotNone(anterior["fecha_fin"])

    def test_no_se_recalcula_la_economia_antigua(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        facturacion_antes = self.mes()["facturacion_total"]

        cr.configurar_servicio("Ana", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 8, 10), ruta=self.ruta)

        # Las 3 sesiones del bono siguen valiendo lo mismo; la cuota se suma
        # encima, no en lugar de.
        self.assertEqual(self.mes()["facturacion_total"], facturacion_antes + 720)
        for sesion in cr.obtener_historial("Ana", ruta=self.ruta):
            self.assertEqual(sesion["tarifa"], 45.0)

    def test_no_se_trasladan_sesiones_al_ciclo_nuevo(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        cr.configurar_servicio("Ana", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 8, 10), ruta=self.ruta)
        self.assertEqual(len(cr.obtener_programas_cliente("Ana", ruta=self.ruta)[0]["sesiones"]), 0)

    def test_de_mensualidad_a_cuenta_conserva_la_mensualidad(self):
        self.mensualidad("Pareja")
        self.firmar("Pareja", 5)
        cr.configurar_servicio("Pareja", CUENTA, tarifa=60, hoy=date(2026, 8, 20), ruta=self.ruta)

        ciclos = cr.obtener_programas_cliente("Pareja", ruta=self.ruta)
        self.assertEqual(ciclos[1]["modalidad"], MENSUALIDAD)
        self.assertEqual(ciclos[1]["cuota_mensual"], 720.0)
        self.assertEqual(len(ciclos[1]["sesiones"]), 5)
        self.assertEqual(ciclos[0]["modalidad"], CUENTA)
        # La cuota de agosto ya cobrada no se devuelve al cambiar de modalidad.
        self.assertEqual(self.mes()["facturacion_total"], 720.0)

    def test_corregir_condiciones_sin_cambiar_modalidad_no_abre_ciclo(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 2)
        cr.configurar_servicio("Ana", BONO, sesiones_totales=8, precio_total=400,
                               hoy=date(2026, 8, 10), ruta=self.ruta)

        ciclos = cr.obtener_programas_cliente("Ana", ruta=self.ruta)
        self.assertEqual(len(ciclos), 1, "corregir un precio no abre un servicio nuevo")
        self.assertEqual(ciclos[0]["precio_total"], 400.0)
        # Y las sesiones ya firmadas conservan su tarifa histórica.
        for sesion in cr.obtener_historial("Ana", ruta=self.ruta):
            self.assertEqual(sesion["tarifa"], 45.0)


class TestEconomiaMensual(BaseModalidades):
    def _las_tres(self):
        self.bono("Ana", sesiones=8, precio=360)      # 45 €/sesión
        self.mensualidad("Pareja", cuota=720)
        self.cuenta("Sami", precio=35)
        self.firmar("Ana", 3)       # 135 €, 3 h
        self.firmar("Pareja", 13)   # 720 € (cuota), 13 h
        self.firmar("Sami", 8)      # 280 €, 8 h

    def test_suma_correctamente_las_tres_modalidades(self):
        self._las_tres()
        self.assertEqual(self.mes()["facturacion_total"], 1135.0)

    def test_las_horas_reales_son_todas(self):
        self._las_tres()
        self.assertEqual(self.mes()["horas_totales"], 24)

    def test_el_precio_medio_sale_de_dividir(self):
        self._las_tres()
        self.assertAlmostEqual(self.mes()["precio_medio_hora"], 1135 / 24, places=4)

    def test_sin_horas_no_hay_division_por_cero(self):
        self.mensualidad("Pareja")  # cuota sin ninguna sesión todavía
        self.assertEqual(self.mes()["horas_totales"], 0)
        self.assertEqual(self.mes()["precio_medio_hora"], 0.0)

    def test_el_desglose_separa_las_tres(self):
        self._las_tres()
        desglose = self.mes()["por_modalidad"]
        self.assertEqual(desglose["bono"], {"horas": 3, "facturacion": 135.0})
        self.assertEqual(desglose["cuenta"], {"horas": 8, "facturacion": 280.0})
        self.assertEqual(desglose["mensualidad"], {"horas": 13, "facturacion": 720.0})

    def test_el_estado_de_pago_no_altera_la_facturacion(self):
        self._las_tres()
        antes = self.mes()
        for quien in ("Ana", "Pareja", "Sami"):
            cr.marcar_pendiente_pago(quien, True, ruta=self.ruta)
        self.assertEqual(self.mes(), antes)

    def test_consultar_la_economia_no_escribe_ni_duplica(self):
        self._las_tres()
        with basedatos.conectar(self.ruta) as conexion:
            antes = conexion.execute("SELECT COUNT(*) AS n FROM cargos_mensuales").fetchone()["n"]
        for _ in range(5):
            er.listar_meses(self.ruta)
            er.obtener_mes(2026, 8, self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            despues = conexion.execute("SELECT COUNT(*) AS n FROM cargos_mensuales").fetchone()["n"]
        self.assertEqual(antes, despues)


class TestIntegridad(BaseModalidades):
    def test_ninguna_sesion_se_queda_sin_ciclo(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.mensualidad("Pareja")
        self.cuenta("Sami", precio=35)
        self.firmar("Ana", 5)
        self.firmar("Pareja", 3)
        self.firmar("Sami", 3)

        with basedatos.conectar(self.ruta) as conexion:
            huerfanas = conexion.execute(
                "SELECT COUNT(*) AS n FROM historial_sesiones h "
                "WHERE NOT EXISTS (SELECT 1 FROM programas_cliente pc "
                "                   WHERE pc.cliente = h.cliente AND pc.ciclo_bono = h.ciclo_bono)"
            ).fetchone()["n"]
            self.assertEqual(huerfanas, 0)

    def test_ningun_ciclo_se_queda_sin_cliente(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 4)
        with basedatos.conectar(self.ruta) as conexion:
            self.assertEqual(len(conexion.execute("PRAGMA foreign_key_check").fetchall()), 0)

    def test_no_hay_cargos_mensuales_duplicados(self):
        self.mensualidad("Pareja")
        for mes in (8, 9, 10):
            cr.asegurar_ciclos_mensuales(2026, mes, ruta=self.ruta)
            cr.asegurar_ciclos_mensuales(2026, mes, ruta=self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            repetidos = conexion.execute(
                "SELECT COUNT(*) AS n FROM (SELECT cliente, anio, mes, concepto FROM cargos_mensuales "
                "GROUP BY 1,2,3,4 HAVING COUNT(*) > 1)"
            ).fetchone()["n"]
        self.assertEqual(repetidos, 0)

    def test_la_idempotencia_de_la_firma_sigue_funcionando(self):
        self.cuenta("Sami", precio=35)
        for _ in range(3):
            ra.registrar_sesion_pt("Sami", fecha=date(2026, 8, 3),
                                   clave_idempotencia="misma-clave", ruta=self.ruta)
        self.assertEqual(len(cr.obtener_historial("Sami", ruta=self.ruta)), 1)

    def test_bonos_y_cuentas_siguen_cuadrando_con_el_historial(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.cuenta("Sami", precio=35)
        self.firmar("Ana", 3)
        self.firmar("Sami", 8)

        with basedatos.conectar(self.ruta) as conexion:
            suma = conexion.execute(
                "SELECT COALESCE(SUM(tarifa), 0) AS s FROM historial_sesiones WHERE fecha LIKE '2026-08-%'"
            ).fetchone()["s"]
        # Sin mensualidades, el dinero del mes es exactamente el de las sesiones.
        self.assertEqual(self.mes()["facturacion_total"], suma)

    def test_la_mensualidad_cuadra_por_cuota_mas_horas(self):
        self.mensualidad("Pareja", cuota=720)
        self.firmar("Pareja", 11)
        mes = self.mes()
        # Ni una sesión ficticia: 11 horas reales y el dinero solo de la cuota.
        self.assertEqual(mes["horas_totales"], 11)
        self.assertEqual(mes["facturacion_total"], 720.0)
        self.assertEqual(mes["facturacion_cuotas"], 720.0)


class TestPantallaPorModalidad(BaseModalidades):
    """La ficha tiene que cambiar de forma según la modalidad."""

    def setUp(self):
        super().setUp()
        import webapp.app as webapp

        self.webapp = webapp
        self._originales = {
            n: getattr(webapp, n)
            for n in ("leer_clientes", "obtener_historial", "obtener_programas_cliente",
                      "obtener_ciclo_actual", "avisar_confirmaciones_pendientes", "contar_no_leidos",
                      "hay_sesion_pendiente_de_confirmar", "confirmaciones_de_hoy",
                      "asegurar_ciclos_mensuales", "hoy_negocio")
        }
        ruta = self.ruta
        webapp.leer_clientes = lambda r=ruta: cr.leer_clientes(ruta)
        webapp.obtener_historial = lambda n, r=ruta: cr.obtener_historial(n, ruta=ruta)
        webapp.obtener_programas_cliente = lambda n, r=ruta: cr.obtener_programas_cliente(n, ruta=ruta)
        webapp.obtener_ciclo_actual = lambda n, conexion=None, r=ruta: cr.obtener_ciclo_actual(n, ruta=ruta)
        webapp.avisar_confirmaciones_pendientes = lambda r=ruta: None
        webapp.contar_no_leidos = lambda r=ruta: 0
        webapp.hay_sesion_pendiente_de_confirmar = lambda n, r=ruta: False
        webapp.confirmaciones_de_hoy = lambda n, r=ruta: []
        webapp.asegurar_ciclos_mensuales = lambda anio, mes, r=ruta: None
        self.addCleanup(self._restaurar)

        webapp.app.config["TESTING"] = True
        self.cliente = webapp.app.test_client()
        with self.cliente.session_transaction() as sesion:
            sesion["autenticado"] = True
            sesion["csrf"] = "t"

    def _restaurar(self):
        for nombre, funcion in self._originales.items():
            setattr(self.webapp, nombre, funcion)

    def _texto(self, ruta_web: str) -> str:
        html = self.cliente.get(ruta_web).get_data(as_text=True)
        html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
        html = re.sub(r"<svg.*?</svg>", " ", html, flags=re.S)
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))

    def test_el_bono_enseña_restantes_y_barra(self):
        self.bono("Ana", sesiones=8, precio=360)
        self.firmar("Ana", 3)
        texto = self._texto("/cliente/Ana")
        self.assertIn("3 de 8 sesiones", texto)
        self.assertIn("Quedan 5", texto)
        self.assertIn("360,00 €", texto)
        self.assertIn("45,00 €", texto)

    def test_la_mensualidad_no_enseña_restantes_ni_barra(self):
        self.mensualidad("Pareja", cuota=720, referencia=12)
        self.firmar("Pareja", 13)
        texto = self._texto("/cliente/Pareja")

        self.assertIn("13 sesiones este mes", texto)
        self.assertIn("12 de referencia", texto)
        self.assertIn("720,00 €", texto)
        self.assertIn("55,38 €/h", texto)   # 720 / 13
        self.assertNotIn("Quedan", texto)
        self.assertNotIn("perfil-progreso-barra", self.cliente.get("/cliente/Pareja").get_data(as_text=True))

    def test_la_cuenta_enseña_lo_acumulado(self):
        self.cuenta("Sami", precio=35)
        self.firmar("Sami", 8)
        texto = self._texto("/cliente/Sami")

        self.assertIn("8 sesiones este mes", texto)
        self.assertIn("35,00 €", texto)
        self.assertIn("280,00 €", texto)
        self.assertNotIn("Quedan", texto)

    def test_editar_ofrece_las_tres_modalidades(self):
        self.bono("Ana")
        texto = self._texto("/cliente/Ana/editar")
        for etiqueta in ("Bono", "Mensualidad", "Cuenta de cliente"):
            self.assertIn(etiqueta, texto)

    def test_abrir_la_lista_abre_el_ciclo_del_mes(self):
        """Fernando no tiene que acordarse de renovar nada: pasa solo."""
        self.mensualidad("Pareja", cuando=date(2026, 8, 3))
        self.firmar("Pareja", 4)

        # Llega septiembre y abre la app.
        self.webapp._MES_COMPROBADO = None
        self.webapp.asegurar_ciclos_mensuales = (
            lambda anio, mes, ruta=self.ruta: cr.asegurar_ciclos_mensuales(anio, mes, ruta=self.ruta)
        )
        self.addCleanup(lambda: setattr(self.webapp, "_MES_COMPROBADO", None))
        original = self.webapp.hoy_negocio
        self.webapp.hoy_negocio = lambda: date(2026, 9, 1)
        self.addCleanup(lambda: setattr(self.webapp, "hoy_negocio", original))

        self.cliente.get("/")

        ciclos = cr.obtener_programas_cliente("Pareja", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2)
        self.assertEqual((ciclos[0]["anio"], ciclos[0]["mes"]), (2026, 9))
        self.assertEqual(er.obtener_mes(2026, 9, self.ruta)["facturacion_total"], 720.0)
        # Y agosto no se ha movido.
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_total"], 720.0)

    def test_abrir_la_lista_muchas_veces_no_duplica_cuotas(self):
        self.mensualidad("Pareja")
        for _ in range(8):
            self.cliente.get("/")
        with basedatos.conectar(self.ruta) as conexion:
            self.assertEqual(conexion.execute("SELECT COUNT(*) AS n FROM cargos_mensuales").fetchone()["n"], 1)

    def test_el_historial_conserva_las_condiciones_de_cada_ciclo(self):
        self.bono("Ana", sesiones=4, precio=180)
        self.firmar("Ana", 3)
        cr.configurar_servicio("Ana", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 8, 10), ruta=self.ruta)
        texto = self._texto("/cliente/Ana")

        # El ciclo cerrado sigue enseñándose como bono, con sus números.
        self.assertIn("Historial de programas · 2", texto)
        self.assertIn("180,00 €", texto)
        self.assertIn("45,00 €", texto)


if __name__ == "__main__":
    unittest.main()
