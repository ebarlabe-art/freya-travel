# Vall d’Aran — original real i anotació de regressió

Origen: `Aran_original.zip`, facilitat explícitament per l’usuari per reproduir la incidència P0 (3/11/2026). `original.pdf` conserva els 87.520 bytes originals; SHA-256 a `sha256.txt`. Quatre pàgines, sense dades personals de viatgers; els telèfons són els de restaurants publicats a la guia. No s’han inventat activitats, passatgers, hores ni dates.

`pages.json`: extracció local amb pdfplumber. Reprodueix `no_itinerary_candidates` perquè l’ordre del text és títol → hora a la línia següent. La imatge de la pàgina 2 confirma visualment l’associació en dues columnes.

`annotated-transcript.json`: **anotació humana/de desenvolupament dels fragments reals**, contrastada amb text i disposició. NO és una captura de resposta OpenAI. Serveix per verificar el contracte d’associació semàntica, l’extractor i la revisió. `excerpt`, títols, hores i capçaleres són literals del text extret; el rol és una anotació. 13 plans principals, 2 opcions de dilluns i 2 plans B. Restaurants: recomanacions, no activitats/reserves.

`openai-real-transcript.json`: resposta real d’OpenAI del 3/11/2026 que provocava `invalid_transcript`: les descripcions complementàries no incloïen títol/hora. Capturada íntegra, sense credencials ni dades personals de viatgers.

`openai-verified-transcript.json`: nova lectura real després de corregir instruccions/validació. 16 propostes: 12 principals (sopar a les notes de l’arribada) i 4 alternatives; deu hores correctes, quatre dies. Pla B de diumenge amb data per revisar; restaurants recomanacions. Configuració local existent de Freya; no s’ha verificat el secret/model desplegat. La prova mòbil reprodueix aquesta resposta capturada, selecciona el PDF original i comprova SHA-256, revisió/opt-in/cancel·lació i zero escriptures. No fa crides a OpenAI ni a producció en CI.

`native-layout.json`: hores, títols i coordenades extrets independentment del PDF amb pdfplumber. Regeneració local: `python scripts/extract-aran-layout.py > /tmp/aran-layout.json`; comparació amb el fixture. Cap dependència nova de l’app. La regressió contrasta els deu títols/hores de les dues respostes reals amb aquestes files visuals i el hash del document. L’Edge no executa pdfplumber: la validació operativa continua essent contra les pàgines transcrites pel model, no OCR independent. La validació física a iPhone continua pendent.

Altres originals llegits **només al Mac**, no copiats al repositori: itinerari de Bolonya (21 candidats/21 dates), itinerari Riga–Tallinn (30/30), guia Riga–Tallinn (20/20 després de la resolució del període entre 2026 i 2027). Aquests recomptes comproven la lectura determinista, no la cobertura semàntica completa d’aquells documents.

## Repetir la lectura real, només al Mac

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

La clau es tecleja a la pregunta oculta, no a la línia d’ordres; no queda a l’historial ni s’escriu a disc. No activar `set -x` ni enregistrar la sessió. El model no és secret; cal usar el mateix de l’app. El programa fa una sola petició a OpenAI, amb consum d’API, `store:false` i límit de 12.000 tokens de sortida. No accedeix a Supabase ni modifica viatges. Comprova també títols, hores, alternatives, sopar, restaurants i absència de duplicats amb l’oracle semàntic del PDF. Només imprimeix el resum o un error sense contingut. No substitueix la validació física posterior. No executar aquest script en CI.
