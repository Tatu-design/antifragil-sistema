-- =============================================================================
-- Esquema inicial del control de entrenamiento — Antifrágil
-- =============================================================================
--
-- Solo las tablas que necesita la primera vertical (clientes, servicios,
-- sesiones y su economía). Economía semanal completa, avisos, CrossFit y
-- ajustes históricos se añaden después, cada uno en su migración.
--
-- CINCO DECISIONES QUE NO SE PUEDEN CAMBIAR DESPUÉS SIN DOLOR:
--
-- 1. El identificador del cliente es un `uuid` interno y estable. El NOMBRE
--    pasa a ser un dato editable más. En SQLite el nombre era la clave
--    primaria y de ella colgaba todo: renombrar rompía las relaciones y hubo
--    que arreglarlo con un aplazamiento de claves foráneas. Aquí no puede
--    pasar.
--
-- 2. El dinero es `numeric(10,2)`, nunca `float`. Al céntimo y exacto.
--
-- 3. `pagado` es NULLABLE a propósito. `null` significa «nunca se registró»,
--    NO «sin pagar». Ponerle `not null default false` convertiría en deuda
--    todo lo que se migre de antes de 2026-08, que es sencillamente falso.
--
-- 4. `sesiones_totales = 0` significa SIN LÍMITE (mensualidad y cuenta de
--    cliente), no «cero sesiones». Cualquier consulta que lo trate como tope
--    máximo tiene que preguntar antes si vale 0.
--
-- 5. El `token` público se conserva tal cual venga de la migración y NO se
--    regenera: hay códigos QR ya repartidos entre los clientes.
--
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Quién puede entrar
-- -----------------------------------------------------------------------------
-- Hoy solo Fernando. La tabla existe desde el principio porque añadir usuarios
-- más tarde a un sistema que no los tenía obliga a repasar todas las políticas
-- de seguridad.

create table public.perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'entrenador'
              check (rol in ('entrenador', 'admin')),
  creado      timestamptz not null default now()
);

comment on table public.perfiles is
  'Personas que pueden usar la aplicación. Los CLIENTES no entran por aquí: '
  'acceden con su enlace público, sin cuenta.';

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------

create type public.estado_cliente as enum ('activo', 'pausado', 'cancelado');

create table public.clientes (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null check (length(trim(nombre)) > 0),
  estado                 public.estado_cliente not null default 'activo',

  -- Enlace público del cliente. Único, y NUNCA se regenera.
  token                  text not null unique,

  -- Describe el servicio EN CURSO. Las deudas antiguas viven en cada ciclo.
  pendiente_pago         boolean not null default false,

  -- Contador del bono en curso. Fernando puede corregirlo a mano (p. ej. un
  -- cliente que ya venía con 5 sesiones hechas), por eso no se deriva.
  sesiones_completadas   integer not null default 0
                         check (sesiones_completadas >= 0),
  ciclo_actual           integer not null default 1 check (ciclo_actual >= 1),

  creado                 timestamptz not null default now(),
  actualizado            timestamptz not null default now()
);

-- El nombre es editable, así que no es clave. Pero dos clientes con el mismo
-- nombre serían indistinguibles en pantalla: se impide, sin distinguir
-- mayúsculas.
create unique index clientes_nombre_unico on public.clientes (lower(nombre));
create index clientes_estado on public.clientes (estado);

comment on column public.clientes.pendiente_pago is
  'Solo el ciclo EN CURSO. En una mensualidad manda cargos_mensuales.';

-- -----------------------------------------------------------------------------
-- Servicios contratados (un ciclo = una contratación)
-- -----------------------------------------------------------------------------
-- Una fila por servicio contratado, no por tipo de servicio: si alguien
-- contrata tres veces el mismo bono, son tres filas y sus sesiones no se
-- mezclan.

create type public.modalidad_servicio as enum ('bono', 'mensualidad', 'cuenta');

