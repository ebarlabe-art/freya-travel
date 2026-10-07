import { readFile, writeFile } from 'node:fs/promises';

const indexUrl=new URL('../index.html',import.meta.url);
const copyUrl=new URL('../404.html',import.meta.url);
const testUrl=new URL('./past-records-navigation.test.mjs',import.meta.url);

let html=await readFile(indexUrl,'utf8');
const from="  const preTrip=state.phase==='future'||state.phase==='setup';\n  if(home)home.classList.toggle('hidden',preTrip);\n  if(preTrip){";
const to="  const hideLiveHome=state.phase==='future'||state.phase==='setup'||state.phase==='past';\n  if(home)home.classList.toggle('hidden',hideLiveHome);\n  if(hideLiveHome){";
if(!html.includes(from))throw new Error('Live Home visibility anchor not found');
html=html.replace(from,to);
await writeFile(indexUrl,html);
await writeFile(copyUrl,html);

let test=await readFile(testUrl,'utf8');
const anchor="test('canonical roadmap keeps the four-stage product compass and defines Records',()=>{";
const added=`test('past trips never show the DURANT home block',()=>{
  assert.ok(html.includes("const hideLiveHome=state.phase==='future'||state.phase==='setup'||state.phase==='past'"));
  assert.ok(html.includes("home.classList.toggle('hidden',hideLiveHome)"));
});

`;
if(!test.includes(anchor))throw new Error('Test anchor not found');
test=test.replace(anchor,added+anchor);
await writeFile(testUrl,test);

console.log('Past trips now hide the DURANT home block.');
