"""Suite de la segunda auditoría de integridad (2026-07-30).

Cubre los huecos que quedaron abiertos tras el primer sprint:

1. Meses históricos que perderían facturación al calcularse desde el
   historial (sesiones económicas sin fila histórica).
2. Migración real de `ciclo_bono` sobre datos antiguos.
3. Firmas simultáneas del mismo cliente.
4. Correcciones alrededor de una renovación.
6. CrossFit Kids entre meses.
7. Migración de esquemas antiguos, ejecutada dos veces.
9. Seguridad mínima de la web (CSRF, cookies, token de instalación).

Cada prueba trabaja sobre un archivo SQLite temporal propio, nunca sobre
`datos/antifragil.db`.

Ejecutar con:
    python -m unittest discover -s tests -v
"""

import os
import sqlite3
import threading
import unittest
from datetime import date
from pathlib import Path
from tempfile import mkstemp

import avisos as av
import basedatos
import clientes.repositorio as cr
import economia.registro as er
import migrar_ajustes_legacy as mal
import migrar_ciclo_bono as mcb
import registrar_asistencia as ra
from tests.test_integridad import BaseIntegridadTestCase


def _bd_temporal() -> Path:
    descriptor, ruta = mkstemp(suffix=".db")
    os.close(descriptor)
    return Path(ruta)


def _borrar(ruta: Path) -> None:
    for sufijo in ("", "-wal", "-shm"):
        candidato = Path(str(ruta) + sufijo)
        try:
            if candidato.exists():
                candidato.unlink()
        except PermissionError:
            pass


# ---------------------------------------------------------------------------
# 1. Meses históricos: facturación sin fila en el historial
# ---------------------------------------------------------------------------


class TestFacturacionHistoricaSinHistorial(BaseIntegridadTestCase):
    """El caso real medido sobre producción: la economía de una semana tiene
    más sesiones que el historial, porque son de antes de que se registraran
    fechas. Calcular el mes solo desde el historial rebajaría un cierre ya
    dado por bueno."""

    def _semana_con_sesiones_sin_historial(self) -> None:
        # Semana entera dentro de agosto: 2 sesiones cobradas en la economía,
        # pero solo 1 con fila en el historial.
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 4), ruta=self.ruta)
        desglose = er.obtener_desglose_semana("2026-08-03", ruta=self.ruta)
        desglose[40.0]["sesiones"] = 2
        desglose[40.0]["facturacion"] = 80.0
        er.registrar_semana(date(2026, 8, 3), date(2026, 8, 9), desglose, 0, ruta=self.ruta)

    def test_mes_sin_ajuste_pierde_la_facturacion_historica(self):
        """Deja constancia del problema: sin ajuste, el mes calculado desde
        el historial es MENOR que la economía cerrada."""
        self._semana_con_sesiones_sin_historial()
        mes = er.obtener_mes(2026, 8, ruta=self.ruta)
        semana = er.obtener_semana("2026-08-03", ruta=self.ruta)
        self.assertAlmostEqual(semana["facturacion_total"], 80.0)
        self.assertAlmostEqual(mes["facturacion_total"], 40.0)  # falta la sesión sin fila

    def test_el_ajuste_legacy_conserva_el_cierre_historico(self):
        self._semana_con_sesiones_sin_historial()
        mal.aplicar(self.ruta)

        mes = er.obtener_mes(2026, 8, ruta=self.ruta)
        self.assertAlmostEqual(mes["facturacion_total"], 80.0)
        self.assertEqual(mes["horas_totales"], 2)
        # La diferencia queda VISIBLE, no escondida dentro del total.
        self.assertAlmostEqual(mes["ajuste_importe"], 40.0)
        self.assertEqual(mes["ajuste_horas"], 1)
        self.assertTrue(mes["ajustes"])
        self.assertIn("sin fila en el historial", mes["ajustes"][0]["motivo"])

    def test_el_ajuste_es_idempotente(self):
        self._semana_con_sesiones_sin_historial()
        mal.aplicar(self.ruta)
        mal.aplicar(self.ruta)
        mal.aplicar(self.ruta)
        mes = er.obtener_mes(2026, 8, ruta=self.ruta)
        self.assertAlmostEqual(mes["facturacion_total"], 80.0)
        self.assertAlmostEqual(mes["ajuste_importe"], 40.0)

    def test_semana_a_caballo_entre_meses_no_se_reparte_a_ojo(self):
        """Requisito explícito: avisar en vez de adivinar."""
        # Semana del 27 de julio al 2 de agosto: cruza dos meses.
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 7, 28), ruta=self.ruta)
        desglose = er.obtener_desglose_semana("2026-07-27", ruta=self.ruta)
        desglose[40.0]["sesiones"] = 3
        desglose[40.0]["facturacion"] = 120.0
        er.registrar_semana(date(2026, 7, 27), date(2026, 8, 2), desglose, 0, ruta=self.ruta)

        ajustes, ambiguedades = mal.calcular_ajustes(self.ruta)
        self.assertEqual(ajustes, {})
        self.assertEqual(len(ambiguedades), 1)
        self.assertIn("cruza dos meses", ambiguedades[0])

        mal.aplicar(self.ruta)
        tipos = [a["tipo"] for a in av.listar_avisos_pendientes(ruta=self.ruta)]
        self.assertIn("ajuste_legacy_ambiguo", tipos)

    def test_futuro_se_calcula_desde_las_fechas_reales(self):
        """Los meses nuevos no llevan ningún ajuste: salen del historial."""
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 9, 7), ruta=self.ruta)
        ra.registrar_sesion_pt("Cliente", fecha=date(2026, 9, 8), ruta=self.ruta)
        mal.aplicar(self.ruta)
        mes = er.obtener_mes(2026, 9, ruta=self.ruta)
        self.assertAlmostEqual(mes["ajuste_importe"], 0.0)
        self.assertAlmostEqual(mes["facturacion_total"], 80.0)


