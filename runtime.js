/* Original editor gameplay/rendering kernel, extracted without editing tools or modes. */
var FEEL_DEFAULTS={maxWalkSpeed:1.85,groundAccel:0.3,airAccel:0.4,stopFriction:0.79,jumpMinHeight:4,jumpMaxHeight:8,jumpMaxHoldTime:0.4,gravity:0.76,maxFallSpeed:4,coyoteTime:0.5,jumpBufferTime:0.35,edgeSnapDist:1};
var FEEL_DESCS={
  maxWalkSpeed:{label:'最大移动速度',min:0.3,max:5,step:0.05,unit:'px/帧',hint:'水平移动的最高速度'},
  groundAccel:{label:'地面加速度',min:0.05,max:3,step:0.05,unit:'',hint:'地面上起步加速的快慢'},
  airAccel:{label:'空中加速度',min:0.05,max:3,step:0.05,unit:'',hint:'空中控制方向的加速度'},
  stopFriction:{label:'停止惯性',min:0.3,max:0.99,step:0.01,unit:'',hint:'松开方向键后速度衰减'},
  jumpMinHeight:{label:'最小跳跃高度',min:4,max:60,step:1,unit:'px',hint:'轻点跳跃键的高度'},
  jumpMaxHeight:{label:'最大跳跃高度',min:8,max:150,step:1,unit:'px',hint:'蓄满力时的高度'},
  jumpMaxHoldTime:{label:'蓄力最大时长',min:0.05,max:1.5,step:0.05,unit:'s',hint:'按住多久算满蓄力'},
  gravity:{label:'重力加速度',min:0.05,max:2,step:0.01,unit:'',hint:'每帧向下加速的量'},
  maxFallSpeed:{label:'最大下落速度',min:1,max:20,step:0.5,unit:'px/帧',hint:'下落速度上限'},
  coyoteTime:{label:'土狼时间',min:0,max:0.5,step:0.01,unit:'s',hint:'离开平台后仍能跳的宽限'},
  jumpBufferTime:{label:'跳跃缓冲',min:0,max:0.5,step:0.01,unit:'s',hint:'落地前按跳，落地自动起跳'},
  edgeSnapDist:{label:'边缘吸附距离',min:0,max:20,step:1,unit:'px',hint:'跳上平台边缘的自动吸附'}
};
var FEEL=JSON.parse(JSON.stringify(FEEL_DEFAULTS));
var FeelStorage={
  KEY:'ghostEcho_feel_v6',
  load:function(){try{var s=localStorage.getItem(this.KEY);if(s){var obj=JSON.parse(s);var out=JSON.parse(JSON.stringify(FEEL_DEFAULTS));for(var k in FEEL_DEFAULTS)if(typeof obj[k]==='number')out[k]=obj[k];return out;}}catch(e){}return JSON.parse(JSON.stringify(FEEL_DEFAULTS));},
  save:function(f){try{localStorage.setItem(this.KEY,JSON.stringify(f));}catch(e){}}
};
function sanitizeFeel(obj){
  var out=JSON.parse(JSON.stringify(FEEL_DEFAULTS));
  if(!obj||typeof obj!=='object')return out;
  for(var k in FEEL_DEFAULTS){
    if(typeof obj[k]==='number'&&isFinite(obj[k])){
      var d=FEEL_DESCS[k];var v=obj[k];
      if(v<d.min)v=d.min;if(v>d.max)v=d.max;out[k]=v;
    }
  }
  return out;
}

var LevelContext={levels:[],currentIdx:0};
var dpr=Math.min(window.devicePixelRatio||1,2);
var D={};
var IS_MOBILE=false;
function rectsOverlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function getLabelTextPos(el){return{x:el.x+(el.w||8)/2+(el.textOffsetX||0),y:el.y+(el.h||8)/2+(el.textOffsetY!==undefined?el.textOffsetY:-22)};}


function getAdjacency(el,list){
  var eps=1.5;var r={up:false,down:false,left:false,right:false};
  var elW=el.w||8,elH=el.h||8;var elR=el.x+elW,elB=el.y+elH;
  for(var i=0;i<list.length;i++){
    var o=list[i];if(o===el)continue;
    if(o.type!==undefined&&el.type!==undefined&&o.type!==el.type)continue;
    var oW=o.w||8,oH=o.h||8;var oR=o.x+oW,oB=o.y+oH;
    var yOverlap=o.y<elB-0.1&&oB>el.y+0.1;
    if(yOverlap){if(Math.abs(el.x-oR)<eps)r.left=true;if(Math.abs(o.x-elR)<eps)r.right=true;}
    var xOverlap=o.x<elR-0.1&&oR>el.x+0.1;
    if(xOverlap){if(Math.abs(el.y-oB)<eps)r.up=true;if(Math.abs(o.y-elB)<eps)r.down=true;}
  }
  return r;
}

/* ============ 像素风味文字 ============ */
/* ============ 像素风味文字 v2：真像素化 + 小字号可读 ============ */
/* ============ 像素风味文字 v3：小字号高可读 ============ */
/* ============ 像素风味文字 v4：细笔画 + 小字号清晰 ============ */
/* ============ 像素风味文字 v5：物理像素级二值化 ============ */
/* ============ 像素风味文字 v6：Bayer 抖动 + 原版尺寸 ============ */
/* ============ 像素风味文字 v7：像素点尺寸可控到亚单位 ============ */
/* ============ 像素风味文字 v8：逐字渲染 + 亚像素粒度 ============ */
var _pxTextCache = {};
var _pxTextCacheOrder = [];
var _pxTextMeasureCtx = null;

var _PX_FONT_STACK = '"Zpix","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","WenQuanYi Micro Hei",SimHei,"Heiti SC",sans-serif';

function _pxHexToRgb(color) {
    if (!color || color[0] !== '#') return { r: 255, g: 255, b: 255 };
    if (color.length === 7) {
        return {
            r: parseInt(color.slice(1, 3), 16),
            g: parseInt(color.slice(3, 5), 16),
            b: parseInt(color.slice(5, 7), 16)
        };
    }
    if (color.length === 4) {
        return {
            r: parseInt(color[1] + color[1], 16),
            g: parseInt(color[2] + color[2], 16),
            b: parseInt(color[3] + color[3], 16)
        };
    }
    return { r: 255, g: 255, b: 255 };
}

/* 逐字渲染：每个字单独定位。字号只由 size 决定（与字符串长度无关），
   因此同一 size 下所有文字的字高完全一致；画布宽度按实际文本宽度裁切，
   长度不同的字符串不会被拉伸或压扁。二值化保证只有实心/透明两态。 */
var _PXR_WIDE = function (ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) ||
           (c >= 0x3400 && c <= 0x4DBF) || (c >= 0xAC00 && c <= 0xD7A3) ||
           (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFF60) ||
           (c >= 0xFFE0 && c <= 0xFFE6);
};
function _getPxTextBitmap(text, size, color, ps) {
    size = Math.max(7, Math.round(size || 10));
    color = color || '#ffffff';
    ps = (typeof ps === 'number' && isFinite(ps) && ps > 0) ? Math.max(0.05, Math.min(8, ps)) : 0.5;
    var key = size + '|' + ps + '|' + color + '|' + text;
    var hit = _pxTextCache[key];
    if (hit) return hit;

    var SS = 4;                              /* 超采样倍率 */
    /* 目标世界尺寸：高度只由 size 决定（与文本长度、ps 都无关）。
       字高 ≈ size*1.5 世界单位，垂直居中于 size*2+10 高的行框内。 */
    var boxH = size * 2 + 10;                /* 世界单位（决定行高与留白） */
    var rows = Math.max(2, Math.min(1024, Math.round(boxH / ps)));
    var worldGlyphH = size * 1.5;            /* 世界单位下的字高 */
    var fontSize = Math.max(4, Math.round(worldGlyphH * SS / ps));  /* 超采样画布字号 */

    if (!_pxTextMeasureCtx) _pxTextMeasureCtx = document.createElement('canvas').getContext('2d');
    var mc = _pxTextMeasureCtx;

    var chars = String(text).split('');
    var n = Math.max(1, chars.length);
    var fontStr = fontSize + 'px ' + _PX_FONT_STACK;

    /* 字距：CJK 稍宽、西文稍窄；空格不再叠加间隙 */
    function _gapAt(i) {
        if (i >= n - 1) return 0;
        var a = chars[i], b = chars[i + 1];
        if (a === ' ' || b === ' ' || a === '\u3000' || b === '\u3000') return 0;
        return fontSize * ((_PXR_WIDE(a) || _PXR_WIDE(b)) ? 0.075 : 0.05);
    }
    mc.font = fontStr;
    var charWidths = [], contentW = 0;
    for (var i = 0; i < n; i++) {
        var w = mc.measureText(chars[i]).width;
        charWidths.push(w);
        contentW += w + _gapAt(i);
    }

    /* 超采样画布：宽度贴合文本实际宽度，不做拉伸 */
    var rwFull = Math.max(2 * SS, Math.ceil(contentW) + SS);
    var cols = Math.max(1, Math.min(4096, Math.ceil(rwFull / SS)));
    rwFull = cols * SS;
    var rh = rows * SS;

    var oc = document.createElement('canvas');
    oc.width = rwFull; oc.height = rh;
    var og = oc.getContext('2d', { willReadFrequently: true });
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, rwFull, rh);
    og.font = fontStr;
    og.textAlign = 'left';
    og.textBaseline = 'middle';
    og.fillStyle = '#000000';

    var startX = Math.max(0, (rwFull - contentW) / 2);
    var curX = startX;
    for (var ci = 0; ci < n; ci++) {
        og.fillText(chars[ci], curX, rh / 2);
        curX += charWidths[ci] + _gapAt(ci);
    }

    var srcData = og.getImageData(0, 0, rwFull, rh).data;

    /* 输出位图：cols × rows 纯二值 */
    var out = document.createElement('canvas');
    out.width = cols;
    out.height = rows;
    var outCtx = out.getContext('2d');
    var outImg = outCtx.createImageData(cols, rows);
    var od = outImg.data;

    var rgb = _pxHexToRgb(color);
    /* 二值化阈值 22%：阈值越低、纳入的边缘像素越多，笔画越饱满。
       0.30 会让小字号显得偏细，0.22 在不糊边的前提下让字更有分量。 */
    var thr = SS * SS * 0.22;

    for (var gy = 0; gy < rows; gy++) {
        var ry0 = gy * SS;
        for (var gx = 0; gx < cols; gx++) {
            var rx0 = gx * SS;
            var on = 0;
            for (var yy = 0; yy < SS; yy++) {
                var rowBase = (ry0 + yy) * rwFull;
                for (var xx = 0; xx < SS; xx++) {
                    if (srcData[(rowBase + rx0 + xx) * 4 + 3] > 128) on++;
                }
            }
            if (on >= thr) {
                var idx = (gy * cols + gx) * 4;
                od[idx] = rgb.r;
                od[idx + 1] = rgb.g;
                od[idx + 2] = rgb.b;
                od[idx + 3] = 255;
            }
        }
    }
    outCtx.putImageData(outImg, 0, 0);

    var result = { canvas: out, w: cols, h: rows };
    _pxTextCache[key] = result;
    _pxTextCacheOrder.push(key);
    if (_pxTextCacheOrder.length > 96) {
        var oldKey = _pxTextCacheOrder.shift();
        delete _pxTextCache[oldKey];
    }
    return result;
}

