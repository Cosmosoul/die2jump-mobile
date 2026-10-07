'use strict';
/* =============================================================================
   拼死跳跃 · 手机版专属表现层（必须在 game.js 之后加载）

   设计原则：
   · 局内（playing / pause / win / fail）＝ 拟物化复古掌机：塑料机身外壳、
     凹陷屏幕、LCD 信息盘（生命 / 旗帜 / 用时 / 慢放）、圆形按键簇。
     所有按键为 canvas2D 绘制的“实体键”（渐变面 + 高光 + 凹陷内影 + 按下反馈），
     每个键都带图元符号 + 中文短标签，便于识别、方便点击。
   · 局外（主菜单 / 选关 / 设置 / 说明 / 确认）＝ 沿用原版明亮卡通风，
     但按“竖屏原生”重新排布：全宽大按钮、纵向关卡列表、加大的字号与点击区。
   · 与电脑版完全独立：只有 mobile/index.html 引用本文件。

   竖屏设计宽度固定 540 设计单位；scale = innerWidth / 540，
   于是 W=540 恒成立、H = innerHeight / scale，横竖屏都能得到一致的设计坐标。
   横屏时只显示“请竖屏使用”提示（本作为竖屏操作设计）。
   ========================================================================== */
(function () {
  if (!window.Game) return;
  window.MOBILE_MODE = true;

  /* ------------------------------------------------------------------ 常量 */
  const DESIGN_W = 540;   /* 竖屏统一设计宽度 */
  const INK = 10.8;       /* 位图字“可见字高”≈ 10.8 × mul 设计单位 */
  const KEY_CELLS = 9;    /* 自定义图元按 9×9 网格书写 */

  const MU = window.MU = {};
  MU.landscape = false;
  MU.safeTop = 0;
  MU.safeBottom = 0;
  MU.held = Object.create(null);   /* 被按住的按键 id → 对应的键码 */
  MU.flash = Object.create(null);  /* 点按类按键的瞬时高亮（id → 截止时刻） */
  MU._tapT = {};                   /* 轻点代替长按的定时器 */

  /* 期望“屏幕上”的 CSS 像素高 → 位图 mul（保证各机型物理观感一致） */
  MU.T = function (cssPx) { return Math.max(0.6, cssPx / (INK * scale)); };
  /* 期望 CSS 像素的单个像素块 → 图元单元尺寸 */
  MU.U = function (cssPx) { return Math.max(0.6, cssPx / (KEY_CELLS * scale)); };

  /* --------------------------------------------------- 描边字（带 ctx 版本） */
  /* game.js 的 text() 固定画在主画布上；掌机机身为静态内容、需要烘焙到离屏
     画布，所以这里实现一组可指定 ctx 的同源文字，保证风格完全一致。 */
  MU.txt = function (ctx, s, cx, cy, color, mul, alpha) {
    if (s === undefined || s === null || s === '') return;
    ctx.save();
    if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(mul, mul);
    drawPixelText(ctx, String(s), 0, 0, UI_STYLE.fontSize, color, null, 1, UI_STYLE.pixelSize);
    ctx.restore();
  };
  MU.txtW = function (s, mul) {
    const b = _getPxTextBitmap(String(s), UI_STYLE.fontSize, '#ffffff', UI_STYLE.pixelSize);
    return b.w * UI_STYLE.pixelSize * mul;
  };
  MU.txtLeft = function (ctx, s, x, y, color, mul, alpha) {
    MU.txt(ctx, s, x + MU.txtW(s, mul) / 2, y, color, mul, alpha);
  };
  MU.txtRight = function (ctx, s, x, y, color, mul, alpha) {
    MU.txt(ctx, s, x - MU.txtW(s, mul) / 2, y, color, mul, alpha);
  };

  /* ------------------------------------------------------------ 圆角矩形路径 */
  MU.rrPath = function (ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  MU.fillRR = function (ctx, x, y, w, h, r, style) {
    ctx.beginPath(); MU.rrPath(ctx, x, y, w, h, r);
    ctx.fillStyle = style; ctx.fill();
  };
  /* LCD 凹槽盘：外框深色内投影 + 微亮下边缘，制造“嵌入面板”的体积感 */
  MU.plate = function (ctx, x, y, w, h, r) {
    r = r === undefined ? 10 : r;
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#0d1211'); gr.addColorStop(0.55, '#141c1b'); gr.addColorStop(1, '#1d2725');
    ctx.save();
    ctx.beginPath(); MU.rrPath(ctx, x, y, w, h, r);
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.72)'; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.075)'; ctx.fillRect(x + 4, y + h - 2.5, w - 8, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(x + 2, y + 1, w - 4, 1);
  };

  /* -------------------------------------------------------------- 图元字形 */
  /* 9×9 像素图元，'1' 为实心。复古掌机核心视觉：纯像素块拼成。 */
  MU.G = {
    left: ['....1....', '...11....', '..111....', '.1111....', '11111....',
      '.1111....', '..111....', '...11....', '....1....'],
    right: ['....1....', '....11...', '....111..', '....1111.', '....11111',
      '....1111.', '....111..', '....11...', '....1....'],
    up: ['....1....', '...111...', '..11111..', '.1111111.', '111111111',
      '....1....', '....1....', '....1....', '....1....'],
    down: ['....1....', '....1....', '....1....', '....1....', '111111111',
      '.1111111.', '..11111..', '...111...', '....1....'],
    flag: ['..111111.', '..111111.', '..111111.', '..1111...', '..11.....',
      '..11.....', '..11.....', '..11.....', '..11.....'],
    slow: ['1111111..', '.1...1...', '..1.1....', '...1.....', '...1.....',
      '..1.1....', '.1...1...', '1111111..', '.........'],
    skull: ['.1111111.', '111111111', '11.111.11', '11.111.11', '111111111',
      '.1111111.', '..1.1.1..', '.........', '.........'],
    restart: ['...11111.', '..1....11', '.1......1', '1.......1', '1.......1',
      '1.......1', '.1.....1.', '..1...1..', '...111...'],
    pause: ['..111.111', '..111.111', '..111.111', '..111.111', '..111.111',
      '..111.111', '..111.111', '..111.111', '..111.111'],
  };
  MU.glyph = function (ctx, name, cx, cy, u, color) {
    const map = MU.G[name];
    if (!map) return;
    const rows = map.length, cols = map[0].length;
    const ox = cx - cols * u / 2, oy = cy - rows * u / 2;
    const cell = Math.max(1, Math.ceil(u));
    ctx.fillStyle = color;
    for (let r = 0; r < rows; r++) {
      const line = map[r];
      for (let c = 0; c < cols; c++) {
        if (line.charAt(c) === '1') ctx.fillRect(Math.round(ox + c * u), Math.round(oy + r * u), cell, cell);
      }
    }
  };

  /* -------------------------------------------------------------- 配色家族 */
  /* a/b/c：键面高光→本色→暗面；rim：外圈；glyph：符号与标签色 */
  MU.PAL = {
    neutral: { a: '#9ea8b2', b: '#6e7882', c: '#49525a', rim: '#1f262c', glyph: '#f5f8fa' },
    gold: { a: '#ffe89b', b: '#e8b641', c: '#b8801a', rim: '#6a4807', glyph: '#4a3206' },
    teal: { a: '#9ff0e2', b: '#5cc3b1', c: '#2f9e8f', rim: '#15544b', glyph: '#0a3833' },
    green: { a: '#bceaa6', b: '#7cc069', c: '#4e9c46', rim: '#264f1e', glyph: '#163a12' },
    red: { a: '#f9b0b5', b: '#dd6a7a', c: '#c4364a', rim: '#6d1925', glyph: '#4a0d15' },
    violet: { a: '#d6ccfa', b: '#a68fea', c: '#7b63d6', rim: '#392b72', glyph: '#241a52' },
  };

  /* -------------------------------------------------------------- 几何布局 */
  /* 严格对照参考图 phoneoverlay.jpeg（301×649 像素）的排布：
       生命盘 | 旗帜盘
       ┌──── 游戏画面（1.44:1）────┐
              用时盘
       ──── 减速进度条 ────
       按键簇（从参考图逐个量出的圆心 / 直径）：
          x/W=0.118  x/W=0.341   x/W=0.671   x/W=0.871
                        ·        插旗        减速
           左         右                   跳（主操作，稍大）
                                 自杀
                                            起点
                     暂停（底部居中）
     横向圆心直接取参考图的归一化坐标；纵向以「减速」为簇顶锚点，各键
     相对减速的像素距离按 K=W/301 等比换算，整簇再乘统一缩放 s，
     因此在任何机型上键与键的相对关系都与参考图完全一致。 */
  MU.compute = function () {
    const geo = {};
    geo.W = W; geo.H = H;

    /* 参考图基准（像素）——所有按键位置均由这张表推导，便于核对 */
    const REF = {
      W: 301, H: 649,
      topCy: 414.5,                                   /* 「减速」圆心 y */
      keys: [
        /* id            refCx  refCy   refD  fam       glyph      label   hold      */
        ['mobLeft', 35.5, 479.5, 59, 'neutral', 'left', '左', 'ArrowLeft'],
        ['mobRight', 102.5, 479.5, 59, 'neutral', 'right', '右', 'ArrowRight'],
        ['mobFlag', 202.0, 445.5, 47, 'green', 'flag', '插旗', null],
        ['mobDie', 202.0, 520.0, 47, 'red', 'skull', '自杀', null],
        ['mobSlow', 262.0, 414.5, 47, 'teal', 'slow', '减速', 'KeyJ'],
        ['mobJump', 262.0, 479.5, 59, 'gold', 'up', '跳', 'ArrowUp'],
        ['mobRestart', 262.0, 545.0, 47, 'violet', 'restart', '起点', null],
        ['mobPause', 150.0, 605.0, 49, 'neutral', 'pause', '暂停', null],
      ],
    };

    /* ---- 顶部：生命盘 / 旗帜盘 ---- */
    const pad = 14, topY = Math.round(MU.safeTop) + 12, topH = 60;
    const plateW = Math.round((W - pad * 2 - 12) / 2);
    geo.livesPlate = { x: pad, y: topY, w: plateW, h: topH };
    geo.flagsPlate = { x: W - pad - plateW, y: topY, w: plateW, h: topH };

    /* ---- 竖向预算：盘 → 画面 → 用时 → 慢放 → 按键簇 ---- */
    const SEAM_TOP = 14;                  /* 盘与画面 */
    const timeH = 58, SEAM1 = 12;         /* 画面与用时 */
    const slowH = 26, SEAM2 = 10;         /* 用时与慢放 */

    const margin = Math.max(14, 0.022 * W);
    const bottomLimit = H - Math.round(MU.safeBottom) - Math.max(16, 0.022 * H);
    const topBlockEnd = topY + topH + SEAM_TOP;

    /* 簇高（减速上缘 → 暂停下缘）按参考图 = (190.5 + 47/2 + 49/2) / 301 ≈ 0.792×W */
    const clusterUnitH = 0.792 * W;
    const belowScreen = SEAM1 + timeH + SEAM2 + slowH;

    /* 画面：宽度铺满（留 margin），1.44:1；并限制不超过屏高的 42% */
    const screenW = W - margin * 2;
    const screenNat = Math.min(screenW / 1.44, H * 0.42);

    /* s：按键簇统一缩放。先按“参考图比例”给足画面，再看剩余高度决定按键能多大；
       所有键径与纵向距离都乘同一个 s，保证任何机型上形态一致。
       下限 0.62 保证可点，上限 1.18 避免最大键横向顶出机身。 */
    const room = (bottomLimit - topBlockEnd) - belowScreen;
    let s = 1;
    if (screenNat + clusterUnitH > room) {
      /* 空间不够：优先压缩按键簇（画面是核心体验，不要让位） */
      s = (room - Math.max(140, screenNat * 0.62)) / clusterUnitH;
      s = Math.max(0.62, Math.min(1.18, s));
    }
    const clusterH = clusterUnitH * s;
    let screenH = Math.min(screenNat, Math.max(120, room - clusterH));

    /* 余量在画面与按键簇之间对半分摊，避免顶部或底部出现突兀的空档 */
    const slack = Math.max(0, room - screenH - clusterH);
    const yOff = slack / 2;

    geo.screenX = Math.round(margin); geo.screenW = Math.round(screenW);
    geo.screenY = Math.round(topBlockEnd + yOff);
    geo.screenH = Math.round(screenH);

    geo.ctrlTop = Math.round(geo.screenY + geo.screenH + belowScreen + yOff);

    /* 「减速」圆心（簇顶内缘） */
    geo.s = s;
    const K = (W / REF.W) * s;                  /* 参考图像素 → 设计单位 */
    const topCy = geo.ctrlTop + (REF.keys[4][3] / 2) * (W / REF.W) * s;

    geo.d = REF.keys[4][3] * (W / REF.W) * s;   /* 以「减速」为基准直径 */

    /* ---- 用时盘 / 慢放条（居中；宽度按实际文字量取，避免“第 N 关”与计时重叠） ---- */
    const timeMul = MU.T(19), lvMul = MU.T(11.5);
    const needW = 16 + MU.txtW('第 88 关', lvMul) + 12 + MU.txtW('88:88.88', timeMul) + 16;
    const timeW = Math.round(Math.min(W - margin * 2, Math.max(0.46 * W, needW)));
    geo.timeX = Math.round((W - timeW) / 2); geo.timeW = timeW;
    geo.timeY = Math.round(geo.screenY + geo.screenH + SEAM1); geo.timeH = timeH;

    const slowW = Math.round(0.70 * W);
    geo.slowX = Math.round((W - slowW) / 2); geo.slowW = slowW;
    geo.slowY = Math.round(geo.timeY + timeH + SEAM2); geo.slowH = slowH;

    /* ---- 按键簇：逐键取参考图坐标，纵向相对「减速」等比换算 ---- */
    geo.controls = REF.keys.map(function (k) {
      return {
        id: k[0],
        cx: (k[1] / REF.W) * W,
        cy: topCy + (k[2] - REF.topCy) * K,
        r: (k[3] / 2) * (W / REF.W) * s,
        fam: k[4], glyph: k[5], label: k[6], hold: k[7],
      };
    });

    /* 簇的上下界，供校验与调试使用 */
    const last = geo.controls[geo.controls.length - 1];
    geo.clusterTop = geo.ctrlTop;
    geo.clusterBottom = last.cy + last.r;
    MU.GEO = geo;
    MU.bakeKey = '';
  };
  MU.ensureGeo = function () { if (!MU.GEO) MU.compute(); };

  /* ----------------------------------------------------------------- resize */
  MU.insets = function () {
    let el = MU._insetEl;
    if (!el) {
      el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(el);
      MU._insetEl = el;
    }
    const cs = getComputedStyle(el);
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    return { top: num(cs.paddingTop), bottom: num(cs.paddingBottom) };
  };
  function MU_resize() {
    MU.landscape = innerWidth > innerHeight * 1.15;

    const nd = Math.min(window.devicePixelRatio || 1, 2);
    if (nd !== dpr) { window.dpr = nd; dpr = nd; }

    /* 固定设计宽度 → 各机型字号与按键的“物理尺寸”一致 */
    scale = innerWidth / DESIGN_W;
    W = DESIGN_W;
    H = innerHeight / scale;
    VS = H / UI_STYLE.baseHeight; HS = 1;

    ui.width = Math.round(innerWidth * dpr);
    ui.height = Math.round(innerHeight * dpr);
    screenKey = '';

    const ins = MU.insets();
    MU.safeTop = ins.top / scale;
    MU.safeBottom = ins.bottom / scale;

    MU.compute();

    const wrap = D.playCanvasWrap;
    if (wrap) {
      if (MU.landscape) {
        wrap.style.display = 'none';
      } else {
        const geo = MU.GEO;
        wrap.style.display = 'block';
        wrap.style.left = (geo.screenX * scale) + 'px';
        wrap.style.top = (geo.screenY * scale) + 'px';
        wrap.style.width = (geo.screenW * scale) + 'px';
        wrap.style.height = (geo.screenH * scale) + 'px';
        wrap.classList.add('md');
      }
    }
    if (!MU.landscape && typeof resizePlayCanvas === 'function') resizePlayCanvas();

    /* 转到横屏时自动暂停，避免玩家在看不到画面时“盲玩” */
    if (MU.landscape && Game.state === 'playing') { Play.keys = {}; MU.releaseAll(); pause(); }
  }
  window.addEventListener('resize', MU_resize);
  window.addEventListener('orientationchange', function () { setTimeout(MU_resize, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', MU_resize);

  /* --------------------------------------------------------------- 机身烘焙 */
  /* 静态部分（外壳 / 包边 / 盘面 / 键面 / 符号 / 标签）只画一次，之后每帧一次
     drawImage，避免 60fps 反复创建渐变造成的开销。 */
  MU.bake = function () {
    const bw = Math.max(1, Math.round(W * dpr * scale));
    const bh = Math.max(1, Math.round(H * dpr * scale));
    if (!MU._cv) { MU._cv = document.createElement('canvas'); MU._cg = MU._cv.getContext('2d'); }
    const cv = MU._cv, cg = MU._cg;
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, bw, bh);
    cg.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    const geo = MU.GEO, Wd = geo.W, Hd = geo.H;
    const sx = geo.screenX, sy = geo.screenY, sw = geo.screenW, sh = geo.screenH;

    /* 1) 机身塑料外壳：上亮下暗竖向渐变铺满，用 even-odd 挖掉屏幕窗口，
          窗口保持透明，让下层游戏画布透出来。 */
    const shell = cg.createLinearGradient(0, 0, 0, Hd);
    shell.addColorStop(0, '#737d87');
    shell.addColorStop(0.30, '#5d666f');
    shell.addColorStop(0.72, '#474f57');
    shell.addColorStop(1, '#353c43');
    cg.beginPath(); cg.rect(0, 0, Wd, Hd); MU.rrPath(cg, sx, sy, sw, sh, 14);
    cg.fillStyle = shell; cg.fill('evenodd');

    /* 机身细节：上下亮暗边、四角螺钉 */
    cg.fillStyle = 'rgba(255,255,255,.12)'; cg.fillRect(0, 0, Wd, 2);
    cg.fillStyle = 'rgba(255,255,255,.05)'; cg.fillRect(0, 2, Wd, 1);
    cg.fillStyle = 'rgba(0,0,0,.28)'; cg.fillRect(0, Hd - 3, Wd, 3);
    const studs = [[14, Math.round(MU.safeTop) + 8], [Wd - 14, Math.round(MU.safeTop) + 8],
    [14, Hd - Math.round(MU.safeBottom) - 12], [Wd - 14, Hd - Math.round(MU.safeBottom) - 12]];
    for (let si = 0; si < studs.length; si++) {
      const s = studs[si];
      cg.fillStyle = 'rgba(0,0,0,.34)'; cg.beginPath(); cg.arc(s[0], s[1], 5, 0, 6.2832); cg.fill();
      cg.fillStyle = 'rgba(255,255,255,.16)'; cg.beginPath(); cg.arc(s[0], s[1], 3.4, 0, 6.2832); cg.fill();
      cg.fillStyle = 'rgba(0,0,0,.28)'; cg.fillRect(s[0] - 2.6, s[1] - 0.7, 5.2, 1.4);
    }

    /* 2) 屏幕包边：深色环 + 内圈阴影，制造屏幕“凹陷” */
    cg.beginPath();
    MU.rrPath(cg, sx - 9, sy - 9, sw + 18, sh + 18, 20);
    MU.rrPath(cg, sx, sy, sw, sh, 14);
    cg.fillStyle = '#1b2126'; cg.fill('evenodd');
    cg.beginPath(); MU.rrPath(cg, sx - 9, sy - 9, sw + 18, sh + 18, 20);
    cg.strokeStyle = 'rgba(0,0,0,.55)'; cg.lineWidth = 1.6; cg.stroke();
    cg.beginPath(); MU.rrPath(cg, sx - 2, sy - 2, sw + 4, sh + 4, 16);
    cg.strokeStyle = 'rgba(0,0,0,.6)'; cg.lineWidth = 3; cg.stroke();
    cg.beginPath(); MU.rrPath(cg, sx + 1, sy + 1, sw - 2, sh - 2, 13);
    cg.strokeStyle = 'rgba(255,255,255,.10)'; cg.lineWidth = 1.6; cg.stroke();

    /* 3) 信息盘（盘框为静态） + 盘内固定小标题 */
    MU.plate(cg, geo.livesPlate.x, geo.livesPlate.y, geo.livesPlate.w, geo.livesPlate.h, 10);
    MU.plate(cg, geo.flagsPlate.x, geo.flagsPlate.y, geo.flagsPlate.w, geo.flagsPlate.h, 10);
    MU.plate(cg, geo.timeX, geo.timeY, geo.timeW, geo.timeH, 10);
    MU.plate(cg, geo.slowX, geo.slowY, geo.slowW, geo.slowH, 10);

    const cap = '#7d9a90', capM = MU.T(11.5);
    MU.txtLeft(cg, '生命', geo.livesPlate.x + 16, geo.livesPlate.y + 19, cap, capM);
    MU.txtRight(cg, '旗帜', geo.flagsPlate.x + geo.flagsPlate.w - 16, geo.flagsPlate.y + 19, cap, capM);
    MU.txtLeft(cg, '用时', geo.timeX + 14, geo.timeY + 14, cap, MU.T(9.5));
    MU.txtLeft(cg, '慢放', geo.slowX + 14, geo.slowY + geo.slowH / 2, cap, capM);

    /* 慢放盘静态底槽 */
    const barX = geo.slowX + Math.max(52, MU.txtW('慢放', capM) + 22);
    const barW = geo.slowX + geo.slowW - 14 - barX;
    MU._bar = { x: barX, w: barW, y: geo.slowY + geo.slowH / 2 };
    cg.fillStyle = '#080c0b'; cg.fillRect(barX, MU._bar.y - 9, barW, 18);
    cg.fillStyle = '#101817'; cg.fillRect(barX + 2, MU._bar.y - 7, barW - 4, 14);
    cg.fillStyle = 'rgba(0,0,0,.5)'; cg.fillRect(barX + 2, MU._bar.y + 5, barW - 4, 2);
    cg.fillStyle = 'rgba(255,255,255,.10)';
    for (let i = 1; i < 4; i++) cg.fillRect(barX + 2 + (barW - 4) * i / 4, MU._bar.y - 7, 1.5, 14);

    /* 4) 圆形按键：键面 + 高光 + 符号 + 标签（全部静态） */
    for (let ci = 0; ci < geo.controls.length; ci++) MU.bakeFace(cg, geo.controls[ci]);

    cg.setTransform(1, 0, 0, 1, 0, 0);
    MU.bakeKey = MU.key();
  };
  MU.key = function () {
    const geo = MU.GEO;
    return [Math.round(geo.W), Math.round(geo.H), scale.toFixed(4), dpr,
      geo.d.toFixed(2), Math.round(MU.safeTop), Math.round(MU.safeBottom)].join('|');
  };

  /* 单个圆形按键的静态外观 */
  MU.bakeFace = function (ctx, c) {
    const P = MU.PAL[c.fam], r = c.r;
    ctx.beginPath(); ctx.arc(c.cx, c.cy + Math.max(3, r * 0.09), r, 0, 6.2832);
    ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fill();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r, 0, 6.2832);
    ctx.fillStyle = P.rim; ctx.fill();
    const gr = ctx.createLinearGradient(0, c.cy - r, 0, c.cy + r);
    gr.addColorStop(0, P.a); gr.addColorStop(0.48, P.b); gr.addColorStop(1, P.c);
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - 3, 0, 6.2832);
    ctx.fillStyle = gr; ctx.fill();
    ctx.beginPath(); ctx.arc(c.cx, c.cy - r * 0.16, r * 0.70, Math.PI * 1.14, Math.PI * 1.86);
    ctx.strokeStyle = 'rgba(255,255,255,.34)'; ctx.lineWidth = Math.max(1.4, r * 0.085); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.cx, c.cy + r * 0.18, r * 0.72, Math.PI * 0.14, Math.PI * 0.86);
    ctx.strokeStyle = 'rgba(0,0,0,.20)'; ctx.lineWidth = Math.max(1.4, r * 0.09); ctx.stroke();
    const gu = MU.U(18);
    MU.glyph(ctx, c.glyph, c.cx, c.cy - r * 0.22, gu, P.glyph);
    MU.txt(ctx, c.label, c.cx, c.cy + r * 0.48, P.glyph, MU.T(11.5));
  };

  /* ------------------------------------------------------ 掌机机身（局内渲染） */
  MU.drawChrome = function () {
    const ctx = g;
    if (MU.bakeKey !== MU.key()) MU.bake();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(MU._cv, 0, 0); ctx.restore();

    MU.drawPlates();      /* 生命 / 旗帜 / 用时 / 慢放 的动态内容 */
    MU.drawControls();    /* 按下反馈 + 起点二次确认高亮 */
    MU.drawWaterHint();
  };

  /* 生命盘：红心格；刚掉血时闪一圈红 */
  MU.drawPlates = function () {
    const ctx = g, geo = MU.GEO, lp = geo.livesPlate, fp = geo.flagsPlate;
    const n = Math.max(0, Play.lives);
    const step = 23;
    const startX = lp.x + 18;
    const hY = lp.y + lp.h - 26;
    for (let i = 0; i < n; i++) heart(startX + i * step, hY, 2);
    if (!n) MU.txt(ctx, '—', lp.x + lp.w / 2, lp.y + lp.h - 20, '#5f736a', MU.T(15));
    for (let hi = 0; hi < Game.hearts.length; hi++) {
      const t = clock - Game.hearts[hi].time;
      if (t < 0.75) {
        ctx.save(); ctx.globalAlpha = 1 - t / 0.75;
        ctx.beginPath(); MU.rrPath(ctx, lp.x - 2, lp.y - 2, lp.w + 4, lp.h + 4, 12);
        ctx.strokeStyle = '#ff6b7a'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
      }
    }
    const f = Play.flagsCollected;
    if (!f) MU.txt(ctx, '无', fp.x + fp.w / 2, fp.y + fp.h - 20, '#5f736a', MU.T(15));
    else {
      const show = Math.min(f, 6);
      for (let i = 0; i < show; i++) flagIcon(fp.x + 20 + i * 27, fp.y + fp.h - 34, 1.7);
      MU.txtRight(ctx, '×' + f, fp.x + fp.w - 14, fp.y + fp.h - 20, '#f4d97a', MU.T(13));
    }
    MU.txtLeft(ctx, '第 ' + String(Game.selected + 1) + ' 关', geo.timeX + 14, geo.timeY + geo.timeH * 0.62, '#8fae9f', MU.T(11));
    MU.txtRight(ctx, formatTime(Game.elapsed), geo.timeX + geo.timeW - 16, geo.timeY + geo.timeH * 0.66, '#f6dd86', MU.T(19));

    const bar = MU._bar;
    if (bar) {
      const e = Math.max(0, Math.min(1, Play.energy));
      if (e > 0.004) {
        const fw = Math.max(3, (bar.w - 4) * e);
        const gr = ctx.createLinearGradient(0, bar.y - 7, 0, bar.y + 7);
        gr.addColorStop(0, '#a8f7e2'); gr.addColorStop(0.5, '#5cc3b1'); gr.addColorStop(1, '#2b8f82');
        ctx.fillStyle = gr; ctx.fillRect(bar.x + 2, bar.y - 7, fw, 14);
        ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fillRect(bar.x + 2, bar.y - 7, fw, 3);
      }
      if (e > 0.995) { ctx.fillStyle = 'rgba(210,255,246,.85)'; ctx.fillRect(bar.x + 2, bar.y - 7, bar.w - 4, 2); }
    }
  };

  /* 按键前景：按下时的内阴影 + 点按闪光 + 起点二次确认脉冲 */
  MU.drawControls = function () {
    const ctx = g, geo = MU.GEO;
    for (let i = 0; i < geo.controls.length; i++) {
      const c = geo.controls[i];
      const pressed = !!MU.held[c.id] || !!(c.hold && Play.keys[c.hold]) || (MU.flash[c.id] > clock);
      if (pressed) {
        ctx.save();
        if (Play.keys[c.hold] && !MU.held[c.id]) ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r - 3, 0, 6.2832);
        ctx.fillStyle = 'rgba(0,0,0,.20)'; ctx.fill();
        ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r - 2, 0, 6.2832);
        ctx.strokeStyle = 'rgba(255,255,255,.20)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      }
      if (c.id === 'mobRestart' && MU.flash[c.id] > clock) {
        const p = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(clock * 11));
        ctx.save(); ctx.globalAlpha = p;
        ctx.beginPath(); ctx.arc(c.cx, c.cy, c.r + 4, 0, 6.2832);
        ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3.4; ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* 入水窒息提示：压在屏幕下沿，不遮挡机身结构 */
  MU.drawWaterHint = function () {
    if (!Play._inWater) return;
    const ctx = g, geo = MU.GEO;
    const w = 214, h = 34, x = geo.screenX + (geo.screenW - w) / 2, y = geo.screenY + geo.screenH - h - 8;
    ctx.save(); ctx.globalAlpha = 0.92;
    MU.plate(ctx, x, y, w, h, 9);
    MU.txt(ctx, '呼吸 ' + Play.waterBubbleTimer.toFixed(1) + ' 秒', x + w / 2, y + h / 2, '#f6dd86', MU.T(13));
    ctx.restore();
  };

  /* -------------------------------------------------------------- 按键行为 */
  /* 长按类：轻点（鼠标 / 无障碍 / 键盘激活）时给一次短促按压。
     同时登记进 MU.held，让全局 release 兜底能回收，避免“卡住不放”。 */
  MU.tapHold = function (code) {
    if (Game.state !== 'playing' || !code) return;
    const tk = '__tap_' + code;
    Play.keys[code] = true;
    MU.held[tk] = code;
    if (code === 'KeyJ') AudioSystem.sfx('slow');
    clearTimeout(MU._tapT[tk]);
    MU._tapT[tk] = setTimeout(function () {
      delete MU.held[tk];
      delete MU._tapT[tk];
      Play.keys[code] = false;
    }, 210);
  };
  MU.releaseAll = function () {
    for (const k in MU.held) delete MU.held[k];
    for (const k in MU._tapT) { clearTimeout(MU._tapT[k]); delete MU._tapT[k]; }
  };
  /* 「起点」：把角色送回当前出生点（有旗子则回旗子），不消耗生命、
     不产生幽灵。与「自杀」的区别是「自杀」会扣血并留下回放幽灵。 */
  MU.goToSpawn = function () {
    if (Game.state !== 'playing') return;
    if (typeof respawnPlay === 'function') {
      respawnPlay(Play.currentFlag ? 'flag' : 'default');
      Play.trajectory = [];
      AudioSystem.sfx('uiClick');
      notify(Play.currentFlag ? '回到旗子' : '回到起点');
    }
  };
  MU.ctrlFn = function (c) {
    if (c.hold) return function () { MU.tapHold(c.hold); };
    if (c.id === 'mobFlag') return function () { if (Game.state === 'playing') doFlagAction(); };
    if (c.id === 'mobDie') return function () { if (Game.state === 'playing') doSuicidePlay(); };
    if (c.id === 'mobRestart') return function () { MU.goToSpawn(); };
    if (c.id === 'mobPause') return function () { if (Game.state === 'playing' || Game.state === 'pause') pause(); };
    return function () { };
  };

  /* ------------------------------------------------------------- 局内 HUD */
  hud = function () {
    if (MU.landscape) return;
    MU.ensureGeo();
    buttons.length = 0;
    for (let i = 0; i < MU.GEO.controls.length; i++) {
      const c = MU.GEO.controls[i];
      buttons.push({
        id: c.id, label: c.label + '（触屏按键）',
        x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2,
        fn: MU.ctrlFn(c), _mob: c,
      });
    }
    MU.drawChrome();
  };

  /* ------------------------------------------- 无障碍 DOM 层：附加长按支持 */
  const _origSyncAccess = syncAccess;
  let COARSE = false;
  try { COARSE = window.matchMedia('(pointer:coarse)').matches; } catch (e) { COARSE = true; }

  /* 触屏上长按类按键由 pointerdown/up 处理，因此必须屏蔽随后的 click→activate，
     否则松手后还会多触发一次 210ms 的“轻点”，出现二段跳之类的误操作。 */
  const _origActivate = activate;
  activate = function (id) {
    let b = null;
    for (let i = 0; i < buttons.length; i++) if (buttons[i].id === id) { b = buttons[i]; break; }
    if (COARSE && b && b._mob) {
      if (b._mob.hold) return;                       /* 长按键：交给 pointer 处理 */
      /* 点按类按键：闪一下键面作为按下反馈，再执行动作 */
      MU.flash[id] = clock + 0.14;
      setTimeout(function () { delete MU.flash[id]; }, 150);
    }
    return _origActivate(id);
  };

  syncAccess = function () {
    _origSyncAccess();
    if (!COARSE) return;
    const list = access.querySelectorAll('button[id^="mob"]');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el._mobBound) continue;
      el._mobBound = true;
      let ctrl = null;
      for (let j = 0; j < buttons.length; j++) {
        if (buttons[j].id === el.id) { ctrl = buttons[j]._mob; break; }
      }
      const code = ctrl && ctrl.hold;
      if (!code) continue;
      const down = function (ev) {
        if (Game.state !== 'playing') return;
        /* 阻止冒泡到 window：否则主输入层会把这次按压当成“拖动镜头”，
           导致按住方向键的同时镜头跟着乱走。 */
        ev.stopPropagation();
        ev.preventDefault();
        try { el.setPointerCapture(ev.pointerId); } catch (e) { }
        MU.held[el.id] = code;
        Play.keys[code] = true;
        if (code === 'KeyJ') AudioSystem.sfx('slow');
      };
      const up = function (ev) {
        if (ev) ev.stopPropagation();
        const held = MU.held[el.id];
        if (!held) return;
        delete MU.held[el.id];
        Play.keys[typeof held === 'string' ? held : code] = false;
      };
      el.addEventListener('pointerdown', down, { passive: false });
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  };

  /* 全局兜底：手指滑出按键后松手也要释放，避免“一直按着”导致的失控 */
  function globalRelease() {
    for (const k in MU.held) {
      const v = MU.held[k];
      if (typeof v === 'string') Play.keys[v] = false;
    }
    for (const k in MU._tapT) { clearTimeout(MU._tapT[k]); delete MU._tapT[k]; }
    for (const k in MU.held) delete MU.held[k];
  }
  window.addEventListener('pointerup', globalRelease);
  window.addEventListener('pointercancel', globalRelease);
  window.addEventListener('blur', globalRelease);

  /* ------------------------------------------------------- 渲染总入口接管 */
  renderUI = function () {
    g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    g.clearRect(0, 0, W, H);
    buttons = [];

    if (MU.landscape) { MU.landscapeOverlay(); syncAccess(); return; }

    if (Game.state !== 'playing') sky();
    if (['pause', 'win', 'fail'].includes(Game.state)) rect(0, 0, W, H, 'rgba(24,40,58,0.46)');
    switch (Game.state) {
      case 'boot': boot(); break;
      case 'menu': menu(); break;
      case 'levels': levels(); break;
      case 'settings': settings(); break;
      case 'help': help(); break;
      case 'playing': hud(); break;
      case 'pause': settings(true); break;
      case 'win': result(true); break;
      case 'fail': result(false); break;
      case 'resetConfirm': confirmScreen('resetConfirm'); break;
      case 'exitConfirm': confirmScreen('exitConfirm'); break;
      case 'quit':
        titleBlock(W / 2, H * 0.36, 1.2);
        text('冒险已结束 · 进度已保存', W / 2, H * 0.58, C.skyInk, 1.55);
        text('可以安全关闭此窗口', W / 2, H * 0.66, C.skyInkDim, 1.3);
        button('backToMenu', '返回主菜单', W / 2 - 190, H * 0.76, 380, 64, function () { change('menu'); });
        break;
    }
    /* 提示条上移，避免压住掌机按键簇 */
    if (Game.toast && Game.toast.until > clock) {
      const s = Game.toast.text;
      const tw = Math.min(W - 40, Math.max(300, MU.txtW(s, 1.0) + 60));
      const tx = (W - tw) / 2, ty = MU.GEO ? (MU.GEO.screenY - 58) : (H * 0.30);
      panel(tx, ty, tw, 46, { tone: 'gold' });
      text(s, W / 2, ty + 23, C.ink, 1.35);
    }
    if (Game.transition > 0) {
      g.save(); g.globalAlpha = Game.transition * 0.22; rect(0, 0, W, H, '#ffffff'); g.restore();
    }
    syncAccess();
  };

  /* 横屏提示：本作按竖屏操作设计 */
  MU.landscapeOverlay = function () {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#232b32'); gr.addColorStop(1, '#10151a');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.32;
    g.save(); g.translate(cx, cy); g.rotate(-Math.PI / 2);
    rect(-30, -52, 60, 104, '#4c565f');
    rect(-24, -45, 48, 90, '#161d23');
    rect(-17, -38, 34, 76, '#1e2a33');
    rect(-10, -30, 20, 60, '#2b3b47');
    g.restore();
    text('请将手机竖屏使用', W / 2, H * 0.60, '#f6dd86', MU.T(19));
    text('本作为竖屏双手拇指操作设计', W / 2, H * 0.74, '#8ea1ad', MU.T(12));
  };

  /* ---------------------------------------------------------------- 天空背景 */
  /* 原版把 480×300 天空插画直接拉伸到全屏，竖屏会被压扁。
     改为“等比放大 + 水平偏右裁切”，既能填满又保留太阳与光束构图。 */
  sky = function () {
    if (!_skyBaked) _bakeSky();
    const t = clock;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, 480, 300);
    sg.drawImage(_skyBG, 0, 0);
    for (let i = 0; i < 9; i++) {
      const x = ((i * 97 + t * (1.1 + (i % 4) * 0.75)) % 640) - 140;
      const y = 20 + (i % 4) * 32, w = 92 + (i % 3) * 48, h = 36 + (i % 2) * 14;
      const sp = _cloudSprite(w, h);
      sg.drawImage(sp, Math.round(x - sp._ox), Math.round(y - sp._oy));
    }
    sg.drawImage(_skyTerrain, 0, 0);
    const center = (Math.sin(t * 0.055) * 0.5 + 0.5) * 700 - 110;
    for (let x = 0; x < 480; x += 3) {
      const d = (x - center) / 115, beam = Math.exp(-(d * d));
      if (beam < 0.004) continue;
      sg.fillStyle = 'rgba(255,250,214,' + (beam * 0.30).toFixed(3) + ')';
      sg.fillRect(x, 0, 3, 300);
    }
    sg.save(); sg.globalCompositeOperation = 'screen';
    sg.beginPath(); sg.moveTo(384, 0); sg.lineTo(424, 0);
    sg.lineTo(206 + Math.sin(t * 0.07) * 36, 300); sg.lineTo(60 + Math.sin(t * 0.07) * 36, 300);
    sg.fillStyle = 'rgba(255,244,196,0.15)'; sg.fill();
    sg.beginPath(); sg.moveTo(292, 0); sg.lineTo(318, 0);
    sg.lineTo(116 + Math.sin(t * 0.05) * 26, 300); sg.lineTo(14 + Math.sin(t * 0.05) * 26, 300);
    sg.fillStyle = 'rgba(255,232,168,0.10)'; sg.fill();
    sg.restore();
    sg.drawImage(_skyVig, 0, 0);

    const sc = Math.max(W / 480, H / 300);
    const dw = 480 * sc, dh = 300 * sc;
    g.imageSmoothingEnabled = false;
    g.drawImage(sceneCanvas, (W - dw) * 0.72, (H - dh) / 2, dw, dh);
  };

  /* ------------------------------------------------------------ 起始 / 菜单 */
  boot = function () {
    titleBlock(W / 2, H * 0.24, 1.32);
    styledText('每一次陨落，都是下一次起跳的回响', W / 2, H * 0.40, 1.06,
      ['#ffffff', '#fff3cf', '#f4c96a', '#b8811c'], 1.6, 0.25);
    const bob = Math.sin(clock * 2.8) * 7, pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 3.2));
    g.save(); g.globalAlpha = pulse;
    styledText('轻触屏幕开始', W / 2, H * 0.54 + bob, 1.62,
      ['#ffffff', '#fff2b0', '#f0b73e', '#a9770f'], 2.4, 0.25);
    g.restore();
    text('手机版 · 竖屏 · 触屏操作', W / 2, H * 0.66, C.skyInkDim, 1.15);
    text('游戏时请竖持手机，双拇指操作', W / 2, H * 0.73, C.skyInkDim, 1.05);
  };

  menu = function () {
    titleBlock(W / 2, H * 0.15, 1.26);
    const items = [
      ['chooseLevels', '选择关卡', 'flag', function () { change('levels'); }, true],
      ['settings', '设置', 'gear', function () { change('settings'); }, false],
      ['help', '游戏说明', 'book', function () { change('help'); }, false],
      ['exit', '退出游戏', 'exit', function () { change('exitConfirm'); }, false]];
    const bw = Math.min(430, W - 56), bh = 68, step = bh + 18;
    const y0 = Math.round(H * 0.30);
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      button(it[0], it[1], (W - bw) / 2, y0 + j * step, bw, bh, it[3], { primary: it[4], icon: it[2] });
    }
    text('手机版 · 双拇指操作', W / 2, H * 0.93, C.skyInkDim, 1.05);
  };

  header = function (title, sub) {
    button('back', '返回', 24, 26, 118, 46, function () { change('menu'); }, { icon: 'back' });
    styledText(title, W / 2, 50, 1.42, ['#ffffff', '#ffe98a', '#e8a92c', '#96630e'], 3.0, 0.25);
    if (sub) text(sub, W / 2, 78, C.skyInkDim, 1.05);
  };

  /* ------------------------------------------------------------ 选关（竖排） */
  levels = function () {
    const all = Game.levels.flatMap(r => r.lv.elements.filter(e => e.type === 'trophy').map(e => r.key + '::' + e.id));
    const taken = all.filter(k => Game.save.trophies[k]).length;
    header('选择关卡', '');
    trophyPlate(W - 24, 88, taken, all.length);

    const listTop = 158, rowH = 122, gapR = 16, stepR = rowH + gapR;
    const footH = 96;
    let per = Math.floor((H - listTop - footH) / stepR);
    per = Math.max(2, Math.min(6, per));
    const pages = Math.max(1, Math.ceil(Game.levels.length / per));
    Game.page = Math.max(0, Math.min(Game.page, pages - 1));
    const start = Game.page * per;

    if (!Game.levels.length) {
      panel(W / 2 - 210, listTop + 40, 420, 130);
      text('尚无可用关卡', W / 2, listTop + 105, C.ink, 1.5);
    }
    const rx = 24, rw = W - 48;
    for (let j = 0; j < per; j++) {
      const i = start + j, r = Game.levels[i];
      if (!r) break;
      const ry = listTop + j * stepR, on = unlocked(i);
      /* 整行即一个巨大的点击区，避免小按钮点不准 */
      button('level-' + i, '', rx, ry, rw, rowH, function () { begin(i); }, { disabled: !on });

      const tx = rx + 16, ty = ry + 17, tw = Math.round(rw * 0.34), th = rowH - 34;
      rect(tx, ty, tw, th, '#ffffff');
      if (r.preview) {
        g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
        g.imageSmoothingEnabled = false;
        g.drawImage(r.preview, tx, ty, tw, th); g.restore();
      }
      if (!on) { rect(tx, ty, tw, th, 'rgba(247,239,215,0.74)'); icon('lock', tx + tw / 2, ty + th / 2, 2.6); }
      rect(tx, ty, tw, 1, '#ffffffcc'); rect(tx, ty + th - 1, tw, 1, '#00000033');

      const cx = tx + tw + 22;
      textLeft(String(i + 1).padStart(2, '0'), cx, ry + 42, on ? C.ink : C.inkFaint, 1.6);
      textLeft(r.lv.name, cx + 32, ry + 42, on ? C.ink : C.inkFaint, 1.5);
      textLeft('最快时间', cx, ry + 80, C.inkSoft, 1.15);
      textLeft(formatTime(Game.save.best[r.key]), cx + 74, ry + 80,
        Number.isFinite(Game.save.best[r.key]) ? C.ink : C.inkFaint, 1.25);

      const chipW = 116, chipX = rx + rw - chipW - 16, chipY = ry + rowH / 2 - 24;
      if (on) {
        panel(chipX, chipY, chipW, 48, { tone: 'gold' });
        text('进入', chipX + chipW / 2, chipY + 24, C.ink, 1.4);
      } else {
        panel(chipX, chipY, chipW, 48);
        text('未解锁', chipX + chipW / 2, chipY + 24, C.inkFaint, 1.2);
      }
    }
    if (pages > 1) {
      const by = H - 74;
      button('pagePrev', '◀', W / 2 - 200, by, 76, 52, function () { Game.page--; }, { disabled: Game.page === 0 });
      panel(W / 2 - 110, by, 220, 52);
      text('第 ' + (Game.page + 1) + ' / ' + pages + ' 页', W / 2, by + 26, C.ink, 1.3);
      button('pageNext', '▶', W / 2 + 124, by, 76, 52, function () { Game.page++; }, { disabled: Game.page >= pages - 1 });
    }
  };

  /* ---------------------------------------------------------- 设置 / 暂停 */
  settings = function (paused) {
    if (paused === undefined) paused = false;
    if (!paused) header('设置', '');
    const pw = Math.min(486, W - 40);
    const ph = paused ? 388 : 348;
    const x = (W - pw) / 2;
    const y = paused ? Math.max(120, (H - ph) / 2) : Math.round(H * 0.20);
    panel(x, y, pw, ph);
    text(paused ? '已暂停' : '声音与存档', W / 2, y + 42, C.ink, 1.85);
    rect(x + 28, y + 68, pw - 56, 2, '#cbbf9e');

    const sx = x + 104, sw = Math.max(130, pw - 322);
    icon('sound', x + 42, y + 130, 1.35);
    slider('musicSlider', '音乐音量', sx, y + 124, sw, Game.save.music, function (v) { setVol('music', v); });
    icon('sound', x + 42, y + 194, 1.35);
    slider('sfxSlider', '音效音量', sx, y + 188, sw, Game.save.sfx, function (v) { setVol('sfx', v); });

    const bw = pw - 80;
    if (paused) {
      button('resume', '继续游戏', x + 40, y + 238, bw, 58, function () { pause(); }, { primary: true, icon: 'play' });
      button('returnLevels', '返回选关', x + 40, y + 306, bw, 58, function () { change('levels'); }, { icon: 'flag' });
    } else {
      button('resetSave', '清除存档', x + 40, y + 244, bw, 58, function () { change('resetConfirm'); }, { icon: 'exit' });
      text('清空进度、奖杯、纪录与声音设置', W / 2, y + 322, C.inkSoft, 1.05);
    }
  };

  /* ----------------------------------------------------------------- 说明 */
  help = function () {
    header('游戏说明', '');
    const pw = Math.min(506, W - 32), x = (W - pw) / 2;
    /* 面板高度按内容量算，不留大片空底（触屏键 7 行 / 玩法 10 行） */
    const rowStep = 62, headH = 112, padB = 30;
    const n = Game.tab ? 11 : 7;
    const ph = Math.min(H - 186, headH + n * rowStep + padB);
    const y = Math.max(120, Math.min(126, (H - ph) / 2));
    panel(x, y, pw, ph);
    const bw = (pw - 56) / 2;
    button('helpKeys', '触屏按键', x + 20, y + 20, bw, 50, function () { Game.tab = 0; }, { primary: Game.tab === 0 });
    button('helpRules', '玩法说明', x + 36 + bw, y + 20, bw, 50, function () { Game.tab = 1; }, { primary: Game.tab === 1 });
    rect(x + 20, y + 84, pw - 40, 2, '#cbbf9e');

    if (!Game.tab) {
      /* 触屏键位：用与掌机同源的圆形键示意 + 说明，替代电脑版键盘键帽 */
      const rows = [
        ['left', '左右移动'],
        ['up', '跳跃 · 长按更高 · 二段跳 / 蹬墙跳'],
        ['flag', '插旗 / 拔旗 · 设置重生点'],
        ['slow', '按住减缓幽灵回放 · 消耗慢放能量'],
        ['skull', '主动爆炸 · 推箱 / 碎块 / 引燃'],
        ['restart', '回到当前重生点（旗子或起点）'],
        ['pause', '暂停 / 继续']];
      const fams = { left: 'neutral', up: 'gold', flag: 'green', slow: 'teal', skull: 'red', restart: 'violet', pause: 'neutral' };
      const avail = ph - headH - 10;
      const step = Math.min(rowStep, avail / rows.length);
      for (let i = 0; i < rows.length; i++) {
        const ry = y + headH + 6 + i * step;
        MU.miniKey(g, x + 58, ry + 12, 21, rows[i][0], fams[rows[i][0]]);
        textLeft(rows[i][1], x + 104, ry + 12, C.ink, 1.3);
      }
    } else {
      const lines = [
        '抵达终末之门即可通关，通关解锁下一关。',
        '阵亡会留下回放幽灵，可无限次重现。',
        '幽灵能承载你、压住机关、阻隔激光。',
        '爆炸可推箱、碎块、引燃与融冰。',
        '旗子设置新重生点；拔旗清除全部幽灵。',
        '生命耗尽本关失败，可随时即时重试。',
        '冰面打滑、重力倒转、消失台周期隐现。',
        '水下移动迟滞，连续浸水十秒会窒息。',
        '烟雾遮蔽视野，幽灵周围会开辟可视范围。',
        '用时包含阵亡过程，不含暂停。',
        '奖杯一经拾取即永久保留。'];
      const step = Math.min(38, (ph - headH - 8) / lines.length);
      for (let i = 0; i < lines.length; i++) {
        const ly = y + headH + 4 + i * step;
        rect(x + 34, ly - 6, 7, 7, C.gold); rect(x + 36, ly - 4, 3, 3, '#fff4c4');
        textLeft(lines[i], x + 54, ly, C.ink, 1.26);
      }
    }
  };

  /* 说明页里的小圆键示意（材质与掌机按键一致） */
  MU.miniKey = function (ctx, cx, cy, r, glyphName, fam) {
    const P = MU.PAL[fam] || MU.PAL.neutral;
    ctx.beginPath(); ctx.arc(cx, cy + 2, r, 0, 6.2832); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fillStyle = P.rim; ctx.fill();
    const gr = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    gr.addColorStop(0, P.a); gr.addColorStop(0.5, P.b); gr.addColorStop(1, P.c);
    ctx.beginPath(); ctx.arc(cx, cy, r - 1.6, 0, 6.2832); ctx.fillStyle = gr; ctx.fill();
    MU.glyph(ctx, glyphName, cx, cy, r * 0.135, P.glyph);
  };

  /* ----------------------------------------------------------------- 确认 */
  confirmScreen = function (kind) {
    const reset = kind === 'resetConfirm';
    const pw = Math.min(452, W - 40), ph = 292;
    const x = (W - pw) / 2, y = (H - ph) / 2;
    panel(x, y, pw, ph);
    text(reset ? '确认清除存档？' : '结束这次冒险？', W / 2, y + 54, reset ? '#8e1d28' : C.ink, 1.8);
    text(reset ? '进度、奖杯、纪录与设置都会重置' : '进度已自动保存，下次仍可继续', W / 2, y + 106, C.inkSoft, 1.16);
    if (reset) text('且无法恢复', W / 2, y + 136, C.inkSoft, 1.1);
    const bw = pw - 80;
    button('confirmNo', '取消', x + 40, y + 176, bw, 54, function () { change(reset ? 'settings' : 'menu'); });
    button('confirmYes', reset ? '确认清空' : '退出', x + 40, y + 238, bw, 54,
      function () { if (reset) resetProgress(); else { change('quit'); window.close(); } }, { primary: true });
  };

  /* --------------------------------------------------------------- 结算页 */
  result = function (win) {
    const pw = Math.min(462, W - 40), ph = 476;
    const x = (W - pw) / 2, y = Math.max(96, (H - ph) / 2);
    panel(x, y, pw, ph);
    if (win) icon('trophy', W / 2, y + 62, 2.6);
    else heart(W / 2 - 14, y + 50, 2.4, C.red, 4);
    styledText(win ? '关 卡 完 成' : '生 命 耗 尽', W / 2, y + 138, 1.66,
      win ? ['#ffffff', '#ffe98a', '#e8a92c', '#96630e'] : ['#fff0f0', '#ff8f96', '#d4384a', '#8e1d28'], 3.0, 0.25);
    if (win) {
      text(formatTime(Game.elapsed), W / 2, y + 198, C.ink, 1.9);
      panel(W / 2 - 160, y + 232, 320, 48, { tone: Game.newBest ? 'gold' : 'paper' });
      text(Game.newBest ? '新的最快纪录' : '已记录通过时间', W / 2, y + 256, C.ink, 1.32);
    } else {
      text('本次用时 ' + formatTime(Game.elapsed), W / 2, y + 198, C.ink, 1.3);
      text('阵亡 ' + Play.deathCount + ' 次', W / 2, y + 238, C.inkSoft, 1.25);
    }
    const bw = pw - 80, next = Game.selected < Game.levels.length - 1;
    button('retry', '再次挑战', x + 40, y + 308, bw, 58, function () { begin(Game.selected); }, { primary: true });
    button('resultLevels', win && next ? '下一关' : '返回选关', x + 40, y + 376, bw, 58,
      function () { if (win && next) begin(Game.selected + 1); else change('levels'); },
      { icon: win && next ? 'play' : 'flag' });
  };

  /* -------------------------------------------------- 结算页与暂停页的转场 */
  /* 电脑版在这两个状态会把天空整体压暗；手机版同样处理，保持观感一致。 */

  /* ----------------------------------------------------------------- 初始化 */
  MU_resize();
  MU.ensureGeo();

  /* 先裁掉旧的关卡分页残留，避免竖屏页数变少时越界 */
  if (typeof Game !== 'undefined') Game.page = 0;

  /* 让无障碍 DOM 层在竖屏下与设计坐标同步（syncAccess 已按 scale 换算） */
  screenKey = '';
})();
