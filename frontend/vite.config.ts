import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Backend CORS allows only localhost:5173 / 127.0.0.1:5173 by default.
export default defineConfig({ plugins: [react()], server: { port: 5173, strictPort: true } })
