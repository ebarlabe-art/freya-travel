import test from 'node:test';
import assert from 'node:assert/strict';
import {projectBuild} from '../domain/tb-build.mjs';

const links=[
 {component_id:'flight_a',flight_id:'f1',accommodation_id:null,activity_id:null},
 {component_id:'hotel_a',flight_id:null,accommodation_id:'h1',activity_id:null},
 {component_id:'activity_a',flight_id:null,accommodation_id:null,activity_id:'a1'},
];
test('TB-08.1 projection keeps operational state separate from price state',()=>{
 const p=projectBuild({
  links,
  flights:[{id:'f1',airline:'Air Test',flight_number:'AT1',departure_airport_code:'BCN',arrival_airport_code:'RIX',flight_status:'planning',notes:'Vol proposat'}],
  accommodations:[{id:'h1',name:'Hotel Test',reservation_status:'confirmed',notes:'Centre'}],
  activities:[{id:'a1',title:'Museu',reservation_status:'reserved',notes:'Visita'}],
  costs:[
   {component_id:'flight_a',expected_amount:120,confirmed_amount:null,currency:'EUR',unknown_required_costs:[],excluded_costs:[]},
   {component_id:'hotel_a',expected_amount:300,confirmed_amount:280,currency:'EUR',unknown_required_costs:[],excluded_costs:[]},
  ],
  budget:{currencies:[{currency:'EUR',total:400}],settings:null,total_components:3,unknown_components:1,unknown_required_costs:0,provisional:true},
 });
 assert.equal(p.components[0].status.key,'planning');
 assert.equal(p.components[0].price_state.key,'expected');
 assert.deepEqual(p.components[0].price,{amount:120,currency:'EUR'});
 assert.equal(p.components[1].status.key,'confirmed');
 assert.equal(p.components[1].price_state.key,'confirmed');
 assert.equal(p.components[2].status.key,'reserved');
 assert.equal(p.components[2].price_state.key,'unknown');
 assert.deepEqual(p.groups.map(g=>g.key),['transport','accommodation','activity']);
});
test('TB-08.1 never manufactures selected/options-found states before later phases',()=>{
 const p=projectBuild({links,flights:[{id:'f1',flight_status:'planning'}],accommodations:[{id:'h1',reservation_status:'planning'}],activities:[{id:'a1',reservation_status:'planning'}]});
 assert.ok(p.components.every(c=>!['selected','options_found'].includes(c.status.key)));
 assert.equal(p.counts.pending,3);
});
test('cancelled and unknown cost are explicit',()=>{
 const p=projectBuild({links:[links[2]],activities:[{id:'a1',title:'Pla',reservation_status:'cancelled'}]});
 assert.equal(p.components[0].status.key,'cancelled');
 assert.equal(p.components[0].price_state.label,'Preu pendent');
 assert.equal(p.budget.provisional,true);
});
