const socket = io();

let currentGameCode = "";
let hostId = "";
let mySocketId = "";

let players = [];
let obstacles = [];
let obstaclesPassed = 0;

let gameWaitingToStart = false;
let countdownRunning = false;
let gameRunning = false;

let countdownTimer = null;
let countdownAnimation = null;

const SERVER_WIDTH = 420;
const SERVER_HEIGHT = 500;
const BIRD_SIZE = 40;

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

function scaleX(serverX) {
  return serverX * (getGameWidth() / SERVER_WIDTH);
}

function scaleY(serverY) {
  return serverY * (getGameHeight() / SERVER_HEIGHT);
}

function scaleSize(size) {
  return size * (getGameWidth() / SERVER_WIDTH);
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

function showGameArea() {
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("controls").style.display = "block";
}

function clearObstacles() {
  document.getElementById("obstacleContainer").innerHTML = "";
}

function updateRoomDisplay(statusText) {
  const isHost = mySocketId === hostId;

  document.getElementById("message").textContent =
    "Game code: " + currentGameCode + ". " + statusText;

  const playerList = document.getElementById("playerList");

  playerList.innerHTML =
    "<h3>Players</h3>" +
    players.map(function(player) {
      const aliveText = player.alive ? "" : " (out)";
      return "<div style='color:" + player.colour + "'>" +
        player.name + aliveText +
        "</div>";
    }).join("");

  if (isHost && gameWaitingToStart) {
    document.getElementById("message").textContent =
      "Game code: " + currentGameCode +
      ". You are the host. Press any movement control to start.";
  }
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
    bird.style.width = scaleSize(BIRD_SIZE) + "px";
    bird.style.height = scaleSize(BIRD_SIZE) + "px";
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

function drawGameState() {
  showGameArea();
  drawPlayers();
  drawObstacles();
}

function requestStartGame() {
  socket.emit("requestStartGame", {
    roomCode: currentGameCode
  });
}

function startCountdown(startAt) {
  const countdown = document.getElementById("countdown");

  gameWaitingToStart = false;
  countdownRunning = true;
  gameRunning = false;

  countdown.style.display = "block";

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  if (countdownAnimation) {
    cancelAnimationFrame(countdownAnimation);
  }

  function updateCountdown() {
    const remaining = startAt - Date.now();

    if (remaining > 2500) {
      countdown.textContent = "3";
    } else if (remaining > 1500) {
      countdown.textContent = "2";
    } else if (remaining > 500) {
      countdown.textContent = "1";
    } else if (remaining > 0) {
      countdown.textContent = "GO!";
    } else {
      countdown.textContent = "GO!";
      return;
    }

    countdownAnimation = requestAnimationFrame(updateCountdown);
  }

  updateCountdown();
}

function stopCountdown() {
  const countdown = document.getElementById("countdown");
  countdown.style.display = "none";

  if (countdownAnimation) {
    cancelAnimationFrame(countdownAnimation);
    countdownAnimation = null;
  }

  countdownRunning = false;
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
  currentGameCode = data.roomCode;
  hostId = data.hostId;
  players = data.players;

  if (data.status === "waiting") {
    gameWaitingToStart = true;
    countdownRunning = false;
    gameRunning = false;
    obstacles = [];
    obstaclesPassed = 0;
    clearObstacles();
    showGameArea();
    drawPlayers();

    updateRoomDisplay(
      mySocketId === hostId
        ? "You are the host. Press any movement control to start."
        : "Waiting for the host to start."
    );
  }
});

socket.on("countdownStarted", function(data) {
  players = data.initialState.players;
  obstacles = data.initialState.obstacles;
  obstaclesPassed = data.initialState.obstaclesPassed;

  drawGameState();
  startCountdown(data.startAt);

  document.getElementById("message").textContent =
    "Get ready...";
});

socket.on("gameStarted", function(data) {
  players = data.players;
  obstacles = data.obstacles;
  obstaclesPassed = data.obstaclesPassed;

  stopCountdown();

  gameWaitingToStart = false;
  countdownRunning = false;
  gameRunning = true;

  document.getElementById("message").textContent =
    "Battle started!";

  drawGameState();
});

socket.on("gameState", function(data) {
  players = data.players;
  obstacles = data.obstacles;
  obstaclesPassed = data.obstaclesPassed;

  drawGameState();
});

socket.on("gameEnded", function(data) {
  gameRunning = false;
  countdownRunning = false;
  gameWaitingToStart = false;

  if (data.winner) {
    document.getElementById("message").textContent =
      data.winner.name + " wins! Obstacles passed: " + data.obstaclesPassed;
  } else {
    document.getElementById("message").textContent =
      "Everyone crashed! Obstacles passed: " + data.obstaclesPassed;
  }

  drawGameState();
});

socket.on("joinError", function(message) {
  document.getElementById("message").textContent = message;
});