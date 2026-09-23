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

  var S = (window.ACSections = window.ACSections || {});

  /* ---------------------------------------------------------- opening */
  S.opening = {
    render: function (root, data, C) {
      root.textContent = '';

      var bg = el('div', 'opening__bg');
      bg.setAttribute('aria-hidden', 'true');
      root.appendChild(bg);

      var petals = el('div', 'ac-petals');
      petals.setAttribute('aria-hidden', 'true');
      for (var p = 0; p < 10; p++) {
        var petal = el('span', 'ac-petal');
        petal.style.left = (5 + p * 9.4) + '%';
        petal.style.top = (8 + (p % 4) * 22) + '%';
        petal.style.animationDelay = (p * 0.6) + 's';
        petals.appendChild(petal);
      }
      root.appendChild(petals);

      var wrap = el('div', 'ac-wrap opening__wrap');
      var inner = el('div', 'opening__inner');

      /* Allyssa: the user's own reference image, framed cleanly. */
      var fig = el('figure', 'ac-portrait');
      var frame = el('div', 'ac-portrait__frame');
      var img = el('img', 'ac-portrait__img');
      var src = C.get('site.portrait');
      img.src = src || 'assets/reference/allyssa-reference.jpg';
      img.alt = C.get('site.portraitAlt') || 'Portrait of Allyssa';
      img.width = 400; img.height = 400;
      img.loading = 'eager';
      img.decoding = 'async';
      frame.appendChild(img);
      fig.appendChild(frame);
      var cap = C.get('site.portraitCaption');
      if (cap) fig.appendChild(el('figcaption', 'ac-portrait__cap', cap));
      inner.appendChild(fig);

      /* Announcement box */
      var boxWrap = el('div', 'opening__box');
      var box = el('div', 'ac-box ac-box--dialog');
      var chip = el('span', 'ac-namechip', C.fill(C.get('opening.speaker')) || C.get('site.name') || '');
      box.appendChild(chip);

      var line = el('p', 'ac-box__text');
      line.setAttribute('data-opening-line', '');
      line.setAttribute('aria-live', 'polite');
      box.appendChild(line);

      /* The announcement is rendered immediately (not typed) so the
         live clock is always visible. */
      var announcement = C.get('opening.announcement');
      if (C.isBlank(announcement)) {
        line.appendChild(el('span', 'ac-empty-inline', 'Waiting to be filled in'));
        line.classList.add('is-empty');
      } else {
        line.appendChild(C.rich(announcement, C.liveStamp()));
      }
      box.appendChild(el('span', 'ac-next'));
      boxWrap.appendChild(box);

      /* Dialogue lines are collected for the typewriter in app.js */
      var lines = C.get('opening.dialogue');
      var dlg = el('div', 'opening__dialogue');
      if (!C.isBlank(lines) && lines.length) {
        dlg.setAttribute('data-opening-dialogue', '');
        for (var i = 0; i < lines.length; i++) {
          var item = el('p', 'opening__dline');
          item.appendChild(C.rich(lines[i], C.liveStamp()));
          dlg.appendChild(item);
        }
      }
      boxWrap.appendChild(dlg);

      var prompt = el('p', 'ac-btn opening__prompt');
      var key = el('span', 'ac-key ac-key--a', 'A');
      key.setAttribute('aria-hidden', 'true');
      prompt.appendChild(key);
      var nextLabel = el('span', null, C.get('ui.next') || 'Next');
      nextLabel.setAttribute('data-content-next', '');
      prompt.appendChild(nextLabel);
      boxWrap.appendChild(prompt);

      inner.appendChild(boxWrap);
      wrap.appendChild(inner);
      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- daily life */
  S.daily = {
    render: function (root, data, C) {
      root.textContent = '';
      var wrap = el('div', 'ac-wrap');

      var head = el('header', 'ac-scene__head');
      head.appendChild(heading(C.get('dailyLife.title') || 'A Day in the Life'));
      var sub = subtitle(C.get('dailyLife.subtitle'));
      if (sub) head.appendChild(sub);
      wrap.appendChild(head);

      var list = el('ol', 'ac-timeline');
      var entries = C.get('dailyLife.entries');
      var anyReal = false;

      if (Array.isArray(entries) && entries.length) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i] || {};
          var blank = C.isBlank(e.time) && C.isBlank(e.title) && C.isBlank(e.detail);
          if (!blank) anyReal = true;

          var li = el('li', 'ac-timeline__item' + (blank ? ' ac-empty' : ''));
          li.setAttribute('data-reveal-on-scroll', '');

          var dot = el('span', 'ac-timeline__dot');
          dot.setAttribute('aria-hidden', 'true');
          li.appendChild(dot);

          var c = card('ac-card ac-timeline__card', blank);
          var time = el('span', 'ac-tag ac-timeline__time');
          if (C.isBlank(e.time)) {
            time.classList.add('ac-tag--dashed');
            time.textContent = 'Time';
          } else {
            time.textContent = C.fill(e.time);
          }
          c.appendChild(time);

          if (C.isBlank(e.title)) {
            c.appendChild(el('h3', 'ac-timeline__title ac-empty-inline', 'Add a moment'));
          } else {
            c.appendChild(el('h3', 'ac-timeline__title', C.fill(e.title)));
          }

          if (C.isBlank(e.detail)) {
            c.appendChild(el('p', 'ac-timeline__detail ac-empty-inline',
              'Waiting to be filled in'));
          } else {
            c.appendChild(el('p', 'ac-timeline__detail', C.fill(e.detail)));
          }
          li.appendChild(c);
          list.appendChild(li);
        }
      }

      if (!anyReal) {
        var note = el('p', 'ac-scene__note',
          'This timeline is ready for you — add your own moments in the content editor.');
        note.setAttribute('data-editable-note', '');
      }
      wrap.appendChild(list);
      if (!anyReal) wrap.appendChild(note);
      root.appendChild(wrap);
    }
  };

  /* Alias: app.js uses SECTION_IDS 'daily'; keep both names working. */
  S.dailyLife = S.daily;

  /* ---------------------------------------------------------- stats */
  S.stats = {
    render: function (root, data, C) {
      root.textContent = '';
      var wrap = el('div', 'ac-wrap');

      var head = el('header', 'ac-scene__head');
      head.appendChild(heading(C.get('stats.title') || 'Resident Stats'));
      var sub = subtitle(C.get('stats.subtitle'));
      if (sub) head.appendChild(sub);
      wrap.appendChild(head);

      var grid = el('div', 'ac-stats');
      var items = C.get('stats.items');

      if (Array.isArray(items) && items.length) {
        for (var i = 0; i < items.length; i++) {
          var it = items[i] || {};
          var blankLabel = C.isBlank(it.label);
          var blankValue = C.isBlank(it.value);
          var blank = blankLabel && blankValue;

          var t = el('article', 'ac-ticket ac-stats__ticket' + (blank ? ' ac-empty' : ''));
          t.setAttribute('data-reveal-on-scroll', '');

          var lbl = el('span', 'ac-ticket__label');
          if (blankLabel) { lbl.classList.add('ac-empty-inline'); lbl.textContent = 'Your label here'; }
          else lbl.textContent = C.fill(it.label);
          t.appendChild(lbl);

          /* A numeric value counts up; anything else is printed as-is. */
          var raw = C.isBlank(it.value) ? '' : String(C.fill(it.value)).trim();
          var numeric = /^-?\d+(\.\d+)?$/.test(raw.replace(/,/g, ''));
          var val = el('span', 'ac-ticket__value');
          if (C.isBlank(it.value)) {
            val.classList.add('ac-empty-inline');
            val.textContent = '—';
          } else if (numeric) {
            var n = Number(raw.replace(/,/g, ''));
            val.setAttribute('data-counter-final', String(n));
            val.setAttribute('data-counter-formatted', raw);
            val.textContent = '0';
          } else {
            val.textContent = raw;
          }
          t.appendChild(val);

          grid.appendChild(t);
        }
      }
      wrap.appendChild(grid);
      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- gallery */
  S.gallery = {
    render: function (root, data, C) {
      root.textContent = '';
      var wrap = el('div', 'ac-wrap');

      var head = el('header', 'ac-scene__head');
      head.appendChild(heading(C.get('gallery.title') || 'Little Moments'));
      var sub = subtitle(C.get('gallery.subtitle'));
      if (sub) head.appendChild(sub);
      wrap.appendChild(head);

      var grid = el('div', 'ac-gallery');
      var photos = C.get('gallery.photos');

      if (Array.isArray(photos) && photos.length) {
        for (var i = 0; i < photos.length; i++) {
          var ph = photos[i] || {};
          var hasImg = !C.isBlank(ph.image);

          var fig = el('figure', 'ac-card ac-gallery__item' + (hasImg ? '' : ' ac-empty'));
          fig.setAttribute('data-reveal-on-scroll', '');

          var shot = el('div', 'ac-gallery__shot');
          if (hasImg) {
            var im = el('img', 'ac-gallery__img');
            im.src = C.fill(ph.image);
            im.alt = C.isBlank(ph.alt) ? (C.isBlank(ph.caption) ? '' : C.fill(ph.caption)) : C.fill(ph.alt);
            im.loading = 'lazy';
            im.decoding = 'async';
            shot.appendChild(im);
          } else {
            /* Never render a broken <img>; an intentional empty frame. */
            var slot = el('div', 'ac-gallery__slot');
            slot.setAttribute('aria-hidden', 'true');
            slot.appendChild(el('span', 'ac-gallery__leaf'));
            shot.appendChild(slot);
            var soon = el('span', 'ac-gallery__soon', C.get('ui.emptyPhoto') || 'Photo coming soon');
            shot.appendChild(soon);
          }
          fig.appendChild(shot);

          var cap = el('figcaption', 'ac-gallery__cap');
          if (C.isBlank(ph.caption)) {
            cap.appendChild(el('span', 'ac-empty-inline', 'Add your caption'));
          } else {
            cap.appendChild(document.createTextNode(C.fill(ph.caption)));
          }
          fig.appendChild(cap);

          if (!C.isBlank(ph.tag)) {
            var tag = el('span', 'ac-tag ac-gallery__tag', C.fill(ph.tag));
            fig.appendChild(tag);
          }
          grid.appendChild(fig);
        }
      }
      wrap.appendChild(grid);
      root.appendChild(wrap);
    }
  };

  /* ---------------------------------------------------------- reveal */
  S.reveal = {
    render: function (root, data, C) {
      root.textContent = '';
      var wrap = el('div', 'ac-wrap reveal');

      /* Beat 1 — the Saving... fake-out */
      var b1 = el('div', 'reveal__stage reveal__saving');
      b1.setAttribute('data-reveal-beat', '1');
      var leaf = el('img', 'reveal__leaf ac-spin');
      leaf.src = 'assets/leaf.svg';
      leaf.alt = '';
      leaf.setAttribute('aria-hidden', 'true');
      leaf.width = 72; leaf.height = 72;
      b1.appendChild(leaf);
      var saveTitle = el('p', 'reveal__saving-title');
      saveTitle.setAttribute('data-content', 'reveal.saving.title');
      saveTitle.setAttribute('data-hide-empty', '');
      if (C.isBlank(C.get('reveal.saving.title'))) { saveTitle.textContent = 'Saving...'; }
      else saveTitle.textContent = C.fill(C.get('reveal.saving.title'));
      b1.appendChild(saveTitle);
      if (!C.isBlank(C.get('reveal.saving.note'))) {
        b1.appendChild(el('p', 'reveal__saving-note', C.fill(C.get('reveal.saving.note'))));
      }
      if (!C.isBlank(C.get('reveal.saving.aside'))) {
        b1.appendChild(el('p', 'reveal__saving-aside', C.fill(C.get('reveal.saving.aside'))));
      }
      wrap.appendChild(b1);

      /* Beat 2 — the announcement */
      var b2 = el('div', 'reveal__stage reveal__announce');
      b2.setAttribute('data-reveal-beat', '2');
      var box2 = el('div', 'ac-box ac-box--dialog');
      if (!C.isBlank(C.get('reveal.announcement.speaker'))) {
        box2.appendChild(el('span', 'ac-namechip', C.fill(C.get('reveal.announcement.speaker'))));
      }
      if (!C.isBlank(C.get('reveal.announcement.badge'))) {
        box2.appendChild(el('span', 'ac-tag ac-tag--pink reveal__badge', C.fill(C.get('reveal.announcement.badge'))));
      }
      var line2 = el('p', 'ac-box__text reveal__line');
      line2.setAttribute('data-typing', '');
      var l2 = C.get('reveal.announcement.line');
      if (C.isBlank(l2)) {
        line2.appendChild(el('span', 'ac-empty-inline', 'Waiting to be filled in'));
      } else {
        line2.appendChild(C.rich(l2));
      }
      box2.appendChild(line2);
      if (!C.isBlank(C.get('reveal.announcement.detail'))) {
        box2.appendChild(el('p', 'reveal__detail', C.fill(C.get('reveal.announcement.detail'))));
      }
      box2.appendChild(el('span', 'ac-next'));
      b2.appendChild(box2);
      wrap.appendChild(b2);

      /* Beat 3 — the achievement */
      var b3 = el('div', 'reveal__stage reveal__achv');
      b3.setAttribute('data-reveal-beat', '3');
      var acard = el('article', 'ac-card reveal__achv-card');
      if (!C.isBlank(C.get('reveal.achievement.badge'))) {
        acard.appendChild(el('span', 'ac-tag ac-tag--blue', C.fill(C.get('reveal.achievement.badge'))));
      }
      if (!C.isBlank(C.get('reveal.achievement.stamp'))) {
        acard.appendChild(el('span', 'ac-stamp reveal__stamp', C.fill(C.get('reveal.achievement.stamp'))));
      }
      var at = C.get('reveal.achievement.title');
      acard.appendChild(el('h3', 'reveal__achv-title', C.isBlank(at) ? '' : C.fill(at)));
      if (!C.isBlank(C.get('reveal.achievement.detail'))) {
        acard.appendChild(el('p', 'reveal__achv-detail', C.fill(C.get('reveal.achievement.detail'))));
      }
      if (!C.isBlank(C.get('reveal.achievement.ticketLabel'))) {
        var tk = el('div', 'ac-ticket reveal__ticket');
        tk.appendChild(el('span', 'ac-ticket__label', C.fill(C.get('reveal.achievement.ticketLabel'))));
        tk.appendChild(el('span', 'ac-ticket__value', C.fill(C.get('reveal.achievement.ticketValue'))));
        acard.appendChild(tk);
      }
      b3.appendChild(acard);
      wrap.appendChild(b3);

      /* Beat 4 — the letter */
      var b4 = el('div', 'reveal__stage reveal__letter');
      b4.setAttribute('data-reveal-beat', '4');
      var paper = el('article', 'reveal__paper');
      paper.appendChild(el('span', 'reveal__air reveal__air--top'));
      paper.appendChild(el('span', 'reveal__air reveal__air--bottom'));
      var body = el('div', 'reveal__letter-body');
      if (!C.isBlank(C.get('reveal.letter.greeting'))) {
        body.appendChild(el('p', 'reveal__greeting', C.fill(C.get('reveal.letter.greeting'))));
      }
      var llines = C.get('reveal.letter.lines');
      if (!C.isBlank(llines) && llines.length) {
        for (var i = 0; i < llines.length; i++) {
          var p2 = el('p', 'reveal__para');
          p2.appendChild(C.rich(llines[i]));
          body.appendChild(p2);
        }
      }
      if (!C.isBlank(C.get('reveal.letter.ps'))) {
        body.appendChild(el('p', 'reveal__ps', C.fill(C.get('reveal.letter.ps'))));
      }
      /* The single most important string on the site. */
      if (!C.isBlank(C.get('reveal.startDate'))) {
        var dateBox = el('div', 'reveal__date');
        dateBox.setAttribute('role', 'text');
        dateBox.appendChild(el('span', 'reveal__date-label',
          C.isBlank(C.get('reveal.letter.calendarLabel')) ? '' : C.fill(C.get('reveal.letter.calendarLabel'))));
        dateBox.appendChild(el('strong', 'reveal__date-value', C.fill(C.get('reveal.startDate'))));
        body.appendChild(dateBox);
      }
      if (!C.isBlank(C.get('reveal.letter.signature'))) {
        body.appendChild(el('p', 'reveal__sig', C.fill(C.get('reveal.letter.signature'))));
      }
      paper.appendChild(body);
      b4.appendChild(paper);
      wrap.appendChild(b4);

      /* Beat 5 — finale */
      var b5 = el('div', 'reveal__stage reveal__finale');
      b5.setAttribute('data-reveal-beat', '5');
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
      var confetti = el('div', 'reveal__confetti');
      confetti.setAttribute('data-confetti', '');
      confetti.setAttribute('aria-hidden', 'true');
      b5.appendChild(confetti);
      var replay = el('button', 'ac-btn reveal__replay');
      replay.type = 'button';
      replay.setAttribute('data-replay', '');
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