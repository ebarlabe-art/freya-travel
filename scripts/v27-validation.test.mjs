import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validationConfig,validationEntry,protectedRefs,productionWorker} from './v27-validation-config.mjs';
const env={FREYA_VALIDATION_PROJECT_REF:'abcdefghijklmnopqrst',FREYA_VALIDATION_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',FREYA_VALIDATION_PUBLISHABLE_KEY:'sb_publishable_validation_fixture'};
test('validation rejects missing, protected, mismatched and privileged credentials',()=>{
  assert.throws(()=>validationConfig({}));
  for(const ref of protectedRefs)assert.throws(()=>validationConfig({...env,FREYA_VALIDATION_PROJECT_REF:ref,FREYA_VALIDATION_SUPABASE_URL:`https://${ref}.supabase.co`}));
  assert.throws(()=>validationConfig({...env,FREYA_VALIDATION_SUPABASE_URL:env.FREYA_VALIDATION_SUPABASE_URL+'/'}));
  for(const key of ['sb_secret_private','eyJhbGciOiJIUzI1NiJ9.fake.jwt'])assert.throws(()=>validationConfig({...env,FREYA_VALIDATION_PUBLISHABLE_KEY:key}));
});
test('validation removes public credentials and worker, constrains network and preserves PWA scope',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const result=validationEntry(source,validationConfig(env));
  for(const ref of protectedRefs)assert.equal(result.includes(ref),false);
  assert.equal(result.includes(productionWorker),false);
  assert.ok(result.includes("connect-src 'self' "+env.FREYA_VALIDATION_SUPABASE_URL));
  assert.ok(result.includes("derivative_pending'){throw Error("));
  assert.ok(result.includes("register('/freya-travel/sw.js'"));
  assert.throws(()=>validationEntry(source,validationConfig({...env,FREYA_VALIDATION_PUBLISHABLE_KEY:source.match(/const SUPABASE_KEY='([^']+)';/)[1]})));
});