# ---------------------------------------------------------------------------
# 2. Migración de ciclo_bono sobre datos antiguos
# ---------------------------------------------------------------------------


class TestMigracionCicloBono(unittest.TestCase):
    """Parte de una base "antigua": dos bonos ya realizados, con TODAS las
    sesiones marcadas como ciclo 1 (que es lo que dejó la migración del
    2026-07-28)."""

    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 12", 50.0, 12, ruta=self.ruta)
        cr.crear_cliente("Cliente", "Bono 12", 0, False, ruta=self.ruta)

        # Dos bonos completos (1..12 y 1..12) + 2 sesiones del tercero,
        # todas con ciclo_bono = 1 como las dejaría la migración antigua.
        with basedatos.conectar(self.ruta) as conexion:
            dia = 1
            for numero in list(range(1, 13)) + list(range(1, 13)) + [1, 2]:
                conexion.execute(
                    "INSERT INTO historial_sesiones "
                    "(cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono) "
                    "VALUES (?, ?, ?, ?, ?, ?, 1)",
                    ("Cliente", f"2026-05-{dia:02d}", "Bono 12", numero, 12, 50.0),
                )
                dia += 1
            conexion.execute("UPDATE clientes SET sesiones_completadas = 2, ciclo_bono = 1 WHERE nombre = 'Cliente'")

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def test_detecta_los_tres_ciclos(self):
        resultado = mcb.calcular(self.ruta)
        self.assertEqual(resultado["ciclo_actual_por_cliente"]["Cliente"], 3)
        # 12 del segundo bono + 2 del tercero pasan a ciclo 2 y 3.
        self.assertEqual(len(resultado["cambios_sesiones"]), 14)

    def test_ajusta_el_ciclo_actual_del_cliente(self):
        mcb.aplicar(self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            ciclo = conexion.execute("SELECT ciclo_bono FROM clientes WHERE nombre = 'Cliente'").fetchone()["ciclo_bono"]
        self.assertEqual(ciclo, 3)

    def test_borrar_una_sesion_del_bono_actual_no_revive_la_12_del_anterior(self):
        """El escenario exacto que pide la auditoría."""
        mcb.aplicar(self.ruta)

        # La sesión 2 del bono actual (ciclo 3) es la más reciente.
        with basedatos.conectar(self.ruta) as conexion:
            fila = conexion.execute(
                "SELECT id, numero_sesion, ciclo_bono FROM historial_sesiones "
                "WHERE cliente = 'Cliente' ORDER BY fecha DESC, id DESC LIMIT 1"
            ).fetchone()
        self.assertEqual((fila["numero_sesion"], fila["ciclo_bono"]), (2, 3))

        ra.eliminar_sesion_pt(fila["id"], ruta=self.ruta)

        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        # Debe quedar en 1 (la sesión 1 del bono actual), NO en 12 del anterior.
        self.assertEqual(cliente["sesiones_completadas"], 1)

    def test_es_seguro_ejecutarla_varias_veces(self):
        mcb.aplicar(self.ruta)
        primera = mcb.calcular(self.ruta)
        mcb.aplicar(self.ruta)
        segunda = mcb.calcular(self.ruta)
        self.assertEqual(primera["ciclo_actual_por_cliente"], segunda["ciclo_actual_por_cliente"])
        # Tras aplicar, ya no queda nada que cambiar.
        self.assertEqual(segunda["cambios_sesiones"], {})

    def test_avisa_de_un_reinicio_que_no_empieza_en_uno(self):
        """Numeración ambigua: se acepta el corte pero se avisa, no se
        inventa nada."""
        ruta = _bd_temporal()
        try:
            basedatos.crear_esquema(ruta)
            cr.guardar_programa("Bono 12", 50.0, 12, ruta=ruta)
            cr.crear_cliente("Cliente", "Bono 12", 0, False, ruta=ruta)
            with basedatos.conectar(ruta) as conexion:
                for dia, numero in enumerate([10, 11, 12, 3, 4], start=1):
                    conexion.execute(
                        "INSERT INTO historial_sesiones "
                        "(cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono) "
                        "VALUES (?, ?, ?, ?, ?, ?, 1)",
                        ("Cliente", f"2026-05-{dia:02d}", "Bono 12", numero, 12, 50.0),
                    )
            resultado = mcb.aplicar(ruta)
            self.assertTrue(any("arranca en la sesión 3" in a for a in resultado["avisos"]))
            tipos = [a["tipo"] for a in av.listar_avisos_pendientes(ruta=ruta)]
            self.assertIn("ciclo_bono_ambiguo", tipos)
        finally:
            _borrar(ruta)

    def test_valida_contra_sesiones_completadas(self):
        """Si el contador del cliente no cuadra con su última sesión, avisa
        en vez de corregirlo por su cuenta."""
        with basedatos.conectar(self.ruta) as conexion:
            conexion.execute("UPDATE clientes SET sesiones_completadas = 7 WHERE nombre = 'Cliente'")
        resultado = mcb.calcular(self.ruta)
        self.assertTrue(any("contador marca 7" in a for a in resultado["avisos"]))


# ---------------------------------------------------------------------------
# 3. Firmas simultáneas
# ---------------------------------------------------------------------------


class TestFirmasSimultaneas(BaseIntegridadTestCase):
    def test_dos_firmas_a_la_vez_del_mismo_cliente(self):
        """Dos firmas concurrentes del mismo cliente deben producir dos
        sesiones correlativas, no dos veces la misma."""
        errores: list[Exception] = []
        barrera = threading.Barrier(2)

        def firmar():
            try:
                barrera.wait(timeout=5)  # arrancan lo más a la vez posible
                ra.registrar_sesion_pt("Cliente", fecha=date(2026, 8, 3), ruta=self.ruta)
            except Exception as error:  # se recoge para verlo en el test
                errores.append(error)

        hilos = [threading.Thread(target=firmar) for _ in range(2)]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=30)

        self.assertEqual(errores, [], f"alguna firma falló: {errores}")

        historial = cr.obtener_historial("Cliente", ruta=self.ruta)
        numeros = sorted(entrada["numero_sesion"] for entrada in historial)

        self.assertEqual(len(historial), 2, "deben quedar dos filas históricas")
        self.assertEqual(numeros, [1, 2], "no puede haber dos filas con el mismo número de sesión")
        self.assertEqual(len(set(numeros)), 2)

        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 2, "el contador avanza dos posiciones")

        semana = er.obtener_semana("2026-08-03", ruta=self.ruta)
        self.assertAlmostEqual(semana["facturacion_total"], 80.0, msg="dos sesiones económicas")
        self.assertEqual(semana["horas_totales"], 2)

        self.assertEqual(
            er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), self.ruta),
            [],
            "no debe quedar discrepancia",
        )


