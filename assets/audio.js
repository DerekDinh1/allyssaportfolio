/**
 * ACSound — ACNH-flavored synthesized sound kit
 * ==============================================
 * ALL audio is synthesized at runtime through the Web Audio API.
 * No audio files are loaded — everything is built from oscillators and noise.
 * Nothing here reproduces an existing melody; it is original, generated
 * material that only *feels* like Animal Crossing.
 *
 * IMPORTANT: Browsers block AudioContext construction until a user gesture
 * (click / tap / keypress). You MUST call ACSound.init() from inside a real
 * user-event handler before any sound will play. This doubles as the
 * authentic ACNH "Press Ⓐ to start" gate.
 *
 * API:
 *   ACSound.init()         — create & resume AudioContext (call on first gesture)
 *   ACSound.setMuted(bool)
 *   ACSound.isMuted()      — boolean
 *   ACSound.blip()         — dry Bebebese / UI tick (menus)
 *   ACSound.talk(char?)    — female Animalese pulse+noise letter chirp
 *   ACSound.resetTalk()    — reset phrase contour for a new line
 *   ACSound.select()       — soft UI click (~40ms, 600Hz)
 *   ACSound.confirm()      — happy two-note rise (major third)
 *   ACSound.cancel()       — gentle two-note fall (minor third down)
 *   ACSound.stamp()        — satisfying achievement thunk
 *   ACSound.fanfare()      — short celebratory 6-note major arpeggio
 *   ACSound.startAmbient() — begin a seamless ambient loop
 *   ACSound.stopAmbient()  — fade out and stop the ambient loop
 *
 * Safety: every public method is safe to call before init() — it silently
 * no-ops. If AudioContext construction fails, the whole API degrades to
 * silent no-ops so the site never breaks without audio support.
 *
 * Owner: creative audio engineer.
 */

