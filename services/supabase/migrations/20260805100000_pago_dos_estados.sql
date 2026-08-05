-- Estado de pago: dos estados y solo dos (decisión de Fernando, 2026-08-05).
--
-- Hasta ahora `ciclos.pagado` admitía NULL con el significado «nunca se
-- registró». Eso creaba un tercer estado —«no se sabe»— que en la práctica
-- no ayudaba a nadie: un servicio del que no consta el cobro está PENDIENTE,
-- porque nadie ha dicho que se pagara. Dar por bueno un cobro que nadie
-- confirmó es inventar un ingreso.
--
-- A partir de aquí:
--
--   false = pendiente de pago      true = pagado
--
-- Y es un eje INDEPENDIENTE del estado del cliente. Un cliente pausado o
-- cancelado puede deber dinero, y su deuda no desaparece por dejar de
-- entrenar: pausar o cancelar no toca nunca el estado de cobro.
--
-- Impacto económico: NINGUNO. `pagado` no entra en el cálculo de la
-- facturación, ni de las horas, ni del precio medio. Solo dice si está
-- cobrado.
--
-- Vuelta atrás:
--   alter table public.ciclos alter column pagado drop not null;
--   alter table public.ciclos alter column pagado drop default;
-- (los valores convertidos de NULL a false no se distinguen después; por eso
--  se hace la copia previa con scripts/copia-staging.mjs)

-- Los NULL que hubiera pasan a pendiente. Se comprobó antes con
-- scripts/diagnostico-pagos.mjs: en staging no había ninguno.
update public.ciclos set pagado = false where pagado is null;

alter table public.ciclos alter column pagado set default false;
alter table public.ciclos alter column pagado set not null;

comment on column public.ciclos.pagado is
  'Estado de COBRO: false = pendiente de pago, true = pagado. Nunca nulo. '
  'Independiente del estado del cliente: un pausado o cancelado puede deber.';

-- `cargos_mensuales.pagado` ya era `not null default false`. Se deja igual y
-- se documenta para que la regla quede escrita en los dos sitios.
comment on column public.cargos_mensuales.pagado is
  'Estado de COBRO de la cuota del mes: false = pendiente, true = pagada.';

-- -----------------------------------------------------------------------------
-- La renovación conserva el cobro del servicio que se cierra y abre el
-- siguiente PENDIENTE.
--
-- Antes, el ciclo que se cerraba tomaba su estado de `clientes.pendiente_pago`.
-- Funcionaba mientras los dos estuvieran sincronizados, pero la fuente de
-- verdad del cobro es el propio ciclo: se lee de ahí y no de un reflejo.
-- -----------------------------------------------------------------------------

