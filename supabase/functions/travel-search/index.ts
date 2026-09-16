import { searchBooking } from './providers/booking.ts';
import { searchExpedia } from './providers/expedia.ts';
import { searchKayak } from './providers/kayak.ts';
import { searchSkyscannerFlights } from './providers/skyscanner.ts';

import type {
  ProviderSearchResponse,
  TravelSearchQuery,
  TravelSearchResult,
  TravelSearchService,
} from './providers/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedServices: TravelSearchService[] = ['flights', 'hotels', 'cars'];
const allowedCabins = ['economy', 'premium_economy', 'business', 'first'];

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

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function uniqueServices(values: unknown[]): TravelSearchService[] {
  return [
    ...new Set(
      values.filter(
        (value): value is TravelSearchService =>
          typeof value === 'string' &&
          allowedServices.includes(value as TravelSearchService),
      ),
    ),
  ];
}

function dedupeResults(results: TravelSearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = [
      result.provider,
      result.service,
      result.id,
      result.deeplink || '',
    ].join('|');

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

async function safeProviderCall(
  provider: string,
  service: TravelSearchService,
  call: () => Promise<ProviderSearchResponse>,
): Promise<ProviderSearchResponse> {
  try {
    return await call();
  } catch (error) {
    console.error(`Provider ${provider}/${service} failed:`, error);

    return {
      provider,
      service,
      configured: true,
      results: [],
      error: error instanceof Error ? error.message : 'Provider search failed',
    };
  }
}

function searchTasks(query: TravelSearchQuery) {
  const tasks: Promise<ProviderSearchResponse>[] = [];

  for (const service of query.services) {
    if (service === 'flights') {
      tasks.push(
        safeProviderCall(
          'skyscanner',
          'flights',
          () => searchSkyscannerFlights(query),
        ),
      );

      tasks.push(
        safeProviderCall(
          'kayak',
          'flights',
          () => searchKayak(query, 'flights'),
        ),
      );
    }

    if (service === 'hotels') {
      tasks.push(
        safeProviderCall(
          'booking',
          'hotels',
          () => searchBooking(query, 'hotels'),
        ),
      );

      tasks.push(
        safeProviderCall(
          'expedia',
          'hotels',
          () => searchExpedia(query, 'hotels'),
        ),
      );

      tasks.push(
        safeProviderCall(
          'kayak',
          'hotels',
          () => searchKayak(query, 'hotels'),
        ),
      );
    }

    if (service === 'cars') {
      tasks.push(
        safeProviderCall(
          'booking',
          'cars',
          () => searchBooking(query, 'cars'),
        ),
      );

      tasks.push(
        safeProviderCall(
          'expedia',
          'cars',
          () => searchExpedia(query, 'cars'),
        ),
      );

      tasks.push(
        safeProviderCall(
          'kayak',
          'cars',
          () => searchKayak(query, 'cars'),
        ),
      );
    }
  }

  return tasks;
}

function summarizeProviders(
  responses: ProviderSearchResponse[],
  service: TravelSearchService,
) {
  const serviceResponses = responses.filter(
    (response) => response.service === service,
  );

  return {
    configured: serviceResponses.some((response) => response.configured),
    sources: serviceResponses.map((response) => ({
      provider: response.provider,
      configured: response.configured,
      error: response.error || null,
      result_count: response.results.length,
    })),
  };
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
  const services = uniqueServices(
    Array.isArray(body?.services) ? body.services : [],
  );

  if (!origin || !destination || !startDate || !endDate) {
    return json({ error: 'Missing required search fields' }, 400);
  }

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return json({ error: 'Invalid date format' }, 400);
  }

  if (endDate < startDate) {
    return json({ error: 'End date cannot be before start date' }, 400);
  }

  if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
    return json({ error: 'Invalid number of adults' }, 400);
  }

  if (!allowedCabins.includes(cabin)) {
    return json({ error: 'Invalid cabin class' }, 400);
  }

  if (!services.length) {
    return json({ error: 'Select at least one search service' }, 400);
  }

  const query: TravelSearchQuery = {
    origin,
    destination,
    start_date: startDate,
    end_date: endDate,
    adults,
    cabin,
    services,
  };

  const responses = await Promise.all(searchTasks(query));

  const results = dedupeResults(
    responses.flatMap((response) => response.results),
  );

  return json({
    ok: true,
    query,
    results,
    provider_responses: responses,
    providers: {
      flights: summarizeProviders(responses, 'flights'),
      hotels: summarizeProviders(responses, 'hotels'),
      cars: summarizeProviders(responses, 'cars'),
    },
  });
});
