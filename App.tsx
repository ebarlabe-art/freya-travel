import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Trip = { id: string; name: string; invite_code: string }
type ChecklistItem = { id: string; text: string; done: boolean; created_at: string }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tripName, setTripName] = useState('Londres 2026')
  const [inviteCode, setInviteCode] = useState('')
  const [newItem, setNewItem] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setTrip(null)
      setItems([])
      return
    }
    loadTrip()
  }, [session])

  useEffect(() => {
    if (!trip) return
    loadItems()
    const channel = supabase
      .channel(`checklist-${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items', filter: `trip_id=eq.${trip.id}` }, () => loadItems())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [trip?.id])

  const userEmail = useMemo(() => session?.user.email ?? '', [session])

  async function loadTrip() {
    const { data, error } = await supabase.rpc('get_my_trip')
    if (error) return setMessage(error.message)
    setTrip(data?.[0] ?? null)
  }

  async function loadItems() {
    if (!trip) return
    const { data, error } = await supabase
      .from('checklist_items')
      .select('id,text,done,created_at')
      .eq('trip_id', trip.id)
      .order('created_at', { ascending: true })
    if (error) setMessage(error.message)
    else setItems(data ?? [])
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
    e.preventDefault()
    if (!trip || !newItem.trim()) return
    const { error } = await supabase.from('checklist_items').insert({ trip_id: trip.id, text: newItem.trim(), created_by: session!.user.id })
    if (error) setMessage(error.message)
    else setNewItem('')
  }

  async function toggleItem(item: ChecklistItem) {
    const { error } = await supabase.from('checklist_items').update({ done: !item.done }).eq('id', item.id)
    if (error) setMessage(error.message)
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('checklist_items').delete().eq('id', id)
    if (error) setMessage(error.message)
  }

  if (loading) return <main className="shell"><section className="card">Carregant...</section></main>

  if (!session) {
    return <main className="shell">
      <section className="hero"><span className="logo">✈️</span><h1>Freya Travel</h1><p>Viatges compartits, sense complicacions.</p></section>
      <section className="card auth-card">
        <h2>Entra o crea el teu compte</h2>
        <form className="stack" onSubmit={signIn}>
          <input type="email" placeholder="Correu electrònic" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="Contrasenya (mínim 6 caràcters)" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
          <button type="submit">Iniciar sessió</button>
          <button type="button" className="secondary" onClick={signUp}>Crear compte</button>
        </form>
        {message && <p className="message">{message}</p>}
      </section>
    </main>
  }

  if (!trip) {
    return <main className="shell">
      <header className="topbar"><div><strong>Freya Travel</strong><small>{userEmail}</small></div><button className="ghost" onClick={() => supabase.auth.signOut()}>Sortir</button></header>
      <section className="card">
        <h2>Comencem el viatge</h2>
        <div className="two-col">
          <div className="panel"><h3>Crear un viatge</h3><input value={tripName} onChange={e => setTripName(e.target.value)} /><button onClick={createTrip}>Crear viatge</button></div>
          <div className="panel"><h3>Unir-me amb un codi</h3><input placeholder="Codi d'invitació" value={inviteCode} onChange={e => setInviteCode(e.target.value)} /><button onClick={joinTrip}>Unir-m'hi</button></div>
        </div>
        {message && <p className="message">{message}</p>}
      </section>
    </main>
  }

  return <main className="shell">
    <header className="topbar"><div><strong>{trip.name}</strong><small>{userEmail}</small></div><button className="ghost" onClick={() => supabase.auth.signOut()}>Sortir</button></header>
    <section className="hero compact"><span className="logo">🧳</span><h1>{trip.name}</h1><p>Comparteix aquest codi amb el Xesc:</p><code>{trip.invite_code}</code></section>
    <section className="card">
      <h2>Checklist compartida</h2>
      <form className="add-row" onSubmit={addItem}><input placeholder="Afegeix una tasca" value={newItem} onChange={e => setNewItem(e.target.value)} /><button>Afegir</button></form>
      <div className="list">
        {items.length === 0 && <p className="empty">Encara no hi ha cap tasca.</p>}
        {items.map(item => <div className={`item ${item.done ? 'done' : ''}`} key={item.id}>
          <label><input type="checkbox" checked={item.done} onChange={() => toggleItem(item)} /><span>{item.text}</span></label>
          <button className="delete" onClick={() => deleteItem(item.id)} aria-label="Eliminar">×</button>
        </div>)}
      </div>
      {message && <p className="message">{message}</p>}
    </section>
  </main>
}
