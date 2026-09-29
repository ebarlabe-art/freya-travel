export type TravelSearchService = 'flights' | 'hotels' | 'cars';
export type TravelSearchPreferenceStrength = 'hard' | 'preference' | 'flexible';
export type TravelSearchPreferenceKey =
  | 'max_stops'
  | 'max_duration_minutes'
  | 'alternative_airports'
  | 'low_cost'
  | 'departure_window'
  | 'arrival_window';

export type TravelSearchPreference = {
  key: TravelSearchPreferenceKey;
  decision_id: string;
  strength: TravelSearchPreferenceStrength;
  value: unknown;
};

export type TravelSearchQuery = {
  origin: string;
  destination: string;
  start_date: string;
  end_date: string | null;
  trip_type: 'one_way' | 'round_trip';
  adults: number;
  children_ages: number[];
  cabin: string;
  services: TravelSearchService[];
  market: string;
  locale: string;
  currency: string;
  preferences: TravelSearchPreference[];
};

export type TravelSearchResult = {
  id: string;
  provider: string;
  service: TravelSearchService;
  title: string;
  subtitle?: string;
  price?: {
    amount: number;
    currency: string;
  };
  deeplink?: string;
  raw?: unknown;
};

export type ProviderSearchResponse = {
  provider: string;
  service: TravelSearchService;
  configured: boolean;
  results: TravelSearchResult[];
  error?: string;
  applied_preferences?: TravelSearchPreferenceKey[];
  unapplied_preferences?: TravelSearchPreferenceKey[];
};
