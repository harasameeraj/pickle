import { AnimatePresence, motion } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav, SideNav } from './components/ui'
import Home from './pages/Home'

const Analyzing = lazy(() => import('./pages/Analyzing'))
const Coach = lazy(() => import('./pages/Coach'))
const LiveCoach = lazy(() => import('./pages/LiveCoach'))
const Matches = lazy(() => import('./pages/Matches'))
const NewMatch = lazy(() => import('./pages/NewMatch'))
const Review = lazy(() => import('./pages/Review'))
const Settings = lazy(() => import('./pages/Settings'))
const Setup = lazy(() => import('./pages/Setup'))
const Verify = lazy(() => import('./pages/Verify'))

const FULLSCREEN = ['/live/', '/record']

export default function App() {
  const loc = useLocation()
  const full = FULLSCREEN.some((p) => loc.pathname.startsWith(p))
  return (
    <div className="flex min-h-screen">
      {!full && <SideNav />}
      <main className={`min-w-0 flex-1 ${full ? '' : 'px-4 pb-28 md:px-8 md:pb-10'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={full ? '' : 'mx-auto max-w-5xl'}
          >
            <Suspense fallback={<div className="grid h-[60vh] place-items-center text-mute">Loading…</div>}>
            <Routes location={loc}>
              <Route path="/" element={<Home />} />
              <Route path="/new" element={<NewMatch />} />
              <Route path="/record" element={<NewMatch record />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/analyzing" element={<Analyzing />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/match/:id" element={<Review />} />
              <Route path="/matches" element={<Matches />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/live/:drill" element={<LiveCoach />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Home />} />
            </Routes>
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      {!full && <BottomNav />}
    </div>
  )
}
