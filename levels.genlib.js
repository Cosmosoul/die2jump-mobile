/* levels.genlib.js —— 关卡生成器（浏览器版），由 lvgen/buildgenlib.cjs 自动生成，请勿手改。
 *
 *  为什么存在：100~1000 关若全部内联为字面量约 94.6MB（93.7% 是背景形状），
 *  浏览器同步解析会卡死。而生成器是**完全确定性**的（同 idx 跨进程 md5 一致、
 *  无 Math.random / Date.now），所以只需存"配方"，运行时重算。
 *
 *  压缩比：1000 关 94.6MB(内联) → 约 80KB(配方)，约 1200:1
 *
 *  用法：
 *    const lv = LevelGen.build(idx);          // 生成第 idx 关（0 起）
 *    const list = LevelGen.meta(0, 1000);     // 只取轻量元数据（选关页用）
 *
 *  注意：idx < 50 的输出与原 world50.cjs **逐字节一致**（见 lvgen/_genxt.cjs）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LevelGen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---- 迷你 CommonJS 运行时 ---- */
var __reg = {};      /* id -> { e: exports, fn: factory } */
var __cache = {};

function __def(id, fn) { __reg[id] = { fn: fn, cached: null }; }
function __req(path) {
  /* 只支持 './xxx.cjs' / './xxx' 形式（本项目生成器只用这种） */
  var id = String(path).replace(/^\.\//, '').replace(/\.cjs$/, '');
  if (__cache[id]) return __cache[id];
  var m = __reg[id];
  if (!m) throw new Error('genlib: 未知模块 ' + path);
  var module = { exports: {} };
  var localReq = function (p) { return __req(p); };
  localReq.main = undefined;                  /* 让 require.main === module 为假 ⇒ 跳过 CLI 块 */
  m.fn(module, module.exports, localReq, id);
  __cache[id] = module.exports;
  return module.exports;
}

/* ===== rooms.cjs ===== */
__def("rooms", function (module, exports, require, __name) {
'use strict';
/* rooms.cjs —— 「解谜房间」配方库（手工逐格设计）
 *
 *  ▍为什么推倒重来
 *    旧版 50 关是「随机拼块 + 注入尖刺」，产出的是**操作难度**（跳过刺和坑），
 *    不是**解密**。用户明确否决：「不是只是简单的跳过刺和坑，这不算解密！」
 *    本版改为：**每个房间 = 一个手工设计的谜题**，玩家看一眼要「想一下」。
 *
 *  ▍房间契约（每个配方必须遵守，保证可组装、可验证）
 *    · 尺寸统一 W=26, H=12（1 格 = 8px）
 *    · 行 0 = 天花板（实心），行 H-1 = 地板（实心）
 *    · 列 0 / 列 W-1 = 侧墙；**门洞 = 行 8..10**（贴地 3 格高）
 *    · 方块字符：'#' 实心  '.' 空  '=' 薄平台  '^' 地刺  ',' 顶刺  '/' 落刺
 *      '~' 水  'i' 冰  'b' 易碎  'f' 可燃  '*' 消失台  'm' 可推箱
 *      'R/L/U/W' 激光    'o' 压力板(need1) 'O' 压力板(need2) 'H' 竖直门
 *      's' 踩踏开关  'g' 重力区  'x' 浓烟  'l' 灯  'v' 藤蔓  'w' 水草
 *    · 配方可声明 floorGap（地板开口）用于竖井/坑
 *
 *  ▍设计基准（全部来自 _limits.cjs 实测）
 *    跳跃净升 ≤ 3.8 格（安全值 3）；可跳坑宽 ≤ 7（安全值 5）；
 *    可上台阶 ≤ 6（安全值 4）；水下窒息 10s；爆炸半径 3 格；
 *    交替蹬墙跳 1 格竖缝可升 6.7 格。
 */

const W = 26, H = 12;
const DOOR0 = 8, DOOR1 = 10;          /* 门洞行 8..10（贴地） */

/* 便捷构造：空白房间（天花板 + 地板 + 侧墙 + 左右门洞） */
function blank() {
  const r = [];
  for (let y = 0; y < H; y++) r.push(new Array(W).fill('.'));
  for (let x = 0; x < W; x++) { r[0][x] = '#'; r[H - 1][x] = '#'; }
  for (let y = 0; y < H; y++) { r[y][0] = '#'; r[y][W - 1] = '#'; }
  /* 左右门洞 */
  for (let y = DOOR0; y <= DOOR1; y++) { r[y][0] = '.'; r[y][W - 1] = '.'; }
  return r.map(a => a.join(''));
}
/* 把 rows(字符串数组) 转成可变二维数组 */
function grid(rows) { return rows.map(s => s.split('')); }
function toRows(g) { return g.map(a => a.join('')); }
/* 在 g 上画：把 ascii 的多行贴到 (x,y) */
function stamp(g, x, y, lines) {
  for (let j = 0; j < lines.length; j++)
    for (let i = 0; i < lines[j].length; i++) {
      const c = lines[j][i];
      if (c !== undefined && x + i >= 0 && x + i < W && y + j >= 0 && y + j < H) g[y + j][x + i] = c;
    }
}

module.exports = { W, H, DOOR0, DOOR1, blank, grid, toRows, stamp };

});

/* ===== themes.cjs ===== */
__def("themes", function (module, exports, require, __name) {
'use strict';
/* ============================================================================
 * themes.cjs —— 背景主题系统
 *  每套主题含 4~5 个视差层（layer 0 最远/静止 → layer N 最近/世界锚定）
 *  形状尺寸自动随"层"与"视野宽度"铺开，保证镜头移动时背景始终覆盖视野。
 *  仅使用编辑器内置 shape / shader，保证游戏端能正确渲染。
 * ==========================================================================*/

/* 视差公式（见 runtime.js）：多图层时 pf = layer/maxLayer
   layer0 → pf=0 → 屏幕锚定（静止远景）
   layerMax → pf=1 → 世界锚定（与场景同步） */

const SHAPE = {
  rect: 'rect', circle: 'circle', ellipse: 'ellipse', triangle: 'triangle',
  mountain: 'presetMountain', range: 'presetMountainRange', castle: 'presetCastle',
  city: 'presetCity', village: 'presetVillage', stars: 'presetStars', galaxy: 'presetGalaxy',
  cloud: 'presetCloud', forest: 'presetForest', pine: 'presetPineForest', hay: 'presetHaystack',
  fence: 'presetFence', wall: 'presetWall', dragon: 'presetDragon', mech: 'presetMech',
  tower: 'presetTower', ruins: 'presetRuins', lighthouse: 'presetLighthouse', tree: 'presetTree',
  birds: 'presetBirds', whale: 'presetWhale', hill: 'presetHill', tent: 'presetTent',
  pyramid: 'presetPyramid', windmill: 'presetWindmill'
};

/* 随机数（可复现） */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 生成一层背景：横向平铺 shapes，覆盖 [x0,x1] × [y0,y1]，带视差安全边距 */
function tile(layer, maxLayer, opts) {
  const rnd = mulberry(opts.seed || 1);
  const out = [];
  const { x0, x1, y0, y1 } = opts.bounds;
  /* 视差安全边距：底层 pf=0 完全屏幕锚定，需要覆盖「世界范围 + 整个视野叠加」；
     这里给足 +900px 双向余量（视野 300px，箱庭纵深可达数百 px）。 */
  const pf = maxLayer > 0 ? layer / maxLayer : 1;
  const pad = Math.ceil((1 - pf) * (opts.pad || 900)) + 400;
  const X0 = x0 - pad, X1 = x1 + pad;
  const Y0 = y0 - pad * 0.5, Y1 = y1 + pad * 0.5;

  const shapes = opts.shapes || [];
  const mapH = Math.max(1, y1 - y0);   /* 实际地图高度（不含 pad） */

  /* --- 密度预判：估算「若全铺」的形状数，超预算就放大步长 ---
     本作是垂直下坠玩法：**纵向密度优先**（保证下潜时背景一直有内容），
     横向可以稀疏一些。故横步长按 scale 线性放大，纵步长只按 √scale 放大。 */
  const CAP = 130;
  function specPlan(spec, scale) {
    const baseStep = spec.step || 200;
    const step = baseStep * scale;
    const count = Math.max(1, Math.ceil((X1 - X0) / step));
    const Hspec = spec.h || 100;
    /* 纵向行距：按形状尺寸留白，同时保证地图高度内至少 ~7 行 → 各分带都有内容 */
    const baseV = Math.round(Math.max(220, Math.min(1500, Hspec * 1.7)));
    const yBase = Math.max(150, Math.min(baseV, mapH / 7));
    const yStep = yBase * Math.sqrt(scale);
    const span = (Y1 + yStep) - (Y0 - yStep);
    const rows = Math.max(1, Math.ceil(span / yStep));
    return { step, count, yStep, rows, n: count * rows };
  }
  let scale = 1;
  for (let it = 0; it < 8; it++) {
    let total = 0;
    for (const spec of shapes) total += specPlan(spec, scale).n;
    if (total <= CAP) break;
    scale *= Math.sqrt(total / CAP) * 1.01;
  }

  for (const spec of shapes) {
    const plan = specPlan(spec, scale);
    const step = plan.step, count = plan.count, yStep = plan.yStep;

    /* === Y 向平铺（关键修复 v2）===
       本作是「垂直下坠」玩法，地图很高；若地标（山/城堡/金字塔）只出现一次，
       镜头下潜后背景就空了（用户反馈："背景会视差移动，要兼顾各位置都好看、不空"）。

       规则：
         · 显式 yStep → 用它；否则用形状高度的 1.7 倍作行距（220..1500 clamp）；
         · baseY 给出时作为首个锚点（相对世界顶端），向下、向上双向铺满；
         · baseY 缺省则从带 pad 的天顶开始铺；
         · 配合 scaleJitter / jitterY / alpha 抖动，看起来是「更多景」而不是机械平铺。 */
    const worldTop = y0;
    const anchor = (spec.baseY !== undefined) ? worldTop + spec.baseY : Y0;
    const ys = [];
    const NMAX = 64;
    for (let k = 0; k < NMAX; k++) {
      const v = anchor + k * yStep;
      if (v > Y1 + yStep) break;
      ys.push(v);
    }
    for (let k = 1; k < NMAX; k++) {
      const v = anchor - k * yStep;
      if (v < Y0 - yStep) break;
      ys.push(v);
    }
    for (const yy of ys) {
      for (let i = 0; i < count; i++) {
        const bx = X0 + i * step + (spec.jitter ? (rnd() - 0.5) * spec.jitter : 0);
        const by = yy + (spec.jitterY ? (rnd() - 0.5) * spec.jitterY : 0);
        const w = spec.w * (spec.scaleJitter ? (1 - spec.scaleJitter / 2 + rnd() * spec.scaleJitter) : 1);
        const h = spec.h * (spec.scaleJitter ? (1 - spec.scaleJitter / 2 + rnd() * spec.scaleJitter) : 1);
        out.push({
          type: 'bgShape',
          chamberId: opts.chamberId,
          x: Math.round(bx), y: Math.round(by),
          w: Math.round(w), h: Math.round(h),
          shape: spec.shape,
          shader: spec.shader || 'solid',
          color: spec.color || '#331166',
          color2: spec.color2 || spec.color || '#0a0e1a',
          glowColor: spec.glowColor || '#ffffff',
          glowIntensity: spec.glowIntensity || 0,
          alpha: spec.alpha !== undefined ? spec.alpha : 0.85,
          rotation: spec.rotation || 0,
          points: spec.points || 6,
          speed: spec.speed !== undefined ? spec.speed : 0
        });
      }
    }
  }
  /* 底色层：一个横跨全范围的渐变矩形，保证永远有底色 */
  if (opts.base) {
    out.unshift({
      type: 'bgShape', chamberId: opts.chamberId,
      x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0,
      shape: 'rect', shader: opts.base.shader || 'gradient',
      color: opts.base.color, color2: opts.base.color2,
      glowColor: opts.base.glow || '#ffffff',
      glowIntensity: opts.base.glowIntensity || 0,
      alpha: opts.base.alpha !== undefined ? opts.base.alpha : 1,
      rotation: 0, points: 6, speed: opts.base.speed || 0
    });
  }
  return out;
}

/* ============================================================================
 * 主题定义：每套 4~5 层
 *  layer 0 = 最远（天空/底色，静止）
 *  layer 末 = 最近（前景剪影，随场景移动）
 * ==========================================================================*/
const THEMES = {
  /* 1. 云间晨光 —— 明亮天空 + 远山 + 云海 + 松林前景 */
  dawn: {
    name: '云间晨光',
    layers: [
      { specs: { base: { color: '#5f9fe0', color2: '#e8f4ff', shader: 'gradient', alpha: 1 } } },
      { specs: { base: { color: '#8fb8e0', color2: '#dceeff', shader: 'gradient', alpha: 0.85 }, shapes: [{ shape: SHAPE.range, step: 240, w: 300, h: 110, baseY: -60, jitterY: 10, color: '#a8c8e8', color2: '#6f9dd0', alpha: 0.6, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.cloud, step: 220, w: 150, h: 70, jitter: 90, jitterY: 60, color: '#ffffff', color2: '#e0eeff', alpha: 0.55, speed: 1.1, scaleJitter: 0.45 }] } },
      { specs: { shapes: [{ shape: SHAPE.pine, step: 150, w: 170, h: 95, baseY: 40, jitterY: 14, color: '#2f6b46', color2: '#1b4230', alpha: 0.8, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.pine, step: 110, w: 150, h: 110, baseY: 95, jitterY: 10, color: '#1d4a30', color2: '#0f2a1b', alpha: 0.92, scaleJitter: 0.25 }] } }
    ]
  },
  /* 2. 落日渐层 —— 暖色天空 + 城市天际线 + 飞鸟 */
  dusk: {
    name: '暮色天际',
    layers: [
      { specs: { base: { color: '#f2a65a', color2: '#7a4a7a', shader: 'sunsetGlow', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.circle, step: 900, w: 70, h: 70, baseY: 30, color: '#fff2b8', color2: '#ff9d5c', glowColor: '#ffd27a', glowIntensity: 1.1, alpha: 0.85, speed: 0.6 }] } },
      { specs: { shapes: [{ shape: SHAPE.city, step: 300, w: 340, h: 130, baseY: 10, jitterY: 25, color: '#6b4a6e', color2: '#3d2a4a', alpha: 0.72, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.city, step: 220, w: 300, h: 170, baseY: 70, jitterY: 20, color: '#3d2a4a', color2: '#221830', alpha: 0.88, scaleJitter: 0.25 }, { shape: SHAPE.birds, step: 400, w: 60, h: 30, baseY: -40, jitterY: 40, color: '#2a1c30', alpha: 0.7, speed: 0.8 }] } }
    ]
  },
  /* 3. 深穴晶矿 —— 洞穴 + 晶体 + 岩浆 */
  cavern: {
    name: '深穴晶矿',
    layers: [
      { specs: { base: { color: '#241a33', color2: '#0d0a16', shader: 'gradient', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.stars, step: 200, w: 200, h: 120, jitterY: 90, color: '#8f7ad8', color2: '#4a3a80', glowColor: '#b49cff', glowIntensity: 0.9, alpha: 0.6, speed: 1.4, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 260, w: 300, h: 160, jitterY: 40, color: '#4b3a6e', color2: '#241a33', alpha: 0.8, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.ruins, step: 240, w: 220, h: 140, baseY: 60, jitterY: 30, color: '#332647', color2: '#1a1230', alpha: 0.9, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.triangle, step: 90, w: 40, h: 70, baseY: 120, jitterY: 16, color: '#7a5fd8', color2: '#c9a6ff', glowColor: '#c9a6ff', glowIntensity: 1.2, alpha: 0.85, rotation: 0, scaleJitter: 0.5 }] } }
    ]
  },
  /* 4. 霜封荒原 —— 雪原 + 冰川 + 松林 */
  frost: {
    name: '霜封荒原',
    layers: [
      { specs: { base: { color: '#bcd8ee', color2: '#eef7ff', shader: 'frostCrystal', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 300, w: 380, h: 150, baseY: -40, jitterY: 20, color: '#cfe4f5', color2: '#8fb4d4', alpha: 0.7, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.hill, step: 240, w: 300, h: 100, baseY: 40, jitterY: 16, color: '#e6f2ff', color2: '#bcd8ee', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.pine, step: 130, w: 140, h: 90, baseY: 90, jitterY: 14, color: '#88a8c0', color2: '#5a7a98', alpha: 0.85, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.pine, step: 100, w: 130, h: 110, baseY: 140, jitterY: 12, color: '#4a6a88', color2: '#2f4a63', alpha: 0.95, scaleJitter: 0.25 }] } }
    ]
  },
  /* 5. 幽森萤火 —— 密林 + 萤火 */
  forest: {
    name: '幽森萤火',
    layers: [
      { specs: { base: { color: '#1d3326', color2: '#08130d', shader: 'gradient', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.forest, step: 240, w: 280, h: 130, jitterY: 60, color: '#2a4a34', color2: '#12241a', alpha: 0.7, scaleJitter: 0.3 }, { shape: SHAPE.fireflies, step: 180, w: 120, h: 90, jitterY: 90, color: '#c8ff9a', color2: '#4a7a3a', glowColor: '#e0ffa0', glowIntensity: 1.0, alpha: 0.65, speed: 1.2, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.tree, step: 190, w: 200, h: 160, baseY: 40, jitterY: 20, color: '#24422e', color2: '#0e1e14', alpha: 0.85, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tree, step: 130, w: 190, h: 210, baseY: 130, jitterY: 16, color: '#152a1c', color2: '#08140d', alpha: 0.95, scaleJitter: 0.25 }] } }
    ]
  },
  /* 6. 熔心forge —— 火山 + 机械 */
  forge: {
    name: '熔心锻炉',
    layers: [
      { specs: { base: { color: '#3a1410', color2: '#160705', shader: 'inferno', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 280, w: 360, h: 170, baseY: -30, jitterY: 20, color: '#5c2418', color2: '#2a0e0a', alpha: 0.8, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tower, step: 220, w: 160, h: 190, baseY: 20, jitterY: 30, color: '#4a2018', color2: '#26100c', alpha: 0.8, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 300, w: 150, h: 90, jitterY: 100, color: '#ff8a3a', color2: '#7a2a12', glowColor: '#ffb060', glowIntensity: 1.1, alpha: 0.6, speed: 1.5, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.mech, step: 200, w: 190, h: 170, baseY: 70, jitterY: 20, color: '#331a12', color2: '#1a0c0a', alpha: 0.9, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.triangle, step: 80, w: 34, h: 54, baseY: 150, jitterY: 14, color: '#ff6a2a', color2: '#ffd0a0', glowColor: '#ff9a4a', glowIntensity: 1.3, alpha: 0.8, scaleJitter: 0.5 }] } }
    ]
  },
  /* 7. 深海幽光 —— 水下 + 鲸 + 水草 */
  abyss: {
    name: '深海幽光',
    layers: [
      { specs: { base: { color: '#0e3a6a', color2: '#03101f', shader: 'caustics', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.whale, step: 700, w: 260, h: 130, jitterY: 120, color: '#1a5a8a', color2: '#0a2a48', alpha: 0.6, speed: 0.7, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 200, w: 130, h: 90, jitterY: 120, color: '#6ad0ff', color2: '#1a4a7a', glowColor: '#9ae6ff', glowIntensity: 0.9, alpha: 0.5, speed: 1.3, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.ruins, step: 300, w: 260, h: 160, baseY: 50, jitterY: 25, color: '#12406b', color2: '#062038', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.forest, step: 200, w: 220, h: 170, baseY: 120, jitterY: 20, color: '#0d3557', color2: '#04182c', alpha: 0.9, scaleJitter: 0.3 }] } }
    ]
  },
  /* 8. 星轨荒星 —— 太空 + 星系 + 巨石 */
  void: {
    name: '星轨荒星',
    layers: [
      { specs: { base: { color: '#120e2a', color2: '#03020a', shader: 'starfield', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.galaxy, step: 520, w: 300, h: 200, jitterY: 160, color: '#7a5fd8', color2: '#2a1a5a', glowColor: '#b9a0ff', glowIntensity: 1.0, alpha: 0.55, speed: 0.5, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 180, w: 140, h: 100, jitterY: 160, color: '#ffffff', color2: '#7a5fd8', glowColor: '#ffffff', glowIntensity: 0.8, alpha: 0.7, speed: 1.6, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 300, w: 340, h: 150, baseY: 40, jitterY: 30, color: '#241a45', color2: '#0e0a20', alpha: 0.85, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.ruins, step: 240, w: 200, h: 150, baseY: 130, jitterY: 20, color: '#161030', color2: '#08061a', alpha: 0.95, scaleJitter: 0.3 }] } }
    ]
  },
  /* 9. 樱吹雪 —— 和风樱花 */
  sakura: {
    name: '樱吹雪',
    layers: [
      { specs: { base: { color: '#e8a8c8', color2: '#f7d8e8', shader: 'cherryBlossom', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 320, w: 400, h: 150, baseY: -20, jitterY: 20, color: '#d490b0', color2: '#9a5f80', alpha: 0.7, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tower, step: 300, w: 150, h: 190, baseY: 60, jitterY: 30, color: '#8f4a6a', color2: '#54293f', alpha: 0.72, scaleJitter: 0.25 }, { shape: SHAPE.cloud, step: 240, w: 150, h: 70, jitterY: 70, color: '#ffe0ee', color2: '#e8a8c8', alpha: 0.6, speed: 0.9, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.tree, step: 180, w: 190, h: 160, baseY: 110, jitterY: 18, color: '#6f3550', color2: '#33182a', alpha: 0.88, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.circle, step: 70, w: 14, h: 14, jitter: 40, jitterY: 200, color: '#ffc0da', color2: '#ff7fb0', alpha: 0.85, speed: 1.8, scaleJitter: 0.6 }] } }
    ]
  },
  /* 10. 霓虹雨巷 —— 赛博都市 */
  neon: {
    name: '霓虹雨巷',
    layers: [
      { specs: { base: { color: '#1a0e2e', color2: '#050210', shader: 'neonRain', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.city, step: 260, w: 320, h: 190, baseY: -20, jitterY: 30, color: '#2e1a4a', color2: '#150a28', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.city, step: 200, w: 280, h: 230, baseY: 60, jitterY: 25, color: '#1e1236', color2: '#0d0620', alpha: 0.85, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 150, w: 90, h: 60, jitterY: 180, color: '#ff4ad0', color2: '#4a2aff', glowColor: '#ff8ae0', glowIntensity: 1.2, alpha: 0.6, speed: 2.0, scaleJitter: 0.6 }] } },
      { specs: { shapes: [{ shape: SHAPE.mech, step: 220, w: 200, h: 200, baseY: 140, jitterY: 20, color: '#140b28', color2: '#080414', alpha: 0.92, scaleJitter: 0.3 }] } }
    ]
  },
  /* 11. 浮空秘境 —— 天空岛 */
  skyland: {
    name: '浮空秘境',
    layers: [
      { specs: { base: { color: '#7fb8f0', color2: '#dcefff', shader: 'cloudscape', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.stars, step: 200, w: 160, h: 100, jitterY: 160, color: '#ffffff', color2: '#a8d0f5', glowColor: '#ffffff', glowIntensity: 0.7, alpha: 0.55, speed: 0.8, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.cloud, step: 260, w: 200, h: 90, jitterY: 120, color: '#ffffff', color2: '#d0e6ff', alpha: 0.6, speed: 1.2, scaleJitter: 0.45 }] } },
      { specs: { shapes: [{ shape: SHAPE.hill, step: 320, w: 320, h: 130, baseY: 20, jitterY: 40, color: '#a8c8e8', color2: '#6f9dd0', alpha: 0.7, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.windmill, step: 400, w: 180, h: 160, baseY: 140, jitterY: 20, color: '#5a7a9a', color2: '#2f4a63', alpha: 0.85, scaleJitter: 0.3 }, { shape: SHAPE.birds, step: 300, w: 70, h: 34, baseY: 40, jitterY: 60, color: '#3a5a7a', alpha: 0.75, speed: 1.0, scaleJitter: 0.4 }] } }
    ]
  },
  /* 12. 古堡回廊 */
  castle: {
    name: '古堡回廊',
    layers: [
      { specs: { base: { color: '#2a2440', color2: '#0a0814', shader: 'moonMist', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.circle, step: 1000, w: 90, h: 90, baseY: -10, color: '#e8eeff', color2: '#8a90c0', glowColor: '#ffffff', glowIntensity: 1.0, alpha: 0.9, speed: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.castle, step: 420, w: 300, h: 190, baseY: 10, jitterY: 20, color: '#4a4268', color2: '#241d3a', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.castle, step: 300, w: 240, h: 220, baseY: 110, jitterY: 20, color: '#332b4d', color2: '#191430', alpha: 0.9, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.wall, step: 200, w: 220, h: 140, baseY: 190, jitterY: 14, color: '#1c1730', color2: '#0b0918', alpha: 0.95, scaleJitter: 0.3 }] } }
    ]
  },
  /* 13. 沙海遗迹 */
  desert: {
    name: '沙海遗迹',
    layers: [
      { specs: { base: { color: '#d9a95c', color2: '#f6dfa8', shader: 'sunsetGlow', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.pyramid, step: 460, w: 300, h: 210, baseY: 30, jitterY: 20, color: '#c08f45', color2: '#8a5f28', alpha: 0.85, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.hill, step: 300, w: 360, h: 130, baseY: 80, jitterY: 20, color: '#d4a558', color2: '#a87c38', alpha: 0.8, scaleJitter: 0.3 }, { shape: SHAPE.birds, step: 500, w: 60, h: 30, baseY: -30, jitterY: 40, color: '#5a4020', alpha: 0.75, speed: 0.8 }] } },
      { specs: { shapes: [{ shape: SHAPE.ruins, step: 240, w: 220, h: 165, baseY: 130, jitterY: 20, color: '#9c7338', color2: '#5f4020', alpha: 0.92, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.fence, step: 180, w: 180, h: 90, baseY: 200, jitterY: 12, color: '#6f5024', color2: '#3d2a12', alpha: 0.95, scaleJitter: 0.3 }] } }
    ]
  },
  /* 14. 极光冰湖 */
  aurora: {
    name: '极光冰湖',
    layers: [
      { specs: { base: { color: '#0e1a3a', color2: '#2a1a4a', shader: 'auroraSilk', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.stars, step: 160, w: 120, h: 90, jitterY: 140, color: '#ffffff', color2: '#7af0d8', glowColor: '#a0ffe8', glowIntensity: 0.9, alpha: 0.7, speed: 1.4, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 320, w: 400, h: 160, baseY: 20, jitterY: 20, color: '#1e2a52', color2: '#0a1024', alpha: 0.8, scaleJitter: 0.25 }] } },
      { specs: { shapes: [{ shape: SHAPE.pine, step: 150, w: 140, h: 100, baseY: 140, jitterY: 14, color: '#14203f', color2: '#080e1e', alpha: 0.9, scaleJitter: 0.3 }] } }
    ]
  },
  /* 15. 蒸汽齿轮城 */
  steampunk: {
    name: '蒸汽齿轮城',
    layers: [
      { specs: { base: { color: '#3a3020', color2: '#141008', shader: 'quantumFoam', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.city, step: 280, w: 320, h: 180, baseY: 0, jitterY: 25, color: '#4a3c26', color2: '#221a10', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tower, step: 240, w: 170, h: 220, baseY: 80, jitterY: 25, color: '#3a2e1e', color2: '#1a140c', alpha: 0.85, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.mech, step: 200, w: 200, h: 200, baseY: 160, jitterY: 18, color: '#261e12', color2: '#100c06', alpha: 0.92, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 240, w: 110, h: 70, jitterY: 200, color: '#ffb44a', color2: '#7a4a12', glowColor: '#ffd080', glowIntensity: 0.9, alpha: 0.55, speed: 1.6, scaleJitter: 0.5 }] } }
    ]
  },
  /* 16. 藤蔓神殿 */
  temple: {
    name: '藤蔓神殿',
    layers: [
      { specs: { base: { color: '#22301f', color2: '#141f14', shader: 'fireflies', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.tower, step: 200, w: 200, h: 210, baseY: -10, jitterY: 30, color: '#3f5440', color2: '#22301f', alpha: 0.85, scaleJitter: 0.3 }, { shape: SHAPE.cloud, step: 260, w: 180, h: 80, jitterY: 130, color: '#4a6a4e', color2: '#2a3f2a', alpha: 0.45, speed: 0.5, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.ruins, step: 170, w: 240, h: 180, baseY: 60, jitterY: 25, color: '#48604a', color2: '#243520', alpha: 0.9, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tree, step: 130, w: 180, h: 170, baseY: 130, jitterY: 18, color: '#33432c', color2: '#16200f', alpha: 0.92, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.circle, step: 110, w: 100, h: 100, baseY: 30, jitterY: 180, color: '#ffe8a0', color2: '#c8a850', glowColor: '#fff0c0', glowIntensity: 1.3, alpha: 0.75, speed: 0.6, scaleJitter: 0.5 }, { shape: SHAPE.stars, step: 130, w: 90, h: 60, jitterY: 220, color: '#a0ffb0', color2: '#2a6a3a', glowColor: '#c0ffc8', glowIntensity: 1.0, alpha: 0.65, speed: 1.5, scaleJitter: 0.6 }] } }
    ]
  },
  /* 17. 暴风雷云 */
  storm: {
    name: '暴风雷云',
    layers: [
      { specs: { base: { color: '#2a3050', color2: '#0a0e1e', shader: 'plasmaField', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.cloud, step: 300, w: 300, h: 130, jitterY: 90, color: '#3a4468', color2: '#1a2038', alpha: 0.7, speed: 1.6, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.cloud, step: 240, w: 260, h: 120, jitterY: 110, color: '#28304e', color2: '#12182c', alpha: 0.8, speed: 1.9, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.mountain, step: 340, w: 400, h: 170, baseY: 90, jitterY: 20, color: '#1a2036', color2: '#080c1a', alpha: 0.9, scaleJitter: 0.25 }] } },
      { specs: { shapes: [{ shape: SHAPE.stars, step: 130, w: 80, h: 60, jitterY: 240, color: '#a0c8ff', color2: '#4a7aff', glowColor: '#d0e6ff', glowIntensity: 1.3, alpha: 0.65, speed: 2.4, scaleJitter: 0.6 }] } }
    ]
  },
  /* 18. 遗忘书房 */
  library: {
    name: '遗忘书房',
    layers: [
      { specs: { base: { color: '#33281c', color2: '#100c06', shader: 'gradient', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.wall, step: 260, w: 320, h: 220, baseY: 0, jitterY: 20, color: '#4a3a26', color2: '#241c12', alpha: 0.72, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.wall, step: 200, w: 280, h: 260, baseY: 100, jitterY: 18, color: '#3a2c1c', color2: '#18120a', alpha: 0.85, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 200, w: 90, h: 60, jitterY: 120, color: '#ffd88a', color2: '#8a6a2a', glowColor: '#ffe8a0', glowIntensity: 1.0, alpha: 0.7, speed: 1.2, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.tree, step: 170, w: 170, h: 180, baseY: 180, jitterY: 16, color: '#241a10', color2: '#0d0905', alpha: 0.9, scaleJitter: 0.3 }] } }
    ]
  },
  /* 19. 虚空齿轮 */
  clockwork: {
    name: '虚空齿轮',
    layers: [
      { specs: { base: { color: '#1a1428', color2: '#06040e', shader: 'voidVortex', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.galaxy, step: 600, w: 280, h: 190, jitterY: 180, color: '#5a3ac0', color2: '#1a0e3a', glowColor: '#9a7aff', glowIntensity: 1.1, alpha: 0.6, speed: 0.6, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.circle, step: 300, w: 130, h: 130, jitterY: 140, color: '#3a2a6a', color2: '#1a1030', glowColor: '#7a5fd8', glowIntensity: 0.8, alpha: 0.6, speed: 0.9, points: 12, scaleJitter: 0.4 }] } },
      { specs: { shapes: [{ shape: SHAPE.mech, step: 240, w: 220, h: 200, baseY: 120, jitterY: 20, color: '#201640', color2: '#0c0820', alpha: 0.9, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.stars, step: 120, w: 60, h: 60, jitterY: 240, color: '#b0a0ff', color2: '#5a4ac0', glowColor: '#d0c8ff', glowIntensity: 1.4, alpha: 0.7, speed: 2.0, scaleJitter: 0.6 }] } }
    ]
  },
  /* 20. 终焉之门 —— 熔金与星穹 */
  finale: {
    name: '终焉之门',
    layers: [
      { specs: { base: { color: '#2a1a14', color2: '#0a0508', shader: 'lavaLamp', alpha: 1 } } },
      { specs: { shapes: [{ shape: SHAPE.galaxy, step: 560, w: 320, h: 210, jitterY: 180, color: '#e0a71f', color2: '#3a1a10', glowColor: '#f7d063', glowIntensity: 1.2, alpha: 0.55, speed: 0.7, scaleJitter: 0.3 }, { shape: SHAPE.stars, step: 160, w: 120, h: 90, jitterY: 200, color: '#ffe8a0', color2: '#8a5a1a', glowColor: '#fff0b0', glowIntensity: 1.0, alpha: 0.7, speed: 1.5, scaleJitter: 0.5 }] } },
      { specs: { shapes: [{ shape: SHAPE.castle, step: 380, w: 300, h: 200, baseY: 10, jitterY: 20, color: '#4a2c18', color2: '#241208', alpha: 0.75, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.dragon, step: 700, w: 280, h: 200, jitterY: 160, color: '#3a1e10', color2: '#1a0a06', alpha: 0.8, speed: 0.6, scaleJitter: 0.3 }] } },
      { specs: { shapes: [{ shape: SHAPE.tower, step: 260, w: 200, h: 240, baseY: 180, jitterY: 18, color: '#1c0e08', color2: '#0a0503', alpha: 0.95, scaleJitter: 0.3 }, { shape: SHAPE.triangle, step: 70, w: 30, h: 48, baseY: 260, jitterY: 12, color: '#ffb84a', color2: '#ffd880', glowColor: '#ffd06a', glowIntensity: 1.4, alpha: 0.8, scaleJitter: 0.5 }] } }
    ]
  }
};

