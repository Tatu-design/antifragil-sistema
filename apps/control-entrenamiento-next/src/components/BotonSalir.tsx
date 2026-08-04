import { LogOut } from "lucide-react";

import { accionSalir } from "@/app/actions";

export function BotonSalir({ correo }: { correo: string | null }) {
  return (
    <form action={accionSalir} className="flex flex-col gap-1 pt-2">
      {correo && <p className="text-center text-xs text-tinta-suave">Dentro como {correo}</p>}
      <button type="submit" className="boton-suave">
        <LogOut className="h-4 w-4" aria-hidden />
        Salir
      </button>
    </form>
  );
}
