const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const menuOverlay = document.getElementById("menuOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const startButton = document.getElementById("startButton");
const menuMainView = document.getElementById("menuMainView");
const howToPlayButton = document.getElementById("howToPlayButton");
const howToPlayPanel = document.getElementById("howToPlayPanel");
const backToMenuButton = document.getElementById("backToMenuButton");
const restartButton = document.getElementById("restartButton");
const menuButton = document.getElementById("menuButton");
const mobileControls = document.getElementById("mobileControls");
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const dashButtonMobile = document.getElementById("dashButtonMobile");
const dashCorner = document.getElementById("dashCorner");
const megaDisplay = document.getElementById("megaDisplay");
const hpDisplay = document.getElementById("hpDisplay");
const scoreDisplay = document.getElementById("scoreDisplay");
const dashDisplayCorner = document.getElementById("dashDisplayCorner");
const staminaDisplay = document.getElementById("staminaDisplay");
const chargeDisplay = document.getElementById("chargeDisplay");
const finalScore = document.getElementById("finalScore");
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
};

const game = {
  running: false,
  width: 0,
  height: 0,
  player: null,
  obstacles: [],
  pickups: [],
  particles: [],
  shoutWaves: [],
  score: 0,
  difficultyTimer: 0,
  lastTime: 0,
  timeScale: 1,
  cameraZoom: 1,
  spawnTimer: 0,
  pickupTimer: 0,
  pickupInterval: 7,
  spawnInterval: 1.15,
  obstacleSpeedBoost: 0,
  dashCooldownUntil: 0,
  invulnerableUntil: 0,
  pointer: {
    x: 0,
    y: 0,
    active: false,
  },
  touch: {
    enabled: false,
    joystickPointerId: null,
    joystickX: 0,
    joystickY: 0,
    chargePointerId: null,
  },
};

const audioState = {
  context: null,
  masterGain: null,
  noiseBuffer: null,
  charge: null,
};

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!audioState.context) {
    const context = new AudioContextClass();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; // Raised from -18 to allow more volume before squashing
    compressor.knee.value = 24;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.24;

    const masterGain = context.createGain();
    masterGain.gain.value = 0.45; // Increased from 0.22
    masterGain.connect(compressor);
    compressor.connect(context.destination);

    audioState.context = context;
    audioState.masterGain = masterGain;
    audioState.noiseBuffer = createNoiseBuffer(context);
  }

  if (audioState.context.state === "suspended") {
    audioState.context.resume();
  }

  return audioState.context;
}

function createNoiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate * 0.6, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function connectToMaster(context, node, pan = 0) {
  if (typeof context.createStereoPanner === "function") {
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    panner.connect(audioState.masterGain);
    return;
  }

  node.connect(audioState.masterGain);
}

function playTone({
  type = "triangle",
  startFreq,
  endFreq,
  duration = 0.14,
  gain = 0.04,
  attack = 0.01,
  delay = 0,
  pan = 0,
  filterType = "",
  filterStart = 1200,
  filterEnd = 600,
  q = 0.8,
}) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  let output = oscillator;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(30, startFreq), now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq || startFreq), now + duration);

  if (filterType) {
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterStart, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(50, filterEnd), now + duration);
    filter.Q.value = q;
    oscillator.connect(filter);
    output = filter;
  }

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(gain, now + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  output.connect(gainNode);
  connectToMaster(context, gainNode, pan);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
}

function playNoiseBurst({
  duration = 0.12,
  gain = 0.03,
  delay = 0,
  pan = 0,
  filterType = "bandpass",
  filterStart = 1200,
  filterEnd = 400,
  q = 0.9,
}) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime + delay;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gainNode = context.createGain();

  source.buffer = audioState.noiseBuffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterStart, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), now + duration);
  filter.Q.value = q;

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gainNode);
  connectToMaster(context, gainNode, pan);
  source.start(now);
  source.stop(now + duration + 0.05);
}

function getPanFromX(x) {
  if (!game.width) {
    return 0;
  }

  return Math.max(-0.75, Math.min(0.75, (x / game.width) * 1.6 - 0.8));
}

function playMenuClickSound() {
  playTone({
    type: "triangle",
    startFreq: 720,
    endFreq: 980,
    duration: 0.08,
    gain: 0.028,
  });
  playTone({
    type: "sine",
    startFreq: 980,
    endFreq: 820,
    duration: 0.06,
    gain: 0.018,
    delay: 0.04,
  });
}

function playStartSound() {
  // Layer 1: The Punchy Impact (Low thud)
  playTone({
    type: "triangle",
    startFreq: 220,
    endFreq: 60,
    duration: 0.25,
    gain: 0.08,
    filterType: "lowpass",
    filterStart: 1200,
    filterEnd: 100,
  });

  // Layer 2: Heroic Arpeggio (Rising notes: C4 -> G4 -> C5)
  // Note 1 (C4)
  playTone({
    type: "sine",
    startFreq: 261,
    endFreq: 261,
    duration: 0.3,
    gain: 0.04,
    attack: 0.01,
  });
  // Note 2 (G4) - slight delay
  playTone({
    type: "sine",
    startFreq: 392,
    endFreq: 392,
    duration: 0.3,
    gain: 0.035,
    attack: 0.01,
    delay: 0.05,
  });
  // Note 3 (C5) - more delay, rising pitch
  playTone({
    type: "sine",
    startFreq: 523,
    endFreq: 1046, // Slant upwards to the next octave
    duration: 0.4,
    gain: 0.04,
    attack: 0.01,
    delay: 0.1,
  });

  // Layer 3: The Shimmer (Sparkly noise)
  playNoiseBurst({
    duration: 0.2,
    gain: 0.025,
    delay: 0.1,
    filterType: "highpass",
    filterStart: 3000,
    filterEnd: 6000,
  });
}

function playDashSound() {
  const pan = game.player ? game.player.lastMoveVector.x * 0.25 : 0;
  
  // Tight randomization for variety without losing the "Fub" character
  const pitchShift = 0.95 + Math.random() * 0.1;
  const duration = 0.09 + Math.random() * 0.03;

  // The "F" - Sharp resonant snap
  playNoiseBurst({
    duration: duration,
    gain: 0.1,
    pan,
    filterType: "bandpass",
    filterStart: 5200 * pitchShift,
    filterEnd: 800 * pitchShift,
    q: 5, // High resonance for a tight "zip"
  });

  // The "ub" - Quick tonal body
  playTone({
    type: "sine",
    startFreq: 240 * pitchShift,
    endFreq: 80 * pitchShift,
    duration: duration * 1.2,
    gain: 0.06,
    attack: 0.005,
    pan,
  });
}

