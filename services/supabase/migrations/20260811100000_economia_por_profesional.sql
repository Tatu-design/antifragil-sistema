-- =============================================================================
-- La economía sabe de qué profesional es (2026-08-11)
-- =============================================================================
--
-- EL PROBLEMA QUE RESUELVE
--
-- Hasta hoy, saber de quién es económicamente una sesión solo se podía
-- responder mirando `clientes.entrenador_id`, que es el responsable de HOY. Si
-- un cliente cambia de profesional, toda su producción pasada se iría con él:
-- enero se reescribiría en febrero.
--
-- `sesiones.firmada_por` no sirve para esto y no debe usarse: dice quién pulsó
-- el botón, no de quién es el cliente. Si Fernando firma excepcionalmente una
-- sesión de un cliente de Rafa, esa sesión es producción de Rafa.
--
-- LA SOLUCIÓN, QUE YA ESTABA INVENTADA AQUÍ
--
-- Las sesiones ya guardan copia de `tarifa`, `servicio` y `sesiones_totales`
-- del momento de firmar, con este motivo escrito en el esquema inicial:
--
--   «Copia de las condiciones del ciclo en el momento de firmar, para que el
--    historial siga diciendo la verdad aunque el servicio cambie después.»
--
-- El profesional responsable es una condición más del momento. Se guarda igual.
--
-- ESTA MIGRACIÓN NO TOCA NI UNA FILA
--
-- Solo añade columnas vacías. Mientras estén vacías, la economía se atribuye
-- por el responsable actual del cliente —que hoy da exactamente el mismo
-- resultado, porque los 9 clientes se repartieron en la migración anterior y
-- ninguno ha cambiado de manos—. Rellenarlas es un cambio sobre datos reales y
-- necesita la aprobación de Fernando (regla del 2026-08-04).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- De quién era la producción cuando se produjo
-- -----------------------------------------------------------------------------

alter table public.sesiones
  add column if not exists profesional_id uuid references public.perfiles (id) on delete set null;

comment on column public.sesiones.profesional_id is
  'Profesional responsable del cliente CUANDO se firmó. Es de quien es la '
  'produccion. Distinto de `firmada_por`, que dice quien pulso el boton. Nulo '
  'en las anteriores al 2026-08-11: entonces se atribuyen por el responsable '
  'actual del cliente.';

create index if not exists sesiones_profesional_idx on public.sesiones (profesional_id);

-- La cuota de una mensualidad es dinero del mes, y también tiene dueño.
alter table public.cargos_mensuales
  add column if not exists profesional_id uuid references public.perfiles (id) on delete set null;

comment on column public.cargos_mensuales.profesional_id is
  'Profesional responsable del cliente cuando se registro la cuota. Nulo en las '
  'anteriores al 2026-08-11.';

create index if not exists cargos_profesional_idx on public.cargos_mensuales (profesional_id);

-- -----------------------------------------------------------------------------
-- Lo que NO se añade, y por qué
-- -----------------------------------------------------------------------------
-- `clases_grupo` (CrossFit Lidomare y Kids) y `ajustes_mensuales` NO llevan
-- profesional. Por decisión de Fernando pertenecen al administrador y no se
-- reparten entre entrenadores. Añadir la columna sería preparar un reparto que
-- nadie ha pedido; el día que haga falta, se añade.