function drawPixelText(g, text, cx, cy, size, color, bgColor, alpha, pixelSize, outlineColor) {
    if (text === undefined || text === null || text === '') return;
    if (alpha !== undefined && alpha <= 0.01) return;

    size = Math.max(7, Math.round(size || 10));
    color = color || '#ffffff';

    /* pixelSize 允许到 0.05，默认 0.5。
       它决定每个逻辑像素块在屏幕上占多少单位。 */
    var ps = (typeof pixelSize === 'number' && isFinite(pixelSize) && pixelSize > 0) ? pixelSize : 0.5;
    ps = Math.max(0.05, Math.min(8, ps));

    /* 位图尺寸只由 size 与 ps 决定（字高与文本长度无关），宽度随文本自适应 */
    var bmp = _getPxTextBitmap(text, size, color, ps);

    var targetW = bmp.w * ps;
    var targetH = bmp.h * ps;

    var x0 = cx - targetW / 2;
    var y0 = cy - targetH / 2;

    g.save();
    if (alpha !== undefined) g.globalAlpha = alpha;
    g.imageSmoothingEnabled = false;

    if (bgColor) {
        g.fillStyle = bgColor;
        g.fillRect(x0 - ps, y0 - ps, targetW + ps * 2, targetH + ps * 2);
    }

    /* 可选克制描边：仅用于亮背景上的小字，默认关闭 */
    if (outlineColor) {
        var ob = _getPxTextBitmap(text, size, outlineColor, ps);
        g.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.5;
        g.drawImage(ob.canvas, x0 - ps, y0, targetW, targetH);
        g.drawImage(ob.canvas, x0 + ps, y0, targetW, targetH);
        g.drawImage(ob.canvas, x0, y0 - ps, targetW, targetH);
        g.drawImage(ob.canvas, x0, y0 + ps, targetW, targetH);
        g.globalAlpha = alpha === undefined ? 1 : alpha;
    }

    g.drawImage(bmp.canvas, x0, y0, targetW, targetH);
    g.restore();
}
/* ============ 背景形状 & 动态着色器 ============ */
function bgShapePath(g, sh, x, y, w, h){
  var shape = sh.shape || 'rect';
  if (shape === 'rect') { g.rect(x, y, w, h); }
  else if (shape === 'circle') { var r = Math.min(w, h) / 2; g.arc(x + w/2, y + h/2, r, 0, Math.PI * 2); }
  else if (shape === 'ellipse') { g.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2); }
  else if (shape === 'triangle') { g.moveTo(x + w/2, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); }
  else if (shape === 'polygon') {
    var n = Math.max(3, sh.points || 6);
    for (var i = 0; i < n; i++) {
      var a = -Math.PI/2 + i * Math.PI * 2 / n;
      var px = x + w/2 + Math.cos(a) * w/2;
      var py = y + h/2 + Math.sin(a) * h/2;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  } else if (shape === 'star') {
    var n2 = Math.max(3, sh.points || 5);
    for (var j = 0; j < n2 * 2; j++) {
      var a2 = -Math.PI/2 + j * Math.PI / n2;
      var rr = (j % 2 === 0) ? 1 : 0.45;
      var px2 = x + w/2 + Math.cos(a2) * w/2 * rr;
      var py2 = y + h/2 + Math.sin(a2) * h/2 * rr;
      if (j === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
    }
    g.closePath();
  } else if (shape === 'line') { g.moveTo(x, y + h/2); g.lineTo(x + w, y + h/2); }
  else { g.rect(x, y, w, h); }
}
/* ============================================================
   WebGL 动态背景 Shader 系统 v3
   - 20 个风格独立的程序化 shader
   - 世界坐标 UV，同图层多画布无缝拼接
   - 纯色默认脉冲，动画速度 0 冻结
   ============================================================ */
/* ============================================================
   Canvas2D 动态背景 Shader 系统 v4
   - 21 个 shader 完全用 JS 逐像素实现，视觉与 WebGL 版一致
   - 分辨率按屏幕尺寸自适应（128px 硬上限），30fps 限流
   - 每个 bgShape 独立 ImageData + 2D canvas 缓存
   - 主渲染只 drawImage(2D canvas) —— 无 GPU 同步
   ============================================================ */

var _glTimeBase = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();

/* ---- GLSL 内置函数移植 ---- */
function _jsFract(x) { return x - Math.floor(x); }
function _jsMod(x, y) { return x - Math.floor(x / y) * y; }
function _jsMix(a, b, t) { return a + (b - a) * t; }
function _jsClamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function _jsSmoothstep(e0, e1, x) {
  var t = (x - e0) / (e1 - e0);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}
function _jsHash1(x, y) {
  var s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function _jsHash1f(n) {
  var s = Math.sin(n * 78.233 + 1.3) * 43758.5453123;
  return s - Math.floor(s);
}
function _jsNoise2(x, y) {
  var ix = Math.floor(x), iy = Math.floor(y);
  var fx = x - ix, fy = y - iy;
  var ux = fx * fx * (3 - 2 * fx);
  var uy = fy * fy * (3 - 2 * fy);
  var a = _jsHash1(ix, iy);
  var b = _jsHash1(ix + 1, iy);
  var c = _jsHash1(ix, iy + 1);
  var e = _jsHash1(ix + 1, iy + 1);
  return _jsMix(_jsMix(a, b, ux), _jsMix(c, e, ux), uy);
}
function _jsFbm(x, y) {
  var v = 0, a = 0.5;
  for (var i = 0; i < 3; i++) {
    v += a * _jsNoise2(x, y);
    x *= 2; y *= 2; a *= 0.5;
  }
  return v;
}

/* ---- 21 个 shader（像素级，写 d[i..i+3]） ---- */

function sh_solid(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  /* 纯色 shader —— v2 修复版
     · speed=0（t≈0）：完全冻结，输出原始颜色 + 完全不透明（alpha=255）
     · speed>0       ：仅在 78%~100% 之间轻微脉动亮度，alpha 恒为 255
     原实现的 bug：当 speed=0 时 t=0，pulse 恒为 0.5，
     导致白色被压成 #808080 且半透明，叠到黑底上就是灰色。 */
  var bright = 1.0;
  if (t > 0.0001) {
    var pulse = 0.5 + 0.5 * Math.sin(t * 2.0);
    pulse = _jsSmoothstep(0, 1, pulse);
    bright = 0.78 + 0.22 * pulse;
  }
  d[i]     = c1r * 255 * bright;
  d[i + 1] = c1g * 255 * bright;
  d[i + 2] = c1b * 255 * bright;
  d[i + 3] = 255;   // 始终不透明
}

function sh_auroraSilk(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.005, uy = wy * 0.005;
  var tt = t * 0.7;
  var bands = 0;
  for (var k = 0; k < 6; k++) {
    var fi = k;
    var sc = 1 + fi * 0.28;
    var qx = ux * sc + tt * (0.5 + fi * 0.18);
    var qy = uy * sc - tt * 0.30 * fi;
    var nqx = qx + 0.28 * Math.sin(qy * 2.8 + tt * 1.4 + fi * 1.7);
    var nqy = qy + 0.28 * Math.cos(qx * 2.2 - tt * 1.2 + fi * 1.3);
    qx = nqx; qy = nqy;
    var n = _jsFbm(qx, qy);
    var dd = (n - 0.5) * 3.5;
    var band = Math.exp(-dd * dd);
    bands += band / (1 + fi * 0.5);
  }
  bands = _jsClamp(bands * 0.75, 0, 1.5);
  var mb = bands > 1 ? 1 : bands;
  var cr = _jsMix(c2r, c1r, mb);
  var cg = _jsMix(c2g, c1g, mb);
  var cb = _jsMix(c2b, c1b, mb);
  var p22 = Math.pow(bands, 2.2) * 1.5;
  var p45 = Math.pow(bands, 4.5) * 0.5;
  cr += c1r * p22 + 0.85 * p45;
  cg += c1g * p22 + 1.0 * p45;
  cb += c1b * p22 + 0.9 * p45;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_nebulaDrift(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.004, uy = wy * 0.004;
  var tt = t * 0.3;
  var qx = _jsFbm(ux + tt * 0.4, uy + tt * 0.4);
  var qy = _jsFbm(ux + 5.2 - tt * 0.3, uy + 1.3 - tt * 0.3);
  var rx = _jsFbm(ux + 3 * qx + 1.7 + tt * 0.25, uy + 3 * qy + 9.2 + tt * 0.25);
  var ry = _jsFbm(ux + 3 * qx + 8.3 - tt * 0.2, uy + 3 * qy + 2.8 - tt * 0.2);
  var f = _jsFbm(ux + 3 * rx, uy + 3 * ry);
  var n = _jsSmoothstep(0.15, 0.9, f);
  var cr = _jsMix(c2r, c1r, n);
  var cg = _jsMix(c2g, c1g, n);
  var cb = _jsMix(c2b, c1b, n);
  var p22 = Math.pow(n, 2.2) * 1.5;
  var p40 = Math.pow(n, 4) * 0.5;
  cr += c1r * p22 + 1.0 * p40;
  cg += c1g * p22 + 0.9 * p40;
  cb += c1b * p22 + 0.8 * p40;
  var cix = Math.floor(ux * 80), ciy = Math.floor(uy * 80);
  var h = _jsHash1(cix, ciy);
  var star = h >= 0.94 ? 1 : 0;
  var tw = 0.5 + 0.5 * Math.sin(t * 4 + h * 12);
  var add = star * tw * 1.5;
  cr += add; cg += add; cb += add;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_caustics(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.008, uy = wy * 0.008;
  var tt = t * 1.2;
  var v = 0;
  for (var k = 0; k < 4; k++) {
    var fi = k + 1;
    var qx = ux * fi * 1.3 + Math.sin(tt * fi * 0.7);
    var qy = uy * fi * 1.3 + Math.cos(tt * fi * 0.6);
    v += Math.sin(qx + Math.sin(qy * 1.3)) * Math.sin(qy + Math.cos(qx * 1.1));
  }
  v = v * 0.25 + 0.5;
  v = Math.pow(Math.abs(v), 1.6);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.4;
  var p50 = Math.pow(v, 5) * 0.5;
  cr += c1r * p25 + 0.8 * p50;
  cg += c1g * p25 + 1.0 * p50;
  cb += c1b * p25 + 1.0 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_lavaLamp(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var px = wx * 0.004, py = wy * 0.004;
  var tt = t * 0.5;
  for (var k = 0; k < 6; k++) {
    var fi = k + 1;
    var npx = px + 0.24 * Math.sin(py * fi + tt * fi * 0.9);
    var npy = py + 0.24 * Math.cos(px * fi - tt * fi * 0.7);
    px = npx; py = npy;
  }
  var n = _jsFbm(px * 1.2, py * 1.2);
  var hot = _jsSmoothstep(0.25, 0.70, n);
  var core = _jsSmoothstep(0.55, 0.90, n);
  var cr = _jsMix(c2r, c1r, hot);
  var cg = _jsMix(c2g, c1g, hot);
  var cb = _jsMix(c2b, c1b, hot);
  var tr = c1r * 1.5 + 0.5, tg = c1g * 1.5 + 0.15, tb = c1b * 1.5;
  var kk = core * 0.6;
  cr = _jsMix(cr, tr, kk);
  cg = _jsMix(cg, tg, kk);
  cb = _jsMix(cb, tb, kk);
  var p30 = Math.pow(core, 3) * 0.7;
  cr += 1.0 * p30; cg += 0.9 * p30; cb += 0.6 * p30;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_frostCrystal(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.006, uy = wy * 0.006;
  var tt = t * 0.4;
  var px = ux * 2, py = uy * 2;
  var ipx = Math.floor(px), ipy = Math.floor(py);
  var fpx = px - ipx, fpy = py - ipy;
  var minD = 1;
  for (var yy = -1; yy <= 1; yy++) {
    for (var xx = -1; xx <= 1; xx++) {
      var cix = ipx + xx, ciy = ipy + yy;
      var ptx = _jsHash1(cix, ciy);
      var pty = _jsHash1(cix + 1.3, ciy + 7.7);
      ptx = 0.5 + 0.5 * Math.sin(tt + 6.28 * ptx);
      pty = 0.5 + 0.5 * Math.sin(tt + 6.28 * pty);
      var ddx = xx + ptx - fpx, ddy = yy + pty - fpy;
      var dd = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dd < minD) minD = dd;
    }
  }
  var face = 1 - _jsSmoothstep(0, 0.5, minD);
  face = Math.pow(face, 1.3);
  var frost = _jsFbm(ux * 5 + tt, uy * 5 + tt);
  var v = face * (0.7 + frost * 0.5);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.2;
  var p45 = Math.pow(v, 4.5) * 0.65;
  cr += c1r * p25 + 0.9 * p45;
  cg += c1g * p25 + 0.95 * p45;
  cb += c1b * p25 + 1.0 * p45;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_cherryBlossom(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var wpx = wx * 0.012, wpy = wy * 0.012;
  var tt = t;
  var cr = c2r, cg = c2g, cb = c2b;
  var tile = 4;
  for (var k = 0; k < 20; k++) {
    var fi = k;
    var r1 = _jsHash1f(fi * 1.7);
    var r2 = _jsHash1f(fi * 3.3);
    var spd = 0.6 + r1 * 0.8;
    var cx = r1 * tile + Math.sin(tt * 1.2 + r1 * 6.28) * 0.2;
    var cy = _jsFract(r2 - tt * spd * 0.2) * tile;
    var dx = wpx - cx, dy = wpy - cy;
    dx = _jsMod(dx + tile * 0.5, tile) - tile * 0.5;
    dy = _jsMod(dy + tile * 0.5, tile) - tile * 0.5;
    var dist = Math.sqrt(dx * 1.2 * dx * 1.2 + dy * 0.6 * dy * 0.6);
    var petal = _jsSmoothstep(0.14, 0.02, dist);
    var m = petal * 0.95;
    cr = _jsMix(cr, c1r, m);
    cg = _jsMix(cg, c1g, m);
    cb = _jsMix(cb, c1b, m);
  }
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_fireflies(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var wpx = wx * 0.008, wpy = wy * 0.008;
  var tt = t * 0.7;
  var cr = c2r, cg = c2g, cb = c2b;
  var tile = 3;
  for (var k = 0; k < 20; k++) {
    var fi = k;
    var r1 = _jsHash1f(fi * 2.3);
    var r2 = _jsHash1f(fi * 5.7);
    var r3 = _jsHash1f(fi * 11.1);
    var cx = r1 * tile + Math.sin(tt * 0.6 + r3 * 6.28) * 0.5;
    var cy = r2 * tile + Math.cos(tt * 0.7 + r3 * 6.28) * 0.4;
    var dx = wpx - cx, dy = wpy - cy;
    dx = _jsMod(dx + tile * 0.5, tile) - tile * 0.5;
    dy = _jsMod(dy + tile * 0.5, tile) - tile * 0.5;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var glow = 0.0015 / (dist * dist + 0.0002);
    var pulse = Math.pow(0.5 + 0.5 * Math.sin(t * (2 + r3 * 3) + fi * 1.7), 2.5);
    var add = glow * pulse;
    cr += c1r * add; cg += c1g * add; cb += c1b * add;
  }
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_moonMist(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.005, uy = wy * 0.005;
  var tt = t * 0.25;
  var qx = _jsFbm(ux + tt * 0.4, uy + tt * 0.4);
  var qy = _jsFbm(ux + 3.7 - tt * 0.3, uy + 1.4 - tt * 0.3);
  var f = _jsFbm(ux + 2.5 * qx, uy + 2.5 * qy);
  var mist = _jsSmoothstep(0.25, 0.9, f);
  var m = mist * 0.9;
  var cr = _jsMix(c2r, c1r, m);
  var cg = _jsMix(c2g, c1g, m);
  var cb = _jsMix(c2b, c1b, m);
  var p30 = Math.pow(mist, 3) * 0.8;
  cr += c1r * p30; cg += c1g * p30; cb += c1b * p30;
  var wisp = _jsFbm(ux * 8 + tt, uy * 8 + tt);
  var w = _jsSmoothstep(0.78, 1, wisp) * 0.4;
  cr += w; cg += w; cb += w;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_neonRain(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var wpx = wx * 0.012, wpy = wy * 0.012;
  var tt = t * 1.2;
  var cr = c2r, cg = c2g, cb = c2b;
  var tile = 3;
  for (var k = 0; k < 15; k++) {
    var fi = k;
    var r1 = _jsHash1f(fi * 3.1);
    var r2 = _jsHash1f(fi * 7.7);
    var spd = 0.8 + _jsHash1f(fi * 11.3) * 1.2;
    var cx = r1 * tile;
    var cy = _jsFract(r2 - tt * spd * 0.3) * tile;
    var dx = wpx - cx, dy = wpy - cy;
    dx = _jsMod(dx + tile * 0.5, tile) - tile * 0.5;
    dy = _jsMod(dy + tile * 0.5, tile) - tile * 0.5;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var line = _jsSmoothstep(0.04, 0, adx) * (ady <= 0.6 ? 1 : 0);
    var add = line * 2;
    cr += c1r * add; cg += c1g * add; cb += c1b * add;
  }
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_inferno(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.006, uy = wy * 0.006;
  var tt = t * 1.2;
  var qx = ux + Math.sin(uy * 3.5 + tt * 1.5) * 0.10;
  var qy = uy;
  var n = _jsFbm(qx * 3.5, qy * 2.5 - tt * 1.8);
  var ff = (1 - _jsFract(uy * 0.25)) * 0.5;
  var heat = _jsSmoothstep(0.22, 0.9, n + ff);
  var cr = _jsMix(c2r, c1r, heat);
  var cg = _jsMix(c2g, c1g, heat);
  var cb = _jsMix(c2b, c1b, heat);
  var p25 = Math.pow(heat, 2.5) * 0.9;
  var p50 = Math.pow(heat, 5) * 0.5;
  cr += 1.0 * p25 + 1.0 * p50;
  cg += 0.6 * p25 + 0.9 * p50;
  cb += 0.2 * p25 + 0.7 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_oceanSwell(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.008, uy = wy * 0.008;
  var tt = t;
  var n1 = Math.sin(ux * 2.5 + tt * 0.8) * 0.15;
  var n2 = Math.sin(ux * 1.8 - tt * 0.6 + 1.5) * 0.18;
  var n3 = Math.sin(ux * 4.5 + tt * 1.2 + 3.3) * 0.08;
  var y = _jsFract(uy * 0.12 + n1 + n2 * 0.5 + n3);
  var wave = _jsSmoothstep(0, 0.35, y) * (1 - _jsSmoothstep(0.55, 1, y));
  var cr = _jsMix(c2r, c1r, wave);
  var cg = _jsMix(c2g, c1g, wave);
  var cb = _jsMix(c2b, c1b, wave);
  var p25 = Math.pow(wave, 2.5) * 1.2;
  var p50 = Math.pow(wave, 5) * 0.4;
  cr += c1r * p25 + 0.8 * p50;
  cg += c1g * p25 + 1.0 * p50;
  cb += c1b * p25 + 1.0 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_voidVortex(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.006, uy = wy * 0.006;
  var tt = t * 0.9;
  var r = Math.sqrt(ux * ux + uy * uy) + 0.001;
  var a = Math.atan2(uy, ux);
  a += tt * 0.8 - 1.5 / r;
  var n = _jsFbm(a * 1.5, r * 3.5 - tt * 2);
  var swirl = Math.sin(a * 2.5 + n * 5) * 0.5 + 0.5;
  var falloff = _jsSmoothstep(0.8, 0.02, r);
  var v = swirl * falloff;
  v = Math.pow(v, 1.2);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.3;
  cr += c1r * p25;
  cg += c1g * p25;
  cb += c1b * p25;
  var center = _jsSmoothstep(0.05, 0, r);
  cr += center; cg += center; cb += center;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_starfield(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.01, uy = wy * 0.01;
  var cr = c2r, cg = c2g, cb = c2b;
  for (var li = 0; li < 4; li++) {
    var fi = li;
    var density = 20 + fi * 25;
    var px = ux * density + fi * 7.3;
    var py = uy * density + fi * 7.3;
    var ipx = Math.floor(px), ipy = Math.floor(py);
    var fpx = px - ipx - 0.5, fpy = py - ipy - 0.5;
    var h = _jsHash1(ipx, ipy);
    var starActive = h >= 0.82 ? 1 : 0;
    var dd = Math.sqrt(fpx * fpx + fpy * fpy);
    var tw = 0.4 + 0.6 * Math.sin(t * (1.5 + h * 4) + h * 12);
    var star = Math.exp(-dd * 22) * tw * starActive;
    var add = star * (1.2 - fi * 0.22);
    cr += c1r * add; cg += c1g * add; cb += c1b * add;
  }
  var n = _jsFbm(ux * 1.5 + t * 0.05, uy * 1.5 + t * 0.05);
  var a2 = _jsSmoothstep(0.50, 0.95, n) * 0.4;
  cr += c1r * a2; cg += c1g * a2; cb += c1b * a2;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_sunsetGlow(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.004, uy = wy * 0.004;
  var tt = t * 0.15;
  var band = Math.sin(uy * 0.4 + tt) * 0.5 + 0.5;
  var n = _jsFbm(ux * 2 + tt * 1.5, uy * 2 + tt * 1.5);
  band = band * (0.7 + n * 0.5);
  var cr = _jsMix(c2r, c1r, band);
  var cg = _jsMix(c2g, c1g, band);
  var cb = _jsMix(c2b, c1b, band);
  var warm = _jsSmoothstep(0.4, 1, band);
  var w8 = warm * 0.8;
  var w36 = Math.pow(warm, 3) * 0.6;
  cr += 1.0 * w8 + 1.0 * w36;
  cg += 0.7 * w8 + 0.9 * w36;
  cb += 0.4 * w8 + 0.7 * w36;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_plasmaField(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.008, uy = wy * 0.008;
  var tt = t;
  var v = Math.sin(ux + tt) + Math.sin(uy + tt * 1.3)
        + Math.sin(ux * 0.5 + uy * 0.5 + tt * 0.7)
        + Math.sin(Math.sqrt(ux * ux + uy * uy) * 2 - tt * 1.2);
  v = v * 0.25 + 0.5;
  var n = _jsFbm(ux * 3 + tt * 0.5, uy * 3 + tt * 0.5);
  v = v * 0.55 + n * 0.6;
  v = Math.pow(_jsClamp(v, 0, 1), 1.3);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.4;
  var p50 = Math.pow(v, 5) * 0.5;
  cr += c1r * p25 + 0.9 * p50;
  cg += c1g * p25 + 0.9 * p50;
  cb += c1b * p25 + 1.0 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_cloudscape(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.004, uy = wy * 0.004;
  var tt = t * 0.3;
  var n1 = _jsFbm(ux * 1.5 + tt * 1.2, uy * 1.5 + tt * 0.4);
  var n2 = _jsFbm(ux * 2.7 - tt * 0.9, uy * 2.7 - tt * 0.3);
  var n3 = _jsFbm(ux * 4.5 + tt * 0.7, uy * 4.5 - tt * 0.5);
  var cloud = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
  cloud = _jsSmoothstep(0.2, 0.85, cloud);
  var cr = _jsMix(c2r, c1r, cloud);
  var cg = _jsMix(c2g, c1g, cloud);
  var cb = _jsMix(c2b, c1b, cloud);
  var a1 = _jsSmoothstep(0.6, 0.98, cloud);
  var a2 = _jsSmoothstep(0.85, 1, cloud) * 0.6;
  cr += c1r * a1 + a2;
  cg += c1g * a1 + a2;
  cb += c1b * a1 + a2;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_kaleidoscope(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.008, uy = wy * 0.008;
  var tt = t * 0.8;
  var r = Math.sqrt(ux * ux + uy * uy);
  var a = Math.atan2(uy, ux) + tt;
  var sectors = 6;
  a = _jsMod(a, 6.2831853 / sectors);
  a = Math.abs(a - 3.14159265 / sectors);
  var px = Math.cos(a) * r, py = Math.sin(a) * r;
  var n = _jsFbm(px * 3 + tt, py * 3 + tt);
  var v = Math.sin(r * 4 + n * 5) * 0.5 + 0.5;
  v = Math.pow(v, 1.2);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.4;
  var p50 = Math.pow(v, 5) * 0.5;
  cr += c1r * p25 + 1.0 * p50;
  cg += c1g * p25 + 1.0 * p50;
  cb += c1b * p25 + 1.0 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_ripples(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.006, uy = wy * 0.006;
  var tt = t * 1.5;
  var r = Math.sqrt(ux * ux + uy * uy) + 0.001;
  var w1 = Math.sin(r * 10 - tt * 2.5) * Math.exp(-r * 0.9);
  var w2 = Math.sin(r * 7 - tt * 1.8 + 1.5) * Math.exp(-r * 0.7) * 0.7;
  var w3 = Math.sin(r * 14 - tt * 3.2 + 3.3) * Math.exp(-r * 1.2) * 0.5;
  var rp = (w1 + w2 + w3) * 0.5 + 0.5;
  rp = _jsClamp(rp, 0, 1);
  var cr = _jsMix(c2r, c1r, rp);
  var cg = _jsMix(c2g, c1g, rp);
  var cb = _jsMix(c2b, c1b, rp);
  var p25 = Math.pow(rp, 2.5) * 1.3;
  var p50 = Math.pow(rp, 5) * 0.4;
  cr += c1r * p25 + p50;
  cg += c1g * p25 + p50;
  cb += c1b * p25 + p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_quantumFoam(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.006, uy = wy * 0.006;
  var tt = t;
  var px = ux, py = uy;
  for (var k = 0; k < 5; k++) {
    var fi = k + 1;
    var npx = px + Math.sin(py * fi + tt * fi) * 0.6;
    var npy = py + Math.cos(px * fi - tt * fi) * 0.6;
    px = npx; py = npy;
  }
  var v = Math.sin(px) * Math.cos(py) * 0.5 + 0.5;
  v = Math.pow(_jsClamp(v, 0, 1), 1.2);
  var n = _jsFbm(ux * 5 + tt, uy * 5 + tt);
  v = _jsMix(v, n, 0.35);
  var cr = _jsMix(c2r, c1r, v);
  var cg = _jsMix(c2g, c1g, v);
  var cb = _jsMix(c2b, c1b, v);
  var p25 = Math.pow(v, 2.5) * 1.3;
  var p50 = Math.pow(v, 5) * 0.45;
  cr += c1r * p25 + p50;
  cg += c1g * p25 + p50;
  cb += c1b * p25 + p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

function sh_auroraPixels(wx, wy, t, c1r, c1g, c1b, c2r, c2g, c2b, d, i) {
  var ux = wx * 0.008, uy = wy * 0.008;
  var pqx = Math.floor(ux * 40) / 40;
  var pqy = Math.floor(uy * 40) / 40;
  var tt = t * 0.8;
  var n = _jsFbm(pqx * 2.5 + tt * 0.8, pqy * 0.6);
  var bands = Math.sin(pqy * 6 + n * 6 + tt * 1.5) * 0.5 + 0.5;
  bands = _jsSmoothstep(0.30, 0.75, bands);
  var cr = _jsMix(c2r, c1r, bands);
  var cg = _jsMix(c2g, c1g, bands);
  var cb = _jsMix(c2b, c1b, bands);
  var p25 = Math.pow(bands, 2.5) * 1.4;
  var p50 = Math.pow(bands, 5) * 0.5;
  cr += c1r * p25 + 0.9 * p50;
  cg += c1g * p25 + 1.0 * p50;
  cb += c1b * p25 + 0.9 * p50;
  d[i] = _jsClamp(cr, 0, 1) * 255;
  d[i + 1] = _jsClamp(cg, 0, 1) * 255;
  d[i + 2] = _jsClamp(cb, 0, 1) * 255;
  d[i + 3] = 255;
}

var _SHADER_FNS = {
  solid: sh_solid,
  auroraSilk: sh_auroraSilk,
  nebulaDrift: sh_nebulaDrift,
  caustics: sh_caustics,
  lavaLamp: sh_lavaLamp,
  frostCrystal: sh_frostCrystal,
  cherryBlossom: sh_cherryBlossom,
  fireflies: sh_fireflies,
  moonMist: sh_moonMist,
  neonRain: sh_neonRain,
  inferno: sh_inferno,
  oceanSwell: sh_oceanSwell,
  voidVortex: sh_voidVortex,
  starfield: sh_starfield,
  sunsetGlow: sh_sunsetGlow,
  plasmaField: sh_plasmaField,
  cloudscape: sh_cloudscape,
  kaleidoscope: sh_kaleidoscope,
  ripples: sh_ripples,
  quantumFoam: sh_quantumFoam,
  auroraPixels: sh_auroraPixels
};

var _glShapeCache = new WeakMap();
var _presetRenderCache = new WeakMap();

function _hexToRgb01(hex) {
  if (!hex || hex[0] !== '#') return [1, 1, 1];
  if (hex.length === 7) return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
  if (hex.length === 4) return [
    parseInt(hex[1] + hex[1], 16) / 255,
    parseInt(hex[2] + hex[2], 16) / 255,
    parseInt(hex[3] + hex[3], 16) / 255
  ];
  return [1, 1, 1];
}

function fillBgShader(g, sh, x, y, w, h, alpha, time, screenScale) {
  var name = sh.shader || 'solid';
  /* 别名映射：旧版编辑器导出的数据里可能带 gradient / none，
     这些名字在当前 shader 表里不存在，统一映射到 solid，
     避免静默回退时行为不一致。 */
  if (name === 'gradient' || name === 'none' || !_SHADER_FNS[name]) {
    name = 'solid';
  }
  var fn = _SHADER_FNS[name];

  var worldW = Math.max(2, w);
  var worldH = Math.max(2, h);
  var sScale = (typeof screenScale === 'number' && screenScale > 0) ? screenScale : 1;
  var screenMax = Math.max(worldW, worldH) * sScale;
  if (screenMax < 8) {
    g.fillStyle = sh.color || '#331166';
    g.fillRect(x, y, w, h);
    return;
  }

  /* ImageData 分辨率：屏幕上最大尺寸的 1/2，硬上限 128。
     逐像素 fbm 比 GLSL 贵，128x128 是性能与画质的平衡点。
     想要更清晰可以调到 192；想要更快可以调到 96。 */
  var budget = Math.max(24, Math.min(64, Math.round(screenMax * 0.5)));
  var sc = Math.min(1, budget / Math.max(worldW, worldH));
  var imgW = Math.max(8, Math.round(worldW * sc));
  var imgH = Math.max(8, Math.round(worldH * sc));

  var cache = _glShapeCache.get(sh);
  if (!cache) {
    cache = { canvas: null, ctx: null, imgData: null, lastUpdate: 0, lastKey: '' };
    _glShapeCache.set(sh, cache);
  }

  var key = name + '|' + imgW + 'x' + imgH + '|'
          + (sh.color || '') + '|' + (sh.color2 || '') + '|' + (sh.speed || 1);
  var sp = (typeof sh.speed === 'number' && isFinite(sh.speed)) ? sh.speed : 1;
  var nowPerf = performance.now();
  /* === 性能优化：静态着色器永久缓存 ===
     speed=0 时着色内容恒定不变 → 只在第一次生成一次，之后永久复用。
     speed>0 时每 200ms 刷新一次，视觉上足够平滑，开销极低。 */
  var needUpdate = (key !== cache.lastKey)
                || (sp > 0.0001 && (nowPerf - cache.lastUpdate > 400));

  if (needUpdate) {
    if (!cache.canvas || cache.canvas.width !== imgW || cache.canvas.height !== imgH) {
      cache.canvas = document.createElement('canvas');
      cache.canvas.width = imgW;
      cache.canvas.height = imgH;
      cache.ctx = cache.canvas.getContext('2d');
      cache.imgData = cache.ctx.createImageData(imgW, imgH);
    }
    var elapsed = (nowPerf - _glTimeBase) * 0.001;
    if (elapsed < 0) elapsed = 0;
    var tVal = elapsed * sp;
    var c1 = _hexToRgb01(sh.color);
    var c2 = _hexToRgb01(sh.color2 || sh.color);
    var d = cache.imgData.data;
    var sX = worldW / imgW, sY = worldH / imgH;
    var idx = 0;
    for (var py = 0; py < imgH; py++) {
      var wy = y + (py + 0.5) * sY;
      for (var px = 0; px < imgW; px++) {
        var wx = x + (px + 0.5) * sX;
        fn(wx, wy, tVal, c1[0], c1[1], c1[2], c2[0], c2[1], c2[2], d, idx);
        idx += 4;
      }
    }
    cache.ctx.putImageData(cache.imgData, 0, 0);
    cache.lastUpdate = nowPerf;
    cache.lastKey = key;
  }

  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.drawImage(cache.canvas, 0, 0, imgW, imgH, x, y, w, h);
  g.restore();
}
function drawBgShape(g, sh, x, y, w, h, alpha, time, editorMode, inCurrent, neighbors, screenScale){
  g.save();
  var rot = (sh.rotation || 0) * Math.PI / 180;
  if (rot) {
    g.translate(x + w/2, y + h/2);
    g.rotate(rot);
    g.translate(-(x + w/2), -(y + h/2));
  }
  /* === preset-shapes v3 === 预设图案走独立绘制路径（纯透明背景 + 离屏缓存） */
  var _presetFn = _PRESET_DRAWERS[sh.shape];
  if (_presetFn) {
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    // 纯透明背景：不再铺设任何底色 / shader / 纯色填充。
    var _psp = (typeof sh.speed === 'number' && isFinite(sh.speed)) ? sh.speed : 1;
    var _pelapsed = (performance.now() - _glTimeBase) * 0.001;
    if (_pelapsed < 0) _pelapsed = 0;
    var _ptVal = _pelapsed * _psp;
    var _pulseRaw = 0.5 + 0.5 * Math.sin(_ptVal * 2.0);
    var _pulse = _jsSmoothstep(0, 1, _pulseRaw);
    var _glow = sh.glowIntensity || 0;
    var _c1 = sh.color || '#331166';
    var _c2 = sh.color2 || '#0a0e1a';
    var _gc = sh.glowColor || '#ffffff';

    /* === 性能优化：预设图案离屏缓存 ===
       把像素网格一次性渲染到离屏画布，之后每帧只做一次 drawImage。
       speed=0 的形状永久缓存；speed>0 的形状每 200ms 刷新一次。
       多层背景叠加时，绘制开销几乎降为零。 */
    var _pcache = _presetRenderCache.get(sh);
    if (!_pcache) {
      _pcache = { key:null, canvas:null, lastUpdate:0 };
      _presetRenderCache.set(sh, _pcache);
    }
    /* === 性能关键修复：缓存键不含 pulse ===
       之前 _pulse 进入缓存键，导致每帧 pulse 变化时都要重建整张
       像素网格（百万级 fillRect），动一下镜头就卡死。
       新方案：缓存一次生成，永久复用；脉冲动画改用绘制时的 alpha
       调制实现，零额外开销。 */
    /* === Bug 修复：缓存键必须包含 shape / shader ===
       之前缓存键漏了 sh.shape 和 sh.shader，
       导致把形状从「山体」改成「云朵」时缓存键不变，
       旧的离屏图案直接被回放 → 用户看到"形状类型改不了"。
       加入 shape / shader 后，任何类型切换都会立即重建缓存。 */
    var _cacheKey = (sh.shape || '') + '|' + (sh.shader || '') + '|'
                  + _c1 + '|' + _c2 + '|' + _gc + '|'
                  + Math.round(w) + 'x' + Math.round(h) + '|'
                  + _glow.toFixed(2);
    var _needRegen = (!_pcache.canvas || _pcache.key !== _cacheKey);
    if (_needRegen) {
      /* 缓存尺寸上限从 2000 提升到 4096，
         让大尺寸形状能按其真实 w/h 渲染，不再因超过上限被压缩后拉伸。 */
      var _cw = Math.max(16, Math.min(8192, Math.round(w)));
      var _ch = Math.max(16, Math.min(8192, Math.round(h)));
      if (!_pcache.canvas) _pcache.canvas = document.createElement('canvas');
      if (_pcache.canvas.width !== _cw || _pcache.canvas.height !== _ch) {
        _pcache.canvas.width = _cw;
        _pcache.canvas.height = _ch;
      }
      var _pctx = _pcache.canvas.getContext('2d');
      _pctx.setTransform(1,0,0,1,0,0);
      _pctx.clearRect(0,0,_cw,_ch);
      _pctx.save();
      _pctx.scale(_cw/w, _ch/h);
      if (_glow > 0.01) {
        _pctx.shadowBlur = 12 * _glow * _pulse;
        _pctx.shadowColor = _gc;
      } else {
        _pctx.shadowBlur = 0;
      }
      try {
        _presetFn(_pctx, 0, 0, w, h, _c1, _c2, 1.0, _gc, _glow);
      } catch(e){}
      _pctx.restore();
      _pcache.key = _cacheKey;
      _pcache.lastUpdate = performance.now();
    }
    var _drawAlpha = alpha;
    if (_psp > 0.0001) {
      // 脉冲动画：整体亮度在 85%~100% 之间轻微波动，零成本
      _drawAlpha = alpha * (0.85 + 0.15 * _pulse);
    }
    g.globalAlpha = _drawAlpha;
    g.imageSmoothingEnabled = false;
    g.drawImage(_pcache.canvas, x, y, w, h);
    g.globalAlpha = 1;
  } else {
    // 原有几何图形路径
    g.beginPath();
    bgShapePath(g, sh, x, y, w, h);
    g.clip();
    g.globalAlpha = 1;
    fillBgShader(g, sh, x, y, w, h, alpha, time, screenScale);
  }
  g.restore();

  if (editorMode) {
    var hasN=false, hasS=false, hasW=false, hasE=false;
    if (neighbors && neighbors.length > 0) {
      var shR = x + w, shB = y + h;
      for (var ni = 0; ni < neighbors.length; ni++) {
        var no = neighbors[ni];
        var noR = no.x + no.w, noB = no.y + no.h;
        if (Math.abs(no.y - shB) < 3 && no.x < shR && noR > x) hasN = true;
        if (Math.abs(sh.y - noB) < 3 && no.x < shR && noR > x) hasS = true;
        if (Math.abs(no.x - shR) < 3 && no.y < shB && noB > y) hasW = true;
        if (Math.abs(sh.x - noR) < 3 && no.y < shB && noB > y) hasE = true;
      }
    }
    g.save();
    g.strokeStyle = inCurrent ? 'rgba(170,68,255,0.9)' : 'rgba(170,68,255,0.3)';
    g.lineWidth = (inCurrent ? 1.5 : 1) / 1;
    g.setLineDash(inCurrent ? [] : [4/1, 4/1]);
    if (!hasN) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
    if (!hasS) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w, y + h); g.stroke(); }
    if (!hasW) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.stroke(); }
    if (!hasE) { g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.stroke(); }
    g.setLineDash([]);
    g.restore();
  }
}

/* ============================================================
   预设像素图案库 v2 —— 超精细像素画重制版
   签名：(g, x, y, w, h, c1, c2, pulse)
   ============================================================ */

/* ---------- 颜色工具 ---------- */
function _hexRgb(h){
  if(typeof h!=='string'||h[0]!=='#')return{r:255,g:255,b:255};
  if(h.length===7)return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)};
  if(h.length===4)return{r:parseInt(h[1]+h[1],16),g:parseInt(h[2]+h[2],16),b:parseInt(h[3]+h[3],16)};
  return{r:255,g:255,b:255};
}
function _rgbHex(r,g,b){
  function h2(v){ v=Math.max(0,Math.min(255,Math.round(v))); return (v<16?'0':'')+v.toString(16); }
  return '#'+h2(r)+h2(g)+h2(b);
}
function _mixHex(a,b,t){
  var A=_hexRgb(a),B=_hexRgb(b);
  return _rgbHex(A.r+(B.r-A.r)*t, A.g+(B.g-A.g)*t, A.b+(B.b-A.b)*t);
}
function _tint(c,t){ return _mixHex(c,'#ffffff',t); }
function _shadeC(c,t){ return _mixHex(c,'#000000',t); }

/* ---------- 像素网格绘制辅助 ---------- */
function _pxGrid(g,x,y,w,h,cols,rows,fn){
  /* === 自动分辨率 v4 —— 修复拉伸失灵 ===
     Bug：之前 _pxGrid 会临时提升 cols/rows 增加分辨率，
     但闭包里的绘制函数用的是自己定义时的 cols/rows，
     导致网格索引 c 超出 0..cols 范围，u=(c+0.5)/cols > 1，
     形状只画出左上角一小块，其余部分全是透明（看起来像"卡住"）。
     修复：把提升后的网格索引按比例映射回原始 cols/rows 空间，
     绘制函数看到的 c/r 始终落在 0..cols / 0..rows 之间。 */
  var _autoCols = Math.ceil(w / 1.5);
  var _autoRows = Math.ceil(h / 1.5);
  var useCols = _autoCols > cols ? _autoCols : cols;
  var useRows = _autoRows > rows ? _autoRows : rows;
  if (useCols > 2000) useCols = 2000;
  if (useRows > 1500) useRows = 1500;
  if(!(useCols>=1))useCols=1;
  if(!(useRows>=1))useRows=1;
  var cs = cols / useCols;
  var rs = rows / useRows;
  var cw=w/useCols, rh=h/useRows;
  for(var r=0;r<useRows;r++){
    var ry=Math.round(y+r*rh);
    var rhh=Math.max(1,Math.round(y+(r+1)*rh)-ry);
    for(var c=0;c<useCols;c++){
      var col=fn(c*cs, r*rs);
      if(!col)continue;
      var rx=Math.round(x+c*cw);
      var rww=Math.max(1,Math.round(x+(c+1)*cw)-rx);
      g.fillStyle=col;
      g.fillRect(rx,ry,rww,rhh);
    }
  }
}

/* ============================================================
   山体 —— 单峰，带雪线、受光面、岩层噪点
   ============================================================ */
function _psMountain(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=44;
  var pal={
    hi : _tint(c1,0.45),
    mid: c1,
    lo : _mixHex(c1,c2,0.55),
    dark:_mixHex(c1,c2,0.85),
    snow:_tint(c1,0.88),
    snowShade:_mixHex(_tint(c1,0.88),c2,0.28)
  };
  function ridge(u){
    var d=(u-0.5)/0.58;
    var base=Math.exp(-d*d*2.6);
    var win=Math.sin(Math.min(1,Math.max(0,u))*Math.PI);
    var rough=_jsFbm(u*9,0.5)*0.16+_jsFbm(u*23,3.1)*0.07;
    return Math.max(0,Math.min(1,(base*0.98-0.07)*win + rough*win*0.6));
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var hgt=ridge(u);
    if(hgt<0.02)return null;
    var top=1-hgt;
    if(v<top)return null;
    var rel=(v-top)/Math.max(0.001,1-top);
    var lit=(u<0.5);
    var col;
    // 雪线
    if(hgt>0.66 && rel<0.20+ (hgt-0.66)*0.35){
      col = lit?pal.snow:pal.snowShade;
      var sn=_pr(c*5.3+r*3.1);
      if(sn<0.10)col=pal.snowShade;
      return col;
    }
    if(rel<0.12)      col=pal.hi;
    else if(rel<0.50) col= lit?pal.hi:pal.mid;
    else if(rel<0.80) col= lit?pal.mid:pal.lo;
    else              col= lit?pal.lo:pal.dark;
    // 岩层噪点
    var grain=_pr(c*3.7+r*11.3);
    if(grain>0.90)col=_tint(col,0.30);
    else if(grain<0.10)col=_mixHex(col,pal.dark,0.55);
    // 山脊暗线
    if(rel<0.05)col=_mixHex(col,pal.dark,0.5);
    return col;
  });
}

/* ============================================================
   山脉 —— 多峰连绵，带雪顶
   ============================================================ */
function _psMountainRange(g,x,y,w,h,c1,c2,pulse){
  /* 精细多峰山脉 —— 五座高度不等的山峰交错，
     每座独立左受光 / 右背光，顶部 22% 雪线，岩层噪点。 */
  var cols=Math.max(60,Math.min(560,Math.ceil(w/1.2)));
  var rows=Math.max(40,Math.min(440,Math.ceil(h/1.2)));
  var pal={
    hi   : _tint(c1,0.46),
    mid  : c1,
    lo   : _mixHex(c1,c2,0.52),
    dark : _mixHex(c1,c2,0.84),
    snow : _tint(c1,0.90),
    snowLo:_mixHex(_tint(c1,0.90),c2,0.30)
  };
  var peaks=[
    {cx:0.10, h:0.48, hw:0.155},
    {cx:0.30, h:0.78, hw:0.170},
    {cx:0.50, h:0.58, hw:0.150},
    {cx:0.70, h:0.88, hw:0.175},
    {cx:0.90, h:0.42, hw:0.150}
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var bestTopV=2, bestCx=0.5;
    for(var i=0;i<peaks.length;i++){
      var pk=peaks[i];
      var du=Math.abs(u-pk.cx);
      if(du>pk.hw)continue;
      var hRatio=pk.h*(1-du/pk.hw);
      var topV=1-hRatio;
      if(v<topV)continue;
      if(topV<bestTopV){bestTopV=topV;bestCx=pk.cx;}
    }
    if(bestTopV>=1.999)return null;
    var rel=(v-bestTopV)/Math.max(0.001,1-bestTopV);
    var lit=(u<bestCx);
    if(rel<0.22){
      var sn=_pr(c*5.3+r*3.1);
      if(sn<0.14)return pal.snowLo;
      return lit?pal.snow:pal.snowLo;
    }
    var col;
    if(rel<0.36)      col=lit?pal.hi :pal.mid;
    else if(rel<0.66) col=lit?pal.mid:pal.lo;
    else              col=lit?pal.lo :pal.dark;
    if(rel<0.02)col=_mixHex(col,pal.dark,0.55);
    var grain=_pr(c*3.7+r*11.3);
    if(grain>0.93)      col=_tint(col,0.26);
    else if(grain<0.07) col=pal.dark;
    return col;
  });
}
function _psCastle(g,x,y,w,h,c1,c2,pulse){
  /* 城堡 —— 主楼 + 双塔 + 城垛 + 拱门 + 窗 */
  var cols=56, rows=48;
  var pal={
    wall   : _mixHex(c1,c2,0.28),
    wallHi : _tint(c1,0.36),
    wallLo : _mixHex(c1,c2,0.58),
    wallDk : _mixHex(c1,c2,0.82),
    mortar : _mixHex(c1,c2,0.72),
    roof   : _mixHex(c1,c2,0.72),
    roofHi : _mixHex(c2,c1,0.30),
    win    : '#ffd166',
    winCore: '#fff6c4',
    door   : '#22150a',
    flag   : '#d84a4a'
  };
  var mainTop=0.44, mainL=0.19, mainR=0.81;
  var towerW=0.14, towerTop=0.22;
  var ltL=0.035, rtL=0.825;
  var merlons=7;
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var col=null;
    if(u>0.487&&u<0.513&&v>0.045&&v<0.16) return pal.wallDk;
    if(u>0.513&&u<0.575&&v>0.055&&v<0.105) return pal.flag;
    if(v>=towerTop-0.055 && v<towerTop){
      if(u>=ltL && u<ltL+towerW){
        var s1=(u-ltL)/towerW*3;
        if(Math.floor(s1)%2===0) col=pal.wallHi;
        return col;
      }
      if(u>=rtL && u<rtL+towerW){
        var s2=(u-rtL)/towerW*3;
        if(Math.floor(s2)%2===0) col=pal.wallHi;
        return col;
      }
    }
    if(v>=mainTop-0.062 && v<mainTop && u>=mainL && u<mainR){
      var seg=(u-mainL)/(mainR-mainL)*merlons;
      if(Math.floor(seg)%2===0) col=pal.wall;
      return col;
    }
    if(u>=ltL && u<ltL+towerW && v>=towerTop && v<=0.95){
      var fx=(u-ltL)/towerW;
      col = (fx<0.30)?pal.wallHi:((fx<0.72)?pal.wall:pal.wallLo);
      if(v>0.40&&v<0.49&&fx>0.28&&fx<0.72){
        col = (fx>0.38&&fx<0.62&&v>0.42&&v<0.47)?pal.winCore:pal.win;
      }
      var row1=Math.floor(v*26);
      if(Math.abs((v*26)-row1)<0.10 || (fx>0.46&&fx<0.54&&row1%2===1)) col=pal.mortar;
      if(fx<0.06||fx>0.94) col=pal.wallDk;
      return col;
    }
    if(u>=rtL && u<rtL+towerW && v>=towerTop && v<=0.95){
      var fx2=(u-rtL)/towerW;
      col = (fx2<0.30)?pal.wallHi:((fx2<0.72)?pal.wall:pal.wallLo);
      if(v>0.40&&v<0.49&&fx2>0.28&&fx2<0.72){
        col = (fx2>0.38&&fx2<0.62&&v>0.42&&v<0.47)?pal.winCore:pal.win;
      }
      var row2=Math.floor(v*26);
      if(Math.abs((v*26)-row2)<0.10 || (fx2>0.46&&fx2<0.54&&row2%2===1)) col=pal.mortar;
      if(fx2<0.06||fx2>0.94) col=pal.wallDk;
      return col;
    }
    if(u>=mainL && u<mainR && v>=mainTop && v<=0.95){
      var fx3=(u-mainL)/(mainR-mainL);
      col = (fx3<0.48)?pal.wall:pal.wallLo;
      if(v-mainTop<0.020) col=pal.wallHi;
      if(v>0.74 && Math.abs(u-0.5)<0.075){
        var dy=(0.95-v)/0.21;
        var arch=Math.sqrt(Math.max(0,1-dy*dy*0.85));
        if(Math.abs(u-0.5)<0.075*arch) col=pal.door;
      }
      if(v>0.56&&v<0.66){
        if((u>0.285&&u<0.345)||(u>0.655&&u<0.715)){
          col = ((v>0.575&&v<0.645)&&(u>0.30&&u<0.33||u>0.67&&u<0.70))?pal.winCore:pal.win;
        }
      }
      if(v>0.68&&v<0.73){
        if((u>0.35&&u<0.40)||(u>0.60&&u<0.65)) col=pal.win;
      }
      var row3=Math.floor(v*28);
      var off=(row3%2)?0.5:0;
      var bx=(fx3*9+off);
      if(Math.abs(bx-Math.round(bx))<0.075 || Math.abs((v*28)-row3)<0.09) col=pal.mortar;
      var grain=_pr(c*3.7+r*11.3);
      if(grain>0.93)col=_tint(col,0.22);
      else if(grain<0.07)col=pal.wallDk;
      return col;
    }
    return null;
  });
}
/* ============================================================
   城市 —— 天际线，每栋楼独立窗户网格
   ============================================================ */
function _psCity(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=46;
  var pal={
    hi   : _tint(c1,0.34),
    b1   : _mixHex(c1,c2,0.32),
    b2   : _mixHex(c1,c2,0.52),
    b3   : _mixHex(c1,c2,0.18),
    dark : _mixHex(c1,c2,0.85),
    win  : '#ffd166',
    winDim:'#a8863c',
    winOff:'#1a2230'
  };
  var xs = [0.000,0.108,0.200,0.320,0.420,0.530,0.630,0.740,0.850];
  var ws = [0.100,0.084,0.110,0.092,0.100,0.092,0.100,0.102,0.140];
  var hs = [0.50 ,0.72 ,0.42 ,0.86 ,0.55 ,0.68 ,0.48 ,0.79 ,0.60 ];
  var blds=[];
  for(var i=0;i<xs.length;i++) blds.push({x:xs[i],w:ws[i],top:1-hs[i],seed:i});

  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<blds.length;i++){
      var b=blds[i];
      if(u<b.x||u>=b.x+b.w)continue;
      if(v<b.top||v>0.965)continue;
      var fx=(u-b.x)/b.w;
      var fy=(v-b.top)/(0.965-b.top);
      var col;
      if(fx<0.5) col=(i%3===0)?pal.b3:pal.b1;
      else       col=(i%3===0)?pal.b1:pal.b2;
      if(fy<0.018) col=pal.hi;
      if(v>0.94)   col=pal.dark;
      // 窗户网格（4 列 × 8 行）
      var wcol=Math.floor(fx*4);
      var wrow=Math.floor(fy*8);
      var lx=fx*4-wcol;
      var ly=fy*8-wrow;
      if(lx>0.20&&lx<0.80&&ly>0.22&&ly<0.78){
        var sv=_pr(i*13.1+wcol*3.7+wrow*7.7);
        if(sv>0.58)      col=pal.win;
        else if(sv>0.38) col=pal.winDim;
        else             col=pal.winOff;
      }
      return col;
    }
    return null;
  });
}

/* ============================================================
   村庄 —— 三角屋顶 + 墙体 + 门 + 窗，屋顶带瓦片纹理
   ============================================================ */
function _psVillage(g,x,y,w,h,c1,c2,pulse){
  var cols=60, rows=38;
  var pal={
    wall  : _mixHex(c1,c2,0.30),
    wallHi: _tint(c1,0.40),
    wallLo: _mixHex(c1,c2,0.56),
    roof  : _mixHex(c1,c2,0.72),
    roofHi: _mixHex(c2,c1,0.38),
    roofLo: _mixHex(c1,c2,0.90),
    door  : '#3a2010',
    win   : '#ffdd88',
    winGlow:'#fff4c0'
  };
  var houses=[
    {x:0.030,w:0.215,top:0.50},
    {x:0.275,w:0.285,top:0.40},
    {x:0.600,w:0.240,top:0.46},
    {x:0.865,w:0.115,top:0.60}
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<houses.length;i++){
      var hs=houses[i];
      var hx=hs.x, hw=hs.w, htop=hs.top;
      var roofH=(1-htop)*0.40;
      var wallTop=htop+roofH;
      if(u<hx||u>=hx+hw)continue;

      // ---- 墙体 ----
      if(v>=wallTop && v<=0.95){
        var col=(u<hx+hw*0.5)?pal.wall:pal.wallLo;
        if(v-wallTop<0.022) col=pal.wallHi;
        // 门
        if(u>hx+hw*0.36 && u<hx+hw*0.64 && v>0.76) col=pal.door;
        // 窗
        if(v>wallTop+0.045 && v<wallTop+0.135){
          if((u>hx+hw*0.10 && u<hx+hw*0.26)||(u>hx+hw*0.74 && u<hx+hw*0.90)){
            col = (v<wallTop+0.115)?pal.winGlow:pal.win;
          }
        }
        return col;
      }
      // ---- 屋顶（三角形） ----
      if(v>=htop && v<wallTop){
        var f=(v-htop)/roofH;
        var halfW=hw*0.5*(f*1.03+0.03);
        if(Math.abs(u-(hx+hw*0.5))<=halfW){
          var col=pal.roof;
          if(u<(hx+hw*0.5)) col=pal.roofHi;
          var tx=Math.floor((u-hx)*26 + f*12);
          if(tx%2===0) col=_mixHex(col,pal.roofLo,0.32);
          if(f>0.86)   col=pal.roofLo;
          if(f<0.10 && u>hx+hw*0.44 && u<hx+hw*0.56) col=pal.roofLo;
          return col;
        }
        return null;
      }
    }
    return null;
  });
}

/* ============================================================
   繁星 —— 星空底噪 + 多级星点 + 闪烁
   ============================================================ */
function _psStars(g,x,y,w,h,c1,c2,pulse){
  var cols=72, rows=46;
  // 纯透明背景：只绘制星点像素，其余格点返回 null 保持透明。
  // 密度比之前略高，避免去掉底色后过于稀疏。
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var s = _pr(c*3.7+r*11.3);
    var s2= _pr(c*7.1+r*5.3);
    if(s>0.9840){
      // 明亮主星（带闪烁）
      var tw=0.55+0.45*Math.sin(pulse*6.283+s2*12.0);
      var col=_tint(c1,0.35+tw*0.6);
      if(tw>0.92) col='#ffffff';
      return col;
    } else if(s>0.9580){
      // 中等星
      return _tint(c1,0.15);
    } else if(s>0.9260){
      // 暗弱星
      return _mixHex(c1,c2,0.42);
    }
    return null;
  });
}

/* ============================================================
   星系 —— 双旋臂 + 亮核 + 尘埃噪声
   ============================================================ */
function _psGalaxy(g,x,y,w,h,c1,c2,pulse){
  var cols=72, rows=52;
  var cx=0.5, cy=0.5;
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var dx=u-cx, dy=v-cy;
    var rad=Math.sqrt(dx*dx+dy*dy);
    var ang=Math.atan2(dy,dx);
    var arms=2, armVal=0;
    for(var a=0;a<arms;a++){
      var target=ang-(a*Math.PI)-Math.log(Math.max(0.025,rad))*1.75;
      var d=Math.atan2(Math.sin(target),Math.cos(target));
      var val=Math.exp(-d*d*5.2)*Math.exp(-rad*2.5);
      if(val>armVal)armVal=val;
    }
    var core=Math.exp(-rad*rad*95);
    var n=_jsFbm(u*20,r*20)*0.34+_jsFbm(u*48,r*48)*0.16;
    var intensity=armVal*0.92+core*1.25+n*0.22;
    if(intensity<0.085)return null;   // 纯透明背景：抬高阈值，去掉底层雾状填充
    var col;
    if(core>0.42)       col='#ffffff';
    else if(core>0.16)  col=_tint(c1,0.62);
    else if(intensity>0.56) col=_tint(c1,0.24);
    else if(intensity>0.30) col=c1;
    else                col=_mixHex(c1,c2,0.58);
    // 偶发亮星
    if(_pr(c*11.7+r*3.1)>0.994) col='#ffffff';
    return col;
  });
}

/* ============================================================
   云朵 —— 距离场堆叠的蓬松云团（真·云感）
   ============================================================ */
function _psCloud(g,x,y,w,h,c1,c2,pulse){
  var cols=56, rows=28;
  var pal={
    hi  : _tint(c1,0.72),
    mid : c1,
    lo  : _mixHex(c1,c2,0.42),
    dark: _mixHex(c1,c2,0.72)
  };
  // 多个椭圆团块（位置 / 半径均归一化）
  var blobs=[
    {x:0.16,y:0.68,rx:0.16,ry:0.26},
    {x:0.28,y:0.56,rx:0.20,ry:0.34},
    {x:0.42,y:0.50,rx:0.18,ry:0.36},
    {x:0.56,y:0.52,rx:0.20,ry:0.34},
    {x:0.70,y:0.60,rx:0.19,ry:0.30},
    {x:0.84,y:0.70,rx:0.15,ry:0.24},
    {x:0.50,y:0.72,rx:0.38,ry:0.24},
    {x:0.30,y:0.78,rx:0.26,ry:0.18},
    {x:0.70,y:0.78,rx:0.26,ry:0.18},
    {x:0.42,y:0.62,rx:0.14,ry:0.22},
    {x:0.60,y:0.64,rx:0.14,ry:0.20}
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var den=-1;
    for(var i=0;i<blobs.length;i++){
      var b=blobs[i];
      var dx=(u-b.x)/b.rx;
      var dy=(v-b.y)/b.ry;
      var d=dx*dx+dy*dy;
      var val=1-d;
      if(val>den)den=val;
    }
    // 边缘抖动，形成不规则蓬松感
    var noise=(_pr(c*12.9+r*78.2)-0.5)*0.26
            + (_pr(c*4.3+r*33.7)-0.5)*0.14;
    den+=noise;
    if(den<=0.02)return null;
    var col;
    if(den>0.66)      col=pal.hi;
    else if(den>0.44) col=pal.mid;
    else if(den>0.22) col=pal.lo;
    else              col=pal.dark;
    // 底部阴影增强
    if(v>0.72 && den<0.70) col=_mixHex(col,pal.dark,0.5);
    // 顶部高光
    if(v<0.42 && den>0.5) col=pal.hi;
    // 云内随机细颗粒
    var grain=_pr(c*3.7+r*11.3);
    if(grain>0.94) col=_tint(col,0.30);
    else if(grain<0.05 && den<0.75) return null;
    return col;
  });
}

/* ============================================================
   树林 —— 连绵树冠 + 树干 + 叶隙
   ============================================================ */
function _psForest(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=40;
  var pal={
    hi   : _tint(c1,0.50),
    mid  : c1,
    lo   : _mixHex(c1,c2,0.50),
    dark : _mixHex(c1,c2,0.82),
    trunk: '#4a3220',
    trunkDk:'#1e1208'
  };
  // 树冠团块（重叠形成连绵）
  var crowns=[];
  var n=11;
  for(var i=0;i<n;i++){
    var t=(i+0.5)/n;
    var cx=t*1.06-0.03;
    var cy=0.44+(_pr(i*3.7)-0.5)*0.10;
    var r =0.17+_pr(i*5.1)*0.07;
    crowns.push({x:cx,        y:cy,            r:r,        seed:i*4+0});
    crowns.push({x:cx-0.05+_pr(i*7.3)*0.10, y:cy-0.16, r:r*0.78, seed:i*4+1});
    crowns.push({x:cx+0.05+_pr(i*11.1)*0.10,y:cy+0.09, r:r*0.72, seed:i*4+2});
    crowns.push({x:cx+(_pr(i*17.3)-0.5)*0.12,y:cy-0.04,r:r*0.86, seed:i*4+3});
  }
  var trunks=[];
  var tn=9;
  for(var k=0;k<tn;k++) trunks.push({x:(k+0.5)/tn + (_pr(k*3.3)-0.5)*0.02});

  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    // ---- 树冠优先 ----
    var best=-1, bestSeed=0;
    for(var i=0;i<crowns.length;i++){
      var b=crowns[i];
      var dx=u-b.x;
      var dy=(v-b.y)*0.82;
      var d2=(dx*dx+dy*dy)/(b.r*b.r);
      var val=1-d2;
      if(val>best){best=val;bestSeed=b.seed;}
    }
    if(best>0.02){
      var grain=_pr(c*1.7+r*5.3+bestSeed*7.9);
      // 叶隙（镂空）
      if(grain<0.055 && best<0.86) return null;
      var col;
      if(best>0.80)      col=pal.hi;
      else if(best>0.52) col=pal.mid;
      else if(best>0.26) col=pal.lo;
      else               col=pal.dark;
      // 下半部压暗（体积感）
      if(v>0.55 && best<0.62) col=pal.dark;
      // 右下侧阴影
      if(u>0.5 && v>0.42 && best<0.70) col=_mixHex(col,pal.dark,0.55);
      // 内部随机明暗
      if(grain>0.935)      col=pal.hi;
      else if(grain<0.16 && best<0.72) col=pal.dark;
      return col;
    }
    // ---- 树干 ----
    if(v>0.72){
      for(var j=0;j<trunks.length;j++){
        var tx=trunks[j].x;
        var ww=0.010+_pr(j*4.4)*0.006;
        if(Math.abs(u-tx)<ww){
          var tv=(v-0.72)/0.28;
          var grain2=_pr(c*9.1+r*2.3);
          if(grain2<0.35) return pal.trunkDk;
          return (tv>0.7)?pal.trunkDk:pal.trunk;
        }
      }
    }
    return null;
  });
}

