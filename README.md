# 0ch.net Messenger

A VS Code Dark+ inspired messenger interface with text chat, group voice room controls, synthesized system sounds, a live canvas visualizer, local profile settings, and a Railway-ready Socket.IO server.

## Requirements

- Node.js 20+
- npm 10+

## Local development

```bash
npm install
npm run dev
```

The Vite client runs on `http://localhost:5173`; the Socket.IO server runs on `http://localhost:3001`.

## Production

```bash
npm run build
npm start
```

The server serves the generated `dist/` directory and exposes `/health` and `/api/ice-servers`.

## GitHub

```bash
git init
git add .
git commit -m "Initial 0ch.net messenger"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/0ch-net-messenger.git
git push -u origin main
```

## Railway

1. Create a new Railway project and deploy the GitHub repository.
2. Railway detects the included `Dockerfile`; the container runs `npm run build` and `npm start`.
3. Add `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` variables when a TURN provider is available. The server already includes Google STUN fallbacks.
4. Set the generated Railway domain as the public URL.

The UI displays `Hosted & Powered by Railway` in the status bar. The audio notification system is generated in-browser with Web Audio API, so no external audio assets are required.