function startChargeHum() {
  const context = getAudioContext();
  if (!context || audioState.charge) {
    return;
  }

  const mainOscillator = context.createOscillator();
  const harmonicOscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gainNode = context.createGain();

  // Use Sine for clean, non-creepy tones
  mainOscillator.type = "sine";
  harmonicOscillator.type = "sine";

  mainOscillator.frequency.value = 220; // A3
  harmonicOscillator.frequency.value = 440; // A4 (Octave)
  
  filter.type = "bandpass";
  filter.frequency.value = 400;
  filter.Q.value = 1.2;
  gainNode.gain.value = 0.0001;

  mainOscillator.connect(filter);
  harmonicOscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioState.masterGain);

  const now = context.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.035, now + 0.1);

  mainOscillator.start(now);
  harmonicOscillator.start(now);

  audioState.charge = {
    mainOscillator,
    harmonicOscillator,
    filter,
    gainNode,
  };

  playTone({
    type: "sine",
    startFreq: 440,
    endFreq: 880,
    duration: 0.1,
    gain: 0.02,
  });
}

function updateChargeHum(chargeRatio) {
  if (!audioState.charge || !audioState.context) {
    return;
  }

  const now = audioState.context.currentTime;
  
  // Clean rising pitch (A3 to E4 range)
  const baseFreq = 220 + chargeRatio * 110; 
  audioState.charge.mainOscillator.frequency.setTargetAtTime(baseFreq, now, 0.1);
  audioState.charge.harmonicOscillator.frequency.setTargetAtTime(baseFreq * 2, now, 0.1);
  
  // Rising filter sweep to make it feel like "lifting off"
  const filterFreq = 400 + chargeRatio * 4200;
  audioState.charge.filter.frequency.setTargetAtTime(filterFreq, now, 0.05);
  
  // Narrow the filter slightly at the end for intensity
  audioState.charge.filter.Q.setTargetAtTime(1.2 + chargeRatio * 2, now, 0.1);
  
  // Subtle gain increase
  audioState.charge.gainNode.gain.setTargetAtTime(0.035 + chargeRatio * 0.02, now, 0.1);
}

function stopChargeHum() {
  if (!audioState.charge || !audioState.context) {
    return;
  }

  const now = audioState.context.currentTime;
  audioState.charge.gainNode.gain.cancelScheduledValues(now);
  audioState.charge.gainNode.gain.setTargetAtTime(0.0001, now, 0.04);
  audioState.charge.mainOscillator.stop(now + 0.15);
  audioState.charge.harmonicOscillator.stop(now + 0.15);
  audioState.charge = null;
}

function playShoutSound(chargeRatio, megaShout) {
  const intensity = megaShout ? 1.25 : 0.7 + chargeRatio * 0.8;
  const basePan = game.player ? game.player.lastMoveVector.x * 0.2 : 0;

  playTone({
    type: "triangle",
    startFreq: 420 + intensity * 180,
    endFreq: 150 + intensity * 60,
    duration: megaShout ? 0.38 : 0.24,
    gain: 0.08 + intensity * 0.03,
    pan: basePan,
    filterType: "lowpass",
    filterStart: 2200 + intensity * 1200,
    filterEnd: 500,
    q: 0.8,
  });
  playTone({
    type: megaShout ? "sawtooth" : "square",
    startFreq: 760 + intensity * 240,
    endFreq: 220 + intensity * 40,
    duration: megaShout ? 0.28 : 0.18,
    gain: 0.045 + intensity * 0.018,
    pan: basePan,
    filterType: "bandpass",
    filterStart: 1800 + intensity * 700,
    filterEnd: 420,
    q: 1.8,
  });
  playNoiseBurst({
    duration: megaShout ? 0.28 : 0.16,
    gain: 0.04 + intensity * 0.026,
    pan: basePan,
    filterType: "bandpass",
    filterStart: megaShout ? 2400 : 1500,
    filterEnd: megaShout ? 460 : 260,
    q: 0.7,
  });

  if (megaShout) {
    playTone({
      type: "sine",
      startFreq: 980,
      endFreq: 360,
      duration: 0.3,
      gain: 0.03,
      delay: 0.03,
      pan: basePan,
    });
  }
}

function playPickupHeartSound() {
  playTone({
    type: "triangle",
    startFreq: 660,
    endFreq: 920,
    duration: 0.12,
    gain: 0.032,
  });
  playTone({
    type: "sine",
    startFreq: 920,
    endFreq: 1320,
    duration: 0.14,
    gain: 0.026,
    delay: 0.07,
  });
}

function playPickupMegaSound() {
  playTone({
    type: "triangle",
    startFreq: 420,
    endFreq: 580,
    duration: 0.16,
    gain: 0.038,
  });
  playTone({
    type: "sine",
    startFreq: 860,
    endFreq: 1380,
    duration: 0.22,
    gain: 0.03,
    delay: 0.05,
  });
  playNoiseBurst({
    duration: 0.12,
    gain: 0.018,
    filterType: "bandpass",
    filterStart: 2400,
    filterEnd: 1800,
  });
}

function playHitSound() {
  playTone({
    type: "square",
    startFreq: 260,
    endFreq: 110,
    duration: 0.16,
    gain: 0.05,
    filterType: "lowpass",
    filterStart: 1200,
    filterEnd: 240,
    q: 1,
  });
  playNoiseBurst({
    duration: 0.16,
    gain: 0.03,
    filterType: "bandpass",
    filterStart: 520,
    filterEnd: 120,
    q: 1.4,
  });
}

function playObstacleBreakSound(scale = 1, pan = 0) {
  playTone({
    type: "triangle",
    startFreq: 520,
    endFreq: 190,
    duration: 0.09,
    gain: 0.024 * scale,
    pan,
    filterType: "bandpass",
    filterStart: 2000,
    filterEnd: 420,
    q: 1.6,
  });
  playNoiseBurst({
    duration: 0.06,
    gain: 0.018 * scale,
    pan,
    filterType: "highpass",
    filterStart: 2600,
    filterEnd: 780,
  });
}

function playGameOverSound() {
  playTone({
    type: "sine",
    startFreq: 420,
    endFreq: 320,
    duration: 0.14,
    gain: 0.036,
  });
  playTone({
    type: "sine",
    startFreq: 320,
    endFreq: 240,
    duration: 0.16,
    gain: 0.034,
    delay: 0.08,
  });
  playTone({
    type: "triangle",
    startFreq: 230,
    endFreq: 120,
    duration: 0.22,
    gain: 0.032,
    delay: 0.16,
  });
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;
}

function syncMobileControls() {
  game.touch.enabled = isTouchDevice();
  mobileControls.classList.toggle("hidden", !game.touch.enabled);
  mobileControls.classList.toggle("is-visible", game.touch.enabled);
}

