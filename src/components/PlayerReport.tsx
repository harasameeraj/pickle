import { motion } from 'framer-motion'
import { SHOT_LABEL } from '../lib/analyze'
import type { Match, ShotType } from '../lib/types'
import CourtMap from './CourtMap'
import { AccuracyRing, GRADE_META, GradeBadge, Meter, StatBar } from './ui'

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export function PlayerReport({ match, playerId, onWatch }: { match: Match; playerId: string; onWatch: (rally: number, shot: number) => void }) {
  const p = match.players.find((x) => x.id === playerId)!
  const st = match.stats[playerId]
  const mix = Object.entries(st.shotMix).sort((a, b) => b[1] - a[1]) as [ShotType, number][]
  const best = st.bestShot ? match.rallies[st.bestShot.rally]?.shots[st.bestShot.shot] : null
  const worst = st.worstShot ? match.rallies[st.worstShot.rally]?.shots[st.worstShot.shot] : null

  return (
    <motion.div key={playerId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <div className="card p-5">
        <div className="flex items-center gap-4">
          <AccuracyRing value={st.accuracy} color={p.color} size={96} />
          <div>
            <div className="text-2xl font-black">{p.name}</div>
            <div className="text-sm text-mute">
              {st.shots} shots · {st.winners} winners · {st.unforced} unforced errors
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(GRADE_META) as (keyof typeof GRADE_META)[])
                .filter((g) => st.grades[g] > 0)
                .map((g) => (
                  <span key={g} className="chip !py-0.5">
                    <GradeBadge grade={g} size={14} /> {st.grades[g]}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-3.5">
          <Meter label="Got to the kitchen line" value={pct(st.kitchenArrivals, st.kitchenChances)} color={p.color} />
          {st.dropsTotal > 0 && <Meter label="Third-shot drops unattackable" value={pct(st.dropsGood, st.dropsTotal)} color={p.color} />}
          {st.dinks > 0 && <Meter label="Dink consistency" value={100 - pct(st.dinkErrors, st.dinks)} color={p.color} />}
          {st.serveTotal > 0 && <Meter label="Serves in" value={pct(st.serveIn, st.serveTotal)} color={p.color} />}
          {st.returnTotal > 0 && <Meter label="Deep returns" value={pct(st.returnDeep, st.returnTotal)} color={p.color} />}
          {st.speedups > 0 && <Meter label="Speed-ups that won the point" value={pct(st.speedupsWon, st.speedups)} color={p.color} />}
        </div>
      </div>
      <div className="grid gap-4">
        <div className="card p-5">
          <div className="label mb-3">Where {p.name} played</div>
          <div className="mx-auto max-w-[220px]">
            <CourtMap heat={st.heat} color={p.color} />
          </div>
          <div className="mt-2 text-center text-sm text-mute">
            Average <b className="text-white">{st.avgNetDist.toFixed(1)} ft</b> from the net
          </div>
        </div>
        <div className="card p-5">
          <div className="label mb-3">Shot mix</div>
          <div className="space-y-2">
            {mix.map(([t, n], i) => (
              <div key={t} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-soft">{SHOT_LABEL[t]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                  <motion.div className="h-full rounded-full" style={{ background: p.color }} initial={{ width: 0 }} whileInView={{ width: `${(n / mix[0][1]) * 100}%` }} viewport={{ once: true }} transition={{ delay: i * 0.05, duration: 0.8 }} />
                </div>
                <span className="w-6 text-right font-bold num">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
        {best && (
          <button onClick={() => onWatch(st.bestShot!.rally, st.bestShot!.shot)} className="card flex items-center gap-3 p-4 text-left transition hover:border-white/25">
            <GradeBadge grade={best.grade} size={36} />
            <div className="min-w-0">
              <div className="label">Shot of the match</div>
              <div className="font-bold">
                {SHOT_LABEL[best.type]} · rally {st.bestShot!.rally + 1}
              </div>
              <div className="truncate text-sm text-mute">{best.note}</div>
            </div>
            <span className="ml-auto text-lime">▶</span>
          </button>
        )}
        {worst && (
          <button onClick={() => onWatch(st.worstShot!.rally, st.worstShot!.shot)} className="card flex items-center gap-3 p-4 text-left transition hover:border-white/25">
            <GradeBadge grade={worst.grade} size={36} />
            <div className="min-w-0">
              <div className="label">Learn from this one</div>
              <div className="font-bold">
                {SHOT_LABEL[worst.type]} · rally {st.worstShot!.rally + 1}
              </div>
              <div className="truncate text-sm text-mute">{worst.note}</div>
            </div>
            <span className="ml-auto text-lime">▶</span>
          </button>
        )}
      </div>
    </motion.div>
  )
}

export function TeamReport({ match }: { match: Match }) {
  const [a, b] = match.teamStats
  const names = (t: 0 | 1) =>
    match.players
      .filter((p) => p.team === t)
      .map((p) => p.name)
      .join(' & ')
  return (
    <div className="card p-5">
      <div className="mb-2 flex justify-between text-sm font-extrabold">
        <span className="text-lime">{names(0)}</span>
        <span className="text-sky">{names(1)}</span>
      </div>
      <StatBar label="Rallies won" a={a.rallyWins} b={b.rallyWins} />
      <StatBar label="Points won on serve" a={a.pointsOnServe} b={b.pointsOnServe} />
      <StatBar label="Side-outs won" a={a.sideOutsWon} b={b.sideOutsWon} />
      <StatBar label="Both at the kitchen line" a={a.bothAtKitchenPct} b={b.bothAtKitchenPct} fmt={(v) => `${v}%`} />
      <StatBar label="One up, one back" a={a.splitPct} b={b.splitPct} fmt={(v) => `${v}%`} />
      <StatBar label="Short rallies won (≤5 shots)" a={a.shortRallyWinPct} b={b.shortRallyWinPct} fmt={(v) => `${v}%`} />
      <StatBar label="Long rallies won (10+ shots)" a={a.longRallyWinPct} b={b.longRallyWinPct} fmt={(v) => `${v}%`} />
      <StatBar label="Dink battles won" a={a.dinkRallyWinPct} b={b.dinkRallyWinPct} fmt={(v) => `${v}%`} />
      <StatBar label="Partner spacing (ft)" a={+a.avgSpacing.toFixed(1)} b={+b.avgSpacing.toFixed(1)} />
    </div>
  )
}
