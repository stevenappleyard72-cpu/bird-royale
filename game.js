const socket = io();

const APP_VERSION = "1.0.0";

let currentGameCode = "";
let hostId = "";
let mySocketId = "";

let players = [];
let obstacles = [];
let obstaclesPassed = 0;
let previousPlayersState = {};  // Track previous alive status to detect deaths

let gameSpeed = 3;
let gameSpeedMultiplier = 1;
let targetScore = 3;

let gameWaitingToStart = false;
let countdownRunning = false;
let gameRunning = false;
let matchEnded = false;

let explosions = {};  // Track explosions: { playerId: { x, y, color, startTime } }
const explosionDuration = 600;  // milliseconds

let shockwaves = []; // { x, y, startTime }
const shockwaveDuration = 750; // milliseconds

let playerStats = {};  // Track wins/losses: { playerId: { wins, matches } }
let winnerSceneActive = false;
let spectatingActive = false;
let spectatorJoining = false;  // True when we joined mid-game as spectator
let spectatorCount = 0;
let pickups = [];

let curse = null;              // Current curse state from server (null | { state, x, y, targetId, carrierId })
let lastCurseRattleTime = 0;  // Throttle rattle sound
const curseBallSize = 20;     // Must match server constant

let leaderboardData = null;
let lbCountdownInterval = null;

let isGhost = false;                 // true when MY bird has died this round
let ghostSpooks = [];                // visual ghost spook effects [{x,y,startTime}]
let autoRestartEndTime = null;       // timestamp when server will auto-restart
let autoRestartDisplayInterval = null;

const serverWidth = 420;
const serverHeight = 500;
const birdSize = 40;

socket.on("connect", function () {
  mySocketId = socket.id;
  document.getElementById("version").textContent = "v" + APP_VERSION;
  socket.emit("requestLeaderboard");
});

function generateGameCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }

  return code;
}

function getPlayerName() {
  const name = document.getElementById("playerName").value.trim();
  return name === "" ? "Player" : name;
}

function getSpeedFromInput() {
  const input = document.getElementById("gameSpeedInput");
  const speed = Number(input.value) || 3;

  if (speed < 1) return 1;
  if (speed > 99) return 99;

  return speed;
}

function getTargetScoreFromInput() {
  const input = document.getElementById("targetScoreInput");
  const score = Number(input.value) || 3;

  if (score < 2) return 2;
  if (score > 5) return 5;

  return score;
}

function setGameSpeed(speed) {
  gameSpeed = speed || 10;
  gameSpeedMultiplier = gameSpeed / 10;
}

function getGameWidth() {
  return document.getElementById("gameArea").clientWidth;
}

function getGameHeight() {
  return document.getElementById("gameArea").clientHeight;
}

function scaleX(serverX) {
  return serverX * (getGameWidth() / serverWidth);
}

function scaleY(serverY) {
  return serverY * (getGameHeight() / serverHeight);
}

function scaleSize(size) {
  return size * (getGameWidth() / serverWidth);
}

function createConfetti() {
  const confettiCount = 50;
  const container = document.getElementById("winnerScene");

  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.style.left = Math.random() * 100 + "%";
    confetti.style.background = ["#FFD700", "#FFA500", "#FF6347", "#32CD32", "#1E90FF"][Math.floor(Math.random() * 5)];
    confetti.style.animationDelay = Math.random() * 0.5 + "s";
    confetti.style.animationDuration = (Math.random() * 2 + 2) + "s";
    container.appendChild(confetti);
  }
}

