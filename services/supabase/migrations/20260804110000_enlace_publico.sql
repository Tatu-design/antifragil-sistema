-- =============================================================================
-- El enlace público del cliente
-- =============================================================================
--
-- Es el único sitio del sistema donde alguien entra SIN cuenta: cada cliente
-- tiene su enlace con un token, y desde ahí ve lo suyo y confirma su sesión.
--
-- LA REGLA QUE LO HACE SEGURO DE VERDAD
--
-- El cliente **nunca crea una sesión**. Solo puede confirmar una que Fernando
-- ya haya firmado. Así es matemáticamente imposible que una sesión se cuente
-- dos veces por un solo entrenamiento — el descuadre que este proyecto ya
-- sufrió una vez por otra vía.
--
-- Confirmar no toca el bono, ni el historial, ni la economía. Solo escribe una
-- fila aquí.
--
-- =============================================================================

create table public.confirmaciones (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  -- Se confirma una SESIÓN concreta, no un día: un cliente puede tener dos
  -- sesiones el mismo día y las dos se tienen que poder confirmar.
  sesion_id   uuid not null unique references public.sesiones (id) on delete cascade,
  fecha       date not null,
  hora        time not null,
  creado      timestamptz not null default now()
);

create index confirmaciones_por_cliente on public.confirmaciones (cliente_id, fecha desc);

comment on table public.confirmaciones is
  'El cliente confirma que la sesión que Fernando registró es correcta. No '
  'crea sesiones ni mueve dinero: es una anotación aparte.';

-- -----------------------------------------------------------------------------
-- Lo que puede ver un cliente con su enlace
-- -----------------------------------------------------------------------------
-- Una función en vez de una política de seguridad: aquí no hay usuario contra
-- el que comparar, solo un token. La función recibe el token, resuelve QUIÉN es
-- y devuelve únicamente lo suyo.
--
-- `security definer` con `search_path` fijado: es la excepción justificada.
-- Corre con permisos elevados porque quien la llama no tiene ninguno, pero solo
-- puede devolver las filas de un cliente y nunca acepta un identificador de
-- cliente como parámetro — solo el token, que es el que decide.

create or replace function public.perfil_publico(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente  public.clientes%rowtype;
  v_ciclo    public.ciclos%rowtype;
begin
  select * into v_cliente from public.clientes where token = p_token;
  if not found then
    return null;  -- Token que no existe: no se distingue de uno sin permisos.
  end if;

  select * into v_ciclo
    from public.ciclos
   where cliente_id = v_cliente.id and ciclo = v_cliente.ciclo_actual;

  return jsonb_build_object(
    'nombre',              v_cliente.nombre,
    'estado',              v_cliente.estado,
    'sesiones_completadas', v_cliente.sesiones_completadas,
    'servicio',            v_ciclo.servicio,
    'modalidad',           v_ciclo.modalidad,
    'tarifa',              v_ciclo.tarifa,
    'sesiones_totales',    v_ciclo.sesiones_totales,
    'cuota_mensual',       v_ciclo.cuota_mensual,
    'anio',                v_ciclo.anio,
    'mes',                 v_ciclo.mes,
    -- Cuántas sesiones lleva en el servicio en curso.
    'sesiones_del_ciclo',  (select count(*) from public.sesiones
                             where cliente_id = v_cliente.id and ciclo = v_cliente.ciclo_actual),
    -- Sus últimas sesiones, para que vea su propio historial reciente.
    'ultimas',             coalesce((
                             select jsonb_agg(jsonb_build_object('fecha', s.fecha, 'numero', s.numero_sesion)
                                              order by s.fecha desc)
                               from (select fecha, numero_sesion from public.sesiones
                                      where cliente_id = v_cliente.id
                                      order by fecha desc, creado desc limit 10) s
                           ), '[]'::jsonb),
    -- Sesiones de HOY que todavía no ha confirmado. Si no hay ninguna, no se
    -- le ofrece confirmar nada: no hay nada que confirmar todavía.
    'pendientes_hoy',      coalesce((
                             select jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero_sesion))
                               from public.sesiones s
                              where s.cliente_id = v_cliente.id
                                and s.fecha = (now() at time zone 'Europe/Madrid')::date
                                and not exists (select 1 from public.confirmaciones c where c.sesion_id = s.id)
                           ), '[]'::jsonb),
    'confirmadas_hoy',     coalesce((
                             select jsonb_agg(jsonb_build_object('hora', c.hora))
                               from public.confirmaciones c
                              where c.cliente_id = v_cliente.id
                                and c.fecha = (now() at time zone 'Europe/Madrid')::date
                           ), '[]'::jsonb)
  );
end;
$$;

comment on function public.perfil_publico is
  'Lo que ve un cliente con su enlace. El cliente sale del TOKEN, nunca de un '
  'parámetro: por eso un token no puede destapar a otro cliente.';

-- -----------------------------------------------------------------------------

create or replace function public.confirmar_sesion(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_sesion_id  uuid;
  v_hora       time;
begin
  select id into v_cliente_id from public.clientes where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'enlace no válido');
  end if;

  -- La sesión más antigua de hoy que aún no esté confirmada.
  select s.id into v_sesion_id
    from public.sesiones s
   where s.cliente_id = v_cliente_id
     and s.fecha = (now() at time zone 'Europe/Madrid')::date
     and not exists (select 1 from public.confirmaciones c where c.sesion_id = s.id)
   order by s.creado
   limit 1;

  if v_sesion_id is null then
    -- Puede que ya estuviera confirmada. Es seguro repetirlo: el enlace del QR
    -- se abre con solo escanearlo y puede escanearse dos veces.
    return jsonb_build_object('ok', true, 'ya_estaba', true);
  end if;

  v_hora := (now() at time zone 'Europe/Madrid')::time;
  insert into public.confirmaciones (cliente_id, sesion_id, fecha, hora)
  values (v_cliente_id, v_sesion_id, (now() at time zone 'Europe/Madrid')::date, v_hora);

  return jsonb_build_object('ok', true, 'ya_estaba', false, 'hora', v_hora);
end;
$$;

comment on function public.confirmar_sesion is
  'Confirma una sesión que YA existe. Nunca crea ninguna, así que no puede '
  'duplicar ni sesiones ni facturación.';

-- -----------------------------------------------------------------------------

alter table public.confirmaciones enable row level security;

create policy "el entrenador ve las confirmaciones"
  on public.confirmaciones for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- Las dos funciones son el único camino del cliente, y no hace falta cuenta.
grant execute on function public.perfil_publico   to anon, authenticated;
grant execute on function public.confirmar_sesion to anon, authenticated;