/* 构建 background 数组 */
function buildBackgrounds(themeKey, bounds, seed) {
  const th = THEMES[themeKey];
  if (!th) throw new Error('未知主题 ' + themeKey);
  const out = [];
  const maxLayer = th.layers.length - 1;
  th.layers.forEach((L, i) => {
    const chamberId = 'bc' + i;
    /* 每个 layer 自己一个画布（尺寸给足，形状按需铺） */
    const padX = (1 - (maxLayer > 0 ? i / maxLayer : 1)) * 900 + 600;
    const canvas = {
      id: chamberId,
      x: (bounds.x0 * 8) - padX,
      y: (bounds.y0 * 8) - 2000,
      w: ((bounds.x1 - bounds.x0) * 8) + padX * 2,
      h: ((bounds.y1 - bounds.y0) * 8) + 4000
    };
    out.push({
      id: 'bg' + i,
      layer: i,
      chambers: [canvas],
      shapes: tile(i, maxLayer, {
        chamberId,
        bounds: { x0: bounds.x0 * 8, x1: bounds.x1 * 8, y0: bounds.y0 * 8, y1: bounds.y1 * 8 },
        seed: (seed || 1) * 7919 + i * 104729,
        base: L.specs.base,
        shapes: L.specs.shapes
      })
    });
  });
  return out;
}

