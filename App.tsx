import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Trip = { id: string; name: string; invite_code: string }
type ChecklistItem = { id: string; text: string; done: boolean; created_at: string }
type Expense = {
  id: string
  concept: string
  amount: number
  currency: 'GBP' | 'EUR'
  paid_by: string
  category: string
  expense_date: string
  place: string | null
  created_at: string
}
type View = 'home' | 'itinerary' | 'tickets' | 'checklist' | 'expenses' | 'settings'

const itinerary = [
  { day: 'Dijous 6', title: 'Arribada i Westminster', detail: 'Vol FR9797 · Girona 12.45 → Stansted 13.55. Hotel i passeig per Big Ben, Parlament, Westminster i South Bank.' },
  { day: 'Divendres 7', title: 'British Museum i Les Misérables', detail: 'British Museum a les 12.40. Les Misérables a les 19.30.' },
  { day: 'Dissabte 8', title: 'Tower, City i miradors', detail: 'Tower of London, Tower Bridge, St Dunstan in the East, Leadenhall Market i Sky Garden quan s’obrin les reserves.' },
  { day: 'Diumenge 9', title: 'Greenwich i London Eye', detail: 'Royal Observatory a les 12.00. London Eye a les 19.30.' },
  { day: 'Dilluns 10', title: 'Oxford i Cotswolds', detail: 'Punt de trobada: Gloucester Road Station, 07.30.' },
  { day: 'Dimarts 11', title: 'Parlament i tornada', detail: 'UK Parliament Audio Tour a les 09.30. Vol FR9798 Stansted 21.30 → Girona.' },
]

