import test from 'node:test';
import assert from 'node:assert/strict';
import {planTravelBookIngestion,batchBackoffMs,classifyTravelBookProcessResponse} from '../domain/travel-book-batch.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

test('ALB-04 batch planner is stable, bounded to valid unique document identities',()=>{
 assert.deepEqual(planTravelBookIngestion([{id:id(2)},{id:'bad'},{id:id(2)},{id:id(1)}]),[id(2),id(1)]);
});

test('ALB-04 batch retry policy only retries transient transport/capacity failures',()=>{
 for(const status of [409,429,502,503,504])assert.equal(classifyTravelBookProcessResponse({status,body:{}}).retry,true);
 assert.deepEqual(classifyTravelBookProcessResponse({status:409,body:{error:'ALB_STALE_LEASE'}}),{state:'stale_lease',retry:false});
 assert.equal(classifyTravelBookProcessResponse({status:422,body:{error:'STORAGE_ERROR'}}).retry,true);
 assert.equal(classifyTravelBookProcessResponse({status:422,body:{error:'SOURCE_MISSING'}}).retry,false);
 assert.equal(classifyTravelBookProcessResponse({status:401,body:{}}).state,'auth');
 assert.deepEqual(classifyTravelBookProcessResponse({status:200,body:{status:'ready'}}),{state:'ready',retry:false});
 assert.deepEqual(classifyTravelBookProcessResponse({status:202,body:{status:'derivative_pending'}}),{state:'derivative_pending',retry:false});
});

test('ALB-04 batch backoff is capped',()=>{
 assert.equal(batchBackoffMs(0),500);
 assert.equal(batchBackoffMs(1),1000);
 assert.equal(batchBackoffMs(4),8000);
 assert.equal(batchBackoffMs(99),8000);
});
