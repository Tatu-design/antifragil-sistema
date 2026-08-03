import { LogOut } from "lucide-react";

import { accionSalir } from "@/app/actions";

export function BotonSalir() {
  return (
    <form action={accionSalir} className="pt-2">
      <button type="submit" className="boton-suave">
        <LogOut className="h-4 w-4" aria-hidden />
        Salir
      </button>
    </form>
  );
}