/* ============================================================
   松树林 —— 层叠锯齿针叶塔
   ============================================================ */
function _psPineForest(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=44;
  var pal={
    hi    : _tint(c1,0.50),
    mid   : c1,
    lo    : _mixHex(c1,c2,0.52),
    dark  : _mixHex(c1,c2,0.86),
    trunk : '#3a2414',
    trunkDk:'#1a0e06'
  };
  var trees=[];
  var n=10;
  for(var i=0;i<n;i++){
    var t=(i+0.5)/n;
    trees.push({
      x: t + (_pr(i*3.7)-0.5)*0.045,
      top: 0.05 + _pr(i*5.1)*0.17,
      bot: 0.76 + _pr(i*7.3)*0.14,
      hw : 0.040 + _pr(i*11.1)*0.026,
      seed: i
    });
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    // ---- 针叶塔 ----
    for(var i=0;i<trees.length;i++){
      var tr=trees[i];
      if(v<tr.top||v>tr.bot)continue;
      var f=(v-tr.top)/(tr.bot-tr.top);
      var side=Math.abs(u-tr.x);
      // 分层锯齿：越往下越宽
      var layer=Math.floor(f*8.0);
      var jag=(layer%2===0)?1.0:0.72;
      var edge=tr.hw*f*jag;
      if(side>edge)continue;
      var col;
      var lightv=_pr(c*3.1+r*7.7+tr.seed*13.1);
      if(f<0.09)            col=pal.hi;
      else if(f<0.42)       col=(u<tr.x)?pal.mid:pal.lo;
      else if(f<0.78)       col=(u<tr.x)?pal.lo :pal.dark;
      else                  col=pal.dark;
      if(lightv>0.92)       col=_tint(col,0.42);
      else if(lightv<0.12)  col=pal.dark;
      return col;
    }
    // ---- 树干 ----
    if(v>0.76){
      for(var j=0;j<trees.length;j++){
        if(Math.abs(u-trees[j].x)<0.0075){
          var g2=_pr(c*5.3+r*3.1);
          return (g2<0.4)?pal.trunkDk:pal.trunk;
        }
      }
    }
    return null;
  });
}

/* ============================================================
   草垛 —— 干草捆，带草束纹理与捆扎带
   ============================================================ */
function _psHaystack(g,x,y,w,h,c1,c2,pulse){
  var cols=56, rows=36;
  var pal={
    hi  : _tint(c1,0.52),
    mid : c1,
    lo  : _mixHex(c1,c2,0.44),
    dark: _mixHex(c1,c2,0.76),
    tie : '#6b4a20',
    tieHi:'#8a6430'
  };
  var stacks=[
    {x:0.055,w:0.205,top:0.28},
    {x:0.315,w:0.245,top:0.16},
    {x:0.615,w:0.225,top:0.32},
    {x:0.850,w:0.130,top:0.44}
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<stacks.length;i++){
      var st=stacks[i];
      if(v<st.top||v>0.95)continue;
      var f=(v-st.top)/(0.95-st.top);
      // 草垛上窄下宽（略带弧度）
      var halfW=st.w*0.5*(0.70+0.36*Math.sin(Math.min(1,f*1.35)*Math.PI*0.5));
      if(Math.abs(u-(st.x+st.w*0.5))>halfW)continue;
      var tx=Math.floor((u-st.x)*46);
      var ty=Math.floor(f*16);
      var sv=_pr(tx*3.7+ty*11.3+i*7.7);
      var col;
      if(sv>0.86)      col=pal.hi;
      else if(sv>0.56) col=pal.mid;
      else if(sv>0.26) col=pal.lo;
      else             col=pal.dark;
      if(f<0.12) col=pal.hi;
      if(f>0.88) col=pal.dark;
      // 捆扎带
      if(Math.abs(f-0.55)<0.055) col=(sv>0.5)?pal.tieHi:pal.tie;
      return col;
    }
    return null;
  });
}

/* ============================================================
   篱笆 —— 木桩 + 双横梁 + 木纹
   ============================================================ */
function _psFence(g,x,y,w,h,c1,c2,pulse){
  var cols=72, rows=30;
  var pal={
    wood  : _mixHex(c1,c2,0.26),
    woodHi: _tint(c1,0.46),
    woodLo: _mixHex(c1,c2,0.58),
    woodDk: _mixHex(c1,c2,0.86)
  };
  var posts=Math.max(4,Math.round(w/16));
  var pw=0.62/posts;
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    // ---- 立柱 ----
    var idx=(u*posts)%1;
    var d=Math.abs(idx-0.5);
    if(d<pw/2 && v>0.08 && v<0.96){
      var col=(d<pw*0.22)?pal.woodHi:pal.wood;
      var grain=_pr(c*3.7+r*11.3);
      if(grain>0.90) col=_tint(col,0.28);
      else if(grain<0.10) col=pal.woodLo;
      if(d>pw*0.40) col=pal.woodDk;
      return col;
    }
    // ---- 上横梁 ----
    if(v>0.28 && v<0.405){
      var col2=(v<0.315)?pal.woodHi:pal.wood;
      if(_pr(c*5.3+r*2.7)<0.14) col2=pal.woodLo;
      if(v>0.388) col2=pal.woodDk;
      return col2;
    }
    // ---- 下横梁 ----
    if(v>0.605 && v<0.730){
      var col3=(v<0.640)?pal.woodHi:pal.wood;
      if(_pr(c*7.1+r*3.3)<0.14) col3=pal.woodLo;
      if(v>0.713) col3=pal.woodDk;
      return col3;
    }
    return null;
  });
}

/* ============================================================
   石墙 —— 交错砖块 + 灰缝 + 单砖色差
   ============================================================ */
function _psWall(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=36;
  var pal={
    stone  : _mixHex(c1,c2,0.26),
    stoneHi: _tint(c1,0.30),
    stoneLo: _mixHex(c1,c2,0.56),
    stoneDk: _mixHex(c1,c2,0.82),
    mortar : _mixHex(c1,c2,0.74)
  };
  var ROWS=8, BRICKS=6;
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var row=Math.floor(v*ROWS);
    var fy=v*ROWS-row;
    var off=(row%2)?0.5:0;
    var bx=u*BRICKS+off;
    var col=Math.floor(bx);
    var fx=bx-col;
    // 灰缝
    if(fy<0.10||fy>0.90||fx<0.045||fx>0.955) return pal.mortar;
    var sv=_pr(col*3.7+row*11.3);
    var base;
    if(sv>0.76)      base=pal.stoneHi;
    else if(sv>0.42) base=pal.stone;
    else if(sv>0.18) base=pal.stoneLo;
    else             base=pal.stoneDk;
    var grain=_pr(c*1.7+r*5.3);
    if(grain>0.90)      base=_tint(base,0.28);
    else if(grain<0.09) base=pal.stoneDk;
    return base;
  });
}

/* ============================================================
   龙 —— 蛇形身体 + 蝠翼 + 头 + 眼 + 角 + 焰息
   ============================================================ */
function _psDragon(g,x,y,w,h,c1,c2,pulse){
  var cols=72, rows=48;
  var pal={
    body  : _mixHex(c1,c2,0.30),
    bodyHi: _tint(c1,0.42),
    bodyLo: _mixHex(c1,c2,0.58),
    belly : _tint(c1,0.68),
    wing  : _mixHex(c1,c2,0.66),
    wingHi: _tint(c1,0.22),
    wingLo: _mixHex(c1,c2,0.90),
    eye   : '#ff3020',
    horn  : '#e8dcc0',
    fire1 : '#ffe070',
    fire2 : '#ff8020',
    fire3 : '#ff4008'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // ---- 焰息（随时间脉冲） ----
    var fx=0.88, fy=0.46;
    var fdx=(u-fx)*1.6;
    var fdy=v-fy;
    var fd=Math.sqrt(fdx*fdx+fdy*fdy);
    var fireLen=0.10+pulse*0.055;
    if(u>0.80 && fd<fireLen){
      if(fd<fireLen*0.32)      return pal.fire1;
      if(fd<fireLen*0.64)      return pal.fire2;
      return pal.fire3;
    }

    // ---- 尾巴 ----
    var tt=(u-0.015)/0.235;
    if(tt>0&&tt<1){
      var ty=0.62+Math.sin(tt*Math.PI*1.5)*0.10 - tt*0.07;
      var thick=0.075*(1-tt*0.72);
      if(Math.abs(v-ty)<thick){
        return (v<ty-thick*0.3)?pal.bodyHi:pal.body;
      }
      if(tt>0.72){
        var ff2=(tt-0.72)/0.28;
        if(Math.abs(v-(ty-0.05))<0.030*ff2) return pal.wingHi;
      }
    }

    // ---- 身体（波浪） ----
    var bt=(u-0.20)/0.50;
    if(bt>0&&bt<1){
      var by=0.50+Math.sin(bt*Math.PI*2.2)*0.075;
      var thick2=0.088*(1-bt*0.26);
      if(Math.abs(v-by)<thick2){
        if(v>by+thick2*0.34) return pal.belly;
        if(v<by-thick2*0.40) return pal.bodyLo;
        return pal.body;
      }
    }

    // ---- 蝠翼 ----
    if(u>0.27&&u<0.62&&v>0.06&&v<0.42){
      var wf=(u-0.27)/0.35;
      var top=0.10+wf*0.22;
      var bot=0.32+wf*0.06;
      if(v>top&&v<bot){
        var rib=Math.abs(Math.sin(wf*Math.PI*3.0));
        if(rib>0.74)      return pal.wingLo;
        if(wf<0.22)       return pal.wingHi;
        return pal.wing;
      }
    }

    // ---- 头部 ----
    var hx=0.685, hy=0.435;
    var hd=Math.sqrt(Math.pow((u-hx)*1.55,2)+Math.pow(v-hy,2));
    if(hd<0.105){
      var col=pal.body;
      if(v<hy-0.03) col=pal.bodyHi;
      if(v>hy+0.05) col=pal.belly;
      return col;
    }
    // ---- 吻部 ----
    if(u>0.755&&u<0.865&&v>0.425&&v<0.480) return pal.body;
    // ---- 眼睛 ----
    if(u>0.700&&u<0.740&&v>0.385&&v<0.428) return pal.eye;
    // ---- 双角 ----
    if(v>0.24&&v<0.375){
      var hf=(v-0.24)/0.135;
      if(Math.abs(u-(0.660+hf*0.010))<0.018) return pal.horn;
      if(Math.abs(u-(0.715-hf*0.006))<0.018) return pal.horn;
    }
    return null;
  });
}

/* ============================================================
   机器人 —— 全副机甲，含头 / 面罩 / 核心 / 四肢 / 天线
   ============================================================ */
function _psMech(g,x,y,w,h,c1,c2,pulse){
  var cols=52, rows=56;
  var pal={
    armor  : _mixHex(c1,c2,0.24),
    armorHi: _tint(c1,0.46),
    armorLo: _mixHex(c1,c2,0.58),
    armorDk: _mixHex(c1,c2,0.86),
    joint  : '#2a2e3a',
    jointHi: '#5a6270',
    eye    : '#00e5ff',
    eyeCore: '#ffffff',
    core   : '#ff4400',
    coreHi : '#ffcc00',
    antenna: '#e03030'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // 天线
    if(u>0.485&&u<0.515&&v>0.025&&v<0.150) return pal.armorLo;
    if(u>0.452&&u<0.548&&v>0.018&&v<0.052) return pal.antenna;

    // 头部
    if(u>0.355&&u<0.645&&v>0.135&&v<0.290){
      var col=(u<0.5)?pal.armorHi:pal.armor;
      if(v>0.225&&v<0.250&&u>0.355&&u<0.645) col=pal.armorDk;
      if(v>0.185&&v<0.245&&u>0.400&&u<0.600){
        col=pal.joint;
        if((u>0.420&&u<0.478)||(u>0.522&&u<0.580)) col=pal.eye;
        if((u>0.442&&u<0.462)||(u>0.540&&u<0.560)) col=pal.eyeCore;
      }
      return col;
    }
    // 颈部
    if(u>0.435&&u<0.565&&v>0.290&&v<0.335) return pal.joint;
    // 躯干
    if(u>0.300&&u<0.700&&v>0.335&&v<0.600){
      var col=(u<0.5)?pal.armorHi:pal.armor;
      if(v>0.355&&v<0.385&&u>0.330&&u<0.670) col=pal.armorDk;
      if(v>0.425&&v<0.445&&u>0.330&&u<0.670) col=pal.armorLo;
      // 胸口核心
      if(u>0.450&&u<0.550&&v>0.440&&v<0.545){
        col=pal.core;
        if(u>0.472&&u<0.528&&v>0.462&&v<0.523) col=pal.coreHi;
      }
      if(u<0.335||u>0.665) col=pal.armorDk;
      return col;
    }
    // 肩甲
    if(((u>0.175&&u<0.320)||(u>0.680&&u<0.825))&&v>0.320&&v<0.445){
      var col=pal.armor;
      if(v<0.352) col=pal.armorHi;
      if(v>0.415) col=pal.armorLo;
      return col;
    }
    // 手臂
    if(((u>0.215&&u<0.300)||(u>0.700&&u<0.785))&&v>0.445&&v<0.685){
      var col=(v<0.545)?pal.armorLo:pal.armor;
      if(v>0.545&&v<0.575) col=pal.joint;
      return col;
    }
    // 腿
    if(((u>0.360&&u<0.462)||(u>0.538&&u<0.640))&&v>0.600&&v<0.915){
      var col=pal.armor;
      if(v>0.655&&v<0.695) col=pal.jointHi;
      if(v>0.855)          col=pal.armorDk;
      return col;
    }
    // 脚
    if(((u>0.300&&u<0.480)||(u>0.520&&u<0.700))&&v>0.905&&v<0.972) return pal.armorDk;
    return null;
  });
}

/* ============================================================
   塔 —— 尖顶 + 收分塔身 + 石纹 + 三层窗 + 门
   ============================================================ */
function _psTower(g,x,y,w,h,c1,c2,pulse){
  var cols=44, rows=60;
  var pal={
    stone  : _mixHex(c1,c2,0.30),
    stoneHi: _tint(c1,0.38),
    stoneLo: _mixHex(c1,c2,0.60),
    stoneDk: _mixHex(c1,c2,0.86),
    roof   : _mixHex(c1,c2,0.74),
    roofHi : _mixHex(c2,c1,0.32),
    win    : '#ffd166',
    winCore: '#fff6c4',
    door   : '#2a1608'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // ---- 尖顶 ----
    if(v<0.235){
      var f=v/0.235;
      var halfW=0.170*(f*1.02+0.04);
      if(Math.abs(u-0.5)<halfW){
        var col=(u<0.5)?pal.roofHi:pal.roof;
        var tv=Math.floor((u-0.5+0.20)*18);
        if(tv%2===0) col=_mixHex(col,pal.roof,0.45);
        return col;
      }
      return null;
    }

    // ---- 塔身（上宽下窄） ----
    var f2=(v-0.235)/0.705;
    var halfW2=0.190*(1-f2*0.18);
    if(Math.abs(u-0.5)<halfW2 && v<0.955){
      var col=(u<0.5)?pal.stoneHi:pal.stone;
      // 石块层
      var row=Math.floor(v*26);
      var off=(row%2)?0.5:0;
      var bx=u*9+off;
      if(Math.abs(bx-Math.round(bx))<0.075 || Math.abs(v*26-row)<0.095) col=pal.stoneLo;
      var grain=_pr(c*3.7+r*11.3);
      if(grain>0.90)      col=_tint(col,0.26);
      else if(grain<0.09) col=pal.stoneDk;
      // 窗
      if(u>0.425&&u<0.575){
        if((v>0.355&&v<0.445)||(v>0.545&&v<0.635)||(v>0.735&&v<0.825)){
          col=pal.win;
          if(u>0.455&&u<0.545) col=pal.winCore;
        }
      }
      // 门
      if(v>0.855&&u>0.395&&u<0.605) col=pal.door;
      // 两侧描边
      if(Math.abs(Math.abs(u-0.5)-halfW2)<0.024) col=pal.stoneDk;
      return col;
    }
    return null;
  });
}

/* ============================================================
   废墟 —— 断裂石柱 + 苔藓 + 地基
   ============================================================ */
function _psRuins(g,x,y,w,h,c1,c2,pulse){
  var cols=60, rows=42;
  var pal={
    stone  : _mixHex(c1,c2,0.30),
    stoneHi: _tint(c1,0.34),
    stoneLo: _mixHex(c1,c2,0.60),
    stoneDk: _mixHex(c1,c2,0.86),
    moss   : '#4a7a3a',
    mossLo : '#2a4a20'
  };
  var pillars=[
    {x:0.055,w:0.085,top:0.28,broken:false},
    {x:0.205,w:0.085,top:0.15,broken:true },
    {x:0.365,w:0.085,top:0.50,broken:false},
    {x:0.525,w:0.085,top:0.22,broken:true },
    {x:0.685,w:0.085,top:0.40,broken:false},
    {x:0.840,w:0.085,top:0.32,broken:true }
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    // ---- 地基 ----
    if(v>0.885){
      var col=(v<0.915)?pal.stone:pal.stoneLo;
      if(v>0.955) col=pal.stoneDk;
      var grain=_pr(c*3.7+r*11.3);
      if(grain>0.90) col=_tint(col,0.20);
      return col;
    }
    // ---- 石柱 ----
    for(var i=0;i<pillars.length;i++){
      var pl=pillars[i];
      if(u<pl.x||u>=pl.x+pl.w) continue;
      var top=pl.top;
      if(pl.broken){
        top=pl.top + _pr(i*7.7+Math.floor(u*36))*0.085;
      }
      if(v<top||v>0.895) continue;
      var fx=(u-pl.x)/pl.w;
      var col;
      if(fx<0.24)      col=pal.stoneHi;
      else if(fx<0.70) col=pal.stone;
      else             col=pal.stoneLo;
      // 横向石纹
      var rr=Math.floor(v*22);
      if(Math.floor((v-0.012)*22)!==rr) col=pal.stoneDk;
      var grain=_pr(c*5.3+r*7.1+i);
      if(grain>0.90)      col=_tint(col,0.26);
      else if(grain<0.08) col=pal.stoneDk;
      // 苔藓
      if(v<0.55 && _pr(i*3.1+Math.floor(v*22))>0.74) col=pal.moss;
      if(v>0.82 && _pr(i*5.3+Math.floor(u*22))>0.58) col=pal.mossLo;
      return col;
    }
    return null;
  });
}

/* ============================================================
   灯塔 —— 红白条纹 + 灯室 + 呼吸光晕
   ============================================================ */
function _psLighthouse(g,x,y,w,h,c1,c2,pulse){
  var cols=36, rows=60;
  var pal={
    red   : '#d84040',
    redLo : '#9a2020',
    white : '#f2f2e6',
    whiteLo:'#c4c4b2',
    dark  : '#1a1a22',
    lamp  : '#ffee88',
    lampCore:'#ffffff',
    base  : '#4a4a52',
    baseHi:'#6a6a72'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // 圆顶
    if(v<0.075){
      var dd=Math.sqrt(Math.pow((u-0.5)*2.4,2)+Math.pow((v-0.055)*2.4,2));
      if(dd<1) return pal.dark;
      return null;
    }
    // 灯室
    if(v>=0.075&&v<0.215){
      if(u>0.335&&u<0.665){
        if(u>0.400&&u<0.600&&v>0.100&&v<0.195){
          return (u>0.455&&u<0.545)?pal.lampCore:pal.lamp;
        }
        return pal.dark;
      }
      return null;
    }
    // 塔身
    var f=(v-0.215)/0.720;
    var halfW=0.175*(1-f*0.30);
    if(Math.abs(u-0.5)<halfW && v<0.955){
      var stripe=Math.floor(f*11);
      var isRed=(stripe%2===0);
      var col;
      if(isRed) col=(u<0.5)?pal.red:pal.redLo;
      else      col=(u<0.5)?pal.white:pal.whiteLo;
      if(Math.abs(Math.abs(u-0.5)-halfW)<0.026) col=pal.dark;
      return col;
    }
    // 底座
    if(v>=0.945){
      var col=(v<0.965)?pal.baseHi:pal.base;
      return col;
    }
    return null;
  });

  // 灯光光晕（网格之外叠加）
  var lx=x+w*0.5, ly=y+h*0.135;
  var rad=Math.min(w,h)*0.46;
  var grd=g.createRadialGradient(lx,ly,0,lx,ly,rad);
  var ga=0.20+pulse*0.22;
  grd.addColorStop(0.00,'rgba(255,238,136,'+(ga*1.0).toFixed(3)+')');
  grd.addColorStop(0.42,'rgba(255,238,136,'+(ga*0.30).toFixed(3)+')');
  grd.addColorStop(1.00,'rgba(255,238,136,0)');
  g.save();
  g.fillStyle=grd;
  g.beginPath();g.arc(lx,ly,rad,0,Math.PI*2);g.fill();
  g.restore();
}

/* ============================================================
   大树 —— 多团树冠 + 树干 + 叶隙
   ============================================================ */
function _psTree(g,x,y,w,h,c1,c2,pulse){
  var cols=48, rows=60;
  var pal={
    leafHi : _tint(c1,0.50),
    leaf   : c1,
    leafLo : _mixHex(c1,c2,0.48),
    leafDk : _mixHex(c1,c2,0.80),
    bark   : '#5a3a1e',
    barkHi : '#8a5a2e',
    barkLo : '#2e1a0a'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // ---- 树干 ----
    if(v>0.560){
      var f=(v-0.560)/0.440;
      var tw=0.048*(1-f*0.26);
      var tx=0.5+Math.sin(f*1.2)*0.010;
      if(Math.abs(u-tx)<tw){
        var col;
        if(u<tx-0.012)      col=pal.barkHi;
        else if(u<tx+0.012) col=pal.bark;
        else                col=pal.barkLo;
        if(Math.abs(u-tx)>tw*0.70) col=pal.barkLo;
        var grain=_pr(c*5.3+r*3.1);
        if(grain>0.88) col=_tint(col,0.30);
        return col;
      }
      if(v>0.920 && Math.abs(u-tx)<tw*2.4) return pal.barkLo;
      return null;
    }

    // ---- 树冠团块 ----
    var clusters=[
      {x:0.50,y:0.28,r:0.245},
      {x:0.31,y:0.38,r:0.205},
      {x:0.69,y:0.38,r:0.205},
      {x:0.39,y:0.17,r:0.170},
      {x:0.61,y:0.17,r:0.170},
      {x:0.50,y:0.44,r:0.220},
      {x:0.21,y:0.49,r:0.135},
      {x:0.79,y:0.49,r:0.135},
      {x:0.50,y:0.10,r:0.135}
    ];
    var best=-1;
    for(var i=0;i<clusters.length;i++){
      var cl=clusters[i];
      var dx=(u-cl.x)/cl.r;
      var dy=(v-cl.y)/cl.r;
      var d=1-(dx*dx+dy*dy);
      if(d>best)best=d;
    }
    if(best>0){
      var grain=_pr(c*3.7+r*11.3);
      if(grain<0.050) return null;   // 叶隙
      var col;
      if(best>0.720)      col=pal.leafHi;
      else if(best>0.420) col=pal.leaf;
      else if(best>0.180) col=pal.leafLo;
      else                col=pal.leafDk;
      if(u>0.5 && v>0.40 && best<0.62) col=pal.leafDk;
      if(grain>0.930) col=pal.leafHi;
      return col;
    }
    return null;
  });
}

/* ============================================================
   飞鸟 —— 经典 V 形剪影 + 振翅
   ============================================================ */
function _psBirds(g,x,y,w,h,c1,c2,pulse){
  var cols=64, rows=34;
  var pal={
    dark: _mixHex(c1,c2,0.62),
    mid : c1,
    hi  : _tint(c1,0.42)
  };
  var birds=[];
  var n=9;
  for(var i=0;i<n;i++){
    birds.push({
      x: 0.08+_pr(i*3.7)*0.84,
      y: 0.16+_pr(i*5.1)*0.58,
      s: 0.036+_pr(i*7.3)*0.042,
      phase: _pr(i*13.1)*6.283
    });
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<birds.length;i++){
      var b=birds[i];
      var flap=Math.sin(pulse*6.283+b.phase);
      var span=b.s*2.8;
      var dx=u-b.x;
      if(Math.abs(dx)>span) continue;
      var we=Math.abs(dx)/span;
      // 翅膀弧线（下探 / 上扬）
      var target=b.y - flap*0.030 - we*we*(0.050+flap*0.018);
      if(Math.abs(v-target)<0.014){
        if(we<0.16) return pal.dark;
        if(we<0.50) return pal.mid;
        return pal.hi;
      }
      // 身体
      if(we<0.11 && Math.abs(v-b.y)<0.013) return pal.dark;
    }
    return null;
  });
}

/* ============================================================
   鲸鱼 —— 钝头身体 + 尾鳍 + 眼睛 + 喷水
   ============================================================ */
function _psWhale(g,x,y,w,h,c1,c2,pulse){
  var cols=68, rows=42;
  var pal={
    body  : _mixHex(c1,c2,0.30),
    bodyHi: _tint(c1,0.44),
    belly : _tint(c1,0.72),
    bodyLo: _mixHex(c1,c2,0.60),
    bodyDk: _mixHex(c1,c2,0.86),
    eye   : '#0a0e1a',
    spout : '#c8e8ff'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // ---- 身体椭圆 ----
    var bx=0.42, by=0.56, rx=0.345, ry=0.195;
    var dx=(u-bx)/rx, dy=(v-by)/ry;
    var dd=dx*dx+dy*dy;
    if(dd<1){
      var col;
      if(v<by-ry*0.26)      col=pal.bodyHi;
      else if(v>by+ry*0.34) col=pal.belly;
      else                  col=pal.body;
      var grain=_pr(c*3.7+r*11.3);
      if(grain>0.92)      col=_tint(col,0.22);
      else if(grain<0.08) col=pal.bodyLo;
      return col;
    }
    // ---- 尾 ----
    if(u>0.700&&u<0.945){
      var tf=(u-0.700)/0.245;
      var ty=by+tf*0.060;
      var thick=0.072*(1-tf*0.92);
      if(Math.abs(v-ty)<thick) return pal.body;
      if(tf>0.54){
        var ff=(tf-0.54)/0.46;
        var spread=ff*0.185;
        if(Math.abs(Math.abs(v-ty)-spread)<0.023) return pal.bodyLo;
      }
    }
    // ---- 眼睛 ----
    if(u>0.195&&u<0.238&&v>0.525&&v<0.578) return pal.eye;
    // ---- 嘴线 ----
    if(u>0.075&&u<0.215&&Math.abs(v-0.605)<0.013) return pal.bodyDk;
    // ---- 喷水 ----
    if(v<0.44){
      var sx=0.300;
      var sd=Math.sqrt(Math.pow((u-sx)*2.6,2)+Math.pow(v-0.235,2));
      if(sd<0.14+pulse*0.035) return pal.spout;
      if(Math.abs(u-sx)<0.013&&v>0.235&&v<0.405) return pal.spout;
    }
    return null;
  });
}

/* ============================================================
   山丘 —— 双峰起伏 + 草地明暗
   ============================================================ */
function _psHill(g,x,y,w,h,c1,c2,pulse){
  var cols=60, rows=34;
  var pal={
    grassHi : _tint(c1,0.50),
    grass   : c1,
    grassLo : _mixHex(c1,c2,0.46),
    grassDk : _mixHex(c1,c2,0.76),
    soil    : _mixHex(c2,c1,0.16)
  };
  function hillH(u){
    var h1=Math.exp(-Math.pow((u-0.29)/0.34,2))*0.72;
    var h2=Math.exp(-Math.pow((u-0.73)/0.30,2))*0.56;
    var n =_jsFbm(u*6.5,0.5)*0.10;
    return Math.max(h1,h2)+n;
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var hh=hillH(u);
    var top=1-hh;
    if(v<top) return null;
    var rel=(v-top)/Math.max(0.001,1-top);
    var lit=(u<0.5);
    var col;
    if(rel<0.10)      col=pal.grassHi;
    else if(rel<0.55) col= lit?pal.grass:pal.grassLo;
    else              col= lit?pal.grassLo:pal.grassDk;
    var grain=_pr(c*3.7+r*11.3);
    if(grain>0.92)      col=pal.grassHi;
    else if(grain<0.09) col=pal.grassDk;
    if(rel>0.90) col=pal.soil;
    return col;
  });
}

