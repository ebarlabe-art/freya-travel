import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const bridge = await read('freya-travel-v1.5/index.html');
const bridgeScript = bridge.match(/<script>([\s\S]*?)<\/script>/)[1];

test('generated fallback is byte-identical', async () => {
  assert.equal(await read('index.html'), await read('404.html'));
});

test('generator rejects divergence/missing output, then writes exact bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'freya-entry-test-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await copyFile(new URL('scripts/app-entries.mjs', root), join(dir, 'scripts/app-entries.mjs'));
    await writeFile(join(dir, 'index.html'), '<!doctype html>\nprova à\n');
    const run = (...args) => spawnSync(process.execPath, [join(dir, 'scripts/app-entries.mjs'), ...args]);
    assert.equal(run().status, 1);
    await writeFile(join(dir, '404.html'), 'stale');
    assert.equal(run().status, 1);
    assert.equal(run('--write').status, 0);
    assert.equal(run().status, 0);
    assert.deepEqual(await readFile(join(dir, 'index.html')), await readFile(join(dir, '404.html')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const suffix of [
  '', '?view=london', '?view=tickets&ticket=london-eye#event-2-3',
  '?view=itinerary&trip=trip-a&source=activity&source_id=item-a&kind=activity_start',
  '?view=password-recovery&code=a%2Bb%2F%3D&state=one&state=two',
  '#access_token=fake%2Btoken&refresh_token=fake&type=recovery',
  '?error=access_denied#error_description=Example%20error',
  '?redirect=https%3A%2F%2Fevil.example&next=%2F%2Fevil.example#javascript:alert(1)',
]) {
  for (const path of ['freya-travel-v1.5/', 'freya-travel-v1.5/index.html', 'freya-travel-v1.5']) {
    test(`bridge preserves opaque route/auth data: ${path}${suffix}`, () => {
      const location = new URL(`https://example.test/freya-travel/${path}${suffix}`);
      let replaced;
      const link = {};
      vm.runInNewContext(bridgeScript, {
        URL,
        window: { location: { origin: location.origin, search: location.search, hash: location.hash, replace: value => { replaced = value; } } },
        document: { getElementById: id => { assert.equal(id, 'continueLink'); return link; } },
      });
      const destination = new URL(replaced);
      assert.equal(destination.origin, location.origin);
      assert.equal(destination.pathname, '/freya-travel/');
      assert.equal(destination.search, location.search);
      assert.equal(destination.hash, location.hash);
      assert.equal(link.href, replaced);
    });
  }
}

test('HTML inline JavaScript syntax and unique literal IDs', async () => {
  for (const path of ['index.html', '404.html', 'freya-travel-v1.5/index.html']) {
    const html = await read(path);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]).filter(id => !id.includes('${'));
    assert.equal(new Set(ids).size, ids.length, `${path}: duplicate literal IDs`);
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc=/.test(match[1])) continue;
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: match[2], encoding: 'utf8' });
      assert.equal(result.status, 0, `${path}: ${result.stderr}`);
    }
  }
});

test('bridge uses main manifest; London still returns to main', async () => {
  assert.match(bridge, /href="\/freya-travel\/manifest.webmanifest"/);
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.match(await read('freya-travel-v1.5/itinerary.html'), /href="\.\.\/index.html\?view=london"/);
});

test('unchanged SW precache assets exist and offline entry fallbacks remain valid', async () => {
  const handlers = {};
  const lookups = [];
  const sw = await read('sw.js');
  const context = vm.createContext({
    URL,
    self: { location: new URL('https://example.test/freya-travel/sw.js'), addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: () => Promise.reject(new Error('offline')),
    caches: { match: async key => { lookups.push(key); return { key }; } },
  });
  vm.runInContext(sw, context);
  for (const asset of vm.runInContext('ASSETS', context)) await access(new URL(asset, root));
  for (const [path, expected] of [
    ['freya-travel-v1.5/', './freya-travel-v1.5/index.html'],
    ['freya-travel-v1.5/index.html', './freya-travel-v1.5/index.html'],
    ['?view=password-recovery#type=recovery', './index.html'],
    ['freya-travel-v1.5/itinerary.html?activity=123', './freya-travel-v1.5/itinerary.html'],
  ]) {
    let response;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', destination: 'document', url: `https://example.test/freya-travel/${path}` }, respondWith: promise => { response = promise; } });
    assert.equal((await response).key, expected);
    assert.equal(lookups.at(-1), expected);
  }
});
