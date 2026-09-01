create or replace function public.claim_notification_deliveries(
  p_batch_size integer default 10,
  p_lease_seconds integer default 600
)
returns setof public.notification_deliveries
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception 'p_batch_size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'p_lease_seconds must be between 30 and 900'
      using errcode = '22023';
  end if;

  return query
  with claimable as (
    select
      delivery.id,
      case delivery.status
        when 'pending' then delivery.scheduled_for
        when 'retry' then delivery.next_attempt_at
        when 'processing' then delivery.lease_until
      end as due_at
    from public.notification_deliveries as delivery
    where
      (delivery.status = 'pending' and delivery.scheduled_for <= statement_timestamp())
      or (delivery.status = 'retry' and delivery.next_attempt_at <= statement_timestamp())
      or (delivery.status = 'processing' and delivery.lease_until <= statement_timestamp())
    order by
      due_at asc,
      delivery.scheduled_for asc,
      delivery.created_at asc,
      delivery.id asc
    for update of delivery skip locked
    limit p_batch_size
  ),
  claimed as (
    update public.notification_deliveries as delivery
    set
      status = 'processing',
      attempt_count = delivery.attempt_count + 1,
      next_attempt_at = null,
      lease_until = statement_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = statement_timestamp()
    from claimable
    where delivery.id = claimable.id
    returning delivery.*
  )
  select claimed.*
  from claimed
  order by
    case claimed.status
      when 'processing' then claimed.scheduled_for
    end asc,
    claimed.created_at asc,
    claimed.id asc;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, integer)
  from public, anon, authenticated;

grant execute on function public.claim_notification_deliveries(integer, integer)
  to service_role;
