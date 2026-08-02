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
type View = 'home' | 'itinerary' | 'tickets' | 'checklist' | 'expenses' | 'weather' | 'settings'

type WeatherDay = {
  date: string
  dayLabel: string
  icon: string
  description: string
  max: number
  min: number
  rain: number
  wind: number
  sunrise: string
  sunset: string
  advice: string
}

type WeatherApiResponse = {
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
    windspeed_10m_max: number[]
    sunrise: string[]
    sunset: string[]
  }
}

function formatLocalTime(dateTime: string) {
  return new Intl.DateTimeFormat('ca-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(dateTime))
}

function weatherAdvice(rainChance: number, wind: number, max: number) {
  if (rainChance >= 40) return 'Porteu paraigua.'
  if (max >= 25) return 'Dia càlid: porteu aigua.'
  if (wind >= 30) return 'Pot fer força vent.'
  return 'Bon dia per caminar i descobrir Londres.'
}

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

const weatherTargetDates = ['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11']
const weatherCacheKey = 'freya-weather-cache'
const weatherCacheTtlMs = 30 * 60 * 1000

function formatCatalanDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  return new Intl.DateTimeFormat('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(parsed).replace(/^./, (char) => char.toUpperCase())
}

function weatherDescription(code: number) {
  if (code === 0) return 'Cel serè'
  if (code >= 1 && code <= 2) return 'Poc ennuvolat'
  if (code === 3) return 'Ennuvolat'
  if (code >= 45 && code <= 48) return 'Boira'
  if (code >= 51 && code <= 57) return 'Plugim'
  if (code >= 61 && code <= 67) return 'Pluja'
  if (code >= 71 && code <= 77) return 'Neu'
  if (code >= 80 && code <= 82) return 'Ruixats'
  if (code >= 85 && code <= 86) return 'Ruixats de neu'
  if (code >= 95 && code <= 99) return 'Tempesta'
  return 'Condicions variables'
}

function weatherIcon(code: number) {
  if (code === 0) return '☀️'
  if (code >= 1 && code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code >= 45 && code <= 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '🌨️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code >= 85 && code <= 86) return '🌨️'
  if (code >= 95 && code <= 99) return '⛈️'
  return '🌤️'
}

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
  const [expenseForm, setExpenseForm] = useState<{ concept: string; amount: string; currency: 'GBP' | 'EUR'; paid_by: string; category: string; expense_date: string; place: string }>({ concept: '', amount: '', currency: 'GBP', paid_by: 'Compte comú', category: 'Menjar', expense_date: '2026-08-06', place: '' })
  const [weatherDays, setWeatherDays] = useState<WeatherDay[]>([])
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState('')
  const [weatherNotice, setWeatherNotice] = useState('')
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setTrip(null); setItems([]); setExpenses([]); return }
    void loadTrip()
  }, [session])

  useEffect(() => {
    if (!trip) return
    void loadItems()
    void loadExpenses()
    const checklistChannel = supabase.channel(`checklist-${trip.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `trip_id=eq.${trip.id}` }, () => { void loadItems() }).subscribe()
    const expenseChannel = supabase.channel(`expenses-${trip.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'travel_expenses', filter: `trip_id=eq.${trip.id}` }, () => { void loadExpenses() }).subscribe()
    return () => { supabase.removeChannel(checklistChannel); supabase.removeChannel(expenseChannel) }
  }, [trip?.id])

  useEffect(() => {
    if (view !== 'weather') return
    void loadWeather(false)
  }, [view])

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
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [expenses])

  const hottestDay = useMemo(() => weatherDays.reduce((current, day) => !current || day.max > current.max ? day : current, weatherDays[0] ?? null), [weatherDays])
  const rainiestDay = useMemo(() => weatherDays.reduce((current, day) => !current || day.rain > current.rain ? day : current, weatherDays[0] ?? null), [weatherDays])

  async function loadTrip() {
    const { data, error } = await supabase.rpc('get_my_trip')
    if (error) setMessage(error.message)
    else setTrip(data?.[0] ?? null)
  }

  async function loadItems() {
    if (!trip) return
    const { data, error } = await supabase.from('checklist_items').select('id,text,done,created_at').eq('trip_id', trip.id).order('created_at')
    if (error) setMessage(error.message)
    else setItems(data ?? [])
  }

  async function loadExpenses() {
    if (!trip) return
    const { data, error } = await supabase.from('travel_expenses').select('id,concept,amount,currency,paid_by,category,expense_date,place,created_at').eq('trip_id', trip.id).order('expense_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) setMessage(error.message)
    else setExpenses((data ?? []) as Expense[])
  }

  async function signUp(e: FormEvent) {
    e.preventDefault(); setMessage('')
    const { error } = await supabase.auth.signUp({ email, password })
    setMessage(error ? error.message : 'Compte creat. Revisa el correu si Supabase demana confirmació.')
  }

  async function signIn(e: FormEvent) {
    e.preventDefault(); setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage(error.message)
  }

  async function createTrip() {
    const { data, error } = await supabase.rpc('create_trip', { p_name: tripName })
    if (error) setMessage(error.message)
    else { setTrip(data?.[0] ?? null); setMessage('Viatge creat.') }
  }

  async function joinTrip() {
    const { data, error } = await supabase.rpc('join_trip', { p_invite_code: inviteCode.trim().toUpperCase() })
    if (error) setMessage(error.message)
    else { setTrip(data?.[0] ?? null); setMessage('Ja formes part del viatge.') }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault(); if (!trip || !newItem.trim()) return
    const { error } = await supabase.from('checklist_items').insert({ trip_id: trip.id, text: newItem.trim(), created_by: session!.user.id })
    if (error) setMessage(error.message)
    else setNewItem('')
  }

  async function toggleItem(item: ChecklistItem) {
    const { error } = await supabase.from('checklist_items').update({ done: !item.done }).eq('id', item.id)
    if (error) setMessage(error.message)
  }

  async function deleteItem(id: string) {
    if (!confirm('Vols eliminar aquesta tasca?')) return
    const { error } = await supabase.from('checklist_items').delete().eq('id', id)
    if (error) setMessage(error.message)
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault(); if (!trip || !expenseForm.concept.trim() || !expenseForm.amount) return
    const { error } = await supabase.from('travel_expenses').insert({ trip_id: trip.id, concept: expenseForm.concept.trim(), amount: Number(expenseForm.amount), currency: expenseForm.currency, paid_by: expenseForm.paid_by, category: expenseForm.category, expense_date: expenseForm.expense_date, place: expenseForm.place.trim() || null, created_by: session!.user.id })
    if (error) setMessage(error.message)
    else { setExpenseForm({ ...expenseForm, concept: '', amount: '', place: '' }); setShowExpenseForm(false) }
  }

  async function deleteExpense(id: string) {
    if (!confirm('Vols eliminar aquesta despesa?')) return
    const { error } = await supabase.from('travel_expenses').delete().eq('id', id)
    if (error) setMessage(error.message)
  }

  function exportExpenses() {
    const rows = [['Data', 'Concepte', 'Categoria', 'Lloc', 'Pagat per', 'Import', 'Moneda'], ...expenses.map(e => [e.expense_date, e.concept, e.category, e.place ?? '', e.paid_by, String(e.amount), e.currency])]
    const csv = rows.map(row => row.map(value => `"${String(value).split('"').join('""')}"`).join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'freya-travel-despeses.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadWeather(force = false) {
    setWeatherLoading(true)
    setWeatherError('')

    if (!force) {
      const cached = window.localStorage.getItem(weatherCacheKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { savedAt: number; days: WeatherDay[]; notice: string }
          const isFresh = Date.now() - parsed.savedAt < weatherCacheTtlMs
          if (isFresh) {
            setWeatherDays(parsed.days)
            setWeatherNotice(parsed.notice)
            setWeatherUpdatedAt(new Date(parsed.savedAt).toLocaleString('ca-ES'))
            setWeatherLoading(false)
            return
          }
        } catch {
          window.localStorage.removeItem(weatherCacheKey)
        }
      }
    }

    try {
      const response = await fetch('https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,sunrise,sunset&timezone=Europe/London&forecast_days=16')
      if (!response.ok) throw new Error('No s’han pogut obtenir dades de la previsió')
      const data = (await response.json()) as WeatherApiResponse
      const source = data.daily
      const days: WeatherDay[] = []
      for (const date of weatherTargetDates) {
        const index = source.time.indexOf(date)
        if (index === -1) continue
        const max = Math.round(source.temperature_2m_max[index])
        const min = Math.round(source.temperature_2m_min[index])
        const rain = source.precipitation_probability_max[index]
        const wind = Math.round(source.windspeed_10m_max[index])
        days.push({
          date,
          dayLabel: formatCatalanDate(date),
          icon: weatherIcon(source.weather_code[index]),
          description: weatherDescription(source.weather_code[index]),
          max,
          min,
          rain,
          wind,
          sunrise: formatLocalTime(source.sunrise[index]),
          sunset: formatLocalTime(source.sunset[index]),
          advice: weatherAdvice(rain, wind, max),
        })
      }
      const missing = weatherTargetDates.filter(date => !days.some(day => day.date === date))
      const notice = missing.length > 0 ? `No hi ha dades per a aquests dies del viatge encara: ${missing.join(', ')}. Es mostren els dies disponibles.` : ''
      setWeatherDays(days)
      setWeatherNotice(notice)
      setWeatherUpdatedAt(new Date().toLocaleString('ca-ES'))
      window.localStorage.setItem(weatherCacheKey, JSON.stringify({ savedAt: Date.now(), days, notice }))
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'No s’han pogut obtenir dades de la previsió'
      setWeatherError(messageText)
      setWeatherDays([])
      setWeatherNotice('')
    } finally {
      setWeatherLoading(false)
    }
  }

  if (loading) return <main className="shell"><section className="card">Carregant...</section></main>
  if (!session) return <main className="shell auth-shell"><section className="hero"><span className="logo">✈️</span><h1>Freya Travel</h1><p>El vostre viatge, sempre a mà.</p></section><section className="card auth-card"><h2>Benvinguda</h2><form className="stack" onSubmit={signIn}><input type="email" placeholder="Correu electrònic" value={email} onChange={e => setEmail(e.target.value)} required /><input type="password" placeholder="Contrasenya" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /><button>Iniciar sessió</button><button type="button" className="secondary" onClick={signUp}>Crear compte</button></form>{message && <p className="message">{message}</p>}</section></main>
  if (!trip) return <main className="shell"><header className="topbar"><div><strong>Freya Travel</strong><small>{userEmail}</small></div><button className="ghost" onClick={() => supabase.auth.signOut()}>Sortir</button></header><section className="card"><h2>Comencem el viatge</h2><div className="two-col"><div className="panel"><h3>Crear un viatge</h3><input value={tripName} onChange={e => setTripName(e.target.value)} /><button onClick={createTrip}>Crear viatge</button></div><div className="panel"><h3>Unir-me amb un codi</h3><input placeholder="Codi d'invitació" value={inviteCode} onChange={e => setInviteCode(e.target.value)} /><button onClick={joinTrip}>Unir-m'hi</button></div></div>{message && <p className="message">{message}</p>}</section></main>

  return <main className="app-shell">
    <header className="app-header"><div><small>Freya Travel</small><strong>{trip.name}</strong></div><button className="avatar" onClick={() => setView('settings')}>E</button></header>
    <div className="content">
      {view === 'home' && <>
        <section className="countdown-card"><span>Falten</span><strong>{countdown}</strong><span>dies per Londres</span></section>
        <section className="quick-grid">
          <button type="button" onClick={() => setView('itinerary')}><span>🗓️</span><b>Itinerari</b><small>6 dies planificats</small></button>
          <button type="button" onClick={() => setView('tickets')}><span>🎫</span><b>Entrades</b><small>{tickets.length} reserves</small></button>
          <button type="button" onClick={() => setView('checklist')}><span>✅</span><b>Checklist</b><small>{items.filter(i => i.done).length}/{items.length} fetes</small></button>
          <button type="button" onClick={() => setView('expenses')}><span>💷</span><b>Despeses</b><small>£{totals.GBP.toFixed(2)} · €{totals.EUR.toFixed(2)}</small></button>
          <button type="button" data-open="weatherView" onClick={() => setView('weather')}><span>🌦️</span><b>Temps</b><small>Previsió de Londres</small></button>
        </section>
        <section className="card"><div className="section-title"><h2>Proper pas</h2><button className="text-button" type="button" onClick={() => setView('itinerary')}>Veure-ho tot</button></div><div className="next-event"><span>✈️</span><div><strong>Vol Girona → Stansted</strong><small>Dijous 6 d’agost · 12.45</small></div></div></section>
      </>}

      {view === 'itinerary' && <section><div className="page-title"><div><small>Planificació</small><h1>Itinerari</h1></div></div><div className="timeline">{itinerary.map((item, index) => <article className="timeline-item" key={item.day}><div className="timeline-dot">{index + 1}</div><div className="card"><small>{item.day}</small><h3>{item.title}</h3><p>{item.detail}</p></div></article>)}</div></section>}

      {view === 'tickets' && <section><div className="page-title"><div><small>Cartera digital</small><h1>Entrades</h1></div></div><div className="ticket-list">{tickets.map(([name, detail]) => <article className="ticket-card" key={name}><div className="ticket-icon">🎫</div><div><strong>{name}</strong><small>{detail}</small></div><span>›</span></article>)}</div><p className="hint">Els QR i documents privats continuen guardats a la secció de documents de la versió anterior. En aquesta actualització no s’han publicat a GitHub.</p></section>}

      {view === 'checklist' && <section><div className="page-title"><div><small>Preparatius compartits</small><h1>Checklist</h1></div></div><div className="card"><form className="add-row" onSubmit={addItem}><input placeholder="Afegeix una tasca" value={newItem} onChange={e => setNewItem(e.target.value)} /><button type="submit">Afegir</button></form><div className="list">{items.length === 0 && <p className="empty">Encara no hi ha cap tasca.</p>}{items.map(item => <div className={`item ${item.done ? 'done' : ''}`} key={item.id}><label><input type="checkbox" checked={item.done} onChange={() => toggleItem(item)} /><span>{item.text}</span></label><button className="delete" onClick={() => deleteItem(item.id)} aria-label="Eliminar">×</button></div>)}</div></div></section>}

      {view === 'expenses' && <section><div className="page-title"><div><small>Compte comú</small><h1>Despeses</h1></div><button className="round-button" type="button" onClick={() => setShowExpenseForm(v => !v)}>＋</button></div><div className="totals"><div><small>Total en lliures</small><strong>£{totals.GBP.toFixed(2)}</strong></div><div><small>Total en euros</small><strong>€{totals.EUR.toFixed(2)}</strong></div></div>{showExpenseForm && <form className="card expense-form" onSubmit={addExpense}><h3>Nova despesa</h3><input placeholder="Concepte" value={expenseForm.concept} onChange={e => setExpenseForm({ ...expenseForm, concept: e.target.value })} required /><div className="form-row"><input type="number" min="0" step="0.01" placeholder="Import" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} required /><select value={expenseForm.currency} onChange={e => setExpenseForm({ ...expenseForm, currency: e.target.value as 'GBP' | 'EUR' })}><option value="GBP">£ Lliures</option><option value="EUR">€ Euros</option></select></div><div className="form-row"><select value={expenseForm.paid_by} onChange={e => setExpenseForm({ ...expenseForm, paid_by: e.target.value })}><option>Compte comú</option><option>Eva</option><option>Xesc</option></select><select value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>{['Menjar', 'Transport', 'Entrades', 'Allotjament', 'Compres', 'Altres'].map(c => <option key={c}>{c}</option>)}</select></div><div className="form-row"><input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} /><input placeholder="Lloc (opcional)" value={expenseForm.place} onChange={e => setExpenseForm({ ...expenseForm, place: e.target.value })} /></div><button type="submit">Guardar despesa</button></form>}<div className="filters"><input placeholder="Cerca una despesa" value={search} onChange={e => setSearch(e.target.value)} /><select value={payerFilter} onChange={e => setPayerFilter(e.target.value)}><option value="Tots">Tots</option><option value="Compte comú">Compte comú</option><option value="Eva">Eva</option><option value="Xesc">Xesc</option></select></div>{categoryTotals.length > 0 && <div className="card category-card"><h3>Top categories</h3>{categoryTotals.map(([category, amount]) => <div className="bar-row" key={category}><strong>{category}</strong><div><i style={{ width: `${Math.min(100, (amount / Math.max(...categoryTotals.map(([, value]) => value))) * 100)}%` }} /></div><span>£{amount.toFixed(0)}</span></div>)}</div>}<div className="expense-list">{filteredExpenses.length === 0 && <p className="empty">Encara no hi ha despeses per mostrar.</p>}{filteredExpenses.map(expense => <article className="expense-card" key={expense.id}><div className="expense-main"><div className="section-title"><h3>{expense.concept}</h3><span className="expense-amount">{expense.currency === 'GBP' ? '£' : '€'}{expense.amount.toFixed(2)}</span></div><p className="hint">{expense.category} · {expense.place ?? 'Sense lloc'} · {expense.paid_by}</p><small>{expense.expense_date}</small></div><button className="delete" onClick={() => deleteExpense(expense.id)} aria-label="Eliminar despesa">×</button></article>)}</div><div className="section-title" style={{ marginTop: '1rem' }}><button className="secondary" type="button" onClick={exportExpenses}>Exportar CSV</button></div></section>}

      {view === 'weather' && <section id="weatherView" className="weather-view"><button className="ghost" type="button" onClick={() => setView('home')}>← Torna al tauler</button><div className="page-title"><div><small>Previsió</small><h1>🌦️ Temps a Londres</h1></div><button className="round-button" type="button" onClick={() => void loadWeather(true)} aria-label="Actualitza la previsió">🔄 Actualitza</button></div><p className="weather-intro">Previsió actualitzada per al vostre viatge</p>{weatherLoading && <div className="card weather-card"><p className="empty">Carregant la previsió…</p></div>}{weatherError && <div className="card weather-card"><p className="weather-error">{weatherError}</p><button className="secondary" type="button" onClick={() => void loadWeather(true)}>Torna-ho a provar</button></div>}{!weatherLoading && !weatherError && <><div className="card weather-summary"><div><strong>Previsió del viatge</strong><p>Del 6 al 11 d’agost de 2026.</p><p className="weather-summary-text">Previsió actualitzada per al vostre viatge</p></div>{weatherUpdatedAt && <small>Darrera actualització: {weatherUpdatedAt}</small>}</div>{weatherNotice && <div className="weather-banner">{weatherNotice}</div>}{weatherDays.length === 0 ? <div className="card weather-card"><p className="empty">No hi ha dades disponibles per als dies del viatge.</p></div> : <><div className="weather-summary-grid"><div className="weather-summary-item"><small>Dia més càlid</small><strong>{hottestDay?.dayLabel ?? '—'}</strong><span>{hottestDay ? `${hottestDay.max}°` : '—'}</span></div><div className="weather-summary-item"><small>Dia més plujós</small><strong>{rainiestDay?.dayLabel ?? '—'}</strong><span>{rainiestDay ? `${rainiestDay.rain}%` : '—'}</span></div></div><div className="weather-grid">{weatherDays.map(day => <article className="weather-card" key={day.date}><div className="weather-top"><span className="weather-icon">{day.icon}</span><div><strong>{day.dayLabel}</strong><p>{day.description}</p></div></div><div className="weather-temp"><div><strong>{day.max}°</strong><small>Màx</small></div><div><strong>{day.min}°</strong><small>Mín</small></div></div><div className="weather-stats"><div><small>Pluja</small><strong>{day.rain}%</strong></div><div><small>Vent</small><strong>{day.wind} km/h</strong></div><div><small>Sol</small><strong>{day.sunrise} · {day.sunset}</strong></div></div><p className="weather-advice">{day.advice}</p></article>)}</div></>}</> }</section>}

      {view === 'settings' && <section><div className="page-title"><div><small>Compte i viatge</small><h1>Configuració</h1></div></div><div className="card settings-card"><label>Correu</label><strong>{userEmail}</strong><label>Codi d’invitació</label><code>{trip.invite_code}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(trip.invite_code)}>Copiar codi</button><button className="danger" onClick={() => supabase.auth.signOut()}>Tancar sessió</button></div></section>}
      {message && <p className="message floating-message">{message}</p>}
      <p className="app-footer">Versió 2.4</p>
    </div>
    <nav className="bottom-nav">{([['home', '⌂', 'Inici'], ['itinerary', '🗓', 'Ruta'], ['tickets', '🎫', 'Entrades'], ['expenses', '💷', 'Despeses'], ['weather', '🌦️', 'Temps'], ['settings', '⚙', 'Opcions']] as [View, string, string][]).map(([id, icon, label]) => <button key={id} className={view === id ? 'active' : ''} type="button" onClick={() => setView(id)}><span>{icon}</span><small>{label}</small></button>)}</nav>
  </main>
}
