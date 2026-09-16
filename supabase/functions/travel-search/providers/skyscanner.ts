import type {
  ProviderSearchResponse,
  TravelSearchQuery,
} from './types.ts';

export async function searchSkyscannerFlights(
  _query: TravelSearchQuery,
): Promise<ProviderSearchResponse> {
  const apiKey = Deno.env.get('SKYSCANNER_API_KEY');

  if (!apiKey) {
    return {
      provider: 'skyscanner',
      service: 'flights',
      configured: false,
      results: [],
    };
  }

  return {
    provider: 'skyscanner',
    service: 'flights',
    configured: true,
    results: [],
    error: 'Provider adapter ready; live search not enabled yet.',
  };
}
