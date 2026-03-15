import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'saude.palmas.online',
      'lotacoes-production-6c18.up.railway.app',
    ],
  },
  server: {
    port: 5173,
  },
})
