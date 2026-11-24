// A3.1: reuse the trip membership and the existing per-trip expense nickname.
// No user emails, auth metadata, new roles or duplicate membership storage.
export function buildTripParticipantRoster(members, labels, ownerId, viewerId) {
  const names = new Map((labels || []).filter(row => row && typeof row.display_name === 'string' && row.display_name.trim())
    .map(row => [row.user_id, row.display_name.trim()]));
  const seen = new Set();
  return (members || []).filter(row => {
    if (!row?.user_id || seen.has(row.user_id)) return false;
    seen.add(row.user_id);
    return true;
  }).map((row, index) => {
    const isOwner = row.user_id === ownerId;
    const isYou = row.user_id === viewerId;
    return {
      userId: row.user_id,
      isOwner,
      isYou,
      customName: names.get(row.user_id) || '',
      name: names.get(row.user_id) || (isYou ? 'Tu' : isOwner ? 'Organitzador/a' : 'Viatger ' + (index + 1)),
    };
  }).sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

export async function fetchTripParticipants({ db, tripId, viewerId, ownerId }) {
  if (!db || !tripId || !viewerId) throw new Error('No es pot identificar el viatge i el teu compte.');
  const [membership, labels] = await Promise.all([
    db.from('trip_members').select('user_id,created_at').eq('trip_id', tripId).order('created_at', { ascending: true }),
    db.from('trip_expense_member_labels').select('user_id,display_name').eq('trip_id', tripId),
  ]);
  if (membership.error) throw membership.error;
  if (labels.error) throw labels.error;
  if (!(membership.data || []).some(row => row.user_id === viewerId))
    throw new Error('Ja no tens accés a aquest viatge. Actualitza els teus viatges.');
  return buildTripParticipantRoster(membership.data, labels.data, ownerId, viewerId);
}

export async function saveOwnParticipantName({ db, tripId, viewerId, name }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 60) throw new Error('Escriu un nom d’entre 1 i 60 caràcters.');
  if (!db || !tripId || !viewerId) throw new Error('No es pot identificar el viatge i el teu compte.');
  const saved = await db.from('trip_expense_member_labels')
    .upsert({ trip_id: tripId, user_id: viewerId, display_name: trimmed }, { onConflict: 'trip_id,user_id' })
    .select('display_name')
    .maybeSingle();
  if (saved.error) throw saved.error;
  if (!saved.data) throw new Error('No s’ha pogut confirmar el nom desat.');
  return saved.data.display_name;
}