# ---------------------------------------------------------------------------
# 4. Correcciones alrededor de una renovación
# ---------------------------------------------------------------------------


class TestCorreccionesAlrededorDeRenovacion(unittest.TestCase):
    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 12", 50.0, 12, ruta=self.ruta)
        cr.crear_cliente("Cliente", "Bono 12", 0, False, ruta=self.ruta)

        # Terminar un bono: 12 sesiones (la 12 renueva).
        for dia in range(1, 13):
            ra.registrar_sesion_pt("Cliente", fecha=date(2026, 6, dia), ruta=self.ruta)
        # Firmar varias sesiones del bono nuevo.
        for dia in range(1, 4):
            ra.registrar_sesion_pt("Cliente", fecha=date(2026, 7, dia), ruta=self.ruta)

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def _sesion(self, numero: int, ciclo: int) -> int:
        with basedatos.conectar(self.ruta) as conexion:
            fila = conexion.execute(
                "SELECT id FROM historial_sesiones WHERE cliente = 'Cliente' AND numero_sesion = ? AND ciclo_bono = ?",
                (numero, ciclo),
            ).fetchone()
        self.assertIsNotNone(fila, f"no existe la sesión {numero} del ciclo {ciclo}")
        return fila["id"]

    def test_el_estado_de_partida_es_el_esperado(self):
        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 3)
        self.assertEqual(cliente["pendiente_pago"], "Sí")
        historial = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(len(historial), 15)

    def test_borrar_la_sesion_que_termino_el_bono_anterior_queda_bloqueado(self):
        with self.assertRaises(ValueError) as contexto:
            ra.eliminar_sesion_pt(self._sesion(12, 1), ruta=self.ruta)
        self.assertIn("bono ya cerrado", str(contexto.exception))
        # Nada ha cambiado.
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 15)
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente"]["sesiones_completadas"], 3)

    def test_cambiar_la_sesion_12_a_11_queda_bloqueado(self):
        with self.assertRaises(ValueError) as contexto:
            ra.editar_sesion_pt(self._sesion(12, 1), "2026-06-12", 11, ruta=self.ruta)
        self.assertIn("bono ya cerrado", str(contexto.exception))
        with basedatos.conectar(self.ruta) as conexion:
            numero = conexion.execute(
                "SELECT numero_sesion FROM historial_sesiones WHERE id = ?", (self._sesion(12, 1),)
            ).fetchone()["numero_sesion"]
        self.assertEqual(numero, 12, "la sesión no debe haber cambiado")

    def test_editar_cualquier_sesion_de_un_ciclo_anterior_queda_bloqueado(self):
        with self.assertRaises(ValueError):
            ra.editar_sesion_pt(self._sesion(5, 1), "2026-06-05", 4, ruta=self.ruta)

    def test_el_bono_actual_si_se_puede_corregir(self):
        """El bloqueo es solo para ciclos con sesiones posteriores: el bono
        en curso se sigue pudiendo arreglar."""
        ra.eliminar_sesion_pt(self._sesion(3, 2), ruta=self.ruta)
        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 2)
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 14)

    def test_vaciar_el_bono_nuevo_deja_el_bono_recien_renovado(self):
        """Al borrar todas las sesiones del bono nuevo, el cliente queda
        exactamente como justo después de renovar: bono 2 empezado, 0
        sesiones hechas y pendiente de pago.

        NO vuelve a "12 completadas del bono 1": esa renovación ocurrió de
        verdad y su sesión 12 sigue en el historial. Volver atrás ahí sería
        inventar que el bono anterior no se terminó."""
        for numero in (3, 2, 1):
            ra.eliminar_sesion_pt(self._sesion(numero, 2), ruta=self.ruta)

        cliente = cr.leer_clientes(self.ruta)["Cliente"]
        self.assertEqual(cliente["sesiones_completadas"], 0)
        self.assertEqual(cliente["pendiente_pago"], "Sí")

        historial = cr.obtener_historial("Cliente", ruta=self.ruta)
        self.assertEqual(len(historial), 12, "las 12 del bono anterior siguen ahí")
        with basedatos.conectar(self.ruta) as conexion:
            ciclo = conexion.execute("SELECT ciclo_bono FROM clientes WHERE nombre = 'Cliente'").fetchone()["ciclo_bono"]
        self.assertEqual(ciclo, 2)


