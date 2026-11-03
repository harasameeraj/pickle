import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS=1 serves over a self-signed certificate so phones on your Wi-Fi can use the camera.
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  build: { chunkSizeWarningLimit: 700 },
})
