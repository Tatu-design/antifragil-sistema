"""Borrar una sesión deja la cuenta cuadrada (2026-08-04).

El fallo que encontró Fernando con Paquito: borró una sesión del historial y
el marcador principal no se movió. La causa era que el contador del cliente
se calculaba con el NÚMERO de la última sesión que quedaba, no con cuántas
sesiones había. Borrada la nº 1 de 7, la última seguía siendo la nº 7 → el
contador se quedaba en 7 con solo 6 sesiones, y la ficha se contradecía con
su propio historial.

Aquí se comprueban las dos mitades:

- Al borrar, las sesiones posteriores del mismo ciclo bajan un número y el
  contador baja con ellas.
- La economía del mes se ajusta sola: una sesión menos son una hora menos y
  su importe menos, con el precio medio recalculado.
"""

import os
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp

import basedatos
import clientes.repositorio as cr
import economia.registro as er
import registrar_asistencia as ra
import reparar_numeracion as rep
from servicios.modalidades import BONO, CUENTA, MENSUALIDAD


class BaseNumeracion(unittest.TestCase):
    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("INSERT INTO programas (nombre, tarifa, sesiones_totales) VALUES ('Base', 40.0, 8)")
        self.addCleanup(self._borrar)

    def _borrar(self):
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

    def paquito(self, sesiones=8, precio=320, dias=(2, 9, 10, 15, 17, 23, 29)):
        """El caso real: bono de 8 a 40 €, siete sesiones firmadas en julio."""
        self.alta("Paquito")
        cr.configurar_servicio("Paquito", BONO, nombre_servicio="Nuevo 40€ x8",
                               sesiones_totales=sesiones, precio_total=precio,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        for dia in dias:
            ra.registrar_sesion_pt("Paquito", fecha=date(2026, 7, dia), ruta=self.ruta)

    def numeros(self, nombre="Paquito"):
        return sorted(s["numero_sesion"] for s in cr.obtener_historial(nombre, ruta=self.ruta))

    def contador(self, nombre="Paquito"):
        return cr.leer_clientes(self.ruta)[nombre]["sesiones_completadas"]

    def julio(self):
        return er.obtener_mes(2026, 7, self.ruta)

    def sesion_numero(self, numero, nombre="Paquito"):
        return [s for s in cr.obtener_historial(nombre, ruta=self.ruta) if s["numero_sesion"] == numero][0]


class TestBorrarUnaSesion(BaseNumeracion):
    def test_el_punto_de_partida_es_el_esperado(self):
        self.paquito()
        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(self.contador(), 7)
        self.assertEqual(self.julio()["facturacion_total"], 280.0)
        self.assertEqual(self.julio()["horas_totales"], 7)

    def test_borrar_la_primera_baja_el_contador_y_renumera(self):
        self.paquito()
        ra.eliminar_sesion_pt(self.sesion_numero(1)["id"], ruta=self.ruta)

        self.assertEqual(self.contador(), 6, "el marcador principal tiene que bajar")
        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6], "no puede quedar un hueco")

    def test_borrar_una_del_medio_tambien(self):
        self.paquito()
        ra.eliminar_sesion_pt(self.sesion_numero(4)["id"], ruta=self.ruta)

        self.assertEqual(self.contador(), 6)
        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6])

    def test_borrar_la_ultima_tambien(self):
        self.paquito()
        ra.eliminar_sesion_pt(self.sesion_numero(7)["id"], ruta=self.ruta)

        self.assertEqual(self.contador(), 6)
        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6])

    def test_borrar_varias_seguidas(self):
        self.paquito()
        for numero in (1, 3, 2):
            ra.eliminar_sesion_pt(self.sesion_numero(numero)["id"], ruta=self.ruta)

        self.assertEqual(self.contador(), 4)
        self.assertEqual(self.numeros(), [1, 2, 3, 4])

    def test_la_ficha_y_su_historial_nunca_se_contradicen(self):
        """Lo que veía Fernando: '7 de 8' arriba y 6 sesiones abajo."""
        self.paquito()
        for numero in (1, 2, 3):
            ra.eliminar_sesion_pt(self.sesion_numero(numero)["id"], ruta=self.ruta)
            ciclo = cr.obtener_programas_cliente("Paquito", ruta=self.ruta)[0]
            self.assertEqual(
                self.contador(), len(ciclo["sesiones"]),
                "el marcador principal y el historial tienen que decir lo mismo",
            )

    def test_al_firmar_despues_sigue_la_numeracion(self):
        self.paquito()
        ra.eliminar_sesion_pt(self.sesion_numero(1)["id"], ruta=self.ruta)
        ra.registrar_sesion_pt("Paquito", fecha=date(2026, 7, 30), ruta=self.ruta)

        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(self.contador(), 7)


