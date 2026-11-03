import { motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { fmtTime, TopBar } from '../components/ui'
import { buildMatch } from '../lib/analyze'
import { saveMatch, saveVideo, uid } from '../lib/db'
import { flow } from '../lib/flow'
import { finalizeRallies, type RallyDraft } from '../lib/pipeline'
import { applyRally, callScore, gameOver, initialScore } from '../lib/scoring'
import type { Player, TeamId } from '../lib/types'

export default function Verify() {
  const nav = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [drafts, setDrafts] = useState<RallyDraft[]>(() => flow.drafts ?? [])
  const [playing, setPlaying] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const stopAt = useRef<number | null>(null)

  const players: Player[] = useMemo(() => (flow.seeds ?? []).map(({ foot: _f, ...p }) => p), [])
  const settings = flow.settings ?? { gameTo: 11, firstServer: 0 as TeamId }

  const scores = useMemo(() => {
    let s = initialScore(settings.firstServer)
    const out: Record<string, string> = {}
    let over: TeamId | null = null
    for (const d of drafts) {
      if (!d.include) continue
      out[d.id] = callScore(s)
      if (over !== null) continue
      s = applyRally(s, d.winner).next
      over = gameOver(s, settings.gameTo)
    }
    return { per: out, final: s.points, over }
  }, [drafts, settings])

  if (!flow.drafts || !flow.seeds) return <Navigate to="/new" replace />

  const teamName = (t: TeamId) =>
    players
      .filter((p) => p.team === t)
      .map((p) => p.name)
      .join(' & ')
  const update = (id: string, patch: Partial<RallyDraft>) => setDrafts(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const play = (d: RallyDraft) => {
    const v = video.current
    if (!v) return
    v.currentTime = d.start
    stopAt.current = d.end
    v.play().catch(() => {})
    setPlaying(d.id)
    v.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const finish = async () => {
    setSaving(true)
    const inputs = finalizeRallies(drafts, players, settings)
    const videoKey = `v-${uid()}`
    const m = buildMatch({
      id: uid(),
      title: flow.name ?? 'My match',
      source: 'video',
      players,
      settings,
      rallies: inputs,
      duration: flow.raw?.duration ?? 0,
      videoKey,
      corners: flow.corners,
      videoAspect: flow.raw?.aspect,
    })
    try {
      await saveVideo(videoKey, flow.file!)
    } catch {
      m.videoKey = undefined
    }
    await saveMatch(m)
    nav(`/match/${m.id}`, { replace: true })
  }

  const included = drafts.filter((d) => d.include).length

  return (
    <div>
      <TopBar title="Check the score" />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3 lg:sticky lg:top-16 lg:self-start">
          <div className="overflow-hidden rounded-2xl bg-black">
            <video
              ref={video}
              src={flow.url}
              playsInline
              controls
              className="block w-full"
              onTimeUpdate={(e) => {
                if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                  e.currentTarget.pause()
                  stopAt.current = null
                  setPlaying(null)
                }
              }}
            />
          </div>
          <div className="card-hi p-5">
            <div className="label">Final score from your rallies</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm font-bold text-lime">{teamName(0)}</div>
              <div className="text-4xl font-black num">
                {scores.final[0]}–{scores.final[1]}
              </div>
              <div className="min-w-0 truncate text-right text-sm font-bold text-sky">{teamName(1)}</div>
            </div>
            <p className="mt-3 text-sm text-soft">
              We found <b>{drafts.length}</b> rallies and guessed who won each. Fix any wrong winners and switch off anything that isn’t a real rally (warm-up, a neighbouring court). The score updates as you go.
            </p>
            <button className="btn btn-primary mt-4 w-full" disabled={!included || saving} onClick={finish}>
              {saving ? 'Building your review…' : '✦ Build my Game Review'}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {drafts.length === 0 && <div className="card p-6 text-center text-mute">No rallies detected. Try a video with clearer audio, or a higher analysis detail setting.</div>}
          {drafts.map((d, i) => (
            <motion.div key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.4) }} className={`card p-3 ${d.include ? '' : 'opacity-45'}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => play(d)} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${playing === d.id ? 'bg-lime text-ink' : 'bg-white/8'}`} aria-label="Play rally">
                  ▶
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">
                    Rally {i + 1} <span className="font-mono text-xs text-mute">{fmtTime(d.start)}</span>
                  </div>
                  <div className="text-xs text-mute">
                    {d.hits.length} shots · score {scores.per[d.id] ?? '—'}
                    {d.confidence < 0.4 && <span className="ml-1 text-orange-300">· low confidence</span>}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-soft">
                  <input type="checkbox" checked={d.include} onChange={(e) => update(d.id, { include: e.target.checked })} className="accent-lime" /> Rally
                </label>
              </div>
              {d.include && (
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {([0, 1] as TeamId[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => update(d.id, { winner: t })}
                      className={`truncate rounded-lg px-2 py-1.5 text-xs font-bold transition ${d.winner === t ? (t === 0 ? 'bg-lime text-ink' : 'bg-sky text-ink') : 'bg-white/5 text-mute'}`}
                    >
                      {d.winner === t ? '🏆 ' : ''}
                      {teamName(t)}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