function resetJoystick() {
  game.touch.joystickPointerId = null;
  game.touch.joystickX = 0;
  game.touch.joystickY = 0;
  joystickKnob.style.transform = "translate(-50%, -50%)";
}

function updateJoystick(pointerId, clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDistance = rect.width * 0.28;
  const deltaX = clientX - centerX;
  const deltaY = clientY - centerY;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const limited = Math.min(distance, maxDistance);
  const normalizedX = deltaX / distance;
  const normalizedY = deltaY / distance;

  game.touch.joystickPointerId = pointerId;
  game.touch.joystickX = normalizedX * (limited / maxDistance);
  game.touch.joystickY = normalizedY * (limited / maxDistance);
  joystickKnob.style.transform = `translate(calc(-50% + ${normalizedX * limited}px), calc(-50% + ${normalizedY * limited}px))`;
}

function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  game.width = window.innerWidth;
  game.height = window.innerHeight;
  canvas.width = game.width * ratio;
  canvas.height = game.height * ratio;
  canvas.style.width = `${game.width}px`;
  canvas.style.height = `${game.height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function createPlayer() {
  return {
    x: game.width / 2,
    y: game.height / 2,
    radius: Math.max(28, Math.min(game.width, game.height) * 0.036),
    speed: 330,
    hp: 3,
    maxHp: 5,
    stamina: 100,
    maxStamina: 100,
    megaShout: false,
    isDashing: false,
    dashUntil: 0,
    dashVector: { x: 0, y: -1 },
    lastMoveVector: { x: 0, y: -1 },
    isCharging: false,
    chargeStartedAt: 0,
    chargeRatio: 0,
    inhalePulse: 0,
    shoutBurstUntil: 0,
    shoutBurstStrength: 0,
    hitFlashUntil: 0,
    pickupEffectUntil: 0,
    pickupEffectType: "",
    pickupEffectStrength: 0,
  };
}

function resetGame() {
  stopChargeHum();
  game.player = createPlayer();
  game.obstacles = [];
  game.pickups = [];
  game.particles = [];
  game.shoutWaves = [];
  game.score = 0;
  game.difficultyTimer = 0;
  game.lastTime = 0;
  game.timeScale = 1;
  game.cameraZoom = 1;
  game.spawnTimer = 0;
  game.pickupTimer = 0;
  game.pickupInterval = 7;
  game.spawnInterval = 1.15;
  game.obstacleSpeedBoost = 0;
  game.dashCooldownUntil = 0;
  game.invulnerableUntil = 0;
  game.pointer.x = game.width / 2;
  game.pointer.y = game.height / 2;
  game.pointer.active = false;
  updateHud();
}

function startGame() {
  getAudioContext();
  playStartSound();
  resetGame();
  game.running = true;
  menuOverlay.classList.add("hidden");
  gameOverOverlay.classList.add("hidden");
  requestAnimationFrame(gameLoop);
}

function endGame() {
  stopChargeHum();
  playGameOverSound();
  game.running = false;
  finalScore.textContent = `Final Score: ${Math.floor(game.score)}`;
  gameOverOverlay.classList.remove("hidden");
}

function showMenu() {
  playMenuClickSound();
  stopChargeHum();
  game.running = false;
  gameOverOverlay.classList.add("hidden");
  menuOverlay.classList.remove("hidden");
  menuMainView.classList.remove("hidden");
  howToPlayPanel.classList.add("hidden");
  resetJoystick();
  game.touch.chargePointerId = null;
  resetGame();
  render();
}

function showHowToPlay() {
  playMenuClickSound();
  menuMainView.classList.add("hidden");
  howToPlayPanel.classList.remove("hidden");
}

function hideHowToPlay() {
  playMenuClickSound();
  howToPlayPanel.classList.add("hidden");
  menuMainView.classList.remove("hidden");
}

function updateHud() {
  if (game.player.hp > 0) {
    const fullHpClass = game.player.hp >= game.player.maxHp ? " full-hp-heart" : "";
    hpDisplay.innerHTML = Array.from({ length: game.player.hp }, (_, index) => (
      `<span class="hp-heart${index >= 3 ? " bonus-heart" : ""}${fullHpClass}">&#10084;</span>`
    )).join(" ");
  } else {
    hpDisplay.textContent = "None";
  }
  scoreDisplay.textContent = Math.floor(game.score).toString();
  staminaDisplay.textContent = `${Math.round(game.player.stamina)} / ${game.player.maxStamina}`;
  const dashRemaining = Math.max(0, game.dashCooldownUntil - performance.now());
  const dashText = dashRemaining > 0 ? `${(dashRemaining / 1000).toFixed(1)}s` : "Ready";
  dashDisplayCorner.textContent = dashText;
  const dashProgress = dashRemaining > 0 ? 1 - dashRemaining / 2000 : 1;
  dashCorner.style.setProperty("--dash-progress", `${Math.max(0, Math.min(1, dashProgress))}turn`);
  dashCorner.style.setProperty("--dash-ring-color", dashRemaining > 0 ? "#f1c232" : "#ffd54a");
  dashCorner.classList.toggle("ready", dashRemaining <= 0);
  megaDisplay.classList.toggle("hidden", !game.player.megaShout);

  if (game.player.isCharging) {
    chargeDisplay.textContent = `${Math.round(game.player.chargeRatio * 100)}% | Cost ${Math.round(getShoutCost(game.player.chargeRatio))}`;
  } else if (game.player.megaShout) {
    chargeDisplay.textContent = "Mega Ready";
  } else {
    chargeDisplay.textContent = "Ready";
  }
}

function getMovementVector() {
  let x = 0;
  let y = 0;

  if (game.touch.enabled && (game.touch.joystickX !== 0 || game.touch.joystickY !== 0)) {
    x = game.touch.joystickX;
    y = game.touch.joystickY;
  } else {
    if (keys.a) x -= 1;
    if (keys.d) x += 1;
    if (keys.w) y -= 1;
    if (keys.s) y += 1;
  }

  if (x === 0 && y === 0) {
    return null;
  }

  const distance = Math.hypot(x, y);
  return {
    x: x / distance,
    y: y / distance,
    distance,
  };
}

function dashPlayer() {
  const now = performance.now();
  if (!game.running || now < game.dashCooldownUntil) {
    return;
  }

  const movementVector = getMovementVector();
  if (movementVector) {
    game.player.lastMoveVector = { x: movementVector.x, y: movementVector.y };
  }

  game.player.isDashing = true;
  game.player.dashUntil = now + 180;
  game.player.dashVector = { ...game.player.lastMoveVector };
  game.dashCooldownUntil = now + 1500;
  playDashSound();

  for (let i = 0; i < 10; i += 1) {
    game.particles.push(createParticle(game.player.x, game.player.y, "#ffd36e", 1.1));
  }
}

