import {readFileSync,readdirSync} from 'node:fs';
import {runDatabaseTests} from './test-travel-book-db.mjs';
await runDatabaseTests({async afterBase({sql,file,container,database}){
 file('supabase/tests/alb03_storage_baseline.sql');
 for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('_travel_book_ingestion_v1.sql')))file('supabase/migrations/'+name);
 sql(readFileSync('supabase/tests/travel_book_fixture.sql','utf8')+readFileSync('supabase/tests/alb03_ingestion_rollback.sql','utf8'));
 console.log('PASS ALB-03 SQL ingestion, permissions, preservation and lifecycle');
 // Existing behavioral contracts run again against the extended schema.
 for(const name of readdirSync('supabase/tests').filter(n=>n.startsWith('travel_book_')&&n.endsWith('_rollback.sql')&&n!=='travel_book_schema_rollback.sql')){
  sql(readFileSync('supabase/tests/travel_book_fixture.sql','utf8')+readFileSync('supabase/tests/'+name,'utf8'));
 }
 console.log('PASS ALB-02 behavioral regression after ALB-03');
 const {ingestionConcurrency}=await import('./travel-book-ingestion-concurrency.mjs');await ingestionConcurrency({sql,container,database});
}}).run();