create table public.ciclos (
  cliente_id           uuid not null references public.clientes (id) on delete cascade,
  ciclo                integer not null check (ciclo >= 0),

  modalidad            public.modalidad_servicio not null default 'bono',
  -- Etiqueta libre. No apunta a ningún catálogo: en SQLite lo hacía y un
  -- cliente con condiciones propias desaparecía de la aplicación entera.
  servicio             text not null,

  -- Tarifa HISTÓRICA, congelada al contratar. `null` en una mensualidad:
  -- sus sesiones no aportan dinero, solo horas.
  tarifa               numeric(10,2) check (tarifa is null or tarifa >= 0),
  -- 0 = SIN LÍMITE. Ver decisión 4 de la cabecera.
  sesiones_totales     integer not null default 0 check (sesiones_totales >= 0),
  precio_total         numeric(10,2) check (precio_total is null or precio_total >= 0),
  cuota_mensual        numeric(10,2) check (cuota_mensual is null or cuota_mensual >= 0),
  sesiones_referencia  integer check (sesiones_referencia is null or sesiones_referencia > 0),

  -- Solo en las modalidades que van por mes natural.
  anio                 integer check (anio is null or anio between 2000 and 2100),
  mes                  integer check (mes is null or mes between 1 and 12),

  fecha_inicio         date,
  fecha_fin            date,

  -- Tri-estado. Ver decisión 3 de la cabecera.
  pagado               boolean,

  creado               timestamptz not null default now(),

  primary key (cliente_id, ciclo),

  -- Las condiciones tienen que ser coherentes con la modalidad. Lo mismo que
  -- valida `validarCondiciones()` en la aplicación, pero aquí no se puede
  -- saltar ni llamando a la base de datos por otro camino.
  constraint condiciones_coherentes check (
    case modalidad
      when 'bono'        then cuota_mensual is null and sesiones_totales > 0
      when 'mensualidad' then tarifa is null and sesiones_totales = 0
      when 'cuenta'      then cuota_mensual is null and sesiones_totales = 0
    end
  ),
  constraint mes_completo check ((anio is null) = (mes is null)),
  constraint fin_despues_del_inicio check (
    fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio
  )
);

create index ciclos_por_mes on public.ciclos (cliente_id, anio, mes)
  where anio is not null;

comment on column public.ciclos.sesiones_totales is
  '0 significa SIN LÍMITE, no cero sesiones.';
comment on column public.ciclos.pagado is
  'null = nunca se registró. NO es lo mismo que «sin pagar».';

-- -----------------------------------------------------------------------------
-- Sesiones firmadas
-- -----------------------------------------------------------------------------

create table public.sesiones (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes (id) on delete cascade,
  ciclo             integer not null,

  -- Fecha de negocio (Europe/Madrid), no la del servidor.
  fecha             date not null,
  -- `null` en las sesiones migradas de antes de que se registrara la hora.
  -- No se inventa ninguna.
  hora              time,

  numero_sesion     integer not null check (numero_sesion >= 1),
  -- Copia de las condiciones del ciclo en el momento de firmar, para que el
  -- historial siga diciendo la verdad aunque el servicio cambie después.
  sesiones_totales  integer not null default 0,
  -- `null` = cuenta como hora trabajada y NO aporta dinero. No es 0 €.
  tarifa            numeric(10,2) check (tarifa is null or tarifa >= 0),
  servicio          text not null,

  creado            timestamptz not null default now(),

  -- Una sesión pertenece a un ciclo que existe.
  foreign key (cliente_id, ciclo) references public.ciclos (cliente_id, ciclo)
    on delete cascade
);

-- Deliberadamente SIN índice único por (cliente, fecha): un cliente puede
-- tener varias sesiones el mismo día. Ese `unique` existía en SQLite y hubo
-- que quitarlo reconstruyendo la tabla.
create index sesiones_cliente_fecha on public.sesiones (cliente_id, fecha desc, id desc);
create index sesiones_por_ciclo on public.sesiones (cliente_id, ciclo);
-- Índice liso sobre la fecha, no sobre `date_trunc('month', fecha)`.
-- PostgreSQL rechaza lo segundo porque esa función depende de la zona horaria
-- configurada y por tanto no puede indexarse. Y además sobra: la economía
-- mensual se consulta por rango (`fecha >= '2026-08-01' and fecha < '2026-09-01'`),
-- que este índice resuelve igual de bien.
create index sesiones_por_fecha on public.sesiones (fecha);

comment on column public.sesiones.tarifa is
  'null = hora trabajada sin importe (mensualidad). Distinto de 0 €.';

-- -----------------------------------------------------------------------------
-- Cuotas mensuales
-- -----------------------------------------------------------------------------
-- En una MENSUALIDAD, esta tabla es la fuente de verdad del estado de cobro
-- (corrección H-02). El `pagado` del ciclo se mantiene alineado con ella.

create table public.cargos_mensuales (
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  anio        integer not null check (anio between 2000 and 2100),
  mes         integer not null check (mes between 1 and 12),
  concepto    text not null default 'mensualidad',
  ciclo       integer not null,
  importe     numeric(10,2) not null check (importe >= 0),
  pagado      boolean not null default false,
  creado      timestamptz not null default now(),

  -- ESTA CLAVE es lo que impide cobrar dos veces el mismo mes. No lo impide
  -- el código que llama: lo impide la base de datos, aunque lleguen diez
  -- peticiones a la vez.
  primary key (cliente_id, anio, mes, concepto),
  foreign key (cliente_id, ciclo) references public.ciclos (cliente_id, ciclo)
    on delete cascade
);