function getCurrentChargeRatio(now = performance.now()) {
  if (!game.player.isCharging) {
    return 0;
  }

  return Math.min(1, (now - game.player.chargeStartedAt) / 950);
}

function getShoutCost(chargeRatio) {
  return 10 + chargeRatio * 50;
}

function getShoutAngle(chargeRatio) {
  const minAngle = Math.PI / 6;
  const maxAngle = (130 * Math.PI) / 180;
  return minAngle + (maxAngle - minAngle) * chargeRatio;
}

function beginCharge() {
  if (!game.running || game.player.isCharging || game.player.stamina < 10) {
    return;
  }

  getAudioContext();
  game.player.isCharging = true;
  game.player.chargeStartedAt = performance.now();
  game.player.chargeRatio = 0;
  startChargeHum();
}

function releaseCharge() {
  const now = performance.now();
  if (!game.running || !game.player.isCharging) {
    return;
  }

  const desiredRatio = getCurrentChargeRatio(now);
  const maxAffordableRatio = Math.min(1, Math.max(0, (game.player.stamina - 10) / 50));
  const actualRatio = Math.min(desiredRatio, maxAffordableRatio);
  const staminaCost = Math.min(game.player.stamina, getShoutCost(actualRatio));
  const megaShout = game.player.megaShout;

  game.player.isCharging = false;
  game.player.chargeRatio = 0;
  stopChargeHum();

  if (staminaCost < 10) {
    return;
  }

  game.player.stamina = Math.max(0, game.player.stamina - staminaCost);
  game.player.shoutBurstUntil = now + 220;
  game.player.shoutBurstStrength = megaShout ? 1.25 : actualRatio;
  playShoutSound(actualRatio, megaShout);

  const shoutRadius = megaShout ? Math.max(game.width, game.height) * 1.2 : 150 + actualRatio * 260;
  const shoutStrength = megaShout ? 2200 : 380 + actualRatio * 980;
  const shoutAngle = megaShout ? Math.PI * 2 : getShoutAngle(actualRatio);
  const forward = game.player.lastMoveVector;
  game.player.megaShout = false;
  let destroyedCount = 0;
  let destroyedXTotal = 0;

  game.shoutWaves.push({
    x: game.player.x,
    y: game.player.y,
    radius: game.player.radius,
    maxRadius: shoutRadius,
    life: 0.35,
    maxLife: 0.35,
    lineWidth: 8 + actualRatio * 10,
    direction: megaShout ? -Math.PI / 2 : Math.atan2(forward.y, forward.x),
    spread: shoutAngle,
    mega: megaShout,
  });

  for (let index = game.obstacles.length - 1; index >= 0; index -= 1) {
    const obstacle = game.obstacles[index];
    const deltaX = obstacle.x - game.player.x;
    const deltaY = obstacle.y - game.player.y;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance === 0 || distance - obstacle.radius > shoutRadius) {
      continue;
    }

    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    if (!megaShout) {
      const dot = directionX * forward.x + directionY * forward.y;
      const angleToObstacle = Math.acos(Math.max(-1, Math.min(1, dot)));
      const edgeAllowance = Math.asin(Math.min(1, obstacle.radius / Math.max(distance, obstacle.radius + 1)));

      if (angleToObstacle > shoutAngle / 2 + edgeAllowance) {
        continue;
      }
    }

    const force = (1 - distance / shoutRadius) * shoutStrength;
    for (let i = 0; i < 10; i += 1) {
      game.particles.push(createParticle(obstacle.x, obstacle.y, megaShout ? "#7be7ff" : "#ffbf47", 0.9 + actualRatio * 0.6));
    }

    obstacle.vx += directionX * force;
    obstacle.vy += directionY * force;
    destroyedCount += 1;
    destroyedXTotal += obstacle.x;
    game.obstacles.splice(index, 1);
  }

  if (destroyedCount > 0) {
    playObstacleBreakSound(1 + Math.min(0.65, destroyedCount * 0.08), getPanFromX(destroyedXTotal / destroyedCount));
  }

  for (let i = 0; i < 16; i += 1) {
    game.particles.push(createParticle(game.player.x, game.player.y, megaShout ? "#7be7ff" : "#ffd36e", 1.2 + actualRatio * 1.4));
  }
}

function triggerPickupEffect(type) {
  const now = performance.now();
  game.player.pickupEffectType = type;
  game.player.pickupEffectUntil = now + (type === "mega" ? 850 : 650);
  game.player.pickupEffectStrength = 1;
}

function updateStamina(deltaTime) {
  const player = game.player;

  if (player.isCharging) {
    const affordableRatio = Math.min(1, Math.max(0, (player.stamina - 10) / 50));
    player.chargeRatio = Math.min(getCurrentChargeRatio(), affordableRatio);
    player.inhalePulse += deltaTime * (8 + player.chargeRatio * 6);
    updateChargeHum(player.chargeRatio);
    return;
  }

  player.inhalePulse = 0;
  player.stamina = Math.min(player.maxStamina, player.stamina + 24 * deltaTime);
}

function createParticle(x, y, color, scale = 1) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 45 + Math.random() * 120;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0.45 + Math.random() * 0.35,
    size: (4 + Math.random() * 6) * scale,
    color,
  };
}

function spawnObstacle() {
  const margin = 60;
  const side = Math.floor(Math.random() * 4);
  let x;
  let y;

  if (side === 0) {
    x = Math.random() * game.width;
    y = -margin;
  } else if (side === 1) {
    x = game.width + margin;
    y = Math.random() * game.height;
  } else if (side === 2) {
    x = Math.random() * game.width;
    y = game.height + margin;
  } else {
    x = -margin;
    y = Math.random() * game.height;
  }

  const radius = 12 + Math.random() * 18;
  const speed = 350 + Math.random() * 140 + game.obstacleSpeedBoost;
  const aimX = game.player.x - x;
  const aimY = game.player.y - y;
  const aimLength = Math.hypot(aimX, aimY) || 1;

  game.obstacles.push({
    x,
    y,
    radius,
    speed,
    hue: 8 + Math.random() * 22,
    vx: (aimX / aimLength) * speed,
    vy: (aimY / aimLength) * speed,
  });
}

function spawnPickup() {
  const type = Math.random() < 0.78 ? "heart" : "mega";
  const margin = 70;
  game.pickups.push({
    type,
    x: margin + Math.random() * Math.max(40, game.width - margin * 2),
    y: margin + Math.random() * Math.max(40, game.height - margin * 2),
    radius: type === "heart" ? 24 : 26,
    pulse: Math.random() * Math.PI * 2,
  });
}

