// Court coordinates are in feet. x runs across the court (0 = left sideline as seen
// from the camera, 20 = right sideline). y runs along it (0 = far baseline,
// 44 = near baseline, net at 22). Team 0 always starts on the near (camera) side.

export interface Vec2 {
  x: number
  y: number
}

export type TeamId = 0 | 1

export interface Player {
  id: string
  name: string
  team: TeamId
  color: string
  isMe?: boolean
}

export type ShotType =
  | 'serve'
  | 'return'
  | 'drop'
  | 'drive'
  | 'dink'
  | 'volley'
  | 'speedup'
  | 'reset'
  | 'lob'
  | 'overhead'

export type Grade =
  | 'brilliant'
  | 'great'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'missed'
  | 'blunder'

/** Contact height relative to the hitter's body. */
export type Contact = 'low' | 'mid' | 'high'

/** How a rally ended, from the point of view of the last shot. */
export type EndKind = 'winner' | 'net' | 'out' | 'fault' | 'unknown'

/** A single sampled pose: 13 keypoints (x, y) in normalised image coords, flattened. */
export type PoseSample = number[]

export interface TrackSample {
  t: number
  /** Court position (feet) of each player, keyed by player id. */
  pos: Record<string, Vec2>
  /** Optional image-space pose per player (video matches only). */
  pose?: Record<string, PoseSample>
  /** Optional ball position in normalised image coords (video matches only). */
  ball?: Vec2 | null
}

/** Raw hit as produced by video analysis or the simulator, before classification. */
export interface HitInput {
  t: number
  hitter: string
  pos: Vec2
  contact: Contact
  /** Ground-truth shot type, when known (simulator). */
  typeHint?: ShotType
}

export interface RallyInput {
  start: number
  end: number
  hits: HitInput[]
  winner: TeamId
  endKind: EndKind
  track: TrackSample[]
}

export interface BetterShot {
  type: ShotType
  target: Vec2
  apex: number
  tip: string
}

export interface Shot {
  index: number
  t: number
  hitter: string
  team: TeamId
  pos: Vec2
  contact: Contact
  type: ShotType
  /** Where the ball went: next contact point, or landing point for the last shot. */
  target: Vec2
  /** Peak height of the ball flight in feet (used for 3D reconstruction). */
  apex: number
  bounces: boolean
  /** Probability (0–1) that team 0 wins the rally, before and after this shot. */
  wpBefore: number
  wpAfter: number
  /** Shot quality 0–1 for the hitter. */
  quality: number
  grade: Grade
  note: string
  better?: BetterShot
  outcome?: 'winner' | 'unforced' | 'forced'
}

export interface Score {
  points: [number, number]
  serving: TeamId
  server: 1 | 2
}

export interface Rally {
  id: string
  index: number
  start: number
  end: number
  scoreBefore: Score
  scoreAfter: Score
  winner: TeamId
  endKind: EndKind
  pointScored: boolean
  shots: Shot[]
  track: TrackSample[]
  /** Highest-impact shot index in this rally (for key moments). */
  keyShot: number
  swing: number
}

export interface PlayerStats {
  playerId: string
  shots: number
  accuracy: number
  grades: Record<Grade, number>
  shotMix: Partial<Record<ShotType, number>>
  winners: number
  unforced: number
  forced: number
  serveIn: number
  serveTotal: number
  returnDeep: number
  returnTotal: number
  kitchenArrivals: number
  kitchenChances: number
  dropsGood: number
  dropsTotal: number
  dinks: number
  dinkErrors: number
  speedups: number
  speedupsWon: number
  missedPutaways: number
  avgNetDist: number
  /** 10 columns x 11 rows over the player's own half; row 0 is at the net. */
  heat: number[]
  bestShot?: { rally: number; shot: number }
  worstShot?: { rally: number; shot: number }
}

export interface TeamStats {
  team: TeamId
  rallyWins: number
  pointsOnServe: number
  serveRallies: number
  sideOutsWon: number
  returnRallies: number
  bothAtKitchenPct: number
  splitPct: number
  avgSpacing: number
  shortRallyWinPct: number
  longRallyWinPct: number
  dinkRallyWinPct: number
}

export interface MatchSettings {
  gameTo: number
  firstServer: TeamId
}

export interface Match {
  id: string
  createdAt: number
  title: string
  source: 'demo' | 'video'
  videoKey?: string
  duration: number
  players: Player[]
  settings: MatchSettings
  rallies: Rally[]
  finalScore: [number, number]
  winner: TeamId | null
  stats: Record<string, PlayerStats>
  teamStats: [TeamStats, TeamStats]
  /** Image-space court corners used for calibration (video matches). */
  corners?: Vec2[]
  videoAspect?: number
}
