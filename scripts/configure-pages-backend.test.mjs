import test from 'node:test';
import assert from 'node:assert/strict';
import {configurePagesBackend} from './configure-pages-backend.mjs';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const staging={
 FREYA_BACKEND_ENV:'staging',
 FREYA_STAGING_SUPABASE_URL:'https://waatqrqyddurultrazbn.supabase.co',
 FREYA_STAGING_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+('a'.repeat(42))
};
test('preview uses an isolated Supabase project and never edits source',()=>{
 const edited=configurePagesBackend(source,staging);
 assert.match(edited,/const SUPABASE_URL="https:\/\/waatqrqyddurultrazbn\.supabase\.co";/);
 assert.match(edited,/const SUPABASE_KEY="sb_publishable_aaa/);
 assert.match(source,/const SUPABASE_URL='https:\/\/otueskpksylzvkhldoft\.supabase\.co';/);
 assert.equal((edited.match(/const SUPABASE_URL=/g)||[]).length,1);
 assert.doesNotMatch(edited,/otueskpksylzvkhldoft/);
 assert.match(edited,/Freya PROVES/);
 assert.match(edited,/id="freya-staging-marker"/);
});
test('production output is byte-identical with no preview variables',()=>{
 assert.equal(configurePagesBackend(source,{}),source);
});
test('refuses staging build with no independent backend',()=>{
 for(const data of [
  {FREYA_BACKEND_ENV:'staging'},
  {...staging,FREYA_STAGING_SUPABASE_PUBLISHABLE_KEY:''},
  {...staging,FREYA_STAGING_SUPABASE_URL:'https://otueskpksylzvkhldoft.supabase.co'},
  {...staging,FREYA_STAGING_SUPABASE_URL:'http://waatqrqyddurultrazbn.supabase.co'},
  {...staging,FREYA_STAGING_SUPABASE_URL:'https://waatqrqyddurultrazbn.supabase.co.attacker.invalid'},
  {...staging,FREYA_STAGING_SUPABASE_URL:'https://other-project.supabase.co'},
  {...staging,FREYA_STAGING_SUPABASE_URL:'https://waatqrqyddurultrazbn.supabase.co/other'},
  {...staging,FREYA_STAGING_SUPABASE_PUBLISHABLE_KEY:'service_role'},
  {FREYA_STAGING_SUPABASE_URL:'https://waatqrqyddurultrazbn.supabase.co'},
  {FREYA_BACKEND_ENV:'misconfigured'}
 ])assert.throws(()=>configurePagesBackend(source,data),/backend Supabase de proves/);
});
test('rejects ambiguous/missing production markers',()=>{
 assert.throws(()=>configurePagesBackend('no config',staging),/backend Supabase de proves/);
 assert.throws(()=>configurePagesBackend(source+source,staging),/backend Supabase de proves/);
});
test('does not leak service keys or write configuration to the source file',()=>{
 const result=configurePagesBackend(source,staging);
 assert.ok(!result.includes('service_role'));
 assert.equal(configurePagesBackend(source,{}),source);
});

test('Railway preview build refuses production and ignores no missing staging config',()=>{
 assert.throws(()=>configurePagesBackend(source,{RAILWAY_ENVIRONMENT_NAME:'preview'}),/backend Supabase de proves/);
 assert.throws(()=>configurePagesBackend(source,{RAILWAY_ENVIRONMENT:'preview'}),/backend Supabase de proves/);
 const output=configurePagesBackend(source,{...staging,RAILWAY_ENVIRONMENT_NAME:'preview'});
 assert.match(output,/Freya PROVES/);
 assert.doesNotMatch(output,/otueskpksylzvkhldoft/);
});