# ---------------------------------------------------------------------------
# 6. CrossFit Kids entre meses
# ---------------------------------------------------------------------------


class TestKidsEntreMeses(unittest.TestCase):
    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 8", 40.0, 8, ruta=self.ruta)
        cr.crear_cliente("Cliente", "Bono 8", 0, False, ruta=self.ruta)

        # Una clase el 31 de julio y otra el 1 de agosto: la MISMA semana
        # natural (27 jul - 2 ago) contiene días de dos meses.
        ra.registrar_clase_grupo("kids", fecha=date(2026, 7, 31), ruta=self.ruta)
        ra.registrar_clase_grupo("kids", fecha=date(2026, 8, 1), ruta=self.ruta)

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def test_cada_clase_cuenta_en_su_mes_real(self):
        self.assertEqual(er.obtener_mes(2026, 7, ruta=self.ruta)["sesiones_kids"], 1)
        self.assertEqual(er.obtener_mes(2026, 8, ruta=self.ruta)["sesiones_kids"], 1)

    def test_meses_provisionales_hasta_introducir_la_facturacion(self):
        self.assertTrue(er.obtener_mes(2026, 7, ruta=self.ruta)["provisional"])
        self.assertTrue(er.obtener_mes(2026, 8, ruta=self.ruta)["provisional"])
        self.assertTrue(er.obtener_semana("2026-07-27", ruta=self.ruta)["provisional"])

    def test_precio_por_sesion_de_cada_mes(self):
        er.registrar_facturacion_kids(2026, 7, 300.0, ruta=self.ruta)
        er.registrar_facturacion_kids(2026, 8, 100.0, ruta=self.ruta)
        # Cada mes tiene 1 clase, así que el precio por clase es su importe.
        self.assertAlmostEqual(er.precio_sesion_kids(2026, 7, ruta=self.ruta), 300.0)
        self.assertAlmostEqual(er.precio_sesion_kids(2026, 8, ruta=self.ruta), 100.0)

    def test_la_semana_a_caballo_suma_la_parte_de_cada_mes(self):
        """Con facturaciones distintas para julio y agosto, la semana que
        contiene una clase de cada mes debe sumar 300 + 100, no 2 clases al
        precio de un solo mes."""
        er.registrar_facturacion_kids(2026, 7, 300.0, ruta=self.ruta)
        er.registrar_facturacion_kids(2026, 8, 100.0, ruta=self.ruta)

        semana = er.obtener_semana("2026-07-27", ruta=self.ruta)
        self.assertAlmostEqual(semana["facturacion_kids"], 400.0)
        self.assertEqual(semana["sesiones_kids"], 2)
        self.assertFalse(semana["provisional"])

    def test_las_horas_de_kids_cuentan_cuando_hay_facturacion(self):
        semana_antes = er.obtener_semana("2026-07-27", ruta=self.ruta)
        horas_antes = semana_antes["horas_totales"]

        er.registrar_facturacion_kids(2026, 7, 300.0, ruta=self.ruta)
        er.registrar_facturacion_kids(2026, 8, 100.0, ruta=self.ruta)

        semana = er.obtener_semana("2026-07-27", ruta=self.ruta)
        self.assertEqual(semana["horas_totales"], horas_antes + 2)

        mes_julio = er.obtener_mes(2026, 7, ruta=self.ruta)
        self.assertEqual(mes_julio["horas_totales"], 1)
        self.assertAlmostEqual(mes_julio["facturacion_total"], 300.0)

    def test_el_mes_deja_de_ser_provisional_al_introducir_su_importe(self):
        er.registrar_facturacion_kids(2026, 7, 300.0, ruta=self.ruta)
        self.assertFalse(er.obtener_mes(2026, 7, ruta=self.ruta)["provisional"])
        # Agosto sigue provisional: su importe aún no está.
        self.assertTrue(er.obtener_mes(2026, 8, ruta=self.ruta)["provisional"])


