"""Ejecuta los escenarios compartidos contra el sistema Python actual.

Cada escenario de `tests/fixtures/escenarios.json` se ejecuta sobre una base
de datos temporal propia y se compara con el resultado esperado que está
escrito en el propio archivo.

Este mismo archivo de escenarios lo ejecutará después la versión de Next.js.
Cuando las dos fotografías coincidan, la equivalencia estará demostrada — no
opinada.

Ejecutar solo esto:
    python -m unittest tests.test_paridad_escenarios -v
"""

import json
import unittest
from pathlib import Path

from tests import motor_escenarios as motor

SALIDA = Path(__file__).parent / "fixtures" / "resultados_python.json"


class TestParidadEscenarios(unittest.TestCase):
    """Una prueba por escenario, generada dinámicamente más abajo.

    Se generan en vez de escribirse a mano para que añadir un escenario al
    JSON no exija tocar Python: quien añada una regla nueva escribe datos, no
    código."""


def _construir_prueba(escenario: dict):
    def prueba(self):
        obtenido = motor.ejecutar(escenario)
        diferencias = motor.comparar(escenario["esperado"], obtenido)
        if diferencias:
            self.fail(
                f"{escenario['id']} — {escenario['regla']}\n  "
                + "\n  ".join(diferencias)
            )

    prueba.__name__ = f"test_{escenario['id'].lower()}"
    prueba.__doc__ = f"{escenario['id']}: {escenario['regla']}"
    return prueba


for _escenario in motor.cargar_escenarios():
    setattr(TestParidadEscenarios, f"test_{_escenario['id'].lower()}", _construir_prueba(_escenario))


class TestElContratoEsSano(unittest.TestCase):
    """Comprobaciones sobre el propio archivo de escenarios.

    Un contrato con identificadores repetidos, escenarios sin resultado
    esperado o acciones inexistentes no protege nada: parecería que cubre
    reglas que en realidad no comprueba."""

    def setUp(self):
        self.escenarios = motor.cargar_escenarios()

    def test_los_identificadores_no_se_repiten(self):
        identificadores = [e["id"] for e in self.escenarios]
        self.assertEqual(len(identificadores), len(set(identificadores)))

    def test_todos_declaran_su_regla_y_lo_que_esperan(self):
        for escenario in self.escenarios:
            with self.subTest(escenario["id"]):
                self.assertTrue(escenario["regla"].strip())
                self.assertTrue(escenario["esperado"], "un escenario sin resultado esperado no comprueba nada")
                self.assertTrue(escenario["pasos"])

    def test_todas_las_acciones_existen(self):
        for escenario in self.escenarios:
            for paso in escenario["pasos"]:
                with self.subTest(f"{escenario['id']}/{paso['accion']}"):
                    self.assertIn(paso["accion"], motor.PASOS)

    def test_ningun_escenario_usa_datos_reales(self):
        """El repositorio es público. Los escenarios solo usan nombres
        genéricos, y esta prueba lo impide de forma activa en vez de
        confiar en que nadie se despiste."""
        permitidos = {"Cliente A", "Cliente A renombrado", "Cliente B", "Cliente D", "Pareja C"}
        for escenario in self.escenarios:
            for paso in escenario["pasos"]:
                for clave in ("cliente", "nuevo"):
                    if clave in paso:
                        with self.subTest(f"{escenario['id']}/{paso[clave]}"):
                            self.assertIn(paso[clave], permitidos)

    def test_son_deterministas(self):
        """Ejecutar dos veces el mismo escenario da exactamente lo mismo.

        Si no lo fuera, comparar Python contra TypeScript no significaría
        nada: la diferencia podría venir del propio ruido."""
        for escenario in self.escenarios[:6]:
            with self.subTest(escenario["id"]):
                self.assertEqual(motor.ejecutar(escenario), motor.ejecutar(escenario))


class TestGenerarResultados(unittest.TestCase):
    def test_se_deja_el_resultado_completo_para_comparar(self):
        """Escribe la fotografía COMPLETA de cada escenario en
        `tests/fixtures/resultados_python.json`.

        El JSON de escenarios solo declara los campos que cada regla afirma;
        este archivo guarda todo lo demás. Cuando exista el motor de
        TypeScript, comparar sus dos archivos detecta también los efectos
        colaterales que nadie pensó en declarar — que son justo los que se
        escapan."""
        resultados = {}
        for escenario in motor.cargar_escenarios():
            resultados[escenario["id"]] = {
                "regla": escenario["regla"],
                "foto": motor.ejecutar(escenario),
            }

        SALIDA.write_text(
            json.dumps(resultados, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.assertTrue(SALIDA.exists())
        self.assertEqual(len(resultados), len(motor.cargar_escenarios()))
