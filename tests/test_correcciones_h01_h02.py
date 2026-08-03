"""Corrección de los dos hallazgos de la Fase 3 (autorizada por Fernando,
2026-08-03).

**H-01 — las horas de una mensualidad no llegaban a la vista semanal.**
Un cliente de mensualidad con 3 sesiones firmadas dejaba la semana en 0 € y
**0 horas**. El dinero es correcto (la cuota es mensual, no semanal), pero
las horas no: son horas trabajadas de verdad, y sin ellas el precio medio
por hora de la semana sale inflado. Es el mismo hueco que ya se corrigió en
la vista mensual el 2026-08-03.

**H-02 — dos indicadores del mismo cobro que podían contradecirse.**
El ciclo de una mensualidad podía decir «pagada» mientras su cargo de ese
mismo mes decía «sin cobrar». A partir de ahora, **para una mensualidad
manda el cargo del mes**.

Reglas que estas correcciones NO pueden romper, y que se comprueban aquí:

- `pagado = NULL` sigue significando «no se sabe», nunca «no pagado».
- No se reinterpretan datos históricos: un ciclo mensual **sin** cargo
  conserva su valor guardado, incluido el nulo.
- Un bono pagado y una mensualidad cobrada siguen siendo cosas distintas,
  con nombres distintos en pantalla.
- Ninguna cifra ya cerrada de un bono se mueve.
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
from servicios.modalidades import etiqueta_pago


class BaseCorrecciones(unittest.TestCase):
    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db", prefix="h01h02-")
        os.close(descriptor)
        self.ruta = Path(ruta)
        basedatos.crear_esquema(self.ruta)
        cr.guardar_programa("Bono 8", 45.0, 8, ruta=self.ruta)
        self.addCleanup(self._limpiar)

    def _limpiar(self):
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                pass

    def bono(self, nombre="Cliente A"):
        cr.crear_cliente(nombre, "Bono 8", 0, False, ruta=self.ruta)

    def mensualidad(self, nombre="Cliente B", cuota=720, cuando=date(2026, 8, 3)):
        cr.crear_cliente(nombre, "Bono 8", 0, False, ruta=self.ruta)
        cr.configurar_servicio(
            nombre, "mensualidad", nombre_servicio="Mensualidad",
            cuota_mensual=cuota, hoy=cuando, ruta=self.ruta,
        )

    def cuenta(self, nombre="Cliente D", precio=35, cuando=date(2026, 8, 3)):
        cr.crear_cliente(nombre, "Bono 8", 0, False, ruta=self.ruta)
        cr.configurar_servicio(
            nombre, "cuenta", nombre_servicio="Cuenta", tarifa=precio, hoy=cuando, ruta=self.ruta,
        )

    def firmar(self, nombre, veces=1, cuando=date(2026, 8, 3)):
        for _ in range(veces):
            ra.registrar_sesion_pt(nombre, fecha=cuando, ruta=self.ruta)

    def semana(self, inicio="2026-08-03"):
        return er.obtener_semana(inicio, self.ruta)

    def cargo(self, cliente, anio=2026, mes=8):
        with basedatos.conectar(self.ruta) as conexion:
            fila = conexion.execute(
                "SELECT * FROM cargos_mensuales WHERE cliente = ? AND anio = ? AND mes = ?",
                (cliente, anio, mes),
            ).fetchone()
        return dict(fila) if fila else None


# ---------------------------------------------------------------------------
# H-01 · Las horas trabajadas llegan a la vista semanal
# ---------------------------------------------------------------------------


class TestH01HorasDeMensualidadEnLaSemana(BaseCorrecciones):
    def test_tres_sesiones_de_mensualidad_son_tres_horas_en_la_semana(self):
        self.mensualidad()
        self.firmar("Cliente B", 3)
        self.assertEqual(self.semana()["horas_totales"], 3)

    def test_esas_sesiones_siguen_sin_sumar_dinero_a_la_semana(self):
        """La cuota es mensual: cobrarla también por semana sería cobrarla
        dos veces. Solo cambian las horas."""
        self.mensualidad()
        self.firmar("Cliente B", 3)
        self.assertEqual(self.semana()["facturacion_total"], 0.0)

    def test_el_precio_medio_por_hora_de_la_semana_deja_de_salir_inflado(self):
        """Un bono a 45 € y una mensualidad, la misma semana. Antes la semana
        decía 45 €/h (1 hora); ahora dice 45 € entre 4 horas."""
        self.bono("Cliente A")
        self.mensualidad("Cliente B")
        self.firmar("Cliente A", 1)
        self.firmar("Cliente B", 3)
        semana = self.semana()
        self.assertEqual(semana["facturacion_total"], 45.0)
        self.assertEqual(semana["horas_totales"], 4)
        self.assertEqual(round(semana["precio_medio_hora"], 2), 11.25)

    def test_borrar_una_sesion_de_mensualidad_devuelve_su_hora(self):
        self.mensualidad()
        self.firmar("Cliente B", 3)
        entrada = cr.obtener_historial("Cliente B", ruta=self.ruta)[0]
        ra.eliminar_sesion_pt(entrada["id"], ruta=self.ruta)
        self.assertEqual(self.semana()["horas_totales"], 2)

    def test_borrarlas_todas_deja_la_semana_a_cero(self):
        self.mensualidad()
        self.firmar("Cliente B", 2)
        for entrada in cr.obtener_historial("Cliente B", ruta=self.ruta):
            ra.eliminar_sesion_pt(entrada["id"], ruta=self.ruta)
        self.assertEqual(self.semana()["horas_totales"], 0)
        self.assertEqual(self.semana()["facturacion_total"], 0.0)

    def test_mover_una_sesion_de_mensualidad_traslada_su_hora(self):
        self.mensualidad(cuando=date(2026, 7, 27))
        self.firmar("Cliente B", 2, cuando=date(2026, 8, 3))
        entrada = cr.obtener_historial("Cliente B", ruta=self.ruta)[0]
        ra.editar_sesion_pt(entrada["id"], "2026-07-31", entrada["numero_sesion"], ruta=self.ruta)
        self.assertEqual(self.semana("2026-08-03")["horas_totales"], 1)
        self.assertEqual(self.semana("2026-07-27")["horas_totales"], 1)

    def test_la_vista_mensual_no_cambia(self):
        """El mes ya contaba bien estas horas. La corrección es de la
        semana, y no puede alterar el mes."""
        self.mensualidad()
        self.firmar("Cliente B", 3)
        mes = er.obtener_mes(2026, 8, self.ruta)
        self.assertEqual(mes["horas_totales"], 3)
        self.assertEqual(mes["facturacion_total"], 720.0)

    def test_semana_y_mes_dicen_ahora_las_mismas_horas(self):
        """La incoherencia que motivó el hallazgo: 0 horas en la semana y 3
        en el mes, con las mismas sesiones."""
        self.mensualidad()
        self.firmar("Cliente B", 3)
        self.assertEqual(
            self.semana()["horas_totales"], er.obtener_mes(2026, 8, self.ruta)["horas_totales"]
        )

    def test_un_bono_sigue_exactamente_igual(self):
        self.bono("Cliente A")
        self.firmar("Cliente A", 4)
        semana = self.semana()
        self.assertEqual(semana["facturacion_total"], 180.0)
        self.assertEqual(semana["horas_totales"], 4)
        self.assertEqual(semana["precio_medio_hora"], 45.0)

    def test_una_cuenta_de_cliente_sigue_exactamente_igual(self):
        """Una cuenta SÍ lleva importe por sesión, así que ya contaba bien.
        No puede contarse dos veces ahora."""
        self.cuenta()
        self.firmar("Cliente D", 3)
        semana = self.semana()
        self.assertEqual(semana["facturacion_total"], 105.0)
        self.assertEqual(semana["horas_totales"], 3)

    def test_crossfit_lidomare_sigue_exactamente_igual(self):
        ra.registrar_clase_grupo("lidomare", fecha=date(2026, 8, 3), ruta=self.ruta)
        semana = self.semana()
        self.assertEqual(semana["facturacion_total"], 15.0)
        self.assertEqual(semana["horas_totales"], 1)

    def test_crossfit_kids_sigue_sin_contar_hasta_tener_importe(self):
        ra.registrar_clase_grupo("kids", fecha=date(2026, 8, 3), ruta=self.ruta)
        self.assertEqual(self.semana()["horas_totales"], 0)
        self.assertTrue(self.semana()["provisional"])

    def test_la_comprobacion_interna_detecta_un_descuadre_de_horas(self):
        """La red de seguridad tiene que cubrir también la cifra nueva: si
        alguien toca las horas a mano, el sistema lo dice."""
        self.mensualidad()
        self.firmar("Cliente B", 3)
        self.assertEqual(
            er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), self.ruta), []
        )
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute("UPDATE semanas SET horas_sin_importe = 99 WHERE fecha_inicio = '2026-08-03'")
        discrepancias = er.verificar_sincronizacion_semana(date(2026, 8, 3), date(2026, 8, 9), self.ruta)
        self.assertTrue(discrepancias)
        self.assertIn("sin importe", " ".join(discrepancias))


class TestH01MigracionAditiva(unittest.TestCase):
    """La columna nueva se añade sin tocar ninguna semana ya cerrada."""

    def setUp(self):
        descriptor, ruta = mkstemp(suffix=".db", prefix="h01-migra-")
        os.close(descriptor)
        self.ruta = Path(ruta)
        self.addCleanup(self._limpiar)

    def _limpiar(self):
        for sufijo in ("", "-wal", "-shm"):
            try:
                Path(str(self.ruta) + sufijo).unlink(missing_ok=True)
            except OSError:
                pass

    def _base_sin_la_columna(self):
        """Reconstruye la forma que tenía `semanas` antes de esta corrección."""
        import sqlite3

        conexion = sqlite3.connect(self.ruta)
        conexion.execute(
            "CREATE TABLE semanas (fecha_inicio TEXT PRIMARY KEY, fecha_fin TEXT NOT NULL, "
            "anio INTEGER NOT NULL, mes INTEGER NOT NULL, facturacion_pt_lidomare REAL NOT NULL, "
            "horas_pt_lidomare INTEGER NOT NULL, sesiones_kids INTEGER NOT NULL DEFAULT 0, "
            "facturacion_kids REAL)"
        )
        conexion.execute(
            "INSERT INTO semanas VALUES ('2026-07-20','2026-07-26',2026,7,630.0,15,0,NULL)"
        )
        conexion.commit()
        conexion.close()

    def test_la_columna_no_existe_antes_de_migrar(self):
        self._base_sin_la_columna()
        with basedatos.conectar(self.ruta) as conexion:
            columnas = {f["name"] for f in conexion.execute("PRAGMA table_info(semanas)")}
        self.assertNotIn("horas_sin_importe", columnas)

    def test_migrar_anade_la_columna_sin_mover_ninguna_cifra(self):
        self._base_sin_la_columna()
        basedatos.crear_esquema(self.ruta)
        semana = er.obtener_semana("2026-07-20", self.ruta)
        self.assertEqual(semana["facturacion_total"], 630.0)
        self.assertEqual(semana["horas_totales"], 15)
        self.assertEqual(semana["precio_medio_hora"], 42.0)

    def test_es_segura_de_repetir(self):
        self._base_sin_la_columna()
        for _ in range(3):
            basedatos.crear_esquema(self.ruta)
        semana = er.obtener_semana("2026-07-20", self.ruta)
        self.assertEqual(semana["facturacion_total"], 630.0)
        self.assertEqual(semana["horas_totales"], 15)

    def test_las_semanas_antiguas_nacen_con_cero_horas_sin_importe(self):
        """Y es lo correcto: todas las sesiones anteriores a esta corrección
        llevan su importe. No se está suponiendo nada."""
        self._base_sin_la_columna()
        basedatos.crear_esquema(self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            valor = conexion.execute(
                "SELECT horas_sin_importe FROM semanas WHERE fecha_inicio = '2026-07-20'"
            ).fetchone()["horas_sin_importe"]
        self.assertEqual(valor, 0)


# ---------------------------------------------------------------------------
# H-02 · El cargo del mes manda en una mensualidad
# ---------------------------------------------------------------------------


class TestH02ElCargoMandaEnLaMensualidad(BaseCorrecciones):
    def test_al_configurar_una_mensualidad_ciclo_y_cargo_dicen_lo_mismo(self):
        """Era el caso exacto del hallazgo: el ciclo decía «pagada» y el
        cargo decía «sin cobrar»."""
        self.mensualidad()
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)
        self.assertEqual(bool(ciclo["pagado"]), bool(self.cargo("Cliente B")["pagado"]))
        self.assertFalse(bool(ciclo["pagado"]), "una mensualidad recién abierta no está cobrada")

    def test_la_ficha_del_cliente_tambien_lo_dice(self):
        self.mensualidad()
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente B"]["pendiente_pago"], "Sí")

    def test_marcar_cobrado_deja_los_tres_de_acuerdo(self):
        self.mensualidad()
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Cliente B", True, ciclo=ciclo, ruta=self.ruta)
        self.assertTrue(bool(cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["pagado"]))
        self.assertTrue(bool(self.cargo("Cliente B")["pagado"]))
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente B"]["pendiente_pago"], "No")

    def test_el_cargo_manda_aunque_el_ciclo_guardado_diga_otra_cosa(self):
        """Se fuerza a mano la contradicción y se comprueba quién gana."""
        self.mensualidad()
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "UPDATE programas_cliente SET pagado = 1 WHERE cliente = 'Cliente B' AND ciclo_bono = ?",
                (ciclo,),
            )
        self.assertFalse(
            bool(cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["pagado"]),
            "el cargo del mes dice que no está cobrado y tiene que mandar él",
        )

    def test_el_historial_de_servicios_tambien_lee_del_cargo(self):
        self.mensualidad()
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Cliente B", True, ciclo=ciclo, ruta=self.ruta)
        servicios = cr.obtener_programas_cliente("Cliente B", ruta=self.ruta)
        mensual = next(s for s in servicios if s["ciclo_bono"] == ciclo)
        self.assertTrue(bool(mensual["pagado"]))

    def test_la_deuda_de_una_mensualidad_sale_del_cargo(self):
        self.mensualidad()
        self.assertEqual(len(cr.deuda_pendiente("Cliente B", ruta=self.ruta)), 1)
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Cliente B", True, ciclo=ciclo, ruta=self.ruta)
        self.assertEqual(cr.deuda_pendiente("Cliente B", ruta=self.ruta), [])

    def test_al_cambiar_de_mes_cada_mes_conserva_su_estado_real(self):
        """Agosto cobrado, septiembre no. Cerrar el mes no puede contagiar
        un estado al otro."""
        self.mensualidad(cuando=date(2026, 8, 3))
        ciclo_agosto = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Cliente B", True, ciclo=ciclo_agosto, ruta=self.ruta)

        cr.asegurar_ciclos_mensuales(2026, 9, ruta=self.ruta)
        servicios = {s["ciclo_bono"]: s for s in cr.obtener_programas_cliente("Cliente B", ruta=self.ruta)}
        self.assertTrue(bool(servicios[ciclo_agosto]["pagado"]), "agosto estaba cobrado")
        self.assertFalse(bool(servicios[ciclo_agosto + 1]["pagado"]), "septiembre aún no")
        self.assertTrue(bool(self.cargo("Cliente B", 2026, 8)["pagado"]))
        self.assertFalse(bool(self.cargo("Cliente B", 2026, 9)["pagado"]))


class TestH02NoSeReinterpretaElPasado(BaseCorrecciones):
    """La regla más delicada de las dos correcciones."""

    def _mensualidad_legacy(self, pagado, anio=2026, mes=6, ciclo=0):
        """Una mensualidad antigua SIN cargo asociado — como las que dejó la
        migración de datos anteriores a esta versión."""
        self.bono("Cliente B")
        with basedatos.transaccion(self.ruta) as conexion:
            conexion.execute(
                "INSERT INTO programas_cliente (cliente, ciclo_bono, tipo_programa, modalidad, "
                "cuota_mensual, sesiones_totales, anio, mes, fecha_inicio, fecha_fin, pagado) "
                "VALUES ('Cliente B', ?, 'Mensualidad', 'mensualidad', 720.0, 0, ?, ?, "
                "'2026-06-01', '2026-06-28', ?)",
                (ciclo, anio, mes, pagado),
            )

    def test_un_ciclo_mensual_sin_cargo_conserva_su_nulo(self):
        """`NULL` sigue siendo «no se sabe». No se convierte en «no pagado»
        por el hecho de que no haya cargo: es que ese cobro nunca se
        registró."""
        self._mensualidad_legacy(None)
        servicios = {s["ciclo_bono"]: s for s in cr.obtener_programas_cliente("Cliente B", ruta=self.ruta)}
        self.assertIsNone(servicios[0]["pagado"])

    def test_un_ciclo_mensual_sin_cargo_y_nulo_no_cuenta_como_deuda(self):
        self._mensualidad_legacy(None)
        self.assertEqual(cr.deuda_pendiente("Cliente B", ruta=self.ruta), [])
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente B"]["ciclos_pendientes"], 0)

    def test_un_ciclo_mensual_sin_cargo_marcado_pagado_lo_sigue_estando(self):
        self._mensualidad_legacy(1)
        servicios = {s["ciclo_bono"]: s for s in cr.obtener_programas_cliente("Cliente B", ruta=self.ruta)}
        self.assertTrue(bool(servicios[0]["pagado"]))

    def test_un_ciclo_mensual_sin_cargo_marcado_sin_cobrar_sigue_debiendo(self):
        self._mensualidad_legacy(0)
        self.assertEqual(len(cr.deuda_pendiente("Cliente B", ruta=self.ruta)), 1)

    def test_el_valor_guardado_no_se_toca_al_leer(self):
        """Leer no escribe. El nulo sigue en la base de datos tal cual."""
        self._mensualidad_legacy(None)
        cr.obtener_programas_cliente("Cliente B", ruta=self.ruta)
        cr.leer_clientes(self.ruta)
        with basedatos.conectar(self.ruta) as conexion:
            valor = conexion.execute(
                "SELECT pagado FROM programas_cliente WHERE cliente='Cliente B' AND ciclo_bono=0"
            ).fetchone()["pagado"]
        self.assertIsNone(valor)


class TestH02LosBonosNoSeVenAfectados(BaseCorrecciones):
    def test_un_bono_no_lee_de_ningun_cargo(self):
        """Un bono no genera cuota mensual: su estado de cobro es el suyo."""
        self.bono("Cliente A")
        self.firmar("Cliente A", 8)
        servicios = {s["ciclo_bono"]: s for s in cr.obtener_programas_cliente("Cliente A", ruta=self.ruta)}
        self.assertTrue(bool(servicios[1]["pagado"]), "el bono agotado estaba al día")
        self.assertFalse(bool(servicios[2]["pagado"]), "el nuevo nace pendiente")
        self.assertIsNone(self.cargo("Cliente A"))

    def test_una_cuenta_de_cliente_tampoco(self):
        """Una cuenta se paga por lo hecho, no por adelantado: no hay cargo."""
        self.cuenta()
        self.firmar("Cliente D", 3)
        self.assertIsNone(self.cargo("Cliente D"))
        ciclo = cr.obtener_ciclo_actual("Cliente D", ruta=self.ruta)
        self.assertIsNotNone(ciclo["pagado"])

    def test_marcar_un_bono_pagado_no_crea_ningun_cargo(self):
        self.bono("Cliente A")
        self.firmar("Cliente A", 2)
        cr.marcar_pago_del_ciclo("Cliente A", True, ruta=self.ruta)
        self.assertIsNone(self.cargo("Cliente A"))
        self.assertEqual(cr.leer_clientes(self.ruta)["Cliente A"]["pendiente_pago"], "No")

    def test_bono_y_mensualidad_se_llaman_distinto_en_pantalla(self):
        """«Bono pagado» y «Mensualidad pagada» son conceptos distintos y
        tienen que seguir diciéndose distinto."""
        self.assertEqual(etiqueta_pago("bono", False), "Bono pagado")
        self.assertEqual(etiqueta_pago("mensualidad", False), "Mensualidad pagada")
        self.assertEqual(etiqueta_pago("cuenta", False), "Cuenta pagada")
        self.assertNotEqual(etiqueta_pago("bono", True), etiqueta_pago("cuenta", True))


class TestLasDosCorreccionesNoMuevenElDinero(BaseCorrecciones):
    """Ninguna de las dos toca la facturación. Se comprueba explícitamente
    porque es lo único que no se puede deshacer si sale mal."""

    def test_la_facturacion_mensual_es_la_misma_con_las_tres_modalidades(self):
        self.bono("Cliente A")
        self.mensualidad("Cliente B")
        self.cuenta("Cliente D")
        self.firmar("Cliente A", 2)   # 2 × 45 = 90
        self.firmar("Cliente B", 3)   # cuota 720, sin importe por sesión
        self.firmar("Cliente D", 4)   # 4 × 35 = 140
        mes = er.obtener_mes(2026, 8, self.ruta)
        self.assertEqual(mes["facturacion_total"], 90.0 + 720.0 + 140.0)
        self.assertEqual(mes["horas_totales"], 9)

    def test_marcar_cobros_arriba_y_abajo_no_mueve_ni_un_euro(self):
        self.mensualidad()
        self.firmar("Cliente B", 3)
        antes_mes = er.obtener_mes(2026, 8, self.ruta)
        antes_semana = self.semana()
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        for valor in (True, False, True, False):
            cr.marcar_pago_del_ciclo("Cliente B", valor, ciclo=ciclo, ruta=self.ruta)
        self.assertEqual(er.obtener_mes(2026, 8, self.ruta), antes_mes)
        self.assertEqual(self.semana(), antes_semana)

    def test_el_historial_no_se_toca(self):
        self.mensualidad()
        self.firmar("Cliente B", 3)
        antes = cr.obtener_historial("Cliente B", ruta=self.ruta)
        ciclo = cr.obtener_ciclo_actual("Cliente B", ruta=self.ruta)["ciclo_bono"]
        cr.marcar_pago_del_ciclo("Cliente B", True, ciclo=ciclo, ruta=self.ruta)
        self.assertEqual(cr.obtener_historial("Cliente B", ruta=self.ruta), antes)
