import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root=new URL('../',import.meta.url);
const dist=new URL('../dist/',import.meta.url);
const runtimeDomain=[
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
// Only the separately pinned iPhone preview branch is hosted at the domain root.
// Never port these replacements to main, where GitHub Pages lives at /freya-travel/.
let previewIndex=builtIndex.replace(cdnSupabase,'/vendor/supabase.js');
const rootPreviewRewrites=[
  ["'/freya-travel/domain/","'/domain/"],
  ["'/freya-travel/sw.js'","'/sw.js'"],
  ["scope:'/freya-travel/'","scope:'/'"],
  ['content="Freya Travel"','content="Freya PROVES"'],
  ['<title>Freya Travel</title>','<title>Freya PROVES · Offline V2</title>'],
];
for(const [needle,replacement] of rootPreviewRewrites){
  if(!previewIndex.includes(needle))throw new Error('Missing root preview route: '+needle);
  previewIndex=previewIndex.replaceAll(needle,replacement);
}
await writeFile(builtIndexUrl,previewIndex);

for(const file of ['sw.js','manifest.webmanifest','itinerary.html']){
  await copyFile(new URL(file,root),new URL(file,dist));
}

await cp(new URL('icons/',root),new URL('icons/',dist),{recursive:true,force:true});
await cp(new URL('freya-travel-v1.5/',root),new URL('freya-travel-v1.5/',dist),{recursive:true,force:true});

// GitHub Pages fallback must be the processed build entry, not the raw source.
await copyFile(new URL('index.html',dist),new URL('404.html',dist));

console.log('Packaged Pages runtime assets in '+fileURLToPath(dist));