create index cargos_por_mes on public.cargos_mensuales (anio, mes);

-- -----------------------------------------------------------------------------
-- Economía semanal
-- -----------------------------------------------------------------------------

create table public.semanas (
  inicio              date primary key,
  fin                 date not null,
  facturacion         numeric(10,2) not null default 0,
  horas               integer not null default 0 check (horas >= 0),
  -- Horas trabajadas que NO aportan dinero a la semana (mensualidades).
  -- Corrección H-01: sin esto la vista semanal perdía esas horas y el precio
  -- medio por hora salía inflado.
  horas_sin_importe   integer not null default 0 check (horas_sin_importe >= 0),
  actualizado         timestamptz not null default now(),

  constraint semana_de_lunes_a_domingo check (fin = inicio + 6),
  constraint empieza_en_lunes check (extract(isodow from inicio) = 1)
);

comment on column public.semanas.horas_sin_importe is
  'Sesiones de mensualidad: suman hora, no dinero. Corrección H-01.';

-- -----------------------------------------------------------------------------
-- Peticiones ya procesadas
-- -----------------------------------------------------------------------------
-- Segunda capa anti-duplicado: un reintento de red o dos pestañas abiertas no
-- pueden guardar la misma firma dos veces.

create table public.idempotencia (
  clave   text primary key,
  creado  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Rastro de la migración
-- -----------------------------------------------------------------------------
-- Correspondencia entre el identificador ANTIGUO (el nombre del cliente en
-- SQLite) y el nuevo `uuid`. Sin esto la migración no se puede auditar ni
-- revertir: no habría forma de saber qué fila de aquí venía de cuál de allí.

create table public.migracion_clientes (
  nombre_origen  text primary key,
  cliente_id     uuid not null unique references public.clientes (id) on delete cascade,
  migrado        timestamptz not null default now(),
  origen         text not null default 'sqlite'
);

comment on table public.migracion_clientes is
  'Qué cliente de SQLite es cuál aquí. Necesario para auditar y revertir.';

-- -----------------------------------------------------------------------------
-- `actualizado` al día sin tener que acordarse
-- -----------------------------------------------------------------------------

create or replace function public.marcar_actualizado()
returns trigger
language plpgsql
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

create trigger clientes_actualizado
  before update on public.clientes
  for each row execute function public.marcar_actualizado();

create trigger semanas_actualizado
  before update on public.semanas
  for each row execute function public.marcar_actualizado();

-- =============================================================================
-- Seguridad a nivel de fila
-- =============================================================================
-- RLS activo en TODAS las tablas. Sin políticas, nadie ve nada — que es el
-- punto de partida correcto.
--
-- Hoy la aplicación es de un solo entrenador: quien ha iniciado sesión ve y
-- gestiona todo. Cuando haya más de uno, estas políticas se estrechan sin
-- tocar ni la aplicación ni los datos.
--
-- El acceso del CLIENTE por su enlace público NO se resuelve aquí: se hará con
-- una función `security definer` que recibe el token y devuelve solo lo suyo.
-- Va en su propia migración, junto a la pantalla que la usa.

alter table public.perfiles          enable row level security;
alter table public.clientes          enable row level security;
alter table public.ciclos            enable row level security;
alter table public.sesiones          enable row level security;
alter table public.cargos_mensuales  enable row level security;
alter table public.semanas           enable row level security;
alter table public.idempotencia      enable row level security;
alter table public.migracion_clientes enable row level security;

create policy "cada uno ve su perfil"
  on public.perfiles for select
  using (id = auth.uid());

create policy "el entrenador gestiona los clientes"
  on public.clientes for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "el entrenador gestiona los ciclos"
  on public.ciclos for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "el entrenador gestiona las sesiones"
  on public.sesiones for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "el entrenador gestiona los cargos"
  on public.cargos_mensuales for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "el entrenador gestiona la economia"
  on public.semanas for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "el entrenador usa la idempotencia"
  on public.idempotencia for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- La correspondencia de la migración es solo de lectura desde la aplicación:
-- la escribe el script de migración con la clave de servicio, que se salta RLS.
create policy "el entrenador consulta la migracion"
  on public.migracion_clientes for select
  using (auth.uid() is not null);
