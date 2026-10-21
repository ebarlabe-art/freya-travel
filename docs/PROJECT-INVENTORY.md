# FREYA TRAVEL — INVENTARI I CONTINUÏTAT DEL PROJECTE
Data de revisió: 2026-10-22. Estat: AUDITORIA EN CURS, no equival a validació funcional.
Font canònica de prioritats: docs/ROADMAP-CANONIC.md (v1.2, 2026-10-08). NO crear roadmaps paral·lels.

## Regla de lectura
- IMPLEMENTAT DOCUMENTAT: consta al roadmap o al codi; no equival a prova real.
- PARCIAL: existeix base però manca el flux complet.
- PENDENT: no consta el flux complet.
- VERIFICAR: no afirmar completat sense comprovar codi + CI + desplegament + dispositiu quan pertoqui.
- Cada sessió actualitza aquest inventari i l'estat de les PR; cap decisió antiga es descarta per absència del roadmap recent.
- NO utilitzar FREYA PROVES: acord explícit de producte del 22/10. No fer canvis a dades de producció per auditar.

## Fonts històriques recuperades
1. Bíblia original: Somiar > Preparar > Viure > Recordar; 8 fases; mode EN VIATGE en dos clics, diari multimèdia, Travel Book, IA personalitzada (fitxers de projecte 'Problema d’accés a l’app.txt').
2. Roadmaps inicials MVP/V2/V3/V4, auditoria de Londres/Eivissa i plans tècnics (fitxers històrics de projecte).
3. Roadmap canònic v1.2 docs/ROADMAP-CANONIC.md, que ja demana una sola font de veritat.
4. Experiències reals Londres, Eivissa i importació Bolonya (codi, documentació i PR).
5. docs/ordered-activity-points.txt, docs/v27-import-review-followup.txt i PR #169, #172, #173.
Cal seguir contrastant altres versions i converses, sense suposar que s'han recuperat totes.

## Inventari funcional — estat provisional
| Bloc | Estat | Evidència / feina pendent |
| --- | --- | --- |
| Comptes, sessions, recuperació | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2; revisar logout i caducitat offline |
| PWA i múltiples viatges | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2; verificar continuïtat en dispositiu |
| Checklist, documents, fotos | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2; prova regressió |
| Vols, allotjaments, transport, activitats operatives | IMPLEMENTAT DOCUMENTAT | trip_flights, trip_accommodations, trip_activities |
| Cotxe de lloguer (contracte/fotos) i aparcament | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2; revisar ús real |
| Itinerari consolidat i Home Ara/Següent | IMPLEMENTAT DOCUMENTAT | fonts operatives + trip_itinerary_items |
| Notificacions | IMPLEMENTAT DOCUMENTAT | Reparació posterior a Eivissa; prova E2E real encara important |
| Travel Builder TB-01 a TB-09 | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2; TB-08.5 hotels live parcial |
| Participants i permisos | PARCIAL | Gestió completa de membres pendent |
| Importació de reserves PDF/imatge | IMPLEMENTAT DOCUMENTAT | Roadmap v1.2 |
| Importació d'itineraris PDF | PARCIAL | Revisió, conflictes, ubicacions i validació real; docs/v27-import-review-followup.txt |
| Punts geogràfics ordenats | PARCIAL | docs/ordered-activity-points.txt; falsos positius en llocs de fora de ciutat |
| Confirmació d'ubicació senzilla | PARCIAL | PR #173; no considerar completada ni publicada sense proves |
| Narració catalana universal | PARCIAL | PR #169: lectura del context de dia; NO guia cultural universal completa |
| Guia de destinació / audioguies culturals | PARCIAL | Base específica Londres; reutilització general pendent |
| Restaurants recomanats, favorits, pubs | VERIFICAR | Base Londres; comprovar model universal |
| Moneda/divises i tipus de canvi | PARCIAL | Despeses amb GBP/EUR històric; mòdul universal no acreditat |
| Roaming/eSIM | VERIFICAR | Idea recuperada; no s'acredita implementació |
| Meteo contextual i meteo als records | VERIFICAR | Idea recuperada; no s'acredita implementació |
| Equipatge estructurat per viatger/segment | PENDENT/VERIFICAR | Checklist existent no és el mateix |
| Temps per arribar / sortir en X minuts | PARCIAL | Rutes entre punts documentades; avisos operatius complets no acreditats |
| Offline V2 lectura essencial | PARCIAL/VERIFICAR | Roadmap v1.2 i feina posterior; gate iPhone/token/logout pendent de contrast |
| Records / àlbum / Travel Book | PARCIAL | Treball ALB posterior al roadmap; exportació, impressió i flux final per verificar |
| Diari de veu, transcripció i multimèdia | PENDENT/VERIFICAR | Visió original; comprovar codi |
| Mapes del record | PENDENT/VERIFICAR | Roadmap v1.2 |
| Hotels i cotxes live | PENDENT | Adapters no són cerca comercial real |
| IA que aprèn preferències | FUTUR | Fora del nucli de publicació |

## DECISIÓ DE PRODUCTE: Activitats de l'itinerari han d'aparèixer a «Activitats»
Data: 2026-10-22. Petició de l'Eva en observar Bolonya.
Fet tècnic verificat: la importació de l'itinerari fa upsert a trip_itinerary_items (scripts/import-itinerary-review-ui.test.mjs); el Build/Activitats consulta trip_activities (domain/tb-build.mjs). Per tant, no és una regla 'només activitats amb entrada': són fonts diferents.
Objectiu: una visita, passejada o monument sense entrada també és una activitat. Mostrar-la a «Activitats» sense crear registres duplicats; entrada, reserva, cost i documents opcionals. Mantenir una font canònica i la sincronització bidireccional amb Itinerari. Diferenciar visites de trasllats i menjars segons tipologia, no segons si són de pagament.
Estat: PENDENT D'IMPLEMENTAR. No afirmar que ja apareixen a Bolonya. Dissenyar projecció de lectura o vinculació estable, revisar RLS, edició, eliminació, estats i proves E2E.

## Decisions no negociables
- No refer el que ja existeix a Londres/Eivissa; auditar i generalitzar.
- No duplicar dades ni crear activitats paral·leles.
- No mostrar falsos 'desat', ni mutar dades sense confirmació.
- No prioritzar integracions comercials davant el nucli ABANS/DURANT/DESPRÉS.
- Sense FREYA PROVES. Destí de publicació: Freya Travel pública, després de proves automàtiques i validacions necessàries.
- Cap PR amb proves fallides es considera tancada.

## Punt de relleu
Tasques immediates:
1. Acabar auditoria històrica i verificar cada estat contra main/PR i desplegament; actualitzar inventari.
2. Resoldre PR #173 (interfície de confirmació), contextualització de ciutat i falsos positius; tancar importació PDF com a flux complet.
3. Dissenyar i implementar la unificació Itinerari -> Activitats, amb prova de Bolonya i regressions Londres/Eivissa.
4. Revisar gates offline/notificacions, i després completar Records/Travel Book i guia universal.
No s'ha modificat cap dada de viatge en aquesta auditoria.
