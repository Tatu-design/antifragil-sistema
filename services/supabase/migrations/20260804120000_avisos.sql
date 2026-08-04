-- =============================================================================
-- Avisos
-- =============================================================================
--
-- Lo que el sistema no puede resolver solo y Fernando debería mirar: un bono
-- que se ha agotado, un cliente al que le queda una sesión, un descuadre entre
-- lo firmado y lo facturado.
--
-- No hay ninguna tarea programada detrás. Los avisos se crean en el momento en
-- que ocurre lo que los provoca, y se leen la próxima vez que se abre la
-- aplicación. Se intentó una automatización en la nube en julio de 2026 y no
-- hubo forma de comprobar que funcionara; esto sí se puede comprobar.
--
-- =============================================================================

create table public.avisos (
  id        uuid primary key default gen_random_uuid(),
  fecha     date not null,
  tipo      text not null,
  detalle   text not null check (length(trim(detalle)) > 0),
  leido     boolean not null default false,
  resuelto  boolean not null default false,
  creado    timestamptz not null default now()
);

create index avisos_sin_resolver on public.avisos (creado desc) where not resuelto;

-- No se guarda dos veces el mismo aviso sin resolver: si el motivo sigue ahí,
-- cada operación volvería a detectarlo y la bandeja se llenaría de copias.
-- Le pasó a Fernando con un descuadre que tardó días en corregirse.
create unique index avisos_sin_duplicar on public.avisos (tipo, detalle) where not resuelto;

comment on table public.avisos is
  'Lo que hay que mirar. "leido" es si ya se ha visto; "resuelto" es si ya no '
  'hace falta. Son cosas distintas: verlo no lo arregla.';

alter table public.avisos enable row level security;

create policy "el entrenador gestiona los avisos"
  on public.avisos for all
  using (auth.uid() is not null) with check (auth.uid() is not null);