function showWinnerScene(winner) {
  // Track stats
  if (!playerStats[winner.id]) {
    playerStats[winner.id] = { wins: 0, matches: 0 };
  }
  playerStats[winner.id].wins++;

  // Count total matches for all players
  for (const player of players) {
    if (!playerStats[player.id]) {
      playerStats[player.id] = { wins: 0, matches: 0 };
    }
    playerStats[player.id].matches++;
  }

  const losses = playerStats[winner.id].matches - playerStats[winner.id].wins;

  // Create winner scene
  const winnerScene = document.createElement("div");
  winnerScene.id = "winnerScene";

  // Darken arena
  const darkOverlay = document.createElement("div");
  darkOverlay.className = "winner-overlay";
  winnerScene.appendChild(darkOverlay);

  // Winner bird (enlarged, centered)
  const winnerBird = document.createElement("div");
  winnerBird.className = "winner-bird";
  winnerBird.style.background = winner.colour;
  winnerBird.textContent = "👑";
  winnerScene.appendChild(winnerBird);

  // Other birds arranged around winner
  const otherPlayers = players.filter(p => p.id !== winner.id);
  const angleStep = (2 * Math.PI) / Math.max(otherPlayers.length, 1);

  otherPlayers.forEach((player, index) => {
    const angle = angleStep * index;
    const distance = 150;
    const x = 50 + (Math.cos(angle) * distance / 420) * 100;
    const y = 50 + (Math.sin(angle) * distance / 500) * 100;

    const bird = document.createElement("div");
    bird.className = "podium-bird";
    bird.style.background = player.colour;
    bird.style.left = x + "%";
    bird.style.top = y + "%";
    bird.style.animationDelay = index * 0.1 + "s";
    winnerScene.appendChild(bird);
  });

  // Crown emoji
  const crown = document.createElement("div");
  crown.className = "crown";
  crown.textContent = "👑";
  winnerScene.appendChild(crown);

  // Champion text
  const text = document.createElement("div");
  text.className = "winner-text";
  text.innerHTML = "BIRD ROYALE<br>CHAMPION<br><br>" + winner.name + "<br><br>" +
    playerStats[winner.id].wins + " wins - " + losses + " losses";
  winnerScene.appendChild(text);

  // Start message
  const startMsg = document.createElement("div");
  startMsg.className = "start-message";
  startMsg.textContent = "Press SPACE to start a new match";
  winnerScene.appendChild(startMsg);

  // Rematch button (only for host)
  if (mySocketId === hostId) {
    const rematchBtn = document.createElement("button");
    rematchBtn.id = "rematchBtn";
    rematchBtn.textContent = "Rematch";
    rematchBtn.onclick = function () { requestRematch(); };
    winnerScene.appendChild(rematchBtn);
  }

  document.getElementById("gameArea").appendChild(winnerScene);
  createConfetti();
  winnerSceneActive = true;
}

function hideWinnerScene() {
  const winnerScene = document.getElementById("winnerScene");
  if (winnerScene) {
    winnerScene.remove();
  }
  winnerSceneActive = false;

  // Return to lobby
  document.getElementById("lobby").style.display = "block";
  document.getElementById("gameArea").style.display = "none";
  document.getElementById("controls").style.display = "none";
  document.getElementById("muteBar").style.display = "none";
  document.getElementById("message").textContent = "";
}

function createMonsterEyes(isTop) {
  const row = document.createElement("div");
  row.className = "monster-eyes " + (isTop ? "monster-eyes-top" : "monster-eyes-bottom");

  for (let e = 0; e < 2; e++) {
    const eyeOuter = document.createElement("div");
    eyeOuter.className = "monster-eye";

    const pupil = document.createElement("div");
    pupil.className = "monster-pupil " + (isTop ? "monster-pupil-down" : "monster-pupil-up");
    eyeOuter.appendChild(pupil);
    row.appendChild(eyeOuter);
  }

  return row;
}

function createExplosion(playerId, x, y, color) {
  explosions[playerId] = {
    x,
    y,
    color,
    startTime: Date.now()
  };
}

function drawExplosions() {
  const container = document.getElementById("playersContainer");
  const now = Date.now();

  for (const playerId in explosions) {
    const explosion = explosions[playerId];
    const elapsed = now - explosion.startTime;
    const progress = Math.min(elapsed / explosionDuration, 1);

    if (progress >= 1) {
      delete explosions[playerId];
      continue;
    }

    // Create expanding circle effect
    const explosionDiv = document.createElement("div");
    explosionDiv.className = "explosion";

    const maxRadius = scaleSize(birdSize * 1.5);
    const currentRadius = maxRadius * progress;
    const opacity = 1 - progress;

    explosionDiv.style.left = scaleX(explosion.x + birdSize / 2) - currentRadius + "px";
    explosionDiv.style.top = scaleY(explosion.y + birdSize / 2) - currentRadius + "px";
    explosionDiv.style.width = currentRadius * 2 + "px";
    explosionDiv.style.height = currentRadius * 2 + "px";
    explosionDiv.style.background = explosion.color;
    explosionDiv.style.borderRadius = "50%";
    explosionDiv.style.position = "absolute";
    explosionDiv.style.opacity = opacity;
    explosionDiv.style.boxShadow = `0 0 ${currentRadius}px ${explosion.color}`;

    container.appendChild(explosionDiv);
  }
}

function showSpectatorOverlay() {
  spectatingActive = true;

  let overlay = document.getElementById("spectatorOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "spectatorOverlay";
    document.getElementById("gameArea").appendChild(overlay);
  }

  updateSpectatorOverlay();
}

function updateSpectatorOverlay() {
  const overlay = document.getElementById("spectatorOverlay");
  if (!overlay) return;

  const scoresHtml = players.map(function (player) {
    const isMe = player.id === mySocketId;
    const statusIcon = player.alive ? "🐦" : "�";
    const meClass = isMe ? " spectator-me" : "";
    return "<div class='spectator-score-row" + meClass + "' style='color:" + player.colour + "'>" +
      statusIcon + " " + player.name + " &mdash; " + player.score + "/" + targetScore +
      "</div>";
  }).join("");

  const ghostControls = isGhost
    ? "<div class='ghost-controls-hint'>Move: ↖ ↑ ↗ &nbsp;|&nbsp; ↓ to <strong>SPOOK</strong> nearby birds!</div>"
    : "";

  overlay.innerHTML =
    "<div class='spectator-title'>" + (isGhost ? "👻 YOU'RE A GHOST!" : "YOU'RE OUT!") + "</div>" +
    (isGhost
      ? "<div class='spectator-watching'>Haunt the arena &mdash; spook the survivors!</div>"
      : "<div class='spectator-watching'>Spectating...</div>") +
    ghostControls +
    "<div class='spectator-scores'>" + scoresHtml + "</div>";
}

