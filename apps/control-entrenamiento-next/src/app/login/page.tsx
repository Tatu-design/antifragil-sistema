import Image from "next/image";
import { redirect } from "next/navigation";

import { FormularioLogin } from "@/components/FormularioLogin";
import { claveUnicaDisponible, haySesion } from "@/lib/auth";

export const metadata = { title: "Iniciar sesión — Antifrágil" };

/** Misma estructura que `webapp/templates/login.html`. */
export default async function PaginaLogin() {
  if (await haySesion()) redirect("/clientes");

  return (
    <div className="page sin-barra">
      <h1 className="sr-only">Antifrágil</h1>
      <Image src="/logo-marca.png" alt="Antifrágil" className="logo-login" width={220} height={64} priority />
      <p className="subtitulo">Introduce tus datos para continuar</p>
      <FormularioLogin conClaveUnica={claveUnicaDisponible()} />
    </div>
  );
}
