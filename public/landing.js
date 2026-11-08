// KeyView landing page behavior. No dependencies.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;
  const light = () => document.documentElement.dataset.theme === 'light';

  // Nav state and scroll progress
  const nav = $('#nav'), bar = $('#progress');
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 24);
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Reveal on scroll
  if (hasIO) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach((el) => io.observe(el));
  } else $$('.rv').forEach((el) => el.classList.add('in'));

  // Marquee: duplicate content so the -50% loop is seamless
  const track = $('#track');
  if (track) track.innerHTML += track.innerHTML;

  // Soft light that follows the cursor
  const glow = $('#cursorGlow');
  if (glow && matchMedia('(hover: hover)').matches && !reduce) {
    let gx = 0, gy = 0, tx = 0, ty = 0, on = false;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; if (!on) { on = true; gx = tx; gy = ty; glow.style.opacity = 1; } }, { passive: true });
    const loop = () => { gx += (tx - gx) * 0.12; gy += (ty - gy) * 0.12; glow.style.transform = `translate(${gx}px, ${gy}px)`; requestAnimationFrame(loop); };
    loop();
  }

  // Cards: light follows the pointer
  $$('.card').forEach((c) => c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }));

  // The boundary: a key-beam reveals what the public cannot see
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

  // How it works: scroll picks the active step and lights the matching path
  const notes = {
    1: 'Trades go into the vault encrypted. Only the totals leave.',
    2: 'The public board reads the totals. No pair, no prices, no thesis.',
    3: 'A follower pays. The key gate records the window and its expiry.',
    4: 'The gate checks the key on every request. Then the follower copies through Intents.',
  };
  const dia = $('#dia'), diaNote = $('#diaNote'), steps = $$('.step');
  const setStep = (n) => {
    dia.dataset.step = n;
    diaNote.textContent = notes[n];
    steps.forEach((s) => s.classList.toggle('active', s.dataset.step === String(n)));
  };
  if (dia && steps.length) {
    setStep(1);
    if (hasIO) {
      const so = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) setStep(e.target.dataset.step); }), { rootMargin: '-42% 0px -42% 0px' });
      steps.forEach((s) => so.observe(s));
    }
    steps.forEach((s) => s.addEventListener('click', () => setStep(s.dataset.step)));
  }

  // Key lifetime ring
  const ring = $('.ringbox'), prog = $('#prog');
  if (ring && prog) {
    const big = $('#ringBig'), unit = $('#ringUnit'), st = $('#ringState');
    const DUR = 9000, HOLD = 1800;
    const t0 = performance.now();
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
          ring.classList.toggle('warn', p < 0.28);
          ring.classList.remove('off');
          st.textContent = p < 0.28 ? 'Expiring soon' : 'Key active';
        } else {
          prog.style.strokeDashoffset = '100';
          big.textContent = '0';
          unit.textContent = 'ended';
          ring.classList.remove('warn'); ring.classList.add('off');
          st.textContent = 'Locked again';
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Hero: a field of light that bends around the cursor
  const cv = $('#flow');
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (ctx) {
    let w = 0, h = 0, dpr = 1, ps = [], running = false, mx = -9999, my = -9999;
    const hero = cv.parentElement;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const field = (x, y, t) => (Math.sin(x * 0.0032 + t * 0.00025) + Math.cos(y * 0.0041 - t * 0.0002) + Math.sin((x + y) * 0.0021 + t * 0.00015)) * 1.9;
    const spawn = (p) => { p.x = p.px = rnd(0, w); p.y = p.py = rnd(0, h); p.v = rnd(0.5, 1.5); p.life = rnd(120, 360); p.warm = Math.random() < 0.1; return p; };
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(240, Math.floor((w * h) / 8500));
      ps = Array.from({ length: n }, () => spawn({}));
    }
    function frame(t) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.035)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1.3;
      const mint = light() ? '0,165,108' : '0,245,160';
      for (const warm of [false, true]) {
        ctx.strokeStyle = warm ? 'rgba(255,180,84,0.5)' : `rgba(${mint},0.6)`;
        ctx.beginPath();
        for (const p of ps) {
          if (p.warm !== warm) continue;
          let a = field(p.x, p.y, t);
          const dx = mx - p.x, dy = my - p.y, d = Math.hypot(dx, dy);
          if (d < 260) { const k = (1 - d / 260) * 0.85; a = a * (1 - k) + (Math.atan2(dy, dx) + Math.PI / 2) * k; }
          p.px = p.x; p.py = p.y;
          p.x += Math.cos(a) * p.v; p.y += Math.sin(a) * p.v;
          ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y);
          if (--p.life < 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) spawn(p);
        }
        ctx.stroke();
      }
    }
    const loop = (t) => { if (!running) return; frame(t); requestAnimationFrame(loop); };
    const start = () => { if (!running && !reduce) { running = true; requestAnimationFrame(loop); } };
    const stop = () => { running = false; };
    resize();
    for (let i = 0; i < 140; i++) frame(i * 16); // open already filled
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(resize, 150); });
    hero.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    hero.addEventListener('pointerleave', () => { mx = my = -9999; });
    if (reduce) { for (let i = 0; i < 260; i++) frame(i * 16); }
    else if (hasIO) new IntersectionObserver((en) => (en[0].isIntersecting ? start() : stop())).observe(hero);
    else start();
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : (!reduce && start())));
  }
})();
