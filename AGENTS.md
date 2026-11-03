# KitchenIQ — handoff guide for AI coding agents

Read this whole file before changing anything. It is the single source of truth for what the
product is, how the code is laid out, how the analysis works, and what is unfinished.

## 1. Product in one paragraph

KitchenIQ is an AI pickleball coach that runs entirely in the browser (mobile-first PWA). A player
films a doubles game with their phone behind the baseline. The app maps the court, tracks the four
players, hears each paddle "pop", splits the video into rallies, keeps score, and produces a
**chess.com-style Game Review**: every shot graded Brilliant → Blunder, accuracy per player, a
win-probability ("momentum") graph, key moments, a 3D replay of every rally with a "show me the
better shot" ghost, player report cards, an AI coach report (3 personas, spoken aloud) with drills,
and an exportable vertical highlight reel. A separate **Live Coach** mode uses the front camera for
real-time form drills (ready position, dink form, serve legality) with voice cues.

- Owner: harasameeraj. Repo: https://github.com/harasameeraj/pickle (branch `main`).
- Live site: https://harasameeraj.github.io/pickle/ (GitHub Pages, branch `gh-pages`).
- Status: v0.1, pre-launch ("coming soon"). Monetisation is planned but **payments are deliberately
  not built yet** — do not add them unless asked.
- Everything is on-device: videos and matches live in IndexedDB. There is no backend.

## 2. Commands

```bash
npm install
npm run dev          # http://localhost:5173 (also exposed on LAN)
npm run dev:phone    # HTTPS with a self-signed cert so phones on Wi-Fi can use the camera
npm run typecheck    # tsc, must stay clean
npm run build        # tsc + vite build into dist/
npm run deploy       # builds with base /pickle/ and force-pushes dist/ to gh-pages (live in ~1 min)
```

There is no test runner yet. Verify changes with `npm run typecheck`, `npm run build`, and by
using the app (the demo match exercises the whole Review UI without a video).

## 3. Stack and conventions

- React 18 + TypeScript (strict, `noUnusedLocals`) + Vite 6 + Tailwind CSS v4 (`@tailwindcss/vite`).
  Tailwind must be **≥ 4.0.14**; 4.0.0's Vite plugin crashes the build.
- three.js 0.170 (3D replay), framer-motion 11 (UI animation), react-router 6, idb-keyval (storage),
  `@mediapipe/tasks-vision` 0.10.14 (pose). The WASM and pose models are loaded at runtime from
  jsDelivr / Google Storage CDNs (see `src/lib/vision.ts`), so first use needs a network.
