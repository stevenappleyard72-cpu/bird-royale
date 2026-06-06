const socket = io();

let currentGameCode = "";
let hostId = "";
let mySocketId = "";

let players = [];

let birdX = 80;
let birdY = 220;
let velocityY = 0;
let velocityX = 0;

const birdSize = 40;

const obstacleWidth = 40;
const obstacleSpacing = 170;
const targetObstacleCount = 4;

let obstacleSpeed = 2;
let obstacles = [];
let obstaclesPassed = 0;
let obstaclePlan = [];
let nextObstaclePlanIndex = 0;

const gravity = 0.45;
const flapStrength = -7.8;
const sideFlapStrength = -6.4;
const horizontalPush = 4.8;
const horizontalDrag = 0.92;

const diveAmount = 45;
const diveRecoveryDelay = 140;

let gameWaitingToStart = false;
let countdownRunning = false;
let gameRunning = false;

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

function getGameWidth() {
  return document.getElementById("gameArea").clientWidth;
}

function getGameHeight() {
  return document.getElementById("gameArea").clientHeight;
}

function createGame() {
  const playerName = getPlayerName();
  currentGameCode = generateGameCode();

  socket.emit("createGame", {
    playerName,
    roomCode: currentGameCode
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

function prepareGame() {
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("controls").style.display = "block";

  const myPlayer = players.find(function(player) {
    return player.id === mySocketId;
  });

  if (myPlayer) {
    birdX = myPlayer.x;
    birdY = myPlayer.y;
  } else {
    birdX = 80;
    birdY = 220;
  }

  velocityX = 0;
  velocityY = 0;

  obstacleSpeed = 2;
  obstaclesPassed = 0;
  obstacles = [];
  obstaclePlan = [];
  nextObstaclePlanIndex = 0;

  clearObstacleElements();

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;

  drawPlayers();
}

function clearObstacleElements() {
  const container = document.getElementById("obstacleContainer");
  container.innerHTML = "";
}

function createObstaclePair(xPosition) {
  if (nextObstaclePlanIndex >= obstaclePlan.length) {
    return;
  }

  const gameHeight = getGameHeight();
  const planItem = obstaclePlan[nextObstaclePlanIndex];

  const topHeight = Math.floor(gameHeight * planItem.topPercent);
  const bottomHeight = Math.floor(gameHeight * planItem.bottomPercent);

  nextObstaclePlanIndex++;

  const container = document.getElementById("obstacleContainer");

  const topElement = document.createElement("div");
  topElement.className = "obstacle top-obstacle";

  const bottomElement = document.createElement("div");
  bottomElement.className = "obstacle bottom-obstacle";

  container.appendChild(topElement);
  container.appendChild(bottomElement);

  obstacles.push({
    x: xPosition,
    topHeight,
    bottomHeight,
    topElement,
    bottomElement
  });
}

function createInitialObstacles() {
  clearObstacleElements();
  obstacles = [];
  nextObstaclePlanIndex = 0;

  for (let i = 0; i < targetObstacleCount; i++) {
    createObstaclePair((getGameWidth() - obstacleWidth) + i * obstacleSpacing);
  }

  drawObstacles();
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
      countdownRunning = false;
      startGame();
    }
  }, 1000);
}

function startGame() {
  gameRunning = true;
  gameLoop();
}

function gameLoop() {
  if (!gameRunning) {
    return;
  }

  velocityY += gravity;
  birdY += velocityY;

  birdX += velocityX;
  velocityX *= horizontalDrag;

  moveObstacles();

  keepBirdInsideArena();

  updateMyPlayerPosition();
  sendMyPlayerState();

  drawPlayers();
  drawObstacles();

  if (birdY <= 0 || birdY >= getGameHeight() - birdSize || checkCollision()) {
    gameRunning = false;
    document.getElementById("message").textContent =
      "Game over! Obstacles passed: " + obstaclesPassed;
    return;
  }

  requestAnimationFrame(gameLoop);
}

function updateMyPlayerPosition() {
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === mySocketId) {
      players[i].x = birdX;
      players[i].y = birdY;
      return;
    }
  }
}

function sendMyPlayerState() {
  socket.emit("playerState", {
    roomCode: currentGameCode,
    x: birdX,
    y: birdY
  });
}

