import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createCurrencyRateStore,destinationCurrencies,exchangeRate,manualCurrencyCodes,
  parseConverterAmount,RATE_ENDPOINT,usualCurrencyForLocale} from '../domain/trip-currency.mjs';

const zoneCurrency=value=>({'Europe/London':'GBP','Europe/Madrid':'EUR','Asia/Tokyo':'JPY'})[value.time_zone]||'';
const destinations=(stops,trip={})=>destinationCurrencies({stops,trip,zoneCurrency});
const stop=(canonical_name,country_code,time_zone)=>({canonical_name,country_code,time_zone});
const nowBase=Date.parse('2026-11-24T12:00:00Z');
const oneDay=86_400_000;
const reply=(updatedAt=nowBase)=>({
  result:'success',base_code:'EUR',time_last_update_unix:updatedAt/1000,
  time_next_update_unix:(updatedAt+oneDay)/1000,
  rates:{EUR:1,GBP:.85,JPY:170,LKR:350,MVR:18,USD:1.17}
});
const storage=()=>{
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};

test('A5 detects destination currencies independently of expense and budget currencies',()=>{
  assert.deepEqual(destinations([],{experience_key:'london-2026',default_currency:'USD'}),[{name:'',codes:['GBP']}]);
  assert.deepEqual(destinations([stop('Riga','LV'),stop('Tallinn','EE')]),[
    {name:'Riga',codes:['EUR']},{name:'Tallinn',codes:['EUR']}
  ]);
  assert.deepEqual(destinations([stop('Tokyo','jp'),stop('Colombo','LK'),stop('Malé','MV')]),[
    {name:'Tokyo',codes:['JPY']},{name:'Colombo',codes:['LKR']},{name:'Malé',codes:['MVR']}
  ]);
  assert.deepEqual(destinations([stop('Eivissa','ES'),stop('Panamá','PA'),stop('Unknown','ZZ'),stop('Tokyo',null,'Asia/Tokyo')]),[
    {name:'Eivissa',codes:['EUR']},{name:'Panamá',codes:['PAB','USD']},{name:'Unknown',codes:[]},{name:'Tokyo',codes:['JPY']}
  ]);
  assert.deepEqual(destinations([]),[]);
  assert.equal(usualCurrencyForLocale('ca-ES'),'EUR');
  assert.equal(usualCurrencyForLocale('en-GB'),'GBP');
  assert.equal(usualCurrencyForLocale('fr-CA'),'CAD');
  assert.equal(usualCurrencyForLocale('en'),'EUR');
  assert.equal(usualCurrencyForLocale(undefined),'EUR');
  assert.ok(manualCurrencyCodes(['EUR'],destinations([stop('Malé','MV')]),{rates:{FOK:1}}).includes('FOK'));
});

test('A5 parses mobile decimal input, converts in both directions and handles equal or missing currencies',async()=>{
  const store=createCurrencyRateStore({getStorage:storage,now:()=>nowBase,fetchRates:async()=>Response.json(reply())});
  const snapshot=await store.refresh();
  assert.equal(parseConverterAmount(' 12,50 '),12.5);
  assert.equal(parseConverterAmount('0'),0);
  for(const invalid of ['',',','1e3','-1','1.000,01','1 000'])assert.equal(parseConverterAmount(invalid),null);
  assert.equal(exchangeRate(null,'EUR','EUR'),1);
  assert.equal(exchangeRate(snapshot,'EUR','GBP'),.85);
  assert.equal(exchangeRate(snapshot,'GBP','EUR')*.85,1);
  assert.equal(exchangeRate(snapshot,'EUR','JPY'),170);
  assert.equal(exchangeRate(snapshot,'EUR','LKR'),350);
  assert.equal(exchangeRate(snapshot,'EUR','MVR'),18);
  assert.equal(exchangeRate(snapshot,'LKR','MVR'),18/350);
  assert.equal(exchangeRate(snapshot,'EUR','KPW'),null);
  assert.equal(exchangeRate(snapshot,'','EUR'),null);
});

test('A5 deduplicates requests, stores provider timestamps, and reopens offline with the last valid quote',async()=>{
  const device=storage();
  let now=nowBase,requests=0;
  const rateStore=createCurrencyRateStore({getStorage:()=>device,now:()=>now,fetchRates:async(url,options)=>{
    requests++;
    assert.equal(url,RATE_ENDPOINT);
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(reply());
  }});
  const [first,second]=await Promise.all([rateStore.refresh(),rateStore.refresh()]);
  assert.equal(requests,1);
  assert.deepEqual(first,second);
  assert.equal(first.updatedAt,nowBase);
  assert.equal(first.nextUpdateAt,nowBase+oneDay);
  await rateStore.refresh();
  assert.equal(requests,1);
  const reopened=createCurrencyRateStore({getStorage:()=>device,now:()=>now,fetchRates:async()=>{
    requests++;throw new Error('offline');
  }});
  assert.deepEqual(reopened.latest(),first);
  now+=oneDay+1000;
  assert.deepEqual(await reopened.refresh(),first);
  assert.equal(requests,2);
  assert.equal(reopened.latest().updatedAt,nowBase);
});

test('A5 keeps the newest valid quote when responses are invalid, older or rate-limited',async()=>{
  const device=storage();
  let now=nowBase,response=Response.json(reply()),requests=0;
  const store=createCurrencyRateStore({getStorage:()=>device,now:()=>now,fetchRates:async()=>{
    requests++;return response;
  }});
  const first=await store.refresh();
  now+=oneDay+1000;
  response=Response.json({...reply(now),rates:{EUR:2,GBP:.82}});
  assert.deepEqual(await store.refresh(),first);
  now+=60_000;
  response=Response.json(reply(nowBase-1000));
  assert.deepEqual(await store.refresh(),first);
  now+=60_000;
  response=new Response(null,{status:429});
  assert.deepEqual(await store.refresh(),first);
  now+=60_000;
  assert.deepEqual(await store.refresh(),first);
  assert.equal(requests,4);
  now+=20*60_000;
  response=Response.json(reply(now));
  const updated=await store.refresh();
  assert.equal(updated.updatedAt,now);
  assert.equal(requests,5);
});

test('A5 localizes every interface label with the same chosen languages as A4.2',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const script=html.match(/<script id="freyaCurrencyTranslations">([\s\S]*?)<\/script>/)[1];
  const keys=Array.from(html.matchAll(/data-currency-text="(\w+)"/g),([,key])=>key);
  for(const [insightsLanguage,title] of Object.entries({ca:'Moneda i canvi de divisa',es:'Moneda y cambio de divisas',
    en:'Currency and exchange rates',fr:'Devises et taux de change',it:'Valute e tassi di cambio'})){
    const nodes=keys.map(key=>({dataset:{currencyText:key}}));
    const root={querySelectorAll:()=>nodes};
    const swap={setAttribute(key,value){this[key]=value}};
    const document={querySelectorAll:()=>[root],getElementById:()=>swap};
    const messages=runInNewContext(script+'\ncurrencyCopy', {insightsLanguage,document});
    assert.equal(root.lang,insightsLanguage);
    assert.equal(messages.title,title);
    assert.equal(swap['aria-label'],messages.swap);
    for(const node of nodes)assert.ok(node.textContent);
    for(const key of ['choose','other','unknown','same','loading','offline','offlineEmpty','stale','unavailable','openError']){
      assert.ok(messages[key],insightsLanguage+': '+key);
    }
  }
});
