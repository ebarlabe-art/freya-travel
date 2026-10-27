import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// BOL-01: test the actual session handler used by the installed PWA, not a
// second implementation of the navigation rules.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function renderSession(next){');
const end=html.indexOf('const LONDON_CHECKLIST_CATEGORIES=',start);
assert.ok(start>0&&end>start,'renderSession boundary exists');
const code=html.slice(start,end);

function harness({coldStart=false,offlineOnly=false,tripVisible=true}={}){
  const calls=[],hidden=new Set(tripVisible?[]:['tripView']);
  const nodes=new Map();
  const $=id=>{
    if(!nodes.has(id))nodes.set(id,{
      textContent:'',value:'',classList:{
        contains:key=>key==='hidden'&&hidden.has(id),
        add:key=>{if(key==='hidden')hidden.add(id)},
        remove:key=>{if(key==='hidden')hidden.delete(id)}
      }
    });
    return nodes.get(id);
  };
  const mark=name=>(...args)=>{calls.push([name,...args])};
  const ctx=vm.createContext({
    console,session:{user:{id:'eva',email:'old@example.test'},...(offlineOnly?{offlineOnly:true}:{})},
    trip:{id:'bolonya'},trips:[{id:'bolonya'}],sessionRenderGeneration:2,
    tripLoadGeneration:3,lastAuthenticatedUserId:'eva',
    coldStartNavigationPending:coldStart,passwordRecoveryMode:false,
    pendingInitialRoute:null,documentViewerOpenSequence:8,
    genericItinerarySelectedDay:'2026-10-24',
    $,
    hide:id=>{calls.push(['hide',id]);hidden.add(id)},
    show:id=>{calls.push(['show',id]);hidden.delete(id)},
    closeItineraryImport:mark('closeItineraryImport'),
    resetBuilderUi:mark('resetBuilderUi'),
    clearParkingReservationPreview:mark('clearParkingReservationPreview'),
    clearNavigationState:mark('clearNavigationState'),
    clearDocumentsReturnContext:mark('clearDocumentsReturnContext'),
    clearAccommodationVoucherFocus:mark('clearAccommodationVoucherFocus'),
    clearGenericItineraryState:mark('clearGenericItineraryState'),
    renderPasswordRecovery:mark('renderPasswordRecovery'),
    stopLondonFlightTimer:mark('stopLondonFlightTimer'),
    clearTripScopedState:mark('clearTripScopedState'),
    resetAccommodationFormUi:mark('resetAccommodationFormUi'),
    disconnectTripRealtime:async()=>{calls.push(['disconnectTripRealtime'])},
    refreshTrips:async args=>{calls.push(['refreshTrips',args.coldStart]);return true},
    window:{freyaBoot:{ready:mark('ready')},speechSynthesis:{cancel:mark('cancel')}},
    history:{replaceState:mark('replaceState')},
    builderHistory:()=>({view:'tripsHomeView'}),
    setAppView:mark('setAppView'),leaveBuilderPointer:mark('leaveBuilderPointer'),
    msg:mark('msg'),connectionUnavailable:()=>false
  });
  vm.runInContext(code,ctx);
  return {ctx,$,calls,hidden};
}

test('auth token refresh for the same account preserves itinerary, day, viewer, and scroll context',async()=>{
  const h=harness(),before=h.ctx.trip,previousGeneration=h.ctx.tripLoadGeneration;
  const next={user:{id:'eva',email:'new@example.test'},access_token:'renewed'};
  await h.ctx.renderSession(next);
  assert.equal(h.ctx.session,next);
  assert.equal(h.ctx.trip,before);
  assert.equal(h.ctx.tripLoadGeneration,previousGeneration);
  assert.equal(h.ctx.sessionRenderGeneration,2);
  assert.equal(h.ctx.documentViewerOpenSequence,8);
  assert.equal(h.ctx.genericItinerarySelectedDay,'2026-10-24');
  assert.equal(h.$('userEmail1').textContent,'new@example.test');
  assert.equal(h.hidden.has('tripView'),false);
  assert.deepEqual(h.calls,[]);
});

test('cold startup still starts at Home, even when a prior account identity is present',async()=>{
  const h=harness({coldStart:true});
  await h.ctx.renderSession({user:{id:'eva',email:'eva@example.test'}});
  assert.equal(h.ctx.coldStartNavigationPending,false);
  assert.ok(h.calls.some(call=>call[0]==='refreshTrips'&&call[1]===true));
  assert.ok(h.calls.some(call=>call[0]==='setAppView'&&call[1]==='tripsHomeView'));
});

test('account change takes the full isolated reinitialization path',async()=>{
  const h=harness();
  await h.ctx.renderSession({user:{id:'other',email:'other@example.test'}});
  assert.ok(h.calls.some(call=>call[0]==='clearNavigationState'&&call[1]==='eva'));
  assert.ok(h.calls.some(call=>call[0]==='clearGenericItineraryState'));
  assert.ok(h.calls.some(call=>call[0]==='refreshTrips'));
  assert.equal(h.ctx.session.user.id,'other');
});

test('offline-only to authenticated transition is not bypassed by the live-screen guard',async()=>{
  const h=harness({offlineOnly:true});
  await h.ctx.renderSession({user:{id:'eva',email:'eva@example.test'},access_token:'verified'});
  assert.ok(h.calls.some(call=>call[0]==='refreshTrips'));
});

test('explicit logout still clears the current trip and shows authentication',async()=>{
  const h=harness();
  await h.ctx.renderSession(null);
  assert.equal(h.ctx.session,null);
  assert.equal(h.ctx.trip,null);
  assert.ok(h.calls.some(call=>call[0]==='clearTripScopedState'));
  assert.ok(h.calls.some(call=>call[0]==='show'&&call[1]==='auth'));
});
