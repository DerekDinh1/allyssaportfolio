/* ============================================================
   Allyssa Portfolio — content loader
   Exposes window.ACContent, the interface assets/app.js expects.

   Contract (see docs/BUILD.md):
     ACContent.data        the parsed content/site.json
     ACContent.load()      -> Promise<data>
     ACContent.get(path)   dot-path lookup, '' when missing
     ACContent.fill(str, extra)  replace {tokens}
     ACContent.rich(str, extra)  -> DocumentFragment, *stars* become .ac-hl
     ACContent.isBlank(v)  true for null / '' / [] / all-empty object
     ACContent.liveStamp() {time, weekday, date} from the real clock

   Content is loaded with a RELATIVE path so the site works from a
   GitHub Pages subpath. If the fetch fails (e.g. opened over file://)
   the page still renders using empty defaults — never invented facts.
   ============================================================ */
(function () {
  'use strict';

  /* Structure mirrors content/site.json exactly, with every editable
     field empty. Used only when the real file cannot be fetched. */
  function emptyDefaults() {
    return {
      site: { title: "Allyssa's Island", tagline: '', name: '', son: '',
              portrait: 'assets/reference/allyssa-reference.jpg',
              portraitAlt: '', editUrl: '' },
      ui: { startPrompt: 'Press A to start', startHint: '', skipLink: 'Skip to content',
            next: 'Next', keepGoing: 'keep going', replay: 'Play it again',
            soundOn: 'Sound on', soundOff: 'Sound off', editLink: 'Edit content',
            emptyEntry: 'Waiting to be filled in', emptyPhoto: 'Photo coming soon',
            emptySection: 'Nothing here yet.' },
      opening: { speaker: '{name}', venue: '', announcement: '', dialogue: [] },
      dailyLife: { title: 'A Day in the Life', subtitle: '', entries: [] },
      stats: { title: 'Resident Stats', subtitle: '', items: [] },
      gallery: { title: 'Little Moments', subtitle: '', photos: [] },
      reveal: {
        years: '', startDate: '', jobTitle: '', employer: '',
        saving: { title: 'Saving...', note: '', aside: '' },
        announcement: { speaker: '', badge: '', line: '', detail: '' },
        achievement: { badge: '', stamp: '', title: '', detail: '',
                       ticketLabel: '', ticketValue: '' },
        letter: { greeting: '', lines: [], signature: '', ps: '', calendarLabel: '' },
        finale: { tag: '', line: '', detail: '' }
      }
    };
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  /* Deep-merge loaded data over the empty defaults so a partial or
     malformed JSON file can never produce undefined reads. */
  function merge(base, over) {
    if (!isObject(over)) return over === undefined ? base : over;
    var out = Array.isArray(base) ? base.slice() : {};
    if (!Array.isArray(base)) {
      for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    }
    for (var j in over) {
      if (!Object.prototype.hasOwnProperty.call(over, j)) continue;
      out[j] = isObject(base[j]) || Array.isArray(base[j]) ? merge(base[j], over[j]) : over[j];
    }
    return out;
  }

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  var data = emptyDefaults();

  function get(path) {
    var parts = String(path || '').split('.');
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return '';
      cur = cur[parts[i]];
    }
    return cur == null ? '' : cur;
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

  /* Unknown or empty tokens collapse to '' so no literal "{son}"
     can ever reach the screen. */
  function fill(s, extra) {
    var t = tokens();
    return str(s).replace(/\{(\w+)\}/g, function (_, k) {
      if (extra && typeof extra[k] === 'string') return extra[k];
      return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : '';
    });
  }

  /* *stars* -> <span class="ac-hl">. Built with DOM nodes only:
     CMS text is never assigned to innerHTML. */
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
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    return frag;
  }

  function isBlank(v) {
    if (v == null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) if (!isBlank(v[i])) return false;
      return true;
    }
    if (typeof v === 'object') {
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k) && !isBlank(v[k])) return false;
      }
      return true;
    }
    return false;
  }

  /* Real current date/time. October 4th is never converted to a Date,
     so no year is ever inferred for it. */
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function liveStamp() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var mer = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var pad = m < 10 ? '0' + m : String(m);
    var weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
    var month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                 'August', 'September', 'October', 'November', 'December'][d.getMonth()];
    return {
      time: h12 + ':' + pad + ' ' + mer,
      weekday: weekday,
      date: month + ' ' + ordinal(d.getDate())
    };
  }

  function load() {
    return fetch('content/site.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('content/site.json: HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        data = merge(emptyDefaults(), json || {});
        return data;
      })
      .catch(function (err) {
        /* file:// or a missing file: keep the empty defaults so every
           placeholder still renders. */
        if (window.console && console.warn) {
          console.warn('[ACContent] Could not load content/site.json; rendering empty placeholders.', err);
        }
        data = emptyDefaults();
        return data;
      });
  }

  window.ACContent = {
    get data() { return data; },
    load: load,
    get: get,
    fill: fill,
    rich: rich,
    isBlank: isBlank,
    liveStamp: liveStamp,
    tokens: tokens
  };
})();