import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {compositionSchemaV1} from '../domain/travel-book-composition.mjs';
test('SQL schema matches domain literal exactly',()=>{const name=readdirSync(new URL('../supabase/migrations',import.meta.url)).find(n=>n.endsWith('_travel_book_foundation_v1.sql'));const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');assert.deepEqual(JSON.parse(sql.split('$json$')[1]),compositionSchemaV1)});
test('new CI check is blocking and local-only; five mutation RPCs and receipt read',()=>{
 const ci=readFileSync(new URL('../.github/workflows/pr-checks.yml',import.meta.url),'utf8').split('  alb02-contracts:')[1];assert.ok(ci);assert.doesNotMatch(ci,/continue-on-error|secrets\./);assert.match(ci,/test:alb02:db -- --ci-container/);
 const name=readdirSync(new URL('../supabase/migrations',import.meta.url)).find(n=>n.endsWith('_travel_book_commands_v1.sql'));const sql=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 const exposed=[...sql.matchAll(/create function public\.(\w+)/g)].map(m=>m[1]);assert.equal(exposed.length,6);assert.doesNotMatch(exposed.join(' '),/asset|snapshot|print|export/);
});
