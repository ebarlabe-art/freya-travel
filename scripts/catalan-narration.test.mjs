import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),code=html.slice(html.indexOf('let catalanNarration='),html.indexOf('function speakGuide('));
function harness(voices=[{lang:'ca-ES',name:'Synthetic Catalan',localService:true}]){
 const spoken=[],synth={getVoices:()=>voices,cancel(){this.cancelled=true},pause(){this.paused=true},resume(){this.paused=false},speak(u){spoken.push(u);u.onstart?.()}};
 const c=vm.createContext({window:{speechSynthesis:synth},speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},console});vm.runInContext(code,c);return {c,synth,spoken};
}
test('shared London engine reads the whole guide in chunks without the #169 1800-character truncation',()=>{
 const {c,spoken}=harness(),text='Una història cultural en català. '.repeat(150);let ended=0;
 assert.equal(c.narrateCatalan(text,{onEnd:()=>ended++}),true);for(let i=0;i<spoken.length;i++)spoken[i].onend();
 assert.equal(spoken.map(u=>u.text).join(''),text.trim());assert.ok(spoken.every(u=>u.text.length<=500&&u.lang==='ca-ES'));assert.equal(ended,1);
});
test('pause, resume, stop and speed reject stale callbacks from replaced fragments',()=>{
 const {c,synth,spoken}=harness();let end=0;c.narrateCatalan('First text',{onEnd:()=>end++});c.pauseCatalanNarration();assert.equal(synth.paused,true);c.resumeCatalanNarration();assert.equal(synth.paused,false);
 const old=spoken[0];c.rateCatalanNarration(1.15);assert.equal(spoken[1].rate,1.15);old.onend();assert.equal(end,0);c.stopCatalanNarration();spoken[1].onend();assert.equal(end,0);
});
test('no Catalan voice requires explicit fallback; unsupported device keeps written text',()=>{
 const {c,spoken}=harness([{lang:'es-ES'}]);assert.equal(c.narrateCatalan('Text'),false);assert.equal(spoken.length,0);let fallback=false;
 assert.equal(c.narrateCatalan('Text',{allowFallback:true,onStart:s=>fallback=s.fallback}),true);assert.equal(fallback,true);
 const unsupported=vm.createContext({window:{}});vm.runInContext(code,unsupported);assert.equal(unsupported.narrateCatalan('Text'),false);
});
