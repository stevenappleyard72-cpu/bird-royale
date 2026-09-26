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
- `game.js`: Client state store, DOM rendering pipeline, and input handling.
- `ambientPresets.js`: Client ambience preset mapping by mutator id.
- `styles.css`: Rendering styles, layering, and animation behavior.

## Server Loop (Authoritative)

Entry point: `startGameLoop(roomCode)` in `server.js`.

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