const THEME_KEYS = Object.keys(THEMES);

module.exports = { THEMES, THEME_KEYS, buildBackgrounds, tile, SHAPE, mulberry };

});

/* ===== lib.cjs ===== */
__def("lib", function (module, exports, require, __name) {
'use strict';
/* ============================================================================
 * lib.cjs —— 关卡构造核心库
 *  · 全部以「格(tile)」为单位，1 格 = 8px（与编辑器网格一致）
 *  · 箱庭(chamber) 既是可活动区（离开即死），也是摄像机边界
 *  · 自动把行动空间切成 200x88 的箱庭网格 → 箱庭数量可控
 * ==========================================================================*/

const T = 8;
const CH_W = 25;   /* 200px / 8 */
const CH_H = 11;   /* 88px / 8  */

const FEEL = {
  maxWalkSpeed: 1.85, groundAccel: 0.3, airAccel: 0.4, stopFriction: 0.79,
  jumpMinHeight: 4, jumpMaxHeight: 8, jumpMaxHoldTime: 0.4, gravity: 0.76,
  maxFallSpeed: 4, coyoteTime: 0.5, jumpBufferTime: 0.35, edgeSnapDist: 1
};
const CAM = {
  deadZoneXLeft: 0.30, deadZoneXRight: 0.70, deadZoneYTop: 0.32,
  deadZoneYBottom: 0.68, viewW: 300, viewH: 100
};

/* ------------------------------- 关卡类 ------------------------------- */
class Lv {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.elements = [];
    this.spaces = [];      /* 行动空间 [x,y,w,h] tile，用于生成箱庭 */
    this.bg = [];
    this.lives = 3;
    this.flags = 0;
    this.notes = '';
    this._cg = {};         /* 计数器 */
  }

  /* ---- 行动空间 ---- */
  space(x, y, w, h) { this.spaces.push([x, y, w, h]); return this; }
  /* 房间快捷：给一块行动区 + 地板 + 天花板 */
  room(x, y, w, h, opt = {}) {
    this.space(x, y, w, h);
    if (opt.floor !== false) this.plat(x, y + h - 1, w, 1);
    if (opt.ceil) this.plat(x, y, w, 1);
    if (opt.wallL) this.plat(x, y, 1, h);
    if (opt.wallR) this.plat(x + w - 1, y, 1, h);
    return this;
  }

  /* ---- 通用元素 ---- */
  add(o) { this.elements.push(o); return this; }
  _n(k) { this._cg[k] = (this._cg[k] || 0) + 1; return this._cg[k]; }

  plat(x, y, w, h = 1, extra) {
    return this.add(Object.assign({ type: 'platform', x: x * T, y: y * T, w: w * T, h: h * T }, extra));
  }
  spike(x, y, w = 1, h = 1) {
    return this.add({ type: 'spike', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  spikeUp(x, y, w = 1) { return this.spike(x, y, w, 1); }
  spikeDown(x, y, w = 1) { return this.spike(x, y, w, 1); }
  fallingSpike(x, y, extra) {
    return this.add(Object.assign({ type: 'fallingSpike', x: x * T, y: y * T, w: 12, h: 10 }, extra));
  }
  laser(x, y, dir) {
    return this.add({ type: 'laser' + dir, x: x * T, y: y * T, w: 6, h: 6, dir: dir.toLowerCase() });
  }
  movable(x, y, w = 1, h = 1) {
    return this.add({ type: 'movable', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  breakable(x, y, w = 1, h = 1) {
    return this.add({ type: 'breakable', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  flammable(x, y, w = 1, h = 1, burnTime = 1.5) {
    return this.add({ type: 'flammable', x: x * T, y: y * T, w: w * T, h: h * T, burnTime });
  }
  ice(x, y, w = 2, h = 1) {
    return this.add({ type: 'ice', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  water(x, y, w, h) {
    return this.add({ type: 'water', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  smoke(x, y, w, h) {
    return this.add({ type: 'smoke', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  gravityFlip(x, y, w, h) {
    return this.add({ type: 'gravityFlip', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  disappear(x, y, w = 3, h = 1, on = 1.5, off = 1.0, phase = 0) {
    return this.add({ type: 'disappear', x: x * T, y: y * T, w: w * T, h: h * T, onTime: on, offTime: off, phase });
  }
  plate(x, y, need = 1, targetId = '', w = 4) {
    return this.add({ type: 'plate', x: x * T, y: y * T, w: w * T, h: 4, need, targetId });
  }
  door(x, y, id, w = 1, h = 5, orientation = 'v') {
    return this.add({ type: 'door', x: x * T, y: y * T, w: w * T, h: h * T, id, orientation });
  }
  switchTog(x, y, tags, w = 2) {
    return this.add({ type: 'switch', x: x * T, y: y * T, w: w * T, h: 4, tags });
  }
  switchDoor(x, y, tags, w = 1, h = 5, initialOpen = false, orientation = 'v') {
    return this.add({ type: 'switchDoor', x: x * T, y: y * T, w: w * T, h: h * T, tags, initialOpen, orientation });
  }
  spawn(x, y) { this._spawn = { x: x * T, y: y * T }; return this; }
  goal(x, y, w = 4, h = 6) {
    return this.add({ type: 'goal', x: x * T, y: y * T, w: w * T, h: h * T });
  }
  flag(x, y) { return this.add({ type: 'flagPickup', x: x * T, y: y * T, w: 8, h: 8 }); }
  heart(x, y) { return this.add({ type: 'heart', x: x * T, y: y * T, w: 8, h: 8 }); }
  trophy(x, y, id) {
    return this.add({ type: 'trophy', x: x * T, y: y * T, w: 12, h: 14, id });
  }
  label(x, y, text, color = '#e8f1ff', radius = 30, dy = -28) {
    return this.add({
      type: 'label', x: x * T, y: y * T, w: 8, h: 8, text,
      fontSize: 10, color, triggerRadius: radius, fadeSpeed: 1.5,
      textOffsetX: 0, textOffsetY: dy, pixelSize: 0.5
    });
  }
  lamp(x, y, h = 4) { return this.add({ type: 'lamp', x: x * T, y: y * T, w: 8, h: h * T }); }
  vine(x, y, h = 5, color = '#88ddaa') {
    return this.add({ type: 'vine', x: x * T, y: y * T, w: 3, h: h * T, color, segments: 8 });
  }
  waterGrass(x, y, h = 2, color = '#44bb88') {
    return this.add({ type: 'waterGrass', x: x * T, y: y * T, w: 8, h: h * T, color, segments: 12 });
  }

  /* ---- 背景 ---- */
  bgLayer(layer, shapes, id) {
    this.bg.push({
      id: id || ('bg' + layer),
      layer,
      chambers: [{ id: 'bc' + layer, x: -4000, y: -4000, w: 16000, h: 8000 }],
      shapes: shapes.map(s => Object.assign({
        type: 'bgShape', chamberId: 'bc' + layer,
        shader: 'solid', color: '#331166', color2: '#0a0e1a',
        glowColor: '#ffffff', glowIntensity: 0, alpha: 0.85,
        rotation: 0, points: 6, speed: 0
      }, s))
    });
    return this;
  }

  /* ---- 生成箱庭网格 ---- */
  _chambers() {
    const set = new Set();
    const out = [];
    for (const [x, y, w, h] of this.spaces) {
      const gx0 = Math.floor(x / CH_W), gx1 = Math.ceil((x + w) / CH_W) - 1;
      const gy0 = Math.floor(y / CH_H), gy1 = Math.ceil((y + h) / CH_H) - 1;
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = gx + ',' + gy;
          if (set.has(k)) continue;
          set.add(k);
          out.push({ id: 'c' + out.length, x: gx * CH_W * T, y: gy * CH_H * T, w: CH_W * T, h: CH_H * T });
        }
      }
    }
    out.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    out.forEach((c, i) => { c.id = 'c' + i; });
    return out;
  }

  /* ---- 包围盒（tile） ---- */
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, w, h] of this.spaces) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 50; y1 = 30; }
    return { x0, y0, x1, y1 };
  }

  toJSON() {
    const els = this.elements.slice();
    if (this._spawn) els.unshift({ type: 'spawn', x: this._spawn.x, y: this._spawn.y, w: 8, h: 8 });
    return {
      id: this.id,
      name: this.name,
      chambers: this._chambers(),
      elements: els,
      initialLives: this.lives,
      initialFlags: this.flags,
      feel: Object.assign({}, FEEL),
      camera: Object.assign({}, CAM),
      backgrounds: this.bg
    };
  }
}

module.exports = { Lv, T, CH_W, CH_H, FEEL, CAM };

});

/* ===== ascii.cjs ===== */
__def("ascii", function (module, exports, require, __name) {
'use strict';
/* ============================================================================
 * ascii.cjs —— ASCII 地图 → 关卡元素 编译器
 *
 *  为什么用 ASCII：手工设计的房间可以精确控制每一格，
 *  从根本上杜绝「方块穿模 / 水草长在陆地上 / 藤蔓悬空 / 谜题重复」。
 *
 *  图例（每个字符 = 1 格 = 8px）
 *    #  实心墙/地板           .  空气
 *    =  薄平台（1 格厚）        ^  地刺（铺在该格）
 *    ,  顶刺（倒挂）            /  落刺
 *    o  压力板 need=1          O  压力板 need=2
 *    H  竖向门                 -  横向门
 *    ~  水                      i  冰面
 *    m  可移动方块              b  易碎方块
 *    f  易燃方块                *  消失台
 *    g  反重力区                R/L/U/W  激光 右/左/上/下
 *    x  浓烟（遮蔽视线；已释放幽灵会在烟里开出一个可视圆）
 *    l  灯柱（须立在地面）      v  藤蔓（须挂在天花/平台下）
 *    w  水草（须长在水中）      T  奖杯   h  心   y  旗帜拾取
 *    P  出生点                  G  终点
 * ==========================================================================*/

const T = 8;

function mkEl(type, x, y, w, h, extra) {
  return Object.assign({ type, x: x * T, y: y * T, w: w * T, h: h * T }, extra || {});
}

/**
 * 编译一个 ASCII 房间
 * @param {string[]} rows
 * @param {object} opt
 *   ox, oy    偏移（格）
 *   doors     {'H':{id,orientation}} 门 id 映射；同名只在首次出现处生成
 *   plates    {'o':{need,targetId,w}, 'O':{...}}
 *   gates     [{x,y,w,dir,id,need,doorSpan}] 幽灵闸门：展开为 旗→板→门
 *   noDeco    关闭自动装饰
 *   seed      装饰随机种子
 *   phase     消失台相位
 */
function compile(rows, opt = {}) {
  const ox = opt.ox || 0, oy = opt.oy || 0;
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const els = [];
  const marks = {};
  const doorSeen = new Set();

  const get = (x, y) => (y < 0 || y >= h || x < 0 || x >= w) ? '#' : (rows[y][x] || '.');

  /* ---- 实心块：横条 + 竖向合并 ---- */
  const bars = [];
  for (let y = 0; y < h; y++) {
    let run = null;
    for (let x = 0; x <= w; x++) {
      const c = x < w ? get(x, y) : '.';
      if (c === '#') { if (run === null) run = x; }
      else { if (run !== null) { bars.push({ x: run, y, w: x - run, h: 1 }); run = null; } }
    }
  }
  const solids = mergeRects(bars);

  /* ---- 薄平台：横向合并成整条（减少元素数、渲染更干净） ---- */
  const platRuns = [];
  for (let y = 0; y < h; y++) {
    let run = null;
    for (let x = 0; x <= w; x++) {
      const c = x < w ? get(x, y) : '.';
      if (c === '=') { if (run === null) run = x; }
      else { if (run !== null) { platRuns.push({ x: run, y, w: x - run }); run = null; } }
    }
  }
  for (const p of platRuns) els.push(mkEl('platform', ox + p.x, oy + p.y, p.w, 1));

  /* ---- 逐格元素 ---- */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = get(x, y);
      const X = ox + x, Y = oy + y;
      switch (c) {
        case '#': case '.': case '=': break;
        case '^': case ',': els.push(mkEl('spike', X, Y, 1, 1)); break;
        case '/': els.push(mkEl('fallingSpike', X, Y, 1, 1)); break;
        case 'o': {
          const cf = (opt.plates && opt.plates.o) || { need: 1, targetId: 'A' };
          els.push(mkEl('plate', X, Y, cf.w || 2, 0.5, { need: cf.need || 1, targetId: cf.targetId || 'A' }));
          break;
        }
        case 'O': {
          const cf = (opt.plates && opt.plates.O) || { need: 2, targetId: 'B' };
          els.push(mkEl('plate', X, Y, cf.w || 2, 0.5, { need: cf.need || 2, targetId: cf.targetId || 'B' }));
          break;
        }
        case 'H': {
          if (doorSeen.has('H' + x)) break;
          doorSeen.add('H' + x);
          let top = Y, bot = Y;
          while (top - 1 > oy && get(x, top - oy - 1) !== '#') top--;
          while (bot + 1 < oy + h && get(x, bot - oy + 1) !== '#') bot++;
          els.push(mkEl('door', X, top, 1, bot - top + 1, { id: opt.doorId || 'A', orientation: 'v' }));
          break;
        }
        case 'D': {
          /* 水平门：只覆盖**连续的 'D'**（精确 2 格宽，不向外扩张）。
             去重键用「行 + 连续段起点」——否则一段 2 格 'D' 会被推两次。 */
          let l = X, r = X;
          while (l - 1 > ox && get(l - ox - 1, y) === 'D') l--;
          while (r + 1 < ox + w && get(r - ox + 1, y) === 'D') r++;
          if (r > l && !doorSeen.has('D' + y + ':' + l)) {
            doorSeen.add('D' + y + ':' + l);
            els.push(mkEl('door', l, Y, r - l + 1, 1, { id: opt.doorId || 'A', orientation: 'h' }));
          }
          break;
        }
        case 's': {
          /* 踩踏开关（tags 由 opt.switchTags 注入；'S' 是与它配对的开关门） */
          els.push(mkEl('switch', X, Y, 2, 0.5, { tags: opt.switchTags || '' }));
          break;
        }
        case 'S': {
          /* ★开关门（switchDoor）★
             由同 tags 的 's' 踩踏开关翻转 open。
             注意：'{'H' 竖向门+压力板' 和 'S 开关门+踩踏开关' 是两套独立机制，
             压力板每帧无条件 `d.open=plate.active`，而开关门只由开关的**边沿**翻转。 */
          if (doorSeen.has('S' + x)) break;
          doorSeen.add('S' + x);
          let top = Y, bot = Y;
          while (top - 1 > oy && get(x, top - oy - 1) !== '#') top--;
          while (bot + 1 < oy + h && get(x, bot - oy + 1) !== '#') bot++;
          els.push(mkEl('switchDoor', X, top, 1, bot - top + 1,
            { id: opt.doorId || 'A', orientation: 'v', tags: opt.switchTags || '' }));
          break;
        }
        case '-': {
          if (doorSeen.has('-' + y)) break;
          doorSeen.add('-' + y);
          let l = X, r = X;
          while (l - 1 > ox && get(l - ox - 1, y) !== '#') l--;
          while (r + 1 < ox + w && get(r - ox + 1, y) !== '#') r++;
          els.push(mkEl('door', l, Y, r - l + 1, 1, { id: 'A', orientation: 'h' }));
          break;
        }
        case '~': els.push(mkEl('water', X, Y, 1, 1)); break;
        case 'i': els.push(mkEl('ice', X, Y, 1, 1)); break;
        case 'm': els.push(mkEl('movable', X, Y, 1, 1)); break;
        case 'b': els.push(mkEl('breakable', X, Y, 1, 1)); break;
        case 'f': els.push(mkEl('flammable', X, Y, 1, 1, { burnTime: 1.5 })); break;
        case '*': els.push(mkEl('disappear', X, Y, 1, 1, { onTime: 1.5, offTime: 1.0, phase: opt.phase || 0 })); break;
        case 'g': els.push(mkEl('gravityFlip', X, Y, 1, 1)); break;
        /* 浓烟：纯遮蔽视线的环境元素（无碰撞）。
           **整行连续 'x' 合并成一整块**，这样一「条」烟就是一条宽雾带，
           而不是一格一格的小方块（渲染出来才有雾堤的感觉）。
           ★ 幽灵第五用 ★：引擎渲染烟雾时用 destination-out 在**已释放幽灵**
             周围挖一个 44px 的可视圆（runtime.js:5370-5390）。
             ⇒ 浓烟遮住的地形，只能靠放出幽灵来「看见」。
             这是纯感知层机制，不影响物理，也不影响可解性证明。 */
        case 'x': {
          const run = marks._smokeRun;
          if (run && run.y === Y && run.x1 === X - 1) {
            run.x1 = X;
            els[run.idx].w = (run.x1 - run.x0 + 1) * T;
          } else {
            marks._smokeRun = { y: Y, x0: X, x1: X, idx: els.length };
            els.push(mkEl('smoke', X, Y, 1, 1));
          }
          break;
        }
        case 'R': els.push(mkEl('laserRight', X, Y, 0.75, 0.75, { dir: 'right' })); break;
        case 'L': els.push(mkEl('laserLeft', X, Y, 0.75, 0.75, { dir: 'left' })); break;
        case 'U': els.push(mkEl('laserUp', X, Y, 0.75, 0.75, { dir: 'up' })); break;
        case 'W': els.push(mkEl('laserDown', X, Y, 0.75, 0.75, { dir: 'down' })); break;
        case 'v': els.push(mkEl('vine', X, Y, 1, 1, { color: opt.vineColor || '#88ddaa', segments: 8 })); break;        case 'w': els.push(mkEl('waterGrass', X, Y, 1, 1, { color: opt.grassColor || '#44bb88', segments: 10 })); break;
        case 'l': els.push(mkEl('lamp', X, Y, 1, 3)); break;
        case 'P': marks.spawn = { x: X, y: Y }; break;
        case 'G': marks.goal = { x: X, y: Y }; break;
        case 'h': els.push(mkEl('heart', X, Y, 1, 1)); break;
        case 'y': els.push(mkEl('flagPickup', X, Y, 1, 1)); break;
        case 'T': els.push(mkEl('trophy', X, Y, 1, 1, { id: opt.trophyId || '' })); break;
        default: break;
      }
    }
  }

  for (const m of solids) els.push(mkEl('platform', ox + m.x, oy + m.y, m.w, m.h));

  /* ---- 幽灵闸门：旗(入口侧) → 压力板 → 门(出口侧) ---- */
  if (opt.gates) {
    opt.gates.forEach((g, gi) => {
      const dir = g.dir || 1;
      const id = g.id || ('G' + gi);
      const base = oy + g.y, s0 = ox + g.x;
      const span = g.span || g.w;
      const flagX = s0 + (dir > 0 ? 2 : span - 3);
      const plateW = Math.min(4, Math.max(2, Math.round(span * 0.22)));
      const plateX = s0 + Math.max(4, Math.min(span - plateW - 4, Math.round(span * 0.44)));
      const doorX = s0 + (dir > 0 ? span - 2 : 1);
      els.push(mkEl('flagPickup', flagX, base - 1, 1, 1));
      els.push(mkEl('plate', plateX, base, plateW, 0.5, { need: g.need || 1, targetId: id }));
      els.push(mkEl('door', doorX, base - (g.doorSpan || 6), 1, g.doorSpan || 6, { id, orientation: 'v' }));
      els.push(mkEl('lamp', doorX + (dir > 0 ? -1 : 1), base - 1, 1, 4));
      els.push(mkEl('lamp', plateX + (dir > 0 ? -1 : 1), base - 1, 1, 3));
    });
  }

  if (!opt.noDeco) autoDeco(rows, els, ox, oy, opt);
  return { elements: els, marks, w, h };
}

function mergeRects(rects) {
  const used = new Array(rects.length).fill(false);
  const byKey = new Map();
  rects.forEach((r, i) => byKey.set(r.x + ':' + r.w + ':' + r.y, i));
  const out = [];
  rects.forEach((r, i) => {
    if (used[i]) return;
    let hh = 1, cur = r;
    while (true) {
      const j = byKey.get(cur.x + ':' + cur.w + ':' + (cur.y + hh));
      if (j === undefined || used[j]) break;
      used[j] = true; hh++;
    }
    out.push({ x: r.x, y: r.y, w: r.w, h: hh });
  });
  return out;
}

const SOLIDSET = new Set(['#', '=', 'i', 'b', 'm', 'f']);

/* 智能装饰：只在有正确支撑的地方放藤蔓/水草/灯，杜绝穿模
   规则（修复"水草长在陆地上""树枝悬空摇摆"）：
     · 水草：**只在水里**（本体或紧邻上下是水），且根部有支撑 → 长度 2 格
     · 藤蔓：**只挂在天花/平台下方**，长度 = 到下方最近实心体的距离（限 1..5 格），
             保证不插进地面/平台
     · 灯柱：只立在实心地表（非水面），且上方 3 格无遮挡
     · 地表草：只放在实心地表且**不在水中** */
function autoDeco(rows, els, ox, oy, opt) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const at = (x, y) => (y < 0 || y >= h || x < 0 || x >= w) ? '#' : (rows[y][x] || '.');
  const isSolid = (x, y) => SOLIDSET.has(at(x, y));
  const isWater = (x, y) => at(x, y) === '~';
  /* 水面判定：该格是空气，且同列上下 1 格内有水 */
  const nearWater = (x, y) => isWater(x, y + 1) || isWater(x, y - 1) || isWater(x, y);

  let seed = (opt.seed || 1) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  /* 到下方最近实心体的距离（用于藤蔓长度，防穿模） */
  const distDown = (x, y, cap) => {
    for (let d = 1; d <= cap; d++) if (isSolid(x, y + d)) return d - 1;
    return cap;
  };

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (at(x, y) !== '.') continue;
      const belowSolid = isSolid(x, y + 1);
      const aboveSolid = isSolid(x, y - 1);
      const inOrNearWater = nearWater(x, y);

      /* --- 水下 / 水边：水草（必须在水里） --- */
      if (inOrNearWater && (belowSolid || isWater(x, y + 1) || isWater(x, y))) {
        const waterBelow = isWater(x, y + 1) || isWater(x, y + 2);
        const rootOk = isSolid(x, y + 1) || isWater(x, y + 1);
        if (rootOk && rnd() < 0.16) {
          /* 高度 2 格（16px），在水体内部向上生长 */
          els.push(mkEl('waterGrass', ox + x, oy + y - 1, 1, 2, { color: opt.grassColor || '#44bb88', segments: 10 }));
        }
        continue;
      }

      /* --- 实心地表：灯柱 / 地表草（均不在水中） --- */
      if (belowSolid) {
        const r = rnd();
        if (r < 0.035 && !isSolid(x, y - 1) && !isSolid(x, y - 2) && !isSolid(x, y - 3)) {
          els.push(mkEl('lamp', ox + x, oy + y, 1, 3));
        } else if (r < 0.09 && !isSolid(x, y - 1)) {
          els.push(mkEl('waterGrass', ox + x, oy + y - 1, 1, 2, { color: opt.grassColor || '#44bb88', segments: 10 }));
        }
        continue;
      }

      /* --- 悬空：藤蔓（必须挂在天花/平台下方，长度自适应） --- */
      if (aboveSolid && rnd() < 0.12) {
        const d = distDown(x, y, 5);
        const len = Math.max(1, Math.min(5, d));
        if (len >= 1) {
          els.push(mkEl('vine', ox + x, oy + y, 1, len, { color: opt.vineColor || '#88ddaa', segments: 4 + len }));
        }
      }
    }
  }
}

module.exports = { compile, T };

});

/* ===== deco.cjs ===== */
__def("deco", function (module, exports, require, __name) {
/* deco.cjs —— 装饰物的**落位校正**（彻底修复「路灯悬空 / 埋进地里」）
 *
 *  drawLampTo 的绘制约定（runtime.js:3070-3120）：
 *    · 灯头/灯芯 在元素顶部 y+6..y+9
 *    · 灯柱      从 y+8 向下画到 y+h
 *    · 灯座      在 y+h-2 .. y+h（元素**底部**）
 *  ⇒ 「灯座贴地」= 元素底部所在行 = 地面行
 *  ⇒ 若灯高 3 格，则元素顶部行 Y 必须满足  Y + 3 === 地面行
 *
 *  历史上所有调用点都差了 2~3 行（把灯放在地面上方一格、高度 3 → 底部埋进地面 2 行），
 *  这就是用户看到的「路灯悬空 / 插进土里」。
 *
 *  本模块提供 fixLamps()：先删掉全部灯，再按上面这条唯一正确规则重新落位。
 *  规则：
 *    1) 遍历每个候选列，自上而下找「地面」= 该格实心、正上方 4 格全是空气
 *    2) 灯放在 groundRow-3 行（高 3 格），保证底部严丝合缝落在地面
 *    3) 水面列不放灯；灯与灯之间至少间隔 7 列（不扎堆）
 *    4) 同一关内保持稀疏（每 N 列最多 1 盏），作为环境叙事的路标
 */
'use strict';
const T = 8;
const LAMP_H = 3;          /* 格 */

const SOLID_TYPES = new Set(['platform', 'ice', 'movable', 'breakable', 'flammable']);

function buildSolidSet(elements) {
  const s = new Set();
  for (const e of elements) {
    if (!SOLID_TYPES.has(e.type)) continue;
    const w = Math.max(1, Math.round((e.w || 8) / T)), h = Math.max(1, Math.round((e.h || 8) / T));
    const a = Math.round(e.x / T), b = Math.round(e.y / T);
    for (let y = b; y < b + h; y++) for (let x = a; x < a + w; x++) s.add(x + ',' + y);
  }
  return s;
}

function buildWaterSet(elements) {
  const s = new Set();
  for (const e of elements) {
    if (e.type !== 'water') continue;
    const w = Math.max(1, Math.round((e.w || 8) / T)), h = Math.max(1, Math.round((e.h || 8) / T));
    const a = Math.round(e.x / T), b = Math.round(e.y / T);
    for (let y = b; y < b + h; y++) for (let x = a; x < a + w; x++) s.add(x + ',' + y);
  }
  return s;
}

/* 找出所有「合法灯位」：返回 [{cx, cy}]，cy 是灯元素顶部行 */
function findLampSpots(elements, opts = {}) {
  const solid = buildSolidSet(elements);
  const water = buildWaterSet(elements);
  const minGap = opts.minGap || 9;
  const headClear = opts.headClear || 4;    /* 灯头上方需净空的行数 */
  const minX = opts.minX !== undefined ? opts.minX : -1e9;
  const maxX = opts.maxX !== undefined ? opts.maxX : 1e9;
  const avoid = opts.avoid || [];           /* [{x,y,r}] 需要避开的点（出生点/终点/旗） */
  const spots = [];
  let lastX = -1e9;
  /* 收集所有实心格的 x 范围 */
  const byX = new Map();
  for (const k of solid) {
    const [x, y] = k.split(',').map(Number);
    if (!byX.has(x)) byX.set(x, []);
    byX.get(x).push(y);
  }
  const cols = [...byX.keys()].sort((a, b) => a - b);
  for (const cx of cols) {
    if (cx < minX || cx > maxX) continue;
    if (cx - lastX < minGap) continue;
    const ys = byX.get(cx).sort((a, b) => a - b);
    /* 候选地面：该格实心，且上方 headClear 行都是空气、且不是水 */
    let chosen = null;
    for (const gy of ys) {
      if (gy < 3) continue;
      let ok = true;
      for (let d = 1; d <= headClear + LAMP_H; d++) {
        if (solid.has(cx + ',' + (gy - d))) { ok = false; break; }
        if (water.has(cx + ',' + (gy - d))) { ok = false; break; }
      }
      if (!ok) continue;
      /* 避免离出生点/终点太近 */
      let near = false;
      for (const a of avoid) {
        if (Math.abs(a.x - cx) <= (a.r || 2) && Math.abs(a.y - gy) <= (a.r || 2) + 2) { near = true; break; }
      }
      if (near) continue;
      chosen = gy;
      break;                        /* 取最上面那个可站地面（视觉上更像路灯沿街） */
    }
    if (chosen === null) continue;
    spots.push({ cx, cy: chosen - LAMP_H, groundRow: chosen });
    lastX = cx;
  }
  return spots;
}

/* 删掉全部灯，再按正确规则重放 */
function fixLamps(elements, opts = {}) {
  const kept = elements.filter(e => e.type !== 'lamp');
  const spots = findLampSpots(kept, opts);
  for (const s of spots) {
    kept.push({ type: 'lamp', x: s.cx * T, y: s.cy * T, w: T, h: LAMP_H * T });
  }
  return { elements: kept, lamps: spots.length };
}

module.exports = { fixLamps, findLampSpots, buildSolidSet, LAMP_H };

});

/* ===== world50.cjs ===== */
__def("world50", function (module, exports, require, __name) {
/* world50.cjs —— 50 关生成器（**可证连通的门到门拼块架构**）
 *
 *  ▍为什么是这个架构
 *  本项目实测过一个硬事实：把「自由生长的房间」交给「会任意挖坑/立柱/垂天花」的
 *  画笔去填，得到的关卡在真实物理下有 85% 不可通行（几何可达 ≠ 物理可达）。
 *  纯骨架 100% 可通，一旦放任画笔自由布置地形就只有 ~15% 可通。
 *
 *  所以本版改成：**关卡 = 一串「门到门拼块」**。
 *    · 拼块（tile）是一块 25×11 的 ASCII，左墙 0 列与右墙 24 列在相对行 7..9 开着
 *      「门洞」，地板（行 10）与天花板（行 0）恒为实心。
 *    · 每个拼块的语义是：**从左侧门洞进来，能从右侧门洞出去**。
 *    · 一串拼块首尾相接（共享 2 列厚的墙，门洞对齐）⇒ 整条主线由传递性保证连通。
 *    · 纵向连接另有「竖井拼块」：在相邻上下两个箱庭之间挖一条 5 宽、踏台每 4 行
 *      左右交错的井道（几何与已验证的 ladder 原子件完全一致）。
 *
 *  ▍验证
 *  最终仍然用 plan2（连续状态跳跃规划器，底层物理与 runtime.js 逐帧 0 误差对拍）
 *  对**整关**再跑一遍，把「可通」从"构造上应该没问题"升级为"机器实际走通过"。
 *
 *  ▍机制阶梯（越后期解锁）
 *    T1 平地 / 消失台 / 尖刺                 idx 0+
 *    T2 缺口 / 台阶 / 平台链                  idx 3+
 *    T3 贴地低通道（隐形知识锁）/ 竖井 / 高塔   idx 8+
 *    T4 水 / 冰 / 荆棘 / 顶刺                   idx 14+
 *    T5 激光 / 下落刺 / 反重力                 idx 24+
 *    T6 幽灵门（旗→压力板→门）                 idx 11+
 */
'use strict';

const T = 8;
const CW = 25, CH = 11;          /* 拼块尺寸（格） */
const DOOR0 = CH - 6, DOOR1 = CH - 2;   /* 门洞相对行 5..9（5 格高，通行宽松） */

/* ============================================================ 随机 */
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/* ============================================================ 拼块基座 */
function base(g, ox, oy) {
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) g[oy + y][ox + x] = '.';
  for (let x = 0; x < CW; x++) { g[oy + 0][ox + x] = '#'; g[oy + CH - 1][ox + x] = '#'; }
  for (let y = 0; y < CH; y++) { g[oy + y][ox + 0] = '#'; g[oy + y][ox + CW - 1] = '#'; }
  for (let y = DOOR0; y <= DOOR1; y++) { g[oy + y][ox + 0] = '.'; g[oy + y][ox + CW - 1] = '.'; }
}
const W = (g, ox, oy, x, y, c) => { g[oy + y][ox + x] = c; };
const WH = (g, ox, oy, y, x0, x1, c) => { for (let x = x0; x <= x1; x++) g[oy + y][ox + x] = c; };
const WV = (g, ox, oy, x, y0, y1, c) => { for (let y = y0; y <= y1; y++) g[oy + y][ox + x] = c; };
const WR = (g, ox, oy, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[oy + y + j][ox + x + i] = c; };
/* 抬高地面（升 lift 格） */
function lift(g, ox, oy, x0, x1, n) {
  for (let x = x0; x <= x1; x++) for (let y = CH - 1 - n; y <= CH - 1; y++) g[oy + y][ox + x] = '#';
}
/* 挖穿地面的坑（深 d，宽 w）—— 掉下去会离开箱庭 → 死 */
function pit(g, ox, oy, x, w, d) {
  for (let k = 0; k < w; k++) for (let y = CH - 1; y > CH - 1 - d; y--) g[oy + y][ox + x + k] = '.';
}

/* ============================================================ 拼块库
 *  签名 (g, r, ox, oy, o)   o = { idx, n }（idx = 关卡序号，n = 拼块在主线里的位置）
 *  每个拼块必须在「左右门洞之间」留一条可走的路径。 */
const TILES = {};
const ORDER = [];
function reg(name, tier, fn) { TILES[name] = { tier, fn }; ORDER.push(name); }

/* --- T1 --- */
reg('flat', 0, (g, r, ox, oy) => { base(g, ox, oy); });
/* 「幽灵门厅」——唯一带机制的知识锁拼块。**按门的朝向镜像**，有两套：
     · 地面通道（底座地板）完全畅通 —— 幽灵/玩家都不堵路
     · **架空壁台**（压板）放在**入口侧**，rel 行 7、实心 5 格、离地 3 格
     · **通高门**放在**出口侧**，把「入口 → 出口」的路彻底堵死
     · 箱庭内部除壁台外一律清空（杜绝相邻拼块/竖井残留干扰）
     · 壁台上**入口端**放旗、**出口端**放一根尖刺（= 幽灵门的"自杀点"）

   方向规则（由 order 的 prev/next 唯一确定）：
     出口 = 右(x24) ⇒ 门在 rel x17、壁台在 rel x3..7   （入口从左或从上方）
     出口 = 左(x0)  ⇒ 门在 rel x7 、壁台在 rel x17..21 （入口从右或从上方）
   这样保证「压板在门的入口一侧、门在出口之前」，玩家**必须**先插旗自杀
   用幽灵永驻压板才能过门 —— 这道门无法靠跳/钻绕过。

   ★ 为什么自杀点必须是**尖刺**而不是按 K ★（这是本关卡的隐形知识锁）
     · 按 K（doSuicidePlay）会置 `_dyingBySuicide=true` → 幽灵 **hasExplosion=true**
       → 每次绕回轨迹起点都爆炸，把「复活后正站在幽灵身上」的玩家弹飞
       （_ghostprobe.cjs 实测：7 点轨迹 → 每 7.5 帧炸一次，玩家被反复弹起）。
     · 被**尖刺**杀死属于普通 hazard 死亡 → `hasExplosion=false`
       → 幽灵是**稳定的压板重物**，门永久敞开。
     ⇒ 玩家必须「插旗 → 沿壁台走向出口端的尖刺」，而不是图省事按 K。 */
function gatehouseTile(m) {
  return (g, r, ox, oy) => {
    base(g, ox, oy);
    /* 内部全清（行 1..CH-2、x1..CW-2）：只保留地板 / 天花 / 侧墙与门洞 */
    for (let y = 1; y <= CH - 2; y++)
      for (let x = 1; x <= CW - 2; x++) W(g, ox, oy, x, y, '.');
    const LGY = 7, LX0 = m ? 17 : 3, LX1 = m ? 21 : 7;
    for (let x = LX0; x <= LX1; x++) W(g, ox, oy, x, LGY, '#');
    /* 壁台四周净空（跳得上去、站得下、下方通道不堵） */
    for (let y = LGY - 3; y <= LGY + 3; y++) {
      if (y < 1 || y > CH - 2 || y === LGY) continue;
      for (let x = LX0 - 1; x <= LX1 + 1; x++)
        if (x >= 1 && x <= CW - 2) W(g, ox, oy, x, y, '.');
    }
    /* 自杀刺**最后画**（避免被上面的净空循环清掉）：
       位置 = 壁台的**出口端**（离出口最近那一端），玩家从旗走到它即死。 */
    const SPX = m ? LX0 : LX1;
    W(g, ox, oy, SPX, LGY - 1, '^');
  };
}
reg('gatehouseER', 0, gatehouseTile(0));   /* 出口向右：门 x17、壁台 x3..7   */
reg('gatehouseEL', 0, gatehouseTile(1));   /* 出口向左：门 x7 、壁台 x17..21 */
reg('vanish', 0, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 8, 14), w = ri(r, 3, 4);
  pit(g, ox, oy, x, w, 5);
  for (let k = 0; k < w; k++) W(g, ox, oy, x + k, CH - 1, '*');
});
reg('spike', 0, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 9, 14), n = ri(r, 2, 3);
  for (let k = 0; k < n; k++) W(g, ox, oy, x + k, CH - 2, '^');
});
/* --- T2 --- */
reg('gap', 1, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 9, 13), w = ri(r, 3, 5);
  pit(g, ox, oy, x, w, 6);
  lift(g, ox, oy, 1, x - 1, 0);
  lift(g, ox, oy, x + w, CW - 2, 0);
});
reg('step', 1, (g, r, ox, oy) => {
  base(g, ox, oy);
  const up = r() < 0.5;
  let x = 5, cur = 0;
  for (let i = 0; i < 3; i++) {
    cur = up ? cur + 1 : cur - 1;
    cur = Math.max(0, Math.min(3, cur));
    if (x + 4 > CW - 5) break;
    lift(g, ox, oy, x, x + 3, cur);
    x += 5;
  }
});
reg('chain', 1, (g, r, ox, oy) => {
  base(g, ox, oy);
  let x = 7;
  for (let i = 0; i < 3 && x < CW - 6; i++) {
    const w = ri(r, 2, 3);
    WH(g, ox, oy, CH - 5, x, Math.min(CW - 5, x + w - 1), '=');
    x += w + ri(r, 3, 4);
  }
});
/* --- T3 --- */
reg('lowTunnel', 2, (g, r, ox, oy) => {
  base(g, ox, oy);
  const h = ri(r, 1, 2);                    /* 贴地缝净高 1~2 格 → 隐形知识锁 */
  const x = ri(r, 10, 14), len = ri(r, 3, 4);
  WR(g, ox, oy, x, 1, len, CH - 2 - h, '#');
});
reg('spire', 2, (g, r, ox, oy) => {
  base(g, ox, oy);
  WH(g, ox, oy, CH - 4, 2, 7, '=');
  WH(g, ox, oy, CH - 7, 16, 22, '=');
  WH(g, ox, oy, CH - 9, 9, 15, '=');
});
reg('pillars', 2, (g, r, ox, oy) => {
  base(g, ox, oy);
  const n = ri(r, 2, 3);
  for (let i = 0; i < n; i++) {
    const x = ri(r, 7, CW - 8), h = ri(r, 2, 4);
    WV(g, ox, oy, x, CH - 1 - h, CH - 2, '#');
  }
});
/* --- T4 --- */
reg('pool', 3, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 9, 13), w = ri(r, 4, 5);
  WR(g, ox, oy, x, CH - 5, w, 4, '~');
  WH(g, ox, oy, CH - 5, x - 1, x + w, '#');   /* 水面上的沿口 */
  for (let k = -1; k <= w; k++) W(g, ox, oy, x + k, CH - 6, '#');
});
reg('ice', 3, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 8, 14), w = ri(r, 4, 6);
  for (let k = 0; k < w; k++) W(g, ox, oy, x + k, CH - 1, 'i');
  WR(g, ox, oy, x + w, CH - 4, 2, 3, '^');    /* 冰尽头放刺：考验刹不住 */
});
reg('thorn', 3, (g, r, ox, oy) => {
  base(g, ox, oy);
  const x = ri(r, 9, 13), w = ri(r, 3, 4);
  pit(g, ox, oy, x, w, 4);
  for (let k = 0; k < w; k++) W(g, ox, oy, x + k, CH - 1, '^');   /* 坑底铺刺 */
  WH(g, ox, oy, CH - 5, x - 2, x + w + 1, '=');                    /* 上方给一条踏脚板 */
});
reg('ceilSpike', 3, (g, r, ox, oy) => {
  /* 「压低通道」：天花垂到只留 2 格，最下一行是顶刺。
     玩法是**不许跳** —— 只要老实走过去就安全，一跳就顶到刺上。
     这正是用户要求的「隐形知识锁」：看上去吓人，其实规则很简单。 */
  base(g, ox, oy);
  const x = ri(r, 9, 13), len = ri(r, 3, 4);
  WR(g, ox, oy, x, 1, len, CH - 5, '#');      /* 行 1..CH-5 实心 */
  for (let k = 0; k < len; k++) W(g, ox, oy, x + k, CH - 4, ',');   /* 行 CH-4 是顶刺 */
});
/* --- T5 --- */
reg('laser', 4, (g, r, ox, oy) => {
  /* 顶部激光：一道**被两侧柱子夹住**的短光路，高悬在走廊上空（行 3）。
     光路不能任其自由延伸（否则会贯穿整张地图），必须用终止柱夹住。
     规则：老实走过去（头在行 8）完全安全；在这里**起跳**就会撞进光路。
     ⇒ 与 ceilSpike / dropSpike 同族：一组"不许跳"的隐形知识锁。 */
  base(g, ox, oy);
  const x = ri(r, 10, 14), len = 5;
  /* 两侧夹柱：从天花（行 1）垂到行 4，把光路限制在 x..x+len */
  for (let y = 1; y <= 4; y++) { W(g, ox, oy, x - 1, y, '#'); W(g, ox, oy, x + len, y, '#'); }
  W(g, ox, oy, x, 3, 'R');                   /* 发射器（向右） */
  W(g, ox, oy, x, 2, '#');                   /* 发射器上方挡住 */
});
reg('dropSpike', 4, (g, r, ox, oy) => {
  /* 下落刺：高悬在走廊上方（行 2），下方 3 格处放一块**承托小台**，
     刺只落到行 5 就停 —— 玩家的通行带（行 9）完全不受影响。
     ⇒ 老实走：安全；在这里**起跳**：头撞进刺的触发区，被砸。
     与 ceilSpike（禁跳）、lowTunnel（必须贴地）构成一组「隐形知识锁」。 */
  base(g, ox, oy);
  const x = ri(r, 10, 14);
  W(g, ox, oy, x, 2, '/');
  /* 承托台：3 宽，行 5 —— 把刺的坠落通道截断在高处 */
  for (let k = -1; k <= 1; k++) W(g, ox, oy, x + k, 5, '#');
});
reg('flip', 4, (g, r, ox, oy) => {
  /* 反重力段：走进 g 区就被翻到天花板，于是「地面」变成天花板。
     为了让规则清晰、也为了保证可通，g 区**只覆盖一小段地面**
     （玩家走进去立刻被翻上去，落回天花板走一小段，再走出 g 区落回地面）。
     天花板那一小段必须是实的可站立平台。 */
  base(g, ox, oy);
  const x0 = ri(r, 9, 12), w = 3;
  for (let k = 0; k < w; k++) W(g, ox, oy, x0 + k, CH - 1, 'g');   /* 只覆盖地板那一行 */
  /* 天花：g 区正上方那一小段是实心（可站立），两侧各留一格缓冲 */
  for (let k = -1; k <= w; k++) W(g, ox, oy, x0 + k, 1, '#');
  /* 天花走廊：g 区上方左右各 3 格也做成实心，便于走上/走下 */
  for (let k = -4; k <= w + 3; k++) W(g, ox, oy, x0 + k, 1, '#');
});
/* --- 复合 --- */
reg('gauntlet', 4, (g, r, ox, oy) => {
  base(g, ox, oy);
  WR(g, ox, oy, 7, CH - 2, 2, 1, '^');
  for (let k = 0; k < 3; k++) W(g, ox, oy, 11 + k, CH - 2, '*');
  pit(g, ox, oy, 10, 5, 4);
  WH(g, ox, oy, CH - 5, 5, CW - 6, '=');
});
reg('temple', 4, (g, r, ox, oy) => {
  base(g, ox, oy);
  for (let i = 0; i < 3; i++) {
    const x = 5 + i * 6;
    lift(g, ox, oy, x, x + 2, 1);
    W(g, ox, oy, x, CH - 3, '^');
  }
  WH(g, ox, oy, CH - 7, 3, CW - 4, '=');
});

