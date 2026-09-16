import type {
  ProviderSearchResponse,
  TravelSearchQuery,
  TravelSearchService,
} from './types.ts';

function kayakConfigured() {
  return Boolean(Deno.env.get('KAYAK_API_KEY'));
}

export async function searchKayak(
  _query: TravelSearchQuery,
  service: Extract<TravelSearchService, 'flights' | 'hotels' | 'cars'>,
): Promise<ProviderSearchResponse> {
  if (!kayakConfigured()) {
    return {
      provider: 'kayak',
      service,
      configured: false,
      results: [],
    };
  }

  return {
    provider: 'kayak',
    service,
    configured: true,
    results: [],
    error: 'Provider adapter ready; live search not enabled yet.',
  };
}
