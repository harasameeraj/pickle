import { useState } from 'react'
import { CoachAvatar } from '../components/CoachPanel'
import { Segmented, TopBar } from '../components/ui'
import { PERSONAS, speak, type Persona } from '../lib/coach'
import { deleteMatch, listMatches, loadSettings, saveSettings, type Settings as S } from '../lib/db'

export default function Settings() {
  const [s, setS] = useState<S>(loadSettings())
  const [msg, setMsg] = useState('')
  const set = (patch: Partial<S>) => {
    const n = { ...s, ...patch }
    setS(n)
    saveSettings(n)
  }
  return (
    <div>
      <TopBar title="You" />
      <div className="space-y-4">
        <div className="card space-y-4 p-5">
          <div>
            <div className="label mb-1.5">Your name</div>
            <input value={s.name} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-xl bg-white/5 px-3 py-2.5 font-semibold outline-none focus:ring-1 focus:ring-lime" />
          </div>
          <div>
            <div className="label mb-1.5">Paddle hand</div>
            <Segmented value={s.hand} onChange={(hand) => set({ hand })} options={[{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }]} />
          </div>
          <div>
            <div className="label mb-1.5">Voice cues</div>
            <Segmented value={s.voice ? 'on' : 'off'} onChange={(v) => set({ voice: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </div>
        </div>
        <div className="card p-5">
          <div className="label mb-3">Your coach</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(PERSONAS) as Persona[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  set({ persona: p })
                  speak({ pro: 'Hi, I’m Maya. Let’s fix your game, one shot at a time.', hype: 'Yo! Coach Blaze here. Let’s get you cooking!', sarge: 'Sarge here. Paddle up. Let’s work.' }[p], p)
                }}
                className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${s.persona === p ? 'border-lime bg-lime/10' : 'border-line hover:bg-white/5'}`}
              >
                <CoachAvatar persona={p} size={40} />
                <div>
                  <div className="font-bold">{PERSONAS[p].name}</div>
                  <div className="text-xs text-mute">{PERSONAS[p].tag}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <div className="label mb-2">Data & privacy</div>
          <p className="text-sm text-mute">All videos and analysis are stored only in this browser on this device. Nothing is uploaded.</p>
          <button
            className="btn btn-ghost mt-3 text-red-300"
            onClick={async () => {
              if (!confirm('Delete every match and video stored on this device?')) return
              const all = await listMatches()
              await Promise.all(all.map((m) => deleteMatch(m.id)))
              setMsg(`Deleted ${all.length} matches.`)
            }}
          >
            Delete all matches
          </button>
          {msg && <div className="mt-2 text-sm text-lime">{msg}</div>}
        </div>
        <div className="pb-4 text-center text-xs text-mute">KitchenIQ v0.1</div>
      </div>
    </div>
  )
}
