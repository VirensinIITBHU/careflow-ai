import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend CORS allows localhost:5173 by default. On Vercel set VITE_API_BASE_URL to the Render URL.
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true } })