- Pinned dependency versions; don't float them.
- Styling: dark sports theme. Design tokens are in `src/index.css` (`@theme`): `ink` background,
  `lime` (#d4ff3a) accent, `sky` (#38bdf8) for the opponent team, plus `.card`, `.card-hi`, `.btn`,
  `.btn-primary`, `.btn-ghost`, `.chip`, `.label`. Reuse them; don't introduce new colour systems.
- Shared UI primitives live in `src/components/ui.tsx` (`GradeBadge`, `GRADE_META`, `AccuracyRing`,
  `CountUp`, `Meter`, `StatBar`, `Segmented`, `TopBar`, nav, `Burst`). Use them.
- Code style: small pure functions in `src/lib`, UI in `src/components` and `src/pages`. Comments are
  sparse and explain *why*. Match the surrounding code.
- Routes are lazy-loaded in `src/App.tsx`; the Review chunk carries three.js (~150 KB gzip).
- The router uses `basename = import.meta.env.BASE_URL` so the same build works at `/` and `/pickle/`.
  Always navigate with router `Link`/`navigate`, and reference public assets with `%BASE_URL%` in
  `index.html`, never a hard-coded leading `/`.

## 4. Repository map

```
src/
  main.tsx, App.tsx            entry, routes, desktop SideNav / mobile BottomNav, page transitions
  index.css                    Tailwind v4 theme tokens + component classes
  lib/
    types.ts                   ALL core data types (read first)
    court.ts                   court geometry (feet), homography solve/apply, colours
    scoring.ts                 side-out doubles scoring (0-0-2 start, win by 2), score call text
    analyze.ts                 shot classification, rally win probability, grades, coach notes,
                               better-shot suggestions, player + team stats  ← the "brain"
    momentum.ts                game-level win probability (value iteration) for the momentum graph
    ballpath.ts                reconstructs a 3D ball flight from the shot list (for replays)
    track.ts                   interpolate player position from a track at time t
    demo.ts                    seeded doubles-game simulator → same engine as real video
    pipeline.ts                video → raw tracks → hits → rallies → engine input
    audio.ts                   paddle-pop onset detection from the decoded audio track
    ball.ts                    cheap colour+motion ball blob finder (overlay only)
    vision.ts                  MediaPipe loader, 13-keypoint pose format, nextTs() clock, helpers
    coach.ts                   coach report generator, personas, drill library, speech synthesis
    liveDrills.ts              Live Coach real-time engines (ready / dink / serve)
    db.ts                      IndexedDB (matches, videos, drill sessions) + localStorage settings
    flow.ts                    in-memory state for record/upload → setup → analyse → verify
  components/
    replay3d.ts                ReplayScene: three.js court, players, ball, trail, badges, ghost
    RallyPlayer.tsx            3D/video replay player, shot-by-shot transport, "better shot" toggle
    MomentumGraph.tsx          interactive win-probability graph
    PlayerReport.tsx           player report card + team comparison
    CoachPanel.tsx             persona picker, spoken report, leaks, drills
    HighlightStudio.tsx        picks highlights, records a 720x1280 reel via MediaRecorder
    CourtMap.tsx               per-player heatmap on a half court
    ui.tsx                     shared primitives (see §3)
  pages/
    Home, NewMatch (record/upload + Recorder), Setup (corners, players, details), Analyzing,
    Verify (confirm rally winners), Review (the Game Review), Matches (history + trends),
    Coach (drill list), LiveCoach (camera drills), Settings
promo/                         promo video renderer (dev-only, not part of the app build)
  scenes.ts, music.ts, main.ts, audio/*.wav + lines.json, tools/gen_voice.py
promo.html, vite.promo.config.ts
public/                        icon.svg, manifest.webmanifest
```

## 5. Core data model (`src/lib/types.ts`)

- **Court coordinates are feet.** `x` 0→20 across (left sideline as seen from the camera),
  `y` 0→44 along (0 = far baseline, 44 = near/camera baseline), net at `y = 22`, kitchen lines at
  15 and 29. **Team 0 is always the near (camera) side**; teams never switch ends within a match.
- `Player { id, name, team, color, isMe }` — ids are `p1..p4` (p1/p2 near, p3/p4 far).
- `TrackSample { t, pos: Record<id, Vec2>, pose?, ball? }` — pose is 13 keypoints flattened
  `[x0,y0,…]` in normalised image coords, order in `vision.ts` (`KEEP`, `K`).
- `RallyInput` (engine input): `hits: HitInput[]` (t, hitter, court pos, contact low/mid/high,
  optional `typeHint`), `winner`, `endKind`, `track`.
- `Rally` / `Shot` (engine output): each shot has `type`, `grade`, `quality` 0–1, `wpBefore/wpAfter`
  (P(team 0 wins the rally)), `note`, optional `better`, `target`, `apex`, `bounces`, `outcome`.
- `Match`: players, settings, rallies, `finalScore`, `winner`, `stats` per player, `teamStats`,
  optional `videoKey` (IndexedDB blob), `corners`.

## 6. How the analysis works

### 6.1 Video pipeline (`pipeline.ts`)
1. `ensureDuration()` — MediaRecorder WebM files report `duration = Infinity`; this forces a scan.
2. Audio is decoded and `detectPops()` finds paddle strikes (first-difference high-pass energy,
   ≥5× local level and above a 97th-percentile floor, 0.22 s refractory). Verified exact on
   synthetic pops.
3. The video is **seeked** frame by frame at `flow.fps` (6/10/15) — deterministic, not real-time.
   Each frame: MediaPipe PoseLandmarker (`full`, up to 6 people) → feet midpoint → homography from the
   4 tapped corners → court position. Players keep identity by greedy matching on distance
   (+25 ft penalty for the wrong side of the net, + shirt colour distance). Wrist speed is stored
   in body-heights/second.
4. `detectRallies()` — pops confirmed by a wrist-speed spike (or wrist-speed peaks when there is no
   audio) → grouped into rallies when gaps < 4.5 s → hits alternate teams; the starting team is the
   phase with most wrist evidence → hitter = teammate with the biggest wrist-speed spike
   (server = deepest player). Contact height from wrist vs shoulder/hip. Winner is a **guess**.
5. The **Verify** page lets the user fix winners / drop false rallies. `finalizeRallies()` then
   replays the score to know who served each rally and reassigns hitters from that.
6. `buildMatch()` (analyze.ts) produces the Match.

**MediaPipe gotcha:** a landmarker in VIDEO mode needs strictly increasing timestamps across every
call on the same cached model. Always pass `nextTs()` from `vision.ts`, never `performance.now()`
or a local counter.

### 6.2 The engine (`analyze.ts`)
- `classify()` — shot type from index (serve/return), hitter distance to net, time to next hit,
  time since previous hit, contact height and previous type. Thresholds are heuristics (e.g. dink if
  ≥ 1.0 s at the kitchen, drop if ≥ 1.15 s from the baseline). The simulator passes `typeHint`.
- `quality()` — 0–1 for the hitter, judged mostly by **what the opponent could do next** (were they
  forced to hit up? could they attack?), plus kitchen arrival after returns, low-contact speed-ups,
  and missed put-aways (high ball at the kitchen sent back soft).
- Rally win probability: `wpAfter = σ(0.8·logit(wpBefore) + 0.3·Δkitchen + 2.6·(q − 0.66))`;
  serving side starts at 0.46.
- `gradeFor()` — winners/errors handled explicitly (unforced error = Blunder; forced = Good or
  Inaccuracy); Brilliant only for difficult shots that flip a losing rally; otherwise by quality
  bands. `coachNote()` writes the note and the `better` shot (type, target, apex, tip).
- `momentum.ts` turns rally WP into game WP via a solved side-out scoring Markov model, so the graph
  is continuous across rallies.
- Calibration target on the demo: Brilliant ~0–2 per player per game, accuracies ~60–80.

### 6.3 Replays
`ballpath.ts` rebuilds a plausible parabola per shot (bounce where rules require, net-clearance
fix, net-stop for errors, roll-out for winners). `ReplayScene` (`replay3d.ts`) renders it with
stylised players that swing at contact, grade sprites, hit flashes, a ball trail, 4 camera presets,
`step(t)` for frame-exact rendering and `showGhost()/setGhostPhase()` for the better shot.

### 6.4 Live Coach (`liveDrills.ts`)
Single-person pose stream (`lite` model). A `RepDetector` finds swings from paddle-wrist speed
peaks. Engines score knee angle, swing size, contact height (dink), contact below waist / upward
path / follow-through (serve), and paddle-up time (ready). Voice cues via `speechSynthesis`, throttled.

## 7. Known limitations and backlog (in priority order)

1. **Not yet tuned on real footage.** All thresholds were tuned on the simulator and synthetic
   clips. Next step: collect real filmed games, hand-label rallies/shots, measure hit detection,
   hitter attribution and grade agreement, then retune `classify`, `quality` and `detectPops`.
2. Busy parks: neighbouring-court pops create false hits; only partly filtered by wrist evidence.
3. Doubles only, traditional side-out scoring, one game per video, no end switching.
4. Ball tracking (`ball.ts`) is overlay-only and weak; a trained small detector (e.g. TrackNet-style)
   would enable real landing points, in/out calls and better shot typing.
5. Long videos are processed on-device frame by frame (roughly real-time or slower). A server/GPU
   path or WebGPU would be needed for scale.
6. Highlight reel export (`HighlightStudio`) records in real time with `requestAnimationFrame`, so
   the tab must stay visible. The promo renderer shows the frame-exact WebCodecs approach to copy.
7. No automated tests. Good first tests: `scoring.ts`, `momentum.ts` (0-0-2 ≈ 0.5, 10-5 ≈ 0.97),
   `analyze.ts` on `simulateMatch(7)` (deterministic), `audio.ts` on synthetic pops.
8. Planned product work (not started): accounts/sync, payments (freemium Pro tier), coach
   marketplace, sharing review links, native app (React Native/Swift) for camera robustness.

## 8. Promo video (`promo/`)

A 33.5 s vertical (1080×1920, 30 fps) promo rendered frame-exactly in the browser:
`scenes.ts` draws each frame (`draw(ctx, t)`), `music.ts` synthesises the soundtrack in an
OfflineAudioContext (128 BPM; DROP 3.75 s, BREAK 26.05 s, FINAL 28.6 s) and mixes the narration with
ducking, `main.ts` encodes H.264 + AAC with WebCodecs and muxes with `mp4-muxer`.

```bash
npx vite --config vite.promo.config.ts   # then open http://localhost:5174/promo.html → Render MP4
```
Output is POSTed back to the dev server and saved to `promo/out/kitcheniq-promo.mp4` (git-ignored).
Voice-line start times live in `AT` in `promo/main.ts`; visual hit times (WHY?, BRILLIANT at 15.2,
BLUNDER at 16.05, slams at 26.4/27.4, COMING SOON at ~29.9) are hard-coded in `scenes.ts` and the
matching sound effects in `music.ts` — change them together. The ending is intentionally
"COMING SOON" (no link) until launch.

Narration is generated with Kokoro (local neural TTS, voice `af_heart`):
```bash
python3.11 -m venv tts && ./tts/bin/pip install kokoro-onnx==0.4.9 soundfile
brew install espeak-ng            # the pip-bundled espeak has a broken data path on macOS
# download kokoro-v1.0.onnx and voices-v1.0.bin from
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 into ./models
./tts/bin/python promo/tools/gen_voice.py ./models promo/audio af_heart
```
The script fits each line into its time slot (speeding up only if needed) and writes `lines.json`.

## 9. Ground rules for agents

- Keep everything on-device unless the owner asks for a backend; never upload user video.
- Keep `npm run typecheck` and `npm run build` clean before you finish.
- Don't commit `promo/out/`, `dist/`, or `node_modules/`. Deploy only with `npm run deploy`, and only
  when the owner asks.
- Don't invent product claims, stats or testimonials in UI or marketing copy.
- When you change engine behaviour, re-run the demo (`simulateMatch(7)`) and sanity-check grade
  counts and accuracies against §6.2.
- Update this file when you change architecture, commands or known limitations.
