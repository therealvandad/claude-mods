import { expect, test } from 'claude-code/testing'

import { LANGS, STRINGS, isLang, tabLabel, tr } from './i18n'
import type { StringKey } from './i18n'

const KEYS = Object.keys(STRINGS) as StringKey[]
const TABS = ['general', 'formats', 'interface', 'notices', 'charts', 'data', 'mods', 'profiles', 'projects', 'history']
const slots = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join(',')

test('every string exists in en, es and de, and is not empty', () => {
  expect(LANGS).toEqual(['en', 'es', 'de'])

  for (const k of KEYS) {
    for (const l of LANGS) {
      expect(STRINGS[k][l].trim().length).toBeGreaterThan(0)
    }
  }
})

test('the placeholders are the same in all three languages', () => {
  for (const k of KEYS) {
    expect(slots(STRINGS[k].es)).toBe(slots(STRINGS[k].en))
    expect(slots(STRINGS[k].de)).toBe(slots(STRINGS[k].en))
  }
})

test('most strings really differ per language', () => {
  const same = KEYS.filter(k => STRINGS[k].es === STRINGS[k].en && STRINGS[k].de === STRINGS[k].en)

  // names that are the same word in all three (Mods) are fine; sentences are not
  expect(same.every(k => STRINGS[k].en.length < 12)).toBe(true)
  expect(KEYS.filter(k => STRINGS[k].es !== STRINGS[k].en).length).toBeGreaterThan(KEYS.length - 6)
  expect(KEYS.filter(k => STRINGS[k].de !== STRINGS[k].en).length).toBeGreaterThan(KEYS.length - 6)
})

test('tr picks the language, falls back to English and fills placeholders', () => {
  expect(tr('en', 'title')).toBe('Preferences')
  expect(tr('es', 'title')).toBe('Preferencias')
  expect(tr('de', 'title')).toBe('Einstellungen')
  expect(tr('fr', 'title')).toBe('Preferences')
  expect(tr(undefined, 'title')).toBe('Preferences')
  expect(tr(5, 'title')).toBe('Preferences')
  expect(tr('en', 'changed', { n: 3 })).toBe('3 changed from default')
  expect(tr('de', 'page', { a: 1, b: 4, n: 40 })).toBe('Seite 1/4 · 40 Zeilen')
  expect(tr('en', 'changed')).toBe('{n} changed from default')
  expect(tr('en', 'changed', { n: 0 })).toBe('0 changed from default')
  expect(tr('es', 'editing', { where: 'este proyecto' })).toBe('Editando: este proyecto')
  expect(isLang('de')).toBe(true)
  expect(isLang('DE')).toBe(false)
  expect(isLang(1)).toBe(false)
})

test('every tab has a label in every language; an unknown tab keeps its name', () => {
  for (const t of TABS) {
    for (const l of LANGS) {
      expect(tabLabel(l, t).length).toBeGreaterThan(1)
      expect(tabLabel(l, t)).not.toBe(`tab.${t}`)
    }
  }
  expect(tabLabel('es', 'history')).toBe('Historial')
  expect(tabLabel('de', 'projects')).toBe('Projekte')
  expect(tabLabel('en', 'nope')).toBe('nope')
  expect(tabLabel('en', 'title')).toBe('title')
})

test('the honesty note says the same thing in every language', () => {
  const word = { en: 'READS', es: 'LEE', de: 'LIEST' } as const

  for (const l of LANGS) {
    expect(STRINGS.honest[l]).toContain('prefs')
    expect(STRINGS.honest[l]).toContain(word[l])
  }
})
