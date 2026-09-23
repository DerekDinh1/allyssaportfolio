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
 *   ACSound.blip()         — per-character typewriter tick (~25-35ms)
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

    setMuted: function (val) { muted = !!val; },
    isMuted: function () { return muted; },

    /* ── UI sounds ─────────────────────────────────── */

    /**
     * blip() — one typewriter tick, ~25-35ms, triangle through a bandpass
     * around 900–1400Hz with small random pitch variance. Gain ~0.05.
     * Extremely cheap and never clicks thanks to the zero-start ramp.
     */
    blip: function () {
      if (!activeCtx() || muted) return;
      if (blipCount >= MAX_BLIP_NODES) return;

      const f = 950 + Math.random() * 450;          // 950–1400 Hz
      tone({
        type: 'triangle',
        freq: f,
        gain: 0.05,
        attack: 0.0015,
        hold: 0.016 + Math.random() * 0.012,        // 16–28 ms body
        release: 0.008 + Math.random() * 0.007,     // 8–15 ms tail
        detune: (Math.random() - 0.5) * 80,         // ±40 cents
        filterType: 'bandpass',
        filterFreq: f,
        filterQ: 2.6,
        tag: 'blip'
      });
    },

    /** select() — soft UI click, triangle around 600Hz, ~40ms, fast decay. */
    select: function () {
      if (!activeCtx() || muted) return;
      tone({ type: 'triangle', freq: 600, gain: 0.1, attack: 0.002, hold: 0.018, release: 0.022 });
    },

    /** confirm() — happy two-note rise, a major third apart (C5 → E5). */
    confirm: function () {
      if (!activeCtx() || muted) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(523.25, now, 0.16);          // C5
      pluckNote(659.25, now + 0.09, 0.18);   // E5
    },

    /** cancel() — gentle two-note fall, a minor third down (E5 → C#5). */
    cancel: function () {
      if (!activeCtx() || muted) return;
      const c = activeCtx();
      const now = c.currentTime;
      pluckNote(659.25, now, 0.14);          // E5
      pluckNote(554.37, now + 0.09, 0.13);   // C#5
    },

    /** stamp() — low sine thump + a short filtered noise burst. */
    stamp: function () {
      if (!activeCtx() || muted) return;
      tone({ type: 'sine', freq: 120, gain: 0.26, attack: 0.002, hold: 0.06, release: 0.09 });
      tone({
        type: 'triangle', freq: 300, gain: 0.05, attack: 0.001, hold: 0.012, release: 0.04,
        noiseGain: 0.12, noiseHold: 0.025, noiseRelease: 0.05
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
        pluckNote(notes[i], now + i * step, 0.18, (Math.random() - 0.5) * 6);
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
      ambientGain.gain.linearRampToValueAtTime(0.12, now + 1.5);
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
        const peak = 0.05;
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
        const peak = 0.15;

        const osc = cNow.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
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
       setTimeout(function () { el.textContent += ch; ACSound.blip(); }, i * 35);
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