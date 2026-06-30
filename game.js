const socket = io();

const APP_VERSION = "1.0.0";

let currentGameCode = "";
let hostId = "";
let mySocketId = "";

let players = [];
let obstacles = [];
let obstaclesPassed = 0;
let previousPlayersState = {};  // Track previous alive status to detect deaths

let gameSpeed = 10;
let gameSpeedMultiplier = 1;
let targetScore = 3;

let gameWaitingToStart = false;
let countdownRunning = false;
let gameRunning = false;
let matchEnded = false;

let explosions = {};  // Track explosions: { playerId: { x, y, color, startTime } }
const explosionDuration = 600;  // milliseconds

let playerStats = {};  // Track wins/losses: { playerId: { wins, matches } }
let winnerSceneActive = false;
let spectatingActive = false;
let spectatorJoining = false;  // True when we joined mid-game as spectator
let spectatorCount = 0;
let pickups = [];

let leaderboardData = null;
let lbCountdownInterval = null;

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
  const speed = Number(input.value) || 10;

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
    const statusIcon = player.alive ? "🐦" : "💀";
    const meClass = isMe ? " spectator-me" : "";
    return "<div class='spectator-score-row" + meClass + "' style='color:" + player.colour + "'>" +
      statusIcon + " " + player.name + " &mdash; " + player.score + "/" + targetScore +
      "</div>";
  }).join("");

  overlay.innerHTML =
    "<div class='spectator-title'>YOU'RE OUT!</div>" +
    "<div class='spectator-watching'>Spectating...</div>" +
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

    bird.appendChild(sprite);
    bird.appendChild(name);
    container.appendChild(bird);
  }

  // Draw explosions
  drawExplosions();

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

    container.appendChild(topElement);
    container.appendChild(bottomElement);
  }
}

function drawPickups() {
  const container = document.getElementById("playersContainer");
  for (const pickup of pickups) {
    if (pickup.type !== "shield") continue;
    const el = document.createElement("div");
    el.className = "shield-pickup";
    el.style.left = scaleX(pickup.x) + "px";
    el.style.top = scaleY(pickup.y) + "px";
    el.style.width = scaleSize(pickup.size) + "px";
    el.style.height = scaleSize(pickup.size) + "px";
    container.appendChild(el);
  }
}

function drawGame() {
  showGameArea();
  drawPlayers();
  drawPickups();
  drawObstacles();
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
      requestStartGame();
    } else {
      document.getElementById("message").textContent = "Waiting for the game creator to start.";
    }

    return;
  }

  if (!gameRunning || countdownRunning) {
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
  updateLocalState(data);

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;
  matchEnded = false;
  explosions = {};
  previousPlayersState = {};

  const winnerScene = document.getElementById("winnerScene");
  if (winnerScene) {
    winnerScene.remove();
  }

  winnerSceneActive = false;
  spectatingActive = false;
  spectatorJoining = false;
  playerStats = {};
  drawGame();
  updatePlayerList();
  showWaitingMessage();
});

socket.on("gameStarting", function (data) {
  updateLocalState(data);

  matchEnded = false;
  explosions = {};  // Clear explosions when new round starts
  previousPlayersState = {};
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

  updateLocalState(data);

  if (data.matchWinner) {
    matchEnded = true;
    document.getElementById("message").textContent = data.matchWinner.name + " wins the match!";
    SoundEngine.matchWin();

    // Show winner scene after a brief delay to see the final state
    setTimeout(() => {
      showWinnerScene(data.matchWinner);
    }, 1500);
  } else {
    matchEnded = false;
    gameWaitingToStart = true;

    let message = "";

    if (data.roundWinner) {
      SoundEngine.roundWin();
      message = data.roundWinner.name + " wins the round! ⭐\n";

      // Build scores list with star next to round winner
      const scoresText = players.map(function (player) {
        const star = player.id === data.roundWinner.id ? " ⭐" : "";
        return player.name + " (" + player.score + "/" + data.targetScore + ")" + star;
      }).join(" | ");

      message += "Scores: " + scoresText + "\n";
      message += "Waiting for host to start next round.";
    } else {
      message = "Everyone crashed! No winner this round.\n";

      // Show all scores even with no winner
      const scoresText = players.map(function (player) {
        return player.name + " (" + player.score + "/" + data.targetScore + ")";
      }).join(" | ");

      message += "Scores: " + scoresText + "\n";
      message += "Waiting for host to start next round.";
    }

    document.getElementById("message").textContent = message;
  }

  drawGame();
  updatePlayerList();
});

socket.on("joinError", function (message) {
  document.getElementById("message").textContent = message;
});

socket.on("joinedAsSpectator", function (data) {
  spectatorJoining = true;
  updateLocalState(data);
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

socket.on("pickupCollected", function () {
  SoundEngine.shieldPickup();
});

socket.on("shieldBlock", function () {
  SoundEngine.shieldBlock();
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