// In-memory state for the record/upload -> setup -> analyse -> verify flow.
import type { PlayerSeed, RallyDraft, RawAnalysis } from './pipeline'
import type { MatchSettings, Vec2 } from './types'

export interface Flow {
  file?: Blob
  url?: string
  name?: string
  corners?: Vec2[]
  seeds?: PlayerSeed[]
  settings?: MatchSettings
  fps: number
  raw?: RawAnalysis
  drafts?: RallyDraft[]
  setupTime?: number
}

export const flow: Flow = { fps: 10 }

export function startFlow(file: Blob, name: string) {
  if (flow.url) URL.revokeObjectURL(flow.url)
  Object.assign(flow, {
    file,
    name,
    url: URL.createObjectURL(file),
    corners: undefined,
    seeds: undefined,
    settings: undefined,
    raw: undefined,
    drafts: undefined,
    setupTime: undefined,
  })
}