function hideSpectatorOverlay() {
  spectatingActive = false;
  const overlay = document.getElementById("spectatorOverlay");
  if (overlay) overlay.remove();
}

function requestRematch() {
  socket.emit("requestRematch", { roomCode: currentGameCode });
  hideWinnerScene();
}

function toggleMute() {
  const muted = SoundEngine.toggleMute();
  document.getElementById("muteBtn").textContent = muted ? "🔇 Sound" : "🔊 Sound";
}

function quickJoin() {
  const playerName = getPlayerName();
  socket.emit("findOpenGame", { playerName });
}

let quickJoinSearching = false;

function startQuickJoinSearch() {
  quickJoinSearching = true;
  const btn = document.getElementById("quickJoinBtn");
  const msg = document.getElementById("message");
  if (btn) {
    btn.textContent = "Cancel Search";
    btn.onclick = cancelQuickJoin;
  }
  if (msg) {
    msg.textContent = "";
    msg.innerHTML = "Searching for a game<span class='searching-dots'><span>.</span><span>.</span><span>.</span></span>";
  }
}

function cancelQuickJoin() {
  if (!quickJoinSearching) return;
  quickJoinSearching = false;
  socket.emit("cancelQuickJoin");
  const btn = document.getElementById("quickJoinBtn");
  if (btn) {
    btn.textContent = "Quick Join a Running Game";
    btn.onclick = quickJoin;
  }
  document.getElementById("message").textContent = "";
}

socket.on("quickJoinQueued", function () {
  startQuickJoinSearch();
});

function createGame() {
  const playerName = getPlayerName();
  currentGameCode = generateGameCode();

  setGameSpeed(getSpeedFromInput());
  targetScore = getTargetScoreFromInput();

  socket.emit("createGame", {
    playerName,
    roomCode: currentGameCode,
    gameSpeed,
    targetScore
  });
}

function joinGame() {
  const playerName = getPlayerName();
  const code = document.getElementById("gameCodeInput").value.trim().toUpperCase();

  if (code === "") {
    document.getElementById("message").textContent = "Please enter a game code.";
    return;
  }

  currentGameCode = code;

  socket.emit("joinGame", {
    playerName,
    roomCode: currentGameCode
  });
}

function showGameArea() {
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("muteBar").style.display = "block";
  document.getElementById("controls").style.display = "block";
}

function updateLocalState(data) {
  currentGameCode = data.roomCode || currentGameCode;
  hostId = data.hostId || hostId;
  players = data.players || [];
  obstacles = data.obstacles || [];
  obstaclesPassed = data.obstaclesPassed || 0;
  setGameSpeed(data.gameSpeed || gameSpeed);
  targetScore = data.targetScore || targetScore;
  pickups = data.pickups || [];
  spectatorCount = data.spectatorCount || 0;
  curse = data.curse !== undefined ? data.curse : null;
}

function drawPlayers() {
  const container = document.getElementById("playersContainer");
  container.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    // Check if bird just died
    if (player.alive === false && previousPlayersState[player.id] !== false) {
      createExplosion(player.id, player.x, player.y, player.colour);
      if (player.id === mySocketId) {
        SoundEngine.localDeath();
        isGhost = true;
        if (!spectatingActive) showSpectatorOverlay();
      } else {
        SoundEngine.enemyDeath();
      }
    }

    // Only draw alive birds
    if (!player.alive) {
      continue;
    }

    const bird = document.createElement("div");
    bird.className = "player-bird";
    bird.style.left = scaleX(player.x) + "px";
    bird.style.top = scaleY(player.y) + "px";
    bird.style.width = scaleSize(birdSize) + "px";
    bird.style.height = scaleSize(birdSize) + "px";

    const sprite = document.createElement("div");
    sprite.className = "player-sprite";
    sprite.style.backgroundImage = "url('/assets/birds/" + player.colour + ".svg')";
    const tilt = Math.max(-30, Math.min(45, player.velocityY * 4));
    sprite.style.transform = "rotate(" + tilt + "deg)";

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;

    if (player.shielded) {
      const ring = document.createElement("div");
      ring.className = "shield-ring";
      bird.appendChild(ring);
    }

    if (player.ramBoosted) {
      const boost = document.createElement("div");
      boost.className = "ramboost-aura";
      bird.appendChild(boost);
    }

    bird.appendChild(sprite);
    bird.appendChild(name);
    container.appendChild(bird);
  }

  // Draw ghost birds for dead players
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.alive || player.ghostX === undefined || player.ghostX === null) continue;

    const ghost = document.createElement("div");
    ghost.className = "player-bird ghost-bird";
    ghost.style.left   = scaleX(player.ghostX) + "px";
    ghost.style.top    = scaleY(player.ghostY) + "px";
    ghost.style.width  = scaleSize(birdSize) + "px";
    ghost.style.height = scaleSize(birdSize) + "px";

    const sprite = document.createElement("div");
    sprite.className = "player-sprite ghost-sprite";
    sprite.style.backgroundImage = "url('/assets/birds/" + player.colour + ".svg')";

    const ghostName = document.createElement("div");
    ghostName.className = "player-name ghost-name";
    ghostName.textContent = "👻 " + player.name;

    // Spook-ready indicator for my ghost
    if (player.id === mySocketId && player.ghostSpookReady) {
      const spookHint = document.createElement("div");
      spookHint.className = "ghost-spook-ready";
      spookHint.textContent = "↓ SPOOK";
      ghost.appendChild(spookHint);
    }

    ghost.appendChild(sprite);
    ghost.appendChild(ghostName);
    container.appendChild(ghost);
  }

  // Draw ghost spook effects
  drawGhostSpooks();

  // Draw explosions and shockwaves
  drawExplosions();
  drawShockwaves();

  // Update previous state
  previousPlayersState = {};
  for (const player of players) {
    previousPlayersState[player.id] = player.alive;
  }
}

