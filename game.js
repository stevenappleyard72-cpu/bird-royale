let currentGameCode = "";

let birdX = 80;
let birdY = 220;
let velocityY = 0;
let velocityX = 0;

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

function createGame() {
  const playerName = getPlayerName();
  currentGameCode = generateGameCode();

  document.getElementById("message").textContent =
    playerName + " created game code: " + currentGameCode +
    ". Press any movement control to start.";

  prepareGame();
}

function joinGame() {
  const playerName = getPlayerName();
  const code = document.getElementById("gameCodeInput").value.trim().toUpperCase();

  if (code === "") {
    document.getElementById("message").textContent = "Please enter a game code.";
    return;
  }

  currentGameCode = code;

  document.getElementById("message").textContent =
    playerName + " joined game: " + currentGameCode +
    ". Press any movement control to start.";

  prepareGame();
}

function prepareGame() {
  document.getElementById("gameArea").style.display = "block";
  document.getElementById("controls").style.display = "block";

  birdX = 80;
  birdY = 220;
  velocityX = 0;
  velocityY = 0;

  gameWaitingToStart = true;
  countdownRunning = false;
  gameRunning = false;

  drawBird();
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

  keepBirdInsideArena();
  drawBird();

  if (birdY <= 0 || birdY >= 460) {
    gameRunning = false;
    document.getElementById("message").textContent = "Game over!";
    return;
  }

  requestAnimationFrame(gameLoop);
}

function drawBird() {
  const bird = document.querySelector(".bird");
  bird.style.left = birdX + "px";
  bird.style.top = birdY + "px";
}

function keepBirdInsideArena() {
  if (birdX < 0) {
    birdX = 0;
    velocityX = 0;
  }

  if (birdX > 380) {
    birdX = 380;
    velocityX = 0;
  }

  if (birdY < 0) {
    birdY = 0;
  }

  if (birdY > 460) {
    birdY = 460;
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