# ---------------------------------------------------------------------------
# 7. Migración de esquemas antiguos
# ---------------------------------------------------------------------------


ESQUEMA_BASE_ANTIGUO = """
CREATE TABLE programas (
    nombre TEXT PRIMARY KEY,
    tarifa REAL NOT NULL,
    sesiones_totales INTEGER NOT NULL
);
CREATE TABLE clientes (
    nombre TEXT PRIMARY KEY,
    tipo_programa TEXT NOT NULL REFERENCES programas(nombre),
    sesiones_completadas INTEGER NOT NULL DEFAULT 0,
    pendiente_pago INTEGER NOT NULL DEFAULT 0,
    token TEXT UNIQUE
);
CREATE TABLE semanas (
    fecha_inicio TEXT PRIMARY KEY,
    fecha_fin TEXT NOT NULL,
    anio INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    facturacion_pt_lidomare REAL NOT NULL DEFAULT 0,
    horas_pt_lidomare INTEGER NOT NULL DEFAULT 0,
    sesiones_kids INTEGER NOT NULL DEFAULT 0,
    facturacion_kids REAL
);
CREATE TABLE desglose (
    fecha_inicio_semana TEXT NOT NULL,
    tarifa REAL NOT NULL,
    sesiones INTEGER NOT NULL,
    facturacion REAL NOT NULL
);
CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE avisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    detalle TEXT NOT NULL,
    resuelto INTEGER NOT NULL DEFAULT 0,
    leido INTEGER NOT NULL DEFAULT 0
);
"""


