import Image from "next/image";
import { notFound } from "next/navigation";

import { HistorialPublico } from "@/components/HistorialPublico";
import { Iconos } from "@/components/Iconos";
import { Avatar } from "@/components/PanelPerfil";
import { euros, mesMinuscula } from "@/lib/formato";
import { obtenerPerfilPublico } from "@/services/publico";

export const dynamic = "force-dynamic";

/**
 * Lo que se instala cuando el cliente añade su enlace a la pantalla de inicio.
 *
 * **Su manifiesto, no el del panel** (2026-08-14). El global dice
 * `start_url: "/clientes"`, así que el icono instalado desde aquí arrancaba en
 * el panel interno y el cliente acababa viendo una pantalla de correo y
 * contraseña. Ver `manifest.webmanifest/route.ts`.
 *
 * El título también se corrige: heredaba «Antifrágil — Clientes», que es el
 * nombre de la lista de Fernando y no significa nada para quien entra a ver
 * cómo va su bono.
 */
export function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  // No se consulta nada: si el token no vale, la propia página devuelve «no
  // encontrado» y el manifiesto, un 404.
  return params.then(({ token }) => ({
    title: "Antifrágil",
    manifest: `/mi/${encodeURIComponent(token)}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "Antifrágil", statusBarStyle: "default" as const },
  }));
}

/**
 * El perfil que ve el propio cliente con su enlace. Copia de
 * `webapp/templates/mi_perfil.html`.
 *
 * Es público a propósito: no pide contraseña, la llave es el token. Solo
 * lectura — el botón de confirmar se quitó de aquí a propósito (2026-07-29):
 * confirmar es algo que pasa delante de Fernando, escaneando su QR.
 */
export default async function PaginaMiPerfil({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const perfil = await obtenerPerfilPublico(token);
  if (!perfil) notFound();

  const { nombre, ficha, programas, confirmadasHoy, hoy, profesional } = perfil;
  const plural = (n: number) => (n === 1 ? "sesión" : "sesiones");
  const cuandoMes = ficha.mes ? ` en ${mesMinuscula(ficha.mes)}` : " este mes";

  return (
    <div className="page sin-barra">
      {/* Sin esto la flecha del historial no se dibuja: los iconos son un
          único bloque que hay que incluir en cada pantalla. Faltaba aquí y la
          barra parecía un rótulo muerto (2026-08-10). */}
      <Iconos />
      <div className="perfil-saludo">
        <Image src="/logo-marca.png" alt="Antifrágil" className="logo-login" width={180} height={48} priority />
        <h1>Hola, {nombre}</h1>
        <p className="subtitulo" style={{ margin: 0 }}>
          {ficha.modalidad === "mensualidad"
            ? "Así va tu mes"
            : ficha.modalidad === "cuenta"
              ? "Así va tu cuenta"
              : "Así va tu programa ahora mismo"}
        </p>
      </div>

      <div className="perfil-hero">
        {/* El NOMBRE del programa no se le enseña al cliente. Son etiquetas
            internas de Fernando y llevan la tarifa dentro: «Nuevo 45€ x4»,
            «Pareja 60€ x16». Se lo estaban viendo 7 de 9 clientes en esta
            misma línea (2026-08-10). */}
        <div className="programa-nombre">Tu programa</div>

        {ficha.modalidad === "bono" && ficha.sesionesTotales ? (
          <div className="perfil-progreso">
            <div className="perfil-progreso-numeros">
              <span className="grande">{ficha.sesionesHechas}</span>
              <span className="de">de {ficha.sesionesTotales} sesiones</span>
            </div>
            <div className="perfil-progreso-barra">
              <span style={{ width: `${ficha.porcentaje ?? 0}%` }} />
            </div>
            <div className="perfil-progreso-restantes">Te quedan {ficha.sesionesRestantes}</div>
          </div>
        ) : null}

        {ficha.modalidad === "mensualidad" && (
          <>
            {/* Sin barra ni «te quedan»: no hay nada que agotar. */}
            <div className="perfil-progreso">
              <div className="perfil-progreso-numeros">
                <span className="grande">{ficha.sesionesHechas}</span>
                <span className="de">
                  {plural(ficha.sesionesHechas)}
                  {cuandoMes}
                </span>
              </div>
            </div>
            {/* Sin «previstas» (Fernando, 2026-08-11). Es una referencia
                interna para calcular, no un compromiso: enseñársela al cliente
                lo convierte en uno —«me habías dicho doce»— cuando en una
                mensualidad se entrena lo que se pueda entrenar ese mes.
                La cuenta de cliente nunca la tuvo. */}
            <dl className="datos-servicio">
              <div>
                <dt>Cuota del mes</dt>
                <dd>{euros(ficha.cuotaMensual)}</dd>
              </div>
            </dl>
          </>
        )}

        {ficha.modalidad === "cuenta" && (
          <>
            <div className="perfil-progreso">
              <div className="perfil-progreso-numeros">
                <span className="grande">{ficha.sesionesHechas}</span>
                <span className="de">
                  {plural(ficha.sesionesHechas)}
                  {cuandoMes}
                </span>
              </div>
            </div>
            <dl className="datos-servicio">
              <div>
                <dt>Precio por sesión</dt>
                <dd>{euros(ficha.tarifa)}</dd>
              </div>
              <div>
                <dt>Total del mes</dt>
                <dd className="acumulado">{euros(ficha.facturacion)}</dd>
              </div>
            </dl>
          </>
        )}

        <div className="estado">
          {ficha.pendientePago ? (
            <span className="pill pendiente">Pendiente de pago</span>
          ) : (
            <span className="pill aldia">Al día</span>
          )}
        </div>
      </div>

      {confirmadasHoy.map((confirmacion, indice) => (
        <div className="aviso-guardado" key={`${confirmacion.hora}-${indice}`}>
          Sesión confirmada el {hoy} a las {confirmacion.hora}
        </div>
      ))}

      {/* Quién le entrena. Solo nombre y foto: esta pantalla la abre
          cualquiera que tenga el enlace, así que del profesional sale lo justo
          para que el cliente sepa con quién trata. */}
      {profesional && (
        <div className="tarjeta-profesional">
          <Avatar nombre={profesional.nombre} foto={profesional.fotoUrl} grande />
          <div>
            <div className="etiqueta-suave">Tu profesional</div>
            <div className="nombre-profesional">{profesional.nombre}</div>
          </div>
        </div>
      )}

      <HistorialPublico programas={programas} />
    </div>
  );
}
