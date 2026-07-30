# Freya Travel 2.0

Aplicació compartida per al viatge a Londres 2026.

## Funcions
- autenticació i viatge compartit
- dashboard mòbil
- itinerari complet
- checklist en temps real
- cartera d’entrades
- despeses del compte comú
- exportació CSV
- PWA i GitHub Pages

## Desplegament
1. Executa `supabase.sql` en un projecte nou, o `supabase-expenses-v2.sql` si el projecte ja existeix.
2. Configura els secrets `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY` a GitHub.
3. El workflow `.github/workflows/deploy.yml` publica automàticament a GitHub Pages.
