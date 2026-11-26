// Sample data for /chdemo: a made-up session with 95 minutes of work, so every chart has something to draw.
// Deterministic (a small linear congruential generator), so the same call gives the same data.

import type { CallRec, DayRec, EditRec, ImportRec, SprintRec, TodoEv, TodoRec } from '../types'

import { importsOf } from './charts'
import type { ChartData } from './charts'
import { addDays, dayKey, startOfDay, weekday } from './draw'

const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0

  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0

    return s / 4294967296
  }
}

const SRC: Readonly<Record<string, string>> = {
  '/proj/src/app.ts': "import { read } from './store'\nimport { draw } from './ui/draw'\nimport React from 'react'\nexport * from './types'\n",
  '/proj/src/store.ts': "import { atom } from 'claude-code'\nimport type { Row } from './ui/draw'\nconst x = require('./util')\n",
  '/proj/src/ui/draw.ts': "import { clamp } from '../util'\nimport { read } from '../store'\n",
  '/proj/src/util.ts': "import fs from 'node:fs'\n",
  '/proj/src/types.ts': '',
  '/proj/tests/app.test.ts': "import { expect, test } from 'claude-code/testing'\nimport { draw } from '../src/ui/draw'\n",
  '/proj/README.md': '',
}

const EDIT_PATHS = Object.keys(SRC)