function drawObstacles() {
  const container = document.getElementById("obstacleContainer");
  container.innerHTML = "";

  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];

    // Top obstacle — stone body with hanging vine tips
    const topElement = document.createElement("div");
    topElement.className = "obstacle top-obstacle";
    topElement.style.left = scaleX(obstacle.x) + "px";
    topElement.style.width = scaleX(obstacle.width) + "px";
    topElement.style.height = scaleY(obstacle.topHeight) + "px";

    const vineBody = document.createElement("div");
    vineBody.className = "obstacle-vine-body";

    const vineTip = document.createElement("div");
    vineTip.className = "obstacle-vine-tip";

    topElement.appendChild(vineBody);
    topElement.appendChild(vineTip);

    // Bottom obstacle — bark trunk body with tree canopy cap
    const bottomElement = document.createElement("div");
    bottomElement.className = "obstacle bottom-obstacle";
    bottomElement.style.left = scaleX(obstacle.x) + "px";
    bottomElement.style.width = scaleX(obstacle.width) + "px";
    bottomElement.style.height = scaleY(obstacle.bottomHeight) + "px";

    const trunk = document.createElement("div");
    trunk.className = "obstacle-trunk";

    const treetop = document.createElement("div");
    treetop.className = "obstacle-treetop";

    bottomElement.appendChild(trunk);
    bottomElement.appendChild(treetop);

    // Monster pipe — add glowing eyes on both segments
    if (obstacle.isMonster) {
      topElement.classList.add("monster-pipe");
      bottomElement.classList.add("monster-pipe");

      // Eyes on the bottom face of the top obstacle (staring down into the gap)
      const topEyes = createMonsterEyes(true);
      topElement.appendChild(topEyes);

      // Eyes on the top face of the bottom obstacle (staring up into the gap)
      const bottomEyes = createMonsterEyes(false);
      bottomElement.appendChild(bottomEyes);
    }

    container.appendChild(topElement);
    container.appendChild(bottomElement);
  }
}

function drawPickups() {
  const container = document.getElementById("playersContainer");
  for (const pickup of pickups) {
    const el = document.createElement("div");
    el.style.left = scaleX(pickup.x) + "px";
    el.style.top = scaleY(pickup.y) + "px";
    el.style.width = scaleSize(pickup.size) + "px";
    el.style.height = scaleSize(pickup.size) + "px";
    if (pickup.type === "shield") {
      el.className = "shield-pickup";
    } else if (pickup.type === "shockwave") {
      el.className = "shockwave-pickup";
    } else if (pickup.type === "ramboost") {
      el.className = "ramboost-pickup";
    } else {
      continue;
    }
    container.appendChild(el);
  }
}

function drawShockwaves() {
  const container = document.getElementById("playersContainer");
  const now = Date.now();
  const delays = [0, 0.28, 0.54];
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    const progress = Math.min((now - sw.startTime) / shockwaveDuration, 1);
    if (progress >= 1) {
      shockwaves.splice(i, 1);
      continue;
    }
    for (let r = 0; r < 3; r++) {
      const d = delays[r];
      const ringProgress = d >= 1 ? 0 : Math.max(0, Math.min((progress - d) / (1 - d), 1));
      if (ringProgress <= 0) continue;
      const maxRadius = scaleSize(180);
      const currentRadius = maxRadius * ringProgress;
      const opacity = (1 - ringProgress) * 0.85;
      const ring = document.createElement("div");
      ring.className = "shockwave-ring";
      ring.style.left = scaleX(sw.x) - currentRadius + "px";
      ring.style.top = scaleY(sw.y) - currentRadius + "px";
      ring.style.width = currentRadius * 2 + "px";
      ring.style.height = currentRadius * 2 + "px";
      ring.style.opacity = opacity;
      container.appendChild(ring);
    }
  }
}

