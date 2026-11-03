import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CoachAvatar } from '../components/CoachPanel'
import CoachPanel from '../components/CoachPanel'
import HighlightStudio from '../components/HighlightStudio'
import MomentumGraph from '../components/MomentumGraph'
import { PlayerReport, TeamReport } from '../components/PlayerReport'
import RallyPlayer from '../components/RallyPlayer'
import { AccuracyRing, CountUp, GRADE_META, GradeBadge, Segmented, TopBar } from '../components/ui'
import { GRADE_ORDER, SHOT_LABEL } from '../lib/analyze'
import { coachReport, PERSONAS } from '../lib/coach'
import { deleteMatch, loadMatch, loadSettings, loadVideo } from '../lib/db'
import { callScore } from '../lib/scoring'
import type { Match } from '../lib/types'

type Tab = 'review' | 'rallies' | 'players' | 'coach' | 'highlights'

export default function Review() {
  const { id } = useParams()
  const nav = useNavigate()
  const [m, setM] = useState<Match | null | undefined>(undefined)
  const [videoUrl, setVideoUrl] = useState<string>()
  const [tab, setTab] = useState<Tab>('review')
  const [rallyIdx, setRallyIdx] = useState(0)
  const [shotIdx, setShotIdx] = useState(0)
  const [playerId, setPlayerId] = useState<string>('')

  useEffect(() => {
    let url: string | undefined
    loadMatch(id!).then(async (match) => {
      setM(match ?? null)
      if (!match) return
      const me = match.players.find((p) => p.isMe) ?? match.players[0]
      setPlayerId(me.id)
      const first = [...match.rallies].sort((a, b) => b.swing - a.swing)[0]
      if (first) {
        setRallyIdx(first.index)
        setShotIdx(first.keyShot)
      }
      if (match.videoKey) {
        const blob = await loadVideo(match.videoKey)
        if (blob) {
          url = URL.createObjectURL(blob)
          setVideoUrl(url)
        }
      }
    })
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  const me = m ? (m.players.find((p) => p.isMe) ?? m.players[0]) : null
  const persona = loadSettings().persona
  const report = useMemo(() => (m && me ? coachReport(m, me.id, persona) : null), [m, me, persona])
  const keyMoments = useMemo(() => (m ? [...m.rallies].sort((a, b) => b.swing - a.swing).slice(0, 5).sort((a, b) => a.index - b.index) : []), [m])

  if (m === undefined) return <div className="grid h-[60vh] place-items-center text-mute">Loading review…</div>
  if (m === null || !me || !report)
    return (
      <div className="grid h-[60vh] place-items-center text-center">
        <div>
          <div className="text-lg font-bold">Match not found</div>
          <button className="btn btn-ghost mt-4" onClick={() => nav('/')}>
            Go home
          </button>
        </div>
      </div>
    )

  const opp = me.team === 0 ? 1 : 0
  const watch = (rally: number, shot: number) => {
    setRallyIdx(rally)
    setShotIdx(shot)
    setTab('rallies')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const teamNames = (t: 0 | 1) =>
    m.players
      .filter((p) => p.team === t)
      .map((p) => p.name)
      .join(' & ')
  const won = m.winner === me.team
  const rally = m.rallies[rallyIdx]
  const name = (pid: string) => m.players.find((p) => p.id === pid)

  return (
    <div>
      <TopBar
        back="/matches"
        title={m.title}
        right={
          <button
            className="text-sm text-mute hover:text-red-400"
            onClick={async () => {
              if (!confirm('Delete this match and its video from this device?')) return
              await deleteMatch(m.id)
              nav('/matches')
            }}
          >
            Delete
          </button>
        }
      />

      {/* Scoreboard hero */}
      <section className="card-hi relative overflow-hidden p-5 md:p-7">
        <div className="flex items-center justify-between gap-2">
          <span className="chip !border-lime/30 !bg-lime/10 !text-lime">◎ Game Review</span>
          <span className="text-xs text-mute">{new Date(m.createdAt).toLocaleDateString()} · {m.rallies.length} rallies</span>
        </div>
        <div className="mt-4 flex items-center justify-center gap-4 sm:gap-8">
          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-sm font-bold text-soft">{teamNames(me.team)}</div>
            {won && <div className="text-xs font-black text-lime">WINNER</div>}
          </div>
          <div className="flex items-baseline gap-3 text-5xl font-black md:text-6xl">
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={won ? 'text-lime glow-lime' : ''}>
              <CountUp to={m.finalScore[me.team]} duration={1} />
            </motion.span>
            <span className="text-2xl text-mute">–</span>
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }} className={!won && m.winner !== null ? 'text-sky' : ''}>
              <CountUp to={m.finalScore[opp]} duration={1} />
            </motion.span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-soft">{teamNames(opp)}</div>
            {m.winner === opp && <div className="text-xs font-black text-sky">WINNER</div>}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-1">
          {[...m.players]
            .sort((a, b) => (a.team === me.team ? 0 : 1) - (b.team === me.team ? 0 : 1))
            .map((p, i) => (
              <button key={p.id} onClick={() => { setPlayerId(p.id); setTab('players') }} className="rounded-2xl py-1 transition hover:bg-white/5">
                <AccuracyRing value={m.stats[p.id].accuracy} color={p.color} size={68} label={p.name} sub="accuracy" delay={0.15 * i} />
              </button>
            ))}
        </div>
        <button onClick={() => setTab('coach')} className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3 text-left transition hover:border-lime/40">
          <CoachAvatar persona={persona} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-mute">{PERSONAS[persona].name}</div>
            <div className="truncate text-sm font-semibold">{report.insights[0] ? `Biggest leak: ${report.insights[0].title}` : report.intro}</div>
          </div>
          <span className="text-lime">›</span>
        </button>
      </section>

      {/* Tabs */}
      <div className="sticky top-14 z-20 -mx-4 mt-4 bg-ink/85 px-4 py-2 backdrop-blur-xl">
        <div className="scroll-x">
          <div className="min-w-[480px]">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'review', label: 'Review' },
                { value: 'rallies', label: 'Replay' },
                { value: 'players', label: 'Players' },
                { value: 'coach', label: 'Coach' },
                { value: 'highlights', label: 'Highlights' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="mt-3">
        {tab === 'review' && (
          <div className="space-y-4">
            <div className="card p-4">
              <div className="mb-1 flex items-center justify-between">
                <div className="label">Win probability</div>
                <div className="text-xs text-mute">Tap the graph to replay any moment</div>
              </div>
              <MomentumGraph match={m} team={me.team} onSelect={watch} />
            </div>

            <div className="card overflow-hidden">
              <div className="grid grid-cols-[1fr_repeat(4,52px)] items-center gap-y-0.5 p-4 text-sm sm:grid-cols-[1fr_repeat(4,76px)]">
                <div className="label">Shot grades</div>
                {m.players.map((p) => (
                  <div key={p.id} className="truncate text-center text-xs font-bold" style={{ color: p.color }}>
                    {p.name}
                  </div>
                ))}
                {GRADE_ORDER.map((g, gi) => (
                  <motion.div key={g} className="contents" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: gi * 0.05 }}>
                    <div className="flex items-center gap-2 py-1.5">
                      <GradeBadge grade={g} size={22} />
                      <span className="font-semibold" style={{ color: GRADE_META[g].color }}>
                        {GRADE_META[g].label}
                      </span>
                    </div>
                    {m.players.map((p) => (
                      <div key={p.id} className={`text-center font-bold num ${m.stats[p.id].grades[g] ? '' : 'text-white/20'}`}>
                        {m.stats[p.id].grades[g]}
                      </div>
                    ))}
                  </motion.div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 mt-6 text-lg font-extrabold">Key moments</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {keyMoments.map((r, i) => {
                  const s = r.shots[r.keyShot]
                  const p = name(s.hitter)!
                  const swing = Math.round((s.wpAfter - s.wpBefore) * 100) * (me.team === 0 ? 1 : -1)
                  return (
                    <motion.button
                      key={r.index}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => watch(r.index, r.keyShot)}
                      className="card flex items-center gap-3 p-4 text-left transition hover:border-white/25"
                    >
                      <GradeBadge grade={s.grade} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-mute">
                          Rally {r.index + 1} · {callScore(r.scoreBefore)}
                          <span className={`font-bold ${r.winner === me.team ? 'text-lime' : 'text-sky'}`}>{r.winner === me.team ? 'won' : 'lost'}</span>
                        </div>
                        <div className="font-bold">
                          <span style={{ color: p.color }}>{p.name}</span> · {SHOT_LABEL[s.type]}
                        </div>
                        <div className="truncate text-sm text-soft">{s.note}</div>
                      </div>
                      <div className={`text-sm font-black num ${swing >= 0 ? 'text-lime' : 'text-sky'}`}>
                        {swing >= 0 ? '+' : ''}
                        {swing}%
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'rallies' && rally && (
          <div className="space-y-3">
            <div className="scroll-x -mx-4 px-4">
              <div className="flex gap-1.5 pb-1">
                {m.rallies.map((r) => {
                  const bad = r.shots.some((s) => s.grade === 'blunder' && m.players.find((p) => p.id === s.hitter)?.team === me.team)
                  const great = r.shots.some((s) => s.grade === 'brilliant')
                  return (
                    <button
                      key={r.index}
                      onClick={() => {
                        setRallyIdx(r.index)
                        setShotIdx(0)
                      }}
                      className={`relative flex shrink-0 flex-col items-center rounded-xl border px-2.5 py-1.5 text-xs font-bold num transition ${r.index === rallyIdx ? 'border-lime bg-lime/15' : 'border-line bg-white/3'}`}
                    >
                      <span className="text-[10px] text-mute">#{r.index + 1}</span>
                      <span>{callScore(r.scoreBefore)}</span>
                      <span className={`mt-1 h-1 w-6 rounded-full ${r.winner === me.team ? 'bg-lime' : 'bg-sky'}`} />
                      {(great || bad) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full" style={{ background: great ? GRADE_META.brilliant.color : GRADE_META.blunder.color }} />}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
              <div className="lg:sticky lg:top-32 lg:self-start">
                <RallyPlayer match={m} rally={rally} shotIdx={shotIdx} onShot={setShotIdx} videoUrl={videoUrl} />
              </div>
              <div className="card max-h-[70vh] overflow-y-auto p-2">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <div className="label">Shot by shot</div>
                  <div className={`text-xs font-bold ${rally.winner === me.team ? 'text-lime' : 'text-sky'}`}>
                    {rally.winner === me.team ? 'Your team won' : 'Opponents won'} · {rally.pointScored ? 'point' : 'side out'}
                  </div>
                </div>
                {rally.shots.map((s) => {
                  const p = name(s.hitter)!
                  const sel = s.index === shotIdx
                  return (
                    <button key={s.index} onClick={() => setShotIdx(s.index)} className={`flex w-full items-start gap-2.5 rounded-xl p-2 text-left transition ${sel ? 'bg-white/8' : 'hover:bg-white/4'}`}>
                      <span className="w-5 pt-1 text-right text-xs text-mute num">{s.index + 1}</span>
                      <GradeBadge grade={s.grade} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold">
                          <span style={{ color: p.color }}>{p.name}</span> <span className="text-soft">{SHOT_LABEL[s.type]}</span>
                        </div>
                        {sel ? <div className="text-xs text-soft">{s.note}</div> : <div className="truncate text-xs text-mute">{s.note}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'players' && (
          <div className="space-y-4">
            <div className="scroll-x">
              <div className="flex gap-2">
                {m.players.map((p) => (
                  <button key={p.id} onClick={() => setPlayerId(p.id)} className={`chip !px-3 !py-1.5 !text-sm ${playerId === p.id ? '!text-ink' : ''}`} style={playerId === p.id ? { background: p.color, borderColor: p.color } : undefined}>
                    {p.name}
                    {p.isMe ? ' (you)' : ''}
                  </button>
                ))}
              </div>
            </div>
            {playerId && <PlayerReport match={m} playerId={playerId} onWatch={watch} />}
            <h3 className="pt-2 text-lg font-extrabold">Team battle</h3>
            <TeamReport match={m} />
          </div>
        )}

        {tab === 'coach' && <CoachPanel match={m} playerId={me.id} onWatch={watch} />}
        {tab === 'highlights' && <HighlightStudio match={m} onWatch={watch} videoUrl={videoUrl} />}
      </div>
    </div>
  )
}
