(function attachAmbientPresets(global) {
  "use strict";

  const PRESETS = {
    standard: {
      id: "standard",
      windMultiplier: 1,
      lifeBias: 0
    },
    turbo: {
      id: "turbo",
      windMultiplier: 1.18,
      lifeBias: 0
    },
    squeeze: {
      id: "squeeze",
      windMultiplier: 0.78,
      lifeBias: -0.05
    },
    bruiser: {
      id: "bruiser",
      windMultiplier: 0.92,
      lifeBias: -0.02
    },
    treasure: {
      id: "treasure",
      windMultiplier: 0.84,
      lifeBias: 0.05
    }
  };

  function getAmbientPreset(mutatorId) {
    const key = String(mutatorId || "standard").toLowerCase();
    return PRESETS[key] || PRESETS.standard;
  }

  global.BIRD_ROYALE_AMBIENCE = {
    PRESETS,
    getAmbientPreset
  };
})(window);
