/**
 * ACSound — ACNH-flavored sound kit
 * ==================================
 * Three independent channels (settings):
 *   music    — looping MP3 / synth ambient bed
 *   dialogue — Animalese talk chirps
 *   sfx      — UI clicks, confirm, stamp, fanfare
 *
 * Drop cleared track at: assets/main-theme.mp3
 *
 * IMPORTANT: Browsers block AudioContext / autoplay until a user gesture.
 * Call ACSound.init() + startAmbient() from a real gesture (start menu).
 *
 * API:
 *   ACSound.init()
 *   ACSound.setMuted(bool) / isMuted()
 *   ACSound.setChannel(name, on) / isChannelOn(name) / getChannels()
 *   ACSound.blip() select() confirm() cancel() stamp() fanfare()
 *   ACSound.talk(char?) resetTalk()
 *   ACSound.startAmbient() stopAmbient() isAmbientRunning()
 */

(function () {
  'use strict';

  /* ── Module state ──────────────────────────────────────── */
  let ctx = null;            // AudioContext (created lazily in init())
  let muted = false;         // master mute (all channels)

  /* Per-channel enables — independent of master mute */
  const channels = { music: true, dialogue: true, sfx: true };
  let musicBus = null;
  let dialogueBus = null;
  let sfxBus = null;

  /* ambient-loop state */
  let ambientRunning = false;
  let ambientMode = null;        // 'file' | 'synth' | null
  let ambientStartPending = false; // true while file BGM load/play is in flight
  let ambientGain = null;        // master GainNode for the synth bed
  let ambientTimer = null;       // scheduler interval id
  let ambientCleanupFns = [];    // registered disconnect callbacks
  let ambientLoopStart = 0;      // absolute ctx time of loop "phase zero"
  let ambientEventIndex = 0;     // monotonically rising event cursor
  let ambientLoopEvents = [];    // pre-computed one-loop timeline
  let ambientLoopDuration = 0;   // seconds per loop
  let bgmEl = null;              // HTMLAudioElement for assets/main-theme.mp3
  let bgmDuckTimer = null;

  /* Drop your MP3 here — replace generated bed when this file loads. */
  const BGM_SRC = 'assets/main-theme.mp3?v=audio10';

  const AMBIENT_LOOKAHEAD = 0.25;   // schedule this far ahead (s)
  const AMBIENT_INTERVAL_MS = 100;  // scheduler tick

  /* polyphony cap so rapid blip() calls cannot spawn runaway nodes */
  const MAX_BLIP_NODES = 16;
  let blipCount = 0;

  /* Shared loudness — SFX / talk / ambient stay in one family */
  const MIX = {
    ambient: 0.09,
    talk: 0.155,
    blip: 0.055,
    select: 0.055,
    confirmA: 0.085,
    confirmB: 0.09,
    cancelA: 0.08,
    cancelB: 0.07,
    stampLow: 0.07,
    stampHi: 0.035,
    stampNoise: 0.028,
    fanfare: 0.1,
    talkFallback: 0.11
  };

  function channelOn(name) {
    return !muted && !!channels[name];
  }

  function ensureBuses() {
    const c = activeCtx();
    if (!c) return null;
    if (!musicBus) {
      musicBus = c.createGain();
      musicBus.gain.value = 1;
      musicBus.connect(c.destination);
    }
    if (!dialogueBus) {
      dialogueBus = c.createGain();
      dialogueBus.gain.value = 1;
      dialogueBus.connect(c.destination);
    }
    if (!sfxBus) {
      sfxBus = c.createGain();
      sfxBus.gain.value = 1;
      sfxBus.connect(c.destination);
    }
    return c;
  }

  function applyBgmVolume() {
    if (!bgmEl) return;
    try {
      const on = channelOn('music') && ambientRunning;
      bgmEl.volume = on ? MIX.ambient : 0;
      if (!on) {
        if (!bgmEl.paused) bgmEl.pause();
      } else if (ambientMode === 'file' && bgmEl.paused) {
        bgmEl.play().catch(function () {});
      }
    } catch (_) {}
  }

  function applyBusMutes() {
    try {
      if (musicBus) musicBus.gain.value = channelOn('music') ? 1 : 0;
      if (dialogueBus) dialogueBus.gain.value = channelOn('dialogue') ? 1 : 0;
      if (sfxBus) sfxBus.gain.value = channelOn('sfx') ? 1 : 0;
    } catch (_) {}
    applyBgmVolume();
    if (ambientGain) {
      try {
        const c = activeCtx();
        if (!c) return;
        const target = channelOn('music') && ambientRunning ? MIX.ambient : 0;
        ambientGain.gain.cancelScheduledValues(c.currentTime);
        ambientGain.gain.setValueAtTime(target, c.currentTime);
      } catch (_) {}
    }
  }

  function ensureBgmEl() {
    if (bgmEl) return bgmEl;
    try {
      bgmEl = new Audio(BGM_SRC);
      bgmEl.loop = true;
      bgmEl.preload = 'auto';
      bgmEl.setAttribute('playsinline', '');
      bgmEl.volume = MIX.ambient;
    } catch (_) {
      bgmEl = null;
    }
    return bgmEl;
  }

  /** Tear down synth bed only (leave file BGM alone). */
  function stopSynthAmbientImmediate() {
    if (ambientTimer) {
      clearInterval(ambientTimer);
      ambientTimer = null;
    }
    ambientCleanupFns.forEach(function (fn) { try { fn(); } catch (_) {} });
    ambientCleanupFns = [];
    ambientEventIndex = 0;
    ambientLoopEvents = [];
    if (ambientGain) {
      try {
        const c = activeCtx();
        if (c) ambientGain.gain.cancelScheduledValues(c.currentTime);
        ambientGain.disconnect();
      } catch (_) {}
      ambientGain = null;
    }
  }

  /** True when HTMLAudio BGM is already audible / claimed. */
  function fileBgmLive() {
    return ambientMode === 'file' ||
      !!(bgmEl && !bgmEl.paused && !bgmEl.ended && bgmEl.currentTime > 0);
  }

  /**
   * Prefer looping MP3; on missing/error call onFail (synth bed).
   * Never start synth while a file attempt is still pending, and never
   * leave synth plucks stacked on top of a successful file play (race
   * from startMenuMusic + dismissStartGate both calling startAmbient).
   */
  function startFileBgm(onFail) {
    const el = ensureBgmEl();
    if (!el) {
      ambientStartPending = false;
      if (!fileBgmLive() && !ambientRunning) onFail();
      return;
    }
    let settled = false;
    let softFallback = false;
    function invokeFail() {
      if (ambientRunning || fileBgmLive()) return;
      onFail();
    }
    function fail() {
      if (settled) return;
      settled = true;
      ambientStartPending = false;
      /* Another concurrent start may already own file BGM — do not synth. */
      invokeFail();
    }
    function softFailToSynth() {
      /* Keep canplay armed: late MP3 must still win and kill synth. */
      if (settled || softFallback) return;
      if (ambientRunning || fileBgmLive()) return;
      softFallback = true;
      ambientStartPending = false;
      invokeFail();
    }
    function playOk() {
      if (settled) return;
      settled = true;
      if (!channelOn('music')) {
        ambientStartPending = false;
        return;
      }
      try {
        /* File won — kill any synth that raced in from softFail / sibling. */
        if (ambientMode === 'synth' || ambientGain || ambientTimer) {
          stopSynthAmbientImmediate();
        }
        el.volume = MIX.ambient;
        const p = el.play();
        ambientRunning = true;
        ambientMode = 'file';
        ambientStartPending = false;
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            /* Only fall back if nothing else claimed ambient since play(). */
            if (ambientMode === 'file') {
              ambientRunning = false;
              ambientMode = null;
            }
            if (ambientRunning || fileBgmLive() || ambientStartPending) return;
            onFail();
          });
        }
      } catch (_) {
        ambientRunning = false;
        ambientMode = null;
        ambientStartPending = false;
        if (!fileBgmLive()) onFail();
      }
    }
    el.addEventListener('error', fail, { once: true });
    if (el.readyState >= 2) {
      playOk();
    } else {
      el.addEventListener('canplay', playOk, { once: true });
      try { el.load(); } catch (_) { fail(); return; }
      /* Slow MP3 must NOT hard-fail to synth (old 2.5s timeout stacked
         plucks on BGM when a concurrent startAmbient later succeeded).
         Soft fallback only after a long wait; canplay can still reclaim. */
      setTimeout(function () {
        if (settled) return;
        if (el.readyState >= 2) {
          playOk();
          return;
        }
        if (el.error || el.networkState === 3 /* NETWORK_NO_SOURCE */) {
          fail();
          return;
        }
        softFailToSynth();
      }, 8000);
    }
  }

  /*
   * Female Animalese — concatenative pulse+noise chirps ([Research](2b39ae2e)).
   * NOT continuous Klatt formants (robot). Hard onset per letter, ≤55ms,
   * one bandpass color, F0 hard-reset. Allyssa peppy ~620 Hz.
   */
  let talkSyllable = 0;
  let talkBaseF0 = 620;
  const TALK_PHRASE = [0, 1, 2, 1, 0, -1, 1, 2, 1, 0, -1, -2, 0, 1];
  const LETTER_VOWEL = {
    a: 'a', b: 'a', c: 'o', d: 'e', e: 'e', f: 'u', g: 'o', h: 'a',
    i: 'i', j: 'i', k: 'o', l: 'o', m: 'a', n: 'e', o: 'o', p: 'a',
    q: 'u', r: 'o', s: 'i', t: 'e', u: 'u', v: 'u', w: 'u', x: 'i',
    y: 'i', z: 'i'
  };
  /* One color peak per vowel (Hz) + Q — not 3 parallel formants; Q eased vs muddy BP */
  const COLOR = {
    a: { fc: 900, q: 2.6 },
    e: { fc: 1400, q: 3.0 },
    i: { fc: 2100, q: 3.2 },
    o: { fc: 700, q: 2.3 },
    u: { fc: 550, q: 2.2 }
  };

  /* ── Internal helpers ──────────────────────────────────── */

  /** Shared context if usable, otherwise null (public methods no-op on null). */
  function activeCtx() {
    if (!ctx || ctx.state === 'closed') return null;
    return ctx;
  }

  /**
   * Play a single enveloped oscillator (+ optional noise burst) with a
   * guaranteed zero-start gain ramp (no clicks), and auto-disconnect once done.
   * `opts.time` may override the start time for pre-scheduled notes.
   */
  function tone(opts) {
    const c = activeCtx();
    if (!c || muted) return;
    const ch = opts.channel || 'sfx';
    if (!channelOn(ch)) return;
    ensureBuses();

    const t0 = opts.time !== undefined ? opts.time : c.currentTime;
    const type = opts.type || 'triangle';
    const freq = opts.freq || 600;
    const peak = opts.gain != null ? opts.gain : 0.15;
    const attack = opts.attack || 0.003;
    const hold = opts.hold || 0.02;
    const release = opts.release || 0.015;
    const detune = opts.detune || 0;
    const isBlip = opts.tag === 'blip';

    if (isBlip && blipCount >= MAX_BLIP_NODES) return;

    /* oscillator */
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);

    /* optional filter */
    let filter = null;
    if (opts.filterType && opts.filterFreq) {
      filter = c.createBiquadFilter();
      filter.type = opts.filterType;
      filter.frequency.setValueAtTime(opts.filterFreq, t0);
      if (opts.filterQ) filter.Q.setValueAtTime(opts.filterQ, t0);
    }

    /* gain envelope — starts at 0, so it never clicks */
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
    g.gain.linearRampToValueAtTime(0, t0 + attack + hold + release);

    let dest = opts.destination ||
      (ch === 'dialogue' ? dialogueBus : ch === 'music' ? musicBus : sfxBus) ||
      c.destination;
    if (filter) {
      osc.connect(filter);
      filter.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(dest);

    const total = attack + hold + release + 0.05;
    osc.start(t0);
    osc.stop(t0 + total);

    /* optional filtered noise burst (achievement stamp) */
    let noiseSrc = null, noiseFlt = null, noiseG = null;
    if (opts.noiseGain > 0) {
      const dur = (opts.noiseHold || 0.01) + (opts.noiseRelease || release) + 0.05;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      noiseSrc = c.createBufferSource();
      noiseSrc.buffer = buf;
      noiseFlt = c.createBiquadFilter();
      noiseFlt.type = 'highpass';
      noiseFlt.frequency.setValueAtTime(500, t0);
      noiseG = c.createGain();
      noiseG.gain.setValueAtTime(0, t0);
      noiseG.gain.linearRampToValueAtTime(opts.noiseGain, t0 + attack);
      noiseG.gain.setValueAtTime(opts.noiseGain, t0 + attack + (opts.noiseHold || 0.01));
      noiseG.gain.linearRampToValueAtTime(0, t0 + attack + (opts.noiseHold || 0.01) + (opts.noiseRelease || release));

      noiseSrc.connect(noiseFlt);
      noiseFlt.connect(noiseG);
      noiseG.connect(dest);
      noiseSrc.start(t0);
      noiseSrc.stop(t0 + dur);
    }

    if (isBlip) blipCount++;

    const cleanup = function () {
      try { osc.disconnect(); } catch (_) {}
      try { g.disconnect(); } catch (_) {}
      if (filter) try { filter.disconnect(); } catch (_) {}
      if (noiseSrc) try { noiseSrc.disconnect(); } catch (_) {}
      if (noiseFlt) try { noiseFlt.disconnect(); } catch (_) {}
      if (noiseG) try { noiseG.disconnect(); } catch (_) {}
      if (isBlip) blipCount = Math.max(0, blipCount - 1);
    };
    osc.onended = cleanup;
  }

  /**
   * Schedule a standalone note with a plucky envelope and auto-disconnect.
   * Used for the two-note confirm/cancel and the fanfare arpeggio.
   */
  function pluckNote(freq, t0, peak, detune) {
    const c = activeCtx();
    if (!c || muted || !channelOn('sfx')) return;
    ensureBuses();

    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);

    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    g.gain.setValueAtTime(peak, t0 + 0.02);
    g.gain.linearRampToValueAtTime(peak * 0.2, t0 + 0.07);
    g.gain.linearRampToValueAtTime(0, t0 + 0.16);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(3200, freq * 3.2), t0);
    lp.Q.setValueAtTime(0.4, t0);

    osc.connect(g);
    g.connect(lp);
    lp.connect(sfxBus || c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
    osc.onended = function () {
      try { osc.disconnect(); } catch (_) {}
      try { g.disconnect(); } catch (_) {}
      try { lp.disconnect(); } catch (_) {}
    };
  }

  /* ── Public API ────────────────────────────────────────── */

  window.ACSound = {

    /**
     * Create and resume the AudioContext. MUST be called from inside a
     * user-gesture event handler. Idempotent and failure-tolerant.
     */
    init: function () {
      if (ctx && ctx.state !== 'closed') {
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        ensureBuses();
        return;
      }
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
        ensureBuses();
      } catch (e) {
        ctx = null;
      }
    },

    setMuted: function (val) {
      muted = !!val;
      applyBusMutes();
      if (ambientMode === 'file' && bgmEl) {
        try {
          if (muted || !channels.music) {
            bgmEl.pause();
          } else if (ambientRunning) {
            bgmEl.volume = MIX.ambient;
            bgmEl.play().catch(function () {});
          }
        } catch (_) {}
        return;
      }
      try {
        var c = activeCtx();
        if (!c || !ambientGain) return;
        ambientGain.gain.cancelScheduledValues(c.currentTime);
        if (muted || !channels.music) {
          ambientGain.gain.setValueAtTime(0, c.currentTime);
        } else if (ambientRunning) {
          ambientGain.gain.setValueAtTime(0, c.currentTime);
          ambientGain.gain.linearRampToValueAtTime(MIX.ambient, c.currentTime + 0.6);
        }
      } catch (_) {}
    },
    isMuted: function () { return muted; },

    setChannel: function (name, on) {
      if (!Object.prototype.hasOwnProperty.call(channels, name)) return;
      channels[name] = !!on;
      applyBusMutes();
      if (name === 'music') {
        if (!channels.music && ambientMode === 'file' && bgmEl) {
          try { bgmEl.pause(); } catch (_) {}
        } else if (channels.music && ambientRunning && ambientMode === 'file' && bgmEl && !muted) {
          try {
            bgmEl.volume = MIX.ambient;
            bgmEl.play().catch(function () {});
          } catch (_) {}
        }
      }
    },
    isChannelOn: function (name) {
      return Object.prototype.hasOwnProperty.call(channels, name) ? !!channels[name] : true;
    },
    getChannels: function () {
      return { music: !!channels.music, dialogue: !!channels.dialogue, sfx: !!channels.sfx };
    },

    /** True when ambient scheduler is live (for debug / unmute restart). */
    isAmbientRunning: function () { return !!ambientRunning; },

    /* ── UI sounds ─────────────────────────────────── */

    /**
     * blip() — Bebebese / UI tick only (menus, dry click).
     * NOT villager talk — keep dry and short.
     */
    blip: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      tone({
        type: 'triangle',
        freq: 720 + Math.random() * 80,
        gain: MIX.blip,
        attack: 0.002,
        hold: 0.012,
        release: 0.02,
        filterType: 'lowpass',
        filterFreq: 1600,
        filterQ: 0.5,
        tag: 'blip',
        channel: 'sfx'
      });
    },

    /**
     * talk(char?) — female Animalese letter chirp ([Research](2b39ae2e)).
     * Triangle+sine → one BP color → LP. Hard AD, ≤55ms, F0 hard-reset.
     * No continuous formants. Silence on punctuation.
     */
    talk: function (char) {
      if (!activeCtx() || !channelOn('dialogue')) return;
      if (blipCount >= MAX_BLIP_NODES) return;

      try {
        const c = ensureBuses() || activeCtx();
        if (!c) return;
        const raw = (char && String(char).length) ? String(char).charAt(0) : '';
        const ch = raw.toLowerCase();
        if (!ch || /[.,!?;:'"…\s]/.test(ch)) return;

        talkSyllable++;
        const phrase = TALK_PHRASE[talkSyllable % TALK_PHRASE.length];
        const jitter = (Math.random() - 0.5) * 2.8; /* ±1.4 st */
        const f0 = talkBaseF0 * Math.pow(2, (phrase + jitter) / 12);
        const fallCents = 40 + Math.random() * 50;
        const fEnd = f0 * Math.pow(2, -fallCents / 1200);

        let vowelKey = LETTER_VOWEL[ch] || 'a';
        if (/[aeiou]/.test(ch)) vowelKey = ch;
        const color = COLOR[vowelKey] || COLOR.a;
        const unvoiced = /[ptkfsc]/.test(ch);
        const voicedCons = /[bdgvzhmnlrwj]/.test(ch);
        const isVowel = /[aeiou]/.test(ch);

        let dur = 0.048 + Math.random() * 0.007;
        if (unvoiced) dur = Math.max(0.04, dur - 0.004);
        if (isVowel) dur = Math.min(0.055, dur + 0.004);

        let fc = color.fc * (unvoiced ? 1.05 : 1);
        if (raw !== ch) fc *= Math.pow(2, 80 / 1200); /* uppercase bump */

        const t0 = c.currentTime;
        const bodyDelay = unvoiced ? 0.008 : (voicedCons ? 0.004 : 0);
        blipCount++;
        /* Do NOT duck ambient — letter-rate ducks thump through opening talk. */

        const master = c.createGain();
        master.gain.setValueAtTime(0.0001, t0);
        master.gain.linearRampToValueAtTime(MIX.talk, t0 + 0.0025);
        master.gain.setValueAtTime(MIX.talk, t0 + Math.max(0.003, dur - 0.012));
        master.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        master.connect(dialogueBus || c.destination);

        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5000, t0);
        lp.Q.setValueAtTime(0.5, t0);
        lp.connect(master);

        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(fc, t0);
        bp.Q.setValueAtTime(color.q, t0);
        bp.connect(lp);

        const voiceStart = t0 + bodyDelay;
        const tri = c.createOscillator();
        tri.type = 'triangle';
        tri.frequency.setValueAtTime(f0, voiceStart);
        tri.frequency.linearRampToValueAtTime(fEnd, t0 + dur);

        const sine = c.createOscillator();
        sine.type = 'sine';
        sine.frequency.setValueAtTime(f0 * 2, voiceStart);
        sine.frequency.linearRampToValueAtTime(fEnd * 2, t0 + dur);

        const triG = c.createGain();
        triG.gain.value = 0.55;
        const sineG = c.createGain();
        sineG.gain.value = 0.18;

        tri.connect(triG);
        sine.connect(sineG);
        triG.connect(bp);
        sineG.connect(bp);

        let noiseSrc = null, noiseFlt = null, noiseG = null;
        const doNoise = unvoiced || (voicedCons && Math.random() < 0.4);
        if (doNoise) {
          const nDur = unvoiced ? (0.01 + Math.random() * 0.004) : (0.004 + Math.random() * 0.004);
          const buf = c.createBuffer(1, Math.ceil(c.sampleRate * nDur), c.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
          noiseSrc = c.createBufferSource();
          noiseSrc.buffer = buf;
          noiseFlt = c.createBiquadFilter();
          noiseFlt.type = 'highpass';
          noiseFlt.frequency.setValueAtTime(unvoiced ? 2200 + Math.random() * 1000 : 1400 + Math.random() * 400, t0);
          noiseG = c.createGain();
          noiseG.gain.setValueAtTime(0.0001, t0);
          noiseG.gain.linearRampToValueAtTime(unvoiced ? 0.048 : 0.028, t0 + 0.0015);
          noiseG.gain.linearRampToValueAtTime(0.0001, t0 + nDur);
          noiseSrc.connect(noiseFlt);
          noiseFlt.connect(noiseG);
          noiseG.connect(lp);
          noiseSrc.start(t0);
          noiseSrc.stop(t0 + nDur + 0.015);
        }

        tri.start(voiceStart);
        sine.start(voiceStart);
        tri.stop(t0 + dur + 0.02);
        sine.stop(t0 + dur + 0.02);

        tri.onended = function () {
          try { tri.disconnect(); } catch (_) {}
          try { sine.disconnect(); } catch (_) {}
          try { triG.disconnect(); } catch (_) {}
          try { sineG.disconnect(); } catch (_) {}
          try { bp.disconnect(); } catch (_) {}
          try { lp.disconnect(); } catch (_) {}
          try { master.disconnect(); } catch (_) {}
          if (noiseSrc) try { noiseSrc.disconnect(); } catch (_) {}
          if (noiseFlt) try { noiseFlt.disconnect(); } catch (_) {}
          if (noiseG) try { noiseG.disconnect(); } catch (_) {}
          blipCount = Math.max(0, blipCount - 1);
        };
      } catch (e) {
        blipCount = Math.max(0, blipCount - 1);
        try {
          tone({
            type: 'triangle',
            freq: 620 + Math.random() * 60,
            gain: MIX.talkFallback,
            channel: 'dialogue'
          });
        } catch (_) {}
      }
    },

    /** Reset talk phrase contour (call at start of a new dialogue line). */
    resetTalk: function () {
      talkSyllable = 0;
      talkBaseF0 = 605 + Math.random() * 30; /* 605–635 Hz, cute not shrill */
    },

    /** select() — soft UI click (menu / A press), NOT talk. */
    select: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      tone({
        type: 'sine',
        freq: 880,
        gain: MIX.select,
        attack: 0.004,
        hold: 0.01,
        release: 0.04,
        filterType: 'lowpass',
        filterFreq: 2400,
        filterQ: 0.4,
        channel: 'sfx'
      });
    },

    /** confirm() — soft two-note rise (C6 → E6), light not thumpy. */
    confirm: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(1046.5, now, MIX.confirmA);
      pluckNote(1318.51, now + 0.08, MIX.confirmB);
    },

    /** cancel() — gentle two-note fall (E6 → C#6). */
    cancel: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(1318.51, now, MIX.cancelA);
      pluckNote(1108.73, now + 0.08, MIX.cancelB);
    },

    /**
     * stamp() — soft paper-stamp pop (NOT a bass thunk).
     * Mid triangle + tiny noise; no sub-100Hz thud.
     */
    stamp: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      tone({
        type: 'triangle',
        freq: 420,
        gain: MIX.stampLow,
        attack: 0.003,
        hold: 0.028,
        release: 0.08,
        filterType: 'lowpass',
        filterFreq: 1400,
        filterQ: 0.5,
        channel: 'sfx'
      });
      tone({
        type: 'sine',
        freq: 680,
        gain: MIX.stampHi,
        attack: 0.002,
        hold: 0.012,
        release: 0.05,
        channel: 'sfx'
      });
      tone({
        type: 'triangle',
        freq: 900,
        gain: MIX.stampNoise * 0.4,
        attack: 0.001,
        hold: 0.008,
        release: 0.03,
        noiseGain: MIX.stampNoise,
        noiseHold: 0.012,
        noiseRelease: 0.03,
        filterType: 'highpass',
        filterFreq: 1200,
        filterQ: 0.4,
        channel: 'sfx'
      });
    },

    /** fanfare() — celebratory 5-note major sparkle (lighter, higher). */
    fanfare: function () {
      if (!activeCtx() || !channelOn('sfx')) return;
      const notes = [659.25, 783.99, 987.77, 1174.66, 1318.51];
      const step = 0.07;
      const c = activeCtx();
      const now = c.currentTime;
      for (let i = 0; i < notes.length; i++) {
        pluckNote(notes[i], now + i * step, MIX.fanfare * (1 - i * 0.08), (Math.random() - 0.5) * 4);
      }
    },

    /* ── Ambient loop ───────────────────────────────── */

    /**
     * startAmbient() — loop assets/bgm.mp3 when present; else cozy synth bed.
     * Synth: Slow I–vi–IV–V (Cmaj7 → Am7 → Fmaj7 → G7) at ~64 BPM with warm
     * sine/triangle chorus pads, gentle LP, chalky breeze, and sparse
     * pentatonic pluck phrases. No drums, low volume, infinite and seam-free.
     */
    startAmbient: function () {
      if (!channelOn('music')) return;
      /* Guard re-entry while MP3 is still loading — second call from
         dismissStartGate must not open a parallel startFileBgm/onFail. */
      if (ambientRunning || ambientStartPending) return;
      if (fileBgmLive()) {
        ambientRunning = true;
        ambientMode = 'file';
        return;
      }

      const self = this;
      ensureBuses();
      ambientStartPending = true;
      startFileBgm(function () {
        if (ambientRunning || fileBgmLive() || ambientStartPending) return;
        self._startSynthAmbient();
      });
    },

    /** Internal: generated Web Audio bed (used when bgm.mp3 missing). */
    _startSynthAmbient: function () {
      if (!activeCtx() || !channelOn('music')) return;
      if (ambientRunning || ambientStartPending || fileBgmLive()) return;

      const c = ensureBuses() || activeCtx();
      /* Ensure context is running — suspended ctx schedules silence */
      if (c.state === 'suspended') {
        c.resume().catch(function () {});
      }
      const now = c.currentTime;
      ambientMode = 'synth';
      ambientStartPending = false;

      /* master bed gain — silent start, fade in over ~1.5s */
      ambientGain = c.createGain();
      ambientGain.gain.setValueAtTime(0, now);
      ambientGain.gain.linearRampToValueAtTime(MIX.ambient, now + 1.5);
      ambientGain.connect(musicBus || c.destination);

      /* --- build the one-loop timeline ----------------------- */
      const BPM = 64;
      const beat = 60 / BPM;              // ~0.9375s
      const chordDur = beat * 8;          // 2 bars per chord ≈ 7.5s
      const LOOP = chordDur * 4;          // I–vi–IV–V ≈ 30s

      /* C-major pentatonic note pool (frequencies, Hz) */
      const P = {
        C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00,
        C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00
      };

      /* I–vi–IV–V pads: Cmaj7, Am7, Fmaj7, G7 */
      const chords = [
        { at: 0,             freqs: [130.81, 164.81, 196.00, 246.94] },  // Cmaj7
        { at: chordDur,      freqs: [110.00, 130.81, 164.81, 196.00] },  // Am7
        { at: chordDur * 2,  freqs: [87.31, 110.00, 130.81, 164.81] },   // Fmaj7
        { at: chordDur * 3,  freqs: [98.00, 123.47, 146.83, 174.61] }    // G7
      ];

      /* sparse pentatonic phrases — rests between motifs, not busy arpeggios */
      const melody = [
        [chordDur * 0 + 2.1,  P.E5],
        [chordDur * 0 + 4.8,  P.G4],
        [chordDur * 1 + 2.4,  P.C5],
        [chordDur * 1 + 5.6,  P.A4],
        [chordDur * 2 + 3.0,  P.A4],
        [chordDur * 2 + 6.2,  P.D5],
        [chordDur * 3 + 2.0,  P.G4],
        [chordDur * 3 + 4.5,  P.C5],
        [chordDur * 3 + 6.8,  P.E5]
      ];

      ambientLoopEvents = [{ kind: 'breeze', offset: 0, duration: LOOP }];
      chords.forEach(function (ch) {
        ambientLoopEvents.push({ kind: 'chord', offset: ch.at, freqs: ch.freqs });
      });
      melody.forEach(function (m) {
        ambientLoopEvents.push({ kind: 'pluck', offset: m[0], freq: m[1] });
      });
      ambientLoopEvents.sort(function (a, b) { return a.offset - b.offset; });

      ambientLoopDuration = LOOP;
      ambientLoopStart = now;
      ambientEventIndex = 0;
      ambientCleanupFns = [];

      /* --- scheduling helpers ------------------------------- */

      /* absolute time of a loop event given its monotonic event number */
      function eventTime(i) {
        const n = ambientLoopEvents.length;
        const loop = Math.floor(i / n);
        const idx = i % n;
        return ambientLoopStart + loop * LOOP + ambientLoopEvents[idx].offset;
      }

      function scheduleWarmPad(freqs, t0) {
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;

        const attack = 2.0;
        const release = 2.8;
        const sustainUntil = t0 + chordDur + 0.6;
        const end = sustainUntil + release + 0.15;

        const lp = cNow.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(820, t0);
        lp.frequency.linearRampToValueAtTime(980, t0 + chordDur * 0.45);
        lp.frequency.linearRampToValueAtTime(860, t0 + chordDur);
        lp.Q.setValueAtTime(0.35, t0);
        lp.connect(ambientGain);

        const voices = [];
        freqs.forEach(function (freq) {
          [
            { type: 'sine', detune: -5, gain: 0.028 },
            { type: 'triangle', detune: 4, gain: 0.018 },
            { type: 'sine', detune: 7, gain: 0.012 }
          ].forEach(function (v) {
            const osc = cNow.createOscillator();
            osc.type = v.type;
            osc.frequency.setValueAtTime(freq, t0);
            osc.detune.setValueAtTime(v.detune + (Math.random() - 0.5) * 3, t0);

            const g = cNow.createGain();
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(v.gain, t0 + attack);
            g.gain.setValueAtTime(v.gain, sustainUntil);
            g.gain.linearRampToValueAtTime(0, sustainUntil + release);

            osc.connect(g);
            g.connect(lp);
            osc.start(t0);
            osc.stop(end);
            voices.push({ osc: osc, g: g });
          });
        });

        const cleanup = function () {
          voices.forEach(function (v) {
            try { v.osc.disconnect(); } catch (_) {}
            try { v.g.disconnect(); } catch (_) {}
          });
          try { lp.disconnect(); } catch (_) {}
        };
        voices[0].osc.onended = cleanup;
        ambientCleanupFns.push(cleanup);
      }

      function scheduleBreeze(t0, duration) {
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;

        const fadeIn = 3.0;
        const fadeOut = 3.0;
        const holdEnd = t0 + duration - fadeOut;
        const end = t0 + duration + 0.1;

        const bufLen = Math.ceil(cNow.sampleRate * duration);
        const buf = cNow.createBuffer(1, bufLen, cNow.sampleRate);
        const data = buf.getChannelData(0);
        let prev = 0;
        for (let i = 0; i < data.length; i++) {
          const white = Math.random() * 2 - 1;
          prev = prev * 0.985 + white * 0.015;
          data[i] = prev;
        }

        const src = cNow.createBufferSource();
        src.buffer = buf;
        src.loop = false;

        const hp = cNow.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(380, t0);
        hp.Q.setValueAtTime(0.4, t0);

        const lp = cNow.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, t0);
        lp.frequency.linearRampToValueAtTime(1800, t0 + duration * 0.5);
        lp.frequency.linearRampToValueAtTime(2200, t0 + duration);
        lp.Q.setValueAtTime(0.3, t0);

        const g = cNow.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.014, t0 + fadeIn);
        g.gain.setValueAtTime(0.014, holdEnd);
        g.gain.linearRampToValueAtTime(0, holdEnd + fadeOut);

        src.connect(hp);
        hp.connect(lp);
        lp.connect(g);
        g.connect(ambientGain);
        src.start(t0);
        src.stop(end);

        const cleanup = function () {
          try { src.disconnect(); } catch (_) {}
          try { hp.disconnect(); } catch (_) {}
          try { lp.disconnect(); } catch (_) {}
          try { g.disconnect(); } catch (_) {}
        };
        src.onended = cleanup;
        ambientCleanupFns.push(cleanup);
      }

      function schedulePluck(freq, t0) {
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;

        const peak = 0.075;
        const osc = cNow.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 6, t0);

        const sine = cNow.createOscillator();
        sine.type = 'sine';
        sine.frequency.setValueAtTime(freq * 2, t0);
        sine.detune.setValueAtTime((Math.random() - 0.5) * 4, t0);

        const lp = cNow.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2200, t0);
        lp.frequency.exponentialRampToValueAtTime(900, t0 + 0.55);
        lp.Q.setValueAtTime(0.5, t0);

        const g = cNow.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
        g.gain.setValueAtTime(peak, t0 + 0.04);
        g.gain.linearRampToValueAtTime(peak * 0.18, t0 + 0.14);
        g.gain.setValueAtTime(peak * 0.18, t0 + 0.55);
        g.gain.linearRampToValueAtTime(0, t0 + 1.15);

        const sineG = cNow.createGain();
        sineG.gain.value = 0.22;

        osc.connect(g);
        sine.connect(sineG);
        sineG.connect(g);
        g.connect(lp);
        lp.connect(ambientGain);
        osc.start(t0);
        sine.start(t0);
        osc.stop(t0 + 1.25);
        sine.stop(t0 + 1.25);

        const cleanup = function () {
          try { osc.disconnect(); } catch (_) {}
          try { sine.disconnect(); } catch (_) {}
          try { sineG.disconnect(); } catch (_) {}
          try { g.disconnect(); } catch (_) {}
          try { lp.disconnect(); } catch (_) {}
        };
        osc.onended = cleanup;
        ambientCleanupFns.push(cleanup);
      }

      function dispatch(ev, t0) {
        if (ev.kind === 'chord') scheduleWarmPad(ev.freqs, t0);
        else if (ev.kind === 'breeze') scheduleBreeze(t0, ev.duration);
        else schedulePluck(ev.freq, t0);
      }

      /* --- the lookahead scheduler -------------------------- */
      function scheduleAhead() {
        if (!ambientRunning) return;
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;

        const horizon = cNow.currentTime + AMBIENT_LOOKAHEAD;
        let guard = 0;
        while (guard++ < 4000 && ambientEventIndex < 1e9) {
          const t = eventTime(ambientEventIndex);
          if (t >= horizon) break;
          try {
            dispatch(ambientLoopEvents[ambientEventIndex % ambientLoopEvents.length], t);
          } catch (_) {
            /* Skip a bad event so one failure cannot kill the bed */
          }
          ambientEventIndex++;
        }
      }

      ambientRunning = true;
      scheduleAhead();
      ambientTimer = setInterval(scheduleAhead, AMBIENT_INTERVAL_MS);
    },

    /**
     * stopAmbient() — fade out and stop the ambient loop, disconnecting all
     * scheduled nodes so nothing leaks.
     */
    stopAmbient: function () {
      ambientStartPending = false;
      if (ambientMode === 'file' || bgmEl) {
        ambientRunning = false;
        ambientMode = null;
        if (bgmDuckTimer) {
          clearTimeout(bgmDuckTimer);
          bgmDuckTimer = null;
        }
        if (bgmEl) {
          try {
            bgmEl.pause();
            bgmEl.currentTime = 0;
          } catch (_) {}
        }
        /* If synth was never started, done. If both somehow live, fall through. */
        if (!ambientGain && !ambientTimer) return;
      }

      if (!ambientRunning && !ambientGain) return;

      ambientRunning = false;
      ambientMode = null;

      if (ambientTimer) {
        clearInterval(ambientTimer);
        ambientTimer = null;
      }

      const c = activeCtx();
      const g = ambientGain;          // capture local, so a fast restart can't race us
      ambientGain = null;
      if (g && c) {
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.8);
        setTimeout(function () { try { g.disconnect(); } catch (_) {} }, 900);
      }

      ambientCleanupFns.forEach(function (fn) { try { fn(); } catch (_) {} });
      ambientCleanupFns = [];
      ambientEventIndex = 0;
      ambientLoopEvents = [];
    }
  };

})();

