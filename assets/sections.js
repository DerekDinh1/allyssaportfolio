/* ============================================================
   Allyssa Portfolio — section renderers
   Exposes window.ACSections.<key>.render(root, data, C)

   app.js calls render() for each section id. C is ACContent
   (or an equivalent shim) providing: fill(), rich(), isBlank(),
   liveStamp(), get(). CMS text is only ever written with
   textContent / DOM nodes — never innerHTML.

   Everything personal is EMPTY until the user fills it in.
   Empty fields render an inviting placeholder, never fake content.
   ============================================================ */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  }
  function card(cls, ph) {
    var n = el('div', cls || 'ac-card');
    if (ph) {
      n.classList.add('ac-empty');
      n.setAttribute('data-empty', '');
    }
    return n;
  }
  function heading(text, extraCls) {
    var h = el('h2', 'ac-heading' + (extraCls ? ' ' + extraCls : ''));
    h.appendChild(el('span', 'ac-leaf'));
    h.appendChild(el('span', 'ac-heading__text', text));
    h.setAttribute('aria-hidden', 'false');
    return h;
  }
  function subtitle(text) {
    if (!text) return null;
    return el('p', 'ac-scene__sub', text);
  }
  function emptyTag(text) {
    var t = el('span', 'ac-tag ac-tag--dashed', text || 'Waiting to be filled in');
    return t;
  }

  /** Decorative star field for daily / stats ambience layers. */
  function sceneStars(count) {
    var amb = el('div', 'scene-ambience scene-ambience--stars');
    amb.setAttribute('aria-hidden', 'true');
    var spots = [
      [8, 12], [22, 8], [38, 18], [55, 6], [72, 14], [88, 10],
      [15, 28], [45, 32], [68, 26], [92, 34]
    ];
    for (var i = 0; i < count; i++) {
      var star = el('span', 'scene-star');
      var spot = spots[i % spots.length];
      star.style.left = spot[0] + '%';
      star.style.top = spot[1] + '%';
      star.style.animationDelay = (i * 0.45) + 's';
      amb.appendChild(star);
    }
    return amb;
  }

  /** Slow-drifting sparkles for stats / gallery backgrounds. */
  function sceneSparkles(count) {
    var amb = el('div', 'scene-ambience scene-ambience--sparkles');
    amb.setAttribute('aria-hidden', 'true');
    var spots = [
      [12, 18], [28, 42], [52, 12], [74, 36], [90, 22], [36, 68], [62, 58]
    ];
    for (var i = 0; i < count; i++) {
      var spark = el('span', 'scene-sparkle');
      var spot = spots[i % spots.length];
      spark.style.left = spot[0] + '%';
      spark.style.top = spot[1] + '%';
      spark.style.animationDelay = (i * 0.8) + 's';
      spark.style.setProperty('--sparkle-drift', ((i % 2) ? -1 : 1) * (14 + (i % 3) * 6) + 'px');
      amb.appendChild(spark);
    }
    return amb;
  }

  function washiTape(side) {
    var tape = el('span', 'tape tape--' + side);
    tape.setAttribute('aria-hidden', 'true');
    return tape;
  }

  function addPetals(root, spots) {
    var petals = el('div', 'ac-petals');
    petals.setAttribute('aria-hidden', 'true');
    var pos = spots || [
      ['3%', '12%'], ['52%', '3%'], ['96%', '30%'], ['94%', '88%'], ['1%', '70%']
    ];
    for (var i = 0; i < pos.length; i++) {
      var petal = el('span', 'ac-petal');
      petal.style.left = pos[i][0];
      petal.style.top = pos[i][1];
      petals.appendChild(petal);
    }
    root.appendChild(petals);
  }

  function sceneKicker(num, total) {
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(num) + ' / ' + pad(total || 5);
  }

  var GALLERY_SCENES = ['sc-sun', 'sc-beach', 'sc-home', 'sc-park', 'sc-bath', 'sc-night'];

  /** Topic emoji from activity / ticket label keywords. */
  function topicIconFor(label) {
    var s = String(label || '').toLowerCase();
    if (/wake|morning|sunny|sleepy head/.test(s)) return '\u2600\uFE0F'; /* sun */
    /* Music before meal — "repeat" contains "eat" as a substring. */
    if (/rhyme|song|sung|sing|music|nursery|melody|lullaby/.test(s)) return '\uD83C\uDFB5'; /* music */
    if (/breakfast|brekky|egg|cereal|yogurt/.test(s)) return '\uD83E\uDD63'; /* breakfast */
    if (/lunch|dinner|meal|belly|\beat\b/.test(s)) return '\uD83C\uDF7D\uFE0F'; /* food */
    if (/snack|treat|food|cookie/.test(s)) return '\uD83C\uDF6A'; /* cookie */
    if (/walk|step|stroll/.test(s)) return '\uD83D\uDC63'; /* footprints */
    if (/play|block|toy/.test(s)) return '\uD83E\uDDF1'; /* brick */
    if (/nap|sleep|bed|night night|night/.test(s)) return '\uD83D\uDE34'; /* sleeping */
    if (/book|read|story/.test(s)) return '\uD83D\uDCD6'; /* open book */
    if (/laundry|wash|clothes/.test(s)) return '\uD83E\uDDFA'; /* basket */
    if (/caffeine|coffee|tea|espresso/.test(s)) return '\u2615'; /* hot beverage */
    if (/love|heart|hug/.test(s)) return '\uD83D\uDC96'; /* sparkling heart */
    return '\u2605'; /* star fallback */
  }

  function mileIconFor(label) { return topicIconFor(label); }

  /** Parse "October 5th" → { month, day, ord } for the calendar card. */
  function parseStartDate(raw) {
    var s = String(raw || '').trim();
    var m = /^([A-Za-z]+)\s+(\d+)([A-Za-z]*)$/.exec(s);
    if (!m) return { month: '', day: s, ord: '' };
    return {
      month: m[1].toUpperCase(),
      day: m[2],
      ord: (m[3] || '').toUpperCase()
    };
  }

  var S = (window.ACSections = window.ACSections || {});

  /* ---------------------------------------------------------- opening */
  S.opening = {
    render: function (root, data, C) {
      root.textContent = '';

      /* Full scene: Allyssa seated behind the desk (not in a picture frame). */
      var stage = el('div', 'opening__stage');
      stage.setAttribute('aria-hidden', 'true');
      var sceneImg = el('img', 'opening__scene');
      sceneImg.src = 'assets/opening-scene.png';
      sceneImg.alt = '';
      sceneImg.decoding = 'async';
      sceneImg.loading = 'eager';
      stage.appendChild(sceneImg);
      root.appendChild(stage);

      var petals = el('div', 'ac-petals');
      petals.setAttribute('aria-hidden', 'true');
      for (var p = 0; p < 8; p++) {
        var petal = el('span', 'ac-petal');
        petal.style.left = (8 + p * 11) + '%';
        petal.style.top = (10 + (p % 3) * 18) + '%';
        petal.style.animationDelay = (p * 0.55) + 's';
        petals.appendChild(petal);
      }
      root.appendChild(petals);

      var wrap = el('div', 'ac-wrap opening__wrap');
      var boxWrap = el('div', 'opening__box');
      var box = el('div', 'ac-box ac-box--dialog');
      var chip = el('span', 'ac-namechip', C.fill(C.get('opening.speaker')) || C.get('site.name') || '');
      box.appendChild(chip);

      var line = el('p', 'ac-box__text');
      line.setAttribute('data-opening-line', '');
      line.setAttribute('aria-live', 'polite');

      var announcement = C.get('opening.announcement');
      if (C.isBlank(announcement)) {
        line.appendChild(el('span', 'ac-empty-inline', 'Waiting to be filled in'));
        line.classList.add('is-empty');
      } else {
        var stamp = C.liveStamp();
        var marked = String(announcement)
          .replace(/\{time\}/g, '\u0001T\u0001')
          .replace(/\{weekday\}/g, '\u0001W\u0001')
          .replace(/\{date\}/g, '\u0001D\u0001');
        var filled = C.fill(marked);
        var chunks = filled.split(/(\u0001[TWD]\u0001|\*[^*]+\*)/g);
        for (var ci = 0; ci < chunks.length; ci++) {
          var chunk = chunks[ci];
          if (!chunk) continue;
          if (chunk === '\u0001T\u0001') {
            line.appendChild(el('span', 'live-time', stamp.time));
          } else if (chunk === '\u0001W\u0001') {
            line.appendChild(el('span', 'live-weekday', stamp.weekday));
          } else if (chunk === '\u0001D\u0001') {
            line.appendChild(el('span', 'live-date', stamp.date));
          } else if (chunk.charAt(0) === '*' && chunk.charAt(chunk.length - 1) === '*') {
            line.appendChild(el('span', 'ac-hl', chunk.slice(1, -1)));
          } else {
            line.appendChild(document.createTextNode(chunk));
          }
        }
      }
      box.appendChild(line);

      var lines = C.get('opening.dialogue');
      /* Hidden line bank — app.js swaps these into [data-opening-line] one at a time */
      var dlg = el('div', 'opening__dialogue');
      dlg.setAttribute('data-opening-dialogue', '');
      dlg.hidden = true;
      if (!C.isBlank(lines) && lines.length) {
        for (var i = 0; i < lines.length; i++) {
          if (C.isBlank(lines[i])) continue;
          var item = el('p', 'opening__dline');
          item.appendChild(C.rich(lines[i]));
          dlg.appendChild(item);
        }
      }
      box.appendChild(dlg);

      var prompt = el('button', 'ac-btn opening__prompt');
      prompt.type = 'button';
      prompt.setAttribute('data-opening-next', '');
      var key = el('span', 'ac-key ac-key--a', 'A');
      key.setAttribute('aria-hidden', 'true');
      prompt.appendChild(key);
      var nextLabel = el('span', null, C.get('ui.next') || 'Next');
      nextLabel.setAttribute('data-content-next', '');
      prompt.appendChild(nextLabel);
      box.appendChild(prompt);

      boxWrap.appendChild(box);
      wrap.appendChild(boxWrap);
      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- daily life */
  S.daily = {
    render: function (root, data, C) {
      root.textContent = '';
      addPetals(root);
      root.appendChild(sceneStars(10));

      var wrap = el('div', 'ac-wrap');
      var sheet = el('div', 'sheet');
      sheet.appendChild(washiTape('l'));
      sheet.appendChild(washiTape('r'));

      var head = el('header', 'day__head');
      var headMain = el('div');
      headMain.appendChild(el('p', 'day__kicker', sceneKicker(2)));
      headMain.appendChild(heading(C.get('dailyLife.title') || 'A Day in the Life'));
      var subText = C.get('dailyLife.subtitle');
      if (!C.isBlank(subText)) {
        var subP = el('p', 'day__sub');
        subP.appendChild(C.rich(subText));
        headMain.appendChild(subP);
      }
      head.appendChild(headMain);

      var entries = C.get('dailyLife.entries');
      var anyReal = false;
      if (Array.isArray(entries)) {
        for (var ei = 0; ei < entries.length; ei++) {
          var ee = entries[ei] || {};
          if (!(C.isBlank(ee.time) && C.isBlank(ee.title) && C.isBlank(ee.detail))) {
            anyReal = true;
            break;
          }
        }
      }

      if (!anyReal) {
        var note = el('p', 'day__note');
        var leafImg = el('img', 'day__leafimg');
        leafImg.src = 'assets/leaf.svg';
        leafImg.width = 40;
        leafImg.height = 40;
        leafImg.alt = '';
        note.appendChild(leafImg);
        var noteTxt = el('span');
        noteTxt.appendChild(el('b', null, 'Blank fields.'));
        noteTxt.appendChild(document.createTextNode(
          ' No routine has been assumed; add each activity and time after they are supplied.'));
        note.appendChild(noteTxt);
        head.appendChild(note);
      }
      sheet.appendChild(head);

      var list = el('ol', 'timeline');
      var slotCount = 0;

      if (Array.isArray(entries) && entries.length) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i] || {};
          var blank = C.isBlank(e.time) && C.isBlank(e.title) && C.isBlank(e.detail);
          if (!blank) anyReal = true;
          slotCount++;

          var liCls = 'moment ac-card reveal-on-scroll' + (blank ? ' ac-empty' : '');
          var li = el('li', liCls);
          li.setAttribute('data-reveal-on-scroll', '');

          var top = el('div', 'moment__top');
          var icon = el('div', 'moment__icon');
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = blank ? '\uFF0B' : topicIconFor(e.title || e.detail);
          top.appendChild(icon);

          var meta = el('div');
          var timeP = el('p', 'moment__time');
          if (C.isBlank(e.time)) {
            timeP.appendChild(document.createTextNode('Time: '));
            timeP.appendChild(el('span', null, 'Add time'));
          } else {
            timeP.textContent = C.fill(e.time);
          }
          meta.appendChild(timeP);

          if (C.isBlank(e.title)) {
            meta.appendChild(el('h3', 'moment__title ac-empty-inline', 'Activity: Add your fact'));
          } else {
            meta.appendChild(el('h3', 'moment__title', C.fill(e.title)));
          }
          top.appendChild(meta);
          li.appendChild(top);

          if (C.isBlank(e.detail)) {
            li.appendChild(el('p', 'moment__cap ac-empty-inline', 'Details: Add your fact'));
          } else {
            li.appendChild(el('p', 'moment__cap', C.fill(e.detail)));
          }
          list.appendChild(li);
        }
      } else {
        for (var p = 0; p < 3; p++) {
          slotCount++;
          var ph = el('li', 'moment ac-card ac-empty reveal-on-scroll');
          ph.setAttribute('data-reveal-on-scroll', '');
          var ptop = el('div', 'moment__top');
          var picon = el('div', 'moment__icon');
          picon.setAttribute('aria-hidden', 'true');
          picon.textContent = '\uFF0B';
          ptop.appendChild(picon);
          var pmeta = el('div');
          var pt = el('p', 'moment__time');
          pt.appendChild(document.createTextNode('Time: '));
          pt.appendChild(el('span', null, 'Add time'));
          pmeta.appendChild(pt);
          pmeta.appendChild(el('h3', 'moment__title ac-empty-inline', 'Activity: Add your fact'));
          ptop.appendChild(pmeta);
          ph.appendChild(ptop);
          ph.appendChild(el('p', 'moment__cap ac-empty-inline', 'Details: Add your fact'));
          list.appendChild(ph);
        }
      }

      sheet.appendChild(list);

      var foot = el('div', 'day__foot');
      if (!anyReal) {
        foot.appendChild(el('p', 'day__progress',
          'Nothing filled in yet. These are presentation placeholders only.'));
      } else {
        foot.appendChild(el('p', 'day__progress',
          slotCount + ' moment' + (slotCount === 1 ? '' : 's') + ' on the schedule.'));
      }
      sheet.appendChild(foot);

      wrap.appendChild(sheet);
      root.appendChild(wrap);
    }
  };

  /* Alias: app.js uses SECTION_IDS 'daily'; keep both names working. */
  S.dailyLife = S.daily;

  /* ---------------------------------------------------------- stats */
  S.stats = {
    render: function (root, data, C) {
      root.textContent = '';
      addPetals(root, [
        ['4%', '10%'], ['60%', '4%'], ['95%', '40%'], ['2%', '86%'], ['78%', '95%']
      ]);
      root.appendChild(sceneStars(8));
      root.appendChild(sceneSparkles(6));

      var wrap = el('div', 'ac-wrap');

      var head = el('header', 'stats__head');
      var headMain = el('div');
      headMain.appendChild(el('p', 'stats__kicker', sceneKicker(3)));
      headMain.appendChild(heading(C.get('stats.title') || 'Resident Stats'));
      var stSub = C.get('stats.subtitle');
      if (!C.isBlank(stSub)) {
        var stP = el('p', 'stats__sub');
        stP.appendChild(C.rich(stSub));
        headMain.appendChild(stP);
      }
      head.appendChild(headMain);

      var portrait = C.get('site.portrait');
      if (!C.isBlank(portrait)) {
        var pass = el('div', 'passport ac-card');
        var face = el('div', 'passport__face');
        var pimg = el('img');
        pimg.src = C.fill(portrait);
        pimg.alt = C.isBlank(C.get('site.portraitAlt'))
          ? (C.fill(C.get('site.name')) || 'Resident portrait')
          : C.fill(C.get('site.portraitAlt'));
        face.appendChild(pimg);
        pass.appendChild(face);
        var passMeta = el('div');
        passMeta.appendChild(el('h3', 'passport__name', C.fill(C.get('site.name')) || 'Resident'));
        if (!C.isBlank(C.get('site.son'))) {
          passMeta.appendChild(el('p', 'passport__role',
            C.fill("{son}'s mom")));
        }
        pass.appendChild(passMeta);
        head.appendChild(pass);
      }
      wrap.appendChild(head);

      var items = C.get('stats.items');
      var allBlank = true;
      if (Array.isArray(items) && items.length) {
        for (var bi = 0; bi < items.length; bi++) {
          var bit = items[bi] || {};
          if (!C.isBlank(bit.label) || !C.isBlank(bit.value)) { allBlank = false; break; }
        }
      }

      if (allBlank && Array.isArray(items) && items.length) {
        var pending = el('p', 'pending');
        pending.setAttribute('role', 'note');
        pending.appendChild(el('span', 'ac-tag ac-tag--pink', 'Heads up'));
        var pendTxt = el('span');
        pendTxt.appendChild(el('strong', null, 'Real numbers pending.'));
        pendTxt.appendChild(document.createTextNode(
          ' Every count below is intentionally blank until the facts are supplied.'));
        pending.appendChild(pendTxt);
        wrap.appendChild(pending);
      }

      var grid = el('ul', 'tickets');
      if (Array.isArray(items) && items.length) {
        for (var i = 0; i < items.length; i++) {
          var it = items[i] || {};
          var blankLabel = C.isBlank(it.label);
          var blankValue = C.isBlank(it.value);
          var blank = blankLabel && blankValue;

          var li = el('li');
          var t = el('article', 'mile ac-stats__ticket reveal-on-scroll' + (blank ? ' ac-empty' : ''));
          t.setAttribute('data-reveal-on-scroll', '');
          if (i === 0) t.setAttribute('aria-pressed', 'true');

          var stampCls = 'ac-stamp' + (blank ? ' ac-stamp--pending' : '');
          t.appendChild(el('span', stampCls, blank ? 'Pending' : 'Earned'));

          var paper = el('div', 'mile__paper ac-ticket');
          var icon = el('span', 'mile__icon');
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = blank ? '\uFF0B' : mileIconFor(it.label);
          paper.appendChild(icon);

          var lbl = el('span', 'ac-ticket__label');
          if (blankLabel) {
            lbl.classList.add('ac-empty-inline');
            lbl.textContent = 'Label: Add your fact';
          } else {
            lbl.textContent = C.fill(it.label);
          }
          paper.appendChild(lbl);

          var raw = C.isBlank(it.value) ? '' : String(C.fill(it.value)).trim();
          var numeric = /^-?\d+(\.\d+)?$/.test(raw.replace(/,/g, ''));
          var valWrap = el('span', 'ac-ticket__value');
          if (C.isBlank(it.value)) {
            valWrap.appendChild(el('span', 'mile__dash', '\u2014 \u2014'));
            valWrap.appendChild(el('span', 'ac-sr', 'Count to be supplied'));
          } else if (numeric) {
            t.setAttribute('data-counter-final', String(Number(raw.replace(/,/g, ''))));
            t.setAttribute('data-counter-formatted', raw);
            valWrap.textContent = '0';
          } else {
            valWrap.textContent = raw;
          }
          paper.appendChild(valWrap);

          if (!C.isBlank(it.detail)) {
            paper.appendChild(el('p', 'mile__quip', C.fill(it.detail)));
          }

          t.appendChild(paper);
          li.appendChild(t);
          grid.appendChild(li);
        }
      }
      wrap.appendChild(grid);

      if (allBlank && Array.isArray(items) && items.length) {
        var foot = el('div', 'stats__foot');
        var box = el('div', 'ac-box');
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'Selected stat details');
        box.appendChild(el('span', 'ac-namechip', 'Fact placeholder'));
        box.appendChild(el('p', null, 'Label: Add your fact. Value: Add value.'));
        box.appendChild(el('span', 'ac-next'));
        foot.appendChild(box);
        wrap.appendChild(foot);
      }

      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- gallery */
  S.gallery = {
    render: function (root, data, C) {
      root.textContent = '';
      addPetals(root, [
        ['3%', '14%'], ['44%', '3%'], ['96%', '26%'], ['92%', '90%'], ['2%', '80%']
      ]);
      root.appendChild(sceneSparkles(7));

      var wrap = el('div', 'ac-wrap');

      var head = el('header', 'gal__head');
      var headMain = el('div');
      headMain.appendChild(el('p', 'gal__kicker', sceneKicker(4)));
      headMain.appendChild(heading(C.get('gallery.title') || 'Little Moments'));
      var galSub = C.get('gallery.subtitle');
      if (!C.isBlank(galSub)) {
        var galP = el('p', 'gal__sub');
        galP.appendChild(C.rich(galSub));
        headMain.appendChild(galP);
      }
      head.appendChild(headMain);
      wrap.appendChild(head);

      var photos = C.get('gallery.photos');
      var supplied = 0;
      if (Array.isArray(photos)) {
        for (var si = 0; si < photos.length; si++) {
          if (!C.isBlank((photos[si] || {}).image)) supplied++;
        }
      }

      var album = el('div', 'album ac-card');
      var bar = el('div', 'album__bar');
      bar.appendChild(el('h3', 'album__title', 'Scrapbook'));
      var count = el('p', 'album__count');
      if (supplied === 0) count.appendChild(el('span', 'ac-tag ac-tag--pink', 'Photos pending'));
      count.appendChild(document.createTextNode(
        (supplied === 0 ? '\u00a0 ' : '') + supplied + ' / ' +
        (Array.isArray(photos) ? photos.length : 0) + ' supplied'));
      bar.appendChild(count);
      album.appendChild(bar);

      var grid = el('ul', 'frames');
      var emptyLabel = C.get('ui.emptyPhoto') || 'Photo to be supplied';
      var photoIndex = 0;

      if (Array.isArray(photos) && photos.length) {
        for (var i = 0; i < photos.length; i++) {
          var ph = photos[i] || {};
          var hasImg = !C.isBlank(ph.image);
          var sceneCls = GALLERY_SCENES[i % GALLERY_SCENES.length];

          var li = el('li');
          var fig = el('figure', 'frame reveal-on-scroll' + (hasImg ? ' frame--open' : ' ac-empty'));
          fig.setAttribute('data-reveal-on-scroll', '');

          /* Real photos: plain art frame (no attached scenic backdrop). */
          var shot = el('div', 'frame__art' + (hasImg ? ' frame__art--photo' : (' ' + sceneCls)));
          if (hasImg) {
            var im = el('img', 'frame__img');
            im.src = C.fill(ph.image);
            im.alt = C.isBlank(ph.alt)
              ? (C.isBlank(ph.caption) ? '' : C.fill(ph.caption))
              : C.fill(ph.alt);
            im.loading = 'lazy';
            im.decoding = 'async';
            shot.appendChild(im);
            fig.setAttribute('role', 'button');
            fig.tabIndex = 0;
            fig.setAttribute('data-photo-index', String(photoIndex));
            fig.setAttribute('aria-label',
              'View full photo' + (im.alt ? ': ' + im.alt : ''));
            photoIndex++;
          } else {
            shot.setAttribute('aria-hidden', 'true');
            shot.appendChild(el('span', 'frame__sun'));
            var fic = el('span', 'frame__icon');
            fic.textContent = '\uFF0B';
            shot.appendChild(fic);
            shot.appendChild(el('span', 'frame__slot', emptyLabel));
          }
          fig.appendChild(shot);

          var cap = el('figcaption', 'frame__cap');
          if (!C.isBlank(ph.caption)) {
            cap.textContent = C.fill(ph.caption);
            fig.appendChild(cap);
          } else if (!C.isBlank(ph.alt)) {
            /* CMS often puts the visible title in alt; show it as caption. */
            cap.textContent = C.fill(ph.alt);
            fig.appendChild(cap);
          }

          var meta = el('span', 'frame__meta');
          meta.appendChild(el('span', 'frame__no',
            'No. ' + (i + 1 < 10 ? '0' + (i + 1) : String(i + 1))));
          if (!C.isBlank(ph.tag)) {
            meta.appendChild(el('span', 'ac-tag', C.fill(ph.tag)));
          } else if (!hasImg) {
            meta.appendChild(el('span', 'ac-tag', 'Placeholder caption'));
          }
          fig.appendChild(meta);

          li.appendChild(fig);
          grid.appendChild(li);
        }
      } else {
        for (var j = 0; j < 6; j++) {
          var li2 = el('li');
          var fig2 = el('figure', 'frame ac-empty reveal-on-scroll');
          fig2.setAttribute('data-reveal-on-scroll', '');
          var art2 = el('div', 'frame__art ' + GALLERY_SCENES[j % GALLERY_SCENES.length]);
          art2.setAttribute('aria-hidden', 'true');
          art2.appendChild(el('span', 'frame__sun'));
          art2.appendChild(el('span', 'frame__icon', '\uFF0B'));
          art2.appendChild(el('span', 'frame__slot', emptyLabel));
          fig2.appendChild(art2);
          fig2.appendChild(el('figcaption', 'frame__cap ac-empty-inline', 'Caption: Add your fact'));
          var meta2 = el('span', 'frame__meta');
          meta2.appendChild(el('span', 'frame__no', 'No. 0' + (j + 1)));
          meta2.appendChild(el('span', 'ac-tag', 'Placeholder caption'));
          fig2.appendChild(meta2);
          li2.appendChild(fig2);
          grid.appendChild(li2);
        }
      }

      album.appendChild(grid);
      wrap.appendChild(album);

      if (supplied === 0) {
        var hint = el('p', 'gal__hint',
          'These slots stay empty until real photos are supplied.');
        wrap.appendChild(hint);
      }

      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- reveal */
  S.reveal = {
    render: function (root, data, C) {
      root.textContent = '';
      var wrap = el('div', 'ac-wrap reveal');

      function txt(path) {
        return C.isBlank(C.get(path)) ? '' : C.fill(C.get(path));
      }
      function addText(parent, tag, cls, path) {
        var v = txt(path);
        if (!v) return null;
        var n = el(tag, cls, v);
        parent.appendChild(n);
        return n;
      }
      function starSegs(s) {
        var out = [], parts = String(s || '').split('*'), i;
        for (i = 0; i < parts.length; i++) {
          if (!parts[i]) continue;
          out.push((i % 2 === 1 && i < parts.length - 1)
            ? { text: parts[i], cls: 'ac-hl' }
            : { text: parts[i] });
        }
        return out;
      }

      /* Beat 1 — Saving… */
      var b1 = el('div', 'reveal__stage reveal__saving');
      b1.setAttribute('data-reveal-beat', '1');
      var leaf = el('img', 'reveal__leaf ac-spin');
      leaf.src = 'assets/leaf.svg';
      leaf.alt = '';
      leaf.setAttribute('aria-hidden', 'true');
      leaf.width = 72;
      leaf.height = 72;
      b1.appendChild(leaf);
      b1.appendChild(el('p', 'reveal__saving-title', txt('reveal.saving.title') || 'Saving...'));
      addText(b1, 'p', 'reveal__saving-note', 'reveal.saving.note');
      addText(b1, 'p', 'reveal__saving-aside', 'reveal.saving.aside');
      wrap.appendChild(b1);

      /* Beat 2 — moving up announcement */
      var b2 = el('div', 'reveal__stage reveal__announce');
      b2.setAttribute('data-reveal-beat', '2');
      var box2 = el('div', 'ac-box ac-box--dialog');
      addText(box2, 'span', 'ac-namechip', 'reveal.announcement.speaker');
      addText(box2, 'span', 'ac-tag ac-tag--pink reveal__badge', 'reveal.announcement.badge');
      var line2 = el('p', 'ac-box__text reveal__line');
      var l2 = txt('reveal.announcement.line');
      if (!l2) {
        line2.appendChild(el('span', 'ac-empty-inline', 'Waiting to be filled in'));
      } else {
        line2.setAttribute('data-typing', JSON.stringify(starSegs(l2)));
      }
      box2.appendChild(line2);
      addText(box2, 'p', 'reveal__detail', 'reveal.announcement.detail');
      box2.appendChild(el('span', 'ac-next'));
      b2.appendChild(box2);
      wrap.appendChild(b2);

      /* Beat 3 — Nook Miles achievement */
      var b3 = el('div', 'reveal__stage reveal__achv');
      b3.setAttribute('data-reveal-beat', '3');
      b3.hidden = true;
      b3.setAttribute('aria-hidden', 'true');
      var rays = el('div', 'reveal__rays');
      rays.setAttribute('aria-hidden', 'true');
      b3.appendChild(rays);

      var card = el('article', 'ac-card reveal__achv-card');
      addText(card, 'span', 'ac-stamp reveal__stamp', 'reveal.achievement.stamp');
      var head = el('div', 'reveal__achv-head');
      var miles = el('span', 'reveal__miles');
      miles.setAttribute('aria-hidden', 'true');
      miles.appendChild(el('span', 'ac-leaf'));
      head.appendChild(miles);
      addText(head, 'span', 'ac-tag ac-tag--blue', 'reveal.achievement.badge');
      card.appendChild(head);
      addText(card, 'h3', 'reveal__achv-title', 'reveal.achievement.title');
      addText(card, 'p', 'reveal__achv-detail', 'reveal.achievement.detail');

      var row = el('div', 'reveal__achv-row');
      var ticketL = txt('reveal.achievement.ticketLabel');
      var ticketV = txt('reveal.achievement.ticketValue');
      if (ticketL || ticketV) {
        var tk = el('div', 'ac-ticket reveal__ticket');
        if (ticketL) tk.appendChild(el('span', 'ac-ticket__label', ticketL));
        if (ticketV) tk.appendChild(el('span', 'ac-ticket__value', ticketV));
        row.appendChild(tk);
      }
      var chapL = txt('reveal.achievement.chapterLabel');
      var chapN = txt('reveal.achievement.chapterNote');
      if (chapL || chapN) {
        var chap = el('div', 'reveal__chapter');
        var top = el('div', 'reveal__chapter-top');
        top.appendChild(el('span', '', chapL || 'New chapter unlocked'));
        var count = txt('reveal.achievement.chapterCount');
        if (count) top.appendChild(el('small', '', count));
        chap.appendChild(top);
        var bar = el('div', 'reveal__bar');
        bar.setAttribute('aria-hidden', 'true');
        bar.appendChild(el('span'));
        chap.appendChild(bar);
        if (chapN) chap.appendChild(el('p', 'reveal__chapter-note', chapN));
        row.appendChild(chap);
      }
      if (row.childNodes.length) card.appendChild(row);

      var tags = el('div', 'reveal__achv-tags');
      addText(tags, 'span', 'ac-tag ac-tag--pink', 'reveal.achievement.tagMom');
      if (tags.childNodes.length) card.appendChild(tags);

      b3.appendChild(card);
      wrap.appendChild(b3);

      /* Beat 4 — the letter (mockup: airmail + postage + calendar) */
      var b4 = el('div', 'reveal__stage reveal__letter');
      b4.setAttribute('data-reveal-beat', '4');
      var paper = el('article', 'reveal__paper');

      var post = el('div', 'reveal__post');
      post.setAttribute('aria-hidden', 'true');
      var stamp = el('div', 'reveal__post-stamp');
      stamp.appendChild(el('span', 'reveal__post-sun'));
      stamp.appendChild(el('span', 'reveal__post-waves'));
      post.appendChild(stamp);
      var mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mark.setAttribute('class', 'reveal__post-mark');
      mark.setAttribute('viewBox', '0 0 96 96');
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML =
        '<circle cx="48" cy="48" r="40"/>' +
        '<circle cx="48" cy="48" r="30"/>' +
        '<text x="48" y="45" text-anchor="middle">ISLAND</text>' +
        '<text x="48" y="60" text-anchor="middle">POST</text>' +
        '<path class="wave" d="M88 34 q8 -6 16 0 t16 0 t16 0 M88 48 q8 -6 16 0 t16 0 t16 0 M88 62 q8 -6 16 0 t16 0 t16 0"/>';
      post.appendChild(mark);
      paper.appendChild(post);

      var hand = el('div', 'reveal__hand');
      if (!C.isBlank(C.get('reveal.letter.greeting'))) {
        hand.appendChild(el('p', 'reveal__greeting', C.fill(C.get('reveal.letter.greeting'))));
      }
      var llines = C.get('reveal.letter.lines');
      if (!C.isBlank(llines) && llines.length) {
        for (var i = 0; i < llines.length; i++) {
          var p2 = el('p', 'reveal__para');
          p2.appendChild(C.rich(llines[i]));
          hand.appendChild(p2);
        }
      }
      if (!C.isBlank(C.get('reveal.letter.signature'))) {
        var sig = el('p', 'reveal__sig');
        sig.appendChild(document.createTextNode('\u2014 '));
        sig.appendChild(document.createTextNode(C.fill(C.get('reveal.letter.signature'))));
        var heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        heart.setAttribute('class', 'reveal__heart');
        heart.setAttribute('viewBox', '0 0 20 18');
        heart.setAttribute('aria-hidden', 'true');
        heart.innerHTML = '<path d="M10 17 C4 12 0 9 0 5 C0 2 2 0 5 0 C7 0 9 1 10 3 C11 1 13 0 15 0 C18 0 20 2 20 5 C20 9 16 12 10 17 Z"/>';
        sig.appendChild(heart);
        hand.appendChild(sig);
      }
      if (!C.isBlank(C.get('reveal.letter.ps'))) {
        hand.appendChild(el('p', 'reveal__ps', C.fill(C.get('reveal.letter.ps'))));
      }
      paper.appendChild(hand);

      if (!C.isBlank(C.get('reveal.startDate'))) {
        var startRaw = C.fill(C.get('reveal.startDate'));
        var parsed = parseStartDate(startRaw);
        var dateBox = el('div', 'reveal__date');
        dateBox.setAttribute('role', 'img');
        dateBox.setAttribute('aria-label',
          (C.isBlank(C.get('reveal.letter.calendarLabel'))
            ? 'First day'
            : C.fill(C.get('reveal.letter.calendarLabel'))) + ': ' + startRaw);
        dateBox.appendChild(el('span', 'reveal__date-tape'));
        var sp1 = el('span', 'reveal__sparkle');
        sp1.style.left = '-22px'; sp1.style.top = '34%';
        dateBox.appendChild(sp1);
        var sp2 = el('span', 'reveal__sparkle');
        sp2.style.right = '-18px'; sp2.style.top = '14%';
        dateBox.appendChild(sp2);
        var sp3 = el('span', 'reveal__sparkle');
        sp3.style.right = '-10px'; sp3.style.bottom = '12%';
        dateBox.appendChild(sp3);
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        circle.setAttribute('class', 'reveal__circle');
        circle.setAttribute('viewBox', '0 0 420 480');
        circle.setAttribute('preserveAspectRatio', 'none');
        circle.setAttribute('aria-hidden', 'true');
        circle.innerHTML = '<path d="M210 14 C330 8 408 90 406 236 C404 380 330 466 206 468 C82 470 12 384 14 238 C16 110 84 22 226 20"/>';
        dateBox.appendChild(circle);
        var cal = el('div', 'reveal__cal');
        if (parsed.month) cal.appendChild(el('span', 'reveal__cal-month', parsed.month));
        var dayEl = el('span', 'reveal__cal-day', parsed.day || startRaw);
        if (parsed.ord) {
          var sup = document.createElement('sup');
          sup.textContent = parsed.ord;
          dayEl.appendChild(sup);
        }
        cal.appendChild(dayEl);
        var calLbl = C.isBlank(C.get('reveal.letter.calendarLabel'))
          ? 'First day'
          : C.fill(C.get('reveal.letter.calendarLabel'));
        cal.appendChild(el('span', 'ac-tag ac-tag--gold reveal__firstday', calLbl));
        dateBox.appendChild(cal);
        paper.appendChild(dateBox);
      }

      b4.appendChild(paper);
      wrap.appendChild(b4);

      /* Beat 5 — finale (kept for CMS; omitted from surprise popup) */
      var b5 = el('div', 'reveal__stage reveal__finale');
      b5.setAttribute('data-reveal-beat', '5');
      b5.hidden = true;
      b5.setAttribute('aria-hidden', 'true');
      if (!C.isBlank(C.get('reveal.finale.tag'))) {
        b5.appendChild(el('span', 'ac-tag reveal__finale-tag', C.fill(C.get('reveal.finale.tag'))));
      }
      var fl = C.get('reveal.finale.line');
      if (!C.isBlank(fl)) {
        b5.appendChild(el('h2', 'reveal__finale-line', C.fill(fl)));
      }
      if (!C.isBlank(C.get('reveal.finale.detail'))) {
        b5.appendChild(el('p', 'reveal__finale-detail', C.fill(C.get('reveal.finale.detail'))));
      }
      var confetti = el('div', 'reveal__confetti reveal-confetti');
      confetti.setAttribute('data-confetti', '');
      confetti.setAttribute('aria-hidden', 'true');
      b5.appendChild(confetti);
      var replay = el('button', 'ac-btn reveal__replay');
      replay.type = 'button';
      replay.setAttribute('data-replay', '');
      replay.classList.add('rv-replay');
      var rk = el('span', 'ac-key ac-key--a', 'A');
      rk.setAttribute('aria-hidden', 'true');
      replay.appendChild(rk);
      replay.appendChild(el('span', null, C.get('ui.replay') || 'Play it again'));
      b5.appendChild(replay);
      wrap.appendChild(b5);

      root.appendChild(wrap);
    }
  };
})();