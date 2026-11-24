import {createCurrencyRateStore,destinationCurrencies,exchangeRate,manualCurrencyCodes,
  parseConverterAmount,usualCurrencyForLocale} from './trip-currency.mjs';

export function mountTripCurrency(root,{copy,language,preferredLocale,existing,common,zoneCurrency,getStorage}){
  const {ownerDocument:doc}=root;
  const get=id=>doc.getElementById(id);
  const home=get('currencyUsual'),local=get('currencyLocal'),amount=get('currencyAmount'),swap=get('currencySwap');
  const quote=get('currencyQuote'),status=get('currencyStatus'),refresh=get('currencyRefresh');
  const rateStore=createCurrencyRateStore({getStorage});
  const locale=intlLocale(language,preferredLocale);
  const decimal=new Intl.NumberFormat(locale,{useGrouping:false,maximumFractionDigits:10});
  const rateFormat=new Intl.NumberFormat(locale,{maximumSignificantDigits:6});
  const dateFormat=new Intl.DateTimeFormat(locale,{timeZone:'UTC',timeZoneName:'short',year:'numeric',
    month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const currencyNames=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(locale,{type:'currency'}):null;
  const currencyName=code=>currencyNames?.of(code)||code;
  const online=()=>doc.defaultView.navigator.onLine!==false;
  let state=null;

  function buildCurrencyOptions(select,first,groupName,values,selected){
    const option=code=>{
      const name=currencyName(code);
      return new Option(name===code?code:code+' · '+name,code);
    };
    const group=(label,codes)=>{
      const node=doc.createElement('optgroup');node.label=label;
      node.append(...codes.map(code=>option(code)));return node;
    };
    const others=values.filter(code=>!first.includes(code)).sort();
    const placeholder=new Option(copy.choose,'');
    placeholder.disabled=true;
    select.replaceChildren(placeholder);
    if(first.length&&groupName)select.append(group(groupName,first));
    else select.append(...first.map(code=>option(code)));
    if(others.length)select.append(group(copy.other,others));
    select.value=selected;
  }

  function populateCurrencies(snapshot){
    const codes=manualCurrencyCodes(existing,state.destinations,snapshot);
    const signature=codes.join(' ');
    if(signature===state.options)return;
    state.options=signature;
    buildCurrencyOptions(home,[...common],null,codes,state.usual);
    buildCurrencyOptions(local,state.localCodes,copy.destinations,codes,state.local);
  }

  function pair(){
    return state.reversed?[state.local,state.usual]:[state.usual,state.local];
  }

  function render(){
    if(!state?.current())return;
    const snapshot=rateStore.latest();
    populateCurrencies(snapshot);
    const [from,to]=pair();
    const rate=exchangeRate(snapshot,from,to);
    const same=!!from&&from===to;
    const needsRate=!!from&&!!to&&!same;
    const input=parseConverterAmount(amount.value);
    const value=input===null||rate===null?null:input*rate;
    const invalid=amount.value.trim()!==''&&input===null;
    const stale=!!snapshot&&snapshot.nextUpdateAt<=Date.now();
    const showQuote=needsRate&&rate!==null;
    const connected=online();

    get('currencyFromCode').textContent=from;
    get('currencyResult').textContent=Number.isFinite(value)
      ?new Intl.NumberFormat(locale,{style:'currency',currency:to,currencyDisplay:'code'}).format(value):'—';
    amount.setAttribute('aria-invalid',String(invalid));
    get('currencyAmountError').classList.toggle('hidden',!invalid);
    swap.disabled=!needsRate;
    quote.classList.toggle('hidden',!showQuote);
    if(showQuote){
      get('currencyRate').textContent='1 '+from+' = '+rateFormat.format(rate)+' '+to;
      const time=get('currencyRateTime');
      time.dateTime=new Date(snapshot.updatedAt).toISOString();
      time.textContent=dateFormat.format(snapshot.updatedAt);
    }
    status.textContent=same?copy.same:!needsRate?'':!connected?(showQuote?copy.offline:copy.offlineEmpty):
      state.loading?copy.loading:showQuote?(stale?copy.stale:''):copy.unavailable;
    status.classList.toggle('hidden',!status.textContent);
    refresh.disabled=state.loading;
    refresh.classList.toggle('hidden',!connected||!needsRate||!!snapshot&&!stale);
  }

  async function update(){
    if(!state?.current())return;
    const active=state;
    const [from,to]=pair();
    const cached=rateStore.latest();
    const needsRefresh=from&&to&&from!==to&&online()&&!(cached?.nextUpdateAt>Date.now());
    if(!needsRefresh||active.loading){render();return}
    active.loading=true;render();
    try{await rateStore.refresh()}
    finally{active.loading=false;if(state===active)render()}
  }

  home.onchange=()=>{
    if(!state?.current())return;
    state.usual=home.value;
    try{if(state.usual)getStorage().setItem(state.preferenceKey,state.usual)}catch{}
    void update();
  };
  local.onchange=()=>{
    if(!state?.current())return;
    state.local=local.value;
    void update();
  };
  amount.oninput=render;
  swap.onclick=()=>{
    if(!state?.current()||swap.disabled)return;
    const input=parseConverterAmount(amount.value),[from,to]=pair();
    const rate=exchangeRate(rateStore.latest(),from,to);
    if(input!==null&&rate!==null&&Number.isFinite(input*rate))amount.value=decimal.format(input*rate);
    state.reversed=!state.reversed;
    render();
  };
  refresh.onclick=()=>void update();
  for(const event of ['online','offline','pageshow'])doc.defaultView.addEventListener(event,()=>void update());
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)void update()});

  function open({trip,stops,userId,current}){
    if(!state||state.tripId!==trip.id||state.userId!==userId){
      const destinations=destinationCurrencies({trip,stops,zoneCurrency});
      const localCodes=[...new Set(destinations.flatMap(row=>row.codes))];
      const preferenceKey='freya-currency-usual-v1:'+userId;
      let usual=usualCurrencyForLocale(preferredLocale);
      try{
        const saved=getStorage().getItem(preferenceKey);
        if(/^[A-Z]{3}$/.test(saved||''))usual=saved;
      }catch{}
      state={tripId:trip.id,userId,destinations,localCodes,preferenceKey,usual,local:localCodes[0]||'',reversed:false};
      amount.value='100';
      const list=get('currencyDestinations');
      list.replaceChildren(...destinations.map(({name,codes})=>{
        const item=doc.createElement('li');
        const label=doc.createElement('strong');
        label.textContent=codes.length?codes.join(' · '):copy.unknown;
        if(name)item.append(name+' · ');
        item.append(label);return item;
      }));
      list.classList.toggle('hidden',!destinations.length);
      get('currencyNoDestinations').classList.toggle('hidden',!!destinations.length);
    }
    state.current=current;
    void update();
  }

  return {open,reset:()=>{state=null}};
}

function intlLocale(language,preferredLocale){
  try{
    const locale=new Intl.Locale(preferredLocale);
    if(locale.language===language)return locale.toString();
  }catch{}
  return language;
}
