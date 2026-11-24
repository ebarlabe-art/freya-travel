// Current legal tender by CLDR region (48.2.0, active on 2026-11-24).
// https://github.com/unicode-org/cldr-json/blob/48.2.0/cldr-json/cldr-core/supplemental/currencyData.json
/*
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2015-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
*/
const territoryCurrencies=new Map();
for(const group of [
  'AED:AE', 'AFN:AF', 'ALL:AL', 'AMD:AM', 'AOA:AO',
  'ARS:AR', 'AUD:AU CC CX HM KI NF NR TV', 'AWG:AW', 'AZN:AZ', 'BAM:BA',
  'BBD:BB', 'BDT:BD', 'BHD:BH', 'BIF:BI', 'BMD:BM',
  'BND:BN', 'BOB:BO', 'BRL:BR', 'BSD:BS', 'BTN INR:BT',
  'BWP:BW', 'BYN:BY', 'BZD:BZ', 'CAD:CA', 'CDF:CD',
  'CHF:CH LI', 'CLP:CL', 'CNY:CN', 'COP:CO', 'CRC:CR',
  'CUP:CU', 'CVE:CV', 'CZK:CZ', 'DJF:DJ', 'DKK:DK FO GL',
  'DOP:DO', 'DZD:DZ', 'EGP:EG', 'ERN:ER', 'ETB:ET',
  'EUR:AD AT AX BE BG BL CY DE EA EE ES EU FI FR GF GP GR HR IC IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT', 'FJD:FJ', 'FKP:FK', 'GBP:GB GG GS IM JE TA', 'GEL:GE',
  'GHS:GH', 'GIP:GI', 'GMD:GM', 'GNF:GN', 'GTQ:GT',
  'GYD:GY', 'HKD:HK', 'HNL:HN', 'HTG USD:HT', 'HUF:HU',
  'IDR:ID', 'ILS:IL', 'ILS JOD:PS', 'INR:IN', 'IQD:IQ',
  'IRR:IR', 'ISK:IS', 'JMD:JM', 'JOD:JO', 'JPY:JP',
  'KES:KE', 'KGS:KG', 'KHR:KH', 'KMF:KM', 'KPW:KP',
  'KRW:KR', 'KWD:KW', 'KYD:KY', 'KZT:KZ', 'LAK:LA',
  'LBP:LB', 'LKR:LK', 'LRD:LR', 'LYD:LY', 'MAD:EH MA',
  'MDL:MD', 'MGA:MG', 'MKD:MK', 'MMK:MM', 'MNT:MN',
  'MOP:MO', 'MRU:MR', 'MUR:MU', 'MVR:MV', 'MWK:MW',
  'MXN:MX', 'MYR:MY', 'MZN:MZ', 'NAD ZAR:NA', 'NGN:NG',
  'NIO:NI', 'NOK:BV NO SJ', 'NPR:NP', 'NZD:CK NU NZ PN TK', 'OMR:OM',
  'PAB USD:PA', 'PEN:PE', 'PGK:PG', 'PHP:PH', 'PKR:PK',
  'PLN:PL', 'PYG:PY', 'QAR:QA', 'RON:RO', 'RSD:RS',
  'RUB:RU', 'RWF:RW', 'SAR:SA', 'SBD:SB', 'SCR:SC',
  'SDG:SD', 'SEK:SE', 'SGD:SG', 'SHP:AC SH', 'SLE:SL',
  'SOS:SO', 'SRD:SR', 'SSP:SS', 'STN:ST', 'SYP:SY',
  'SZL:SZ', 'THB:TH', 'TJS:TJ', 'TMT:TM', 'TND:TN',
  'TOP:TO', 'TRY:TR', 'TTD:TT', 'TWD:TW', 'TZS:TZ',
  'UAH:UA', 'UGX:UG', 'USD:AS BQ DG EC FM GU IO MH MP PR PW SV TC TL UM US VG VI', 'UYU:UY', 'UZS:UZ',
  'VES:VE', 'VND:VN', 'VUV:VU', 'WST:WS', 'XAF:CF CG CM GA GQ TD',
  'XCD:AG AI DM GD KN LC MS VC', 'XCG:CW SX', 'XOF:BF BJ CI GW ML NE SN TG', 'XPF:NC PF WF', 'YER:YE',
  'ZAR:ZA', 'ZAR LSL:LS', 'ZMW:ZM', 'ZWG USD:ZW'
]){
  const [codes,territories]=group.split(':');
  const currencies=codes.split(' ');
  for(const territory of territories.split(' '))territoryCurrencies.set(territory,currencies);
}
const territorialCurrencyCodes=[...new Set([...territoryCurrencies.values()].flat())];

