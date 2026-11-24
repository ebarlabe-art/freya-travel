// Shared expenses for generic trips. No automatic FX or bank transfer.
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoCurrency = value => /^[A-Z]{3}$/.test(value);
const readNumber = value => String(value ?? '').trim().replace(',', '.');

export function amountToCents(input) {
  const raw = readNumber(input);
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(raw)) throw Error('Indica un import amb un màxim de dos decimals.');
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw Error('L’import ha de ser superior a zero.');
  return cents;
}

export function equalShares(cents, ids) {
  const unique = [...new Set(ids)];
  if (!Number.isSafeInteger(cents) || cents <= 0 || unique.length === 0 || unique.length !== ids.length || !unique.every(id => uuidPattern.test(id))) {
    throw Error('Tria almenys un participant vàlid.');
  }
  const base = Math.floor(cents / unique.length);
  const remainder = cents % unique.length;
  if (base === 0) throw Error('L’import és massa petit per repartir-lo entre tantes persones.');
  return unique.map((user_id, index) => ({ user_id, amount_cents: base + (index < remainder ? 1 : 0) }));
}

export function customShares(cents, values) {
  const shares = values.map(row => ({ user_id: row.user_id, amount_cents: amountToCents(row.amount) }));
  if (shares.length === 0 || new Set(shares.map(row => row.user_id)).size !== shares.length ||
      !shares.every(row => uuidPattern.test(row.user_id)) ||
      shares.reduce((sum, row) => sum + row.amount_cents, 0) !== cents) {
    throw Error('La suma de les parts ha de coincidir exactament amb la despesa.');
  }
  return shares;
}

export function summarizeSharedExpenses(expenses, settlements, memberIds) {
  const ids = new Set(memberIds);
  const currencies = new Map();
  const group = currency => {
    if (!currencies.has(currency)) currencies.set(currency, { currency, balances: new Map(memberIds.map(id => [id, 0])), expenseCents: 0, settlementCents: 0, movements: 0 });
    return currencies.get(currency);
  };
  for (const row of expenses) {
    if (!ids.has(row.payer_user_id) || !isoCurrency(row.currency) || !Array.isArray(row.split_shares)) continue;
    const cents = amountToCents(String(row.amount));
    const parts = row.split_shares;
    if (!parts.length || parts.reduce((sum, part) => sum + Number(part.amount_cents), 0) !== cents ||
        new Set(parts.map(part => part.user_id)).size !== parts.length ||
        !parts.every(part => ids.has(part.user_id) && Number.isSafeInteger(Number(part.amount_cents)) && Number(part.amount_cents) > 0)) continue;
    const g = group(row.currency);
    g.expenseCents += cents;
    g.movements += 1;
    g.balances.set(row.payer_user_id, (g.balances.get(row.payer_user_id) || 0) + cents);
    for (const part of parts) g.balances.set(part.user_id, (g.balances.get(part.user_id) || 0) - Number(part.amount_cents));
  }
  for (const row of settlements) {
    if (!ids.has(row.payer_user_id) || !ids.has(row.receiver_user_id) || !isoCurrency(row.currency)) continue;
    const cents = amountToCents(String(row.amount));
    const g = group(row.currency);
    g.settlementCents += cents;
    g.balances.set(row.payer_user_id, (g.balances.get(row.payer_user_id) || 0) + cents);
    g.balances.set(row.receiver_user_id, (g.balances.get(row.receiver_user_id) || 0) - cents);
  }
  return [...currencies.values()].sort((a,b) => a.currency.localeCompare(b.currency)).map(g => {
    if ([...g.balances.values()].reduce((sum, n) => sum + n, 0) !== 0) throw Error('Els saldos no quadren.');
    const creditors = [...g.balances].filter(([, cents]) => cents > 0).map(([id, cents]) => ({ id, cents }));
    const debtors = [...g.balances].filter(([, cents]) => cents < 0).map(([id, cents]) => ({ id, cents: -cents }));
    const suggestions = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const cents = Math.min(debtors[i].cents, creditors[j].cents);
      suggestions.push({ from: debtors[i].id, to: creditors[j].id, amount_cents: cents, currency: g.currency });
      debtors[i].cents -= cents;
      creditors[j].cents -= cents;
      if (debtors[i].cents === 0) i++;
      if (creditors[j].cents === 0) j++;
    }
    return { ...g, suggestions };
  });
}

