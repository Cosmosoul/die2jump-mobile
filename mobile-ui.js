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
  /* 期望“屏幕上”的 CSS 像素高 → 设计单位（用于非像素字 / 图元以外的手绘） */
  MU.CSS = function (cssPx) { return cssPx / scale; };

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

  /* ---------------------------------------- 清晰的非像素字体 + 老式 LCD 质感 */
  /* 需求：**局内拟物掌机的文字以“看清”为第一目的**，不再使用像素字。
     这里统一采用各平台自带的清晰中文字体（iOS=PingFang、Android=Noto/思源、
     Windows=雅黑），再叠加老式 LCD 的“发光刻印 + 轻微凹陷 + 玻璃高光”做出拟物屏幕感。 */
  MU.FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Heiti SC","Source Han Sans SC",system-ui,sans-serif';
  MU.lcd = { glow: 1.1, bl: 0.5, hi: 0.42 };   /* glow=发光半径系数 bl=凹刻暗影 hi=顶缘高光 */
  MU._mcv = null; MU._mctx = null;
  /* 用非像素字体量宽（用于布局避让，保证不重叠） */
  MU.insetW = function (s, size, weight) {
    if (!MU._mcv) { MU._mcv = document.createElement('canvas'); MU._mctx = MU._mcv.getContext('2d'); }
    MU._mctx.font = (weight || 600) + ' ' + size + 'px ' + MU.FONT;
    return MU._mctx.measureText(String(s)).width;
  };
  /* 设计单位下的清晰字字号：opt.px=true 时按“屏幕 CSS 像素”给定，跨机型一致 */
  function labFont(size, px) { return px ? MU.CSS(size) : size; }
  /* 判断颜色明暗（0=黑,1=白）：用来决定描边该用亮还是暗，保证任何底色上都能分开。 */
  MU.lum = function (hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
    if (!m) return 0.5;
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
  };

  /* 老式 LCD 上的「发光刻印」文字：①凹刻暗影 → ②（可选描边）→ ③发光填充 → ④顶缘高光。
     塑料键面上的丝印用 opt.crisp=true 关闭发光/高光，保证笔画清晰不糊。
     opt: {align, weight, glow, shadow, alpha, hi, crisp, outline} */
  MU.inset = function (ctx, s, x, y, size, color, opt) {
    opt = opt || {};
    const crisp = !!opt.crisp;
    const glow = opt.glow === undefined ? (crisp ? 0 : MU.lcd.glow) : opt.glow;
    ctx.save();
    if (opt.alpha !== undefined) ctx.globalAlpha = opt.alpha;
    ctx.font = (opt.weight || 600) + ' ' + size + 'px ' + MU.FONT;
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = 'middle';
    /* 描边通道：在字形外扩一圈**对比色**细边，让字从同色系底面上"立"起来。
       这是提升可读性而不改主色的关键——字的填充色仍是原键面配色（不违和），
       只增加一圈极细的分离边。明暗自动取反：深字配亮边、亮字配暗边。 */
    if (opt.outline) {
      const l = MU.lum(color);
      const oc = opt.outline === true
        ? (l < 0.5 ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.62)')
        : opt.outline;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.6, size * 0.17);
      ctx.strokeStyle = oc;
      ctx.strokeText(String(s), x, y);
    }
    if (opt.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,' + (crisp ? 0.62 : MU.lcd.bl) + ')';
      ctx.fillText(String(s), x, y + Math.max(1, size * 0.075));
    }
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = size * glow; }
    ctx.fillStyle = color;
    ctx.fillText(String(s), x, y);
    if (glow > 0) ctx.fillText(String(s), x, y);
    ctx.shadowBlur = 0;
    const hiAmt = opt.hi === undefined ? MU.lcd.hi : opt.hi;
    if (hiAmt > 0 && glow > 0) {
      ctx.globalAlpha = (opt.alpha === undefined ? 1 : opt.alpha) * hiAmt * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(String(s), x, y - Math.max(0.6, size * 0.05));
    }
    ctx.restore();
  };
  /* 老式 LCD 显示槽：深色玻璃 + 内凹倒角 + 玻璃高光，做出“嵌进机身”的屏幕感 */
  MU.lcdWell = function (ctx, x, y, w, h, r, tone) {
    r = r === undefined ? 9 : r;
    const green = tone !== 'amber';
    const b0 = green ? 'rgb(9,23,17)' : 'rgb(30,25,8)';
    const b1 = green ? 'rgb(4,12,9)' : 'rgb(18,14,4)';
    ctx.save();
    /* 外缘：深色倒角环（凹陷的边） */
    ctx.beginPath(); MU.rrPath(ctx, x - 2, y - 2, w + 4, h + 4, r + 2);
    ctx.fillStyle = 'rgba(26,14,48,.92)'; ctx.fill();
    ctx.beginPath(); MU.rrPath(ctx, x - 1, y - 1, w + 2, h + 2, r + 1);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    /* 玻璃液体 */
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, b0); gr.addColorStop(1, b1);
    ctx.beginPath(); MU.rrPath(ctx, x, y, w, h, r); ctx.fillStyle = gr; ctx.fill();
    /* 上缘内影（凹陷感） */
    const sh = ctx.createLinearGradient(0, y, 0, y + Math.max(5, h * 0.55));
    sh.addColorStop(0, 'rgba(0,0,0,.66)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); MU.rrPath(ctx, x, y, w, h, r); ctx.fillStyle = sh; ctx.fill();
    /* 玻璃斜高光（很淡） */
    const gl = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    gl.addColorStop(0, 'rgba(255,255,255,.10)');
    gl.addColorStop(0.4, 'rgba(255,255,255,.02)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); MU.rrPath(ctx, x, y, w, h, r); ctx.fillStyle = gl; ctx.fill();
    /* 内缘高光（玻璃边） */
    ctx.beginPath(); MU.rrPath(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(2, r - 1));
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
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
  /* 参考真实 Game Boy Color（Atomic Purple 等）：D-Pad / A / B 为**哑光深灰塑料**
     （并非全黑，带一点冷灰蓝），字符为浅灰白；彩色键为透明塑料染色的实色版本。
     键面高光→本色→暗面 a/b/c；rim：座圈；gate：按下时的凹井暗影；glyph：符号/标签色。 */
  /* 键面字色统一为白色（用户明确要求"都改成白色字"）。
     白色在亮键面（金/薄荷绿）上容易被"吃掉"，因此 keyInk 会给白色字
     描一圈**深色**分离边（见 MU.keyInk / MU.inset 的 outline 通道），
     既满足"白字"又保证任何键面上都看得清。 */
  MU.PAL = {
    neutral: { a: '#5c6570', b: '#3c434c', c: '#262c34', rim: '#141a20', gate: 'rgba(0,0,0,.46)', glyph: '#ffffff' },
    gold: { a: '#ffdf8e', b: '#dfa52c', c: '#9c6a12', rim: '#5d3d06', gate: 'rgba(40,22,0,.42)', glyph: '#ffffff' },
    teal: { a: '#96e3d2', b: '#2b9c88', c: '#10614f', rim: '#0a362d', gate: 'rgba(0,28,22,.42)', glyph: '#ffffff' },
    green: { a: '#a8d98a', b: '#589b46', c: '#2f6428', rim: '#1a3d16', gate: 'rgba(8,32,4,.42)', glyph: '#ffffff' },
    red: { a: '#f2959e', b: '#c53f52', c: '#841a2b', rim: '#4e0f1a', gate: 'rgba(48,4,12,.42)', glyph: '#ffffff' },
    violet: { a: '#c3b3ef', b: '#8f72da', c: '#5c42b6', rim: '#2f2166', gate: 'rgba(22,8,48,.46)', glyph: '#ffffff' },
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
    MU.bakeBoardKey = '';
    if (MU.setHLFrame) MU.setHLFrame(W);
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

  /* ------------------------------------------------- 立体视差（陀螺仪 / 倾斜） */
  /* 需求：不改动游戏画面与外壳本身，**只让壳内的电路板层略微移动**，
     使「外壳 = 前层平面、电路板 = 后层立体」的关系被感知到，产生真实立体结构的错觉。
     做法：电路板（以及壳内的厚度暗角）画在一个独立的、会随倾斜位移的平面上；
     外壳（屏幕包边 / LCD / 按键 / 螺钉 / 玻璃高光）全部固定不动。
     数据源优先级：设备方向传感器（陀螺仪/加速度计）→ 手动 setTilt()（测试/兜底）。 */
  /* 幅度：设计宽度为 540 单位，PARALLAX 即"倾斜到位"时电路板的最大位移。
     旧值 9 只占画幅 1.7%（真机约 6 CSS px），几乎看不出层次，廉价感明显；
     调到 18（≈画幅 3.3%，真机约 13 CSS px）后，隔着屏幕能清楚感到板子在壳内
     滑动 —— 与真实掌机"玻璃在前、PCB 在后"的纵深关系一致。
     硬约束：PARALLAX 必须 ≤ PAD（此处留 12 单位余量），否则位移到极限时
     电路板会从机身边缘露出、露出底色。 */
  MU.PARALLAX = 18;             /* 电路板最大位移（设计单位） */
  MU.PAD = 30;                  /* 电路板四周预留余量，保证位移后仍铺满、不露边 */
  MU.parallaxOn = true;
  MU.tilt = { x: 0, y: 0 };     /* 平滑后的位移（设计单位） */
  MU.gyro = { available: false, enabled: false, denied: false, source: 'none', deg: { b: 0, g: 0 } };
  const TILT_RANGE = 20;        /* 认为“倾斜到位”的角度（度）：达到即位移到最大 */
  let _rawTilt = { x: 0, y: 0 }, _neutral = null, _lastOrient = 0;
  MU._manualTilt = null;        /* {x,y} ∈ [-1,1]：测试或外部直接给值 */

  /* 直接设定归一化倾斜（-1..1）。测试与无传感器兜底都用它。
     传 null/undefined 表示“交还给传感器”，此时把 source 一并复位，
     避免 instrumentation 残留把状态标记成 'manual'。 */
  MU.setTilt = function (vx, vy) {
    if (vx === null || vx === undefined) {
      MU._manualTilt = null;
      MU.gyro.source = MU.gyro.enabled ? 'sensor' : (MU.gyro.denied ? 'denied' : 'none');
      return;
    }
    MU._manualTilt = { x: Math.max(-1, Math.min(1, vx)), y: Math.max(-1, Math.min(1, vy || 0)) };
    MU.gyro.source = 'manual';
  };

  function _clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

  /* 传感器回调：以“启用时那一刻的姿态”为中性点，之后按角度差给位移。
     角度会缓慢自适应回中（时间常数很长，玩的时候察觉不到），避免手臂漂移后跑偏。 */
  function onOrient(e) {
    if (e.beta === null && e.gamma === null) return;
    const b = e.beta || 0, g = e.gamma || 0;
    MU.gyro.available = true;
    MU.gyro.deg.b = b; MU.gyro.deg.g = g;
    if (!_neutral) _neutral = { b: b, g: g };
    /* 缓慢自适应：把中性点往当前姿态蹭一点点（约 25s 时间常数） */
    const now = performance.now();
    const dtS = _lastOrient ? Math.min(0.25, (now - _lastOrient) / 1000) : 0;
    _lastOrient = now;
    const k = Math.min(1, dtS * 0.04);
    _neutral.b += (b - _neutral.b) * k;
    _neutral.g += (g - _neutral.g) * k;
    /* 竖持时 beta≈90、gamma≈0；取差值后 gamma 变化 → 左右平移，beta 变化 → 上下平移。
       向右倾斜 gamma 增大 → 板子往左移（视差：近处玻璃右移、远处板子左移）。 */
    _rawTilt.x = _clamp1(-(g - _neutral.g) / TILT_RANGE);
    _rawTilt.y = _clamp1((b - _neutral.b) / TILT_RANGE);
    MU.gyro.source = 'sensor';
  }

  /* 启用设备方向传感器。iOS 13+ 需在**用户手势**里调用 requestPermission，
     因此本函数应在点击/触摸处理中直接调用（不要在 await 之后才调）。 */
  MU.enableGyro = function () {
    if (MU.gyro.enabled || MU.gyro.denied) return Promise.resolve(MU.gyro.enabled);
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) { MU.gyro.source = 'unsupported'; return Promise.resolve(false); }
    const bind = function () {
      window.addEventListener('deviceorientation', onOrient, true);
      MU.gyro.enabled = true; MU.gyro.available = true;
      if (MU.gyro.source === 'none') MU.gyro.source = 'sensor';
      return true;
    };
    if (typeof DOE.requestPermission === 'function') {
      let p;
      try { p = DOE.requestPermission(); } catch (e) { MU.gyro.denied = true; MU.gyro.source = 'denied'; return Promise.resolve(false); }
      return Promise.resolve(p).then(function (r) {
        if (r === 'granted') return bind();
        MU.gyro.denied = true; MU.gyro.source = 'denied'; return false;
      }).catch(function () { MU.gyro.denied = true; MU.gyro.source = 'denied'; return false; });
    }
    return Promise.resolve(bind());
  };

  /* 每帧推进平滑（临界阻尼式趋近，手感不飘）。
     若倾角变化超过阈值，则让**键面高光随光向微调**——重新烘焙一次前层。
     烘焙本身不快，因此只有“明显变化”才触发（静止时零开销）；
     单次偏移量的门槛设为 1.1 设计单位，正常手指呼吸级别的抖动不会触发。 */
  MU._tiltHL = true;            /* 键面高光是否随倾角变化（可由设置关闭） */
  MU._rebakes = 0;              /* 重烘焙次数（供性能观察 / 测试） */
  let _hlBakedX = 0, _hlBakedY = 0, _hlNextBake = 0;
  MU.updateTilt = function (dt) {
    if (!MU.parallaxOn) {
      if (MU.tilt.x !== 0 || MU.tilt.y !== 0) MU.tilt.x = MU.tilt.y = 0;
    } else {
      let tx = 0, ty = 0;
      if (MU._manualTilt) { tx = MU._manualTilt.x; ty = MU._manualTilt.y; }
      else if (MU.gyro.enabled) { tx = _rawTilt.x; ty = _rawTilt.y; }
      const k = Math.min(1, (dt || 0.016) * 7);
      MU.tilt.x += (tx * MU.PARALLAX - MU.tilt.x) * k;
      MU.tilt.y += (ty * MU.PARALLAX - MU.tilt.y) * k;
    }
    /* 键面高光跟随：倾角变化够明显才重烘焙前层，且**限流**（≥110ms 一次）。
       传感器噪声级别的小抖动永远不触发，静止时零开销。 */
    if (MU._tiltHL && MU.parallaxOn && MU._cv && MU.GEO) {
      const d = Math.abs(MU.tilt.x - _hlBakedX) + Math.abs(MU.tilt.y - _hlBakedY);
      if (d > 1.1 && clock >= _hlNextBake) {
        _hlBakedX = MU.tilt.x; _hlBakedY = MU.tilt.y;
        _hlNextBake = clock + 0.11;
        MU.bakeKey = '';            /* 让 drawChrome 重烘焙前层 */
        MU._rebakes++;
      } else if (d < 0.25 && (_hlBakedX || _hlBakedY) && clock >= _hlNextBake) {
        _hlBakedX = _hlBakedY = 0;  /* 已回到中位，收回参考点，避免反复触发 */
      }
    }
  };

  /* --------------------------------------------------------------- 机身烘焙 */
  /* 静态部分（外壳 / 包边 / 盘面 / 键面 / 符号 / 标签）只画一次，之后每帧一次
     drawImage，避免 60fps 反复创建渐变造成的开销。
     分两层烘焙，以支持立体视差：
       · _bp（后层）＝ 电路板 + 壳内厚度暗角 —— 唯一会随倾斜位移的层；
       · _cv（前层）＝ 染色玻璃 / 镜面高光 / 描边 / 屏幕包边 / LCD / 按键 —— 全部固定。
     两层的静态内容不变，只是拆开绘制，观感与旧版一致。 */
  function _mkLayer(cvKey, ctxKey) {
    if (!MU[cvKey]) { MU[cvKey] = document.createElement('canvas'); MU[ctxKey] = MU[cvKey].getContext('2d'); }
    return MU[cvKey];
  }
  /* 后层：电路板。整层比机身**四周各大出 MU.PAD**，于是位移后仍铺满、绝不露边。
     注意：这一层**不做屏幕窗口挖空**——挖空会随图层一起跑偏；屏幕窗口改由
     MU.drawBoard() 在**固定的外壳坐标系**里实时裁剪，板子滑动时绝不会爬进画面。 */
  MU.bakeBoard = function () {
    const Pd = MU.PAD;
    const bw = Math.max(1, Math.round((W + Pd * 2) * dpr * scale));
    const bh = Math.max(1, Math.round((H + Pd * 2) * dpr * scale));
    const cv = _mkLayer('_bp', '_bpg');
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const cg = MU._bpg;
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, bw, bh);
    /* 平移 (Pd,Pd) 后即为「机身坐标系」，后续坐标无需再换算 */
    cg.setTransform(dpr * scale, 0, 0, dpr * scale, Pd * dpr * scale, Pd * dpr * scale);

    /* —— 内部电路板（低分图放大后作为玻璃后的底，插值天然带来“隔玻璃”的模糊） —— */
    if (!MU._pcb || MU._pcbW !== W || MU._pcbH !== H) {
      MU._pcb = MU._buildPCB(W, H); MU._pcbW = W; MU._pcbH = H;
    }
    cg.imageSmoothingEnabled = true;
    cg.drawImage(MU._pcb, -Pd, -Pd, W + Pd * 2, H + Pd * 2);

    const geo = MU.GEO, Wd = geo.W, Hd = geo.H;
    const sx = geo.screenX, sy = geo.screenY, sw = geo.screenW, sh = geo.screenH;

    /* —— 壳内厚度暗角：属于「内部」，随板子一起位移，强化纵深 —— */
    const edge = cg.createRadialGradient(Wd / 2, Hd * 0.42, Math.min(Wd, Hd) * 0.34,
      Wd / 2, Hd * 0.5, Math.max(Wd, Hd) * 0.62);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(0.72, 'rgba(52,26,102,0.18)');
    edge.addColorStop(1, 'rgba(40,16,84,0.50)');
    cg.fillStyle = edge; cg.fillRect(0, 0, Wd, Hd);

    /* —— 屏幕开孔在**壳内侧**投下的软阴影：也在内部平面上，随板子微微位移。
         强度刻意压低，且大部分会被固定的屏幕包边盖住，只在外沿留一圈很淡的接触影。
         露出的部分由 MU.drawBoard() 按固定坐标裁掉孔内区域，所以绝不会挡画面。 —— */
    const hs = 14;
    cg.beginPath();
    MU.rrPath(cg, sx - hs, sy - hs, sw + hs * 2, sh + hs * 2, 14 + hs);
    MU.rrPath(cg, sx, sy, sw, sh, 14);
    const hsh = cg.createLinearGradient(0, sy - hs, 0, sy + sh + hs);
    hsh.addColorStop(0, 'rgba(6,2,18,.55)');
    hsh.addColorStop(0.55, 'rgba(6,2,18,.18)');
    hsh.addColorStop(1, 'rgba(6,2,18,.55)');
    cg.fillStyle = hsh; cg.fill('evenodd');

    cg.setTransform(1, 0, 0, 1, 0, 0);
    MU.bakeBoardKey = MU.key();
  };

  MU.bake = function () {
    const bw = Math.max(1, Math.round(W * dpr * scale));
    const bh = Math.max(1, Math.round(H * dpr * scale));
    const cv = _mkLayer('_cv', '_cg');
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const cg = MU._cg;
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, bw, bh);
    cg.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    const geo = MU.GEO, Wd = geo.W, Hd = geo.H;
    const sx = geo.screenX, sy = geo.screenY, sw = geo.screenW, sh = geo.screenH;

    /* 1) 机身外壳（前层固定）：原子紫彩透塑料——
          高透、干净、饱和的**紫罗兰**，塑料表面**光洁**（镜面高光 + 边缘厚壁折射）。
          屏幕窗口用 even-odd 裁掉保持透明；电路板由后层（随倾斜位移）提供。 */
    const boardPath = () => {
      cg.beginPath(); cg.rect(0, 0, Wd, Hd); MU.rrPath(cg, sx, sy, sw, sh, 14);
      cg.clip('evenodd');
    };

    /* —— 原子紫染色层：彩透塑料的“色号”。
         这一层是**固定**的（属于外壳），电路板在它后面滑动。
           alpha 必须足够低，才能让板上的铜色走线透出来——有可见纹理，
           “板子在动”才被眼睛捕捉得到（否则视差无从体现）；
           同时 alpha 又不能太低，避免机身显得像一块脏玻璃。
           0.58~0.61 是实测的平衡点：绿板隐约可辨、紫色依旧饱满。 —— */
    cg.save(); boardPath();
    const coat = cg.createLinearGradient(0, 0, Wd * 0.35, Hd);
    coat.addColorStop(0, 'rgba(148,108,222,0.58)');
    coat.addColorStop(0.5, 'rgba(122,82,204,0.59)');
    coat.addColorStop(1, 'rgba(100,60,180,0.61)');
    cg.fillStyle = coat; cg.fillRect(0, 0, Wd, Hd);
    cg.restore();

    /* —— 光洁塑料的镜面高光：随倾角移动，见 MU.drawSheen（画在动态层，
          以便真正“跟着倾角走”；此处不再烘焙，避免叠加成双重高光） —— */

    /* 玻璃外缘：亮描边 + 内圈，体现壳的圆角与厚度 */
    cg.beginPath(); MU.rrPath(cg, 0.75, 0.75, Wd - 1.5, Hd - 1.5, 16);
    cg.strokeStyle = 'rgba(236,222,255,0.52)'; cg.lineWidth = 1.6; cg.stroke();
    cg.beginPath(); MU.rrPath(cg, 2.5, 2.5, Wd - 5, Hd - 5, 14);
    cg.strokeStyle = 'rgba(255,255,255,0.12)'; cg.lineWidth = 1; cg.stroke();
    cg.fillStyle = 'rgba(255,255,255,.26)'; cg.fillRect(2, 0, Wd - 4, 1.6);
    cg.fillStyle = 'rgba(0,0,0,.34)'; cg.fillRect(2, Hd - 3, Wd - 4, 3);

    /* 四角螺钉（嵌在紫色壳里，金属感） */
    const studs = [[14, Math.round(MU.safeTop) + 8], [Wd - 14, Math.round(MU.safeTop) + 8],
    [14, Hd - Math.round(MU.safeBottom) - 12], [Wd - 14, Hd - Math.round(MU.safeBottom) - 12]];
    for (let si = 0; si < studs.length; si++) {
      const s = studs[si];
      cg.fillStyle = 'rgba(30,12,58,.60)'; cg.beginPath(); cg.arc(s[0], s[1], 5.2, 0, 6.2832); cg.fill();
      const mg = cg.createRadialGradient(s[0] - 1.3, s[1] - 1.3, 0.4, s[0], s[1], 3.8);
      mg.addColorStop(0, 'rgba(238,226,255,.92)'); mg.addColorStop(1, 'rgba(150,124,196,.55)');
      cg.fillStyle = mg; cg.beginPath(); cg.arc(s[0], s[1], 3.6, 0, 6.2832); cg.fill();
      cg.strokeStyle = 'rgba(24,8,48,.55)'; cg.lineWidth = 1.1;
      cg.beginPath(); cg.moveTo(s[0] - 2.6, s[1] - 0.3); cg.lineTo(s[0] + 2.6, s[1] + 0.3); cg.stroke();
    }

    /* 2) 屏幕包边：GBC 式深色屏幕框（带圆角内凹）——深灰塑料框 + 内圈深影。
          注意：包边的每一层都必须是「外框 − 内窗」的 even-odd 环，
          绝不能整块填充外框——那样会把半透明的高光/阴影**糊在游戏画面上**，
          虽然不致命，但会让画面发灰发暗（这是本次修掉的一个真实缺陷）。 */
    const bezOut = (grow, rad) => {
      cg.beginPath();
      MU.rrPath(cg, sx - grow, sy - grow, sw + grow * 2, sh + grow * 2, rad + grow);
      MU.rrPath(cg, sx, sy, sw, sh, rad);
    };
    /* 框体本身 */
    bezOut(10, 14); cg.fillStyle = '#171c22'; cg.fill('evenodd');
    /* 框面受光（塑料边框的上亮下暗），同样只作用在框上 */
    bezOut(10, 14);
    const bez = cg.createLinearGradient(0, sy - 10, 0, sy + sh + 10);
    bez.addColorStop(0, 'rgba(255,255,255,.10)'); bez.addColorStop(0.5, 'rgba(255,255,255,0)');
    bez.addColorStop(1, 'rgba(0,0,0,.28)');
    cg.fillStyle = bez; cg.fill('evenodd');
    /* 外缘细描（只描框的外边界，不进画面） */
    cg.beginPath(); MU.rrPath(cg, sx - 10, sy - 10, sw + 20, sh + 20, 22);
    cg.strokeStyle = 'rgba(0,0,0,.6)'; cg.lineWidth = 1.6; cg.stroke();
    /* 屏幕内凹：内圈重影（用环状描边，避免压到画面） */
    cg.save();
    cg.beginPath();
    MU.rrPath(cg, sx - 4, sy - 4, sw + 8, sh + 8, 18);
    MU.rrPath(cg, sx + 1.5, sy + 1.5, sw - 3, sh - 3, 12.5);
    cg.clip('evenodd');                                    /* 只在内圈 4px 环内作画 */
    cg.beginPath(); MU.rrPath(cg, sx - 3, sy - 3, sw + 6, sh + 6, 16);
    cg.strokeStyle = 'rgba(0,0,0,.72)'; cg.lineWidth = 4; cg.stroke();
    cg.beginPath(); MU.rrPath(cg, sx - 1, sy - 1, sw + 2, sh + 2, 15);
    cg.strokeStyle = 'rgba(255,255,255,.12)'; cg.lineWidth = 1.6; cg.stroke();
    cg.restore();

    /* 3) 信息盘：老式 LCD 显示槽（生命 / 旗帜 / 用时 / 慢放）
          + 非像素、可读性优先的固定小标题。 */
    MU.lcdWell(cg, geo.livesPlate.x, geo.livesPlate.y, geo.livesPlate.w, geo.livesPlate.h, 10);
    MU.lcdWell(cg, geo.flagsPlate.x, geo.flagsPlate.y, geo.flagsPlate.w, geo.flagsPlate.h, 10);
    MU.lcdWell(cg, geo.timeX, geo.timeY, geo.timeW, geo.timeH, 10, 'amber');
    MU.lcdWell(cg, geo.slowX, geo.slowY, geo.slowW, geo.slowH, 10);

    const capS = labFont(13.5, true);
    const capCol = 'rgba(150,205,178,.94)', capColA = 'rgba(226,201,132,.95)';
    MU.inset(cg, '生命', geo.livesPlate.x + 15, geo.livesPlate.y + 18, capS, capCol, { weight: 700, glow: 0.5 });
    MU.inset(cg, '旗帜', geo.flagsPlate.x + geo.flagsPlate.w - 15, geo.flagsPlate.y + 18, capS, capCol, { weight: 700, glow: 0.5, align: 'right' });
    MU.inset(cg, '用时', geo.timeX + 14, geo.timeY + 16, capS, capColA, { weight: 700, glow: 0.5 });
    MU.inset(cg, '慢放', geo.slowX + 14, geo.slowY + geo.slowH / 2, capS, capCol, { weight: 700, glow: 0.5 });

    /* 慢放盘静态底槽 */
    const barX = geo.slowX + Math.max(50, MU.insetW('慢放', capS, 700) + 20);
    const barW = geo.slowX + geo.slowW - 12 - barX;
    MU._bar = { x: barX, w: barW, y: geo.slowY + geo.slowH / 2 };
    cg.fillStyle = '#050b09'; cg.fillRect(barX, MU._bar.y - 8, barW, 16);
    cg.fillStyle = '#0d1514'; cg.fillRect(barX + 2, MU._bar.y - 6, barW - 4, 12);
    cg.fillStyle = 'rgba(0,0,0,.5)'; cg.fillRect(barX + 2, MU._bar.y + 4, barW - 4, 2);
    cg.fillStyle = 'rgba(255,255,255,.10)';
    for (let i = 1; i < 4; i++) cg.fillRect(barX + 2 + (barW - 4) * i / 4, MU._bar.y - 6, 1.5, 12);
    /* 槽玻璃高光 */
    cg.fillStyle = 'rgba(255,255,255,.10)'; cg.fillRect(barX + 2, MU._bar.y - 6, barW - 4, 1.4);

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

  /* 内部电路板：在**低分辨率**离屏上绘制，再被放大贴合到玻璃后，
     放大插值天然产生“隔着磨砂玻璃看内部”的模糊观感（彩透掌机风）。
     配色为经典绿色 PCB：墨绿底 + 铜色走线 + 排针/焊点/芯片。 */
  MU._buildPCB = function (Wd, Hd) {
    const K = 0.20;                                  /* 低分辨率比例：越小越模糊 */
    const w = Math.max(24, Math.round(Wd * K)), h = Math.max(24, Math.round(Hd * K));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    const r = mulberry32Local(Math.round(Wd) * 131 + Math.round(Hd) * 17);
    /* 更亮更饱和的阻焊绿，保证透过紫色壳仍能分辨出“绿色电路板” */
    c.fillStyle = '#1b7d3e'; c.fillRect(0, 0, w, h);
    /* 大区块色差，避免死板平色 */
    for (let i = 0; i < 26; i++) {
      c.fillStyle = (i % 2 ? 'rgba(44,158,84,.66)' : 'rgba(14,92,52,.62)');
      c.fillRect(r() * w, r() * h, 6 + r() * (w * 0.24), 6 + r() * (h * 0.16));
    }
    /* 铜色走线：横平竖直的折线 + 45° 斜段，模拟 PCB 布线 */
    c.lineWidth = 1;
    for (let i = 0; i < 52; i++) {
      c.strokeStyle = (i % 3 === 0) ? 'rgba(255,208,124,.80)' : 'rgba(208,164,94,.62)';
      c.beginPath();
      let x = r() * w, y = r() * h;
      c.moveTo(x, y);
      const segs = 2 + Math.floor(r() * 3);
      for (let s = 0; s < segs; s++) {
        const horiz = r() < 0.5, len = (3 + r() * (w * 0.16)) * (r() < 0.5 ? -1 : 1);
        if (horiz) x += len; else y += len;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    /* 焊点 / 过孔：亮铜小圆点 */
    for (let i = 0; i < 100; i++) {
      const x = r() * w, y = r() * h;
      c.fillStyle = 'rgba(255,214,138,.9)'; c.beginPath(); c.arc(x, y, 0.9 + r() * 0.7, 0, 6.2832); c.fill();
      c.fillStyle = 'rgba(16,84,44,.85)'; c.beginPath(); c.arc(x, y, 0.36, 0, 6.2832); c.fill();
    }
    /* 芯片：深色方块 + 引脚 */
    for (let i = 0; i < 6; i++) {
      const cw = 4 + r() * 10, chh = 3 + r() * 8, x = r() * (w - cw), y = r() * (h - chh);
      c.fillStyle = '#0c1a13'; c.fillRect(x, y, cw, chh);
      c.strokeStyle = 'rgba(180,142,74,.62)'; c.lineWidth = 0.6; c.strokeRect(x + 0.3, y + 0.3, cw - 0.6, chh - 0.6);
      c.fillStyle = 'rgba(226,186,110,.68)';
      const pins = Math.max(2, Math.round(cw / 2.2));
      for (let p = 0; p < pins; p++) {
        const px = x + (p + 0.5) * (cw / pins);
        c.fillRect(px - 0.35, y - 1, 0.7, 1); c.fillRect(px - 0.35, y + chh, 0.7, 1);
      }
    }
    /* 排针座：一排铜针 */
    for (let i = 0; i < 4; i++) {
      const bx = r() * (w - 8), by = r() * (h - 6);
      c.fillStyle = '#12241c'; c.fillRect(bx, by, 8, 5);
      c.fillStyle = 'rgba(226,184,106,.82)';
      for (let p = 0; p < 4; p++) c.fillRect(bx + 1 + p * 1.7, by + 1.2, 0.9, 2.6);
    }
    /* 丝印白字（放大后成一团雾白，恰似玻璃后模糊字样） */
    c.fillStyle = 'rgba(236,246,240,.44)';
    for (let i = 0; i < 18; i++) c.fillRect(r() * w, r() * h, 2 + r() * 7, 0.9);
    return cv;
  };
  /* 供 PCB 使用的可复现随机（与项目其它处一致的 mulberry32） */
  function mulberry32Local(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 静态高光随倾角的微调系数（0.85~1.15）：这是“灯光跟着手机走”的观感来源。
     幅度刻意压得很小——键帽的形状读起来必须稳定，不能因为晃动而显得在闪。
     kx/ky 是这一处高光在“受光方向”上的权重（顶光≈ky 大，侧光≈kx 大）。 */
  let _hlHalfW = 1;
  MU.setHLFrame = function (Wd) { _hlHalfW = Math.max(1, Wd / 2); };
  function _hl(k, kx, ky, cx) {
    if (!MU._tiltHL || !MU.parallaxOn || !MU.GEO) return k;
    const rel = a => Math.max(-1, Math.min(1, a / MU.PARALLAX));
    const tx = rel(MU.tilt.x), ty = rel(MU.tilt.y);
    const dx = (cx - _hlHalfW) / _hlHalfW;             /* 键相对机身中心的横向位置 */
    const v = kx * (-tx) + ky * (-ty) + 0.22 * kx * dx * (-tx);
    return k * (1 + 0.15 * Math.max(-1, Math.min(1, v)));
  }

  /* 单个圆形按键的静态外观：拟物化实体键（参考 GBC 真实按键）
     层次：座圈凹井(gate) → 落地投影 → 外缘斜面(rim) → 亮边 → 凹碗键面 →
           顶部弧面高光 + 左缘镜面高光 → 底内影 → 底部反弹光 → 符号 + 标签。
     符号保留像素图元（键帽丝印风），**标签改为清晰的非像素字**。
     高光强度随倾角微变（_hl / MU._tiltHL），倾斜明显变化时由 setTilt 触发重烘焙。 */
  MU.bakeFace = function (ctx, c) {
    const P = MU.PAL[c.fam], r = c.r;
    const faceR = r - Math.max(3, r * 0.16);
    const hTop = _hl(0.34, 0.85, 0.55, c.cx);            /* 顶部宽弧光 */
    const hLip = _hl(0.18, 0.30, 0.55, c.cx);            /* 左缘镜面 */
    const hDot = _hl(0.10, 0.75, 0.75, c.cx);            /* 右下点光 */
    const hBot = _hl(0.10, 0.35, -0.80, c.cx);           /* 底部反弹光 */

    /* ⓪ 座圈凹井：键被“嵌进”机身的一圈暗槽（比键略大），增强实处感 */
    ctx.beginPath(); ctx.arc(c.cx, c.cy + r * 0.03, r * 1.055, 0, 6.2832);
    ctx.fillStyle = P.gate; ctx.fill();

    /* ① 落地阴影：整键在机身玻璃上的投影（柔化） */
    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, c.cy + Math.max(3.5, r * 0.11), r * 1.01, 0, 6.2832);
    ctx.fillStyle = 'rgba(14,6,32,.50)'; ctx.filter = 'blur(1.6px)'; ctx.fill();
    ctx.restore();

    /* ② 外缘斜面（rim）：座圈，受光面向左上光源 */
    const rg = ctx.createLinearGradient(c.cx - r, c.cy - r, c.cx + r * 0.5, c.cy + r);
    rg.addColorStop(0, 'rgba(255,255,255,.40)');
    rg.addColorStop(0.30, P.rim);
    rg.addColorStop(0.55, P.rim);
    rg.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r, 0, 6.2832);
    ctx.fillStyle = P.rim; ctx.fill();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - 0.6, 0, 6.2832);
    ctx.strokeStyle = rg; ctx.lineWidth = Math.max(1.3, r * 0.085); ctx.stroke();

    /* ③ 座圈内的一圈亮边（键面与座圈的分界） */
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - Math.max(2.6, r * 0.135), 0, 6.2832);
    ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = Math.max(1, r * 0.055); ctx.stroke();

    /* ④ 凹碗按键面：径向渐变，中央微凹、左上受光 */
    const face = ctx.createRadialGradient(
      c.cx - faceR * 0.36, c.cy - faceR * 0.46, faceR * 0.10,
      c.cx - faceR * 0.06, c.cy - faceR * 0.02, faceR * 1.08);
    face.addColorStop(0, P.a);
    face.addColorStop(0.42, P.b);
    face.addColorStop(1, P.c);
    ctx.beginPath(); ctx.arc(c.cx, c.cy, faceR, 0, 6.2832);
    ctx.fillStyle = face; ctx.fill();

    /* ⑤ 高光层（裁在键面内）：顶部弧面高光 + 左缘镜面高光 + 底部反弹光 */
    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, faceR, 0, 6.2832); ctx.clip();
    /* 顶部宽弧光 */
    ctx.beginPath();
    ctx.ellipse(c.cx - faceR * 0.06, c.cy - faceR * 0.50, faceR * 0.66, faceR * 0.34, 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,' + hTop.toFixed(3) + ')'; ctx.fill();
    /* 左缘竖条镜面高光（塑料壳反光） */
    ctx.beginPath();
    ctx.ellipse(c.cx - faceR * 0.52, c.cy - faceR * 0.06, faceR * 0.16, faceR * 0.58, 0.12, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,' + hLip.toFixed(3) + ')'; ctx.fill();
    /* 右下点状小高光 */
    ctx.beginPath();
    ctx.ellipse(c.cx + faceR * 0.40, c.cy + faceR * 0.44, faceR * 0.20, faceR * 0.13, -0.7, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,' + hDot.toFixed(3) + ')'; ctx.fill();
    /* ⑥ 底部内阴影：强化“凹” */
    const inSh = ctx.createRadialGradient(c.cx, c.cy + faceR * 0.30, faceR * 0.18, c.cx, c.cy, faceR * 1.02);
    inSh.addColorStop(0, 'rgba(0,0,0,0)');
    inSh.addColorStop(1, 'rgba(0,0,0,.40)');
    ctx.beginPath(); ctx.arc(c.cx, c.cy, faceR, 0, 6.2832);
    ctx.fillStyle = inSh; ctx.fill();
    /* 底部反弹光（环境光从下方照回键面下缘） */
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy + faceR * 0.86, faceR * 0.50, faceR * 0.16, 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,' + hBot.toFixed(3) + ')'; ctx.fill();
    ctx.restore();

    /* ⑦ 符号（像素丝印）+ 标签（清晰非像素字，保证可读） */
    MU.keyInk(ctx, c, c.cx, c.cy, r, P);
  };

  /* ------------------------------------------------------ 掌机机身（局内渲染） */
  /* 分层绘制顺序（这是立体感的关键）：
       ① 后层 MU.drawBoard()  —— 电路板，唯一随倾角位移的层；
       ② 前层 MU._cv          —— 玻璃染色 / 描边 / 包边 / LCD / 按键，固定不动；
       ③ MU.drawSheen()       —— 外壳高光，位置随倾角微移（磨砂感，很弱）；
       ④ 动态内容             —— LCD 文字 / 按键按下态 / 入水提示。 */
  MU.drawChrome = function () {
    const ctx = g;
    if (MU.bakeBoardKey !== MU.key()) MU.bakeBoard();
    if (MU.bakeKey !== MU.key()) MU.bake();
    MU.drawBoard(ctx);                       /* ① 会随倾斜滑动的内部电路板 */
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(MU._cv, 0, 0);             /* ② 固定的外壳玻璃 */
    ctx.restore();
    MU.drawSheen();                          /* ③ 随倾斜移动的玻璃反光 */

    MU.drawPlates();      /* 生命 / 旗帜 / 用时 / 慢放 的动态内容 */
    MU.drawControls();    /* 按下反馈 + 起点二次确认高亮 */
    MU.drawWaterHint();
  };

  /* 后层贴图：整层比机身四周各大 MU.PAD，位移后仍满幅（|tilt| ≤ PAD，永不露边）。
     屏幕窗口在这里按**固定的**机身坐标挖空，因此无论电路板怎么滑，
     画面区域永远是纯净的，绝不会被纹理侵占。 */
  MU.drawBoard = function (ctx) {
    const bp = MU._bp;
    if (!bp) return;
    const geo = MU.GEO, Pd = MU.PAD;
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);   /* 用设计单位作图 */
    ctx.imageSmoothingEnabled = true;
    ctx.beginPath(); ctx.rect(0, 0, geo.W, geo.H);
    MU.rrPath(ctx, geo.screenX, geo.screenY, geo.screenW, geo.screenH, 14);
    ctx.clip('evenodd');                                       /* 挖掉屏幕窗口 */
    ctx.drawImage(bp, MU.tilt.x - Pd, MU.tilt.y - Pd, geo.W + Pd * 2, geo.H + Pd * 2);
    ctx.restore();
  };

  /* 玻璃外壳的镜面反光：位置/强度**随倾角微动**，制造“高光跟着手机走”的真实感。
     三条硬性约束（用户红线：绝不能影响可读性）：
       · 大片柔光 / 左缘细高光 / 斜向环境光带都只作用在**外壳玻璃**上，强度本身很低
         （磨砂玻璃，不刺眼，不像贴了张镜子）；
       · 用 even-odd 把 **游戏窗口 + 4 个 LCD 信息槽（含外框）** 整块挖掉，
         文字与画面所在区域一个像素都不覆盖；
       · 绘制顺序排在动态文字**之前**，即使有边缘溢出也会被后续文字压住。 */
  MU.drawSheen = function () {
    const ctx = g;
    if (!MU.GEO) return;
    const geo = MU.GEO, Wd = geo.W, Hd = geo.H;
    const rel = a => Math.max(-1, Math.min(1, a / MU.PARALLAX));
    const tx = rel(MU.tilt.x), ty = rel(MU.tilt.y);
    const sx = geo.screenX, sy = geo.screenY, sw = geo.screenW, sh = geo.screenH;
    const pad = 6;

    const cut = () => {
      MU.rrPath(ctx, sx - pad, sy - pad, sw + pad * 2, sh + pad * 2, 18);
      [geo.livesPlate, geo.flagsPlate].forEach(p =>
        MU.rrPath(ctx, p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2, 14));
      MU.rrPath(ctx, geo.timeX - pad, geo.timeY - pad, geo.timeW + pad * 2, geo.timeH + pad * 2, 14);
      MU.rrPath(ctx, geo.slowX - pad, geo.slowY - pad, geo.slowW + pad * 2, geo.slowH + pad * 2, 14);
    };

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, Wd, Hd); cut(); ctx.clip('evenodd');

    /* ① 大片柔光：光源随倾角移动。强度**克制**——磨砂玻璃不会出现大片镜面，
          大块亮斑只会让机身看起来发灰、像蒙了层雾，所以宁可弱一点。 */
    const gx = Wd * 0.30 - tx * Wd * 0.11, gy = Hd * 0.25 - ty * Hd * 0.075;
    const spec = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(Wd, Hd) * 0.60);
    spec.addColorStop(0, 'rgba(255,255,255,' + (0.105 + 0.03 * rel(-tx)).toFixed(3) + ')');
    spec.addColorStop(0.42, 'rgba(255,255,255,0.036)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec; ctx.fillRect(0, 0, Wd, Hd);

    /* ② 左缘细高光：塑料厚壁的反光。这一处最像“真的玻璃”，因此给得稍足，
          并且位置与强度都随倾角变化。 */
    const lipW = Wd * 0.14;
    const off = tx * Wd * 0.022;
    const lg = ctx.createLinearGradient(off, 0, off + lipW, 0);
    lg.addColorStop(0, 'rgba(255,244,255,' + (0.20 + 0.08 * rel(-tx)).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(255,244,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, lipW + Math.abs(off), Hd);

    /* ③ 斜向环境反光：一整片很淡、很宽的对角亮带，随倾角小幅平移。
          刻意压得很低（≈0.04）—— 它的作用是让机身“是一块玻璃”而不是一块板，
          一旦调高就会变成一块发白的污渍，反而不真实。 */
    const bandW = Wd * 0.55;
    const bx = -bandW * 0.30 + tx * Wd * 0.05;
    const bg = ctx.createLinearGradient(bx, 0, bx + bandW, Hd);
    bg.addColorStop(0, 'rgba(232,222,255,0)');
    bg.addColorStop(0.5, 'rgba(232,222,255,' + (0.042 + 0.02 * rel(-tx)).toFixed(3) + ')');
    bg.addColorStop(1, 'rgba(232,222,255,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, Wd, Hd);

    ctx.restore();
  };

  /* 生命盘：红心格；刚掉血时闪一圈红 */
  MU.drawPlates = function () {
    const ctx = g, geo = MU.GEO, lp = geo.livesPlate, fp = geo.flagsPlate;
    const n = Math.max(0, Play.lives);
    const step = 23;
    const startX = lp.x + 18;
    const hY = lp.y + lp.h - 26;
    for (let i = 0; i < n; i++) heart(startX + i * step, hY, 2);
    if (!n) MU.inset(ctx, '—', lp.x + lp.w / 2, lp.y + lp.h - 22, 18, 'rgba(128,168,146,.85)', { weight: 700, align: 'center' });
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
    if (!f) MU.inset(ctx, '无', fp.x + fp.w / 2, fp.y + fp.h - 22, 18, 'rgba(128,168,146,.85)', { weight: 700, align: 'center' });
    else {
      const show = Math.min(f, 6);
      for (let i = 0; i < show; i++) flagIcon(fp.x + 20 + i * 27, fp.y + fp.h - 36, 1.7);
      MU.inset(ctx, '×' + f, fp.x + fp.w - 14, fp.y + fp.h - 22, 17, 'rgba(244,217,122,.98)', { weight: 800, align: 'right' });
    }
    MU.inset(ctx, '第 ' + String(Game.selected + 1) + ' 关', geo.timeX + 14, geo.timeY + geo.timeH * 0.64, 13, 'rgba(150,200,170,.94)', { weight: 600 });
    MU.inset(ctx, formatTime(Game.elapsed), geo.timeX + geo.timeW - 16, geo.timeY + geo.timeH * 0.66, 26, 'rgba(252,228,140,1)', { weight: 800, align: 'right', glow: 1.35 });

    const bar = MU._bar;
    if (bar) {
      const e = Math.max(0, Math.min(1, Play.energy));
      /* 触底回涨：黄色；回满后黄色缓慢渐变为原本的绿色（slowWarn 1→0）。
         未触底时 slowWarn=0 → 纯绿色，观感与旧版一致。 */
      const w = Math.max(0, Math.min(1, Play.slowWarn || 0));
      const mix = (a, b) => Math.round(a + (b - a) * w);
      const fillA = `rgb(${mix(168, 255)},${mix(247, 226)},${mix(226, 122)})`;
      const fillB = `rgb(${mix(92, 232)},${mix(195, 176)},${mix(177, 38)})`;
      const fillC = `rgb(${mix(43, 176)},${mix(143, 120)},${mix(130, 24)})`;
      if (e > 0.004) {
        const fw = Math.max(3, (bar.w - 4) * e);
        const gr = ctx.createLinearGradient(0, bar.y - 6, 0, bar.y + 6);
        gr.addColorStop(0, fillA); gr.addColorStop(0.5, fillB); gr.addColorStop(1, fillC);
        ctx.fillStyle = gr; ctx.fillRect(bar.x + 2, bar.y - 6, fw, 12);
        ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fillRect(bar.x + 2, bar.y - 6, fw, 2.6);
      }
      /* 触底锁定：条框闪一圈警示黄，提示“正在回能，满了才能再用” */
      if (Play.slowLocked) {
        const p = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(clock * 7));
        ctx.save();
        ctx.globalAlpha = p;
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.2;
        ctx.beginPath(); MU.rrPath(ctx, bar.x - 2, bar.y - 10.5, bar.w + 4, 21, 5); ctx.stroke();
        ctx.restore();
      }
      if (e > 0.995 && !Play.slowLocked) { ctx.fillStyle = 'rgba(210,255,246,.85)'; ctx.fillRect(bar.x + 2, bar.y - 6, bar.w - 4, 2); }
    }
  };

  /* 键帽丝印：符号（像素图元）+ 标签（清晰非像素字，无发光以免糊）。bakeFace 与按下态共用。
     可读性策略（不改键面主色，避免"字和键色差太多很违和"）：
     给符号与标签都加一圈**极细的对比色描边**——深色字配亮边、亮色字配暗边，
     自动由 MU.lum(P.glyph) 决定。键面配色仍然是原样，只是多了分离边。 */
  MU.keyInk = function (ctx, c, cx, cy, r, P, inkAlpha) {
    const gu = MU.U(16.5);
    const gy = cy - r * 0.29;
    const glum = MU.lum(P.glyph);
    const halo = glum < 0.5 ? 'rgba(255,255,255,.78)' : 'rgba(0,0,0,.68)';
    ctx.save();
    if (inkAlpha !== undefined) ctx.globalAlpha = inkAlpha;
    /* ① 原有底部投影（保留：给出"刻进塑料"的厚度感） */
    ctx.globalAlpha *= 0.34;
    MU.glyph(ctx, c.glyph, cx, gy + 1.2, gu, 'rgba(0,0,0,.95)');
    ctx.restore();

    /* ② 环形描边：8 个方向的偏移各画一遍，形成一圈封闭细边。
       偏移量取 1 个像素格，保证细而不糊。 */
    ctx.save();
    if (inkAlpha !== undefined) ctx.globalAlpha = inkAlpha * 0.92;
    const o = Math.max(1, Math.round(gu * 0.9));
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]]) {
      MU.glyph(ctx, c.glyph, cx + dx, gy + dy, gu, halo);
    }
    ctx.restore();

    /* ③ 本体：符号用键面配色 */
    MU.glyph(ctx, c.glyph, cx, gy, gu, P.glyph);

    /* 标签：以**屏幕 CSS 像素**给定字号并设下限 12px，保证小屏也看得清；
       位置下移到键面下缘内侧，避免压到座圈。字号略增 + 描边以提升可读性。 */
    const labCss = Math.max(12.5, Math.min(17, (r * scale) * 0.52));
    const labSize = MU.CSS(labCss);
    MU.inset(ctx, c.label, cx, cy + r * 0.43, labSize, P.glyph,
      { weight: 800, crisp: true, align: 'center', alpha: inkAlpha, outline: true });
  };

  /* 按下态：座圈**固定不动**，只有键帽下沉 + 缩径 + 压暗 —— 这才是真实的
     “按键陷进壳体”的观感。t∈[0,1] 为压下比例（0.8 约等于真实键程）。 */
  MU.pressFace = function (ctx, c, t) {
    const P = MU.PAL[c.fam], r = c.r;
    const faceR = r - Math.max(3, r * 0.16);
    const sink = faceR * 0.17 * t;                    /* 下沉量（够大胆） */
    const sh = 1 - 0.085 * t;                         /* 缩径 */
    const fr = faceR * sh, cy = c.cy + sink;

    /* ① 座圈凹井：**固定在原位**，不随键帽下沉 */
    ctx.beginPath(); ctx.arc(c.cx, c.cy + r * 0.03, r * 1.055, 0, 6.2832);
    ctx.fillStyle = P.gate; ctx.fill();
    const rg = ctx.createLinearGradient(c.cx, c.cy - r, c.cx, c.cy + r);
    rg.addColorStop(0, 'rgba(255,255,255,.38)');
    rg.addColorStop(0.34, P.rim);
    rg.addColorStop(1, 'rgba(0,0,0,.50)');
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r, 0, 6.2832);
    ctx.fillStyle = P.rim; ctx.fill();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - 0.6, 0, 6.2832);
    ctx.strokeStyle = rg; ctx.lineWidth = Math.max(1.3, r * 0.085); ctx.stroke();
    /* 座圈内圈亮边（键面与座圈的分界，静止不动） */
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - Math.max(2.6, r * 0.135), 0, 6.2832);
    ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = Math.max(1, r * 0.055); ctx.stroke();

    /* ② 键帽下沉后，座圈上沿露出的内壁：在键帽顶部投下一道深弧影 */
    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, c.cy, r - Math.max(2.6, r * 0.135), 0, 6.2832); ctx.clip();
    const wallSh = ctx.createLinearGradient(0, c.cy - r, 0, c.cy + sink + fr * 0.15);
    wallSh.addColorStop(0, 'rgba(0,0,0,' + (0.30 + 0.34 * t).toFixed(3) + ')');
    wallSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wallSh;
    ctx.fillRect(c.cx - r, c.cy - r, r * 2, sink + fr * 0.6 + 2);
    ctx.restore();

    /* ③ 键帽：下沉 + 缩径 + 整体压暗 */
    const face = ctx.createRadialGradient(c.cx - fr * 0.2, cy + fr * 0.30, fr * 0.10, c.cx, cy, fr * 1.06);
    face.addColorStop(0, P.b);
    face.addColorStop(0.52, P.c);
    face.addColorStop(1, P.rim);
    ctx.beginPath(); ctx.arc(c.cx, cy, fr, 0, 6.2832);
    ctx.fillStyle = face; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(c.cx, cy, fr, 0, 6.2832); ctx.clip();
    /* 整体压暗（受光减少） */
    const dark = ctx.createLinearGradient(0, cy - fr, 0, cy + fr);
    dark.addColorStop(0, 'rgba(0,0,0,' + (0.34 * t).toFixed(3) + ')');
    dark.addColorStop(0.55, 'rgba(0,0,0,' + (0.18 * t).toFixed(3) + ')');
    dark.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = dark; ctx.fillRect(c.cx - fr, cy - fr, fr * 2, fr * 2);
    /* 顶缘内影：凹碗上沿挡住光（按压的关键视觉） */
    const topSh = ctx.createLinearGradient(0, cy - fr, 0, cy + fr * 0.10);
    topSh.addColorStop(0, 'rgba(0,0,0,' + (0.30 + 0.22 * t).toFixed(3) + ')');
    topSh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topSh; ctx.fillRect(c.cx - fr, cy - fr, fr * 2, fr * 1.20);
    /* 底缘一线细反光（键帽下缘仍被环境光照到） */
    ctx.beginPath();
    ctx.ellipse(c.cx, cy + fr * 0.92, fr * 0.62, fr * 0.09, 0, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.20 * (1 - 0.5 * t)).toFixed(3) + ')'; ctx.fill();
    ctx.restore();

    /* ④ 键帽外缘一圈细描（下沉后更清晰的分界） */
    ctx.beginPath(); ctx.arc(c.cx, cy, fr, 0, 6.2832);
    ctx.strokeStyle = 'rgba(0,0,0,' + (0.20 + 0.24 * t).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, r * 0.045); ctx.stroke();

    /* ⑤ 丝印随键帽下沉并略压暗 */
    MU.keyInk(ctx, c, c.cx, cy - sink * 0.30, r, P, 1 - 0.24 * t);
  };

  /* 按键前景：按下时的真实压感 + 点按闪光 + 起点二次确认脉冲 */
  MU.drawControls = function () {
    const ctx = g, geo = MU.GEO;
    for (let i = 0; i < geo.controls.length; i++) {
      const c = geo.controls[i];
      const lit = !!MU.held[c.id] || !!(c.hold && Play.keys[c.hold]);
      const flashed = MU.flash[c.id] > clock;
      if (lit || flashed) {
        const t = lit ? 0.8 : 0.6;
        ctx.save();
        if (Play.keys[c.hold] && !MU.held[c.id]) ctx.globalAlpha = 0.96;
        MU.pressFace(ctx, c, t);
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
    ctx.save(); ctx.globalAlpha = 0.94;
    MU.lcdWell(ctx, x, y, w, h, 9, 'amber');
    MU.inset(ctx, '呼吸 ' + Play.waterBubbleTimer.toFixed(1) + ' 秒', x + w / 2, y + h / 2, labFont(17, true), 'rgba(252,228,140,1)', { weight: 800, align: 'center', glow: 1.1 });
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
  /* 「起点」：让场上的幽灵回到各自轨迹的起点（与 PC 端的 L 键同源）。
     注意——这**不是**让玩家回重生点：玩家原地不动、不扣血，
     只是把幽灵回放拉回轨迹开头，方便反复观察 / 借幽灵借力。
     （若玩家正站在幽灵上，会随幽灵一起被带回去，这属于正常玩法。） */
  MU.ghostRewind = function () {
    if (Game.state !== 'playing') return;
    if (typeof rewindGhosts !== 'function') return;
    const n = rewindGhosts();
    if (!n) { notify('当前没有幽灵'); return; }
    AudioSystem.sfx('ghost');
    notify('幽灵已回到轨迹起点');
  };
  MU.ctrlFn = function (c) {
    if (c.hold) return function () { MU.tapHold(c.hold); };
    if (c.id === 'mobFlag') return function () { if (Game.state === 'playing') doFlagAction(); };
    if (c.id === 'mobDie') return function () { if (Game.state === 'playing') doSuicidePlay(); };
    if (c.id === 'mobRestart') return function () { MU.ghostRewind(); };
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
    /* 输入闸门（界面切换后的短暂屏蔽）：直接返回，且**不要**点亮键面，
       否则会闪出一个「按了但没反应」的假反馈，反而让人以为按键坏了。 */
    if (typeof gated === 'function' && gated()) return;
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
        /* 这类按键会 stopPropagation，window 上的 pointerdown 不会触发，
           所以在这里自行标记“本次是否为触摸类输入”，闸门才会对它生效。 */
        if (typeof armGate === 'function') armGate(ev.pointerType);
        /* 局内外衔接处：刚进关卡的极短窗口内屏蔽，避免「进入关卡的那一次连点」
           顺手把方向键/跳跃也按下去了（局内稳态不受影响，闸门会自然过期）。 */
        if (typeof gated === 'function' && gated()) return;
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
      const fs = labFont(17, true);
      const tw = Math.min(W - 40, Math.max(300, MU.insetW(s, fs, 700) + 56));
      const tx = (W - tw) / 2, ty = MU.GEO ? (MU.GEO.screenY - 60) : (H * 0.30);
      MU.lcdWell(g, tx, ty, tw, 46, 10, 'amber');
      MU.inset(g, s, W / 2, ty + 24, fs, 'rgba(255,236,168,1)', { weight: 700, align: 'center', glow: 1.05 });
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
    /* 简约独立游戏启动页（竖屏）：居中 logo + 标语 + 呼吸提示，其余留白。 */
    const cy = H * 0.38;
    styledText('拼 死 跳 跃', W / 2, cy - H * 0.028, 2.10,
      ['#ffffff', '#ffe98a', '#e8a92c', '#96630e'], 3.6, 0.25);
    styledText('D I E   T O   J U M P', W / 2, cy + H * 0.046, 0.98,
      ['#ffffff', '#fff3cf', '#f4c96a', '#b8811c'], 1.8, 0.25);
    rect(W / 2 - Math.round(W * 0.16), cy + H * 0.082, Math.round(W * 0.32), 1, 'rgba(255,255,255,.34)');
    styledText('每一次陨落，都是下一次起跳的回响', W / 2, cy + H * 0.118, 0.92,
      ['#ffffff', '#fff3cf', '#f4c96a', '#b8811c'], 1.5, 0.25);
    const pulse = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(clock * 2.4));
    g.save(); g.globalAlpha = pulse;
    styledText('轻 触 屏 幕 开 始', W / 2, H * 0.78, 1.35,
      ['#ffffff', '#fff2b0', '#f0b73e', '#a9770f'], 2.2, 0.25);
    g.restore();
    g.save(); g.globalAlpha = 0.42;
    text('手机版 · 竖屏触屏操作', W / 2, H * 0.88, C.skyInkDim, 0.92);
    g.restore();
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
        ['restart', '幽灵回到轨迹起点（玩家原地不动）'],
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
