import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS=1 serves over a self-signed certificate so phones on your Wi-Fi can use the camera.
// GH_PAGES=1 builds for https://<user>.github.io/pickle/
export default defineConfig({
  base: process.env.GH_PAGES ? '/pickle/' : '/',
  plugins: [react(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  build: { chunkSizeWarningLimit: 700 },
})
