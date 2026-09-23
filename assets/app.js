/**
 * assets/app.js — Allyssa Portfolio production behaviour layer
 * =================================================================
 * OWNER: shell worker (this file only — do not edit other files)
 *
 * Architecture (load order in index.html):
 *   1. tokens.css, base.css, site.css, section CSS files
 *   2. audio.js           → window.ACSound
 *   3. content.js          → window.ACContent
 *   4. Section modules     → ACSections.{opening,daily,stats,gallery,reveal}
 *   5. THIS FILE (last)    → boots, wires start gate, keyboard nav,
 *                              scroll reveals, reveal chain, counters
 *
 * Rules:
 *   - All ACSound calls are guard-wrapped so a missing window.ACSound
 *     never throws.
 *   - localStorage access is try/catch guarded for privacy modes.
 *   - prefers-reduced-motion is honoured everywhere.
 *   - No inline event-handler attributes; everything is addEventListener.
 *   - Defensive against missing/empty/null JSON keys.
 *   - Relative paths only.
 */

(function () {
  'use strict';

  /* ================================================================
     CONSTANTS
     ================================================================ */

  var SECTION_IDS = ['opening', 'daily', 'stats', 'gallery', 'reveal'];
  var TOTAL_SECTIONS = SECTION_IDS.length;
  /* Content scenes shown in presentation nav (surprise is a popup, not a slide). */
  var CONTENT_SCENES = 4;
  var CLOCK_INTERVAL_MS = 10000;   // update live clock every 10 s
  var SAVING_HOLD_MS = 5000;       // Saving... stays fully visible
  var SAVING_FADE_MS = 3400;       // then slow fade out
  var SAVING_HOLD_REDUCED_MS = 900;
  var SAVING_FADE_REDUCED_MS = 400;

  /* cached DOM lookups populated during boot */
  var dom = {};

  /* runtime state */
  var state = {
    currentScene: 0,               // 0-based index into SECTION_IDS
    presentationActive: false,     // true once start gate dismissed
    muted: false,
    clockTimer: null,
    reducedMotion: false,
    startGateDismissed: false,
    surpriseOpen: false,           // true while surprise modal is up
    savingHoldUntil: 0,            // timestamp; beat 2 waits until this
    surpriseStep: 0                // 0=idle, 1..5 = current surprise beat
  };

  /* ================================================================
     HELPERS
     ================================================================ */

  /** Safe querySelector on a given root. */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /** Safe querySelectorAll. */
  function $$(sel, root) {
    return (root || document).querySelectorAll(sel);
  }

  /** Guarded ACSound call. Never throws. */
  function sound(method) {
    try {
      if (window.ACSound && typeof window.ACSound[method] === 'function') {
        window.ACSound[method]();
      }
    } catch (e) { /* audio is best-effort */ }
  }

  /** Guarded localStorage read. Returns defaultValue on any failure. */
  function storageGet(key, defaultValue) {
    try {
      var v = localStorage.getItem('ac-' + key);
      return v === null ? defaultValue : v;
    } catch (e) {
      return defaultValue;
    }
  }

  /** Guarded localStorage write. */
  function storageSet(key, value) {
    try {
      localStorage.setItem('ac-' + key, value);
    } catch (e) { /* privacy mode, quota, etc. */ }
  }

  /** True on touch-primary devices (used to avoid scroll hijack). */
  function isTouchPrimary() {
    return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0));
  }

  /**
   * Ordinal suffix for day numbers.
   * 1→st, 2→nd, 3→rd, 4→th, 11→th, 12→th, 13→th, 21→st, etc.
   */
  function ordinal(n) {
    var m = n % 100;
    if (m >= 11 && m <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  /**
   * Build the live date / time stamp from new Date().
   * Returns { time: '9:14 PM', weekday: 'Tuesday', date: 'September 22nd' }
   */
  function liveStamp(d) {
    var AC = window.ACContent;
    if (!AC || typeof AC.liveStamp !== 'function') {
      /* manual fallback if content.js is missing */
      var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
      var h = d.getHours();
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12 || 12;
      var mins = d.getMinutes();
      var dayOrdinal = d.getDate();
      return {
        time: h12 + ':' + (mins < 10 ? '0' : '') + mins + ' ' + ampm,
        weekday: days[d.getDay()],
        date: months[d.getMonth()] + ' ' + dayOrdinal + ordinal(dayOrdinal)
      };
    }
    return AC.liveStamp(d);
  }

  /* ================================================================
     LIVE CLOCK (opening section)
     ================================================================ */

  function updateClock() {
    var now = new Date();
    var stamp = liveStamp(now);
    /* Opening announcement uses .live-time, .live-weekday, .live-date
       (or a combined .live-date that already includes weekday). */
    var timeEls = $$('.live-time');
    var weekdayEls = $$('.live-weekday');
    var dateEls = $$('.live-date');
    for (var i = 0; i < timeEls.length; i++) {
      timeEls[i].textContent = stamp.time;
    }
    for (var w = 0; w < weekdayEls.length; w++) {
      weekdayEls[w].textContent = stamp.weekday;
    }
    for (var j = 0; j < dateEls.length; j++) {
      /* If a sibling .live-weekday exists, date is month+day only.
         Otherwise keep legacy "weekday, month day" shape. */
      var parent = dateEls[j].parentNode;
      var hasWeekday = parent && parent.querySelector('.live-weekday');
      dateEls[j].textContent = hasWeekday
        ? stamp.date
        : (stamp.weekday + ', ' + stamp.date);
    }
  }

  function startClock() {
    updateClock();
    state.clockTimer = setInterval(updateClock, CLOCK_INTERVAL_MS);
  }

  function stopClock() {
    if (state.clockTimer) {
      clearInterval(state.clockTimer);
      state.clockTimer = null;
    }
  }

  /* ================================================================
     TYPEWRITER
     ================================================================ */

  /**
   * Type an array of { text, cls? } segments into `el`, one character at
   * a time. `el` is cleared first.
   *
   * @param el            the DOM element whose textContent we build
   * @param segments      array of { text: string, cls?: string }
   * @param speedMs       base ms per character (default 60)
   * @param done           callback when typing finishes
   * @param skipIfReduced  instant-complete under reduced motion (default true)
   * @returns {{ skip: function }} — call .skip() to finish instantly
   */
  function typewriter(el, segments, speedMs, done, skipIfReduced) {
    if (skipIfReduced === undefined) skipIfReduced = true;
    speedMs = speedMs || 60;

    var timer = null;
    var cancelled = false;

    /* cancel any typewriter already running on this element */
    if (el._acTypewriter && typeof el._acTypewriter.cancel === 'function') {
      el._acTypewriter.cancel();
    }

    /* build child span nodes for styled segments */
    el.textContent = '';
    var nodes = [];
    for (var i = 0; i < segments.length; i++) {
      var span = document.createElement('span');
      if (segments[i].cls) span.className = segments[i].cls;
      var text = segments[i].text || '';
      span.textContent = '';
      el.appendChild(span);
      nodes.push({ el: span, text: text });
    }

    /* count total characters (non-space) for progress */
    var totalChars = 0;
    for (var j = 0; j < segments.length; j++) {
      totalChars += (segments[j].text || '').length;
    }

    function cancel() {
      cancelled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.remove('ac-caret');
    }

    function finish() {
      if (cancelled) return;
      cancelled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      el.classList.remove('ac-caret');
      for (var k = 0; k < nodes.length; k++) {
        nodes[k].el.textContent = nodes[k].text;
      }
      if (typeof done === 'function') done();
    }

    /* reduced motion: instant complete */
    if (skipIfReduced && state.reducedMotion) {
      /* use rAF to yield one frame so the DOM is painted before we fill */
      requestAnimationFrame(function () { finish(); });
      el._acTypewriter = { skip: finish, cancel: cancel };
      return el._acTypewriter;
    }

    el.classList.add('ac-caret');

    var si = 0, ci = 0;
    (function tick() {
      if (cancelled) return;
      if (si >= nodes.length) {
        el.classList.remove('ac-caret');
        if (typeof done === 'function') done();
        return;
      }
      var node = nodes[si];
      var t = node.text;
      ci++;
      node.el.textContent = t.slice(0, ci);
      var ch = t.charAt(ci - 1);
      /* blip on non-space, non-newline characters */
      if (ch && ch !== ' ' && ch !== '\n') sound('blip');
      if (ci >= t.length) { si++; ci = 0; }
      var delay = /[!.,;:?\n]/.test(ch) ? speedMs * 3 : speedMs;
      timer = setTimeout(tick, delay);
    })();

    el._acTypewriter = { skip: finish, cancel: cancel };
    return el._acTypewriter;
  }

  /* ================================================================
     SCENE NAVIGATION (keyboard presentation)
     ================================================================ */

  function updateSceneIndicator() {
    var idx = state.currentScene;
    var el = dom.sceneProgress;
    if (!el) return;
    /* Presentation counts content scenes only (surprise is a popup). */
    var shown = Math.min(idx + 1, CONTENT_SCENES);
    var total = CONTENT_SCENES;
    var num = String(shown);
    el.innerHTML = (num.length === 1 ? '0' + num : num) +
                   ' <small>/ ' + (total < 10 ? '0' + total : total) + '</small>';
  }

  function scrollToScene(idx) {
    if (idx < 0) return;

    /* From gallery forward → open surprise popup instead of scrolling to #reveal */
    if (idx >= CONTENT_SCENES) {
      openSurprise();
      return;
    }

    /* Leaving surprise */
    if (state.surpriseOpen) closeSurprise();

    var id = SECTION_IDS[idx];
    var el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: state.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    enterScene(idx);
    sound('select');
  }

  function handleKeyDown(e) {
    /* Don't intercept when focus is inside a form control, unless it's
       a dedicated navigation key (ArrowLeft/ArrowRight/PageUp/PageDown) */
    var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    var isForm = (tag === 'input' || tag === 'textarea' || tag === 'select' ||
                  (document.activeElement && document.activeElement.isContentEditable));
    var key = e.key;

    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

    /* Before the start gate is dismissed, only the start keys do anything.
       (Prevents Space on the gate from also skipping past the opening.) */
    if (!state.startGateDismissed) {
      if (key === 'Enter' || key === ' ' || key === 'a' || key === 'A') {
        e.preventDefault();
        dismissStartGate();
      }
      return;
    }

    /* Space/Enter on a focused control, or inside a dialogue box, belongs
       to that element (BUILD.md §4d: sections handle dialogue advance). */
    if (key === ' ') {
      var ae = document.activeElement;
      var interactive = ae && ae !== document.body &&
        (/^(button|a|summary)$/i.test(ae.tagName) ||
         (ae.closest && ae.closest('.ac-box, [role="button"], [data-dialogue]')));
      if (interactive) return;
    }

    /* Navigation keys always work even in form fields, because there
       are no form fields in this site that need arrow navigation. */
    if (isForm && key !== 'ArrowRight' && key !== 'ArrowLeft' &&
        key !== 'PageDown' && key !== 'PageUp') {
      return;
    }

    switch (key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        if (key === ' ' && isForm) return;
        e.preventDefault();
        if (state.surpriseOpen) {
          advanceSurprise();
          return;
        }
        /* Space acts like A on the opening: advance dialogue first */
        if (key === ' ' && state.currentScene === 0 && advanceOpeningDialogue()) {
          return;
        }
        if (state.currentScene < CONTENT_SCENES - 1) {
          scrollToScene(state.currentScene + 1);
        } else if (state.currentScene === CONTENT_SCENES - 1) {
          openSurprise();
        }
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        if (state.surpriseOpen) {
          closeSurprise();
          scrollToScene(CONTENT_SCENES - 1);
          return;
        }
        if (state.currentScene > 0) {
          scrollToScene(state.currentScene - 1);
        }
        break;
      case 'a':
      case 'A':
        if (!state.startGateDismissed) {
          dismissStartGate();
          return;
        }
        if (state.surpriseOpen) {
          e.preventDefault();
          advanceSurprise();
          return;
        }
        if (state.currentScene === 0 && advanceOpeningDialogue()) {
          e.preventDefault();
          return;
        }
        break;
      default:
        break;
    }
  }

  /* ================================================================
     START GATE
     ================================================================ */

  function dismissStartGate() {
    if (state.startGateDismissed) return;
    state.startGateDismissed = true;

    /* Initialize audio (must be in a user gesture) */
    try {
      if (window.ACSound && typeof ACSound.init === 'function') {
        ACSound.init();
        /* apply persisted mute BEFORE starting ambient so a muted visitor
           never hears the ambient bed */
        if (typeof ACSound.setMuted === 'function') ACSound.setMuted(state.muted);
        if (!state.muted && typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
      }
    } catch (e) { /* audio best-effort */ }

    /* Release the background from inert and move focus off the gate so
       keyboard focus is never left on a removed element. */
    setBackgroundInert(false);
    var gateHadFocus = dom.startGate && dom.startGate.contains(document.activeElement);

    /* Hide the start gate */
    var gate = dom.startGate;
    if (gate) {
      gate.classList.add('is-dismissed');
      /* Remove from DOM after transition so it does not eat clicks */
      setTimeout(function () {
        if (gate.parentNode) gate.parentNode.removeChild(gate);
      }, 700);
    }

    /* Unlock body */
    document.body.classList.add('is-started');

    /* Show presentation controls */
    if (dom.siteControls) {
      dom.siteControls.hidden = false;
    }

    /* Begin opening sequence */
    state.presentationActive = true;
    startClock();
    updateSceneIndicator();

    /* Enter the opening scene */
    enterScene(0);

    if (gateHadFocus || document.activeElement === document.body) {
      var target = document.getElementById('opening') || dom.main;
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch (e2) { target.focus(); }
      }
    }
  }

  /** Make everything behind the start gate inert while it is shown. */
  function setBackgroundInert(on) {
    var els = $$('body > header, body > main, body > footer, .site-controls');
    for (var i = 0; i < els.length; i++) {
      if (on) {
        els[i].setAttribute('inert', '');
        els[i].setAttribute('aria-hidden', 'true');
      } else {
        els[i].removeAttribute('inert');
        els[i].removeAttribute('aria-hidden');
      }
    }
  }

  function setupStartGate() {
    var gate = dom.startGate;
    if (!gate) return;
    if (!gate.hasAttribute('role')) gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');

    var btn = $('.start-gate__button', gate);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        dismissStartGate();
      });
    }

    /* Clicking anywhere on the gate also starts */
    gate.addEventListener('click', function (e) {
      /* Don't double-fire if the button was clicked */
      if (e.target === btn || (btn && btn.contains(e.target))) return;
      dismissStartGate();
    });

    /* Keys (Enter / Space / A) are handled by handleKeyDown while the gate
       is up, so no separate listener is needed here (avoids double-firing). */

    if (!state.startGateDismissed) {
      setBackgroundInert(true);
      if (btn) {
        try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
      }
    }
  }

  /* ================================================================
     MUTE TOGGLE
     ================================================================ */

  function setupMuteToggle() {
    var btn = dom.soundToggle;
    if (!btn) return;

    /* Restore persisted mute state */
    state.muted = storageGet('muted', 'false') === 'true';
    updateMuteUI();

    btn.addEventListener('click', function () {
      state.muted = !state.muted;
      storageSet('muted', String(state.muted));
      updateMuteUI();
      try {
        if (window.ACSound && typeof ACSound.setMuted === 'function') {
          ACSound.setMuted(state.muted);
          if (state.startGateDismissed) {
            if (state.muted && typeof ACSound.stopAmbient === 'function') ACSound.stopAmbient();
            if (!state.muted && typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
          }
        }
      } catch (e) {}
      sound('select');
    });
  }

  function updateMuteUI() {
    var btn = dom.soundToggle;
    if (!btn) return;

    var label = dom.soundToggleLabel;
    var keyEl = dom.soundToggleKey;
    var data = state.data || ((window.ACContent && window.ACContent.data) ? window.ACContent.data : {}) || {};
    var ui = data.ui || {};

    if (label) {
      label.textContent = state.muted ? (ui.soundOn || 'Sound on') : (ui.soundOff || 'Sound off');
    }
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.muted));
    }
    if (keyEl) {
      /* Show X key when sound is off (muted=true => "press X for sound on")
         or when sound is on (muted=false => "press X for sound off").
         The mockup shows the X key chip always present, just the label changes. */
      keyEl.textContent = 'X';
      if (state.muted) {
        keyEl.style.background = 'var(--ac-ink-soft)';
      } else {
        keyEl.style.background = 'var(--ac-btn-x)';
      }
    }
  }

  /* ================================================================
     SCENE DETECTION (IntersectionObserver for current scene)
     ================================================================ */

  function enterScene(idx) {
    if (idx < 0 || idx >= CONTENT_SCENES) return;
    state.currentScene = idx;
    updateSceneIndicator();

    /* Call the section's enter() if it exists */
    var key = SECTION_IDS[idx];
    if (window.ACSections && ACSections[key] && typeof ACSections[key].enter === 'function') {
      try {
        ACSections[key].enter();
      } catch (e) { /* section code is defensive */ }
    }
  }

  /**
   * Track which content section is most on-screen (by IntersectionObserver
   * ratio) and set currentScene to that index. The surprise section is
   * excluded — it only appears as a popup.
   */
  function setupSceneTracking() {
    if (!('IntersectionObserver' in window)) return;

    var thresholds = [];
    for (var t = 0; t <= 20; t++) thresholds.push(t / 20);

    var ratios = {};
    for (var i = 0; i < CONTENT_SCENES; i++) {
      ratios[SECTION_IDS[i]] = 0;
    }

    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        ratios[entries[e].target.id] = entries[e].intersectionRatio;
      }
      if (!state.presentationActive || state.surpriseOpen) return;
      var bestIdx = 0;
      var bestRatio = 0;
      for (var j = 0; j < CONTENT_SCENES; j++) {
        var r = ratios[SECTION_IDS[j]] || 0;
        if (r > bestRatio) {
          bestRatio = r;
          bestIdx = j;
        }
      }
      if (bestRatio > 0 && bestIdx !== state.currentScene) {
        enterScene(bestIdx);
      }
    }, { threshold: thresholds });

    for (var k = 0; k < CONTENT_SCENES; k++) {
      var el = document.getElementById(SECTION_IDS[k]);
      if (el) io.observe(el);
    }
  }

  /* ================================================================
     SCROLL REVEALS (.reveal-on-scroll → .is-in)
     ================================================================ */

  function setupScrollReveals() {
    if (!('IntersectionObserver' in window)) {
      /* No observer: just mark everything visible */
      var all = $$('.reveal-on-scroll');
      for (var i = 0; i < all.length; i++) {
        all[i].classList.add('is-in');
      }
      return;
    }

    var staggerBase = 70; /* ms, per DESIGN.md §6 */

    /* Map from element to its index among siblings with the same parent,
       for staggering */
    var staggerIdx = new WeakMap();
    var allReveals = $$('.reveal-on-scroll');
    for (var r = 0; r < allReveals.length; r++) {
      var el = allReveals[r];
      var parent = el.parentNode;
      if (!parent) continue;
      /* Count how many .reveal-on-scroll siblings come before this one */
      var siblings = $$('.reveal-on-scroll', parent);
      var idx = 0;
      for (var s = 0; s < siblings.length; s++) {
        if (siblings[s] === el) { idx = s; break; }
      }
      staggerIdx.set(el, idx);
    }

    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        var entry = entries[e];
        if (entry.isIntersecting) {
          var target = entry.target;
          var delay = (staggerIdx.get(target) || 0) * staggerBase;
          if (delay > 0 && !state.reducedMotion) {
            (function (t) {
              setTimeout(function () { t.classList.add('is-in'); }, delay);
            })(target);
          } else {
            target.classList.add('is-in');
          }
          io.unobserve(target);
        }
      }
    }, { threshold: 0.12 });

    for (var i = 0; i < allReveals.length; i++) {
      io.observe(allReveals[i]);
    }
  }

  /* ================================================================
     ANIMATED COUNTERS (stats tickets with numeric values)
     ================================================================ */

  /**
   * Animate a value from 0 to `finalValue` over `duration` ms using
   * an ease-out curve. Calls `onFrame(current)` on each rAF.
   * Respects reduced motion (instantly shows final value).
   */
  function animateCounter(finalValue, duration, onFrame, onDone) {
    if (state.reducedMotion) {
      onFrame(finalValue);
      if (typeof onDone === 'function') onDone();
      return;
    }

    var start = null;
    duration = duration || 1200;

    function step(timestamp) {
      if (!start) start = timestamp;
      var elapsed = timestamp - start;
      var progress = Math.min(elapsed / duration, 1);
      /* ease-out (quadratic) */
      var eased = 1 - (1 - progress) * (1 - progress);
      var current = Math.round(finalValue * eased);
      onFrame(current);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        onFrame(finalValue);
        if (typeof onDone === 'function') onDone();
      }
    }

    requestAnimationFrame(step);
  }

  /**
   * Find all elements with data-counter-final and animate them.
   * The pattern is: a stat ticket value matches `^\d{1,3}(,\d{3})*$` or
   * `^\d+$` — animate; otherwise verbatim text (the section module
   * already sets data-counter-final if it's a number).
   */
  function setupCounters(root) {
    var counters = $$('[data-counter-final]', root || document);
    var io = null;

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (entries[e].isIntersecting) {
            animateCounterFor(entries[e].target);
            io.unobserve(entries[e].target);
          }
        }
      }, { threshold: 0.3 });
    }

    for (var i = 0; i < counters.length; i++) {
      if (io) {
        io.observe(counters[i]);
      } else {
        animateCounterFor(counters[i]);
      }
    }
  }

  function animateCounterFor(el) {
    var labelEl = el.querySelector('.ac-ticket__label');
    var valueEl = el.querySelector('.ac-ticket__value');
    if (!valueEl) return;

    var rawFinal = el.getAttribute('data-counter-final');
    if (rawFinal === null || rawFinal === '') return;

    var finalNum = parseInt(rawFinal, 10);
    if (isNaN(finalNum)) return;

    /* Original formatted value (may have commas) */
    var formatted = el.getAttribute('data-counter-formatted') || rawFinal;

    animateCounter(finalNum, 1400, function (current) {
      valueEl.textContent = current.toLocaleString ? current.toLocaleString() : String(current);
    }, function () {
      /* Set the exact formatted string at the end */
      valueEl.textContent = formatted;
      if (labelEl) {
        try {
          sound('stamp');
        } catch (_) {}
      }
    });
  }

  /* ================================================================
     SURPRISE POPUP + REVEAL CHAIN
     ================================================================ */

  /**
   * Surprise is not a scroll section in presentation — it pops over
   * the page. Saving... holds on screen longer before the next beat.
   */
  function openSurprise() {
    var root = document.getElementById('reveal');
    if (!root || state.surpriseOpen) return;

    state.surpriseOpen = true;
    state.surpriseStep = 0;
    sound('select');

    root.classList.add('is-surprise-open');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.removeAttribute('hidden');
    document.body.classList.add('surprise-open');

    /* Reset beats then run the sequenced popup show */
    resetRevealChain(true);
    runSurpriseSequence();

    try {
      root.focus({ preventScroll: true });
    } catch (e) {
      try { root.focus(); } catch (e2) {}
    }
  }

  function closeSurprise() {
    var root = document.getElementById('reveal');
    state.surpriseOpen = false;
    state.surpriseStep = 0;
    state.savingHoldUntil = 0;
    clearSurpriseTimers();
    document.body.classList.remove('surprise-open');
    if (root) {
      root.classList.remove('is-surprise-open');
      root.removeAttribute('aria-modal');
    }
  }

  function scheduleSurprise(fn, ms) {
    if (!state.surpriseTimers) state.surpriseTimers = [];
    state.surpriseTimers.push(setTimeout(fn, ms));
  }

  /** Advance to next surprise beat (A / Space / click while popup open). */
  function advanceSurprise() {
    if (!state.surpriseOpen) return;
    /* During Saving hold/fade: skip straight to the announcement pop */
    if (state.surpriseStep === 1) {
      clearSurpriseTimers();
      finishSavingIntoAnnouncement();
      return;
    }
    if (state.surpriseStep >= 5) return;
    showSurpriseBeat(state.surpriseStep + 1);
  }

  function clearSurpriseTimers() {
    if (!state.surpriseTimers) return;
    for (var i = 0; i < state.surpriseTimers.length; i++) {
      clearTimeout(state.surpriseTimers[i]);
    }
    state.surpriseTimers = [];
  }

  /**
   * Saving... → long fade → announcement pops with confetti from behind.
   */
  function finishSavingIntoAnnouncement() {
    var root = document.getElementById('reveal');
    if (!root) return;
    var saving = $('[data-reveal-beat="1"]', root);
    if (!saving || state.surpriseStep !== 1) {
      showSurpriseBeat(2);
      return;
    }

    var fade = state.reducedMotion ? SAVING_FADE_REDUCED_MS : SAVING_FADE_MS;
    saving.classList.add('is-saving-fade');
    state.savingHoldUntil = Date.now() + fade;

    scheduleSurprise(function () {
      if (!state.surpriseOpen) return;
      saving.classList.remove('is-saving-fade', 'is-surprise-current', 'is-in', 'is-armed');
      saving.setAttribute('hidden', '');
      showAnnouncementWithBlast();
    }, fade);
  }

  function showAnnouncementWithBlast() {
    var root = document.getElementById('reveal');
    if (!root) return;
    var beat = $('[data-reveal-beat="2"]', root);
    if (!beat) return;

    var all = $$('[data-reveal-beat]', root);
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('is-in', 'is-armed', 'is-surprise-current', 'is-pop-in', 'is-saving-fade');
      if (parseInt(all[i].getAttribute('data-reveal-beat'), 10) !== 2) {
        all[i].setAttribute('hidden', '');
      } else {
        all[i].removeAttribute('hidden');
      }
    }

    state.surpriseStep = 2;
    state.savingHoldUntil = 0;

    /* Confetti layer sits behind the dialogue card */
    var blast = $('.reveal__blast', beat);
    if (!blast) {
      blast = document.createElement('div');
      blast.className = 'reveal__blast reveal-confetti';
      blast.setAttribute('data-confetti', '');
      blast.setAttribute('aria-hidden', 'true');
      beat.insertBefore(blast, beat.firstChild);
    } else {
      blast.textContent = '';
    }

    beat.classList.add('is-armed', 'is-in', 'is-surprise-current', 'is-pop-in');
    sound('fanfare');
    spawnConfetti(beat);
    triggerAnnouncementTypewriter(beat);
  }

  function showSurpriseBeat(num) {
    var root = document.getElementById('reveal');
    if (!root) return;
    var beat = $('[data-reveal-beat="' + num + '"]', root);
    if (!beat) return;

    /* Hide prior beats; show this one full-screen in the popup */
    var all = $$('[data-reveal-beat]', root);
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('is-in', 'is-armed', 'is-surprise-current', 'is-pop-in', 'is-saving-fade');
      if (parseInt(all[i].getAttribute('data-reveal-beat'), 10) !== num) {
        all[i].setAttribute('hidden', '');
      } else {
        all[i].removeAttribute('hidden');
      }
    }

    state.surpriseStep = num;
    beat.classList.add('is-armed', 'is-in', 'is-surprise-current');
    triggerBeat(String(num), beat);

    if (num === 1) {
      var hold = state.reducedMotion ? SAVING_HOLD_REDUCED_MS : SAVING_HOLD_MS;
      /* Hold window includes the upcoming fade so skip still feels responsive */
      state.savingHoldUntil = Date.now() + hold + (state.reducedMotion ? SAVING_FADE_REDUCED_MS : SAVING_FADE_MS);
      scheduleSurprise(function () {
        if (state.surpriseOpen && state.surpriseStep === 1) {
          finishSavingIntoAnnouncement();
        }
      }, hold);
    }
  }

  function runSurpriseSequence() {
    showSurpriseBeat(1);
  }

  /**
   * Scroll-based reveal chain (fallback if someone deep-links #reveal).
   * In normal use the surprise opens as a popup instead.
   */
  function setupRevealChain() {
    var revealRoot = document.getElementById('reveal');
    if (!revealRoot) return;

    /* Keep reveal out of the page flow until the popup opens. */
    if (!revealRoot.hasAttribute('tabindex')) {
      revealRoot.setAttribute('tabindex', '-1');
    }
    revealRoot.classList.add('reveal--popup');

    var beatPlayed = {};
    var beatArmed = {};

    if (state.revealObservers) {
      for (var o = 0; o < state.revealObservers.length; o++) {
        try { state.revealObservers[o].disconnect(); } catch (e0) {}
      }
    }
    state.revealObservers = [];

    /* Scroll observers only matter if popup styling fails — keep light arming. */
    if (!('IntersectionObserver' in window)) return;

    var armIO = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        var en = entries[e];
        if (en.isIntersecting && !beatArmed[en.target.dataset.revealBeat]) {
          beatArmed[en.target.dataset.revealBeat] = true;
          if (!state.reducedMotion) en.target.classList.add('is-armed');
        }
      }
    }, { threshold: 0 });

    var triggerIO = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        var en = entries[e];
        if (!en.isIntersecting) continue;
        /* Never auto-play surprise from scroll — popup owns the sequence. */
        if (!state.surpriseOpen) continue;
        var beatNum = en.target.dataset.revealBeat;
        if (beatPlayed[beatNum]) continue;
        /* Saving hold: delay beat 2 until hold expires */
        if (beatNum === '2' && Date.now() < state.savingHoldUntil) continue;
        beatPlayed[beatNum] = true;
        triggerBeat(beatNum, en.target);
      }
    }, { threshold: 0.4 });
    state.revealObservers.push(armIO, triggerIO);

    for (var i = 1; i <= 5; i++) {
      var el = $('[data-reveal-beat="' + i + '"]', revealRoot);
      if (el) {
        armIO.observe(el);
        triggerIO.observe(el);
      }
    }
  }

  function triggerBeat(num, el) {
    el.classList.add('is-in');
    switch (num) {
      case '1':
        sound('confirm');
        break;
      case '2':
        /* Announcement is entered via showAnnouncementWithBlast for the
           timed sequence; keep this for manual/replay edge cases. */
        triggerAnnouncementTypewriter(el);
        break;
      case '3':
        setTimeout(function () { sound('stamp'); }, state.reducedMotion ? 0 : 650);
        setTimeout(function () { sound('fanfare'); }, state.reducedMotion ? 150 : 950);
        break;
      case '5':
        sound('fanfare');
        spawnConfetti(el);
        break;
      default:
        break;
    }
  }

  function triggerAnnouncementTypewriter(beatEl) {
    /* Find the typed line inside beat 2 */
    var lineEl = $('.reveal__line', beatEl) || $('.rv-line', beatEl) || $('[data-typing]', beatEl);
    if (!lineEl) return;

    /* Read data attributes set by the section module:
       data-typing: JSON array of segments */
    var raw = lineEl.getAttribute('data-typing');
    if (!raw) return;

    var segments;
    try {
      segments = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!segments || !segments.length) return;

    var boxEl = lineEl.closest('.rv-box') || lineEl.closest('.ac-box');
    var emoteEl = $('.rv-emote', beatEl);
    var subEl = $('.rv-sub', beatEl);

    if (boxEl) boxEl.classList.remove('is-done');
    if (emoteEl) emoteEl.classList.remove('is-on');

    typewriter(lineEl, segments, 60, function () {
      if (boxEl) boxEl.classList.add('is-done');
      if (emoteEl) {
        emoteEl.classList.add('is-on');
        if (!state.reducedMotion) {
          emoteEl.classList.remove('ac-pop');
          void emoteEl.offsetWidth;
          emoteEl.classList.add('ac-pop');
        }
      }
      sound('confirm');
    });
  }

  function spawnConfetti(beatEl) {
    if (state.reducedMotion) return;

    var container = $('.reveal__blast', beatEl) ||
                    $('.reveal__confetti', beatEl) ||
                    $('.reveal-confetti', beatEl) ||
                    $('[data-confetti]', beatEl);
    if (!container) return;

    /* Seedable PRNG for repeatable confetti layout */
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }

    for (var i = 0; i < 72; i++) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      var d = 4.2 + rnd() * 4.8;
      piece.style.setProperty('--x', (rnd() * 100).toFixed(2) + '%');
      piece.style.setProperty('--duration', d.toFixed(2) + 's');
      piece.style.setProperty('--delay', (-rnd() * 0.4).toFixed(2) + 's');
      piece.style.setProperty('--sway', Math.round((rnd() - 0.5) * 140) + 'px');
      piece.setAttribute('aria-hidden', 'true');
      container.appendChild(piece);
    }
  }

  /** Reset all reveal beats for replay.
   *  @param {boolean} soft  if true, don't reconnect observers (popup restart) */
  function resetRevealChain(soft) {
    var revealRoot = document.getElementById('reveal');
    if (!revealRoot) return;

    clearSurpriseTimers();
    state.savingHoldUntil = 0;

    var allBeats = $$('[data-reveal-beat]', revealRoot);
    for (var i = 0; i < allBeats.length; i++) {
      allBeats[i].classList.remove('is-armed', 'is-in', 'is-surprise-current', 'is-pop-in', 'is-saving-fade');
      allBeats[i].removeAttribute('hidden');
    }

    var achv = $('[data-reveal-beat="3"]', revealRoot);
    if (achv) achv.classList.remove('is-shake');

    var confettiContainers = $$('.reveal__blast, .reveal__confetti, .reveal-confetti, [data-confetti]', revealRoot);
    for (var c = 0; c < confettiContainers.length; c++) {
      confettiContainers[c].textContent = '';
    }

    if (window.ACSections && ACSections.reveal && typeof ACSections.reveal.reset === 'function') {
      try { ACSections.reveal.reset(); } catch (e) {}
    }

    if (!soft) setupRevealChain();
  }

  /* ================================================================
     REPLAY BUTTON
     ================================================================ */

  function setupReplay() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.reveal__replay, .rv-replay, [data-replay]');
      if (btn) {
        e.preventDefault();
        sound('select');
        if (!state.surpriseOpen) openSurprise();
        else {
          resetRevealChain(true);
          runSurpriseSequence();
        }
        return;
      }

      /* Click anywhere on the surprise (except replay) advances beats */
      if (state.surpriseOpen) {
        var root = document.getElementById('reveal');
        if (root && root.contains(e.target) && !e.target.closest('a, button')) {
          advanceSurprise();
        }
      }
    });
  }

  /* ================================================================
     OPENING DIALOGUE ADVANCE
     ================================================================ */

  var openingDialogue = {
    index: -1,   /* -1 = announcement only; 0+ = revealed dialogue lines */
    done: false
  };

  /**
   * Reveal the next opening dialogue line. Returns true if something
   * was advanced (so the A-key handler can preventDefault).
   */
  function advanceOpeningDialogue() {
    var root = document.getElementById('opening');
    if (!root) return false;

    var lines = $$('[data-opening-dialogue] .opening__dline', root);
    var prompt = $('[data-opening-next], .opening__prompt', root);
    var keepGoing = '';
    try {
      keepGoing = (window.ACContent && ACContent.get('ui.keepGoing')) || '';
    } catch (e) {}

    if (openingDialogue.done) {
      /* After last line, Next moves to the following scene. */
      if (state.currentScene < CONTENT_SCENES - 1) {
        scrollToScene(state.currentScene + 1);
        return true;
      }
      return false;
    }

    openingDialogue.index += 1;
    if (openingDialogue.index < lines.length) {
      lines[openingDialogue.index].hidden = false;
      sound('select');
      if (openingDialogue.index === lines.length - 1) {
        openingDialogue.done = true;
        if (prompt) {
          var label = prompt.querySelector('[data-content-next]');
          if (label && keepGoing) label.textContent = keepGoing;
        }
      }
      return true;
    }

    openingDialogue.done = true;
    return false;
  }

  function setupOpeningDialogue() {
    openingDialogue.index = -1;
    openingDialogue.done = false;

    var root = document.getElementById('opening');
    if (!root) return;

    var prompt = $('[data-opening-next], .opening__prompt', root);
    if (!prompt) return;

    prompt.addEventListener('click', function (e) {
      e.preventDefault();
      advanceOpeningDialogue();
    });
  }

  /* ================================================================
     SKIP LINK
     ================================================================ */

  function setupSkipLink() {
    var link = dom.skipLink;
    if (!link) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var main = document.getElementById('main');
      if (main) {
        main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: false });
        /* Remove tabindex after blur so it does not get a permanent tab stop */
        main.addEventListener('blur', function handler() {
          main.removeAttribute('tabindex');
          main.removeEventListener('blur', handler);
        }, { once: true });
      }
    });
  }

  /* ================================================================
     BOOT SEQUENCE
     ================================================================ */

  /**
   * Cache the DOM elements that app.js owns or reads.
   * The shell worker puts these in the HTML with these ids/classes.
   */
  function cacheDom() {
    dom.startGate      = document.getElementById('start-gate');
    dom.siteControls   = $('.site-controls');
    dom.sceneProgress  = $('.section-progress');
    dom.soundToggle    = $('.sound-toggle');
    dom.soundToggleLabel = $('.sound-toggle__label');
    dom.soundToggleKey = $('.sound-toggle .ac-key');
    dom.skipLink       = $('.skip-link');
    dom.main           = document.getElementById('main');
  }

  /**
   * Render each section from the JSON data.
   * This calls ACSections.<name>.render(root, data, ACContent) if available.
   * If the section module does not exist, the section stays empty
   * (the shell worker may still render a placeholder).
   */
  function renderSections(data) {
    for (var i = 0; i < TOTAL_SECTIONS; i++) {
      var key = SECTION_IDS[i];
      var root = document.getElementById(key);
      if (!root) continue;

      if (window.ACSections && ACSections[key] && typeof ACSections[key].render === 'function') {
        try {
          ACSections[key].render(root, data, ACContent);
        } catch (e) {
          /* If a section renderer throws, show a small error note in dev */
          if (window.console && console.warn) {
            console.warn('Section render failed for', key, e);
          }
        }
      }
    }
  }

  /**
   * Main boot: load content → set title → render → setup UX.
   */
  function boot() {
    cacheDom();

    /* Check reduced motion */
    if (window.matchMedia) {
      try {
        var mq = matchMedia('(prefers-reduced-motion: reduce)');
        state.reducedMotion = mq.matches;
        var onMq = function (e) { state.reducedMotion = e.matches; };
        if (mq.addEventListener) mq.addEventListener('change', onMq);
        else if (mq.addListener) mq.addListener(onMq);
      } catch (e) { /* keep default */ }
    }

    /* Hook for CSS: .js .reveal-on-scroll hides until revealed */
    document.documentElement.classList.add('js');

    /* Must have ACContent (or fallback) */
    var C = window.ACContent;
    if (!C || !C.load) {
      /* Fallback: content.js is missing. Try fetch directly. */
      fallbackBoot();
      return;
    }

    var booted = false;
    function run(data) {
      if (booted) return;
      booted = true;
      data = (data && typeof data === 'object') ? data : {};
      state.data = data;
      if (data.site && data.site.title) document.title = data.site.title;
      renderShell(data);
      renderSections(data);
      postBoot(data);
    }
    var p;
    try { p = C.load(); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') { run({ _fetchFailed: true }); return; }
    p.then(run, function () { run({ _fetchFailed: true }); })
     .catch(function (e) {
       if (window.console && console.warn) console.warn('Boot error', e);
     });
  }

  /**
   * Fallback when ACContent is not available: fetch content/site.json
   * directly; on failure render every empty state from {}.
   */
  function fallbackBoot() {
    function run(data) {
      data = (data && typeof data === 'object') ? data : {};
      state.data = data;
      if (data.site && data.site.title) document.title = data.site.title;
      renderShell(data);
      renderSectionsWithRawData(data);
      postBoot(data);
    }
    /* BUILD.md §4c: on fetch/parse failure render every empty state from {}.
       The legacy window.AC_CONFIG is intentionally NOT read (BUILD.md §1a). */
    var req;
    try {
      req = fetch('content/site.json', { cache: 'no-cache' });
    } catch (e) {
      run({ _fetchFailed: true });
      return;
    }
    req.then(function (res) {
        if (!res.ok) throw new Error('fetch failed: ' + res.status);
        return res.json();
      })
      .then(run, function () { run({ _fetchFailed: true }); })
      .catch(function (e) {
        if (window.console && console.warn) console.warn('Boot error', e);
      });
  }

  /**
   * Fill shell-level copy (start gate, skip link, edit link) from JSON.
   * index.html marks such elements with data-content="dot.path"; the text
   * comes only from JSON. Empty values hide the element (BUILD.md §3b).
   * The edit link is [data-edit-link]; it is shown only when site.editUrl
   * is a non-empty http(s) URL.
   */
  function lookup(data, path) {
    var parts = String(path || '').split('.');
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = cur[parts[i]];
    }
    return cur == null ? '' : cur;
  }

  function renderShell(data) {
    var els = $$('[data-content]');
    for (var i = 0; i < els.length; i++) {
      var v = lookup(data, els[i].getAttribute('data-content'));
      var str = (typeof v === 'string') ? v : '';
      if (str.trim() === '') {
        /* keep the element but hide it; a button keeps its aria-label */
        els[i].textContent = '';
        if (els[i].hasAttribute('data-hide-empty')) els[i].hidden = true;
      } else {
        els[i].textContent = str;
        els[i].hidden = false;
      }
    }

    var edit = $$('[data-edit-link]');
    var url = lookup(data, 'site.editUrl');
    var label = lookup(data, 'ui.editLink');
    var ok = typeof url === 'string' && /^https?:\/\//i.test(url.trim()) &&
             typeof label === 'string' && label.trim() !== '';
    for (var j = 0; j < edit.length; j++) {
      if (ok) {
        edit[j].setAttribute('href', url.trim());
        edit[j].setAttribute('rel', 'noopener');
        edit[j].textContent = label;
        edit[j].hidden = false;
      } else {
        edit[j].removeAttribute('href');
        edit[j].hidden = true;
      }
    }
  }

  /**
   * Minimal ACContent stand-in used only if content.js failed to load.
   * Mirrors BUILD.md §4b; builds DOM with textContent only.
   */
  function makeContentShim(data) {
    function str(v) { return (typeof v === 'string') ? v : ''; }
    function get(path) {
      var v = lookup(data, path);
      return v == null ? '' : v;
    }
    function tokens() {
      return {
        name: str(get('site.name')),
        son: str(get('site.son')),
        venue: str(get('opening.venue')),
        years: str(get('reveal.years')),
        startDate: str(get('reveal.startDate')),
        jobTitle: str(get('reveal.jobTitle')),
        employer: str(get('reveal.employer'))
      };
    }
    function fill(s, extra) {
      var t = tokens();
      return str(s).replace(/\{(\w+)\}/g, function (_, k) {
        if (extra && typeof extra[k] === 'string') return extra[k];
        return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : '';
      });
    }
    function rich(s, extra) {
      var parts = fill(s, extra).split('*');
      var frag = document.createDocumentFragment();
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        if (i % 2 === 1 && i < parts.length - 1) {
          var span = document.createElement('span');
          span.className = 'ac-hl';
          span.textContent = parts[i];
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode((i % 2 === 1 ? '*' : '') + parts[i]));
        }
      }
      return frag;
    }
    function isBlank(v) {
      if (v == null) return true;
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === 'object') {
        for (var k in v) {
          if (Object.prototype.hasOwnProperty.call(v, k) && !isBlank(v[k])) return false;
        }
        return true;
      }
      return false;
    }
    return { data: data, get: get, fill: fill, rich: rich, isBlank: isBlank, liveStamp: liveStamp };
  }

  /**
   * Render sections using the raw data object (when ACContent helpers
   * are not available).
   */
  function renderSectionsWithRawData(data) {
    var shim = makeContentShim(data);
    for (var i = 0; i < TOTAL_SECTIONS; i++) {
      var key = SECTION_IDS[i];
      var root = document.getElementById(key);
      if (!root) continue;

      if (window.ACSections && ACSections[key] && typeof ACSections[key].render === 'function') {
        try {
          ACSections[key].render(root, data, shim);
        } catch (e) {
          if (window.console && console.warn) {
            console.warn('Section render failed for', key, e);
          }
        }
      }
    }
  }

  /**
   * Setup everything that comes after sections are rendered.
   */
  function postBoot(data) {
    /* Hide presentation controls until start gate is dismissed */
    if (dom.siteControls) {
      dom.siteControls.hidden = true;
    }

    /* Setup start gate */
    setupStartGate();

    /* Setup mute toggle */
    setupMuteToggle();

    /* Setup skip link */
    setupSkipLink();

    /* Keyboard navigation */
    document.addEventListener('keydown', handleKeyDown);

    /* Scene tracking via IntersectionObserver */
    setupSceneTracking();

    /* Scroll reveals */
    setupScrollReveals();

    /* Animated counters (look through entire document) */
    setupCounters(document);

    /* Reveal chain */
    setupRevealChain();

    /* Replay button delegation */
    setupReplay();

    /* Opening dialogue Next / A advance */
    setupOpeningDialogue();

    /* Content status: if fetch failed, show a non-intrusive notice.
       content.js already shows a role="status" notice. If we're in
       fallback mode and the notice does not exist, add one. */
    if (data && data._fetchFailed) {
      var status = document.getElementById('content-status');
      if (!status) {
        status = document.createElement('div');
        status.id = 'content-status';
        status.className = 'content-status';
        status.setAttribute('role', 'status');
        status.textContent = 'Content could not be loaded — please refresh in a moment.';
        var main = dom.main || document.querySelector('main');
        if (main) {
          main.insertBefore(status, main.firstChild);
        }
      }
    }

    /* No gate in the markup: never leave the page locked. Start without
       audio (audio still requires a gesture, so ACSound is not touched). */
    if (!dom.startGate && !state.startGateDismissed) {
      state.startGateDismissed = true;
      state.presentationActive = true;
      document.body.classList.add('is-started');
      if (dom.siteControls) dom.siteControls.hidden = false;
      startClock();
      enterScene(0);
    }
  }

  /* ================================================================
     PUBLIC API (exposed for replay / section interaction)
     ================================================================ */

  window.ACApp = {
    /** Force the current scene to a given index (0-based). */
    goToScene: scrollToScene,

    /** Open the surprise popup sequence. */
    openSurprise: openSurprise,

    /** Reset and replay the reveal chain. */
    replayReveal: function () {
      if (!state.surpriseOpen) openSurprise();
      else {
        resetRevealChain(true);
        runSurpriseSequence();
      }
    },

    /** Schedule counter animation on a newly-rendered element. */
    animateCounter: animateCounterFor,

    /** Setup reveal observers after a section re-renders. */
    setupRevealObservers: setupRevealChain,

    /** Spawn confetti for a finale element. */
    spawnConfetti: spawnConfetti,

    /** Trigger a typewriter on an element with data-typing. */
    triggerTypewriter: triggerAnnouncementTypewriter,

    /** Current state (read-only access) */
    getState: function () { return state; },

    /** Get the reduced-motion flag */
    isReducedMotion: function () { return state.reducedMotion; }
  };

  /* ================================================================
     INIT
     ================================================================ */

  /* Don't boot until DOM is ready (defer script handles this, but be safe) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
