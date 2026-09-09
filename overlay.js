// In-page overlay: synthetic cursor, click ripple, eased scrolling.
// Injected via addInitScript (every navigation) and page.evaluate (idempotent).

const OVERLAY_SOURCE = `(() => {
  if (window.__voila) return;

  const CURSOR_SVG = '<svg width="26" height="30" viewBox="0 0 26 30" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 1.5 L3 24 L8.7 18.8 L12.6 27.6 L16.4 25.9 L12.5 17.2 L20 16.6 Z" ' +
    'fill="#1b1b1f" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round"/></svg>';

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let cursorEl = null;
  let cur = { x: -60, y: -60 };

  function install() {
    if (cursorEl && document.documentElement.contains(cursorEl)) return;
    cursorEl = document.createElement('div');
    cursorEl.id = '__voila_cursor';
    cursorEl.innerHTML = CURSOR_SVG;
    Object.assign(cursorEl.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647',
      pointerEvents: 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
      transform: 'translate3d(' + cur.x + 'px,' + cur.y + 'px,0)'
    });
    (document.body || document.documentElement).appendChild(cursorEl);
  }

  function render() {
    if (cursorEl) cursorEl.style.transform = 'translate3d(' + cur.x + 'px,' + cur.y + 'px,0)';
  }

  window.__voila = {
    jump(x, y) { cur = { x, y }; install(); render(); },

    moveTo(x, y, dur) {
      install();
      return new Promise(res => {
        const sx = cur.x, sy = cur.y, t0 = performance.now();
        const step = now => {
          const p = Math.min(1, (now - t0) / dur), e = ease(p);
          cur = { x: sx + (x - sx) * e, y: sy + (y - sy) * e };
          render();
          if (p < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    },

    ripple() {
      install();
      const ring = (size, delay, width, color) => {
        const r = document.createElement('div');
        Object.assign(r.style, {
          position: 'fixed', left: (cur.x - size / 2) + 'px', top: (cur.y - size / 2) + 'px',
          width: size + 'px', height: size + 'px', borderRadius: '50%',
          border: width + 'px solid ' + color, zIndex: '2147483646',
          pointerEvents: 'none', opacity: '0'
        });
        (document.body || document.documentElement).appendChild(r);
        r.animate(
          [{ transform: 'scale(0.35)', opacity: 0.95 }, { transform: 'scale(1.9)', opacity: 0 }],
          { duration: 700, delay, easing: 'cubic-bezier(.2,.7,.3,1)' }
        ).onfinish = () => r.remove();
      };
      ring(58, 0, 3.5, 'rgba(255,255,255,0.95)');
      ring(58, 130, 3, 'rgba(110,165,255,0.9)');
    },

    press() {
      install();
      const svg = cursorEl.firstElementChild;
      if (!svg) return;
      svg.style.transformOrigin = '6px 4px';
      svg.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.76)' }, { transform: 'scale(1)' }],
        { duration: 280, easing: 'ease-out' }
      );
    },

    highlight(x, y, w, h) {
      const pad = 6;
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', left: (x - pad) + 'px', top: (y - pad) + 'px',
        width: (w + pad * 2) + 'px', height: (h + pad * 2) + 'px',
        border: '2.5px solid rgba(110,165,255,0.95)', borderRadius: '10px',
        boxShadow: '0 0 0 5px rgba(110,165,255,0.18)',
        zIndex: '2147483645', pointerEvents: 'none', opacity: '0'
      });
      (document.body || document.documentElement).appendChild(el);
      el.animate(
        [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'scale(1)', offset: 0.25 },
         { opacity: 1, transform: 'scale(1)', offset: 0.75 }, { opacity: 0, transform: 'scale(1)' }],
        { duration: 1200, easing: 'ease-out' }
      ).onfinish = () => el.remove();
    },

    slide(o) {
      install();
      const esc = s => (s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const accent = /^#[0-9a-fA-F]{3,8}$/.test(o.accent || '') ? o.accent : '#d97d43';
      const titleWords = esc(o.title).split(' ');
      const words = titleWords.map((w, i) =>
        '<span style="display:inline-block;opacity:0;transform:translateY(36px);' +
        'animation:__vRise .65s cubic-bezier(.16,1,.3,1) ' + (0.15 + i * 0.09).toFixed(2) + 's forwards">' + w + '</span>'
      ).join(' ');
      const after = (0.15 + titleWords.length * 0.09);
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;opacity:0;transition:opacity .45s ease;' +
        'background:linear-gradient(135deg,#0d0d12 0%,#161119 55%,#0f0f16 100%)';
      el.innerHTML =
        '<style>@keyframes __vRise{to{opacity:1;transform:translateY(0)}}@keyframes __vBar{to{transform:scaleX(1)}}</style>' +
        '<div style="font:700 62px/1.15 -apple-system,Helvetica,Arial,sans-serif;color:#f4f2ec;text-align:center;max-width:82%;letter-spacing:-0.02em">' + words + '</div>' +
        '<div style="width:86px;height:4px;border-radius:2px;background:' + accent + ';transform:scaleX(0);' +
        'animation:__vBar .5s ease ' + (after + 0.2).toFixed(2) + 's forwards;margin:28px 0 18px"></div>' +
        (o.subtitle
          ? '<div style="font:400 26px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#b9b5c0;opacity:0;transform:translateY(20px);' +
            'animation:__vRise .6s ease ' + (after + 0.35).toFixed(2) + 's forwards;text-align:center;max-width:70%">' + esc(o.subtitle) + '</div>'
          : '');
      document.documentElement.appendChild(el);
      if (cursorEl) cursorEl.style.opacity = '0';
      return new Promise(res => {
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => {
            el.remove();
            if (cursorEl) cursorEl.style.opacity = '1';
            res();
          }, 500);
        }, o.ms || 3200);
      });
    },

    scrollToY(y, dur) {
      return new Promise(res => {
        const sy = window.scrollY, t0 = performance.now();
        const step = now => {
          const p = Math.min(1, (now - t0) / dur);
          window.scrollTo(0, sy + (y - sy) * ease(p));
          if (p < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();`;

module.exports = { OVERLAY_SOURCE };
