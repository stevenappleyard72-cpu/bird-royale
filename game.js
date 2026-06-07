const socket = io();

let currentGameCode = "";
let hostId = "";
let mySocketId = "";

let players = [];
let obstacles = [];
let obstaclesPassed = 0;

let gameSpeed = 10;
let gameSpeedMultiplier = 1;

let gameWaitingToStart = false;
let countdownRunning = false;
let gameRunning = false;

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

function createGame() {
  const playerName = getPlayerName();
  currentGameCode = generateGameCode();

  setGameSpeed(getSpeedFromInput());

  socket.emit("createGame", {
    playerName,
    roomCode: currentGameCode,
    gameSpeed
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
}

function drawPlayers() {
  const container = document.getElementById("playersContainer");
  container.innerHTML = "";

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    const bird = document.createElement("div");
    bird.className = "player-bird";
    bird.style.left = scaleX(player.x) + "px";
    bird.style.top = scaleY(player.y) + "px";
    bird.style.width = scaleSize(birdSize) + "px";
    bird.style.height = scaleSize(birdSize) + "px";
    bird.style.background = player.colour;
    bird.style.opacity = player.alive ? "1" : "0.25";

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;

    bird.appendChild(name);
    container.appendChild(bird);
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
      return "<div style='color:" + player.colour + "'>" +
        player.name + aliveText +
        "</div>";
    }).join("");
}

function showWaitingMessage() {
  const isHost = mySocketId === hostId;

  document.getElementById("message").textContent =
    "Game code: " + currentGameCode +
    ". Speed: " + gameSpeed + " (" + gameSpeedMultiplier.toFixed(1) + "x). " +
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

  drawGame();
  updatePlayerList();
  showWaitingMessage();
});

socket.on("gameStarting", function(data) {
  updateLocalState(data);

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

socket.on("gameEnded", function(data) {
  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = false;

  if (data.winner) {
    document.getElementById("message").textContent =
      data.winner.name + " wins! Obstacles passed: " + data.obstaclesPassed;
  } else {
    document.getElementById("message").textContent =
      "Everyone crashed! Obstacles passed: " + data.obstaclesPassed;
  }

  drawGame();
  updatePlayerList();
});

socket.on("joinError", function(message) {
  document.getElementById("message").textContent = message;
});