class TestLaEconomiaSeAjusta(BaseNumeracion):
    def test_borrar_quita_su_hora_y_su_importe(self):
        self.paquito()
        ra.eliminar_sesion_pt(self.sesion_numero(1)["id"], ruta=self.ruta)

        julio = self.julio()
        self.assertEqual(julio["horas_totales"], 6, "una sesión menos es una hora menos")
        self.assertEqual(julio["facturacion_total"], 240.0, "40 € menos")
        self.assertEqual(julio["precio_medio_hora"], 40.0)

    def test_la_sesion_se_quita_del_mes_al_que_pertenecia(self):
        self.paquito()
        # Una sesión más, en agosto.
        ra.registrar_sesion_pt("Paquito", fecha=date(2026, 8, 4), ruta=self.ruta)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta)["facturacion_total"], 40.0)

        agosto = [s for s in cr.obtener_historial("Paquito", ruta=self.ruta)
                  if s["fecha"].startswith("2026-08")][0]
        ra.eliminar_sesion_pt(agosto["id"], ruta=self.ruta)

        # Agosto se queda sin nada y julio no se entera.
        self.assertIsNone(er.obtener_mes(2026, 8, self.ruta))
        self.assertEqual(self.julio()["facturacion_total"], 280.0)

    def test_el_precio_medio_se_recalcula(self):
        self.paquito()
        # Otro cliente más caro el mismo mes, para que la media no sea plana.
        self.alta("Cara")
        cr.configurar_servicio("Cara", BONO, sesiones_totales=4, precio_total=240,
                               hoy=date(2026, 7, 1), ruta=self.ruta)   # 60 €/sesión
        ra.registrar_sesion_pt("Cara", fecha=date(2026, 7, 5), ruta=self.ruta)

        antes = self.julio()
        self.assertAlmostEqual(antes["precio_medio_hora"], (280 + 60) / 8, places=4)

        ra.eliminar_sesion_pt(self.sesion_numero(1)["id"], ruta=self.ruta)

        despues = self.julio()
        self.assertEqual(despues["horas_totales"], 7)
        self.assertEqual(despues["facturacion_total"], 300.0)
        self.assertAlmostEqual(despues["precio_medio_hora"], 300 / 7, places=4)

    def test_borrar_y_volver_a_firmar_deja_todo_como_estaba(self):
        self.paquito()
        antes = self.julio()
        ra.eliminar_sesion_pt(self.sesion_numero(7)["id"], ruta=self.ruta)
        ra.registrar_sesion_pt("Paquito", fecha=date(2026, 7, 29), ruta=self.ruta)

        self.assertEqual(self.julio()["facturacion_total"], antes["facturacion_total"])
        self.assertEqual(self.julio()["horas_totales"], antes["horas_totales"])
        self.assertEqual(self.contador(), 7)

    def test_en_una_cuenta_de_cliente_tambien(self):
        self.alta("Sami")
        cr.configurar_servicio("Sami", CUENTA, tarifa=35, hoy=date(2026, 7, 1), ruta=self.ruta)
        for dia in (1, 2, 3):
            ra.registrar_sesion_pt("Sami", fecha=date(2026, 7, dia), ruta=self.ruta)
        self.assertEqual(self.julio()["facturacion_total"], 105.0)

        ra.eliminar_sesion_pt(self.sesion_numero(2, "Sami")["id"], ruta=self.ruta)

        self.assertEqual(self.julio()["facturacion_total"], 70.0)
        self.assertEqual(self.julio()["horas_totales"], 2)
        self.assertEqual(self.numeros("Sami"), [1, 2])

    def test_en_una_mensualidad_baja_la_hora_pero_no_la_cuota(self):
        self.alta("Pareja")
        cr.configurar_servicio("Pareja", MENSUALIDAD, cuota_mensual=720,
                               hoy=date(2026, 7, 1), ruta=self.ruta)
        for dia in (1, 2, 3):
            ra.registrar_sesion_pt("Pareja", fecha=date(2026, 7, dia), ruta=self.ruta)

        ra.eliminar_sesion_pt(self.sesion_numero(2, "Pareja")["id"], ruta=self.ruta)

        julio = self.julio()
        self.assertEqual(julio["horas_totales"], 2, "una hora menos")
        self.assertEqual(julio["facturacion_total"], 720.0, "la cuota del mes no cambia")
        self.assertEqual(self.numeros("Pareja"), [1, 2])


