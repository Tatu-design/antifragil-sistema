import Link from "next/link";

import { FormularioClave } from "@/components/FormularioClave";
import { Iconos, Icono } from "@/components/Iconos";
import { exigirUsuario } from "@/lib/permisos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi contraseña — Antifrágil" };

/**
 * La cuenta de quien está dentro.
 *
 * De momento solo sirve para cambiar la contraseña, que es lo único que hacía
 * falta: las cuentas nuevas se crean con una temporal y no había forma de
 * estrenarla.
 *
 * La tienen los dos roles: el administrador y los entrenadores. Cada uno
 * cambia la suya y solo la suya — el correo lo pone el servidor desde la
 * sesión, nunca el formulario.
 */
export default async function PaginaCuenta() {
  const usuario = await exigirUsuario();

  return (
    <>
      <Iconos />
      <div className="page sin-barra">
        <Link className="volver" href="/clientes">
          <Icono nombre="i-arrow-left" pequeno />
          Clientes
        </Link>

        <FormularioClave correo={usuario.correo} />
      </div>
    </>
  );
}
