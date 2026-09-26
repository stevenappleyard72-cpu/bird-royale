(function attachRenderLoop(global) {
  "use strict";

  /**
   * Client render loop body.
   * Called after local state is updated from server snapshots.
   */
  function renderFrame(view) {
    view.showGameArea();
    view.drawPlayers();
    view.drawPickups();
    view.drawObstacles();
    view.drawCurse();
    view.drawScoreHud();
    view.drawRoundMutatorBadge();
    view.drawArenaFeed();
    view.applyArenaCinematics();

    if (view.spectatingActive) {
      view.updateSpectatorOverlay();
    }
  }

  /**
   * Snapshot-driven client tick.
   * The server owns simulation; the client applies and renders snapshots.
   */
  function applyServerSnapshot(snapshot, handlers) {
    handlers.updateLocalState(snapshot);
    renderFrame(handlers.view);
    handlers.updatePlayerList();
  }

  global.BIRD_ROYALE_RENDER_LOOP = {
    renderFrame,
    applyServerSnapshot
  };
})(window);
