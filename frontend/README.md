# CareFlow AI frontend

React 18 + TypeScript + Vite + Tailwind. Routes: `/login`, `/interview` (live interview copilot), `/queue`,
`/case/:id` (evidence-linked brief), `/ops`, `/trust`, `/audit` (admin).

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check + production build into dist/
```

Set `VITE_API_BASE_URL` to the backend URL (default `http://127.0.0.1:8000`). On Vercel, use Root Directory
`frontend`; `vercel.json` handles SPA rewrites. Live updates use a WebSocket (interview copilot, with HTTP fallback)
and server-sent events (case progress, queue changes). The session token is kept in `sessionStorage`.
