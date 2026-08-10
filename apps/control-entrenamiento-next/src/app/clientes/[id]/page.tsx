import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";

import { accionFirmar } from "@/app/actions";
import { BotonFirmar, EnlaceYQr } from "@/components/AccionesPerfil";
import { HistorialProgramas } from "@/components/HistorialProgramas";
import { Iconos, Icono } from "@/components/Iconos";
import { Ltv } from "@/components/Ltv";
import { PerfilHero } from "@/components/PerfilHero";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { confirmacionDeHoy, obtenerPerfil } from "@/services/clientes";

import { esAdmin, exigirAccesoACliente } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/** Misma estructura que `webapp/templates/perfil_cliente.html`. */
export default async function PaginaPerfil({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ firmado?: string; borrado?: string; cobro?: string; guardado?: string }>;
}) {
  const { id } = await params;

  // El candado. Antes de leer nada de este cliente: un entrenador que
  // escriba la dirección a mano de un cliente ajeno recibe «no existe».
  const usuario = await exigirAccesoACliente(id);

  // Qué ve cada uno del dinero, que NO es todo o nada (Fernando, 2026-08-10):
  //
  //   Los importes de ESTE cliente —su tarifa, su programa, lo que paga—
  //     los ve todo el mundo que tenga acceso a él. Un entrenador los
  //     necesita: es él quien le pone el precio al darlo de alta, y quien
  //     responde si el cliente pregunta.
  //
  //   verLtv → el valor acumulado Y el precio por hora. Las dos son cuentas
  //     del negocio, no del servicio, y se quedan para el administrador. Un
  //     entrenador ve lo que paga su cliente —el precio del bono, la cuota—
  //     pero no a cuánto sale la hora.
  const verLtv = esAdmin(usuario);
  let perfil;
  try {
    perfil = await obtenerPerfil(id);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  if (!perfil) notFound();

  const { cliente, ficha, servicios, ltv } = perfil;
  const { firmado, borrado, cobro, guardado } = await searchParams;

  const confirmacion = await confirmacionDeHoy(cliente.id);

  // La dirección se calcula desde la petición: así el enlace es correcto tanto
  // en local como desplegado, sin configurarlo en dos sitios.
  const cabeceras = await headers();
  const anfitrion = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo = anfitrion.startsWith("localhost") ? "http" : "https";
  const enlace = `${protocolo}://${anfitrion}/mi/${cliente.token}`;
  const qr = await QRCode.toDataURL(`${enlace}/confirmar`, {
    width: 190,
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const estado = cliente.estado[0]!.toUpperCase() + cliente.estado.slice(1);

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clientes">
          <Icono nombre="i-arrow-left" pequeno />
          Clientes
        </Link>

        {/* Nombre y estado en la misma línea: el estado se ve de un vistazo y
            es un enlace a cambiarlo, así que no hace falta subtítulo. */}
        <div className="ficha-titulo">
          <h1>{cliente.nombre}</h1>
          <Link className={`pill estado-${cliente.estado}`} href={`/clientes/${cliente.id}/datos`}>
            {estado}
          </Link>
        </div>

        {firmado && <div className="aviso-guardado">✔ Sesión firmada — {firmado}</div>}
        {borrado && <div className="aviso-guardado">✔ Sesión borrada — {borrado}</div>}
        {guardado && <div className="aviso-guardado">✔ Guardado: {guardado}</div>}
        {cobro && (
          <div className="aviso-guardado">
            ✔ Estado de cobro actualizado — no se ha tocado ninguna sesión ni la economía
          </div>
        )}

        {cliente.estado !== "activo" ? (
          <div className="aviso-texto">
            Este cliente está <strong>{cliente.estado}</strong>:{" "}
            {cliente.estado === "pausado"
              ? "no se pueden firmar sesiones mientras lo esté."
              : "no se pueden firmar sesiones."}{" "}
            Su servicio y su historial se conservan intactos. Puedes reactivarlo en «Editar datos».
          </div>
        ) : (
          !ficha.completo && (
            <div className="aviso-texto">
              No se pueden firmar sesiones todavía: a este servicio le falta{" "}
              <strong>{ficha.faltan.join(" y ")}</strong>. Rellénalo en «Editar programa».
            </div>
          )
        )}

        <PerfilHero clienteId={cliente.id} ficha={ficha} verPrecioHora={verLtv} />

        {/* Acción principal. Depende de `ficha.puedeFirmar`, que mira el estado
            del cliente y los datos que SU modalidad necesita. */}
        {ficha.puedeFirmar && (
          <form action={accionFirmar} className="accion-principal">
            <input type="hidden" name="clienteId" value={cliente.id} />
            {/* Un valor distinto en cada carga: dos envíos del mismo formulario
                cuentan como uno solo. */}
            <input type="hidden" name="claveIdempotencia" value={randomUUID()} />
            <BotonFirmar />
          </form>
        )}

        {/* El valor acumulado del cliente. Va aquí, entre la acción principal y
            las secundarias, por dos motivos: no empuja hacia abajo el botón de
            firmar —que es lo que se usa a diario— y queda a la altura de lo
            que de verdad es, un dato de consulta. */}
        {verLtv && <Ltv ltv={ltv} />}

        {/* Acciones secundarias, del mismo tamaño. */}
        <div className="acciones-perfil">
          <Link className="boton-secundario" href={`/clientes/${cliente.id}/datos`}>
            Editar datos
          </Link>
          {/* Cambiar el programa es cambiar tarifas: solo el administrador.
              La pantalla lo exige por su cuenta, esto solo evita enseñar un
              botón que respondería «no existe». */}
          <Link className="boton-secundario" href={`/clientes/${cliente.id}/programa`}>
            Editar programa
          </Link>
        </div>

        <EnlaceYQr
          nombre={cliente.nombre}
          enlace={enlace}
          qr={qr}
          mostrarQr={Boolean(firmado) && confirmacion.hayPendiente}
          confirmadas={confirmacion.confirmadas}
        />

        <HistorialProgramas clienteId={cliente.id} nombre={cliente.nombre} servicios={servicios} />
      </div>
    </>
  );
}
