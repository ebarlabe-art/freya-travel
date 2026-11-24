import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {amountToCents,equalShares,customShares,summarizeSharedExpenses,formatSharedMoney} from '../domain/shared-trip-expenses.mjs';

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
