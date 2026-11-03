// Dev-only server for rendering the promo video: `npx vite --config vite.promo.config.ts`
// then open /promo.html. Finished renders are POSTed back and saved to promo/out/.
import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const saver: Plugin = {
  name: 'promo-saver',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      const name = path.basename(new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'promo.mp4')
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const out = path.resolve('promo/out', name)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, Buffer.concat(chunks))
        res.end(out)
      })
    })
  },
}

export default defineConfig({ plugins: [saver], server: { port: 5174, strictPort: true } })