const tickets = [
  ['British Museum', '7 d’agost · 12.40'],
  ['Les Misérables', '7 d’agost · 19.30 · Dress Circle H14–H15'],
  ['Tower of London', 'Entrades i dues audioguies'],
  ['Royal Observatory', '9 d’agost · 12.00'],
  ['London Eye', '9 d’agost · 19.30'],
  ['Oxford i Cotswolds', '10 d’agost · trobada 07.30'],
  ['UK Parliament', '11 d’agost · 09.30'],
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [view, setView] = useState<View>('home')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tripName, setTripName] = useState('Londres 2026')
  const [inviteCode, setInviteCode] = useState('')
  const [newItem, setNewItem] = useState('')
  const [search, setSearch] = useState('')
  const [payerFilter, setPayerFilter] = useState('Tots')
  const [showExpenseForm, setShowExpenseForm] = useState(false)
  const [expenseForm, setExpenseForm] = useState({ concept: '', amount: '', currency: 'GBP', paid_by: 'Compte comú', category: 'Menjar', expense_date: '2026-08-06', place: '' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setTrip(null); setItems([]); setExpenses([]); return }
    loadTrip()
  }, [session])

  useEffect(() => {
    if (!trip) return
    loadItems(); loadExpenses()
    const checklistChannel = supabase.channel(`checklist-${trip.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `trip_id=eq.${trip.id}` }, loadItems).subscribe()
    const expenseChannel = supabase.channel(`expenses-${trip.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'travel_expenses', filter: `trip_id=eq.${trip.id}` }, loadExpenses).subscribe()
    return () => { supabase.removeChannel(checklistChannel); supabase.removeChannel(expenseChannel) }
  }, [trip?.id])

  const userEmail = session?.user.email ?? ''
  const countdown = useMemo(() => Math.max(0, Math.ceil((new Date('2026-08-06T12:45:00+02:00').getTime() - Date.now()) / 86400000)), [])
  const totals = useMemo(() => expenses.reduce((acc, item) => { acc[item.currency] += Number(item.amount); return acc }, { GBP: 0, EUR: 0 }), [expenses])
  const filteredExpenses = useMemo(() => expenses.filter(expense => {
    const matchesText = `${expense.concept} ${expense.place ?? ''} ${expense.category}`.toLowerCase().includes(search.toLowerCase())
    return matchesText && (payerFilter === 'Tots' || expense.paid_by === payerFilter)
  }), [expenses, search, payerFilter])
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    expenses.filter(e => e.currency === 'GBP').forEach(e => map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount)))
    return [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0,5)
  }, [expenses])

  async function loadTrip() { const { data, error } = await supabase.rpc('get_my_trip'); if (error) setMessage(error.message); else setTrip(data?.[0] ?? null) }
  async function loadItems() { if (!trip) return; const { data, error } = await supabase.from('checklist_items').select('id,text,done,created_at').eq('trip_id', trip.id).order('created_at'); if (error) setMessage(error.message); else setItems(data ?? []) }
  async function loadExpenses() { if (!trip) return; const { data, error } = await supabase.from('travel_expenses').select('id,concept,amount,currency,paid_by,category,expense_date,place,created_at').eq('trip_id', trip.id).order('expense_date', { ascending: false }).order('created_at', { ascending: false }); if (error) setMessage(error.message); else setExpenses((data ?? []) as Expense[]) }

  async function signUp(e: FormEvent) { e.preventDefault(); setMessage(''); const { error } = await supabase.auth.signUp({ email, password }); setMessage(error ? error.message : 'Compte creat. Revisa el correu si Supabase demana confirmació.') }
  async function signIn(e: FormEvent) { e.preventDefault(); setMessage(''); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setMessage(error.message) }
  async function createTrip() { const { data, error } = await supabase.rpc('create_trip', { p_name: tripName }); if (error) setMessage(error.message); else { setTrip(data?.[0] ?? null); setMessage('Viatge creat.') } }
  async function joinTrip() { const { data, error } = await supabase.rpc('join_trip', { p_invite_code: inviteCode.trim().toUpperCase() }); if (error) setMessage(error.message); else { setTrip(data?.[0] ?? null); setMessage('Ja formes part del viatge.') } }
  async function addItem(e: FormEvent) { e.preventDefault(); if (!trip || !newItem.trim()) return; const { error } = await supabase.from('checklist_items').insert({ trip_id: trip.id, text: newItem.trim(), created_by: session!.user.id }); if (error) setMessage(error.message); else setNewItem('') }
  async function toggleItem(item: ChecklistItem) { const { error } = await supabase.from('checklist_items').update({ done: !item.done }).eq('id', item.id); if (error) setMessage(error.message) }
  async function deleteItem(id: string) { if (!confirm('Vols eliminar aquesta tasca?')) return; const { error } = await supabase.from('checklist_items').delete().eq('id', id); if (error) setMessage(error.message) }
  async function addExpense(e: FormEvent) {
    e.preventDefault(); if (!trip || !expenseForm.concept.trim() || !expenseForm.amount) return
    const { error } = await supabase.from('travel_expenses').insert({ trip_id: trip.id, concept: expenseForm.concept.trim(), amount: Number(expenseForm.amount), currency: expenseForm.currency, paid_by: expenseForm.paid_by, category: expenseForm.category, expense_date: expenseForm.expense_date, place: expenseForm.place.trim() || null, created_by: session!.user.id })
    if (error) setMessage(error.message); else { setExpenseForm({ ...expenseForm, concept: '', amount: '', place: '' }); setShowExpenseForm(false) }
  }
  async function deleteExpense(id: string) { if (!confirm('Vols eliminar aquesta despesa?')) return; const { error } = await supabase.from('travel_expenses').delete().eq('id', id); if (error) setMessage(error.message) }
  function exportExpenses() {
    const rows = [['Data','Concepte','Categoria','Lloc','Pagat per','Import','Moneda'], ...expenses.map(e => [e.expense_date,e.concept,e.category,e.place ?? '',e.paid_by,String(e.amount),e.currency])]
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'freya-travel-despeses.csv'; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <main className="shell"><section className="card">Carregant...</section></main>
  if (!session) return <main className="shell auth-shell"><section className="hero"><span className="logo">✈️</span><h1>Freya Travel</h1><p>El vostre viatge, sempre a mà.</p></section><section className="card auth-card"><h2>Benvinguda</h2><form className="stack" onSubmit={signIn}><input type="email" placeholder="Correu electrònic" value={email} onChange={e => setEmail(e.target.value)} required/><input type="password" placeholder="Contrasenya" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required/><button>Iniciar sessió</button><button type="button" className="secondary" onClick={signUp}>Crear compte</button></form>{message && <p className="message">{message}</p>}</section></main>
  if (!trip) return <main className="shell"><header className="topbar"><div><strong>Freya Travel</strong><small>{userEmail}</small></div><button className="ghost" onClick={() => supabase.auth.signOut()}>Sortir</button></header><section className="card"><h2>Comencem el viatge</h2><div className="two-col"><div className="panel"><h3>Crear un viatge</h3><input value={tripName} onChange={e => setTripName(e.target.value)}/><button onClick={createTrip}>Crear viatge</button></div><div className="panel"><h3>Unir-me amb un codi</h3><input placeholder="Codi d'invitació" value={inviteCode} onChange={e => setInviteCode(e.target.value)}/><button onClick={joinTrip}>Unir-m'hi</button></div></div>{message && <p className="message">{message}</p>}</section></main>

  return <main className="app-shell">
    <header className="app-header"><div><small>Freya Travel</small><strong>{trip.name}</strong></div><button className="avatar" onClick={() => setView('settings')}>E</button></header>
    <div className="content">
      {view === 'home' && <>
        <section className="countdown-card"><span>Falten</span><strong>{countdown}</strong><span>dies per Londres</span></section>
        <section className="quick-grid">
          <button onClick={() => setView('itinerary')}><span>🗓️</span><b>Itinerari</b><small>6 dies planificats</small></button>
          <button onClick={() => setView('tickets')}><span>🎫</span><b>Entrades</b><small>{tickets.length} reserves</small></button>
          <button onClick={() => setView('checklist')}><span>✅</span><b>Checklist</b><small>{items.filter(i => i.done).length}/{items.length} fetes</small></button>
          <button onClick={() => setView('expenses')}><span>💷</span><b>Despeses</b><small>£{totals.GBP.toFixed(2)} · €{totals.EUR.toFixed(2)}</small></button>
        </section>
        <section className="card"><div className="section-title"><h2>Proper pas</h2><button className="text-button" onClick={() => setView('itinerary')}>Veure-ho tot</button></div><div className="next-event"><span>✈️</span><div><strong>Vol Girona → Stansted</strong><small>Dijous 6 d’agost · 12.45</small></div></div></section>
      </>}

      {view === 'itinerary' && <section><div className="page-title"><div><small>Planificació</small><h1>Itinerari</h1></div></div><div className="timeline">{itinerary.map((item, index) => <article className="timeline-item" key={item.day}><div className="timeline-dot">{index+1}</div><div className="card"><small>{item.day}</small><h3>{item.title}</h3><p>{item.detail}</p></div></article>)}</div></section>}

      {view === 'tickets' && <section><div className="page-title"><div><small>Cartera digital</small><h1>Entrades</h1></div></div><div className="ticket-list">{tickets.map(([name, detail]) => <article className="ticket-card" key={name}><div className="ticket-icon">🎫</div><div><strong>{name}</strong><small>{detail}</small></div><span>›</span></article>)}</div><p className="hint">Els QR i documents privats continuen guardats a la secció de documents de la versió anterior. En aquesta actualització no s’han publicat a GitHub.</p></section>}

      {view === 'checklist' && <section><div className="page-title"><div><small>Preparatius compartits</small><h1>Checklist</h1></div></div><div className="card"><form className="add-row" onSubmit={addItem}><input placeholder="Afegeix una tasca" value={newItem} onChange={e => setNewItem(e.target.value)}/><button>Afegir</button></form><div className="list">{items.length === 0 && <p className="empty">Encara no hi ha cap tasca.</p>}{items.map(item => <div className={`item ${item.done ? 'done' : ''}`} key={item.id}><label><input type="checkbox" checked={item.done} onChange={() => toggleItem(item)}/><span>{item.text}</span></label><button className="delete" onClick={() => deleteItem(item.id)} aria-label="Eliminar">×</button></div>)}</div></div></section>}

      {view === 'expenses' && <section><div className="page-title"><div><small>Compte comú</small><h1>Despeses</h1></div><button className="round-button" onClick={() => setShowExpenseForm(v => !v)}>＋</button></div><div className="totals"><div><small>Total en lliures</small><strong>£{totals.GBP.toFixed(2)}</strong></div><div><small>Total en euros</small><strong>€{totals.EUR.toFixed(2)}</strong></div></div>{showExpenseForm && <form className="card expense-form" onSubmit={addExpense}><h3>Nova despesa</h3><input placeholder="Concepte" value={expenseForm.concept} onChange={e => setExpenseForm({...expenseForm, concept:e.target.value})} required/><div className="form-row"><input type="number" min="0" step="0.01" placeholder="Import" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount:e.target.value})} required/><select value={expenseForm.currency} onChange={e => setExpenseForm({...expenseForm, currency:e.target.value})}><option value="GBP">£ Lliures</option><option value="EUR">€ Euros</option></select></div><div className="form-row"><select value={expenseForm.paid_by} onChange={e => setExpenseForm({...expenseForm, paid_by:e.target.value})}><option>Compte comú</option><option>Eva</option><option>Xesc</option></select><select value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category:e.target.value})}>{['Menjar','Transport','Entrades','Allotjament','Compres','Altres'].map(c => <option key={c}>{c}</option>)}</select></div><div className="form-row"><input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({...expenseForm, expense_date:e.target.value})}/><input placeholder="Lloc (opcional)" value={expenseForm.place} onChange={e => setExpenseForm({...expenseForm, place:e.target.value})}/></div><button>Guardar despesa</button></form>}<div className="filters"><input placeholder="Cerca una despesa" value={search} onChange={e => setSearch(e.target.value)}/><select value={payerFilter} onChange={e => setPayerFilter(e.target.value)}><option>Tots</option><option>Compte comú</option><option>Eva</option><option>Xesc</option></select></div>{categoryTotals.length > 0 && <section className="card category-card"><h3>Despesa en lliures per categoria</h3>{categoryTotals.map(([category, amount]) => <div className="bar-row" key={category}><span>{category}</span><div><i style={{width:`${Math.max(8,(amount/categoryTotals[0][1])*100)}%`}}/></div><b>£{amount.toFixed(2)}</b></div>)}</section>}<div className="expense-list">{filteredExpenses.length === 0 && <div className="card empty">Encara no hi ha despeses.</div>}{filteredExpenses.map(expense => <article className="expense-card" key={expense.id}><div className="expense-emoji">{expense.category === 'Menjar' ? '🍽️' : expense.category === 'Transport' ? '🚇' : expense.category === 'Entrades' ? '🎭' : expense.category === 'Allotjament' ? '🏨' : expense.category === 'Compres' ? '🛍️' : '🧾'}</div><div className="expense-main"><strong>{expense.concept}</strong><small>{expense.expense_date} · {expense.paid_by}{expense.place ? ` · ${expense.place}` : ''}</small></div><b>{expense.currency === 'GBP' ? '£' : '€'}{Number(expense.amount).toFixed(2)}</b><button className="delete" onClick={() => deleteExpense(expense.id)}>×</button></article>)}</div><button className="secondary wide" onClick={exportExpenses}>Exportar a Excel (CSV)</button></section>}

      {view === 'settings' && <section><div className="page-title"><div><small>Compte i viatge</small><h1>Configuració</h1></div></div><div className="card settings-card"><label>Correu</label><strong>{userEmail}</strong><label>Codi d’invitació</label><code>{trip.invite_code}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(trip.invite_code)}>Copiar codi</button><button className="danger" onClick={() => supabase.auth.signOut()}>Tancar sessió</button></div></section>}
      {message && <p className="message floating-message">{message}</p>}
    </div>
    <nav className="bottom-nav">{([['home','⌂','Inici'],['itinerary','🗓','Ruta'],['tickets','🎫','Entrades'],['expenses','💷','Despeses'],['settings','⚙','Opcions']] as [View,string,string][]).map(([id,icon,label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><span>{icon}</span><small>{label}</small></button>)}</nav>
  </main>
}