function drawGhostSpooks() {
  const container = document.getElementById("playersContainer");
  const now = Date.now();
  const spookDuration = 600;

  for (let i = ghostSpooks.length - 1; i >= 0; i--) {
    const s = ghostSpooks[i];
    const progress = Math.min((now - s.startTime) / spookDuration, 1);
    if (progress >= 1) { ghostSpooks.splice(i, 1); continue; }

    const maxRadius = scaleSize(90);
    const radius    = maxRadius * progress;
    const opacity   = (1 - progress) * 0.75;

    const ring = document.createElement("div");
    ring.style.position     = "absolute";
    ring.style.borderRadius = "50%";
    ring.style.border       = "3px solid rgba(200,255,200,0.9)";
    ring.style.boxShadow    = "0 0 12px 4px rgba(180,255,180,0.6)";
    ring.style.left         = scaleX(s.x) - radius + "px";
    ring.style.top          = scaleY(s.y) - radius + "px";
    ring.style.width        = radius * 2 + "px";
    ring.style.height       = radius * 2 + "px";
    ring.style.opacity      = opacity;
    ring.style.pointerEvents = "none";
    ring.style.zIndex       = "110";
    container.appendChild(ring);
  }
}

function drawScoreHud() {
  const hud = document.getElementById("scoreHud");
  if (!hud) return;
  if (!gameRunning && !spectatingActive) {
    hud.style.display = "none";
    return;
  }
  hud.style.display = "flex";

  const speed = Math.round(gameSpeedMultiplier * 10) / 10;
  const speedLabel = gameSpeedMultiplier >= 1.5
    ? "<span class='hud-speed hud-speed-fast'>⚡" + speed + "x</span>"
    : "<span class='hud-speed'>⚡" + speed + "x</span>";

  hud.innerHTML =
    "<div class='hud-scores'>" +
    players.map(function (p) {
      const stars   = "★".repeat(p.score) + "☆".repeat(Math.max(0, targetScore - p.score));
      const deadMark = p.alive ? "" : " 💀";
      const isMe    = p.id === mySocketId;
      return "<span class='hud-player" + (isMe ? " hud-me" : "") + (!p.alive ? " hud-dead" : "") +
        "' style='color:" + p.colour + "'>" +
        p.name + deadMark + " " + stars +
        "</span>";
    }).join("<span class='hud-sep'> · </span>") +
    "</div>" + speedLabel;
}

function drawCurse() {
  if (!curse) return;
  const container = document.getElementById("playersContainer");

  if (curse.state === 'roaming') {
    // Iron ball
    const ball = document.createElement("div");
    ball.className = "curse-ball";
    ball.style.left   = scaleX(curse.x) + "px";
    ball.style.top    = scaleY(curse.y) + "px";
    ball.style.width  = scaleSize(curseBallSize) + "px";
    ball.style.height = scaleSize(curseBallSize) + "px";
    container.appendChild(ball);

    // Targeting beam + skull marker on the locked-on bird
    if (curse.targetId) {
      const tgt = players.find(function (p) { return p.id === curse.targetId; });
      if (tgt && tgt.alive) {
        const cx = scaleX(curse.x + curseBallSize / 2);
        const cy = scaleY(curse.y + curseBallSize / 2);
        const tx = scaleX(tgt.x + birdSize / 2);
        const ty = scaleY(tgt.y + birdSize / 2);
        const len   = Math.hypot(tx - cx, ty - cy);
        const angle = Math.atan2(ty - cy, tx - cx) * 180 / Math.PI;

        const beam = document.createElement("div");
        beam.className = "curse-beam";
        beam.style.left      = cx + "px";
        beam.style.top       = cy + "px";
        beam.style.width     = len + "px";
        beam.style.transform = "rotate(" + angle + "deg)";
        container.appendChild(beam);

        // Skull floats above the targeted player's head
        const marker = document.createElement("div");
        marker.className = "curse-target-marker";
        marker.textContent = "💀";
        marker.style.left = scaleX(tgt.x + birdSize / 2) + "px";
        marker.style.top  = scaleY(tgt.y - 18) + "px";
        container.appendChild(marker);
      }
    }

    // Rattle sound while roaming (throttled)
    const now = Date.now();
    if (now - lastCurseRattleTime > 1600) {
      SoundEngine.curseRattle();
      lastCurseRattleTime = now;
    }

  } else if (curse.state === 'attached' && curse.carrierId) {
    const carrier = players.find(function (p) { return p.id === curse.carrierId; });
    if (carrier && carrier.alive) {
      // Short chain link
      const chain = document.createElement("div");
      chain.className = "curse-chain";
      chain.style.left = scaleX(carrier.x + birdSize / 2 - 3) + "px";
      chain.style.top  = scaleY(carrier.y + birdSize - 2) + "px";
      container.appendChild(chain);

      // Swinging iron ball below the carrier
      const ball = document.createElement("div");
      ball.className = "curse-ball-attached";
      ball.style.left   = scaleX(carrier.x + birdSize / 2 - curseBallSize / 2) + "px";
      ball.style.top    = scaleY(carrier.y + birdSize + 8) + "px";
      ball.style.width  = scaleSize(curseBallSize) + "px";
      ball.style.height = scaleSize(curseBallSize) + "px";
      container.appendChild(ball);
    }
  }
}

