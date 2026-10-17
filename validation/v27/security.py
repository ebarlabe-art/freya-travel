"""Real Auth, PostgREST, RLS and Storage requests to ephemeral localhost only."""
import concurrent.futures,hashlib,json,pathlib,subprocess,sys,urllib.request,urllib.error,urllib.parse
keys=json.load(open(sys.argv[1]))
base=keys.get('API_URL','http://127.0.0.1:54321')
assert urllib.parse.urlparse(base).hostname in ('127.0.0.1','localhost')
anon=keys['ANON_KEY'];service=keys['SERVICE_ROLE_KEY']
def request(path,token=None,method='GET',data=None,typ='application/json',expected=(200,),prefer=None):
 headers={'apikey':anon,'Content-Type':typ}
 if token:headers['Authorization']='Bearer '+token
 if prefer:headers['Prefer']=prefer
 body=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
 req=urllib.request.Request(base+path,headers=headers,data=body,method=method)
 try:
  with urllib.request.urlopen(req,timeout=30) as r:code,payload=r.status,r.read()
 except urllib.error.HTTPError as r:code,payload=r.code,r.read()
 if code not in expected:
  # No tokens/passwords or document contents in logs.
  try:kind=json.loads(payload).get('code','')
  except Exception:kind=''
  raise AssertionError(f'{method} {path.split("?")[0]} returned {code}, expected {expected}, code={kind}')
 if typ=='application/pdf' or not payload:return payload
 try:return json.loads(payload)
 except Exception:return payload
password='Synthetic-local-only-V27!2026'
tokens={};users={}
for name in ('owner','member','outsider'):
 email=f'v27-{name}@example.test'
 user=request('/auth/v1/admin/users',service,'POST',{'email':email,'password':password,'email_confirm':True})
 users[name]=user['id']
 login=request('/auth/v1/token?grant_type=password',None,'POST',{'email':email,'password':password})
 tokens[name]=login['access_token']
print('PASS real local Auth: three synthetic confirmed accounts and password login')
def rest(path,name='owner',method='GET',data=None,expected=(200,),prefer=None):
 return request('/rest/v1/'+path,tokens[name] if name else None,method,data,expected=expected,prefer=prefer)
stops=[{'label':'London','canonical_name':'London','time_zone':'Europe/London','provider':'geoapify','provider_place_id':'synthetic-london','country_code':'GB','latitude':51.5,'longitude':-0.12}]
trip=rest('rpc/create_trip_with_stops_v1',method='POST',data={'p_name':'Synthetic V27','p_start_date':'2030-01-01','p_end_date':'2030-01-02','p_stops':stops})[0]
tid=trip['id']
rest('rpc/join_trip_v2','member','POST',{'p_invite_code':trip['invite_code']})
assert rest('trips?id=eq.'+tid,'outsider')==[]
assert rest('trips?id=eq.'+tid,None)==[]
assert len(rest('trips?id=eq.'+tid,'member'))==1
assert len(rest('trip_stops?trip_id=eq.'+tid))==1
assert len(rest('checklist_items?trip_id=eq.'+tid))>0
print('PASS create/join RPC dependencies, trip stops, checklist trigger and owner/member/outsider/anon RLS')
row={'trip_id':tid,'title':'British Museum','timing_kind':'exact','starts_at':'2030-01-01T09:00:00Z','ends_at':'2030-01-01T10:00:00Z','time_zone':'Europe/London','location_name':'British Museum','city':'London'}
item=rest('trip_itinerary_items',method='POST',data=row,expected=(201,),prefer='return=representation')[0]
iid=item['id'];path='trip_itinerary_items?id=eq.'+iid
snapshot={'title':row['title'],'location_name':row['location_name'],'city':'London','address':None,'place':{'canonical_name':'British Museum','provider':'geoapify','provider_place_id':'synthetic-poi','attribution':'Synthetic local fixture','country_code':'GB','coordinate_role':'exact_location','latitude':51.5,'longitude':-0.12}}
patched=rest(path,method='PATCH',data={'resolved_location':snapshot},prefer='return=representation')[0]
assert patched['resolved_location']==snapshot
assert patched['starts_at']==item['starts_at'] and patched['ends_at']==item['ends_at']
bad=json.loads(json.dumps(snapshot));bad['place']['latitude']=999
rest(path,method='PATCH',data={'resolved_location':bad},expected=(400,))
rest('trip_itinerary_items','outsider','POST',row,expected=(403,))
assert rest(path,'outsider')==[]
assert rest(path,'outsider','PATCH',{'notes':'must not persist'},prefer='return=representation')==[]
changed=rest(path,'member','PATCH',{'location_name':'Corrected entrance'},prefer='return=representation')[0]
assert changed['resolved_location'] is None and changed['location_name']=='Corrected entrance'
stale=urllib.parse.quote(changed['updated_at'],safe='')
def concurrent_edit(note):
 return rest(path+'&updated_at=eq.'+stale,method='PATCH',data={'notes':note},prefer='return=representation')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(concurrent_edit,['version A','version B']))
assert sorted(map(len,results))==[0,1],results
print('PASS v27 geography constraints, schedule preservation, membership writes, correction invalidation and concurrent optimistic update')
pdf=(pathlib.Path(__file__).resolve().parents[2]/'scripts/fixtures/v27-london-itinerary.pdf').read_bytes()
obj=tid+'/v27-fixture.pdf';sp='/storage/v1/object/trip-documents/'+obj
request(sp,tokens['owner'],'POST',pdf,'application/pdf',expected=(200,201))
for name in ('owner','member'):
 downloaded=request('/storage/v1/object/authenticated/trip-documents/'+obj,tokens[name],typ='application/pdf')
 assert hashlib.sha256(downloaded).digest()==hashlib.sha256(pdf).digest()
request('/storage/v1/object/authenticated/trip-documents/'+obj,tokens['outsider'],typ='application/pdf',expected=(400,403,404))
request('/storage/v1/object/trip-documents/'+tid+'/forbidden.pdf',tokens['outsider'],'POST',pdf,'application/pdf',expected=(400,403))
request(sp,tokens['owner'],'PUT',pdf,'application/pdf',expected=(200,201))
doc=rest('travel_documents',method='POST',data={'trip_id':tid,'title':'Synthetic PDF','category':'Altres','file_name':'fixture.pdf','file_path':obj,'mime_type':'application/pdf','created_by':users['owner']},expected=(201,),prefer='return=representation')[0]
assert rest('travel_documents?id=eq.'+doc['id'],'outsider')==[]
request('/storage/v1/object/trip-documents',tokens['owner'],'DELETE',{'prefixes':[obj]})
print('PASS private Storage upload, byte-exact owner/member read, outsider denial, replacement, deletion and document metadata RLS')
rest(path,method='DELETE',expected=(204,))
assert rest(path)==[]
url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
sql="""DO $$ BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','app_private','place_private','proposal_private') AND p.prokind IN ('f','p'))<>117 THEN RAISE EXCEPTION 'v27 function count'; END IF;
 IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','app_private','place_private','proposal_private') AND NOT t.tgisinternal)<>50 THEN RAISE EXCEPTION 'v27 trigger count'; END IF;
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE public) THEN RAISE EXCEPTION 'Public bucket'; END IF;
END $$;"""
subprocess.run(['psql',url,'-Xq','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True)
print('PASS post-migration 117 functions / 50 triggers, exposed-table RLS and private buckets. All HTTP traffic stayed on localhost.')