function moveObstacles() {
  for (let i = 0; i < obstacles.length; i++) {
    obstacles[i].x -= obstacleSpeed;
  }

  while (obstacles.length > 0 && obstacles[0].x < -obstacleWidth) {
    obstacles[0].topElement.remove();
    obstacles[0].bottomElement.remove();
    obstacles.shift();

    obstaclesPassed++;

    obstacleSpeed = 2;

    const lastObstacle = obstacles[obstacles.length - 1];

    if (lastObstacle) {
      createObstaclePair(lastObstacle.x + obstacleSpacing);
    }
  }
}

function drawPlayers() {
  const container = document.getElementById("playersContainer");
  container.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    const bird = document.createElement("div");
    bird.className = "player-bird";
    bird.style.left = player.x + "px";
    bird.style.top = player.y + "px";
    bird.style.background = player.colour;

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;

    bird.appendChild(name);
    container.appendChild(bird);
  }
}

function drawObstacles() {
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];

    obstacle.topElement.style.left = obstacle.x + "px";
    obstacle.topElement.style.height = obstacle.topHeight + "px";

    obstacle.bottomElement.style.left = obstacle.x + "px";
    obstacle.bottomElement.style.height = obstacle.bottomHeight + "px";
  }
}

function checkCollision() {
  const gameHeight = getGameHeight();

  const birdLeft = birdX;
  const birdRight = birdX + birdSize;
  const birdTop = birdY;
  const birdBottom = birdY + birdSize;

  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i];

    const obstacleLeft = obstacle.x;
    const obstacleRight = obstacle.x + obstacleWidth;

    const overlapsHorizontally =
      birdRight > obstacleLeft &&
      birdLeft < obstacleRight;

    const hitsTop =
      overlapsHorizontally &&
      birdTop < obstacle.topHeight;

    const hitsBottom =
      overlapsHorizontally &&
      birdBottom > gameHeight - obstacle.bottomHeight;

    if (hitsTop || hitsBottom) {
      return true;
    }
  }

  return false;
}

function keepBirdInsideArena() {
  const gameWidth = getGameWidth();
  const gameHeight = getGameHeight();

  if (birdX < 0) {
    birdX = 0;
    velocityX = 0;
  }

  if (birdX > gameWidth - birdSize) {
    birdX = gameWidth - birdSize;
    velocityX = 0;
  }

  if (birdY < 0) {
    birdY = 0;
  }

  if (birdY > gameHeight - birdSize) {
    birdY = gameHeight - birdSize;
  }
}

function flapUp() {
  velocityY = flapStrength;
}

function flapLeft() {
  velocityY = sideFlapStrength;
  velocityX -= horizontalPush;
}

function flapRight() {
  velocityY = sideFlapStrength;
  velocityX += horizontalPush;
}

function diveThenRecover() {
  birdY += diveAmount;
  velocityY = 2;

  setTimeout(function() {
    if (gameRunning) {
      velocityY = flapStrength;
    }
  }, diveRecoveryDelay);
}

function handleMove(direction) {
  if (gameWaitingToStart && !countdownRunning) {
    if (mySocketId === hostId) {
      requestStartGame();
    } else {
      document.getElementById("message").textContent =
        "Waiting for the game creator to start.";
    }

    return;
  }

  if (!gameRunning || countdownRunning) {
    return;
  }

  if (direction === "up") {
    flapUp();
  }

  if (direction === "left") {
    flapLeft();
  }

  if (direction === "right") {
    flapRight();
  }

  if (direction === "down") {
    diveThenRecover();
  }
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
  currentGameCode = data.roomCode;
  hostId = data.hostId;
  players = data.players;

  const isHost = mySocketId === hostId;

  document.getElementById("message").textContent =
    "Game code: " + currentGameCode + ". " +
    (isHost
      ? "You are the host. Press any movement control to start."
      : "Waiting for the host to start.");

  const playerList = document.getElementById("playerList");

  playerList.innerHTML =
    "<h3>Players</h3>" +
    players.map(function(player) {
      return "<div style='color:" + player.colour + "'>" + player.name + "</div>";
    }).join("");

  prepareGame();
});

socket.on("gameStarting", function(data) {
  obstaclePlan = data.obstaclePlan;
  createInitialObstacles();
  startCountdown();
});

socket.on("playerMoved", function(data) {
  for (let i = 0; i < players.length; i++) {
    if (players[i].id === data.id) {
      players[i].x = data.x;
      players[i].y = data.y;
      return;
    }
  }
});

socket.on("joinError", function(message) {
  document.getElementById("message").textContent = message;
});