function drawGame() {
  showGameArea();
  drawPlayers();
  drawPickups();
  drawObstacles();
  drawCurse();
  drawScoreHud();
  if (spectatingActive) {
    updateSpectatorOverlay();
  }
}

function updatePlayerList() {
  const playerList = document.getElementById("playerList");

  playerList.innerHTML =
    "<h3>Players</h3>" +
    players.map(function (player) {
      const aliveText = player.alive ? "" : " (out)";
      const scoreText = player.score !== undefined ? " (" + player.score + "/" + targetScore + ")" : "";
      return "<div style='color:" + player.colour + "'>" +
        player.name + scoreText + aliveText +
        "</div>";
    }).join("");
}

function showWaitingMessage() {
  const isHost = mySocketId === hostId;
  const specCount = (typeof spectatorCount !== "undefined" && spectatorCount > 0)
    ? " " + spectatorCount + " spectator" + (spectatorCount > 1 ? "s" : "") + " waiting."
    : "";

  document.getElementById("message").textContent =
    "Game code: " + currentGameCode +
    ". Speed: " + gameSpeed + " (" + gameSpeedMultiplier.toFixed(1) + "x). " +
    "Target: " + targetScore + " rounds." + specCount + " " +
    (isHost
      ? "You are the host. Press any movement control to start."
      : "Waiting for the host to start.");
}

function requestStartGame() {
  socket.emit("requestStartGame", {
    roomCode: currentGameCode
  });
}

function startCountdown() {
  const countdown = document.getElementById("countdown");

  gameWaitingToStart = false;
  countdownRunning = true;
  gameRunning = false;

  let number = 3;
  countdown.style.display = "block";
  countdown.textContent = number;
  SoundEngine.countdownBeep(false);

  const timer = setInterval(function () {
    number--;

    if (number > 0) {
      countdown.textContent = number;
      SoundEngine.countdownBeep(false);
    } else if (number === 0) {
      countdown.textContent = "GO!";
      SoundEngine.countdownBeep(true);
    } else {
      clearInterval(timer);
      countdown.style.display = "none";
    }
  }, 1000);
}

function handleMove(direction) {
  if (matchEnded) {
    return;
  }

  if (gameWaitingToStart && !countdownRunning) {
    if (mySocketId === hostId) {
      hideRoundCountdown();
      requestStartGame();
    } else {
      document.getElementById("message").textContent = "Waiting for the game creator to start.";
    }

    return;
  }

  if (!gameRunning || countdownRunning) {
    return;
  }

  // Ghost mode: my bird has died but the round is still live
  if (isGhost) {
    if (direction === "down") {
      socket.emit("ghostInput", { roomCode: currentGameCode, direction: "spook" });
    } else {
      SoundEngine.flap();
      socket.emit("ghostInput", { roomCode: currentGameCode, direction });
    }
    return;
  }

  SoundEngine.flap();
  socket.emit("playerInput", {
    roomCode: currentGameCode,
    direction
  });
}

document.addEventListener("keydown", function (event) {
  const activeElement = document.activeElement;

  if (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA"
  ) {
    return;
  }

  // Space to start new match from winner scene
  if (event.code === "Space" && winnerSceneActive) {
    event.preventDefault();
    if (mySocketId === hostId) {
      requestRematch();
    } else {
      hideWinnerScene();
    }
    return;
  }

  const movementKeys = [
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "KeyW", "KeyA", "KeyS", "KeyD", "Space"
  ];

  if (movementKeys.includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === "ArrowUp" || event.code === "KeyW" || event.code === "Space") {
    handleMove("up");
  }

  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    handleMove("left");
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    handleMove("right");
  }

  if (event.code === "ArrowDown" || event.code === "KeyS") {
    handleMove("down");
  }
});