/* ============================================================
   帐篷 —— 三角篷布 + 接缝 + 开口
   ============================================================ */
function _psTent(g,x,y,w,h,c1,c2,pulse){
  var cols=60, rows=36;
  var pal={
    clothHi : _tint(c1,0.44),
    cloth   : c1,
    clothLo : _mixHex(c1,c2,0.50),
    clothDk : _mixHex(c1,c2,0.82),
    dark    : '#1a1008'
  };
  var tents=[
    {x:0.055,w:0.245,top:0.30},
    {x:0.335,w:0.300,top:0.18},
    {x:0.665,w:0.270,top:0.34}
  ];
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<tents.length;i++){
      var t=tents[i];
      var cx=t.x+t.w*0.5;
      var halfW=t.w*0.5;
      if(v<t.top||v>0.935) continue;
      var f=(v-t.top)/(0.935-t.top);
      var wAt=f*halfW;
      if(Math.abs(u-cx)>wAt) continue;
      var col=(u<cx)?pal.clothHi:pal.cloth;
      if(Math.abs(u-cx)<0.006) col=pal.clothLo;
      if(f>0.82) col=pal.clothLo;
      // 开口
      if(f>0.52){
        var openW=wAt*0.44;
        if(Math.abs(u-cx)<openW)       col=pal.clothDk;
        if(Math.abs(u-cx)<openW*0.58)  col=pal.dark;
      }
      return col;
    }
    return null;
  });
}

/* ============================================================
   金字塔 —— 砌块分层 + 受光面 + 转角高光
   ============================================================ */
function _psPyramid(g,x,y,w,h,c1,c2,pulse){
  var cols=56, rows=42;
  var pal={
    faceHi : _tint(c1,0.44),
    face   : c1,
    faceLo : _mixHex(c1,c2,0.48),
    faceDk : _mixHex(c1,c2,0.78),
    edge   : _mixHex(c1,c2,0.92),
    edgeHi : _tint(c1,0.62)
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var halfW=v*0.480;
    if(Math.abs(u-0.5)>halfW) return null;
    var lit=(u<0.5);
    var blockRow=Math.floor(v*15);
    var bf=v*15-blockRow;
    var col=lit?pal.faceHi:pal.face;
    // 水平砖缝
    if(bf<0.115) col=pal.edge;
    // 顶部收口线
    if(v<0.025) col=pal.edgeHi;
    // 转角高光
    if(Math.abs(Math.abs(u-0.5)-halfW)<0.012) col=pal.edgeHi;
    // 底部压暗
    if(v>0.86) col=lit?pal.faceLo:pal.faceDk;
    var grain=_pr(c*3.7+r*11.3);
    if(grain>0.93)      col=_tint(col,0.22);
    else if(grain<0.07) col=_mixHex(col,pal.faceDk,0.5);
    return col;
  });
}

/* ============================================================
   风车 —— 塔身 + 圆锥顶 + 四叶旋转
   ============================================================ */
function _psWindmill(g,x,y,w,h,c1,c2,pulse){
  var cols=52, rows=60;
  var pal={
    wall   : _mixHex(c1,c2,0.30),
    wallHi : _tint(c1,0.40),
    wallLo : _mixHex(c1,c2,0.60),
    wallDk : _mixHex(c1,c2,0.86),
    roof   : _mixHex(c1,c2,0.70),
    roofHi : _mixHex(c2,c1,0.32),
    door   : '#2a1608',
    win    : '#ffd166',
    hub    : '#3a2414'
  };
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;

    // ---- 圆锥顶 ----
    if(v<=0.300){
      var f2=v/0.300;
      var halfW2=0.175*(f2*0.92+0.055);
      if(Math.abs(u-0.5)<halfW2){
        var col=(u<0.5)?pal.roofHi:pal.roof;
        var tv=Math.floor((u-0.5+0.20)*16);
        if(tv%2===0) col=_mixHex(col,pal.roof,0.4);
        return col;
      }
      return null;
    }
    // ---- 塔身 ----
    if(v>0.300&&v<0.945){
      var f=(v-0.300)/0.645;
      var halfW=0.155*(1-f*0.24);
      if(Math.abs(u-0.5)<halfW){
        var col=(u<0.5)?pal.wallHi:pal.wall;
        var grain=_pr(c*3.7+r*11.3);
        if(grain>0.90)      col=_tint(col,0.22);
        else if(grain<0.09) col=pal.wallLo;
        if(v>0.40&&v<0.50&&Math.abs(u-0.5)<0.048) col=pal.win;
        if(v>0.60&&v<0.70&&Math.abs(u-0.5)<0.048) col=pal.win;
        if(v>0.80&&Math.abs(u-0.5)<0.055)         col=pal.door;
        if(Math.abs(Math.abs(u-0.5)-halfW)<0.023) col=pal.wallDk;
        return col;
      }
    }
    return null;
  });

  // ---- 风车叶（网格外直接绘制） ----
  var hubX=x+w*0.5, hubY=y+h*0.235;
  var rot=pulse*Math.PI*2;
  var bladeLen=Math.min(w,h)*0.40;
  var steps=Math.ceil(bladeLen);
  for(var b=0;b<4;b++){
    var ang=rot+b*Math.PI/2;
    var ca=Math.cos(ang), sa=Math.sin(ang);
    for(var s=3;s<=steps;s++){
      var px=hubX+ca*s;
      var py=hubY+sa*s;
      var sz=Math.max(1, 2.4*(1-s/steps*0.55));
      g.fillStyle=(s%4<2)?_tint(c1,0.30):_mixHex(c1,c2,0.45);
      g.fillRect(Math.round(px-sz/2),Math.round(py-sz/2),Math.round(sz),Math.round(sz));
    }
  }
  // 轮毂
  g.fillStyle=pal.hub;
  g.fillRect(Math.round(hubX-3),Math.round(hubY-3),6,6);
  g.fillStyle=_tint(c1,0.55);
  g.fillRect(Math.round(hubX-1),Math.round(hubY-1),2,2);
}var _PRESET_DRAWERS = {
  presetMountain: _psMountain,
  presetMountainRange: _psMountainRange,
  presetCastle: _psCastle,
  presetCity: _psCity,
  presetVillage: _psVillage,
  presetStars: _psStars,
  presetGalaxy: _psGalaxy,
  presetCloud: _psCloud,
  presetForest: _psForest,
  presetPineForest: _psPineForest,
  presetHaystack: _psHaystack,
  presetFence: _psFence,
  presetWall: _psWall,
  presetDragon: _psDragon,
  presetMech: _psMech,
  presetTower: _psTower,
  presetRuins: _psRuins,
  presetLighthouse: _psLighthouse,
  presetTree: _psTree,
  presetBirds: _psBirds,
  presetWhale: _psWhale,
  presetHill: _psHill,
  presetTent: _psTent,
  presetPyramid: _psPyramid,
  presetWindmill: _psWindmill
};

function computeBgLayerMax(list){
  var m = 1;
  list.forEach(function(bg){ var l = bg.layer||0; if (l > m) m = l; });
  return m;
}
function computeBgHaze(layer, maxLayer){
  var ratio = maxLayer > 0 ? (layer/maxLayer) : 0;
  return (1-ratio) * 0.72;
}
/* ============ 编辑渲染 ============ */

function _pr(i){ var x=Math.sin(i*12.9898)*43758.5453; return x-Math.floor(x); }
function paintBlock(g, x, y, w, h, col, adj, opt){
  opt = opt || {};
  g.fillStyle = col.base;
  g.fillRect(x, y, w, h);
  if (opt.texture === 'noise'){
    var count = Math.min(24, Math.floor(w*h/20));
    for (var i=0;i<count;i++){
      var nx = x + _pr(x*7+y*13+i*3)*w;
      var ny = y + _pr(x*11+y*17+i*5)*h;
      g.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
      g.fillRect(nx, ny, 1, 1);
    }
  } else if (opt.texture === 'metal'){
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (var mx = x+1; mx < x+w-1; mx += 3){ g.fillRect(mx, y+1, 1, h-2); }
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (var mx2 = x+2; mx2 < x+w-1; mx2 += 3){ g.fillRect(mx2, y+1, 1, h-2); }
  } else if (opt.texture === 'brick'){
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 0.5;
    for (var by = y+3; by < y+h-1; by += 4){ g.beginPath(); g.moveTo(x, by); g.lineTo(x+w, by); g.stroke(); }
  }
  if (!adj.up && h >= 3){
    var gr = g.createLinearGradient(0, y, 0, y+3);
    gr.addColorStop(0, col.top); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, 3);
    g.fillStyle = col.topEdge || 'rgba(255,255,255,0.5)';
    g.fillRect(x, y, w, 1);
  }
  if (!adj.down && h >= 3){
    var gr2 = g.createLinearGradient(0, y+h-3, 0, y+h);
    gr2.addColorStop(0, 'rgba(0,0,0,0)'); gr2.addColorStop(1, col.bottomShadow);
    g.fillStyle = gr2; g.fillRect(x, y+h-3, w, 3);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y+h-1, w, 1);
  }
  if (!adj.left && w >= 2){
    var gr3 = g.createLinearGradient(x, 0, x+2, 0);
    gr3.addColorStop(0, col.side); gr3.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr3; g.fillRect(x, y, 2, h);
    g.fillStyle = col.sideEdge || 'rgba(255,255,255,0.25)';
    g.fillRect(x, y, 1, h);
  }
  if (!adj.right && w >= 2){
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x+w-1, y, 1, h);
  }
}
function drawPlatformTo(g, el, adj){
  paintBlock(g, el.x, el.y, el.w||8, el.h||8, {
    base:'#2e3038', top:'#5a6270', topEdge:'rgba(180,200,220,0.4)',
    side:'#444a58', sideEdge:'rgba(160,180,200,0.3)',
    bottomShadow:'rgba(0,0,0,0.7)'
  }, adj, {texture:'noise'});
}
function drawIceTo(g, el, adj){
  var x=Math.round(el.x), y=Math.round(el.y), w=Math.round(el.w||8), h=Math.round(el.h||8);
  g.save();
  // 半透明冰蓝底
  g.globalAlpha=0.88;
  _px(g, x, y, w, h, '#7ec8e3');
  g.globalAlpha=1;
  // 内部像素霜纹
  _dither(g, x, y, w, h, 'rgba(200,240,255,0.65)', 'rgba(100,170,210,0.55)', 0.20);
  // 上缘白高光
  if (!adj.up){
    _px(g, x, y, w, 1, '#eaf7ff');
    if (w>=3) _px(g, x+1, y+1, w-2, 1, 'rgba(255,255,255,0.55)');
  }
  // 下缘深蓝
  if (!adj.down){
    _px(g, x, y+h-1, w, 1, '#3a7a9a');
  }
  // 左侧亮边
  if (!adj.left){
    for (var ly=0; ly<h; ly++){
      _pxDot(g, x, y+ly, 'rgba(255,255,255,0.35)');
    }
  }
  // 右侧暗边
  if (!adj.right){
    for (var ry=0; ry<h; ry++){
      _pxDot(g, x+w-1, y+ry, 'rgba(30,60,90,0.5)');
    }
  }
  // 中央像素星（反光）
  if (w>=4 && h>=4){
    var cx=Math.floor(w/2), cy=Math.floor(h/2);
    _pxDot(g, x+cx,   y+cy,   'rgba(255,255,255,0.9)');
    _pxDot(g, x+cx-1, y+cy,   'rgba(255,255,255,0.5)');
    _pxDot(g, x+cx+1, y+cy,   'rgba(255,255,255,0.5)');
    _pxDot(g, x+cx,   y+cy-1, 'rgba(255,255,255,0.5)');
    _pxDot(g, x+cx,   y+cy+1, 'rgba(255,255,255,0.5)');
  }
  // 融化中闪烁
  if (el._melt > 0){
    g.globalAlpha = 0.4 + 0.4*Math.sin(Date.now()/80);
    _px(g, x, y, w, h, '#88ddff');
    g.globalAlpha = 1;
  }
  g.restore();
}
function drawMovableTo(g, el, adj){
  paintBlock(g, el.x, el.y, el.w||8, el.h||8, {
    base:'#3f6fa8', top:'#7ca3d6', topEdge:'rgba(200,230,255,0.7)',
    side:'#5a85bd', sideEdge:'rgba(180,220,255,0.5)',
    bottomShadow:'rgba(0,10,30,0.75)'
  }, adj, {texture:'metal'});
  var x=el.x, y=el.y, w=el.w||8, h=el.h||8;
  g.fillStyle='rgba(255,255,255,0.4)';
  g.fillRect(x+1.5, y+1.5, 1, 1); g.fillRect(x+w-2.5, y+1.5, 1, 1);
  g.fillRect(x+1.5, y+h-2.5, 1, 1); g.fillRect(x+w-2.5, y+h-2.5, 1, 1);
}
function drawBreakableTo(g, el, adj){
  paintBlock(g, el.x, el.y, el.w||8, el.h||8, {
    base:'#a86040', top:'#e09060', topEdge:'rgba(255,220,180,0.7)',
    side:'#c07050', sideEdge:'rgba(255,200,160,0.5)',
    bottomShadow:'rgba(40,10,0,0.75)'
  }, adj, {texture:'brick'});
  var x=el.x, y=el.y, w=el.w||8, h=el.h||8;
  g.strokeStyle='rgba(60,20,0,0.7)'; g.lineWidth=0.6;
  g.beginPath(); g.moveTo(x+w*0.3, y+h*0.15); g.lineTo(x+w*0.5, y+h*0.5); g.lineTo(x+w*0.35, y+h*0.85); g.stroke();
  if (w > 8){ g.beginPath(); g.moveTo(x+w*0.7, y+h*0.2); g.lineTo(x+w*0.6, y+h*0.55); g.stroke(); }
}
function drawFlammableTo(g, el, adj){
  paintBlock(g, el.x, el.y, el.w||8, el.h||8, {
    base:'#a04020', top:'#e06030', topEdge:'rgba(255,180,100,0.8)',
    side:'#c05030', sideEdge:'rgba(255,200,140,0.5)',
    bottomShadow:'rgba(40,5,0,0.75)'
  }, adj, {texture:'noise'});
  var x=el.x, y=el.y, w=el.w||8, h=el.h||8;
  g.fillStyle='rgba(255,180,80,0.45)';
  for (var i=0;i<3;i++){ g.fillRect(x + _pr(x*3+y+i)*w, y + _pr(x+y*5+i)*h, 1, 1); }
}
function drawDisappearTo(g, el, adj){
  var x=el.x,y=el.y,w=el.w||8,h=el.h||8;
  var period=(el.onTime||1.5)+(el.offTime||1.0);
  var t=((Game.simTime+(el.phase||0))%period);
  var visible=t<(el.onTime||1.5);
  var alphaBase=visible?(0.85+0.15*Math.sin(Date.now()/180)):0.12;
  g.save();
  g.globalAlpha=alphaBase;
  var gr=g.createLinearGradient(0,y,0,y+h);
  gr.addColorStop(0,'#e0d0ff'); gr.addColorStop(1,'#a08adc');
  g.fillStyle=gr; g.fillRect(x,y,w,h);
  if(!adj.up){g.fillStyle='#ffffff';g.fillRect(x,y,w,1);}
  if(!adj.down){g.fillStyle='rgba(80,60,140,0.7)';g.fillRect(x,y+h-1,w,1);}
  g.setLineDash([3,3]);
  g.lineDashOffset=visible?(Date.now()/80)%6:0;
  g.strokeStyle=visible?'#d0bcff':'#6a6a8a';
  g.lineWidth=0.6;
  var x1=x+0.3,y1=y+0.3,x2=x+w-0.3,y2=y+h-0.3;
  if(!adj.up){g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y1);g.stroke();}
  if(!adj.down){g.beginPath();g.moveTo(x1,y2);g.lineTo(x2,y2);g.stroke();}
  if(!adj.left){g.beginPath();g.moveTo(x1,y1);g.lineTo(x1,y2);g.stroke();}
  if(!adj.right){g.beginPath();g.moveTo(x2,y1);g.lineTo(x2,y2);g.stroke();}
  g.setLineDash([]); g.lineDashOffset=0;
  g.restore();
}
function drawLampTo(g, l, playMode){
  var x=l.x, y=l.y, w=l.w||10, h=l.h||28;
  var cx=x+w/2;
  var bulbY = y + h*0.18;
  if(l.broken){
    g.save();
    g.strokeStyle='#3a3a44'; g.lineWidth=Math.max(1.5, w*0.2); g.lineCap='round';
    g.beginPath(); g.moveTo(cx, y+h); g.quadraticCurveTo(cx+3, y+h*0.5, cx-2, y+h*0.22); g.stroke();
    g.strokeStyle='rgba(255,255,255,0.15)'; g.lineWidth=Math.max(0.5, w*0.06);
    g.beginPath(); g.moveTo(cx-0.6, y+h); g.quadraticCurveTo(cx+2, y+h*0.5, cx-2.6, y+h*0.22); g.stroke();
    g.fillStyle='#4a4a52'; g.beginPath(); g.arc(cx-2, y+h*0.22, 4, 0, Math.PI*2); g.fill();
    g.fillStyle='rgba(0,0,0,0.5)'; g.beginPath(); g.arc(cx-2, y+h*0.22, 2.5, 0, Math.PI*2); g.fill();
    g.restore();
  } else {
    g.fillStyle='#3a3a44'; g.fillRect(cx-3, y+h-3, 6, 3);
    g.fillStyle='#5a5a66'; g.fillRect(cx-3, y+h-3, 6, 1);
    g.strokeStyle='#5a5a66'; g.lineWidth=Math.max(1.5, w*0.2); g.lineCap='round';
    g.beginPath(); g.moveTo(cx, y+h-2); g.lineTo(cx, y+h*0.22); g.stroke();
    g.strokeStyle='rgba(255,255,255,0.3)'; g.lineWidth=Math.max(0.5, w*0.06);
    g.beginPath(); g.moveTo(cx-1, y+h-2); g.lineTo(cx-1, y+h*0.22); g.stroke();
    var pulse = playMode ? (0.85 + Math.sin(Date.now()/400)*0.15) : 0.92;
    var haloR = h*1.4;
    var halo=g.createRadialGradient(cx, bulbY, 0, cx, bulbY, haloR);
    halo.addColorStop(0, 'rgba(255,224,102,'+(0.7*pulse)+')');
    halo.addColorStop(0.35, 'rgba(255,200,80,'+(0.22*pulse)+')');
    halo.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle=halo; g.beginPath(); g.arc(cx, bulbY, haloR, 0, Math.PI*2); g.fill();
    g.fillStyle='#ffcc44'; g.beginPath(); g.arc(cx, bulbY, 4, 0, Math.PI*2); g.fill();
    g.fillStyle='#ffffff'; g.beginPath(); g.arc(cx, bulbY, 1.6, 0, Math.PI*2); g.fill();
  }
}
function drawVineTo(g, v, playMode){
  var x=v.x, y=v.y, w=v.w||6, h=v.h||36;
  var segs=Math.max(3, v.segments||5);
  var color=v.color||'#88ffaa';
  var cx=x+w/2;
  var sway=v.sway||0;
  var nodes=[{x:cx, y:y}];
  var segH=h/segs;
  for(var i=1;i<=segs;i++){
    var frac=i/segs;
    var amp = sway * 14 * frac * frac;
    var wobble = Math.sin(Date.now()/1400 + i*0.8 + (v.x+v.y)*0.05) * 0.6 * frac;
    nodes.push({x: cx + amp + wobble, y: y + segH*i});
  }
  g.save();
  g.shadowBlur = playMode ? 12 : 8;
  g.shadowColor = color;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.8, w*0.4);
  g.lineCap='round'; g.lineJoin='round';
  g.beginPath(); g.moveTo(nodes[0].x, nodes[0].y);
  for(var n=1;n<nodes.length;n++){
    var prev=nodes[n-1], curr=nodes[n];
    var mx=(prev.x+curr.x)/2, my=(prev.y+curr.y)/2;
    g.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.lineWidth = Math.max(0.6, w*0.12);
  g.beginPath(); g.moveTo(nodes[0].x, nodes[0].y);
  for(var n2=1;n2<nodes.length;n2++){
    var prev2=nodes[n2-1], curr2=nodes[n2];
    var mx2=(prev2.x+curr2.x)/2, my2=(prev2.y+curr2.y)/2;
    g.quadraticCurveTo(prev2.x, prev2.y, mx2, my2);
  }
  g.stroke();
  var pulse = playMode ? (0.7 + Math.sin(Date.now()/700)*0.3) : 0.85;
  g.shadowBlur = 6; g.shadowColor = color; g.fillStyle = color;
  g.beginPath(); g.arc(nodes[0].x, nodes[0].y, 1.8*pulse+0.8, 0, Math.PI*2); g.fill();
  g.shadowBlur = 0;
  g.fillStyle='rgba(255,255,255,'+(0.7*pulse)+')';
  g.beginPath(); g.arc(nodes[0].x, nodes[0].y, 0.9, 0, Math.PI*2); g.fill();
  g.restore();
}
function _pr(i){ var x=Math.sin(i*12.9898)*43758.5453; return x-Math.floor(x); }
function _px(g,x,y,w,h,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); }
function _pxDot(g,x,y,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),1,1); }
function _dither(g,x,y,w,h,cA,cB,density){
  // 1px 抖动图案 —— 硬像素，无渐变
  var n=Math.max(1,Math.round(w*h*density));
  for(var i=0;i<n;i++){
    var px2 = x + Math.floor(_pr((x*13+y*7+i)*1.17)*w);
    var py2 = y + Math.floor(_pr((x*7+y*13+i)*2.31)*h);
    _pxDot(g, px2, py2, (i%2===0)?cA:cB);
  }
}
function drawBlockPixel(g, el, adj, pal){
  var x=Math.round(el.x), y=Math.round(el.y), w=Math.round(el.w||8), h=Math.round(el.h||8);
  _px(g, x, y, w, h, pal.base);
  // 内部抖动
  if (pal.ditherA && pal.ditherB){
    _dither(g, x, y, w, h, pal.ditherA, pal.ditherB, pal.density||0.12);
  }
  // 边缘（只在未连接时）
  if (!adj.up){
    _px(g, x, y, w, 1, pal.top);
    if (w>=3) _px(g, x+1, y, w-2, 1, pal.top2 || pal.top);
  }
  if (!adj.down){
    _px(g, x, y+h-1, w, 1, pal.bot);
    if (w>=3) _px(g, x+1, y+h-2, w-2, 1, pal.bot2 || pal.bot);
  }
  if (!adj.left){
    for (var ly=0; ly<h; ly++){
      var a = 0.10 + 0.06*Math.sin(ly*0.7 + x*0.3);
      _pxDot(g, x, y+ly, 'rgba(255,255,255,'+a.toFixed(2)+')');
    }
  }
  if (!adj.right){
    for (var ry=0; ry<h; ry++){
      _pxDot(g, x+w-1, y+ry, 'rgba(0,0,0,0.32)');
    }
  }
  // 内部像素细节
  if (pal.detail) pal.detail(g, x, y, w, h);
}
function drawPlatformTo(g, el, adj){
  drawBlockPixel(g, el, adj, {
    base:'#31323c',
    top:'#5a5c6a', top2:'#454754',
    bot:'#16171c',
    ditherA:'rgba(90,95,115,0.55)', ditherB:'rgba(20,20,28,0.55)', density:0.14
  });
}
function drawMovableTo(g, el, adj){
  drawBlockPixel(g, el, adj, {
    base:'#3c5670',
    top:'#607c9a', top2:'#4a627e',
    bot:'#182334',
    ditherA:'rgba(120,150,190,0.5)', ditherB:'rgba(20,30,45,0.5)', density:0.10,
    detail:function(g,x,y,w,h){
      // 四角像素铆钉
      _pxDot(g, x+1, y+1, '#8ba8c4');
      _pxDot(g, x+w-2, y+1, '#8ba8c4');
      _pxDot(g, x+1, y+h-2, '#1a2a3a');
      _pxDot(g, x+w-2, y+h-2, '#1a2a3a');
    }
  });
}
function drawBreakableTo(g, el, adj){
  drawBlockPixel(g, el, adj, {
    base:'#7a5340',
    top:'#a5735a', top2:'#8c5e46',
    bot:'#3a2518',
    ditherA:'rgba(200,150,120,0.5)', ditherB:'rgba(50,30,18,0.5)', density:0.16,
    detail:function(g,x,y,w,h){
      // 单像素裂纹
      _pxDot(g, x+Math.floor(w*0.35), y+Math.floor(h*0.25), '#3a2010');
      _pxDot(g, x+Math.floor(w*0.45), y+Math.floor(h*0.5), '#3a2010');
      _pxDot(g, x+Math.floor(w*0.55), y+Math.floor(h*0.75), '#3a2010');
    }
  });
}
function drawFlammableTo(g, el, adj){
  drawBlockPixel(g, el, adj, {
    base:'#7d3a2a',
    top:'#a8503a', top2:'#8c442f',
    bot:'#3a1410',
    ditherA:'rgba(220,120,70,0.55)', ditherB:'rgba(60,15,5,0.55)', density:0.18,
    detail:function(g,x,y,w,h){
      // 中央一点余烬
      _pxDot(g, x+Math.floor(w/2), y+Math.floor(h/2), '#ffb060');
    }
  });
}
function drawDisappearTo(g, el, adj){
  var x=Math.round(el.x), y=Math.round(el.y), w=Math.round(el.w||8), h=Math.round(el.h||8);
  var period=(el.onTime||1.5)+(el.offTime||1.0);
  var t=((Game.simTime+(el.phase||0))%period);
  var visible=t<(el.onTime||1.5);
  var a=visible?0.9:0.18;
  g.save();
  g.globalAlpha=a;
  _px(g, x, y, w, h, '#8a7fc4');
  // 抖动像素图案
  _dither(g, x, y, w, h, 'rgba(224,208,255,0.9)', 'rgba(120,100,180,0.6)', 0.25);
  if(!adj.up){ _px(g, x, y, w, 1, '#e8dfff'); }
  if(!adj.down){ _px(g, x, y+h-1, w, 1, '#5c4a98'); }
  g.globalAlpha=1;
  // 硬像素虚线外框
  g.setLineDash([2,2]);
  g.strokeStyle=visible?'#d8c6ff':'#6a6a8a';
  g.lineWidth=1;
  var x1=x+0.5,y1=y+0.5,x2=x+w-0.5,y2=y+h-0.5;
  if(!adj.up){g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y1);g.stroke();}
  if(!adj.down){g.beginPath();g.moveTo(x1,y2);g.lineTo(x2,y2);g.stroke();}
  if(!adj.left){g.beginPath();g.moveTo(x1,y1);g.lineTo(x1,y2);g.stroke();}
  if(!adj.right){g.beginPath();g.moveTo(x2,y1);g.lineTo(x2,y2);g.stroke();}
  g.setLineDash([]);
  g.restore();
}
function drawLampTo(g, l, playMode){
  var x=Math.round(l.x), y=Math.round(l.y);
  var w=Math.round(l.w||8), h=Math.round(l.h||32);
  var cx=Math.round(x+w/2);
  if(l.broken){
    // 断柱
    _px(g, cx-1, y+8, 2, h-8, '#2a2a32');
    _px(g, cx-1, y+8, 1, h-8, '#3a3a44');
    // 碎灯头
    _px(g, cx-3, y+6, 5, 3, '#2a2a32');
    _px(g, cx-2, y+7, 1, 1, '#4a4a54');
    return;
  }
  // 灯柱（1px 细）
  for (var py=y+8; py<y+h; py++){
    _pxDot(g, cx, py, '#4a4a56');
  }
  // 灯柱高光
  for (var py2=y+9; py2<y+h; py2+=2){
    _pxDot(g, cx-1, py2, 'rgba(120,120,140,0.3)');
  }
  // 灯座
  _px(g, cx-2, y+h-2, 4, 2, '#3a3a44');
  // 灯头
  _px(g, cx-2, y+6, 4, 3, '#3a3a44');
  _px(g, cx-1, y+6, 2, 1, '#5a5a66');
  // 昏暗的暖黄光晕（两层叠加，全部低 alpha）
  var pulse = playMode ? (0.85 + Math.sin(Date.now()/900)*0.15) : 0.9;
  g.save();
  // 外层大光晕
  var g1 = g.createRadialGradient(cx, y+8, 0, cx, y+8, h*0.9);
  g1.addColorStop(0,   'rgba(255,220,140,'+(0.14*pulse)+')');
  g1.addColorStop(0.45,'rgba(255,190,100,'+(0.06*pulse)+')');
  g1.addColorStop(1,   'rgba(255,190,100,0)');
  g.fillStyle=g1;
  g.beginPath(); g.arc(cx, y+8, h*0.9, 0, Math.PI*2); g.fill();
  // 内层小光晕
  var g2 = g.createRadialGradient(cx, y+8, 0, cx, y+8, h*0.35);
  g2.addColorStop(0,   'rgba(255,235,170,'+(0.22*pulse)+')');
  g2.addColorStop(0.6, 'rgba(255,210,130,'+(0.08*pulse)+')');
  g2.addColorStop(1,   'rgba(255,210,130,0)');
  g.fillStyle=g2;
  g.beginPath(); g.arc(cx, y+8, h*0.35, 0, Math.PI*2); g.fill();
  g.restore();
  // 微小灯芯（1px 硬像素）
  _pxDot(g, cx, y+8, '#ffe9b0');
  if (playMode && Math.random()<0.5){
    // 偶尔有一点摇曳的火星
    _pxDot(g, cx + (Math.random()<0.5?-1:1), y+7, 'rgba(255,220,150,0.7)');
  }
}
function drawVineTo(g, v, playMode){
  var x=Math.round(v.x), y=Math.round(v.y);
  var w=Math.max(2, v.w||3), h=Math.round(v.h||40);
  var segs=Math.max(4, Math.min(14, v.segments||8));
  var color=v.color||'#88ddaa';
  var cx = x + w/2;
  var sway = v.sway||0;
  var now = Date.now();
  // 计算节点（越往下摆动越大，幅度大幅增加）
  var nodes=[];
  var segH = h / segs;
  for (var i=0; i<=segs; i++){
    var frac = i/segs;
    var amp = sway * 40 * frac * frac;   // 原来 12，改为 40 → 大幅摆动
    var wob = Math.sin(now/1600 + i*0.6 + (v.x+v.y)*0.04) * 0.4 * frac;
    nodes.push({x: cx + amp + wob, y: y + segH*i, frac: frac});
  }
  g.save();
  var glow = playMode ? 1 : 0.7;
  g.shadowBlur = 4 * glow;
  g.shadowColor = color;

  // 逐行绘制连续丝带（关键：不再逐节点画点）
  for (var yy = y; yy < y + h; yy++){
    var fracY = (yy - y) / h;
    var nodeIdx = fracY * segs;
    var i1 = Math.min(Math.floor(nodeIdx), segs);
    var i2 = Math.min(i1 + 1, segs);
    var t = nodeIdx - i1;
    var xx = nodes[i1].x + (nodes[i2].x - nodes[i1].x) * t;
    var thick = fracY < 0.3 ? 2 : 1;
    _px(g, Math.round(xx - thick/2), yy, thick, 1, color);
  }
  g.shadowBlur = 0;

  // 内芯细高光（上半部）
  for (var yy2 = y + 1; yy2 < y + h - 1; yy2++){
    var fracY2 = (yy2 - y) / h;
    if (fracY2 > 0.55) continue;
    var nodeIdx2 = fracY2 * segs;
    var i12 = Math.min(Math.floor(nodeIdx2), segs);
    var i22 = Math.min(i12 + 1, segs);
    var t2 = nodeIdx2 - i12;
    var xx2 = nodes[i12].x + (nodes[i22].x - nodes[i12].x) * t2;
    _pxDot(g, Math.round(xx2), yy2, 'rgba(255,255,255,0.55)');
  }

  // 顶端固定点 + 底端小球
  _pxDot(g, Math.round(nodes[0].x), Math.round(nodes[0].y), color);
  var lastNd = nodes[nodes.length-1];
  _pxDot(g, Math.round(lastNd.x), Math.round(lastNd.y), color);

  g.restore();
}

