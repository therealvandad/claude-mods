import type { Register } from 'claude-code'

const LONG_TURN_MS = 20_000

let startedAt = 0

// The Dusk ink theme is off at the person's request: the app draws its own look.
// make-colors.js stays in this folder for the next theme.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.theme.clear()
    // An early version pinned a status line ("no attached desktop ..."). Clear that leftover.
    $.ui.status(undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    startedAt = await $.clock.now()

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const took = (await $.clock.now()) - startedAt

    if (e.reason === 'error' || e.reason === 'refusal') {
      void $.audio.play({ asset: 'sounds/error.wav' }).catch(() => undefined)
    } else if (e.reason === 'answer' && took > LONG_TURN_MS) {
      void $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined)
    }

    return next(e)
  })
}
