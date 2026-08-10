-- =============================================================================
-- Los avisos saben de qué cliente son (2026-08-10)
-- =============================================================================
--
-- Rafa necesita sus avisos: que a su cliente le queda una sesión, que ha
-- pasado a pendiente de pago. Hasta ahora un aviso era solo un texto, así que
-- no había forma de saber a quién pertenecía y, por tanto, a quién enseñárselo.
--
-- Se añade el vínculo con el cliente. Admite nulo A PROPÓSITO: hay avisos que
-- no son de nadie en concreto —el descuadre entre lo firmado y Calendar, por
-- ejemplo— y esos son cosa del administrador.
--
-- No toca ninguna fila existente: los avisos que ya hay se quedan sin cliente,
-- que es exactamente lo que eran.
-- =============================================================================

alter table public.avisos
  add column if not exists cliente_id uuid references public.clientes (id) on delete cascade;

comment on column public.avisos.cliente_id is
  'De quién es el aviso. Nulo = del sistema, y esos solo los ve el administrador.';

-- La pantalla de avisos filtra por el profesional del cliente en cada carga.
create index if not exists avisos_cliente_idx on public.avisos (cliente_id);

-- -----------------------------------------------------------------------------
-- La política, coherente con el resto
-- -----------------------------------------------------------------------------
-- Recordatorio: HOY ESTO NO SE APLICA, porque la aplicación se conecta como
-- `postgres` y se salta las políticas. La autorización de verdad está en el
-- servidor. Se mantiene al día para el día que se cambie el rol de conexión.

alter table public.avisos enable row level security;

drop policy if exists "el entrenador gestiona los avisos" on public.avisos;

create policy "cada cual ve los avisos de sus clientes"
  on public.avisos for all
  using (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = avisos.cliente_id and c.entrenador_id = auth.uid())
  )
  with check (
    public.es_admin()
    or exists (select 1 from public.clientes c
                where c.id = avisos.cliente_id and c.entrenador_id = auth.uid())
  );
