import os,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent
work=os.environ['SUPABASE_WORKDIR']
assert work.startswith(os.environ['RUNNER_TEMP']+'/'), 'Only ephemeral runner stack allowed'
subprocess.run(['supabase','stop','--workdir',work,'--no-backup'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['supabase','start','--workdir',work],check=True,stdout=subprocess.DEVNULL)
url='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
for name in ('01-baseline','02-storage','03-realtime'):
 subprocess.run(['psql',url,'-Xq','-v','ON_ERROR_STOP=1','-f',str(root/'sql'/f'{name}.sql')],check=True)
subprocess.run(['python3',str(root/'compare.py')],check=True)
for name in ('04-v27','05-assert-empty-and-secured'):
 subprocess.run(['psql',url,'-Xq','-v','ON_ERROR_STOP=1','-f',str(root/'sql'/f'{name}.sql')],check=True)
print('PASS second clean full restore and v27 migration after deleting the first ephemeral stack and volumes.')
