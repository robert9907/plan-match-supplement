/*!
 * GenerationHealth.me call card v1.2.0
 *
 * Tapping a link to Rob's number, (828) 761-3326, opens a branded card
 * showing the number with Call / Text / Copy buttons, instead of jumping
 * straight to the phone's "open this app?" confirmation. Customers see
 * exactly who they are calling first, and anyone uneasy about the
 * browser's confirmation can read or copy the number and dial by hand.
 *
 * Other numbers (1-800-MEDICARE, carrier lines) are left alone.
 *
 * v1.2.0: inside a Plan Match iframe, a tap on our number asks the parent
 *         page to open the card there, so "Call now" is a plain top-level
 *         tel: link. iOS Chrome silently drops a tel: navigation started
 *         from a cross-origin iframe (target=_top), so the call never
 *         dialed. If the parent page has no card script (no reply within
 *         400ms), the card opens inside the frame with an ordinary tel:
 *         link, which dials after the browser's confirmation.
 * v1.1.0: card renders inside a shadow root so the host page's CSS
 *         (WordPress theme rules on p / a / button) can't restyle it.
 *
 * One file, no dependencies. Mirrored byte-for-byte in:
 *   plan-match              apps/web/public/pm-call-card.js  (also served to WordPress)
 *   plan-match-aca          public/pm-call-card.js
 *   plan-match-supplement   public/pm-call-card.js
 * WordPress loads https://planmatch.generationhealth.me/pm-call-card.js
 * from a WPCode site-wide footer snippet.
 */
