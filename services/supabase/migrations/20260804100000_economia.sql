-- =============================================================================
-- Economía: clases de grupo, CrossFit Kids y ajustes históricos
-- =============================================================================
--
-- Completa lo que faltaba para tener la misma economía que la aplicación
-- Flask. Tres piezas, cada una por un motivo distinto:
--
--   clases_grupo             CrossFit Lidomare y Kids no son de un cliente
--                            concreto, así que no caben en `sesiones`.
--   facturacion_kids_mensual Kids se factura por mensualidad: su importe lo
--                            introduce Fernando al acabar el mes.
--   ajustes_mensuales        Facturación real anterior al registro de fechas
--                            (antes del 2026-07-22), que el cálculo desde el
--                            historial no puede ver porque esas sesiones
--                            nunca tuvieron fecha guardada.
--
-- =============================================================================

create type public.tipo_clase as enum ('lidomare', 'kids');

create table public.clases_grupo (
  id      uuid primary key default gen_random_uuid(),
  fecha   date not null,
  tipo    public.tipo_clase not null,
  creado  timestamptz not null default now()
);

create index clases_por_fecha on public.clases_grupo (fecha);

comment on table public.clases_grupo is
  'Una fila por clase dada. Se guardan una a una, y no como un contador, para '
  'poder deshacer un toque de más y para poder comprobar que la economía '
  'sigue cuadrando.';

-- -----------------------------------------------------------------------------

create table public.facturacion_kids_mensual (
  anio     integer not null check (anio between 2000 and 2100),
  mes      integer not null check (mes between 1 and 12),
  importe  numeric(10,2) not null check (importe > 0),
  creado   timestamptz not null default now(),

  -- La clave es el mes REAL, no el lunes de una semana: una semana a caballo
  -- entre julio y agosto tiene clases de los dos meses.
  primary key (anio, mes)
);

comment on table public.facturacion_kids_mensual is
  'Lo facturado por CrossFit Kids cada mes. El precio por clase se calcula '
  'dividiendo entre las clases que de verdad se dieron ESE mes.';

-- -----------------------------------------------------------------------------

create table public.ajustes_mensuales (
  anio     integer not null check (anio between 2000 and 2100),
  mes      integer not null check (mes between 1 and 12),
  origen   text not null default 'legacy',
  importe  numeric(10,2) not null default 0,
  horas    integer not null default 0,
  motivo   text not null check (length(trim(motivo)) > 0),
  creado   timestamptz not null default now(),

  primary key (anio, mes, origen)
);

comment on table public.ajustes_mensuales is
  'Facturación real que el historial no puede ver. Se SUMA al mes pero se '
  'muestra como línea propia con su motivo: la diferencia queda visible, '
  'nunca escondida dentro del total.';

-- -----------------------------------------------------------------------------

alter table public.clases_grupo             enable row level security;
alter table public.facturacion_kids_mensual enable row level security;
alter table public.ajustes_mensuales        enable row level security;

create policy "el entrenador gestiona las clases de grupo"
  on public.clases_grupo for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "el entrenador gestiona la facturacion de kids"
  on public.facturacion_kids_mensual for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "el entrenador gestiona los ajustes"
  on public.ajustes_mensuales for all
  using (auth.uid() is not null) with check (auth.uid() is not null);