const currencyCode=value=>typeof value==='string'&&/^[A-Z]{3}$/.test(value);
const currencyCodes=codes=>[...new Set(codes.filter(currencyCode))];

export function usualCurrencyForLocale(locale){
  try{return territoryCurrencies.get(new Intl.Locale(locale).region)?.[0]||'EUR'}
  catch{return 'EUR'}
}

export function destinationCurrencies({trip,stops,zoneCurrency}){
  if(!stops.length){
    const code=trip.experience_key==='london-2026'?'GBP':zoneCurrency(trip);
    return code?[{name:'',codes:[code]}]:[];
  }
  return stops.map(stop=>{
    const country=String(stop.country_code||'').trim().toUpperCase();
    const codes=territoryCurrencies.get(country)||currencyCodes([zoneCurrency(stop)]);
    return {name:String(stop.canonical_name||stop.label||'').trim(),codes};
  });
}

export function manualCurrencyCodes(existing,destinations,snapshot){
  return currencyCodes([...existing,...destinations.flatMap(row=>row.codes),
    ...territorialCurrencyCodes,...Object.keys(snapshot?.rates||{})]);
}

export function parseConverterAmount(value){
  const trimmed=value.trim();
  if(trimmed.length>28||!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed))return null;
  const number=Number(trimmed.replace(',','.'));
  return Number.isFinite(number)?number:null;
}

export function exchangeRate(snapshot,from,to){
  if(!currencyCode(from)||!currencyCode(to))return null;
  if(from===to)return 1;
  const rate=snapshot?.rates[to]/snapshot?.rates[from];
  return Number.isFinite(rate)&&rate>0?rate:null;
}

export const RATE_ENDPOINT='https://open.er-api.com/v6/latest/EUR';
const CACHE_KEY='freya-currency-rates-v1';
const MAX_CLOCK_SKEW=5*60_000;
const MIN_RETRY_INTERVAL=60_000;
const RATE_LIMIT_RETRY_INTERVAL=20*MIN_RETRY_INTERVAL;

function validateSnapshot(value,now){
  if(!Number.isSafeInteger(value?.updatedAt)||value.updatedAt<=0||value.updatedAt>now+MAX_CLOCK_SKEW||
    !Number.isSafeInteger(value.nextUpdateAt)||value.nextUpdateAt<=value.updatedAt||
    value.nextUpdateAt-value.updatedAt>2*86_400_000||value.rates?.EUR!==1)return null;
  const rates=Object.fromEntries(Object.entries(value.rates).filter(([code,rate])=>
    currencyCode(code)&&Number.isFinite(rate)&&rate>0
  ));
  if(Object.keys(rates).length<2)return null;
  return {updatedAt:value.updatedAt,nextUpdateAt:value.nextUpdateAt,rates};
}

function providerSnapshot(value,now){
  if(value?.result!=='success'||value.base_code!=='EUR'||
    !Number.isSafeInteger(value.time_last_update_unix)||!Number.isSafeInteger(value.time_next_update_unix))return null;
  return validateSnapshot({
    updatedAt:value.time_last_update_unix*1000,
    nextUpdateAt:value.time_next_update_unix*1000,
    rates:value.rates
  },now);
}

export function createCurrencyRateStore({getStorage,fetchRates=fetch,now=Date.now}){
  let snapshot=null,pending=null,retryAt=0;

  function latest(){
    try{
      const stored=validateSnapshot(JSON.parse(getStorage().getItem(CACHE_KEY)),now());
      if(stored&&(!snapshot||stored.updatedAt>=snapshot.updatedAt))snapshot=stored;
    }catch{}
    return snapshot;
  }

  async function request(){
    retryAt=now()+MIN_RETRY_INTERVAL;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),7500);
    try{
      const response=await fetchRates(RATE_ENDPOINT,{
        signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-cache'
      });
      if(response.status===429)retryAt=now()+RATE_LIMIT_RETRY_INTERVAL;
      if(!response.ok)return latest();
      const received=providerSnapshot(await response.json(),now());
      const previous=latest();
      if(!received||previous&&received.updatedAt<previous.updatedAt)return previous;
      snapshot=received;
      try{getStorage().setItem(CACHE_KEY,JSON.stringify(snapshot))}catch{}
      return snapshot;
    }catch{return latest()}
    finally{clearTimeout(timer)}
  }

  function refresh(){
    const cached=latest();
    if(pending)return pending;
    if(cached?.nextUpdateAt>now()||retryAt>now())return Promise.resolve(cached);
    pending=request().finally(()=>{pending=null});
    return pending;
  }

  return {latest,refresh};
}
