# Freya Travel — fase 1

Primera versió funcional del compartit:
- crear compte / iniciar sessió
- crear un viatge
- unir-s'hi amb codi
- checklist sincronitzada en temps real

## 1. Supabase
Obre SQL Editor, enganxa tot el contingut de `supabase.sql` i prem Run.

A Authentication > Providers > Email, deixa Email activat. Per provar més ràpid, pots desactivar temporalment "Confirm email".

## 2. GitHub
Crea un repositori anomenat exactament `freya-travel` i puja-hi aquests fitxers.

A Settings > Secrets and variables > Actions crea:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

A Settings > Pages, selecciona Source: GitHub Actions.

La web quedarà a `https://EL_TEU_USUARI.github.io/freya-travel/`.
