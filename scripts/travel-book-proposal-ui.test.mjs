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
 assert.match(sw,/freya-travel-release-6444-v1/);
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
