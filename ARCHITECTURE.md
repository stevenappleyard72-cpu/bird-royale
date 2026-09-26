# Bird Royale Architecture

This document explains how the server and client loops work together.

## High-Level Model

- The server is authoritative for gameplay simulation.
- The client is authoritative for presentation only.
- The server runs a fixed-timestep loop at 60 Hz.
- The client re-renders on each `gameState` snapshot from the server.

## File Layout

- `server.js`: Room lifecycle, socket events, and authoritative simulation functions.
- `serverConfig.js`: Gameplay constants and mutator definitions.
- `serverGameLoop.js`: Server tick orchestration (`runServerTick`, `createStartGameLoop`).
- `serverRoundSystem.js`: Round/mutator/phase helpers (`getRoundPhase`, `isSuddenDeath`, etc.).
- `serverCurseSystem.js`: Cursed-ball hazard behavior (`updateCurse`, `checkCurseTransfer`).
- `serverRoundLifecycleSystem.js`: Round start/end lifecycle and ghost/speed progression helpers.
- `serverLeaderboardPresenceSystem.js`: Leaderboard persistence, hourly rollups, name registry, and quick-join queueing.
- `serverSocketHandlers.js`: Socket.IO event registration for matchmaking, lifecycle commands, input, and disconnect cleanup.
- `game.js`: Client state store, DOM rendering pipeline, and input handling.
- `ambientPresets.js`: Client ambience preset mapping by mutator id.
- `clientRenderLoop.js`: Client render tick orchestration from local snapshot state.
- `styles.css`: Rendering styles, layering, and animation behavior.

## Server Loop (Authoritative)

Entry point: `startGameLoop(roomCode)` in `server.js` (created by `serverGameLoop.js`).

The loop executes every ~16.67ms and follows this order:

1. World state progression
- `updateSpeedRamp(activeRoom)`
- `updateWind(activeRoom, roomCode)`

2. Entity movement and AI
- `updatePlayerPhysics(activeRoom)`
- `updateBotAI(activeRoom)`
- `updateGhosts(activeRoom)`
- `updateCurse(activeRoom, roomCode)`
- `checkCurseTransfer(activeRoom, roomCode)`

3. Interactions and hazards
- `applyPlayerCollisions(activeRoom, roomCode)`
- `updateMonster(activeRoom, roomCode)`
- `updateObstacles(activeRoom, roomCode)`

4. Objectives and scoring
- `updateGoldenTarget(activeRoom, roomCode)`
- `updatePickups(activeRoom, roomCode)`
- `applyObstacleDeaths(activeRoom, roomCode)`
- `updateSurvivalScoring(activeRoom)`

5. Publish and lifecycle
- `broadcastGameState(roomCode)`
- `checkForRoundEnd(roomCode)`

Round setup entry point: `startRoundForRoom(roomCode)`.

## Client Loop (Render-On-Snapshot)

Primary render entry point: `drawGame()` in `game.js`.

State update trigger:
- `socket.on("gameState", ...)` receives authoritative snapshots.
- `updateLocalState(data)` updates the client-side local model.
- `drawGame()` maps model state to DOM.
- `updatePlayerList()` updates lobby/sidebar text UI.

`drawGame()` rendering order:

1. `drawPlayers()`
2. `drawPickups()`
3. `drawObstacles()`
4. `drawCurse()`
5. `drawScoreHud()`
6. `drawRoundMutatorBadge()`
7. `drawArenaFeed()`
8. `applyArenaCinematics()`

This order keeps world entities beneath overlays/HUD and ensures cinematic effects are applied after state-bound visuals are in place.

## Mutator-Driven Ambience

- Server includes mutator id in room/game state.
- Client resolves mutator ambience profile via `ambientPresets.js`.
- `applyArenaCinematics()` writes CSS variables and `data-atmo` on `#gameArea`.
- `styles.css` maps `data-atmo` to visual signature variables.

## Design Intent

- Keep simulation deterministic and centralized on the server.
- Keep client side simple: consume snapshots and render.
- Keep tunable gameplay data separated from loop logic.
- Keep visual tone configuration separate from rendering mechanics.

## Contributor Guide

Use this section as the default placement guide when adding features.

### Where New Server Code Goes

- Add or tune constants in `serverConfig.js`.
- Add room/phase derivation helpers in `serverRoundSystem.js`.
- Add simulation tick ordering only in `serverGameLoop.js`.
- Add hazard-specific behavior in a dedicated `server*System.js` file (example: curse logic in `serverCurseSystem.js`).
- Add round start/end or round transition logic in `serverRoundLifecycleSystem.js`.
- Add leaderboard, queue, or name presence logic in `serverLeaderboardPresenceSystem.js`.
- Add socket endpoint routing and event registration in `serverSocketHandlers.js`.

### Where New Client Code Goes

- Add render tick orchestration in `clientRenderLoop.js`.
- Add ambience preset mappings in `ambientPresets.js`.
- Keep game state adaptation and DOM feature rendering in `game.js`.
- Keep visual styling and animation behavior in `styles.css`.

### Practical Rules

- Prefer dependency injection for new modules instead of direct cross-file imports of mutable runtime state.
- Keep server systems mostly stateless; room mutation should happen through explicit function inputs.
- Keep socket handlers thin: validate input, then delegate to systems.
- Keep each function focused on one responsibility and use action-first names (for example: `updateWind`, `checkForRoundEnd`, `drainWaitingQueueToLobby`).
- When adding new timed gameplay behavior, document whether it runs in the server loop, a timeout, or a client render frame.

### Naming Conventions

- Use `*Ms` suffix for millisecond durations.
- Use `*Multiplier` for scaling factors.
- Use `update*` for per-tick state progression.
- Use `check*` for predicates that may trigger transitions.
- Use `create*System` for dependency-injected modules.
