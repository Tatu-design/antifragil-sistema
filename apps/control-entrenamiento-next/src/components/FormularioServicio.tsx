"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { accionConfigurarServicio } from "@/app/actions";
import { ETIQUETAS } from "@/domain/modalidades";
import { CamposServicio, detalleServicio, type ValoresServicio } from "./CamposServicio";

/**
 * Editar programa y su pantalla de repaso, juntas.
 *
 * Es la unión de `webapp/templates/editar.html` y `confirmar_servicio.html`:
 * mismos campos, mismos textos y el mismo «antes → después» antes de guardar.
 * La única diferencia es que el repaso ocurre sin cambiar de página; los datos
 * ya están en el navegador y así no hay que reenviarlos escondidos.
 */
export function FormularioServicio({
  clienteId,
  nombre,
  iniciales,
  antes,
}: {
  clienteId: string;
  nombre: string;
  iniciales: ValoresServicio;
  antes: { etiqueta: string; servicio: string | null; detalle: string; sesionesCiclo: number; pendientePago: boolean };
}) {
  const [valores, setValores] = useState<ValoresServicio>(iniciales);
  const [revisando, setRevisando] = useState(false);

  const cambiaModalidad = valores.modalidad !== iniciales.modalidad;
  const etiquetaNueva = ETIQUETAS[valores.modalidad];

  if (!revisando) {
    return (
      <>
        <h1>Editar programa</h1>
        <p className="subtitulo">
          Qué tiene contratado y en qué condiciones. Los datos del cliente se editan aparte.
        </p>

        <form
          className="formulario"
          onSubmit={(evento) => {
            evento.preventDefault();
            setRevisando(true);
          }}
        >
          <CamposServicio valores={valores} alCambiar={setValores} />
          <button type="submit" className="boton">
            Revisar cambios
          </button>
        </form>

        <p className="aviso-texto">
          Cambiar de modalidad cierra el servicio actual y abre uno nuevo. Las sesiones ya hechas y su
          economía se conservan sin ningún cambio — te lo enseñaremos antes de guardar.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Revisa antes de guardar</h1>

      {cambiaModalidad && (
        // Cambiar de modalidad es la operación delicada: se dice exactamente
        // qué va a pasar, con los números concretos de este cliente.
        <div className="zona-peligrosa">
          <p className="zona-peligrosa-titulo">Vas a cambiar de modalidad</p>
          <p className="meta">
            Se <strong>cierra</strong> {antes.etiqueta.toLowerCase()} actual de {nombre}
            {antes.sesionesCiclo > 0 &&
              ` (${antes.sesionesCiclo} ${antes.sesionesCiclo === 1 ? "sesión ya hecha" : "sesiones ya hechas"}, ${
                antes.pendientePago ? "pendiente de pago" : "al día"
              })`}{" "}
            y se abre {etiquetaNueva.toLowerCase()} nueva.
          </p>
          <p className="meta">
            Las sesiones anteriores y su economía <strong>se conservan sin ningún cambio</strong>: seguirán
            en el historial con las condiciones con las que se hicieron. No se recalcula nada del pasado ni
            se traslada ninguna sesión al servicio nuevo.
          </p>
        </div>
      )}

      <div className="lista">
        <div className="cabecera-seccion">
          <span>Antes</span>
        </div>
        <div className="fila">
          <div className="sesion-info">
            <div className="fecha">
              {antes.etiqueta}
              {antes.servicio ? ` · ${antes.servicio}` : ""}
            </div>
            <div className="tipo">{antes.detalle}</div>
          </div>
        </div>
      </div>

      <div className="lista" style={{ marginTop: "1rem" }}>
        <div className="cabecera-seccion">
          <span>Después</span>
        </div>
        <div className="fila">
          <div className="sesion-info">
            <div className="fecha">
              {etiquetaNueva}
              {valores.servicio ? ` · ${valores.servicio}` : ""}
            </div>
            <div className="tipo">{detalleServicio(valores)}</div>
          </div>
        </div>
      </div>

      {valores.modalidad === "mensualidad" && (
        <p className="aviso-texto">
          La cuota de este mes se registrará entera en la Economía en cuanto guardes, aunque todavía no se
          haya entrenado — es lo que el cliente paga por tener sus plazas reservadas. Quedará pendiente de
          pago hasta que la marques como pagada.
        </p>
      )}

      <form action={accionConfigurarServicio} style={{ marginTop: "1.25rem" }}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <input type="hidden" name="modalidad" value={valores.modalidad} />
        <input type="hidden" name="servicio" value={valores.servicio} />
        <input type="hidden" name="sesionesTotales" value={valores.sesionesTotales} />
        <input type="hidden" name="precioTotal" value={valores.precioTotal} />
        <input type="hidden" name="cuotaMensual" value={valores.cuotaMensual} />
        <input type="hidden" name="sesionesReferencia" value={valores.sesionesReferencia} />
        <input type="hidden" name="tarifa" value={valores.tarifa} />
        <Guardar texto={cambiaModalidad ? "Cerrar el actual y guardar" : "Guardar cambios"} />
      </form>

      <button
        type="button"
        className="boton-secundario"
        style={{ width: "100%", marginTop: "0.65rem" }}
        onClick={() => setRevisando(false)}
      >
        Cancelar
      </button>
    </>
  );
}

function Guardar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}