create or replace function public.firmar_sesion(
  p_cliente_id          uuid,
  p_fecha               date default null,
  p_hora                time default null,
  p_clave_idempotencia  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente          public.clientes%rowtype;
  v_ciclo            public.ciclos%rowtype;
  v_fecha            date;
  v_hora             time;
  v_tarifa           numeric(10,2);
  v_numero           integer;
  v_restantes        integer;
  v_renovado         boolean := false;
  v_aviso_ultima     boolean := false;
  v_lunes            date;
  v_cargo            boolean;
begin
  -- La fecha del negocio es la de Madrid, no la del servidor. Vercel corre en
  -- UTC: entre medianoche y las 2 de la madrugada en Madrid estaría en «ayer».
  v_fecha := coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date);
  v_hora  := coalesce(p_hora,  (now() at time zone 'Europe/Madrid')::time);

  -- Aquí empieza la exclusión: cualquier otra firma de este cliente espera.
  select * into v_cliente
    from public.clientes
   where id = p_cliente_id
     for update;

  if not found then
    raise exception 'Ese cliente ya no existe' using errcode = 'no_data_found';
  end if;

  if v_cliente.estado <> 'activo' then
    raise exception '«%» está %. Reactívalo antes de firmarle una sesión.',
      v_cliente.nombre, v_cliente.estado using errcode = 'check_violation';
  end if;

  select * into v_ciclo
    from public.ciclos
   where cliente_id = p_cliente_id and ciclo = v_cliente.ciclo_actual;

  if not found then
    raise exception '«%» no tiene un servicio asignado', v_cliente.nombre
      using errcode = 'no_data_found';
  end if;

  -- Las mismas tres condiciones que comprueba la interfaz. Esconder un botón
  -- no impide llamar a la función.
  if v_ciclo.modalidad = 'bono' and (v_ciclo.sesiones_totales = 0 or v_ciclo.tarifa is null) then
    raise exception 'A «%» le faltan datos del bono por rellenar', v_cliente.nombre
      using errcode = 'check_violation';
  elsif v_ciclo.modalidad = 'cuenta' and v_ciclo.tarifa is null then
    raise exception 'A «%» le falta el precio por sesión', v_cliente.nombre
      using errcode = 'check_violation';
  elsif v_ciclo.modalidad = 'mensualidad' and coalesce(v_ciclo.cuota_mensual, 0) = 0 then
    raise exception 'A «%» le falta la cuota mensual', v_cliente.nombre
      using errcode = 'check_violation';
  end if;

  -- Segunda capa anti-duplicado. La clave primaria hace el trabajo: si ya
  -- estaba, no se inserta y se devuelve el estado sin tocar nada.
  if p_clave_idempotencia is not null then
    insert into public.idempotencia (clave)
    values (p_clave_idempotencia)
    on conflict (clave) do nothing;

    if not found then
      return jsonb_build_object(
        'numero_sesion',      v_cliente.sesiones_completadas,
        'sesiones_totales',   v_ciclo.sesiones_totales,
        'renovado',           false,
        'aviso_ultima_sesion', false,
        'duplicado',          true,
        'modalidad',          v_ciclo.modalidad,
        'anio',               extract(year from v_fecha)::int,
        'mes',                extract(month from v_fecha)::int
      );
    end if;
  end if;

  -- Cuánto aporta esta sesión. En una mensualidad, nada: su cuota ya está
  -- registrada aparte, así que sumar también la sesión sería cobrar dos veces.
  -- La sesión se guarda igual y cuenta como hora trabajada.
  v_tarifa := case when v_ciclo.modalidad = 'mensualidad' then null else v_ciclo.tarifa end;

  if v_ciclo.modalidad = 'bono' then
    v_restantes := v_ciclo.sesiones_totales - v_cliente.sesiones_completadas - 1;

    if v_restantes <= 0 then
      -- Esta sesión agota el bono: su número es el TOTAL (la última del bono
      -- que se cierra), no la primera del que empieza después.
      v_numero   := v_ciclo.sesiones_totales;
      v_renovado := true;
    else
      v_numero := v_ciclo.sesiones_totales - v_restantes;
    end if;
    v_aviso_ultima := (v_restantes = 1);
  else
    -- Mensualidad y cuenta: no hay saldo que gastar ni renovación que
    -- disparar. La sesión es simplemente la siguiente de este periodo.
    select count(*) + 1 into v_numero
      from public.sesiones
     where cliente_id = p_cliente_id and ciclo = v_ciclo.ciclo;
  end if;

  insert into public.sesiones
    (cliente_id, ciclo, fecha, hora, numero_sesion, sesiones_totales, tarifa, servicio)
  values
    (p_cliente_id, v_ciclo.ciclo, v_fecha, v_hora, v_numero,
     v_ciclo.sesiones_totales, v_tarifa, v_ciclo.servicio);

  -- Economía de la semana que contiene esa fecha (de lunes a domingo).
  v_lunes := v_fecha - ((extract(isodow from v_fecha)::int - 1) || ' days')::interval;

  insert into public.semanas (inicio, fin, facturacion, horas, horas_sin_importe)
  values (
    v_lunes,
    v_lunes + 6,
    coalesce(v_tarifa, 0),
    case when v_tarifa is null then 0 else 1 end,
    -- Corrección H-01: una sesión sin importe suma HORA y solo hora.
    case when v_tarifa is null then 1 else 0 end
  )
  on conflict (inicio) do update set
    facturacion       = public.semanas.facturacion + excluded.facturacion,
    horas             = public.semanas.horas + excluded.horas,
    horas_sin_importe = public.semanas.horas_sin_importe + excluded.horas_sin_importe;

  -- La primera sesión estrena la fecha de inicio del servicio.
  update public.ciclos
     set fecha_inicio = coalesce(fecha_inicio, v_fecha)
   where cliente_id = p_cliente_id and ciclo = v_ciclo.ciclo;

  if v_renovado then
    -- Se cierra el servicio agotado con su fecha de fin y su estado de cobro
    -- (es el único momento en que se sabe cómo quedó)...
    update public.ciclos
       set fecha_fin = v_fecha,
           -- Conserva SU PROPIO estado de cobro, leído del ciclo y no
           -- de `clientes.pendiente_pago`, que es solo un reflejo.
           pagado    = v_ciclo.pagado
     where cliente_id = p_cliente_id and ciclo = v_ciclo.ciclo;

    -- ...y se abre el siguiente con las MISMAS condiciones. Nace pendiente.
    insert into public.ciclos
      (cliente_id, ciclo, modalidad, servicio, tarifa, sesiones_totales,
       precio_total, cuota_mensual, sesiones_referencia, anio, mes, pagado)
    values
      (p_cliente_id, v_ciclo.ciclo + 1, v_ciclo.modalidad, v_ciclo.servicio,
       v_ciclo.tarifa, v_ciclo.sesiones_totales, v_ciclo.precio_total,
       v_ciclo.cuota_mensual, v_ciclo.sesiones_referencia, v_ciclo.anio, v_ciclo.mes, false);

    update public.clientes
       set ciclo_actual         = v_ciclo.ciclo + 1,
           sesiones_completadas = 0,
           pendiente_pago       = true
     where id = p_cliente_id;
  else
    update public.clientes
       set sesiones_completadas = sesiones_completadas + 1
     where id = p_cliente_id;
  end if;

  return jsonb_build_object(
    'numero_sesion',       v_numero,
    'sesiones_totales',    v_ciclo.sesiones_totales,
    'renovado',            v_renovado,
    'aviso_ultima_sesion', v_aviso_ultima,
    'duplicado',           false,
    'modalidad',           v_ciclo.modalidad,
    'anio',                extract(year from v_fecha)::int,
    'mes',                 extract(month from v_fecha)::int
  );
end;
$$;
