import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
export async function ingestionConcurrency({sql,container,database}){
 const [actor,trip,book,photo,operation]=Array.from({length:5},()=>randomUUID());
 sql(`insert into auth.users(id) values('${actor}');insert into public.trips(id,name,owner_id) values('${trip}','ALB03 concurrency','${actor}');insert into public.trip_members(trip_id,user_id) values('${trip}','${actor}');select set_config('request.jwt.claim.sub','${actor}',false);select public.create_travel_book_v1('${trip}','${book}','Concurrency','${randomUUID()}');insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by) values('${photo}','${trip}','Photo','Foto','photo.png','${trip}/photos/${photo}.png','image/png','${actor}');insert into storage.objects(bucket_id,name) values('trip-documents','${trip}/photos/${photo}.png');`);
 const session=command=>new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database],{stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>resolve({code,out}));p.stdin.end(command);});
 const request=`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);select public.request_travel_book_photo_v1('${trip}','${book}','${photo}','${operation}');select pg_sleep(0.15);commit;`;
 const results=await Promise.all([session(request),session(request)]);assert.ok(results.every(r=>r.code===0),JSON.stringify(results));
 sql(`do $$begin if (select count(*) from public.travel_book_assets where book_id='${book}')<>1 or (select count(*) from app_private.alb03_requests where book_id='${book}')<>1 then raise exception 'duplicate concurrent ingestion';end if;end$$;`);
 const asset=sql(`select asset_id from app_private.alb03_ingestions where book_id='${book}';`).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)[0];
 const claim=`begin;set local role service_role;select public.alb03_claim_v1('${asset}','${actor}');select pg_sleep(0.15);commit;`;
 const claims=await Promise.all([session(claim),session(claim)]);assert.equal(claims.filter(r=>r.code===0).length,1);assert.ok(claims.find(r=>r.code!==0).out.includes('55P03'));
 console.log('PASS ALB-03 concurrent identical ingestion and exclusive worker lease (independent sessions)');
}
