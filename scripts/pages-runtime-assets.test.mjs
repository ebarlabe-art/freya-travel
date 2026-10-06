import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const pack=readFileSync(new URL('./package-pages.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('Pages build packages every runtime domain module referenced dynamically',()=>{
  const refs=[...html.matchAll(/import\(['"]\.\/domain\/([^'"]+)['"]\)/g)].map(m=>m[1]);
  refs.push(...[...html.matchAll(/loadTravelBookModule\(['"]([^'"]+)['"]\)/g)].map(m=>m[1]));
  assert.ok(refs.length>0);
  for(const file of new Set(refs)) assert.ok(pack.includes(file),'missing '+file);
  assert.equal(pkg.scripts.postbuild,'node scripts/package-pages.mjs');
});

test('Pages build packages PWA and compatibility runtime files',()=>{
  for(const file of ['sw.js','manifest.webmanifest','itinerary.html','icons/','freya-travel-v1.5/']) assert.ok(pack.includes(file),'missing '+file);
  assert.ok(pack.includes('404.html'));
});
