import { motion } from 'framer-motion'

/** Heatmap of where a player stood on their own half. Row 0 is at the net. */
export default function CourtMap({ heat, color }: { heat: number[]; color: string }) {
  const max = Math.max(1, ...heat)
  const cw = 20
  const ch = 20
  return (
    <svg viewBox="0 0 200 236" className="w-full">
      <rect x="0" y="16" width="200" height="220" rx="4" fill="#1f4aa8" />
      <rect x="0" y="16" width="200" height="70" fill="#2a63c9" />
      {heat.map((v, i) => {
        const row = Math.floor(i / 10)
        const col = i % 10
        const a = v / max
        if (a < 0.03) return null
        return (
          <motion.rect
            key={i}
            x={col * cw}
            y={16 + row * ch}
            width={cw}
            height={ch}
            fill={color}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: Math.min(0.9, a * 0.95) }}
            viewport={{ once: true }}
            transition={{ delay: (row + col) * 0.02, duration: 0.5 }}
            style={{ filter: 'blur(6px)' }}
          />
        )
      })}
      <g stroke="#fff" strokeWidth="1.5" fill="none" opacity=".9">
        <rect x="0" y="16" width="200" height="220" />
        <line x1="0" y1="86" x2="200" y2="86" />
        <line x1="100" y1="86" x2="100" y2="236" />
      </g>
      <line x1="-4" y1="16" x2="204" y2="16" stroke="#fff" strokeWidth="4" />
      <text x="100" y="10" textAnchor="middle" fontSize="9" fill="#8aa597" fontWeight="700">
        NET
      </text>
      <text x="196" y="80" textAnchor="end" fontSize="8" fill="#ffffffaa" fontWeight="700">
        KITCHEN
      </text>
    </svg>
  )
}
