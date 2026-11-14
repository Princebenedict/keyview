// KeyView landing page behavior. No dependencies. The cursor lives in cursor.js.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  // Scroll reveal
  const clearDelay = (el) => setTimeout(() => el.style.removeProperty('--d'), 800);
  if (hasIO) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); clearDelay(e.target); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach((el) => io.observe(el));
  } else $$('.rv').forEach((el) => el.classList.add('in'));
  $$('.bento .card, .status .col').forEach((el, i) => el.style.setProperty('--d', `${(i % 3) * 0.08}s`));

  const track = $('#track');
  if (track) track.innerHTML += track.innerHTML; // seamless -50% loop

  // The boundary: a ring of acid reveals what the public cannot see
  const stage = $('#stage'), priv = $('#private'), turn = $('#turn'), turnLabel = $('#turnLabel');
  if (stage && priv) {
    let inside = false, visible = true;
    const setPos = (x, y) => { priv.style.setProperty('--x', `${x}px`); priv.style.setProperty('--y', `${y}px`); };
    const r0 = priv.getBoundingClientRect();
    setPos(r0.width * 0.5, r0.height * 0.32);
    priv.addEventListener('pointermove', (e) => { const r = priv.getBoundingClientRect(); setPos(e.clientX - r.left, e.clientY - r.top); inside = true; });
    priv.addEventListener('pointerleave', () => { inside = false; });
    if (hasIO) new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(stage);
    const auto = (t) => {
      if (visible && !inside && !reduce && stage.dataset.open !== 'true') {
        const r = priv.getBoundingClientRect();
        setPos(r.width * (0.5 + 0.34 * Math.sin(t / 1700)), r.height * (0.5 + 0.36 * Math.sin(t / 1100 + 1.2)));
      }
      requestAnimationFrame(auto);
    };
    requestAnimationFrame(auto);
    turn.addEventListener('click', () => {
      const open = stage.dataset.open !== 'true';
      stage.dataset.open = String(open);
      turn.setAttribute('aria-pressed', String(open));
      turnLabel.textContent = open ? 'Lock it again' : 'Turn the key';
    });
  }

  // How it works: a horizontal rail. The card nearest the middle, or the one you hover, lights its path.
  const notes = {
    1: 'Trades go into the vault encrypted. Only the totals leave.',
    2: 'The public board reads the totals. No pair, no prices, no thesis.',
    3: 'A follower pays. The key gate records the window and its expiry.',
    4: 'The gate checks the key on every request. Then the follower copies through Intents.',
  };
  const dia = $('#dia'), diaNote = $('#diaNote'), rail = $('#rail'), steps = $$('.step');
  const setStep = (n) => {
    n = String(n);
    if (dia.dataset.step === n && $('.step.active') && $('.step.active').dataset.step === n) return;
    dia.dataset.step = n;
    diaNote.textContent = notes[n];
    steps.forEach((s) => s.classList.toggle('active', s.dataset.step === n));
  };
  if (dia && rail && steps.length) {
    // Let the rail bleed to the screen edges while the first card lines up with the page content
    const gutter = () => { const sec = rail.parentElement; rail.style.setProperty('--g', `${sec.getBoundingClientRect().left + parseFloat(getComputedStyle(sec).paddingLeft)}px`); rail.scrollLeft = 0; };
    gutter();
    addEventListener('resize', gutter);
    setStep(1);
    let pending = false;
    const nearest = () => {
      pending = false;
      const rc = rail.getBoundingClientRect(), mid = rc.left + rc.width / 2;
      let best = steps[0], bd = Infinity;
      steps.forEach((s) => { const r = s.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if (d < bd) { bd = d; best = s; } });
      setStep(best.dataset.step);
    };
    rail.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(nearest); } }, { passive: true });
    steps.forEach((s) => {
      s.addEventListener('pointerenter', () => setStep(s.dataset.step));
      s.addEventListener('click', () => setStep(s.dataset.step));
    });
    const by = (dir) => rail.scrollBy({ left: dir * 348, behavior: reduce ? 'auto' : 'smooth' });
    $('#prev').addEventListener('click', () => by(-1));
    $('#next').addEventListener('click', () => by(1));
  }

  // Key lifetime ring
  const ring = $('.ringbox'), prog = $('#prog');
  if (ring && prog) {
    const big = $('#ringBig'), unit = $('#ringUnit'), st = $('#ringState');
    const DUR = 9000, HOLD = 1800, t0 = performance.now();
    let seen = true;
    if (hasIO) new IntersectionObserver((en) => { seen = en[0].isIntersecting; }).observe(ring);
    const tick = (now) => {
      if (seen) {
        const el = reduce ? 0 : (now - t0) % (DUR + HOLD);
        if (el < DUR) {
          const p = 1 - el / DUR;
          prog.style.strokeDashoffset = String(100 * (1 - p));
          const days = Math.max(1, Math.ceil(p * 7));
          big.textContent = String(days);
          unit.textContent = days === 1 ? 'day left' : 'days left';
          ring.classList.toggle('warn', p < 0.28); ring.classList.remove('off');
          st.textContent = p < 0.28 ? 'Expiring soon' : 'Key active';
        } else {
          prog.style.strokeDashoffset = '100';
          big.textContent = '0'; unit.textContent = 'ended';
          ring.classList.remove('warn'); ring.classList.add('off');
          st.textContent = 'Locked again';
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
})();