/* 可用拼块：按 idx 关卡序号过滤
 *
 *  ★ 「门厅」不能进随机池 ★（这是一个曾经潜伏的结构性 bug）
 *    `gatehouseER` / `gatehouseEL` 里带着「壁台 + 自杀刺」，并且**通高门**是靠
 *    build50 按 `gates` 元数据后补的元素。它们只能由 `gateTileOf(i)` 精确放在
 *    `gateCells` 上 —— 只有那里才会同时生成「旗 + 压力板 + 门 + 自杀刺」四件套。
 *    若被 `pickTile()` 随机抽到某个普通箱庭，就会多出一间**只有壁台和悬空自杀刺、
 *    却没有任何门/压力板**的房间（lv21 实测 3 道门却铺了 5 个门厅拼块）。
 *    那些刺虽然悬在走廊上方 3 格、正常走路踩不到，但玩家一跳就会撞上 ——
 *    等于凭空撒了一批随机致死点。
 *
 *  ⚠ 修复方式刻意**不动 rnd 消耗序列**：`pickTile()` 内部是
 *    「对池中每个候选取一次 rnd()」，所以直接从池里删掉门厅会改变之后所有
 *    随机数、导致 50 关地形整体重排（此前所有验证作废）。
 *    这里改为**在选中之后替换**为 flat：rnd() 调用次数完全不变 ⇒ 地形只在这一处
 *    由「门厅」变成「平地」，其余关卡布局逐格不变，历史验证全部继续有效。 */
