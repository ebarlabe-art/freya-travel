import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {amountToCents,equalShares,customShares,summarizeSharedExpenses,formatSharedMoney,needsSharedExpenseReview,sameSharedAllocation} from '../domain/shared-trip-expenses.mjs';

const eva='11111111-1111-4111-8111-111111111111';
const xesc='22222222-2222-4222-8222-222222222222';
const marc='33333333-3333-4333-8333-333333333333';

test('cents preserve decimal precision and reject invalid or negative amounts',()=>{
  assert.equal(amountToCents('12,50'),1250);
  assert.equal(amountToCents('0.01'),1);
  for(const amount of ['0','-2','1.234','1e5','1,2,3','NaN','999999999999999'])assert.throws(()=>amountToCents(amount));
  assert.match(formatSharedMoney(1234,'EUR'),/12,34/);
});

test('equal split preserves every cent with deterministic remainder',()=>{
  const rows=equalShares(1000,[eva,xesc,marc]);
  assert.deepEqual(rows.map(x=>x.amount_cents),[334,333,333]);
  assert.equal(rows.reduce((sum,x)=>sum+x.amount_cents,0),1000);
  assert.throws(()=>equalShares(1,[eva,xesc]));
  assert.throws(()=>equalShares(100,[eva,eva]));
});

test('custom split supports subsets and rejects invalid allocation totals',()=>{
  assert.deepEqual(customShares(1000,[{user_id:eva,amount:'7.50'},{user_id:marc,amount:'2.50'}]).map(x=>x.amount_cents),[750,250]);
  assert.throws(()=>customShares(1000,[{user_id:eva,amount:'8'},{user_id:marc,amount:'1'}]));
  assert.throws(()=>customShares(1000,[{user_id:eva,amount:'5'},{user_id:eva,amount:'5'}]));
});

test('balances, transfers and currencies do not mix',()=>{
  const expenses=[
    {payer_user_id:eva,amount:'60.00',currency:'EUR',split_shares:equalShares(6000,[eva,xesc,marc])},
    {payer_user_id:xesc,amount:'30.00',currency:'EUR',split_shares:customShares(3000,[{user_id:xesc,amount:'15'},{user_id:marc,amount:'15'}])},
    {payer_user_id:eva,amount:'10',currency:'USD',split_shares:equalShares(1000,[eva,xesc])}
  ];
  const summaries=summarizeSharedExpenses(expenses,[],[eva,xesc,marc]);
  const eur=summaries.find(row=>row.currency==='EUR');
  assert.equal(eur.expenseCents,9000);
  assert.deepEqual([...eur.balances],[ [eva,4000],[xesc,-500],[marc,-3500] ]);
  assert.deepEqual(eur.suggestions.map(row=>[row.from,row.to,row.amount_cents]),[[xesc,eva,500],[marc,eva,3500]]);
  assert.equal(summaries.find(row=>row.currency==='USD').expenseCents,1000);
  const after=summarizeSharedExpenses(expenses,[{payer_user_id:marc,receiver_user_id:eva,amount:'20',currency:'EUR'}],[eva,xesc,marc]);
  assert.equal(after.find(row=>row.currency==='EUR').balances.get(marc),-1500);
  assert.equal(after.find(row=>row.currency==='EUR').balances.get(eva),2000);
  assert.equal(after.find(row=>row.currency==='USD').balances.get(eva),500);
});

test('legacy expenses without shares stay outside settlement balances',()=>{
  assert.deepEqual(summarizeSharedExpenses([{payer_user_id:null,amount:'40',currency:'GBP',split_shares:null}],[],[eva,xesc]),[]);
});

test('generic navigation, build packaging, offline cache and RLS contract are wired',async()=>{
  const [html,packageScript,sw,sql]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('./package-pages.mjs',import.meta.url),'utf8'),
    readFile(new URL('../sw.js',import.meta.url),'utf8'),
    readFile(new URL('../supabase/migrations/20261124005200_shared_trip_expenses_v1.sql',import.meta.url),'utf8')
  ]);
  assert.match(html,/data-open="sharedExpensesView"/);
  assert.match(html,/id="sharedExpensesRoot"/);
  assert.match(html,/if\(id==='sharedExpensesView'\)loadSharedExpenseScreen\(\)/);
  assert.match(packageScript,/'shared-trip-expenses.mjs'/);
  assert.match(sw,/domain\/shared-trip-expenses.mjs/);
  assert.match(sql,/alter table public\.trip_expense_settlements enable row level security/i);
  assert.match(sql,/split_shares jsonb/);
  assert.match(sql,/public\.is_trip_member\(trip_id\)/);
  assert.match(sql,/created_by in \(payer_user_id, receiver_user_id\)/);
});

test('new member joining after an expense gets a review notice, never a retroactive auto-split',()=>{
  const expense={payer_user_id:eva,created_at:'2026-11-24T09:29:33Z',split_shares:[{user_id:eva,amount_cents:15000}]};
  const members=[
    {user_id:eva,created_at:'2026-11-15T20:43:06Z'},
    {user_id:xesc,created_at:'2026-11-24T09:44:53Z'}
  ];
  assert.equal(needsSharedExpenseReview(expense,members),true);
  assert.deepEqual(expense.split_shares,[{user_id:eva,amount_cents:15000}],'Joining must not mutate an old allocation');
  const revised={...expense,split_shares:equalShares(15000,[eva,xesc])};
  assert.equal(needsSharedExpenseReview(revised,members),false);
  assert.equal(needsSharedExpenseReview({...expense,created_at:'2026-11-24T10:00:00Z'},members),false);
  assert.equal(needsSharedExpenseReview({...expense,payer_user_id:null},members),false);
  assert.equal(sameSharedAllocation(revised.split_shares,[{user_id:xesc,amount_cents:7500},{user_id:eva,amount_cents:7500}]),true);
  const ledger=summarizeSharedExpenses([revised,{payer_user_id:xesc,amount:'100',currency:'EUR',split_shares:equalShares(10000,[eva,xesc])}],[],[eva,xesc]);
  assert.equal(ledger[0].balances.get(eva),2500);
  assert.equal(ledger[0].balances.get(xesc),-2500);
});

test('solo save warning, explicit review editor and stale revision guard are present',async()=>{
  const [module,sql]=await Promise.all([
    readFile(new URL('../domain/shared-trip-expenses.mjs',import.meta.url),'utf8'),
    readFile(new URL('../supabase/migrations/20261124114500_shared_expense_split_review_v2.sql',import.meta.url),'utf8')
  ]);
  assert.match(module,/members\.length===1 && !globalThis\.confirm/);
  assert.match(module,/requireCurrentMembers\(\)/);
  assert.match(module,/data-open-edit/);
  assert.match(module,/data-edit-split/);
  assert.match(module,/eq\('split_revision',row\.split_revision\)/);
  assert.match(sql,/create policy "shared expense creator revises split"/);
  assert.match(sql,/Only the original creator can revise a shared allocation/);
  assert.match(sql,/new\.split_revision := old\.split_revision \+ 1/);
});