/* ============ 物理引擎 ============ */
function mkParticle(x,y,vx,vy,life,r,g,b){return{x:x,y:y,vx:vx,vy:vy,life:life,maxLife:life,r:r,g:g,b:b};}
function stepPlayerPhysics(p,keys,dt,solids,ghosts,mods){
  mods=mods||{};
  var _speedMul=mods.speedMul||1;
  var _inertiaMul=mods.inertiaMul||1;
  var _gravityMul=mods.gravityMul||1;
  var left=keys['KeyA']||keys['ArrowLeft'];
  var right=keys['KeyD']||keys['ArrowRight'];
  var jump=keys['KeyW']||keys['ArrowUp'];
  var acc=p.grounded?FEEL.groundAccel:FEEL.airAccel;
  var maxSp=FEEL.maxWalkSpeed*_speedMul;
  var _stopFriction=FEEL.stopFriction;
  if(_inertiaMul>1)_stopFriction=1-(1-_stopFriction)/_inertiaMul;
  if(left&&right){
    if(p.vx>0.1)p.vx=Math.max(p.vx-acc,0);
    else if(p.vx<-0.1)p.vx=Math.min(p.vx+acc,0);
    else p.vx=0;
  }else if(left)p.vx=Math.max(p.vx-acc,-maxSp);
  else if(right)p.vx=Math.min(p.vx+acc,maxSp);
  else{p.vx*=_stopFriction;if(Math.abs(p.vx)<0.05)p.vx=0;}
  var jumpMinV=-Math.sqrt(2*FEEL.gravity*_gravityMul*FEEL.jumpMinHeight);
  var jumpMaxV=-Math.sqrt(2*FEEL.gravity*_gravityMul*FEEL.jumpMaxHeight);
  var maxHoldFrames=Math.max(1,Math.round(FEEL.jumpMaxHoldTime*60));
  if(p.grounded)p.coyoteTimer=FEEL.coyoteTime;
  else p.coyoteTimer=Math.max(0,p.coyoteTimer-dt);
  if(jump&&!p._prevJump)p.bufferTimer=FEEL.jumpBufferTime;
  else p.bufferTimer=Math.max(0,p.bufferTimer-dt);
  if(p.bufferTimer>0&&p.coyoteTimer>0&&p.jumpHold===0&&p.wallJumpUsed!==true){
    p.vy=jumpMinV*p.gravityDir;
    p.grounded=false;p.jumpHold=1;
    p.bufferTimer=0;p.coyoteTimer=0;
    p.squashVY=-0.5;p.squashVX=-0.25;
    p.canDoubleJump=true;
  }
  // 蹬墙跳：贴在墙上且土狼时间耗尽，按跳触发一次
  if(p.bufferTimer>0&&p.onWall!==0&&p.jumpHold===0&&!p.wallJumpUsed){
    p.vy=jumpMinV*0.95*p.gravityDir;
    p.vx=p.onWall*FEEL.maxWalkSpeed*1.5;
    p.grounded=false;p.jumpHold=1;
    p.bufferTimer=0;p.coyoteTimer=0;
    p.squashVY=-0.5;p.squashVX=-0.25;
    p.canDoubleJump=true;
    p.wallJumpUsed=true;
  }
  if(jump&&p.jumpHold>0&&p.jumpHold<maxHoldFrames){
    var holdT=p.jumpHold/maxHoldFrames;
    var baseV=jumpMinV+(jumpMaxV-jumpMinV)*holdT;
    var targetV=baseV*p.gravityDir;
    if(p.gravityDir>0)p.vy=Math.min(p.vy,targetV);
    else p.vy=Math.max(p.vy,targetV);
    p.jumpHold++;
  }
  if(!jump)p.jumpHold=0;
  if(jump&&!p.grounded&&p.canDoubleJump&&p.coyoteTimer<=0&&!p._prevJump){
    p.vy=jumpMinV*0.95*p.gravityDir;
    p.canDoubleJump=false;
    p.squashVY=-0.4;p.squashVX=-0.2;
  }
  p._prevJump=jump;
  p.vy+=FEEL.gravity*_gravityMul*p.gravityDir;
  if(p.onWall!==0&&p.vy*p.gravityDir>0)p.vy=Math.min(p.vy,0.6*p.gravityDir);
  if(p.onWall!==0&&p.grounded){p.wallJumpUsed=false;}
  if(p.onWall!==0&&p.wallJumpUsed&&p.vy*p.gravityDir>0){p.vy=Math.min(p.vy,0.3*p.gravityDir);}
  var _maxFall=mods.waterMode?Math.min(FEEL.maxFallSpeed,1.0):FEEL.maxFallSpeed;
  if(p.gravityDir>0)p.vy=Math.min(p.vy,_maxFall);
  else p.vy=Math.max(p.vy,-_maxFall);
  var steps=Math.max(1,Math.ceil(Math.max(Math.abs(p.vx),Math.abs(p.vy))/3));
  var stepVX=p.vx/steps,stepVY=p.vy/steps;
  var wasGrounded=p.grounded;
  p.grounded=false;p.onWall=0;
  for(var s=0;s<steps;s++){
    p.x+=stepVX;
    for(var i=0;i<solids.length;i++){
      var r=solids[i];
      if(!rectsOverlap(p,r))continue;
      var ol=(p.x+p.w)-r.x,or=(r.x+r.w)-p.x;
      if(ol<or){p.x=r.x-p.w;p.onWall=-1;}
      else{p.x=r.x+r.w;p.onWall=1;}
      p.vx=0;stepVX=0;
    }
    p.y+=stepVY;
    for(var i2=0;i2<solids.length;i2++){
      var r2=solids[i2];
      if(!rectsOverlap(p,r2))continue;
      var ot=(p.y+p.h)-r2.y,ob=(r2.y+r2.h)-p.y;
      if(ot<ob){
        p.y=r2.y-p.h;
        if(p.gravityDir>0){p.grounded=true;p.canDoubleJump=true;}
        p.vy=0;stepVY=0;
      }else{
        p.y=r2.y+r2.h;
        if(p.gravityDir<0){p.grounded=true;p.canDoubleJump=true;}
        p.vy=0;stepVY=0;
      }
    }
  }
  if(ghosts)for(var gi=0;gi<ghosts.length;gi++)collideGhost(p,ghosts[gi]);
  if(!p.grounded&&FEEL.edgeSnapDist>0){
    if(p.gravityDir>0&&p.vy>0){
      for(var es=0;es<solids.length;es++){
        var plat=solids[es];
        var pBottom=p.y+p.h;var platTop=plat.y;
        if(pBottom>platTop&&pBottom-platTop<FEEL.edgeSnapDist&&p.x+p.w>plat.x&&p.x<plat.x+plat.w){
          p.y=platTop-p.h;p.vy=0;p.grounded=true;p.canDoubleJump=true;break;
        }
      }
    }else if(p.gravityDir<0&&p.vy<0){
      for(var es2=0;es2<solids.length;es2++){
        var plat2=solids[es2];
        var platBot=plat2.y+plat2.h;
        if(p.y<platBot&&platBot-p.y<FEEL.edgeSnapDist&&p.x+p.w>plat2.x&&p.x<plat2.x+plat2.w){
          p.y=platBot;p.vy=0;p.grounded=true;p.canDoubleJump=true;break;
        }
      }
    }
  }
  var targetSX=1,targetSY=1;
  if(!p.grounded){
    var vertVel=p.vy*p.gravityDir;
    if(vertVel<-2){targetSX=0.68;targetSY=1.42;}
    else if(vertVel<-1){targetSX=0.78;targetSY=1.28;}
    else if(vertVel<-0.3){targetSX=0.88;targetSY=1.14;}
    else if(vertVel>4){targetSX=1.32;targetSY=0.72;}
    else if(vertVel>2.5){targetSX=1.2;targetSY=0.82;}
    else if(vertVel>1){targetSX=1.08;targetSY=0.94;}
    else{targetSX=0.96;targetSY=1.04;}
  }else if(Math.abs(p.vx)>FEEL.maxWalkSpeed*0.75){targetSX=1.32;targetSY=0.74;}
  else if(Math.abs(p.vx)>FEEL.maxWalkSpeed*0.4){targetSX=1.16;targetSY=0.88;}
  if(p.grounded){p.wallJumpUsed=false;}
  if(p.grounded&&!wasGrounded){
    var impact=Math.min(1,Math.abs(p.vy)/4);
    p.squashVY=0.6+impact*0.35;
    p.squashVX=0.4+impact*0.2;
  }
  p.wasGrounded=p.grounded;
  var springK=0.4,damping=0.7;
  p.squashVX+=(targetSX-p.squashX)*springK;p.squashVX*=damping;p.squashX+=p.squashVX;
  p.squashVY+=(targetSY-p.squashY)*springK;p.squashVY*=damping;p.squashY+=p.squashVY;
}
function collideGhost(p,g){
  var gr={x:g.x,y:g.y,w:8,h:8};
  if(!rectsOverlap(p,gr))return false;
  var towardGround=p.vy*p.gravityDir>=0;
  if(p.gravityDir>0){
    var overlapTop=(p.y+p.h)-gr.y;
    if(overlapTop>0&&overlapTop<12&&p.x+p.w>gr.x&&p.x<gr.x+gr.w){
      var hDist=Math.abs((p.x+p.w/2)-(gr.x+4));
      if(hDist<12&&(towardGround||overlapTop<6)){
        p.y=gr.y-p.h;p.vy=0;p.grounded=true;p.canDoubleJump=true;p.onGhost=g;
        return true;
      }
    }
  }else{
    var overlapBottom=(gr.y+gr.h)-p.y;
    if(overlapBottom>0&&overlapBottom<12&&p.x+p.w>gr.x&&p.x<gr.x+gr.w){
      var hDist2=Math.abs((p.x+p.w/2)-(gr.x+4));
      if(hDist2<12&&(towardGround||overlapBottom<6)){
        p.y=gr.y+gr.h;p.vy=0;p.grounded=true;p.canDoubleJump=true;p.onGhost=g;
        return true;
      }
    }
  }
  return false;
}
function compressTrajectory(traj){
  var out=[],stillCount=0;
  for(var i=0;i<traj.length;i++){
    var p=traj[i];
    if(i>0){
      var prev=traj[i-1];
      // 静止判定阈值从 1.5 收紧到 0.15：
      // 玩家踩在幽灵身上被缓慢带动时（每帧位移约 0.2~0.8px）
      // 之前会被 1.5 阈值误判为"静止"而把这段轨迹压缩丢弃，
      // 导致下次生成幽灵时缺失这一段，播放到缺口处就出现平滑瞬移。
      if(Math.abs(p.x-prev.x)<0.15&&Math.abs(p.y-prev.y)<0.15)stillCount++;
      else stillCount=0;
    }
    if(stillCount<120)out.push(p);
  }
  return out;
}
/* ============ 爆炸 ============ */
function triggerExplosion(x,y,source){
  AudioSystem.sfx("explosion",x,y);
  var radius=32;
  for(var i=0;i<24;i++){
    var a=Math.random()*Math.PI*2;var s=1.5+Math.random()*3;
    Play.particles.push(mkParticle(x,y,Math.cos(a)*s,Math.sin(a)*s-0.5,500+Math.random()*300,255,140+Math.random()*80,40));
  }
  for(var j=0;j<8;j++){
    var a2=Math.random()*Math.PI*2;var s2=0.8+Math.random()*2;
    Play.particles.push(mkParticle(x,y,Math.cos(a2)*s2,Math.sin(a2)*s2,300,255,255,220));
  }
  for(var k=0;k<16;k++){
    var ang=(k/16)*Math.PI*2;
    Play.particles.push(mkParticle(x,y,Math.cos(ang)*4,Math.sin(ang)*4,400,255,200,100));
  }
  Play.movables.forEach(function(m){
    var dx=(m.x+m.w/2)-x,dy=(m.y+m.h/2)-y;
    var d=Math.sqrt(dx*dx+dy*dy);
    if(d<radius){
      var force=(radius-d)/radius*8;
      var angle=Math.atan2(dy,dx);
      m.vx=(m.vx||0)+Math.cos(angle)*force;
      m.vy=(m.vy||0)+Math.sin(angle)*force*0.5-1;
    }
  });
  for(var bi=Play.breakables.length-1;bi>=0;bi--){
    var bk=Play.breakables[bi];
    var dx2=(bk.x+bk.w/2)-x,dy2=(bk.y+bk.h/2)-y;
    if(Math.sqrt(dx2*dx2+dy2*dy2)<radius){
      for(var p2=0;p2<8;p2++){
        var ang2=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(bk.x+bk.w/2,bk.y+bk.h/2,Math.cos(ang2)*1.5,Math.sin(ang2)*1.5-1,500,204,119,68));
      }
      Play.breakables.splice(bi,1);
    }
  }
  Play.flammables.forEach(function(f){
    var dx3=(f.x+f.w/2)-x,dy3=(f.y+f.h/2)-y;
    if(Math.sqrt(dx3*dx3+dy3*dy3)<radius){f.burning=(f.burnTime||1.5);f._igniteDelay=0;}
  });
  // 炸坏路灯
  if(Play.lamps)Play.lamps.forEach(function(l){
    if(l.broken)return;
    var lx=l.x+(l.w||8)/2;
    var ly=l.y+(l.h||32)*0.2;
    var dx4=lx-x,dy4=ly-y;
    if(Math.sqrt(dx4*dx4+dy4*dy4)<radius*1.2){
      l.broken=true;
      for(var pi=0;pi<8;pi++){
        var a4=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(lx,ly,Math.cos(a4)*1.2,Math.sin(a4)*1.2-0.4,600,200,180,120));
      }
      for(var pi2=0;pi2<5;pi2++){
        var a5=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(lx,ly,Math.cos(a5)*0.9,Math.sin(a5)*0.9,900,120,120,120));
      }
    }
  });

  if(source==='ghost'&&Play.player&&!Play.player.dead&&!Play.won){
    var pdx=(Play.player.x+Play.player.w/2)-x;
    var pdy=(Play.player.y+Play.player.h/2)-y;
    var pd=Math.sqrt(pdx*pdx+pdy*pdy);
    if(pd<radius){
      var force2=(radius-pd)/radius*7;
      var pangle=Math.atan2(pdy,pdx);
      Play.player.vx+=Math.cos(pangle)*force2;
      Play.player.vy+=Math.sin(pangle)*force2*0.6-2;
      Play.screenShake=6;
    }
  }
  if(source==='player')Play.screenShake=10;
}

/* ============ 幽灵 ============ */
function PlayGhost(trajectory,dieX,dieY,originId,hasExplosion){
  this.trajectory=trajectory.map(function(p){return{x:p.x,y:p.y};});
  this.progress=0;this.x=dieX;this.y=dieY;
  this.lastX=dieX;this.lastY=dieY;
  this.trail=[];for(var i=0;i<8;i++)this.trail.push({x:dieX,y:dieY});
  this.originId=originId||'default';
  this.hasExplosion=!!hasExplosion;
  this._pendingExplosion=false;
  this._explosionX=0;this._explosionY=0;
  this.released=false;
  if(this.trajectory.length>0){
    var lastP=this.trajectory[this.trajectory.length-1];
    this._explosionX=lastP.x;this._explosionY=lastP.y;
  }
}
PlayGhost.prototype.update=function(){
  this.lastX=this.x;this.lastY=this.y;
  if(!this.trajectory||this.trajectory.length<2){
    this.offScreen=false;
    this.fadeAlpha=1;
    return;
  }
  var baseSpeed=0.8;
  if(Play.keys['KeyJ']&&Play.energy>0){
    baseSpeed=0.2;
    Play.energy=Math.max(0,Play.energy-1/240);
  }else{
    Play.energy=Math.min(1,Play.energy+1/90);
  }
  // 离屏判定（沿用旧机制，只用于决定是否加速）
  var offScreen=false;
  if(Play.cam){
    var margin=120;
    var viewL=Play.cam.x-margin,viewR=Play.cam.x+Play.cam.viewW+margin;
    var viewT=Play.cam.y-margin,viewB=Play.cam.y+Play.cam.viewH+margin;
    if(this.x<viewL||this.x>viewR||this.y<viewT||this.y>viewB)offScreen=true;
  }
  if(this._speedMul===undefined)this._speedMul=1;
  if(offScreen){
    // 屏幕外：平滑加速到 3 倍（保留原机制）
    this._speedMul+=(3-this._speedMul)*0.08;
  }else{
    // 关键修复：一旦幽灵重新回到屏幕内，立即把加速余量清零，
    // 避免它在可见轨迹上继续以 2~3 倍速扫过（观感=平滑瞬移）
    this._speedMul=1;
  }
  var speed=baseSpeed*this._speedMul;
  this.progress+=speed;

  var L=this.trajectory.length-1;
  if(L<1){ this.offScreen=false; this.fadeAlpha=1; return; }
  // 防御性回绕：无论 progress 因加速溢出多少，最终都落在 [0, L)
  while(this.progress>=L){this.progress-=L;if(this.hasExplosion)this._pendingExplosion=true;}
  while(this.progress<0)this.progress+=L;
  if(this.progress>=L){
    this.progress-=L;
    if(this.hasExplosion)this._pendingExplosion=true;
  }

  var i=Math.floor(this.progress);var t=this.progress-i;
  if(i<0)i=0;
  if(i>=this.trajectory.length)i=this.trajectory.length-1;
  var p1=this.trajectory[i];var p2=this.trajectory[Math.min(i+1,this.trajectory.length-1)];
  this.x=p1.x+(p2.x-p1.x)*t;
  this.y=p1.y+(p2.y-p1.y)*t;
  this.trail.unshift({x:this.x,y:this.y});
  if(this.trail.length>8)this.trail.pop();
  this.offScreen=offScreen;

  // 轨迹首尾淡入/淡出，隐藏回绕瞬移（保留原逻辑）
  var fadeRange=Math.min(8,Math.floor(L/4));
  if(fadeRange<2)fadeRange=2;
  var a=1;
  if(this.progress<fadeRange)a=this.progress/fadeRange;
  else if(this.progress>L-fadeRange)a=(L-this.progress)/fadeRange;
  this.fadeAlpha=Math.max(0,Math.min(1,a));
};
PlayGhost.prototype.reset=function(){this.progress=0;};

/* ============ 相机 ============ */
function makeCamera(lv){
  var c=lv&&lv.camera?lv.camera:{};
  return{
    x:0,y:0,viewW:200,viewH:160,zoom:4,
    deadZoneXLeftRatio:c.deadZoneXLeft||0.30,
    deadZoneXRightRatio:c.deadZoneXRight||0.70,
    deadZoneYTopRatio:c.deadZoneYTop||0.32,
    deadZoneYBottomRatio:c.deadZoneYBottom||0.68,
    worldPadding:40,
    lerpX:0.18,lerpY:0.14,
    vertAirTriggerRatio:0.18,
    viewTargetW:c.viewW||300,
    viewTargetH:c.viewH||100
  };
}
function updateCameraView(cam,canvasEl){
  var rect=canvasEl.getBoundingClientRect();
  if(rect.width<1||rect.height<1)return;
  var cssW=rect.width,cssH=rect.height;
  var zoom=Math.max(cssW/cam.viewTargetW,cssH/cam.viewTargetH);
  cam.zoom=zoom;
  cam.viewW=cssW/zoom;cam.viewH=cssH/zoom;
}
function updateCamera(cam,player,worldBounds,camOffset){
  if(!cam||!player)return;
  var pCX=player.x+player.w/2;
  var pCY=player.y+player.h/2;
  var dLeft=cam.viewW*cam.deadZoneXLeftRatio;
  var dRight=cam.viewW*cam.deadZoneXRightRatio;
  var dTop=cam.viewH*cam.deadZoneYTopRatio;
  var dBottom=cam.viewH*cam.deadZoneYBottomRatio;
  var offsetX=pCX-cam.x,offsetY=pCY-cam.y;
  var targetX=cam.x,targetY=cam.y;
  if(offsetX<dLeft)targetX=pCX-dLeft;
  else if(offsetX>dRight)targetX=pCX-dRight;
  if(player.grounded){
    if(offsetY<dTop)targetY=pCY-dTop;
    else if(offsetY>dBottom)targetY=pCY-dBottom;
  }else{
    var airTop=cam.viewH*0.35,airBottom=cam.viewH*0.65;
    if(offsetY<airTop)targetY=pCY-airTop;
    else if(offsetY>airBottom)targetY=pCY-airBottom;
  }
  if(camOffset){targetX+=camOffset.x;targetY+=camOffset.y;}
  cam.x+=(targetX-cam.x)*cam.lerpX;
  cam.y+=(targetY-cam.y)*cam.lerpY;
  /* === 摄像机边界限制 ===
     视野边界（cam.x ~ cam.x + viewW）严格限制在 worldBounds 内。
     · 画布比视野窄 → 居中
     · 画布比视野宽 → 相机左边缘 >= minX，右边缘 <= maxX
     这里不再使用 worldPadding，让边界精确贴合画布最外层。 */
  if(worldBounds){
    var wW=worldBounds.maxX-worldBounds.minX;
    var wH=worldBounds.maxY-worldBounds.minY;
    if(wW<=cam.viewW)cam.x=(worldBounds.minX+worldBounds.maxX)/2-cam.viewW/2;
    else cam.x=Math.max(worldBounds.minX,Math.min(worldBounds.maxX-cam.viewW,cam.x));
    if(wH<=cam.viewH)cam.y=(worldBounds.minY+worldBounds.maxY)/2-cam.viewH/2;
    else cam.y=Math.max(worldBounds.minY,Math.min(worldBounds.maxY-cam.viewH,cam.y));
  }
}

/* ============ 试玩 ============ */
var Play={
  active:false,player:null,keys:{},raf:null,lastTime:0,
  spawnX:10,spawnY:70,won:false,wonTimer:0,
  platforms:[],disappearPlats:[],spikes:[],fallingSpikes:[],
  lasers:[],doors:[],plates:[],movables:[],breakables:[],flammables:[],
  goals:[],hearts:[],flagPickups:[],gravityZones:[],labels:[],backgrounds:[],lamps:[],vines:[],iceBlocks:[],
  trophies:[],switches:[],switchDoors:[],waters:[],smokes:[],waterGrasses:[],
  waterBubbleTimer:10,waterBubbleMax:10,_inWater:false,_smokeCanvas:null,
  worldBounds:null,cam:null,deathCount:0,
  trajectory:[],dashTrajectory:[],ghosts:[],particles:[],
  currentRespawnOrigin:'default',currentFlag:null,flagsCollected:0,
  placedFlags:[], /* === flag/ghost v2 === */
  lives:3,maxLives:3,
  camOffset:{x:0,y:0},freeLookTimer:0,dragStart:null,
  energy:1,screenShake:0,_flagGhostsCleared:false,
  _dyingBySuicide:false,_flagKeyHeld:false,
  deathAnim:null,
  showGrid:false
};

function startPlay(){
  var lv=LevelContext.levels[LevelContext.currentIdx];if(!lv)return;
  ['platforms','disappearPlats','spikes','fallingSpikes','lasers','doors','plates',
   'movables','breakables','flammables','iceBlocks','goals','hearts','flagPickups','gravityZones','labels','backgrounds','lamps','vines',
   'trophies','switches','switchDoors','waters','smokes','waterGrasses'
  ].forEach(function(k){Play[k]=[];});
  Play.ghosts=[];Play.particles=[];Play.trajectory=[];Play.dashTrajectory=[];
  Play.deathCount=0;Play.won=false;
  Play.currentRespawnOrigin='default';Play.currentFlag=null;Play.placedFlags=[];
  Play.flagsCollected=lv.initialFlags||0;
  Play.lives=lv.initialLives||3;Play.maxLives=Play.lives;
  Play.energy=1;
  Play.camOffset={x:0,y:0};Play.freeLookTimer=0;Play.dragStart=null;
  Play.screenShake=0;Play._dyingBySuicide=false;Play._flagKeyHeld=false;
  Play.deathAnim=null;
  Play.keys={};
  lv.elements.forEach(function(el){
    if(el.type==='bg')return;
    var c=JSON.parse(JSON.stringify(el));
    switch(c.type){
      case 'platform':Play.platforms.push(c);break;
      case 'disappear':Play.disappearPlats.push(c);break;
      case 'spike':Play.spikes.push(c);break;
      case 'fallingSpike':c._t=false;c._f=false;c._tm=0;Play.fallingSpikes.push(c);break;
      case 'laserRight':case 'laserLeft':case 'laserUp':case 'laserDown':Play.lasers.push(c);break;
      case 'door':c.open=false;c._openProgress=0;Play.doors.push(c);break;
      case 'plate':c.active=false;c._w=0;Play.plates.push(c);break;
      case 'movable':c.vx=0;c.vy=0;Play.movables.push(c);break;
      case 'breakable':Play.breakables.push(c);break;
      case 'flammable':c.burning=0;c._igniteDelay=0;Play.flammables.push(c);break;
      case 'goal':Play.goals.push(c);break;
      case 'heart':Play.hearts.push(c);break;
      case 'flagPickup':Play.flagPickups.push(c);break;
      case 'gravityFlip':Play.gravityZones.push(c);break;
      case 'label':c._vis=0;Play.labels.push(c);break;
      case 'lamp':c.broken=false;Play.lamps.push(c);break;
      case 'vine':c.sway=0;c.swayV=0;Play.vines.push(c);break;
      case 'ice':c._melt=-1;Play.iceBlocks.push(c);break;
      case 'trophy':
        if(!c.id)c.id='trophy_legacy_'+Math.round(c.x)+'_'+Math.round(c.y);
        if(!TrophyStore.has(c.id))Play.trophies.push(c);
        break;
      case 'switch':c._pressed=false;c.on=false;Play.switches.push(c);break;
      case 'switchDoor':c.open=!!c.initialOpen;c._openProgress=c.open?1:0;Play.switchDoors.push(c);break;
      case 'water':Play.waters.push(c);break;
      case 'smoke':Play.smokes.push(c);break;
      case 'waterGrass':c.sway=0;c.swayV=0;Play.waterGrasses.push(c);break;
    }
  });
  // 复制背景层数据
  Play.backgrounds=(lv.backgrounds||[]).map(function(bg){return JSON.parse(JSON.stringify(bg));});
  /* === 摄像机边界 = 所有箱庭的最外包围盒（不含元素） ===
       玩家无论跑到哪里，摄像机都不会超出这个范围。 */
  (function(){
    var _minX=Infinity, _minY=Infinity, _maxX=-Infinity, _maxY=-Infinity;
    (lv.chambers||[]).forEach(function(c){
      if(c.x<_minX)_minX=c.x;
      if(c.y<_minY)_minY=c.y;
      if(c.x+c.w>_maxX)_maxX=c.x+c.w;
      if(c.y+c.h>_maxY)_maxY=c.y+c.h;
    });
    if(!isFinite(_minX)){_minX=0;_minY=0;_maxX=200;_maxY=88;}
    Play.worldBounds={minX:_minX,minY:_minY,maxX:_maxX,maxY:_maxY};
  })();
  var sp=lv.elements.filter(function(e){return e.type==='spawn';})[0];
  Play.spawnX=sp?sp.x:Play.worldBounds.minX+20;
  Play.spawnY=sp?sp.y:Play.worldBounds.minY+20;
  respawnPlay('default');
  D.playScreen.classList.add('active');
  Play.active=true;
  document.getElementById('playInfo').textContent='关卡: '+lv.name;
  resizePlayCanvas();
  Play.cam=makeCamera(lv);
  updateCameraView(Play.cam,D.playCanvas);
  Play.cam.x=Play.player.x+Play.player.w/2-Play.cam.viewW/2;
  Play.cam.y=Play.player.y+Play.player.h/2-Play.cam.viewH/2;
  Play.lastTime=performance.now();
  if(Play.raf)cancelAnimationFrame(Play.raf);
  Play.raf=null;
  if(IS_MOBILE)D.playControls.classList.add('active');
  else D.playControls.classList.remove('active');
  // Input and camera drag are bound by the game shell.
}
function getRespawnPos(){
  /* === flag/ghost v4 ===
     同样只看 currentFlag，不看 currentRespawnOrigin。 */
  if(Play.currentFlag){
    return {x:Play.currentFlag.x, y:Play.currentFlag.y};
  }
  return {x:Play.spawnX, y:Play.spawnY};
}
function respawnPlay(originId){
  /* === flag/ghost v4 ===
     关键修复：不再用 originId 字符串判断，避免因某次时序问题把
     Play.currentRespawnOrigin 悄悄改成 'default' 后就永久失效。
     直接以 Play.currentFlag 是否存在为唯一真相源：
       有旗子 → 从旗子位置重生
       无旗子 → 从初始出生点重生 */
  var rp;
  if(Play.currentFlag){rp=Play.currentFlag;originId='flag';}
  else{rp={x:Play.spawnX,y:Play.spawnY};originId='default';}
  Play.player={
    x:rp.x,y:rp.y-8,w:8,h:8,vx:0,vy:0,
    grounded:false,onWall:0,canDoubleJump:true,gravityDir:1,
    squashX:1,squashY:1,squashVX:0,squashVY:0,wasGrounded:false,
    jumpHold:0,bufferTimer:0,coyoteTimer:0,wallJumpUsed:false,
    _prevJump:false,onGhost:null,dead:false
  };
  Play.currentRespawnOrigin=originId;
}
function resizePlayCanvas(){
  var c=D.playCanvas,wrap=D.playCanvasWrap;
  if(!c||!wrap)return;
  var rect=wrap.getBoundingClientRect();
  if(rect.width<1||rect.height<1)return;
  c.width=Math.floor(rect.width*dpr);
  c.height=Math.floor(rect.height*dpr);
  c.style.width=rect.width+'px';
  c.style.height=rect.height+'px';
  if(Play.cam)updateCameraView(Play.cam,c);
}
function playLoop(t){
  if(!Play.active)return;
  var dt=Math.min(100,t-Play.lastTime)/1000;
  Play.lastTime=t;
  updatePlay(dt);
  renderPlay();
  Play.raf=null;
}
function updateParticlesOnly(dt){
  for(var pi3=Play.particles.length-1;pi3>=0;pi3--){
    var pt=Play.particles[pi3];
    pt.x+=pt.vx;pt.y+=pt.vy;
    pt.vy+=0.08;
    pt.vx*=0.96;pt.vy*=0.96;
    pt.life-=dt*1000;
    if(pt.life<=0)Play.particles.splice(pi3,1);
  }
}
function updateMovables(dt){
  Play.movables.forEach(function(m){
    m.vy=(m.vy||0)+FEEL.gravity;
    if(m.vy>FEEL.maxFallSpeed)m.vy=FEEL.maxFallSpeed;
    m.y+=m.vy;m.x+=m.vx||0;
    m.vx=(m.vx||0)*0.85;
    var mObs=[];
    Play.platforms.forEach(function(pp){mObs.push(pp);});
    Play.disappearPlats.forEach(function(dd){if(isDisappearVisible(dd))mObs.push(dd);});
    Play.doors.forEach(function(dd){if(!_doorPassable(dd))mObs.push(dd);});
    Play.switchDoors.forEach(function(dd){if(!_doorPassable(dd))mObs.push(dd);});
    Play.movables.forEach(function(mm){if(mm!==m)mObs.push(mm);});
    Play.breakables.forEach(function(bb){mObs.push(bb);});
    Play.flammables.forEach(function(ff){if(ff.burning<=0)mObs.push(ff);});
    Play.iceBlocks.forEach(function(ib){mObs.push(ib);});
    for(var k=0;k<mObs.length;k++){
      var pl2=mObs[k];
      if(rectsOverlap(m,pl2)){
        var mol=(m.x+m.w)-pl2.x,mor=(pl2.x+pl2.w)-m.x;
        var mot=(m.y+m.h)-pl2.y,mob=(pl2.y+pl2.h)-m.y;
        var mnx=Math.min(mol,mor),mny=Math.min(mot,mob);
        if(mny<mnx){
          if(mot<mob){m.y=pl2.y-m.h;m.vy=0;}
          else{m.y=pl2.y+pl2.h;m.vy=0;}
        }else{
          if(mol<mor)m.x=pl2.x-m.w;
          else m.x=pl2.x+pl2.w;
          m.vx=0;
        }
      }
    }
  });
}
function updateFlammables(dt){
  // 1) 相邻引燃：燃烧中的方块引燃紧挨着的未燃烧易燃方块，延迟 0.5s
  for(var a=0;a<Play.flammables.length;a++){
    var fa=Play.flammables[a];
    if(fa.burning<=0)continue;
    for(var b=0;b<Play.flammables.length;b++){
      if(a===b)continue;
      var fb=Play.flammables[b];
      if(fb.burning>0)continue;
      if(fb._igniteDelay>0)continue;
      var eps=1.5;
      var faR=fa.x+fa.w, fbR=fb.x+fb.w;
      var yOverlap=(fa.y<fb.y+fb.h-0.1)&&(fa.y+fa.h>fb.y+0.1);
      var xOverlap=(fa.x<fbR-0.1)&&(faR>fb.x+0.1);
      var adjacent=false;
      if(yOverlap && (Math.abs(fa.x-fbR)<eps || Math.abs(fb.x-faR)<eps))adjacent=true;
      if(xOverlap && (Math.abs(fa.y-(fb.y+fb.h))<eps || Math.abs(fb.y-(fa.y+fa.h))<eps))adjacent=true;
      if(adjacent){fb._igniteDelay=0.5;}
    }
  }
  // 2) 延迟引燃倒计时
  for(var ii=0;ii<Play.flammables.length;ii++){
    var fi=Play.flammables[ii];
    if(fi._igniteDelay>0 && fi.burning<=0){
      fi._igniteDelay-=dt;
      if(fi._igniteDelay<=0){
        fi._igniteDelay=0;
        fi.burning=(fi.burnTime||1.5);
      }
    }
  }
  // 3) 燃烧处理
  for(var fi2=Play.flammables.length-1;fi2>=0;fi2--){
    var f2=Play.flammables[fi2];
    if(f2.burning>0){
      f2.burning-=dt;
      if(Math.random()<0.6){
        var fx=f2.x+Math.random()*f2.w;
        var fy=f2.y+Math.random()*f2.h;
        Play.particles.push(mkParticle(fx,fy,(Math.random()-0.5)*0.5,-0.8-Math.random()*0.5,400+Math.random()*200,255,100+Math.random()*100,30));
      }
      if(Math.random()<0.25){
        var fx2=f2.x+Math.random()*f2.w;
        var fy2=f2.y-2;
        Play.particles.push(mkParticle(fx2,fy2,(Math.random()-0.5)*0.3,-0.4,700,80,80,80));
      }
      if(f2.burning<=0){
        for(var ashI=0;ashI<12;ashI++){
          var ax=f2.x+Math.random()*f2.w;
          var ay=f2.y+Math.random()*f2.h;
          Play.particles.push(mkParticle(ax,ay,(Math.random()-0.5)*0.8,-0.2-Math.random()*0.6,900,120,120,120));
        }
        Play.flammables.splice(fi2,1);
      }
    }
  }
}
function updateVines(dt){
  if(!Play.vines||!Play.vines.length)return;
  var p=Play.player;
  if(!p||p.dead)return;
  var pvx=p.vx||0;
  var px=p.x+p.w/2;
  var py=p.y+p.h/2;
  for(var i=0;i<Play.vines.length;i++){
    var v=Play.vines[i];
    var cx=v.x+(v.w||3)/2;
    var topY=v.y;
    var top = topY + (v.h||40)*0.35;
    var dx = px - cx;
    var dy = py - top;
    var dist = Math.sqrt(dx*dx + dy*dy);
    // 快速掠过时的强冲量
    if (dist < 40 && Math.abs(pvx) > 0.8) {
      var impulse = Math.sign(pvx) * Math.min(0.35, Math.abs(pvx) * 0.18);
      var nearFactor = 1 - Math.min(1, Math.abs(dy) / 30);
      if (Math.abs(dx) < 24) {
        v.swayV += impulse * nearFactor;
      }
    }
    // 强弹簧 + 适度阻尼
    v.swayV += -v.sway * 0.20;
    v.swayV *= 0.92;
    v.sway = (v.sway||0) + v.swayV;
    if (Math.abs(v.sway) < 0.002 && Math.abs(v.swayV) < 0.002) {
      v.sway = 0;
      v.swayV = 0;
    }
  }
}
function _ensureWaterGrassNodes(wg){
  var segs=Math.max(4,Math.min(16,wg.segments||12));
  var h=wg.h||16;
  var needRebuild=!wg._nodes||wg._initX!==wg.x||wg._initY!==wg.y||wg._initH!==h||wg._initSegs!==segs;
  if(!needRebuild)return;
  var segH=h/segs;
  var cx=wg.x+(wg.w||8)/2;
  var baseY=wg.y+h;
  var nodes=[];
  // i=0 是根部（底部），i=segs 是顶端（顶部）
  for(var i=0;i<=segs;i++){
    var yy=baseY-segH*i;
    nodes.push({x:cx,y:yy,px:cx,py:yy});
  }
  wg._nodes=nodes;
  wg._segLen=segH;
  wg._initX=wg.x;wg._initY=wg.y;wg._initH=h;wg._initSegs=segs;
}
function _waterGrassImpulse(nodes,srcX,srcY,srcVX,weight,stepScale){
  if(Math.abs(srcVX)<0.05)return;
  for(var j=1;j<nodes.length;j++){
    var n=nodes[j];
    var dx=n.x-srcX, dy=n.y-srcY;
    var d2=dx*dx+dy*dy;
    if(d2<1225){ // 35px 内
      var d=Math.sqrt(d2);
      var force=(35-d)/35;
      var frac=j/(nodes.length-1);
      n.px-=srcVX*force*frac*weight*stepScale;
    }
  }
}
function updateWaterGrass(dt){
  if(!Play.waterGrasses||!Play.waterGrasses.length)return;
  var p=Play.player;
  var now2=Date.now()/1000;
  var stepScale=Math.min(dt*60,2);
  for(var i=0;i<Play.waterGrasses.length;i++){
    var wg=Play.waterGrasses[i];
    _ensureWaterGrassNodes(wg);
    var nodes=wg._nodes;
    var segLen=wg._segLen;
    var baseX=wg.x+(wg.w||8)/2;
    var baseY=wg.y+(wg.h||16);
    var segs=nodes.length-1;

    // === Verlet 积分（与丝带同一套物理思路） ===
    // 阻尼系数偏轻，让回正过程缓慢、丝滑
    var damp=Math.pow(0.987,stepScale);
    for(var j=1;j<nodes.length;j++){
      var n=nodes[j];
      var vx=(n.x-n.px)*damp;
      var vy=(n.y-n.py)*damp;
      n.px=n.x; n.py=n.y;
      n.x+=vx;
      n.y+=vy;
      // 水中软回正：每个节点轻微朝"直立静止位置"靠近
      // 顶端回正更弱，越靠近根部回正越强
      var restX=baseX;
      var restY=baseY-segLen*j;
      var k=0.030*stepScale*(0.35+0.65*(1-j/segs));
      n.x+=(restX-n.x)*k;
      n.y+=(restY-n.y)*k;
      // 水流自然微摆（待机 1~2px 幅度）
      var drift=Math.sin(now2*0.55+j*0.42+wg.x*0.17+wg.y*0.13)*0.030*(j/segs);
      n.x+=drift*stepScale;
    }

    // === 玩家经过时施加冲量（与丝带同样的方式） ===
    if(p&&!p.dead){
      _waterGrassImpulse(nodes, p.x+p.w/2, p.y+p.h/2, p.vx||0, 0.85, stepScale);
    }

    // === 约束迭代：根部固定，整株按段长约束保持连贯 ===
    for(var iter=0;iter<6;iter++){
      nodes[0].x=baseX; nodes[0].y=baseY;
      nodes[0].px=baseX; nodes[0].py=baseY;
      for(var k2=1;k2<nodes.length;k2++){
        var a=nodes[k2-1], b=nodes[k2];
        var ddx=b.x-a.x, ddy=b.y-a.y;
        var dist=Math.sqrt(ddx*ddx+ddy*ddy);
        if(dist<0.001)continue;
        var diff=(dist-segLen)/dist;
        if(k2===1){
          b.x-=ddx*diff;
          b.y-=ddy*diff;
        }else{
          a.x+=ddx*diff*0.5;
          a.y+=ddy*diff*0.5;
          b.x-=ddx*diff*0.5;
          b.y-=ddy*diff*0.5;
        }
      }
    }
  }
}
function updateIce(dt){
  if(!Play.iceBlocks||!Play.iceBlocks.length)return;
  for(var im=Play.iceBlocks.length-1;im>=0;im--){
    var ib=Play.iceBlocks[im];
    if(ib._melt===undefined)ib._melt=-1;
    var adjacentBurning=false;
    for(var fi=0;fi<Play.flammables.length;fi++){
      var f=Play.flammables[fi];
      if(f.burning<=0)continue;
      var eps=2;
      var ibR=ib.x+ib.w, ibB=ib.y+ib.h;
      var fR=f.x+f.w, fB=f.y+f.h;
      var yOverlap=(ib.y<fB-0.1)&&(ibB>f.y+0.1);
      var xOverlap=(ib.x<fR-0.1)&&(ibR>f.x+0.1);
      var adj=false;
      if(yOverlap && (Math.abs(ib.x-fR)<eps || Math.abs(f.x-ibR)<eps))adj=true;
      if(xOverlap && (Math.abs(ib.y-fB)<eps || Math.abs(f.y-ibB)<eps))adj=true;
      if(adj){adjacentBurning=true;break;}
    }
    if(adjacentBurning){
      if(ib._melt<0)ib._melt=0.6;
      ib._melt-=dt;
      if(ib._melt<=0){
        for(var pk=0;pk<8;pk++){
          var a=Math.random()*Math.PI*2;
          Play.particles.push(mkParticle(ib.x+ib.w/2,ib.y+ib.h/2,Math.cos(a)*1.0,Math.sin(a)*1.0-0.3,600,120,200,255));
        }
        Play.iceBlocks.splice(im,1);
      }
    } else {
      ib._melt=-1;
    }
  }
}
function _doorPassable(d){
  if(!d)return true;
  var p=(d._openProgress!==undefined)?d._openProgress:(d.open?1:0);
  return p>0.5;
}
function _getDoorOrientation(d){
  if(d.orientation==='h'||d.orientation==='v')return d.orientation;
  return (d.w>d.h)?'h':'v';
}

