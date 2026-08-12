"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionCambiarClave, accionGuardarPerfil } from "@/app/actions";
import type { PerfilVisible } from "@/lib/foto-perfil";
import { Icono } from "./Iconos";

/**
 * «Lo mío»: nombre, foto y contraseña.
 *
 * Sustituye al chip «Mi cuenta» que estaba suelto en la cabecera de la lista
 * de clientes (Fernando, 2026-08-10). Aquello mezclaba dos cosas: la lista es
 * el trabajo, y la cuenta es quién eres. Ahora se entra por la propia foto,
 * que es donde todo el mundo busca esto.
 *
 * Sube desde abajo, igual que el panel de filtros. Es la segunda ventana de la
 * aplicación y comparte el mismo lenguaje a propósito: quien ha aprendido a
 * cerrar una, sabe cerrar la otra.
 *
 * Lo tienen los dos roles. Un entrenador lo necesita incluso más: entra con
 * una contraseña temporal que le pasa Fernando y tiene que poder estrenarla.
 */
export function PanelPerfil({
  abierto,
  alCerrar,
  usuario,
}: {
  abierto: boolean;
  alCerrar: () => void;
  usuario: PerfilVisible & { correo: string };
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [seccion, setSeccion] = useState<"datos" | "clave">("datos");

  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", alPulsar);
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPulsar);
      document.body.style.overflow = overflow;
    };
  }, [abierto, alCerrar]);

  // Al cerrarlo vuelve a su primera pantalla: abrirlo otra vez y encontrarse
  // el formulario de la contraseña a medias sería desconcertante.
  useEffect(() => {
    if (!abierto) setSeccion("datos");
  }, [abierto]);

  if (!abierto) return null;

  return (
    <div className="panel-fondo" onClick={alCerrar} role="presentation">
      <div
        ref={panel}
        className="panel-filtros"
        role="dialog"
        aria-modal="true"
        aria-label="Mi perfil"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-cabecera">
          <span className="panel-titulo">Mi perfil</span>
          <button type="button" className="panel-cerrar" onClick={alCerrar} aria-label="Cerrar">
            <Icono nombre="i-x" pequeno />
          </button>
        </div>

        <div className="panel-cuerpo">
          {seccion === "datos" ? (
            <Datos usuario={usuario} alIrAClave={() => setSeccion("clave")} />
          ) : (
            <Clave alVolver={() => setSeccion("datos")} />
          )}
        </div>

        {seccion === "datos" && (
          <div className="panel-pie">
            {/* Enlace normal, no `<Link>`: el enrutador precarga los enlaces a
                la vista, y precargar «Salir» cerraba la sesión sola. */}
            <a className="boton-secundario" href="/salir">
              Cerrar sesión
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Datos({
  usuario,
  alIrAClave,
}: {
  usuario: PerfilVisible & { correo: string };
  alIrAClave: () => void;
}) {
  const [resultado, enviar] = useActionState(accionGuardarPerfil, null);
  const [nombre, setNombre] = useState(usuario.nombre);

  /**
   * Qué se manda en el campo `foto`:
   *
   *   ""        → no la toques (lo normal: se abre el panel y no se cambia)
   *   "quitar"  → bórrala
   *   data:…    → esta nueva
   *
   * Así **la foto actual no viaja al navegador**: se ve por su dirección, que
   * ocupa cuarenta caracteres en vez de 18 KB.
   */
  const [cambioDeFoto, setCambioDeFoto] = useState("");

  // Lo que se ve: la nueva si acaba de elegir una, ninguna si la ha quitado, y
  // si no, la que ya tenía.
  const enPantalla =
    cambioDeFoto === "quitar" ? null : cambioDeFoto || usuario.fotoUrl;
  const tieneFoto = enPantalla !== null && enPantalla !== "";

  return (
    <form action={enviar} className="perfil-form">
      <div className="perfil-foto-fila">
        <Avatar nombre={nombre} foto={enPantalla} grande />
        <div className="perfil-foto-acciones">
          <label className="boton-secundario boton-foto">
            {tieneFoto ? "Cambiar foto" : "Poner foto"}
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const archivo = e.target.files?.[0];
                if (archivo) setCambioDeFoto(await encoger(archivo));
                // Permite volver a elegir el mismo archivo si se arrepiente.
                e.target.value = "";
              }}
            />
          </label>
          {tieneFoto && (
            <button type="button" className="boton-texto" onClick={() => setCambioDeFoto("quitar")}>
              Quitar
            </button>
          )}
        </div>
      </div>

      <label className="campo">
        <span>Tu nombre</span>
        <input
          type="text"
          name="nombre"
          required
          maxLength={40}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <span className="meta">Es el que se ve en el filtro por profesional.</span>
      </label>

      <input type="hidden" name="foto" value={cambioDeFoto} />

      <p className="meta">{usuario.correo}</p>

      {resultado && (
        <div className={resultado.ok ? "aviso-guardado" : "aviso-error"}>
          {resultado.ok ? "✔ " : ""}
          {resultado.mensaje}
        </div>
      )}

      <Enviar texto="Guardar" />

      <button type="button" className="boton-secundario" onClick={alIrAClave}>
        Cambiar contraseña
      </button>
    </form>
  );
}

function Clave({ alVolver }: { alVolver: () => void }) {
  const [resultado, enviar] = useActionState(accionCambiarClave, null);

  return (
    <form action={enviar} className="perfil-form">
      <button type="button" className="volver volver-panel" onClick={alVolver}>
        <Icono nombre="i-arrow-left" pequeno />
        Mi perfil
      </button>

      <label className="campo">
        <span>Contraseña actual</span>
        <input type="password" name="actual" required autoComplete="current-password" autoCapitalize="off" />
      </label>

      <label className="campo">
        <span>Contraseña nueva</span>
        <input type="password" name="nueva" required minLength={8} autoComplete="new-password" autoCapitalize="off" />
        <span className="meta">Al menos 8 caracteres.</span>
      </label>

      <label className="campo">
        <span>Repítela</span>
        <input type="password" name="repetir" required minLength={8} autoComplete="new-password" autoCapitalize="off" />
      </label>

      {resultado && (
        <div className={resultado.ok ? "aviso-guardado" : "aviso-error"}>
          {resultado.ok ? "✔ " : ""}
          {resultado.mensaje}
        </div>
      )}

      <Enviar texto="Cambiar contraseña" />
    </form>
  );
}

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

/**
 * La foto, o las iniciales si no hay.
 *
 * Nunca un hueco gris: un círculo vacío no dice nada y encima invita a
 * pulsarlo pensando que está roto.
 */
export function Avatar({
  nombre,
  foto,
  grande = false,
}: {
  nombre: string;
  /**
   * La DIRECCIÓN de la foto (`/perfil/<id>/foto?v=…`), no la foto entera.
   *
   * Incrustarla costaba 18 KB en cada carga de cada pantalla (2026-08-12).
   * Así la descarga el navegador una vez y la guarda.
   *
   * La única excepción es mientras se está eligiendo una nueva: ahí sí llega
   * la imagen recién leída del móvil, para poder verla antes de guardar.
   */
  foto?: string | null;
  grande?: boolean;
}) {
  const iniciales = nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span className={`avatar${grande ? " avatar-grande" : ""}`} aria-hidden="true">
      {foto ? (
        /* `<img>` a propósito, no `next/image`: la foto viene incrustada en la
           propia página como data URI de 160×160 y ya está encogida. El
           optimizador de Next no puede hacer nada con ella salvo estorbar. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={foto} alt="" />
      ) : (
        iniciales
      )}
    </span>
  );
}

/**
 * Encoge la foto en el propio móvil antes de enviarla.
 *
 * Una foto de cámara son 3-5 MB. Aquí se recorta a un cuadrado de 160 px y
 * sale en unos pocos kilobytes, que es lo que se guarda en la base. Sin esto,
 * subir una foto sería mandar megas por la red para pintar un círculo de un
 * centímetro.
 */
async function encoger(archivo: File): Promise<string> {
  const bitmap = await createImageBitmap(archivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const lienzo = document.createElement("canvas");
  lienzo.width = 160;
  lienzo.height = 160;

  const ctx = lienzo.getContext("2d")!;
  // Recorte cuadrado desde el centro: es como se mira una foto de perfil.
  ctx.drawImage(
    bitmap,
    (bitmap.width - lado) / 2,
    (bitmap.height - lado) / 2,
    lado,
    lado,
    0,
    0,
    160,
    160,
  );
  bitmap.close();
  return lienzo.toDataURL("image/jpeg", 0.8);
}
