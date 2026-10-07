/* ============================================================================
 * fx.js — die2jump 表现层特效
 * ----------------------------------------------------------------------------
 * 1) SceneFX   : 全屏 WebGL(片元着色器) 场景转场遮罩；不支持 WebGL 时回退 Canvas2D。
 *                风格化遮罩库（8 套）：水墨晕染 / 斜切速度线(P5) / 漫画碎格(P5)
 *                / 光圈收缩(宝可梦) / 像素溶解(蔚蓝) / 马赛克格 / 百叶色带 / 漩涡。
 *                每次随机镜像方向与种子，同一模式重复出现也不会完全一样。
 * 2) Loading   : 兜底加载页（纯黑 + 简单可爱像素动画，无音乐）。
 *                正常情况下不出现；一旦出现至少停留 2s，避免闪烁。
 *
 * 公开 API：
 *   SceneFX.play(mode, dur, onSwap) -> Promise   播放一次转场（onSwap 在遮罩全遮时调用）
 *   SceneFX.mode()                               随机/轮转取一个主题模式名
 *   Loading.show() / hide() / setProgress(x) / waitMin()
 *   Loading.whenNeeded(hasReadyFn)               仅在必要时显示
 * ========================================================================== */
(function (global) {
  'use strict';

  var DISABLED = (typeof global.__noFX !== 'undefined') ? !!global.__noFX : false;

  /* ========================================================================
   * 1) 场景转场（WebGL 片元着色器）
   * ====================================================================== */
  /* 八套风格化遮罩：水墨晕染 / 斜切速度线(P5) / 漫画碎格(P5) / 光圈收缩(宝可梦)
     / 像素溶解(蔚蓝) / 马赛克格 / 百叶色带 / 漩涡。
     每套的 coord 均归一化到 [0,1]，保证 cover=1 时全域不透明（换页不会露馅）。 */
  var MODES = ['ink', 'diag', 'panels', 'iris', 'pixel', 'mosaic', 'bars', 'spiral'];
  var SIMPLE = ['diag', 'iris', 'pixel', 'bars'];          /* 干净利落：斜切/光圈/像素/百叶 */
  var FANCY = ['ink', 'panels', 'mosaic', 'spiral'];       /* 偶尔华丽：水墨/漫画/马赛克/漩涡 */
  var THEME = {
    ink: { a: [0.043, 0.059, 0.102], b: [0.106, 0.141, 0.212], e: [0.878, 0.647, 0.125] },  /* 深蓝墨 + 描金 */
    diag: { a: [0.086, 0.012, 0.020], b: [0.310, 0.020, 0.039], e: [1.000, 0.200, 0.240] },  /* 猩红黑 + 亮红（P5） */
    panels: { a: [0.930, 0.910, 0.880], b: [0.800, 0.780, 0.752], e: [0.830, 0.100, 0.140] },/* 米白纸 + 朱红（漫画） */
    iris: { a: [0.024, 0.125, 0.165], b: [0.039, 0.188, 0.220], e: [0.400, 0.788, 0.722] },  /* 青玉 */
    pixel: { a: [0.063, 0.094, 0.149], b: [0.114, 0.165, 0.239], e: [0.969, 0.816, 0.388] }, /* 夜蓝 + 金 */
    mosaic: { a: [0.075, 0.043, 0.129], b: [0.149, 0.086, 0.235], e: [0.720, 0.550, 1.000] },/* 紫罗兰 */
    bars: { a: [0.875, 0.914, 0.961], b: [0.725, 0.796, 0.878], e: [1.000, 1.000, 1.000] },  /* 云白 */
    spiral: { a: [0.020, 0.114, 0.106], b: [0.035, 0.180, 0.165], e: [0.420, 0.940, 0.800] }  /* 薄荷 */
  };
  var MODE_IDX = { ink: 0, diag: 1, panels: 2, iris: 3, pixel: 4, mosaic: 5, bars: 6, spiral: 7 };

  var VS_SRC = 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}';
  var FS_SRC = [
    'precision highp float;',
    'uniform vec2 u_res; uniform float u_time; uniform float u_cover;',
    'uniform float u_mode; uniform float u_seed; uniform float u_dir;',
    'uniform vec3 u_colA; uniform vec3 u_colB; uniform vec3 u_edge;',
    'float hash21(vec2 p){p=fract(p*vec2(123.34,345.45)+u_seed);p+=dot(p,p+34.345);return fract(p.x*p.y);}',
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);',
    ' float a=hash21(i),b=hash21(i+vec2(1.0,0.0)),c=hash21(i+vec2(0.0,1.0)),d=hash21(i+vec2(1.0,1.0));',
    ' return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}',
    'float fbm(vec2 p){float s=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);',
    ' for(int i=0;i<5;i++){s+=a*vnoise(p);p=m*p;a*=0.5;}return s;}',
    /* 格子哈希：掺入 u_seed，保证每次播放的碎块顺序都不同 */
    'float chash(vec2 c){return fract(sin(dot(c,vec2(41.3,289.1))+u_seed*1.7)*43758.5453);}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/u_res; float asp=u_res.x/max(u_res.y,1.0);',
    ' if(u_dir<0.5){ uv.x=1.0-uv.x; }',                     /* 每次随机左右镜像，增加变化 */
    ' vec2 p=vec2(uv.x*asp,uv.y); float t=u_time;',
    ' float coord; float wob; float hard;',
    ' if(u_mode<0.5){',                                     /* 0 水墨晕染：斜向笔触 + 墨迹晕开 */
    '   float dir=uv.x*0.52+(1.0-uv.y)*0.48;',
    '   coord=fbm(p*3.0+vec2(t*0.15,-t*0.12))*0.50+dir*0.46+0.01; wob=fbm(p*6.0-t*0.25)*0.07; hard=0.0;',
    ' } else if(u_mode<1.5){',                              /* 1 斜切速度线（P5） */
    '   float d=uv.x*0.62+(1.0-uv.y)*0.38;',
    '   coord=floor(d*7.0+0.5)/7.0; wob=sin(d*88.0-t*7.0)*0.02; hard=1.0;',
    ' } else if(u_mode<2.5){',                              /* 2 漫画碎格（P5） */
    '   vec2 g=floor(p*6.0); coord=clamp((uv.x*0.5+(1.0-uv.y)*0.5)*0.62+chash(g)*0.46,0.0,1.0);',
    '   wob=0.0; hard=1.0;',
    ' } else if(u_mode<3.5){',                              /* 3 光圈收缩（宝可梦） */
    '   float rad=length((uv-0.5)*vec2(asp,1.0))/max(asp,1.0)*2.0;',
    '   float box=max(abs(uv.x-0.5)*2.0,abs(uv.y-0.5)*2.0);',
    '   coord=clamp(max(box*0.94,rad*0.86),0.0,1.2); wob=fbm(p*4.0+t*0.3)*0.06; hard=0.0;',
    ' } else if(u_mode<4.5){',                              /* 4 像素溶解（蔚蓝） */
    '   vec2 cell=floor(p*20.0); coord=clamp(chash(cell)*0.66+uv.x*0.2+(1.0-uv.y)*0.2,0.0,1.0);',
    '   wob=0.0; hard=1.0;',
    ' } else if(u_mode<5.5){',                              /* 5 马赛克格 */
    '   vec2 cell=floor(p*13.0); float sw=uv.x*0.55+(1.0-uv.y)*0.45;',
    '   coord=clamp(floor((sw*0.72+chash(cell)*0.42)*6.0)/6.0,0.0,1.0); wob=0.0; hard=1.0;',
    ' } else if(u_mode<6.5){',                              /* 6 百叶色带 */
    '   float band=floor(uv.y*9.0); coord=clamp(uv.x*1.15+chash(vec2(band,3.0))*0.35-0.1,0.0,1.1);',
    '   wob=0.0; hard=1.0;',
    ' } else {',                                            /* 7 漩涡 */
    '   float ang=atan(uv.y-0.5,uv.x-0.5)/6.2831853+0.5; float rad=length(uv-0.5)*2.0;',
    '   coord=clamp(ang*0.62+rad*0.5,0.0,1.1); wob=fbm(p*3.0+t*0.2)*0.05; hard=0.0;',
    ' }',
    ' float b=mix(-0.32,1.62,u_cover);',
    ' float d=coord+wob-b;',
    ' float soft=mix(0.032,0.010,hard);',                   /* 硬边模式边缘更锐利 */
    ' float covered=smoothstep(soft,-soft,d);',
    ' float edge=smoothstep(0.10,0.0,abs(d))*(0.30+0.70*u_cover);',
    ' float g=clamp(uv.y*0.8+fbm(p*2.0+t*0.2)*0.25,0.0,1.0);',
    ' vec3 fill=mix(u_colA,u_colB,g);',
    ' if(u_mode>0.5&&u_mode<1.5){ float dd=uv.x*0.62+(1.0-uv.y)*0.38; fill+=0.07*(0.5+0.5*sin(dd*118.0-t*9.0)); }', /* 速度线 */
    ' if(u_mode>2.5&&u_mode<3.5){ fill+=0.05*(0.5+0.5*sin(uv.y*136.0-t*8.0)); }',                                       /* 扫描线 */
    ' if(u_mode>5.5&&u_mode<6.5){ fill=mix(u_colA,u_colB,step(0.5,fract(uv.y*9.0))); }',                                 /* 交替色带 */
    ' vec3 col=fill*covered+u_edge*edge;',
    ' float alpha=clamp(covered+edge*0.85,0.0,1.0);',
    ' gl_FragColor=vec4(col,alpha);',
    '}'
  ].join('\n');

  var gl = null, glCanvas = null, prog = null, uLoc = {}, ready = false, tried = false;
  var fallback = null; /* Canvas2D 画布（WebGL 不可用时） */

  function init() {
    if (ready || tried) return ready;
    tried = true;
    if (DISABLED) return false;
    try {
      glCanvas = document.createElement('canvas');
      glCanvas.id = 'fxCanvas';
      glCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:40;pointer-events:none;display:none;';
      document.body.appendChild(glCanvas);
      var opts = { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false };
      gl = glCanvas.getContext('webgl', opts) || glCanvas.getContext('experimental-webgl', opts);
      if (!gl) { glCanvas.remove(); glCanvas = null; return false; }
      var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(vs, VS_SRC); gl.compileShader(vs);
      gl.shaderSource(fs, FS_SRC); gl.compileShader(fs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        if (global.console) console.warn('[fx] shader compile failed', gl.getShaderInfoLog(fs));
        glCanvas.remove(); glCanvas = null; gl = null; return false;
      }
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        glCanvas.remove(); glCanvas = null; gl = null; prog = null; return false;
      }
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var aPos = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      ['u_res', 'u_time', 'u_cover', 'u_mode', 'u_seed', 'u_dir', 'u_colA', 'u_colB', 'u_edge'].forEach(function (k) {
        uLoc[k] = gl.getUniformLocation(prog, k);
      });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      resizeGL();
      global.addEventListener('resize', resizeGL);
      ready = true;
    } catch (e) {
      if (global.console) console.warn('[fx] webgl init error', e && e.message);
      if (glCanvas && glCanvas.parentNode) glCanvas.remove();
      glCanvas = null; gl = null; ready = false;
    }
    return ready;
  }

  function resizeGL() {
    if (!glCanvas) return;
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var w = Math.max(1, Math.round((global.innerWidth || 960) * dpr));
    var h = Math.max(1, Math.round((global.innerHeight || 600) * dpr));
    if (glCanvas.width !== w || glCanvas.height !== h) { glCanvas.width = w; glCanvas.height = h; }
    if (gl) gl.viewport(0, 0, w, h);
  }

  function initFallback() {
    if (fallback) return fallback;
    fallback = document.createElement('canvas');
    fallback.id = 'fxCanvas2d';
    fallback.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:40;pointer-events:none;display:none;';
    document.body.appendChild(fallback);
    return fallback;
  }

  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* 覆盖率曲线：前 42% 铺开 → 42%~58% 保持“全遮不透明”平台 → 后 42% 揭开。
     中间的平台保证 swap（换页）一定发生在完全遮住的一段时间内，
     不会因为掉帧错过单帧峰值而在切换瞬间露出旧/新画面。 */
  function coverAt(p) {
    if (p < 0.42) return easeInOut(p / 0.42);
    if (p < 0.58) return 1;
    return easeInOut((1 - p) / 0.42);
  }

  var playing = false;
  var _lastCover = 0;   /* 最近一帧的遮罩覆盖率（0~1），供自测断言换页发生在全遮时 */

  function play(mode, dur, onSwap) {
    if (DISABLED) { if (onSwap) { try { onSwap(); } catch (e) { } } return Promise.resolve(); }
    if (playing) { if (onSwap) { try { onSwap(); } catch (e) { } } return Promise.resolve(); }
    var name = MODES.indexOf(mode) >= 0 ? mode : 'ink';
    var midx = MODE_IDX[name];
    var theme = THEME[name];
    var D = Math.max(0.28, dur || 0.72);
    playing = true;
    var compResolve;                 /* 动画结束 resolve */
    var comp = new Promise(function (r) { compResolve = r; });

    if (init()) {
      glCanvas.style.display = 'block';
      var seed = (Math.random() * 1000) % 1000;
      var dir = Math.random() < 0.5 ? 0 : 1;   /* 每次随机镜像方向 */
      var t0 = performance.now();
      var swapped = false;
      function tick(now) {
        var prog01 = Math.min(1, (now - t0) / (D * 1000));
        /* 前 42% 覆盖，中段 42%~58% 全遮平台，后 42% 揭开；在平台内执行 swap */
        var cover = coverAt(prog01);
        _lastCover = cover;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uLoc.u_res, glCanvas.width, glCanvas.height);
        gl.uniform1f(uLoc.u_time, (now / 1000) % 1000);
        gl.uniform1f(uLoc.u_cover, cover);
        gl.uniform1f(uLoc.u_mode, midx);
        gl.uniform1f(uLoc.u_seed, seed);
        gl.uniform1f(uLoc.u_dir, dir);
        gl.uniform3fv(uLoc.u_colA, theme.a);
        gl.uniform3fv(uLoc.u_colB, theme.b);
        gl.uniform3fv(uLoc.u_edge, theme.e);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!swapped && prog01 >= 0.5) { swapped = true; if (onSwap) { try { onSwap(); } catch (e) { } } }
        if (prog01 < 1) { requestAnimationFrame(tick); return; }
        glCanvas.style.display = 'none';
        gl.clear(gl.COLOR_BUFFER_BIT);
        playing = false; compResolve();
      }
      requestAnimationFrame(tick);
      return comp;
    }

    /* Canvas2D 兜底（无 WebGL）：滑动渐变 + 发光边 */
    var c2 = initFallback(), ctx2 = c2.getContext('2d');
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    c2.width = Math.round((global.innerWidth || 960) * dpr);
    c2.height = Math.round((global.innerHeight || 600) * dpr);
    c2.style.display = 'block';
    var st = performance.now(), sw2 = false;
    function tick2(now) {
      var p01 = Math.min(1, (now - st) / (D * 1000));
      var cover = coverAt(p01);
      _lastCover = cover;
      var W = c2.width, H = c2.height;
      ctx2.clearRect(0, 0, W, H);
      var g = ctx2.createLinearGradient(0, 0, W * 0.6, H);
      g.addColorStop(0, 'rgba(' + theme.a.map(v => Math.round(v * 255)).join(',') + ',' + cover.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + theme.b.map(v => Math.round(v * 255)).join(',') + ',' + cover.toFixed(3) + ')');
      ctx2.fillStyle = g;
      var rad = Math.max(W, H) * (0.15 + cover * 0.95);
      ctx2.beginPath(); ctx2.arc(W / 2, H / 2, rad, 0, Math.PI * 2); ctx2.fill();
      if (!sw2 && p01 >= 0.5) { sw2 = true; if (onSwap) { try { onSwap(); } catch (e) { } } }
      if (p01 < 1) { requestAnimationFrame(tick2); return; }
      c2.style.display = 'none'; playing = false; compResolve();
    }
    requestAnimationFrame(tick2);
    return comp;
  }

  var _mi = 0;
  var _fancyCounter = 0;
  /* 选择本次转场模式：按“简单”序列轮转打底（保证每次切换都有清晰可辨的遮罩动效），
     每隔几次插入一次华丽特别的，兼顾辨识度与新鲜感、又不会让华丽转场变廉价。
     每次还可能随机镜像方向/换种子（在 play 内），同一模式重复出现也不会完全一样。 */
  function modeName() {
    _fancyCounter++;
    if (_fancyCounter % 4 === 0) return FANCY[Math.floor(Math.random() * FANCY.length)];
    _mi = (_mi + 1) % SIMPLE.length;
    return SIMPLE[_mi];
  }
  function isFancy(m) { return FANCY.indexOf(m) >= 0; }

  var SceneFX = {
    MODES: MODES,
    SIMPLE: SIMPLE,
    FANCY: FANCY,
    play: play,
    mode: modeName,
    isFancy: isFancy,
    isPlaying: function () { return playing; },
    busy: function () { return playing; },
    enabled: function () { return !DISABLED; },
    ready: function () { return ready; },
    cover: function () { return _lastCover; },
    /* 自测用：以指定覆盖率渲染一帧，返回采样点的最小 alpha（1=完全不透明） */
    _probe: function (mode, cover) {
      if (!init()) return null;
      var name = MODES.indexOf(mode) >= 0 ? mode : 'ink';
      var th = THEME[name];
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uLoc.u_res, glCanvas.width, glCanvas.height);
      gl.uniform1f(uLoc.u_time, 1.0);
      gl.uniform1f(uLoc.u_cover, cover);
      gl.uniform1f(uLoc.u_mode, MODE_IDX[name]);
      gl.uniform1f(uLoc.u_seed, 7.0);
      gl.uniform1f(uLoc.u_dir, 0.0);
      gl.uniform3fv(uLoc.u_colA, th.a);
      gl.uniform3fv(uLoc.u_colB, th.b);
      gl.uniform3fv(uLoc.u_edge, th.e);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var W = glCanvas.width, H = glCanvas.height;
      var minA = 1, under = 0, tot = 0;
      var step = 16;
      var px = new Uint8Array(4);
      for (var y = step; y < H; y += step) {
        for (var x = step; x < W; x += step) {
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          var a = px[3] / 255; tot++;
          if (a < minA) minA = a;
          if (a < 0.985) under++;
        }
      }
      return { minA: +minA.toFixed(3), underRatio: +(under / tot).toFixed(4), samples: tot };
    },
    /* 自测用：以指定模式/覆盖率渲染一帧，并叠在“模拟旧页面”背景上导出 PNG dataURL，
       便于肉眼检查遮罩形状是否好看、是否有辨识度。 */
    _renderPNG: function (mode, cover) {
      if (!init()) return null;
      var name = MODES.indexOf(mode) >= 0 ? mode : 'ink';
      var th = THEME[name];
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uLoc.u_res, glCanvas.width, glCanvas.height);
      gl.uniform1f(uLoc.u_time, 2.0);
      gl.uniform1f(uLoc.u_cover, cover);
      gl.uniform1f(uLoc.u_mode, MODE_IDX[name]);
      gl.uniform1f(uLoc.u_seed, 7.0);
      gl.uniform1f(uLoc.u_dir, 0.0);
      gl.uniform3fv(uLoc.u_colA, th.a);
      gl.uniform3fv(uLoc.u_colB, th.b);
      gl.uniform3fv(uLoc.u_edge, th.e);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var W = glCanvas.width, H = glCanvas.height;
      var px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var q = c.getContext('2d');
      var img = q.createImageData(W, H);
      /* 背景：模拟一张“旧页面”（暖灰渐变 + 网格），便于看清遮罩边缘 */
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var i = (y * W + x) * 4;
          var gy = y / H;
          var bgR = 60 + gy * 40, bgG = 66 + gy * 44, bgB = 84 + gy * 50;
          if (((x >> 5) + (y >> 5)) % 2 === 0) { bgR += 10; bgG += 10; bgB += 12; }
          var a = px[i + 3] / 255;                    /* 遮罩 alpha */
          var sa = a;                                  /* 非预乘 */
          img.data[i] = Math.round(px[i] * sa + bgR * (1 - sa));
          img.data[i + 1] = Math.round(px[i + 1] * sa + bgG * (1 - sa));
          img.data[i + 2] = Math.round(px[i + 2] * sa + bgB * (1 - sa));
          img.data[i + 3] = 255;
        }
      }
      q.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
    _init: init
  };

  /* ========================================================================
   * 2) 兜底加载页（纯黑 + 像素动画 + 进度）
   * ====================================================================== */
  var LOAD_MIN_MS = 2000;
  /* 像素画逻辑分辨率与显示倍率（cssScale 为 CSS 像素/逻辑像素） */
  var LOAD_LW = 120, LOAD_LH = 72, LOAD_CSS_SCALE = 3;

  var Loading = {
    el: null, cv: null, cx: null, raf: 0, shown: 0, _prog: 0, _target: 0, _done: false, _minP: null,
    ensure: function () {
      if (this.el) return;
      var el = document.createElement('div');
      el.id = 'loadingScreen';
      /* z-index 30：位于页面画布(z2)之上、转场遮罩(z40)之下，
         这样进入关卡时遮罩能盖住加载页，转场观感一致。 */
      el.style.cssText = 'position:fixed;inset:0;z-index:30;display:none;align-items:center;justify-content:center;' +
        'background:#05070c;color:#e8f1ff;font-family:"Courier New",monospace;';
      var inner = document.createElement('div');
      inner.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:18px;';
      var cv = document.createElement('canvas');
      cv.id = 'loadingCanvas';
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      /* 设备像素 = 逻辑像素 × cssScale × dpr；绘制时用同一个缩放矩阵，保证填满且像素锐利 */
      cv.width = Math.round(LOAD_LW * LOAD_CSS_SCALE * dpr);
      cv.height = Math.round(LOAD_LH * LOAD_CSS_SCALE * dpr);
      cv.style.cssText = 'position:relative;inset:auto;display:block;width:' + (LOAD_LW * LOAD_CSS_SCALE) + 'px;height:' + (LOAD_LH * LOAD_CSS_SCALE) +
        'px;image-rendering:pixelated;image-rendering:crisp-edges;';
      var tip = document.createElement('div');
      tip.id = 'loadingTip';
      tip.style.cssText = 'font-size:13px;letter-spacing:3px;opacity:.72;';
      tip.textContent = '正在准备关卡…';
      inner.appendChild(cv); inner.appendChild(tip);
      el.appendChild(inner);
      document.body.appendChild(el);
      this.el = el; this.cv = cv; this.cx = cv.getContext('2d');
      this.cx.imageSmoothingEnabled = false;
      this._scale = LOAD_CSS_SCALE * dpr;
    },
    /* 简单可爱像素动画：像素小人在两平台间跳动 + 星空闪烁 + 逐格进度条 */
    _draw: function (ms) {
      var cx = this.cx, S = this._scale, LW = LOAD_LW, LH = LOAD_LH;
      cx.save();
      cx.setTransform(S, 0, 0, S, 0, 0);
      cx.fillStyle = '#05070c'; cx.fillRect(0, 0, LW, LH);
      /* 星空点点（缓慢闪烁） */
      for (var i = 0; i < 22; i++) {
        var sx = (i * 37 % (LW - 4)) + 2, sy = (i * 23 % (LH - 20)) + 2;
        var tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ms / 600 + i));
        cx.fillStyle = 'rgba(150,200,255,' + tw.toFixed(2) + ')';
        cx.fillRect(sx, sy, 1, 1);
      }
      var t = ms / 1000;
      /* 地面平台（居中对称） */
      cx.fillStyle = '#2a3a52';
      cx.fillRect(18, 52, 34, 3);
      cx.fillRect(68, 52, 34, 3);
      cx.fillStyle = '#3d567a';
      cx.fillRect(18, 52, 34, 1);
      cx.fillRect(68, 52, 34, 1);
      /* 像素小人：在两个平台间来回跳跃 */
      var period = 1.25;
      var ph = (t % (period * 2)) / period;   /* 0..2 */
      var onRight = ph >= 1;
      var u = onRight ? (ph - 1) : ph;        /* 0..1 */
      var x0 = onRight ? 30 : 80, x1 = onRight ? 80 : 30;
      var px = x0 + (x1 - x0) * u;
      var arc = Math.sin(u * Math.PI);
      var py = 40 - arc * 18;
      var landing = (u < 0.07 || u > 0.93);
      var squash = landing ? 1 : 0;
      var bx = Math.round(px), by = Math.round(py + squash);
      /* 身体（金）：头 + 身 */
      cx.fillStyle = '#f0b73e';
      cx.fillRect(bx, by, 7, 8);
      /* 眼（白） */
      cx.fillStyle = '#fdfbf2';
      cx.fillRect(bx + 1, by + 2, 1, 2);
      cx.fillRect(bx + 5, by + 2, 1, 2);
      /* 高光 */
      cx.fillStyle = '#f7d063';
      cx.fillRect(bx, by, 7, 1);
      /* 脚 */
      cx.fillStyle = '#d4384a';
      cx.fillRect(bx, by + 8, 2, 1);
      cx.fillRect(bx + 5, by + 8, 2, 1);
      /* 落地/起跳粒子 */
      if (landing) {
        cx.fillStyle = 'rgba(247,208,99,0.85)';
        var side = u < 0.1 ? -1 : 1;
        cx.fillRect(bx + (side < 0 ? -4 : 8), 50, 2, 1);
        cx.fillRect(bx + (side < 0 ? -6 : 10), 48, 1, 1);
      }
      /* 进度条：16 格像素块，居中 */
      var cells = 16, cw = 5, gap = 1, barW = cells * (cw + gap) - gap;
      var pbx = Math.round((LW - barW) / 2), pby = 62;
      for (var c = 0; c < cells; c++) {
        var on = (c + 1) / cells <= (this._prog || 0) + 1e-6;
        cx.fillStyle = on ? '#66c9b8' : '#1b2634';
        cx.fillRect(pbx + c * (cw + gap), pby, cw, 3);
      }
      cx.restore();
    },
    show: function () {
      this.ensure();
      if (this.el.style.display === 'flex') return;
      this.shown = performance.now();
      this._prog = 0; this._target = 0; this._done = false;
      this.el.style.display = 'flex';
      var self = this;
      function loop() {
        var ms = performance.now() - self.shown;
        /* 进度平滑逼近目标；未完成时最多显示到 92% */
        var cap = self._done ? 1 : 0.92;
        var tgt = Math.min(cap, self._target);
        self._prog += (tgt - self._prog) * 0.12;
        if (self._done && self._prog > 0.995) self._prog = 1;
        self._draw(ms);
        if (self.el.style.display === 'flex') self.raf = requestAnimationFrame(loop);
      }
      this.raf = requestAnimationFrame(loop);
    },
    setProgress: function (x) { this._target = Math.max(0, Math.min(1, x || 0)); },
    /* 标记“已就绪”，但仍满足最短停留 2s，防止一闪而过 */
    done: function () { this._done = true; },
    waitMin: function () {
      if (!this.shown) return Promise.resolve();
      var el = performance.now() - this.shown;
      var rest = Math.max(0, LOAD_MIN_MS - el);
      return new Promise(function (r) { setTimeout(r, rest); });
    },
    hide: function () {
      if (this.raf) cancelAnimationFrame(this.raf), this.raf = 0;
      if (this.el) { this.el.style.display = 'none'; }
      this.shown = 0;
    },
    isVisible: function () { return !!(this.el && this.el.style.display === 'flex'); }
  };

  global.SceneFX = SceneFX;
  global.Loading = Loading;
  if (typeof module !== 'undefined' && module.exports) module.exports = { SceneFX: SceneFX, Loading: Loading };
})(typeof window !== 'undefined' ? window : this);
