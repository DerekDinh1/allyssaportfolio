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
  var SECTION_NAV_FALLBACKS = ['Morning', 'Daily', 'Stats', 'Gallery', 'News'];
  var CLOCK_INTERVAL_MS = 10000;   // update live clock every 10 s
  var SAVING_HOLD_MS = 5000;       // Saving stays fully visible
  var SAVING_FADE_MS = 3400;       // then slow fade before surprise
  var WIPE_HALF_MS = 380;          // leaf wipe mid-point for scene swap

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
    sceneTransitioning: false,
    savingTimer: null,
    mailInterruptOpen: false,
    mailLandTimer: null,
    mailFlightRaf: null,
    surpriseOpened: false,
    surpriseBeatIndex: 0,
    surpriseBeats: [],
    navOpen: false,
    navLabels: SECTION_NAV_FALLBACKS.slice(),
    photoViewerOpen: false,
    photoViewerIndex: 0,
    photoViewerItems: [],
    photoViewerOpener: null,
    menuMusicStarted: false,
    introSfxTimer: null
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

  /** Guarded ACSound call. Never throws. Optional arg for talk(char). */
  function sound(method, arg) {
    try {
      if (window.ACSound && typeof window.ACSound[method] === 'function') {
        if (arg !== undefined) window.ACSound[method](arg);
        else window.ACSound[method]();
      }
    } catch (e) { /* audio is best-effort */ }
  }

  /**
   * Intro: mute SFX only for 3s (keep talk + BGM). Then restore SFX
   * if the user still has Sound effects enabled in settings.
   */
  function muteIntroSfxBriefly() {
    if (!window.ACSound || typeof ACSound.setChannel !== 'function') return;
    if (state.introSfxTimer) {
      clearTimeout(state.introSfxTimer);
      state.introSfxTimer = null;
    }
    try { ACSound.setChannel('sfx', false); } catch (e) {}
    state.introSfxTimer = setTimeout(function () {
      state.introSfxTimer = null;
      try {
        if (state.muted) return;
        if (storageGet('audio_sfx', 'true') === 'false') return;
        ACSound.setChannel('sfx', true);
      } catch (e2) {}
    }, 3000);
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
  function typewriter(el, segments, speedMs, done, skipIfReduced, silent) {
    if (skipIfReduced === undefined) skipIfReduced = true;
    speedMs = speedMs || 55; /* Match Animalese syllable (~60–80ms) */

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
    if (!silent) sound('resetTalk');

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
      /* Animalese talk on letters; pause on punctuation (no voice) */
      if (!silent && ch && ch !== ' ' && ch !== '\n' && !/[.,!?;:'"…]/.test(ch)) {
        if (window.ACSound && typeof ACSound.talk === 'function') sound('talk', ch);
        else sound('blip');
      }
      if (ci >= t.length) { si++; ci = 0; }
      var delay = /[!.,;:?\n]/.test(ch) ? speedMs * 3.5 : (ch === ' ' ? speedMs * 1.4 : speedMs);
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
    var num = String(idx + 1);
    var padded = num.length === 1 ? '0' + num : num;
    var el = dom.sceneProgress;
    if (el) {
      el.innerHTML = padded +
                     ' <small>/ ' + (TOTAL_SECTIONS < 10 ? '0' + TOTAL_SECTIONS : TOTAL_SECTIONS) + '</small>';
    }
    if (dom.navChipNum) dom.navChipNum.textContent = padded;
    updatePresentationNav();
  }

  /** Short scene labels for the collapsible nav (content-aware). */
  function deriveNavLabels(data) {
    var labels = SECTION_NAV_FALLBACKS.slice();
    data = data || state.data || {};
    var C = window.ACContent;

    if (data.opening && data.opening.title && String(data.opening.title).trim()) {
      labels[0] = String(data.opening.title).trim();
    }

    if (data.dailyLife && data.dailyLife.title && String(data.dailyLife.title).trim()) {
      labels[1] = 'Daily';
    }

    if (data.stats && data.stats.title && String(data.stats.title).trim()) {
      var st = String(data.stats.title).trim();
      labels[2] = st.length <= 12 ? st : 'Stats';
    }

    if (data.gallery && data.gallery.title && String(data.gallery.title).trim()) {
      labels[3] = 'Gallery';
    }

    if (data.reveal && data.reveal.announcement && data.reveal.announcement.badge) {
      var badge = String(data.reveal.announcement.badge).trim();
      if (/news/i.test(badge)) labels[4] = 'News';
      else if (badge.length <= 12) labels[4] = badge.replace(/[!]+/g, '').trim();
    }

    if (C && typeof C.get === 'function') {
      if (!C.isBlank(C.get('opening.title'))) labels[0] = String(C.get('opening.title')).trim();
      if (!C.isBlank(C.get('dailyLife.title'))) labels[1] = 'Daily';
      if (!C.isBlank(C.get('stats.title'))) {
        var statsTitle = String(C.get('stats.title')).trim();
        labels[2] = statsTitle.length <= 12 ? statsTitle : 'Stats';
      }
      if (!C.isBlank(C.get('gallery.title'))) labels[3] = 'Gallery';
      if (!C.isBlank(C.get('reveal.announcement.badge'))) {
        var rvBadge = String(C.get('reveal.announcement.badge')).trim();
        if (/news/i.test(rvBadge)) labels[4] = 'News';
        else if (rvBadge.length <= 12) labels[4] = rvBadge.replace(/[!]+/g, '').trim();
      }
    }

    return labels;
  }

  function setPresentationNavOpen(open) {
    var nav = dom.presentationNav;
    var panel = dom.navPanel;
    var toggle = dom.navToggle;
    if (!nav || !panel || !toggle) return;

    state.navOpen = !!open;
    nav.classList.toggle('is-open', state.navOpen);
    toggle.setAttribute('aria-expanded', state.navOpen ? 'true' : 'false');
    panel.hidden = !state.navOpen;
    if (dom.navToggleSr) {
      dom.navToggleSr.textContent = state.navOpen ? 'Close scene menu' : 'Open scene menu';
    }

    if (state.navOpen) {
      var focusTarget = (state.currentScene > 0 && dom.navBack && !dom.navBack.disabled)
        ? dom.navBack
        : (dom.navItems && dom.navItems[state.currentScene]) || toggle;
      if (focusTarget) {
        try { focusTarget.focus({ preventScroll: true }); } catch (e) { focusTarget.focus(); }
      }
    }
  }

  function closePresentationNav() {
    if (!state.navOpen) return;
    setPresentationNavOpen(false);
  }

  function togglePresentationNav() {
    setPresentationNavOpen(!state.navOpen);
    if (!state.navOpen && dom.navToggle) dom.navToggle.focus({ preventScroll: true });
  }

  function updatePresentationNav() {
    if (!dom.presentationNav) return;
    var idx = state.currentScene;

    if (dom.navBack) {
      var onFirst = idx <= 0;
      dom.navBack.disabled = onFirst;
      dom.navBack.hidden = onFirst;
      dom.navBack.setAttribute('aria-label', onFirst ? '' : 'Go to previous scene');
    }

    if (dom.navItems) {
      for (var i = 0; i < dom.navItems.length; i++) {
        var btn = dom.navItems[i];
        if (!btn) continue;
        var isCurrent = i === idx;
        btn.classList.toggle('is-current', isCurrent);
        btn.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      }
    }
  }

  function buildPresentationNavList() {
    if (!dom.navList) return;
    dom.navList.innerHTML = '';
    dom.navItems = [];
    var labels = state.navLabels || SECTION_NAV_FALLBACKS;

    for (var i = 0; i < TOTAL_SECTIONS; i++) {
      var li = document.createElement('li');
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'presentation-nav__item';
      item.setAttribute('data-scene', String(i));
      item.textContent = labels[i] || SECTION_NAV_FALLBACKS[i] || ('Scene ' + (i + 1));
      item.setAttribute('aria-label', 'Go to ' + item.textContent);
      dom.navItems.push(item);
      li.appendChild(item);
      dom.navList.appendChild(li);
    }
  }

  function setupPresentationNav() {
    dom.presentationNav = document.getElementById('presentation-nav');
    dom.navToggle = $('.presentation-nav__toggle');
    dom.navPanel = document.getElementById('presentation-nav-panel');
    dom.navBack = $('.presentation-nav__back');
    dom.navList = $('.presentation-nav__list');
    dom.navChipNum = $('.presentation-nav__chip-num');
    dom.navToggleSr = $('.presentation-nav__toggle-sr');
    dom.navItems = [];

    if (!dom.presentationNav || !dom.navToggle || !dom.navPanel) return;

    state.navLabels = deriveNavLabels(state.data);
    buildPresentationNavList();
    updatePresentationNav();

    dom.navToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      sound('select');
      togglePresentationNav();
    });

    if (dom.navBack) {
      dom.navBack.addEventListener('click', function () {
        if (state.currentScene <= 0) return;
        sound('select');
        closePresentationNav();
        goToScene(state.currentScene - 1);
      });
    }

    dom.navList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-scene]');
      if (!btn || !dom.navList.contains(btn)) return;
      var idx = parseInt(btn.getAttribute('data-scene'), 10);
      if (isNaN(idx) || idx < 0 || idx >= TOTAL_SECTIONS) return;
      sound('select');
      closePresentationNav();
      goToScene(idx);
    });

    document.addEventListener('click', function (e) {
      if (!state.navOpen || !dom.presentationNav) return;
      if (dom.presentationNav.contains(e.target)) return;
      closePresentationNav();
    });
  }

  /** Toggle .is-active on scene sections (presentation deck). */
  function activateSceneSlide(idx) {
    for (var i = 0; i < TOTAL_SECTIONS; i++) {
      var sec = document.getElementById(SECTION_IDS[i]);
      if (!sec) continue;
      if (i === idx) sec.classList.add('is-active');
      else sec.classList.remove('is-active');
    }
  }

  /** Soft leaf wipe, then swap the active scene. */
  function goToScene(idx, opts) {
    opts = opts || {};
    if (idx < 0 || idx >= TOTAL_SECTIONS) return;
    if (idx === state.currentScene && !opts.force) return;
    if (state.sceneTransitioning) return;

    var apply = function () {
      activateSceneSlide(idx);
      enterScene(idx);
      if (!opts.silent) sound('select');
    };

    if (state.reducedMotion || opts.instant) {
      apply();
      return;
    }

    state.sceneTransitioning = true;
    var wipe = dom.sceneWipe || document.getElementById('scene-wipe');
    if (!wipe) {
      apply();
      state.sceneTransitioning = false;
      return;
    }

    wipe.hidden = false;
    wipe.setAttribute('aria-hidden', 'false');
    /* force reflow so transition runs */
    void wipe.offsetWidth;
    wipe.classList.add('is-on');

    setTimeout(function () {
      apply();
      wipe.classList.remove('is-on');
      setTimeout(function () {
        wipe.hidden = true;
        wipe.setAttribute('aria-hidden', 'true');
        state.sceneTransitioning = false;
      }, WIPE_HALF_MS);
    }, WIPE_HALF_MS);
  }

  function scrollToScene(idx) {
    goToScene(idx);
  }

  /**
   * Primary advance (A / Space / Enter): click the on-screen A button
   * when one is visible, otherwise surprise → opening dialogue → next scene.
   */
  function isAdvanceKey(e) {
    var key = e.key;
    var code = e.code || '';
    return key === ' ' || key === 'Spacebar' || code === 'Space' ||
           key === 'Enter' || code === 'Enter' ||
           key === 'a' || key === 'A' || code === 'KeyA';
  }

  function clickVisibleAdvanceButton() {
    if (state.mailInterruptOpen) {
      var mailBtn = document.querySelector('#mail-interrupt:not([hidden]) [data-mail-open]');
      if (mailBtn) {
        openMailSurprise();
        return true;
      }
    }
    if (state.surpriseOpened) {
      var surpriseBtn = document.querySelector('#surprise-popup:not([hidden]) [data-surprise-next]');
      if (surpriseBtn) {
        surpriseBtn.click();
        return true;
      }
    }
    if (state.currentScene === 0) {
      var openBtn = document.querySelector('#opening.is-active [data-opening-next], #opening.is-active .opening__prompt');
      if (!openBtn) {
        openBtn = document.querySelector('#opening [data-opening-next], #opening .opening__prompt');
      }
      if (openBtn) {
        openBtn.click();
        return true;
      }
    }
    return false;
  }

  function advancePrimary() {
    if (state.photoViewerOpen) {
      stepPhotoViewer(1);
      return true;
    }
    if (clickVisibleAdvanceButton()) return true;
    if (state.mailInterruptOpen) {
      openMailSurprise();
      return true;
    }
    if (state.surpriseOpened) {
      advanceSurpriseBeat();
      return true;
    }
    if (state.currentScene === 0) {
      if (advanceOpeningDialogue()) return true;
    }
    if (state.currentScene < TOTAL_SECTIONS - 1) {
      scrollToScene(state.currentScene + 1);
      return true;
    }
    return false;
  }

  function handleKeyDown(e) {
    var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
    var isTextField = (tag === 'input' || tag === 'textarea' || tag === 'select' ||
                       (document.activeElement && document.activeElement.isContentEditable));
    var key = e.key;
    var code = e.code || '';

    if (e.altKey || e.ctrlKey || e.metaKey) return;

    /* Start gate */
    if (!state.startGateDismissed) {
      if (isAdvanceKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        startMenuMusic();
        dismissStartGate();
      } else {
        /* Any other key still unlocks AudioContext + BGM on the menu */
        startMenuMusic();
      }
      return;
    }

    if (isTextField) return;

    if (key === 'Escape' || code === 'Escape') {
      if (dom.audioSettingsPanel && !dom.audioSettingsPanel.hidden) {
        e.preventDefault();
        e.stopPropagation();
        setAudioSettingsOpen(false);
        return;
      }
      if (state.photoViewerOpen) {
        e.preventDefault();
        e.stopPropagation();
        closePhotoViewer();
        return;
      }
      if (state.navOpen) {
        e.preventDefault();
        e.stopPropagation();
        closePresentationNav();
        if (dom.navToggle) dom.navToggle.focus({ preventScroll: true });
      }
      return;
    }

    /* X opens audio settings (Y still mute-all shortcut) */
    if (code === 'KeyX' || key === 'x' || key === 'X') {
      e.preventDefault();
      e.stopPropagation();
      if (dom.audioSettingsPanel) {
        setAudioSettingsOpen(!!dom.audioSettingsPanel.hidden);
      }
      return;
    }
    if (code === 'KeyY' || key === 'y' || key === 'Y') {
      e.preventDefault();
      e.stopPropagation();
      toggleMute();
      return;
    }

    if (code === 'ArrowRight' || key === 'ArrowRight' ||
        code === 'PageDown' || key === 'PageDown') {
      e.preventDefault();
      if (state.photoViewerOpen) stepPhotoViewer(1);
      else if (state.surpriseOpened) advanceSurpriseBeat();
      else if (state.currentScene < TOTAL_SECTIONS - 1) scrollToScene(state.currentScene + 1);
      return;
    }

    if (code === 'ArrowLeft' || key === 'ArrowLeft' ||
        code === 'PageUp' || key === 'PageUp' ||
        code === 'KeyB' || key === 'b' || key === 'B') {
      e.preventDefault();
      if (state.photoViewerOpen) {
        if (code === 'KeyB' || key === 'b' || key === 'B') closePhotoViewer();
        else stepPhotoViewer(-1);
      } else if (state.surpriseOpened) {
        retreatSurpriseBeat();
      } else if (state.mailInterruptOpen) {
        sound('cancel');
        clearSavingSequence();
        clearMailInterrupt();
        if (state.currentScene > 0) scrollToScene(state.currentScene - 1);
      } else if (state.currentScene > 0) {
        closePresentationNav();
        scrollToScene(state.currentScene - 1);
      }
      return;
    }

    if (isAdvanceKey(e)) {
      /* Focused mute / edit controls must not be stolen by A/Space advance */
      var ae = document.activeElement;
      if (ae && ae.closest && ae.closest('.audio-settings, .sound-toggle, .edit-link, .site-controls a, .presentation-nav')) {
        if (ae.closest('.audio-settings__toggle, .sound-toggle')) {
          e.preventDefault();
          e.stopPropagation();
          if (dom.audioSettingsPanel) setAudioSettingsOpen(!!dom.audioSettingsPanel.hidden);
        }
        return;
      }
      /* Capture Space before focused A buttons swallow it; still "press A". */
      e.preventDefault();
      e.stopPropagation();
      advancePrimary();
    }
  }

  /* ================================================================
     START GATE
     ================================================================ */

  function dismissStartGate() {
    if (state.startGateDismissed) return;
    state.startGateDismissed = true;

    /* Music may already be running from start-menu gesture */
    try {
      if (window.ACSound && typeof ACSound.init === 'function') {
        ACSound.init();
        loadAudioChannelPrefs();
        if (typeof ACSound.setMuted === 'function') ACSound.setMuted(state.muted);
        if (!state.muted && typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
        /* First 3s of intro: BGM + talk only; SFX resume after */
        muteIntroSfxBriefly();
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

    /* Show presentation controls + scene nav */
    if (dom.siteControls) {
      dom.siteControls.hidden = false;
      dom.siteControls.classList.remove('is-on-start');
    }
    if (dom.presentationNav) dom.presentationNav.hidden = false;

    /* Begin opening sequence */
    state.presentationActive = true;
    startClock();
    updateSceneIndicator();

    /* Enter the opening scene as the first deck slide */
    goToScene(0, { instant: true, silent: true, force: true });

    /* ACNH talk: type the morning announcement with blips */
    setTimeout(function () { startOpeningLineTypewriter(); }, state.reducedMotion ? 0 : 280);

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
    var els = $$('body > header, body > main, body > footer, .site-controls, .presentation-nav');
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

    /* Show settings on the start menu (bottom-right) so music can be heard here. */
    if (dom.siteControls) {
      dom.siteControls.hidden = false;
      dom.siteControls.classList.add('is-on-start');
    }

    /* Any gesture on the start menu starts BGM — gate stays until Press A. */
    function armMenuMusic(e) {
      startMenuMusic();
    }
    gate.addEventListener('pointerdown', armMenuMusic);
    gate.addEventListener('touchstart', armMenuMusic, { passive: true });
    gate.addEventListener('keydown', armMenuMusic, true);

    var btn = $('.start-gate__button', gate);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startMenuMusic();
        dismissStartGate();
      });
    }

    /* Clicking the green backdrop only wakes music — does NOT enter the island. */
    gate.addEventListener('click', function (e) {
      if (e.target === btn || (btn && btn.contains(e.target))) return;
      if (e.target.closest && e.target.closest('.site-controls, .audio-settings')) return;
      e.preventDefault();
      startMenuMusic();
    });

    /* Keys (Enter / Space / A) dismiss via handleKeyDown. */

    if (!state.startGateDismissed) {
      /* Keep site-controls interactive on the start menu */
      setBackgroundInert(true);
      if (dom.siteControls) {
        dom.siteControls.removeAttribute('inert');
        dom.siteControls.removeAttribute('aria-hidden');
      }
      if (btn) {
        try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
      }
    }
  }

  /* ================================================================
     AUDIO SETTINGS (music / dialogue / sfx)
     ================================================================ */

  function loadAudioChannelPrefs() {
    try {
      if (!window.ACSound || typeof ACSound.setChannel !== 'function') return;
      ['music', 'dialogue', 'sfx'].forEach(function (name) {
        var raw = storageGet('audio_' + name, 'true');
        ACSound.setChannel(name, raw !== 'false');
      });
      if (storageGet('muted', 'false') === 'true') {
        state.muted = true;
        if (typeof ACSound.setMuted === 'function') ACSound.setMuted(true);
      }
    } catch (e) {}
  }

  function syncAudioSettingsUI() {
    var panel = dom.audioSettingsPanel || document.getElementById('audio-settings-panel');
    if (!panel || !window.ACSound || typeof ACSound.getChannels !== 'function') return;
    var ch = ACSound.getChannels();
    var boxes = panel.querySelectorAll('[data-audio-channel]');
    for (var i = 0; i < boxes.length; i++) {
      var name = boxes[i].getAttribute('data-audio-channel');
      boxes[i].checked = !!ch[name];
    }
    var muteBtn = panel.querySelector('[data-audio-mute-all]');
    if (muteBtn) {
      muteBtn.textContent = state.muted ? 'Unmute all' : 'Mute all';
    }
  }

  function setAudioSettingsOpen(open) {
    var panel = dom.audioSettingsPanel;
    var toggle = dom.audioSettingsToggle;
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function toggleMute() {
    var turningOff = !state.muted;
    state.muted = !state.muted;
    storageSet('muted', String(state.muted));
    try {
      if (!window.ACSound) return;
      if (turningOff) {
        if (typeof ACSound.setMuted === 'function') ACSound.setMuted(true);
        if (state.startGateDismissed && typeof ACSound.stopAmbient === 'function') {
          /* keep bed paused under master mute; restart on unmute */
          if (typeof ACSound.isAmbientRunning === 'function' && ACSound.isAmbientRunning()) {
            state._bgmWasRunning = true;
          }
          ACSound.stopAmbient();
        }
      } else {
        if (typeof ACSound.setMuted === 'function') ACSound.setMuted(false);
        if (typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
      }
    } catch (e) {}
    syncAudioSettingsUI();
  }

  function setupMuteToggle() {
    loadAudioChannelPrefs();
    syncAudioSettingsUI();

    var toggle = dom.audioSettingsToggle;
    var panel = dom.audioSettingsPanel;
    if (!toggle || !panel) return;

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setAudioSettingsOpen(panel.hidden);
    });

    panel.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    panel.addEventListener('change', function (e) {
      var input = e.target.closest('[data-audio-channel]');
      if (!input || !window.ACSound || typeof ACSound.setChannel !== 'function') return;
      var name = input.getAttribute('data-audio-channel');
      var on = !!input.checked;
      storageSet('audio_' + name, String(on));
      ACSound.setChannel(name, on);
      if (name === 'music' && on && !state.muted) {
        if (typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
      }
    });

    var muteAll = panel.querySelector('[data-audio-mute-all]');
    if (muteAll) {
      muteAll.addEventListener('click', function (e) {
        e.preventDefault();
        toggleMute();
      });
    }

    document.addEventListener('click', function (e) {
      if (!panel || panel.hidden) return;
      if (dom.audioSettings && dom.audioSettings.contains(e.target)) return;
      setAudioSettingsOpen(false);
    });
  }

  function updateMuteUI() {
    syncAudioSettingsUI();
  }

  /** Start BGM on the start menu. Retries if autoplay was blocked. */
  function startMenuMusic() {
    try {
      if (!window.ACSound) return;
      if (typeof ACSound.init === 'function') ACSound.init();
      loadAudioChannelPrefs();
      if (state.muted) {
        state.menuMusicStarted = true;
        return;
      }
      var running = typeof ACSound.isAmbientRunning === 'function' && ACSound.isAmbientRunning();
      if (running) {
        state.menuMusicStarted = true;
        return;
      }
      if (typeof ACSound.startAmbient === 'function') ACSound.startAmbient();
      state.menuMusicStarted = true;
    } catch (e) {}
  }

  /* ================================================================
     SCENE DETECTION (IntersectionObserver for current scene)
     ================================================================ */

  function enterScene(idx) {
    if (idx < 0 || idx >= TOTAL_SECTIONS) return;
    var prev = state.currentScene;
    closePresentationNav();
    state.currentScene = idx;
    updateSceneIndicator();
    activateSceneSlide(idx);

    /* Opening owns the lower third — park chrome top-right while there */
    if (idx === 0) {
      document.body.classList.add('is-on-opening');
      if (prev !== 0) resetOpeningDialogueState(true);
    } else {
      document.body.classList.remove('is-on-opening');
    }

    /* Leaving reveal: cancel pending Saving / mail interrupt */
    if (prev === TOTAL_SECTIONS - 1 && idx !== prev) {
      clearSavingSequence();
      clearMailInterrupt();
      closeSurprisePopup();
    }

    if (state.photoViewerOpen && SECTION_IDS[idx] !== 'gallery') {
      closePhotoViewer();
    }

    /* Call the section's enter() if it exists */
    var key = SECTION_IDS[idx];
    if (window.ACSections && ACSections[key] && typeof ACSections[key].enter === 'function') {
      try {
        ACSections[key].enter();
      } catch (e) { /* section code is defensive */ }
    }

    /* Reveal scene: timed Saving → surprise popup (not in-page scroll) */
    if (key === 'reveal') {
      startSavingSequence();
    }
  }

  /**
   * Deck presentation changes scenes via goToScene only — no scroll tracking.
   */
  function setupSceneTracking() {
    /* no-op under deck presentation; kept for API compatibility */
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
     REVEAL: Saving hold → fade → paper plane → surprise popup
     ================================================================ */

  function clearSavingSequence() {
    if (state.savingTimer) {
      clearTimeout(state.savingTimer);
      state.savingTimer = null;
    }
    var saving = $('[data-reveal-beat="1"]');
    if (saving) {
      saving.classList.remove('is-hold', 'is-fade', 'is-in');
    }
  }

  var MAIL_FLIGHT_DURATION_MS = 5200;
  var MAIL_FLIGHT_TANGENT_EPS = 0.006;

  function cancelMailFlight() {
    if (state.mailFlightRaf) {
      cancelAnimationFrame(state.mailFlightRaf);
      state.mailFlightRaf = null;
    }
  }

  /** Clock t → path: bob cruise, then ease-out skid into center (last 24%). */
  function mailFlightPathT(t) {
    var cruiseEnd = 0.76;
    if (t <= cruiseEnd) return (t / cruiseEnd) * 0.76;
    var u = (t - cruiseEnd) / (1 - cruiseEnd);
    var eased = 1 - Math.pow(1 - u, 2.8);
    return 0.76 + eased * 0.24;
  }

  /**
   * Keep paper-plane right-side-up: face with scaleX, pitch only ±14°.
   * Full 360 rotate flips the shaded top (looks upside-down).
   */
  function mailFlightAttitude(dx, dy, rawT) {
    var facingLeft = dx < 0;
    var pitch = Math.atan2(dy, Math.abs(dx) + 0.0001) * (180 / Math.PI);
    if (pitch > 14) pitch = 14;
    if (pitch < -14) pitch = -14;
    /* Skid: flatten into a slight nose-up stop */
    if (rawT > 0.8) {
      var u = (rawT - 0.8) / 0.2;
      u = u * u;
      pitch = pitch * (1 - u) + (-6) * u;
    }
    return { flip: facingLeft ? -1 : 1, pitch: pitch };
  }

  function mailFlightTransform(flip, pitch) {
    return 'translate(-50%, -50%) scaleX(' + flip + ') rotate(' + pitch + 'deg)';
  }

  /**
   * rAF along #mail-flight-path: side entry → bob → skid center.
   * Asset nose = +x; leftward flight = scaleX(-1), not rotate 180.
   */
  function animateMailFlight(plane, craft, onComplete) {
    var path = document.getElementById('mail-flight-path');
    if (!path || !plane) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    cancelMailFlight();
    var totalLen = path.getTotalLength();
    var startTs = null;
    var lastAttitude = { flip: -1, pitch: -8 };

    function frame(ts) {
      if (!state.mailInterruptOpen) {
        cancelMailFlight();
        return;
      }
      if (!startTs) startTs = ts;
      var rawT = Math.min((ts - startTs) / MAIL_FLIGHT_DURATION_MS, 1);
      var pathT = mailFlightPathT(rawT);
      var len = pathT * totalLen;
      var look = totalLen * MAIL_FLIGHT_TANGENT_EPS;
      var pt, pt2;
      if (len + look <= totalLen) {
        pt = path.getPointAtLength(len);
        pt2 = path.getPointAtLength(len + look);
      } else {
        pt = path.getPointAtLength(Math.max(0, totalLen - look));
        pt2 = path.getPointAtLength(totalLen);
      }

      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var x = (pt.x / 100) * vw;
      var y = (pt.y / 100) * vh;
      if (len + look > totalLen) {
        var ptNow = path.getPointAtLength(len);
        x = (ptNow.x / 100) * vw;
        y = (ptNow.y / 100) * vh;
      }
      var dx = (pt2.x - pt.x) * vw;
      var dy = (pt2.y - pt.y) * vh;
      var attitude = mailFlightAttitude(dx, dy, rawT);
      lastAttitude = attitude;

      var opacity = rawT <= 0.06 ? rawT / 0.06 : 1;
      var scale = 0.88 + 0.12 * Math.min(rawT / 0.18, 1);

      plane.style.left = x + 'px';
      plane.style.top = y + 'px';
      plane.style.opacity = String(opacity);
      plane.style.transform = mailFlightTransform(attitude.flip, attitude.pitch);
      if (craft) craft.style.transform = 'scale(' + scale + ')';

      if (rawT < 1) {
        state.mailFlightRaf = requestAnimationFrame(frame);
      } else {
        state.mailFlightRaf = null;
        if (typeof onComplete === 'function') onComplete(lastAttitude);
      }
    }

    state.mailFlightRaf = requestAnimationFrame(frame);
  }

  function clearMailInterrupt() {
    if (state.mailLandTimer) {
      clearTimeout(state.mailLandTimer);
      state.mailLandTimer = null;
    }
    cancelMailFlight();
    state.mailInterruptOpen = false;
    var mail = document.getElementById('mail-interrupt');
    if (!mail) return;
    mail.hidden = true;
    mail.setAttribute('aria-hidden', 'true');
    mail.classList.remove('is-on', 'is-landed');
    var hint = mail.querySelector('[data-mail-hint]');
    if (hint) hint.hidden = true;
    var plane = mail.querySelector('[data-mail-open]');
    var craft = mail.querySelector('.mail-interrupt__craft');
    if (plane) {
      plane.style.left = '';
      plane.style.top = '';
      plane.style.opacity = '';
      plane.style.transform = '';
    }
    if (craft) craft.style.transform = '';
  }

  function showMailInterrupt() {
    clearMailInterrupt();
    var mail = document.getElementById('mail-interrupt');
    if (!mail) {
      openSurprisePopup();
      return;
    }

    state.mailInterruptOpen = true;
    mail.hidden = false;
    mail.setAttribute('aria-hidden', 'false');
    /* Restart fly animation cleanly */
    void mail.offsetWidth;
    mail.classList.add('is-on');

    var plane = mail.querySelector('[data-mail-open]');
    var hint = mail.querySelector('[data-mail-hint]');
    var C = window.ACContent;
    if (hint) {
      hint.textContent = (C && C.get('reveal.mail.hint')) || 'Tap the letter!';
      hint.hidden = false;
    }

    var craft = mail.querySelector('.mail-interrupt__craft');
    var landAttitude = { flip: -1, pitch: -6 };

    function land(finalAttitude) {
      if (!state.mailInterruptOpen) return;
      cancelMailFlight();
      if (finalAttitude && typeof finalAttitude.flip === 'number') {
        landAttitude = finalAttitude;
      }
      mail.classList.add('is-landed');
      if (plane) {
        plane.style.left = '50%';
        plane.style.top = '50%';
        plane.style.opacity = '1';
        plane.style.transform = mailFlightTransform(landAttitude.flip, landAttitude.pitch);
      }
      if (craft) craft.style.transform = '';
      sound('confirm');
      if (plane) {
        try { plane.focus({ preventScroll: true }); } catch (_) {}
      }
    }

    if (state.reducedMotion) {
      land(landAttitude);
    } else if (plane) {
      var done = false;
      function finishFlight(finalAttitude) {
        if (done) return;
        done = true;
        if (state.mailLandTimer) {
          clearTimeout(state.mailLandTimer);
          state.mailLandTimer = null;
        }
        land(finalAttitude);
      }
      animateMailFlight(plane, craft, finishFlight);
      state.mailLandTimer = setTimeout(function () {
        state.mailLandTimer = null;
        finishFlight(landAttitude);
      }, MAIL_FLIGHT_DURATION_MS + 100);
    } else {
      land(landAttitude);
    }

    if (plane && !plane._acMailBound) {
      plane._acMailBound = true;
      plane.addEventListener('click', function (e) {
        e.preventDefault();
        openMailSurprise();
      });
    }
  }

  function openMailSurprise() {
    if (!state.mailInterruptOpen && !document.getElementById('mail-interrupt')) {
      openSurprisePopup();
      return;
    }
    clearMailInterrupt();
    sound('select');
    openSurprisePopup();
  }

  function closeSurprisePopup() {
    var popup = dom.surprisePopup || document.getElementById('surprise-popup');
    if (!popup) return;
    popup.classList.remove('is-in');
    popup.hidden = true;
    popup.setAttribute('aria-hidden', 'true');
    state.surpriseOpened = false;
    state.surpriseBeatIndex = 0;
    state.surpriseBeats = [];
    var body = popup.querySelector('[data-surprise-body]');
    if (body) body.textContent = '';
    var conf = popup.querySelector('[data-surprise-confetti]');
    if (conf) conf.textContent = '';
  }

  function updateSurpriseProgress() {
    var popup = dom.surprisePopup || document.getElementById('surprise-popup');
    if (!popup) return;
    var prog = popup.querySelector('[data-surprise-progress]');
    var label = popup.querySelector('[data-surprise-next-label]');
    var backBtn = popup.querySelector('[data-surprise-back]');
    var total = state.surpriseBeats.length || 1;
    var cur = Math.min(state.surpriseBeatIndex + 1, total);
    if (prog) prog.textContent = cur + ' / ' + total;
    if (label) {
      var C = window.ACContent;
      var nextTxt = (C && C.get('ui.next')) || 'Next';
      var doneTxt = (C && C.get('ui.replay')) || 'Play it again';
      label.textContent = (state.surpriseBeatIndex >= total - 1) ? doneTxt : nextTxt;
    }
    if (backBtn) {
      /* Always offer Back — on first beat it exits to the prior deck scene. */
      backBtn.hidden = false;
      backBtn.disabled = false;
    }
  }

  function showSurpriseBeat(idx) {
    var beats = state.surpriseBeats;
    if (!beats.length) return;
    idx = Math.max(0, Math.min(idx, beats.length - 1));
    state.surpriseBeatIndex = idx;

    for (var i = 0; i < beats.length; i++) {
      if (i === idx) beats[i].classList.add('is-show');
      else beats[i].classList.remove('is-show');
    }
    updateSurpriseProgress();

    var beat = beats[idx];
    var num = beat.getAttribute('data-reveal-beat');
    if (num === '2') {
      sound('select');
      triggerAnnouncementTypewriter(beat);
    } else if (num === '3') {
      sound('select');
      setTimeout(function () { sound('stamp'); }, state.reducedMotion ? 0 : 400);
      setTimeout(function () { sound('fanfare'); }, state.reducedMotion ? 150 : 900);
    } else if (num === '4') {
      sound('select');
    } else if (num === '5') {
      sound('fanfare');
    } else {
      sound('select');
    }
  }

  function retreatSurpriseBeat() {
    if (!state.surpriseOpened) return false;
    if (state.surpriseBeatIndex <= 0) {
      /* Leave surprise → previous deck scene (gallery) */
      sound('cancel');
      clearSavingSequence();
      clearMailInterrupt();
      closeSurprisePopup();
      if (state.currentScene > 0) scrollToScene(state.currentScene - 1);
      return true;
    }
    showSurpriseBeat(state.surpriseBeatIndex - 1);
    return true;
  }

  function advanceSurpriseBeat() {
    if (!state.surpriseOpened) return false;
    var total = state.surpriseBeats.length;
    if (!total) return false;

    /* ACNH: A during talk skips to full line before advancing */
    var cur = state.surpriseBeats[state.surpriseBeatIndex];
    if (cur) {
      var typingLine = $('.reveal__line', cur) || $('[data-typing]', cur);
      if (isTyping(typingLine)) {
        skipTyping(typingLine);
        var box = typingLine && typingLine.closest('.ac-box');
        if (box) box.classList.add('is-done');
        return true;
      }
    }

    if (state.surpriseBeatIndex < total - 1) {
      showSurpriseBeat(state.surpriseBeatIndex + 1);
      return true;
    }

    /* Last beat: replay the Saving → surprise sequence */
    sound('select');
    resetRevealChain();
    return true;
  }

  function openSurprisePopup() {
    if (state.surpriseOpened) return;
    var popup = dom.surprisePopup || document.getElementById('surprise-popup');
    var revealRoot = document.getElementById('reveal');
    if (!popup || !revealRoot) return;

    var body = popup.querySelector('[data-surprise-body]');
    var conf = popup.querySelector('[data-surprise-confetti]');
    if (!body) return;
    body.textContent = '';
    state.surpriseBeats = [];

    /* Announcement → Nook Miles achievement (skip letter + finale) */
    var beatOrder = [2, 3];
    for (var bi = 0; bi < beatOrder.length; bi++) {
      var i = beatOrder[bi];
      var beat = $('[data-reveal-beat="' + i + '"]', revealRoot);
      if (!beat) continue;
      var clone = beat.cloneNode(true);
      clone.hidden = false;
      clone.removeAttribute('aria-hidden');
      clone.classList.add('is-in');
      clone.classList.remove('is-show');
      clone.removeAttribute('style');
      /* Popup owns chrome — drop nested replay/confetti from clones */
      var nestedReplay = clone.querySelectorAll('.reveal__replay, [data-replay], .rv-replay');
      for (var r = 0; r < nestedReplay.length; r++) {
        if (nestedReplay[r].parentNode) nestedReplay[r].parentNode.removeChild(nestedReplay[r]);
      }
      var nestedConf = clone.querySelectorAll('.reveal__confetti, [data-confetti]');
      for (var n = 0; n < nestedConf.length; n++) {
        if (nestedConf[n].parentNode) nestedConf[n].parentNode.removeChild(nestedConf[n]);
      }
      body.appendChild(clone);
      state.surpriseBeats.push(clone);
    }

    popup.hidden = false;
    popup.setAttribute('aria-hidden', 'false');
    void popup.offsetWidth;
    popup.classList.add('is-in');
    state.surpriseOpened = true;

    sound('fanfare');
    if (conf) spawnConfetti(conf);

    showSurpriseBeat(0);

    var nextBtn = popup.querySelector('[data-surprise-next]');
    if (nextBtn) {
      try { nextBtn.focus({ preventScroll: true }); } catch (e) { nextBtn.focus(); }
    }
  }

  function startSavingSequence() {
    clearSavingSequence();
    clearMailInterrupt();
    closeSurprisePopup();
    state.surpriseOpened = false;

    var saving = $('[data-reveal-beat="1"]');
    if (!saving) {
      showMailInterrupt();
      return;
    }

    saving.classList.add('is-hold', 'is-in');
    saving.classList.remove('is-fade');
    sound('confirm');

    var hold = state.reducedMotion ? 400 : SAVING_HOLD_MS;
    var fade = state.reducedMotion ? 200 : SAVING_FADE_MS;

    state.savingTimer = setTimeout(function () {
      saving.classList.add('is-fade');
      state.savingTimer = setTimeout(function () {
        state.savingTimer = null;
        /* Paper plane interrupts the save — click opens announcement */
        showMailInterrupt();
      }, fade);
    }, hold);
  }

  function setupRevealChain() {
    var popup = document.getElementById('surprise-popup');
    if (popup && !popup._acBound) {
      popup._acBound = true;
      popup.addEventListener('click', function (e) {
        if (e.target.closest('[data-surprise-next]')) {
          e.preventDefault();
          pressButtonFeedback(e.target.closest('[data-surprise-next]'));
          advanceSurpriseBeat();
          return;
        }
        if (e.target.closest('[data-surprise-back]')) {
          e.preventDefault();
          pressButtonFeedback(e.target.closest('[data-surprise-back]'));
          retreatSurpriseBeat();
          return;
        }
        if (e.target.closest('[data-surprise-close]')) {
          /* Scrim close must not leave empty reveal — replay Saving */
          resetRevealChain();
        }
      });
    }
  }

  /* ================================================================
     SCRAPBOOK PHOTO VIEWER
     ================================================================ */

  function collectGalleryPhotos() {
    var C = window.ACContent;
    var raw = (C && C.get) ? C.get('gallery.photos') : [];
    var out = [];
    if (!Array.isArray(raw)) return out;
    for (var i = 0; i < raw.length; i++) {
      var ph = raw[i] || {};
      if (!ph.image || (C.isBlank && C.isBlank(ph.image))) continue;
      var src = C.fill ? C.fill(ph.image) : String(ph.image);
      if (!src) continue;
      var title = '';
      if (ph.caption && !(C.isBlank && C.isBlank(ph.caption))) {
        title = C.fill ? C.fill(ph.caption) : String(ph.caption);
      } else if (ph.alt && !(C.isBlank && C.isBlank(ph.alt))) {
        title = C.fill ? C.fill(ph.alt) : String(ph.alt);
      }
      out.push({ src: src, title: title, alt: title || '' });
    }
    return out;
  }

  function updatePhotoViewer() {
    var viewer = dom.photoViewer || document.getElementById('photo-viewer');
    if (!viewer) return;
    var items = state.photoViewerItems;
    var idx = state.photoViewerIndex;
    if (!items.length) return;
    idx = ((idx % items.length) + items.length) % items.length;
    state.photoViewerIndex = idx;
    var item = items[idx];
    var img = viewer.querySelector('[data-photo-img]');
    var title = viewer.querySelector('[data-photo-title]');
    var count = viewer.querySelector('[data-photo-count]');
    var prev = viewer.querySelector('[data-photo-prev]');
    var next = viewer.querySelector('[data-photo-next]');
    if (img) {
      img.src = item.src;
      img.alt = item.alt || item.title || '';
    }
    if (title) title.textContent = item.title || '';
    if (count) count.textContent = (idx + 1) + ' / ' + items.length;
    if (prev) prev.disabled = items.length < 2;
    if (next) next.disabled = items.length < 2;
  }

  function openPhotoViewer(idx, opener) {
    var viewer = dom.photoViewer || document.getElementById('photo-viewer');
    if (!viewer) return;
    state.photoViewerItems = collectGalleryPhotos();
    if (!state.photoViewerItems.length) return;
    state.photoViewerIndex = Math.max(0, Math.min(idx | 0, state.photoViewerItems.length - 1));
    state.photoViewerOpener = opener || null;
    state.photoViewerOpen = true;
    viewer.hidden = false;
    viewer.setAttribute('aria-hidden', 'false');
    void viewer.offsetWidth;
    viewer.classList.add('is-in');
    updatePhotoViewer();
    sound('select');
    var closeBtn = viewer.querySelector('[data-photo-close]');
    if (closeBtn) {
      try { closeBtn.focus({ preventScroll: true }); } catch (e) { closeBtn.focus(); }
    }
  }

  function closePhotoViewer() {
    var viewer = dom.photoViewer || document.getElementById('photo-viewer');
    if (!viewer) return;
    viewer.classList.remove('is-in');
    viewer.hidden = true;
    viewer.setAttribute('aria-hidden', 'true');
    state.photoViewerOpen = false;
    var opener = state.photoViewerOpener;
    state.photoViewerOpener = null;
    if (opener && typeof opener.focus === 'function') {
      try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); }
    }
  }

  function stepPhotoViewer(dir) {
    if (!state.photoViewerOpen || !state.photoViewerItems.length) return;
    state.photoViewerIndex += dir < 0 ? -1 : 1;
    updatePhotoViewer();
    sound('select');
  }

  function setupPhotoViewer() {
    var viewer = document.getElementById('photo-viewer');
    dom.photoViewer = viewer;
    if (!viewer || viewer._acBound) return;
    viewer._acBound = true;

    viewer.addEventListener('click', function (e) {
      if (e.target.closest('[data-photo-close]')) {
        e.preventDefault();
        closePhotoViewer();
        return;
      }
      if (e.target.closest('[data-photo-prev]')) {
        e.preventDefault();
        stepPhotoViewer(-1);
        return;
      }
      if (e.target.closest('[data-photo-next]')) {
        e.preventDefault();
        stepPhotoViewer(1);
      }
    });

    document.addEventListener('click', function (e) {
      var frame = e.target.closest('[data-photo-index]');
      if (!frame) return;
      var gallery = document.getElementById('gallery');
      if (!gallery || !gallery.contains(frame)) return;
      e.preventDefault();
      var idx = parseInt(frame.getAttribute('data-photo-index'), 10);
      if (isNaN(idx)) return;
      openPhotoViewer(idx, frame);
    });

    document.addEventListener('keydown', function (e) {
      if (!e.target || !e.target.closest) return;
      var frame = e.target.closest('[data-photo-index]');
      if (!frame) return;
      var gallery = document.getElementById('gallery');
      if (!gallery || !gallery.contains(frame)) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space' && e.code !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      var idx = parseInt(frame.getAttribute('data-photo-index'), 10);
      if (isNaN(idx)) return;
      openPhotoViewer(idx, frame);
    }, true);
  }

  function triggerBeat(num, el) {
    el.classList.add('is-in');
    switch (num) {
      case '2':
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
    var lineEl = $('.reveal__line', beatEl) || $('[data-typing]', beatEl);
    var boxEl = beatEl && (lineEl ? lineEl.closest('.ac-box') : $('.ac-box', beatEl));
    function revealDetail() {
      if (boxEl) boxEl.classList.add('is-done');
    }

    if (!lineEl) {
      revealDetail();
      return;
    }

    var raw = lineEl.getAttribute('data-typing');
    var segments = null;
    if (raw) {
      try { segments = JSON.parse(raw); } catch (e) { segments = null; }
    }

    if (boxEl) boxEl.classList.remove('is-done');

    if (!segments || !segments.length) {
      revealDetail();
      return;
    }

    /* Moving-up line: talk chirps; detail fades in when done */
    typewriter(lineEl, segments, 55, revealDetail);
  }

  /** Convert a rich-text DOM node into typewriter segments ({text, cls?}). */
  function domToTypeSegments(root) {
    var segments = [];
    if (!root) return segments;
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        var t = node.textContent || '';
        if (t) segments.push({ text: t });
        return;
      }
      if (node.nodeType !== 1) return;
      var cls = '';
      if (node.classList) {
        if (node.classList.contains('ac-hl')) cls = 'ac-hl';
        else if (node.classList.contains('ac-hl-g')) cls = 'ac-hl-g';
        else if (node.classList.contains('live-time')) cls = 'live-time';
        else if (node.classList.contains('live-weekday')) cls = 'live-weekday';
        else if (node.classList.contains('live-date')) cls = 'live-date';
      }
      if (cls) {
        segments.push({ text: node.textContent || '', cls: cls });
        return;
      }
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
    walk(root);
    return segments;
  }

  function isTyping(el) {
    return !!(el && el._acTypewriter && el.classList && el.classList.contains('ac-caret'));
  }

  function skipTyping(el) {
    if (el && el._acTypewriter && typeof el._acTypewriter.skip === 'function') {
      el._acTypewriter.skip();
      return true;
    }
    return false;
  }

  function pressButtonFeedback(btn) {
    if (!btn) return;
    btn.classList.remove('is-press');
    void btn.offsetWidth;
    btn.classList.add('is-press');
    setTimeout(function () { btn.classList.remove('is-press'); }, 160);
  }

  function spawnConfetti(beatEl) {
    if (state.reducedMotion) return;
    if (!beatEl) return;

    var container = null;
    if (beatEl.getAttribute && (
      beatEl.hasAttribute('data-surprise-confetti') ||
      beatEl.hasAttribute('data-confetti') ||
      (beatEl.classList && (beatEl.classList.contains('reveal__confetti') || beatEl.classList.contains('reveal-confetti')))
    )) {
      container = beatEl;
    } else {
      container = $('.reveal__confetti', beatEl) ||
                  $('.reveal-confetti', beatEl) ||
                  $('[data-confetti]', beatEl) ||
                  $('[data-surprise-confetti]', beatEl);
    }
    if (!container) return;

    container.textContent = '';

    /* Seedable PRNG for repeatable confetti layout */
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }

    for (var i = 0; i < 120; i++) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      var d = 4.5 + rnd() * 5.5;
      piece.style.setProperty('--x', (rnd() * 100).toFixed(2) + '%');
      piece.style.setProperty('--duration', d.toFixed(2) + 's');
      piece.style.setProperty('--delay', (-rnd() * d).toFixed(2) + 's');
      piece.style.setProperty('--sway', Math.round((rnd() - 0.5) * 140) + 'px');
      piece.setAttribute('aria-hidden', 'true');
      container.appendChild(piece);
    }
  }

  /** Reset reveal for replay */
  function resetRevealChain() {
    clearSavingSequence();
    clearMailInterrupt();
    closeSurprisePopup();
    startSavingSequence();
  }

  /* ================================================================
     REPLAY BUTTON
     ================================================================ */

  function setupReplay() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.reveal__replay, .rv-replay, [data-replay]');
      if (!btn) return;
      e.preventDefault();
      sound('select');
      resetRevealChain();
    });
  }

  /* ================================================================
     OPENING DIALOGUE ADVANCE
     ================================================================ */

  var openingDialogue = {
    index: -1,   /* -1 = announcement only; 0+ = revealed dialogue lines */
    done: false,
    typing: false
  };

  function resetOpeningDialogueState(rerender) {
    openingDialogue.index = -1;
    openingDialogue.done = false;
    openingDialogue.typing = false;
    if (!rerender) return;
    var root = document.getElementById('opening');
    if (!root || !window.ACSections || !ACSections.opening || !window.ACContent) return;
    try {
      ACSections.opening.render(root, state.data, ACContent);
    } catch (e) { return; }
    var prompt = $('[data-opening-next], .opening__prompt', root);
    if (prompt && !prompt._acBound) {
      prompt._acBound = true;
      prompt.addEventListener('click', function (ev) {
        ev.preventDefault();
        pressButtonFeedback(prompt);
        advanceOpeningDialogue();
      });
    }
    startOpeningLineTypewriter();
  }

  /** Type the current [data-opening-line] contents with talk blips. */
  function startOpeningLineTypewriter() {
    var root = document.getElementById('opening');
    if (!root) return;
    var lineEl = $('[data-opening-line]', root);
    if (!lineEl || lineEl.classList.contains('is-empty')) return;

    var segments = domToTypeSegments(lineEl);
    if (!segments.length) return;

    openingDialogue.typing = true;
    /* Talk chirps + BGM; SFX gated by muteIntroSfxBriefly() */
    typewriter(lineEl, segments, 55, function () {
      openingDialogue.typing = false;
    });
  }

  /**
   * Reveal the next opening dialogue line inside the single dialogue
   * text slot (ACNH style — never stack lines). Returns true if handled.
   */
  function advanceOpeningDialogue() {
    var root = document.getElementById('opening');
    if (!root) return false;

    var lineEl = $('[data-opening-line]', root);
    var lines = $$('[data-opening-dialogue] .opening__dline', root);
    var prompt = $('[data-opening-next], .opening__prompt', root);
    var keepGoing = '';
    try {
      keepGoing = (window.ACContent && ACContent.get('ui.keepGoing')) || '';
    } catch (e) {}

    /* Mid-type: A skips to full line (no advance yet) */
    if (isTyping(lineEl) || openingDialogue.typing) {
      skipTyping(lineEl);
      openingDialogue.typing = false;
      sound('select');
      return true;
    }

    if (openingDialogue.done) {
      if (state.currentScene < TOTAL_SECTIONS - 1) {
        sound('select');
        scrollToScene(state.currentScene + 1);
        return true;
      }
      return false;
    }

    openingDialogue.index += 1;
    if (openingDialogue.index < lines.length && lineEl) {
      lineEl.classList.remove('is-empty');
      var src = lines[openingDialogue.index];
      var segments = domToTypeSegments(src);
      if (!segments.length) {
        lineEl.textContent = src.textContent || '';
        sound('select');
      } else {
        sound('select');
        openingDialogue.typing = true;
        typewriter(lineEl, segments, 55, function () {
          openingDialogue.typing = false;
        });
      }
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
    if (state.currentScene < TOTAL_SECTIONS - 1) {
      sound('select');
      scrollToScene(state.currentScene + 1);
      return true;
    }
    return false;
  }

  function setupOpeningDialogue() {
    openingDialogue.index = -1;
    openingDialogue.done = false;
    openingDialogue.typing = false;

    var root = document.getElementById('opening');
    if (!root) return;

    var prompt = $('[data-opening-next], .opening__prompt', root);
    if (!prompt || prompt._acBound) return;
    prompt._acBound = true;

    prompt.addEventListener('click', function (e) {
      e.preventDefault();
      pressButtonFeedback(prompt);
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
    dom.audioSettings  = $('.audio-settings');
    dom.audioSettingsToggle = $('.audio-settings__toggle');
    dom.audioSettingsPanel = document.getElementById('audio-settings-panel');
    dom.soundToggle    = $('.audio-settings__toggle'); /* legacy alias */
    dom.soundToggleLabel = $('.audio-settings__toggle-label');
    dom.soundToggleKey = $('.audio-settings__toggle .ac-key');
    dom.skipLink       = $('.skip-link');
    dom.main           = document.getElementById('main');
    dom.sceneWipe      = document.getElementById('scene-wipe');
    dom.surprisePopup  = document.getElementById('surprise-popup');
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
    if (dom.siteControls) dom.siteControls.hidden = true;
    if (dom.presentationNav) dom.presentationNav.hidden = true;

    /* Setup start gate */
    setupStartGate();

    /* Setup mute toggle */
    setupMuteToggle();

    /* Setup skip link */
    setupSkipLink();

    /* Collapsible scene nav */
    setupPresentationNav();

    /* Scrapbook full-photo lightbox */
    setupPhotoViewer();

    /* Keyboard navigation */
    document.addEventListener('keydown', handleKeyDown, true);
    /* Stop Space keyup from re-clicking a focused A button after we already advanced. */
    document.addEventListener('keyup', function (e) {
      if (!state.startGateDismissed && !state.surpriseOpened) return;
      var code = e.code || '';
      var key = e.key;
      if (code === 'Space' || key === ' ' || key === 'Spacebar' ||
          code === 'Enter' || key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

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
      if (dom.presentationNav) dom.presentationNav.hidden = false;
      startClock();
      goToScene(0, { instant: true, silent: true, force: true });
    }
  }

  /* ================================================================
     PUBLIC API (exposed for replay / section interaction)
     ================================================================ */

  window.ACApp = {
    /** Force the current scene to a given index (0-based). */
    goToScene: goToScene,

    /** Reset and replay the reveal chain. */
    replayReveal: function () {
      resetRevealChain();
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
