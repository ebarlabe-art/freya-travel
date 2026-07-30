# Freya Travel 2.1

Aplicació compartida per al viatge a Londres 2026.

## Inclou

- autenticació i viatge compartit
- dashboard mòbil
- itinerari de Londres
- cartera de reserves
- checklist en temps real
- despeses del compte comú en EUR i GBP
- cerca, filtres, resum per categories i exportació CSV
- desplegament automàtic a GitHub Pages

## Desplegament

1. Si `travel_expenses` encara no existeix, executa `supabase-expenses-v2.sql` a Supabase.
2. Configura `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY` als secrets de GitHub.
3. El workflow `.github/workflows/deploy.yml` compila i publica l'aplicació.