export const demoData = (now: number): ChartData => {
  const rnd = lcg(42)
  const start = now - 95 * 60_000
  const prompts = [0, 11, 30, 47, 69, 88].map((m, i) => ({ at: start + m * 60_000, len: [120, 640, 85, 310, 40, 220][i] ?? 100 }))
  const calls: CallRec[] = []
  const turns: { start: number; end: number }[] = []
  const tools = ['Read', 'Grep', 'Edit', 'Bash', 'Write', 'Glob', 'Read', 'Edit']
  let id = 0

  prompts.forEach((p, pi) => {
    const turnLen = (5 + Math.floor(rnd() * 4)) * 60_000
    let t = p.at + 4000
    const n = 7 + Math.floor(rnd() * 5)

    const tight = pi === prompts.length - 1

    for (let i = 0; i < n; i += 1) {
      const tool = tools[Math.floor(rnd() * tools.length)] ?? 'Read'
      const ms = Math.round(40 + rnd() * (tool === 'Bash' ? (tight ? 3000 : 9000) : tool === 'Grep' ? 700 : 300))
      const path = EDIT_PATHS[Math.floor(rnd() * EDIT_PATHS.length)] ?? '/proj/src/app.ts'
      const isFile = tool === 'Read' || tool === 'Edit' || tool === 'Write'
      const call: CallRec = {
        id: `d${(id += 1)}`,
        tool,
        detail: tool === 'Bash' ? ['npm', 'git', 'ls', 'pytest'][Math.floor(rnd() * 4)] ?? 'npm' : isFile ? path.split('/').pop() ?? '' : 'pattern',
        startedAt: t,
        endedAt: t + ms,
        isError: tool === 'Bash' && rnd() < 0.35,
        out: Math.round(Math.exp(rnd() * 9)),
      }

      if (isFile) {
        call.file = path
      }
      calls.push(call)

      if (rnd() < 0.3) {
        // two more starting together: parallel calls
        for (let k = 0; k < 2; k += 1) {
          calls.push({ id: `d${(id += 1)}`, tool: 'Read', detail: 'util.ts', file: '/proj/src/util.ts', startedAt: t + k * 30, endedAt: t + k * 30 + 200 + Math.round(rnd() * 400), isError: false, out: 800 + Math.round(rnd() * 4000) })
        }
      }
      t += ms + (tight ? 400 + Math.round(rnd() * 2500) : 8000 + Math.round(rnd() * 25_000))
    }

    if (pi === prompts.length - 1) {
      // the last turn gets one nested group, like a sub-agent running its own calls
      const outer = t + 2000
      calls.push({ id: `d${(id += 1)}`, tool: 'Task', detail: 'explore', startedAt: outer, endedAt: outer + 30_000, isError: false, out: 2400 })
      calls.push({ id: `d${(id += 1)}`, tool: 'Grep', detail: 'pattern', startedAt: outer + 2000, endedAt: outer + 9000, isError: false, out: 600 })
      calls.push({ id: `d${(id += 1)}`, tool: 'Read', detail: 'draw.ts', file: '/proj/src/ui/draw.ts', startedAt: outer + 11_000, endedAt: outer + 14_000, isError: false, out: 5200 })
      calls.push({ id: `d${(id += 1)}`, tool: 'Edit', detail: 'draw.ts', file: '/proj/src/ui/draw.ts', startedAt: outer + 16_000, endedAt: outer + 17_500, isError: false, out: 300 })
      t = outer + 31_000
    }
    turns.push({ start: p.at, end: tight ? t + 1000 : Math.max(t, p.at + turnLen) })
  })
  calls.sort((a, b) => a.startedAt - b.startedAt)

  const edits: EditRec[] = EDIT_PATHS.slice(0, 6).map((path, i) => ({
    path,
    n: [9, 6, 4, 3, 2, 1][i] ?? 1,
    added: [120, 60, 44, 30, 12, 6][i] ?? 5,
    removed: [40, 20, 11, 4, 0, 0][i] ?? 0,
    marks: i === 0 ? [12, 40, 41, 88, 210] : i === 1 ? [5, 120] : i === 2 ? [30] : [],
    lines: i === 0 ? 240 : i === 1 ? 140 : i === 4 ? 12 : 0,
  }))
  const imports: ImportRec[] = Object.entries(SRC).map(([path, src]) => ({ path, imports: importsOf(src) }))
  const days: Record<string, DayRec> = {}
  const day0 = startOfDay(now)

  for (let i = 0; i < 90; i += 1) {
    const ms = addDays(day0, -i)
    const w = weekday(ms) >= 5 ? 0.25 : 1
    const n = rnd() < 0.2 ? 0 : Math.round(rnd() * rnd() * 160 * w)
    days[dayKey(ms)] = { n, usd: Math.round(n * 0.04 * 100) / 100 }
  }
  days[dayKey(now)] = { n: 62, usd: 2.4 }
  const hours = Array.from({ length: 24 }, (_, h) => Math.round(Math.max(0, 40 * Math.exp(-(((h - 14) / 4.5) ** 2)) + 22 * Math.exp(-(((h - 10) / 2) ** 2))) * (0.6 + rnd() * 0.5)))
  const sprints: SprintRec[] = Array.from({ length: 13 }, (_, i) => ({
    at: addDays(day0, -Math.floor(i * 2.4)) + (9 + (i % 5)) * 3_600_000,
    min: [25, 25, 50, 15, 25, 45][i % 6] ?? 25,
    label: ['write the parser', 'review the diff', 'fix flaky test', 'plan the release', 'docs pass', 'refactor draw.ts'][i % 6] ?? 'work',
  })).reverse()
  const todos: TodoRec[] = ['set up the repo', 'write the renderer', 'add the tests', 'document the commands', 'review colours', 'ship it', 'celebrate'].map((text, i) => ({ id: i + 1, text }))
  const todoEv: TodoEv[] = []
  const minute = 60_000
  const plan: [number, number, 'open' | 'doing' | 'done'][] = [
    [-90, 1, 'open'], [-90, 2, 'open'], [-88, 3, 'open'], [-80, 4, 'open'], [-60, 5, 'open'], [-55, 6, 'open'], [-30, 7, 'open'],
    [-85, 1, 'doing'], [-75, 1, 'done'], [-74, 2, 'doing'], [-50, 2, 'done'], [-48, 3, 'doing'], [-20, 3, 'done'], [-15, 4, 'doing'], [-6, 5, 'doing'],
  ]

  for (const [m, tid, to] of plan) {
    todoEv.push({ t: now + m * minute, id: tid, to })
  }
  todoEv.sort((a, b) => a.t - b.t)

  return {
    now,
    start,
    calls,
    prompts,
    turns,
    samples: [],
    edits,
    imports,
    days,
    hours,
    sprints,
    todos,
    todoEv,
    budget: 5,
    usd: 3.2,
    ctx: 63,
    limit: 41,
  }
}
