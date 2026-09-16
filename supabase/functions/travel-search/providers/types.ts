export type TravelSearchService = 'flights' | 'hotels' | 'cars';

export type TravelSearchQuery = {
  origin: string;
  destination: string;
  start_date: string;
  end_date: string;
  adults: number;
  cabin: string;
  services: TravelSearchService[];
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
};
