/**
 * Unit test for the browser preference store (no DOM, no harness).
 * The client half is TypeScript, so this relies on Node's native type
 * stripping (Node 22.6+/24); on an older runtime the suite skips itself rather
 * than failing the build.
 * Run: node test/prefs.mjs
 */
let createPrefsStore, PREFS_FALLBACK, SETTINGS_NS
try {
  ({ createPrefsStore, PREFS_FALLBACK, SETTINGS_NS } = await import('../src/client/worktreePrefs.ts'))
} catch (error) {
  console.log(`SKIP prefs — this Node cannot import TypeScript sources (${error.code ?? error.message}); requires Node 22.6+`)
  process.exit(0)
}

let failed = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failed += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * A stand-in for the client settings scope.
 * @param behavior - `accept` folds a write into the snapshot, `refuse` leaves it
 *   unchanged (the transport resolves either way — that is the whole point).
 */
function fakeBinder(section, behavior = 'accept') {
  const listeners = new Set()
  const writes = []
  let spec
  let snapshot = {
    status: 'ready',
    value: section,
    writable: true,
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async set(field, value) {
      writes.push({ field, value })
      if (behavior !== 'accept') return
      snapshot = { ...snapshot, value: { ...snapshot.value, [field]: value } }
    },
  }
  return {
    binder: { bind: (bound) => { spec = bound; return scope } },
    writes,
    getSpec: () => spec,
    publish(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

console.log('binding')
{
  const fake = fakeBinder({ defaultMode: 'worktree', rememberLastChoice: false })
  const store = createPrefsStore()
  const unsubscribe = store.bind(fake.binder)
  check('binds the plugin namespace', fake.getSpec().namespace === SETTINGS_NS, fake.getSpec().namespace)
  check('declares a decoder', typeof fake.getSpec().decode === 'function')
  check('adopts the accepted section', store.getSnapshot().defaultMode === 'worktree' && store.getSnapshot().rememberLastChoice === false, JSON.stringify(store.getSnapshot()))
  check('reports the scope as available', store.getSnapshot().available === true)
  check('the decoder narrows known values', JSON.stringify(fake.getSpec().decode({ defaultMode: 'worktree', rememberLastChoice: 'yes' })) === JSON.stringify({ defaultMode: 'worktree', rememberLastChoice: true }))
  check('the decoder rejects a non-object section', fake.getSpec().decode(undefined) === undefined && fake.getSpec().decode('nonsense') === undefined)
  check('unbinding is a function', typeof unsubscribe === 'function')
  unsubscribe()
}

console.log('reactivity')
{
  const fake = fakeBinder({ defaultMode: 'local', rememberLastChoice: true })
  const store = createPrefsStore()
  store.bind(fake.binder)
  let notified = 0
  const unsubscribe = store.subscribe(() => { notified += 1 })
  fake.publish({ status: 'ready', value: { defaultMode: 'worktree', rememberLastChoice: true }, writable: true })
  check('a committed change notifies once', notified === 1 && store.getSnapshot().defaultMode === 'worktree', `${notified} / ${JSON.stringify(store.getSnapshot())}`)
  fake.publish({ status: 'ready', value: { defaultMode: 'worktree', rememberLastChoice: true }, writable: true })
  check('an equal snapshot does not notify', notified === 1)
  unsubscribe()
}

console.log('writes')
{
  const fake = fakeBinder({ defaultMode: 'local', rememberLastChoice: true })
  const store = createPrefsStore()
  store.bind(fake.binder)
  const accepted = await store.setDefaultMode('worktree')
  check('an accepted write reports true', accepted === true, JSON.stringify(store.getSnapshot()))
  check('the write carries the field and value', JSON.stringify(fake.writes) === JSON.stringify([{ field: 'defaultMode', value: 'worktree' }]), JSON.stringify(fake.writes))
  const remember = await store.setRememberLastChoice(false)
  check('the remember toggle writes its own field', remember === true && fake.writes[1].field === 'rememberLastChoice')

  const refusing = fakeBinder({ defaultMode: 'local', rememberLastChoice: true }, 'refuse')
  const refused = createPrefsStore()
  refused.bind(refusing.binder)
  const ok = await refused.setDefaultMode('worktree')
  check('a transport that resolves while the host refuses reports false', ok === false)
}

console.log('without a bound scope')
{
  const store = createPrefsStore()
  check('the fallback is local + remember, unavailable', store.getSnapshot().defaultMode === 'local' && store.getSnapshot().rememberLastChoice === true && store.getSnapshot().available === false, JSON.stringify(store.getSnapshot()))
  check('the fallback reports loading, not unavailable', store.getSnapshot().status === 'loading')
  check('the exported fallback matches', store.getSnapshot().defaultMode === PREFS_FALLBACK.defaultMode && store.getSnapshot().available === PREFS_FALLBACK.available)
  check('a write without a scope reports false', (await store.setDefaultMode('worktree')) === false)
}

console.log('unavailable / unwritable scope')
{
  const fake = fakeBinder({ defaultMode: 'worktree', rememberLastChoice: true })
  const store = createPrefsStore()
  store.bind(fake.binder)
  fake.publish({ status: 'unavailable', value: undefined, writable: false })
  check('reports unavailable', store.getSnapshot().available === false && store.getSnapshot().status === 'unavailable')
  check('falls back to local while unavailable', store.getSnapshot().defaultMode === 'local', JSON.stringify(store.getSnapshot()))
}

console.log(failed === 0 ? '\nPREFS OK — all checks passed' : `\nPREFS FAILED — ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
