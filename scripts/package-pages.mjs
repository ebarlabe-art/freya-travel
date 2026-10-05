import { copyFile, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
];

await mkdir(new URL('domain/',dist),{recursive:true});
for(const file of runtimeDomain){
  await copyFile(new URL('domain/'+file,root),new URL('domain/'+file,dist));
}
for(const file of ['trip-brief.mjs','live-trip-brief.mjs','travel-builder.mjs','import-proposal.mjs','proposal-refinement.mjs','proposal-builder.mjs']){
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('domain/'+file,root),'utf8'));
  const browser=source
    .replaceAll("./trip-brief.mjs","./trip-brief.js")
    .replaceAll("./live-trip-brief.mjs","./live-trip-brief.js")
    .replaceAll("./proposal-refinement.mjs","./proposal-refinement.js");
  await import('node:fs/promises').then(fs=>fs.writeFile(new URL('domain/'+file.replace(/\.mjs$/,'.js'),dist),browser));
}

for(const file of ['sw.js','manifest.webmanifest','itinerary.html']){
  await copyFile(new URL(file,root),new URL(file,dist));
}

await cp(new URL('icons/',root),new URL('icons/',dist),{recursive:true,force:true});
await cp(new URL('freya-travel-v1.5/',root),new URL('freya-travel-v1.5/',dist),{recursive:true,force:true});

// GitHub Pages fallback must be the processed build entry, not the raw source.
await copyFile(new URL('index.html',dist),new URL('404.html',dist));

console.log('Packaged Pages runtime assets in '+fileURLToPath(dist));