const GATEHOUSE_PREFIX = 'gatehouse';
function poolFor(idx) {
  return ORDER.filter(n => TILES[n].tier <= tierOf(idx));
}
/* 机制阶梯：返回该关可用的最高 tier */
function tierOf(idx) {
  if (idx < 3) return 0;
  if (idx < 8) return 1;
  if (idx < 14) return 2;
  if (idx < 24) return 3;
  return 4;
}

/* ============================================================ 致死机关簇注入器（v4）
 *
 *  ▍为什么需要它（用户的反馈）
 *    「前期太简单了！！！每关至少要有 5 个谜题…你只是改变地形不算谜题，
 *      只有真的会让玩家死亡的才算谜题！」
 *    旧版把"难度"做成了**地形复杂度**（平台多、有水池、有台阶），
 *    但这些**都不致死** —— 实测 lv1 致死簇 = 0、lv5 = 0、lv2 = 1、lv11 = 1。
 *    玩家前期完全不会死，自然觉得"太简单"。
 *
 *  ▍设计口径（用户确认）
 *    谜题 = 「必须用跳跃 / 幽灵 / 机制才能安全通过、否则必死的机关组合」，记 1 个。
 *    计数由 `hazard_clusters.cjs` 独立审计（空间聚类，簇间距 <= 3.2 格算同簇）。
 *
 *  ▍★★ 前三版为什么全军覆没（三个坑，全部真实引擎实测）★★
 *    ① 挖穿地板 / 把消失台铺在主通道地板上
 *       ⇒ 无门关只有**一条**主通道（箱庭内部行 5..9 + 地板行 10），
 *         在它上面挖洞 = 掐断唯一通路 ⇒ `plan2 exhausted`。
 *    ② ★ 把「必须跳」的地面尖刺与「不许跳」的顶刺放在**同一段 x 上** ★
 *       ⇒ 逻辑自相矛盾：尖刺要求跳过去、顶刺禁止跳，**构造上不可能通过**。
 *       lv1 实测：rel x6,7 是地面尖刺，正上方 rel x5,6,7 恰是 ceil 顶刺。
 *       这是 lv1/2/3/5/6/7/9/10/12 全部 `exhausted` 的真正原因。
 *    ③ 尖刺成排太宽、在低净空下跳不过去。
 *
 *  ▍真实引擎实测数据（`_clear2.cjs`，天花板行 → 最多能跳过的地面尖刺宽度）
 *       无天花        → 6 根
 *       天花行 4（5 行净空）→ 5 根
 *       天花行 5/6（4~3 行）→ 4 根
 *       天花行 7（2 行净空）→ 3 根
 *     ⇒ 2 根尖刺只要头顶有 4 行净空就**一定跳得过去**。
 *
 *  ▍本版设计（结构性安全，不靠"事后回退"）
 *    · 注入簇**只用一种机制：地面 2 根尖刺**（"必须跳"）。
 *      同族 ⇒ 结构上不可能再出现"跳 / 不许跳"矛盾。
 *    · **每个箱庭最多 1 个注入簇**（槽位相距 >= 9 格，绝不在同一箱庭内
 *      放两个会互相干扰跳跃弧的机关）。
 *    · 落位前做**空间体检**（`injectSlotOk`）：
 *        ① 助跑区 + 落地区的地板**全部实心**（不会踩空、不会掉坑）
 *        ② 助跑到落地整段的行 5..9 **全程净空**（有足够空间起跳/落地）
 *        ③ 该跨度内**没有任何既有危险物 / 地形**（尖刺、消失台、激光、平台…）
 *        ④ 落点不越出箱庭门洞带、不碰竖井列
 *      ⇒ 一定跳得过去（有路），且一定必死（不跳就踩刺）。
 *    · **不改变地板可走性**（地板一行原样保留）⇒ 地形连通性构造上保持。
 *
 *  ▍难度阶梯（数量随箱庭同步增长）
 *     目标簇数 = max(5, ceil(箱庭数 × 0.45))
 *     每关直接注入 `need` 个簇（拼块自带的机关只会更多，不会更少）。
 *     机制**种类**的升级由拼块库的 tier 阶梯负责（水/冰/顶刺/激光/反重力…），
 *     注入器只负责保证"前期也有足够多的致死谜题"。
 */
