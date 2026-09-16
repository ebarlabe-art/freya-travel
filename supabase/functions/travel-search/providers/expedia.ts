import type {
  ProviderSearchResponse,
  TravelSearchQuery,
  TravelSearchService,
} from './types.ts';

function expediaLodgingConfigured() {
  return Boolean(
    Deno.env.get('EXPEDIA_API_KEY') &&
    Deno.env.get('EXPEDIA_SHARED_SECRET')
  );
}

export async function searchExpedia(
  _query: TravelSearchQuery,
  service: Extract<TravelSearchService, 'hotels' | 'cars'>,
): Promise<ProviderSearchResponse> {
  if (!expediaLodgingConfigured()) {
    return {
      provider: 'expedia',
      service,
      configured: false,
      results: [],
    };
  }

  return {
    provider: 'expedia',
    service,
    configured: true,
    results: [],
    error: 'Provider adapter ready; live search not enabled yet.',
  };
}
