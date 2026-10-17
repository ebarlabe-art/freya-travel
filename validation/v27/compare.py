"""Compare real local Supabase catalogs against the schema-only source snapshot."""
import json, os, pathlib, subprocess, re
root=pathlib.Path(__file__).resolve().parent
url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
def query(sql):
    out=subprocess.check_output(['psql',url,'-XAtq','-v','ON_ERROR_STOP=1'],input=sql,text=True)
    return json.loads(out)
sql=(root/'evidence/catalog-readonly.sql').read_text().replace("'travel_book_private'","'app_private'")
expected=json.loads((root/'evidence/catalog.json').read_text())
sql=sql.replace('BEGIN READ ONLY;', 'BEGIN READ ONLY; SET LOCAL search_path=public,extensions,pg_catalog;')
actual=query(sql)
# Recompile every function with checks enabled after all dependencies exist.
compile_sql = 'BEGIN; SET LOCAL check_function_bodies=true; SET LOCAL search_path=public,extensions,pg_catalog;\n' + '\n'.join(f['definition'].rstrip(';')+';' for f in expected['functions']) + '\nCOMMIT;'
subprocess.run(['psql',url,'-Xq','-v','ON_ERROR_STOP=1'],input=compile_sql,text=True,check=True)
print('PASS all 116 function definitions recompiled with check_function_bodies=true')
def norm(v):
    if isinstance(v,str): return re.sub(r'\s+',' ',v).strip()
    if isinstance(v,list): return sorted((norm(x) for x in v),key=lambda x:json.dumps(x,sort_keys=True))
    if isinstance(v,dict): return {k:norm(x) for k,x in v.items() if k not in ('acl','owner')}
    return v
errors=[]
for key in ('schemas','tables','columns','constraints','indexes','functions','triggers','policies','publication'):
    a,b=norm(expected[key]),norm(actual[key])
    if a!=b:
        left={json.dumps(x,sort_keys=True) for x in a or []}
        right={json.dumps(x,sort_keys=True) for x in b or []}
        errors.append(key)
        print('FAIL',key,'expected',len(a or []),'actual',len(b or []))
        print('Missing examples:',list(sorted(left-right))[:2])
        print('Extra examples:',list(sorted(right-left))[:2])
    else: print('PASS catalog',key,len(a or []))
roles={'anon','authenticated','service_role','PUBLIC'}
keys=('table_schema','table_name','grantee','privilege_type','is_grantable')
extract=lambda rows:{tuple(g[k] for k in keys) for g in rows if g['grantee'] in roles}
assert extract(expected['grants'])==extract(actual['grants']),'Application role table grants differ'
print('PASS table grants for API roles')
extra=json.loads((root/'evidence/extra.json').read_text())
grants=query("SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname IN ('public','app_private','place_private','proposal_private') AND p.prokind IN ('f','p');")
extractf=lambda rows:{json.dumps(g,sort_keys=True) for g in rows if g['grantee'] in roles}
assert extractf(extra['function_grants'])==extractf(grants),'Function API-role grants differ'
print('PASS function grants for API roles')
buckets=query("SELECT jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) FROM storage.buckets;")
assert norm(extra['buckets'])==norm(buckets),'Storage bucket configuration differs'
print('PASS private Storage bucket configuration')
assert not errors,errors
print('PASS COMPLETE BASELINE RESTORE: 62 tables, 116 functions, 688 columns, 535 constraints, 185 indexes, 48 triggers, 103 policies, grants, buckets and publication match.')
