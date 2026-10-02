import { readFile, writeFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
for(const file of ['trip-brief.mjs','live-trip-brief.mjs','travel-builder.mjs']){
  const source=await readFile(new URL('domain/'+file,root),'utf8');
  const browser=source
    .replaceAll("./trip-brief.mjs","./trip-brief.js")
    .replaceAll("./live-trip-brief.mjs","./live-trip-brief.js");
  await writeFile(new URL('domain/'+file.replace(/\.mjs$/,'.js'),root),browser);
}
console.log('Generated browser Builder runtime before Vite build.');