class TestMigracionDeEsquemasAntiguos(unittest.TestCase):
    """Reconstruye las formas que la base de datos tuvo antes y comprueba que
    `crear_esquema` las migra sin perder nada — ejecutándola DOS veces, que
    es lo que pasa de verdad cada vez que el servidor se recarga."""

    def setUp(self) -> None:
        self.ruta = _bd_temporal()

    def tearDown(self) -> None:
        _borrar(self.ruta)

    def _crear_base_antigua(self, historial_sql: str, con_kids_mensual: bool = False) -> None:
        with sqlite3.connect(self.ruta) as conexion:
            conexion.executescript(ESQUEMA_BASE_ANTIGUO)
            conexion.executescript(historial_sql)
            conexion.execute("INSERT INTO programas VALUES ('Bono 12', 50.0, 12)")
            conexion.execute("INSERT INTO clientes (nombre, tipo_programa, sesiones_completadas) VALUES ('A', 'Bono 12', 2)")
            conexion.execute(
                "INSERT INTO semanas (fecha_inicio, fecha_fin, anio, mes, facturacion_pt_lidomare, "
                "horas_pt_lidomare, sesiones_kids, facturacion_kids) "
                "VALUES ('2026-06-01', '2026-06-07', 2026, 6, 100.0, 2, 3, 90.0)"
            )
            conexion.execute(
                "INSERT INTO desglose VALUES ('2026-06-01', 50.0, 2, 100.0)"
            )
            if not con_kids_mensual:
                pass  # el caso "semanas con facturacion_kids pero sin facturacion_kids_mensual"

    def _insertar_historial(self, columnas: str, filas: list[tuple]) -> None:
        with sqlite3.connect(self.ruta) as conexion:
            marcas = ", ".join("?" for _ in filas[0])
            conexion.executemany(f"INSERT INTO historial_sesiones ({columnas}) VALUES ({marcas})", filas)

    def _comprobar_integridad(self) -> None:
        with basedatos.conectar(self.ruta) as conexion:
            self.assertEqual(conexion.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conexion.execute("PRAGMA foreign_key_check").fetchall(), [])
            columnas = {f["name"] for f in conexion.execute("PRAGMA table_info(historial_sesiones)")}
            self.assertIn("tarifa", columnas)
            self.assertIn("ciclo_bono", columnas)
            for tabla in ("clases_grupo", "facturacion_kids_mensual", "firmas_idempotencia", "ajustes_mensuales"):
                existe = conexion.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (tabla,)
                ).fetchone()
                self.assertIsNotNone(existe, f"falta la tabla {tabla}")
            columnas_clientes = {f["name"] for f in conexion.execute("PRAGMA table_info(clientes)")}
            self.assertIn("ciclo_bono", columnas_clientes)

    def _estado(self) -> tuple:
        with basedatos.conectar(self.ruta) as conexion:
            filas = conexion.execute("SELECT COUNT(*) AS n, COALESCE(SUM(tarifa), 0) AS s FROM historial_sesiones").fetchone()
            semanas = conexion.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(facturacion_pt_lidomare), 0) AS s FROM semanas"
            ).fetchone()
        return (filas["n"], filas["s"], semanas["n"], semanas["s"])

    def _migrar_dos_veces_y_comprobar(self, esperado: tuple) -> None:
        basedatos.crear_esquema(self.ruta)
        primera = self._estado()
        self._comprobar_integridad()

        basedatos.crear_esquema(self.ruta)
        segunda = self._estado()
        self._comprobar_integridad()

        self.assertEqual(primera, segunda, "la segunda pasada no debe cambiar nada")
        self.assertEqual(primera, esperado)

    def test_historial_con_unique_cliente_fecha(self):
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL,
                UNIQUE(cliente, fecha)
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa",
            [("A", "2026-06-01", "Bono 12", 1, 12, 50.0), ("A", "2026-06-02", "Bono 12", 2, 12, 50.0)],
        )
        self._migrar_dos_veces_y_comprobar((2, 100.0, 1, 100.0))

        # El UNIQUE debe haber desaparecido: dos sesiones el mismo día.
        with basedatos.conectar(self.ruta) as conexion:
            definicion = conexion.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='historial_sesiones'"
            ).fetchone()["sql"]
        self.assertNotIn("UNIQUE", definicion)

    def test_historial_con_unique_conserva_ciclo_bono(self):
        """El bug corregido en esta auditoría: la reconstrucción para quitar
        el UNIQUE recreaba la tabla SIN `ciclo_bono`, perdiendo la columna y
        sus valores en silencio."""
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL,
                ciclo_bono INTEGER NOT NULL DEFAULT 1,
                UNIQUE(cliente, fecha)
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa, ciclo_bono",
            [("A", "2026-06-01", "Bono 12", 12, 12, 50.0, 1), ("A", "2026-06-02", "Bono 12", 1, 12, 50.0, 2)],
        )
        basedatos.crear_esquema(self.ruta)

        with basedatos.conectar(self.ruta) as conexion:
            ciclos = [
                f["ciclo_bono"]
                for f in conexion.execute("SELECT ciclo_bono FROM historial_sesiones ORDER BY fecha")
            ]
        self.assertEqual(ciclos, [1, 2], "los ciclos deben sobrevivir a la reconstrucción")

    def test_historial_sin_tarifa(self):
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales",
            [("A", "2026-06-01", "Bono 12", 1, 12), ("A", "2026-06-02", "Bono 12", 2, 12)],
        )
        # Sin tarifa, la suma es 0 pero las filas se conservan.
        self._migrar_dos_veces_y_comprobar((2, 0, 1, 100.0))

    def test_historial_sin_ciclo_bono(self):
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa",
            [("A", "2026-06-01", "Bono 12", 1, 12, 50.0), ("A", "2026-06-02", "Bono 12", 2, 12, 50.0)],
        )
        self._migrar_dos_veces_y_comprobar((2, 100.0, 1, 100.0))

    def test_clientes_sin_ciclo_bono(self):
        """La tabla `clientes` del esquema antiguo no tiene `ciclo_bono`."""
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa",
            [("A", "2026-06-01", "Bono 12", 1, 12, 50.0)],
        )
        with basedatos.conectar(self.ruta) as conexion:
            columnas = {f["name"] for f in conexion.execute("PRAGMA table_info(clientes)")}
        self.assertNotIn("ciclo_bono", columnas)

        basedatos.crear_esquema(self.ruta)
        basedatos.crear_esquema(self.ruta)
        self._comprobar_integridad()

    def test_semanas_con_facturacion_kids_sin_tabla_mensual(self):
        """La facturación de Kids ya repartida en `semanas` debe seguir ahí
        tras migrar, aunque no exista todavía `facturacion_kids_mensual`."""
        self._crear_base_antigua(
            """
            CREATE TABLE historial_sesiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL REFERENCES clientes(nombre),
                fecha TEXT NOT NULL,
                tipo_programa TEXT NOT NULL,
                numero_sesion INTEGER NOT NULL,
                sesiones_totales INTEGER NOT NULL,
                tarifa REAL
            );
            """
        )
        self._insertar_historial(
            "cliente, fecha, tipo_programa, numero_sesion, sesiones_totales, tarifa",
            [("A", "2026-06-01", "Bono 12", 1, 12, 50.0)],
        )
        basedatos.crear_esquema(self.ruta)
        basedatos.crear_esquema(self.ruta)
        self._comprobar_integridad()

        with basedatos.conectar(self.ruta) as conexion:
            fila = conexion.execute(
                "SELECT sesiones_kids, facturacion_kids FROM semanas WHERE fecha_inicio = '2026-06-01'"
            ).fetchone()
        self.assertEqual(fila["sesiones_kids"], 3)
        self.assertAlmostEqual(fila["facturacion_kids"], 90.0)


