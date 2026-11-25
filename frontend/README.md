# Carely frontend

Carely's dashboard and live call interface are built with React, TypeScript, Vite, Tailwind CSS, and Pipecat's FastAPI WebSocket voice service.

## Development

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Vite proxies `/api` and `/ws` to the FastAPI backend at `http://127.0.0.1:8001`. Start the backend from `backend/` before using dashboard data or voice calls. See the root [README](../README.md) for setup, configuration, and run instructions.

Create a production build with:

```bash
npm run build
```
