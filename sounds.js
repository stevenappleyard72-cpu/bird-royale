const SoundEngine = (() => {
  let _ctx = null;
  let _muted = false;

  function getCtx() {
    if (_muted) return null;
    if (!_ctx) {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ctx.state === "suspended") {
      _ctx.resume();
    }
    return _ctx;
  }

  function makeNoise(c, duration) {
    const len = Math.ceil(c.sampleRate * duration);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(c, type, freq, vol, attack, release, startTime, freqEnd) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + release);
    }
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(vol, startTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + release);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(startTime);
    osc.stop(startTime + release + 0.05);
  }

  function noiseBurst(c, vol, duration, hpFreq, startTime) {
    const src = c.createBufferSource();
    src.buffer = makeNoise(c, duration);
    const filter = c.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hpFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(c.destination);
    src.start(startTime);
  }

  // Inharmonic metallic ring — ratios approximate a struck metal plate
  function metalRing(c, baseFreq, vol, duration, startTime) {
    [1, 2.756, 5.404, 8.933, 13.34].forEach((ratio, i) => {
      const freq = Math.min(baseFreq * ratio, 18000);
      const partialVol = vol / (1 + i * 0.7);
      const partialDur = duration * Math.max(0.3, 1 - i * 0.15);
      tone(c, "sine", freq, partialVol, 0.001, partialDur, startTime);
    });
  }

  return {
    get muted() {
      return _muted;
    },

    toggleMute() {
      _muted = !_muted;
      return _muted;
    },

    // Light metallic tick on flap
    flap() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      tone(c, "triangle", 1600, 0.07, 0.002, 0.07, t, 500);
      noiseBurst(c, 0.04, 0.025, 3500, t);
    },

    // Sci-fi metallic clang on player-vs-player collision
    impact() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      metalRing(c, 180, 0.28, 0.5, t);
      tone(c, "sawtooth", 850, 0.14, 0.002, 0.2, t, 55);
      noiseBurst(c, 0.2, 0.07, 1000, t);
    },

    // Dramatic metallic explosion for local player death
    localDeath() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      metalRing(c, 75, 0.3, 1.0, t);
      metalRing(c, 290, 0.18, 0.65, t);
      tone(c, "sawtooth", 1300, 0.2, 0.002, 0.7, t, 28);
      noiseBurst(c, 0.4, 0.45, 350, t);
    },

    // Shorter metallic pop for other birds dying
    enemyDeath() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      metalRing(c, 200, 0.18, 0.5, t);
      tone(c, "sawtooth", 650, 0.1, 0.002, 0.3, t, 45);
      noiseBurst(c, 0.18, 0.18, 700, t);
    },

    // Countdown tick (isGo=false) or GO! burst (isGo=true)
    countdownBeep(isGo) {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      if (isGo) {
        [330, 415, 523, 659].forEach((freq, i) => {
          tone(c, "sawtooth", freq, 0.08, 0.003, 0.3, t + i * 0.04);
        });
        metalRing(c, 330, 0.1, 0.5, t);
      } else {
        tone(c, "sine", 520, 0.12, 0.004, 0.14, t);
        metalRing(c, 520, 0.05, 0.12, t);
      }
    },

    // Round win — short ascending arpeggio
    roundWin() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      [392, 523, 659].forEach((freq, i) => {
        tone(c, "triangle", freq, 0.1, 0.01, 0.28, t + i * 0.1);
        metalRing(c, freq, 0.04, 0.22, t + i * 0.1);
      });
    },

    // Match win — full victory fanfare
    matchWin() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      [[392, 0], [494, 0.14], [659, 0.28], [784, 0.42], [1047, 0.6]].forEach(([freq, delay]) => {
        tone(c, "triangle", freq, 0.12, 0.01, 0.4, t + delay);
        metalRing(c, freq, 0.05, 0.35, t + delay);
      });
    },

    // Bright ascending chime on shield pickup
    shieldPickup() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      [880, 1108, 1397, 1760].forEach((freq, i) => {
        tone(c, "sine", freq, 0.08, 0.008, 0.22, t + i * 0.055);
        metalRing(c, freq, 0.03, 0.18, t + i * 0.055);
      });
    },

    // Metallic clang when shield absorbs a hit
    shieldBlock() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      metalRing(c, 440, 0.24, 0.4, t);
      tone(c, "square", 220, 0.1, 0.002, 0.18, t, 440);
      noiseBurst(c, 0.14, 0.1, 900, t);
    },

    // Deep bass boom + electric crackle when shockwave detonates
    shockwavePickup() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      tone(c, "sine", 65, 0.5, 0.001, 0.4, t, 22);
      tone(c, "sawtooth", 190, 0.18, 0.001, 0.22, t, 48);
      metalRing(c, 110, 0.2, 0.5, t);
      noiseBurst(c, 0.45, 0.2, 280, t);
    },

    // Revving engine swell when ram boost is collected
    ramBoostPickup() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      tone(c, "sawtooth", 120, 0.22, 0.02, 0.5, t, 380);
      tone(c, "sawtooth", 180, 0.14, 0.04, 0.45, t, 520);
      tone(c, "square",   240, 0.08, 0.06, 0.35, t, 680);
      metalRing(c, 260, 0.1, 0.4, t + 0.12);
      noiseBurst(c, 0.12, 0.12, 1200, t + 0.1);
    },

    // Heavy thud when a ram-boosted bird smashes into someone
    ramBoostHit() {
      const c = getCtx();
      if (!c) return;
      const t = c.currentTime;
      tone(c, "sine",     55,  0.5, 0.001, 0.28, t, 28);
      tone(c, "sawtooth", 320, 0.22, 0.001, 0.18, t, 60);
      metalRing(c, 220, 0.28, 0.35, t);
      noiseBurst(c, 0.35, 0.12, 500, t);
    }
  };
})();
