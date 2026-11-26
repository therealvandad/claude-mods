// Labels of this mod's own pane in English, Spanish and German. Preference labels and descriptions stay in English: only the
// pane's own chrome (title, tabs, buttons, counters, the honesty note) is translated.
export type Lang = 'en' | 'es' | 'de'
export const LANGS: readonly Lang[] = ['en', 'es', 'de']

type Row = Readonly<Record<Lang, string>>

export const STRINGS = {
  title: { en: 'Preferences', es: 'Preferencias', de: 'Einstellungen' },
  honest: {
    en: 'Honest note: a preference only changes what a mod READS it. Today only prefs itself and mods built after it do; the rest of your mods ignore these values.',
    es: 'Nota honesta: una preferencia solo cambia lo que un mod LEE de ella. Hoy solo prefs y los mods creados despues lo hacen; los demas mods ignoran estos valores.',
    de: 'Ehrlicher Hinweis: Eine Einstellung ändert nur, was ein Mod daraus LIEST. Heute tun das nur prefs selbst und später gebaute Mods; alle anderen Mods ignorieren diese Werte.',
  },
  'tab.general': { en: 'General', es: 'General', de: 'Allgemein' },
  'tab.formats': { en: 'Formats', es: 'Formatos', de: 'Formate' },
  'tab.interface': { en: 'Interface', es: 'Interfaz', de: 'Oberfläche' },
  'tab.notices': { en: 'Notices', es: 'Avisos', de: 'Hinweise' },
  'tab.charts': { en: 'Charts', es: 'Graficos', de: 'Diagramme' },
  'tab.data': { en: 'Data', es: 'Datos', de: 'Daten' },
  'tab.mods': { en: 'Mods', es: 'Mods', de: 'Mods' },
  'tab.profiles': { en: 'Profiles', es: 'Perfiles', de: 'Profile' },
  'tab.projects': { en: 'Projects', es: 'Proyectos', de: 'Projekte' },
  'tab.history': { en: 'History', es: 'Historial', de: 'Verlauf' },
  search: { en: 'search', es: 'buscar', de: 'suchen' },
  searchHint: { en: 'key, label or words', es: 'clave, nombre o palabras', de: 'Schlüssel, Name oder Wörter' },
  filter: { en: 'filter', es: 'filtrar', de: 'filtern' },
  clearSearch: { en: 'clear search', es: 'borrar busqueda', de: 'Suche löschen' },
  changed: { en: '{n} changed from default', es: '{n} distintas del valor por defecto', de: '{n} vom Standard abweichend' },
  editing: { en: 'Editing: {where}', es: 'Editando: {where}', de: 'Bearbeite: {where}' },
  preview: { en: 'PREVIEW', es: 'VISTA PREVIA', de: 'VORSCHAU' },
  reset: { en: 'reset', es: 'restablecer', de: 'zurücksetzen' },
  usedHere: { en: 'used by prefs', es: 'usado por prefs', de: 'von prefs genutzt' },
  storedOnly: { en: 'stored for other mods', es: 'guardado para otros mods', de: 'für andere Mods gespeichert' },
  page: { en: 'page {a}/{b} · {n} rows', es: 'pagina {a}/{b} · {n} filas', de: 'Seite {a}/{b} · {n} Zeilen' },
  nothing: { en: 'Nothing matches.', es: 'No hay coincidencias.', de: 'Nichts passt.' },
  all: { en: 'all', es: 'todo', de: 'alle' },
  undoLast: { en: 'undo last change', es: 'deshacer ultimo cambio', de: 'letzte Änderung rückgängig' },
  noHistory: { en: 'No changes yet.', es: 'Aun no hay cambios.', de: 'Noch keine Änderungen.' },
  global: { en: 'global', es: 'global', de: 'global' },
  thisProject: { en: 'this project', es: 'este proyecto', de: 'dieses Projekt' },
  thisBranch: { en: 'this branch', es: 'esta rama', de: 'dieser Branch' },
  use: { en: 'use', es: 'usar', de: 'anwenden' },
  del: { en: 'delete', es: 'borrar', de: 'löschen' },
  save: { en: 'save', es: 'guardar', de: 'speichern' },
  copyCmd: { en: 'put in prompt', es: 'poner en el prompt', de: 'in den Prompt' },
  footer: {
    en: 'Commands: /pf lists them all. Values here are stored; nothing is written to disk files and nothing is sent anywhere.',
    es: 'Comandos: /pf los lista todos. Los valores se guardan en el almacen del mod; nada se escribe en archivos ni se envia a ningun sitio.',
    de: 'Befehle: /pf listet alle. Die Werte liegen im Speicher des Mods; nichts wird in Dateien geschrieben oder irgendwohin gesendet.',
  },
} as const satisfies Record<string, Row>

export type StringKey = keyof typeof STRINGS

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'es' || v === 'de'

/** The string in the language (English when the language is unknown), with `{name}` placeholders filled from `vars`. */
export const tr = (lang: unknown, key: StringKey, vars: Readonly<Record<string, string | number>> = {}): string => {
  const row: Row = STRINGS[key]
  const text = row[isLang(lang) ? lang : 'en']

  return text.replace(/\{(\w+)\}/g, (_m, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`))
}

export const tabLabel = (lang: unknown, tab: string): string => {
  const key = `tab.${tab}`

  return key in STRINGS ? tr(lang, key as StringKey) : tab
}