function updatePlayer(deltaTime) {
  const player = game.player;
  const movementVector = getMovementVector();

  if (movementVector) {
    player.lastMoveVector = { x: movementVector.x, y: movementVector.y };
  }

  if (player.isDashing) {
    const dashSpeed = 760;
    player.x += player.dashVector.x * dashSpeed * deltaTime;
    player.y += player.dashVector.y * dashSpeed * deltaTime;

    if (performance.now() >= player.dashUntil) {
      player.isDashing = false;
    } else {
      game.particles.push({
        x: player.x - player.dashVector.x * 12,
        y: player.y - player.dashVector.y * 12,
        vx: (Math.random() - 0.5) * 30,
        vy: (Math.random() - 0.5) * 30,
        life: 0.2 + Math.random() * 0.2,
        size: 8 + Math.random() * 8,
        color: "rgba(255, 219, 118, 0.7)",
      });
    }
  } else if (movementVector) {
    const moveSpeed = player.isCharging ? player.speed * 0.42 : player.speed;
    player.x += movementVector.x * moveSpeed * deltaTime;
    player.y += movementVector.y * moveSpeed * deltaTime;

    const trailStrength = player.isCharging ? 0.8 : 1.1;
    const trailCount = player.isCharging ? 2 : 3; // Reduced back to a lighter density
    for (let i = 0; i < trailCount; i += 1) {
      const spread = player.radius * 0.35;
      const sideOffset = (Math.random() - 0.5) * spread;
      const backwardOffset = player.radius * (0.9 + Math.random() * 0.5);
      game.particles.push({
        x: player.x - movementVector.x * backwardOffset - movementVector.y * sideOffset,
        y: player.y - movementVector.y * backwardOffset + movementVector.x * sideOffset,
        vx: -movementVector.x * (15 + Math.random() * 25) + (Math.random() - 0.5) * 10,
        vy: -movementVector.y * (15 + Math.random() * 25) + (Math.random() - 0.5) * 10,
        life: 0.3 + Math.random() * 0.2,
        size: (6 + Math.random() * 5) * trailStrength, // Reduced size
        color: player.isCharging ? "rgba(180, 240, 255, 0.25)" : "rgba(173, 230, 255, 0.35)", // More transparent light blue
      });
    }
  }

  player.x = Math.max(player.radius, Math.min(game.width - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(game.height - player.radius, player.y));

}

function updateObstacles(deltaTime) {
  for (const obstacle of game.obstacles) {
    obstacle.x += obstacle.vx * deltaTime;
    obstacle.y += obstacle.vy * deltaTime;
  }
}

function handleCollisions() {
  const now = performance.now();

  for (let index = game.obstacles.length - 1; index >= 0; index -= 1) {
    const obstacle = game.obstacles[index];
    const distance = Math.hypot(game.player.x - obstacle.x, game.player.y - obstacle.y);

    if (distance <= game.player.radius + obstacle.radius) {
      if (game.player.isDashing) {
        playObstacleBreakSound(0.9, getPanFromX(obstacle.x));
        game.obstacles.splice(index, 1);
        for (let i = 0; i < 5; i += 1) {
          game.particles.push(createParticle(obstacle.x, obstacle.y, "#ffe4a8", 0.9));
        }
        continue;
      }

      if (now < game.invulnerableUntil) {
        continue;
      }

      game.obstacles.splice(index, 1);

      game.player.hp -= 1;
      game.player.hitFlashUntil = now + 250;
      game.invulnerableUntil = now + 900;
      if (game.player.hp > 0) {
        playHitSound();
      }

      for (let i = 0; i < 10; i += 1) {
        game.particles.push(createParticle(game.player.x, game.player.y, "#ff7d7d", 1.4));
      }

      if (game.player.hp <= 0) {
        endGame();
        return;
      }
    }
  }

  for (let index = game.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = game.pickups[index];
    const distance = Math.hypot(game.player.x - pickup.x, game.player.y - pickup.y);

    if (distance > game.player.radius + pickup.radius) {
      continue;
    }

    if (pickup.type === "heart") {
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + 1);
      playPickupHeartSound();
      triggerPickupEffect("heart");
      for (let i = 0; i < 10; i += 1) {
        game.particles.push(createParticle(pickup.x, pickup.y, "#ff7d9a", 0.9));
      }
    } else {
      game.player.megaShout = true;
      playPickupMegaSound();
      triggerPickupEffect("mega");
      for (let i = 0; i < 14; i += 1) {
        game.particles.push(createParticle(pickup.x, pickup.y, "#77ebff", 1.1));
      }
    }

    game.pickups.splice(index, 1);
  }
}

function updateParticles(deltaTime) {
  for (let index = game.particles.length - 1; index >= 0; index -= 1) {
    const particle = game.particles[index];
    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    particle.life -= deltaTime;
    particle.size *= 0.985;

    if (particle.life <= 0) {
      game.particles.splice(index, 1);
    }
  }
}

function updateShoutWaves(deltaTime) {
  for (let index = game.shoutWaves.length - 1; index >= 0; index -= 1) {
    const wave = game.shoutWaves[index];
    wave.life -= deltaTime;
    wave.radius += ((wave.maxRadius - wave.radius) * 9) * deltaTime;

    if (wave.life <= 0) {
      game.shoutWaves.splice(index, 1);
    }
  }
}

function updatePickups(deltaTime) {
  game.pickupTimer += deltaTime;
  game.pickupInterval = Math.max(4.5, 7 - game.difficultyTimer * 0.04);

  while (game.pickupTimer >= game.pickupInterval) {
    if (game.pickups.length < 3) {
      spawnPickup();
    }
    game.pickupTimer -= game.pickupInterval;
  }

  for (const pickup of game.pickups) {
    pickup.pulse += deltaTime * 3.2;

    const pullX = game.player.x - pickup.x;
    const pullY = game.player.y - pickup.y;
    const distance = Math.hypot(pullX, pullY);
    const magnetRadius = game.player.radius + pickup.radius + 110;

    if (distance === 0 || distance > magnetRadius) {
      continue;
    }

    const pullStrength = 1 - distance / magnetRadius;
    const speed = 90 + pullStrength * 240;
    pickup.x += (pullX / distance) * speed * deltaTime;
    pickup.y += (pullY / distance) * speed * deltaTime;
  }
}

