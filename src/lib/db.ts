import { createStore, del, get, keys, set } from 'idb-keyval'
import type { Persona } from './coach'
import type { Match } from './types'

const matches = createStore('kitcheniq-matches', 'matches')
const videos = createStore('kitcheniq-videos', 'videos')
const sessions = createStore('kitcheniq-sessions', 'sessions')

export async function saveMatch(m: Match) {
  await set(m.id, m, matches)
}

export async function loadMatch(id: string): Promise<Match | undefined> {
  return get<Match>(id, matches)
}

export async function listMatches(): Promise<Match[]> {
  const ks = await keys(matches)
  const all = await Promise.all(ks.map((k) => get<Match>(k, matches)))
  return (all.filter(Boolean) as Match[]).sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteMatch(id: string) {
  const m = await loadMatch(id)
  if (m?.videoKey) await del(m.videoKey, videos)
  await del(id, matches)
}

export async function saveVideo(key: string, blob: Blob) {
  await set(key, blob, videos)
}

export async function loadVideo(key: string): Promise<Blob | undefined> {
  return get<Blob>(key, videos)
}

export interface DrillSession {
  id: string
  drill: string
  at: number
  reps: number
  score: number
  seconds: number
}

export async function saveSession(s: DrillSession) {
  await set(s.id, s, sessions)
}

export async function listSessions(): Promise<DrillSession[]> {
  const ks = await keys(sessions)
  const all = await Promise.all(ks.map((k) => get<DrillSession>(k, sessions)))
  return (all.filter(Boolean) as DrillSession[]).sort((a, b) => b.at - a.at)
}

// ---------- Settings (small, per device) ----------

export interface Settings {
  name: string
  persona: Persona
  voice: boolean
  hand: 'right' | 'left'
  onboarded: boolean
}

const DEFAULTS: Settings = { name: 'You', persona: 'pro', voice: true, hand: 'right', onboarded: false }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('kitcheniq-settings')
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('kitcheniq-settings', JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
