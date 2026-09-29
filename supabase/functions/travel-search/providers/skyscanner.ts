import type {
  ProviderSearchResponse,
  TravelSearchQuery,
} from './types.ts';
import { createSkyscannerFlightsAdapter } from './skyscanner-core.mjs';

export async function searchSkyscannerFlights(
  query: TravelSearchQuery,
): Promise<ProviderSearchResponse> {
  const apiKey = Deno.env.get('SKYSCANNER_API_KEY');

  if (!apiKey) {
    return {
      provider: 'skyscanner',
      service: 'flights',
      configured: false,
      results: [],
      applied_preferences: [],
      unapplied_preferences: query.preferences.map((item) => item.key),
    };
  }

  return await createSkyscannerFlightsAdapter({ apiKey }).search(query);
}
