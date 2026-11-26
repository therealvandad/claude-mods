// What each tab of the pane (and the matching commands) shows, as plain lines.
import {
  backlogLines,
  backlogOpen,
  bestLines,
  dailyLines,
  focusLines,
  habitLines,
  journalLines,
  ladderLines,
  learnLines,
  metricsLines,
  momentumLines,
  projectLines,
  projectListLines,
  shipLines,
  streakLines,
  treeLines,
  weekRingLines,
  xpLines,
} from './logic'
import type {
  BacklogData,
  Bests,
  Days,
  FocusEvent,
  GoalData,
  Glyphs,
  Habits,
  JournalEntry,
  LearnData,
  Live,
  Meta,
  Metrics,
  ProjData,
  Ship,
  Skills,
  Tab,
} from './logic'

export type Cache = {
  goals: GoalData
  days: Days
  meta: Meta
  skills: Skills
  proj: ProjData
  learn: LearnData
  habits: Habits
  bests: Bests
  journal: JournalEntry[]
  backlog: BacklogData
  live: Live
  ships: Ship[]
  metrics: Metrics
}

export type Block = { title: string; lines: string[] }

export const blocksFor = (tab: Tab, c: Cache, today: string, now: number, gl: Glyphs): Block[] => {
  const events: FocusEvent[] = c.live.events

  switch (tab) {
    case 'goals':
      return [
        { title: 'DAILY PROGRESS', lines: dailyLines(c.goals, today, now, gl) },
        { title: 'WEEKLY RING', lines: weekRingLines(c.goals, today, gl) },
        { title: 'BACKLOG', lines: [`${backlogOpen(c.backlog)} open. /pgbacklog list`] },
      ]
    case 'level':
      return [
        { title: 'MILESTONE LADDER', lines: ladderLines(c.meta.totals, gl) },
        { title: 'XP', lines: xpLines(c.days, c.meta.archive, today) },
      ]
    case 'streak':
      return [
        { title: 'STREAK CALENDAR', lines: streakLines(c.days, c.meta.frozen, today, gl) },
        { title: 'HABITS', lines: habitLines(c.habits, today, gl) },
      ]
    case 'plans': {
      const cur = c.proj.projects.find(p => p.name === c.proj.current)

      return [
        { title: 'PROJECT', lines: cur === undefined ? ['No project yet. /pgproj new <name>'] : projectLines(cur, gl) },
        ...(c.proj.projects.length > 1 ? [{ title: 'ALL PROJECTS', lines: projectListLines(c.proj, gl) }] : []),
        { title: 'LEARNING', lines: learnLines(c.learn, today, gl) },
        { title: 'BACKLOG', lines: backlogLines(c.backlog, gl) },
      ]
    }
    case 'stats':
      return [
        { title: 'PERSONAL BESTS', lines: bestLines(c.bests, c.days, c.meta.frozen, today) },
        { title: 'FOCUS', lines: focusLines(events, now, gl) },
        { title: 'MOMENTUM', lines: momentumLines(c.live.hours, now, gl) },
        { title: 'BEFORE AND AFTER', lines: metricsLines(c.metrics) },
      ]
    case 'log':
      return [
        { title: 'JOURNAL', lines: journalLines(c.journal, today) },
        { title: 'SHIP LOG', lines: shipLines(c.ships) },
      ]
    case 'skills':
      return [{ title: 'SKILL TREE', lines: treeLines(c.skills, gl) }]
  }
}
