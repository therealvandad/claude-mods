import type { Hook, Register } from 'claude-code'

type Dollar = Parameters<Hook<'session.start'>>[0]
type Cfg = { isOn: boolean; keep: string[] }

// Rows that are about safety or something waiting on you stay. The rest are hidden until you ask.
const DEFAULT_KEEP: readonly string[] = ['cockpit', 'alerts', 'safety-pro', 'controls']
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

let cfg: Cfg = { isOn: true, keep: [...DEFAULT_KEEP] }
let seen: string[] = []

// A row's plugin may arrive as `name` or `name@marketplace`: compare the bare name.
const bare = (plugin: string) => plugin.split('@')[0]?.toLowerCase() ?? ''

export const isKept = (plugin: string, keep: readonly string[]) => keep.includes(bare(plugin))

const clean = (raw: unknown): Cfg => {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const keep = Array.isArray(o.keep) ? o.keep.filter((n): n is string => typeof n === 'string' && NAME.test(n)).slice(0, 30) : [...DEFAULT_KEEP]

  return { isOn: o.isOn !== false, keep }
}

const save = (d: Dollar) => d.store.set('cfg', cfg)

const summary = () =>
  `Tidy is ${cfg.isOn ? 'on' : 'off'}. Showing rows from: ${cfg.keep.join(', ') || '(none)'}.\nRows drawn right now: ${seen.length === 0 ? '(none yet)' : seen.join(', ')}.\nUsage: /tidy on|off · /tidy keep <name> · /tidy hide <name> · /tidy rows · /tidy reset`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cfg = clean(await $.store.get('cfg'))
    await $.command.register({ name: 'tidy', description: 'Choose which mods may draw a row above the prompt' }).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    seen = e.props.rows.map(r => bare(r.plugin))

    if (!cfg.isOn || e.props.hasSurvey) {
      return next(e)
    }
    const rows = e.props.rows.filter(r => isKept(r.plugin, cfg.keep))

    return next({ ...e, props: { ...e.props, rows } })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'tidy' }, async ($, e) => {
    const [verb = '', name = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === 'on' || verb === 'off') {
      cfg = { ...cfg, isOn: verb === 'on' }
      await save($)

      return { text: verb === 'on' ? 'Tidy on: only the chosen rows show above the prompt.' : 'Tidy off: every mod may draw above the prompt again.' }
    }

    if (verb === 'keep' || verb === 'hide') {
      if (!NAME.test(name)) {
        return { text: `Usage: /tidy ${verb} <mod name>, for example /tidy ${verb} workbench` }
      }
      const keep = verb === 'keep' ? [...new Set([...cfg.keep, name])].slice(0, 30) : cfg.keep.filter(n => n !== name)
      cfg = { ...cfg, keep }
      await save($)

      return { text: verb === 'keep' ? `${name} may draw above the prompt.` : `${name} is hidden above the prompt.` }
    }

    if (verb === 'reset') {
      cfg = { isOn: true, keep: [...DEFAULT_KEEP] }
      await save($)

      return { text: 'Tidy reset to its defaults.' }
    }

    if (verb === 'rows') {
      return { text: seen.length === 0 ? 'No mod is drawing above the prompt right now.' : `Drawing above the prompt now: ${seen.join(', ')}` }
    }

    return { text: summary() }
  })
}
