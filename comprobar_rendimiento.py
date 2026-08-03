"""Comprueba que la app sigue yendo rápida. Lo que las pruebas no ven.

Por qué existe (2026-08-01): dos veces se entregó un cambio que empeoraba
la app sin saberlo — 13 elementos desenfocando el fondo a la vez tras el
rediseño, y un `<script>` sin `defer` que detenía el dibujado de la página.
Las 74 pruebas pasaban en ambos casos: un efecto caro o un recurso que
bloquea no rompen ningún test. Tuvo que reportarlo Fernando las dos veces.

Esto mide lo que sí se nota al usar la app:

  1. Recursos que BLOQUEAN el dibujado (scripts sin `defer` en la cabecera).
  2. Efectos caros del CSS (`backdrop-filter`, `filter: blur`) y, sobre
     todo, cuántos elementos los llevan a la vez mientras se hace scroll.
  3. Peso de lo que descarga el navegador en la primera visita.
  4. Conexiones a la base de datos por pantalla (abrir una cuesta más que
     la consulta en sí).
  5. Puntos de ruptura por ancho que el diseño no tiene.

Uso:
    python comprobar_rendimiento.py

Devuelve 0 si todo está dentro de los límites y 1 si algo se pasa, para
poder encadenarlo con las pruebas.
"""

import os
import re
import sys
import time
from pathlib import Path
from tempfile import mkstemp

RAIZ = Path(__file__).resolve().parent
PLANTILLAS = RAIZ / "webapp" / "templates"
ESTATICO = RAIZ / "webapp" / "static"

# Límites. No son caprichosos: salen de los problemas reales que ya se
# sufrieron en este proyecto (ver el log de lecciones).
LIMITES = {
    "bloqueantes": 0,        # nada debe frenar el dibujado de la página
    # 0, que es el estado real hoy: durante el scroll no queda ningún
    # desenfoque. Un límite por encima de lo que hay deja pasar regresiones
    # sin avisar — si algún día hace falta uno, se sube A CONCIENCIA y se
    # anota por qué compensa.
    "desenfoques_scroll": 0,
    "peso_kb": 120,          # primera visita; llegó a 175 KB con el logo sin redimensionar
    "conexiones_pagina": 6,  # abrir una conexión cuesta ~2 ms, y se suman
}

# Estos selectores solo aparecen sobre ventanas superpuestas (el QR, el
# panel), que existen únicamente mientras están abiertas: su desenfoque no
# se paga durante el scroll.
SELECTORES_SUPERPUESTOS = ("qr-fondo", "panel-fondo")


def _aviso(problemas, texto):
    problemas.append(texto)
    print(f"  [!] {texto}")


def revisar_bloqueantes(problemas) -> None:
    print("\n1. Recursos que bloquean el dibujado")
    culpables = []
    for archivo in sorted(PLANTILLAS.glob("*.html")):
        texto = archivo.read_text(encoding="utf-8")
        cabecera = texto.split("</head>")[0] if "</head>" in texto else texto
        for etiqueta in re.findall(r"<script\b[^>]*>", cabecera):
            if " src=" in etiqueta and " defer" not in etiqueta and " async" not in etiqueta:
                culpables.append(f"{archivo.name}: {etiqueta[:70]}")

    if culpables:
        for c in culpables:
            _aviso(problemas, f"script sin defer/async en la cabecera — {c}")
    else:
        print("  ok: ningún script frena el dibujado")


def revisar_efectos(problemas) -> None:
    print("\n2. Efectos caros del CSS durante el scroll")
    css = (ESTATICO / "style.css").read_text(encoding="utf-8")
    sin_comentarios = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

    caros = []
    for bloque in re.finditer(r"([^{}]+)\{([^}]*)\}", sin_comentarios):
        selector, cuerpo = bloque.group(1).strip(), bloque.group(2)
        if "backdrop-filter:" not in cuerpo and not re.search(r"[^-]filter:\s*blur", cuerpo):
            continue
        if any(s in selector for s in SELECTORES_SUPERPUESTOS):
            continue
        caros.append(selector.replace("\n", " ")[:60])

    print(f"  elementos con desenfoque visibles al hacer scroll: {len(caros)}")
    for c in caros:
        print(f"      · {c}")
    if len(caros) > LIMITES["desenfoques_scroll"]:
        _aviso(problemas, f"{len(caros)} elementos con desenfoque (límite {LIMITES['desenfoques_scroll']})")

    rupturas = re.findall(r"@media[^{]*\(min-width", sin_comentarios)
    if rupturas:
        _aviso(problemas, f"{len(rupturas)} punto(s) de ruptura por ancho — el diseño no tiene ninguno")
    else:
        print("  ok: sin puntos de ruptura por ancho")


