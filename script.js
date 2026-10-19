(() => {
  const W = 2400, H = 1000, CX = 1200, CY = 560;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SENSES = ['brown', 'chipping', 'peaceful', 'mountain'];
  // true로 바꾸면 아직 놓이지 않은 종이 자리가 점선으로 보여요
  const SHOW_GHOST = false;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round((n >> 16 & 255) * k), 0, 255);
    const g = clamp(Math.round((n >> 8 & 255) * k), 0, 255);
    const b = clamp(Math.round((n & 255) * k), 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  const easeOutBack = (x, c = 1.25) => 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  const easeInCubic = x => x * x * x;
  const easeInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;

  // ---------- paper grain ----------
  const grain = document.createElement('canvas');
  grain.width = grain.height = 180;
  {
    const g = grain.getContext('2d');
    const id = g.createImageData(180, 180);
    const r = rng(9);
    for (let i = 0; i < id.data.length; i += 4) {
      if (r() < 0.55) { id.data[i] = 40; id.data[i + 1] = 30; id.data[i + 2] = 18; id.data[i + 3] = r() * 12; }
      else { id.data[i] = 255; id.data[i + 1] = 246; id.data[i + 2] = 222; id.data[i + 3] = r() * 10; }
    }
    g.putImageData(id, 0, 0);
  }
  function applyGrain(g, bbox) {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = g.createPattern(grain, 'repeat');
    g.fillRect(bbox[0] - 80, bbox[1] - 80, bbox[2] + 160, bbox[3] + 160);
    g.restore();
  }
  function speckle(g, clipPath, bbox, n, color, seed, rmax = 2.4) {
    const r = rng(seed);
    g.save();
    g.clip(clipPath);
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = bbox[0] + r() * bbox[2], y = bbox[1] + r() * bbox[3];
      g.globalAlpha = 0.25 + r() * 0.55;
      g.beginPath(); g.arc(x, y, 0.6 + r() * rmax, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // ---------- geometry ----------
  const layers = [];
  function addLayer(o) {
    Object.assign(o, { v: 0, alpha: 0, drop: 0, rot: 0, sy: 1, shade: 0, anim: null, canvas: null, landed: true });
    layers.push(o);
    return o;
  }

  function ridgePts(h, seed) {
    const r = rng(seed), ph = [r() * 6, r() * 6, r() * 6];
    const pts = [];
    for (let x = -300; x <= 2700; x += 16) {
      let f;
      // L: 왼쪽 끝에서 높고 edge 지점까지 대각선으로 내려옴 / R: 그 반대 / B: 양쪽이 올라간 그릇 모양
      if (h.side === 'L') { const u = x / h.edge; f = u < 0 ? 1 - u * 0.3 : (u < 1 ? Math.pow(1 - u, 1.15) : 0); }
      else if (h.side === 'R') { const u = (W - x) / (W - h.edge); f = u < 0 ? 1 - u * 0.3 : (u < 1 ? Math.pow(1 - u, 1.15) : 0); }
      else { const u = (x - CX) / 1200; f = Math.min(1.2, u * u * 1.5); }
      const y = h.base - h.lift * f + h.rough * (Math.sin(x / 170 + ph[0]) * 0.6 + Math.sin(x / 83 + ph[1]) * 0.3 + Math.sin(x / 37 + ph[2]) * 0.1);
      pts.push([x, y]);
    }
    return pts;
  }
  const ridgeY = (pts, x) => {
    const i = clamp((x + 300) / 16, 0, pts.length - 1.001);
    const a = Math.floor(i), t = i - a;
    return lerp(pts[a][1], pts[a + 1][1], t);
  };
  function addPine(p, x, y, h) {
    const T = h > 55 ? 5 : 4, w = h * 0.36;
    p.moveTo(x, y - h);
    for (let k = 1; k <= T; k++) {
      const yy = y - h + h * k / T, ww = w * (0.32 + 0.68 * k / T);
      p.lineTo(x - ww, yy);
      if (k < T) p.lineTo(x - ww * 0.45, yy - h * 0.03);
    }
    for (let k = T; k >= 1; k--) {
      const yy = y - h + h * k / T, ww = w * (0.32 + 0.68 * k / T);
      if (k < T) p.lineTo(x + ww * 0.45, yy - h * 0.03);
      p.lineTo(x + ww, yy);
    }
    p.closePath();
  }

  // ================================================================
  //  장면: "해 질 녘의 종이 극장"
  //  따뜻한 종이색 한 가족(아이보리 → 모래 → 흙갈색)만 쓰고,
  //  산 뒤의 해에서 오는 빛 하나로 깊이를 만든다. 장식 대신 실루엣과 그림자.
  // ================================================================
  // 노을 팔레트: 빛을 받는 코랄·분홍 → 앞으로 올수록 자두색·남보라
  const P = {
    sun: '#fff3c8', far: '#e9a0a4', peakTop: '#c97f9e', peakBot: '#a2668f', low: '#b26f8c',
    h1: '#f0a58a', h2: '#d9838a', h3: '#ac6488', h4: '#774c7f', h5: '#463460',
    mist: 'rgba(255,214,196,.32)', lake: '#ffcf98', cloud: '#ffcfae', ink: '#2e2340',
    leaf: '#3d2b57', leafTop: '#6a4673'
  };
  const EDGE = 'rgba(255,224,190,.85)';
  const vgrad = (g, y0, y1, a, b) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };

  // 종이 한 장 만들기
  function sheet(o) {
    addLayer({
      sense: o.sense, d: o.d, kind: 'paper', hinge: o.hinge, bbox: o.bbox, ghost: o.edge || new Path2D(), sway: o.sway, hit: o.hit, path: o.path,
      paint(g) {
        g.fillStyle = typeof o.fill === 'function' ? o.fill(g) : o.fill;
        g.fill(o.path);
        if (o.extra) o.extra(g);
        if (o.edge) { g.strokeStyle = EDGE; g.lineWidth = 2; g.stroke(o.edge); }
        applyGrain(g, o.bbox);
      }
    });
  }
  // 함수 y=f(x)로 위쪽 가장자리를 정한 종이
  function ridge(f, step = 8) {
    const path = new Path2D(), edge = new Path2D();
    let minY = Infinity;
    path.moveTo(-300, 1250);
    for (let x = -300; x <= 2700; x += step) {
      const y = f(x); minY = Math.min(minY, y);
      path.lineTo(x, y);
      if (x === -300) edge.moveTo(x, y); else edge.lineTo(x, y);
    }
    path.lineTo(2700, 1250); path.closePath();
    return { path, edge, minY };
  }
  // 점들을 지나는 부드러운 곡선
  function smooth(path, pts, start) {
    if (start) path.moveTo(pts[0][0], pts[0][1]); else path.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1]; path.lineTo(l[0], l[1]);
  }

  // ---------- MOUNTAIN: 해 + 먼 능선 + 주봉 + 낮은 능선 ----------
  const SUN = [1290, 455, 150];
  addLayer({ sense: 'mountain', d: 0.02, kind: 'glow', x: SUN[0], y: SUN[1], rad: 950, color: [255, 205, 140], strength: 0.7 });
  {
    const { path, edge, minY } = ridge(x => 560 - 70 * Math.pow(Math.sin(x / 540 + 0.5), 2) - 18 * Math.sin(x / 190 + 1.3));
    sheet({ sense: 'mountain', d: 0.05, hinge: 660, bbox: [-300, minY - 10, 3000, 1260 - minY], path, edge,
      fill: g => vgrad(g, minY, 680, P.far, shade(P.far, 0.95)) });
  }
  {
    // 주봉: 크기를 줄이고, 능선에 작은 바위턱·어깨·두 번째 봉우리를 넣어 실제 산처럼 (아래는 바닥까지)
    const r = rng(5150), ph = [r() * 6, r() * 6, r() * 6, r() * 6];
    // 봉우리 모양: 꼭대기는 둥글고 아래로 갈수록 완만하게 퍼지는 곡선
    const bell = (x, c, w, p) => { const u = Math.min(1, Math.abs(x - c) / w); return Math.pow(Math.cos(u * Math.PI / 2), p); };
    const f = x => {
      // 꼭대기는 살짝 뾰족하되 부드럽게, 양쪽 비탈 길이가 달라 자연스러운 산 모양
      const pk = (c, wl, wr, pb) => { const w = x < c ? wl : wr; const u = Math.min(1, Math.abs(x - c) / w);
        return 0.55 * Math.pow(1 - u, 1.25) + 0.45 * Math.pow(Math.cos(u * Math.PI / 2), pb); };
      const main = pk(1180, 720, 860, 3), second = 0.56 * pk(1570, 380, 460, 3), shoulder = 0.38 * pk(860, 360, 400, 2.6);
      const sh = Math.max(main, second, shoulder);
      const detail = Math.pow(sh, 0.8) * (5 * Math.sin(x / 73 + ph[0]) + 2.2 * Math.sin(x / 31 + ph[1]));   // 아주 은은한 굴곡만
      return 830 - 535 * sh - detail;
    };
    const { path, edge, minY } = ridge(f, 6);
    sheet({ sense: 'mountain', d: 0.08, hinge: 1000, bbox: [-300, minY - 20, 3000, 1270 - minY], path, edge,
      fill: g => vgrad(g, minY, 900, P.peakTop, P.peakBot),
      extra: g => {   // 해가 있는 쪽 비탈이 조금 더 밝게
        g.save(); g.clip(path);
        const rg = g.createRadialGradient(SUN[0], SUN[1], 0, SUN[0], SUN[1], 520);
        rg.addColorStop(0, 'rgba(255,190,150,.6)'); rg.addColorStop(1, 'rgba(255,190,150,0)');
        g.fillStyle = rg; g.fillRect(-300, 200, 3000, 1050); g.restore();
      } });
  }
  {
    const pts = [[-300, 650], [150, 610], [520, 568], [760, 532], [920, 552], [1120, 606], [1310, 596], [1500, 552], [1760, 526], [2060, 584], [2400, 610], [2700, 640]];
    const path = new Path2D(), edge = new Path2D();
    smooth(path, pts, true); path.lineTo(2700, 1250); path.lineTo(-300, 1250); path.closePath();
    smooth(edge, pts, true);
    sheet({ sense: 'mountain', d: 0.1, hinge: 700, bbox: [-300, 510, 3000, 740], path, edge,
      fill: g => vgrad(g, 520, 760, P.low, shade(P.low, 0.94)) });
  }

  // ---------- PEACEFUL: 매달린 구름 (바닥이 평평하고, 한쪽은 몽글몽글 솟고 반대쪽은 길게 가늘어지는 꼬리) ----------
  function cloudShape(cx, cy, w, dir, bumps) {
    const base = 0.06, squash = 0.62, X = u => cx + dir * u * w, Y = v => cy + v * w;
    const L = bumps[0], R = bumps[bumps.length - 1];   // 양 끝 덩이: 아래까지 둥글게 마감
    const xs = [], top = [], bot = [];
    for (let u = L[0] - L[2]; u <= R[0] + R[2] + 1e-6; u += 0.005) {
      let t = Infinity;
      for (const [bx, by, r] of bumps) { const d = u - bx; if (Math.abs(d) < r) t = Math.min(t, by - Math.sqrt(r * r - d * d)); }
      if (t === Infinity) t = base - 0.02;
      let bt = base + 0.003 * Math.sin(u * 9);
      for (const E of [L, R]) {
        const d = u - E[0];
        if ((E === L && d < 0) || (E === R && d > 0)) bt = Math.min(bt, E[1] + Math.sqrt(Math.max(0, E[2] * E[2] - d * d)));
      }
      t = Math.min(t, bt);
      xs.push(u); top.push(base - (base - t) * squash); bot.push(base - (base - bt) * squash);   // 위아래로 납작하게
    }
    const path = new Path2D(), edge = new Path2D();
    path.moveTo(X(xs[0]), Y(top[0])); edge.moveTo(X(xs[0]), Y(top[0]));
    for (let i = 1; i < xs.length; i++) { path.lineTo(X(xs[i]), Y(top[i])); edge.lineTo(X(xs[i]), Y(top[i])); }
    for (let i = xs.length - 1; i >= 0; i--) path.lineTo(X(xs[i]), Y(bot[i]));
    path.closePath();
    // 안쪽의 가는 결 (덩이와 덩이가 겹친 자리의 밝은 곡선)
    const inner = new Path2D();
    bumps.slice(1, 4).forEach(([bx, by, r], i) => {
      const ax = X(bx + r * 0.25 * (i % 2 ? -1 : 1)), ay = Y(base - (base - (by + r * 0.55)) * squash), rr = r * w * 0.5;
      inner.moveTo(ax - rr, ay); inner.quadraticCurveTo(ax - rr * 0.2, ay - rr * 0.4, ax + rr * 0.6, ay - rr * 0.15);
    });
    return { path, edge, inner, top: Y(Math.min(...top)) };
  }
  const CLOUD_BUMPS = [
    [[-0.38, 0.0, 0.06], [-0.24, -0.05, 0.12], [-0.06, -0.1, 0.17], [0.12, -0.03, 0.11], [0.24, 0.02, 0.06]],
    [[-0.36, 0.01, 0.05], [-0.2, -0.07, 0.14], [0.0, -0.06, 0.12], [0.15, -0.0, 0.08], [0.25, 0.03, 0.045]],
    [[-0.37, 0.0, 0.06], [-0.22, -0.04, 0.1], [-0.05, -0.11, 0.16], [0.13, -0.04, 0.1], [0.24, 0.02, 0.055]]
  ];
  [[560, 205, 400, 0.12, 1], [1840, 250, 320, 0.13, -1], [1560, 120, 220, 0.115, 1]].forEach(([cx, cy, w, d, dir], i) => {
    const { path, edge, inner, top } = cloudShape(cx, cy, w, dir, CLOUD_BUMPS[i]);
    sheet({ sense: 'peaceful', d, hinge: -80, bbox: [cx - w * 0.7 - 20, -340, w * 1.4 + 40, cy + w * 0.1 + 360], path, edge,
      hit: [cx - w * 0.45, cy - w * 0.13, cx + w * 0.45, cy + w * 0.08],
      sway: { x: cx, y: -60, ph: i * 1.7, amp: 0.006 },
      fill: g => vgrad(g, top, cy + w * 0.07, '#ffe2bf', '#f59a9c'),
      extra: g => {
        g.strokeStyle = 'rgba(255,246,232,.6)'; g.lineWidth = 1.6; g.lineCap = 'round'; g.stroke(inner);
        g.strokeStyle = 'rgba(70,40,80,.3)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, -340); g.lineTo(cx, top + w * 0.05); g.stroke();
      } });
  });

  // ---------- BROWN: 흙빛 언덕 다섯 겹 (가운데가 낮은 골짜기) ----------
  const HILL = (base, lift, center, width, wav, ph) => x =>
    base - lift * (1 - Math.exp(-Math.pow((x - center) / width, 2))) + wav * Math.sin(x / 230 + ph) + wav * 0.4 * Math.sin(x / 97 + ph * 2);
  function cypressRow(xs, f, col) {   // 능선 위의 작은 사이프러스 실루엣
    const p = new Path2D();
    xs.forEach(([x, h]) => { const y = f(x) + 4; p.moveTo(x, y); p.bezierCurveTo(x - h * 0.2, y - h * 0.4, x - h * 0.08, y - h * 0.9, x, y - h); p.bezierCurveTo(x + h * 0.08, y - h * 0.9, x + h * 0.2, y - h * 0.4, x, y); });
    return g => { g.fillStyle = col; g.fill(p); };
  }
  [
    { d: 0.20, f: HILL(640, 170, 1150, 520, 14, 0.3), col: P.h1, trees: [[300, 46], [330, 62], [362, 40], [1900, 50], [1935, 64]] },
    { d: 0.30, f: HILL(695, 230, 1350, 560, 16, 1.4), col: P.h2 },
    { d: 0.42, f: HILL(748, 260, 1000, 600, 18, 2.2), col: P.h3, trees: [[2080, 58], [2120, 76], [2160, 52]] },
    { d: 0.56, f: HILL(825, 300, 1450, 640, 18, 0.9), col: P.h4 },
    { d: 0.72, f: HILL(905, 330, 1100, 700, 20, 2.8), col: P.h5, trees: [[150, 90], [205, 120], [260, 84]] },
  ].forEach(h => {
    const { path, edge, minY } = ridge(h.f);
    sheet({ sense: 'brown', d: h.d, hinge: 1000, bbox: [-300, minY - 140, 3000, 1390 - minY], path, edge,
      fill: g => vgrad(g, minY, minY + 360, shade(h.col, 1.06), shade(h.col, 0.93)),
      extra: h.trees ? cypressRow(h.trees, h.f, shade(h.col, 0.86)) : null });
  });

  // ---------- PEACEFUL: 바닥까지 이어지는 호수 면 + 낮은 들판 면 ----------
  {
    // 호수: 가운데는 평평한 수면, 양옆으로 갈수록 아래로 내려가 언덕 뒤로 숨음. 아래는 바닥까지.
    const f = x => { const u = Math.abs(x - 1210) / 520; return u < 1 ? 690 + 6 * u * u : 696 + 260 * Math.pow(u - 1, 1.4); };
    const { path, edge, minY } = ridge(f, 6);
    sheet({ sense: 'brown', d: 0.5, hinge: 1000, bbox: [-300, minY - 10, 3000, 1260 - minY], path, edge,
      fill: g => vgrad(g, 688, 860, P.lake, shade(P.lake, 0.82)),
      });
  }
  {
    // 호수 앞 낮은 들판 (가운데가 낮은 골짜기 모양, 아래는 바닥까지)
    const f = HILL(812, 150, 1250, 520, 10, 0.7);
    const { path, edge, minY } = ridge(f);
    sheet({ sense: 'brown', d: 0.63, hinge: 1000, bbox: [-300, minY - 10, 3000, 1260 - minY], path, edge,
      fill: g => vgrad(g, minY, minY + 300, '#8a5a86', '#6e4877') });
  }

  // ---------- CHIPPING: 가는 나무 + 매달린 종이 새 + 갈대 ----------
  addLayer({ sense: 'chipping', d: 0.6, kind: 'birds' });
  function bareTree(x, scale, lean, seed) {   // 이름은 그대로, 이제 잎이 풍성한 나무
    const r = rng(seed);
    const strokes = [], tips = [];
    const grow = (x0, y0, ang, len, w, depth) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      strokes.push([x0, y0, x1, y1, w, (x0 + x1) / 2 + (r() - 0.5) * len * 0.12, (y0 + y1) / 2]);
      if (depth === 0) { tips.push([x1, y1]); return; }
      for (let i = 0; i < 2; i++) {
        const na = ang + (i ? 1 : -1) * (0.38 + r() * 0.25);
        grow(x1, y1, na + (-Math.PI / 2 - na) * 0.15, len * (0.74 + r() * 0.08), w * 0.62, depth - 1);
      }
    };
    grow(x, 1250, -Math.PI / 2 + lean, 340 * scale, 58 * scale, 4);
    const crown = new Path2D();
    tips.forEach(([tx, ty]) => {
      for (let k = 0; k < 6; k++) {
        const cx = tx + (r() - 0.5) * 150 * scale, cy = ty + (r() - 0.5) * 110 * scale, rr = (54 + r() * 52) * scale;
        crown.moveTo(cx + rr, cy); crown.arc(cx, cy, rr, 0, Math.PI * 2);
      }
    });
    return g => {
      g.strokeStyle = P.ink; g.lineCap = 'round';
      strokes.forEach(([x0, y0, x1, y1, w, mx, my]) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke(); });
      // 잎: 노을빛을 받은 밝은 윗테두리 + 그 아래 짙은 잎
      g.fillStyle = '#c97a86'; g.fill(crown);
      g.save(); g.clip(crown); g.translate(0, 4.5);
      g.fillStyle = vgrad(g, -100, 700, P.leafTop, P.leaf); g.fill(crown);
      g.restore();
    };
  }
  [[0.84, [[170, 0.95, 0.05, 1101], [430, 0.7, -0.04, 1102]], [-300, 1250]],
   [0.86, [[2230, 0.95, -0.05, 1103], [1970, 0.68, 0.05, 1104]], [1150, 1550]]].forEach(([d, trees, [bx, bw]]) => {
    const draws = trees.map(([x, s, l, seed]) => bareTree(x, s, l, seed));
    const bbox = [bx, -200, bw, 1450];
    addLayer({ sense: 'brown', d, kind: 'paper', hinge: 1000, bbox, ghost: new Path2D(),
      paint(g) { draws.forEach(fn => fn(g)); applyGrain(g, bbox); } });
  });
  // 앞쪽에 나무 더 (양옆을 풍성하게)
  [[0.9, [[40, 0.8, 0.06, 1105], [560, 0.6, -0.08, 1106]], [-300, 1300]],
   [0.905, [[2360, 0.8, -0.06, 1107], [1840, 0.58, 0.08, 1108]], [1100, 1600]]].forEach(([d, trees, [bx, bw]]) => {
    const draws = trees.map(([x, s, l, seed]) => bareTree(x, s, l, seed));
    const bbox = [bx, -200, bw, 1450];
    addLayer({ sense: 'brown', d, kind: 'paper', hinge: 1000, bbox, ghost: new Path2D(),
      paint(g) { draws.forEach(fn => fn(g)); applyGrain(g, bbox); } });
  });
  // 맨 앞 덤불: 나무 밑동을 덮고 바닥 모서리까지 이어짐
  function bushRow(d, spans, seed) {
    const r = rng(seed), crown = new Path2D();
    spans.forEach(([x0, x1, top]) => {
      for (let x = x0; x <= x1; x += 46) {
        const rr = 46 + r() * 44, y = top + r() * 50 + rr * 0.4;
        crown.moveTo(x + rr, y); crown.arc(x, y, rr, 0, Math.PI * 2);
        crown.moveTo(x + rr, y + 140); crown.arc(x, y + 140, rr * 1.1, 0, Math.PI * 2);
      }
      crown.rect(x0 - 40, top + 150, x1 - x0 + 80, 1250 - top);
    });
    const bbox = [-300, 400, 3000, 850];
    addLayer({ sense: 'brown', d, kind: 'paper', hinge: 1000, bbox, ghost: new Path2D(),
      paint(g) {
        g.fillStyle = '#c97a86'; g.fill(crown);          // 노을빛 윗테두리
        g.save(); g.clip(crown); g.translate(0, 4.5);
        g.fillStyle = vgrad(g, 600, 1000, P.leafTop, P.leaf); g.fill(crown);
        g.restore();
        applyGrain(g, bbox);
      } });
  }
  bushRow(0.93, [[-300, 620, 800], [620, 1780, 885], [1780, 2700, 790]], 1301);
  bushRow(0.945, [[-300, 420, 880], [440, 1960, 905], [1980, 2700, 870]], 1302);   // 가운데까지 이어진 낮은 덤불

  // 섬세한 제비 실루엣 (오른쪽을 봄). f: 날갯짓 1(위로) ~ -0.3(아래로). dir: 1 오른쪽 / -1 왼쪽
  function swallow(p, x, y, s, f = 0.8, dir = 1, wp = p) {   // wp: 날개를 따로 담을 경로 (겹친 곳 구멍 방지)
    const P2 = (px, py) => [x + dir * px * s, y + py * s];
    const M = (a, b) => p.moveTo(...P2(a, b)), L = (a, b) => p.lineTo(...P2(a, b));
    const Q = (a, b, c, d) => p.quadraticCurveTo(...P2(a, b), ...P2(c, d));
    const C = (a, b, c, d, e, h) => p.bezierCurveTo(...P2(a, b), ...P2(c, d), ...P2(e, h));
    // 몸통 + 작은 머리와 부리 + 길게 갈라진 꼬리
    M(0.66, -0.03);
    Q(0.52, -0.13, 0.38, -0.11);
    C(0.12, -0.1, -0.22, -0.05, -0.42, -0.02);
    L(-1.08, -0.2);                       // 위쪽 꼬리깃
    Q(-0.66, -0.02, -0.52, 0.03);
    Q(-0.66, 0.07, -1.02, 0.16);          // 아래쪽 꼬리깃
    Q(-0.56, 0.12, -0.38, 0.07);
    C(-0.1, 0.15, 0.26, 0.13, 0.46, 0.04);
    Q(0.58, 0.01, 0.66, -0.03);
    p.closePath();
    // 앞쪽 날개: 가늘고 길게 휘어진 초승달
    const wing = (rootX, tipX, k) => {
      const ty = -1.0 * f * k - 0.08;
      wp.moveTo(...P2(rootX + 0.16, -0.06));
      wp.bezierCurveTo(...P2(rootX + 0.12, -0.42 * f * k - 0.06), ...P2(tipX + 0.5, ty + 0.05 * f), ...P2(tipX, ty));
      wp.bezierCurveTo(...P2(tipX + 0.36, ty * 0.55 + 0.04), ...P2(rootX - 0.02, -0.18 * f * k), ...P2(rootX - 0.16, -0.02));
      wp.closePath();
    };
    wing(0.02, -0.62, 1);       // 가까운 날개
    wing(0.16, -0.3, 0.72);     // 먼 날개 (조금 앞쪽, 조금 짧게)
  }

  // 붓으로 슥 그은 듯한 활공하는 새 (가늘고 긴 두 날개 + 작은 몸통, 가장자리가 살짝 거친 붓결)
  function brushBird(p, x, y, s, tilt, seed, lw = [[-0.45, 0.06], [-1.05, -0.02]], rw = [[0.32, -0.16], [0.98, -0.5]]) {
    const r = rng(seed), ca = Math.cos(tilt), sa = Math.sin(tilt);
    const T = (px, py) => [x + (px * ca - py * sa) * s, y + (px * sa + py * ca) * s];
    const wing = ([m, tip], w0) => {   // 몸통에서 끝까지 휘어지며 가늘어지는 붓질
      const N = 22, top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const bx = 2 * (1 - u) * u * m[0] + u * u * tip[0], by = 2 * (1 - u) * u * m[1] + u * u * tip[1];
        const dx = 2 * (1 - u) * m[0] + 2 * u * (tip[0] - m[0]), dy = 2 * (1 - u) * m[1] + 2 * u * (tip[1] - m[1]);
        const len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        const w = w0 * Math.pow(1 - u, 0.8) * (0.55 + 0.9 * Math.sin(Math.min(1, u * 3.2) * Math.PI / 2)) * (0.85 + r() * 0.3);
        top.push([bx + nx * w, by + ny * w]); bot.push([bx - nx * w * 0.7, by - ny * w * 0.7]);
      }
      poly(top.concat(bot.reverse()).map(q => T(...q)));
    };
    // 모든 조각을 같은 방향으로 감아야 겹친 곳에 구멍이 안 생김 (원/타원과 같은 시계 방향으로)
    const poly = pts => {
      let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
      if (a < 0) pts.reverse();
      p.moveTo(...pts[0]); pts.forEach(q => p.lineTo(...q)); p.closePath();
    };
    wing(lw, 0.075); wing(rw, 0.08);
    // 몸통과 작은 머리, 짧은 꼬리
    p.moveTo(...T(0.13, -0.02)); p.ellipse(...T(0, 0.02), 0.13 * s, 0.055 * s, tilt + 0.15, 0, Math.PI * 2);
    p.moveTo(...T(0.17, -0.03)); p.arc(...T(0.14, -0.03), 0.04 * s, 0, Math.PI * 2);
    poly([T(-0.1, 0.03), T(-0.04, 0.12), T(0.04, 0.11), T(0.03, 0.04)]);
  }

  // 실에 매달려 흔들리는 종이 새 모빌 (활공하는 모습, 저마다 기울기·날개 모양이 다름)
  [[780, 200, 62, -0.12, 1, null, null], [950, 285, 46, 0.18, 2, [[-0.4, -0.12], [-0.95, -0.4]], [[0.35, 0.02], [1.0, 0.05]]],
   [1560, 180, 70, 0.05, 3, null, null], [1740, 300, 50, -0.2, 4, [[-0.42, 0.0], [-1.0, -0.22]], [[0.3, -0.2], [0.85, -0.62]]],
   [1180, 130, 40, 0.1, 5, null, null]].forEach(([x, y, sz, tilt, seed, lw, rw], i) => {
    const path = new Path2D();
    brushBird(path, x, y, sz, tilt, 7300 + seed, lw || undefined, rw || undefined);
    sheet({ sense: 'chipping', d: 0.9 + i * 0.006, hinge: -80, bbox: [x - sz * 1.3 - 20, -340, sz * 2.6 + 40, y + sz + 360], path, fill: '#241b33',
      hit: [x - sz * 1.15, y - sz * 0.8, x + sz * 1.15, y + sz * 0.5],
      sway: { x, y: -60, ph: i * 1.3, amp: 0.02 },
      extra: g => { g.strokeStyle = 'rgba(46,35,64,.4)'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(x, -340); g.lineTo(x, y - sz * 0.04); g.stroke(); } });
  });
  // 앞쪽 갈대와 풀: 화면 맨 아래 짙은 땅 띠에서 자라남 (anchorBottom: 항상 화면 바닥에 붙음)
  {
    const r = rng(1201), blades = new Path2D(), back = new Path2D(), heads = new Path2D(), ground = new Path2D();
    const G = 1000;   // 땅 높이 = 장면 맨 아래
    ground.moveTo(-300, 1250);
    for (let x = -300; x <= 2700; x += 20) ground.lineTo(x, G - 105 - 9 * Math.sin(x / 140) - 5 * Math.sin(x / 53 + 1));   // 두툼한 땅 띠
    ground.lineTo(2700, 1250); ground.closePath();
    // tall: 키 큰 갈대 / to: 그릴 묶음(back = 뒤쪽 한 톤 밝은 풀, blades = 앞쪽 짙은 풀)
    const clump = (x0, x1, n, tall, to = blades, lift = 0) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + r() * (x1 - x0), h = (tall ? 150 : 50) + r() * (tall ? 230 : 120), lean = (r() - 0.5) * 0.7, w = 1.6 + r() * 3;
        const base = G - 95 - lift, tx = x + Math.sin(lean) * h, ty = base - h;
        to.moveTo(x - w, base + 20 + lift); to.quadraticCurveTo(x + Math.sin(lean) * h * 0.4, base - h * 0.5, tx, ty);
        to.quadraticCurveTo(x + Math.sin(lean) * h * 0.4 + w, base - h * 0.5, x + w, base + 20 + lift); to.closePath();
        if (tall && to === blades && r() < 0.3) { heads.moveTo(tx + 7, ty); heads.ellipse(tx, ty - 16, 7, 22, lean, 0, Math.PI * 2); }
      }
    };
    // 뒤쪽 한 겹 (조금 밝은 보라) — 풀숲에 깊이감
    clump(-200, 640, 90, true, back, 14); clump(1760, 2600, 90, true, back, 14);
    clump(-200, 2600, 220, false, back, 10);
    // 앞쪽 짙은 풀
    clump(-200, 560, 110, true); clump(1840, 2600, 110, true);   // 양옆 키 큰 갈대 숲
    clump(-200, 2600, 300, false);                                // 바닥 전체를 촘촘히 덮는 짧은 풀
    clump(520, 900, 24, true); clump(1500, 1880, 24, true);       // 가운데로 이어지는 갈대
    const bbox = [-300, 400, 3000, 850];
    addLayer({ sense: 'brown', d: 0.99, kind: 'paper', hinge: G, bbox, ghost: new Path2D(), anchorBottom: true,
      paint(g) { g.fillStyle = '#4a3768'; g.fill(back); g.fillStyle = P.ink; g.fill(blades); g.fill(heads); g.fill(ground); applyGrain(g, bbox); } });
  }

  // ---------- PEACEFUL: 산과 들 사이를 천천히 흐르는 옅은 연기(안개) 띠 ----------
  [[0.3, 640, 70, 0.4], [0.55, 735, 60, 2.1], [0.74, 820, 80, 4.3]].forEach(([d, y, h, ph]) =>
    addLayer({ sense: 'peaceful', d, kind: 'mist', y, h, ph }));

  layers.sort((a, b) => a.d - b.d);
  for (const L of layers) {
    if (L.sway && L.hinge < 0 && L.sense === 'peaceful') L.sway = null;   // 구름은 흔들리지 않고 고정
    if (L.sway && L.hinge < 0) L.phys = { a: 0, v: 0 };   // 실에 매달린 새 모빌: 흔들림 물리
    if (L.kind === 'paper' && L.sense === 'brown' && L.d >= 0.84) L.bend = L.d >= 0.99 ? 0.22 : L.d >= 0.93 ? 0.055 : 0.03;   // 바람에 휘는 정도
  }
  const lakeLayer = layers.find(L => L.sense === 'brown' && L.d === 0.5);
  const meadowLayer = layers.find(L => L.sense === 'brown' && L.d === 0.63);

  // ---------- canvas / rendering ----------
  const stage = document.getElementById('stage');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const HAS_FILTER = 'filter' in ctx;
  let dpr = 1, s = 1, ox = 0, oy = 0, cw = 0, ch = 0, rebuildTimer = 0;

  const PAD = 70;
  function renderLayer(L, ls) {
    const [bx, by, bw, bh] = L.bbox;
    const w = Math.ceil((bw + PAD * 2) * ls), h = Math.ceil((bh + PAD * 2) * ls);
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tg = tmp.getContext('2d');
    tg.setTransform(ls, 0, 0, ls, (PAD - bx) * ls, (PAD - by) * ls);
    L.paint(tg);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const og = out.getContext('2d');
    og.shadowColor = 'rgba(0,0,0,.6)';
    og.shadowBlur = 26 * ls;
    og.shadowOffsetY = 12 * ls;
    og.drawImage(tmp, 0, 0);
    return out;
  }
  // 연기 한 덩이 그림: 동그란 흐림 여러 개를 겹치고 블러 → 가장자리가 부드럽게 풀어지는 몽글한 연기
  let puffSprite = null;
  function getPuffSprite() {
    if (puffSprite) return puffSprite;
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), r = rng(4242);
    if (HAS_FILTER) g.filter = 'blur(14px)';
    for (let i = 0; i < 9; i++) {
      const x = S / 2 + (r() - 0.5) * 90, y = S / 2 + (r() - 0.5) * 40, rad = 30 + r() * 46;
      const rg = g.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, 'rgba(255,236,232,.55)'); rg.addColorStop(0.6, 'rgba(255,222,226,.2)'); rg.addColorStop(1, 'rgba(255,220,228,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    return (puffSprite = c);
  }
  function renderMist(L) {   // 띠마다 연기 덩이들을 준비 (나이·속도·크기가 제각각)
    const r = rng(900 + Math.round(L.y));
    L.puffs = [];
    for (let i = 0; i < 12; i++) {
      const life = 16 + r() * 14;
      L.puffs.push({ x: -300 + r() * 3000, dy: (r() - 0.5) * L.h, r: 120 + r() * 170, st: 1.8 + r() * 1.4,
        vx: 14 + r() * 22, vy: -(1 + r() * 3), grow: 0.25 + r() * 0.35, life, age: r() * life, a: 0.5 + r() * 0.5, rot: (r() - 0.5) * 0.3 });
    }
    return getPuffSprite();
  }
  // 큰 종이 그림을 그대로 그리면 Mac Chrome이 큰 그림을 조각으로 나눠 그리면서
  // 조각 경계에 1px 흰 세로선이 생김 → 직접 작은 조각으로 나누고 서로 겹치게 그려서 틈을 없앰
  const TILE = 900, GUT = 4;
  function sliceTiles(src) {
    const tiles = [];
    for (let y = 0; y < src.height; y += TILE) {
      for (let x = 0; x < src.width; x += TILE) {
        // 조각 둘레에 실제 그림 여백(GUT)을 붙여 두면, 경계에서 투명한 틈 대신 진짜 픽셀을 섞어 그림
        const x0 = Math.max(0, x - GUT), y0 = Math.max(0, y - GUT);
        const x1 = Math.min(src.width, x + TILE + GUT), y1 = Math.min(src.height, y + TILE + GUT);
        const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
        c.getContext('2d').drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
        // 다음 조각과 1px 겹치게 (오른쪽·아래 끝이 아니면)
        const w = Math.min(TILE + (x + TILE < src.width ? 1 : 0), src.width - x);
        const h = Math.min(TILE + (y + TILE < src.height ? 1 : 0), src.height - y);
        tiles.push({ c, sx: x - x0, sy: y - y0, x, y, w, h });
      }
    }
    return tiles;
  }
  function rebuild() {
    const ls = Math.min(s, 1.15);
    for (const L of layers) {
      if (L.kind === 'paper') { L.canvas = renderLayer(L, ls); L.tiles = sliceTiles(L.canvas); }
      else if (L.kind === 'mist') { if (!L.puffs) L.canvas = renderMist(L); }
    }
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.max(1, Math.round(r.width * dpr)); ch = Math.max(1, Math.round(r.height * dpr));
    cv.width = cw; cv.height = ch;
    s = Math.max(ch / H, cw / W); ox = (cw - W * s) / 2; oy = (ch - H * s) / 2;
    const first = !layers.some(L => L.canvas);
    clearTimeout(rebuildTimer);
    if (first) rebuild(); else rebuildTimer = setTimeout(rebuild, 180);
  }
  new ResizeObserver(resize).observe(stage);

  // pointer parallax
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    tmx = ((e.clientX - r.left) / r.width) * 2 - 1;
    tmy = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  stage.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; });

  // ---------- 인터랙션: 모빌 흔들기 · 호수 물결 · 바람 · 노을에서 밤으로 ----------
  let wind = 0, windT = 0, lastZoom = 1, drag = null, lastP = null, night = 0, nightT = 0;
  const ripples = [], leaves = [];
  const hitCtx = document.createElement('canvas').getContext('2d');
  function toWorld(clientX, clientY, d) {   // 화면 좌표 → 그 깊이(d) 레이어의 장면 좌표
    const r = stage.getBoundingClientRect();
    const px = (clientX - r.left) * dpr, py = (clientY - r.top) * dpr;
    const zl = 1 + (lastZoom - 1) * (0.4 + d * 1.2), live = reduce ? 0 : 1;
    const offX = -mx * ((d - 0.35) * PAR_X + frontK(d) * FRONT_X) + live * Math.sin(tNow * 0.35 + d * 5) * 6 * d;
    const offY = -my * ((d - 0.35) * PAR_Y + frontK(d) * FRONT_Y) + live * Math.sin(tNow * 0.5 + d * 7) * 5 * d;
    const k = s * zl;
    return [(px - (ox + s * CX - k * CX + s * offX * zl)) / k, (py - (oy + s * CY - k * CY + s * offY * zl)) / k];
  }
  function hitMobile(cx, cy) {   // 앞쪽부터 실에 매달린 새·구름을 찾음
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (!L.phys || !L.hit || L.alpha < 0.5) continue;
      let [wx, wy] = toWorld(cx, cy, L.d);
      const a = -L.phys.a, px = L.sway.x, py = L.sway.y, dx = wx - px, dy = wy - py;   // 흔들린 각도만큼 되돌려서 확인
      wx = px + dx * Math.cos(a) - dy * Math.sin(a); wy = py + dx * Math.sin(a) + dy * Math.cos(a);
      const [x0, y0, x1, y1] = L.hit;
      if (wx > x0 && wx < x1 && wy > y0 && wy < y1) return L;
    }
    return null;
  }
  function hitLake(cx, cy) {
    if (!lakeLayer || lakeLayer.alpha < 0.5 || !lakeLayer.path) return null;
    if (meadowLayer && meadowLayer.path && meadowLayer.alpha > 0.5) { const [mx2, my2] = toWorld(cx, cy, meadowLayer.d); if (hitCtx.isPointInPath(meadowLayer.path, mx2, my2)) return null; }
    const [wx, wy] = toWorld(cx, cy, lakeLayer.d);
    return hitCtx.isPointInPath(lakeLayer.path, wx, wy) && wy < 900 ? [wx, wy] : null;
  }
  function plop() {   // '또롱' — 높고 맑은 물방울 + 길게 남는 울림
    if (!AC) return;
    const t = AC.currentTime, f0 = 1150 + Math.random() * 350;
    const out = AC.createGain(); out.gain.value = 1;
    out.connect(master);
    const wet = AC.createGain(); wet.gain.value = 0.9; out.connect(wet); wet.connect(getReverb());
    [[0, 1, 1], [0.11 + Math.random() * 0.05, 0.35, 1.5]].forEach(([dl, v, fm]) => {
      const o = AC.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0 * fm, t + dl); o.frequency.exponentialRampToValueAtTime(f0 * fm * 1.9, t + dl + 0.05);
      const g = AC.createGain(); g.gain.setValueAtTime(0, t + dl);
      g.gain.linearRampToValueAtTime(0.07 * v, t + dl + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dl + 0.22);
      o.connect(g); g.connect(out); o.start(t + dl); o.stop(t + dl + 0.25);
    });
    // 맑게 남는 종 같은 여운
    [[f0 * 2.4, 0.022], [f0 * 3.6, 0.008]].forEach(([f, v]) => {
      const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = AC.createGain(); g.gain.setValueAtTime(0, t + 0.03);
      g.gain.linearRampToValueAtTime(v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g); g.connect(out); o.start(t + 0.03); o.stop(t + 1.35);
    });
  }
  stage.addEventListener('pointerdown', e => {
    if (!document.body.classList.contains('ready')) return;
    ensureAudio();
    const m = hitMobile(e.clientX, e.clientY);
    if (m) {
      drag = { L: m, x0: e.clientX, y0: e.clientY, moved: false, tgt: undefined };
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      stage.style.cursor = 'grabbing';
      return;
    }
    const w = hitLake(e.clientX, e.clientY);
    if (w) { ripples.push({ x: w[0], y: w[1], t0: performance.now() }); if (ripples.length > 12) ripples.shift(); plop(); }
  });
  stage.addEventListener('pointermove', e => {
    const now = performance.now();
    if (drag) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
      if (drag.moved) {
        const L = drag.L, [wx, wy] = toWorld(e.clientX, e.clientY, L.d);
        drag.tgt = clamp(-Math.atan2(wx - L.sway.x, wy - L.sway.y), -0.32, 0.32);
      }
    } else {
      if (lastP) {   // 마우스를 빠르게 휘저으면 그 방향으로 바람
        const dtp = Math.max(8, now - lastP.t) / 1000, vx = (e.clientX - lastP.x) / dtp, vy = (e.clientY - lastP.y) / dtp;
        if (Math.hypot(vx, vy) > 1100) {
          windT = clamp(windT + vx / 10000, -0.55, 0.55);
          if (active.has('brown') && leaves.length < 14 && Math.random() < 0.15) {   // 지나간 자리에 나뭇잎 몇 장
            const d = 0.9 + Math.random() * 0.08, [wx, wy] = toWorld(e.clientX, e.clientY, d);
            leaves.push({ x: wx + (Math.random() - 0.5) * 40, y: wy + (Math.random() - 0.5) * 40,
              vx: vx * 0.12 + (Math.random() - 0.5) * 60, vy: -30 + Math.random() * 50, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 7,
              sz: 9 + Math.random() * 9, ph: Math.random() * 6, col: LEAF_COLS[Math.floor(Math.random() * LEAF_COLS.length)],
              t0: now, life: 3000 + Math.random() * 2500, d });
          }
        }
      }
      if (document.body.classList.contains('ready'))
        stage.style.cursor = hitMobile(e.clientX, e.clientY) ? 'grab' : (hitLake(e.clientX, e.clientY) ? 'pointer' : '');
    }
    lastP = { x: e.clientX, y: e.clientY, t: now };
  });
  const endDrag = e => {
    if (!drag) return;
    const L = drag.L;
    if (!drag.moved) {   // 톡 치면 반대쪽으로 흔들림
      const [wx] = toWorld(e.clientX, e.clientY, L.d);
      L.phys.v += (wx >= L.sway.x ? -1 : 1) * (0.4 + Math.random() * 0.15);
    }
    drag = null; stage.style.cursor = 'grab';
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  // 네 단어를 모두 켰을 때만: 스크롤을 내리면 밤, 올리면 다시 노을
  window.addEventListener('wheel', e => {
    if (active.size === 4 && document.body.classList.contains('ready')) nightT = clamp(nightT + e.deltaY * 0.0012, 0, 1);
  }, { passive: true });

  // 밤하늘: 별 · 반딧불이
  const stars = [], flies = [];
  { const r = rng(777);
    for (let i = 0; i < 190; i++) stars.push({ x: -300 + r() * 3000, y: -250 + r() * 760, r: 0.5 + r() * r() * 1.0, ph: r() * 6, sp: 0.4 + r() * 1.4, big: r() < 0.12 });
    for (let i = 0; i < 35; i++) flies.push({ R: 7 + Math.pow(r(), 2.2) * 38, br: 0.35 + r() * 0.65, x: -100 + r() * 2600, y: 560 + r() * 380, d: 0.55 + r() * 0.42, ph: r() * 6, ph2: r() * 6, f1: 0.15 + r() * 0.35, f2: 0.2 + r() * 0.4, sp: 0.8 + r() * 1.6, th: r() });
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const SKY_STOPS = [0, 0.3, 0.5, 0.68, 1];
  const SKY_DAY = ['#6b5aa6', '#b86f9e', '#f08a86', '#fbb06a', '#f7c98a'].map(hex);
  const SKY_NIGHT = ['#0e0e2c', '#191940', '#262352', '#352a5c', '#40305f'].map(hex);
  const NIGHT_TINT = [105, 108, 178];   // 밤이 되면 종이 장면 전체에 곱해지는 푸른 보랏빛

  // ---------- audio ----------
  let AC = null, master = null, noiseBuf = null, soundOn = true;
  function ensureAudio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain(); master.gain.value = soundOn ? 0.9 : 0; master.connect(AC.destination);
        noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { AC = null; }
      loadFlip();
    }
    if (AC && AC.state === 'suspended') AC.resume().catch(() => {});
  }
  function noiseHit(freq, type, dur, gainV, when = 0) {
    if (!AC) return;
    const t = AC.currentTime + when;
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.7;
    const g = AC.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainV, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  const thud = d => noiseHit(380 + (1 - d) * 500, 'lowpass', 0.22, 0.16 + d * 0.12);
  const rustle = () => noiseHit(2600, 'highpass', 0.18, 0.05);
  function chirp() {
    if (!AC) return;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1400;
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(master); }
    for (let i = 0; i < notes; i++) {
      const t = AC.currentTime + i * (0.07 + Math.random() * 0.05);
      const o = AC.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.05);
      const g = AC.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(pan || master); o.start(t); o.stop(t + 0.09);
    }
  }
  function bowl() {
    if (!AC) return;
    const t = AC.currentTime;
    [[196, 0.07], [196 * 2.71, 0.025], [196 * 5.2, 0.01]].forEach(([f, v]) => {
      const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = AC.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 7.2);
    });
  }
  // ---------- BROWN 배경음: 숲 (바람에 스치는 나뭇잎 + 졸졸 흐르는 시냇물) ----------
  let forest = null;
  function setForest(on) {
    if (!AC) return;
    if (on && !forest) {
      const now = AC.currentTime;
      const bus = AC.createGain(); bus.gain.value = 0; bus.connect(master);
      bus.gain.linearRampToValueAtTime(0.55, now + 3);   // 숲 소리 전체 크기
      const srcs = [];
      const loopNoise = () => { const n = AC.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.start(now, Math.random()); srcs.push(n); return n; };
      // 시냇물: 좁은 대역 필터 여러 개의 높이를 계속 흔들어 '졸졸' 거품 소리
      const brookN = loopNoise();
      const brookLP = AC.createBiquadFilter(); brookLP.type = 'lowpass'; brookLP.frequency.value = 1800;
      const brookG = AC.createGain(); brookG.gain.value = 0.3;
      brookLP.connect(brookG);
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      if (pan) { pan.pan.value = -0.35; brookG.connect(pan); pan.connect(bus); } else brookG.connect(bus);
      const bubbles = [0, 1, 2, 3, 4].map(() => {
        const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6 + Math.random() * 4;   // 너무 좁으면 귀뚜라미처럼 '찌르르' 울림
        f.frequency.value = 700 + Math.random() * 1600;
        const g = AC.createGain(); g.gain.value = 0.05;
        brookN.connect(f); f.connect(g); g.connect(brookLP);
        return { f, g };
      });
      const timer = setInterval(() => {
        const t = AC.currentTime;
        for (const b of bubbles) {   // 물방울: 높이와 세기를 짧게 튀게
          b.f.frequency.setTargetAtTime(350 + Math.random() * 1100, t, 0.06 + Math.random() * 0.08);
          b.g.gain.setTargetAtTime(0.015 + Math.random() * 0.07, t, 0.04);
        }
}, 110);
      forest = { bus, srcs, timer };
    } else if (!on && forest) {
      const f = forest; forest = null;
      clearInterval(f.timer);
      const t = AC.currentTime;
      f.bus.gain.cancelScheduledValues(t); f.bus.gain.setValueAtTime(f.bus.gain.value, t);
      f.bus.gain.linearRampToValueAtTime(0, t + 1.8);
      f.srcs.forEach(n => n.stop(t + 2));
    }
  }

  // ---------- PEACEFUL 배경음: 아주 잔잔한 현악기 (느린 화음이 겹쳐 이어짐) ----------
  let strings = null, reverb = null;
  function getReverb() {   // 넓은 공간의 울림
    if (reverb) return reverb;
    const len = AC.sampleRate * 3.5, ir = AC.createBuffer(2, len, AC.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    reverb = AC.createConvolver(); reverb.buffer = ir; reverb.connect(master);
    return reverb;
  }
  // ---------- PEACEFUL 음악: 파헬벨 '캐논' (D장조) — 바이올린 · 첼로 · 피아노 ----------
  // 1680년경 작곡된 곡이라 저작권이 없는 고전 음악. 첼로가 같은 저음 8개를 계속 반복하고(그라운드 베이스),
  // 그 위로 바이올린이 선율을 돌림노래(캐논)처럼 겹쳐 연주함.
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const BEAT = 0.7;   // 4분음표 길이(초)
  const CANON_BASS = [50, 45, 47, 42, 43, 38, 43, 45];                       // D A B F# G D G A (각 2박)
  const CANON_CHORD = [[62, 66, 69], [61, 64, 69], [62, 66, 71], [61, 66, 69],
                       [59, 62, 67], [62, 66, 69], [59, 62, 67], [61, 64, 69]];  // 각 저음 위의 화음
  const LINE_HALF = [78, 76, 74, 73, 71, 69, 71, 73];                        // 첫 선율: 2분음표 (F# E D C# B A B C#)
  const LINE_QUARTER = [74, 78, 81, 79, 78, 74, 78, 76, 74, 71, 74, 69, 67, 71, 69, 67];  // 둘째 선율: 4분음표
  // 진행: 0 = 피아노+첼로만 → 1 = 바이올린 첫 선율 → 2 = 둘째 선율 + 두 번째 바이올린이 첫 선율(캐논)
  //       → 3 = 첫 선율 한 옥타브 위 + 둘째 선율 → 다시 1부터 반복
  const CANON_PLAN = [[], [['half', 0, 0.006]], [['quarter', 0, 0.0055], ['half', 0, 0.0035]], [['half', 12, 0.0045], ['quarter', 0, 0.004]]];
  function piano(bus, f, t, v) {   // 부드러운 피아노: 배음이 위로 갈수록 빨리 사라짐
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(bus);
    [[1, 1, 2.8], [2, 0.42, 1.6], [3, 0.18, 1.0], [4, 0.08, 0.6]].forEach(([m, a, d]) => {
      const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = f * m * (1 + (m - 1) * 0.0006);
      const g = AC.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * a, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + d + 0.05);
    });
  }
  function bowed(bus, f, t, dur, v, cutoff, vibCents) {   // 활로 켜는 현 (바이올린·첼로)
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
    const g = AC.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + Math.min(0.18, dur * 0.3));
    g.gain.setValueAtTime(v * 0.9, t + dur * 0.75); g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    lp.connect(g); g.connect(bus);
    const vib = AC.createOscillator(); vib.frequency.value = 5.2;
    const vg = AC.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(vibCents, t + 0.35);
    vib.connect(vg);
    [-5, 5].forEach(c => {
      const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c;
      vg.connect(o.detune); o.connect(lp); o.start(t); o.stop(t + dur + 0.3);
    });
    vib.start(t); vib.stop(t + dur + 0.3);
  }
  function setStrings(on) {
    if (!AC) return;
    if (on && !strings) {
      const bus = AC.createGain(); bus.gain.value = 0;
      bus.gain.linearRampToValueAtTime(1, AC.currentTime + 2.5);
      const dry = AC.createGain(); dry.gain.value = 0.75; bus.connect(dry); dry.connect(master);
      const wet = AC.createGain(); wet.gain.value = 0.35; bus.connect(wet); wet.connect(getReverb());   // 작은 연주홀 울림
      let cycle = 0, next = AC.currentTime + 0.15;   // 한 바퀴 = 저음 8개 × 2박 = 16박
      const schedule = () => {
        while (next < AC.currentTime + 1.5) {
          const sw = () => (Math.random() - 0.5) * 0.02;   // 사람이 연주하듯 살짝씩 어긋나게
          const plan = CANON_PLAN[cycle === 0 ? 0 : 1 + ((cycle - 1) % 3)];
          CANON_BASS.forEach((bn, i) => {
            const t0 = next + i * 2 * BEAT;
            bowed(bus, midi(bn), t0, 2 * BEAT * 0.97, 0.004, 650, 4);            // 첼로
            const [a, b2, c] = CANON_CHORD[i];                                     // 피아노: 화음을 8분음표로 펼쳐 침
            [a, b2, c, b2].forEach((n, k) => piano(bus, midi(n), t0 + k * BEAT / 2 + sw(), k === 0 ? 0.011 : 0.008));
          });
          for (const [line, shift, vol] of plan) {                                 // 바이올린
            if (line === 'half') LINE_HALF.forEach((n, i) => bowed(bus, midi(n + shift), next + i * 2 * BEAT, 2 * BEAT * 0.95, vol, 2400, 7));
            else LINE_QUARTER.forEach((n, i) => bowed(bus, midi(n + shift), next + i * BEAT, BEAT * 0.9, vol, 2400, 6));
          }
          next += 16 * BEAT; cycle++;
        }
      };
      schedule();
      const timer = setInterval(schedule, 400);
      strings = { bus, timer };
    } else if (!on && strings) {
      const st = strings; strings = null;
      clearInterval(st.timer);
      const t = AC.currentTime;
      st.bus.gain.cancelScheduledValues(t); st.bus.gain.setValueAtTime(st.bus.gain.value, t);
      st.bus.gain.linearRampToValueAtTime(0, t + 2.5);
      setTimeout(() => st.bus.disconnect(), 4500);
    }
  }

  // 인트로 끝: 새들이 다 올라오면 '띠옹~' 하고 맑게 휘어 올라가는 소리
  function sparkle() {
    if (!AC) return;
    const t = AC.currentTime;
    const out = AC.createGain(); out.gain.value = 1; out.connect(master);
    const wet = AC.createGain(); wet.gain.value = 0.7; out.connect(wet); wet.connect(getReverb());
    [[1, 0.045], [2, 0.012], [3, 0.006]].forEach(([m, v]) => {
      const o = AC.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(880 * m, t);
      o.frequency.exponentialRampToValueAtTime(1320 * m, t + 0.09);    // '띠'
      o.frequency.exponentialRampToValueAtTime(1760 * m, t + 0.32);    // '옹~' 위로 휘어 올라감
      const vib = AC.createOscillator(); vib.frequency.value = 6; const vg = AC.createGain(); vg.gain.value = 12 * m;
      vib.connect(vg); vg.connect(o.frequency);
      const g = AC.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.setValueAtTime(v, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.6); vib.start(t); vib.stop(t + 1.6);
    });
  }

  // ---------- state ----------
  const active = new Set();
  const DROP = 1150;
  function toggle(sense) {
    ensureAudio();
    const on = !active.has(sense);
    if (on) active.add(sense); else active.delete(sense);
    const now = performance.now();
    const group = layers.filter(L => L.sense === sense);
    const ordered = on ? group : group.slice().reverse();
    ordered.forEach((L, i) => {
      L.anim = { t0: now + i * (reduce ? 0 : 150), dur: reduce ? 450 : (on ? 1150 : 750), to: on ? 1 : 0, from: L.v };
      L.landed = !on;
      L.quiet = sense === 'mountain' || (group.length > 4 && i % 2 === 1);   // MOUNTAIN은 소리 없이   // 종이가 많을 땐 소리를 한 장 걸러
      L.wob = (Math.random() - 0.5) * 0.05;
    });
    if (sense === 'brown') setForest(on);
    if (sense === 'peaceful') setStrings(on);
    if (sense === 'chipping' && on) { nextChirp = now + 700; for (let i = 0; i < 3; i++) spawnBird(true); nextFlock = now + 1800; nextComer = now + 4200; }
    if (!on && sense !== 'mountain') rustle();
    if (!on) hero = null;
    updateUI();
  }

  // ---------- birds ----------
  const birds = [];
  let nextChirp = 0, nextSpawn = 0;
  function spawnBird(initial) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const d = 0.3 + Math.random() * 0.5;
    birds.push({
      dir, d,
      x: initial ? 300 + Math.random() * 1800 : (dir > 0 ? -250 : 2650),
      y0: 140 + Math.random() * 230,   // 하늘에서만 (호수·언덕 높이로 내려오지 않게)
      size: 10 + d * 26,
      vx: dir * (110 + Math.random() * 120),
      ph: Math.random() * 6, rate: 9 + Math.random() * 5,
      wave: Math.random() * 6, amp: 12 + Math.random() * 26, a: initial ? 0 : 1
    });
  }
  function drawSideBird(g, b, t) {
    const y = b.y0 + Math.sin(t * 0.9 + b.wave) * b.amp;
    const f = 0.35 + 0.65 * Math.sin(t * b.rate * 0.7 + b.ph);   // 부드러운 날갯짓
    const p = new Path2D(), w = new Path2D();
    swallow(p, b.x, y, b.size * 1.15, f, b.dir, w);
    g.save(); g.globalAlpha *= b.a; g.fillStyle = '#2e2340'; g.fill(p); g.fill(w); g.restore();
  }
  let hero = null;
  // 앞으로 날아오는 새: 산 쪽 멀리서 점처럼 시작해 점점 커지며 화면 밖(카메라 옆)으로 스쳐 지나감
  const comers = [];
  let nextComer = 0, nextFlock = 0;
  function spawnComer() {
    const side = Math.random() < 0.5 ? -1 : 1;
    comers.push({ t0: performance.now(), dur: 3800 + Math.random() * 1400,
      x0: 1000 + Math.random() * 450, y0: 200 + Math.random() * 90,   // 산 위 하늘에서 출발
      x1: 1200 + side * (1500 + Math.random() * 500), y1: -200 + Math.random() * 420,
      rate: 7 + Math.random() * 2, ph: Math.random() * 6 });
  }
  function frontBird(p, x, y, s, f) {   // 정면에서 본 새: 몸통 + 양쪽으로 펼친 날개
    const wy = -0.55 * f;
    for (const sd of [-1, 1]) {
      p.moveTo(x + sd * 0.06 * s, y - 0.04 * s);
      p.bezierCurveTo(x + sd * 0.4 * s, y + (wy - 0.25) * s, x + sd * 0.75 * s, y + (wy * 1.2 - 0.05) * s, x + sd * 1.1 * s, y + (wy * 1.5 + 0.1) * s);
      p.bezierCurveTo(x + sd * 0.7 * s, y + (wy * 0.9 + 0.12) * s, x + sd * 0.35 * s, y + (wy * 0.3 + 0.12) * s, x + sd * 0.05 * s, y + 0.1 * s);
      p.closePath();
    }
    p.moveTo(x + 0.08 * s, y); p.ellipse(x, y + 0.02 * s, 0.08 * s, 0.17 * s, 0, 0, Math.PI * 2);
  }
  // 새떼: 열 마리 남짓이 느슨한 무리를 지어 하늘을 한 번 가로지름
  function spawnFlock() {
    const dir = Math.random() < 0.5 ? 1 : -1, n = 9 + Math.floor(Math.random() * 6);
    const y0 = 170 + Math.random() * 180, d = 0.38 + Math.random() * 0.1, vx = dir * (150 + Math.random() * 40), wave = Math.random() * 6;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(Math.random() * 5);
      birds.push({ dir, d: d + (Math.random() - 0.5) * 0.04,
        x: (dir > 0 ? -300 : 2700) - dir * (i * 55 + Math.random() * 90),
        y0: y0 + (Math.random() - 0.5) * 120 + row * 6, size: 7 + Math.random() * 5,
        vx: vx * (0.96 + Math.random() * 0.08), ph: Math.random() * 6, rate: 11 + Math.random() * 4,
        wave, amp: 10 + Math.random() * 10, a: 1, flock: true });
    }
  }
  function drawHero(g, h, t) {
    const f = 0.35 + 0.65 * Math.sin(t * h.rate * 0.8);
    const p = new Path2D(), w = new Path2D();
    swallow(p, h.x, h.y, h.size * 1.2, f, -1, w);
    g.save(); g.globalAlpha *= h.a; g.fillStyle = '#2e2340'; g.fill(p); g.fill(w); g.restore();
  }

  // ---------- loop ----------
  let last = performance.now(), comp = 0, settledAll = false;
  // 마우스 따라 레이어가 움직이는 정도 (클수록 과감) — 원래 70 / 22
  const PAR_X = 190, PAR_Y = 75;
  // 앞쪽 나무·덤불·풀끼리도 조금씩 엇갈리게 (d 0.8 이상인 레이어에 추가로 더 움직임)
  const FRONT_X = 320, FRONT_Y = 60;
  const frontK = d => Math.max(0, d - 0.8);
  let tNow = 0;
  function setWorld(d, offY, zoomBase, pushX = 0) {
    const zl = 1 + (zoomBase - 1) * (0.4 + d * 1.2);
    const live = reduce ? 0 : 1;
    const offX = -mx * ((d - 0.35) * PAR_X + frontK(d) * FRONT_X) + pushX + live * Math.sin(tNow * 0.35 + d * 5) * 6 * d;
    const offY2 = -my * ((d - 0.35) * PAR_Y + frontK(d) * FRONT_Y) + offY + live * Math.sin(tNow * 0.5 + d * 7) * 5 * d;
    const k = s * zl;
    ctx.setTransform(k, 0, 0, k, ox + s * CX - k * CX + s * offX * zl, oy + s * CY - k * CY + s * offY2 * zl);
    return k;
  }

  const LEAF_COLS = ['#c97a86', '#e39e9b', '#f0bb92', '#a873a0', '#d88b8f'];   // 나무 테두리처럼 노을빛 받은 잎
  const MOON_X = 1300;
  function drawLakeFx(now, t) {
    if (!ripples.length && night < 0.01) return;
    ctx.save(); ctx.clip(lakeLayer.path); ctx.lineCap = 'round';
    for (let i = ripples.length - 1; i >= 0; i--) {   // 동그랗게 퍼지는 물결 세 겹
      const R = ripples[i], age = (now - R.t0) / 1000;
      if (age > 3) { ripples.splice(i, 1); continue; }
      for (let j = 0; j < 3; j++) {
        const a2 = age - j * 0.28; if (a2 <= 0) continue;
        const rx = 4 + a2 * 75 * (1 - a2 * 0.12), a = Math.max(0, 1 - a2 / 2.4) * (0.8 - j * 0.2);
        ctx.strokeStyle = `rgba(255,250,232,${a})`; ctx.lineWidth = 1.5 - j * 0.3;
        ctx.beginPath(); ctx.ellipse(R.x, R.y, rx, rx * 0.17, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (night > 0.01) {   // 밤: 호수에 비친 달빛이 일렁임
      ctx.strokeStyle = `rgba(255,255,255,${night * 0.55})`;
      for (let k = 0; k < 9; k++) {
        const y = 702 + k * 6.5, w = (70 - k * 6) * (0.75 + 0.25 * Math.sin(t * 1.3 + k * 1.7)), dx = Math.sin(t * 0.9 + k) * 6;
        ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(MOON_X + dx - w / 2, y); ctx.lineTo(MOON_X + dx + w / 2, y); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    tNow = t;
    mx += (tmx - mx) * 0.07; my += (tmy - my) * 0.07;
    windT *= Math.pow(0.12, dt);                                 // 바람은 금방 잦아듦
    wind += (windT - wind) * Math.min(1, dt * 4);
    if (active.size < 4) nightT = 0;
    night += (nightT - night) * Math.min(1, dt * 1.4);
    if (night < 0.001) night = 0;
    for (const L of layers) if (L.phys) {   // 실에 매달린 모빌: 스프링 + 감쇠 → 흔들리다 천천히 멈춤
      const P = L.phys, idle = reduce ? 0 : Math.sin(t * 0.5 + L.sway.ph) * L.sway.amp;
      if (drag && drag.L === L && drag.tgt !== undefined) {
        const na = P.a + (drag.tgt - P.a) * Math.min(1, dt * 14);
        P.v = (na - P.a) / Math.max(dt, 1e-3); P.a = na;
      } else {
        const acc = -2.6 * (P.a - idle) - 0.9 * P.v - wind * 0.3;
        P.v += acc * dt; P.a += P.v * dt;
      }
      P.a = clamp(P.a, -0.35, 0.35);
    }

    // animate layers
    let allSettled = true;
    for (const L of layers) {
      if (L.kind === 'birds') continue;
      const A = L.anim;
      if (A) {
        const u = clamp((now - A.t0) / A.dur, 0, 1);
        if (now < A.t0) { allSettled = false; continue; }
        // 팝업북처럼: 바닥(hinge)에 납작하게 접혀 있던 종이가 일어서고, 살짝 넘어갔다가 제자리로
        if (reduce) {
          L.v = lerp(A.from, A.to, u); L.sy = 1; L.shade = 0; L.alpha = L.v;
        } else if (A.to === 1) {
          const fresh = A.from < 0.5;
          const e = fresh ? easeOutBack(u, 1.8) : 1;
          L.sy = Math.max(0.002, e);
          L.shade = 1 - clamp(e, 0, 1);
          L.alpha = L.kind === 'mist' ? u : (fresh ? clamp(u * 8, 0, 1) : 1);   // 안개는 천천히 스며 나옴
          L.v = u;
          if (!L.landed && u > 0.42) { L.landed = true; if (L.kind === 'paper' && !L.quiet) thud(L.d); }
        } else {
          const e = easeInCubic(u);
          L.sy = Math.max(0.002, 1 - e);
          L.shade = e;
          L.alpha = L.kind === 'mist' ? 1 - u : 1 - clamp((u - 0.75) / 0.25, 0, 1);
          L.v = 1 - u;
        }
        if (u >= 1) { L.anim = null; L.v = A.to; L.sy = 1; L.shade = 0; L.alpha = A.to; }
        else allSettled = false;
      }
    }
    const complete = active.size === 4 && allSettled;
    if (complete && !hero) {
      hero = { t0: now, x: 1420, y: 1080, size: 70, rate: 7, a: 1 };
    }
    comp += ((complete ? 1 : 0) - comp) * (reduce ? 1 : 0.012);
    if (complete !== settledAll) { settledAll = complete; updateUI(); }

    const breath = reduce ? 0 : Math.sin(t * Math.PI * 2 / 8);
    const zoom = 1 + 0.005 * breath + 0.035 * easeInOutSine(clamp(comp, 0, 1));
    lastZoom = zoom;

    // backdrop
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // 배경: 노을 하늘 (위는 라벤더·보라 → 분홍 → 해 근처 주황·노랑)
    const sy = oy + s * 455, sx = ox + s * 1290;
    const bgl = ctx.createLinearGradient(0, 0, 0, ch);
    // 밤에는 마지막에 장면 전체에 푸른빛을 곱하므로, 하늘은 그만큼 미리 밝게 칠해 둠 → 최종 하늘 = 원하는 밤하늘색
    const tint = NIGHT_TINT.map(c => 1 - night * (1 - c / 255));
    SKY_STOPS.forEach((st, i) => {
      const c = SKY_DAY[i].map((v, j) => Math.min(255, Math.round(lerp(v, SKY_NIGHT[i][j], night) / tint[j])));
      bgl.addColorStop(st, `rgb(${c[0]},${c[1]},${c[2]})`);
    });
    ctx.fillStyle = bgl; ctx.fillRect(0, 0, cw, ch);
    if (night < 0.999) {
      const day = 1 - night;
      const bg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(cw, ch) * 0.55);
      bg.addColorStop(0, `rgba(255,236,170,${0.95 * day})`); bg.addColorStop(0.35, `rgba(255,190,120,${0.45 * day})`); bg.addColorStop(1, 'rgba(255,170,120,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    }
    if (night > 0.01) {   // 별: 반짝반짝 (산·나무 뒤에 있도록 종이보다 먼저)
      setWorld(0, 0, zoom);
      ctx.globalCompositeOperation = 'lighter';
      for (const st of stars) {
        // 평소엔 희미하다가 가끔 '반짝' 하고 밝아짐
        const tw = Math.pow(Math.max(0, Math.sin(t * st.sp + st.ph)), 12);
        const a = Math.min(1, night * (0.6 + 0.4 * tw) * 1.3);
        ctx.fillStyle = `rgba(255,250,240,${a})`;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r * (1 + tw * 0.6), 0, Math.PI * 2); ctx.fill();
        if (st.big && tw > 0.05) {   // 몇몇 별은 반짝일 때 가는 빛줄기 십자
          const L2 = 6 + tw * 9, w2 = 0.35;
          ctx.fillStyle = `rgba(255,250,240,${a * 0.8})`;
          ctx.fillRect(st.x - L2, st.y - w2, L2 * 2, w2 * 2); ctx.fillRect(st.x - w2, st.y - L2, w2 * 2, L2 * 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // birds update
    const chipOn = active.has('chipping');
    if (chipOn) {
      if (now > nextSpawn && birds.filter(b => !b.flock).length < 5) { spawnBird(false); nextSpawn = now + 2500 + Math.random() * 3500; }
      if (nextFlock && now > nextFlock) { spawnFlock(); nextFlock = now + 30000 + Math.random() * 20000; }
      if (nextComer && now > nextComer) { spawnComer(); nextComer = now + 11000 + Math.random() * 9000; }
      if (AC && soundOn && now > nextChirp) { chirp(); nextChirp = now + 1400 + Math.random() * 3200; }
    }
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      b.x += b.vx * dt * (reduce ? 0.4 : 1);
      b.a = chipOn ? Math.min(1, b.a + dt * 1.2) : b.a - dt * 1.5;
      if ((b.vx > 0 ? b.x > 2800 : b.x < -400) || b.a <= 0) birds.splice(i, 1);   // 날아가는 쪽 끝을 지나면 사라짐
    }

    for (const L of layers) {
      // ghost cut-lines where the paper will rest
      if (SHOW_GHOST && L.ghost) {
        const ga = (1 - (L.anim ? Math.max(L.v, L.alpha) : L.v)) * 0.32;
        if (ga > 0.01) {
          const k = setWorld(L.d, 0, zoom);
          ctx.globalAlpha = ga;
          ctx.strokeStyle = '#e6d4aa';
          ctx.lineWidth = 1.1 * dpr / k;
          ctx.setLineDash([5 * dpr / k, 6 * dpr / k]);
          ctx.stroke(L.ghost);
          ctx.setLineDash([]);
        }
      }
      if (L.kind === 'birds') {
        if (birds.length) {
          for (const b of birds) { setWorld(b.d, 0, zoom); ctx.globalAlpha = 1; drawSideBird(ctx, b, t); }
        }
        continue;
      }
      if (L.alpha <= 0.001) continue;
      let anchorY = 0;
      if (L.anchorBottom) {   // 세계 좌표 1000(땅)이 화면 맨 아래에 오도록 위치 보정
        const zl = 1 + (zoom - 1) * (0.4 + L.d * 1.2);
        anchorY = ((ch - oy) / s - CY) / zl + CY - 1000 + my * ((L.d - 0.35) * PAR_Y + frontK(L.d) * FRONT_Y);   // 풀은 항상 화면 바닥에 붙어 있게
      }
      setWorld(L.d, anchorY, zoom);
      ctx.globalAlpha = L.alpha;
      if (L.kind === 'paper' && L.canvas) {
        const [bx, by, bw, bh] = L.bbox;
        ctx.save();
        if (L.sway) {
          const ang = L.phys ? L.phys.a : (reduce ? 0 : Math.sin(t * 0.5 + L.sway.ph) * L.sway.amp);
          ctx.translate(L.sway.x, L.sway.y); ctx.rotate(ang); ctx.translate(-L.sway.x, -L.sway.y);
        }
        if (L.bend) {
          const w2 = wind + (reduce ? 0 : 0.05 * Math.sin(t * 0.7 + L.d * 10));   // 바람 + 평소의 아주 약한 산들바람
          ctx.translate(0, 1000); ctx.transform(1, 0, -w2 * L.bend, 1, 0, 0); ctx.translate(0, -1000);
        }
        if (L.sy !== 1) {
          ctx.translate(0, L.hinge); ctx.scale(1, L.sy); ctx.translate(0, -L.hinge);
        }
        if (L.shade > 0.02 && HAS_FILTER) ctx.filter = `brightness(${(1 - 0.6 * L.shade).toFixed(3)})`;
        const k = (bw + PAD * 2) / L.canvas.width;   // 종이 그림 1px = 세계 좌표 k
        if (L.tiles) for (const t of L.tiles) ctx.drawImage(t.c, t.sx, t.sy, t.w, t.h, bx - PAD + t.x * k, by - PAD + t.y * k, t.w * k, t.h * k);
        else ctx.drawImage(L.canvas, bx - PAD, by - PAD, bw + PAD * 2, bh + PAD * 2);
        ctx.restore();
        if (L === lakeLayer && L.alpha > 0.5) drawLakeFx(now, t);
      } else if (L.kind === 'glow') {
        const pulse = (0.78 + 0.22 * (0.5 + 0.5 * breath)) * (1 - night);
        ctx.globalCompositeOperation = 'lighter';
        const [r, g, b] = L.color;
        const rg = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.rad);
        rg.addColorStop(0, `rgba(${r},${g},${b},${L.strength * pulse})`);
        rg.addColorStop(0.45, `rgba(${r},${g},${b},${L.strength * pulse * 0.35})`);
        rg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = rg;
        ctx.fillRect(L.x - L.rad, L.y - L.rad, L.rad * 2, L.rad * 2);
        ctx.globalCompositeOperation = 'source-over';
      } else if (L.kind === 'mist' && L.canvas) {
        // 연기 덩이들이 옆으로 흘러가며 천천히 피어올라 커지고, 생겨났다 스러짐을 반복
        for (const p of L.puffs) {
          if (!reduce) p.age += dt;
          if (p.age > p.life) { p.age = 0; p.wx = 0; p.x = -350 + Math.random() * 600 + (Math.random() < 0.5 ? 0 : Math.random() * 2400); }
          const u = p.age / p.life, fade = Math.sin(Math.PI * u);
          p.wx = (p.wx || 0) + wind * dt * 260;
          const x = p.x + p.vx * p.age + Math.sin(t * 0.3 + p.r) * 20 + p.wx;
          if (x > 2800) { p.age = p.life; continue; }
          const y = L.y + p.dy + p.vy * p.age + Math.sin(t * 0.4 + p.x) * 4;
          const rr = p.r * (1 + p.grow * u);
          ctx.globalAlpha = L.alpha * p.a * fade * fade * 0.6;
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot + u * 0.15); ctx.scale(p.st, 1);
          ctx.drawImage(L.canvas, -rr, -rr * 0.55, rr * 2, rr * 1.1);
          ctx.restore();
        }
      }
    }

    // hero bird flies toward the lit mountain once all four senses rest
    // 다가오는 새 (모든 종이보다 앞, 카메라 쪽으로)
    for (let i = comers.length - 1; i >= 0; i--) {
      const c = comers[i], u = (now - c.t0) / c.dur;
      if (u >= 1) { comers.splice(i, 1); continue; }
      const e = u * u * u;   // 멀리선 천천히, 가까워질수록 빠르게
      const x = lerp(c.x0, c.x1, e) + Math.sin(u * 5 + c.ph) * 30 * (1 - e);
      const y = lerp(c.y0, c.y1, e * e) + Math.sin(u * 9 + c.ph) * 8;
      const sz = 3 + Math.pow(u, 3.2) * 420;
      setWorld(lerp(0.15, 1.05, e), 0, zoom);
      const p = new Path2D();
      frontBird(p, x, y, sz, Math.sin(t * c.rate + c.ph));
      ctx.globalAlpha = clamp(u * 10, 0, 1) * (chipOn ? 1 : 0);
      ctx.fillStyle = '#2a2038'; ctx.fill(p);
      ctx.globalAlpha = 1;
    }
    if (hero) {
      const u = clamp((now - hero.t0) / (reduce ? 1 : 7000), 0, 1);
      const e = easeInOutSine(u);
      const d = lerp(1, 0.12, e);
      if (u < 1) {
        hero.x = lerp(1420, CX, e) + Math.sin(u * Math.PI) * -120;
        hero.y = lerp(1080, 350, e);
        hero.size = lerp(70, 9, e);
        hero.rate = lerp(7, 3.5, e);
      } else {
        const tt = (now - hero.t0) / 1000 - 7;
        hero.x = CX + Math.sin(tt * 0.35) * 70;
        hero.y = 350 + Math.sin(tt * 0.7) * 14;
        hero.rate = 2.4;
      }
      setWorld(d, 0, zoom);
      ctx.globalAlpha = 1;
      drawHero(ctx, hero, t);
    }

    // 바람에 날리는 나뭇잎 종이 조각 (마우스가 빠르게 지나간 자리에서 생겨남 — pointermove 에서 추가)
    for (let i = leaves.length - 1; i >= 0; i--) {
      const f = leaves[i], age = now - f.t0;
      if (age > f.life) { leaves.splice(i, 1); continue; }
      f.vx += (wind * 260 - f.vx) * Math.min(1, dt * 0.9);
      f.vy += 60 * dt;
      f.x += f.vx * dt + Math.sin(t * 2.6 + f.ph) * 30 * dt;
      f.y += f.vy * dt + Math.cos(t * 3.1 + f.ph) * 22 * dt;
      f.rot += f.vr * dt;
      setWorld(f.d, 0, zoom);
      ctx.globalAlpha = Math.min(1, age / 200) * (1 - clamp((age - f.life * 0.75) / (f.life * 0.25), 0, 1));
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(t * 4 + f.ph)));
      ctx.fillStyle = f.col; ctx.beginPath();
      ctx.moveTo(-f.sz, 0); ctx.quadraticCurveTo(0, -f.sz * 0.55, f.sz, 0); ctx.quadraticCurveTo(0, f.sz * 0.55, -f.sz, 0); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 밤: 장면 전체에 푸른 보랏빛을 곱해 어둡게 → 그 위에 달과 반딧불이
    if (night > 0.003) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      const tc = NIGHT_TINT.map(c => Math.round(255 - night * (255 - c)));
      ctx.fillStyle = `rgb(${tc[0]},${tc[1]},${tc[2]})`; ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      // 달: 산 위로 천천히 떠오름
      setWorld(0.02, 0, zoom);
      const my2 = lerp(330, 235, easeInOutSine(night)), mr = 34;
      ctx.globalAlpha = clamp((night - 0.15) / 0.5, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(MOON_X, my2, mr * 0.8, MOON_X, my2, mr * 5);
      halo.addColorStop(0, 'rgba(200,205,255,.35)'); halo.addColorStop(1, 'rgba(200,205,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(MOON_X - mr * 5, my2 - mr * 5, mr * 10, mr * 10);
      ctx.globalCompositeOperation = 'source-over';
      const mg = ctx.createRadialGradient(MOON_X - mr * 0.3, my2 - mr * 0.3, mr * 0.1, MOON_X, my2, mr);
      mg.addColorStop(0, '#fffaf0'); mg.addColorStop(1, '#e8e2f2');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(MOON_X, my2, mr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // 반딧불이: 밤이 깊어질수록 하나둘 늘어나며 깜빡깜빡
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        const vis = clamp((night - (0.3 + f.th * 0.6)) / 0.12, 0, 1);
        if (vis <= 0) continue;
        const blink = Math.pow(Math.max(0, Math.sin(t * f.sp + f.ph)), 3);
        const x = f.x + Math.sin(t * f.f1 + f.ph) * 60 + Math.sin(t * f.f2 * 2.3 + f.ph2) * 18;
        const y = f.y + Math.sin(t * f.f2 + f.ph2) * 34;
        setWorld(f.d, 0, zoom);
        const a = vis * f.br * (0.15 + 0.85 * blink), R = f.R, core = Math.min(0.35, 4 / R);   // 빛이 넓게 퍼지는 것 / 작게 모인 것
        const fg = ctx.createRadialGradient(x, y, 0, x, y, R);
        for (let q = 0; q <= 10; q++) {   // 가운데 작은 심 + 가장자리로 갈수록 아주 천천히 사라지는 빛 (경계선 없음)
          const u = q / 10, glow = Math.exp(-Math.pow(u / 0.5, 2)) * (1 - u) * (1 - u), coreL = Math.exp(-Math.pow(u / core, 2));
          fg.addColorStop(u, `rgba(240,255,165,${(a * (0.75 * glow + 0.45 * coreL)).toFixed(4)})`);
        }
        ctx.fillStyle = fg; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 영상처럼 가장자리를 어둡게 (비네팅)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const vg = ctx.createRadialGradient(cw / 2, ch * 0.55, Math.min(cw, ch) * 0.3, cw / 2, ch * 0.55, Math.max(cw, ch) * 0.75);
    vg.addColorStop(0, 'rgba(40,20,55,0)'); vg.addColorStop(1, 'rgba(40,20,55,.28)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch);
    requestAnimationFrame(frame);
  }

  // ---------- UI ----------
  const tags = [...document.querySelectorAll('.tag')];
  function updateUI() {
    tags.forEach(b => b.setAttribute('aria-pressed', active.has(b.dataset.sense) ? 'true' : 'false'));
  }
  tags.forEach(b => b.addEventListener('click', () => toggle(b.dataset.sense)));
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.classList.contains('ready')) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) toggle(SENSES[i]);
    if (e.key === 'm') { soundOn = !soundOn; ensureAudio(); if (master) master.gain.setTargetAtTime(soundOn ? 0.9 : 0, AC.currentTime, 0.1); }
  });

  // 인트로(intro.js)에서 쓰는 소리
  // 종이 한 장이 넘어가며 일어서는 소리: 짧게 '스윽' 쓸리고 끝에 종이가 '탁' 펴짐
  // 인트로 책장 소리: 폴더의 sounds/page-flip.mp3 를 쓰고, 파일이 없으면 아래 합성음을 씀
  const FLIP_FILE = 'sounds/page-flip.mp3';
  const FLIP_MAX = 0.9;   // 한 장에 재생할 최대 길이(초) — 파일이 길면 앞부분만
  let flipBuf = null, flipLoading = false;
  function loadFlip() {
    if (flipBuf || flipLoading || !AC) return;
    flipLoading = true;
    fetch(FLIP_FILE).then(r => r.ok ? r.arrayBuffer() : Promise.reject())
      .then(b => AC.decodeAudioData(b)).then(buf => { flipBuf = buf; }).catch(() => {});
  }
  function paperFlip(v = 1) {
    if (AC && flipBuf) {
      const t = AC.currentTime, src = AC.createBufferSource(); src.buffer = flipBuf;
      const FLIP_TEMPO = 1.3;   // 책장 소리 빠르기 (1 = 원래 속도)
      const rate = FLIP_TEMPO * (0.86 + Math.random() * 0.26);   // 장마다 아주 조금씩 다르게
      src.playbackRate.value = rate;
      const g = AC.createGain(), len = Math.min(FLIP_MAX, flipBuf.duration) / rate;
      const VOL = 0.22;   // 책장 소리 크기
      g.gain.setValueAtTime(VOL * v, t); g.gain.setValueAtTime(VOL * v, t + Math.max(0.01, len - 0.1)); g.gain.linearRampToValueAtTime(0, t + len);
      src.connect(g); g.connect(master); src.start(t); src.stop(t + len + 0.02);
      return;
    }
    return paperFlipSynth(v);
  }
  // 인트로: 구름이 올라올 때 — 맑고 부드러운 종소리 (구름마다 음이 하나씩 올라감)
  function cloudSound(k = 0) {
    if (!AC) return;
    const t = AC.currentTime, base = [1046.5, 1318.5, 1568][k % 3];
    const out = AC.createGain(); out.gain.value = 1;
    out.connect(master); out.connect(getReverb());
    [[1, 0.05, 'sine'], [2, 0.012, 'sine'], [3.01, 0.006, 'triangle']].forEach(([m, v, type]) => {
      const o = AC.createOscillator(); o.type = type; o.frequency.value = base * m;
      const g = AC.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.7);
    });
    // 아주 옅은 '후—' 공기 소리
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const gn = AC.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.02, t + 0.25); gn.gain.linearRampToValueAtTime(0, t + 0.8);
    src.connect(lp); lp.connect(gn); gn.connect(master); src.start(t, Math.random()); src.stop(t + 0.85);
  }
  // 인트로: 새가 올라올 때 — '푸드득' 짧은 날갯짓 (+ 가끔 짹)
  function birdSound(k = 0) {
    if (!AC) return;
    const t = AC.currentTime, dur = 0.22 + Math.random() * 0.08;
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300 + Math.random() * 500; bp.Q.value = 0.9;
    const g = AC.createGain(); g.gain.setValueAtTime(0, t);
    for (let q = 0, n = Math.round(dur / 0.045); q < n; q++) {   // 날개를 퍼덕이는 박자
      const tq = t + q * 0.045, v = 0.035 * (1 - q / n * 0.6);
      g.gain.setValueAtTime(0.002, tq); g.gain.linearRampToValueAtTime(v, tq + 0.012); g.gain.linearRampToValueAtTime(0.002, tq + 0.04);
    }
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (pan) pan.pan.value = (Math.random() - 0.5) * 0.8;
    src.connect(bp); bp.connect(g); g.connect(pan || master); if (pan) pan.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    if (k % 2 === 0) setTimeout(chirp, 120 + Math.random() * 120);
  }
  function paperFlipSynth(v = 1) {
    // 책장 넘기는 소리: '스르륵' 부드럽게 커지는 종이 바람 + 잔잔한 종이결 + 끝에 '팔락' 내려앉음
    if (!AC) return;
    const t = AC.currentTime, dur = 0.5 + Math.random() * 0.15;
    const out = AC.createGain(); out.gain.value = v;
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (pan) { pan.pan.setValueAtTime(-0.35, t); pan.pan.linearRampToValueAtTime(0.35, t + dur); out.connect(pan); pan.connect(master); }   // 왼쪽에서 오른쪽으로 넘어감
    else out.connect(master);
    // 1) 종이가 공기를 가르는 '스르륵'
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.55;
    bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2300, t + dur * 0.7); bp.frequency.exponentialRampToValueAtTime(1300, t + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.014, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0, t + dur);
    src.connect(bp); bp.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    // 2) 종이결이 스치는 잔잔한 사각거림 (드문드문 아주 작게)
    for (let i = 0, n = 6 + Math.floor(Math.random() * 6); i < n; i++)
      noiseHit(3500 + Math.random() * 3000, 'highpass', 0.012 + Math.random() * 0.02, 0.006 + Math.random() * 0.008, dur * (0.25 + Math.random() * 0.65));
    // 3) 끝에 종이가 '팔락' 내려앉음
    noiseHit(900 + Math.random() * 300, 'lowpass', 0.09, 0.05, dur * 0.95);
    noiseHit(2600, 'bandpass', 0.035, 0.02, dur * 0.96);
  }
  function unfold() {
    if (!AC) return;
    const t = AC.currentTime;
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.5);
    const g = AC.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.25);
    g.gain.linearRampToValueAtTime(0.05, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random()); src.stop(t + 1.9);
  }
  // 애니메이션 없이 바로 세워 두기 (인트로에서 넘어올 때)
  function place(sense) {
    if (active.has(sense)) return;
    active.add(sense);
    layers.filter(L => L.sense === sense).forEach(L => {
      L.anim = null; L.v = 1; L.alpha = 1; L.sy = 1; L.shade = 0; L.landed = true;
    });
    updateUI();
  }
  // 인트로가 끝나는 순간 네 감각을 한꺼번에: 뒤(산)에서 앞(숲)으로 종이가 연달아 일어섬
  function popAll(stagger = 65) {
    ensureAudio();
    const now = performance.now();
    SENSES.forEach(s => active.add(s));
    layers.filter(L => L.kind !== 'birds').forEach((L, i) => {
      if (L.v >= 1 && !L.anim) return;
      L.anim = { t0: now + i * stagger, dur: reduce ? 300 : 1000, to: 1, from: 0 };
      L.v = 0; L.landed = false; L.quiet = i % 3 !== 0;
    });
    setForest(true); setStrings(true);
    nextChirp = now + 1400;
    for (let i = 0; i < 3; i++) spawnBird(true);
    updateUI();
  }
  // 인트로 카드 안에 같은 종이 그림(나무·덤불)을 세우기 위해 넘겨줌
  function paperLayers() {
    return {
      W, H, PAD,
      layers: layers.filter(L => L.kind === 'paper' && L.canvas)
        .map(L => ({ d: L.d, sense: L.sense, canvas: L.canvas, tiles: L.tiles, bbox: L.bbox, hinge: L.hinge }))
    };
  }
  window.papercut = { birds, comers, ensureAudio, unfold, paperFlip, cloudSound, birdSound, chirp, sparkle, bowl, place, popAll, paperLayers, thump: () => thud(0.95) };

  resize();
  updateUI();
  requestAnimationFrame(frame);
})();
