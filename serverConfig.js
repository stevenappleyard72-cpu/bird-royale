const playerColours = ["gold", "dodgerblue", "tomato", "limegreen", "violet", "orange"];
const MAX_PLAYERS = playerColours.length;

const birdSize = 40;
const gameWidth = 420;
const gameHeight = 500;

const playerMaxHealth = 100;
const playerHealthRegenPerSecond = 7;
const playerHealthRegenDelay = 1300;

const roundDurationMs = 85000;
const suddenDeathLeadInMs = 20000;
const suddenDeathStartMs = roundDurationMs - suddenDeathLeadInMs;

const obstaclePassBasePoints = 7;
const obstaclePassComboBonusCap = 8;
const obstaclePassSuddenDeathBonus = 3;
const obstacleNearMissPoints = 1;
const obstacleNearMissThreshold = 8;
const survivalTickMs = 3500;
const survivalTickPoints = 4;
const roundWinnerBonusPoints = 12;
const suddenDeathWinnerBonusPoints = 8;

const obstacleDamage = 22;
const obstacleDamageSuddenDeath = 30;
const obstacleDamageCooldownMs = 500;
const collisionToObstacleWindowMs = 1500;
const collisionForceObstacleBonus = 6;
const collisionForceObstacleKoBonus = 10;

const collisionPointSteal = 3;
const collisionPointStealBonus = 3;

const bountyMinPoints = 18;
const bountyMinLead = 6;
const bountyHitBonus = 2;
const bountyCrashBonus = 4;

const crownPickupSize = 34;
const crownPickupPoints = 16;
const crownSuddenDeathBonusPoints = 10;
const crownPickupHeal = 22;

const goldenTargetSize = 30;
const goldenTargetSpawnInterval = 10000;
const goldenTargetBasePoints = 14;
const goldenTargetSuddenDeathBonus = 6;
const goldenTargetTravelSpeed = 3.4;
const goldenTargetVerticalSpeed = 1.35;

const feverWindowMs = 4200;
const feverDurationMs = 5000;
const feverBonusPoints = 2;
const feverFlapMultiplier = 1.08;
const feverPushMultiplier = 1.12;

const gravity = 0.45;
const flapStrength = -7.8;
const sideFlapStrength = -6.4;
const horizontalPush = 4.8;
const horizontalDrag = 0.92;

const diveBurstStart = 20;
const diveBurstDecay = 0.45;
const diveBurstMinimum = 0.15;

const obstacleWidth = 40;
const obstacleSpacing = 170;
const obstacleSpeed = 2;
const targetObstacleCount = 4;

const victimKnockback = 65;
const attackerRecoil = 15;

const shieldDuration = 6000;
const shieldPickupSize = 28;
const maxPickups = 3;
const pickupSpawnInterval = 4000;

const shockwavePickupSize = 28;
const shockwaveRadius = 300;
const shockwavePushStrength = 98;

const ramBoostDuration = 5000;
const ramBoostPickupSize = 28;
const ramBoostKnockbackMultiplier = 2.5;
const ramBoostRecoilMultiplier = 0.4;

const GHOST_SPOOK_RADIUS = 110;
const GHOST_SPOOK_FORCE = 35;
const GHOST_SPOOK_COOLDOWN = 2500;

const curseBallSize = 20;
const curseSpawnInterval = 13000;
const curseChaseAcceleration = 0.06;
const curseMaxSpeed = 1.8;
const curseTargetSwitchCooldown = 1200;
const curseBeamInterceptDist = birdSize * 0.65;
const curseExtraGravity = 0.1;
const curseKnockbackBonus = 0.3;

const monsterSpawnInterval = 5200;
const monsterChaseSpeed = 0.58;
const monsterMinGap = 115;
const monsterPunchRange = 48;
const monsterPunchDynamicMinRange = 18;
const monsterPunchSafeCenterPadding = 22;
const monsterPunchCooldownMs = 850;
const monsterPunchKnockback = 44;
const monsterPunchDamage = 12;
const monsterPunchVictimGraceMs = 950;
const monsterArmReachMin = 26;
const monsterArmReachMax = 92;
const monsterBoxingStyles = ["classic", "leafwrap", "thorn", "bark"];

const windGustIntervalMs = 11000;
const windGustDurationMs = 2800;
const windGustForceMin = 0.028;
const windGustForceMax = 0.058;

const BOT_ID = "__bot__";
const BOT_NAME = "Bot";
const roundWinRule = "WIN: LAST BIRD STANDING";