/* ============================================================
   USAGE
   ============================================================

   Link it after config.js:
     <script src="assets/config.js"></script>
     <script src="assets/audio.js"></script>

   First user gesture (e.g. "Press Ⓐ to start"):
     startBtn.addEventListener('click', function () {
       ACSound.init();
       ACSound.setMuted(window.AC_CONFIG.audio.enabled === false);
       ACSound.startAmbient();
     });

   Typewriter (one tick per character):
     text.split('').forEach(function (ch, i) {
       setTimeout(function () { el.textContent += ch; ACSound.talk(ch); }, i * 55);
     });

   UI feedback:
     ACSound.select();      // soft click
     ACSound.confirm();     // happy confirm (advance dialog)
     ACSound.cancel();      // gentle cancel (back out)
     ACSound.stamp();       // achievement unlocked!
     ACSound.fanfare();     // big reveal (section 6!)
     ACSound.startAmbient();// cozy background bed
     ACSound.stopAmbient(); // stop the bed

   ============================================================ */

/* SELF-TEST (uncomment to run in a browser console after a gesture):

(function runTest() {
  if (!window.ACSound) { console.error('ACSound missing'); return; }
  ACSound.init();
  ACSound.setMuted(false);
  var seq = [0, 40, 200, 500, 1200, 1800, 2500, 3500, 14000];
  setTimeout(function () { ACSound.blip(); }, seq[0]);
  setTimeout(function () { ACSound.blip(); ACSound.blip(); }, seq[1]);
  setTimeout(function () { ACSound.select(); }, seq[2]);
  setTimeout(function () { ACSound.confirm(); }, seq[3]);
  setTimeout(function () { ACSound.cancel(); }, seq[4]);
  setTimeout(function () { ACSound.stamp(); }, seq[5]);
  setTimeout(function () { ACSound.fanfare(); }, seq[6]);
  setTimeout(function () { ACSound.startAmbient(); }, seq[7]);
  setTimeout(function () { ACSound.stopAmbient(); }, seq[8]);
  setTimeout(function () { console.log('ACSound self-test done.'); }, 16000);
})();

*/