socket.on("roomUpdated", function (data) {
  // Reset quick-join UI if we were queued and just got placed into a lobby
  if (quickJoinSearching) {
    quickJoinSearching = false;
    const btn = document.getElementById("quickJoinBtn");
    if (btn) { btn.textContent = "Quick Join a Running Game"; btn.onclick = quickJoin; }
  }

  updateLocalState(data);

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;
  matchEnded = false;
  explosions = {};
  shockwaves = [];
  ghostSpooks = [];
  previousPlayersState = {};
  isGhost = false;
  hideRoundCountdown();  // clear between-rounds timer
  if (autoRestartDisplayInterval) { clearInterval(autoRestartDisplayInterval); autoRestartDisplayInterval = null; }

  const winnerScene = document.getElementById("winnerScene");
  if (winnerScene) {
    winnerScene.remove();
  }

  winnerSceneActive = false;
  spectatingActive = false;
  spectatorJoining = false;
  playerStats = {};
  curse = null;
  lastCurseRattleTime = 0;
  drawGame();
  updatePlayerList();
  showWaitingMessage();
});

socket.on("gameStarting", function (data) {
  updateLocalState(data);

  matchEnded = false;
  explosions = {};
  shockwaves = [];
  ghostSpooks = [];
  previousPlayersState = {};
  curse = null;
  lastCurseRattleTime = 0;
  isGhost = false;
  hideRoundCountdown();  // clear between-rounds timer
  hideSpectatorOverlay();

  drawGame();
  updatePlayerList();

  document.getElementById("message").textContent = "Get ready...";
  startCountdown();
});

socket.on("gameStarted", function (data) {
  updateLocalState(data);

  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = true;
  hideSpectatorOverlay();

  document.getElementById("countdown").style.display = "none";
  document.getElementById("message").textContent = "Battle started!";

  drawGame();
  updatePlayerList();
});

socket.on("gameState", function (data) {
  updateLocalState(data);
  drawGame();
  updatePlayerList();
});

socket.on("roundEnded", function (data) {
  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = false;
  isGhost = false;  // round is over — no longer a ghost

  updateLocalState(data);

  if (data.matchWinner) {
    matchEnded = true;
    autoRestartEndTime = null;
    if (autoRestartDisplayInterval) { clearInterval(autoRestartDisplayInterval); autoRestartDisplayInterval = null; }
    window._lastRoundWinnerName = null;
    window._lastRoundWinnerId   = null;
    document.getElementById("message").textContent = data.matchWinner.name + " wins the match!";
    SoundEngine.matchWin();

    // Show winner scene after a brief delay to see the final state
    setTimeout(() => {
      showWinnerScene(data.matchWinner);
    }, 1500);
  } else if (spectatorJoining) {
    // Mid-game spectators should not enter the between-rounds waiting state —
    // they can't start the round and their flow is handled via spectatorsCanJoin.
    // Just update the score display and preserve the spectating message.
    const scoresText = players.map(function (player) {
      return player.name + " (" + player.score + "/" + data.targetScore + ")";
    }).join(" | ");
    document.getElementById("message").textContent =
      "Spectating... " + scoresText + " — waiting for the match to end.";
  } else {
    matchEnded = false;
    gameWaitingToStart = true;

    // Store round winner info for the auto-restart countdown display
    window._lastRoundWinnerName = data.roundWinner ? data.roundWinner.name : null;
    window._lastRoundWinnerId   = data.roundWinner ? data.roundWinner.id   : null;

    if (data.roundWinner) {
      SoundEngine.roundWin();
    }
    // The message will be filled in by the autoRestartCountdown event handler.
    // If auto-restart is not active (e.g. first round with host-starts), show a fallback.
    const scoresText = players.map(function (player) {
      return player.name + " (" + player.score + "/" + data.targetScore + ")";
    }).join(" | ");
    let message = data.roundWinner
      ? data.roundWinner.name + " wins the round! ⭐\nScores: " + scoresText
      : "Everyone crashed! No winner.\nScores: " + scoresText;
    document.getElementById("message").textContent = message;
  }

  drawGame();
  updatePlayerList();
});

socket.on("joinError", function (message) {
  if (quickJoinSearching) cancelQuickJoin();
  document.getElementById("message").textContent = message;
});

socket.on("joinedAsSpectator", function (data) {
  quickJoinSearching = false;
  const btn = document.getElementById("quickJoinBtn");
  if (btn) { btn.textContent = "Quick Join a Running Game"; btn.onclick = quickJoin; }

  spectatorJoining = true;
  updateLocalState(data);

  // Seed previousPlayersState so the first drawPlayers() doesn't mistake
  // already-dead players as "just died" and fire false explosions/sounds.
  previousPlayersState = {};
  for (const player of players) {
    previousPlayersState[player.id] = player.alive;
  }

  showGameArea();
  drawGame();
  updatePlayerList();
  document.getElementById("lobby").style.display = "none";
  document.getElementById("message").textContent = "Spectating... You'll join as a player when the current match ends.";
});

socket.on("spectatorsCanJoin", function () {
  if (spectatorJoining) {
    document.getElementById("message").textContent = "The match has ended! You will join the next game.";
  }
});

socket.on("pickupCollected", function (data) {
  if (!data || data.type === "shield") {
    SoundEngine.shieldPickup();
  } else if (data.type === "ramboost") {
    SoundEngine.ramBoostPickup();
  }
});