/* ============ 辅助：HSV  RGB（用于镭射色相） ============ */
function _hsv2rgb(h, s, v){
  h = h - Math.floor(h);
  var i = Math.floor(h * 6);
  var f = h * 6 - i;
  var p = v * (1 - s);
  var q = v * (1 - f * s);
  var t = v * (1 - (1 - f) * s);
  switch(i % 6){
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
  }
  return [v, v, v];
}

/* ============ 反重力区域 shader（镭射质感） ============ */
var _gravZoneCacheMap = new WeakMap();

function drawGravityZoneShader(g, el, time){
  var x = el.x, y = el.y;
  var w = Math.round(el.w || 64);
  var h = Math.round(el.h || 48);
  if (w < 2 || h < 2) return;

  var maxDim = 96;
  var sc = Math.min(1, maxDim / Math.max(w, h));
  var imgW = Math.max(8, Math.round(w * sc));
  var imgH = Math.max(8, Math.round(h * sc));

  var cache = _gravZoneCacheMap.get(el);
  if (!cache) {
    cache = { canvas:null, ctx:null, imgData:null, lastKey:'', lastUpdate:0 };
    _gravZoneCacheMap.set(el, cache);
  }

  var key = imgW + 'x' + imgH;
  var nowMs = performance.now();
  var needUpdate = (key !== cache.lastKey) || (nowMs - cache.lastUpdate > 66);

  if (needUpdate) {
    if (!cache.canvas || cache.canvas.width !== imgW || cache.canvas.height !== imgH) {
      cache.canvas = document.createElement('canvas');
      cache.canvas.width = imgW;
      cache.canvas.height = imgH;
      cache.ctx = cache.canvas.getContext('2d');
      cache.imgData = cache.ctx.createImageData(imgW, imgH);
    }
    var d = cache.imgData.data;
    var t = time;
    var idx = 0;
    for (var py = 0; py < imgH; py++) {
      var vy = py / imgH;
      for (var px = 0; px < imgW; px++) {
        var vx = px / imgW;
        var u1 = vx * 3.2, v1 = vy * 3.2;
        var n1 = _jsFbm(u1 + t*0.35, v1 + t*0.22);
        var n2 = _jsFbm(u1*1.8 - t*0.42, v1*1.8 + t*0.31);
        var n3 = _jsFbm(u1*0.55 + t*0.18, v1*0.55 - t*0.25);
        var n = n1*0.5 + n2*0.3 + n3*0.2;
        var hue = n*0.55 + vx*0.18 + vy*0.10 + t*0.08;
        var rgb = _hsv2rgb(hue, 0.58, 0.95);
        var scan = 0.5 + 0.5 * Math.sin(vy * Math.PI * 2 * 22 + t * 6);
        var scanMul = 0.78 + scan * 0.22;
        var ex = Math.min(vx, 1-vx) * 2;
        var ey = Math.min(vy, 1-vy) * 2;
        var edge = Math.min(ex, ey);
        var edgeFade = edge < 0.08 ? edge/0.08 : 1;
        var ddx = vx - 0.5, ddy = vy - 0.5;
        var dr = Math.sqrt(ddx*ddx + ddy*ddy) * 2;
        var ring = 1 - Math.abs(dr - 0.62) * 3.2;
        if (ring < 0) ring = 0;
        var bright = 0.55 + ring * 0.6 + n * 0.25;
        var alpha = edgeFade * (0.28 + n * 0.22);
        d[idx]   = Math.min(255, Math.round(rgb[0] * bright * scanMul * 255));
        d[idx+1] = Math.min(255, Math.round(rgb[1] * bright * scanMul * 255));
        d[idx+2] = Math.min(255, Math.round(rgb[2] * bright * scanMul * 255));
        d[idx+3] = Math.round(alpha * 255);
        idx += 4;
      }
    }
    cache.ctx.putImageData(cache.imgData, 0, 0);
    cache.lastKey = key;
    cache.lastUpdate = nowMs;
  }

  g.save();
  g.imageSmoothingEnabled = true;
  g.drawImage(cache.canvas, x, y, w, h);
  g.restore();
}

/* ============ 终点传送门 shader（紫色漩涡） ============ */
var _goalCacheMap = new WeakMap();

function drawGoalPortalShader(g, el, time){
  var cx = el.x + (el.w || 8) / 2;
  var cy = el.y + (el.h || 8) / 2;
  /* === 终点按框尺寸 v2 === */
  var cw = Math.max(8, el.w || 8);
  var ch = Math.max(8, el.h || 8);

  var maxDim = 96;
  var sc = Math.min(1, maxDim / Math.max(cw, ch));
  var imgW = Math.max(16, Math.round(cw * sc));
  var imgH = Math.max(20, Math.round(ch * sc));

  var cache = _goalCacheMap.get(el);
  if (!cache) {
    cache = { canvas:null, ctx:null, imgData:null, lastKey:'', lastUpdate:0 };
    _goalCacheMap.set(el, cache);
  }

  var key = imgW + 'x' + imgH;
  var nowMs = performance.now();
  var needUpdate = (key !== cache.lastKey) || (nowMs - cache.lastUpdate > 50);

  if (needUpdate) {
    if (!cache.canvas || cache.canvas.width !== imgW || cache.canvas.height !== imgH) {
      cache.canvas = document.createElement('canvas');
      cache.canvas.width = imgW;
      cache.canvas.height = imgH;
      cache.ctx = cache.canvas.getContext('2d');
      cache.imgData = cache.ctx.createImageData(imgW, imgH);
    }
    var d = cache.imgData.data;
    var t = time;
    var idx = 0;
    var halfW = imgW / 2;
    var halfH = imgH / 2;
    for (var py = 0; py < imgH; py++) {
      var v = (py - halfH) / halfH;
      for (var px = 0; px < imgW; px++) {
        var u = (px - halfW) / halfW;
        var r2 = u*u + v*v;
        if (r2 > 1.0) { d[idx+3] = 0; idx += 4; continue; }
        var r = Math.sqrt(r2);
        var a = Math.atan2(v, u);
        var spiral1 = Math.sin(a * 3 + Math.log(r + 0.06) * 3.5 - t * 3.2);
        var spiral2 = Math.sin(a * 5 - Math.log(r + 0.06) * 5.0 - t * 4.8);
        var sVal = (spiral1 * 0.6 + spiral2 * 0.4 + 1) * 0.5;
        var edgeFade;
        if (r > 0.94) edgeFade = (1 - (r - 0.94) / 0.06);
        else if (r < 0.08) edgeFade = r / 0.08;
        else edgeFade = 1;
        var core = r < 0.22 ? (1 - r / 0.22) : 0;
        var pr = 0.60, pg = 0.28, pb = 0.95;
        var qr = 0.95, qg = 0.72, qb = 1.00;
        var cr = pr + (qr - pr) * sVal;
        var cg = pg + (qg - pg) * sVal;
        var cb = pb + (qb - pb) * sVal;
        if (r > 0.78 && r < 0.96) {
          var rimBoost = 1 - Math.abs(r - 0.87) / 0.09;
          if (rimBoost > 0) {
            cr = cr * (1 + rimBoost * 0.8);
            cg = cg * (1 + rimBoost * 0.9);
            cb = cb * (1 + rimBoost * 1.0);
          }
        }
        var bright = 0.65 + sVal * 0.55;
        cr = Math.min(1, cr * bright);
        cg = Math.min(1, cg * bright);
        cb = Math.min(1, cb * bright);
        cr = cr * (1 - core * 0.88);
        cg = cg * (1 - core * 0.88);
        cb = cb * (1 - core * 0.88);
        var alpha = edgeFade * (0.70 + sVal * 0.30);
        if (r < 0.10) alpha *= 0.5;
        d[idx]   = Math.round(cr * 255);
        d[idx+1] = Math.round(cg * 255);
        d[idx+2] = Math.round(cb * 255);
        d[idx+3] = Math.round(alpha * 255);
        idx += 4;
      }
    }
    cache.ctx.putImageData(cache.imgData, 0, 0);
    cache.lastKey = key;
    cache.lastUpdate = nowMs;
  }

  g.save();
  g.imageSmoothingEnabled = true;
  g.drawImage(cache.canvas, cx - cw/2, cy - ch/2, cw, ch);
  g.restore();
}

function computeLaserRay(laser){
  var sx=laser.x+3,sy=laser.y+3;
  var dx=0,dy=0;
  if(laser.type==='laserRight')dx=1;
  else if(laser.type==='laserLeft')dx=-1;
  else if(laser.type==='laserUp')dy=-1;
  else if(laser.type==='laserDown')dy=1;
  var objs=[];
  Play.platforms.forEach(function(p){objs.push(p);});
  Play.movables.forEach(function(m){objs.push(m);});
  Play.breakables.forEach(function(b){objs.push(b);});
  Play.flammables.forEach(function(f){if(f.burning<=0)objs.push(f);});
  Play.doors.forEach(function(d){if(!_doorPassable(d))objs.push(d);});
  Play.switchDoors.forEach(function(d){if(!_doorPassable(d))objs.push(d);});
  Play.disappearPlats.forEach(function(d){if(isDisappearVisible(d))objs.push(d);});
  var ex=sx,ey=sy;var maxSteps=4000;var blocked=false;
  for(var step=0;step<maxSteps;step++){
    ex+=dx;ey+=dy;
    if(ex<Play.worldBounds.minX-50||ex>Play.worldBounds.maxX+50||
       ey<Play.worldBounds.minY-50||ey>Play.worldBounds.maxY+50){blocked=true;break;}
    var testPt={x:ex-1.5,y:ey-1.5,w:3,h:3};
    var hit=false;
    for(var i=0;i<objs.length;i++){
      if(rectsOverlap(testPt,objs[i])){hit=true;break;}
    }
    if(hit){blocked=true;break;}
  }
  return{startX:sx,startY:sy,endX:ex,endY:ey,hit:blocked};
}
function spawnLaserSpark(x,y,dx,dy){
  var backDX=-dx,backDY=-dy;
  for(var si=0;si<3;si++){
    var angle=Math.atan2(backDY,backDX)+(Math.random()-0.5)*1.8;
    var spd=1.5+Math.random()*2.5;
    Play.particles.push(mkParticle(x,y,Math.cos(angle)*spd,Math.sin(angle)*spd,200+Math.random()*200,255,200+Math.random()*55,80+Math.random()*120));
  }
  if(Math.random()<0.4)Play.particles.push(mkParticle(x,y,0,0,80,255,255,220));
}
function updatePlay(dt){
  updateParticlesOnly(dt);
  // 门开合动画进度（0→1）
  var _doorRate = 10;
  Play.doors.forEach(function(d){
    if(d._openProgress===undefined)d._openProgress=d.open?1:0;
    var t=d.open?1:0;
    d._openProgress+=(t-d._openProgress)*Math.min(1,dt*_doorRate);
    if(Math.abs(d._openProgress-t)<0.01)d._openProgress=t;
  });
  Play.switchDoors.forEach(function(d){
    if(d._openProgress===undefined)d._openProgress=d.open?1:0;
    var t=d.open?1:0;
    d._openProgress+=(t-d._openProgress)*Math.min(1,dt*_doorRate);
    if(Math.abs(d._openProgress-t)<0.01)d._openProgress=t;
  });
  // 死亡动画期间也要推进可移动方块和易燃方块，让爆炸推力/点燃效果立刻生效
  updateMovables(dt);
  updateFlammables(dt);
  updateIce(dt);
  updateVines(dt);

  if(Play.deathAnim&&Play.deathAnim.active){
    updateDeathAnim(dt);
    return;
  }

  if(Play.won){
    updateParticlesOnly(dt);
    return;
  }
  var p=Play.player;if(!p||p.dead)return;
  var keys=Play.keys;
  var allSolids=Play.platforms.slice();
  Play.disappearPlats.forEach(function(d){if(isDisappearVisible(d))allSolids.push(d);});
  Play.doors.forEach(function(d){if(!_doorPassable(d))allSolids.push(d);});
  Play.switchDoors.forEach(function(d){if(!_doorPassable(d))allSolids.push(d);});
  Play.movables.forEach(function(m){allSolids.push(m);});
  Play.breakables.forEach(function(b){allSolids.push(b);});
  Play.flammables.forEach(function(f){if(f.burning<=0)allSolids.push(f);});
  Play.iceBlocks.forEach(function(ib){allSolids.push(ib);});
  p.onGhost=null;
  // 站在冰上：速度 ×1.5、惯性 ×1.5
  var _onIce=false;
  var _feetY=p.y+p.h;
  for(var _ii=0;_ii<Play.iceBlocks.length;_ii++){
    var _ib=Play.iceBlocks[_ii];
    if(p.x+p.w>_ib.x&&p.x<_ib.x+_ib.w&&Math.abs(_feetY-_ib.y)<3&&p.vy>=0){
      _onIce=true;break;
    }
  }
  // ---- 水域检测 ----
  var _inWater=false;
  for(var _wi=0;_wi<Play.waters.length;_wi++){
    var _wtr=Play.waters[_wi];
    if(p.x+p.w>_wtr.x&&p.x<_wtr.x+_wtr.w&&p.y+p.h>_wtr.y&&p.y<_wtr.y+_wtr.h){_inWater=true;break;}
  }
  Play._inWater=_inWater;
  var _physMods=null;
  if(_inWater){_physMods={speedMul:0.30,inertiaMul:1.8,gravityMul:0.08,waterMode:true};}
  else if(_onIce){_physMods={speedMul:1.5,inertiaMul:5};}
  stepPlayerPhysics(p,keys,dt,allSolids,Play.ghosts,_physMods);
  // ---- 水中气泡窒息计时 ----
  if(_inWater){
    Play.waterBubbleTimer-=dt;
    if(Play.waterBubbleTimer<=0){
      Play.waterBubbleTimer=Play.waterBubbleMax;
      for(var _wp=0;_wp<24;_wp++){
        var _wa=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(p.x+4,p.y+4,Math.cos(_wa)*2,Math.sin(_wa)*2-0.8,900,120,200,255));
      }
      diePlay();return;
    }
  }else{
    Play.waterBubbleTimer=Play.waterBubbleMax;
  }
  if(p.onGhost){
    var g=p.onGhost;
    var dx=g.x-g.lastX,dy=g.y-g.lastY;
    if(Math.abs(dx)<5&&Math.abs(dy)<5){p.x+=dx;p.y+=dy;}
  }
  // 推可移动方块
  var pushDir=0;
  if(keys['KeyD']||keys['ArrowRight'])pushDir=1;
  else if(keys['KeyA']||keys['ArrowLeft'])pushDir=-1;
  // 接触数量限制：一次最多推动 2 个；接触 3 个及以上时整组推不动
  if(pushDir!==0){
    var _touchCount=0;
    for(var _ti=0;_ti<Play.movables.length;_ti++){
      var _tm=Play.movables[_ti];
      var _tOverlapY=(p.y<_tm.y+_tm.h)&&(p.y+p.h>_tm.y);
      if(!_tOverlapY)continue;
      if(pushDir>0){
        var _tgapA=_tm.x-(p.x+p.w);
        if(_tgapA>=-1.5&&_tgapA<3)_touchCount++;
      }else{
        var _tgapB=p.x-(_tm.x+_tm.w);
        if(_tgapB>=-1.5&&_tgapB<3)_touchCount++;
      }
    }
    if(_touchCount>2)pushDir=0;
  }
  if(pushDir!==0){
    var obstacles=[];
    Play.platforms.forEach(function(pp){obstacles.push(pp);});
    Play.disappearPlats.forEach(function(dd){if(isDisappearVisible(dd))obstacles.push(dd);});
    Play.doors.forEach(function(dd){if(!_doorPassable(dd))obstacles.push(dd);});
    Play.switchDoors.forEach(function(dd){if(!_doorPassable(dd))obstacles.push(dd);});
    Play.movables.forEach(function(mm){obstacles.push(mm);});
    Play.breakables.forEach(function(bb){obstacles.push(bb);});
    Play.flammables.forEach(function(ff){if(ff.burning<=0)obstacles.push(ff);});
    Play.iceBlocks.forEach(function(ib){obstacles.push(ib);});
    for(var i=0;i<Play.movables.length;i++){
      var m=Play.movables[i];
      var overlapY=(p.y<m.y+m.h)&&(p.y+p.h>m.y);
      if(!overlapY)continue;
      if(pushDir>0){
        var gap=m.x-(p.x+p.w);
        if(gap>=-1.5&&gap<3){
          var step=Math.max(0.4,Math.abs(p.vx));
          var newX=m.x+step;
          var blocked=false;
          var testRect={x:newX,y:m.y,w:m.w,h:m.h};
          for(var j=0;j<obstacles.length;j++){
            if(obstacles[j]===m)continue;
            if(rectsOverlap(testRect,obstacles[j])){blocked=true;break;}
          }
          if(!blocked){m.x=newX;m.vx=step*0.5;}
          p.x=m.x-p.w;p.vx=0;
        }
      }else{
        var gap2=p.x-(m.x+m.w);
        if(gap2>=-1.5&&gap2<3){
          var step2=Math.max(0.4,Math.abs(p.vx));
          var newX2=m.x-step2;
          var blocked2=false;
          var testRect2={x:newX2,y:m.y,w:m.w,h:m.h};
          for(var k=0;k<obstacles.length;k++){
            if(obstacles[k]===m)continue;
            if(rectsOverlap(testRect2,obstacles[k])){blocked2=true;break;}
          }
          if(!blocked2){m.x=newX2;m.vx=-step2*0.5;}
          p.x=m.x+m.w;p.vx=0;
        }
      }
    }
  }
  // 踩碎易碎方块
  for(var bi=Play.breakables.length-1;bi>=0;bi--){
    var bk=Play.breakables[bi];
    if(p.gravityDir>0&&p.vy>0){
      var ovTop=(p.y+p.h)-bk.y;
      if(p.x+p.w>bk.x&&p.x<bk.x+bk.w&&ovTop>0&&ovTop<8&&Math.abs(p.x+p.w/2-(bk.x+bk.w/2))<bk.w/2+p.w/2){
        for(var k3=0;k3<8;k3++){
          var a3=Math.random()*Math.PI*2;
          Play.particles.push(mkParticle(bk.x+bk.w/2,bk.y+bk.h/2,Math.cos(a3)*1.5,Math.sin(a3)*1.5-1,500,204,119,68));
        }
        Play.breakables.splice(bi,1);
        p.y=bk.y-p.h;p.vy=0;p.grounded=true;
        continue;
      }
    }
  }
  // 幽灵更新（仅已释放的）
  for(var gi=0;gi<Play.ghosts.length;gi++){
    var gh=Play.ghosts[gi];
    if(!gh.released)continue;
    gh.update();
    if(gh._pendingExplosion){
      gh._pendingExplosion=false;
      triggerExplosion(gh._explosionX+4,gh._explosionY+4,'ghost');
    }
  }
  // ---- 开关：玩家/可移动方块踩到就翻转（边沿检测） ----
  for(var swi=0;swi<Play.switches.length;swi++){
    var sw=Play.switches[swi];
    var swBox={x:sw.x,y:sw.y-6,w:sw.w,h:sw.h+8};
    var swOver=rectsOverlap(p,swBox);
    if(!swOver){
      for(var mwi=0;mwi<Play.movables.length;mwi++){
        if(rectsOverlap(Play.movables[mwi],swBox)){swOver=true;break;}
      }
    }
    if(swOver&&!sw._pressed){
      sw._pressed=true;
      var swTags=(sw.tags||'').split(',').map(function(t){return t.trim();}).filter(function(t){return t;});
      Play.switchDoors.forEach(function(sd){
        var sdTags=(sd.tags||'').split(',').map(function(t){return t.trim();}).filter(function(t){return t;});
        var hit=false;
        for(var a=0;a<swTags.length;a++){if(sdTags.indexOf(swTags[a])>=0){hit=true;break;}}
        if(hit){
          sd.open=!sd.open;
          for(var spi=0;spi<8;spi++){
            var spa=Math.random()*Math.PI*2;
            Play.particles.push(mkParticle(sd.x+sd.w/2,sd.y+sd.h/2,Math.cos(spa)*1.2,Math.sin(spa)*1.2,420,0,221,255));
          }
        }
      });
      for(var spi2=0;spi2<6;spi2++){
        var spa2=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(sw.x+sw.w/2,sw.y+2,Math.cos(spa2)*1.2,Math.sin(spa2)*1.2-0.6,400,0,221,255));
      }
    }else if(!swOver&&sw._pressed){
      sw._pressed=false;
    }
  }
  // ---- 奖杯收集 ----
  for(var ti=Play.trophies.length-1;ti>=0;ti--){
    var tr=Play.trophies[ti];
    if(rectsOverlap(p,tr)){
      TrophyStore.add(tr.id);
      for(var tpi=0;tpi<26;tpi++){
        var ta=Math.random()*Math.PI*2;
        var ts=1+Math.random()*3;
        Play.particles.push(mkParticle(tr.x+tr.w/2,tr.y+tr.h/2,Math.cos(ta)*ts,Math.sin(ta)*ts-1,1200,255,215,0));
      }
      Play.trophies.splice(ti,1);
      toast('★ 获得奖杯！（已永久收藏）');
    }
  }
  // ---- 水草摆动 ----
  updateWaterGrass(dt);
  // 标签触发显示
  /* 提示标签：同一时刻只显示离玩家最近的一条，避免多处标签重叠成一片。
     先算出每条标签的距离与是否在触发范围内，再选出最近的一条作为唯一可见项。 */
  (function(){
    var pCX=p.x+p.w/2, pCY=p.y+p.h/2;
    var best=-1, bestDist=Infinity;
    for(var li=0;li<Play.labels.length;li++){
      var lb=Play.labels[li];
      var tCX=lb.x+(lb.w||8)/2, tCY=lb.y+(lb.h||8)/2;
      var ddx=pCX-tCX, ddy=pCY-tCY;
      var d2=ddx*ddx+ddy*ddy;
      var radius=lb.triggerRadius!==undefined?lb.triggerRadius:60;
      lb._dist2=d2;
      if(d2<radius*radius && d2<bestDist){bestDist=d2;best=li;}
    }
    for(var lj=0;lj<Play.labels.length;lj++){
      var l2=Play.labels[lj];
      var target=(lj===best)?1:0;
      var speed=l2.fadeSpeed||1.5;
      var cur=l2._vis||0;
      l2._vis=target+(cur-target)*Math.exp(-speed*dt);
    }
  })();
  Play.trajectory.push({x:p.x,y:p.y});
  if(Play.trajectory.length>1500)Play.trajectory.shift();
  var inChamber=false;
  var chambers=LevelContext.levels[LevelContext.currentIdx].chambers;
  for(var ci=0;ci<chambers.length;ci++){
    var ch=chambers[ci];
    if(p.x+p.w>ch.x&&p.x<ch.x+ch.w&&p.y+p.h>ch.y&&p.y<ch.y+ch.h){inChamber=true;break;}
  }
  if(!inChamber){diePlay();return;}
  for(var s=0;s<Play.spikes.length;s++)if(rectsOverlap(p,Play.spikes[s])){diePlay();return;}
  for(var fs=0;fs<Play.fallingSpikes.length;fs++){
    var fsp=Play.fallingSpikes[fs];
    if(!fsp._t){
      var range=fsp.triggerRange||60;
      if(p.x+p.w>fsp.x&&p.x<fsp.x+fsp.w&&p.y>fsp.y&&p.y<fsp.y+fsp.h+range){fsp._t=true;fsp._tm=fsp.triggerDelay;}
    }
    if(fsp._t&&!fsp._f){fsp._tm-=dt;if(fsp._tm<=0)fsp._f=true;}
    if(fsp._f){
      fsp.y+=(fsp.fallSpeed||8)*dt*60;
      for(var pi=0;pi<Play.platforms.length;pi++){
        if(rectsOverlap(fsp,Play.platforms[pi])){fsp.y=Play.platforms[pi].y-fsp.h;fsp._f=false;break;}
      }
    }
    if(rectsOverlap(p,fsp)){diePlay();return;}
  }
  for(var l=0;l<Play.lasers.length;l++){
    var laser=Play.lasers[l];
    var ray=computeLaserRay(laser);
    var dx=0,dy=0;
    if(laser.type==='laserRight')dx=1;
    else if(laser.type==='laserLeft')dx=-1;
    else if(laser.type==='laserUp')dy=-1;
    else if(laser.type==='laserDown')dy=1;
    if(ray.hit&&Math.random()<0.85){spawnLaserSpark(ray.endX,ray.endY,dx,dy);}
    var playerHit=false;
    if(dx>0)playerHit=(p.y+p.h>laser.y&&p.y<laser.y+6&&p.x+p.w>laser.x&&p.x<ray.endX);
    else if(dx<0)playerHit=(p.y+p.h>laser.y&&p.y<laser.y+6&&p.x+p.w>ray.endX&&p.x<laser.x);
    else if(dy<0)playerHit=(p.x+p.w>laser.x&&p.x<laser.x+6&&p.y+p.h>ray.endY&&p.y<laser.y);
    else playerHit=(p.x+p.w>laser.x&&p.x<laser.x+6&&p.y+p.h>laser.y&&p.y<ray.endY);
    if(playerHit){
      var safe=false;
      for(var sgi=0;sgi<Play.ghosts.length;sgi++){
        var sg=Play.ghosts[sgi];
        if(!sg.released)continue;
        var sgx=sg.x+4,sgy=sg.y+4;
        if(dx>0&&sgx<p.x&&sgx>laser.x){safe=true;break;}
        if(dx<0&&sgx>p.x+p.w&&sgx<laser.x){safe=true;break;}
        if(dy<0&&sgy>p.y+p.h&&sgy<laser.y){safe=true;break;}
        if(dy>0&&sgy<p.y&&sgy>laser.y){safe=true;break;}
      }
      if(!safe){diePlay();return;}
    }
  }
  for(var pl=0;pl<Play.plates.length;pl++){
    var plate=Play.plates[pl];
    var pr={x:plate.x,y:plate.y-6,w:plate.w,h:10};
    var weight=0;
    if(rectsOverlap(p,pr))weight=1;
    for(var gi3=0;gi3<Play.ghosts.length;gi3++){
      if(!Play.ghosts[gi3].released)continue;
      var gr={x:Play.ghosts[gi3].x,y:Play.ghosts[gi3].y,w:8,h:8};
      if(rectsOverlap(gr,pr))weight+=1;
    }
    for(var mw=0;mw<Play.movables.length;mw++){
      if(rectsOverlap(Play.movables[mw],pr))weight+=1;
    }
    plate._w=weight;
    plate.active=weight>=plate.need;
    Play.doors.forEach(function(d){if(d.id===plate.targetId)d.open=plate.active;});
  }


  for(var hi=Play.hearts.length-1;hi>=0;hi--)if(rectsOverlap(p,Play.hearts[hi])){
    for(var ph=0;ph<10;ph++){
      var a3b=Math.random()*Math.PI*2;
      Play.particles.push(mkParticle(Play.hearts[hi].x+4,Play.hearts[hi].y+4,Math.cos(a3b)*1.5,Math.sin(a3b)*1.5-0.5,600,255,51,102));
    }
    Play.lives++;Play.hearts.splice(hi,1);
  }
  for(var fp=Play.flagPickups.length-1;fp>=0;fp--)if(rectsOverlap(p,Play.flagPickups[fp])){
    for(var pf=0;pf<12;pf++){
      var a4=Math.random()*Math.PI*2;
      Play.particles.push(mkParticle(Play.flagPickups[fp].x+4,Play.flagPickups[fp].y+4,Math.cos(a4)*1.8,Math.sin(a4)*1.8-0.5,800,255,221,68));
    }
    Play.flagsCollected++;Play.flagPickups.splice(fp,1);
    toast('拾取旗帜（库存：'+Play.flagsCollected+'）');
  }
  var inFlip=false;
  for(var gz=0;gz<Play.gravityZones.length;gz++)if(rectsOverlap(p,Play.gravityZones[gz])){inFlip=true;break;}
  var newDir=inFlip?-1:1;
  if(newDir!==p.gravityDir){
    p.gravityDir=newDir;p.canDoubleJump=true;p.squashVY=0.4;
    for(var pz=0;pz<12;pz++){
      var ap=Math.random()*Math.PI*2;
      Play.particles.push(mkParticle(p.x+4,p.y+4,Math.cos(ap)*1.8,Math.sin(ap)*1.8,500,170,136,255));
    }
  }
  for(var gi4=0;gi4<Play.goals.length;gi4++){
    if(rectsOverlap(p,Play.goals[gi4])){
      Play.won=true;Play.wonTimer=1.5;
      D.playWin.classList.add('show');
      for(var pw=0;pw<30;pw++){
        var aw=Math.random()*Math.PI*2;
        var sw=1+Math.random()*3;
        Play.particles.push(mkParticle(Play.goals[gi4].x+4,Play.goals[gi4].y+4,Math.cos(aw)*sw,Math.sin(aw)*sw-1,1200,255,68,102));
      }
      return;
    }
  }
  if(Play.freeLookTimer>0)Play.freeLookTimer-=dt;
  else{
    Play.camOffset.x*=0.92;Play.camOffset.y*=0.92;
    if(Math.abs(Play.camOffset.x)<0.5)Play.camOffset.x=0;
    if(Math.abs(Play.camOffset.y)<0.5)Play.camOffset.y=0;
  }
  if(Play.screenShake>0.5)Play.screenShake*=0.88;
  else Play.screenShake=0;
  if(!Play.cam)Play.cam=makeCamera(LevelContext.levels[LevelContext.currentIdx]);
  updateCameraView(Play.cam,D.playCanvas);
  updateCamera(Play.cam,p,Play.worldBounds,Play.camOffset);
}
/* 死亡动画：0.8s 原地停留展示爆炸，0.3s 平滑运镜回重生点（总 1.1s） */
function updateDeathAnim(dt){
  var da=Play.deathAnim;
  if(!da)return;
  da.timer+=dt;
  var holdTime=0.8;
  var returnStart=holdTime;
  var returnT=Math.max(0,(da.timer-returnStart)/(da.duration-returnStart));
  returnT=Math.min(1,returnT);
  var easeT=returnT*returnT*(3-2*returnT);
  var targetCamX=da.respawnX-Play.cam.viewW/2+4;
  var targetCamY=da.respawnY-Play.cam.viewH/2+4;
  Play.cam.x=da.camStartX+(targetCamX-da.camStartX)*easeT;
  Play.cam.y=da.camStartY+(targetCamY-da.camStartY)*easeT;
  if(da.timer>=da.duration){
    da.active=false;
    Play.deathAnim=null;
    /* === flag/ghost v4 === */
    respawnPlay(Play.currentFlag?'flag':'default');
    for(var i=0;i<Play.ghosts.length;i++)Play.ghosts[i].released=true;
    Play.cam.x=da.respawnX-Play.cam.viewW/2+4;
    Play.cam.y=da.respawnY-Play.cam.viewH/2+4;
    updateCameraView(Play.cam,D.playCanvas);
    updateCamera(Play.cam,Play.player,Play.worldBounds,Play.camOffset);
  }
}