# ---------------------------------------------------------------------------
# 9. Seguridad mínima de la web
# ---------------------------------------------------------------------------


class TestSeguridadWeb(unittest.TestCase):
    def setUp(self) -> None:
        self.ruta = _bd_temporal()
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 8", 40.0, 8, ruta=self.ruta)
        cr.crear_cliente("Cliente", "Bono 8", 0, False, ruta=self.ruta)

        import webapp.app as app_module

        self.app_module = app_module
        app_module.app.config["TESTING"] = True
        # Se apuntan al archivo temporal las funciones que la web usa para
        # leer/escribir, para no tocar la base de datos real.
        self._original_leer = app_module.leer_clientes
        self._original_historial = app_module.obtener_historial
        self._original_firmar = app_module.registrar_sesion_pt
        # Desde el 2026-08-04 la ruta de firmar comprueba también el ciclo
        # del cliente: sin redirigirla, leería la base de datos REAL.
        self._original_ciclo = app_module.obtener_ciclo_actual
        self._original_ciclos = app_module.obtener_programas_cliente
        app_module.obtener_ciclo_actual = lambda nombre, conexion=None, ruta=self.ruta: (
            cr.obtener_ciclo_actual(nombre, ruta=self.ruta)
        )
        app_module.obtener_programas_cliente = lambda nombre, ruta=self.ruta: (
            cr.obtener_programas_cliente(nombre, ruta=self.ruta)
        )
        app_module.leer_clientes = lambda ruta=self.ruta: cr.leer_clientes(self.ruta)
        app_module.obtener_historial = lambda nombre, ruta=self.ruta: cr.obtener_historial(nombre, ruta=self.ruta)
        app_module.registrar_sesion_pt = lambda nombre, clave_idempotencia=None, ruta=self.ruta: (
            ra.registrar_sesion_pt(nombre, clave_idempotencia=clave_idempotencia, ruta=self.ruta)
        )
        self.cliente = app_module.app.test_client()
        with self.cliente.session_transaction() as sesion:
            sesion["autenticado"] = True

    def tearDown(self) -> None:
        self.app_module.leer_clientes = self._original_leer
        self.app_module.obtener_historial = self._original_historial
        self.app_module.registrar_sesion_pt = self._original_firmar
        self.app_module.obtener_ciclo_actual = self._original_ciclo
        self.app_module.obtener_programas_cliente = self._original_ciclos
        _borrar(self.ruta)

    def test_un_post_sin_token_csrf_se_rechaza(self):
        respuesta = self.cliente.post("/cliente/Cliente/firmar", data={"clave_idempotencia": "k"})
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=self.ruta), [], "no debe haber escrito nada")

    def test_un_post_con_token_incorrecto_se_rechaza(self):
        with self.cliente.session_transaction() as sesion:
            sesion["csrf"] = "el-token-bueno"
        respuesta = self.cliente.post(
            "/cliente/Cliente/firmar", data={"clave_idempotencia": "k", "csrf": "otro-token"}
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(cr.obtener_historial("Cliente", ruta=self.ruta), [])

    def test_un_post_con_el_token_correcto_funciona(self):
        with self.cliente.session_transaction() as sesion:
            sesion["csrf"] = "el-token-bueno"
        respuesta = self.cliente.post(
            "/cliente/Cliente/firmar",
            data={"clave_idempotencia": "k", "csrf": "el-token-bueno"},
            follow_redirects=True,
        )
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(cr.obtener_historial("Cliente", ruta=self.ruta)), 1)

    def test_las_plantillas_incluyen_el_token(self):
        html = self.cliente.get("/cliente/Cliente").get_data(as_text=True)
        self.assertIn('name="csrf"', html)

    def test_cookies_endurecidas(self):
        configuracion = self.app_module.app.config
        self.assertTrue(configuracion["SESSION_COOKIE_HTTPONLY"])
        self.assertEqual(configuracion["SESSION_COOKIE_SAMESITE"], "Lax")

    def test_las_rutas_de_maquina_estan_excluidas_del_csrf(self):
        """No llevan cookie ni formulario: se protegen con su token propio.
        Sin token válido responden 401, no 400 de CSRF."""
        respuesta = self.cliente.post("/admin/verificar-semana", json={"eventos": []})
        self.assertEqual(respuesta.status_code, 401)

    def test_el_token_de_maquina_se_compara_de_forma_segura(self):
        from webapp.auth import token_admin_valido

        self.assertFalse(token_admin_valido(None, self.ruta))
        self.assertFalse(token_admin_valido("", self.ruta))
        self.assertFalse(token_admin_valido("incorrecto", self.ruta))

    def test_procesar_dia_esta_retirada(self):
        respuesta = self.cliente.post("/admin/procesar-dia", json={"fecha": "2026-08-03", "eventos": []})
        self.assertEqual(respuesta.status_code, 410)

    def test_admin_debug_ya_no_existe(self):
        respuesta = self.cliente.post("/admin/debug", json={"mensaje": "hola"})
        self.assertEqual(respuesta.status_code, 404)


if __name__ == "__main__":
    unittest.main()