def revisar_peso(problemas) -> None:
    print("\n3. Peso de la primera visita")
    piezas = ["style.css", "carga.js", "logo-marca.png", "favicon.png"]
    piezas += [f"fonts/{f.name}" for f in sorted((ESTATICO / "fonts").glob("geist-*.woff2"))]

    total = 0
    for nombre in piezas:
        ruta = ESTATICO / nombre
        if not ruta.exists():
            continue
        kb = ruta.stat().st_size / 1024
        total += kb
        marca = "  <-- pesado" if kb > 40 else ""
        print(f"      {nombre:<32} {kb:6.1f} KB{marca}")
    print(f"      {'TOTAL':<32} {total:6.1f} KB")

    if total > LIMITES["peso_kb"]:
        _aviso(problemas, f"{total:.0f} KB en la primera visita (límite {LIMITES['peso_kb']} KB)")


def revisar_consultas(problemas) -> None:
    print("\n4. Conexiones a la base de datos por pantalla")

    import basedatos
    import clientes.repositorio as cr
    import economia.registro as er
    import firma_publica as fp
    import registrar_asistencia as ra
    from datetime import date

    descriptor, ruta_str = mkstemp(suffix=".db")
    os.close(descriptor)
    ruta = Path(ruta_str)
    try:
        basedatos.crear_esquema(ruta)
        cr.guardar_programa("Bono", 35.0, 8, ruta=ruta)
        for nombre in ("Cliente A", "Cliente B", "Cliente C"):
            cr.crear_cliente(nombre, "Bono", 0, False, ruta=ruta)
        cr.asegurar_tokens(ruta=ruta)
        ra.registrar_sesion_pt("Cliente A", fecha=date(2026, 8, 3), ruta=ruta)

        original = basedatos.conectar
        cuenta = {"n": 0}

        def espia(r=ruta):
            cuenta["n"] += 1
            return original(ruta)

        modulos = [basedatos, cr, er, fp]
        try:
            import avisos
            modulos.append(avisos)
        except ImportError:
            avisos = None
        for modulo in modulos:
            modulo.conectar = espia

        pantallas = {
            "Clientes": lambda: (fp.avisar_confirmaciones_pendientes(ruta), cr.leer_clientes(ruta),
                                 avisos.contar_no_leidos(ruta)),
            "Clientes (1º del mes)": lambda: (cr.asegurar_ciclos_mensuales(2026, 8, ruta),
                                              fp.avisar_confirmaciones_pendientes(ruta),
                                              cr.leer_clientes(ruta), avisos.contar_no_leidos(ruta)),
            "Perfil": lambda: (cr.leer_clientes(ruta),
                               cr.obtener_programas_cliente("Cliente A", ruta=ruta),
                               fp.confirmaciones_de_hoy("Cliente A", ruta=ruta),
                               avisos.contar_no_leidos(ruta)),
            "Economía": lambda: (er.obtener_ultima_semana(ruta), er.listar_meses(ruta),
                                 avisos.contar_no_leidos(ruta)),
        }

        for etiqueta, trabajo in pantallas.items():
            cuenta["n"] = 0
            inicio = time.perf_counter()
            trabajo()
            ms = (time.perf_counter() - inicio) * 1000
            print(f"      {etiqueta:<12} {cuenta['n']:>2} conexiones   {ms:6.1f} ms")
            if cuenta["n"] > LIMITES["conexiones_pagina"]:
                _aviso(problemas, f"{etiqueta}: {cuenta['n']} conexiones (límite {LIMITES['conexiones_pagina']})")

        for modulo in modulos:
            modulo.conectar = original
    finally:
        for sufijo in ("", "-wal", "-shm"):
            candidato = Path(str(ruta) + sufijo)
            try:
                if candidato.exists():
                    candidato.unlink()
            except PermissionError:
                pass


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    print("=" * 66)
    print("COMPROBACIÓN DE RENDIMIENTO — lo que las pruebas no ven")
    print("=" * 66)

    problemas = []
    revisar_bloqueantes(problemas)
    revisar_efectos(problemas)
    revisar_peso(problemas)
    revisar_consultas(problemas)

    print("\n" + "=" * 66)
    if problemas:
        print(f"{len(problemas)} problema(s) de rendimiento — CORREGIR ANTES DE ENTREGAR:")
        for p in problemas:
            print(f"  · {p}")
        raise SystemExit(1)
    print("Todo dentro de los límites. La app sigue yendo rápida.")


if __name__ == "__main__":
    main()
