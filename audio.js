/* ============================================================================
 * audio.js  —  die2jump 纯 WebAudio 音频系统（无任何外部音频资源）
 * ----------------------------------------------------------------------------
 * 公开 API（挂在 window.AudioSystem）：
 *   init()                 : Promise   用户手势解锁 AudioContext，可重复调用
 *   setScene(kind, level)  : void      kind = 'menu' | 'pause' | 'level' | 'silent'
 *   setVolumes(music, sfx) : void      0..1
 *   sfx(name, x?, y?)      : void      一次性音效（由 game.js 驱动）
 *   update(player, Play, dt): void     每帧：监听点、水下、环境音淡入淡出
 *   setListener(player)    : void
 *   reset()                : void
 *   debug()                : object
 *   levelSeed(level)       : string    由背景层/形状/颜色派生的确定性种子
 *   compose(kind, level)   : {duration, seed, events}
 *   renderTrack(kind, level): Promise<AudioBuffer>  离线生产路径（供检测）
 *
 * 设计要点：
 *   · 音乐三声部：和弦旋律 + 低音 + 轻鼓；仅用种子 PRNG，禁用 Math.random 组成旋律
 *   · 循环 PCM 缓冲：所有尾音按长度取模折叠回开头 → 首尾接缝连续，source.loop = true
 *   · 切换交叉淡化；音乐缓冲缓存上限 8 段
 *   · 一次性音效 → sfx 总线；music 总线独立
 *   · 水下：sfx/环境音统一低通(650~900Hz) + 短延时反馈湿声；音乐可轻低通
 *   · 激光：按发射器与 computeLaserRay 端点线段距离做平滑衰减
 *   · 环境音（水/烟/重力/易燃/激光）：区域/线段距离淡入淡出，最多 20 个，
 *     离局立即停止释放，暂停停止、恢复重建
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /* FNV-1a 32bit 字符串哈希（可指定初始偏移，用于双哈希） */
  function hashStr(str, seed) {
    var h = (seed >>> 0);
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  /* mulberry32：确定性 PRNG，仅由种子驱动 */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function toHex32(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }

  /* ------------------------------------------------------------------ */
  /* 全局状态                                                            */
  /* ------------------------------------------------------------------ */
  var ctx = null;              // AudioContext
  var built = false;           // 音频图是否已建立

  var master, limiter;         // 主输出 + 软限幅
  var musicBus, musicFilter;   // 音乐总线 + 轻低通
  var sfxBus, sfxUnder, sfxTame, sfxDry, sfxWet, sfxDelay, sfxFeedback; // 音效总线 + 水下处理 + 削刺耳

  var musicVolume = 0.7;
  var sfxVolume = 0.85;

  var scene = 'silent';        // menu | pause | level | silent
  var sceneLevel = null;       // setScene 传入的 level（可能是 lv 或 Play）

  var activeTracks = [];       // 正在播放的音乐轨（支持交叉淡化）
  var currentSeed = '';
  var currentDuration = 0;
  var currentGenre = '';

  var musicCache = {};         // key -> AudioBuffer
  var musicCacheOrder = [];    // LRU 顺序
  var MUSIC_CACHE_MAX = 8;

  var sfxCache = {};           // name -> AudioBuffer
  var sfxActive = new Set();   // 正在播放的一次性音效源

  var listener = { x: 0, y: 0 };
  var underwater = false;
  var filterHz = 20000;

  var ambient = new Map();     // key -> voice（环境音，最多 20）
  var AMBIENT_CAP = 20;
  var AMBIENT_MAX = { water: 260, smoke: 220, gravity: 240, flammable: 200, laser: 300 };

  var laserSegCache = {};      // index -> {t, seg, ref}
  var renderPending = 0;

  var warmReady = true;        // 预热是否已完成（无预热任务时为 true）
  var warmPending = false;     // 是否有预热任务在进行

  var noiseBuffer = null;

  /* ------------------------------------------------------------------ */
  /* 上下文 / 音频图                                                     */
  /* ------------------------------------------------------------------ */
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
    return ctx;
  }

  function makeLimiterCurve() {
    var n = 1024, c = new Float32Array(n), k = Math.tanh(1.3);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.3) / k;
    }
    return c;
  }

  function buildGraph() {
    if (built || !ctx) return;
    master = ctx.createGain(); master.gain.value = 1;
    limiter = ctx.createWaveShaper(); limiter.curve = makeLimiterCurve(); limiter.oversample = '2x';
    master.connect(limiter); limiter.connect(ctx.destination);

    /* 音乐：musicBus -> musicFilter(轻低通) -> master */
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.7;
    musicFilter.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicVolume;
    musicBus.connect(musicFilter);

    /* 音效：sfxBus -> dry/wet -> sfxUnder(水下低通) -> sfxTame(削刺耳高架) -> master */
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVolume;
    sfxUnder = ctx.createBiquadFilter();
    sfxUnder.type = 'lowpass'; sfxUnder.frequency.value = 20000; sfxUnder.Q.value = 0.7;
    /* sfxTame：固定不动的高架衰减，专门压掉 4kHz 以上的"白噪感/毛刺"，
       让音效听着柔和不刺耳。与水下低通彼此独立，不影响 underwater 判据。 */
    sfxTame = ctx.createBiquadFilter();
    sfxTame.type = 'highshelf'; sfxTame.frequency.value = 4500; sfxTame.gain.value = -6;
    sfxDry = ctx.createGain(); sfxDry.gain.value = 1;
    sfxWet = ctx.createGain(); sfxWet.gain.value = 0;
    sfxDelay = ctx.createDelay(1.0); sfxDelay.delayTime.value = 0.035;
    sfxFeedback = ctx.createGain(); sfxFeedback.gain.value = 0.32;

    sfxBus.connect(sfxDry); sfxDry.connect(sfxUnder); sfxUnder.connect(sfxTame); sfxTame.connect(master);
    sfxBus.connect(sfxDelay);
    sfxDelay.connect(sfxFeedback); sfxFeedback.connect(sfxDelay); // 反馈回路
    sfxDelay.connect(sfxWet); sfxWet.connect(sfxUnder);

    built = true;
  }

  function ensureReady() {
    if (!ctx) ensureCtx();
    if (ctx && !built) buildGraph();
    return ctx;
  }

  function createBuf(channels, length, sampleRate) {
    if (ctx && ctx.createBuffer) return ctx.createBuffer(channels, length, sampleRate);
    if (typeof AudioBuffer !== 'undefined') {
      return new AudioBuffer({ numberOfChannels: channels, length: length, sampleRate: sampleRate });
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 特征提取 / 种子                                                     */
  /* ------------------------------------------------------------------ */
  /* 从 level（lv 或 Play）中提取 canonical 特征：
   *   背景图层数 + 每种 shape 数量 + 所有 color/color2/glowColor 计数（排序） */
  function extractFeatures(level) {
    var layers = (level && level.backgrounds) ? level.backgrounds : [];
    var shapeCounts = {}, colorCounts = {};
    for (var i = 0; i < layers.length; i++) {
      var bg = layers[i];
      var shapes = (bg && bg.shapes) ? bg.shapes : [];
      for (var j = 0; j < shapes.length; j++) {
        var sh = shapes[j];
        if (!sh) continue;
        var st = sh.shape || sh.type || 'unknown';
        shapeCounts[st] = (shapeCounts[st] || 0) + 1;
        var keys = ['color', 'color2', 'glowColor'];
        for (var c = 0; c < keys.length; c++) {
          var v = sh[keys[c]];
          if (v != null && v !== '') colorCounts[v] = (colorCounts[v] || 0) + 1;
        }
      }
    }
    return { layerCount: layers.length, shapeCounts: shapeCounts, colorCounts: colorCounts };
  }

  /* 关卡的“可辨识特征串”：把编辑器导出 JSON 里的**设计数据**全部纳入，
     让种子真正反映这一关的内容（元素构成/数量/机关/房间数/相机/手感/背景）。
     音乐只依赖这个特征串，而不是任何人工按关卡名写死的配置。 */
  function canonicalFeature(level) {
    if (!level) return 'EMPTY';
    var parts = [];
    var f = extractFeatures(level);
    parts.push('L' + f.layerCount);
    var sk = Object.keys(f.shapeCounts).sort();
    parts.push('S' + sk.map(function (k) { return k + ':' + f.shapeCounts[k]; }).join(','));
    var ck = Object.keys(f.colorCounts).sort();
    parts.push('C' + ck.map(function (k) { return k + ':' + f.colorCounts[k]; }).join(','));
    /* 实体构成（决定“音乐能量/密度/律动气质”） */
    var els = level.elements || [];
    var counts = {};
    for (var i = 0; i < els.length; i++) {
      var t = (els[i] && (els[i].type || els[i].kind)) || 'x';
      counts[t] = (counts[t] || 0) + 1;
    }
    var ek = Object.keys(counts).sort();
    parts.push('E' + ek.map(function (k) { return k + ':' + counts[k]; }).join(','));
    parts.push('N' + els.length);
    parts.push('M' + ((level.chambers && level.chambers.length) || 0));
    if (level.camera) parts.push('K' + JSON.stringify(level.camera));
    if (level.initialLives != null) parts.push('V' + level.initialLives);
    if (level.initialFlags != null) parts.push('F' + level.initialFlags);
    if (level.feel) parts.push('G' + [level.feel.gravity, level.feel.maxWalkSpeed, level.feel.jumpMaxHeight].join(','));
    return parts.join('|');
  }

  /* 双哈希派生确定性种子字符串 */
  function levelSeed(level) {
    var canon = canonicalFeature(level);
    var h1 = hashStr(canon, 0x811c9dc5);
    var h2 = hashStr(canon + '#2', 0x9e3779b9);
    return toHex32(h1) + toHex32(h2);
  }

  /* ------------------------------------------------------------------ */
  /* 谱面生成（确定性）                                                   */
  /* ------------------------------------------------------------------ */
  /* 音阶语汇（乐器/调式集合，非按关卡配置；由种子挑选其中一个） */
  var SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentaMajor: [0, 2, 4, 7, 9],      /* 国风：宫调五声 */
    pentaYo: [0, 2, 3, 7, 8],         /* 和风：都节/阳旋法 */
    blues: [0, 3, 5, 6, 7, 10],       /* 蓝调音阶 */
    dorian: [0, 2, 3, 5, 7, 9, 10],   /* 多利亚 */
    mixolydian: [0, 2, 4, 5, 7, 9, 10]/* 混合利底亚 */
  };

  /* 16 分音符网格记法：'.'/' ' = 静音，'1'..'9' = 力度，'x' = 0.6 */
  function gridHit(s, i) {
    var c = s.charAt(i);
    if (c === '.' || c === ' ') return 0;
    if (c === 'x' || c === 'X') return 0.6;
    var d = c.charCodeAt(0) - 48;
    return (d >= 1 && d <= 9) ? d / 9 : 0;
  }

  /* ==================================================================
     音乐生成器（种子驱动）
     ------------------------------------------------------------------
     设计原则：**不存在按关卡名/关卡配置写死的音乐**。
       · 种子 = levelSeed(level)，由编辑器导出的关卡数据（背景/实体构成/机关/
         房间数/相机/手感）经双哈希派生 → 见 canonicalFeature()。
       · 下面的 STYLES / PROGS 是“音乐语汇库”（和弦/律动/音色素材），
         不是关卡配置。种子从语汇库里**确定性地挑选并参数化**每一项：
         选哪套律动、速度多少、音阶、音色、摇摆量、进行、密度……
       · 关卡数据还会**调制**速度/密度/调式明暗，让音乐呼应关卡气质。
     因此不同关卡会得到不同曲风，且同一关每次结果完全一致（确定性）。
     ================================================================== */
  var STYLES = {
    rock: {
      name: '摇滚', tempo: 120, scalePool: ['minor', 'dorian', 'mixolydian'], swingPool: [0, 0],
      leadPool: ['saw', 'square'], bassPool: ['saw', 'square'], drive: 0.85, density: 0.60,
      kickPool: ['9.......9...7...', '9...9...9...9...', '9.......9.......'],
      snarePool: ['....8.......8...', '....8...7...8...'], hatPool: ['x.x.x.x.x.x.x.x.', 'x.xxx.x.x.xxx.x.'],
      padPool: [0, 0, 0.03], progs: [[0, 5, 3, 4], [0, 3, 4, 4], [5, 3, 0, 4]]
    },
    blues: {
      name: '蓝调', tempo: 96, scalePool: ['blues', 'minor'], swingPool: [0.12, 0.18, 0.24],
      leadPool: ['square', 'tri'], bassPool: ['sine', 'tri'], drive: 0.3, density: 0.48,
      kickPool: ['9.......8.......', '9.....7.9.......'], snarePool: ['....7.......7...', '....6.......6...'],
      hatPool: ['.x..x.x..x..x.x.', '..x...x...x...x.'], padPool: [0, 0.05],
      progs: [[0, 0, 0, 0], [0, 3, 0, 4], [0, 0, 3, 0]]
    },
    jazz: {
      name: '爵士', tempo: 112, scalePool: ['major', 'dorian', 'mixolydian'], swingPool: [0.22, 0.28, 0.34],
      leadPool: ['tri', 'sine'], bassPool: ['tri', 'sine'], drive: 0.35, density: 0.66,
      kickPool: ['8.......x.......', '8...8...........'], snarePool: ['....5.......5...', '....4.......5...'],
      hatPool: ['x.xxx.x.x.xxx.x.', 'x.x.x.x.x.x.x.x.'], padPool: [0, 0.04],
      progs: [[0, 3, 4, 3], [0, 4, 3, 3], [5, 3, 4, 0]]
    },
    classical: {
      name: '古典', tempo: 84, scalePool: ['major', 'minor'], swingPool: [0],
      leadPool: ['sine', 'tri'], bassPool: ['sine'], drive: 0, density: 0.72,
      kickPool: ['7...............', '9.......7.......'], snarePool: ['', '................'],
      hatPool: ['', '....x.......x...'], padPool: [0.10, 0.14, 0.18],
      progs: [[0, 4, 5, 3], [0, 3, 4, 0], [0, 5, 3, 4]]
    },
    electronic: {
      name: '电子', tempo: 124, scalePool: ['minor', 'dorian'], swingPool: [0],
      leadPool: ['saw', 'square'], bassPool: ['square', 'saw'], drive: 0.9, density: 0.70,
      kickPool: ['9...9...9...9...', '9.......9...9...'], snarePool: ['....7.......7...', '....x.......x...'],
      hatPool: ['..x...x...x...x.', 'x.xxx.xxx.xxx.xx'], padPool: [0.05, 0.09],
      progs: [[0, 5, 3, 4], [0, 3, 4, 5], [5, 3, 0, 4]]
    },
    cyberpunk: {
      name: '赛博朋克', tempo: 134, scalePool: ['minor', 'dorian'], swingPool: [0],
      leadPool: ['square', 'saw'], bassPool: ['saw', 'square'], drive: 0.95, density: 0.78,
      kickPool: ['9...9...9...9...', '9..9..9..9..9..9'], snarePool: ['....x.......x...', '....x...x...x...'],
      hatPool: ['x.xxx.xxx.xxx.xx', 'xxxxxxxxxxxxxxxx'], padPool: [0.07, 0.11],
      progs: [[0, 5, 3, 4], [0, 0, 5, 4], [5, 3, 4, 0]]
    },
    rnb: {
      name: '节奏布鲁斯', tempo: 78, scalePool: ['minor', 'dorian'], swingPool: [0.08, 0.12, 0.16],
      leadPool: ['sine', 'tri'], bassPool: ['sine', 'tri'], drive: 0.25, density: 0.46,
      kickPool: ['9.......7...x...', '9.....7...x.....'], snarePool: ['....6.......6...', '....5.......6...'],
      hatPool: ['..x...x...x...x.', '.x..x.x..x..x.x.'], padPool: [0.06, 0.10],
      progs: [[0, 3, 5, 4], [0, 4, 3, 3], [5, 4, 0, 3]]
    },
    pop: {
      name: '流行', tempo: 116, scalePool: ['major', 'pentaMajor'], swingPool: [0, 0.05],
      leadPool: ['tri', 'sine'], bassPool: ['sine', 'tri'], drive: 0.4, density: 0.62,
      kickPool: ['9...9...9...9...', '9.......9...7...'], snarePool: ['....7.......7...', '....6.......7...'],
      hatPool: ['..x...x...x...x.', '.x..x...x..x....'], padPool: [0.04, 0.08],
      progs: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 4, 0]]
    },
    folk: {
      name: '民谣', tempo: 90, scalePool: ['major', 'mixolydian', 'pentaMajor'], swingPool: [0, 0.06],
      leadPool: ['tri', 'sine'], bassPool: ['sine'], drive: 0.15, density: 0.56,
      kickPool: ['7.......7.......', '9.......7.......'], snarePool: ['........5.......', '........x.......'],
      hatPool: ['', '....x.......x...'], padPool: [0.05, 0.09],
      progs: [[0, 4, 5, 3], [0, 3, 4, 0], [0, 5, 3, 4]]
    },
    country: {
      name: '乡村', tempo: 104, scalePool: ['major', 'mixolydian', 'pentaMajor'], swingPool: [0.08, 0.14],
      leadPool: ['tri', 'sine'], bassPool: ['sine', 'tri'], drive: 0.3, density: 0.54,
      kickPool: ['9...7...9...7...', '9.......9.......'], snarePool: ['....8...7...8...', '....7.......8...'],
      hatPool: ['.x..x..x.x..x..x', '..x...x...x...x.'], padPool: [0, 0.04],
      progs: [[0, 0, 4, 4], [0, 3, 4, 0], [0, 4, 0, 5]]
    },
    guofeng: {
      name: '国风', tempo: 92, scalePool: ['pentaMajor', 'pentaYo', 'major'], swingPool: [0, 0.04],
      leadPool: ['tri', 'sine'], bassPool: ['sine', 'tri'], drive: 0.1, density: 0.50,
      kickPool: ['9.......7.......', '9.......9.......'], snarePool: ['........x.......', '................'],
      hatPool: ['....5.......5...', '..x...x...x...x.'], padPool: [0.09, 0.13, 0.17],
      progs: [[0, 4, 3, 0], [0, 3, 4, 0], [4, 3, 0, 0]]
    },
    japanese: {
      name: '和风', tempo: 100, scalePool: ['pentaYo', 'pentaMajor', 'minor'], swingPool: [0, 0],
      leadPool: ['tri', 'sine'], bassPool: ['tri', 'sine'], drive: 0.15, density: 0.44,
      kickPool: ['9.......9.......', '9.......7.......'], snarePool: ['........6.......', '........x.......'],
      hatPool: ['..x...x...x...x.', '....x.......x...'], padPool: [0.08, 0.12],
      progs: [[0, 4, 3, 0], [0, 0, 3, 4], [3, 4, 0, 0]]
    }
  };
  var STYLE_KEYS = Object.keys(STYLES);

  function pickFrom(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  /* 从关卡 JSON 提取“音乐相关”特征（全部来自数据，无人工配置）：
     energy=整体能量(元素/机关越多越激昂) · hazard=危险物占比 · bright=背景明度 ·
     roomy=空间感(水/背景层) · bars=结构长度(房间数) */
  function deriveMusicFeatures(level) {
    var els = (level && level.elements) || [];
    var f = extractFeatures(level || {});
    var cols = Object.keys(f.colorCounts || {});
    var lum = 0, n = 0;
    for (var c = 0; c < cols.length; c++) {
      var hex = cols[c];
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
      lum += (0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16)) / 255; n++;
    }
    var bright = n ? lum / n : 0.5;
    var hazardSet = { spike: 1, fallingSpike: 1, laserDown: 1, laserUp: 1, laser: 1, flammable: 1, smoke: 1, disappear: 1 };
    var hazards = 0, water = 0;
    for (var i = 0; i < els.length; i++) {
      var t = els[i] && (els[i].type || els[i].kind);
      if (hazardSet[t]) hazards++;
      if (t === 'water') water++;
    }
    var energy = Math.min(1, els.length / 40);
    var hazard = els.length ? hazards / els.length : 0;
    var roomy = Math.min(1, ((level && level.backgrounds && level.backgrounds.length) || 0) / 5 * 0.6 + (water ? 0.4 : 0));
    var rooms = (level && level.chambers && level.chambers.length) || 0;
    /* 结构长度：给 4 段动态编排留足空间（更长的循环也更耐听） */
    var bars = rooms >= 4 ? 32 : (rooms >= 2 ? 32 : 24);
    return { energy: energy, hazard: hazard, bright: bright, roomy: roomy, bars: bars, count: els.length };
  }

  /* 调内音级 → 相对调根的半音偏移（负数音级自动跨八度） */
  function degSemi(scale, deg) {
    var L = scale.length, o = Math.floor(deg / L), i = ((deg % L) + L) % L;
    return scale[i] + 12 * o;
  }
  /* 调内音级 → MIDI（负数音级自动跨八度） */
  function degMidi(scale, keyRoot, octBase, deg) {
    var L = scale.length, o = Math.floor(deg / L), i = ((deg % L) + L) % L;
    return keyRoot + octBase + scale[i] + 12 * o;
  }
  /* 动机：从和弦锚音出发、级进为主的“音级偏移”序列（带音域约束与拱形走向，避免乱跳）。
     级进权重 0.82，跳进只用 2/3 度且跳后回归，保证旋律平顺、可记忆。 */
  function buildMotif(rng, len) {
    var m = [rng() < 0.5 ? 0 : 2];
    var dir = rng() < 0.5 ? 1 : -1;                    /* 动机整体走向（拱形感） */
    for (var i = 1; i < len; i++) {
      var r = rng(), st;
      if (r < 0.82) st = dir * (rng() < 0.75 ? 1 : 2); /* 以级进为主，偶带二度 */
      else st = dir * (rng() < 0.5 ? 2 : 3);           /* 少量跳进强调高点 */
      if (rng() < 0.35) dir = -dir;                    /* 走向偶尔反转形成波峰波谷 */
      var nx = m[i - 1] + st;
      if (nx > 5) nx = m[i - 1] - Math.abs(st);        /* 音域上限：回落 */
      if (nx < -3) nx = m[i - 1] + Math.abs(st);       /* 音域下限：回升 */
      m.push(nx);
    }
    return m;
  }

  /* 音乐生成：种子 + 关卡特征 → 谱面。
     乐理约束：旋律由“和弦锚定的动机”构成并按乐句重复/变化（成句、可记忆、
     不杂乱）；正拍落和弦音保证谐和；低音+琶音+铺底+主旋律+鼓 = 有层次；
     乐句末尾留白产生呼吸与情感起伏。 */
  function compose(kind, level) {
    var seedStr, seedNum;
    if (kind === 'menu') { seedStr = 'MENU_V4'; seedNum = hashStr(seedStr, 0x1234abcd); }
    else if (kind === 'pause') { seedStr = 'PAUSE_V4'; seedNum = hashStr(seedStr, 0x77aa33cc); }
    else { seedStr = levelSeed(level); seedNum = hashStr(seedStr, 0x2545f491); }

    var rng = mulberry32(seedNum);
    var F = (kind === 'level') ? deriveMusicFeatures(level) : { energy: 0.4, hazard: 0.1, bright: 0.5, roomy: 0.4, bars: 16, count: 20 };

    var gkey, G;
    if (level && level.__forceStyle && STYLES[level.__forceStyle]) gkey = level.__forceStyle;   /* 仅测试用覆盖 */
    else if (kind === 'menu') gkey = 'jazz';
    else if (kind === 'pause') gkey = 'classical';
    else gkey = STYLE_KEYS[Math.floor(rng() * STYLE_KEYS.length)];
    G = STYLES[gkey];

    var energyBias = (F.energy - 0.4) * 18 + F.hazard * 14;
    var BPM = clamp(Math.round(G.tempo + (rng() * 2 - 1) * 7 + energyBias), 64, 150);

    var BARS = F.bars;
    var BEAT = 60 / BPM, BAR = BEAT * 4, SIX = BEAT / 4, DUR = BAR * BARS;
    var swing = pickFrom(rng, G.swingPool);

    var scaleName = pickFrom(rng, G.scalePool);
    if (F.bright > 0.6 && G.scalePool.indexOf('major') >= 0 && rng() < 0.6) scaleName = 'major';
    else if (F.bright < 0.3 && G.scalePool.indexOf('minor') >= 0 && rng() < 0.6) scaleName = 'minor';
    var scale = SCALES[scaleName] || SCALES.minor;

    var keyRoot = 45 + Math.floor(rng() * 12);
    var pat = pickFrom(rng, G.progs);
    var chords = [];
    for (var ci = 0; ci < 4; ci++) {
      var d = pat[ci];
      var semis = [degSemi(scale, d), degSemi(scale, d + 2), degSemi(scale, d + 4)];
      chords.push({ deg: d, root: keyRoot + semis[0], semis: semis });
    }

    var leadWave = pickFrom(rng, G.leadPool), bassWave = pickFrom(rng, G.bassPool);
    var padAmp = pickFrom(rng, G.padPool);
    var drive = rng() < G.drive;
    var timbre = {
      leadWave: leadWave, leadHarm: 0.2 + rng() * 0.3, leadDecay: 1.8 + rng() * 1.6,
      bassWave: bassWave, bassHarm: 0.3 + rng() * 0.28, bassDecay: 1.2 + rng() * 0.7,
      padWave: pickFrom(rng, ['sine', 'tri', 'saw'])
    };
    var density = clamp(G.density * (0.85 + F.energy * 0.35) + (rng() * 2 - 1) * 0.06, 0.3, 0.85);
    var useArp = rng() < (0.5 + F.energy * 0.25);

    /* 动机 A/B（重复 + 变化 构成 A-A'-B-A'' 乐句结构） */
    var motifA = buildMotif(rng, 3 + Math.floor(rng() * 3));
    var motifB = buildMotif(rng, 3 + Math.floor(rng() * 3));

    var events = [];
    function gtime(barStart, slot) { return barStart + slot * SIX + ((slot % 2 === 1) ? swing * SIX : 0); }

    /* --- 编排：4 段式动态弧线。arc[i] = 该段“强度”，决定声部进出、力度与密度，
       从而产生起伏、呼吸与情感（而不是从头到尾所有乐器一起轰）。 --- */
    var SEC_N = 4, SEC_LEN = Math.max(1, Math.round(BARS / SEC_N));
    var arcPool = [[0.22, 0.5, 0.82, 1.0], [0.32, 0.58, 0.92, 0.7], [0.4, 0.62, 0.85, 1.0], [0.18, 0.44, 0.72, 0.98]];
    var arc = pickFrom(rng, arcPool).slice();
    for (var ai = 0; ai < SEC_N; ai++) arc[ai] = clamp(arc[ai] * (0.86 + F.energy * 0.4), 0.14, 1.12);
    function secOf(bar) { var s = Math.floor(bar / SEC_LEN); return s > SEC_N - 1 ? SEC_N - 1 : s; }

    /* --- 低音：稳定骨架（全程持续，但力度随段强度起伏） --- */
    for (var b = 0; b < BARS; b++) {
      var chord = chords[b % 4], barT = b * BAR, bi = arc[secOf(b)];
      var broot = keyRoot + chord.semis[0] - 12;
      if (drive) {
        for (var bs = 0; bs < 8; bs++) events.push({ t: gtime(barT, bs * 2), dur: SIX * 1.5, voice: 'bass', midi: broot, vel: (bs % 2 ? 0.22 : 0.32) * bi });
      } else {
        events.push({ t: barT, dur: SIX * 6, voice: 'bass', midi: broot, vel: 0.38 * bi });
        events.push({ t: barT + BEAT * 2, dur: SIX * 6, voice: 'bass', midi: broot, vel: 0.30 * bi });
        if (b % 4 === 3) events.push({ t: barT + BEAT * 3, dur: SIX * 5, voice: 'bass', midi: broot + 7, vel: 0.26 * bi });
      }
    }

    /* --- 主旋律：乐句式旋律线条。
       核心：以“音级随机游走”产生级进为主的线条（±1 为主，偶有 ±2 跳进，跳后回归），
       强拍只把当前音级“就近 ±1”吸附到和弦音（既保和声又不破坏级进），
       乐句终止落主和弦根收束。节奏用短语槽位，低强度段更稀疏 → 有呼吸、有情感。 --- */
    var RHY_SPARSE = [[0, 4, 8, 12], [0, 6, 8, 12], [0, 4, 10, 12], [0, 8, 12]];
    var RHY_MID = [[0, 2, 4, 8, 12], [0, 4, 6, 8, 12, 14], [0, 2, 4, 7, 8, 12], [0, 3, 6, 8, 12]];
    var RHY_FULL = [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 7, 8, 10, 12, 14], [0, 2, 3, 4, 8, 10, 12, 14]];
    function p8(ph, sl) { return ph * BAR + sl * (BEAT / 2) + ((sl % 2) ? swing * (BEAT / 2) : 0); }
    var curDeg = 4;      /* 旋律当前音级（相对调内的“度”），从稳定音级起 */
    var walkDir = rng() < 0.5 ? 1 : -1;
    for (var ph = 0; ph < BARS; ph += 2) {
      var pchord = chords[ph % 4], pI = arc[secOf(ph)];
      var pool = pI < 0.42 ? RHY_SPARSE : (pI < 0.72 ? RHY_MID : RHY_FULL);
      if (ph >= BARS - 2) pool = RHY_SPARSE;                 /* 收尾乐句留白，为循环做铺垫 */
      var slots = pickFrom(rng, pool).slice();
      var cc = [pchord.deg, pchord.deg + 2, pchord.deg + 4];
      var octPh = (secOf(ph) === SEC_N - 1 && rng() < 0.5) ? 12 : 0;   /* 高潮段偶尔翻高八度 */
      for (var si = 0; si < slots.length; si++) {
        var sl = slots[si], isEnd = (si === slots.length - 1);
        var nxt = (si + 1 < slots.length) ? slots[si + 1] : 16;
        var strong = (sl % 4 === 0);
        /* 线条推进：级进为主（约 88% 为 ±1 度），偶有 ±2 度跳进并继续级进，
           临近音域边界自动回折；强拍就近吸附和弦音。整体形成平顺、可歌唱的线条。 */
        if (curDeg > 8) walkDir = -1; else if (curDeg < 3) walkDir = 1;
        var r = rng();
        if (r < 0.88) curDeg += walkDir;
        else curDeg += walkDir * (rng() < 0.7 ? 2 : 3);
        if (rng() < 0.28) walkDir = -walkDir;                /* 波峰波谷 */
        /* 强拍：就近（±1）吸附到和弦音，保持和声清晰但不破坏级进 */
        if (strong) {
          var bestNudge = 0, bestDist = 99;
          for (var c2 = 0; c2 < cc.length; c2++) {
            var gap = cc[c2] - curDeg;
            if (Math.abs(gap) < Math.abs(bestDist)) { bestDist = gap; bestNudge = gap; }
          }
          if (Math.abs(bestNudge) <= 1) curDeg += bestNudge;
        }
        /* 音域约束：柔和反射（而非硬折返），避免突兀大跳 */
        if (curDeg > 11) { curDeg = 11 - (curDeg - 11); walkDir = -1; }
        else if (curDeg < 0) { curDeg = -curDeg; walkDir = 1; }
        if (isEnd) {
          /* 乐句终止：吸附到“离当前最近”的主和弦音，保留线条连续 */
          var eBest = 0, eDist = 99;
          for (var e2 = 0; e2 < cc.length; e2++) { var eg = cc[e2] - curDeg; if (Math.abs(eg) < Math.abs(eDist)) { eDist = eg; eBest = e2; } }
          if (Math.abs(eDist) <= 2) curDeg += eDist;
        }
        var midi = degMidi(scale, keyRoot, 12 + octPh, curDeg);
        midi = clamp(midi, keyRoot + 7, keyRoot + 31);
        var dur = (nxt - sl) * (BEAT / 2) * (isEnd ? 1.0 : 0.92);   /* legato：连到下一个音 */
        if (isEnd) dur = (16 - sl) * (BEAT / 2) + BEAT * 0.5;       /* 终止长音，拖过乐句线 */
        var vel = (strong ? 0.5 : 0.4) * (0.68 + pI * 0.5);
        events.push({ t: p8(ph, sl), dur: dur, voice: 'melody', midi: midi, vel: vel });
      }
    }

    /* --- 琶音层：只在高潮段进入、且用四分分解（少量点缀），避免全程嘈杂 --- */
    if (useArp) {
      var arpCycle = [0, 1, 2, 1];
      for (var ab = 0; ab < BARS; ab++) {
        if (arc[secOf(ab)] < 0.7) continue;
        var ach = chords[ab % 4], abT = ab * BAR;
        var toneSet = [degMidi(scale, keyRoot, 24, ach.deg), degMidi(scale, keyRoot, 24, ach.deg + 2), degMidi(scale, keyRoot, 24, ach.deg + 4)];
        for (var as = 0; as < 4; as++)
          events.push({ t: abT + as * BEAT, dur: BEAT * 0.9, voice: 'arp', midi: toneSet[arpCycle[as]], vel: 0.07 + (as === 0 ? 0.03 : 0) });
      }
    }

    /* --- 和声铺底（pad）：柔和长音，力度随段强度轻微起伏 --- */
    if (padAmp > 0) {
      for (var pb = 0; pb < BARS; pb += 4) {
        var pch = chords[(pb / 4) % 4], pI2 = arc[secOf(pb)];
        for (var pi = 0; pi < pch.semis.length; pi++)
          events.push({ t: pb * BAR, dur: BAR * 3.85, voice: 'pad', midi: keyRoot + pch.semis[pi], vel: padAmp * (0.7 + pI2 * 0.5) });
      }
    }

    /* --- 鼓组：随编排进入（前段只有轻 hat，中后段才加入 kick/snare），力度随段起伏。
       hat 采用“8 分网格”为主，只有高能段才允许 16 分加花 —— 避免全程 16 分沙沙声。 --- */
    if (kind !== 'pause') {
      var kick = pickFrom(rng, G.kickPool), snare = pickFrom(rng, G.snarePool), hat = pickFrom(rng, G.hatPool);
      var grids = [['kick', kick], ['snare', snare], ['hat', hat]];
      for (var db = 0; db < BARS; db++) {
        var dI = arc[secOf(db)], dt0 = db * BAR;
        for (var gi = 0; gi < grids.length; gi++) {
          var voice = grids[gi][0], grid = grids[gi][1] || '';
          if (voice !== 'hat' && dI < 0.4) continue;          /* 前段先不加鼓，留白 */
          if (voice === 'hat' && dI < 0.3) continue;          /* 极安静段连 hat 也留白 */
          for (var gs = 0; gs < 16 && gs < grid.length; gs++) {
            var v = gridHit(grid, gs);
            if (v <= 0) continue;
            /* hat：只在 8 分位置；高能段才放开 16 分（增强律动又不嘈杂） */
            if (voice === 'hat' && (gs % 2 === 1) && dI < 0.85) continue;
            var vv = v * (voice === 'hat' ? (0.30 + 0.42 * dI) : (0.5 + 0.45 * dI));
            events.push({ t: gtime(dt0, gs), voice: 'drum', drum: voice, vel: vv });
          }
        }
        if (db % 4 === 3 && dI > 0.55) {
          for (var fi = 12; fi < 16; fi++)
            if (rng() < 0.4) events.push({ t: gtime(dt0, fi), voice: 'drum', drum: (fi % 2 ? 'snare' : 'kick'), vel: (0.26 + rng() * 0.16) * dI });
        }
      }
    }

    events.sort(function (a, b) { return a.t - b.t; });
    return {
      duration: DUR, seed: seedStr, events: events, bpm: BPM,
      genre: gkey, genreName: G.name, scale: scaleName, density: density, energy: F.energy,
      keyRoot: keyRoot, progDegs: pat.slice(), swing: swing,
      timbre: {
        leadWave: timbre.leadWave, leadHarm: timbre.leadHarm, leadDecay: timbre.leadDecay,
        bassWave: timbre.bassWave, bassHarm: timbre.bassHarm, bassDecay: timbre.bassDecay,
        padWave: timbre.padWave
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 音乐合成：直接 JS 生成 PCM，尾音模长度折叠回开头                     */
  /* ------------------------------------------------------------------ */
  /* 波形求值：sine 用少量谐波加厚；saw/square 用有限谐波叠加做“带限”，
     既保留该曲风的音色辨识度，又不会产生刺耳的混叠毛刺。
     —— 性能：把每种波形预烘焙成波表（一次），合成时按相位查表插值，
     避免每个采样点做 8 次 Math.sin（这是进场卡顿的主因）。 */
  var WAVE_TABLE_N = 2048;
  var _waveTables = {};
  function rawWave(ph, wave, harm) {
    if (wave === 'saw') {
      var s = 0, h = 1;
      while (h <= 8) { s += Math.sin(ph * h) / h; h++; }
      return s * 0.62;
    }
    if (wave === 'square') {
      var q = 0, g = 1;
      while (g <= 9) { q += Math.sin(ph * g) / g; g += 2; }
      return q * 0.72;
    }
    if (wave === 'tri') {
      var tr = 0, k = 0, sign = 1;
      for (k = 0; k < 4; k++) { tr += sign * Math.sin(ph * (2 * k + 1)) / ((2 * k + 1) * (2 * k + 1)); sign = -sign; }
      return tr * 1.23;
    }
    return Math.sin(ph) + harm * 0.4 * Math.sin(ph * 2) + harm * 0.12 * Math.sin(ph * 3);
  }
  function getWaveTable(wave, harm) {
    var w = wave || 'sine';
    var hq = (w === 'sine') ? Math.round((harm || 0) * 50) / 50 : 0;   // 仅 sine 依赖 harm
    var key = w + '|' + hq;
    var t = _waveTables[key];
    if (t) return t;
    var N = WAVE_TABLE_N;
    var tab = new Float32Array(N + 1);
    for (var i = 0; i < N; i++) tab[i] = rawWave(2 * Math.PI * i / N, w, hq);
    tab[N] = tab[0];                 // 便于线性插值的末端
    _waveTables[key] = tab;
    return tab;
  }
  /* 相位用 [0,1) 归一化小数表示，直接映射到波表，避免大数相位精度损失 */
  function waveSampleFrac(frac, wave, harm) {
    var tab = getWaveTable(wave, harm);
    var x = frac * WAVE_TABLE_N;
    var i0 = x | 0;
    var fr = x - i0;
    var a = tab[i0], b = tab[i0 + 1];
    return a + (b - a) * fr;
  }

  function mixTone(L, R, sr, t0, dur, freq, amp, pan, harm, attack, decay, wave) {
    var len = L.length;
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    var atk = Math.max(1, attack * sr);
    var phFrac = 0;
    var twoPi = 2 * Math.PI;
    var dstep = 1 / sr;
    var dm = Math.exp(-decay * dstep);      // 逐步衰减，替代每采样 Math.exp
    var dec = 1;
    var vibStep = twoPi * 5 * dstep, vibPh = 0;
    for (var i = 0; i < n; i++) {
      /* 轻微颤音（每采样一次 sin，代价可接受） */
      vibPh += vibStep;
      var f = freq * (1 + 0.0025 * Math.sin(vibPh));
      phFrac += f * dstep;
      if (phFrac >= 1) phFrac -= Math.floor(phFrac);
      var s = waveSampleFrac(phFrac, wave, harm);
      var env = (i < atk ? i / atk : 1) * dec;
      dec *= dm;
      var tail = (n - i) < 60 ? (n - i) / 60 : 1;
      var v = s * amp * env * tail;
      var li = (i0 + i) % len; if (li < 0) li += len;
      L[li] += v * gl; R[li] += v * gr;
    }
  }

  /* 低分辨率长音（pad 等“慢速无瞬态”声部用）：
     每 div 个输出样本只在粗网格上求一次值，其间线性插值。
     对柔和的和声铺底完全听不出差别，但 CPU 降为 1/div（进场卡顿的关键优化）。 */
  function mixToneDecim(L, R, sr, t0, dur, freq, amp, pan, harm, attack, decay, wave, div) {
    var len = L.length;
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    var atk = Math.max(1, attack * sr);
    var coarse = Math.ceil(n / div);
    if (coarse < 2) { mixTone(L, R, sr, t0, dur, freq, amp, pan, harm, attack, decay, wave); return; }
    var phFrac = 0, vibPh = 0;
    var twoPi = 2 * Math.PI;
    var cstep = div / sr;                    // 粗网格时间步
    var vibStep = twoPi * 5 * cstep;
    var dm = Math.exp(-decay * cstep);
    var dec = 1;
    var prev = 0, hasPrev = false;
    for (var c = 0; c < coarse; c++) {
      var i = c * div;
      var t = i / sr;
      vibPh += vibStep;
      var f = freq * (1 + 0.0025 * Math.sin(vibPh));
      phFrac += f * cstep;
      if (phFrac >= 1) phFrac -= Math.floor(phFrac);
      var s = waveSampleFrac(phFrac, wave, harm);
      var env = (i < atk ? i / atk : 1) * dec;
      dec *= dm;
      var tll = (n - i) < 60 ? (n - i) / 60 : 1;
      var v = s * amp * env * tll;
      /* 在 prev→v 之间线性填充分段 */
      var steps = Math.min(div, n - i);
      var step = hasPrev ? (v - prev) / steps : 0;
      for (var q = 0; q < steps; q++) {
        var vv = hasPrev ? (prev + step * (q + 1)) : v;
        var li = (i0 + i + q) % len; if (li < 0) li += len;
        L[li] += vv * gl; R[li] += vv * gr;
      }
      prev = v; hasPrev = true;
    }
  }

  function mixKick(L, R, sr, t0, amp) {
    var len = L.length, i0 = Math.round(t0 * sr), n = Math.round(0.20 * sr), ph = 0;
    var k = Math.SQRT1_2;
    var twoPi = 2 * Math.PI, dstep = 1 / sr;
    var fm = Math.exp(-28 * dstep), em = Math.exp(-11 * dstep);   // 逐步衰减
    var fEnv = 1, eEnv = 1;
    for (var i = 0; i < n; i++) {
      var f = 120 * fEnv + 42;
      fEnv *= fm;
      ph += twoPi * f * dstep;
      var v = Math.sin(ph) * amp * eEnv;
      eEnv *= em;
      var li = (i0 + i) % len; if (li < 0) li += len;
      L[li] += v * k; R[li] += v * k;
    }
  }

  function mixNoise(L, R, sr, t0, dur, amp, lp, decay, pan, srng, hp) {
    var len = L.length, i0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    var y = 0, py = 0;
    var em = Math.exp(-decay / sr), env = 1;      // 逐步衰减，替代每采样 Math.exp
    for (var i = 0; i < n; i++) {
      var w = srng() * 2 - 1;
      y += (w - y) * lp;
      var s = hp ? (y - py) : y; py = y;
      var v = s * amp * env;
      env *= em;
      var li = (i0 + i) % len; if (li < 0) li += len;
      L[li] += v * gl; R[li] += v * gr;
    }
  }

  function onePoleLP(buf, coef) {
    // Warm the filter from the end of the ring so its state is periodic at sample 0.
    var y = 0;
    for (var k = Math.max(0, buf.length - 4096); k < buf.length; k++) y += (buf[k] - y) * coef;
    for (var i = 0; i < buf.length; i++) { y += (buf[i] - y) * coef; buf[i] = y; }
  }

  /* ------------------------------------------------------------------
     状态化声部发生器（voice generators）
     每个音符/鼓点封装成一个可“续算”的发生器：render(L,R,until) 只把它
     负责的样本从当前进度写到 until。这样整段音乐可以按极小的“时间窗”
     分帧生成，单帧开销有上界（不受长音长度影响）→ 进场不再卡顿。
     采用固定时间窗顺序推进，产物与一次性合成完全一致（确定性）。
     ------------------------------------------------------------------ */
  function panGL(pan) { return Math.cos((pan + 1) * Math.PI / 4); }
  function panGR(pan) { return Math.sin((pan + 1) * Math.PI / 4); }

  function makeToneGen(sr, len, t0sec, dur, freq, amp, pan, harm, attack, decay, wave) {
    var t0 = Math.round(t0sec * sr);
    var n = Math.max(1, Math.round(dur * sr));
    var endS = t0 + n;
    var gl = panGL(pan), gr = panGR(pan);
    var atk = Math.max(1, attack * sr);
    var twoPi = 2 * Math.PI, dstep = 1 / sr;
    var dm = Math.exp(-decay * dstep), dec = 1;
    var vibStep = twoPi * 5 * dstep, vibPh = 0;
    var phFrac = 0, pos = t0;
    var g = {
      pos: t0, end: endS,
      render: function (L, R, until) {
        var up = until < endS ? until : endS;
        var i = pos - t0;
        while (pos < up) {
          vibPh += vibStep;
          var f = freq * (1 + 0.0025 * Math.sin(vibPh));
          phFrac += f * dstep; if (phFrac >= 1) phFrac -= Math.floor(phFrac);
          var s = waveSampleFrac(phFrac, wave, harm);
          var env = (i < atk ? i / atk : 1) * dec; dec *= dm;
          var tail = (n - i) < 60 ? (n - i) / 60 : 1;
          var v = s * amp * env * tail;
          var li = pos % len; if (li < 0) li += len;
          L[li] += v * gl; R[li] += v * gr;
          pos++; i++;
        }
        g.pos = pos;
      }
    };
    return g;
  }

  /* 低分辨率长音：每 div 个样本只在粗网格求一次值，其间线性填充。
     对柔和和声铺底听感无异，CPU 降为 1/div。 */
  function makeToneDecimGen(sr, len, t0sec, dur, freq, amp, pan, harm, attack, decay, wave, div) {
    var t0 = Math.round(t0sec * sr);
    var n = Math.max(1, Math.round(dur * sr));
    var endS = t0 + n;
    var gl = panGL(pan), gr = panGR(pan);
    var atk = Math.max(1, attack * sr), twoPi = 2 * Math.PI;
    var cstep = div / sr, vibStep = twoPi * 5 * cstep, vibPh = 0;
    var dm = Math.exp(-decay * cstep), dec = 1;
    var phFrac = 0, pos = t0;
    var cIdx = 0, cFill = 0, prepared = false, prevInit = false, prevV = 0, curV = 0;
    function prepare() {
      var i = cIdx * div;
      vibPh += vibStep;
      var f = freq * (1 + 0.0025 * Math.sin(vibPh));
      phFrac += f * cstep; if (phFrac >= 1) phFrac -= Math.floor(phFrac);
      var s = waveSampleFrac(phFrac, wave, harm);
      var env = (i < atk ? i / atk : 1) * dec; dec *= dm;
      var tll = (n - i) < 60 ? (n - i) / 60 : 1;
      curV = s * amp * env * tll;
      prepared = true;
    }
    var g = {
      pos: t0, end: endS,
      render: function (L, R, until) {
        var up = until < endS ? until : endS;
        while (pos < up) {
          if (!prepared) prepare();
          var can = div - cFill, rem = up - pos;
          if (can > rem) can = rem;
          for (var q = 0; q < can; q++) {
            var vv = prevInit ? (prevV + (curV - prevV) * ((cFill + q + 1) / div)) : curV;
            var li = (pos + q) % len; if (li < 0) li += len;
            L[li] += vv * gl; R[li] += vv * gr;
          }
          cFill += can; pos += can;
          if (cFill >= div) { prevV = curV; prevInit = true; cIdx++; cFill = 0; prepared = false; }
        }
        g.pos = pos;
      }
    };
    return g;
  }

  function makeKickGen(sr, len, t0sec, amp) {
    var t0 = Math.round(t0sec * sr), n = Math.round(0.20 * sr), endS = t0 + n;
    var k = Math.SQRT1_2, ph = 0, dstep = 1 / sr;
    var fm = Math.exp(-28 * dstep), em = Math.exp(-11 * dstep), fEnv = 1, eEnv = 1;
    var pos = t0;
    var g = {
      pos: t0, end: endS,
      render: function (L, R, until) {
        var up = until < endS ? until : endS;
        while (pos < up) {
          var f = 120 * fEnv + 42; fEnv *= fm;
          ph += 2 * Math.PI * f * dstep;
          var v = Math.sin(ph) * amp * eEnv; eEnv *= em;
          var li = pos % len; if (li < 0) li += len;
          L[li] += v * k; R[li] += v * k;
          pos++;
        }
        g.pos = pos;
      }
    };
    return g;
  }

  function makeNoiseGen(sr, len, t0sec, dur, amp, lp, decay, pan, srng, hp) {
    var t0 = Math.round(t0sec * sr), n = Math.max(1, Math.round(dur * sr)), endS = t0 + n;
    var gl = panGL(pan), gr = panGR(pan);
    var y = 0, py = 0, em = Math.exp(-decay / sr), env = 1, pos = t0;
    var g = {
      pos: t0, end: endS,
      render: function (L, R, until) {
        var up = until < endS ? until : endS;
        while (pos < up) {
          var w = srng() * 2 - 1; y += (w - y) * lp;
          var s = hp ? (y - py) : y; py = y;
          var v = s * amp * env; env *= em;
          var li = pos % len; if (li < 0) li += len;
          L[li] += v * gl; R[li] += v * gr;
          pos++;
        }
        g.pos = pos;
      }
    };
    return g;
  }

  /* 一个谱面事件 → 一个或多个发生器（各事件相互独立、可并行续算） */
  function gensForEvent(sr, len, ev, T, srng) {
    var out = [];
    if (ev.voice === 'melody') {
      out.push(makeToneGen(sr, len, ev.t, ev.dur, midiToFreq(ev.midi), ev.vel * 0.5, -0.12, T.leadHarm, 0.008, T.leadDecay * 0.88, T.leadWave));
      out.push(makeToneGen(sr, len, ev.t + 0.004, ev.dur, midiToFreq(ev.midi) * 2.0, ev.vel * 0.11, 0.12, 0.3, 0.006, T.leadDecay * 1.25, 'sine'));
    } else if (ev.voice === 'bass') {
      out.push(makeToneGen(sr, len, ev.t, ev.dur, midiToFreq(ev.midi), ev.vel * 0.6, 0.0, T.bassHarm, 0.01, T.bassDecay, T.bassWave));
    } else if (ev.voice === 'arp') {
      /* 琶音：短促、清亮的三角/正弦，低音量铺在旋律之下做层次 */
      out.push(makeToneGen(sr, len, ev.t, ev.dur, midiToFreq(ev.midi), ev.vel, 0.18, 0.15, 0.006, 3.6, 'tri'));
    } else if (ev.voice === 'pad') {
      out.push(makeToneDecimGen(sr, len, ev.t, ev.dur, midiToFreq(ev.midi), ev.vel, 0.0, 0.25, 0.35, 0.4, T.padWave, 8));
      out.push(makeToneDecimGen(sr, len, ev.t, ev.dur, midiToFreq(ev.midi) * 1.5, ev.vel * 0.4, 0.0, 0.2, 0.5, 0.4, 'sine', 8));
    } else if (ev.voice === 'drum') {
      if (ev.drum === 'kick') out.push(makeKickGen(sr, len, ev.t, ev.vel * 0.85));
      else if (ev.drum === 'snare') {
        out.push(makeNoiseGen(sr, len, ev.t, 0.13, ev.vel * 0.55, 0.55, 16, 0.05, srng, false));
        out.push(makeToneGen(sr, len, ev.t, 0.09, 175, ev.vel * 0.2, 0.05, 0.2, 0.001, 18, 'sine'));
      } else {
        out.push(makeNoiseGen(sr, len, ev.t, 0.05, ev.vel * 0.32, 0.85, 42, 0.18, srng, true));
      }
    }
    return out;
  }

  /* 收尾：低通去毛刺 + 归一化防削波 → AudioBuffer */
  function finalizeTrack(L, R, sr, len) {
    var coef = 1 - Math.exp(-2 * Math.PI * 11000 / sr);
    onePoleLP(L, coef); onePoleLP(R, coef);
    var peak = 0;
    for (var s = 0; s < len; s++) {
      var a = Math.abs(L[s]); if (a > peak) peak = a;
      var b = Math.abs(R[s]); if (b > peak) peak = b;
    }
    if (peak > 0.9) { var g = 0.9 / peak; for (var q = 0; q < len; q++) { L[q] *= g; R[q] *= g; } }
    /* 无缝循环：把“尾部”等功率交叉淡入“头部”，再截去尾部。
       这样循环点两侧取自同一条连续波形，消除接缝咔哒声（各音轨首尾天然接近）。 */
    var CF = Math.round(sr * 0.012);   /* ≈12ms */
    if (len > CF * 3) {
      for (var i = 0; i < CF; i++) {
        var t = i / CF;                /* 0 → 1 */
        var j = len - CF + i;
        L[i] = L[i] * t + L[j] * (1 - t);
        R[i] = R[i] * t + R[j] * (1 - t);
      }
      len -= CF;
    }
    var buf = createBuf(2, len, sr);
    if (!buf) return null;
    if (buf.copyToChannel) { buf.copyToChannel(L.subarray(0, len), 0); buf.copyToChannel(R.subarray(0, len), 1); }
    else { buf.getChannelData(0).set(L.subarray(0, len)); buf.getChannelData(1).set(R.subarray(0, len)); }
    return buf;
  }

  var SYNTH_WINDOW = 1024;    // 每次推进的样本窗口（≈23ms 音频）

  /* 分片合成任务：按固定时间窗顺序推进；单次 step 受时间预算约束。 */
  function createSynthJob(chart, kind) {
    var sr = (ctx && ctx.sampleRate) ? ctx.sampleRate : 44100;
    var len = Math.max(1, Math.round(chart.duration * sr));
    var L = new Float32Array(len), R = new Float32Array(len);
    var srng = mulberry32(hashStr('synth:' + chart.seed + ':' + kind, 0x9e3779b9));
    var T = chart.timbre || { leadWave: 'sine', leadHarm: 0.5, leadDecay: 2.6, bassWave: 'sine', bassHarm: 0.65, bassDecay: 1.7, padWave: 'sine' };
    var evs = chart.events, ei = 0, pos = 0, active = [];
    return {
      step: function (budgetMs) {
        var t0 = now();
        while (pos < len) {
          var end = Math.min(len, pos + SYNTH_WINDOW);
          /* 激活本窗内开始的事件 */
          while (ei < evs.length && Math.round(evs[ei].t * sr) <= end) {
            var gs = gensForEvent(sr, len, evs[ei], T, srng);
            for (var z = 0; z < gs.length; z++) active.push(gs[z]);
            ei++;
          }
          /* 各活动声部推进到本窗末 */
          var keep = [];
          for (var a = 0; a < active.length; a++) {
            active[a].render(L, R, end);
            if (active[a].pos < active[a].end) keep.push(active[a]);
          }
          active = keep;
          pos = end;
          if (now() - t0 > budgetMs) break;
        }
        return pos >= len;
      },
      finish: function () { return finalizeTrack(L, R, sr, len); },
      progress: function () { return len ? pos / len : 1; }
    };
  }

  /* 同步合成（离线路径 renderTrack 用；内部同样走分片逻辑，结果与实时一致） */
  function synthesizeTrack(chart, kind) {
    var job = createSynthJob(chart, kind);
    var guard = 0;
    while (!job.step(1e9) && guard++ < 100000) { }
    return job.finish();
  }
  function touchCache(key) {
    var idx = musicCacheOrder.indexOf(key);
    if (idx >= 0) { musicCacheOrder.splice(idx, 1); musicCacheOrder.push(key); }
  }
  function evictCache() {
    while (musicCacheOrder.length > MUSIC_CACHE_MAX) {
      var k = musicCacheOrder.shift();
      delete musicCache[k];
    }
  }

  function getTrackBuffer(kind, level) {
    var chart = compose(kind, level);
    var key = kind + '|' + (chart.genre || '') + '|' + chart.seed;
    if (musicCache[key]) { touchCache(key); return { buf: musicCache[key], chart: chart }; }
    var buf = synthesizeTrack(chart, kind);
    if (buf) { musicCache[key] = buf; musicCacheOrder.push(key); evictCache(); }
    return { buf: buf, chart: chart };
  }

  function trackKey(kind, chart) { return kind + '|' + (chart.genre || '') + '|' + chart.seed; }

  /* ------------------------------------------------------------------ */
  /* 异步/分片音乐生产队列                                                */
  /* 进场时不再同步合成整段 PCM（会卡主线程数秒），改为在浏览器空闲帧里   */
  /* 每次只算 ~6ms，算完再起播；期间可先播上一场景的淡出，听感更连续。    */
  /* ------------------------------------------------------------------ */
  var synthJob = null;           // {kind, level, chart, key, job}
  var synthTimer = null;
  var pendingEnsure = null;      // ensureTrack 的 Promise（若有）
  var SYNTH_BUDGET_MS = 6;

  function cancelSynthJob() {
    if (synthTimer) { try { clearTimeout(synthTimer); } catch (e) { } synthTimer = null; }
    if (pendingEnsure && synthJob && synthJob._resolve) { try { synthJob._resolve(synthJob); } catch (e) { } }
    pendingEnsure = null;
    synthJob = null;
  }
  function pumpSynth() {
    synthTimer = null;
    if (!synthJob) return;
    var done = false;
    try { done = synthJob.job.step(SYNTH_BUDGET_MS); } catch (e) { done = true; }
    if (!done) { synthTimer = setTimeout(pumpSynth, 0); return; }
    var finished = synthJob, buf = finished.job.finish();
    synthJob = null;
    if (buf) {
      musicCache[finished.key] = buf; musicCacheOrder.push(finished.key); evictCache();
      /* ensureTrack 等待者：缓存就绪即 resolve */
      if (finished._resolve && pendingEnsure) { var pe = pendingEnsure; pendingEnsure = null; finished._resolve(finished); }
      /* 只有当场景未再变化、且确实需要这条轨时才起播 */
      else if (scene === finished.kind && sceneLevel === finished.level) {
        _startTrackFromBuffer(finished.kind, finished.chart, buf);
      }
    }
  }
  /* 请求播放某场景音乐：命中缓存即时播；否则排入分片任务异步生产 */
  function requestTrack(kind, level) {
    if (!built) return;
    var chart = compose(kind, level);
    var key = trackKey(kind, chart);
    if (musicCache[key]) {
      cancelSynthJob();
      _startTrackFromBuffer(kind, chart, musicCache[key]);
      return;
    }
    /* 正在为该 key 生产则复用 */
    if (synthJob && synthJob.key === key) return;
    cancelSynthJob();
    synthJob = { kind: kind, level: level, chart: chart, key: key, job: createSynthJob(chart, kind) };
    if (!synthTimer) synthTimer = setTimeout(pumpSynth, 0);
  }

  /* 把某场景音乐准备好（缓存命中即返回；否则排入分片生产）。
     返回 Promise，resolve 时该轨已可零延迟起播。 */
  function ensureTrack(kind, level) {
    ensureReady();
    if (!built) return Promise.resolve(false);
    var chart = compose(kind, level);
    var key = trackKey(kind, chart);
    if (musicCache[key]) return Promise.resolve(true);
    if (synthJob && synthJob.key === key && pendingEnsure) return pendingEnsure;

    cancelSynthJob();
    var job = { kind: kind, level: level, chart: chart, key: key, job: createSynthJob(chart, kind) };
    var resolveP;
    var p = new Promise(function (r) { resolveP = r; });
    job._resolve = function () { resolveP(true); };   /* 仅负责 resolve；缓存写入由 pumpSynth 完成 */
    pendingEnsure = p;
    synthJob = job;
    if (!synthTimer) synthTimer = setTimeout(pumpSynth, 0);
    return p;
  }

  /* 该场景音乐是否已就绪（缓存命中） */
  function trackReady(kind, level) {
    if (!built) return false;
    var chart = compose(kind, level);
    return !!musicCache[trackKey(kind, chart)];
  }

  /* ------------------------------------------------------------------ */
  /* 音乐播放 / 交叉淡化                                                 */
  /* ------------------------------------------------------------------ */
  function fadeOutTrack(track, immediate) {
    if (!track) return;
    var t = ctx.currentTime;
    try {
      track.gain.gain.cancelScheduledValues(t);
      if (immediate) track.gain.gain.setValueAtTime(0, t);
      else track.gain.gain.linearRampToValueAtTime(0, t + 0.6);
    } catch (e) { }
    var stopAt = immediate ? 0 : 700;
    setTimeout(function () {
      try { track.src.stop(); } catch (e) { }
      try { track.src.disconnect(); track.gain.disconnect(); } catch (e) { }
    }, stopAt);
  }

  function fadeOutAllTracks(immediate) {
    for (var i = 0; i < activeTracks.length; i++) fadeOutTrack(activeTracks[i], immediate);
    activeTracks = [];
  }

  function _startTrackFromBuffer(kind, chart, buf) {
    if (!built || !buf) return;
    /* 同场景同种子且正在播放 → 不重启 */
    if (scene === kind && currentSeed === chart.seed && activeTracks.length) return;

    fadeOutAllTracks(false);

    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    var g = ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(musicBus);
    var t = ctx.currentTime;
    try { src.start(t); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.6); }
    catch (e) { try { src.start(); } catch (e2) { } }
    activeTracks.push({ src: src, gain: g });
    currentSeed = chart.seed;
    currentDuration = chart.duration;
    currentGenre = chart.genre || '';
  }

  /* 同步起播（离线/测试路径仍可用）；实时路径请用 requestTrack 以免卡顿 */
  function startTrack(kind, level) {
    if (!built) return;
    var res = getTrackBuffer(kind, level);
    if (!res.buf) return;
    _startTrackFromBuffer(kind, res.chart, res.buf);
  }

  function _applyScene() {
    if (!built) return;
    if (scene === 'silent') {
      cancelSynthJob();
      fadeOutAllTracks(false);
      stopAllAmbient(true);
      currentSeed = ''; currentDuration = 0; currentGenre = '';
      return;
    }
    requestTrack(scene, sceneLevel);
    if (scene !== 'level') stopAllAmbient(true);
  }

  /* ------------------------------------------------------------------ */
  /* 一次性音效合成                                                      */
  /* ------------------------------------------------------------------ */
  function p_tone(out, sr, t0, dur, f0, f1, amp, wave, attack, decay) {
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr), ph = 0;
    var atk = Math.max(1, (attack || 0.005) * sr);
    for (var i = 0; i < n; i++) {
      var idx = i0 + i; if (idx < 0) continue; if (idx >= out.length) break;
      var t = i / sr, u = t / dur;
      var f = f0 + (f1 - f0) * u;
      ph += 2 * Math.PI * f / sr;
      var s;
      if (wave === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
      else if (wave === 'saw') s = 2 * ((ph / (2 * Math.PI)) % 1) - 1;
      else if (wave === 'square') s = (Math.sin(ph) >= 0 ? 1 : -1);
      else s = Math.sin(ph);
      var env = Math.min(1, i / atk) * Math.exp(-t * (decay || 3));
      var tail = (n - i) < 40 ? (n - i) / 40 : 1;
      out[idx] += s * amp * env * tail;
    }
  }
  function p_noise(out, sr, t0, dur, amp, lp, decay, rng) {
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr), prev = 0;
    for (var i = 0; i < n; i++) {
      var idx = i0 + i; if (idx < 0) continue; if (idx >= out.length) break;
      var t = i / sr, w = rng() * 2 - 1;
      prev += (w - prev) * lp;
      var tail = (n - i) < 40 ? (n - i) / 40 : 1;
      out[idx] += prev * amp * Math.exp(-t * (decay || 6)) * tail;
    }
  }

  var SFX_DEFS = {
    'jump': { dur: 0.18, gen: function (o, s, r) { p_tone(o, s, 0, 0.16, 320, 760, 0.5, 'sine', 0.004, 6); p_tone(o, s, 0, 0.12, 640, 1520, 0.18, 'sine', 0.002, 8); } },
    'doubleJump': { dur: 0.18, gen: function (o, s, r) { p_tone(o, s, 0, 0.16, 520, 1080, 0.45, 'sine', 0.003, 7); p_tone(o, s, 0, 0.12, 1040, 2160, 0.15, 'sine', 0.002, 9); } },
    'wallJump': { dur: 0.18, gen: function (o, s, r) { p_tone(o, s, 0, 0.15, 300, 720, 0.45, 'tri', 0.003, 7); p_noise(o, s, 0, 0.1, 0.2, 0.25, 10, r); } },
    'land': { dur: 0.20, gen: function (o, s, r) { p_tone(o, s, 0, 0.18, 170, 70, 0.6, 'sine', 0.002, 7); p_noise(o, s, 0, 0.09, 0.25, 0.15, 12, r); } },
    'step': { dur: 0.07, gen: function (o, s, r) { p_noise(o, s, 0, 0.045, 0.075, 0.045, 26, r); p_tone(o, s, 0, 0.04, 150, 105, 0.05, 'sine', 0.002, 22); } },
    'death': { dur: 0.60, gen: function (o, s, r) { p_tone(o, s, 0, 0.55, 520, 110, 0.5, 'saw', 0.005, 2.2); p_tone(o, s, 0.02, 0.5, 260, 90, 0.25, 'sine', 0.005, 2.5); p_noise(o, s, 0, 0.3, 0.2, 0.35, 4, r); } },
    'respawn': { dur: 0.50, gen: function (o, s, r) { p_tone(o, s, 0, 0.18, 440, 440, 0.4, 'sine', 0.005, 5); p_tone(o, s, 0.12, 0.18, 660, 660, 0.4, 'sine', 0.005, 5); p_tone(o, s, 0.24, 0.24, 880, 880, 0.4, 'sine', 0.005, 4); } },
    'explosion': { dur: 0.70, gen: function (o, s, r) { p_noise(o, s, 0, 0.6, 0.7, 0.12, 3.5, r); p_tone(o, s, 0, 0.5, 120, 40, 0.7, 'sine', 0.002, 3); p_noise(o, s, 0, 0.15, 0.4, 0.5, 10, r); } },
    'flagPlace': { dur: 0.20, gen: function (o, s, r) { p_tone(o, s, 0, 0.08, 560, 840, 0.24, 'tri', 0.004, 13); p_tone(o, s, 0.05, 0.14, 700, 700, 0.26, 'sine', 0.005, 7); } },
    'flagPull': { dur: 0.20, gen: function (o, s, r) { p_tone(o, s, 0, 0.16, 760, 420, 0.35, 'sine', 0.004, 7); } },
    'flagPickup': { dur: 0.30, gen: function (o, s, r) { p_tone(o, s, 0, 0.12, 660, 660, 0.35, 'sine', 0.004, 7); p_tone(o, s, 0.09, 0.18, 990, 990, 0.35, 'sine', 0.004, 6); } },
    'heart': { dur: 0.45, gen: function (o, s, r) { p_tone(o, s, 0, 0.22, 523, 523, 0.35, 'sine', 0.006, 4.5); p_tone(o, s, 0.16, 0.28, 659, 659, 0.35, 'sine', 0.006, 4); } },
    'trophy': { dur: 0.60, gen: function (o, s, r) { var n = [784, 988, 1319, 1568]; for (var i = 0; i < n.length; i++) p_tone(o, s, i * 0.09, 0.22, n[i], n[i], 0.32, 'sine', 0.004, 5); } },
    'switch': { dur: 0.20, gen: function (o, s, r) { p_tone(o, s, 0, 0.06, 700, 1120, 0.22, 'sine', 0.003, 14); p_tone(o, s, 0.05, 0.13, 480, 720, 0.2, 'sine', 0.005, 9); } },
    'doorOpen': { dur: 0.60, gen: function (o, s, r) { p_tone(o, s, 0, 0.5, 160, 420, 0.35, 'saw', 0.02, 2.5); p_noise(o, s, 0, 0.4, 0.12, 0.25, 3, r); } },
    'doorClose': { dur: 0.60, gen: function (o, s, r) { p_tone(o, s, 0, 0.5, 420, 140, 0.35, 'saw', 0.02, 2.5); p_tone(o, s, 0.42, 0.16, 120, 70, 0.5, 'sine', 0.002, 8); p_noise(o, s, 0.4, 0.12, 0.25, 0.2, 10, r); } },
    'plate': { dur: 0.22, gen: function (o, s, r) { p_noise(o, s, 0, 0.03, 0.06, 0.06, 30, r); p_tone(o, s, 0.02, 0.16, 260, 320, 0.24, 'sine', 0.006, 8); p_tone(o, s, 0.06, 0.1, 400, 620, 0.1, 'sine', 0.006, 10); } },
    'break': { dur: 0.30, gen: function (o, s, r) { p_noise(o, s, 0, 0.22, 0.5, 0.35, 9, r); p_tone(o, s, 0, 0.12, 420, 180, 0.3, 'tri', 0.002, 12); } },
    'ignite': { dur: 0.50, gen: function (o, s, r) { p_noise(o, s, 0, 0.45, 0.4, 0.18, 3.5, r); p_tone(o, s, 0, 0.4, 180, 320, 0.2, 'saw', 0.02, 3); } },
    'melt': { dur: 0.50, gen: function (o, s, r) { p_tone(o, s, 0, 0.45, 700, 200, 0.35, 'sine', 0.005, 3); p_noise(o, s, 0, 0.3, 0.15, 0.2, 4, r); } },
    'fallingSpike': { dur: 0.50, gen: function (o, s, r) { p_tone(o, s, 0, 0.12, 660, 660, 0.2, 'tri', 0.004, 11); p_tone(o, s, 0.16, 0.12, 590, 590, 0.19, 'tri', 0.004, 11); p_noise(o, s, 0.32, 0.12, 0.14, 0.14, 11, r); } },
    'gravity': { dur: 0.50, gen: function (o, s, r) { p_tone(o, s, 0, 0.45, 300, 900, 0.25, 'sine', 0.02, 3); p_tone(o, s, 0, 0.45, 90, 200, 0.25, 'sine', 0.02, 3); } },
    'waterEnter': { dur: 0.50, gen: function (o, s, r) { p_noise(o, s, 0, 0.4, 0.5, 0.12, 4, r); p_tone(o, s, 0, 0.3, 600, 180, 0.3, 'sine', 0.004, 5); } },
    'waterExit': { dur: 0.50, gen: function (o, s, r) { p_noise(o, s, 0, 0.35, 0.45, 0.15, 4, r); p_tone(o, s, 0, 0.3, 200, 700, 0.3, 'sine', 0.004, 5); } },
    'bubble': { dur: 0.25, gen: function (o, s, r) { p_tone(o, s, 0, 0.2, 400, 1100, 0.35, 'sine', 0.004, 8); } },
    'smokeEnter': { dur: 0.50, gen: function (o, s, r) { p_noise(o, s, 0, 0.45, 0.3, 0.08, 3.5, r); } },
    'slow': { dur: 0.60, gen: function (o, s, r) { p_tone(o, s, 0, 0.55, 800, 180, 0.4, 'tri', 0.01, 2.5); } },
    'laserHit': { dur: 0.25, gen: function (o, s, r) { p_noise(o, s, 0, 0.16, 0.18, 0.12, 14, r); p_tone(o, s, 0, 0.16, 900, 260, 0.26, 'tri', 0.003, 12); } },
    'ghost': { dur: 0.70, gen: function (o, s, r) { p_tone(o, s, 0, 0.65, 520, 540, 0.25, 'sine', 0.08, 2.5); p_tone(o, s, 0, 0.65, 522, 542, 0.22, 'sine', 0.08, 2.5); p_noise(o, s, 0, 0.5, 0.06, 0.05, 2, r); } },
    'uiHover': { dur: 0.08, gen: function (o, s, r) { p_tone(o, s, 0, 0.05, 1200, 1400, 0.18, 'sine', 0.002, 16); } },
    'uiClick': { dur: 0.11, gen: function (o, s, r) { p_tone(o, s, 0, 0.06, 880, 1320, 0.26, 'sine', 0.002, 18); p_tone(o, s, 0.03, 0.07, 1320, 1760, 0.16, 'tri', 0.002, 16); } },
    'win': { dur: 0.90, gen: function (o, s, r) { var n = [523, 659, 784, 1047]; for (var i = 0; i < n.length; i++) p_tone(o, s, i * 0.16, 0.36, n[i], n[i], 0.34, 'sine', 0.005, 3.5); } },
    'fail': { dur: 0.70, gen: function (o, s, r) { p_tone(o, s, 0, 0.3, 440, 415, 0.35, 'sine', 0.006, 4); p_tone(o, s, 0.28, 0.4, 392, 370, 0.35, 'sine', 0.006, 3.5); } }
  };

  /* 常见别名 */
  var SFX_ALIAS = {
    'doublejump': 'doubleJump', 'walljump': 'wallJump', 'wall_jump': 'wallJump',
    'waterenter': 'waterEnter', 'waterexit': 'waterExit', 'smokeenter': 'smokeEnter',
    'fallingspike': 'fallingSpike', 'laserhit': 'laserHit', 'flagplace': 'flagPlace',
    'flagpull': 'flagPull', 'flagpickup': 'flagPickup', 'dooropen': 'doorOpen',
    'doorclose': 'doorClose', 'ui_hover': 'uiHover', 'ui_click': 'uiClick',
    'uiclick': 'uiClick', 'uihover': 'uiHover', 'double_jump': 'doubleJump'
  };

  function getSfxBuffer(name) {
    var key = SFX_ALIAS[name] || name;
    if (sfxCache[key]) return sfxCache[key];
    var def = SFX_DEFS[key];
    if (!def) return null;
    var sr = (ctx && ctx.sampleRate) ? ctx.sampleRate : 44100;
    var n = Math.ceil(def.dur * sr);
    var out = new Float32Array(n);
    var rng = mulberry32(hashStr('sfx:' + key, 0x51ed270b));
    def.gen(out, sr, rng);
    /* 归一化，避免叠加削波 */
    var peak = 0;
    for (var i = 0; i < n; i++) { var a = Math.abs(out[i]); if (a > peak) peak = a; }
    if (peak > 0.95) { var g = 0.95 / peak; for (var j = 0; j < n; j++) out[j] *= g; }
    var buf = createBuf(1, n, sr);
    if (buf) {
      if (buf.copyToChannel) buf.copyToChannel(out, 0);
      else buf.getChannelData(0).set(out);
      sfxCache[key] = buf;
    }
    return buf;
  }

  function playSfx(name, x, y) {
    ensureReady();
    if (!ctx || !built) return;
    var buf = getSfxBuffer(name);
    if (!buf) return;

    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain();
    var gain = 1, panVal = 0;
    if (typeof x === 'number' && typeof y === 'number') {
      var dx = x - listener.x, dy = y - listener.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      gain = clamp(1 - d / 420, 0.06, 1);
      panVal = clamp(dx / 200, -1, 1);
    }
    g.gain.value = gain;

    if (typeof ctx.createStereoPanner === 'function') {
      var pan = ctx.createStereoPanner(); pan.pan.value = panVal;
      src.connect(g); g.connect(pan); pan.connect(sfxBus);
    } else {
      src.connect(g); g.connect(sfxBus);
    }
    try { src.start(); } catch (e) { return; }
    sfxActive.add(src);
    src.onended = function () { sfxActive.delete(src); try { src.disconnect(); } catch (e) { } };
  }

  /* ------------------------------------------------------------------ */
  /* 环境音（区域 / 线段距离淡入淡出，最多 20）                          */
  /* ------------------------------------------------------------------ */
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    var sr = ctx.sampleRate, len = Math.floor(sr * 2);
    noiseBuffer = ctx.createBuffer(1, len, sr);
    var d = noiseBuffer.getChannelData(0);
    var rng = mulberry32(0x12345678);
    for (var i = 0; i < len; i++) d[i] = rng() * 2 - 1;
    return noiseBuffer;
  }

  function distToRect(px, py, r) {
    var cx = clamp(px, r.x, r.x + r.w), cy = clamp(py, r.y, r.y + r.h);
    var dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function distToSegment(px, py, x1, y1, x2, y2) {
    var vx = x2 - x1, vy = y2 - y1;
    var wx = px - x1, wy = py - y1;
    var L2 = vx * vx + vy * vy;
    var t = L2 > 0 ? clamp((wx * vx + wy * vy) / L2, 0, 1) : 0;
    var cx = x1 + vx * t, cy = y1 + vy * t;
    var dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function approxLaserSegment(l) {
    var cx = l.x + (l.w || 6) / 2, cy = l.y + (l.h || 6) / 2, dx = 0, dy = 0, L = 200;
    if (l.type === 'laserRight') dx = 1; else if (l.type === 'laserLeft') dx = -1;
    else if (l.type === 'laserUp') dy = -1; else if (l.type === 'laserDown') dy = 1;
    return { x1: cx, y1: cy, x2: cx + dx * L, y2: cy + dy * L };
  }

  function getLaserSegment(i, l) {
    var t = now();
    var e = laserSegCache[i];
    if (e && (t - e.t) < 120 && e.ref === l) return e.seg;
    var seg;
    try {
      if (typeof global.computeLaserRay === 'function') {
        var ray = global.computeLaserRay(l);
        if (ray) seg = { x1: ray.startX, y1: ray.startY, x2: ray.endX, y2: ray.endY };
      }
    } catch (err) { seg = null; }
    if (!seg) seg = approxLaserSegment(l);
    laserSegCache[i] = { t: t, seg: seg, ref: l };
    return seg;
  }

  function createAmbientVoice(type) {
    var g = ctx.createGain(); g.gain.value = 0;
    var pan = (typeof ctx.createStereoPanner === 'function') ? ctx.createStereoPanner() : null;
    if (pan) { g.connect(pan); pan.connect(sfxBus); } else { g.connect(sfxBus); }
    var sources = [], nodes = [], base = 0.1;

    if (type === 'water') {
      var s1 = ctx.createBufferSource(); s1.buffer = getNoiseBuffer(); s1.loop = true;
      var lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 700; lp1.Q.value = 0.6;
      s1.connect(lp1); lp1.connect(g); s1.start();
      sources.push(s1); nodes.push(lp1); base = 0.22;
    } else if (type === 'smoke') {
      var s2 = ctx.createBufferSource(); s2.buffer = getNoiseBuffer(); s2.loop = true;
      var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 380; lp2.Q.value = 0.6;
      s2.connect(lp2); lp2.connect(g); s2.start();
      sources.push(s2); nodes.push(lp2); base = 0.10;
    } else if (type === 'gravity') {
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 58;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 87;
      o1.connect(g); o2.connect(g); o1.start(); o2.start();
      sources.push(o1, o2); base = 0.14;
    } else if (type === 'flammable') {
      var s3 = ctx.createBufferSource(); s3.buffer = getNoiseBuffer(); s3.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.2;
      s3.connect(bp); bp.connect(g); s3.start();
      sources.push(s3); nodes.push(bp); base = 0.16;
    } else if (type === 'laser') {
      var o3 = ctx.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = 92;
      var lp3 = ctx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 900; lp3.Q.value = 0.7;
      var o4 = ctx.createOscillator(); o4.type = 'sine'; o4.frequency.value = 1500;
      o3.connect(lp3); lp3.connect(g); o4.connect(g);
      o3.start(); o4.start();
      sources.push(o3, o4); nodes.push(lp3); base = 0.10;
    }
    return { type: type, gain: g, pan: pan, sources: sources, nodes: nodes, base: base };
  }

  function releaseAmbientVoice(v) {
    if (!v) return;
    for (var i = 0; i < v.sources.length; i++) { try { v.sources[i].stop(); } catch (e) { } }
    try { v.gain.disconnect(); } catch (e) { }
    if (v.pan) { try { v.pan.disconnect(); } catch (e) { } }
    for (var j = 0; j < v.nodes.length; j++) { try { v.nodes[j].disconnect(); } catch (e) { } }
  }

  function fadeRemoveAmbient(key) {
    var v = ambient.get(key); if (!v) return;
    ambient.delete(key);
    var t = ctx.currentTime;
    try { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, 0.12); } catch (e) { }
    setTimeout(function () { releaseAmbientVoice(v); }, 450);
  }

  function stopAllAmbient(immediate) {
    var keys = [];
    ambient.forEach(function (v, k) { keys.push(k); });
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = ambient.get(k);
      ambient.delete(k);
      if (!v) continue;
      if (immediate) { releaseAmbientVoice(v); }
      else {
        var t = ctx.currentTime;
        try { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setTargetAtTime(0, t, 0.12); } catch (e) { }
        (function (vv) { setTimeout(function () { releaseAmbientVoice(vv); }, 450); })(v);
      }
    }
  }

  function reconcileAmbient(Play) {
    var t = ctx.currentTime;
    var cands = [];

    function addRegion(list, type) {
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r) continue;
        if (type === 'flammable' && !(r.burning > 0)) continue;
        var d = distToRect(listener.x, listener.y, r);
        if (d > AMBIENT_MAX[type]) continue;
        cands.push({
          key: type + ':' + i, type: type, dist: d,
          px: r.x + (r.w || 0) / 2, py: r.y + (r.h || 0) / 2
        });
      }
    }
    addRegion(Play.waters, 'water');
    addRegion(Play.smokes, 'smoke');
    addRegion(Play.gravityZones, 'gravity');
    addRegion(Play.flammables, 'flammable');

    if (Play.lasers) {
      for (var li = 0; li < Play.lasers.length; li++) {
        var l = Play.lasers[li]; if (!l) continue;
        var seg = getLaserSegment(li, l);
        var dl = distToSegment(listener.x, listener.y, seg.x1, seg.y1, seg.x2, seg.y2);
        if (dl > AMBIENT_MAX.laser) continue;
        cands.push({ key: 'laser:' + li, type: 'laser', dist: dl, px: (seg.x1 + seg.x2) / 2, py: (seg.y1 + seg.y2) / 2 });
      }
    }

    cands.sort(function (a, b) { return a.dist - b.dist; });
    if (cands.length > AMBIENT_CAP) cands = cands.slice(0, AMBIENT_CAP);

    var wanted = {};
    for (var c = 0; c < cands.length; c++) wanted[cands[c].key] = true;

    /* 移除不再需要的 */
    var removeKeys = [];
    ambient.forEach(function (v, k) { if (!wanted[k]) removeKeys.push(k); });
    for (var rk = 0; rk < removeKeys.length; rk++) fadeRemoveAmbient(removeKeys[rk]);

    /* 新增 / 更新 */
    for (var n = 0; n < cands.length; n++) {
      var cd = cands[n];
      var v = ambient.get(cd.key);
      if (!v) { v = createAmbientVoice(cd.type); ambient.set(cd.key, v); }
      var maxD = AMBIENT_MAX[cd.type];
      var f = clamp(1 - cd.dist / maxD, 0, 1); f = f * f;
      try { v.gain.gain.setTargetAtTime(v.base * f, t, 0.15); } catch (e) { v.gain.gain.value = v.base * f; }
      if (v.pan) {
        var dx = cd.px - listener.x;
        try { v.pan.pan.setTargetAtTime(clamp(dx / 220, -1, 1), t, 0.2); } catch (e) { v.pan.pan.value = clamp(dx / 220, -1, 1); }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 水下处理                                                            */
  /* ------------------------------------------------------------------ */
  function setUnderwater(uw) {
    if (underwater === uw) return;
    underwater = uw;
    if (!built) return;
    var t = ctx.currentTime;
    var hz = uw ? 760 : 20000;      // 650~900Hz 区间
    filterHz = hz;
    try { sfxUnder.frequency.setTargetAtTime(hz, t, 0.08); } catch (e) { sfxUnder.frequency.value = hz; }
    var wet = uw ? 0.35 : 0, dry = uw ? 0.75 : 1;
    try { sfxWet.gain.setTargetAtTime(wet, t, 0.1); } catch (e) { sfxWet.gain.value = wet; }
    try { sfxDry.gain.setTargetAtTime(dry, t, 0.1); } catch (e) { sfxDry.gain.value = dry; }
    if (musicFilter) {
      var mhz = uw ? 6000 : 20000;  // 音乐轻低通（非必须）
      try { musicFilter.frequency.setTargetAtTime(mhz, t, 0.2); } catch (e) { musicFilter.frequency.value = mhz; }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 公开 API                                                            */
  /* ------------------------------------------------------------------ */
  var AudioSystem = {
    init: function () {
      ensureReady();
      if (!ctx) return Promise.resolve(false);
      var p = ctx.resume ? ctx.resume() : Promise.resolve();
      return Promise.resolve(p).then(function () {
        if (scene !== 'silent' && !activeTracks.length) _applyScene();
        return ctx.state === 'running';
      }).catch(function () { return false; });
    },

    setScene: function (kind, level) {
      if (kind !== 'menu' && kind !== 'pause' && kind !== 'level' && kind !== 'silent') kind = 'silent';
      scene = kind;
      sceneLevel = level || null;
      ensureReady();
      if (built) _applyScene();
    },

    setVolumes: function (music, sfx) {
      if (typeof music === 'number') musicVolume = clamp(music, 0, 1);
      if (typeof sfx === 'number') sfxVolume = clamp(sfx, 0, 1);
      if (built) {
        var t = ctx.currentTime;
        try { musicBus.gain.setTargetAtTime(musicVolume, t, 0.05); } catch (e) { musicBus.gain.value = musicVolume; }
        try { sfxBus.gain.setTargetAtTime(sfxVolume, t, 0.05); } catch (e) { sfxBus.gain.value = sfxVolume; }
      }
    },

    sfx: function (name, x, y) { playSfx(name, x, y); },

    setListener: function (player) {
      if (!player) return;
      listener.x = player.x + (player.w || 0) / 2;
      listener.y = player.y + (player.h || 0) / 2;
    },

    update: function (player, Play, dt) {
      ensureReady();
      if (!built) return;
      var p = player || (Play && Play.player);
      if (p) AudioSystem.setListener(p);

      /* 水下：优先使用 Play._inWater */
      var uw = false;
      if (Play && typeof Play._inWater === 'boolean') uw = Play._inWater;
      setUnderwater(uw);

      /* 环境音：仅局内；暂停/静音不生成 */
      if (scene === 'level' && Play) reconcileAmbient(Play);
      else if (ambient.size) stopAllAmbient(false);
    },

    /* 立即把当前场景音乐的合成跑完并起播（同步；仅供加载界面/测试收口用） */
    flushMusic: function () {
      if (synthJob) {
        while (synthJob && !synthJob.job.step(1e9)) { }
        pumpSynth();
      }
      return currentSeed || '';
    },

    reset: function () {
      if (built) { try { stopAllAmbient(true); } catch (e) { } fadeOutAllTracks(true); }
      cancelSynthJob();
      sfxActive.clear();
      underwater = false;
      listener.x = 0; listener.y = 0;
      scene = 'silent'; sceneLevel = null;
      currentSeed = ''; currentDuration = 0; currentGenre = '';
      musicCache = {}; musicCacheOrder = [];
      sfxCache = {};
      laserSegCache = {};
      renderPending = 0;
      filterHz = 20000;
      if (built) {
        sfxUnder.frequency.value = 20000;
        sfxWet.gain.value = 0; sfxDry.gain.value = 1;
        if (musicFilter) musicFilter.frequency.value = 20000;
      }
    },

    debug: function () {
      return {
        ctxState: ctx ? ctx.state : 'none',
        musicGain: musicVolume,
        sfxGain: sfxVolume,
        scene: scene,
        seed: currentSeed,
        loopDuration: currentDuration,
        ambientCount: ambient.size,
        underwater: underwater,
        filterHz: built ? sfxUnder.frequency.value : filterHz,
        sfxCount: sfxActive.size,
        renderPending: renderPending,
        genre: currentGenre,
        synthPending: !!synthJob,
        synthProgress: synthJob ? +synthJob.job.progress().toFixed(3) : 1
      };
    },

    levelSeed: function (level) { return levelSeed(level); },

    /* 曲风表（供检测/调参）：名称、速度与音色波形 */
    /* 风格语汇库（供检测/调参）：这些是“素材池”，不是按关卡写死的配置；
       真正用哪套、速度多少、音阶音色，全部由关卡种子派生（见 compose）。 */
    genres: function () {
      var o = {};
      for (var k in STYLES) if (Object.prototype.hasOwnProperty.call(STYLES, k)) {
        var G = STYLES[k];
        o[k] = { name: G.name, tempoBase: G.tempo, scalePool: G.scalePool.slice(), leadPool: G.leadPool.slice(), bassPool: G.bassPool.slice(), swingPool: G.swingPool.slice() };
      }
      return o;
    },

    /* 关卡 → 音乐特征（全部来自关卡数据，无人工配置） */
    levelFeatures: function (level) { return deriveMusicFeatures(level); },

    /* 预热：后台空闲地把所有关卡（+菜单/暂停）的音乐预先合成进缓存，
       这样玩家进任何关卡都是“命中缓存、零延迟起播”，彻底消除切换延迟。
       返回 Promise，resolve 时预热完成（或在途任务被新任务替换时提前结束）。 */
    prewarm: function (levels) {
      var list = [];
      if (levels && levels.length) {
        for (var i = 0; i < levels.length; i++) list.push({ kind: 'level', level: levels[i] });
      }
      list.push({ kind: 'menu', level: null });
      list.push({ kind: 'pause', level: null });
      ensureReady();
      if (!built) return Promise.resolve(0);
      /* 预热时把缓存上限抬高，保证全部关卡常驻 */
      if (MUSIC_CACHE_MAX < list.length + 2) MUSIC_CACHE_MAX = list.length + 2;

      warmReady = false; warmPending = true;
      return new Promise(function (resolve) {
        var idx = 0, made = 0;
        function idle(fn) {
          if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 250 });
          else setTimeout(fn, 0);
        }
        function next() {
          if (idx >= list.length) { warmReady = true; warmPending = false; resolve(made); return; }
          var item = list[idx++];
          var chart = compose(item.kind, item.level);
          var key = trackKey(item.kind, chart);
          if (musicCache[key]) { idle(next); return; }
          var job = createSynthJob(chart, item.kind);
          (function advance(deadline) {
            var budget = (deadline && deadline.timeRemaining) ? Math.min(10, deadline.timeRemaining() + 2) : 6;
            var done = false;
            try { done = job.step(budget); } catch (e) { done = true; }
            if (!done) { idle(advance); return; }
            var buf = job.finish();
            if (buf) { musicCache[key] = buf; musicCacheOrder.push(key); made++; }
            idle(next);
          })();
        }
        idle(next);
      });
    },

    /* 预热进度（0..1），供加载界面显示 */
    prewarmState: function () { return { ready: warmReady, active: warmPending }; },

    /* 确保某场景音乐已就绪（缓存命中即 resolve；否则分片生产后 resolve） */
    ensureTrack: function (kind, level) { return ensureTrack(kind, level); },
    /* 该场景音乐是否已缓存可就绪（不触发生产） */
    trackReady: function (kind, level) { return trackReady(kind, level); },

    compose: function (kind, level) {
      var c = compose(kind, level);
      return { duration: c.duration, seed: c.seed, events: c.events, bpm: c.bpm, genre: c.genre, genreName: c.genreName, scale: c.scale, keyRoot: c.keyRoot, progDegs: c.progDegs, swing: c.swing, density: c.density, energy: c.energy, timbre: c.timbre };
    },

    /* 离线生产路径：与实时播放复用同一合成函数 */
    renderTrack: function (kind, level) {
      renderPending++;
      return new Promise(function (resolve) {
        ensureReady();
        if (!ctx) { renderPending--; resolve(null); return; }
        setTimeout(function () {
          var buf = null;
          try {
            var res = getTrackBuffer(kind, level);
            buf = res.buf;
          } catch (e) { buf = null; }
          renderPending--;
          resolve(buf);
        }, 0);
      });
    },

    /* 离线渲染单个音效（与实时播放复用同一 getSfxBuffer 合成函数），供音色检测使用 */
    renderSfx: function (name) {
      renderPending++;
      return new Promise(function (resolve) {
        ensureReady();
        if (!ctx) { renderPending--; resolve(null); return; }
        setTimeout(function () {
          var buf = null;
          try { buf = getSfxBuffer(name); } catch (e) { buf = null; }
          renderPending--;
          resolve(buf);
        }, 0);
      });
    }
  };

  global.AudioSystem = AudioSystem;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
