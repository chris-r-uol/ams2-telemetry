# Contributing

Thanks for helping. Bug reports, recordings from real AMS2 sessions, and pull
requests are all welcome.

## Development setup

Any OS works: macOS, Windows or Linux. You don't need the game to develop.

```bash
npm install
npm run dev        # demo driver + hot-reloading dashboard at http://localhost:8606
npm run dev:udp    # same, but listening for the real game
```

Node.js 22.18 or newer is required. The server runs TypeScript directly through
Node's built-in type stripping, so there's no server build step.

| Script | What it does |
|---|---|
| `npm start` | build the dashboard, listen for AMS2 on UDP 5606 |
| `npm run demo` | build the dashboard, run the simulated driver |
| `npm run replay -- file.ams2rec` | replay a recording |
| `npm run demo:send-udp` | send simulated packets over real UDP (tests the listener) |
| `npm test` | unit and end-to-end pipeline tests |
| `npm run typecheck` | TypeScript |
| `npm run check` | typecheck, test and build: run this before a pull request |
| `npm run screenshots` | regenerate README images (needs Google Chrome installed) |

## Project layout

```
src/
  shared/            used by both the server and the browser
    protocol/        UDP packet layouts, decoder and encoder
    analysis/        resampling, delta, corners, coaching, session insights
    model/           types for laps, sessions and live frames
    format.ts        units and all user-facing coaching wording
  server/
    telemetry/       packet hub and lap builder
    sources/         UDP listener, recorder, replay
    demo/            simulated track and driver
    session-manager.ts, storage.ts, http.ts, live-socket.ts, index.ts
  web/               React dashboard (views, components, styles)
tests/               Vitest
docs/                protocol notes, coaching method, images
```

## Reporting a telemetry bug

1. Press **Record telemetry** (Live or Sessions page), or start with `npm start -- --record`.
2. Drive until the problem happens, then press **Stop recording**.
3. Download the file from the recordings list on the Sessions page, attach it to your issue,
   and describe what looked wrong.

A recording replays the exact packets, so the bug can be reproduced on any machine.

## Accessibility checklist

The dashboard is meant to be read at a glance from a driving seat, by everyone.
Please keep these true:

- Colour is never the only signal: deltas have a sign, an icon and words; lap status has a label.
- Text meets WCAG AA contrast in both themes (tokens in `src/web/styles/tokens.css`).
- Every chart has a legend (for two or more series) and a table view.
- Everything works with a keyboard, with a visible focus ring.
- Nothing announces to screen readers at frame rate; lap completion is announced once.
- Layouts reflow down to phone width and at 150% text size.
