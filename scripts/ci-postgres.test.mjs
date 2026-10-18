import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('CI database falls back to publisher mirror on quota, preserves override and fails closed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'freya-ci-pull-'));
  try{
    writeFileSync(join(dir,'docker'),`#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$1 $2" in
  'image inspect') exit 1 ;;
  'pull public.ecr.aws/supabase/postgres:17.6.1.165') exit 1 ;;
  'pull docker.io/supabase/postgres:17.6.1.165') exit 0 ;;
  'pull custom.invalid/image:fixed') exit 1 ;;
esac
exit 0
`,{mode:0o755});
    writeFileSync(join(dir,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    const script=new URL('./ci-postgres.sh',import.meta.url).pathname;
    const calls=join(dir,'calls');
    const env={...process.env,PATH:dir+':'+process.env.PATH,CALLS:calls,FREYA_CI_POSTGRES_IMAGE:''};
    const run=spawnSync('bash',[script,'start','freya_alb02_ci'],{env,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    let log=readFileSync(calls,'utf8');
    assert.ok(log.includes('pull docker.io/supabase/postgres:17.6.1.165'));
    assert.ok(log.includes('run -d --name freya_alb02_ci'));
    assert.ok(log.includes('docker.io/supabase/postgres:17.6.1.165'));
    writeFileSync(calls,'');
    const failed=spawnSync('bash',[script,'start','freya_alb02_ci'],{env:{...env,FREYA_CI_POSTGRES_IMAGE:'custom.invalid/image:fixed'},encoding:'utf8'});
    assert.equal(failed.status,1);
    log=readFileSync(calls,'utf8');
    assert.equal(log.includes('docker.io'),false);
    assert.equal(log.includes('run -d'),false);
    assert.equal(log.split('pull custom.invalid/image:fixed').length-1,4);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