const roundMutators = {
  standard: {
    id: "standard",
    name: "Classic Skies",
    description: "Balanced arena flow.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1,
    pickupSpawnMult: 1,
    goldenSpawnMult: 1,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1
  },
  turbo: {
    id: "turbo",
    name: "Turbo Draft",
    description: "Everything moves faster. Commit to lines.",
    speedMult: 1.1,
    gapTighten: 8,
    collisionMult: 1.05,
    pickupSpawnMult: 0.9,
    goldenSpawnMult: 0.85,
    curseSpawnMult: 0.85,
    curseChaseMult: 1.06,
    monsterChaseMult: 1.08
  },
  squeeze: {
    id: "squeeze",
    name: "Tight Squeeze",
    description: "Narrow gaps, cleaner flight required.",
    speedMult: 1.04,
    gapTighten: 14,
    collisionMult: 0.96,
    pickupSpawnMult: 1,
    goldenSpawnMult: 1,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1.08
  },
  bruiser: {
    id: "bruiser",
    name: "Bumper Birds",
    description: "Hits launch harder and steals matter more.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1.2,
    pickupSpawnMult: 0.92,
    goldenSpawnMult: 0.95,
    curseSpawnMult: 1,
    curseChaseMult: 1,
    monsterChaseMult: 1
  },
  treasure: {
    id: "treasure",
    name: "Treasure Storm",
    description: "High-value targets appear more often.",
    speedMult: 1,
    gapTighten: 0,
    collisionMult: 1,
    pickupSpawnMult: 0.8,
    goldenSpawnMult: 0.7,
    curseSpawnMult: 1.08,
    curseChaseMult: 0.96,
    monsterChaseMult: 1
  }
};

const rotatingMutatorPool = ["turbo", "squeeze", "bruiser", "treasure"];

const pointPowerThresholds = [24, 52, 85];
const pointPowerDurationMs = [3000, 4200, 5800];
const pointPowerFlapMultiplier = [1.06, 1.12, 1.2];
const pointPowerPushMultiplier = [1.08, 1.16, 1.24];
const pointPowerHeal = [8, 12, 18];
const tier3ClutchImmunityMs = 1500;
const clutchKnockbackResistance = 0.25;

const grassDepth = 28;
const vineDepth = 24;
const boundaryReleaseVelocity = 0.9;
const boundaryDiveBurstDamping = 0.18;

module.exports = {
  playerColours,
  MAX_PLAYERS,
  birdSize,
  gameWidth,
  gameHeight,
  playerMaxHealth,
  playerHealthRegenPerSecond,
  playerHealthRegenDelay,
  roundDurationMs,
  suddenDeathLeadInMs,
  suddenDeathStartMs,
  obstaclePassBasePoints,
  obstaclePassComboBonusCap,
  obstaclePassSuddenDeathBonus,
  obstacleNearMissPoints,
  obstacleNearMissThreshold,
  survivalTickMs,
  survivalTickPoints,
  roundWinnerBonusPoints,
  suddenDeathWinnerBonusPoints,
  obstacleDamage,
  obstacleDamageSuddenDeath,
  obstacleDamageCooldownMs,
  collisionToObstacleWindowMs,
  collisionForceObstacleBonus,
  collisionForceObstacleKoBonus,
  collisionPointSteal,
  collisionPointStealBonus,
  bountyMinPoints,
  bountyMinLead,
  bountyHitBonus,
  bountyCrashBonus,
  crownPickupSize,
  crownPickupPoints,
  crownSuddenDeathBonusPoints,
  crownPickupHeal,
  goldenTargetSize,
  goldenTargetSpawnInterval,
  goldenTargetBasePoints,
  goldenTargetSuddenDeathBonus,
  goldenTargetTravelSpeed,
  goldenTargetVerticalSpeed,
  feverWindowMs,
  feverDurationMs,
  feverBonusPoints,
  feverFlapMultiplier,
  feverPushMultiplier,
  gravity,
  flapStrength,
  sideFlapStrength,
  horizontalPush,
  horizontalDrag,
  diveBurstStart,
  diveBurstDecay,
  diveBurstMinimum,
  obstacleWidth,
  obstacleSpacing,
  obstacleSpeed,
  targetObstacleCount,
  victimKnockback,
  attackerRecoil,
  shieldDuration,
  shieldPickupSize,
  maxPickups,
  pickupSpawnInterval,
  shockwavePickupSize,
  shockwaveRadius,
  shockwavePushStrength,
  ramBoostDuration,
  ramBoostPickupSize,
  ramBoostKnockbackMultiplier,
  ramBoostRecoilMultiplier,
  GHOST_SPOOK_RADIUS,
  GHOST_SPOOK_FORCE,
  GHOST_SPOOK_COOLDOWN,
  curseBallSize,
  curseSpawnInterval,
  curseChaseAcceleration,
  curseMaxSpeed,
  curseTargetSwitchCooldown,
  curseBeamInterceptDist,
  curseExtraGravity,
  curseKnockbackBonus,
  monsterSpawnInterval,
  monsterChaseSpeed,
  monsterMinGap,
  monsterPunchRange,
  monsterPunchDynamicMinRange,
  monsterPunchSafeCenterPadding,
  monsterPunchCooldownMs,
  monsterPunchKnockback,
  monsterPunchDamage,
  monsterPunchVictimGraceMs,
  monsterArmReachMin,
  monsterArmReachMax,
  monsterBoxingStyles,
  windGustIntervalMs,
  windGustDurationMs,
  windGustForceMin,
  windGustForceMax,
  BOT_ID,
  BOT_NAME,
  roundWinRule,
  roundMutators,
  rotatingMutatorPool,
  pointPowerThresholds,
  pointPowerDurationMs,
  pointPowerFlapMultiplier,
  pointPowerPushMultiplier,
  pointPowerHeal,
  tier3ClutchImmunityMs,
  clutchKnockbackResistance,
  grassDepth,
  vineDepth,
  boundaryReleaseVelocity,
  boundaryDiveBurstDamping
};