class TestReparacionDeLoYaDescuadrado(BaseNumeracion):
    """Los datos que quedaron mal ANTES de corregir el borrado."""

    def _romper(self, nombre, numeros):
        """Deja las sesiones con los números indicados, como estaban en el
        servidor: sin renumerar tras un borrado."""
        sesiones = sorted(cr.obtener_historial(nombre, ruta=self.ruta), key=lambda s: s["fecha"])
        with basedatos.transaccion(self.ruta) as conexion:
            for sesion, numero in zip(sesiones, numeros):
                conexion.execute("UPDATE historial_sesiones SET numero_sesion = ? WHERE id = ?",
                                 (numero, sesion["id"]))

    def test_el_caso_paquito_numeros_que_empiezan_en_dos(self):
        self.paquito(dias=(9, 10, 15, 17, 23, 29))
        self._romper("Paquito", [2, 3, 4, 5, 6, 7])
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("UPDATE clientes SET sesiones_completadas = 7 WHERE nombre = 'Paquito'")

        rep.aplicar(self.ruta)

        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6])
        self.assertEqual(self.contador(), 6)

    def test_el_caso_nikki_huecos_en_medio(self):
        self.paquito(dias=(1, 2, 3, 6, 7, 8))
        self._romper("Paquito", [1, 2, 3, 6, 7, 8])
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("UPDATE clientes SET sesiones_completadas = 0 WHERE nombre = 'Paquito'")

        rep.aplicar(self.ruta)

        self.assertEqual(self.numeros(), [1, 2, 3, 4, 5, 6])
        self.assertEqual(self.contador(), 6)

    def test_el_caso_rocio_mas_sesiones_que_el_bono(self):
        """9 sesiones en un bono de 8: le faltó una renovación."""
        self.alta("Rocio")
        cr.configurar_servicio("Rocio", BONO, sesiones_totales=8, precio_total=280,
                               hoy=date(2026, 6, 1), ruta=self.ruta)
        for dia in range(1, 10):   # 9 sesiones, todas en el ciclo 1
            ra.registrar_sesion_pt("Rocio", fecha=date(2026, 6, dia), ruta=self.ruta)
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("UPDATE historial_sesiones SET ciclo_bono = 1 WHERE cliente = 'Rocio'")
            conexion.execute("UPDATE clientes SET ciclo_bono = 1, sesiones_completadas = 1 "
                             "WHERE nombre = 'Rocio'")

        rep.aplicar(self.ruta)

        ciclos = cr.obtener_programas_cliente("Rocio", ruta=self.ruta)
        self.assertEqual(len(ciclos), 2, "el bono lleno se cierra y empieza otro")
        self.assertEqual(len(ciclos[1]["sesiones"]), 8)
        self.assertEqual(len(ciclos[0]["sesiones"]), 1)
        self.assertIsNotNone(ciclos[1]["fecha_fin"], "el bono lleno queda cerrado")
        self.assertIsNone(ciclos[0]["fecha_fin"], "el nuevo queda abierto")
        self.assertEqual(self.contador("Rocio"), 1)

    def test_la_reparacion_no_mueve_la_economia(self):
        self.paquito(dias=(9, 10, 15, 17, 23, 29))
        self._romper("Paquito", [2, 3, 4, 5, 6, 7])
        antes = self.julio()

        rep.aplicar(self.ruta)

        self.assertEqual(self.julio(), antes,
                         "el número de sesión es una etiqueta, no entra en la economía")

    def test_la_reparacion_es_segura_de_repetir(self):
        self.paquito(dias=(9, 10, 15, 17, 23, 29))
        self._romper("Paquito", [2, 3, 4, 5, 6, 7])
        rep.aplicar(self.ruta)

        estado = (self.numeros(), self.contador(), self.julio())
        for _ in range(3):
            rep.aplicar(self.ruta)
            self.assertEqual((self.numeros(), self.contador(), self.julio()), estado)

    def test_no_toca_lo_que_ya_esta_bien(self):
        self.paquito()
        arreglos, _ = rep.revisar(self.ruta)
        self.assertEqual(arreglos, [], "una numeración correcta no necesita arreglo")

    def test_no_renumera_los_ciclos_ya_cerrados(self):
        """La numeración de un bono cerrado es historia."""
        self.paquito(dias=(1, 2, 3, 4, 5, 6, 7, 8, 9))   # 8 cierran el bono, 1 va al nuevo
        cerrado = cr.obtener_programas_cliente("Paquito", ruta=self.ruta)[1]
        numeros_cerrado = sorted(s["numero_sesion"] for s in cerrado["sesiones"])

        rep.aplicar(self.ruta)

        cerrado_despues = cr.obtener_programas_cliente("Paquito", ruta=self.ruta)[1]
        self.assertEqual(sorted(s["numero_sesion"] for s in cerrado_despues["sesiones"]),
                         numeros_cerrado)


if __name__ == "__main__":
    unittest.main()
