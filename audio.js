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
  var musicCacheBytes = {};    // key -> 占用字节（精确记账，用于内存预算淘汰）
  var musicCacheOrder = [];    // LRU 顺序
  /* === 缓存上限：从「条数」改为「内存预算」（支撑大规模地图） ===
     旧实现把上限设成 `关卡数 + 2`（prewarm 里会往上抬），这在 20 关时没问题，
     但本地批量生成关卡（实测放大到 400 关）时会变成：
       402 轨 × 15.8MB/轨（实测 DUR 46.8s × 44.1kHz × 2ch × 4B）≈ **6.3 GB**
     ⇒ 必然 OOM 崩溃。
     现在改为**内存预算**驱动：
       · MUSIC_CACHE_BYTES 是硬上限（默认 192MB，约 12 轨）；
       · 每条 buffer 按 `length × numberOfChannels × 4` 精确记账；
       · 淘汰时**永不驱逐「当前正在播放」与「菜单/暂停」这两条常驻轨**
         （否则会出现"音乐播到一半被自己踢掉"的诡异现象）；
       · 条数上限只作为兜底（防止极短曲目把 map 撑爆）。 */
  var MUSIC_CACHE_MAX = 24;                 /* 条数兜底 */
  var MUSIC_CACHE_BYTES = 192 * 1024 * 1024;/* 内存硬上限 192MB */
  var _cacheBytes = 0;
  var _cachePinned = {};                    /* 常驻：kind -> true（menu/pause） */
  function _bufBytes(buf) {
    if (!buf) return 0;
    return (buf.length || 0) * (buf.numberOfChannels || 1) * 4;
  }

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
  var prewarmToken = 0;        // 每次 prewarm 自增，用于作废旧的后台预热任务

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
    },
    /* ★BOSS 主题★（用户原话「华丽一点炫酷一点有压迫感一点」）
       · tempo 拉高到 148 + drive 0.95 ⇒ 推进感与失真的压迫；
       · density 0.86 + 双倍结构（见 compose 的 BOSS 分支）⇒ 织体最厚；
       · 沉重四四拍：底鼓落在 1、3 拍与切分的"3&"上（半速感觉 + 双踩）；
       · 军鼓加密成十六分滚奏 ⇒ 华丽/炫酷；
       · 进行 i–VI–VII–V（谐波小调里的"魔王进行"）—— 最典型的压迫感和声。
       · 音阶只取 minor / 和声色彩近亲，保证"阴沉"是确定的，不靠随机漂。 */
    bossTheme: {
      name: '魔域', tempo: 148, scalePool: ['minor', 'dorian'], swingPool: [0, 0],
      leadPool: ['saw', 'square'], bassPool: ['saw', 'square'], drive: 0.95, density: 0.86,
      kickPool: ['9...9...9...9...', '9.....9.9.....9.', '9...9...9...9.9.'],
      snarePool: ['..x.x.x...x.x.x.', '..x...x...x...x.', '.x.x.x.x.x.x.x.x'],
      hatPool: ['xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx'],
      padPool: [0.16, 0.20, 0.24],
      progs: [[0, 5, 6, 4], [0, 5, 6, 4], [0, 6, 5, 4]]
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
    else if (kind === 'boss') { seedStr = 'BOSS_THEME_V1'; seedNum = hashStr(seedStr, 0x5bd1e995); }
    else { seedStr = levelSeed(level); seedNum = hashStr(seedStr, 0x2545f491); }

    var rng = mulberry32(seedNum);
    var F = (kind === 'level') ? deriveMusicFeatures(level)
      : (kind === 'boss') ? { energy: 0.95, hazard: 0.9, bright: 0.22, roomy: 0.30, bars: 16, count: 20 }
        : { energy: 0.4, hazard: 0.1, bright: 0.5, roomy: 0.4, bars: 16, count: 20 };

    var gkey, G;
    if (level && level.__forceStyle && STYLES[level.__forceStyle]) gkey = level.__forceStyle;   /* 仅测试用覆盖 */
    else if (kind === 'menu') gkey = 'jazz';
    else if (kind === 'pause') gkey = 'classical';
    else if (kind === 'boss') gkey = 'bossTheme';        /* ★BOSS 主题固定风格★ */
    else gkey = STYLE_KEYS[Math.floor(rng() * STYLE_KEYS.length)];
    G = STYLES[gkey];

    var energyBias = (F.energy - 0.4) * 18 + F.hazard * 14;
    var BPM = clamp(Math.round(G.tempo + (rng() * 2 - 1) * 7 + energyBias), 64, 150);

    var BARS = F.bars;
    /* ★BOSS：结构加长到 2 倍★（F.bars 由关卡特征算出，BOSS 场景没有关卡 ⇒ 走默认 16）
       翻倍到 32 小节 ⇒ 循环周期更长、听不出重复，才撑得住一场拉锯战。 */
    if (kind === 'boss') BARS = BARS * 2;
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
  /* 记一笔内存（入缓存时调用） */
  function _noteBytes(key, buf) {
    var b = _bufBytes(buf);
    if (b) { musicCacheBytes[key] = b; _cacheBytes += b; }
  }
  function _dropKey(k) {
    if (musicCacheBytes[k]) { _cacheBytes -= musicCacheBytes[k]; delete musicCacheBytes[k]; }
    delete musicCache[k];
  }
  /* 淘汰：先按内存预算，再按条数兜底。
     保护两类 key，绝不驱逐：
       ① 正在播放的轨（activeTracks 里的）—— 否则音乐播到一半突然断；
       ② 常驻轨（menu / pause）—— 它们必须"按下即响"，重建代价是 4 秒等待。
     `_pinOf(key)` 从 key 前缀取 kind（key 形如 `kind|genre|seed`）。 */
  function _pinOf(key) { return String(key).split('|')[0]; }
  function _isProtected(key) {
    if (_cachePinned[_pinOf(key)]) return true;
    for (var i = 0; i < activeTracks.length; i++) {
      if (activeTracks[i] && activeTracks[i].key === key) return true;
    }
    return false;
  }
  function evictCache() {
    /* 先从最旧的开始尝试驱逐，跳过受保护的（把它们挪到队尾重排） */
    var guard = 0, limit = musicCacheOrder.length * 2 + 8;
    while ((_cacheBytes > MUSIC_CACHE_BYTES || musicCacheOrder.length > MUSIC_CACHE_MAX) && guard++ < limit) {
      var k = musicCacheOrder.shift();
      if (k === undefined) break;
      if (_isProtected(k)) { musicCacheOrder.push(k); continue; }
      _dropKey(k);
    }
  }

  function getTrackBuffer(kind, level) {
    var chart = compose(kind, level);
    var key = kind + '|' + (chart.genre || '') + '|' + chart.seed;
    if (musicCache[key]) { touchCache(key); return { buf: musicCache[key], chart: chart }; }
    var buf = synthesizeTrack(chart, kind);
    if (buf) { musicCache[key] = buf; musicCacheOrder.push(key); _noteBytes(key, buf); evictCache(); }
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
      musicCache[finished.key] = buf; musicCacheOrder.push(finished.key); _noteBytes(finished.key, buf); evictCache();
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
    activeTracks.push({ src: src, gain: g, key: trackKey(kind, chart) });
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
    /* ★BOSS 场景与 level 一样保留环境音★（水流/风声/虫鸣）——
       进 BOSS 房时把环境音掐掉会让临场感断裂，听起来像"跳到另一首歌"。
       只有 menu/pause 才停环境音。 */
    if (scene !== 'level' && scene !== 'boss') stopAllAmbient(true);
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

  /* ★FM 合成（怪物音效的"高级音色"主力）★
     为什么必须有它：本项目既有音效只有 sine/tri/saw/square 四个基波 ——
     单层基波无论怎么包络都摆脱不了"8bit 味道"。FM（一个正弦调制另一个
     正弦的瞬时相位）能用**两个参数**造出带丰富谐波又完全可控的音色：
       · ratio=0.5~1.0 + index≈4~5  ⇒ 兽吼 / 铜管（低频厚重、有"嗓音感"）
       · ratio=2.0~3.6 + index≈2~4  ⇒ 金属 / 骨骼（有明确的"硬物"泛音）
       · ratio=5.0+     + index≈3    ⇒ 铃 / 玻璃（清亮但不刺耳）
     调制指数按 `menv` 随时间衰减 ⇒ 起音粗粝、尾音收束（真实乐器的行为），
     而不是全程一样粗糙。★不刺耳的硬约束★：调用方一律把 `f0/f1` 控制在
     1.4kHz 以下、`index` ≤ 6，再交给 sfxTame（4.5kHz 以上 -6dB）兜底。 */
  function p_fm(out, sr, t0, dur, f0, f1, amp, ratio, index, attack, decay) {
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr);
    var atk = Math.max(1, (attack || 0.005) * sr);
    var ph = 0, mph = 0;
    var dec = decay || 3;
    for (var i = 0; i < n; i++) {
      var idx = i0 + i; if (idx < 0) continue; if (idx >= out.length) break;
      var t = i / sr, u = t / dur;
      var f = f0 + (f1 - f0) * u;
      mph += 2 * Math.PI * (f * ratio) / sr;
      ph += 2 * Math.PI * f / sr;
      var menv = Math.exp(-t * dec * 0.55);
      var s = Math.sin(ph + Math.sin(mph) * index * menv);
      var env = Math.min(1, i / atk) * Math.exp(-t * dec);
      var tail = (n - i) < 40 ? (n - i) / 40 : 1;
      out[idx] += s * amp * env * tail;
    }
  }

  /* ★带通扫频噪声★（气流 / 蒸汽 / 呼啸 / 尘雾）
     与 p_noise 的区别：一阶低通系数 `lp` 在整段里**从 lp0 线性扫到 lp1**。
      · lp 0.02→0.30：由暗到亮 ⇒ 像"某物正在逼近/睁眼"（呼啸、睁眼）
      · lp 0.50→0.03：由亮到暗 ⇒ 像"泄气/熄灭/远去"（蒸汽、扑灭、尘雾）
     听起来是"一个有体积的声源在运动"，而不是一段静止的白噪底。 */
  function p_noiseSweep(out, sr, t0, dur, amp, lp0, lp1, decay, rng, hp) {
    var i0 = Math.round(t0 * sr), n = Math.round(dur * sr), y = 0, py = 0;
    for (var i = 0; i < n; i++) {
      var idx = i0 + i; if (idx < 0) continue; if (idx >= out.length) break;
      var t = i / sr, u = t / dur;
      var lp = lp0 + (lp1 - lp0) * u;
      var w = rng() * 2 - 1;
      y += (w - y) * lp;
      var s = hp ? (y - py) : y; py = y;
      var tail = (n - i) < 40 ? (n - i) / 40 : 1;
      out[idx] += s * amp * Math.exp(-t * (decay || 6)) * tail;
    }
  }

  var SFX_DEFS = {
    /* vol：该音效的独立音量系数（默认 1）。
       起跳/落地这类**高频**操作音原本偏响，连按很吵 → 统一调低。
       注意：只影响音量，不改波形/时长/音色。 */
    'jump': { dur: 0.18, vol: 0.55, gen: function (o, s, r) { p_tone(o, s, 0, 0.16, 320, 760, 0.5, 'sine', 0.004, 6); p_tone(o, s, 0, 0.12, 640, 1520, 0.18, 'sine', 0.002, 8); } },
    'doubleJump': { dur: 0.18, vol: 0.55, gen: function (o, s, r) { p_tone(o, s, 0, 0.16, 520, 1080, 0.45, 'sine', 0.003, 7); p_tone(o, s, 0, 0.12, 1040, 2160, 0.15, 'sine', 0.002, 9); } },
    'wallJump': { dur: 0.18, vol: 0.55, gen: function (o, s, r) { p_tone(o, s, 0, 0.15, 300, 720, 0.45, 'tri', 0.003, 7); p_noise(o, s, 0, 0.1, 0.2, 0.25, 10, r); } },
    'land': { dur: 0.20, vol: 0.6, gen: function (o, s, r) { p_tone(o, s, 0, 0.18, 170, 70, 0.6, 'sine', 0.002, 7); p_noise(o, s, 0, 0.09, 0.25, 0.15, 12, r); } },
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
    'fail': { dur: 0.70, gen: function (o, s, r) { p_tone(o, s, 0, 0.3, 440, 415, 0.35, 'sine', 0.006, 4); p_tone(o, s, 0.28, 0.4, 392, 370, 0.35, 'sine', 0.006, 3.5); } },

    /* ==================================================================
       ★怪物专属音效（v1）★
       ------------------------------------------------------------------
       用户原话（硬约束）：「所有怪物都要有专属音效 …… 所有音效记住不能刺耳
       不能太低端不能只是简单的 8bit 音效，要适当你真复杂一点」。
       因此这里的每一条都遵守三条纪律：
         ① **多层**：至少 2 个声部（FM 主体 + 噪声/共鸣层），单层基波不用；
         ② **不刺耳**：主频一律 ≤ 2.2kHz，粗粝感靠 FM 调制指数而非高频；
            再有 sfxTame（4.5kHz 以上 -6dB）兜底 ⇒ 连点也不会扎耳朵；
         ③ **有体积**：长度 ≥ 0.3s 的都会带"噪声扫频"层（气流感 / 空间感），
            避免"啪一下就没了"的低端感。
       命名与运行时触发点一一对应（见 runtime.js 里的 AudioSystem.sfx 调用）。
       ================================================================== */

    /* ---- 墓碑粉碎（小怪1 的触发器）----
       石块：FM ratio 3.4 造"硬物"泛音；尘埃：低通扫频由亮转暗（扬尘沉降）。 */
    'graveCrush': {
      dur: 0.85, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.30, 220, 96, 0.50, 3.4, 4.2, 0.003, 5.5);      /* 石体断裂 */
        p_fm(o, s, 0.05, 0.26, 148, 62, 0.38, 2.1, 5.0, 0.004, 6.0);    /* 低频塌陷 */
        p_noiseSweep(o, s, 0, 0.55, 0.30, 0.46, 0.06, 4.2, r, false);   /* 尘雾：亮→暗 */
        p_noise(o, s, 0, 0.10, 0.26, 0.60, 16, r);                      /* 起手的碎屑 */
        p_tone(o, s, 0.36, 0.40, 92, 58, 0.18, 'sine', 0.01, 4);        /* 落地闷响 */
      }
    },

    /* ---- 苍白鬼魂：从墓碑"钻"出来 ---- */
    'foeGhostSpawn': {
      dur: 1.05, vol: 0.9, gen: function (o, s, r) {
        /* 由暗到亮的扫频噪声 = "有什么东西正在浮出来" */
        p_noiseSweep(o, s, 0, 0.85, 0.30, 0.03, 0.26, 1.9, r, false);
        /* 反向滑音（低→高）带出"升起"的姿态，用两个失谐层做合唱感 */
        p_tone(o, s, 0.04, 0.80, 168, 268, 0.20, 'sine', 0.16, 1.6);
        p_tone(o, s, 0.04, 0.80, 170, 271, 0.16, 'sine', 0.16, 1.6);
        p_fm(o, s, 0.20, 0.60, 300, 420, 0.10, 1.5, 2.2, 0.12, 1.8);
      }
    },
    /* ---- 苍白鬼魂：被"玩家幽灵"撞散（惊讶 + 化白雾）---- */
    'foeGhostDie': {
      dur: 0.75, vol: 0.9, gen: function (o, s, r) {
        p_tone(o, s, 0, 0.42, 470, 700, 0.24, 'sine', 0.012, 4.5);      /* 上挑的"咦!"*/
        p_tone(o, s, 0, 0.42, 474, 706, 0.20, 'sine', 0.012, 4.5);      /* 微失谐 = 惊愕 */
        p_fm(o, s, 0.06, 0.34, 240, 130, 0.24, 2.6, 3.4, 0.004, 6);     /* 骸体解体 */
        p_noiseSweep(o, s, 0.04, 0.60, 0.26, 0.44, 0.05, 4.0, r, false);/* 白雾扩散 */
      }
    },
    /* ---- 苍白鬼魂：近距开火 ---- */
    'foeGhostShot': {
      dur: 0.34, vol: 0.8, gen: function (o, s, r) {
        p_tone(o, s, 0, 0.16, 1080, 480, 0.26, 'sine', 0.003, 12);      /* 幽能喷出 */
        p_fm(o, s, 0, 0.14, 620, 300, 0.20, 1.5, 3.0, 0.002, 13);
        p_noise(o, s, 0, 0.20, 0.14, 0.34, 9, r);                       /* 一点气流尾 */
      }
    },

    /* ---- 火团怪：从火焰里"弹"出来 ---- */
    'foeFireSpawn': {
      dur: 0.55, vol: 0.9, gen: function (o, s, r) {
        p_noiseSweep(o, s, 0, 0.34, 0.38, 0.20, 0.62, 7.0, r, false);   /* 火焰被"挤"出来 */
        p_tone(o, s, 0, 0.30, 380, 760, 0.22, 'tri', 0.008, 6.5);       /* 上跳弹起 */
        p_fm(o, s, 0.02, 0.26, 210, 320, 0.20, 1.0, 3.6, 0.006, 8);     /* 爆燃质感 */
      }
    },
    /* ---- 火团怪：被带水幽灵扑灭 ---- */
    'foeFireDie': {
      dur: 0.95, vol: 0.9, gen: function (o, s, r) {
        p_noiseSweep(o, s, 0, 0.80, 0.40, 0.66, 0.03, 3.2, r, false);   /* 嘶——蒸汽泄压 */
        p_noiseSweep(o, s, 0.02, 0.70, 0.22, 0.50, 0.05, 3.6, r, true); /* 高通薄层：水汽 */
        p_tone(o, s, 0, 0.55, 300, 96, 0.26, 'sine', 0.01, 3.4);        /* 熄灭下行 */
      }
    },

    /* ---- 骷髅怪：巡视时的骨响（轻、短、可频繁触发）---- */
    'skelTick': {
      dur: 0.22, vol: 0.55, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.10, 420, 300, 0.36, 3.6, 4.4, 0.001, 16);       /* 骨节轻磕 */
        p_noise(o, s, 0, 0.05, 0.08, 0.55, 26, r);
      }
    },
    /* ---- 骷髅怪：发现玩家（咔咔抬头 + 双状态机切换）---- */
    'skelAlert': {
      dur: 0.60, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.14, 300, 620, 0.36, 3.4, 5.0, 0.002, 11);       /* 咔 */
        p_fm(o, s, 0.13, 0.14, 340, 700, 0.34, 3.4, 5.4, 0.002, 11);    /* 咔（上挑）*/
        p_tone(o, s, 0.28, 0.28, 620, 940, 0.18, 'tri', 0.004, 7);      /* 喉音上挑 */
      }
    },
    /* ---- 骷髅怪：蓄力（0.35s 后仰 → 冲刺）---- */
    'skelCharge': {
      dur: 0.45, gen: function (o, s, r) {
        p_tone(o, s, 0, 0.36, 120, 300, 0.34, 'saw', 0.05, 4.2);        /* 蓄力上行 */
        p_fm(o, s, 0, 0.36, 96, 220, 0.26, 1.5, 3.2, 0.06, 4.0);
        p_noiseSweep(o, s, 0.04, 0.36, 0.16, 0.10, 0.34, 4.5, r, false);/* 能量聚拢 */
      }
    },
    /* ---- 骷髅怪：冲刺 ---- */
    'skelDash': {
      dur: 0.42, gen: function (o, s, r) {
        p_noiseSweep(o, s, 0, 0.34, 0.34, 0.34, 0.10, 5.0, r, false);   /* 划过空气 */
        p_tone(o, s, 0, 0.26, 340, 150, 0.24, 'tri', 0.004, 7);         /* 骨头破风 */
        p_fm(o, s, 0, 0.20, 260, 120, 0.20, 2.8, 3.6, 0.002, 9);
      }
    },
    /* ---- 骷髅怪：眩晕（头顶转星星）---- */
    'skelStun': {
      dur: 0.80, gen: function (o, s, r) {
        /* 打转的合金铃：FM ratio 5.2 造"清亮但不尖"的金属环 */
        p_fm(o, s, 0, 0.34, 720, 600, 0.20, 5.2, 2.4, 0.01, 3.6);
        p_fm(o, s, 0.14, 0.34, 640, 520, 0.17, 5.2, 2.4, 0.01, 3.6);
        p_fm(o, s, 0.28, 0.36, 560, 440, 0.14, 5.2, 2.4, 0.01, 3.6);
        p_tone(o, s, 0, 0.55, 150, 96, 0.16, 'sine', 0.02, 3);          /* 塌下来的闷底 */
      }
    },
    /* ---- 骷髅怪：被玩家踩碎 ---- */
    'skelDie': {
      dur: 0.85, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.12, 780, 420, 0.34, 4.0, 4.6, 0.001, 13);       /* 头骨碎裂 */
        p_noise(o, s, 0, 0.22, 0.30, 0.52, 8, r);
        for (var i = 0; i < 4; i++)                                     /* 骨块四散落地 */
          p_fm(o, s, 0.10 + i * 0.11, 0.12, 300 - i * 26, 200 - i * 22, 0.20, 3.4, 4.0, 0.001, 14);
        p_tone(o, s, 0.42, 0.34, 110, 62, 0.20, 'sine', 0.008, 4.5);    /* 残骸落定 */
      }
    },

    /* ---- BOSS：苏醒长吼（进门第一声，要有"地鸣 + 兽吼"两层）---- */
    'bossAwake': {
      dur: 2.30, vol: 0.95, gen: function (o, s, r) {
        /* 地鸣：极低频、慢起、长衰减 —— 让"巨大感"从耳朵以下传上来 */
        p_tone(o, s, 0, 1.90, 58, 36, 0.52, 'sine', 0.10, 1.5);
        p_fm(o, s, 0.06, 1.60, 46, 30, 0.34, 1.0, 3.2, 0.16, 1.6);
        /* 兽吼主体：FM ratio 0.62（次谐波，低而宽）的滑音，共振峰由低到高再回落 */
        p_fm(o, s, 0.10, 1.55, 150, 178, 0.44, 0.62, 5.4, 0.14, 1.5);
        p_fm(o, s, 0.10, 1.55, 151, 180, 0.34, 0.63, 5.8, 0.14, 1.5);   /* 失谐 → 厚度 */
        p_fm(o, s, 0.42, 1.10, 176, 118, 0.28, 1.24, 4.4, 0.20, 1.9);   /* 吼腔的第二个共振峰 */
        /* 气流：由暗到亮的扫频（"它张开了嘴"） */
        p_noiseSweep(o, s, 0.04, 1.70, 0.26, 0.02, 0.20, 1.6, r, false);
        /* 尾音：一声胸腔共鸣的收束，避免"声音被掐断" */
        p_tone(o, s, 1.55, 0.70, 92, 62, 0.20, 'sine', 0.06, 2.6);
      }
    },
    /* ---- BOSS：每波开始的咆哮（比苏醒短、更凶、带金属摩擦）---- */
    'bossRoar': {
      dur: 1.45, vol: 0.95, gen: function (o, s, r) {
        p_tone(o, s, 0, 1.05, 74, 48, 0.44, 'sine', 0.05, 1.9);         /* 胸腔底 */
        p_fm(o, s, 0, 0.95, 168, 138, 0.42, 0.66, 5.6, 0.06, 1.9);      /* 吼腔 */
        p_fm(o, s, 0.02, 0.90, 252, 196, 0.28, 1.33, 4.2, 0.08, 2.2);   /* 上方共鸣峰 */
        p_noiseSweep(o, s, 0.02, 0.90, 0.28, 0.05, 0.24, 2.4, r, false);/* 喷出的气 */
        /* 金属刮擦：高通细层，给"威压"一点锋利的边，但只占很小比例 */
        p_noise(o, s, 0.00, 0.26, 0.10, 0.62, 7, r);
        p_fm(o, s, 0.66, 0.40, 210, 132, 0.22, 2.0, 4.6, 0.02, 4.0);    /* 收尾"咕噜" */
      }
    },
    /* ---- BOSS：沉睡回落（气息变远、逐渐闭眼）---- */
    'bossSleep': {
      dur: 1.60, vol: 0.85, gen: function (o, s, r) {
        p_fm(o, s, 0, 1.10, 140, 66, 0.34, 0.66, 4.6, 0.08, 2.0);
        p_tone(o, s, 0, 1.30, 82, 44, 0.30, 'sine', 0.08, 1.8);
        p_noiseSweep(o, s, 0, 1.20, 0.22, 0.22, 0.02, 2.2, r, false);   /* 亮→暗 = 远去 */
        p_tone(o, s, 1.10, 0.42, 60, 40, 0.16, 'sine', 0.06, 3.2);
      }
    },
    /* ---- BOSS：吐弹（喉音 + 喷气；可频繁触发 ⇒ 时长与音量都收着）---- */
    'bossSpit': {
      dur: 0.50, vol: 0.75, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.20, 190, 120, 0.30, 0.8, 4.6, 0.004, 9);        /* 喉音 */
        p_noiseSweep(o, s, 0.02, 0.34, 0.24, 0.08, 0.46, 5.5, r, false);/* 喷出的气流 */
        p_tone(o, s, 0.04, 0.22, 320, 200, 0.16, 'tri', 0.006, 8);
      }
    },
    /* ---- BOSS：受爆伤害（"命中"而非"爆炸"，与玩家炸弹音区分开）---- */
    'bossHit': {
      dur: 0.70, vol: 0.95, gen: function (o, s, r) {
        p_fm(o, s, 0, 0.26, 168, 60, 0.52, 1.2, 5.0, 0.002, 6.5);       /* 沉重的钝击 */
        p_tone(o, s, 0, 0.44, 110, 42, 0.48, 'sine', 0.002, 4.2);
        p_noise(o, s, 0, 0.16, 0.28, 0.42, 11, r);                      /* 皮开的碎响 */
        p_fm(o, s, 0.14, 0.44, 130, 74, 0.24, 0.66, 4.2, 0.06, 3.4);    /* 痛的闷哼 */
      }
    },
    /* ---- BOSS：死亡崩解（长、下行、哀嚎 → 尘埃落定）---- */
    'bossDeath': {
      dur: 2.80, vol: 0.95, gen: function (o, s, r) {
        p_tone(o, s, 0, 1.30, 120, 40, 0.50, 'sine', 0.03, 1.4);        /* 崩解下行 */
        p_fm(o, s, 0, 1.20, 200, 70, 0.42, 0.7, 5.6, 0.04, 1.5);        /* 哀嚎 */
        p_fm(o, s, 0.04, 1.10, 300, 104, 0.26, 1.4, 4.6, 0.05, 1.7);
        p_noiseSweep(o, s, 0.02, 1.70, 0.32, 0.52, 0.03, 2.0, r, false);/* 崩落的尘与渣 */
        for (var i = 0; i < 5; i++)                                     /* 连续塌方 */
          p_tone(o, s, 0.55 + i * 0.26, 0.30, 96 - i * 8, 48, 0.22, 'sine', 0.006, 5);
        p_tone(o, s, 2.05, 0.65, 56, 33, 0.30, 'sine', 0.05, 2.2);      /* 最后的地鸣 */
      }
    }
  };

  /* 常见别名 */
  var SFX_ALIAS = {
    'doublejump': 'doubleJump', 'walljump': 'wallJump', 'wall_jump': 'wallJump',
    'waterenter': 'waterEnter', 'waterexit': 'waterExit', 'smokeenter': 'smokeEnter',
    'fallingspike': 'fallingSpike', 'laserhit': 'laserHit', 'flagplace': 'flagPlace',
    'flagpull': 'flagPull', 'flagpickup': 'flagPickup', 'dooropen': 'doorOpen',
    'doorclose': 'doorClose', 'ui_hover': 'uiHover', 'ui_click': 'uiClick',
    'uiclick': 'uiClick', 'uihover': 'uiHover', 'double_jump': 'doubleJump',
    /* ★怪物 / BOSS 音效别名★（小写、下划线两种写法都归到同一个键，
       与既有纪律一致：调用方写错大小写不会变成"静默无声"）。 */
    'gravecrush': 'graveCrush', 'grave_crush': 'graveCrush',
    'foeghostspawn': 'foeGhostSpawn', 'foe_ghost_spawn': 'foeGhostSpawn',
    'ghostspawn': 'foeGhostSpawn', 'ghost_spawn': 'foeGhostSpawn',
    'foeghostdie': 'foeGhostDie', 'foe_ghost_die': 'foeGhostDie',
    'ghostdie': 'foeGhostDie', 'ghost_die': 'foeGhostDie',
    'foeghostshot': 'foeGhostShot', 'foe_ghost_shot': 'foeGhostShot',
    'ghostshot': 'foeGhostShot', 'ghost_shot': 'foeGhostShot',
    'foefirespawn': 'foeFireSpawn', 'foe_fire_spawn': 'foeFireSpawn',
    'foefiredie': 'foeFireDie', 'foe_fire_die': 'foeFireDie',
    'skeltick': 'skelTick', 'skel_tick': 'skelTick',
    'skelalert': 'skelAlert', 'skel_alert': 'skelAlert',
    'skelcharge': 'skelCharge', 'skel_charge': 'skelCharge',
    'skeldash': 'skelDash', 'skel_dash': 'skelDash',
    'skelstun': 'skelStun', 'skel_stun': 'skelStun',
    'skeldie': 'skelDie', 'skel_die': 'skelDie',
    'bossawake': 'bossAwake', 'boss_awake': 'bossAwake',
    'bossroar': 'bossRoar', 'boss_roar': 'bossRoar',
    'bosssleep': 'bossSleep', 'boss_sleep': 'bossSleep',
    'bossspit': 'bossSpit', 'boss_spit': 'bossSpit',
    'bosshit': 'bossHit', 'boss_hit': 'bossHit',
    'bossdeath': 'bossDeath', 'boss_death': 'bossDeath'
  };

  /* ★按前缀兜底解析★：万一某个调用点漏登记别名，也不会变成"静默无声"
     （那是最糟的失败模式 —— 用户听不到声音，也不知道为什么）。
     `foeGhostSpawn` → 依次尝试 …Spawn / …Roar / …Die / …Hit / …Awake；
     只在**完全找不到**时返回 null（保持既有"未知音效=静默"的语义，不抛错）。 */
  function resolveSfxKey(name) {
    var k = SFX_ALIAS[name] || name;
    if (SFX_DEFS[k]) return k;
    var m = String(k).match(/^(foeGhost|foeFire|foe|skel|boss|grave)/);
    if (m) {
      var pre = m[1];
      var cands = [pre + 'Spawn', pre + 'Roar', pre + 'Die', pre + 'Hit', pre + 'Awake'];
      for (var i = 0; i < cands.length; i++) if (SFX_DEFS[cands[i]]) return cands[i];
    }
    return null;
  }

  function getSfxBuffer(name) {
    var key = resolveSfxKey(name);
    if (!key) return null;
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

  /* opt（可选）：UI 层用它做「同一音效的音高微随机 + 分层音量」，
     避免连点同一个按钮时听觉疲劳（一致性 > 丰富度，只在音高上做 0.9~1.1 抖动）。
     不传 opt 时行为与旧版**逐字节等价**（rate=1 / vol=1）。 */
  function playSfx(name, x, y, opt) {
    ensureReady();
    if (!ctx || !built) return;
    var buf = getSfxBuffer(name);
    if (!buf) return;

    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain();
    var gain = 1, panVal = 0;
    var rate = 1, busVol = 1;
    if (opt) {
      if (typeof opt.rate === 'number' && isFinite(opt.rate)) rate = clamp(opt.rate, 0.25, 4);
      if (typeof opt.vol === 'number' && isFinite(opt.vol)) busVol = clamp(opt.vol, 0, 4);
    }
    try { src.playbackRate.value = rate; } catch (e) { }
    if (typeof x === 'number' && typeof y === 'number') {
      var dx = x - listener.x, dy = y - listener.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      gain = clamp(1 - d / 420, 0.06, 1);
      panVal = clamp(dx / 200, -1, 1);
    }
    /* 独立音量系数：起跳/落地等高频音效在 SFX_DEFS 里给了 vol<1，
       只降音量、不改音色（距离衰减 gain 照旧相乘）。 */
    var def = SFX_DEFS[resolveSfxKey(name)];
    if (def && typeof def.vol === 'number' && isFinite(def.vol)) gain *= def.vol;
    gain *= busVol;
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
  /* 后台预热（共享实现）                                                 */
  /* ------------------------------------------------------------------ */
  /* 按顺序把 list 里的音乐逐一合成进缓存。要点：
     · 每条轨分片合成（每帧只算几 ms），绝不阻塞主线程。
     · 一旦出现「前台」任务（玩家正在等的那条轨 / 离线渲染），立即停手让位，
       否则预热会把进场音乐拖慢数秒。
     · 用 prewarmToken 作废过期任务：新的预热一启动，旧的立刻收尾退出，
       避免多个预热循环同时抢主线程。 */
  function _warmList(list) {
    ensureReady();
    if (!built) return Promise.resolve(0);
    /* 不再按 list 长度抬高条数上限（那是"关卡数=缓存数"的老思路，
       400 关会算出 6.3GB）。改为：只保证「内存预算 ≥ 常驻轨 + 少量滚动窗口」，
       具体容量由 MUSIC_CACHE_BYTES 决定，LRU 自动淘汰远端关卡。
       这样 1000 关也能稳定运行：进某关 → 该关轨进缓存 → 旧关轨按 LRU 出局。 */
    /* ★boss 也是常驻轨★：它是**固定种子单轨**（`BOSS_THEME_V1`，所有关卡共用），
       一旦算好就该一直留着 —— 否则进新关时被 LRU 淘汰，下次遇 BOSS 又要等 ~4.5s。 */
    _cachePinned.menu = true; _cachePinned.pause = true; _cachePinned.boss = true;

    warmReady = false; warmPending = true;
    var warmTok = ++prewarmToken;
    return new Promise(function (resolve) {
      var idx = 0, made = 0;
      var pending = 0;                 /* 同时只允许一个后台任务在跑 */
      function idle(fn) {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 250 });
        else setTimeout(fn, 0);
      }
      function foregroundBusy() { return !!(synthJob || pendingEnsure) || renderPending > 0; }
      function next() {
        if (warmTok !== prewarmToken) { resolve(made); return; }
        if (idx >= list.length) { warmReady = true; warmPending = false; resolve(made); return; }
        if (foregroundBusy()) { idle(next); return; }
        var item = list[idx++];
        var chart = compose(item.kind, item.level);
        var key = trackKey(item.kind, chart);
        if (musicCache[key]) { idle(next); return; }
        var job = createSynthJob(chart, item.kind);
        (function advance(deadline) {
          if (warmTok !== prewarmToken) { resolve(made); return; }
          if (foregroundBusy()) { idle(advance); return; }
          var budget = (deadline && deadline.timeRemaining) ? Math.min(10, deadline.timeRemaining() + 2) : 6;
          var done = false;
          try { done = job.step(budget); } catch (e) { done = true; }
          if (!done) { idle(advance); return; }
          var buf = job.finish();
          if (buf) { musicCache[key] = buf; musicCacheOrder.push(key); _noteBytes(key, buf); made++; }
          idle(next);
        })();
      }
      idle(next);
    });
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
      /* ★'boss' 是合法场景★：BOSS 激活时由 runtime 的 `_pbossBgm(true)` 切入，
         死亡/沉睡时用 'level' 切回关卡曲。白名单必须放行，否则会被静默降级成
         'silent'（表现为"进 BOSS 房突然没声了"）。 */
      if (kind !== 'menu' && kind !== 'pause' && kind !== 'level' && kind !== 'boss' && kind !== 'silent') kind = 'silent';
      scene = kind;
      sceneLevel = level || null;
      ensureReady();
      if (built) _applyScene();
    },

    /* ★当前场景（只读）★：供验收脚本断言"暂停→继续后是否还在 BOSS 主题"，
       以及排查"音乐莫名切错"时直接读真实状态（而不是去数 setScene 调用）。 */
    scene: function () { return scene; },

    setVolumes: function (music, sfx) {
      if (typeof music === 'number') musicVolume = clamp(music, 0, 1);
      if (typeof sfx === 'number') sfxVolume = clamp(sfx, 0, 1);
      if (built) {
        var t = ctx.currentTime;
        try { musicBus.gain.setTargetAtTime(musicVolume, t, 0.05); } catch (e) { musicBus.gain.value = musicVolume; }
        try { sfxBus.gain.setTargetAtTime(sfxVolume, t, 0.05); } catch (e) { sfxBus.gain.value = sfxVolume; }
      }
    },

    sfx: function (name, x, y, opt) { playSfx(name, x, y, opt); },

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

    /* 预热：后台空闲地把**玩家可能马上听到的**音乐预先合成进缓存，
       这样进关卡是"命中缓存、零延迟起播"，彻底消除切换延迟。
       ★ 关键改动：不再全量预热所有关卡（支撑大规模地图）★
         合成一条轨要 ~1.3~1.7s CPU，400 关就是 ~10 分钟纯后台运算，而且大部分
         会在 LRU 里被淘汰 —— 纯浪费电、还抢主线程。改为**滚动窗口**：
         · 常驻：menu / pause（必响）；
         · 窗口：从 `fromIdx` 起 `PREWARM_WINDOW` 关（默认向后 8 关），
           覆盖"接下来最可能玩的几关"；
         · 玩家真正进入某关时，`ensureTrack` 会即时把它补进缓存（若不在窗口内），
           代价是一次 ~1.5s 的后台合成，且界面已在运行、不等它。
       `fromIdx` 由调用方传入（game.js 传当前选中的页码起点）。
       返回 Promise，resolve 时窗口预热完成（或在途任务被新任务替换时提前结束）。 */
    PREWARM_WINDOW: 8,
    prewarm: function (levels, fromIdx) {
      var list = [];
      /* 「菜单 / 暂停」必须排在最前：它们是玩家最先听到的两段音乐。 */
      list.push({ kind: 'menu', level: null });
      list.push({ kind: 'pause', level: null });
      if (levels && levels.length) {
        var n = levels.length;
        /* 支持两种签名：
             prewarm(levels)            → 从第 0 关起开窗（兼容旧调用）
             prewarm(levels, fromIdx)   → 从指定关起开窗（推荐） */
        var st = Number.isFinite(fromIdx) ? Math.max(0, Math.min(n - 1, Math.floor(fromIdx))) : 0;
        var win = Math.min(n, st + (this.PREWARM_WINDOW || 8));
        for (var i = st; i < win; i++) list.push({ kind: 'level', level: levels[i] });
      }
      return _warmList(list);
    },
    /* 换个窗口重新预热（翻页/跳关时调用；会作废上一次窗口任务） */
    prewarmAt: function (levels, fromIdx) { return this.prewarm(levels, fromIdx); },
    /* 缓存诊断（供验收脚本读取真实占用） */
    cacheStats: function () {
      var n = 0, b = 0;
      for (var k in musicCache) { n++; b += (musicCacheBytes[k] || 0); }
      return { tracks: n, bytes: b, mb: +(b / 1048576).toFixed(1),
        maxTracks: MUSIC_CACHE_MAX, maxMB: Math.round(MUSIC_CACHE_BYTES / 1048576),
        pinned: Object.keys(_cachePinned) };
    },

    /* 启动预热：进入主菜单前（甚至用户手势之前）就把「菜单/暂停」两轨算出来。
       合成纯粹是 CPU 数学运算，不依赖已运行的 AudioContext，所以在 boot 阶段
       就能开始；等玩家按下按键时，这两条已进缓存 → 音乐瞬间响起、不再等待。
       与后续 prewarm 用同一个共享 token，避免互相抢主线程 / 重复劳动。 */
    bootWarm: function () {
      ensureReady();                       /* 创建（可能仍在 suspended 的）ctx + 音频图 */
      if (!built) return Promise.resolve(0);
      /* ★BOSS 轨必须一起预热★（用户报"BOSS 专属 BGM"后补）：
         它虽是固定种子单轨，但首次合成实测 ~4.5s。若不预热，第一次进 BOSS 房时
         "淡出关卡曲 → 淡入 BOSS 曲"会晚 4~5 秒才发生（BOSS 已苏醒、血条都出来了，
         音乐还停在关卡曲上）。放在 menu/pause 之后：二者是玩家最先听到的两段。 */
      return _warmList([
        { kind: 'menu', level: null },
        { kind: 'pause', level: null },
        { kind: 'boss', level: null }
      ]);
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