/* 注入簇：每簇 2 根地面尖刺（"必须跳"的唯一机制）。 */
const INJ_SPIKE_N = 2;

/* 玩家在箱庭 i 的**地板层必须经过的列区间** [m0, m1]（rel x）。
 *
 *  为什么必须算这个：只按固定槽位放刺会踩两个坑（都实测过）——
 *    ① 竖井型关卡：玩家从井道**掉到下一层**就走了，根本不过那一段地板
 *       ⇒ 刺成了玩家永远遇不到的装饰（甚至"不跳也活着"，谜题彻底失效）。
 *    ② 从上方落入的箱庭：玩家落在中部（rel x9..13）后直接往出口走，
 *       放在反方向槽位的刺同样无效。
 *
 *  判据：由 `order` 的前后邻接关系唯一确定入口/出口方位 ——
 *    · 横向入口（prev 在左/右）→ 玩家贴着地板从那一侧进来（x=1 / x=24）
 *    · 纵向入口（prev 在上方）→ 玩家从井道口落进中部（x=11）
 *    · 纵向出口（next 在下方）→ 玩家必须走到井道口（x=11）
 *  蛇形 order 只向下折，所以纵向只可能是「上进（T）/ 下出（B）」。
 */
function floorInterval(order, i) {
  const cur = order[i], prev = order[i - 1], next = order[i + 1];
  if (!prev || !next) return null;
  const entX = prev.x < cur.x ? 1 : prev.x > cur.x ? CW - 2 : 11;
  const extX = next.x < cur.x ? 1 : next.x > cur.x ? CW - 2 : 11;
  const m0 = Math.min(entX, extX), m1 = Math.max(entX, extX);
  if (m1 - m0 < 8) return null;                 /* 穿越段太短，放不下助跑+跳跃+落地 */
  return [m0, m1];
}

/* 在 rel 列 [s, s+1] 放「地面 2 根尖刺」是否**一定可跳、且一定必死**？
 *  需同时满足：
 *    ① 助跑 + 落地区（rel s-2..s+3）地板**全部实心**
 *       —— 不踩空、不掉竖井（竖井口就是把地板挖空，天然被排除）
 *    ② 该段再外扩一格的**通道行 5..CH-2 全程净空**
 *       —— 起跳弧不被平台/顶刺/激光挡住，也绝无"禁止跳"机关混进来
 *    ③ 整段落在 [m0, m1] 内 —— 保证刺在**必经之路**上，绕不过去
 *
 *  实测依据（`_clear2.cjs`：天花板行 6（4 行净空）时最多可跳过 4 根地面刺）
 *  ⇒ 只需跳 2 根，**构造上必定可过**；不跳则必踩刺。
 */
function injectSpotOk(g, ox, oy, s, m0, m1) {
  const CHm1 = CH - 1;
  const a = s - 2, b = s + INJ_SPIKE_N + 1;     /* 含落地余量 */
  if (a < m0 || b > m1) return false;           /* ③ 必须在必经段内 */
  if (a < 4 || b > CW - 4) return false;        /* 不碰门洞硬化带 */
  const SOLID = '#=ibmf';
  for (let x = a; x <= b; x++) {
    if (!SOLID.includes(g[oy + CHm1][ox + x])) return false;   /* ① 地板实心 */
    for (let y = 5; y <= CH - 2; y++) {                        /* ② 通道净空 */
      if (g[oy + y][ox + x] !== '.') return false;
    }
  }
  /* 再外扩一格确认（防止紧邻处有地形挡住起跳/落地的腾挪空间） */
  for (const x of [a - 1, b + 1]) {
    if (x < 4 || x > CW - 4) continue;
    if (!SOLID.includes(g[oy + CHm1][ox + x])) return false;
    for (let y = 6; y <= CH - 2; y++) if (g[oy + y][ox + x] !== '.') return false;
  }
  return true;
}

/* 注入一个「地面尖刺簇」（2 根，行 CH-2，地板不动）。返回描述或 null。 */
function injectSpikeCluster(g, ox, oy, s, m0, m1) {
  if (!injectSpotOk(g, ox, oy, s, m0, m1)) return null;
  for (let x = s; x < s + INJ_SPIKE_N; x++) g[oy + CH - 2][ox + x] = '^';
  return { s, kind: '刺' };
}

/* ============================================================ 关卡布局
 *  箱庭排布：蛇形（snake）—— 一行内左右串行（保证横向延伸），
 *  行末下折到下一行（保证纵向延伸）。 */function layout(idx, N) {
  const shape = shapeOf(idx);
  let GX, GY;
  if (shape === 'H') { GX = N; GY = 1; }
  else if (shape === 'V') {
    /* 竖向延伸为主，但仍保留 2 列宽 → 既有纵深也有横向余地 */
    GX = Math.min(2, Math.max(1, N));
    GY = Math.ceil(N / GX);
  } else {
    /* HV / L：接近正方形，略偏横向（横向更好走、更好看） */
    GX = Math.max(2, Math.round(Math.sqrt(N * 1.7)));
    GY = Math.ceil(N / GX);
    while (GX * GY < N) GX++;
  }
  const full = [];
  for (let y = 0; y < GY; y++) {
    const xs = [];
    for (let x = 0; x < GX; x++) xs.push(x);
    if (y % 2 === 1) xs.reverse();
    for (const x of xs) full.push({ x, y });
  }
  return { GX, GY, order: full.slice(0, N) };
}

/* ============================================================ 竖井雕刻
 *  在上下相邻的两个箱庭之间挖一条 5 宽井道，踏台每 4 行左右交错。
 *  几何与已验证的 `ladder` 原子件一致（plan2 实测可通）。 */
function carveShaft(g, W, H, cx, yTopFloor, yBotFloor) {
  const x0 = cx * CW + 9, x1 = x0 + 4;         /* 5 宽 */
  /* 1) 清空井道（从上箱庭地板之上 1 行，到下箱庭地板之上 1 行） */
  for (let y = yTopFloor - 1; y <= yBotFloor - 1; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = x0; x <= x1; x++) g[y][x] = '.';
  }
  /* 2) 上箱庭天花板也要开口（否则上不去） */
  const ceilRow = yTopFloor - (CH - 1);
  for (let y = Math.max(0, ceilRow); y <= yTopFloor - 1; y++)
    for (let x = x0; x <= x1; x++) if (g[y]) g[y][x] = '.';
  /* 3) 踏台：每 4 行一个，3 宽，左右交错（贴左墙 / 贴右墙） */
  let i = 0;
  for (let y = yBotFloor - 4; y > yTopFloor; y -= 4, i++) {
    const left = (i % 2 === 0);
    const a = left ? x0 : x1 - 2;
    for (let x = a; x <= a + 2; x++) if (g[y]) g[y][x] = '=';
  }
  /* 4) 井口上方留 2 行净空 */
  for (let y = yTopFloor - 1; y >= yTopFloor - 2; y--)
    for (let x = x0; x <= x1; x++) if (g[y] && y > 0) g[y][x] = '.';
  return { x0, x1 };
}