export function formatSharedMoney(cents, currency) {
  return new Intl.NumberFormat('ca-ES', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export function mountSharedExpenses({root, db, tripId, userId, current}) {
  let alive = true;
  let busy = false;
  let rows = [];
  let settlements = [];
  let members = [];
  let labels = [];
  let mode = 'equal';
  let currency = 'EUR';
  let request = 0;
  const active = () => alive && current();
  const name = id => id === userId ? (labels.find(l => l.user_id === id)?.display_name || 'Tu') :
    (labels.find(l => l.user_id === id)?.display_name || ('Viatger ' + (members.findIndex(m => m.user_id === id) + 1 || id.slice(0,6))));
  const option = (id, selected = false) => '<option value="' + escapeHtml(id) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(name(id)) + '</option>';
  const money = (cents, iso) => formatSharedMoney(cents, iso);
  const status = (message, error = false) => {
    const el = root.querySelector('[data-shared-status]');
    if (el) { el.textContent = message; el.classList.toggle('error', error); }
  };
  const memberOptions = selected => members.map(m => option(m.user_id, m.user_id === selected)).join('');

  function renderParticipantChoices() {
    const target = root.querySelector('[data-shared-participants]');
    if (!target) return;
    target.innerHTML = members.map(m => '<label class="shared-expense-participant"><span><input type="checkbox" data-split-member="' + escapeHtml(m.user_id) + '" checked> ' + escapeHtml(name(m.user_id)) + '</span><input type="number" inputmode="decimal" min="0.01" step="0.01" data-split-amount="' + escapeHtml(m.user_id) + '" aria-label="Part de ' + escapeHtml(name(m.user_id)) + '" disabled></label>').join('');
    const update = () => {
      for (const input of target.querySelectorAll('[data-split-amount]')) {
        const checkbox = [...target.querySelectorAll('[data-split-member]')].find(x => x.dataset.splitMember === input.dataset.splitAmount);
        input.disabled = mode !== 'custom' || !checkbox?.checked;
      }
    };
    target.querySelectorAll('[data-split-member]').forEach(input => input.addEventListener('change', update));
    update();
  }

  function render() {
    if (!active()) return;
    const accountingIds = [...new Set([...members.map(x => x.user_id), ...rows.flatMap(x => [x.payer_user_id,...(x.split_shares||[]).map(part => part.user_id)]), ...settlements.flatMap(x => [x.payer_user_id,x.receiver_user_id])].filter(id => uuidPattern.test(id||'')))];
    const summaries = summarizeSharedExpenses(rows, settlements, accountingIds);
    const legacyCount = rows.filter(x => !x.payer_user_id || !x.split_shares).length;
    root.innerHTML = '<section class="card"><h2>💸 Despeses compartides</h2><p class="muted">Cada persona apunta el que ha pagat. Freya calcula els saldos del grup, per moneda, sense barrejar pressupost i pagaments.</p><p class="message" data-shared-status role="status" aria-live="polite"></p><button type="button" class="secondary" data-shared-refresh>↻ Actualitza</button> <button type="button" class="secondary" data-shared-csv>📤 Exporta CSV</button></section>' +
      '<section class="card"><h3>👥 Participants (' + members.length + ')</h3><p class="muted">Es reutilitzen els membres d’aquest viatge. Cadascú pot posar el seu nom visible al grup.</p><form data-shared-label class="shared-expense-inline"><label>El meu nom<input data-shared-my-name type="text" maxlength="60" placeholder="Nom visible" value="' + escapeHtml(labels.find(l => l.user_id === userId)?.display_name || '') + '" required></label><button type="submit">Desa el nom</button></form><p class="muted">Si falta algú, convida’l des de «Viatgers» al tauler.</p></section>' +
      '<section class="card"><h3>📊 Com van els comptes?</h3>' + (summaries.length ? summaries.map(g => '<section class="shared-expense-currency"><h4>' + escapeHtml(g.currency) + ' · ' + money(g.expenseCents, g.currency) + ' gastats</h4>' +
        [...g.balances].map(([id, cents]) => '<p><strong>' + escapeHtml(name(id)) + '</strong>: ' + (cents > 0 ? 'li deuen ' : cents < 0 ? 'deu ' : 'al dia ') + money(Math.abs(cents), g.currency) + '</p>').join('') +
        '<h4>Per saldar els comptes</h4>' + (g.suggestions.length ? g.suggestions.map(s => '<div class="shared-expense-settle"><span>' + escapeHtml(name(s.from)) + ' → ' + escapeHtml(name(s.to)) + ': <strong>' + money(s.amount_cents, s.currency) + '</strong></span>' + (members.some(m => m.user_id === s.from) && members.some(m => m.user_id === s.to) ? '<button type="button" class="secondary" data-propose-payment="' + escapeHtml(s.from + '|' + s.to + '|' + s.amount_cents + '|' + s.currency) + '">Registra el pagament</button>' : '<small>Participant antic: liquidació manual pendent</small>') + '</div>').join('') : '<p>Tot saldat en aquesta moneda. ✅</p>') + '</section>').join('') : '<p class="muted">Quan afegiu la primera despesa, aquí veureu què deu cadascú.</p>') +
      (legacyCount ? '<p class="muted">Hi ha ' + legacyCount + ' despeses antigues sense repartiment: es conserven i no es compten com a deutes.</p>' : '') + '</section>' +
      '<section class="card"><h3>＋ Afegir una despesa</h3><form data-shared-expense class="shared-expense-form">' +
      '<label>Concepte<input name="description" maxlength="200" placeholder="Sopar, taxi, entrades..." required></label>' +
      '<div class="shared-expense-inline"><label>Import<input name="amount" type="number" inputmode="decimal" min="0.01" max="999999999.99" step="0.01" required></label><label>Moneda ISO<input name="currency" maxlength="3" pattern="[A-Z]{3}" value="' + escapeHtml(currency) + '" required></label></div>' +
      '<div class="shared-expense-inline"><label>Ha pagat<select name="payer" required>' + memberOptions(userId) + '</select></label><label>Data<input name="date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label></div>' +
      '<label>Categoria<select name="category"><option>Menjar</option><option>Transport</option><option>Entrades</option><option>Allotjament</option><option>Compres</option><option>Altres</option></select></label>' +
      '<fieldset><legend>Entre qui repartim la despesa?</legend><label><input type="radio" name="mode" value="equal" checked> A parts iguals</label> <label><input type="radio" name="mode" value="custom"> Imports personalitzats</label><div data-shared-participants></div></fieldset>' +
      '<button type="submit" data-shared-save>Desa la despesa</button></form></section>' +
      '<section class="card"><h3>💸 Registrar un pagament ja fet</h3><p class="muted">Només registra un Bizum, transferència o pagament en efectiu que ja s’ha realitzat. Freya no mou diners.</p>' +
      '<form data-shared-payment class="shared-expense-form"><div class="shared-expense-inline"><label>Qui ha pagat<select name="payer" required>' + memberOptions(userId) + '</select></label><label>Qui ha rebut<select name="receiver" required>' + memberOptions(members.find(m => m.user_id !== userId)?.user_id) + '</select></label></div>' +
      '<div class="shared-expense-inline"><label>Import<input name="amount" type="number" min="0.01" max="999999999.99" inputmode="decimal" step="0.01" required></label><label>Moneda ISO<input name="currency" maxlength="3" pattern="[A-Z]{3}" value="' + escapeHtml(currency) + '" required></label></div><button type="submit" data-shared-pay>Registra la liquidació</button></form></section>' +
      '<section class="card"><h3>🧾 Moviments</h3>' + ([...rows.filter(r => r.payer_user_id && r.split_shares).map(r => ({ kind:'expense',...r })), ...settlements.map(r => ({ kind:'settlement',...r }))].sort((a,b) => (b.created_at || '').localeCompare(a.created_at || '')).map(r => {
        const cents = amountToCents(String(r.amount));
        const description = r.kind === 'expense' ? r.description : 'Liquidació · ' + name(r.payer_user_id) + ' → ' + name(r.receiver_user_id);
        return '<div class="shared-expense-movement"><div><strong>' + escapeHtml(description) + '</strong><small>' + escapeHtml(name(r.payer_user_id)) + ' · ' + escapeHtml(r.expense_date || r.created_at?.slice(0,10) || '') + '</small></div><strong>' + money(cents,r.currency) + '</strong>' + (r.created_by === userId ? '<button type="button" class="secondary" data-shared-remove="' + escapeHtml(r.kind + '|' + r.id) + '">Elimina</button>' : '') + '</div>';
      }).join('') || '<p class="muted">Encara no hi ha moviments.</p>') + '</section>';
    renderParticipantChoices();
    root.querySelector('[data-shared-refresh]').onclick = () => void load();
    root.querySelector('[data-shared-csv]').onclick = exportCSV;
    root.querySelectorAll('input[name="mode"]').forEach(input => input.onchange = () => {
      mode = input.value;
      root.querySelectorAll('[data-split-amount]').forEach(amount => { const box = root.querySelector('[data-split-member="' + amount.dataset.splitAmount + '"]'); amount.disabled = mode !== 'custom' || !box?.checked; });
    });
    root.querySelector('[data-shared-label]').onsubmit = saveLabel;
    root.querySelector('[data-shared-expense]').onsubmit = saveExpense;
    root.querySelector('[data-shared-payment]').onsubmit = savePayment;
    root.querySelectorAll('[data-propose-payment]').forEach(button => button.onclick = () => {
      const [from, to, cents, iso] = button.dataset.proposePayment.split('|');
      const form = root.querySelector('[data-shared-payment]');
      form.elements.payer.value = from;
      form.elements.receiver.value = to;
      form.elements.amount.value = (Number(cents) / 100).toFixed(2);
      form.elements.currency.value = iso;
      form.scrollIntoView({ behavior:'smooth', block:'center' });
    });
    root.querySelectorAll('[data-shared-remove]').forEach(button => button.onclick = () => void remove(button.dataset.sharedRemove));
  }

  async function load() {
    const serial = ++request;
    if (!active()) return;
    root.textContent = 'Carregant despeses compartides…';
    const queries = await Promise.all([
      db.from('trip_members').select('user_id,created_at').eq('trip_id',tripId).order('created_at'),
      db.from('trip_expense_member_labels').select('user_id,display_name').eq('trip_id',tripId),
      db.from('travel_expenses').select('id,description,amount,currency,paid_by,payer_user_id,split_shares,expense_date,created_at,created_by').eq('trip_id',tripId).order('created_at',{ascending:false}),
      db.from('trip_expense_settlements').select('id,trip_id,payer_user_id,receiver_user_id,amount,currency,created_by,created_at').eq('trip_id',tripId).order('created_at',{ascending:false})
    ]);
    if (!active() || serial !== request) return;
    const error = queries.find(q => q.error)?.error;
    if (error) {
      root.innerHTML = '<section class="card"><h2>Despeses compartides</h2><p class="message error" role="alert">No hem pogut carregar el mòdul. Cal que la migració de despeses compartides estigui aplicada i que tinguis connexió.</p><p class="muted">' + escapeHtml(error.message) + '</p><button type="button" data-shared-retry>Torna-ho a provar</button></section>';
      root.querySelector('[data-shared-retry]').onclick = () => void load();
      return;
    }
    members = queries[0].data || [];
    labels = queries[1].data || [];
    rows = queries[2].data || [];
    settlements = queries[3].data || [];
    render();
  }

  async function action(run, text) {
    if (busy || !active()) return;
    busy = true;
    const buttons = root.querySelectorAll('button[type="submit"]');
    buttons.forEach(button => button.disabled = true);
    try {
      await run();
      if (active()) { await load(); status(text); }
    } catch (error) {
      if (active()) status((error?.message || 'No s’ha pogut desar.') + ' Comprova els moviments abans de tornar-ho a intentar.',true);
    } finally {
      busy = false;
      buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
    }
  }

  function saveLabel(event) {
    event.preventDefault();
    const display_name = root.querySelector('[data-shared-my-name]').value.trim();
    if (!display_name || display_name.length > 60) { status('Indica un nom vàlid.',true); return; }
    void action(async () => {
      const {error} = await db.from('trip_expense_member_labels').upsert({trip_id:tripId,user_id:userId,display_name},{onConflict:'trip_id,user_id'});
      if (error) throw error;
    }, 'Nom desat.');
  }

  function saveExpense(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const description = form.elements.description.value.trim();
    const amount = readNumber(form.elements.amount.value);
    const iso = form.elements.currency.value.trim().toUpperCase();
    const payer = form.elements.payer.value;
    const included = [...root.querySelectorAll('[data-split-member]')].filter(el => el.checked).map(el => el.dataset.splitMember);
    let shares, cents;
    try {
      cents = amountToCents(amount);
      if (!description || description.length > 200 || !isoCurrency(iso) || !members.some(m => m.user_id === payer)) throw Error('Revisa el concepte, la moneda i qui ha pagat.');
      shares = mode === 'equal' ? equalShares(cents,included) : customShares(cents,included.map(user_id => ({user_id,amount:root.querySelector('[data-split-amount="' + user_id + '"]').value})));
    } catch (error) { status(error.message,true); return; }
    currency = iso;
    void action(async () => {
      const payload = {trip_id:tripId,description,amount:(cents/100).toFixed(2),currency:iso,paid_by:name(payer),payer_user_id:payer,split_shares:shares,category:form.elements.category.value,expense_date:form.elements.date.value||null,created_by:userId};
      const {error} = await db.from('travel_expenses').insert(payload);
      if (error) throw error;
    }, 'Despesa desada i repartida.');
  }

  function savePayment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payer = form.elements.payer.value, receiver = form.elements.receiver.value;
    const iso = form.elements.currency.value.trim().toUpperCase();
    let cents;
    try {
      cents = amountToCents(form.elements.amount.value);
      if (!isoCurrency(iso) || payer === receiver || !members.some(m => m.user_id === payer) || !members.some(m => m.user_id === receiver))
        throw Error('Indica dos participants diferents i una moneda vàlida.');
      if (userId !== payer && userId !== receiver) throw Error('Només pots registrar pagaments en què hagis participat.');
    } catch (error) { status(error.message,true); return; }
    if (!globalThis.confirm('Confirma que el pagament ja s’ha fet realment?')) return;
    currency = iso;
    void action(async () => {
      const {error} = await db.from('trip_expense_settlements').insert({trip_id:tripId,payer_user_id:payer,receiver_user_id:receiver,amount:(cents/100).toFixed(2),currency:iso,created_by:userId});
      if (error) throw error;
    }, 'Liquidació registrada.');
  }

  function remove(value) {
    const [kind,id] = value.split('|');
    const record = (kind === 'expense' ? rows : settlements).find(r => r.id === id);
    if (!record || record.created_by !== userId || !globalThis.confirm('Eliminar aquest moviment?')) return;
    void action(async () => {
      const table = kind === 'expense' ? 'travel_expenses' : 'trip_expense_settlements';
      const {error} = await db.from(table).delete().eq('trip_id',tripId).eq('id',id).eq('created_by',userId);
      if (error) throw error;
    }, 'Moviment eliminat.');
  }

  function exportCSV() {
    const csvField = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
    const records = [['Tipus','Data','Concepte','Import','Moneda','Pagador','Destinatari','Repartiment']];
    rows.filter(x => x.payer_user_id && x.split_shares).forEach(x => records.push(['Despesa',x.expense_date||'',x.description,x.amount,x.currency,name(x.payer_user_id),'',x.split_shares.map(s => name(s.user_id) + ':' + (Number(s.amount_cents)/100).toFixed(2)).join('; ')]));
    settlements.forEach(x => records.push(['Liquidació',x.created_at?.slice(0,10)||'','',x.amount,x.currency,name(x.payer_user_id),name(x.receiver_user_id),'']));
    const blob = new Blob(['\ufeff' + records.map(row => row.map(csvField).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'despeses-compartides.csv'; a.click(); URL.revokeObjectURL(url);
  }

  void load();
  return {dispose() { alive = false; request++; root.replaceChildren(); }};
}
