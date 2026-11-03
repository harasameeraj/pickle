import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { arcPoints, ballAt, buildSegments, contactHeight, type Segment } from '../lib/ballpath'
import { COURT_L, COURT_W, courtLines, KITCHEN, NET_Y } from '../lib/court'
import { posAt } from '../lib/track'
import type { BetterShot, Player, Rally, Shot } from '../lib/types'
import { GRADE_META } from './ui'

export type View = 'broadcast' | 'top' | 'side' | 'baseline'

const V = (x: number, y: number, h = 0) => new THREE.Vector3(x - COURT_W / 2, h, y - NET_Y)

const VIEWS: Record<View, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  broadcast: { pos: new THREE.Vector3(0, 25, 45), target: new THREE.Vector3(0, 0, 1) },
  top: { pos: new THREE.Vector3(0, 54, 0.01), target: new THREE.Vector3(0, 0, 0) },
  side: { pos: new THREE.Vector3(-36, 13, 0), target: new THREE.Vector3(0, 1, 0) },
  baseline: { pos: new THREE.Vector3(0, 9, 34), target: new THREE.Vector3(0, 3, -6) },
}

function textSprite(text: string, color: string, opts: { bg?: string; size?: number; bold?: boolean } = {}) {
  const c = document.createElement('canvas')
  const fs = 48
  const ctx = c.getContext('2d')!
  ctx.font = `${opts.bold === false ? 600 : 800} ${fs}px Inter, sans-serif`
  const w = Math.ceil(ctx.measureText(text).width) + 40
  c.width = w
  c.height = fs + 28
  ctx.font = `${opts.bold === false ? 600 : 800} ${fs}px Inter, sans-serif`
  if (opts.bg) {
    ctx.fillStyle = opts.bg
    const r = c.height / 2
    ctx.beginPath()
    ctx.roundRect(0, 0, w, c.height, r)
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, w / 2, c.height / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const s = new THREE.Sprite(mat)
  const scale = (opts.size ?? 1.6) / c.height
  s.scale.set(w * scale, c.height * scale, 1)
  s.renderOrder = 10
  return s
}

function badgeSprite(shot: Shot) {
  const m = GRADE_META[shot.grade]
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.shadowColor = m.color
  ctx.shadowBlur = 24
  ctx.fillStyle = m.color
  ctx.beginPath()
  ctx.arc(64, 64, 44, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#07110d'
  ctx.font = `900 ${m.symbol.length > 1 ? 40 : 54}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(m.symbol, 64, 68)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  s.scale.set(2.6, 2.6, 1)
  s.renderOrder = 12
  return s
}

interface PlayerRig {
  group: THREE.Group
  arm: THREE.Group
  ring: THREE.Mesh
  label: THREE.Sprite
  team: 0 | 1
}

export class ReplayScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  private rigs = new Map<string, PlayerRig>()
  private ball: THREE.Mesh
  private ballShadow: THREE.Mesh
  private trail: THREE.Points
  private trailPos: Float32Array
  private trailCol: Float32Array
  private trailHist: THREE.Vector3[] = []
  private flashes: { mesh: THREE.Mesh; t: number }[] = []
  private badges: { sprite: THREE.Sprite; shot: Shot }[] = []
  private ghostGroup = new THREE.Group()
  private ghostBall: THREE.Mesh | null = null
  private ghostPts: THREE.Vector3[] = []
  private rally: Rally | null = null
  private segs: Segment[] = []
  private raf = 0
  private lastFrame = performance.now()
  private camTween: { from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; p: number } | null = null
  private lastShotIdx = -1
  private ro: ResizeObserver
  time = 0
  playing = false
  speed = 1
  loopEnd = 0
  stopAt: number | null = null
  onTime?: (t: number) => void
  onShot?: (shot: Shot) => void
  onEnd?: () => void

  constructor(private host: HTMLElement, players: Player[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'

    this.scene.background = new THREE.Color('#06100c')
    this.scene.fog = new THREE.Fog('#06100c', 70, 140)
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400)
    this.camera.position.copy(VIEWS.broadcast.pos)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(VIEWS.broadcast.target)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI / 2.05
    this.controls.minDistance = 12
    this.controls.maxDistance = 110

    this.buildEnvironment()
    for (const p of players) this.rigs.set(p.id, this.buildPlayer(p))

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#e6ff3d', emissive: '#b5d900', emissiveIntensity: 0.9, roughness: 0.4 }),
    )
    this.ball.castShadow = true
    this.scene.add(this.ball)
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35 }))
    this.ballShadow.rotation.x = -Math.PI / 2
    this.scene.add(this.ballShadow)

    const N = 26
    this.trailPos = new Float32Array(N * 3)
    this.trailCol = new Float32Array(N * 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3))
    this.trail = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.scene.add(this.trail)
    this.scene.add(this.ghostGroup)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
    this.loop()
  }

  private buildEnvironment() {
    const s = this.scene
    s.add(new THREE.HemisphereLight('#cfe9ff', '#0b1a12', 0.9))
    const sun = new THREE.DirectionalLight('#ffffff', 2.2)
    sun.position.set(-20, 40, 18)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -30
    sc.right = 30
    sc.top = 35
    sc.bottom = -35
    s.add(sun)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#0a1d15', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    s.add(ground)

    const apron = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 20, COURT_L + 22), new THREE.MeshStandardMaterial({ color: '#145236', roughness: 0.9 }))
    apron.rotation.x = -Math.PI / 2
    apron.receiveShadow = true
    s.add(apron)

    const court = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, COURT_L), new THREE.MeshStandardMaterial({ color: '#1f4aa8', roughness: 0.75 }))
    court.rotation.x = -Math.PI / 2
    court.position.y = 0.01
    court.receiveShadow = true
    s.add(court)

    for (const side of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W, KITCHEN), new THREE.MeshStandardMaterial({ color: '#2a63c9', roughness: 0.75 }))
      k.rotation.x = -Math.PI / 2
      k.position.set(0, 0.015, (side * KITCHEN) / 2)
      k.receiveShadow = true
      s.add(k)
    }

    const lineMat = new THREE.MeshBasicMaterial({ color: '#f4f8ff' })
    for (const [a, b] of courtLines()) {
      const A = V(a.x, a.y)
      const B = V(b.x, b.y)
      const len = A.distanceTo(B)
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.17, 0.17), lineMat)
      m.rotation.x = -Math.PI / 2
      m.position.copy(A.clone().add(B).multiplyScalar(0.5)).setY(0.03)
      if (Math.abs(A.x - B.x) < 0.01) m.rotation.z = Math.PI / 2
      s.add(m)
    }

    // net
    const netMat = new THREE.MeshStandardMaterial({ color: '#0b0f0d', transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    const net = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W + 2, 2.85), netMat)
    net.position.set(0, 1.45, 0)
    s.add(net)
    const tape = new THREE.Mesh(new THREE.BoxGeometry(COURT_W + 2, 0.22, 0.06), new THREE.MeshStandardMaterial({ color: '#ffffff' }))
    tape.position.set(0, 2.9, 0)
    tape.castShadow = true
    s.add(tape)
    for (const x of [-(COURT_W / 2 + 1), COURT_W / 2 + 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.1, 12), new THREE.MeshStandardMaterial({ color: '#d9e2dc', metalness: 0.4 }))
      post.position.set(x, 1.55, 0)
      post.castShadow = true
      s.add(post)
    }

    // fence posts for depth
    const fenceMat = new THREE.MeshStandardMaterial({ color: '#1a2f25' })
    for (let i = -3; i <= 3; i++) {
      for (const z of [-34, 34]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 10, 0.25), fenceMat)
        p.position.set(i * 6, 5, z)
        s.add(p)
      }
    }
    const fenceNet = new THREE.MeshStandardMaterial({ color: '#0f1f18', transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    for (const z of [-34, 34]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(36, 10), fenceNet)
      f.position.set(0, 5, z)
      s.add(f)
    }
  }

  private buildPlayer(p: Player): PlayerRig {
    const group = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.45, emissive: p.color, emissiveIntensity: 0.12 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 2.3, 6, 16), mat)
    body.position.y = 2.2
    body.castShadow = true
    group.add(body)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 16), new THREE.MeshStandardMaterial({ color: '#f1d7c0', roughness: 0.6 }))
    head.position.y = 4.55
    head.castShadow = true
    group.add(head)
    const visor = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 8, 24, Math.PI), mat)
    visor.rotation.x = Math.PI / 2
    visor.position.y = 4.75
    group.add(visor)
    const arm = new THREE.Group()
    arm.position.set(0.95, 3.3, 0)
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), mat)
    forearm.position.y = -0.8
    arm.add(forearm)
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.15, 0.08), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3 }))
    paddle.position.y = -2.05
    paddle.castShadow = true
    arm.add(paddle)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), new THREE.MeshStandardMaterial({ color: '#333' }))
    handle.position.y = -1.35
    arm.add(handle)
    group.add(arm)
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 32), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.85 }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    group.add(ring)
    const label = textSprite(p.name, '#07110d', { bg: p.color, size: 1.25 })
    label.position.y = 6.2
    group.add(label)
    this.scene.add(group)
    return { group, arm, ring, label, team: p.team }
  }

  setRally(r: Rally) {
    this.rally = r
    this.segs = buildSegments(r)
    for (const b of this.badges) {
      this.scene.remove(b.sprite)
    }
    this.badges = r.shots.map((shot) => {
      const sprite = badgeSprite(shot)
      sprite.visible = false
      this.scene.add(sprite)
      return { sprite, shot }
    })
    const last = this.segs[this.segs.length - 1]
    this.loopEnd = last ? (last.tail ? last.tail.t1 : last.t1) + 1 : r.end
    this.trailHist = []
    this.lastShotIdx = -1
    this.clearGhost()
    this.seek(r.shots[0] ? r.shots[0].t - 0.8 : r.start)
  }

  seek(t: number) {
    this.time = t
    this.trailHist = []
    this.lastShotIdx = this.rally ? this.rally.shots.filter((s) => s.t <= t).length - 1 : -1
    this.renderAt(t)
  }

  /** Render a specific time without resetting the ball trail (for driven playback). */
  step(t: number) {
    this.time = t
    this.renderAt(t)
  }

  setView(v: View) {
    const target = VIEWS[v]
    this.camTween = { from: this.camera.position.clone(), to: target.pos.clone(), tf: this.controls.target.clone(), tt: target.target.clone(), p: 0 }
  }

  showGhost(shot: Shot, better: BetterShot) {
    this.clearGhost()
    const h0 = contactHeight(shot)
    const mk = (pts: { x: number; y: number; h: number }[], color: string, dashed: boolean) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => V(p.x, p.y, p.h)))
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.9 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      this.ghostGroup.add(line)
      return pts
    }
    // what happened
    const seg = this.segs[shot.index]
    if (seg) {
      const actual: { x: number; y: number; h: number }[] = []
      for (let i = 0; i <= 40; i++) {
        const b = ballAt([seg], seg.t0 + ((seg.tail ? seg.tail.t1 : seg.t1) - seg.t0) * (i / 40))
        if (b) actual.push(b)
      }
      mk(actual, '#ef4444', true)
    }
    // what would have been better
    const pts = arcPoints(shot.pos, h0, better.target, better.apex, undefined, 50)
    mk(pts, '#22d3ee', false)
    this.ghostPts = pts.map((p) => V(p.x, p.y, p.h))
    const target = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32), new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.9, side: THREE.DoubleSide }))
    target.rotation.x = -Math.PI / 2
    target.position.copy(V(better.target.x, better.target.y, 0.06))
    this.ghostGroup.add(target)
    this.ghostBall = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.85 }))
    this.ghostGroup.add(this.ghostBall)
    const tag = textSprite('Better: ' + better.type, '#07110d', { bg: '#22d3ee', size: 1.1 })
    tag.position.copy(V(better.target.x, better.target.y, 2.4))
    this.ghostGroup.add(tag)
  }

  /** Place the ghost ball at a fraction of its arc (for frame-exact rendering). */
  setGhostPhase(u: number) {
    if (!this.ghostBall || !this.ghostPts.length) return
    const i = Math.min(this.ghostPts.length - 1, Math.max(0, Math.floor(u * this.ghostPts.length)))
    this.ghostBall.position.copy(this.ghostPts[i])
  }

  clearGhost() {
    for (const c of [...this.ghostGroup.children]) this.ghostGroup.remove(c)
    this.ghostBall = null
    this.ghostPts = []
  }

  private resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1.2 ? 50 : 40
    this.camera.updateProjectionMatrix()
  }

  private renderAt(t: number) {
    const r = this.rally
    if (!r) return
    // players
    for (const [id, rig] of this.rigs) {
      const p = posAt(r.track, id, t)
      if (!p) continue
      rig.group.position.copy(V(p.x, p.y))
      const facing = rig.team === 0 ? Math.PI : 0
      rig.group.rotation.y = facing
      // swing animation around each of this player's hits
      let swing = 0
      for (const s of r.shots) {
        if (s.hitter !== id) continue
        const d = t - s.t
        if (d > -0.3 && d < 0.35) {
          swing = d < 0 ? -((d + 0.3) / 0.3) * 0.9 : -0.9 + (d / 0.35) * 2.1
          if (s.contact === 'high') swing *= 1.4
        }
      }
      rig.arm.rotation.x = swing
      rig.arm.rotation.z = 0.25
    }
    // ball
    const b = ballAt(this.segs, t)
    if (b) {
      this.ball.visible = true
      this.ballShadow.visible = true
      const v = V(b.x, b.y, Math.max(0.3, b.h))
      this.ball.position.copy(v)
      this.ballShadow.position.set(v.x, 0.04, v.z)
      ;(this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.4 - b.h * 0.03)
      this.trailHist.push(v.clone())
      if (this.trailHist.length > 26) this.trailHist.shift()
    } else {
      this.ball.visible = false
      this.ballShadow.visible = false
    }
    const n = this.trailHist.length
    for (let i = 0; i < 26; i++) {
      const p = this.trailHist[i]
      const f = n ? i / n : 0
      this.trailPos[i * 3] = p ? p.x : 0
      this.trailPos[i * 3 + 1] = p ? p.y : -50
      this.trailPos[i * 3 + 2] = p ? p.z : 0
      this.trailCol[i * 3] = 0.85 * f
      this.trailCol[i * 3 + 1] = 1 * f
      this.trailCol[i * 3 + 2] = 0.25 * f
    }
    this.trail.geometry.attributes.position.needsUpdate = true
    this.trail.geometry.attributes.color.needsUpdate = true

    // hit events: flash + grade badges
    const idx = r.shots.filter((s) => s.t <= t).length - 1
    if (idx > this.lastShotIdx && idx >= 0) {
      for (let k = this.lastShotIdx + 1; k <= idx; k++) {
        const s = r.shots[k]
        if (t - s.t < 0.3) this.flash(s)
        this.onShot?.(s)
      }
    }
    this.lastShotIdx = idx
    for (const bd of this.badges) {
      const age = t - bd.shot.t
      const show = age >= 0 && age < 1.6
      bd.sprite.visible = show
      if (show) {
        const hp = posAt(r.track, bd.shot.hitter, bd.shot.t) ?? bd.shot.pos
        const pop = Math.min(1, age / 0.18)
        const sc = 2.6 * (pop < 1 ? pop * 1.25 : 1 + Math.max(0, 0.15 - (age - 0.18)) )
        bd.sprite.scale.set(sc, sc, 1)
        bd.sprite.position.copy(V(hp.x, hp.y, 8 + age * 0.6))
        ;(bd.sprite.material as THREE.SpriteMaterial).opacity = age > 1.2 ? 1 - (age - 1.2) / 0.4 : 1
      }
    }
  }

  private flash(s: Shot) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 32), new THREE.MeshBasicMaterial({ color: GRADE_META[s.grade].color, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    m.position.copy(V(s.pos.x, s.pos.y, contactHeight(s)))
    m.lookAt(this.camera.position)
    this.scene.add(m)
    this.flashes.push({ mesh: m, t: 0 })
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    if (this.playing && this.rally) {
      this.time += dt * this.speed
      const limit = this.stopAt ?? this.loopEnd
      if (this.time >= limit) {
        this.time = limit
        this.playing = false
        this.stopAt = null
        this.onEnd?.()
      }
      this.renderAt(this.time)
      this.onTime?.(this.time)
    }
    if (this.camTween) {
      const tw = this.camTween
      tw.p = Math.min(1, tw.p + dt * 1.6)
      const e = 1 - Math.pow(1 - tw.p, 3)
      this.camera.position.lerpVectors(tw.from, tw.to, e)
      this.controls.target.lerpVectors(tw.tf, tw.tt, e)
      if (tw.p >= 1) this.camTween = null
    }
    for (const f of this.flashes) {
      f.t += dt
      const s = 1 + f.t * 9
      f.mesh.scale.set(s, s, s)
      ;(f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - f.t / 0.45)
    }
    this.flashes = this.flashes.filter((f) => {
      if (f.t > 0.45) {
        this.scene.remove(f.mesh)
        return false
      }
      return true
    })
    if (this.ghostBall && this.ghostPts.length) {
      const u = ((now / 1000) % 1.6) / 1.6
      const i = Math.min(this.ghostPts.length - 1, Math.floor(u * this.ghostPts.length))
      this.ghostBall.position.copy(this.ghostPts[i])
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  get canvas() {
    return this.renderer.domElement
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
    })
    this.renderer.domElement.remove()
  }
}