function updateDifficulty(deltaTime) {
  game.difficultyTimer += deltaTime;
  game.spawnInterval = Math.max(0.34, 0.88 - game.difficultyTimer * 0.02);
  game.obstacleSpeedBoost = Math.min(180, game.difficultyTimer * 8);
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, game.height);
  gradient.addColorStop(0, "#fffef7");
  gradient.addColorStop(1, "#ffeaa0");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, game.width, game.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.arc(game.width * 0.18, game.height * 0.18, 90, 0, Math.PI * 2);
  ctx.fill();

  const ringCount = 5;
  for (let i = 0; i < ringCount; i += 1) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 206, 85, ${0.16 - i * 0.02})`;
    ctx.lineWidth = 2;
    ctx.arc(game.width / 2, game.height / 2, 120 + i * 100, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlayer() {
  const player = game.player;
  const now = performance.now();
  const isHit = now < player.hitFlashUntil;
  const pickupLife = now < player.pickupEffectUntil ? (player.pickupEffectUntil - now) / (player.pickupEffectType === "mega" ? 850 : 650) : 0;
  const faceColor = player.isDashing ? "#fff1ba" : isHit ? "#ffd6d6" : "#fffef8";
  const chargeBreath = player.isCharging ? 1 + player.chargeRatio * 0.34 + Math.sin(player.inhalePulse) * 0.06 : 1;
  const burstLife = now < player.shoutBurstUntil ? (player.shoutBurstUntil - now) / 220 : 0;
  const burstScaleX = 1 + burstLife * player.shoutBurstStrength * 0.32;
  const burstScaleY = 1 - burstLife * player.shoutBurstStrength * 0.18;
  const pickupBoostScale = pickupLife > 0 ? 1 + pickupLife * 0.12 : 1;
  const mouthY = player.radius * 0.02;
  const mouthWidth = player.radius * (0.44 + burstLife * player.shoutBurstStrength * 0.1);
  const mouthLift = player.isCharging ? Math.sin(player.inhalePulse) * player.radius * 0.032 : 0;
  const mouthCurve = player.isCharging
    ? (-player.radius * (0.04 + player.chargeRatio * 0.09) + Math.sin(player.inhalePulse) * player.radius * 0.03)
    : 0;
  const mouthOpen = player.isCharging
    ? player.radius * (0.045 + player.chargeRatio * 0.075 + (Math.sin(player.inhalePulse) + 1) * 0.012)
    : 0;
  const chargeMouthWidth = player.radius * (0.24 + player.chargeRatio * 0.14);
  const chargeMouthHeight = player.radius * (0.1 + player.chargeRatio * 0.14 + (Math.sin(player.inhalePulse) + 1) * 0.02);
  const eyeSquint = player.isCharging ? player.chargeRatio * 0.04 : 0;
  const faceTension = player.isCharging ? 1 + player.chargeRatio * 0.08 : 1;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(Math.atan2(player.lastMoveVector.y, player.lastMoveVector.x) + Math.PI / 2);
  ctx.scale(chargeBreath * burstScaleX * pickupBoostScale * faceTension, chargeBreath * burstScaleY * pickupBoostScale);

  if (pickupLife > 0 && player.pickupEffectType === "heart") {
    const heartPulse = player.radius + 20 + (1 - pickupLife) * 26;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 126, 167, ${pickupLife * 0.2})`;
    ctx.arc(0, 0, heartPulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 106, 157, ${pickupLife * 0.95})`;
    ctx.lineWidth = 4;
    ctx.arc(0, 0, heartPulse + 8, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 3; i += 1) {
      const angle = now * 0.008 + i * ((Math.PI * 2) / 3);
      const orbit = player.radius + 18 + Math.sin(now * 0.012 + i) * 4;
      const sparkX = Math.cos(angle) * orbit;
      const sparkY = Math.sin(angle) * orbit - 6;

      ctx.save();
      ctx.translate(sparkX, sparkY);
      ctx.scale(0.72 + pickupLife * 0.55, 0.72 + pickupLife * 0.55);
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 112, 160, ${0.55 + pickupLife * 0.4})`;
      ctx.arc(-5, -2, 5, 0, Math.PI * 2);
      ctx.arc(5, -2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(-10, 1);
      ctx.lineTo(10, 1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  if (pickupLife > 0 && player.pickupEffectType === "mega") {
    const megaPulse = player.radius + 18 + (1 - pickupLife) * 44;
    ctx.beginPath();
    ctx.fillStyle = `rgba(78, 227, 255, ${pickupLife * 0.14})`;
    ctx.arc(0, 0, megaPulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(103, 244, 255, ${pickupLife * 0.9})`;
    ctx.lineWidth = 5;
    ctx.arc(0, 0, megaPulse + 10, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 4; i += 1) {
      const angle = now * 0.01 + i * (Math.PI / 2);
      const orbit = player.radius + 22 + Math.cos(now * 0.01 + i) * 5;
      const sparkX = Math.cos(angle) * orbit;
      const sparkY = Math.sin(angle) * orbit;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(119, 235, 255, ${0.4 + pickupLife * 0.5})`;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.moveTo(sparkX * 0.72, sparkY * 0.72);
      ctx.lineTo(sparkX, sparkY);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.75 + pickupLife * 0.2})`;
      ctx.arc(sparkX, sparkY, 3.6 + pickupLife * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.beginPath();
  ctx.fillStyle = player.isDashing ? "rgba(255, 214, 92, 0.36)" : "rgba(255, 255, 255, 0.3)";
  ctx.arc(0, 0, player.radius + 18, 0, Math.PI * 2);
  ctx.fill();

  if (player.isCharging) {
    const inhaleGlow = player.radius + 10 + player.chargeRatio * 12 + Math.sin(player.inhalePulse) * 4;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 212, 77, ${0.16 + player.chargeRatio * 0.2})`;
    ctx.arc(0, 0, inhaleGlow, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 174, 0, ${0.2 + player.chargeRatio * 0.2})`;
    ctx.lineWidth = 2.5;
    ctx.arc(0, 0, inhaleGlow + 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.fillStyle = faceColor;
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "rgba(160, 150, 126, 0.98)";
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = player.isDashing ? "rgba(255, 208, 74, 0.98)" : "rgba(255, 255, 255, 0.82)";
  ctx.lineWidth = 2;
  ctx.arc(0, 0, player.radius + 6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.ellipse(-player.radius * 0.16, -player.radius * 0.3, player.radius * 0.24, player.radius * 0.14, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.fillStyle = "#1f232b";
  ctx.ellipse(-player.radius * 0.34, -player.radius * 0.34, player.radius * 0.15, player.radius * (0.15 - eyeSquint), 0, 0, Math.PI * 2);
  ctx.ellipse(player.radius * 0.34, -player.radius * 0.34, player.radius * 0.15, player.radius * (0.15 - eyeSquint), 0, 0, Math.PI * 2);
  ctx.fill();

  if (player.isCharging) {
    const cheekLift = Math.sin(player.inhalePulse) * 0.05;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 170, 92, ${0.26 + player.chargeRatio * 0.2})`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.moveTo(-player.radius * 0.6, mouthY - player.radius * (0.11 + cheekLift));
    ctx.lineTo(-player.radius * 0.4, mouthY - player.radius * (0.01 - cheekLift));
    ctx.moveTo(player.radius * 0.4, mouthY - player.radius * (0.01 - cheekLift));
    ctx.lineTo(player.radius * 0.6, mouthY - player.radius * (0.11 + cheekLift));
    ctx.stroke();
  }

  if (player.isCharging) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(58, 36, 22, 0.88)";
    ctx.ellipse(
      0,
      mouthY + mouthCurve * 0.2 + mouthOpen * 0.4,
      chargeMouthWidth,
      chargeMouthHeight,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = "#40362f";
    ctx.lineWidth = 2.1;
    ctx.ellipse(
      0,
      mouthY + mouthCurve * 0.2 + mouthOpen * 0.4,
      chargeMouthWidth,
      chargeMouthHeight,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.strokeStyle = "#40362f";
    ctx.lineWidth = burstLife > 0 ? 2.6 + player.shoutBurstStrength * 0.6 : 2.2;
    ctx.lineCap = "round";
    ctx.moveTo(-mouthWidth, mouthY + mouthLift);
    ctx.quadraticCurveTo(
      0,
      mouthY + mouthCurve,
      mouthWidth,
      mouthY - mouthLift
    );
    ctx.stroke();
  }

  if (burstLife > 0) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 130, 0, ${burstLife * 0.9})`;
    ctx.lineWidth = 4 + player.shoutBurstStrength * 4;
    ctx.moveTo(player.radius * 0.34, mouthY);
    ctx.lineTo(player.radius * 1.1 + burstLife * 20, mouthY);
    ctx.stroke();
  }

  ctx.restore();
}

function drawObstacles() {
  for (const obstacle of game.obstacles) {
    const gradient = ctx.createRadialGradient(
      obstacle.x - obstacle.radius * 0.25,
      obstacle.y - obstacle.radius * 0.25,
      obstacle.radius * 0.25,
      obstacle.x,
      obstacle.y,
      obstacle.radius
    );
    gradient.addColorStop(0, `hsla(${obstacle.hue}, 90%, 72%, 0.95)`);
    gradient.addColorStop(1, `hsla(${obstacle.hue}, 82%, 48%, 0.98)`);

    ctx.beginPath();
    ctx.fillStyle = gradient;
    ctx.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPickups() {
  for (const pickup of game.pickups) {
    const pulseScale = 1 + Math.sin(pickup.pulse) * 0.08;
    ctx.save();
    ctx.translate(pickup.x, pickup.y);
    ctx.scale(pulseScale, pulseScale);

    if (pickup.type === "heart") {
      ctx.beginPath();
      ctx.fillStyle = "rgba(255, 122, 163, 0.18)";
      ctx.arc(0, 0, pickup.radius + 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "#ff7ba3";
      ctx.arc(-pickup.radius * 0.34, -pickup.radius * 0.1, pickup.radius * 0.42, 0, Math.PI * 2);
      ctx.arc(pickup.radius * 0.34, -pickup.radius * 0.1, pickup.radius * 0.42, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "#ff7ba3";
      ctx.moveTo(0, pickup.radius * 0.72);
      ctx.lineTo(-pickup.radius * 0.8, 0);
      ctx.lineTo(pickup.radius * 0.8, 0);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.arc(-pickup.radius * 0.28, -pickup.radius * 0.4, pickup.radius * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.fillStyle = "rgba(98, 233, 255, 0.2)";
      ctx.arc(0, 0, pickup.radius + 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "#86f2ff";
      ctx.arc(0, 0, pickup.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "#e9fdff";
      ctx.lineWidth = 4;
      ctx.arc(0, 0, pickup.radius - 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "#1c6f7e";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.moveTo(-pickup.radius * 0.34, 0);
      ctx.lineTo(pickup.radius * 0.34, 0);
      ctx.moveTo(0, -pickup.radius * 0.34);
      ctx.lineTo(0, pickup.radius * 0.34);
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.arc(-pickup.radius * 0.22, -pickup.radius * 0.28, pickup.radius * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawShoutWaves() {
  for (const wave of game.shoutWaves) {
    const waveAlpha = Math.max(0, wave.life / wave.maxLife);

    ctx.beginPath();
    ctx.globalAlpha = waveAlpha;
    ctx.lineWidth = wave.lineWidth;
    ctx.strokeStyle = wave.mega ? "rgba(90, 233, 255, 0.95)" : "rgba(255, 172, 28, 0.9)";
    ctx.arc(
      wave.x,
      wave.y,
      wave.radius,
      wave.direction - wave.spread / 2,
      wave.direction + wave.spread / 2
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = wave.mega ? `rgba(110, 233, 255, ${0.18 * waveAlpha})` : `rgba(255, 195, 77, ${0.16 * waveAlpha})`;
    ctx.moveTo(wave.x, wave.y);
    ctx.arc(
      wave.x,
      wave.y,
      wave.radius,
      wave.direction - wave.spread / 2,
      wave.direction + wave.spread / 2
    );
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = Math.max(2, wave.lineWidth * 0.28);
    ctx.strokeStyle = wave.mega ? `rgba(235, 255, 255, ${0.95 * waveAlpha})` : `rgba(255, 245, 210, ${0.9 * waveAlpha})`;
    ctx.arc(
      wave.x,
      wave.y,
      Math.max(0, wave.radius - wave.lineWidth * 0.9),
      wave.direction - wave.spread / 2,
      wave.direction + wave.spread / 2
    );
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawChargePreview() {
  const player = game.player;
  if (!player.isCharging) {
    return;
  }

  const radius = player.megaShout ? Math.max(game.width, game.height) * 0.58 : 95 + player.chargeRatio * 210;
  const spread = player.megaShout ? Math.PI * 2 : getShoutAngle(player.chargeRatio);
  const direction = player.megaShout ? -Math.PI / 2 : Math.atan2(player.lastMoveVector.y, player.lastMoveVector.x);
  const pulse = 0.72 + Math.sin(player.inhalePulse) * 0.08;

  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.fillStyle = player.megaShout ? `rgba(110, 233, 255, ${0.16 + player.chargeRatio * 0.12})` : `rgba(255, 209, 87, ${0.12 + player.chargeRatio * 0.12})`;
  ctx.arc(player.x, player.y, radius * pulse, direction - spread / 2, direction + spread / 2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = player.megaShout ? `rgba(140, 245, 255, ${0.46 + player.chargeRatio * 0.22})` : `rgba(255, 170, 28, ${0.35 + player.chargeRatio * 0.25})`;
  ctx.arc(player.x, player.y, radius * pulse, direction - spread / 2, direction + spread / 2);
  ctx.stroke();
}

function drawParticles() {
  for (const particle of game.particles) {
    ctx.beginPath();
    ctx.fillStyle = particle.color;
    ctx.globalAlpha = Math.max(0, particle.life * 1.6);
    ctx.arc(particle.x, particle.y, Math.max(1, particle.size), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function render() {
  ctx.save();
  ctx.translate(game.width / 2, game.height / 2);
  ctx.scale(game.cameraZoom, game.cameraZoom);
  ctx.translate(-game.width / 2, -game.height / 2);
  drawBackground();
  drawChargePreview();
  drawShoutWaves();
  drawParticles();
  drawPickups();
  drawObstacles();
  drawPlayer();
  ctx.restore();
}

function gameLoop(timestamp) {
  if (!game.running) {
    return;
  }

  if (!game.lastTime) {
    game.lastTime = timestamp;
  }

  const rawDeltaTime = Math.min((timestamp - game.lastTime) / 1000, 0.033);
  game.lastTime = timestamp;
  const targetTimeScale = game.player.isCharging ? 0.58 : 1;
  const targetZoom = game.player.isCharging ? 1.045 : 1;
  const smoothRate = game.player.isCharging ? 8.5 : 6.5;
  game.timeScale += (targetTimeScale - game.timeScale) * Math.min(1, rawDeltaTime * smoothRate);
  game.cameraZoom += (targetZoom - game.cameraZoom) * Math.min(1, rawDeltaTime * 7.5);
  const deltaTime = rawDeltaTime * game.timeScale;

  game.score += deltaTime * 10;
  game.spawnTimer += deltaTime;

  updateDifficulty(deltaTime);
  updateStamina(deltaTime);
  updatePlayer(deltaTime);
  updateObstacles(deltaTime);
  updatePickups(deltaTime);
  handleCollisions();
  updateParticles(deltaTime);
  updateShoutWaves(deltaTime);

  while (game.spawnTimer >= game.spawnInterval) {
    spawnObstacle();
    game.spawnTimer -= game.spawnInterval;
  }

  render();
  updateHud();

  if (game.running) {
    requestAnimationFrame(gameLoop);
  }
}

window.addEventListener("resize", () => {
  resizeCanvas();
  syncMobileControls();
  if (!game.player) {
    return;
  }

  game.player.x = Math.min(game.width - game.player.radius, Math.max(game.player.radius, game.player.x));
  game.player.y = Math.min(game.height - game.player.radius, Math.max(game.player.radius, game.player.y));
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key in keys) {
    keys[key] = true;
    event.preventDefault();
  }

  if (key === "ไ") {
    keys.w = true;
    event.preventDefault();
  }

  if (key === "ฟ") {
    keys.a = true;
    event.preventDefault();
  }

  if (key === "ห") {
    keys.s = true;
    event.preventDefault();
  }

  if (key === "ก") {
    keys.d = true;
    event.preventDefault();
  }

  if (event.key === "ArrowUp") {
    keys.w = true;
    event.preventDefault();
  }

  if (event.key === "ArrowLeft") {
    keys.a = true;
    event.preventDefault();
  }

  if (event.key === "ArrowDown") {
    keys.s = true;
    event.preventDefault();
  }

  if (event.key === "ArrowRight") {
    keys.d = true;
    event.preventDefault();
  }

  if (event.code === "Space") {
    dashPlayer();
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key in keys) {
    keys[key] = false;
    event.preventDefault();
  }

  if (key === "ไ") {
    keys.w = false;
    event.preventDefault();
  }

  if (key === "ฟ") {
    keys.a = false;
    event.preventDefault();
  }

  if (key === "ห") {
    keys.s = false;
    event.preventDefault();
  }

  if (key === "ก") {
    keys.d = false;
    event.preventDefault();
  }

  if (event.key === "ArrowUp") {
    keys.w = false;
    event.preventDefault();
  }

  if (event.key === "ArrowLeft") {
    keys.a = false;
    event.preventDefault();
  }

  if (event.key === "ArrowDown") {
    keys.s = false;
    event.preventDefault();
  }

  if (event.key === "ArrowRight") {
    keys.d = false;
    event.preventDefault();
  }
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  game.pointer.x = event.clientX - rect.left;
  game.pointer.y = event.clientY - rect.top;
  game.pointer.active = true;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("mousedown", (event) => {
  if (game.touch.enabled) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  game.pointer.x = event.clientX - rect.left;
  game.pointer.y = event.clientY - rect.top;
  game.pointer.active = true;

  if (event.button === 0) {
    beginCharge();
  }

  if (event.button === 2) {
    event.preventDefault();
  }
});

window.addEventListener("mouseup", (event) => {
  if (game.touch.enabled) {
    return;
  }

  if (event.button === 0) {
    releaseCharge();
  }
});

joystickBase.addEventListener("pointerdown", (event) => {
  if (!game.touch.enabled) {
    return;
  }

  event.preventDefault();
  updateJoystick(event.pointerId, event.clientX, event.clientY);
});

window.addEventListener("pointermove", (event) => {
  if (!game.touch.enabled) {
    return;
  }

  if (event.pointerId === game.touch.joystickPointerId) {
    updateJoystick(event.pointerId, event.clientX, event.clientY);
  }

  if (event.pointerId === game.touch.chargePointerId) {
    const point = getCanvasPoint(event.clientX, event.clientY);
    game.pointer.x = point.x;
    game.pointer.y = point.y;
    game.pointer.active = true;
  }
});

window.addEventListener("pointerup", (event) => {
  if (!game.touch.enabled) {
    return;
  }

  if (event.pointerId === game.touch.joystickPointerId) {
    resetJoystick();
  }

  if (event.pointerId === game.touch.chargePointerId) {
    game.touch.chargePointerId = null;
    releaseCharge();
  }
});

window.addEventListener("pointercancel", (event) => {
  if (!game.touch.enabled) {
    return;
  }

  if (event.pointerId === game.touch.joystickPointerId) {
    resetJoystick();
  }

  if (event.pointerId === game.touch.chargePointerId) {
    game.touch.chargePointerId = null;
    releaseCharge();
  }
});

dashButtonMobile.addEventListener("pointerdown", (event) => {
  if (!game.touch.enabled) {
    return;
  }

  event.preventDefault();
  dashPlayer();
});

canvas.addEventListener("pointerdown", (event) => {
  if (!game.touch.enabled || game.touch.chargePointerId !== null) {
    return;
  }

  event.preventDefault();
  const point = getCanvasPoint(event.clientX, event.clientY);
  game.pointer.x = point.x;
  game.pointer.y = point.y;
  game.pointer.active = true;
  game.touch.chargePointerId = event.pointerId;
  beginCharge();
});

startButton.addEventListener("click", startGame);
howToPlayButton.addEventListener("click", showHowToPlay);
backToMenuButton.addEventListener("click", hideHowToPlay);
restartButton.addEventListener("click", startGame);
menuButton.addEventListener("click", showMenu);

resizeCanvas();
syncMobileControls();
resetGame();
render();
