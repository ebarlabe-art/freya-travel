import { readFile, writeFile } from 'node:fs/promises';

const indexUrl=new URL('../index.html',import.meta.url);
const copyUrl=new URL('../404.html',import.meta.url);
let html=await readFile(indexUrl,'utf8');

html=html.replace("const OFFLINE_CACHE_VERSION=1;","const OFFLINE_CACHE_VERSION=2;");

const oldQuery="  const {data,error}=await db.from('checklist_items').select('id,text,done,category,template_key,dismissed,created_at').eq('trip_id',tripId).order('created_at');";
const newQuery="  let data,error;if(!isLondonTrip()&&connectionUnavailable()){const cached=readOfflineTripSnapshot()?.checklistItems;if(Array.isArray(cached)){data=cached;offlineSnapshotActive=true;offlineSnapshotSavedAt=readOfflineTripSnapshot()?.savedAt||offlineSnapshotSavedAt;updateConnectivityBanner()}else return}else({data,error}=await db.from('checklist_items').select('id,text,done,category,template_key,dismissed,created_at').eq('trip_id',tripId).order('created_at'));";
if(!html.includes(oldQuery))throw new Error('checklist query anchor missing');
html=html.replace(oldQuery,newQuery);

const itemMap="  const items=(data||[]).filter(item=>!item.dismissed).map(item=>({...item,...checklistTextParts(item.text,item.category)}));";
const itemMapNew=itemMap+"\n  if(!isLondonTrip()&&!connectionUnavailable())mergeOfflineTripSnapshot({checklistItems:items});";
html=html.replace(itemMap,itemMapNew);

html=html.replace("  document.querySelectorAll('[data-toggle]').forEach(el=>el.onchange=()=>toggleItem(el.dataset.toggle,el.checked));","  document.querySelectorAll('[data-toggle]').forEach(el=>{el.disabled=connectionUnavailable();el.onchange=()=>toggleItem(el.dataset.toggle,el.checked)});");
html=html.replace("  document.querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>deleteItem(el.dataset.delete,el.dataset.templateKey));","  document.querySelectorAll('[data-delete]').forEach(el=>{el.disabled=connectionUnavailable();el.onclick=()=>deleteItem(el.dataset.delete,el.dataset.templateKey)});");
html=html.replace("async function toggleItem(id,done){if(!trip)return;","async function toggleItem(id,done){if(!trip)return;if(connectionUnavailable()){msg('checklistMsg','📵 Sense connexió. La checklist és només de consulta fins que torni la xarxa.',true);await loadItems();return}");
html=html.replace("async function deleteItem(id,templateKey=''){if(!trip)return;","async function deleteItem(id,templateKey=''){if(!trip)return;if(connectionUnavailable()){msg('checklistMsg','📵 Sense connexió. No eliminarem res fins que torni la xarxa.',true);return}");

const restoreBlock="  if(!isLondonTrip()&&connectionUnavailable()){restoreOfflineAgendaSnapshot();restoreOfflineCarRentals();restoreOfflineDocuments()}";
const restoreNew="  if(!isLondonTrip()&&connectionUnavailable()){restoreOfflineAgendaSnapshot();restoreOfflineCarRentals();restoreOfflineDocuments();loadItems();loadParkingSummary()}";
if(!html.includes(restoreBlock))throw new Error('offline select anchor missing');
html=html.replace(restoreBlock,restoreNew);

const promiseOld="  await Promise.all([connectionUnavailable()?Promise.resolve():loadItems(),loadDocuments(true),...(isLondonTrip()?[loadExpenses(true)]:[ensureTripAgenda(),connectionUnavailable()?Promise.resolve():loadParkingSummary(),loadCarRentals(true)])]);";
const promiseNew="  await Promise.all([loadItems(),loadDocuments(true),...(isLondonTrip()?[loadExpenses(true)]:[ensureTripAgenda(),loadParkingSummary(),loadCarRentals(true)])]);";
if(!html.includes(promiseOld))throw new Error('offline select promise anchor missing');
html=html.replace(promiseOld,promiseNew);

const reconnectOld="    await Promise.all([loadCarRentals(true),loadDocuments(true)]);";
html=html.replace(reconnectOld,"    await Promise.all([loadCarRentals(true),loadDocuments(true),loadItems(),loadParkingSummary()]);");

await writeFile(indexUrl,html);
await writeFile(copyUrl,html);
console.log('Offline V2 checklist core applied.');
