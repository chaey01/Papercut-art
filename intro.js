// 인트로: 접힌 팝업 카드 → 위쪽 장이 일어서며 빛이 새어 나옴 → 카메라가 카드 안으로 → 빈 무대 + 단어 탭이 일어섬
(() => {
  const intro = document.getElementById('intro');
  if (!intro) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 타이밍 (ms) — 여기 숫자로 속도를 조절할 수 있어요
  const T_UNFOLD = 833;   // 카드와 안의 종이가 함께 펼쳐지는 시간 (style.css .flap / .plane transition과 맞추기)
  const T_ZOOM = 375;         // 카메라가 들어가기 시작한 뒤 화면이 사라지기까지
  const T_FOREST = 4583;   // 종이가 한 장씩 다 설 때까지 기다림 (= 250 + (종이 수-1)×간격 + 920 - T_UNFOLD)
  
  let started = false;

  // ---------- 카드 속 숲 (나무·덤불) 세우기 ----------
  function buildForest() {
    const P = window.papercut;
    const box = intro.querySelector('.diorama');
    if (!P || !P.paperLayers || !box) return;
    const { W, H, PAD, layers } = P.paperLayers();
    const TOP_SPACE = 10;   // 숲이 갈색 프레임 안에 정돈되어 보이도록 (위로 삐져나오지 않게)
    const book = intro.querySelector('.book');
    const w = book.offsetWidth, h = book.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    box.innerHTML = '';
    let i = 0;
    const STEP = 1.1;   // 종이 사이 간격 (카드 바닥 깊이의 %) — 작을수록 더 촘촘히 붙음
    const byDepth = layers.slice().sort((a, b) => a.d - b.d);
    // 매달린 구름(위에 매달린 PEACEFUL 종이)은 맨 마지막 순서로
    const isCloud = L => L.sense === 'peaceful' && L.hinge < 0;   // 매달린 구름
    const isBird = L => L.sense === 'chipping' && L.hinge < 0;    // 매달린 새
    const ordered = layers.filter(L => !isCloud(L) && !isBird(L))
      .concat(layers.filter(isCloud), layers.filter(isBird));   // 구름 → 새 순서로 맨 마지막
    for (const L of ordered) {
      // 장면의 모든 종이를 카드 안에 세움
      const plane = document.createElement('div');
      plane.className = 'plane';
      plane.dataset.kind = isCloud(L) ? 'cloud' : isBird(L) ? 'bird' : 'paper';   // 효과음 구분용
      // 깊이 d(0=맨 뒤, 1=맨 앞)를 카드 바닥 위의 위치로
      // 각 종이는 바로 뒤 종이의 밑변에 붙어서 섬 (종이 한 장 두께만큼만 앞으로)
      const p = 2 + byDepth.indexOf(L) * STEP;
      plane.style.bottom = (100 - p) + '%';
      plane.style.setProperty('--i', i++);
      // 나무 꼭대기가 잘리지 않게 종이를 위로 TOP_SPACE만큼 더 길게 (장면 높이 1000 기준)
      // 종이 높이는 그림이 있는 위치까지만 (위쪽 빈 부분은 잘라냄)
      // 매달린 구름·새는 실이 카드 뒷면(하늘 종이) 맨 위 끝까지 닿도록 종이를 위로 늘림.
      // 앞에 선 종이일수록 밑변이 낮아지므로(카드 바닥 기울기) 그만큼 더 늘림: 500 × p%
      const top = L.hinge < 0
        ? -Math.round(TOP_SPACE + 5 * p)
        : Math.max(-TOP_SPACE, Math.floor(L.bbox[1] - 30));
      const frac = (H - top) / H;
      plane.style.height = (100 * frac) + '%';
      const c = document.createElement('canvas');
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * frac * dpr);
      const g = c.getContext('2d');
      const k = c.width / W;
      g.setTransform(k, 0, 0, k, 0, -top * k);
      const [bx, by, bw, bh] = L.bbox;
      // 큰 그림을 한 번에 옮기면 Mac Chrome에서 1px 흰 세로선이 생김 → 조각(tiles)으로 나눠 그림
      const kk = (bw + PAD * 2) / L.canvas.width;
      if (L.tiles) for (const t of L.tiles) g.drawImage(t.c, t.sx, t.sy, t.w, t.h, bx - PAD + t.x * kk, by - PAD + t.y * kk, t.w * kk, t.h * kk);
      else g.drawImage(L.canvas, bx - PAD, by - PAD, bw + PAD * 2, bh + PAD * 2);
      plane.appendChild(c);
      box.appendChild(plane);
    }
  }

  function finish() {
    document.body.classList.add('ready');
    setTimeout(() => document.body.classList.add('settled'), 1500);
    setTimeout(() => intro.remove(), 1300);
  }

  function zoomIn() {
    const cam = intro.querySelector('.cam');
    const flap = intro.querySelector('.inside');
    const c = cam.getBoundingClientRect();
    const f = flap.getBoundingClientRect();
    const fx = f.left + f.width / 2;
    const fy = f.top + f.height / 2;
    cam.style.transformOrigin = `${fx - c.left}px ${fy - c.top}px`;
    const s = Math.max(innerWidth / f.width, innerHeight / f.height) * 1.2;
    cam.style.transform = `translate(${innerWidth / 2 - fx}px, ${innerHeight / 2 - fy}px) scale(${s})`;
    // 카드 속 산이 무대의 산으로 이어지도록, 화면이 넘어가기 직전에 MOUNTAIN을 켜 둠
    // 카메라가 들어가는 순간 숲·계곡·산·구름이 한꺼번에 팝업
    // 큰 화면은 노을 하늘만 있는 빈 무대 — 단어를 누르면 레이어가 등장
    setTimeout(() => { intro.classList.add('gone'); finish(); }, T_ZOOM);
  }

  function openCard() {
    if (started) return;
    started = true;
    const P = window.papercut;
    if (reduce) { intro.classList.add('gone'); finish(); return; }
    intro.classList.add('open');
    if (P) {
      P.ensureAudio();
      // 종이가 한 장씩 넘어가 일어설 때마다 '스윽-탁' (.plane 의 .21s + i×183ms 와 맞춤)
      // 종이는 불규칙하게 가끔 책장 소리, 구름은 소리 없음, 새는 날갯짓 + 짹 (각 종이가 일어서는 시점에 맞춤)
      let paperN = 0, birdN = 0, lastFlip = -1e9, lastBirdAt = 0;
      intro.querySelectorAll('.plane').forEach((pl, i) => {
        const at = 210 + i * 183, kind = pl.dataset.kind;
        if (kind === 'cloud') { /* 구름은 소리 없이 */ }
        else if (kind === 'bird') { const k = birdN++; if (k % 2 === 0) setTimeout(() => P.chirp && P.chirp(), at + 150 + Math.random() * 150); lastBirdAt = at; }   // 가끔 '짹'
        else {
          // 불규칙하게: 첫 장은 꼭, 그 뒤로는 무작위로 띄엄띄엄 (가까운 소리끼리는 최소 0.45초 간격), 타이밍·세기도 제각각
          const tAt = at + (Math.random() - 0.3) * 160;
          if (paperN++ === 0 || (Math.random() < 0.24 && tAt - lastFlip > 450)) {
            lastFlip = tAt;
            setTimeout(() => P.paperFlip(0.55 + Math.random() * 0.45), Math.max(0, tAt));
          }
        }
      });
    }
    setTimeout(zoomIn, T_UNFOLD + T_FOREST);  // 나무까지 다 선 뒤 카메라가 들어감
  }

  // 종이 그림이 준비된 뒤 숲을 세우고, 창 크기가 바뀌면 다시 만듦
  requestAnimationFrame(buildForest);
  let rt = 0;
  window.addEventListener('resize', () => {
    if (started) return;
    clearTimeout(rt);
    rt = setTimeout(buildForest, 250);
  });

  const wake = () => { if (window.papercut) window.papercut.ensureAudio(); };
  setTimeout(wake, 0);   // 미리 소리 준비(책장 소리 파일 불러오기) — 실제 재생은 브라우저가 허락한 뒤
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  // 화면을 켜면: 종이 모서리 선 → 각도가 바뀌며 면으로 펼쳐짐(닫힌 편지) → 카드가 열리며 종이가 한 장씩 일어섬
  const T_EDGE = 500;   // 선으로 보이는 시간
  const T_FACE = 1700;  // 선이 면으로 펼쳐지고 편지를 보여 주는 시간
  setTimeout(() => intro.classList.replace('edge', 'face'), T_EDGE);
  // 편지가 다 나타나면 클릭(또는 Enter·Space)을 기다림 → 누르면 카드가 열림 (이 클릭으로 소리도 켜짐)
  let canOpen = false;
  setTimeout(() => { canOpen = true; intro.classList.add('wait'); }, T_EDGE + T_FACE);
  const start = () => {
    if (!canOpen || started) return;
    wake();
    intro.classList.remove('face', 'wait');
    openCard();
  };
  intro.querySelector('.book').addEventListener('click', start);   // 편지(카드)를 눌러야만 열림
  window.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') start(); });
})();