function restartPlayFromLevel(){
  var lv=LevelContext.levels[LevelContext.currentIdx];
  ['platforms','disappearPlats','spikes','fallingSpikes','lasers','doors','plates',
   'movables','breakables','flammables','iceBlocks','goals','hearts','flagPickups',
   'gravityZones','labels','lamps','vines',
   'trophies','switches','switchDoors','waters','smokes','waterGrasses'
  ].forEach(function(k){Play[k]=[];});
  lv.elements.forEach(function(el){
    if(el.type==='bg')return;
    var c=JSON.parse(JSON.stringify(el));
    switch(c.type){
      case 'platform':Play.platforms.push(c);break;
      case 'disappear':Play.disappearPlats.push(c);break;
      case 'spike':Play.spikes.push(c);break;
      case 'fallingSpike':c._t=false;c._f=false;c._tm=0;Play.fallingSpikes.push(c);break;
      case 'laserRight':case 'laserLeft':case 'laserUp':case 'laserDown':Play.lasers.push(c);break;
      case 'door':c.open=false;c._openProgress=0;Play.doors.push(c);break;
      case 'plate':c.active=false;c._w=0;Play.plates.push(c);break;
      case 'movable':c.vx=0;c.vy=0;Play.movables.push(c);break;
      case 'breakable':Play.breakables.push(c);break;
      case 'flammable':c.burning=0;c._igniteDelay=0;Play.flammables.push(c);break;
      case 'goal':Play.goals.push(c);break;
      case 'heart':Play.hearts.push(c);break;
      case 'flagPickup':Play.flagPickups.push(c);break;
      case 'gravityFlip':Play.gravityZones.push(c);break;
      case 'label':c._vis=0;Play.labels.push(c);break;
      case 'lamp':c.broken=false;Play.lamps.push(c);break;
      case 'vine':c.sway=0;c.swayV=0;Play.vines.push(c);break;
      case 'ice':c._melt=-1;Play.iceBlocks.push(c);break;
      case 'trophy':
        if(!c.id)c.id='trophy_legacy_'+Math.round(c.x)+'_'+Math.round(c.y);
        if(!TrophyStore.has(c.id))Play.trophies.push(c);
        break;
      case 'switch':c._pressed=false;c.on=false;Play.switches.push(c);break;
      case 'switchDoor':c.open=!!c.initialOpen;c._openProgress=c.open?1:0;Play.switchDoors.push(c);break;
      case 'water':Play.waters.push(c);break;
      case 'smoke':Play.smokes.push(c);break;
      case 'waterGrass':c.sway=0;c.swayV=0;Play.waterGrasses.push(c);break;
    }
  });
  Play.player.dead=true;
  Play.deathAnim={
    active:true,timer:0,duration:1.1,
    camStartX:Play.cam.x,camStartY:Play.cam.y,
    respawnX:Play.spawnX,respawnY:Play.spawnY
  };
  toast('生命耗尽，关卡已完全重置');
}

function diePlay(){
  if(Play.deathAnim&&Play.deathAnim.active)return;
  if(!Play.player||Play.player.dead)return;
  Play.lives--;Play.deathCount++;
  for(var i=0;i<20;i++){
    var a=Math.random()*Math.PI*2;var s=1+Math.random()*2.5;
    Play.particles.push(mkParticle(Play.player.x+4,Play.player.y+4,Math.cos(a)*s,Math.sin(a)*s-0.5,800,0,255,170));
  }
  if(Play.lives<=0){
    Play.lives=Play.maxLives;
    Play.flagsCollected=(LevelContext.levels[LevelContext.currentIdx].initialFlags||0);
    Play.currentFlag=null;Play.placedFlags=[];
    Play.currentRespawnOrigin='default';
    Play._flagGhostsCleared=false;
    Play.ghosts=[];Play.trajectory=[];Play.dashTrajectory=[];
    restartPlayFromLevel();
    return;
  }
  if(false){
    Play.deathAnim={
      active:true,timer:0,duration:1.1,
      camStartX:Play.cam.x,camStartY:Play.cam.y,
      respawnX:Play.spawnX,respawnY:Play.spawnY
    };
    Play._dyingBySuicide=false;
    toast('生命耗尽，返回初始点');
    return;
  }
  /* === flag/ghost v3 ===
     关键修复：
     - 旗子处第一次死亡：无论轨迹多短，都必须清空场上所有幽灵
       并强制生成一个新幽灵（从旗子位置开始）。
       之前单纯依赖 trajectory.length>8 且 compressed.length>6 的判断，
       如果玩家从旗子复活后很快死亡，轨迹太短，新幽灵根本不会生成。
     - 非旗子死亡：保持原有逻辑（避免太短的碎步轨迹产生噪音幽灵）。 */
  /* === flag/ghost v4 ===
     用 currentFlag 判定"是否是旗子处第一次死亡"，不再信任
     currentRespawnOrigin 字符串。 */
  var wasFlagFirstDeath=(!!Play.currentFlag&&!Play._flagGhostsCleared);
  if(wasFlagFirstDeath){
    Play.ghosts=[];
    Play._flagGhostsCleared=true;
  }
  var shouldCreateGhost=false;
  if(wasFlagFirstDeath){
    shouldCreateGhost=true;
  }else if(Play.trajectory.length>8){
    var _tmpCompress=compressTrajectory(Play.trajectory);
    if(_tmpCompress.length>6)shouldCreateGhost=true;
  }
  if(shouldCreateGhost){
    var compressed=compressTrajectory(Play.trajectory);
    // 极端情况：轨迹只有 1 点或 0 点 —— 补一个点让它能循环
    if(compressed.length<2){
      var _p0=compressed.length>0?compressed[0]:{x:Play.player.x,y:Play.player.y};
      compressed=[{x:_p0.x,y:_p0.y},{x:_p0.x,y:_p0.y}];
    }
    var wasSuicide=Play._dyingBySuicide===true;
    var newGhost=new PlayGhost(compressed,Play.player.x,Play.player.y,Play.currentRespawnOrigin,wasSuicide);
    Play.ghosts=Play.ghosts.filter(function(g){return g.originId!==Play.currentRespawnOrigin;});
    Play.ghosts.push(newGhost);
    if(Play.ghosts.length>4)Play.ghosts.shift();
  }
  Play._dyingBySuicide=false;
  Play.dashTrajectory=Play.trajectory.slice();
  Play.trajectory=[];
  Play.player.dead=true;
  var rsp=getRespawnPos();
  Play.deathAnim={
    active:true,timer:0,duration:1.1,
    camStartX:Play.cam.x,camStartY:Play.cam.y,
    respawnX:rsp.x,respawnY:rsp.y
  };
}
function isDisappearVisible(d){
  var onT=d.onTime||1.5,offT=d.offTime||1.0;
  var period=onT+offT;
  return((Game.simTime+(d.phase||0))%period)<onT;
}

function bindPlayDrag(){
  if(playDragBound)return;
  playDragBound=true;
  var c=D.playCanvas;
  var onStart=function(clientX,clientY,target){
    if(target&&target.closest&&target.closest('.pc-zone'))return false;
    Play.dragStart={x:clientX,y:clientY,ox:Play.camOffset.x,oy:Play.camOffset.y};
    Play.freeLookTimer=3;
    D.playFreeLookHint.classList.add('show');
    return true;
  };
  var onMove=function(clientX,clientY){
    if(!Play.dragStart)return;
    var dx=clientX-Play.dragStart.x;
    var dy=clientY-Play.dragStart.y;
    if(Math.abs(dx)<3&&Math.abs(dy)<3)return;
    Play.camOffset.x=Play.dragStart.ox-dx/Play.cam.zoom;
    Play.camOffset.y=Play.dragStart.oy-dy/Play.cam.zoom;
    Play.freeLookTimer=3;
  };
  var onEnd=function(){
    Play.dragStart=null;
    setTimeout(function(){if(Play.freeLookTimer<=0)D.playFreeLookHint.classList.remove('show');},3100);
  };
  c.addEventListener('touchstart',function(e){if(e.touches.length===1)onStart(e.touches[0].clientX,e.touches[0].clientY,e.target);},{passive:false});
  c.addEventListener('touchmove',function(e){if(e.touches.length===1)onMove(e.touches[0].clientX,e.touches[0].clientY);},{passive:false});
  c.addEventListener('touchend',onEnd);
  c.addEventListener('touchcancel',onEnd);
  c.addEventListener('mousedown',function(e){if(e.button===0)onStart(e.clientX,e.clientY,e.target);});
  c.addEventListener('mousemove',function(e){if(Play.dragStart)onMove(e.clientX,e.clientY);});
  window.addEventListener('mouseup',onEnd);
}

/* ============ 试玩渲染 ============ */
function renderPlay(){
  var c=D.playCanvas,g=c.getContext('2d');
  var W=c.width,H=c.height;
  g.setTransform(dpr,0,0,dpr,0,0);
  g.fillStyle='#0a0e1a';g.fillRect(0,0,W,H);
  if(!Play.cam||!Play.player)return;
  var cam=Play.cam;var zoom=cam.zoom;var now=Date.now()/1000;
  g.save();
  if(Play.screenShake>0.5)g.translate((Math.random()-0.5)*Play.screenShake,(Math.random()-0.5)*Play.screenShake);
  g.scale(zoom,zoom);
  /* === 像素完美：把相机平移吸附到设备像素网格，消除像素抖动 ===
     原理：scale(zoom) 后，世界坐标 wx 映射到 CSS 像素 (wx-cam.x)*zoom，
     再乘 dpr 到设备像素。只要 cam.x * zoom * dpr 是整数，所有整数世界
     坐标都会落在整数设备像素上，绘制时不会出现半像素偏移。
     这一步对像素艺术至关重要：不做的话，相机平滑跟随会让整个画面
     的像素以亚像素级别抖动，观感非常差。 */
  var _pixSnap = zoom * dpr;
  var _snapCamX = Math.round(cam.x * _pixSnap) / _pixSnap;
  var _snapCamY = Math.round(cam.y * _pixSnap) / _pixSnap;
  g.translate(-_snapCamX,-_snapCamY);
  g.fillStyle='#0a0e1a';
  g.fillRect(_snapCamX-100,_snapCamY-100,cam.viewW+200,cam.viewH+200);

  // ===== 背景层（视差 + 动态 + 裁剪） =====
  if(Play.backgrounds&&Play.backgrounds.length>0){
    var sorted=Play.backgrounds.slice().sort(function(a,b){return (a.layer||0)-(b.layer||0);});
    var maxBgLayer=computeBgLayerMax(sorted);
    // === 视锥剔除（性能优化）===
    // 视口世界坐标范围 + 一圈 margin。注意这里是"绘制世界坐标"，
    // 已经包含了 translate(-cam.x,-cam.y)，所以直接和 cam.x/cam.y 比较。
    var _playMargin=120;
    var _pVisL=cam.x-_playMargin, _pVisT=cam.y-_playMargin;
    var _pVisR=cam.x+cam.viewW+_playMargin, _pVisB=cam.y+cam.viewH+_playMargin;
    sorted.forEach(function(bg){
      var layer=bg.layer||0;
      /* === 视差公式 v2 ===
         多图层时：
           · 最底层 pf = 0 → 完全静止（屏幕锚定）
           · 最高层 pf = 1 → 与相机反向等速移动（世界锚定）
           · 中间层线性插值
         单图层时：pf = 1（世界锚定，和普通物体一致） */
      var pf;
      if (sorted.length > 1) {
        var maxLayerNum = Math.max(1, maxBgLayer);
        pf = Math.max(0, Math.min(1, layer / maxLayerNum));
      } else {
        pf = 1;
      }
      var haze=computeBgHaze(layer,maxBgLayer);
      // 视差：世界绘制位置 = base + (1-pf)*cam
      var offX=(1-pf)*cam.x;
      var offY=(1-pf)*cam.y;
      // 像素吸附：视差偏移量对齐到设备像素网格，消除移动抖动
      var _pfUnit = cam.zoom * dpr;
      if (_pfUnit > 0) {
        offX = Math.round(offX * _pfUnit) / _pfUnit;
        offY = Math.round(offY * _pfUnit) / _pfUnit;
      }

      /* === 拉伸 Bug 修复（试玩侧） ===
         不再把形状裁剪到所属画布范围。每个形状按自己的包围盒做视锥剔除。 */
      (bg.shapes||[]).forEach(function(sh){
        var bc=null;
        (bg.chambers||[]).forEach(function(c){if(c.id===sh.chamberId)bc=c;});
        if(!bc)return;
        var srx=sh.x+offX, sry=sh.y+offY;
        if(srx+sh.w<_pVisL||srx>_pVisR||sry+sh.h<_pVisT||sry>_pVisB)return;
        var a=(sh.alpha!==undefined?sh.alpha:0.85);
        var _nbrs=(bg.shapes||[]).filter(function(o){return o!==sh&&o.type==='bgShape'&&o.chamberId===sh.chamberId;});
        drawBgShape(g,sh,sh.x+offX,sh.y+offY,sh.w,sh.h,a,now,false,true,_nbrs,cam.zoom);
      });
    });
  }

  // 参考格子
  if(Play.showGrid){
    var gridSize=8;
    var gx0=Math.floor(cam.x/gridSize)*gridSize;
    var gy0=Math.floor(cam.y/gridSize)*gridSize;
    g.strokeStyle='rgba(0,255,170,0.18)';g.lineWidth=0.5/zoom;
    for(var gx=gx0;gx<cam.x+cam.viewW+gridSize;gx+=gridSize){
      g.beginPath();g.moveTo(gx,cam.y);g.lineTo(gx,cam.y+cam.viewH);g.stroke();
    }
    for(var gy=gy0;gy<cam.y+cam.viewH+gridSize;gy+=gridSize){
      g.beginPath();g.moveTo(cam.x,gy);g.lineTo(cam.x+cam.viewW,gy);g.stroke();
    }
    g.strokeStyle='rgba(0,255,170,0.35)';g.lineWidth=0.8/zoom;
    var majorSize=gridSize*5;
    var mgx0=Math.floor(cam.x/majorSize)*majorSize;
    var mgy0=Math.floor(cam.y/majorSize)*majorSize;
    for(var mgx=mgx0;mgx<cam.x+cam.viewW+majorSize;mgx+=majorSize){
      g.beginPath();g.moveTo(mgx,cam.y);g.lineTo(mgx,cam.y+cam.viewH);g.stroke();
    }
    for(var mgy=mgy0;mgy<cam.y+cam.viewH+majorSize;mgy+=majorSize){
      g.beginPath();g.moveTo(cam.x,mgy);g.lineTo(cam.x+cam.viewW,mgy);g.stroke();
    }
  }
  // 幽灵路径
  Play.ghosts.forEach(function(gh){
    if(!gh.released)return;
    var traj=gh.trajectory;
    if(!traj||traj.length<2)return;
    var fa=(gh.fadeAlpha===undefined?1:gh.fadeAlpha);
    var z=Math.max(zoom,0.5);
    var lineW1=2.4/z, lineW2=3.6/z;
    var dashOn=7/z, dashOff=6/z;
    g.lineCap='round';g.lineJoin='round';
    g.strokeStyle='rgba(150,160,190,'+(0.38*fa)+')';
    g.lineWidth=lineW1;
    g.setLineDash([dashOn,dashOff]);
    g.beginPath();
    g.moveTo(traj[0].x+4,traj[0].y+4);
    var step=Math.max(1,Math.floor(traj.length/240));
    for(var di=step;di<traj.length;di+=step){
      g.lineTo(traj[di].x+4,traj[di].y+4);
    }
    g.lineTo(traj[traj.length-1].x+4,traj[traj.length-1].y+4);
    g.stroke();
    g.setLineDash([]);
    var cur=gh.progress;
    var ci=Math.floor(cur);
    if(ci<0)ci=0;
    if(ci>traj.length-1)ci=traj.length-1;
    var hs=Math.max(0,ci-11),he=Math.min(traj.length-1,ci+11);
    if(he>hs){
      g.strokeStyle='rgba(255,255,255,'+(0.92*fa)+')';
      g.lineWidth=lineW2;
      g.beginPath();
      g.moveTo(traj[hs].x+4,traj[hs].y+4);
      for(var hi=hs+1;hi<=he;hi++)g.lineTo(traj[hi].x+4,traj[hi].y+4);
      g.stroke();
    }
    g.lineCap='butt';g.lineJoin='miter';
    g.lineWidth=1;
  });
  // 平台
  Play.platforms.forEach(function(p){
    var adj=getAdjacency(p,Play.platforms);
    drawPlatformTo(g, p, adj);
  });
  Play.disappearPlats.forEach(function(d){
    var adj=getAdjacency(d,Play.disappearPlats);
    drawDisappearTo(g, d, adj);
  });
  Play.doors.forEach(function(d){
    var _prog=(d._openProgress!==undefined)?d._openProgress:(d.open?1:0);
    var _scale=1-_prog;
    if(_scale>0.02){
      var _orient=_getDoorOrientation(d);
      var _cx=d.x+d.w/2, _cy=d.y+d.h/2;
      var _nw,_nh,_nx,_ny;
      if(_orient==='h'){
        _nw=d.w*_scale; _nh=d.h; _nx=_cx-_nw/2; _ny=d.y;
      }else{
        _nw=d.w; _nh=d.h*_scale; _nx=d.x; _ny=_cy-_nh/2;
      }
      var x=Math.round(_nx), y=Math.round(_ny);
      var w=Math.max(1,Math.round(_nw)), h=Math.max(1,Math.round(_nh));
      g.save();
      g.globalAlpha=Math.min(1,_scale*1.5);
      _px(g, x, y, w, h, '#8a5a08');
      for(var dy=0;dy<h;dy+=2){
        _pxDot(g, x+1, y+dy, '#ffaa00');
        _pxDot(g, x+w-2, y+dy, '#a06a00');
      }
      _px(g, x, y, w, 1, '#ffcc66');
      _px(g, x, y+h-1, w, 1, '#3a2400');
      g.restore();
    }
    if(_prog>0.5){
      g.fillStyle='rgba(255,170,0,'+(0.06*(_prog-0.5)*2)+')';
      g.fillRect(d.x,d.y,d.w,d.h);
    }
  });
  Play.movables.forEach(function(m){
    var adj=getAdjacency(m,Play.movables);
    drawMovableTo(g, m, adj);
  });
  Play.iceBlocks.forEach(function(ib){
    var adj=getAdjacency(ib,Play.iceBlocks);
    drawIceTo(g, ib, adj);
  });
  Play.breakables.forEach(function(bk){
    var adj=getAdjacency(bk,Play.breakables);
    drawBreakableTo(g, bk, adj);
  });
  Play.flammables.forEach(function(f){
    var adj=getAdjacency(f,Play.flammables);
    if(f.burning>0){
      // 燃烧中：像素火焰抖动
      var ratio=Math.max(0,Math.min(1,f.burning/(f.burnTime||1.5)));
      var x=Math.round(f.x), y=Math.round(f.y), w=Math.round(f.w), h=Math.round(f.h);
      _px(g, x, y, w, h, 'rgb('+Math.round(60+ratio*140)+','+Math.round(30+ratio*30)+','+Math.round(15+ratio*15)+')');
      // 随机像素火苗
      for (var pi=0; pi<Math.floor(w*h*0.5); pi++){
        var px3 = x + Math.floor(Math.random()*w);
        var py3 = y + Math.floor(Math.random()*h);
        var colors = ['#ff8020','#ffb040','#ffe070'];
        _pxDot(g, px3, py3, colors[Math.floor(Math.random()*3)]);
      }
    }else{
      drawFlammableTo(g, f, adj);
    }
  });  Play.spikes.forEach(function(s){
    g.fillStyle='#ff3366';
    for(var si=0;si<s.w;si++){
      var sh=Math.round((1-Math.abs(si/s.w*2-1))*s.h);
      g.fillRect(s.x+si,s.y+s.h-sh,1,sh);
    }
  });
  Play.fallingSpikes.forEach(function(fs){
    g.fillStyle='#ff3366';
    for(var fi=0;fi<fs.w;fi++){
      var fh=Math.round((1-Math.abs(fi/fs.w*2-1))*fs.h);
      g.fillRect(fs.x+fi,fs.y,1,fh);
    }
  });
  Play.plates.forEach(function(p){
    g.fillStyle='#3a2a08';g.fillRect(p.x,p.y,p.w,p.h);
    g.fillStyle=p.active?'#aa8820':'#886600';g.fillRect(p.x,p.y,p.w,1);
    var need=p.need||1,cw=p._w||0;
    var lightY=p.y+Math.floor(p.h/2)-1;
    for(var ii=0;ii<need;ii++){
      var lx=p.x+Math.floor((ii+1)*p.w/(need+1))-1;
      if(ii<cw){g.fillStyle='#00ff44';g.shadowBlur=5;g.shadowColor='#00ff44';}
      else{g.fillStyle='#ff3366';g.shadowBlur=3;g.shadowColor='#ff3366';}
      g.fillRect(lx-1,lightY-1,2,2);
      g.shadowBlur=0;
    }
  });
  Play.lasers.forEach(function(l){
    var ray=computeLaserRay(l);
    var dx=0,dy=0;
    if(l.type==='laserRight')dx=1;
    else if(l.type==='laserLeft')dx=-1;
    else if(l.type==='laserUp')dy=-1;
    else if(l.type==='laserDown')dy=1;
    g.shadowBlur=12;g.shadowColor='#ff3366';
    g.strokeStyle='#ff3366';g.lineWidth=3;
    g.beginPath();g.moveTo(ray.startX,ray.startY);g.lineTo(ray.endX,ray.endY);g.stroke();
    g.shadowBlur=0;
    g.strokeStyle='#ffffff';g.lineWidth=1;
    g.beginPath();g.moveTo(ray.startX,ray.startY);g.lineTo(ray.endX,ray.endY);g.stroke();
    g.shadowBlur=8;g.shadowColor='#ff3366';
    g.fillStyle='#ff3366';
    g.beginPath();g.arc(l.x+3,l.y+3,5,0,Math.PI*2);g.fill();
    g.shadowBlur=0;
    g.fillStyle='#ffaaaa';
    g.beginPath();g.arc(l.x+3,l.y+3,2,0,Math.PI*2);g.fill();
    if(ray.hit){
      var gp=0.6+Math.sin(now*15)*0.4;
      g.fillStyle='rgba(255,220,100,'+gp+')';
      g.beginPath();g.arc(ray.endX,ray.endY,4+Math.random()*2,0,Math.PI*2);g.fill();
    }
  });
  Play.goals.forEach(function(goal){
    drawGoalPortalShader(g, goal, now);
  });
  Play.hearts.forEach(function(ht){
    g.fillStyle='#ff3366';
    g.fillRect(ht.x+1,ht.y+1,2,2);g.fillRect(ht.x+ht.w-3,ht.y+1,2,2);
    g.fillRect(ht.x,ht.y+2,ht.w,2);g.fillRect(ht.x+1,ht.y+4,ht.w-2,1);
    g.fillRect(ht.x+2,ht.y+5,ht.w-4,1);g.fillRect(ht.x+3,ht.y+6,ht.w-6,1);
  });
  Play.flagPickups.forEach(function(fp){
    var bob=Math.sin(now*3+fp.x)*1;
    g.fillStyle='#aa8844';g.fillRect(fp.x+fp.w/2-0.5,fp.y+bob,1,fp.h);
    g.fillStyle='#ffdd44';g.fillRect(fp.x+fp.w/2,fp.y+bob,fp.w,Math.floor(fp.h*0.5));
  });
  /* === flag/ghost v3 === */
  // 死亡动画期间也持续渲染旗子，避免复活瞬间旗子突然出现
  if(Play.placedFlags&&Play.placedFlags.length>0){
    Play.placedFlags.forEach(function(cf){
      var isSpawnFlag=(Play.currentFlag===cf);
      var age=(Date.now()-(cf.spawnTime||Date.now()))/1000;
      var spawnT=Math.min(1,age*2.2);
      var easeS=spawnT*spawnT*(3-2*spawnT);
      var px=Play.player?Play.player.x+4:cf.x;
      var py=Play.player?Play.player.y+4:cf.y;
      var fdx=px-(cf.x+4),fdy=py-(cf.y+4);
      var near=Math.sqrt(fdx*fdx+fdy*fdy)<20;
      if(near&&Play.player&&!Play.player.dead){
        var hp=0.7+Math.sin(now*8)*0.3;
        g.strokeStyle='rgba(255,221,68,'+hp+')';
        g.lineWidth=2/zoom;
        g.beginPath();g.arc(cf.x+4,cf.y+4,16,0,Math.PI*2);g.stroke();
      }
      g.save();
      // 出生点旗子比普通旗子更亮
      g.globalAlpha=(isSpawnFlag?0.3+0.7*easeS:0.18+0.35*easeS);
      g.shadowBlur=(isSpawnFlag?14:6)*easeS;
      g.shadowColor='rgba(255,221,68,0.9)';
      g.fillStyle='#e0d0ff';
      g.fillRect(cf.x+4,cf.y-30+30*(1-easeS),2,30*easeS);
      g.fillStyle=isSpawnFlag?'#ffdd44':'#ccaa44';
      var fh=Math.floor(6*easeS);
      for(var fi2=0;fi2<fh;fi2++){
        var wave=Math.sin(now*4+fi2*0.8)*2;
        g.fillRect(cf.x+6,cf.y-28+fi2*3,12+wave,2);
      }
      g.restore();
    });
  }

  // 路灯
  if (Play.lamps) Play.lamps.forEach(function(l){ drawLampTo(g, l, true); });
  // 软树枝
  if (Play.vines) Play.vines.forEach(function(v){ drawVineTo(g, v, true); });
  // 水草
  if (Play.waterGrasses) Play.waterGrasses.forEach(function(wg){ drawWaterGrassTo(g, wg, true); });
  // 开关门（游戏内）
  if (Play.switchDoors) Play.switchDoors.forEach(function(sd){ drawSwitchDoorTo(g, sd, true); });
  // 开关（游戏内）
  if (Play.switches) Play.switches.forEach(function(sw){ drawSwitchTo(g, sw, true); });
  // 奖杯
  if (Play.trophies) Play.trophies.forEach(function(tr){ drawTrophyTo(g, tr); });
  Play.gravityZones.forEach(function(z){
    drawGravityZoneShader(g, z, now);
  });
  Play.ghosts.forEach(function(gh){
    if(!gh.released)return;
    var fa=(gh.fadeAlpha===undefined?1:gh.fadeAlpha);
    if(fa<=0.02)return;
    var n=Math.min(gh.trail.length,8);
    for(var ti=n-1;ti>=1;ti--){
      var ta=(0.05+(1-ti/n)*0.75)*fa;
      g.fillStyle='rgba(136,170,255,'+ta+')';
      g.fillRect(Math.round(gh.trail[ti].x),Math.round(gh.trail[ti].y),8,8);
    }
    var pulse=(0.85+Math.sin(now*3)*0.15)*fa;
    g.shadowBlur=12*fa;g.shadowColor='#88aaff';
    g.fillStyle='rgba(136,170,255,'+pulse+')';
    g.fillRect(Math.round(gh.x),Math.round(gh.y),8,8);
    g.shadowBlur=0;
    g.fillStyle='#0a0e1a';
    g.fillRect(Math.round(gh.x)+2,Math.round(gh.y)+3,1.5,1.5);
    g.fillRect(Math.round(gh.x)+5,Math.round(gh.y)+3,1.5,1.5);
    if(gh.hasExplosion){
      var ep=(0.6+Math.sin(now*6)*0.4)*fa;
      g.strokeStyle='rgba(255,140,40,'+ep+')';
      g.lineWidth=1/zoom;
      g.beginPath();g.arc(gh.x+4,gh.y+4,7,0,Math.PI*2);g.stroke();
    }
    if(gh.offScreen){
      g.fillStyle='rgba(136,170,255,'+(0.9*fa)+')';
      g.font='bold 6px Courier New';
      g.textAlign='center';
      g.fillText('»',gh.x+4,gh.y+2);
      g.textAlign='left';
    }
  });
  Play.labels.forEach(function(lb){
    var vis=lb._vis||0;
    if(vis<0.01)return;
    var tcx=lb.x+(lb.w||8)/2;
    var tcy=lb.y+(lb.h||8)/2;
    if(vis>0.05){
      g.save();
      g.globalAlpha=vis*0.35;
      g.strokeStyle='rgba(255,221,68,0.9)';
      g.lineWidth=1/zoom;
      g.beginPath();g.arc(tcx,tcy,6,0,Math.PI*2);g.stroke();
      g.restore();
    }
    var tpX=lb.x+(lb.w||8)/2+(lb.textOffsetX||0);
    var tpY=lb.y+(lb.h||8)/2+(lb.textOffsetY!==undefined?lb.textOffsetY:-22);
    /* 不使用背景板：仅靠文字自身的克制描边在明亮场景中保持清晰 */
    drawPixelText(g,lb.text||'文本',tpX,tpY,lb.fontSize||10,lb.color||'#ffffff',null,vis,lb.pixelSize||2,'rgba(24,32,40,0.75)');
  });
  var p=Play.player;
  if(p&&!p.dead){
    g.save();
    if(p.gravityDir>0){
      g.translate(p.x+p.w/2,p.y+p.h);
      g.scale(p.squashX,p.squashY);
      g.translate(-p.w/2,-p.h);
    }else{
      g.translate(p.x+p.w/2,p.y);
      g.scale(p.squashX,p.squashY);
      g.translate(-p.w/2,0);
    }
    g.shadowBlur=12;g.shadowColor='#00ffaa';
    g.fillStyle='#00ffaa';g.fillRect(0,0,p.w,p.h);
    g.shadowBlur=0;
    g.fillStyle='#0a0e1a';
    g.fillRect(2,2,1.5,1.5);g.fillRect(4.5,2,1.5,1.5);
    g.restore();
  }
  for(var pi4=0;pi4<Play.particles.length;pi4++){
    var pt4=Play.particles[pi4];
    var alpha2=Math.max(0,pt4.life/pt4.maxLife);
    var size=1+alpha2*1.5;
    g.fillStyle='rgba('+pt4.r+','+pt4.g+','+pt4.b+','+(alpha2*0.4)+')';
    g.fillRect(pt4.x-size,pt4.y-size,size*2.6,size*2.6);
    g.fillStyle='rgba('+pt4.r+','+pt4.g+','+pt4.b+','+alpha2+')';
    g.fillRect(pt4.x,pt4.y,size,size);
  }
  // ===== 水（在粒子之后绘制，覆盖一层浅蓝滤镜） =====
  if (Play.waters && Play.waters.length){
    Play.waters.forEach(function(wt){ drawWaterTo(g, wt, true); });
  }
  // ===== 玩家周围的水中气泡 =====
  if (Play._inWater && Play.player && !Play.player.dead){
    var bp=Play.player;
    var ratio=Math.max(0,Math.min(1,Play.waterBubbleTimer/Play.waterBubbleMax));
    // 半径从 20 缓慢收缩到 7（约等于玩家尺寸），不会缩到玩家身体内部
    var bR=7+13*ratio;
    g.save();
    g.globalAlpha=0.35+0.45*ratio;
    g.strokeStyle='rgba(140,210,255,0.95)';
    g.lineWidth=1.2/zoom;
    g.beginPath();g.arc(bp.x+4,bp.y+4,Math.max(2,bR),0,Math.PI*2);g.stroke();
    g.globalAlpha=0.18+0.25*ratio;
    g.fillStyle='rgba(120,200,255,0.9)';
    g.beginPath();g.arc(bp.x+4,bp.y+4,Math.max(2,bR),0,Math.PI*2);g.fill();
    g.globalAlpha=0.85;
    g.fillStyle='rgba(230,250,255,0.95)';
    g.beginPath();g.arc(bp.x+4-bR*0.45,bp.y+4-bR*0.5,Math.max(0.8,bR*0.16),0,Math.PI*2);g.fill();
    g.restore();
  }
  g.restore();
  // ===== 烟雾覆盖层：在场景渲染完成后叠加 =====
  if (Play.smokes && Play.smokes.length){
    var _cw = c.width / dpr, _ch = c.height / dpr;
    if (!Play._smokeCanvas) Play._smokeCanvas = document.createElement('canvas');
    var _sc = Play._smokeCanvas;
    if (_sc.width !== c.width || _sc.height !== c.height){ _sc.width = c.width; _sc.height = c.height; }
    var _sg = _sc.getContext('2d');
    _sg.setTransform(dpr,0,0,dpr,0,0);
    _sg.clearRect(0,0,_cw,_ch);
    _sg.save();
    _sg.scale(zoom,zoom);
    _sg.translate(-cam.x,-cam.y);
    var _smokeTex = _getSmokeNoiseTex();
    Play.smokes.forEach(function(sm){
      var sx=sm.x, sy=sm.y, sw=sm.w, sh=sm.h;
      var seedBase = sm.x*0.73 + sm.y*0.31;
      var minD = Math.min(sw, sh);

      // ==================================================
      // 阶段 1：边界柔雾 —— 沿矩形四周撒大量柔圆
      //         每个圆半径 22~38px、中心略偏内，向外形成 25px+ 的宽幅羽化
      //         这就是"过渡分界线"的根治手段：用重叠圆的不透明度衰减代替窄渐变
      // ==================================================
      var perimeter = (sw + sh) * 2;
      var ringCount = Math.max(80, Math.floor(perimeter / 3.2));
      for(var ci=0; ci<ringCount; ci++){
        // 沿周长均匀 + 抖动
        var t = (ci / ringCount) * perimeter + (_pr(seedBase + ci*1.13) - 0.5) * 6;
        if(t < 0) t += perimeter;
        if(t >= perimeter) t -= perimeter;
        var px, py, outNX, outNY;
        if(t < sw){ px = sx + t; py = sy; outNX = 0; outNY = -1; }
        else if(t < sw+sh){ px = sx + sw; py = sy + (t-sw); outNX = 1; outNY = 0; }
        else if(t < 2*sw+sh){ px = sx + sw - (t-sw-sh); py = sy + sh; outNX = 0; outNY = 1; }
        else { px = sx; py = sy + sh - (t-2*sw-sh); outNX = -1; outNY = 0; }

        // 圆心略微偏向内 3~7px，避免向外扩张过多
        var inward = 3 + _pr(seedBase + ci*2.17) * 4;
        px += outNX * -inward;
        py += outNY * -inward;

        // 半径 15~25（比之前小很多，羽化带更紧）
        var rr = 15 + _pr(seedBase + ci*3.29) * 10;
        // 中心不透明度 0.55~0.9
        var aa = 0.55 + _pr(seedBase + ci*4.41) * 0.35;

        // 用 4 段渐变让外缘衰减极其柔和（不在视觉上形成任何"硬边"）
        var grd = _sg.createRadialGradient(px,py,0, px,py,rr);
        grd.addColorStop(0,    'rgba(230,232,238,'+ aa.toFixed(3) +')');
        grd.addColorStop(0.30, 'rgba(230,232,238,'+ (aa*0.85).toFixed(3) +')');
        grd.addColorStop(0.58, 'rgba(230,232,238,'+ (aa*0.55).toFixed(3) +')');
        grd.addColorStop(0.82, 'rgba(230,232,238,'+ (aa*0.22).toFixed(3) +')');
        grd.addColorStop(1,    'rgba(230,232,238,0)');
        _sg.fillStyle = grd;
        _sg.beginPath();
        _sg.arc(px, py, rr, 0, Math.PI*2);
        _sg.fill();
      }

      // 再撒一批更远的柔圆，把"雾裙"再向外铺 15~25px
      var driftCount = Math.max(30, Math.floor(perimeter / 8));
      for(var di=0; di<driftCount; di++){
        var t2 = (di / driftCount) * perimeter + (_pr(seedBase + di*1.71 + 100) - 0.5) * 10;
        if(t2 < 0) t2 += perimeter;
        if(t2 >= perimeter) t2 -= perimeter;
        var px2, py2, onx, ony;
        if(t2 < sw){ px2 = sx + t2; py2 = sy; onx = 0; ony = -1; }
        else if(t2 < sw+sh){ px2 = sx + sw; py2 = sy + (t2-sw); onx = 1; ony = 0; }
        else if(t2 < 2*sw+sh){ px2 = sx + sw - (t2-sw-sh); py2 = sy + sh; onx = 0; ony = 1; }
        else { px2 = sx; py2 = sy + sh - (t2-2*sw-sh); onx = -1; ony = 0; }

        var outDist = 3 + _pr(seedBase + di*2.33 + 50) * 7;      // 向外仅 3~10px
        px2 += onx * outDist;
        py2 += ony * outDist;
        var rr2 = 7 + _pr(seedBase + di*3.47 + 50) * 7;          // 半径 7~14
        var aa2 = 0.08 + _pr(seedBase + di*4.59 + 50) * 0.14;    // alpha 0.08~0.22
        var grd2 = _sg.createRadialGradient(px2,py2,0, px2,py2,rr2);
        grd2.addColorStop(0,   'rgba(230,232,238,'+aa2.toFixed(3)+')');
        grd2.addColorStop(0.5, 'rgba(230,232,238,'+(aa2*0.55).toFixed(3)+')');
        grd2.addColorStop(1,   'rgba(230,232,238,0)');
        _sg.fillStyle = grd2;
        _sg.beginPath(); _sg.arc(px2,py2,rr2,0,Math.PI*2); _sg.fill();
      }

      // ==================================================
      // 阶段 2：实心内核 —— 比矩形略缩 4px，保证核心 100% 不透明
      //         用圆角矩形路径，避免直角突出
      // ==================================================
      var inset = Math.min(4, minD * 0.15);
      var corner = Math.min(6, minD * 0.2);
      _sg.save();
      _sg.fillStyle = 'rgba(228,230,236,1)';
      roundRectPath(_sg, sx+inset, sy+inset, sw-inset*2, sh-inset*2, corner);
      _sg.fill();
      _sg.restore();

      // ==================================================
      // 阶段 3：fbm 噪声纹理（纯 source-over 叠加，不挖孔）
      //         clip 到 rect 内，让纹理只出现在不透明核心里
      // ==================================================
      _sg.save();
      _sg.beginPath();
      _sg.rect(sx, sy, sw, sh);
      _sg.clip();
      _tileSmokeNoise(_sg, _smokeTex, sx, sy, sw, sh, 340,  now*2.5, -now*5.5, 0.22, 'source-over');
      _tileSmokeNoise(_sg, _smokeTex, sx, sy, sw, sh, 220, -now*4.5, -now*13.0, 0.32, 'source-over');
      _tileSmokeNoise(_sg, _smokeTex, sx, sy, sw, sh, 150,  now*6.0, -now*20.0, 0.26, 'source-over');
      _tileSmokeNoise(_sg, _smokeTex, sx, sy, sw, sh, 260,  now*1.5, -now*9.0,  0.18, 'source-over');
      _sg.restore();
    });
    _sg.restore();
    // 幽灵开辟可视圆
    _sg.globalCompositeOperation = 'destination-out';
    if (Play.ghosts){
      Play.ghosts.forEach(function(gh){
        if (!gh.released) return;
        var gx = (gh.x + 4 - cam.x) * zoom;
        var gy = (gh.y + 4 - cam.y) * zoom;
        var rr = 44 * zoom;
        var grd = _sg.createRadialGradient(gx,gy,rr*0.30,gx,gy,rr);
        grd.addColorStop(0,   'rgba(0,0,0,1)');
        grd.addColorStop(0.55,'rgba(0,0,0,0.92)');
        grd.addColorStop(0.82,'rgba(0,0,0,0.45)');
        grd.addColorStop(1,   'rgba(0,0,0,0)');
        _sg.fillStyle = grd;
        _sg.beginPath(); _sg.arc(gx,gy,rr,0,Math.PI*2); _sg.fill();
      });
    }
    _sg.globalCompositeOperation = 'source-over';
    g.setTransform(dpr,0,0,dpr,0,0);
    g.drawImage(_sc, 0, 0, _cw, _ch);
  }

}

