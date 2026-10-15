import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root=new URL('../',import.meta.url);
const dist=new URL('../dist/',import.meta.url);
const runtimeDomain=[
  'itinerary-route.mjs',
  'itinerary-route-ui.mjs',
  'itinerary-quick-place.mjs',
  'place-resolution.mjs',
  'place-resolution-ui.mjs',
  'proposal-handoff.mjs',
  'tb-confirmation.mjs',
  'tb-budget.mjs',
  'tb-build.mjs',
  'travel-search.mjs',
  'proposal-refinement.mjs',
  'proposal-builder.mjs',
  'live-trip-brief.mjs',
  'travel-builder.mjs',
  'trip-brief.mjs',
  'import-proposal.mjs',
  'import-itinerary-proposal.mjs',
  'import-itinerary-review.mjs',
  'import-itinerary-write.mjs',
  'travel-book-proposal.mjs',
  'travel-book-batch.mjs',
  'travel-book-editor-state.mjs',
  'travel-book-composition.mjs',
];

await mkdir(new URL('domain/',dist),{recursive:true});
for(const file of runtimeDomain){
  await copyFile(new URL('domain/'+file,root),new URL('domain/'+file,dist));
}
// A single editor module keeps failed imports retryable: browsers cache failed
// static dependencies separately, so changing only the entry URL is insufficient.
await build({
  configFile:false,
  publicDir:false,
  build:{
    outDir:fileURLToPath(new URL('domain/',dist)),
    emptyOutDir:false,
    minify:false,
    lib:{
      entry:fileURLToPath(new URL('domain/travel-book-editor-state.mjs',root)),
      formats:['es'],
      fileName:()=> 'travel-book-editor-state.mjs',
    },
  },
});

for(const file of ['trip-brief.mjs','live-trip-brief.mjs','travel-builder.mjs','import-proposal.mjs','proposal-refinement.mjs','proposal-builder.mjs']){
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('domain/'+file,root),'utf8'));
  const browser=source
    .replaceAll("./trip-brief.mjs","./trip-brief.js")
    .replaceAll("./live-trip-brief.mjs","./live-trip-brief.js")
    .replaceAll("./proposal-refinement.mjs","./proposal-refinement.js");
  await import('node:fs/promises').then(fs=>fs.writeFile(new URL('domain/'+file.replace(/\.mjs$/,'.js'),dist),browser));
}

await mkdir(new URL('vendor/',dist),{recursive:true});
await copyFile(new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js',root),new URL('vendor/supabase.js',dist));
const builtIndexUrl=new URL('index.html',dist);
const builtIndex=await readFile(builtIndexUrl,'utf8');
const cdnSupabase='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
if(!builtIndex.includes(cdnSupabase))throw new Error('Supabase CDN runtime marker not found in built index');
// Eliminate the second critical request during standalone iOS bootstrap.
// Keep the pinned UMD SDK in the built HTML; the source HTML remains lightweight.
const sdk=await readFile(new URL('vendor/supabase.js',dist),'utf8');
if(!sdk.includes('createClient')||Buffer.byteLength(sdk)>2*1024*1024)
  throw new Error('Supabase SDK is missing or unexpectedly large');
const sdkTag = `<script id="freyaSdk" src="${cdnSupabase}" onload="window.freyaBoot.step('app')" onerror="window.freyaBoot.fail('sdk')"></script>`;
if(!builtIndex.includes(sdkTag))throw new Error('Supabase bootstrap tag not found in built index');
// An HTML parser treats a raw closing script tag as markup even within JS strings.
const safeSdk=sdk.replace(/<\/script/gi,'<\\/script');
const inlineSdk = '<script id="freyaSdk">\n'+safeSdk+
  "\nwindow.freyaBoot.step(window.supabase?.createClient?'app':'sdk');\n</script>";
const finalIndex=builtIndex.replace(sdkTag,inlineSdk);
if(finalIndex.includes('src="'+cdnSupabase+'"'))throw new Error('Unexpected external critical SDK');
await writeFile(builtIndexUrl,finalIndex);

for(const file of ['sw.js','manifest.webmanifest','itinerary.html']){
  await copyFile(new URL(file,root),new URL(file,dist));
}

await cp(new URL('icons/',root),new URL('icons/',dist),{recursive:true,force:true});
await cp(new URL('freya-travel-v1.5/',root),new URL('freya-travel-v1.5/',dist),{recursive:true,force:true});

// GitHub Pages fallback must be the processed build entry, not the raw source.
await copyFile(new URL('index.html',dist),new URL('404.html',dist));

console.log('Packaged Pages runtime assets in '+fileURLToPath(dist));
