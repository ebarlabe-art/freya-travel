import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linesToItems,
  saveComponentCost,
  confirmComponentWithCost,
  loadBudget,
  saveBudgetSettings,
  findTbComponent
} from '../domain/tb-budget.mjs';

function rpcClient(handler){
  return {rpc:async(name,args)=>handler(name,args)};
}

test('linesToItems trims blanks and caps at 20 items',()=>{
  const input=['  tax  ','',' baggage ','fees',...Array.from({length:30},(_,i)=>'x'+i)].join('\n');
  const out=linesToItems(input);
  assert.deepEqual(out.slice(0,3),['tax','baggage','fees']);
  assert.equal(out.length,20);
});

test('saveComponentCost preserves expected and confirmed as separate fields',async()=>{
  const calls=[];
  const client=rpcClient(async(name,args)=>{calls.push([name,args]);return {data:{revision:4},error:null}});
  await saveComponentCost(client,{
    tripId:'trip',componentId:'component',expectedRevision:3,expectedAmount:120,
    confirmedAmount:100,currency:'EUR',expectedQuality:'verified',
    verifiedAt:'2026-09-29T10:00:00.000Z',scope:{description:'total group'},
    unknownRequiredCosts:['city tax'],excludedCosts:['meals'],evidenceDocumentId:'doc',
    operationId:'op'
  });
  assert.equal(calls.length,1);
  const [name,args]=calls[0];
  assert.equal(name,'set_trip_component_cost_v1');
  assert.equal(args.p_expected_amount,120);
  assert.equal(args.p_confirmed_amount,100);
  assert.equal(args.p_currency,'EUR');
  assert.equal(args.p_expected_revision,3);
  assert.deepEqual(args.p_unknown_required_costs,['city tax']);
  assert.deepEqual(args.p_excluded_costs,['meals']);
  assert.equal(args.p_operation_id,'op');
});

test('confirmComponentWithCost is one atomic RPC and preserves TB-05 evidence contract',async()=>{
  const calls=[];
  const client=rpcClient(async(name,args)=>{calls.push([name,args]);return {data:{status:'confirmed'},error:null}});
  await confirmComponentWithCost(client,{
    tripId:'trip',componentId:'component',expectedUpdatedAt:'v1',
    expectedEvidenceDocumentId:'old-doc',evidenceDocumentId:'new-doc',evidenceRole:'ticket',
    costExpectedRevision:2,expectedAmount:80,confirmedAmount:75,currency:'EUR',
    expectedQuality:'estimated',scope:{description:'2 people'},unknownRequiredCosts:[],
    excludedCosts:['transport'],costEvidenceDocumentId:'new-doc',operationId:'op-confirm'
  });
  assert.equal(calls.length,1);
  const [name,args]=calls[0];
  assert.equal(name,'confirm_trip_component_with_cost_v1');
  assert.equal(args.p_expected_evidence_document_id,'old-doc');
  assert.equal(args.p_evidence_document_id,'new-doc');
  assert.equal(args.p_evidence_role,'ticket');
  assert.equal(args.p_confirmed_amount,75);
  assert.equal(args.p_cost_expected_revision,2);
  assert.equal(args.p_cost_evidence_document_id,'new-doc');
  assert.equal(args.p_operation_id,'op-confirm');
});

test('loadBudget returns server-derived totals without client recomputation',async()=>{
  const payload={
    total_components:3,unknown_components:1,unknown_required_costs:1,provisional:true,
    currencies:[
      {currency:'EUR',total:175,confirmed_total:75,expected_total:100},
      {currency:'GBP',total:40,confirmed_total:40,expected_total:0}
    ]
  };
  const client=rpcClient(async(name,args)=>{
    assert.equal(name,'get_trip_budget_v1');
    assert.deepEqual(args,{p_trip_id:'trip'});
    return {data:payload,error:null};
  });
  assert.equal(await loadBudget(client,'trip'),payload);
});

test('budget settings keep target and maximum separate and require no FX logic client-side',async()=>{
  let seen;
  const client=rpcClient(async(name,args)=>{seen=[name,args];return {data:{revision:2},error:null}});
  await saveBudgetSettings(client,{
    tripId:'trip',expectedRevision:1,targetAmount:1000,maximumAmount:1200,currency:'EUR',operationId:'op-budget'
  });
  assert.equal(seen[0],'set_trip_budget_settings_v1');
  assert.equal(seen[1].p_target_amount,1000);
  assert.equal(seen[1].p_maximum_amount,1200);
  assert.equal(seen[1].p_currency,'EUR');
});

test('findTbComponent maps each operational source to the correct component link column',async()=>{
  for(const [kind,column] of [['accommodation','accommodation_id'],['flight','flight_id'],['activity','activity_id']]){
    const seen=[];
    const q={
      select(){seen.push(['select']);return this},
      eq(key,value){seen.push(['eq',key,value]);return this},
      async maybeSingle(){return {data:{component_id:'c-'+kind},error:null}}
    };
    const client={from(table){assert.equal(table,'trip_proposal_component_links');return q}};
    assert.equal(await findTbComponent(client,{tripId:'t',sourceKind:kind,sourceId:'s'}),'c-'+kind);
    assert.deepEqual(seen.filter(x=>x[0]==='eq'),[['eq','trip_id','t'],['eq',column,'s']]);
  }
});
