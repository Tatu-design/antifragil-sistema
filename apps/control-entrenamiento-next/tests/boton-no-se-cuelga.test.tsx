/**
 * Qué NO deja un botón colgado en «Guardando…».
 *
 * NACE DE UN FALLO REAL (2026-09-03). A Fernando se le quedó el botón del cobro
 * de un cliente en «GUARDANDO…» y no volvió. El cobro **sí** se había guardado:
 * era la pantalla la que se quedaba colgada, igual que había pasado antes con
 * la firma.
 *
 * LO QUE SE INVESTIGÓ Y NO ERA. La primera sospecha fue el patrón de pedir
 * confirmación dentro de `onSubmit` y cancelar el envío con `preventDefault()`,
 * que está en siete formularios. **No es eso**: se probó con un navegador
 * simulado y el botón vuelve a la normalidad al cancelar. Queda comprobado aquí
 * abajo para que nadie vuelva a perseguir esa pista.
 *
 * LO QUE SÍ ES. Mientras una acción está en marcha, `useFormStatus()` dice
 * «pendiente», y deja de decirlo cuando la respuesta llega y la pantalla se
 * vuelve a dibujar. Si esa vuelta no llega —la red del móvil se corta, la
 * navegación se pierde— **no hay nada que despierte al botón**. Se queda
 * apagado y diciendo que guarda, aunque lo que se pulsó ya esté guardado.
 *
 * Se intentó además un aviso automático —«está tardando, recarga»— y se
 * descartó: cualquier `useEffect` que reaccione a `pending` **rompe el estado
 * del formulario** (queda comprobado abajo, en la bisección). Meterlo habría
 * roto lo que funciona para avisar de lo que falla.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFormStatus } from "react-dom";


afterEach(cleanup);

const esperar = (ms = 60) => new Promise((s) => setTimeout(s, ms));

// ---------------------------------------------------------------------------
// Lo que NO era
// ---------------------------------------------------------------------------

describe("cancelar una confirmación", () => {
  function Simple({ accion, responde }: { accion: () => Promise<void>; responde: boolean }) {
    const Boton = () => {
      const { pending } = useFormStatus();
      return (
        <button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Marcar cobrado"}
        </button>
      );
    };
    return (
      <form action={accion} onSubmit={(e) => { if (!responde) e.preventDefault(); }}>
        <Boton />
      </form>
    );
  }

  it("no deja el botón colgado, aunque se pregunte dentro del envío", async () => {
    // Comprobado a propósito: esta era la sospecha y NO es la causa.
    const accion = vi.fn(async () => {});
    render(<Simple accion={accion} responde={false} />);

    fireEvent.click(screen.getByRole("button"));
    await esperar();

    const boton = screen.getByRole("button") as HTMLButtonElement;
    expect(accion, "no se guarda nada").not.toHaveBeenCalled();
    expect(boton.textContent, "y el botón sigue vivo").toContain("Marcar cobrado");
    expect(boton.disabled).toBe(false);
  });

  it("y aceptando, se guarda", async () => {
    const accion = vi.fn(async () => {});
    render(<Simple accion={accion} responde={true} />);
    fireEvent.click(screen.getByRole("button"));
    await esperar();
    expect(accion).toHaveBeenCalledTimes(1);
  });
});