socket.on("ramBoostHit", function () {
  SoundEngine.ramBoostHit();
});

socket.on("shockwaveTriggered", function (data) {
  shockwaves.push({ x: data.x, y: data.y, startTime: Date.now() });
  SoundEngine.shockwavePickup();
});

socket.on("shieldBlock", function () {
  SoundEngine.shieldBlock();
});

socket.on("monsterActivated", function () {
  SoundEngine.monsterActivated();
});

socket.on("curseSpawned", function () {
  SoundEngine.curseSpawn();
});

socket.on("curseAttached", function () {
  SoundEngine.curseAttach();
});

socket.on("curseTransferred", function () {
  SoundEngine.curseTransfer();
});

socket.on("curseDespawned", function () {
  SoundEngine.curseDespawn();
});

socket.on("curseDestroyedByPowerup", function () {
  SoundEngine.curseDespawn();
});

function showRoundCountdown(seconds, winnerName) {
  const el = document.getElementById("roundCountdown");
  if (!el) return;
  el.style.display = "flex";
  const numEl = document.getElementById("rcNumber");
  const subEl = document.getElementById("rcWinner");
  if (numEl) numEl.textContent = seconds;
  if (subEl) subEl.textContent = winnerName
    ? winnerName + " wins the round! ⭐"
    : "Everyone crashed — no winner.";
}

function hideRoundCountdown() {
  const el = document.getElementById("roundCountdown");
  if (el) el.style.display = "none";
  autoRestartEndTime = null;
  if (autoRestartDisplayInterval) {
    clearInterval(autoRestartDisplayInterval);
    autoRestartDisplayInterval = null;
  }
}

socket.on("ghostSpook", function (data) {
  if (!data) return;
  ghostSpooks.push({ x: data.x, y: data.y, startTime: Date.now() });
});

socket.on("stompKill", function (data) {
  if (!data) return;
  // Flash "STOMP!" text briefly above the attacker's position
  const attacker = players.find(function (p) { return p.id === data.attackerId; });
  if (attacker) {
    const el = document.createElement("div");
    el.className = "stomp-label";
    el.textContent = "STOMP!";
    el.style.left = scaleX(attacker.x + birdSize / 2) + "px";
    el.style.top  = scaleY(attacker.y - 24) + "px";
    document.getElementById("playersContainer").appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
  }
  if (data.victimId === mySocketId) {
    SoundEngine.localDeath();
  } else if (data.attackerId === mySocketId) {
    SoundEngine.impact();
  } else {
    SoundEngine.enemyDeath();
  }
});

socket.on("autoRestartCountdown", function (data) {
  autoRestartEndTime = Date.now() + data.seconds * 1000;
  if (autoRestartDisplayInterval) clearInterval(autoRestartDisplayInterval);

  function tick() {
    if (!gameWaitingToStart || matchEnded || autoRestartEndTime === null) {
      hideRoundCountdown();
      return;
    }
    const remaining = Math.max(0, Math.ceil((autoRestartEndTime - Date.now()) / 1000));
    showRoundCountdown(remaining, window._lastRoundWinnerName);
  }

  tick();
  autoRestartDisplayInterval = setInterval(tick, 400);
});

socket.on("leaderboardUpdate", function (data) {
  leaderboardData = data;
  drawLeaderboard();
});

function drawLeaderboard() {
  if (!leaderboardData) return;

  const hourlyBody = document.getElementById("hourlyTableBody");
  if (hourlyBody) {
    hourlyBody.innerHTML = leaderboardData.hourly.length === 0
      ? "<tr><td colspan='3' class='lb-empty'>No games yet this hour</td></tr>"
      : leaderboardData.hourly.map(function (e, i) {
          return "<tr><td class='lb-rank'>" + (i + 1) + "</td><td class='lb-name'>" + e.name +
            "</td><td class='lb-score'>" + e.matchWins + "M / " + e.roundWins + "R</td></tr>";
        }).join("");
  }

  const hofBody = document.getElementById("hofTableBody");
  if (hofBody) {
    hofBody.innerHTML = leaderboardData.hof.length === 0
      ? "<tr><td colspan='3' class='lb-empty'>No champions yet</td></tr>"
      : leaderboardData.hof.map(function (e, i) {
          return "<tr><td class='lb-rank'>" + (i + 1) + "</td><td class='lb-name'>" + e.name +
            "</td><td class='lb-score'>" + e.points + " ⭐</td></tr>";
        }).join("");
  }

  // Start/reset countdown ticker
  if (!lbCountdownInterval) {
    lbCountdownInterval = setInterval(updateLbCountdown, 1000);
  }
  updateLbCountdown();
}

function updateLbCountdown() {
  const el = document.getElementById("lbCountdown");
  if (!el || !leaderboardData) return;
  const remaining = Math.max(0, leaderboardData.resetAt - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  el.textContent = "resets in " + mins + "m " + String(secs).padStart(2, "0") + "s";
}