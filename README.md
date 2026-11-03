# KitchenIQ — AI pickleball coach

Film a doubles game and get a chess.com-style **Game Review**: automatic scorekeeping, every shot graded from Brilliant to Blunder, accuracy per player, a win-probability graph, key moments, a 3D replay of every rally with a "show me the better shot" ghost, coach reports with voice, drills, and an exportable vertical highlight reel. **Live Coach** gives real-time voice feedback on ready position, dink form and serve legality from the camera.

Working on the code with an AI agent? Start with [AGENTS.md](AGENTS.md); it has the full architecture, conventions and backlog.

Everything runs in the browser. Videos and analysis stay on the device (IndexedDB).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:phone    # HTTPS on your Wi-Fi so a phone can use the camera (accept the certificate warning)
npm run build        # static site in dist/, deploy to any static host (Vercel, Netlify, Cloudflare Pages)
```

Camera features need HTTPS (or localhost). The vision model downloads from Google's CDN on first use.

## How the analysis works

| Stage | File |
|---|---|
| Paddle-pop detection from the audio track (high-pass energy spikes) | `src/lib/audio.ts` |
| Body tracking (MediaPipe Pose, up to 6 people) mapped onto the court via a homography from 4 tapped corners; identities kept with position + shirt colour | `src/lib/pipeline.ts`, `src/lib/court.ts`, `src/lib/vision.ts` |
| Ball candidates (moving, ball-coloured blobs) for overlays | `src/lib/ball.ts` |
| Pops + wrist speed → hits → rallies, alternating teams; user confirms rally winners | `src/lib/pipeline.ts`, `src/pages/Verify.tsx` |
| Shot classification, rally win probability, grades, coaching notes, better-shot suggestions, stats | `src/lib/analyze.ts` |
| Game-level win probability (side-out scoring, value iteration) for the momentum graph | `src/lib/momentum.ts` |
| 3D ball-flight reconstruction and replay (three.js) | `src/lib/ballpath.ts`, `src/components/replay3d.ts` |
| Coach reports, personas, drills, speech | `src/lib/coach.ts` |
| Live Coach form engines | `src/lib/liveDrills.ts` |
| Demo match simulator (same engine as real video) | `src/lib/demo.ts` |

## Known limits (v0.1)

- Grades and shot types come from heuristics (timing between hits, positions, contact height), not a trained model. They need tuning against real labelled match footage.
- Hit detection relies on clear paddle pops; noisy parks with neighbouring courts will produce extra pops. The Verify step is where users correct that.
- Doubles, traditional side-out scoring, one game per video. Teams are assumed not to switch ends mid-video.
- Long videos are processed frame by frame on the device: roughly real-time or slower depending on hardware and the detail setting.
