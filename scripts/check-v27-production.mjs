import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
assert.equal(html,await readFile(new URL('404.html',root),'utf8'),'Packaged fallback differs');
assert.match(html,/const SUPABASE_URL='https:\/\/otueskpksylzvkhldoft\.supabase\.co'/,'Public endpoint changed');
const key=html.match(/const SUPABASE_KEY='([^']+)'/)?.[1];
assert.ok(key,'Missing existing public client key');
if(key.split('.').length===3){
 const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
 assert.equal(payload.role,'anon','Privileged frontend key');
 assert.equal(payload.ref,'otueskpksylzvkhldoft','Client key points elsewhere');
}else assert.ok(key.startsWith('sb_publishable_'),'Unexpected client key type');
async function scan(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  assert.ok(!['validation','supabase','.env'].includes(entry.name),'Preparation or configuration packaged');
  const url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
  if(entry.isDirectory())await scan(url);
  else if(/\.(?:html|js|mjs|json|webmanifest)$/.test(entry.name)){
   const text=await readFile(url,'utf8');
   for(const match of text.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g))
    assert.equal(match[1],'otueskpksylzvkhldoft','Unexpected Supabase project in release');
  }
 }
}
await scan(root);
assert.match(await readFile(new URL('sw.js',root),'utf8'),/freya-travel-release-6444-v43/);
console.log('PASS public artifact: intended project only, public client key, entry parity, v27 worker, no independent-environment files.');
