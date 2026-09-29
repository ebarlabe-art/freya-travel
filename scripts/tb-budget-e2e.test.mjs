import test from 'node:test';
import assert from 'node:assert/strict';
import {saveComponentCost,confirmComponentWithCost,loadBudget,findTbComponent} from '../domain/tb-budget.mjs';

function statefulClient(){
  const state={
    links:new Map([
      ['activity:activity-1','activity-1'],
      ['flight:flight-1','flight-1']
    ]),
    costs:new Map(),
    confirmations:new Map(),
    operations:new Map()
  };
  const budget=tripId=>{
    const rows=[...state.costs.values()].filter(x=>x.trip_id===tripId);
    const grouped=new Map();
    for(const row of rows){
      const amount=row.confirmed_amount ?? row.expected_amount;
      if(amount==null)continue;
      const key=row.currency;
      const g=grouped.get(key)||{currency:key,total:0,confirmed_total:0,expected_total:0,priced_components:0,confirmed_components:0,expected_components:0};
      g.total+=amount;g.priced_components++;
      if(row.confirmed_amount!=null){g.confirmed_total+=amount;g.confirmed_components++}
      else{g.expected_total+=amount;g.expected_components++}
      grouped.set(key,g);
    }
    const unknown=[...state.links.values()].filter(id=>!state.costs.has(id)).length;
    const unknownRequired=rows.reduce((n,row)=>n+(row.unknown_required_costs?.length||0),0);
    return {trip_id:tripId,settings:null,currencies:[...grouped.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),total_components:state.links.size,unknown_components:unknown,unknown_required_costs:unknownRequired,provisional:unknown>0||unknownRequired>0};
  };
  const client={
    state,
    from(table){
      assert.equal(table,'trip_proposal_component_links');
      const filters={};
      return {
        select(){return this},
        eq(k,v){filters[k]=v;return this},
        async maybeSingle(){
          const sourceKind=filters.activity_id?'activity':filters.flight_id?'flight':'accommodation';
          const sourceId=filters.activity_id||filters.flight_id||filters.accommodation_id;
          const componentId=state.links.get(sourceKind+':'+sourceId)||null;
          return {data:componentId?{component_id:componentId}:null,error:null};
        }
      };
    },
    async rpc(name,args){
      if(name==='set_trip_component_cost_v1'){
        const opKey='cost:'+args.p_operation_id;
        const request=JSON.stringify(args);
        if(state.operations.has(opKey)){
          assert.equal(state.operations.get(opKey).request,request,'same operation id must carry identical request');
          return {data:{...state.operations.get(opKey).result,replayed:true},error:null};
        }
        const previous=state.costs.get(args.p_component_id);
        assert.equal(previous?.revision||0,args.p_expected_revision,'cost revision conflict');
        const result={
          trip_id:args.p_trip_id,component_id:args.p_component_id,
          expected_amount:args.p_expected_amount,confirmed_amount:args.p_confirmed_amount,
          currency:args.p_currency,expected_quality:args.p_expected_quality,
          unknown_required_costs:args.p_unknown_required_costs,excluded_costs:args.p_excluded_costs,
          revision:(previous?.revision||0)+1,replayed:false
        };
        state.costs.set(args.p_component_id,result);
        state.operations.set(opKey,{request,result});
        return {data:result,error:null};
      }
      if(name==='confirm_trip_component_with_cost_v1'){
        const opKey='confirm:'+args.p_operation_id;
        const request=JSON.stringify(args);
        if(state.operations.has(opKey)){
          assert.equal(state.operations.get(opKey).request,request,'confirmation replay must be exact');
          return {data:{...state.operations.get(opKey).result,replayed:true},error:null};
        }
        const previous=state.costs.get(args.p_component_id);
        assert.equal(previous?.revision||0,args.p_cost_expected_revision,'confirmation must use current cost revision');
        const confirmation={component_id:args.p_component_id,status:'confirmed',confirmation_source:'user_manual',evidence_document_id:args.p_evidence_document_id,evidence_role:args.p_evidence_role};
        state.confirmations.set(args.p_component_id,confirmation);
        const cost={
          trip_id:args.p_trip_id,component_id:args.p_component_id,
          expected_amount:args.p_expected_amount,confirmed_amount:args.p_confirmed_amount,
          currency:args.p_currency,expected_quality:args.p_expected_quality,
          unknown_required_costs:args.p_unknown_required_costs,excluded_costs:args.p_excluded_costs,
          revision:(previous?.revision||0)+1,replayed:false
        };
        state.costs.set(args.p_component_id,cost);
        const result={...confirmation,cost};
        state.operations.set(opKey,{request,result});
        return {data:result,error:null};
      }
      if(name==='get_trip_budget_v1')return {data:budget(args.p_trip_id),error:null};
      throw Error('Unexpected RPC '+name);
    }
  };
  return client;
}

