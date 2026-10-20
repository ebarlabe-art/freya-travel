import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePointCandidates,pointCandidateDescription} from '../domain/itinerary-place-points-ui.mjs';

const place=(name,id,lat=44.49,lon=11.34,extra={})=>({
 canonical_name:name,provider_place_id:id,latitude:lat,longitude:lon,
 country_code:'IT',locality:'Bologna',coordinate_role:'exact_location',
 formatted_address:name+', Piazza San Domenico, 40124 Bologna BO, Italia',
 ...extra
});

test('Bologna: nearby same-name basilica records appear once, but different basilicas remain',()=>{
 const sanDomenico=place('Basilica di San Domenico','domenico-one');
 const duplicate=place('Basilica di San Domenico','domenico-two',44.49015,11.34012,{
  formatted_address:'Basilica di San Domenico, 40125 Bologna BO, Italia'
 });
 const petronio=place('Basilica di San Petronio','petronio');
 const stefano=place('Basilica di Santo Stefano','stefano');
 const candidates=[sanDomenico,duplicate,petronio,stefano];
 const before=structuredClone(candidates);
 const shown=visiblePointCandidates(candidates);
 assert.deepEqual(shown,[sanDomenico,petronio,stefano]);
 assert.equal(shown[0],sanDomenico,'keeps original verified candidate; display only');
 assert.deepEqual(candidates,before,'does not mutate original provider response');
});

test('same names remain separate if geographically distant or from different cities/countries',()=>{
 const base=place('Basilica di San Domenico','one');
 const far=place('Basilica di San Domenico','two',44.492,11.34);
 const otherCity=place('Basilica di San Domenico','three',44.49001,11.34001,{locality:'Modena'});
 const otherCountry=place('Basilica di San Domenico','four',44.49001,11.34001,{country_code:'SM'});
 assert.deepEqual(visiblePointCandidates([base,far,otherCity,otherCountry]),[base,far,otherCity,otherCountry]);
});

test('accent variants and identical provider IDs collapse without hiding other named sights',()=>{
 const original=place('Basílica de Sant Petroni','same-id');
 const repeat=place('Basilica de Sant Petroni','same-id',44.492,11.343);
 const distinct=place('Basilica di Santo Stefano','steph',44.49,11.34);
 assert.deepEqual(visiblePointCandidates([original,repeat,distinct]),[original,distinct]);
});

test('mobile candidate subtitle prioritizes a short address and shows precision',()=>{
 const basilica=place('Basilica di San Domenico','d');
 assert.equal(pointCandidateDescription(basilica),'Piazza San Domenico · Lloc exacte');
 const district=place('Quadrilatero','q',44.49,11.34,{
  coordinate_role:'representative_point',formatted_address:'Quadrilatero'
 });
 assert.equal(pointCandidateDescription(district),'Bologna · Zona aproximada');
});
