-- =============================================================================
-- Más de un entrenador (2026-08-09)
-- =============================================================================
--
-- Hasta hoy la aplicación era de una sola persona: quien entraba, veía todo.
-- Entra Rafa como entrenador y Fernando pasa a ser administrador.
--
-- El modelo de roles YA EXISTÍA: la tabla `perfiles` se creó el 2026-08-03 con
-- su columna `rol` ('entrenador' | 'admin') justamente para esto. Aquí no se
-- inventa nada nuevo: solo falta el vínculo entre un cliente y su profesional.
--
-- SOBRE EL NOMBRE DEL ROL
--
-- El encargo hablaba de `admin` y `trainer`. Se mantiene `entrenador`, que es
-- lo que ya admite la restricción de la tabla y el idioma del resto del
-- proyecto. Añadir un segundo nombre para la misma cosa sería duplicar.
--
-- ESTA MIGRACIÓN NO TOCA NI UNA FILA DE DATOS
--
-- Solo añade columnas vacías. El reparto de los clientes actuales va aparte,
-- con su vista previa y la aprobación de Fernando, porque son datos reales
-- (regla del 2026-08-04).
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cliente → profesional responsable
-- -----------------------------------------------------------------------------
-- Nace admitiendo nulo porque los 8 clientes que ya existen todavía no lo
-- tienen. Una vez repartidos y comprobados, otra migración lo hará
-- obligatorio: así ningún cliente puede quedarse sin responsable por descuido.
--
-- `on delete restrict`: borrar un perfil que aún tiene clientes asignados debe
-- fallar, no dejar clientes huérfanos en silencio.

alter table public.clientes
  add column if not exists entrenador_id uuid references public.perfiles (id) on delete restrict;

comment on column public.clientes.entrenador_id is
  'Profesional responsable. Un entrenador solo ve y toca los suyos; un admin, todos.';

-- La lista de clientes filtra por esta columna en cada carga.
create index if not exists clientes_entrenador_idx on public.clientes (entrenador_id);

-- -----------------------------------------------------------------------------
-- Quién firmó cada sesión
-- -----------------------------------------------------------------------------
-- Para trazabilidad, y para que el día que se quiera repartir la economía por
-- profesional el dato ya esté ahí. Hoy no se enseña en ninguna pantalla.
--
-- Admite nulo A PROPÓSITO y para siempre: las sesiones anteriores a hoy se
-- firmaron cuando no había más que una persona. No se inventa quién las hizo.
--
-- `on delete set null`: si algún día se borra un perfil, la sesión y su dinero
-- siguen existiendo. El historial no se toca nunca.

alter table public.sesiones
  add column if not exists firmada_por uuid references public.perfiles (id) on delete set null;

comment on column public.sesiones.firmada_por is
  'Quién firmó la sesión. Nulo en las anteriores al 2026-08-09: entonces solo había una persona.';

create index if not exists sesiones_firmada_por_idx on public.sesiones (firmada_por);

-- -----------------------------------------------------------------------------
-- Las políticas de seguridad, ahora conscientes del rol
-- -----------------------------------------------------------------------------
-- IMPORTANTE, Y HAY QUE SABERLO (comprobado el 2026-08-09):
--
-- Estas políticas HOY NO PROTEGEN NADA, porque la aplicación se conecta como
-- el usuario `postgres`, que tiene `rolbypassrls` y se las salta por diseño.
-- La autorización de verdad vive en el servidor de la aplicación
-- (`src/lib/permisos.ts`) y dentro de las propias consultas, que filtran por
-- `entrenador_id`.
--
-- Se actualizan igualmente por dos motivos: para que digan la verdad sobre
-- quién debe ver qué, y para que el día que se conecte con un rol normal
-- —que es lo correcto a medio plazo— la segunda barrera ya esté puesta y no
-- haya que repensarla con prisa.

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
     where id = auth.uid() and rol = 'admin'
  );
$$;

comment on function public.es_admin is
  'Si quien ha iniciado sesión es administrador. `security definer` para poder '
  'leer `perfiles` sin chocar con la política de la propia tabla.';

-- Antes: «quien haya iniciado sesión gestiona los clientes». Eso era correcto
-- cuando solo había una persona y deja de serlo hoy.
drop policy if exists "el entrenador gestiona los clientes" on public.clientes;

create policy "cada cual ve y gestiona los suyos"
  on public.clientes for all
  using (public.es_admin() or entrenador_id = auth.uid())
  with check (public.es_admin() or entrenador_id = auth.uid());

-- Los ciclos y las sesiones cuelgan de un cliente: se autorizan por el suyo.
drop policy if exists "el entrenador gestiona los ciclos" on public.ciclos;

create policy "los ciclos siguen a su cliente"
  on public.ciclos for all
  using (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = ciclos.cliente_id and c.entrenador_id = auth.uid())
  )
  with check (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = ciclos.cliente_id and c.entrenador_id = auth.uid())
  );

drop policy if exists "el entrenador gestiona las sesiones" on public.sesiones;

create policy "las sesiones siguen a su cliente"
  on public.sesiones for all
  using (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = sesiones.cliente_id and c.entrenador_id = auth.uid())
  )
  with check (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = sesiones.cliente_id and c.entrenador_id = auth.uid())
  );

-- El dinero es cosa del administrador. Un entrenador no ve la economía global
-- ni los cargos de nadie.
drop policy if exists "el entrenador gestiona los cargos" on public.cargos_mensuales;

create policy "los cargos son del administrador"
  on public.cargos_mensuales for all
  using (public.es_admin())
  with check (public.es_admin());

-- -----------------------------------------------------------------------------
-- Que un perfil se pueda leer para saber su rol
-- -----------------------------------------------------------------------------
-- La política anterior («cada uno ve su perfil») impedía que el administrador
-- listara los profesionales para el filtro de la lista de clientes.

drop policy if exists "cada uno ve su perfil" on public.perfiles;

create policy "cada uno ve el suyo, el admin todos"
  on public.perfiles for select
  using (id = auth.uid() or public.es_admin());
