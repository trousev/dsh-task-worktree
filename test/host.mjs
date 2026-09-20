/**
 * Host-half test for dsh-task-worktree (no harness boot).
 *
 * Mounts the real plugin `apply()` on a minimal fake cordis context and
 * asserts the two things the settings feature depends on:
 *  - the `task-worktree` settings namespace is registered with the expected
 *    schema and composed defaults;
 *  - the worktree-creation instruction is injected with the first genuine user
 *    message of a conversation that starts under the worktree default, and NOT
 *    when the user answered "local" for that conversation.
 *
 * Run: node test/host.mjs
 */
import { apply, SETTINGS_NS, WorktreeSettings } from '../lib/index.js'

let failed = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failed += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Minimal cordis-like context that records what the plugin registers. */
function fakeContext() {
  const handlers = new Map()
  const registrations = { tools: [], commands: [], settings: [], effects: [] }
  const resolved = { defaultMode: 'local', rememberLastChoice: true }
  const ctx = {
    registrations,
    resolved,
    __handlers: handlers,
    get(name) {
      if (name === 'subprocess') return { spawn: () => { throw new Error('not used in this test') } }
      return undefined
    },
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
    effect(callback) {
      registrations.effects.push(callback)
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    inject(services, callback) {
      if (Array.isArray(services) && services.includes('settings')) callback(ctx)
    },
    tools: { register: (tool) => { registrations.tools.push(tool) } },
    commands: { register: (command) => { registrations.commands.push(command) } },
    settings: {
      register(ns, schema, options) {
        registrations.settings.push({ ns, schema, options })
        return { get: () => ({ ...resolved }), watch: () => () => {} }
      },
    },
  }
  return ctx
}

/** Fire one harness event at the mounted plugin. */
function emit(ctx, event, payload) {
  for (const handler of ctx.__handlers.get(event) ?? []) handler(payload)
}

/** A fake agent: records injected messages. */
function agentWith(id, seq = 0) {
  const injected = []
  return { id, session: { seq }, injected, inject: (message) => { injected.push(message) } }
}

const textOf = (message) => message?.content?.[0]?.text ?? ''

console.log('settings namespace registration')
{
  const ctx = fakeContext()
  apply(ctx)
  const entry = ctx.registrations.settings[0]
  check('namespace is task-worktree', entry?.ns === SETTINGS_NS, JSON.stringify(entry?.ns))
  check('composed defaults are the base', entry?.options?.base?.defaultMode === 'local' && entry?.options?.base?.rememberLastChoice === true, JSON.stringify(entry?.options?.base))
  const resolved = entry.schema({})
  check('schema defaults to local + remember', resolved.defaultMode === 'local' && resolved.rememberLastChoice === true, JSON.stringify(resolved))
  const worktree = entry.schema({ defaultMode: 'worktree' })
  check('schema accepts worktree', worktree.defaultMode === 'worktree')
  let rejected = false
  try { entry.schema({ defaultMode: 'nonsense' }) } catch { rejected = true }
  check('schema rejects an unknown mode', rejected)
}

console.log('tools and command still mount')
{
  const ctx = fakeContext()
  apply(ctx)
  const toolNames = ctx.registrations.tools.map((tool) => tool.name)
  check('three model tools registered', toolNames.length === 3 && toolNames.includes('worktree_create'), JSON.stringify(toolNames))
  check('the /worktree command is registered', ctx.registrations.commands.some((command) => command.name === 'worktree'))
}

console.log('default worktree: first message of a blank conversation')
{
  const ctx = fakeContext()
  ctx.resolved.defaultMode = 'worktree'
  apply(ctx)
  const agent = agentWith('s1')
  emit(ctx, 'agent/session-start', { agent, source: 'startup' })
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('exactly one instruction injected', agent.injected.length === 1, String(agent.injected.length))
  check('the instruction asks for worktree_create', textOf(agent.injected[0]).includes('worktree_create'))
  check('it is a plugin-sourced instruction block', agent.injected[0]?.source?.plugin === 'dsh-task-worktree' && agent.injected[0]?.source?.form === 'instructions')
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('the next message adds nothing', agent.injected.length === 1)
}

console.log('default worktree: a resumed conversation is left alone')
{
  const ctx = fakeContext()
  ctx.resolved.defaultMode = 'worktree'
  apply(ctx)
  const agent = agentWith('s1', 12)
  emit(ctx, 'agent/session-start', { agent, source: 'resume' })
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('no injection on resume', agent.injected.length === 0)
}

console.log('default worktree: explicit local mode wins')
{
  const ctx = fakeContext()
  ctx.resolved.defaultMode = 'worktree'
  apply(ctx)
  const agent = agentWith('s1')
  emit(ctx, 'agent/session-start', { agent, source: 'startup' })
  const command = ctx.registrations.commands.find((candidate) => candidate.name === 'worktree')
  // The browser selector runs `/worktree mode-off` through the command service.
  const invocation = { rawInput: 'mode-off', agent: { session: { id: 's1' } } }
  await command.handler(invocation)
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('mode-off suppresses the configured default', agent.injected.length === 0)
}

console.log('mode-on after an explicit local choice')
{
  const ctx = fakeContext()
  ctx.resolved.defaultMode = 'worktree'
  apply(ctx)
  const agent = agentWith('s1')
  emit(ctx, 'agent/session-start', { agent, source: 'startup' })
  const command = ctx.registrations.commands.find((candidate) => candidate.name === 'worktree')
  const invocation = (rawInput) => ({ rawInput, agent: { session: { id: 's1' } } })
  await command.handler(invocation('mode-off'))
  await command.handler(invocation('mode-on worktree/login'))
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('the armed name is injected', agent.injected.length === 1 && textOf(agent.injected[0]).includes('worktree/login'), JSON.stringify(agent.injected.map(textOf)))
}

console.log('default local: nothing is injected')
{
  const ctx = fakeContext()
  apply(ctx)
  const agent = agentWith('s1')
  emit(ctx, 'agent/session-start', { agent, source: 'startup' })
  emit(ctx, 'agent/inbox/inserted', { agent, message: { source: { kind: 'user' } } })
  check('no injection', agent.injected.length === 0)
}

console.log('schema is exported for the browser half to mirror')
{
  check('SETTINGS_NS matches the browser key', SETTINGS_NS === 'task-worktree')
  check('WorktreeSettings is a rehydratable schema', typeof WorktreeSettings === 'function' && WorktreeSettings({}).defaultMode === 'local')
}

console.log(failed === 0 ? '\nHOST OK — all checks passed' : `\nHOST FAILED — ${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
