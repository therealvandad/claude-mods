export type Accent = 'suggestion' | 'claude' | 'success' | 'warning' | 'permission' | 'remember'
export type Density = 'compact' | 'normal' | 'airy'
export type IconPack = 'letters' | 'symbols' | 'minimal'
export type Preset = 'calm' | 'focus' | 'full' | 'custom'

declare module 'claude-code' {
  interface PluginState {
    settings: {
      accent: Accent
      density: Density
      icons: IconPack
      preset: Preset
      isCalm: boolean
      /**
       * Per-mod feature switches: ONLY the overrides, `{ '<mod>.<id>': boolean }`. An id that is absent means that
       * switch's default. Read it from another mod with `atom({ plugin: 'settings', key: 'features' } as const, {}, { shape: 'features-1' })`
       * and `const on = (o: Record<string, boolean>, id: string, dflt: boolean) => o[id] ?? dflt`. Only settings writes it.
       */
      features: Shaped<Record<string, boolean>>
    }
  }
}
