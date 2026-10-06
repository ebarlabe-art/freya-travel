import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const pack=readFileSync(new URL('./package-pages.mjs',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('ALB-04 UI exposes Crear album only as an explicit action and opens a dedicated proposal view',()=>{
 assert.match(html,/id="travelBookEntry"[^>]*hidden/);
 assert.match(html,/id="createTravelBookButton"/);
 assert.match(html,/id="travelBookView" class="hidden"/);
 assert.match(html,/APP_VIEWS=\[[^\]]*'travelBookView'/);
 assert.match(html,/GENERIC_ALLOWED_VIEWS=new Set\(\[[^\]]*'travelBookView'/);
});

test('ALB-04 UI consumes the pure proposal module and only ready editorial assets',()=>{
 assert.match(html,/import\('\.\/domain\/travel-book-proposal\.mjs'\)/);
 assert.match(html,/from\('travel_book_assets'\)[\s\S]*?\.eq\('status','ready'\)/);
 assert.match(html,/get_travel_book_ingestion_v1/);
 assert.match(html,/travel_book_asset_variants[\s\S]*?\.in\('kind',\['thumbnail','preview'\]\)/);
 assert.match(html,/from\('travel_documents'\)\.select\('id,title,file_name'\)/);
 assert.match(html,/title_reviewed:userCaption/);
});

test('ALB-04 runtime module is packaged and cached for the PWA',()=>{
 assert.match(pack,/'travel-book-proposal\.mjs'/);
 assert.match(sw,/'\.\/domain\/travel-book-proposal\.mjs'/); assert.match(sw,/'\.\/domain\/travel-book-batch\.mjs'/);
 assert.match(sw,/freya-travel-release-6444-v4/);
});

test('ALB-04 preview communicates partial source coverage instead of pretending the full gallery is ready',()=>{
 assert.match(html,/totalGallery=documents\.length/);
 assert.match(html,/\$\{proposal\.stats\.ready_photos\} de \$\{totalGallery\} fotos preparades/);
});

test('ALB-04 bulk preparation is server-resumable and uses bounded reads',()=>{
 assert.match(html,/request_travel_book_photo_v1/);
 assert.match(html,/get_travel_book_ingestion_v1/);
 assert.match(html,/runTravelBookBatch/);
 assert.match(html,/travelBookMapLimited\(assets,4/);
 assert.match(html,/createSignedUrls\(/);
 assert.match(html,/travel-book-derivatives-production\.up\.railway\.app\/process/);
});


test('ALB-05 renders a creative Travel Book instead of a plain photo grid',()=>{
 assert.match(html,/data-creative="\$\{esc\(page\.creative_style\)\}"/);
 assert.match(html,/travel-book-creative-copy/);
 assert.match(html,/travel-book-stickers/);
 assert.match(html,/hero_editorial/);
 assert.match(html,/scrapbook/);
 assert.match(html,/narrative/);
});


test('ALB-05.3 exposes direct page editing without replacing the creative proposal flow',()=>{
 assert.match(html,/contenteditable="true"[^>]*data-tb-edit="title"/);
 assert.match(html,/contenteditable="true"[^>]*data-tb-edit="subtitle"/);
 assert.match(html,/data-tb-style/);
 assert.match(html,/Proposa’m un altre text/);
 assert.match(html,/data-tb-sticker/);
 assert.match(html,/editTravelBookPage/);
 assert.match(html,/proposeAlternativeTravelBookTitle/);
});

test('ALB-05.3 keeps page edits scoped to the selected page and preserves index\/404 parity contract',()=>{
 assert.match(html,/travelBookApplyPageEdit\(sectionIndex,pageIndex/);
 assert.match(html,/section_index:sectionIndex,page_index:pageIndex/);
 assert.match(html,/state\.proposal=api\.editTravelBookPage/);
});


test('ALB-05.4 uses understandable composition names and exposes visible decoration labels',()=>{
 assert.match(html,/>Foto protagonista<\/option>/);
 assert.match(html,/>Collage<\/option>/);
 assert.match(html,/>Història<\/option>/);
 assert.match(html,/✨ Brilli/);
 assert.match(html,/♥ Cor/);
 assert.match(html,/▱ Postal/);
});

test('ALB-05.4 supports direct text overlays on each photo',()=>{
 assert.match(html,/data-tb-photo-edit/);
 assert.match(html,/Text sobre aquesta foto/);
 assert.match(html,/travelBookApplyPhotoText/);
 assert.match(html,/editTravelBookPhotoOverlay/);
 assert.match(html,/travel-book-photo-overlay/);
});


test('ALB-05.5 loads and saves the editor through the existing Travel Book persistence model',()=>{
 assert.match(html,/import\('\.\/domain\/travel-book-editor-state\.mjs'\)/);
 assert.match(html,/create_travel_book_edition_v1/);
 assert.match(html,/change_travel_book_structure_v1/);
 assert.match(html,/save_travel_book_compositions_v1/);
 assert.match(html,/travel_book_composition_versions/);
 assert.match(html,/applyTravelBookDocuments/);
 assert.match(html,/queueTravelBookSave/);
});

test('ALB-05.5 stickers are movable with pointer input and persist percentage positions',()=>{
 assert.match(html,/onpointerdown/);
 assert.match(html,/onpointermove/);
 assert.match(html,/onpointerup/);
 assert.match(html,/sticker_positions/);
 assert.match(html,/touch-action:none/);
 assert.match(html,/Arrossega per moure-la/);
});

test('ALB-05.5 persistence runtime is packaged and cached',()=>{
 assert.match(pack,/'travel-book-editor-state\.mjs'/);
 assert.match(sw,/'\.\/domain\/travel-book-editor-state\.mjs'/);
 assert.match(sw,/freya-travel-release-6444-v4/);
});


test('ALB-05.5 hotfix packages the editor transitive browser dependency',()=>{
 assert.match(pack,/'travel-book-composition\.mjs'/);
 assert.match(sw,/'\.\/domain\/travel-book-composition\.mjs'/);
 assert.match(sw,/freya-travel-release-6444-v4/);
});


test('ALB-03 stale lease stops the browser batch instead of being counted as retryable noise',()=>{
 assert.match(html,/error\?\.code==='auth'\|\|error\?\.code==='stale_lease'/);
});