(function () {
  'use strict';
  if (window.__pmCallCard) return;
  window.__pmCallCard = true;

  var DIGITS = '8287613326';
  var TEL = 'tel:+18287613326';
  var SMS = 'sms:+18287613326';
  var DISPLAY = '(828) 761-3326';

  var framed;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }

  function isOurNumber(href) {
    if (!/^tel:/i.test(href)) return false;
    var d = href.replace(/\D/g, '');
    return d.slice(-10) === DIGITS;
  }

  var CSS =
    ':host{all:initial}*{box-sizing:border-box}p{margin:0}' +
    '.pmcc-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(9,22,44,.48);' +
    '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:flex-end;' +
    'justify-content:center;opacity:0;transition:opacity .22s ease}' +
    '.pmcc-backdrop.pmcc-in{opacity:1}' +
    '.pmcc-card{position:relative;width:100%;max-width:420px;box-sizing:border-box;background:#fff;color:#0d2f5e;' +
    'border-radius:22px 22px 0 0;padding:10px 24px calc(24px + env(safe-area-inset-bottom));' +
    'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,sans-serif;' +
    'box-shadow:0 -12px 40px rgba(9,22,44,.25);transform:translateY(24px);transition:transform .26s cubic-bezier(.2,.8,.2,1);' +
    'text-align:center;-webkit-font-smoothing:antialiased}' +
    '.pmcc-in .pmcc-card{transform:none}' +
    '@media (min-width:600px){.pmcc-backdrop{align-items:center}.pmcc-card{border-radius:22px;padding-bottom:24px}}' +
    '@media (prefers-reduced-motion:reduce){.pmcc-backdrop,.pmcc-card{transition:none}}' +
    '.pmcc-grab{width:38px;height:5px;border-radius:3px;background:#d7dee8;margin:0 auto 16px}' +
    '@media (min-width:600px){.pmcc-grab{display:none}}' +
    '.pmcc-x{position:absolute;top:12px;right:12px;width:36px;height:36px;border:0;border-radius:18px;' +
    'background:#f1f4f8;color:#4a5b73;font-size:20px;line-height:36px;cursor:pointer;padding:0}' +
    '.pmcc-brand{font-size:15px;font-weight:600;letter-spacing:-.01em;margin:6px 0 14px}' +
    '.pmcc-brand b{font-weight:700}.pmcc-brand .g{color:#0D2F5E}.pmcc-brand .h{color:#00CEA1}.pmcc-brand .m{color:#4B9CD3;font-weight:400}' +
    '.pmcc-label{font-size:17px;color:#4a5b73;margin:0 0 6px}' +
    '.pmcc-num{font-size:34px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px;color:#0d2f5e;' +
    '-webkit-user-select:all;user-select:all;font-variant-numeric:tabular-nums}' +
    '.pmcc-sub{font-size:15px;color:#4a5b73;margin:0 0 22px}' +
    '.pmcc-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;' +
    'min-height:56px;border-radius:14px;font-size:18px;font-weight:600;text-decoration:none;border:0;cursor:pointer;' +
    'font-family:inherit;margin:0 0 10px;-webkit-tap-highlight-color:transparent}' +
    '.pmcc-call{background:#0d2f5e;color:#fff}.pmcc-call:active{background:#0a2448}' +
    '.pmcc-row{display:flex;gap:10px}.pmcc-row .pmcc-btn{flex:1;min-height:50px;font-size:17px}' +
    '.pmcc-alt{background:#eef3f8;color:#0d2f5e}.pmcc-alt:active{background:#e2e9f1}' +
    '.pmcc-note{font-size:13px;color:#6b7b90;margin:8px 0 0;line-height:1.45}' +
    '.pmcc-btn:focus-visible,.pmcc-x:focus-visible{outline:3px solid #4B9CD3;outline-offset:2px}';

  var PHONE_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 ' +
    '19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 ' +
    '2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 ' +
    '12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';

  var open = null;
  var lastFocus = null;

  function close() {
    if (!open) return;
    var el = open;
    open = null;
    el.classList.remove('pmcc-in');
    document.removeEventListener('keydown', onKey, true);
    var host = el.__host || el;
    setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, 260);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function copyNumber(btn) {
    var done = function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy number'; }, 1800);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(DISPLAY).then(done, fallback);
        return;
      }
    } catch (e) {}
    fallback();
    function fallback() {
      var t = document.createElement('textarea');
      t.value = DISPLAY;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(t);
    }
  }

  function show() {
    if (open) return;
    lastFocus = document.activeElement;

    var host = document.createElement('div');
    host.setAttribute('data-pm-call-card', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var wrap = document.createElement('div');
    wrap.className = 'pmcc-backdrop';
    var style = document.createElement('style');
    style.textContent = CSS;
    wrap.innerHTML =
      '<div class="pmcc-card" role="dialog" aria-modal="true" aria-labelledby="pmcc-num">' +
        '<div class="pmcc-grab" aria-hidden="true"></div>' +
        '<button type="button" class="pmcc-x" aria-label="Close">&times;</button>' +
        '<p class="pmcc-brand"><b class="g">Generation</b><b class="h">Health</b><span class="m">.me</span></p>' +
        '<p class="pmcc-label">Talk with a licensed broker</p>' +
        '<p class="pmcc-num" id="pmcc-num">' + DISPLAY + '</p>' +
        '<p class="pmcc-sub">Rob Simm &middot; Free, no-obligation help</p>' +
        '<a class="pmcc-btn pmcc-call" data-pm-direct href="' + TEL + '">' + PHONE_SVG + 'Call now</a>' +
        '<div class="pmcc-row">' +
          '<a class="pmcc-btn pmcc-alt" data-pm-direct href="' + SMS + '">Text</a>' +
          '<button type="button" class="pmcc-btn pmcc-alt pmcc-copy">Copy number</button>' +
        '</div>' +
        '<p class="pmcc-note">Your phone may ask you to confirm the call. That&rsquo;s normal.</p>' +
      '</div>';

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) close();
    });
    wrap.querySelector('.pmcc-x').addEventListener('click', close);
    wrap.querySelector('.pmcc-copy').addEventListener('click', function (e) {
      copyNumber(e.currentTarget);
    });
    // Close the card once the call/text actually launches.
    var direct = wrap.querySelectorAll('[data-pm-direct]');
    for (var i = 0; i < direct.length; i++) {
      direct[i].addEventListener('click', function () { setTimeout(close, 400); });
    }

    root.appendChild(style);
    root.appendChild(wrap);
    document.body.appendChild(host);
    wrap.__host = host;
    open = wrap;
    document.addEventListener('keydown', onKey, true);
    // Next frame so the slide-up transition runs.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wrap.classList.add('pmcc-in');
        var call = wrap.querySelector('.pmcc-call');
        if (call && call.focus) call.focus({ preventScroll: true });
      });
    });
  }

  document.addEventListener(
    'click',
    function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!el || el.hasAttribute('data-pm-direct')) return;
      if (!isOurNumber(el.getAttribute('href') || '')) return;
      e.preventDefault();
      if (framed) askParent(); else show();
    },
    true
  );

  // ── Parent handoff ────────────────────────────────────────────────
  var MSG = 'pm-call-card';
  var TRUSTED_FRAME_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*generationhealth\.me$|^https:\/\/plan-match-supplement\.vercel\.app$/;
  var pending = null;

  function askParent() {
    if (pending) return;
    try {
      window.parent.postMessage({ source: MSG, type: 'open' }, '*');
    } catch (err) {
      show();
      return;
    }
    pending = setTimeout(function () { pending = null; show(); }, 400);
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== MSG) return;
    if (d.type === 'ack' && framed && e.source === window.parent) {
      if (pending) { clearTimeout(pending); pending = null; }
      return;
    }
    if (d.type === 'open' && TRUSTED_FRAME_ORIGIN.test(e.origin)) {
      show();
      try { e.source.postMessage({ source: MSG, type: 'ack' }, e.origin); } catch (err) {}
    }
  });

  window.pmCallCard = { open: show, close: close };
})();
