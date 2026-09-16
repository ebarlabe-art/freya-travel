const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: any;

  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const origin = String(body?.origin || '').trim();
  const destination = String(body?.destination || '').trim();
  const startDate = String(body?.start_date || '').trim();
  const endDate = String(body?.end_date || '').trim();
  const adults = Number(body?.adults || 0);
  const cabin = String(body?.cabin || 'economy');
  const services = Array.isArray(body?.services) ? body.services : [];

  if (!origin || !destination || !startDate || !endDate) {
    return json({ error: 'Missing required search fields' }, 400);
  }

  if (endDate < startDate) {
    return json({ error: 'End date cannot be before start date' }, 400);
  }

  if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
    return json({ error: 'Invalid number of adults' }, 400);
  }

  const allowedServices = ['flights', 'hotels', 'cars'];
  const normalizedServices = services.filter(
    (value: unknown) =>
      typeof value === 'string' && allowedServices.includes(value)
  );

  if (!normalizedServices.length) {
    return json({ error: 'Select at least one search service' }, 400);
  }

  return json({
    ok: true,
    query: {
      origin,
      destination,
      start_date: startDate,
      end_date: endDate,
      adults,
      cabin,
      services: normalizedServices,
    },
    providers: {
      flights: {
        provider: 'skyscanner',
        configured: Boolean(Deno.env.get('SKYSCANNER_API_KEY')),
      },
      hotels: {
        provider: 'booking',
        configured:
          Boolean(Deno.env.get('BOOKING_API_TOKEN')) &&
          Boolean(Deno.env.get('BOOKING_AFFILIATE_ID')),
      },
      cars: {
        provider: 'booking',
        configured:
          Boolean(Deno.env.get('BOOKING_API_TOKEN')) &&
          Boolean(Deno.env.get('BOOKING_AFFILIATE_ID')),
      },
    },
  });
});
