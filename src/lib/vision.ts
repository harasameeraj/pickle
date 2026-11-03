import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
}

/** Landmarks we keep, in this order (MediaPipe indices). */
export const KEEP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
export const K = {
  nose: 0,
  lShoulder: 1,
  rShoulder: 2,
  lElbow: 3,
  rElbow: 4,
  lWrist: 5,
  rWrist: 6,
  lHip: 7,
  rHip: 8,
  lKnee: 9,
  rKnee: 10,
  lAnkle: 11,
  rAnkle: 12,
}
export const BONES: [number, number][] = [
  [1, 2],
  [1, 3],
  [3, 5],
  [2, 4],
  [4, 6],
  [1, 7],
  [2, 8],
  [7, 8],
  [7, 9],
  [9, 11],
  [8, 10],
  [10, 12],
]

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null
const landmarkers: Partial<Record<'lite' | 'full', Promise<PoseLandmarker>>> = {}

export function getPoseLandmarker(kind: 'lite' | 'full', numPoses: number): Promise<PoseLandmarker> {
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM)
  const key = kind
  if (!landmarkers[key]) {
    landmarkers[key] = filesetPromise.then(async (fs) => {
      const make = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: MODELS[kind], delegate },
          runningMode: 'VIDEO',
          numPoses,
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.35,
          minTrackingConfidence: 0.35,
        })
      try {
        return await make('GPU')
      } catch {
        return make('CPU')
      }
    })
  }
  return landmarkers[key]!
}

let lastTs = 0
/** MediaPipe VIDEO mode needs strictly increasing timestamps across every call on a model. */
export function nextTs() {
  lastTs = Math.max(performance.now(), lastTs + 1)
  return lastTs
}

/** Flatten a MediaPipe pose to our 13-keypoint [x0, y0, x1, y1, ...] format. */
export function compactPose(lm: NormalizedLandmark[]): number[] {
  const out: number[] = []
  for (const i of KEEP) out.push(+lm[i].x.toFixed(4), +lm[i].y.toFixed(4))
  return out
}

export const kp = (pose: number[], i: number) => ({ x: pose[i * 2], y: pose[i * 2 + 1] })

/** Joint angle at b (degrees) for points a-b-c. */
export function angle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }
  const v2 = { x: c.x - b.x, y: c.y - b.y }
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))) * 180) / Math.PI
}

/** Body height in image units (shoulder midpoint to ankle midpoint) for scale normalisation. */
export function bodyScale(pose: number[]) {
  const s = mid(kp(pose, K.lShoulder), kp(pose, K.rShoulder))
  const a = mid(kp(pose, K.lAnkle), kp(pose, K.rAnkle))
  return Math.max(0.02, Math.hypot(s.x - a.x, s.y - a.y))
}

export const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function feet(pose: number[]) {
  return mid(kp(pose, K.lAnkle), kp(pose, K.rAnkle))
}
