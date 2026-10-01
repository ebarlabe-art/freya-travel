import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('reservation runtime no longer uses dynamic imports',()=>{
 assert.doesNotMatch(html,/import\(['"]\.\/domain\/tb-confirmation\.mjs['"]\)/);
 assert.doesNotMatch(html,/import\(['"]\.\/domain\/tb-budget\.mjs['"]\)/);
 assert.match(html,/const TB_CONFIRMATION_API=/);
 assert.match(html,/const TB_BUDGET_API=/);
});
