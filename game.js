const socket = io();

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

const serverWidth = 420;
const serverHeight = 500;
const birdSize = 40;

socket.on("connect", function() {
  mySocketId = socket.id;
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
}

function drawPlayers() {
  const container = document.getElementById("playersContainer");
  container.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    // Check if bird just died
    if (player.alive === false && previousPlayersState[player.id] !== false) {
      createExplosion(player.id, player.x, player.y, player.colour);
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
    bird.style.background = player.colour;
    bird.style.opacity = "1";

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;

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

    const topElement = document.createElement("div");
    topElement.className = "obstacle top-obstacle";
    topElement.style.left = scaleX(obstacle.x) + "px";
    topElement.style.width = scaleX(obstacle.width) + "px";
    topElement.style.height = scaleY(obstacle.topHeight) + "px";

    const bottomElement = document.createElement("div");
    bottomElement.className = "obstacle bottom-obstacle";
    bottomElement.style.left = scaleX(obstacle.x) + "px";
    bottomElement.style.width = scaleX(obstacle.width) + "px";
    bottomElement.style.height = scaleY(obstacle.bottomHeight) + "px";

    container.appendChild(topElement);
    container.appendChild(bottomElement);
  }
}

function drawGame() {
  showGameArea();
  drawPlayers();
  drawObstacles();
}

function updatePlayerList() {
  const playerList = document.getElementById("playerList");

  playerList.innerHTML =
    "<h3>Players</h3>" +
    players.map(function(player) {
      const aliveText = player.alive ? "" : " (out)";
      const scoreText = player.score !== undefined ? " (" + player.score + "/" + targetScore + ")" : "";
      return "<div style='color:" + player.colour + "'>" +
        player.name + scoreText + aliveText +
        "</div>";
    }).join("");
}

function showWaitingMessage() {
  const isHost = mySocketId === hostId;

  document.getElementById("message").textContent =
    "Game code: " + currentGameCode +
    ". Speed: " + gameSpeed + " (" + gameSpeedMultiplier.toFixed(1) + "x). " +
    "Target: " + targetScore + " rounds. " +
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

  const timer = setInterval(function() {
    number--;

    if (number > 0) {
      countdown.textContent = number;
    } else if (number === 0) {
      countdown.textContent = "GO!";
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

  socket.emit("playerInput", {
    roomCode: currentGameCode,
    direction
  });
}

document.addEventListener("keydown", function(event) {
  const activeElement = document.activeElement;

  if (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA"
  ) {
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

socket.on("roomUpdated", function(data) {
  updateLocalState(data);

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;
  matchEnded = false;
  explosions = {};
  previousPlayersState = {};

  drawGame();
  updatePlayerList();
  showWaitingMessage();
});

socket.on("gameStarting", function(data) {
  updateLocalState(data);

  matchEnded = false;
  explosions = {};  // Clear explosions when new round starts
  previousPlayersState = {};

  drawGame();
  updatePlayerList();

  document.getElementById("message").textContent = "Get ready...";
  startCountdown();
});

socket.on("gameStarted", function(data) {
  updateLocalState(data);

  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = true;

  document.getElementById("countdown").style.display = "none";
  document.getElementById("message").textContent = "Battle started!";

  drawGame();
  updatePlayerList();
});

socket.on("gameState", function(data) {
  updateLocalState(data);
  drawGame();
  updatePlayerList();
});

socket.on("roundEnded", function(data) {
  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = false;

  updateLocalState(data);

  if (data.matchWinner) {
    matchEnded = true;
    document.getElementById("message").textContent = data.matchWinner.name + " wins the match with " + data.matchWinner.score + " round wins!";
  } else {
    matchEnded = false;
    gameWaitingToStart = true;

    if (data.roundWinner) {
      document.getElementById("message").textContent = data.roundWinner.name + " wins the round! (" + data.roundWinner.score + "/" + data.targetScore + "). Waiting for host to start next round.";
    } else {
      document.getElementById("message").textContent = "Everyone crashed! No winner this round. Waiting for host to start next round.";
    }
  }

  drawGame();
  updatePlayerList();
});

socket.on("joinError", function(message) {
  document.getElementById("message").textContent = message;
});