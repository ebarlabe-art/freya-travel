import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const log=await readFile(process.argv[2],'utf8');
const root=log.match(/Validation site prepared: (.+)/)?.[1];
assert.ok(root,'Missing isolated site');
let files=0;
async function scan(path){for(const entry of await readdir(path,{withFileTypes:true})){
 const file=join(path,entry.name);if(entry.isDirectory()){await scan(file);continue;}
 const bytes=await readFile(file),text=bytes.toString();files++;
 assert.ok(!/otueskpksylzvkhldoft|waatqrqyddurultrazbn|travel-book-derivatives-production|sb_secret_[A-Za-z0-9_-]{15,}/.test(text),file);
 for(const m of text.matchAll(/(?:https?|wss?):\/\/([a-z]{20})\.supabase\.co/g))assert.equal(m[1],'abcdefghijklmnopqrst');
}}
await scan(root);
const index=await readFile(join(root,'freya-travel/index.html'));
assert.deepEqual(index,await readFile(join(root,'freya-travel/404.html')));
assert.ok(index.includes("connect-src 'self' https://abcdefghijklmnopqrst.supabase.co"));
assert.ok(index.includes('id="freyaSdk"'));
console.log(`PASS complete isolated frontend: ${files} files, index/404 parity, synthetic ref, no protected project or production worker.`);
