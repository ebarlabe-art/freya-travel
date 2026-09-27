// Refinement is untrusted generation context, never a patch to the trip summary.
export const refinementChoices={cheaper:'Més econòmic',more_snow:'Més neu',more_christmas:'Més Nadal',fewer_transfers:'Menys trasllats',calmer:'Més tranquil',different_destinations:'Destinacions diferents'};
export function validateRefinement(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['chips','text'].includes(k))||!Array.isArray(value.chips)||value.chips.length>6||new Set(value.chips).size!==value.chips.length||value.chips.some(k=>!Object.hasOwn(refinementChoices,k))||typeof value.text!=='string'||[...value.text].length>1000)throw Object.assign(Error('Refinament invàlid.'),{code:'invalid_request'});
 return {chips:[...value.chips],text:value.text};
}
export function contextualRefinements(document,proposals=[]){
 const fields=new Set(Object.values(document.decisions||{}).filter(d=>d.knowledge==='known').map(d=>d.field));
 return Object.entries(refinementChoices).filter(([key])=>key==='different_destinations'||key==='calmer'||key==='cheaper'&&fields.has('budget')||key==='more_snow'&&[...fields].some(f=>f==='interest.snow'||f==='interest.snow_activities')||key==='more_christmas'&&[...fields].some(f=>f==='interest.christmas'||f==='interest.christmas_markets')||key==='fewer_transfers'&&proposals.some(p=>p.document.candidate.route.legs.length>0));
}