(function () {
  'use strict';

  /* ── Module state ──────────────────────────────────────── */
  let ctx = null;            // AudioContext (created lazily in init())
  let muted = false;

  /* ambient-loop state */
  let ambientRunning = false;
  let ambientGain = null;        // master GainNode for the ambient bed
  let ambientTimer = null;       // scheduler interval id
  let ambientCleanupFns = [];    // registered disconnect callbacks
  let ambientLoopStart = 0;      // absolute ctx time of loop "phase zero"
  let ambientEventIndex = 0;     // monotonically rising event cursor
  let ambientLoopEvents = [];    // pre-computed one-loop timeline
  let ambientLoopDuration = 0;   // seconds per loop

  const AMBIENT_LOOKAHEAD = 0.25;   // schedule this far ahead (s)
  const AMBIENT_INTERVAL_MS = 100;  // scheduler tick

  /* polyphony cap so rapid blip() calls cannot spawn runaway nodes */
  const MAX_BLIP_NODES = 16;
  let blipCount = 0;

  /* Shared loudness — SFX / talk / ambient stay in one family */
  const MIX = {
    ambient: 0.085,
    talk: 0.155,
    blip: 0.055,
    select: 0.075,
    confirmA: 0.12,
    confirmB: 0.13,
    cancelA: 0.11,
    cancelB: 0.10,
    stampLow: 0.16,
    stampHi: 0.04,
    stampNoise: 0.07,
    fanfare: 0.13,
    talkFallback: 0.11
  };

  function duckAmbientBrief() {
    if (!ambientGain || muted || !ambientRunning) return;
    try {
      const c = activeCtx();
      if (!c) return;
      const t = c.currentTime;
      const g = ambientGain.gain;
      g.cancelScheduledValues(t);
      const cur = Math.max(0.0001, g.value || MIX.ambient);
      g.setValueAtTime(cur, t);
      g.linearRampToValueAtTime(MIX.ambient * 0.35, t + 0.02);
      g.linearRampToValueAtTime(MIX.ambient, t + 0.28);
    } catch (_) {}
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

    let dest = opts.destination || c.destination;
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
    if (!c || muted) return;

    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);

    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.setValueAtTime(peak, t0 + 0.03);
    g.gain.linearRampToValueAtTime(peak * 0.25, t0 + 0.08);
    g.gain.setValueAtTime(peak * 0.25, t0 + 0.11);
    g.gain.linearRampToValueAtTime(0, t0 + 0.2);

    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + 0.25);
    osc.onended = function () {
      try { osc.disconnect(); } catch (_) {}
      try { g.disconnect(); } catch (_) {}
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
        return;
      }
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ctx = new AudioCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
      } catch (e) {
        ctx = null;
      }
    },

    setMuted: function (val) {
      muted = !!val;
      /* Hard-silence ambient bed immediately so mute isn't a slow fade-only feel */
      if (muted && ambientGain) {
        try {
          var c = activeCtx();
          if (c) {
            ambientGain.gain.cancelScheduledValues(c.currentTime);
            ambientGain.gain.setValueAtTime(0, c.currentTime);
          }
        } catch (_) {}
      }
    },
    isMuted: function () { return muted; },

    /* ── UI sounds ─────────────────────────────────── */

    /**
     * blip() — Bebebese / UI tick only (menus, dry click).
     * NOT villager talk — keep dry and short.
     */
    blip: function () {
      if (!activeCtx() || muted) return;
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
        tag: 'blip'
      });
    },

    /**
     * talk(char?) — female Animalese letter chirp ([Research](2b39ae2e)).
     * Triangle+sine → one BP color → LP. Hard AD, ≤55ms, F0 hard-reset.
     * No continuous formants. Silence on punctuation.
     */
    talk: function (char) {
      if (!activeCtx() || muted) return;
      if (blipCount >= MAX_BLIP_NODES) return;

      try {
        const c = activeCtx();
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
        duckAmbientBrief();

        const master = c.createGain();
        master.gain.setValueAtTime(0.0001, t0);
        master.gain.linearRampToValueAtTime(MIX.talk, t0 + 0.0025);
        master.gain.setValueAtTime(MIX.talk, t0 + Math.max(0.003, dur - 0.012));
        master.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        master.connect(c.destination);

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
      if (!activeCtx() || muted) return;
      tone({
        type: 'triangle',
        freq: 680,
        gain: MIX.select,
        attack: 0.002,
        hold: 0.014,
        release: 0.028,
        filterType: 'lowpass',
        filterFreq: 1800,
        filterQ: 0.6
      });
    },

    /** confirm() — happy two-note rise, a major third apart (C5 → E5). */
    confirm: function () {
      if (!activeCtx() || muted) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(523.25, now, MIX.confirmA);
      pluckNote(659.25, now + 0.09, MIX.confirmB);
    },

    /** cancel() — gentle two-note fall, a minor third down (E5 → C#5). */
    cancel: function () {
      if (!activeCtx() || muted) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(659.25, now, MIX.cancelA);
      pluckNote(554.37, now + 0.09, MIX.cancelB);
    },

    /** stamp() — low sine thump + a short filtered noise burst. */
    stamp: function () {
      if (!activeCtx() || muted) return;
      tone({ type: 'sine', freq: 120, gain: MIX.stampLow, attack: 0.002, hold: 0.06, release: 0.09 });
      tone({
        type: 'triangle', freq: 300, gain: MIX.stampHi, attack: 0.001, hold: 0.012, release: 0.04,
        noiseGain: MIX.stampNoise, noiseHold: 0.025, noiseRelease: 0.05
      });
    },

    /** fanfare() — celebratory 6-note major arpeggio (C E G C E G), plucky. */
    fanfare: function () {
      if (!activeCtx() || muted) return;
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
      const step = 0.09;
      const c = activeCtx();
      const now = c.currentTime;
      for (let i = 0; i < notes.length; i++) {
        pluckNote(notes[i], now + i * step, MIX.fanfare, (Math.random() - 0.5) * 6);
      }
    },

    /* ── Ambient loop ───────────────────────────────── */

    /**
     * startAmbient() — begin a seamless, cozy ambient bed.
     * A slow diatonic C-major progression (Cmaj7 → Am7 → Fmaj7 → G7) as soft
     * sine pads, overlaid with a sparse plucked melody drawn from the C major
     * pentatonic scale. No drums, low volume, infinite and seam-free.
     */
    startAmbient: function () {
      if (!activeCtx() || muted) return;
      if (ambientRunning) return;

      const c = activeCtx();
      const now = c.currentTime;

      /* master bed gain — silent start, fade in over ~1.5s */
      ambientGain = c.createGain();
      ambientGain.gain.setValueAtTime(0, now);
      ambientGain.gain.linearRampToValueAtTime(MIX.ambient, now + 1.5);
      ambientGain.connect(c.destination);

      /* --- build the one-loop timeline ----------------------- */
      const beat = 60 / 72;                 // ~0.833s at 72 BPM
      const chordDur = beat * 4;            // one bar ≈ 3.333s
      const LOOP = chordDur * 4;            // four bars ≈ 13.333s

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

      /* sparse plucked melody: [offset-in-loop, frequency] */
      const melody = [
        [0.42, P.E5], [1.25, P.C5], [2.08, P.D5], [2.92, P.G4],
        [3.75, P.A4], [4.58, P.C5], [5.42, P.E5], [6.26, P.C5],
        [7.10, P.E5], [7.94, P.D5], [8.78, P.C5], [9.62, P.A4],
        [10.46, P.G4], [11.30, P.A4], [12.14, P.D5], [12.92, P.C5]
      ];

      ambientLoopEvents = [];
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

      function scheduleChord(freqs, t0) {
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;
        const peak = 0.032;
        const attack = 0.8;
        const release = 1.2;
        const sustainUntil = t0 + chordDur;

        freqs.forEach(function (freq) {
          const osc = cNow.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          osc.detune.setValueAtTime((Math.random() - 0.5) * 10, t0);

          const g = cNow.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(peak, t0 + attack);
          g.gain.setValueAtTime(peak, sustainUntil);
          g.gain.linearRampToValueAtTime(0, sustainUntil + release);

          osc.connect(g);
          g.connect(ambientGain);
          osc.start(t0);
          osc.stop(sustainUntil + release + 0.1);

          const cleanup = function () {
            try { osc.disconnect(); } catch (_) {}
            try { g.disconnect(); } catch (_) {}
          };
          osc.onended = cleanup;
          ambientCleanupFns.push(cleanup);
        });
      }

      function schedulePluck(freq, t0) {
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;
        const peak = 0.065;
        osc.detune.setValueAtTime((Math.random() - 0.5) * 8, t0);

        const g = cNow.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
        g.gain.setValueAtTime(peak, t0 + 0.03);
        g.gain.linearRampToValueAtTime(peak * 0.22, t0 + 0.11);
        g.gain.setValueAtTime(peak * 0.22, t0 + 0.4);
        g.gain.linearRampToValueAtTime(0, t0 + 0.9);

        osc.connect(g);
        g.connect(ambientGain);
        osc.start(t0);
        osc.stop(t0 + 1.0);

        const cleanup = function () {
          try { osc.disconnect(); } catch (_) {}
          try { g.disconnect(); } catch (_) {}
        };
        osc.onended = cleanup;
        ambientCleanupFns.push(cleanup);
      }

      function dispatch(ev, t0) {
        if (ev.kind === 'chord') scheduleChord(ev.freqs, t0);
        else schedulePluck(ev.freq, t0);
      }

      /* --- the lookahead scheduler -------------------------- */
      function scheduleAhead() {
        if (!ambientRunning) return;
        const cNow = activeCtx();
        if (!cNow || !ambientGain) return;

        const horizon = cNow.currentTime + AMBIENT_LOOKAHEAD;
        /* guard against pathological runaway: never schedule > 2s ahead */
        let guard = 0;
        while (guard++ < 4000 && ambientEventIndex < 1e9) {
          const t = eventTime(ambientEventIndex);
          if (t >= horizon) break;
          dispatch(ambientLoopEvents[ambientEventIndex % ambientLoopEvents.length], t);
          ambientEventIndex++;
        }
      }

      ambientRunning = true;
      scheduleAhead();                       // prime the first events
      ambientTimer = setInterval(scheduleAhead, AMBIENT_INTERVAL_MS);
    },

    /**
     * stopAmbient() — fade out and stop the ambient loop, disconnecting all
     * scheduled nodes so nothing leaks.
     */
    stopAmbient: function () {
      if (!ambientRunning && !ambientGain) return;

      ambientRunning = false;

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