function doSuicidePlay(){
  if(!Play.player||Play.player.dead)return;
  triggerExplosion(Play.player.x+4,Play.player.y+4,'player');
  Play._dyingBySuicide=true;
  diePlay();
}
function doFlagAction(){
  if(!Play.player||Play.player.dead)return;
  /* === flag/ghost v2 ===
     支持同时存在多个旗子：
     - 按 F 靠近某个旗子 → 拔掉该旗子
       · 若拔的是当前出生点旗子 → 出生点回退到上一个剩余旗子（后进先出）
       · 无剩余旗子 → 出生点退回初始点
       · 清除场上全部幽灵
     - 远离所有旗子按 F → 插下一面新旗子
       · 不清除幽灵，不清除轨迹
       · 出生点设为新旗子 */
  var nearestIdx=-1;
  var nearestDist=24;
  for(var fi=0;fi<Play.placedFlags.length;fi++){
    var fl=Play.placedFlags[fi];
    var fdx=(Play.player.x+4)-(fl.x+4);
    var fdy=(Play.player.y+4)-(fl.y+4);
    var fd=Math.sqrt(fdx*fdx+fdy*fdy);
    if(fd<nearestDist){nearestDist=fd;nearestIdx=fi;}
  }
  if(nearestIdx>=0){
    var picked=Play.placedFlags[nearestIdx];
    Play.placedFlags.splice(nearestIdx,1);
    Play.flagsCollected++;
    for(var i=0;i<10;i++){
      var a=Math.random()*Math.PI*2;
      Play.particles.push(mkParticle(picked.x+4,picked.y-15,Math.cos(a)*1.5,Math.sin(a)*1.5-0.5,500,255,221,68));
    }
    // 如果拔掉的是当前出生点旗子，出生点回退到上一个剩余旗子
    if(Play.currentFlag===picked){
      Play.currentFlag=Play.placedFlags.length>0?Play.placedFlags[Play.placedFlags.length-1]:null;
      Play.currentRespawnOrigin=Play.currentFlag?'flag':'default';
    }
    // 清除场上全部幽灵
    Play.ghosts=[];Play._flagGhostsCleared=false;
    Play.trajectory=[];
    Play.dashTrajectory=[];
    toast('拔旗（库存：'+Play.flagsCollected+'）');
    return;
  }
  if(Play.flagsCollected<=0){toast('没有旗帜可插');return;}
  Play.flagsCollected--;
  var newFlag={x:Play.player.x,y:Play.player.y,spawnTime:Date.now()};
  Play.placedFlags.push(newFlag);
  Play.currentFlag=newFlag;
  /* === flag/ghost v4 === */
  Play.currentRespawnOrigin='flag';
  Play._flagGhostsCleared=false;
  /* === flag/ghost v5 ===
     关键修复：插旗成功后必须清空 trajectory。
     否则下一次死亡时，trajectory 里还包含玩家从【最初出生点】
     一路走到旗子的那一整段路径，幽灵回放就会从原出生点开始播放，
     看起来像"幽灵从原出生点生成"。
     清空后 trajectory 只记录插旗之后玩家的新路径，
     幽灵自然从旗子位置开始。 */
  Play.trajectory=[];
  Play.dashTrajectory=[];
  for(var i2=0;i2<18;i2++){
    var a2=-Math.PI/2+(Math.random()-0.5)*1.4;
    var s2=1+Math.random()*2.2;
    Play.particles.push(mkParticle(Play.player.x+4,Play.player.y+4,Math.cos(a2)*s2,Math.sin(a2)*s2-0.5,700,255,221,68));
  }
  for(var i3=0;i3<6;i3++){
    var a3=Math.random()*Math.PI*2;
    Play.particles.push(mkParticle(Play.player.x+4,Play.player.y+4,Math.cos(a3)*1.2,Math.sin(a3)*1.2,400,255,255,220));
  }
  toast('已插旗（新重生点）');
}

function _px(g,x,y,w,h,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); }
function _pxDot(g,x,y,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),1,1); }

function _ensureVineNodes(v){
  var segs=Math.max(4,Math.min(14,v.segments||8));
  var h=v.h||40;
  var needRebuild = !v._nodes || v._initX!==v.x || v._initY!==v.y || v._initH!==h || v._initSegs!==segs;
  if(!needRebuild) return;
  var segH=h/segs;
  var cx=v.x+(v.w||3)/2;
  var nodes=[];
  for(var i=0;i<=segs;i++){
    nodes.push({x:cx, y:v.y+segH*i, px:cx, py:v.y+segH*i});
  }
  v._nodes=nodes;
  v._segLen=segH;
  v._initX=v.x; v._initY=v.y; v._initH=h; v._initSegs=segs;
}

function updateVines(dt){
  if(!Play.vines||!Play.vines.length)return;
  var p=Play.player;
  var stepScale=Math.min(dt*60,2);
  var damp=Math.pow(0.98,stepScale);
  var grav=0.4*stepScale;
  for(var i=0;i<Play.vines.length;i++){
    var v=Play.vines[i];
    _ensureVineNodes(v);
    var nodes=v._nodes;
    var segLen=v._segLen;
    var topX=v.x+(v.w||3)/2;
    var topY=v.y;
    // Verlet 积分
    for(var j=1;j<nodes.length;j++){
      var n=nodes[j];
      var vx=(n.x-n.px)*damp;
      var vy=(n.y-n.py)*damp;
      n.px=n.x; n.py=n.y;
      n.x+=vx;
      n.y+=vy+grav;
    }
    // 玩家带动
    if(p&&!p.dead){
      _vineImpulse(nodes, p.x+p.w/2, p.y+p.h/2, p.vx||0, 0.5, stepScale);
    }
    // 幽灵带动（用坐标差推速度）
    if(Play.ghosts&&Play.ghosts.length){
      for(var gi=0;gi<Play.ghosts.length;gi++){
        var gh=Play.ghosts[gi];
        if(!gh.released)continue;
        var gvx=(gh.x-gh.lastX)||0;
        var gvy=(gh.y-gh.lastY)||0;
        // 幽灵的运动速度通常很慢，加速度倍数放大
        _vineImpulse(nodes, gh.x+4, gh.y+4, gvx, 1.6, stepScale);
      }
    }
    // 约束迭代
    for(var iter=0;iter<5;iter++){
      nodes[0].x=topX; nodes[0].y=topY;
      nodes[0].px=topX; nodes[0].py=topY;
      for(var k=1;k<nodes.length;k++){
        var a=nodes[k-1], b=nodes[k];
        var ddx=b.x-a.x, ddy=b.y-a.y;
        var dist=Math.sqrt(ddx*ddx+ddy*ddy);
        if(dist<0.001)continue;
        var diff=(dist-segLen)/dist;
        if(k===1){
          b.x-=ddx*diff;
          b.y-=ddy*diff;
        }else{
          a.x+=ddx*diff*0.5;
          a.y+=ddy*diff*0.5;
          b.x-=ddx*diff*0.5;
          b.y-=ddy*diff*0.5;
        }
      }
    }
  }
}

// 向节点施加水平/垂直冲量：冲量 = 施力者速度 × 靠近衰减 × 位置衰减 × 全局系数
function _vineImpulse(nodes, srcX, srcY, srcVX, weight, stepScale){
  if(Math.abs(srcVX) < 0.05) return;
  for(var j=1;j<nodes.length;j++){
    var n=nodes[j];
    var dx=n.x-srcX, dy=n.y-srcY;
    var d2=dx*dx+dy*dy;
    if(d2 < 900){ // 30px 内
      var d=Math.sqrt(d2);
      var force=(30-d)/30;
      var frac=j/(nodes.length-1);
      n.px -= srcVX * force * frac * weight * stepScale;
    }
  }
}
function drawVineTo(g, v, playMode){
  _ensureVineNodes(v);
  var nodes=v._nodes;
  var color=v.color||'#88ddaa';
  var total=nodes.length-1;
  g.save();
  var glow=playMode?1:0.7;
  g.shadowBlur=4*glow;
  g.shadowColor=color;
  // 逐段绘制连续丝带（保证不断线）
  for(var i=0;i<nodes.length-1;i++){
    var p1=nodes[i], p2=nodes[i+1];
    var dx=p2.x-p1.x, dy=p2.y-p1.y;
    var segDist=Math.sqrt(dx*dx+dy*dy);
    var samples=Math.max(2,Math.ceil(segDist*2));
    for(var s=0;s<samples;s++){
      var t=s/samples;
      var x=p1.x+dx*t;
      var y=p1.y+dy*t;
      var frac=(i+t)/total;
      var thick=frac<0.3?2:1;
      _px(g, Math.round(x-thick/2), Math.round(y), thick, 1, color);
    }
  }
  g.shadowBlur=0;
  // 内芯高光（上半部）
  for(var i2=0;i2<nodes.length-1;i2++){
    var q1=nodes[i2], q2=nodes[i2+1];
    var midFrac=(i2+0.5)/total;
    if(midFrac>0.55)continue;
    var mx=(q1.x+q2.x)/2;
    var my=(q1.y+q2.y)/2;
    _pxDot(g, Math.round(mx), Math.round(my), 'rgba(255,255,255,0.5)');
  }
  // 顶端固定点 + 底端小球
  _pxDot(g, Math.round(nodes[0].x), Math.round(nodes[0].y), color);
  _pxDot(g, Math.round(nodes[total].x), Math.round(nodes[total].y), color);
  g.restore();
}

/* ============================================================
   奖杯绘制
   ============================================================ */
function drawTrophyTo(g, el){
  var x=Math.round(el.x), y=Math.round(el.y);
  var w=Math.round(el.w||12), h=Math.round(el.h||14);
  var t=Date.now()/1000;
  var bob=Math.sin(t*2.2 + x*0.15)*1.2;
  var cy=y+bob;
  g.save();
  // 光晕
  var gl=0.55+Math.sin(t*3)*0.35;
  g.globalAlpha=gl*0.5;
  var grad=g.createRadialGradient(x+w/2,cy+h/2,0,x+w/2,cy+h/2,h*1.5);
  grad.addColorStop(0,'rgba(255,220,90,0.9)');
  grad.addColorStop(0.6,'rgba(255,190,50,0.18)');
  grad.addColorStop(1,'rgba(255,190,50,0)');
  g.fillStyle=grad;
  g.beginPath();g.arc(x+w/2,cy+h/2,h*1.5,0,Math.PI*2);g.fill();
  g.globalAlpha=1;
  // 杯身
  var bodyW=Math.max(6,Math.round(w*0.72));
  var bodyH=Math.max(5,Math.round(h*0.42));
  var bodyX=x+Math.round((w-bodyW)/2);
  var bodyY=cy+Math.round(h*0.05);
  _px(g, bodyX, bodyY, bodyW, bodyH, '#d9a800');
  _px(g, bodyX+1, bodyY+1, bodyW-2, bodyH-2, '#ffd83a');
  _px(g, bodyX+1, bodyY+1, bodyW-2, 1, '#fff5b8');
  // 双耳
  var earY=bodyY+1, earH=Math.max(3,bodyH-3);
  _px(g, bodyX-2, earY, 2, earH, '#c99a00');
  _px(g, bodyX+bodyW, earY, 2, earH, '#c99a00');
  // 杯柱与底座
  var stemY=bodyY+bodyH;
  var stemH=Math.max(2,Math.round(h*0.18));
  _px(g, x+Math.floor(w/2)-1, stemY, 2, stemH, '#c99a00');
  var baseY=stemY+stemH;
  var baseH=Math.max(2,h-(baseY-y));
  _px(g, x+1, baseY, w-2, baseH, '#d9a800');
  _px(g, x+1, baseY, w-2, 1, '#fff5b8');
  // 星形高光
  _pxDot(g, bodyX+Math.floor(bodyW/2)-1, bodyY+Math.floor(bodyH/2)-1, '#ffffff');
  g.restore();
}

/* ============================================================
   开关 / 开关门绘制
   ============================================================ */
function drawSwitchTo(g, el, playMode){
  var x=Math.round(el.x), y=Math.round(el.y);
  var w=Math.max(8,Math.round(el.w||16)), h=Math.max(3,Math.round(el.h||4));
  // 底座凹槽
  _px(g, x, y, w, h, '#06171f');
  _px(g, x, y, w, 1, '#0e2a38');
  // 面板
  _px(g, x+1, y+1, w-2, h-2, '#0d2b38');
  // 顶部亮边
  _px(g, x, y, w, 1, '#00ddff');
  // 中央按钮
  var bx=x+Math.floor(w/2)-2;
  var by=y+Math.max(1,Math.floor(h/2)-1);
  _px(g, bx, by, 4, Math.max(1,h-2), '#0a4658');
  var glow=playMode?(0.65+Math.sin(Date.now()/220)*0.35):0.9;
  g.save();
  g.globalAlpha=glow;
  _pxDot(g, bx+1, by, '#66f2ff');
  _pxDot(g, bx+2, by+ (h>3?1:0), '#ffffff');
  g.restore();
  // 侧边指示灯
  _pxDot(g, x+2, y+Math.floor(h/2), '#00ffcc');
  _pxDot(g, x+w-3, y+Math.floor(h/2), '#00ffcc');
  if(playMode&&el._pressed){
    g.save();
    g.globalAlpha=0.55+Math.sin(Date.now()/120)*0.35;
    _px(g, x, y, w, h, '#00ddff');
    g.restore();
  }
}
function drawSwitchDoorTo(g, el, playMode){
  var ex=Math.round(el.x), ey=Math.round(el.y);
  var ew=Math.max(4,Math.round(el.w||8)), eh=Math.max(4,Math.round(el.h||40));
  var _prog;
  if(playMode){
    _prog=(el._openProgress!==undefined)?el._openProgress:(el.open?1:0);
  }else{
    _prog=el.initialOpen?1:0;
  }
  var _scale=1-_prog;
  if(_scale<=0.02){
    /* 参考压力板门：门体缩到 0 后几乎"消失"
       —— 仅保留极淡的青色残影 + 四边细亮线（呼吸），
          不再使用门楣/中央横线，视觉上彻底区分于"关闭" */
    var _t = Date.now() / 1000;
    var _pulse = 0.5 + 0.5 * Math.sin(_t * 2.5);
    // 极淡的青色残影填充
    g.save();
    g.globalAlpha = 0.05 + _pulse * 0.06;
    _px(g, ex, ey, ew, eh, '#00ddff');
    g.restore();
    // 四边细亮线（呼吸），表示此处仍有"门框"
    g.save();
    g.globalAlpha = 0.30 + _pulse * 0.35;
    _px(g, ex, ey, ew, 1, '#00eeff');
    _px(g, ex, ey+eh-1, ew, 1, '#00eeff');
    _px(g, ex, ey, 1, eh, '#00eeff');
    _px(g, ex+ew-1, ey, 1, eh, '#00eeff');
    g.restore();
    return;
  }
  var _orient=_getDoorOrientation(el);
  var _cx=ex+ew/2, _cy=ey+eh/2;
  var _nw,_nh,_nx,_ny;
  if(_orient==='h'){
    _nw=ew*_scale; _nh=eh; _nx=_cx-_nw/2; _ny=ey;
  }else{
    _nw=ew; _nh=eh*_scale; _nx=ex; _ny=_cy-_nh/2;
  }
  var x=Math.round(_nx), y=Math.round(_ny);
  var w=Math.max(1,Math.round(_nw)), h=Math.max(1,Math.round(_nh));
  g.save();
  if(playMode)g.globalAlpha=Math.min(1,_scale*1.5);
  _px(g, x, y, w, h, '#062736');
  for(var dy=0;dy<h;dy+=2){
    _pxDot(g, x+1, y+dy, '#00ddff');
    _pxDot(g, x+w-2, y+dy, '#008899');
  }
  _px(g, x, y, w, 1, '#88eeff');
  _px(g, x, y+h-1, w, 1, '#003344');
  if(playMode){
    g.globalAlpha=0.25+Math.sin(Date.now()/500)*0.15;
    _px(g, x, y, w, h, '#00ddff');
  }
  g.restore();
}

/* ============================================================
   水绘制：浅蓝滤镜 + 上浮气泡 + 玩家涟漪 + 融合
   ============================================================ */
function drawWaterTo(g, el, playMode){
  var x=Math.round(el.x), y=Math.round(el.y);
  var w=Math.round(el.w||32), h=Math.round(el.h||32);
  if(w<1||h<1)return;
  var t=Date.now()/1000;
  g.save();
  g.beginPath();g.rect(x,y,w,h);g.clip();

  // ---- 基础浅蓝滤镜 ----
  g.fillStyle='rgba(64,140,220,0.32)';
  g.fillRect(x,y,w,h);
  g.fillStyle='rgba(120,190,255,0.10)';
  g.fillRect(x,y,w,Math.max(1,Math.floor(h*0.4)));

  // ---- 上浮气泡 ----
  var totalBubbles=Math.max(3,Math.floor(w*h/260));
  for(var i=0;i<totalBubbles;i++){
    var seed=el.x*7+el.y*13+i*31;
    var bx=x+_pr(seed)*w;
    var speed=8+_pr(seed+1)*18;
    var by=y+h-((t*speed+_pr(seed+2)*h)%h);
    var br=0.6+_pr(seed+3)*2.0;
    var ba=0.35+_pr(seed+4)*0.45;
    g.strokeStyle='rgba(200,230,255,'+ba.toFixed(3)+')';
    g.lineWidth=0.55;
    g.beginPath();g.arc(bx,by,br,0,Math.PI*2);g.stroke();
    if(br>1.3){
      g.fillStyle='rgba(230,248,255,'+(ba*0.5).toFixed(3)+')';
      g.beginPath();g.arc(bx-br*0.3,by-br*0.35,br*0.22,0,Math.PI*2);g.fill();
    }
  }

  // ---- 玩家/幽灵移动产生的涟漪 ----
  var rippleSrcs=[];
  if(playMode){
    if(Play.player&&!Play.player.dead)rippleSrcs.push({x:Play.player.x+4,y:Play.player.y+4,vx:Play.player.vx||0});
    if(Play.ghosts){
      Play.ghosts.forEach(function(gh){
        if(!gh.released)return;
        var gvx=(gh.x-gh.lastX)||0;
        if(Math.abs(gvx)>0.05)rippleSrcs.push({x:gh.x+4,y:gh.y+4,vx:gvx});
      });
    }
  }
  rippleSrcs.forEach(function(src){
    if(src.x<x-30||src.x>x+w+30||src.y<y-30||src.y>y+h+30)return;
    var intensity=Math.min(1,Math.abs(src.vx)*0.8);
    if(intensity<0.05)return;
    for(var ri=0;ri<3;ri++){
      var phase=(t*2.2+ri*0.33)%1;
      var radius=phase*22;
      var alpha=(1-phase)*0.55*intensity;
      g.strokeStyle='rgba(220,240,255,'+alpha.toFixed(3)+')';
      g.lineWidth=0.8;
      g.beginPath();g.arc(src.x,src.y,radius,0,Math.PI*2);g.stroke();
    }
  });

  // ---- 水面高光带 ----
  g.fillStyle='rgba(190,225,255,0.55)';
  g.fillRect(x,y,w,1);
  g.fillStyle='rgba(255,255,255,0.22)';
  var waveOff=Math.sin(t*1.4+el.x*0.1)*3;
  for(var wx=0;wx<w;wx+=4){
    var wy=y+1+Math.sin((wx+waveOff)*0.35)*0.8;
    g.fillRect(x+wx,wy,2,1);
  }
  // ---- 水底暗调 ----
  g.fillStyle='rgba(10,30,60,0.22)';
  g.fillRect(x,y+h-2,w,2);
  g.restore();
}

/* ============================================================
   烟雾噪声纹理（fbm 生成，多次平铺叠加制造真实烟雾团）
   ============================================================ */
var _smokeNoiseTex = null;
function _getSmokeNoiseTex(){
  if(_smokeNoiseTex) return _smokeNoiseTex;
  var N = 256;
  var cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  var c2 = cv.getContext('2d');
  var img = c2.createImageData(N, N);
  var d = img.data;
  for(var y=0;y<N;y++){
    for(var x=0;x<N;x++){
      // 三层 fbm 叠加：大团 + 中团 + 细碎
      var n = _jsFbm(x*0.032, y*0.032)*0.55
            + _jsFbm(x*0.078, y*0.078)*0.30
            + _jsFbm(x*0.176, y*0.176)*0.15;
      // 阈值 + 平滑曲线，得到柔和有机的边缘
      var a = (n - 0.32) / 0.50;
      if(a < 0) a = 0; else if(a > 1) a = 1;
      a = a * a * (3 - 2 * a);
      var idx = (y*N + x) * 4;
      d[idx]   = 255;
      d[idx+1] = 255;
      d[idx+2] = 255;
      d[idx+3] = Math.round(a * 252);
    }
  }
  c2.putImageData(img, 0, 0);
  _smokeNoiseTex = cv;
  return cv;
}

function roundRectPath(g, x, y, w, h, r){
  if(r < 0.5){ g.rect(x,y,w,h); return; }
  if(r > w/2) r = w/2;
  if(r > h/2) r = h/2;
  g.beginPath();
  g.moveTo(x+r, y);
  g.lineTo(x+w-r, y);
  g.quadraticCurveTo(x+w, y, x+w, y+r);
  g.lineTo(x+w, y+h-r);
  g.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  g.lineTo(x+r, y+h);
  g.quadraticCurveTo(x, y+h, x, y+h-r);
  g.lineTo(x, y+r);
  g.quadraticCurveTo(x, y, x+r, y);
  g.closePath();
}
function _tileSmokeNoise(g, tex, sx, sy, sw, sh, tileSize, offX, offY, alpha, mode){
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  var ox = ((offX % tileSize) + tileSize) % tileSize;
  var oy = ((offY % tileSize) + tileSize) % tileSize;
  var x0 = sx - tileSize + ox;
  var y0 = sy - tileSize + oy;
  var xEnd = sx + sw + tileSize;
  var yEnd = sy + sh + tileSize;
  for(var ty = y0; ty < yEnd; ty += tileSize){
    for(var tx = x0; tx < xEnd; tx += tileSize){
      g.drawImage(tex, tx, ty, tileSize, tileSize);
    }
  }
  g.restore();
}

/* ============================================================
   烟雾编辑器预览
   ============================================================ */
function drawSmokePreviewTo(g, el){
  var x=Math.round(el.x), y=Math.round(el.y);
  var w=Math.round(el.w||64), h=Math.round(el.h||64);
  g.save();
  g.fillStyle='rgba(230,232,238,0.55)';
  g.fillRect(x,y,w,h);
  g.strokeStyle='rgba(255,255,255,0.85)';
  g.setLineDash([4,3]);
  g.lineWidth=1;
  g.strokeRect(x+0.5,y+0.5,w-1,h-1);
  g.setLineDash([]);
  g.fillStyle='rgba(255,255,255,0.75)';
  g.font='bold 10px Courier New';
  g.textAlign='center';
  g.fillText('烟雾',x+w/2,y+h/2+3);
  g.textAlign='left';
  g.restore();
}

/* ============================================================
   水草绘制（根部在下，上半部分摆动）
   ============================================================ */
function drawWaterGrassTo(g, el, playMode){
  _ensureWaterGrassNodes(el);
  var nodes=el._nodes;
  var x=Math.round(el.x), y=Math.round(el.y);
  var w=Math.max(2,Math.round(el.w||8));
  var h=Math.max(8,Math.round(el.h||16));
  var color=el.color||'#44bb88';
  var baseY=y+h;
  var topY=y;

  // 颜色解析（深→浅）
  var r0=0x1a,g0=0x6e,b0=0x4a;
  var r1=0x8f,g1=0xff,b1=0xcc;
  if(color&&/^#[0-9a-fA-F]{6}$/.test(color)){
    r0=parseInt(color.substr(1,2),16);
    g0=parseInt(color.substr(3,2),16);
    b0=parseInt(color.substr(5,2),16);
    r1=Math.min(255,Math.round(r0*1.55+45));
    g1=Math.min(255,Math.round(g0*1.22+45));
    b1=Math.min(255,Math.round(b0*1.35+45));
  }

  // 逐像素行绘制：对每一行 y 找节点插值出的 x
  var segs=nodes.length-1;
  for(var i=0;i<h;i++){
    var yy=baseY-1-i;              // 从根部往上
    var frac=i/(h-1);              // 0=根部，1=顶端
    var nodeIdx=frac*segs;
    var i1=Math.floor(nodeIdx);
    var i2=Math.min(i1+1,segs);
    var t=nodeIdx-i1;
    var xx=nodes[i1].x+(nodes[i2].x-nodes[i1].x)*t;

    // 叶片厚度：根部粗 → 顶部细
    var thick=Math.max(1, Math.round(w*0.55*(1-frac*0.65)));

    // 颜色插值
    var cr=Math.round(r0+(r1-r0)*frac);
    var cg=Math.round(g0+(g1-g0)*frac);
    var cb=Math.round(b0+(b1-b0)*frac);

    g.fillStyle='rgb('+cr+','+cg+','+cb+')';
    g.fillRect(Math.round(xx-thick/2), Math.round(yy), thick, 1);
  }

  // 顶端嫩芽高光（跟随顶端节点）
  var tipX=nodes[segs].x;
  _pxDot(g, Math.round(tipX), topY, 'rgba(235,255,240,0.95)');
  _pxDot(g, Math.round(tipX), topY+1, 'rgba(200,255,220,0.55)');

  if(playMode){
    g.save();
    g.globalAlpha=0.08;
    g.shadowBlur=10;
    g.shadowColor=color;
    g.fillStyle=color;
    g.fillRect(x, y, w, h);
    g.restore();
  }
}