/* ============================================================ 单关构建 */
function buildLevel(idx) {
  const N = roomsOf(idx);
  const { GX, GY, order } = layout(idx, N);
  const rnd = mulberry(40427 + idx * 7919);
  const W = GX * CW, H = GY * CH;
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));

  /* 拼块池（避免同一关重复太多） */
  const pool = poolFor(idx);
  const used = new Map();
  function pickTile() {
    /* 加权：越后期越偏好"新机制"；同时压制重复 */
    let best = null, bestS = -1;
    for (const n of pool) {
      const cnt = used.get(n) || 0;
      const tierBias = 1 + TILES[n].tier * 0.55;
      const rep = 1 / (1 + cnt * 2.2);
      const s = tierBias * rep * (0.6 + rnd() * 0.8);
      if (s > bestS) { bestS = s; best = n; }
    }
    used.set(best, (used.get(best) || 0) + 1);
    return best;
  }
  /* 被随机抽到的「门厅」一律换成平地（**必须在 pickTile 之后做**，
     这样 rnd() 消耗序列与旧版逐次一致，其余关卡地形逐格不变）。 */
  const pickTileSafe = () => {
    const n = pickTile();
    return n.startsWith(GATEHOUSE_PREFIX) ? 'flat' : n;
  };

  /* 幽灵门的**箱庭位置**要先定**，因为它们改用专用「门厅」拼块：
     门厅地形固定 = 地面通道 + 架空壁台（压板）+ 通高门，别无杂物。
     **必须避开竖井**：`carveShaft` 会把「上箱庭」的 x9..13 整列清空
     （含壁台），因此门厅不能是任何竖井的下端箱庭。 */
  const nGate = GATES_OF(idx);
  const gateCells = new Set();
  const gateSlots = [];
  if (nGate > 0) {
    const isShaftNeighbor = (i) => {
      const c = order[i];
      const prev = order[i - 1], next = order[i + 1];
      /* 只要自己是竖井的**下箱庭**就会被 carveShaft 清空 x9..13；
         壁台可能落在 x3..7 或 x17..21，两侧都有风险 → 上下两端都避开。 */
      if (prev && prev.x === c.x && Math.abs(prev.y - c.y) === 1) return true;
      if (next && next.x === c.x && Math.abs(next.y - c.y) === 1) return true;
      return false;
    };
    const cand = [];
    for (let i = 2; i < order.length - 1; i++) if (!isShaftNeighbor(i)) cand.push(i);
    const step = cand.length / (nGate + 1);
    for (let k = 0; k < nGate; k++) {
      const pos = cand[Math.min(cand.length - 1, Math.floor((k + 1) * step))];
      if (pos === undefined) continue;
      if (gateCells.has(pos)) continue;
      gateCells.add(pos);
      gateSlots.push(pos);
    }
  }

  /* 门厅朝向：由「出口方向」唯一确定（player 从 prev 进、往 next 出）。
     出口在右 / 上方 ⇒ E=0（门 x17、壁台 x3..7）；出口在左 ⇒ E=1（镜像）。 */
  const gateDir = new Map();
  if (nGate > 0) {
    for (const i of gateSlots) {
      const cur = order[i], next = order[i + 1];
      let exitR = true;
      if (next.x < cur.x) exitR = false;
      else if (next.x > cur.x) exitR = true;
      else exitR = (next.y >= cur.y);   /* 竖直：向下出口当作"右"变体 */
      gateDir.set(i, exitR ? 0 : 1);
    }
  }
  const gateTileOf = (i) => (gateDir.get(i) || 0) === 0 ? 'gatehouseER' : 'gatehouseEL';

  /* 逐箱庭铺拼块 */
  const chambers = [];
  const tileOf = [];
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const ox = c.x * CW, oy = c.y * CH;
    const isFirst = i === 0, isLast = i === order.length - 1;
    let name;
    if (isFirst || isLast) name = 'flat';           /* 首尾纯平地：出生安全、终点好到达 */
    else if (gateCells.has(i)) name = gateTileOf(i);  /* 幽灵门厅：按出口方向选镜像版 */
    else name = pickTileSafe();
    TILES[name].fn(g, rnd, ox, oy, { idx, n: i });
    tileOf.push(name);
    chambers.push({ x: ox, y: oy, w: CW, h: CH, cx: c.x, cy: c.y, i, tile: name });
  }

  /* 横向连接：相邻箱庭（同排左右相邻）门洞已由 base() 开好。
     **但拼块地形可能把门洞带填实**（如 lift 抬地会碰到 CH-4 行、
     pillars 会顶到 CH-2 行）。这里统一做一道「门厅硬化」：
     每个箱庭最左 3 列 / 最右 3 列 的 CH-4..CH-2 行强制为空，
     地板行 CH-1 强制实心 —— 保证横向通行永不中断。
     **幽灵门厅除外**：它自身已是自洽的（地面通道畅通、壁台在内部），
     硬化反而会削掉 x7 / x21 处的壁台边角。 */
  for (let oi = 0; oi < order.length; oi++) {
    if (gateCells.has(oi)) continue;
    const c = order[oi];
    const ox = c.x * CW, oy = c.y * CH;
    for (const xr of [0, 1, 2, CW - 3, CW - 2, CW - 1]) {
      const X = ox + xr;
      for (let y = oy + 1; y <= oy + CH - 2; y++) g[y][X] = '.';
      g[oy + CH - 1][X] = '#';
    }
    /* 门厅上方 2 行也清空，避免"进门要低头" */
    for (const xr of [3, CW - 4]) {
      const X = ox + xr;
      for (let y = oy + CH - 4; y <= oy + CH - 2; y++) g[y][X] = '.';
      g[oy + CH - 1][X] = '#';
    }
  }

  /* 纵向连接：蛇形下折处挖竖井 */
  const shafts = [];
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    if (a.x === b.x && Math.abs(a.y - b.y) === 1) {
      const top = a.y < b.y ? a : b;
      const bot = a.y < b.y ? b : a;
      const yTopFloor = top.y * CH + CH - 1;
      const yBotFloor = bot.y * CH + CH - 1;
      const s = carveShaft(g, W, H, bot.x, yTopFloor, yBotFloor);
      shafts.push({ cx: bot.x, top: top.y, bot: bot.y, ...s });
    }
  }

  /* 出生点 / 终点：放在首/末箱庭的地面上 */
  const first = order[0];
  const spawn = { x: first.x * CW + 3, y: first.y * CH + CH - 2 };
  const last = order[order.length - 1];
  const goal = { x: last.x * CW + CW - 5, y: last.y * CH + CH - 2 };

  /* 幽灵门元数据。
     地形由 `gatehouseER` / `gatehouseEL` 两个镜像拼块铺好，这里只补：
       · 门列整列清空（防止相邻拼块的门洞硬化反过来填实门列）
       · 输出 gate 元数据供 build50 放 plate / door / flag 元素
     方向（dir=0 出口向右 / dir=1 出口向左）决定门列与壁台的 rel x：
       dir0: 壁台 x3..7、旗 x5、门 x17   （入口必在左或上方）
       dir1: 壁台 x17..21、旗 x19、门 x7 （入口必在右或上方） */
  const gates = [];
  const LEDGE_R = 7;
  for (let k = 0; k < gateSlots.length; k++) {
    const pos = gateSlots[k];
    const c = order[pos];
    const x0 = c.x * CW, y0 = c.y * CH;
    const base = y0 + CH - 1;
    const dir = gateDir.get(pos) || 0;
    const doorRX = dir === 0 ? 17 : 7;
    const ledRX0 = dir === 0 ? 3 : 17;
    const ledRX1 = ledRX0 + 4;
    /* 旗放在壁台的**入口端**（离入口最近那一端），尖刺在**出口端**。
       玩家复活在旗上 → 幽灵原地循环压板；玩家再沿壁台走向出口端的尖刺……
       但此时玩家已复活、不会再走。真正的"自杀"发生在**插旗之后、复活之前**：
       插旗 → 走向出口端尖刺 → 死 → 幽灵轨迹 = [旗..尖刺]（全程仍在压板宽度内）
       ⇒ 幽灵在壁台上来回走，**永驻压板** → 门永久敞开。 */
    const flagRX = (dir === 0) ? ledRX0 : ledRX1;
    const doorX = x0 + doorRX;
    const ledgeX0 = x0 + ledRX0, ledgeX1 = x0 + ledRX1;
    const plateX = ledgeX0, plateW = ledRX1 - ledRX0 + 1;
    const flagX = x0 + flagRX, flagY = y0 + LEDGE_R - 1;

    /* 门列 + 左右各 1 列：整列清空（行 1..base-1） */
    for (let y = y0 + 1; y <= base - 1; y++) {
      g[y][doorX] = '.'; g[y][doorX - 1] = '.'; g[y][doorX + 1] = '.';
    }
    /* 确保壁台上方 3 行 / 下方 3 行净空（相邻拼块的门洞硬化可能填实） */
    for (let y = y0 + LEDGE_R - 3; y <= y0 + LEDGE_R + 3; y++) {
      if (y <= y0 || y >= base) continue;
      if (y === y0 + LEDGE_R) continue;               /* 壁台本体保留 */
      for (let x = ledgeX0 - 1; x <= ledgeX1 + 1; x++)
        if (x > x0 && x < x0 + CW - 1) g[y][x] = '.';
    }
    /* 门厅整块的外侧 3 列（出入口门洞）上下各留 2 行净空，防止"进门要低头" */
    for (const X of [x0 + 1, x0 + 2, x0 + CW - 2, x0 + CW - 3]) {
      for (let y = y0 + CH - 5; y <= base - 1; y++) g[y][X] = '.';
    }
    /* 自杀刺：放在壁台的**出口端**（离出口最近那一列）。
       必须在上面所有净空循环**之后**画，否则会被清掉。 */
    const spikeRX = (dir === 0) ? ledRX1 : ledRX0;
    const spikeX = x0 + spikeRX, spikeY = y0 + LEDGE_R - 1;
    g[spikeY][spikeX] = '^';

    gates.push({
      id: 'G' + idx + '_' + k, cell: pos, dir,
      plateX, plateY: y0 + LEDGE_R, plateW,
      flagX, flagY,
      ledge: { x0: ledgeX0, x1: ledgeX1, y: y0 + LEDGE_R },
      doorX, doorY: y0 + 1, doorH: CH - 2,
      /* 入口一侧的地面落脚点（供求解器/文档参考） */
      entrySide: dir === 0 ? 'L' : 'R'
    });
  }

  /* ---------- 浓烟带（幽灵第五用：在烟中开辟可视区） ----------
   *  纯**感知层**机制：`Play.smokes` 在引擎里只被渲染使用（runtime.js:5257-5390），
   *  不参与任何碰撞 / 死亡 / 门禁判定 ⇒ **不会影响可解性**，可以放心叠加。
   *
   *  引擎渲染雾时用 `destination-out` 在每个**已释放幽灵**周围挖一个 44px 的
   *  可视圆（runtime.js:5370-5390）。于是「烟里看不见 → 需要提前插旗放幽灵」
   *  就成了一条纯隐形的知识锁：地形本身能过，但只有会放幽灵的玩家才看得见。
   *
   *  落法：只覆盖**空格**（'.'），绝不覆盖墙 / 平台 / 门洞 / 壁台
   *  ⇒ 即使烟画歪了也不会改变几何，最坏只是视觉上多一块雾。
   *  放开条件：idx >= 18（此时已有幽灵门 ⇒ 玩家手里一定有幽灵可用）；
   *  每关取 1~2 个箱庭（由关卡种子确定，可复现），跳过首尾箱庭（出生/终点要看得见）。 */
  if (idx >= 18) {
    const nFog = order.length >= 30 ? 2 : 1;
    const cand = [];
    for (let i = 1; i < order.length - 1; i++) if (!gateCells.has(i)) cand.push(i);
    if (cand.length) {
      const stepF = cand.length / (nFog + 1);
      for (let k = 0; k < nFog; k++) {
        const pos = cand[Math.min(cand.length - 1, Math.floor((k + 1) * stepF))];
        if (pos === undefined) continue;
        const c = order[pos];
        const ox = c.x * CW, oy = c.y * CH;
        /* 雾带：行 3..6（走廊上方的可视空间），列 2..22。
           只在**足够长的连续空格段**（>= 8 格）上落雾 —— 否则被立柱切断的
           碎块（1~2 格）在渲染上只是几个小雾点，反而显脏。 */
        for (let y = oy + 3; y <= oy + 6; y++) {
          if (!g[y]) continue;
          let run = -1;
          for (let x = ox + 2; x <= ox + CW - 2; x++) {
            const free = (x < ox + CW - 2) && g[y][x] === '.';
            if (free) { if (run < 0) run = x; continue; }
            if (run >= 0) {
              if (x - run >= 8) for (let k = run; k < x; k++) g[y][k] = 'x';
              run = -1;
            }
          }
          if (run >= 0 && (ox + CW - 2) - run >= 8)
            for (let k = run; k < ox + CW - 2; k++) g[y][k] = 'x';
        }
      }
    }
  }

  /* ---------- 机制密室（可移动方块 / 易燃方块 / 易碎方块） ----------
   *  ▲ 为什么必须做成「可选」▲
   *    simfast 把 movable / breakable / flammable 一律当作**静态固体**，而真实引擎里
   *    它们会掉落（updateMovables）、会被踩碎（updateBreakables）、会燃烧消失。
   *    把这三个机制放进主线 = 让「已验证可通关」的证明失效。
   *    所以这里只在**完全不影响主线**的天花侧净空开一间密室：
   *      · 选址硬约束：所需格位必须**原本全是空气**（否则跳过该箱庭）
   *      · 位置：相对行 **1..4** —— 严格避开走廊通行带（行 5..9，即门洞高度）
   *        玩家从地面（脚在行 10）起跳，脚最高可达行 3.25（实测 6.79 格），
   *        所以「行 4 的书架顶面」是直接可达的，不需要额外踏台。
   *      · 主线拼块的行 5..10 一格不动 ⇒ simfast 的物理证明完全不受影响。
   *    内容：书架（platform，顶面行 4）→ 上面停一个**可移动方块**、
   *          两个**易燃方块**（相邻 → 会连锁引燃）、一个**易碎方块**，
   *          最上面一颗心作为奖励。
   *    ★ 与幽灵的第五种协同 ★
   *      幽灵自杀爆炸 `triggerExplosion(x, y, 32, 'ghost')` 会在半径内
   *      **引爆易燃方块**（runtime.js:3405）并**打碎易碎方块**（runtime.js:3393）。
   *      ⇒ 玩家可以先探索密室，再用「插旗 + 按 K 自杀」把这里的可燃物炸掉。
   *      这条路线对通关**可有可无**，正是用户想要的"幽灵不只是按开关"。 */
  if (idx >= 20) {
    const vaultCands = [];
    for (let i = 1; i < order.length - 1; i++) {
      if (gateCells.has(i)) continue;
      const c = order[i], ox = c.x * CW, oy = c.y * CH;
      /* 只占用行 1..4：x9..14 的书架带 + 上面的方块/奖励。
         x 取 9..14 是为了与「门厅硬化」的 x∈{0,1,2,3,21,22,23,24} 完全错开。 */
      const need = [];
      for (let x = 9; x <= 14; x++) need.push([x, 4]);
      for (let x = 10; x <= 13; x++) need.push([x, 3]);
      need.push([11, 2], [12, 2], [9, 3], [14, 3]);
      let ok = true;
      for (const [x, y] of need) if (g[oy + y][ox + x] !== '.') { ok = false; break; }
      if (ok) vaultCands.push(i);
    }
    const nVault = Math.min(vaultCands.length, idx >= 36 ? 2 : 1);
    for (let k = 0; k < nVault; k++) {
      const i = vaultCands[Math.min(vaultCands.length - 1,
        Math.floor((k + 1) * vaultCands.length / (nVault + 1)))];
      const c = order[i], ox = c.x * CW, oy = c.y * CH;
      for (let x = 9; x <= 14; x++) g[oy + 4][ox + x] = '=';      /* 书架（顶面行 4） */
      g[oy + 3][ox + 10] = 'm';                                   /* 可移动方块 */
      g[oy + 3][ox + 11] = 'f';                                   /* 易燃（相邻连锁） */
      g[oy + 3][ox + 12] = 'f';
      g[oy + 3][ox + 13] = 'b';                                   /* 易碎（爆炸可破） */
      g[oy + 2][ox + 11] = 'h';                                   /* 奖励：心 */
    }
  }

  /* ---------- ★致死机关簇注入 v4（用户核心要求：每关 >= 5 个谜题）★ ----------
   *  目标簇数 = max(5, ceil(箱庭数 × 0.45)) —— 「密度不变，数量随箱庭同步增加」。
   *
   *  ▍与前几版的根本区别：**结构性安全**，不靠"事后回退"
   *    旧版注入 'ceil'（禁止跳）+ 'spikes'（必须跳）混在同一片 x 上，
   *    于是制造出「跳又死、不跳也死」的逻辑死局（lv1 实测）。
   *    本版只注入**单一机制**（地面 2 根尖刺 = "必须跳"），
   *    并且落位前做空间体检：要求助跑/落地整段地板实心、行 5..CH-2 全程净空、
   *    邻域无任何既有危险物 ⇒ **一定跳得过去**（已验证：2 根刺 + 4 行净空必过）。
   *    ⇒ 同时满足「可解」与「不跳必死」两个硬约束。
   *
   *  ▍自检闭环
   *    每次注入后立刻用网格版「致死簇计数器」（与 hazard_clusters.cjs 同口径：
   *    同一箱庭 + 欧氏距离 <= 3.2 格算同簇）重算，达成就停止；
   *    加不进去也不会破坏可解性（最多是簇数不足，由外部审计报告）。
   */
  const injectedList = [];
  {
    const need = Math.max(5, Math.ceil(order.length * 0.45));

    /* 网格版簇计数（同口径） */
    const countClusters = () => {
      const src = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = g[y][x];
        if (c === '^' || c === ',' || c === '/') src.push({ x, y });
        else if (c === 'R' || c === 'L' || c === 'U' || c === 'W') src.push({ x, y });
      }
      for (let y = CH - 1; y < H; y += CH) for (let x = 0; x < W; x++) {
        const c = g[y][x];
        if (c !== '.' && c !== '*') continue;
        let depth = 0;
        for (let yy = y + 1; yy < H && g[yy][x] !== '#'; yy++) depth++;
        if (y + 1 >= H || depth >= 3) src.push({ x: x + 0.5, y });
      }
      const cellOf = (s) => ((s.x / CW) | 0) + ',' + ((s.y / CH) | 0);
      const clusters = [];
      for (const s of src) {
        const cell = cellOf(s);
        let hit = null;
        for (const cl of clusters) {
          if (cl.cell !== cell) continue;
          for (const m of cl.members) if (Math.hypot(m.x - s.x, m.y - s.y) <= 3.2) { hit = cl; break; }
          if (hit) break;
        }
        if (hit) hit.members.push(s); else clusters.push({ cell, members: [s] });
      }
      return clusters.length;
    };

    /* 候选箱庭：跳过首尾（出生/终点要绝对安全）与门厅（自有机制） */
    const cands = [];
    for (let i = 1; i < order.length - 1; i++) {
      if (gateCells.has(i)) continue;
      cands.push(i);
    }
    let count = countClusters();
    let injected = 0;
    /* 逐箱庭：只在「地板层必经段 [m0, m1]」里找落点。
       每个箱庭最多 2 簇，两簇中心相距 >= 8 格（否则会被 3.2 阈值并簇）。 */
    for (const i of cands) {
      if (count >= need) break;
      const iv = floorInterval(order, i);
      if (!iv) continue;
      const [m0, m1] = iv;
      const c = order[i], ox = c.x * CW, oy = c.y * CH;
      const picked = [];
      for (let s = m0; s + INJ_SPIKE_N < m1; s++) {
        if (picked.length >= 2) break;
        if (picked.some(u => Math.abs(u - s) < 8)) continue;
        const r = injectSpikeCluster(g, ox, oy, s, m0, m1);
        if (!r) continue;
        picked.push(s);
        injectedList.push({ cell: i, cx: c.x, cy: c.y, s, x: ox + s, y: oy + CH - 2 });
        count = countClusters();
        injected++;
      }
    }
    /* 浏览器安全：`process` 在浏览器里不存在，用 typeof 守卫，
       否则打包成 levels.genlib.js 后这里会 ReferenceError。 */
    if (typeof process !== 'undefined' && process.env && process.env.W50DBG) {
      console.log(`lv${idx + 1} 箱庭${order.length} 需${need} 注入${injected} 现${countClusters()}`);
    }
  }

  /* ---------- ★世界外框封边（修「走出摄像机就死」）★ ----------
   *  引擎真相（runtime.js:4617）：玩家只要**不在任一箱庭矩形内**就立刻 diePlay()。
   *  箱庭矩形 = {x: c.x*T, y: c.y*T, w: CW*T, h: CH*T}，玩家的"安全区"就是这些
   *  矩形的并集。而 `base()` 给**每个**拼块都开了左右两个门洞（行 5..9），
   *  于是位于世界最左 / 最右列的箱庭，其门洞**直接通向世界之外**：
   *  玩家一路向左走，越过 x < -8 之后不再与任何箱庭重叠 → 立即死亡。
   *  这非常反常识：画面上只是"空处的边缘"，没有任何提示，玩家会白丢一条命。
   *
   *  修法：在所有地形 / 机制生成**全部结束之后**把世界最外一圈补实。
   *    · 顶行 / 最左列 / 最右列 → 一律补成实心。
   *      这些门洞**没有任何合法用途**：主线是「门到门」传递的，
   *      玩家的行进方向永远是「从 prev 箱庭进、往 next 箱庭出」，
   *      从不穿过世界边缘。
   *    · **底行不动**：`pit()` 挖穿地板掉下去死是**有意设计**的正常玩法
   *      （用户明确要求"保留坑洞但封侧墙"）。
   *    · 出生点在 x = first.x*CW+3、终点在 x = last.x*CW+CW-5，
   *      都在 ≥3 与 ≤W-6 处，**不会被封边覆盖**。
   *    · 格子并集若有缺角（layout 末行不足），那些格子本来就是 '#'，无需处理。
   *  这样「看得见的墙」与「安全区边界」从此完全对齐。 */
  for (let y = 0; y < H; y++) { g[y][0] = '#'; g[y][W - 1] = '#'; }
  for (let x = 0; x < W; x++) g[0][x] = '#';

  /* 支线奖励：在主线之外的箱庭位置放奖杯（本架构里箱庭即主线，故用高台） */
  const rows = g.map(r => r.join(''));

  return {
    rows, W, H, GX, GY, T, CW, CH,
    chambers: chambers.map(c => ({ x: c.x * T, y: c.y * T, w: CW * T, h: CH * T })),
    chamberCells: chambers,
    shafts, gates, order, tileOf,
    injected: injectedList,
    spawn: { x: spawn.x, y: spawn.y },
    goal: { x: goal.x, y: goal.y },
    rooms: order.length,
    inner: { GX, GY }
  };
}

/* ============================================================ 50 关规格 */
const BASE = [
  [5, 'H'], [6, 'H'], [7, 'V'], [8, 'HV'], [9, 'H'],
  [10, 'V'], [10, 'HV'], [11, 'H'], [12, 'HV'], [12, 'L'],
  [13, 'H'], [14, 'V'], [14, 'HV'], [15, 'L'], [16, 'H'],
  [17, 'V'], [17, 'HV'], [18, 'H'], [19, 'HV'], [20, 'L'],
  [22, 'H'], [23, 'V'], [24, 'HV'], [25, 'L'], [26, 'H'],
  [27, 'V'], [28, 'HV'], [29, 'H'], [30, 'HV'], [30, 'L'],
  [32, 'L'], [33, 'H'], [34, 'V'], [35, 'HV'], [36, 'H'],
  [37, 'V'], [38, 'HV'], [39, 'L'], [40, 'H'], [40, 'HV'],
  [44, 'HV'], [45, 'L'], [46, 'H'], [47, 'HV'], [48, 'L'],
  [49, 'HV'], [50, 'HV'], [50, 'L'], [50, 'HV'], [50, 'L']
];
const ROOMS_OF = BASE.map(b => b[0]);
const SHAPES = BASE.map(b => b[1]);

const NAMES = [
  '晨曦小径', '苔痕石阶', '苔洞垂井', '风语回廊', '霜原浅野',
  '霜井初探', '幽林双庭', '林间长桥', '炽炉工坊', '炉心折返',
  '樱落浮台', '樱井回旋', '潮汐囚笼', '海渊折廊', '霓虹立交',
  '霓虹垂井', '云海天梯', '云桥连廊', '古堡残垣', '残堡回环',
  '沙海沉窟', '沙窟垂梯', '极光冰原', '极光折径', '沉墨书廊',
  '书廊垂井', '雷暴尖塔', '雷暴连桥', '齿轮回廊', '齿轮折返',
  '齿轮垂井', '蒸汽长街', '蒸汽垂塔', '圣殿回廊', '圣殿长阶',
  '虚空垂井', '虚空净界', '虚空回环', '天穹圣殿', '终焉之门',
  '万象回廊', '万象折径', '万象长桥', '万象双塔', '万象回寰',
  '归墟之始', '归墟垂井', '归墟终点', '无相空域', '万象归墟'
];

