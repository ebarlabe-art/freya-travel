# ALB-04 — Primera proposta editable del Travel Book

Estat: **en implementació**. Decisió de producte validada el 2026-10-05: motor **híbrid**.

## Objectiu

Quan l'usuari prem «Crear àlbum», Freya no obre un editor buit. Prepara una primera proposta útil a partir de recursos editorials autoritzats i, després, una capa creativa pot enriquir-la sense inventar vivències.

ALB-04 no fixa encara format físic, mida d'impressió, bleed ni renderer. La proposta intermèdia és semàntica i independent de píxels o mil·límetres; ALB-05/07 la materialitzaran sobre composicions i renderització quan els contractes corresponents estiguin aprovats.

## Motor híbrid aprovat

### Capa A — base determinista

domain/travel-book-proposal.mjs rep exclusivament dades filtrades:
- identitat de viatge i llibre;
- actius editorials en estat ready;
- data/context explícit disponible;
- títol de foto, quan existeix, només com a declaració de l'usuari;
- identificadors de snapshots autoritzats;
- dimensions editorials necessàries per heurístiques visuals simples.

La sortida:
- tria una portada candidata de manera determinista;
- agrupa fotografies amb data explícita per dia;
- conserva les fotos sense data en un bloc separat, sense inferir-ne el dia;
- proposa un ritme semàntic (hero, duo, triptych, grid, story_grid);
- conserva procedència;
- no incorpora paths d'Storage, noms de fitxer, reserves ni camps arbitraris;
- no produeix narrativa factual.

### Capa B — creativa Freya

Pendent dins ALB-04. La capa creativa només podrà treballar sobre la base determinista i fonts filtrades. Haurà de retornar propostes tipades de títols, jerarquia i microtext, amb procedència i classificació. No podrà afirmar una experiència viscuda a partir de planning, reserva o simple existència d'una foto.

## Contracte inicial

La proposta V1 té:
- schema_version: 1;
- engine.mode = hybrid;
- base alb04-deterministic-v1;
- portada candidata;
- seccions per dia o records sense data;
- items referenciats només per asset_id;
- caption_candidate opcional classificat com user_statement;
- source_snapshot_ids;
- avisos i estadístiques.

No conté geometria física. Això evita decidir silenciosament un format comercial encara pendent.

## Validació ALB-04.1

La fase 04.1 es considera preparada quan:
1. la base és determinista i estable davant reordenació de l'input;
2. només usa actius ready;
3. no inventa dates, llocs ni vivències;
4. no filtra dades operatives o rutes privades;
5. funciona amb dades parcials i fotos sense context;
6. té tests de contracte;
7. la UI pot consumir aquesta proposta sense començar en blanc.

La integració de UI i la capa creativa es faran incrementalment sobre aquest contracte.
