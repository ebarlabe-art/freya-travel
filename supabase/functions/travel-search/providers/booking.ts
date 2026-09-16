import type {
  ProviderSearchResponse,
  TravelSearchQuery,
  TravelSearchService,
} from './types.ts';

function bookingConfigured() {
  return Boolean(
    Deno.env.get('BOOKING_API_TOKEN') &&
    Deno.env.get('BOOKING_AFFILIATE_ID')
  );
}

export async function searchBooking(
  _query: TravelSearchQuery,
  service: Extract<TravelSearchService, 'hotels' | 'cars'>,
): Promise<ProviderSearchResponse> {
  if (!bookingConfigured()) {
    return {
      provider: 'booking',
      service,
      configured: false,
      results: [],
    };
  }

  return {
    provider: 'booking',
    service,
    configured: true,
    results: [],
    error: 'Provider adapter ready; live search not enabled yet.',
  };
}
