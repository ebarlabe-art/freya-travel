// TB-01: domain contract only; deliberately not loaded by the current app.
const text = (max = 200) => ({ type: 'string', minLength: 1, maxLength: max, pattern: '\\S' });
const integer = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const enumeration = (...values) => ({ enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const list = (items, max = 30) => ({ type: 'array', items, minItems: 1, maxItems: max, uniqueItems: true });
const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
const date = { type: 'string', pattern: '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$', format: 'date' };
const time = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const money = { type: 'number', minimum: 0, maximum: 100000000, multipleOf: 0.01 };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const boolean = { type: 'boolean' };
const bag = object({ kind: enumeration('personal', 'cabin', 'checked', 'other'), quantity: integer(1, 20), weight_kg: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, note: text(500) }, ['kind', 'quantity']);
const baggage = object({ shared: list(bag), per_traveler: { type: 'object', propertyNames: id, maxProperties: 30, additionalProperties: list(bag) } }, []);
const budget = { oneOf: [
  object({ mode: { const: 'price_discovery' }, includes: list(text(80)) }, ['mode']),
  ...['target', 'maximum', 'target_stretch'].map(mode => object({ mode: { const: mode }, currency, amount: money, ...(mode === 'target_stretch' ? { stretch: money } : {}), includes: list(text(80)) }, ['mode', 'currency', 'amount', ...(mode === 'target_stretch' ? ['stretch'] : [])])),
] };
export const valueSchemas = {
  dates: { oneOf: [object({ mode: { const: 'exact' }, start: date, end: date }), object({ mode: { const: 'window' }, earliest: date, latest: date })] },
  'dates.flexibility_days': integer(0, 365),
  origin: object({ places: list(text(120)) }),
  destination: { oneOf: [object({ mode: { const: 'open' } }), object({ mode: enumeration('known', 'partial'), places: list(text(120)) })] },
  duration: object({ unit: enumeration('days', 'nights'), min: integer(1, 730), max: integer(1, 730) }),
  pace: enumeration('relaxed', 'balanced', 'active'), budget,
  interests: list(text(80)),
  'flight.departure_window': object({ weekdays: list(integer(1, 7), 7), local_date: date, min: time, max: time, time_zone: text(100) }, []),
  'flight.arrival_window': object({ weekdays: list(integer(1, 7), 7), local_date: date, min: time, max: time, time_zone: text(100) }, []),
  'flight.max_stops': integer(0, 5), 'flight.max_duration_minutes': integer(1, 4320),
  'flight.alternative_airports': list(text(120)), 'flight.low_cost': boolean,
  baggage,
  'hotel.comfort': enumeration('economic', 'comfortable', 'special'),
  'hotel.location': enumeration('central', 'well_connected'),
  'hotel.room': object({ type: text(100), rooms: integer(1, 30), occupancy: integer(1, 60) }, ['type']),
  'hotel.breakfast': boolean, 'hotel.cancellation': enumeration('free', 'refundable', 'non_refundable_acceptable'),
  'hotel.amenities': list(text(80)),
  'hotel.stars': integer(1, 5),
  'hotel.rating': object({ min: { type: 'number', minimum: 0, maximum: 10 }, scale: enumeration(5, 10), source: text(100) }),
  'experience.styles': list(enumeration('independent', 'audio_guide', 'guided_visit', 'organized_excursion', 'independent_excursion', 'combination')),
  notes: text(2000),
};
const fields = Object.keys(valueSchemas);
const field = { anyOf: [{ enum: fields }, { type: 'string', pattern: '^custom\\.[a-z][a-z0-9_]{0,49}$' }] };
const common = { field, scope: { anyOf: [{ const: 'global' }, id] }, origin: enumeration('explicit_user', 'interpreted_from_user', 'system_default') };
const decision = { oneOf: [
  object({ ...common, knowledge: { const: 'unknown' } }),
  object({ ...common, knowledge: { const: 'indifferent' }, strength: enumeration('hard', 'preference', 'flexible') }),
  { ...object({ ...common, knowledge: { const: 'known' }, strength: enumeration('hard', 'preference', 'flexible'), value: {} }), allOf: [
    ...Object.entries(valueSchemas).map(([key, schema]) => ({ if: { properties: { field: { const: key } } }, then: { properties: { value: schema } } })),
    { if: { properties: { field: { pattern: '^custom\\.' } } }, then: { properties: { value: text(1000) } } },
  ] },
] };
const map = (item, max) => ({ type: 'object', propertyNames: id, maxProperties: max, additionalProperties: item });
export const briefSchemaV1 = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  ...object({
    decisions: map(decision, 200),
    scopes: map(object({ kind: enumeration('destination', 'stay', 'component', 'leg'), parent: { anyOf: [{ const: 'global' }, id] }, label: text(120) }), 50),
    travelers: map(object({ kind: enumeration('adult', 'child'), age: integer(0, 17) }, ['kind']), 30),
  }),
};
export function emptyBriefDocument() { return { decisions: {}, scopes: {}, travelers: {} }; }

// Nearest explicit decision wins; an unconfirmed interpretation never shadows
// an explicit ancestor. Unknown overrides preserve ignorance, never indifference.
export function resolveBriefDecision(document, fieldName, scope = 'global') {
  const chain = [], seen = new Set();
  for (let current = scope; ; current = document.scopes[current]?.parent) {
    if (!current || seen.has(current)) throw new Error('Invalid scope chain');
    seen.add(current); chain.push(current); if (current === 'global') break;
  }
  const matches = chain.map(s => Object.entries(document.decisions).find(([, d]) => d.field === fieldName && d.scope === s)).filter(Boolean);
  const selected = matches.find(([, d]) => d.origin === 'explicit_user') || matches[0];
  return selected ? { id: selected[0], decision: structuredClone(selected[1]), requiresConfirmation: selected[1].origin !== 'explicit_user' } : null;
}

// Prepare once, persist the command if necessary, retry exactly the same command.
// Never generate a new operation ID inside the transport retry path.
export function prepareBriefPatch({ briefId = crypto.randomUUID(), operationId = crypto.randomUUID(), expectedRevision = 0, set = {}, remove = {}, confirmHard = [] } = {}) {
  return structuredClone({ p_brief_id: briefId, p_operation_id: operationId, p_expected_revision: expectedRevision, p_set: set, p_remove: remove, p_confirm_hard: confirmHard });
}
export async function applyBriefPatch(client, command) {
  const { data, error } = await client.rpc('apply_trip_brief_patch_v1', command);
  if (error) { const failure = new Error(error.message); failure.code = error.code; throw failure; }
  return data;
}
export async function readBrief(client, id) {
  const { data, error } = await client.from('trip_briefs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