const THEMES = [
  'dawn', 'dawn', 'cavern', 'forest', 'frost',
  'frost', 'forest', 'forest', 'forge', 'forge',
  'sakura', 'sakura', 'abyss', 'abyss', 'neon',
  'neon', 'skyland', 'skyland', 'castle', 'castle',
  'desert', 'desert', 'aurora', 'aurora', 'library',
  'library', 'storm', 'storm', 'clockwork', 'clockwork',
  'steampunk', 'steampunk', 'temple', 'temple', 'temple',
  'void', 'void', 'void', 'temple', 'finale',
  'finale', 'finale', 'finale', 'finale', 'finale',
  'void', 'void', 'finale', 'void', 'finale'
];

function GATES_OF(idx) {
  if (idx < 11) return 0;
  return Math.min(10, 1 + Math.floor((idx - 11) / 4));
}

/* ============================================================ 可扩展到任意关数
 *
 *  ▍为什么要有这一层
 *    上面 4 张表（BASE/NAMES/THEMES/GATES_OF）是**为 50 关手工调的**，
 *    长度写死 50。一旦 idx >= 50，`SHAPES[idx]` 就是 undefined，
 *    `layout()` 读它的 `.x` 直接抛异常（实测 buildLevel(120) 崩）。
 *    用户要的是 100~1000 关，所以必须把「查表」升级成「查表 + 公式」。
 *
 *  ▍★硬约束：idx < 50 必须逐字节不变★
 *    50 关那套已经过完整验证（tilecheck / plan2 / verify50 / _injver / _border）。
 *    任何偏移都会让这些验证全部作废。所以下面每个访问器都是
 *    **先返回原表值**，只有在 idx >= 50 时才走公式分支。
 *    （验收：_genxt.cjs 对 idx 0..49 比对修改前后的 md5。）
 *
 *  ▍idx >= 50 的曲线设计
 *    · 箱庭数：50 起每 2 关 +1，封顶 64（再大只会拖长单关时长、放大体积）
 *    · 布局形状：H/V/HV/L 四拍循环（保证横向与纵向都持续出现）
 *    · 主题：20 主题循环，但**用 idx 打散**避免与前期重复同样的顺序
 *    · 名称：主题名 + 序号后缀，保证 1000 关里名字可读且不重样
 */
/* 20 个主题 key（与 themes.cjs 的 THEMES 一一对应）与其中文名。
   这里**重复声明一份常量**而不是 require('./themes.cjs')，
   目的是让 world50.cjs 保持「零依赖」—— 打包成浏览器脚本时更简单。 */
const THEME_CYCLE = [
  'dawn', 'dusk', 'cavern', 'frost', 'forest', 'forge', 'abyss', 'void',
  'sakura', 'neon', 'skyland', 'castle', 'desert', 'aurora', 'steampunk',
  'temple', 'storm', 'library', 'clockwork', 'finale'
];
const THEME_NAME = {
  dawn: '晨光', dusk: '暮色', cavern: '深穴', frost: '霜原',
  forest: '幽森', forge: '熔炉', abyss: '深海', void: '星轨',
  sakura: '樱雪', neon: '霓虹', skyland: '浮空', castle: '古堡',
  desert: '沙海', aurora: '极光', steampunk: '蒸汽', temple: '神殿',
  storm: '雷暴', library: '书房', clockwork: '齿轮', finale: '终焉'
};

const XT_ROOMS_CAP = 64;
/* 箱庭数曲线（idx >= 50）：
   · 先按 k/2 线性成长到上限（50 → 64）
   · 触顶后在 [cap-8, cap] 的**带状区间内确定性振荡**，让相邻关卡大小不同
     ★为什么必须振荡★：若只做「线性成长 + 封顶」，实测 1000 关里有 **922 关
     全是 64 箱庭**（完全一样大），后 900 关玩起来毫无节奏变化。
     振荡后 56..64 共 9 档轮转，既保持"后期偏大"的总体趋势，又逐关有变化。 */
function roomsOf(idx) {
  if (idx < ROOMS_OF.length) return ROOMS_OF[idx];
  const k = idx - ROOMS_OF.length;
  const grown = 50 + Math.floor(k / 2);
  if (grown < XT_ROOMS_CAP) return grown;
  return XT_ROOMS_CAP - ((idx * 7) % 9);        /* 56..64 轮转 */
}
const XT_SHAPES = ['H', 'V', 'HV', 'L'];
function shapeOf(idx) {
  if (idx < SHAPES.length) return SHAPES[idx];
  return XT_SHAPES[idx % XT_SHAPES.length];
}
function themeOf(idx) {
  if (idx < THEMES.length) return THEMES[idx];
  /* 用 (idx*7)%20 打散，避免"第 50 关 = 第 1 关"这种一眼可见的重复 */
  const keys = THEME_CYCLE;
  return keys[(idx * 7) % keys.length];
}
/* 名称后缀池：按序号取词，保证可读、不重样 */
const XT_SUFFIX = [
  '回廊', '垂井', '长桥', '双塔', '折径', '回寰', '净界', '长阶',
  '折返', '连廊', '尖塔', '残垣', '沉窟', '垂梯', '立交', '天梯',
  '浮台', '回旋', '囚笼', '折廊', '工坊', '垂塔', '冰原', '书廊',
  '连桥', '长街', '回环', '终点', '空域', '归墟'
];
function nameOf(idx) {
  if (idx < NAMES.length) return NAMES[idx];
  const th = THEME_NAME[themeOf(idx)] || '秘境';
  const s = XT_SUFFIX[(idx * 11) % XT_SUFFIX.length];
  const round = Math.floor(idx / XT_SUFFIX.length) + 1;
  return th + s + '·' + round;
}

module.exports = {
  buildLevel, layout, TILES, ORDER, poolFor, tierOf,
  ROOMS_OF, SHAPES, NAMES, THEMES, GATES_OF, BASE,
  /* ★可扩展访问器（支持任意关数）★ */
  roomsOf, shapeOf, themeOf, nameOf,
  CW, CH, T, mulberry, ri, pick
};

});

/* ===== build50.cjs ===== */
__def("build50", function (module, exports, require, __name) {
/* build50.cjs —— 组装层（world50 → 元素 + 资源 + 背景）
 *
 *  与 build4 的区别：
 *    · 地形来自 world50 的「门到门拼块」（构造上保证可通）
 *    · **所有路灯统一走 deco.fixLamps 重新落位**（修复悬空/埋地）
 *    · 资源按「主线长度 + 机制密度」极限收紧
 */
'use strict';
const A = require('./ascii.cjs');
const W5 = require('./world50.cjs');
const TH = require('./themes.cjs');
const D = require('./deco.cjs');

const T = 8, CW = 25, CH = 11;

const DECO = {
  dawn: { grass: '#6fc98a', vine: '#8fd8a8' },
  forest: { grass: '#5fbf7a', vine: '#7fd090' },
  cavern: { grass: '#7f8fd8', vine: '#9fa8e8' },
  frost: { grass: '#a8d8f0', vine: '#c8e8ff' },
  forge: { grass: '#d89a5f', vine: '#e8b878' },
  sakura: { grass: '#e0a8c0', vine: '#f0c8d8' },
  abyss: { grass: '#4fb8c8', vine: '#6fd8e8' },
  neon: { grass: '#c85fd8', vine: '#e08ff0' },
  skyland: { grass: '#8fd0a8', vine: '#a8e0c0' },
  castle: { grass: '#8f8fc0', vine: '#a8a8d8' },
  desert: { grass: '#c8a870', vine: '#d8c090' },
  aurora: { grass: '#7fe0d0', vine: '#a0f0e0' },
  library: { grass: '#b89870', vine: '#d0b890' },
  storm: { grass: '#7f9fc8', vine: '#9fbfe0' },
  clockwork: { grass: '#9f8fd8', vine: '#b8a8e8' },
  steampunk: { grass: '#c8a060', vine: '#e0c080' },
  temple: { grass: '#7fb87f', vine: '#9fd09f' },
  void: { grass: '#9f8fe0', vine: '#b8a8f0' },
  finale: { grass: '#e0b050', vine: '#f0d078' },
  null: { grass: '#b0b0c0', vine: '#c8c8d8' }
};

function build(idx, opts = {}) {
  const w = W5.buildLevel(idx);
  const theme = W5.themeOf(idx);
  const deco = DECO[theme] || DECO.dawn;

  const compiled = A.compile(w.rows, {
    grassColor: deco.grass,
    vineColor: deco.vine,
    seed: 1000 + idx * 37,
    noDeco: true                       /* 装饰统一由 deco.cjs 负责落位 */
  });
  const elements = compiled.elements;

  /* 幽灵门：旗（壁架上）→ 压力板（壁架上）→ 通高门。
     玩家插旗后立刻自杀 → 幽灵从旗点起循环「挪到板上 → 静止」→ 永久压板开门。
     代价 = 1 条命（game.js 覆写的 diePlay 在生命耗尽时直接 fail，自杀是真实开销）。 */
  for (const gt of w.gates) {
    elements.push({ type: 'flagPickup', x: gt.flagX * T, y: gt.flagY * T, w: 8, h: 8 });
    elements.push({
      type: 'plate', x: gt.plateX * T, y: gt.plateY * T,
      w: gt.plateW * T, h: 4, need: 1, targetId: gt.id
    });
    elements.push({
      type: 'door', x: gt.doorX * T, y: gt.doorY * T,
      w: T, h: gt.doorH * T, id: gt.id, orientation: 'v'
    });
  }

  /* 出生 / 终点 */
  elements.push({ type: 'spawn', x: w.spawn.x * T, y: w.spawn.y * T, w: 8, h: 8 });
  elements.push({
    type: 'goal', x: w.goal.x * T, y: (w.goal.y - 4) * T,
    w: 4 * T, h: 5 * T
  });

  /* 支线奖励：每关固定几颗心/奖杯，放在高处平台（需要跳上去才有） */
  const rewards = [];
  const nR = Math.min(3, 1 + Math.floor(w.rooms / 14));
  for (let k = 0; k < nR; k++) {
    const c = w.chamberCells[2 + k * 3] || w.chamberCells[1];
    if (!c) continue;
    const x = c.x + 4 + k * 5, y = c.y + 3;
    const ch = (k % 2 === 0) ? 'h' : 'T';
    elements.push(ch === 'h'
      ? { type: 'heart', x: x * T, y: y * T, w: 8, h: 8 }
      : { type: 'trophy', x: x * T, y: y * T, w: 8, h: 8, id: 'lv' + (idx + 1) + 't' + k });
    rewards.push({ x, y, ch });
  }

  /* 路灯：**统一重新落位**（立在地面，不悬空、不埋地） */
  const lum = D.fixLamps(elements, {
    minGap: 13,
    headClear: 3,
    avoid: [
      { x: w.spawn.x, y: w.spawn.y, r: 2 },
      { x: w.goal.x, y: w.goal.y, r: 2 },
      ...w.gates.map(g => ({ x: g.flagX, y: g.flagY, r: 2 })),
      ...w.gates.map(g => ({ x: g.plateX, y: g.plateY, r: 2 }))
    ]
  });
  const finalEls = lum.elements;

  /* 背景 */
  const backgrounds = TH.buildBackgrounds(theme, { x0: 0, y0: 0, x1: w.W, y1: w.H }, 1000 + idx * 37);

  /* ---------- 资源：极限收紧 ---------- */
  let danger = 0;
  for (const e of finalEls) {
    const t = e.type;
    if (t === 'spike') danger += 1;
    else if (t === 'fallingSpike') danger += 1.6;
    else if (t && t.startsWith('laser')) danger += 1.4;
    else if (t === 'flammable') danger += 1.2;
    else if (t === 'breakable') danger += 0.5;
    else if (t === 'disappear') danger += 0.35;
  }
  const rooms = w.rooms;
  const gateCount = w.gates.length;
  /* 密度：按箱庭数归一（每箱庭的危险量），再压缩成 0..4 的加成 */
  const density = Math.min(4, Math.round((danger * 1.35) / rooms));
  /* 生命预算的**硬账**（必须先算清，否则构造上不可解）：
       · game.js:430 覆写：`lives<=1` 时死亡直接 fail ⇒ **允许死亡次数 = lives-1**
       · 每道幽灵门必须消耗 1 条命（插旗后自杀；幽灵不可复用，见 ghostgate.cjs）
       ⇒ `lives` 至少 = gateCount + 1 才「刚好够」。
     设计（★已被用户反馈收紧过一轮★）：
       前期（idx< 24）：gateCount + 1 + 1（+ 密度，**上限 +2**）
       中期（24..39）：gateCount + 1 + 1（+ 密度/2）
       后期（idx>=40）：gateCount + 1（**零冗余**，一处失误即重来）

     ⚠ 为什么密度加成必须**封顶 +2**：
       旧版 `spare=2` + `densAdd=density`（最高 4）会让 lv1/lv2 直接拿到
       **6 条命、而必需死亡数 = 0** ⇒ 这是全游戏最宽松的两关，与用户明确要求
       「资源紧张一点刚好能过关、不要让玩家躺着都能赢」「前期太简单」直接冲突。
       病根是**双重计数**：危险多 → 多给命 → 又因为危险多 → 又加命。
       注入器补齐密度后，danger 被推高（lv1 danger=11），旧公式就失控了。
       现在：基础冗余固定 1 条，密度最多再补 2 条 ⇒ lv1 = 4 条（原 6 条）。 */
  const late = idx >= 40, mid = idx >= 24;
  let spare = 1;
  if (late) spare = 0;
  const densAdd = late ? 0 : Math.min(2, Math.round(density * (mid ? 0.5 : 1)));
  let lives = gateCount + 1 + spare + densAdd;
  lives = Math.max(3, lives);
  /* 旗帜：插旗是幽灵门的入场券；每关固定 1 面（幽灵门只认「当前旗」） */
  const flags = 1;

  return {
    id: 'lv' + (idx + 1),
    name: W5.nameOf(idx),
    chambers: w.chambers,
    elements: finalEls,
    initialLives: lives,
    initialFlags: flags,
    feel: null,
    camera: null,
    backgrounds,
    _meta: {
      GX: w.GX, GY: w.GY, rooms: rooms, gates: gateCount, theme,
      shafts: w.shafts.length, lamps: lum.lamps, danger: Math.round(danger),
      spawn: w.spawn, goal: w.goal, shape: W5.shapeOf(idx),
      gateList: w.gates
    }
  };
}

module.exports = { build, DECO };

if (require.main === module) {
  const idx = process.argv[2] !== undefined ? parseInt(process.argv[2], 10) : null;
  const list = idx === null ? Array.from({ length: 50 }, (_, i) => i) : [idx];
  for (const i of list) {
    const lv = build(i);
    const m = lv._meta;
    console.log(`lv${String(i + 1).padStart(2)} ${lv.name} ${W5.shapeOf(i)} 箱庭${m.rooms}(${m.GX}x${m.GY}) 井${m.shafts} 门${m.gates} 灯${m.lamps} 危${m.danger} 元${lv.elements.length} 命${lv.initialLives} 旗${lv.initialFlags}`);
  }
}

});

/* ---- 对外 API ---- */
var W5 = __req('./world50.cjs');
var B  = __req('./build50.cjs');

var API = {
  /* 生成第 idx 关（0 起）。返回与 lvgen/build50.cjs build() 相同结构 */
  build: function (idx) { return B.build(idx); },
  /* 轻量元数据（不需要生成地形就能拿到，选关页用） */
  meta: function (idx) {
    return {
      id: 'lv' + (idx + 1),
      name: W5.nameOf(idx),
      theme: W5.themeOf(idx),
      shape: W5.shapeOf(idx),
      rooms: W5.roomsOf(idx),
      gates: W5.GATES_OF(idx)
    };
  },
  /* 批量元数据（只做配方展开，不生成地形 ⇒ 极快） */
  metaRange: function (from, to) {
    var out = [];
    for (var i = from; i < to; i++) out.push(this.meta(i));
    return out;
  },
  /* 深度校验：把配方完整体检一遍（返回错误数组，空数组 = 健康） */
  validate: function (idx) {
    var errs = [];
    try {
      var lv = B.build(idx);
      if (!lv || !Array.isArray(lv.elements)) errs.push('elements 缺失');
      else {
        var kinds = {};
        for (var i = 0; i < lv.elements.length; i++) kinds[lv.elements[i].type] = 1;
        if (!kinds.goal) errs.push('缺 goal');
        if (!kinds.spawn) errs.push('缺 spawn');
        for (var j = 0; j < lv.elements.length; j++) {
          var e = lv.elements[j];
          if (!isFinite(e.x) || !isFinite(e.y)) { errs.push('元素 ' + j + ' 坐标非有限'); break; }
        }
      }
      if (!Array.isArray(lv.chambers) || !lv.chambers.length) errs.push('缺 chambers');
      if (!Array.isArray(lv.backgrounds) || !lv.backgrounds.length) errs.push('缺 backgrounds');
    } catch (e) { errs.push('异常: ' + e.message); }
    return errs;
  },
  count: function () { return Infinity; },     /* 可无限生成 */
  version: '1.0.0'
};

return API;
});