test('TB-06 E2E: expected -> confirmed replaces amount, same component, replay idempotent, currencies stay separate',async()=>{
  const client=statefulClient();
  const activityComponent=await findTbComponent(client,{tripId:'trip',sourceKind:'activity',sourceId:'activity-1'});
  assert.equal(activityComponent,'activity-1');

  const planned=await saveComponentCost(client,{
    tripId:'trip',componentId:activityComponent,expectedRevision:0,
    expectedAmount:120,confirmedAmount:null,currency:'EUR',expectedQuality:'estimated',
    scope:{description:'2 people'},unknownRequiredCosts:[],excludedCosts:[],operationId:'cost-plan'
  });
  assert.equal(planned.revision,1);

  let budget=await loadBudget(client,'trip');
  assert.equal(budget.currencies.find(x=>x.currency==='EUR').total,120);
  assert.equal(budget.currencies.find(x=>x.currency==='EUR').expected_total,120);

  const confirmed=await confirmComponentWithCost(client,{
    tripId:'trip',componentId:activityComponent,expectedUpdatedAt:'source-v1',
    evidenceDocumentId:'ticket-doc',evidenceRole:'ticket',
    costExpectedRevision:1,expectedAmount:120,confirmedAmount:100,currency:'EUR',
    expectedQuality:'estimated',scope:{description:'2 people'},
    unknownRequiredCosts:[],excludedCosts:[],costEvidenceDocumentId:'ticket-doc',
    operationId:'confirm-activity'
  });
  assert.equal(confirmed.status,'confirmed');
  assert.equal(confirmed.confirmation_source,'user_manual');
  assert.equal(client.state.costs.size,1,'confirmation updates the same component cost');
  assert.equal(client.state.confirmations.size,1,'one manual confirmation only');

  budget=await loadBudget(client,'trip');
  const eur=budget.currencies.find(x=>x.currency==='EUR');
  assert.equal(eur.total,100,'confirmed replaces expected; 120 + 100 must never be summed');
  assert.equal(eur.confirmed_total,100);
  assert.equal(eur.expected_total,0);

  const replay=await confirmComponentWithCost(client,{
    tripId:'trip',componentId:activityComponent,expectedUpdatedAt:'source-v1',
    evidenceDocumentId:'ticket-doc',evidenceRole:'ticket',
    costExpectedRevision:1,expectedAmount:120,confirmedAmount:100,currency:'EUR',
    expectedQuality:'estimated',scope:{description:'2 people'},
    unknownRequiredCosts:[],excludedCosts:[],costEvidenceDocumentId:'ticket-doc',
    operationId:'confirm-activity'
  });
  assert.equal(replay.replayed,true);
  assert.equal(client.state.costs.size,1);
  assert.equal(client.state.confirmations.size,1);

  const flightComponent=await findTbComponent(client,{tripId:'trip',sourceKind:'flight',sourceId:'flight-1'});
  await saveComponentCost(client,{
    tripId:'trip',componentId:flightComponent,expectedRevision:0,
    expectedAmount:40,confirmedAmount:40,currency:'GBP',expectedQuality:'verified',
    verifiedAt:'2026-09-29T10:00:00.000Z',scope:{description:'whole booking'},
    unknownRequiredCosts:['seat fee unknown'],excludedCosts:[],operationId:'cost-flight'
  });

  budget=await loadBudget(client,'trip');
  assert.deepEqual(budget.currencies.map(x=>[x.currency,x.total]),[['EUR',100],['GBP',40]]);
  assert.equal(budget.unknown_required_costs,1);
  assert.equal(budget.provisional,true);
});
