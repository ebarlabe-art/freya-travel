# Vall d’Aran — original real i anotació de regressió

Origen: `Aran_original.zip`, facilitat explícitament per l’usuari per reproduir la incidència P0 (3/11/2026). `original.pdf` conserva els 87.520 bytes originals; SHA-256 a `sha256.txt`. Quatre pàgines, sense dades personals de viatgers; els telèfons són els de restaurants publicats a la guia. No s’han inventat activitats, passatgers, hores ni dates.

`pages.json`: extracció local amb pdfplumber. Reprodueix `no_itinerary_candidates` perquè l’ordre del text és títol → hora a la línia següent. La imatge de la pàgina 2 confirma visualment l’associació en dues columnes.

`annotated-transcript.json`: **anotació humana/de desenvolupament dels fragments reals**, contrastada amb text i disposició. NO és una captura de resposta OpenAI. Serveix per verificar el contracte d’associació semàntica, l’extractor i la revisió. `excerpt`, títols, hores i capçaleres són literals del text extret; el rol és una anotació. 13 plans principals, 2 opcions de dilluns i 2 plans B. Restaurants: recomanacions, no activitats/reserves.

La prova mòbil selecciona els bytes del PDF original, comprova el SHA-256 del payload i simula exclusivament la resposta del proveïdor amb aquesta anotació. El backend real, la resposta IA al nou esquema i la PWA física continuen pendents. No presentar aquest fixture com a prova end-to-end d’OpenAI.

Altres originals llegits **només al Mac**, no copiats al repositori: itinerari de Bolonya (21 candidats/21 dates), itinerari Riga–Tallinn (30/30), guia Riga–Tallinn (20/20 després de la resolució del període entre 2026 i 2027). Aquests recomptes comproven la lectura determinista, no la cobertura semàntica completa d’aquells documents.

## Lectura real pendent, només al Mac

No crear secrets al repositori ni als runners. Al Terminal del Mac (zsh), executar:

```sh
cd /private/tmp/freya-aran-import
read -rs "OPENAI_API_KEY?Clau OpenAI (entrada oculta): "
export OPENAI_API_KEY
read "A2_IMPORT_MODEL?Nom exacte del model configurat a Supabase: "
export A2_IMPORT_MODEL
node scripts/check-aran-provider.mjs --allow-provider
unset OPENAI_API_KEY A2_IMPORT_MODEL
```

La clau es tecleja a la pregunta oculta, no a la línia d’ordres; no queda a l’historial ni s’escriu a disc. No activar `set -x` ni enregistrar la sessió. El model no és secret; cal usar el mateix de l’app. El programa fa una sola petició a OpenAI, amb consum d’API, `store:false` i límit de 12.000 tokens de sortida. No accedeix a Supabase ni modifica viatges. Només imprimeix recomptes/dates o un error sense contingut. Aquests recomptes no substitueixen la revisió semàntica ni la validació física posterior. No executar aquest script en CI.
