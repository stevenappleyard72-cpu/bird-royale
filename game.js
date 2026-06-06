let currentGameCode = "";

let birdX = 80;
let birdY = 220;
let velocityY = 0;
let velocityX = 0;

const birdSize = 40;
const socket = io();
const obstacleWidth = 40;
const obstacleSpacing = 170;
const targetObstacleCount = 4;

let obstacleSpeed = 2;
let obstacles = [];
let obstaclesPassed = 0;

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

  document.getElementById("message").textContent =
    playerName + " created game code: " + currentGameCode +
    ". Waiting for players...";
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

  birdX = 80;
  birdY = 220;
  velocityX = 0;
  velocityY = 0;

  obstacleSpeed = 2;
  obstaclesPassed = 0;
  obstacles = [];

  clearObstacleElements();

  for (let i = 0; i < targetObstacleCount; i++) {
    createObstaclePair((getGameWidth() - obstacleWidth) + i * obstacleSpacing);
  }

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;

  drawBird();
  drawObstacles();
}

function clearObstacleElements() {
  const container = document.getElementById("obstacleContainer");
  container.innerHTML = "";
}

function createObstaclePair(xPosition) {
  const gameHeight = getGameHeight();
  const maxTotalObstacleHeight = gameHeight / 2;

  let topHeight = randomNumber(50, 170);
  let bottomHeight = randomNumber(50, 170);

  while (topHeight + bottomHeight > maxTotalObstacleHeight) {
    topHeight = randomNumber(50, 170);
    bottomHeight = randomNumber(50, 170);
  }

  const container = document.getElementById("obstacleContainer");

  const topElement = document.createElement("div");
  topElement.className = "obstacle top-obstacle";

  const bottomElement = document.createElement("div");
  bottomElement.className = "obstacle bottom-obstacle";

  container.appendChild(topElement);
  container.appendChild(bottomElement);

  obstacles.push({
    x: xPosition,
    topHeight: topHeight,
    bottomHeight: bottomHeight,
    topElement: topElement,
    bottomElement: bottomElement
  });
}

function randomNumber(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
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
  drawBird();
  drawObstacles();

  if (birdY <= 0 || birdY >= getGameHeight() - birdSize || checkCollision()) {
    gameRunning = false;
    document.getElementById("message").textContent =
      "Game over! Obstacles passed: " + obstaclesPassed;
    return;
  }

  requestAnimationFrame(gameLoop);
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
    createObstaclePair(lastObstacle.x + obstacleSpacing);
  }
}

function drawBird() {
  const bird = document.querySelector(".bird");
  bird.style.left = birdX + "px";
  bird.style.top = birdY + "px";
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
    startCountdown();
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

  document.getElementById("message").textContent =

    "Game code: " + currentGameCode + ". Press any movement control to start.";

  const playerList = document.getElementById("playerList");

  playerList.innerHTML =

    "<h3>Players</h3>" +

    data.players.map(function(player) {

      return "<div>" + player.name + "</div>";

    }).join("");

  prepareGame();

});

socket.on("joinError", function(message) {

  document.getElementById("message").textContent = message;

});