import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BotonFirmar } from "@/components/BotonFirmar";
import { CambiarEstado } from "@/components/CambiarEstado";
import { EnlaceDelCliente } from "@/components/EnlaceDelCliente";
import { EditarServicio } from "@/components/EditarServicio";
import { HistorialServicios } from "@/components/HistorialServicios";
import { ZonaPeligrosa } from "@/components/ZonaPeligrosa";
import { TarjetaServicio } from "@/components/TarjetaServicio";
import { haySesion } from "@/lib/auth";
import { obtenerPerfil } from "@/services/clientes";
import { SinConexion } from "@/components/SinConexion";
import { BaseNoDisponible } from "@/repositories/postgres";
import { headers } from "next/headers";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export default async function PaginaPerfil({ params }: { params: Promise<{ id: string }> }) {
  if (!(await haySesion())) redirect("/login");

  const { id } = await params;
  let perfil;
  try {
    perfil = await obtenerPerfil(id);
  } catch (error) {
    if (error instanceof BaseNoDisponible) return <SinConexion />;
    throw error;
  }
  if (!perfil) notFound();

  const { cliente, ficha, servicios } = perfil;

  // La dirección se calcula desde la petición: así el enlace es correcto tanto
  // en local como en el despliegue, sin tener que configurarlo en dos sitios.
  const cabeceras = await headers();
  const anfitrion = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "localhost:3000";
  const protocolo = anfitrion.startsWith("localhost") ? "http" : "https";
  const enlace = `${protocolo}://${anfitrion}/mi/${cliente.token}`;
  // El QR lleva a confirmar directamente: escanearlo ya confirma.
  const qr = await QRCode.toDataURL(`${enlace}/confirmar`, { margin: 1, width: 384 });

  return (
    <main className="flex flex-col gap-4">
      <Link
        href="/clientes"
        className="inline-flex items-center gap-1 text-sm text-tinta-suave hover:text-acento"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Clientes
      </Link>

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            cliente.estado === "activo" ? "bg-acento/10 text-acento-oscuro" : "bg-borde text-tinta-suave"
          }`}
        >
          {cliente.estado[0]!.toUpperCase() + cliente.estado.slice(1)}
        </span>
      </header>

      <TarjetaServicio ficha={ficha} />

      {/* La firma es la acción principal: va antes que nada editable. */}
      <BotonFirmar clienteId={cliente.id} ficha={ficha} />

      <CambiarEstado clienteId={cliente.id} estado={cliente.estado} nombre={cliente.nombre} />

      <EditarServicio clienteId={cliente.id} ficha={ficha} />

      <EnlaceDelCliente enlace={enlace} qr={qr} />

      <HistorialServicios clienteId={cliente.id} servicios={servicios} />

      <ZonaPeligrosa
        clienteId={cliente.id}
        nombre={cliente.nombre}
        sesiones={servicios.reduce((n, s) => n + s.sesiones.length, 0)}
        importe={servicios.reduce(
          (suma, s) => suma + s.sesiones.reduce((total, ses) => total + (ses.tarifa ?? 0), 0),
          0,
        )}
      />
    </main>
  );
}
