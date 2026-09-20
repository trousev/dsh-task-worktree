/**
 * Unit test for the worktree-mode arming policy (no harness required).
 * Covers: explicit arming, the settings-driven default on empty conversations,
 * the explicit-local override, resumed conversations, late session-start
 * beacons, and disposal cleanup.
 * Run: node test/mode.mjs
 */
import { createModeArmer } from '../lib/mode.js'

let failed = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failed += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A settings reader the test can flip, mirroring the live namespace. */
function settings(defaultMode) {
  const state = { defaultMode }
  return {
    read: () => state.defaultMode,
    set: (mode) => { state.defaultMode = mode },
  }
}

/** A fake agent: records every injected instruction. */
function agent(id, seq = 0) {
  const injected = []
  return {
    id,
    session: { seq },
    injected,
    inject: (message) => { injected.push(message) },
  }
}

/** One genuine human prompt, as the inbox event delivers it. */
const userMessage = { source: { kind: 'user' } }
const pluginMessage = { source: { kind: 'plugin', plugin: 'other' } }

function armerFor(defaultMode) {
  const prefs = settings(defaultMode)
  const armer = createModeArmer({ defaultMode: prefs.read, inject: (target, name) => { target.inject({ name }) } })
  return { armer, prefs }
}

console.log('explicit arming (mode-on)')
{
  const { armer } = armerFor('local')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.arm('s1', ' worktree/login ')
  armer.inboxInserted(a, userMessage)
  check('armed name is trimmed and injected once', a.injected.length === 1 && a.injected[0].name === 'worktree/login', JSON.stringify(a.injected))
  armer.inboxInserted(a, userMessage)
  check('no second injection on the next message', a.injected.length === 1)
}

console.log('explicit arming without a name (model proposes one)')
{
  const { armer } = armerFor('local')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.arm('s1', undefined)
  armer.inboxInserted(a, userMessage)
  check('injected with no name', a.injected.length === 1 && a.injected[0].name === undefined)
}

console.log('plugin-produced messages never ride an injection')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.inboxInserted(a, pluginMessage)
  check('plugin message ignored', a.injected.length === 0)
}

console.log('default mode: local')
{
  const { armer } = armerFor('local')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.inboxInserted(a, userMessage)
  check('a blank conversation stays local by default', a.injected.length === 0)
}

console.log('default mode: worktree')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.inboxInserted(a, userMessage)
  check('the first message of a blank conversation auto-arms', a.injected.length === 1)
  armer.inboxInserted(a, userMessage)
  check('the decision is made once per conversation', a.injected.length === 1)
}

console.log('default mode changed mid-flight')
{
  const { armer, prefs } = armerFor('worktree')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  prefs.set('local')
  armer.inboxInserted(a, userMessage)
  check('a default switched to local before the first message is honoured', a.injected.length === 0)
}

console.log('explicit local override beats the default')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.disarm('s1')
  armer.inboxInserted(a, userMessage)
  check('mode-off suppresses the configured default', a.injected.length === 0)
}

console.log('re-arming after an explicit local choice')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1')
  armer.sessionStart(a, 'startup')
  armer.disarm('s1')
  armer.arm('s1', 'worktree/late')
  armer.inboxInserted(a, userMessage)
  check('mode-on clears the suppression and injects', a.injected.length === 1 && a.injected[0].name === 'worktree/late')
}

console.log('resumed conversations are never auto-armed')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1', 42)
  armer.sessionStart(a, 'resume')
  armer.inboxInserted(a, userMessage)
  check('a resumed session keeps its own mode', a.injected.length === 0)
}

console.log('late session-start beacon cannot double-inject')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1', 0)
  // The message is observed before the lifecycle beacon (agent created by the
  // send): the seq===0 fallback decides, and the late beacon must not re-add it.
  armer.inboxInserted(a, userMessage)
  armer.sessionStart(a, 'startup')
  armer.inboxInserted(a, userMessage)
  check('exactly one injection', a.injected.length === 1, JSON.stringify(a.injected))
}

console.log('disposal clears per-session state')
{
  const { armer } = armerFor('worktree')
  const a = agent('s1', 0)
  armer.sessionStart(a, 'startup')
  armer.disarm('s1')
  armer.disposed(a)
  check('every per-session fact is dropped', JSON.stringify(armer.inspect()) === JSON.stringify({ armed: 0, decided: 0, suppressed: 0, fresh: 0 }), JSON.stringify(armer.inspect()))
  const b = agent('s1', 0)
  armer.sessionStart(b, 'startup')
  armer.inboxInserted(b, userMessage)
  check('a fresh conversation on the same id auto-arms again', b.injected.length === 1)
}

console.log(failed === 0 ? '\nMODE OK — all checks passed' : `\nMODE FAILED — ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
