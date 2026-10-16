import {cp,mkdtemp,readFile,writeFile,symlink,rm,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {validationConfig,validationEntry,protectedRefs,productionWorker} from './v27-validation-config.mjs';

const config=validationConfig(process.env); // Fail before building anything.
const root=fileURLToPath(new URL('../',import.meta.url));
// No arbitrary output path: never delete or overwrite a pre-existing site.
const temporary=await mkdtemp(join(tmpdir(),'freya-v27-validation-'));
const source=join(temporary,'source');
const site=join(temporary,'site');
try{
  await cp(root,source,{recursive:true,filter:path=>!['.git','node_modules','dist','.env'].includes(basename(path))&&!basename(path).startsWith('.env.')});
  await symlink(resolve(root,'node_modules'),join(source,'node_modules'),'dir');
  const original=await readFile(join(source,'index.html'),'utf8');
  const oldKey=original.match(/const SUPABASE_KEY='([^']+)';/)[1];
  await writeFile(join(source,'index.html'),validationEntry(original,config));
  execFileSync('npm',['run','build'],{cwd:source,stdio:'inherit'});
  async function scan(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=join(path,entry.name);
      if(entry.isDirectory()){await scan(file);continue;}
      const bytes=await readFile(file);
      if([...protectedRefs,oldKey,productionWorker].some(value=>bytes.includes(value)))throw Error('Protected backend or credential found in validation artifact: '+entry.name);
      const text=bytes.toString();
      if(/sb_secret_[A-Za-z0-9_-]{15,}/.test(text))throw Error('Secret key found in validation artifact');
      for(const match of text.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/g))if(match[1]!==config.ref)throw Error('Unexpected Supabase project in artifact');
    }
  }
  await scan(join(source,'dist'));
  await mkdir(site);
  await cp(join(source,'dist'),join(site,'freya-travel'),{recursive:true});
  await writeFile(join(site,'validation.json'),JSON.stringify({release:'v27',project_ref:config.ref,path:'/freya-travel/',built_at:new Date().toISOString()},null,2));
  console.log(`Validation site prepared: ${site}\nServe this directory over HTTPS; open /freya-travel/. Not deployed.`);
}catch(error){
  await rm(temporary,{recursive:true,force:true});
  throw error;
}finally{
  await rm(source,{recursive:true,force:true});
}
