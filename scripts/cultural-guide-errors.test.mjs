import test from 'node:test';import assert from 'node:assert/strict';
import {culturalFunctionResult} from '../domain/cultural-guide-ui.mjs';
test('reads the real FunctionsHttpError response body on non-2xx; never renders arbitrary upstream data',async()=>{
 const error={name:'FunctionsHttpError',context:Response.json({error:'invalid_response',stage:'generate',request_id:'16700000-0000-4000-8000-000000000099',private:'secret'},{status:503})};
 await assert.rejects(culturalFunctionResult({data:null,error}),/incompleta.*Referència: 16700000/);
 await assert.rejects(culturalFunctionResult({error:{name:'FunctionsFetchError'}}),/connectar/);
 await assert.rejects(culturalFunctionResult({error:{context:new Response('private HTML',{status:502})}}),/servei de generació/);
 await assert.rejects(culturalFunctionResult({data:{error:'<script>private</script>'}}),e=>!e.message.includes('private'));
 assert.deepEqual(await culturalFunctionResult({data:{candidates:[]},error:null}),{candidates:[]});
});
