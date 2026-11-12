/* Service pages — in-site scrolling demo windows (design only).
   Click the window or its corner button to pop it out larger; click outside,
   press Esc, or use the button again to put it back. */
(function () {
  'use strict';
  var demos = Array.prototype.slice.call(document.querySelectorAll('.demo:not(.is-empty)'));
  if (!demos.length) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var backdrop = document.createElement('div');
  backdrop.className = 'demo-backdrop';
  document.body.appendChild(backdrop);
  var openDemo = null;

  function withTransition(fn) {
    if (!reduceMotion && document.startViewTransition) document.startViewTransition(fn);
    else fn();
  }

  function setOpen(demo, open) {
    var btn = demo.querySelector('.demo-btn');
    var scroller = demo.querySelector('.demo-scroll');
    var max = scroller.scrollHeight - scroller.clientHeight;
    var ratio = max > 0 ? scroller.scrollTop / max : 0;

    withTransition(function () {
      demo.classList.toggle('is-open', open);
      backdrop.classList.toggle('is-visible', open);
      document.body.classList.toggle('demo-locked', open);
      if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close enlarged demo' : 'Enlarge demo');
      }
      // keep the same spot in the piece after resizing
      scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
    });

    openDemo = open ? demo : null;
    if (open) scroller.focus({ preventScroll: true });
    else if (btn) btn.focus({ preventScroll: true });
  }

  demos.forEach(function (demo) {
    var btn = demo.querySelector('.demo-btn');
    var scroller = demo.querySelector('.demo-scroll');

    if (btn) btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(demo, !demo.classList.contains('is-open'));
    });
    scroller.addEventListener('click', function () {
      if (!demo.classList.contains('is-open')) setOpen(demo, true);
    });

    // subtle self-scroll nudge the first time it comes into view (instead of a "scroll" label)
    if (!reduceMotion && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        setTimeout(function () {
          if (scroller.scrollTop !== 0 || demo.classList.contains('is-open')) return;
          scroller.scrollTo({ top: 140, behavior: 'smooth' });
          setTimeout(function () {
            if (scroller.scrollTop <= 160) scroller.scrollTo({ top: 0, behavior: 'smooth' });
          }, 750);
        }, 400);
      }, { threshold: 0.6 });
      io.observe(demo);
    }
  });

  backdrop.addEventListener('click', function () { if (openDemo) setOpen(openDemo, false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openDemo) setOpen(openDemo, false);
  });
})();
