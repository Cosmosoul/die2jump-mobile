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
    /* ★支持 rgba()/rgb() 与 #rgb/#rrggbb/#rrggbbaa★
       旧版只认 `#`，一旦传入 `rgba(24,32,40,0.75)`（标签文字的**深色描边**）
       就静默回退成纯白 —— 白字描白边 = 完全没有对比度提升，
       在明亮场景里标签会糊成一团（这正是"文字不够清晰"的根因之一）。
       alpha 分量在这里**刻意丢弃**：位图只存"实心/透明"两态，
       描边的整体透明度由 drawPixelText 统一施加。 */
    if (!color) return { r: 255, g: 255, b: 255 };
    var s = String(color).trim();
    if (s[0] === '#') {
        if (s.length === 7) {
            return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
        }
        if (s.length === 4) {
            return { r: parseInt(s[1] + s[1], 16), g: parseInt(s[2] + s[2], 16), b: parseInt(s[3] + s[3], 16) };
        }
        if (s.length === 9) {   /* #rrggbbaa：忽略 aa */
            return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
        }
        return { r: 255, g: 255, b: 255 };
    }
    var m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        var parts = m[1].split(',');
        var r = parseInt(parts[0], 10), g = parseInt(parts[1], 10), b = parseInt(parts[2], 10);
        if (!isFinite(r)) r = 255; if (!isFinite(g)) g = 255; if (!isFinite(b)) b = 255;
        return { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) };
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
    /* ★字号下限 7 → 4★：编辑器标签要让玩家能把字调得更小（用户诉求）。
       下限必须与 drawPixelText 里的钳制保持一致，否则会出现
       "编辑器显示 4、实际按 7 画"的两套标准。 */
    size = Math.max(4, Math.round(size || 10));
    color = color || '#ffffff';
    ps = (typeof ps === 'number' && isFinite(ps) && ps > 0) ? Math.max(0.05, Math.min(8, ps)) : 0.5;
    var key = size + '|' + ps + '|' + color + '|' + text;
    var hit = _pxTextCache[key];
    if (hit) return hit;

    /* 目标世界尺寸：高度只由 size 决定（与文本长度、ps 都无关）。
       字高 ≈ size*1.5 世界单位，垂直居中于 size*2+10 高的行框内。 */
    var boxH = size * 2 + 10;                /* 世界单位（决定行高与留白） */
    var rows = Math.max(2, Math.min(1024, Math.round(boxH / ps)));
    var worldGlyphH = size * 1.5;            /* 世界单位下的字高 */
    /* ★超采样倍率按"输出位图上的字高"自适应★：
       小字号在输出位图上只有几行像素 —— 固定 SS=4 时，抗锯齿产生的灰边
       在二值化后会把细笔画整条吃掉（字看起来缺胳膊少腿、不清晰）。
       提高 SS 让字形先在高分辨率下成形、再降采样二值化，细笔画得以保留，
       这正是"标签文字更清晰"的关键。SS 有上界（输出字高越小才会变大），
       因此超大字号仍用 4，不会撑爆位图。 */
    var outGlyphRows = worldGlyphH / ps;     /* 输出位图上的字高（逻辑像素行数） */
    var SS = outGlyphRows < 8 ? 8 : (outGlyphRows < 16 ? 6 : 4);   /* 超采样倍率 */
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
    /* 上限 96 → 384：选关页要为 20 关的「关号 / 关卡名 / 时间值 / 按钮标签」
       各建 1~2 个变体（含描边色），加上页首固定文案共约 100~130 条。
       上限 96 会导致**边预热边被驱逐**（预热白做，且每次重进选关页又冷建一遍）。
       每个位图很小（10 号字、高度约 30px），384 条的内存代价可忽略。
       仍然是 FIFO 有界缓存，不会无限增长。 */
    if (_pxTextCacheOrder.length > 384) {
        var oldKey = _pxTextCacheOrder.shift();
        delete _pxTextCache[oldKey];
    }
    return result;
}

function drawPixelText(g, text, cx, cy, size, color, bgColor, alpha, pixelSize, outlineColor) {
    if (text === undefined || text === null || text === '') return;
    if (alpha !== undefined && alpha <= 0.01) return;

    /* ★下限与 _getPxTextBitmap 严格一致（4）★：否则会出现
       "小的被钳到 7、缓存键却是 4"的错配。 */
    size = Math.max(4, Math.round(size || 10));
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

    /* ★克制的深色描边★：亮背景上的小字靠它拉开对比。
       必须画**八邻域**（含四个对角）—— 只画上下左右的话，笔画斜向末端
       会露出破口，远看就是"字被啃掉一角"。对角用更低透明度，避免糊成黑块。 */
    if (outlineColor) {
        var ob = _getPxTextBitmap(text, size, outlineColor, ps);
        var oa = (alpha === undefined ? 1 : alpha);
        g.globalAlpha = oa * 0.72;
        g.drawImage(ob.canvas, x0 - ps, y0, targetW, targetH);
        g.drawImage(ob.canvas, x0 + ps, y0, targetW, targetH);
        g.drawImage(ob.canvas, x0, y0 - ps, targetW, targetH);
        g.drawImage(ob.canvas, x0, y0 + ps, targetW, targetH);
        g.globalAlpha = oa * 0.5;
        g.drawImage(ob.canvas, x0 - ps, y0 - ps, targetW, targetH);
        g.drawImage(ob.canvas, x0 + ps, y0 - ps, targetW, targetH);
        g.drawImage(ob.canvas, x0 - ps, y0 + ps, targetW, targetH);
        g.drawImage(ob.canvas, x0 + ps, y0 + ps, targetW, targetH);
        g.globalAlpha = oa;
    }

    g.drawImage(bmp.canvas, x0, y0, targetW, targetH);
    g.restore();
}
/* ============ 背景形状 & 动态着色器 ============ */
/* WS-D② 新增 12 个「几何图形」——全部是纯 path，零资源、零加载开销。
   设计意图（对应需求书"重新设计一批真正好看的几何图形"）：
     · 与已有 21 个 shader 组合出更丰富的背景（例如 crystal×frostCrystal、blob×lavaLamp）；
     · 参考蔚蓝/动物井的"柔和有机轮廓"（blob / leaf / droplet / crescent）；
     · 参考泰拉瑞亚/闰跃之年的"远景剪影"（mountainPath / spike / waveBand / arch）。
   全部为**确定性**几何（无随机，靠 sh.points 可调细节），保证同参数同结果。 */
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
  /* ============ WS-D② 新增开始 ============ */
  else if (shape === 'crystal') {
    /* 多面体棱柱：上下两个尖，两侧对称阶梯。配 caustics / frostCrystal 极佳 */
    var cxm = x + w/2, seg = Math.max(3, sh.points || 6);
    g.moveTo(cxm, y);
    g.lineTo(x + w, y + h * 0.30);
    for (var ci = 1; ci < seg; ci++) {
      var t = ci / seg;
      g.lineTo(x + w - w * 0.42 * t, y + h * (0.30 + 0.40 * t));
    }
    g.lineTo(cxm, y + h);
    for (var cj = seg - 1; cj >= 1; cj--) {
      var t2 = cj / seg;
      g.lineTo(x + w * 0.42 * t2, y + h * (0.30 + 0.40 * t2));
    }
    g.lineTo(x, y + h * 0.30);
    g.closePath();
  } else if (shape === 'leaf') {
    /* 叶形：两段对称二次曲线交汇于上下尖点 */
    g.moveTo(x + w/2, y);
    g.quadraticCurveTo(x + w, y + h * 0.22, x + w/2, y + h);
    g.quadraticCurveTo(x, y + h * 0.22, x + w/2, y);
    g.closePath();
  } else if (shape === 'droplet') {
    /* 水滴：上尖下圆 */
    var dcx = x + w/2;
    g.moveTo(dcx, y);
    g.bezierCurveTo(x + w, y + h * 0.35, x + w, y + h * 0.85, dcx, y + h);
    g.bezierCurveTo(x, y + h * 0.85, x, y + h * 0.35, dcx, y);
    g.closePath();
  } else if (shape === 'ring') {
    /* 圆环（evenodd 挖孔）：外层顺时针 + 内层逆时针 */
    var orx = Math.min(w, h) / 2, irr = orx * 0.55;
    var rgx = x + w/2, rgy = y + h/2;
    g.moveTo(rgx + orx, rgy);
    g.arc(rgx, rgy, orx, 0, Math.PI * 2, false);
    g.moveTo(rgx + irr, rgy);
    g.arc(rgx, rgy, irr, 0, Math.PI * 2, true);
    g.closePath();
  } else if (shape === 'hexagon') {
    /* 正六边形（等角，非拉伸多边形） */
    var hcx = x + w/2, hcy = y + h/2, hr = Math.min(w, h) / 2;
    for (var hi = 0; hi < 6; hi++) {
      var ha = -Math.PI/2 + hi * Math.PI / 3;
      var hpx = hcx + Math.cos(ha) * hr, hpy = hcy + Math.sin(ha) * hr;
      if (hi === 0) g.moveTo(hpx, hpy); else g.lineTo(hpx, hpy);
    }
    g.closePath();
  } else if (shape === 'spike') {
    /* 尖刺群：底边水平、顶部多个高低错落的尖齿（远景山林/荆棘剪影）。
       sh.points 控制尖齿数量（默认 5）。 */
    var spn = Math.max(2, Math.round(sh.points || 5)), spbase = y + h;
    g.moveTo(x, spbase);
    for (var si = 0; si < spn; si++) {
      var su0 = si / spn, su1 = (si + 0.5) / spn, su2 = (si + 1) / spn;
      /* 齿尖高度按确定性哈希错落，避免整齐一刀切 */
      var shgt = h * (0.55 + 0.45 * (((si * 61 + 17) % 100) / 100));
      g.lineTo(x + w * su0, spbase - h * 0.06);
      g.lineTo(x + w * su1, spbase - shgt);
      g.lineTo(x + w * su2, spbase - h * 0.06);
    }
    g.closePath();
  } else if (shape === 'waveBand') {
    /* 波浪带：上下两条正弦边（海面 / 云带） */
    var wbx = 0, wstep = Math.max(6, Math.round(w / 24));
    for (wbx = 0; wbx <= w; wbx += wstep) {
      var wu = wbx / w;
      var wtop = y + h * 0.18 + Math.sin(wu * Math.PI * 2 + 0.4) * h * 0.14;
      if (wbx === 0) g.moveTo(x, wtop); else g.lineTo(x + wbx, wtop);
    }
    for (wbx = w; wbx >= 0; wbx -= wstep) {
      var wu2 = wbx / w;
      var wbot = y + h * 0.82 + Math.sin(wu2 * Math.PI * 2 + 1.9) * h * 0.14;
      g.lineTo(x + wbx, wbot);
    }
    g.closePath();
  } else if (shape === 'mountainPath') {
    /* 山脊：多峰折线（峰数由 sh.points 控制） */
    var mpk = Math.max(2, sh.points || 4), mpbase = y + h;
    g.moveTo(x, mpbase);
    for (var mi = 0; mi < mpk; mi++) {
      var mt = (mi + 0.5) / mpk;
      var mh = h * (0.45 + 0.55 * (((mi * 37) % 100) / 100));
      g.lineTo(x + w * mt, mpbase - mh);
      g.lineTo(x + w * (mi + 1) / mpk, mpbase - h * 0.10 * (((mi * 53) % 100) / 100));
    }
    g.lineTo(x + w, mpbase);
    g.closePath();
  } else if (shape === 'arch') {
    /* 拱门：半圆 + 两柱 */
    var acx = x + w/2, ar = w/2, acy = y + ar;
    var postW = w * 0.16;
    g.moveTo(x, y + h);
    g.lineTo(x, acy);
    g.arc(acx, acy, ar, Math.PI, 0, false);
    g.lineTo(x + w, y + h);
    g.lineTo(x + w - postW, y + h);
    g.lineTo(x + w - postW, y + h * 0.55);
    g.lineTo(x + postW, y + h * 0.55);
    g.lineTo(x + postW, y + h);
    g.closePath();
  } else if (shape === 'blob') {
    /* 有机团块：极坐标正弦扰动（动物井风）。sh.points 控制起伏阶数 */
    var blcx = x + w/2, blcy = y + h/2, blr = Math.min(w, h) / 2;
    var blk = Math.max(2, sh.points || 3), blSteps = 40;
    for (var bi = 0; bi <= blSteps; bi++) {
      var ba = bi / blSteps * Math.PI * 2 - Math.PI/2;
      var brad = blr * (0.78 + 0.22 * Math.sin(ba * blk + 0.7));
      var bpx = blcx + Math.cos(ba) * brad * (w / Math.min(w, h));
      var bpy = blcy + Math.sin(ba) * brad * (h / Math.min(w, h));
      if (bi === 0) g.moveTo(bpx, bpy); else g.lineTo(bpx, bpy);
    }
    g.closePath();
  } else if (shape === 'crescent') {
    /* 月牙：外圆 + 内切圆（evenodd 成弯月） */
    var mrx = Math.min(w, h) / 2, mcX = x + w/2, mcY = y + h/2;
    g.moveTo(mcX + mrx, mcY);
    g.arc(mcX, mcY, mrx, 0, Math.PI * 2, false);
    g.moveTo(mcX + mrx * 0.92, mcY);
    g.arc(mcX + mrx * 0.45, mcY, mrx * 0.92, 0, Math.PI * 2, true);
    g.closePath();
  } else if (shape === 'diamond') {
    /* 菱形（旋转正方，等比不拉伸） */
    var ddx = x + w/2, ddy = y + h/2;
    g.moveTo(ddx, y); g.lineTo(x + w, ddy); g.lineTo(ddx, y + h); g.lineTo(x, ddy);
    g.closePath();
  }
  /* ============ WS-D② 新增结束 ============ */
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

/* ============================================================
   WS-D③ 颗粒参数槽（颗粒数量 / 颗粒大小）
   由 fillBgShader 在**调用 shader 前**设置、**逐像素循环之后**还原。
   为什么用模块级槽而不是改 21 个 shader 的签名：
     · 改签名 = 21 处回归面；参数槽 = 1 处设置，含颗粒的 shader 按需读取。
   纪律：
     · 必须"循环前设置、循环后还原"，否则多形状之间会串味；
     · 参数必须进缓存键（见 _bgParticleKey）⇒ 调参才会重建。
   ============================================================ */
var _bgPD = 1;   /* 颗粒密度倍率（>1 更密） */
var _bgPS = 1;   /* 颗粒大小倍率（>1 更大） */

function _bgParticleActive(sh){
  return !!sh && ((typeof sh.density === 'number' && sh.density !== 1)
               || (typeof sh.grainSize === 'number' && sh.grainSize !== 1));
}
function _bgParticleKey(sh){
  if (!sh) return '';
  var d = (typeof sh.density === 'number' && isFinite(sh.density) && sh.density > 0) ? sh.density : 1;
  var s = (typeof sh.grainSize === 'number' && isFinite(sh.grainSize) && sh.grainSize > 0) ? sh.grainSize : 1;
  return '@' + d + ',' + s;
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
  var cix = Math.floor(ux * 80 / _bgPS), ciy = Math.floor(uy * 80 / _bgPS);
  var h = _jsHash1(cix, ciy);
  var star = h >= (0.94 / _bgPD) ? 1 : 0;
  var tw = 0.5 + 0.5 * Math.sin(t * 4 + h * 12);
  var add = star * tw * 1.5 * _bgPS;
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
  /* WS-D③：density↑ ⇒ 瓣的「数量」增加（而不是把固定的 20 瓣摊薄到大 tile 上，
     后者反而会让画面更稀疏 —— 这正是初版断言失败的原因） */
  var tile = 4;
  /* WS-D③：size↑ 让光斑更"胖"（smoothstep 外沿更远），瓣更大更明显 */
  var pE0 = 0.14 * _bgPS;
  var _cnt = Math.round(20 * _bgPD); if (_cnt < 4) _cnt = 4; if (_cnt > 60) _cnt = 60;
  for (var k = 0; k < _cnt; k++) {
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
    var petal = _jsSmoothstep(pE0, 0.02, dist);
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
  /* WS-D③：density↑ ⇒ 萤火虫「数量」增加；size↑ ⇒ glow 更亮更"胖" */
  var tile = 3;
  var gGain = 0.0015 * _bgPS;
  var _cnt = Math.round(20 * _bgPD); if (_cnt < 4) _cnt = 4; if (_cnt > 60) _cnt = 60;
  for (var k = 0; k < _cnt; k++) {
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
    var glow = gGain / (dist * dist + 0.0002);
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
  /* WS-D③：density↑ ⇒ 雨滴「数量」增加；size↑ ⇒ 雨丝更粗 */
  var tile = 3;
  var lw = 0.04 * _bgPS;
  var _cnt = Math.round(15 * _bgPD); if (_cnt < 4) _cnt = 4; if (_cnt > 60) _cnt = 60;
  for (var k = 0; k < _cnt; k++) {
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
    var line = _jsSmoothstep(lw, 0, adx) * (ady <= 0.6 ? 1 : 0);
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
  /* WS-D③：大小↑ ⇒ 单星更亮更"胖"；密度↑ ⇒ 星星更多（阈值下调） */
  var ux = wx * 0.01 * _bgPS, uy = wy * 0.01 * _bgPS;
  var cr = c2r, cg = c2g, cb = c2b;
  var starTh = 0.82 - 0.14 * (_bgPD - 1);
  if (starTh < 0.35) starTh = 0.35;
  for (var li = 0; li < 4; li++) {
    var fi = li;
    var density = (20 + fi * 25) / _bgPS;
    var px = ux * density + fi * 7.3;
    var py = uy * density + fi * 7.3;
    var ipx = Math.floor(px), ipy = Math.floor(py);
    var fpx = px - ipx - 0.5, fpy = py - ipy - 0.5;
    var h = _jsHash1(ipx, ipy);
    var starActive = h >= starTh ? 1 : 0;
    var dd = Math.sqrt(fpx * fpx + fpy * fpy);
    var tw = 0.4 + 0.6 * Math.sin(t * (1.5 + h * 4) + h * 12);
    var star = Math.exp(-dd * 22) * tw * starActive;
    var add = star * (1.2 - fi * 0.22) * _bgPS;
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
  /* WS-D③：颗粒感旋钮 —— 泡沫细节频率与混合量 */
  var n = _jsFbm(ux * 5 * _bgPD + tt, uy * 5 * _bgPD + tt);
  v = _jsMix(v, n, 0.35 * _bgPS > 1 ? 1 : 0.35 * _bgPS);
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
  /* WS-D③：颗粒（像素块）数量与大小 —— 密度↑ 格更密，大小↑ 块更大 */
  var _pq = 40 * _bgPD / _bgPS;
  if (_pq < 4) _pq = 4; if (_pq > 400) _pq = 400;
  var pqx = Math.floor(ux * _pq) / _pq;
  var pqy = Math.floor(uy * _pq) / _pq;
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

/* === 启动性能：预视图的「临时渲染通道」 ===
   问题：选关缩略图 preview() 只有 340x150，却会对**每个**背景形状按真实尺寸
   （单个最大可达 3150x1432）各分配一块离屏画布；而且这些画布被 _presetRenderCache
   以 WeakMap 挂在 shape 对象上，只要关卡数据还活着就永不释放。
   20 关共约 8299 个形状 → 实测阻塞主线程 87 秒 + 巨量内存（4K 下直接崩渲染进程）。

   解法：preview 期间置 _bgEphemeral，drawBgShape 改走这条通道 ——
   共享**一块**小画布、尺寸按目标上限限幅、且**完全不写**持久缓存。
   渲染时仍调用同一套 _presetFn，因此观感与正常路径一致，只是分辨率够用即可。

   注意：仅缩小画布尺寸**不足以**省时间。真正的杠杆是**按输出足迹派网格**。
   实测（_pxprobe.cjs / _zprobe.cjs）：level1 的 438 个预设形状若按世界尺寸
   派网格，共 586 万格；按输出足迹（w*z，z≈0.17~0.34）派，只需 69 万格。
   全 20 关：172,291,401 格 → 9,474,148 格（5.5%，约 18 倍）。
   但多个 _ps* 函数带 Math.max(60/40,…) 网格下限，故另加每形状 cellBudget 闸。
   默认 null → 游戏内路径逐字不变（零回归）。 */
var _bgEphemeral = null;      /* {canvas, ctx, maxPx, cellBudget, scale, ss, pxPerCell} */

function _bgEphBegin(maxPx, cellBudget, scale, ss, pxPerCell) {
  _bgEphemeral = _bgEphemeral || { canvas: document.createElement('canvas'), ctx: null };
  _bgEphemeral.maxPx = maxPx || 512;
  _bgEphemeral.cellBudget = cellBudget || 512;
  _bgEphemeral.scale = (scale > 0 && isFinite(scale)) ? scale : 1;
  /* ss：相对**输出像素**的过采样倍数（1=刚好输出分辨率，2=两倍，视觉更顺）。
     pxPerCell：每个网格格最多覆盖多少画布像素（越小越精细、越慢）。 */
  _bgEphemeral.ss = (ss > 0 && isFinite(ss)) ? ss : 1;
  _bgEphemeral.pxPerCell = (pxPerCell > 0 && isFinite(pxPerCell)) ? pxPerCell : 6;
  if (!_bgEphemeral.ctx) _bgEphemeral.ctx = _bgEphemeral.canvas.getContext('2d');
  return _bgEphemeral;
}
function _bgEphEnd() { _bgEphemeral = null; }

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

/* ============================================================
   WS-D① 背景几何图形「颜色校正」
   五个可调参数（对「几何图形」与「预设图案」两条渲染路径**都生效**）：
     sat        饱和度   0=全灰   1=原色   2=双倍艳
     contrast   对比度   绕中灰 0.5 缩放
     brightness 亮度     直接乘
     vibrancy   鲜明度   只抬「低饱和」部分（保护已鲜艳区不溢出）
     grayscale  灰度     向亮度混合
   设计要点：
   · 21 个 shader 与所有预设图案**共用同一套公式**，不改任何一个 shader 实现；
   · 只在**缓存重建时**执行一次（参数已进缓存键）⇒ 正常游玩零额外开销；
   · shader 路径的 ImageData ≤64x64（见 fillBgShader 的 budget），代价可忽略；
   · 预设路径在离屏画布上做一次 getImageData/putImageData，与已发生的
     百万级 _presetFn 绘制相比是小头，且同样只在重建时发生。
   · 全部参数缺省时 _bgColorAdjActive 返回 false ⇒ **老数据零回归**。
   ============================================================ */
function _applyColorAdj(r, g, b, adj){
  var lum = 0.2126*r + 0.7152*g + 0.0722*b;
  var gs = adj.grayscale || 0;
  if (gs > 0){ r += (lum-r)*gs; g += (lum-g)*gs; b += (lum-b)*gs; }
  var sat = (adj.sat === undefined) ? 1 : adj.sat;
  if (sat !== 1){ r = lum + (r-lum)*sat; g = lum + (g-lum)*sat; b = lum + (b-lum)*sat; }
  var vib = (adj.vibrancy === undefined) ? 1 : adj.vibrancy;
  if (vib !== 1){
    var mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    var s = (mx-mn)/255; if (s > 1) s = 1;
    var vm = 1 + (vib-1)*(1-s);
    r = lum + (r-lum)*vm; g = lum + (g-lum)*vm; b = lum + (b-lum)*vm;
  }
  var con = (adj.contrast === undefined) ? 1 : adj.contrast;
  if (con !== 1){ r = (r-128)*con+128; g = (g-128)*con+128; b = (b-128)*con+128; }
  var bri = (adj.brightness === undefined) ? 1 : adj.brightness;
  if (bri !== 1){ r *= bri; g *= bri; b *= bri; }
  return [ r<0?0:(r>255?255:r), g<0?0:(g>255?255:g), b<0?0:(b>255?255:b) ];
}
function _bgColorAdjOf(sh){
  return { sat: sh.sat, contrast: sh.contrast, brightness: sh.brightness,
           vibrancy: sh.vibrancy, grayscale: sh.grayscale };
}
function _bgColorAdjActive(sh){
  if (!sh) return false;
  return (sh.sat !== undefined && sh.sat !== 1)
      || (sh.contrast !== undefined && sh.contrast !== 1)
      || (sh.brightness !== undefined && sh.brightness !== 1)
      || (sh.vibrancy !== undefined && sh.vibrancy !== 1)
      || ((sh.grayscale || 0) > 0);
}
/* 供缓存键使用：把五个参数压成短串，参数一变键就变 ⇒ 必定重建 */
function _bgColorAdjKey(sh){
  if (!sh) return '';
  return '|' + (sh.sat===undefined?1:sh.sat) + ',' + (sh.contrast===undefined?1:sh.contrast)
       + ',' + (sh.brightness===undefined?1:sh.brightness) + ',' + (sh.vibrancy===undefined?1:sh.vibrancy)
       + ',' + (sh.grayscale||0);
}
function _applyColorAdjImageData(imgData, sh){
  if (!_bgColorAdjActive(sh)) return;
  var adj = _bgColorAdjOf(sh);
  var d = imgData.data;
  for (var i = 0; i < d.length; i += 4){
    if (d[i+3] === 0) continue;          /* 全透明像素直接跳过（省一大半） */
    var c = _applyColorAdj(d[i], d[i+1], d[i+2], adj);
    d[i] = c[0]; d[i+1] = c[1]; d[i+2] = c[2];
  }
}
function _applyColorAdjCanvas(ctx, w, h, sh){
  if (!_bgColorAdjActive(sh)) return;
  var id = ctx.getImageData(0, 0, w, h);
  _applyColorAdjImageData(id, sh);
  ctx.putImageData(id, 0, 0);
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
          + (sh.color || '') + '|' + (sh.color2 || '') + '|' + (sh.speed || 1)
          + _bgColorAdjKey(sh) + _bgParticleKey(sh);
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
    /* WS-D③：设置颗粒参数槽（逐像素循环之后必须还原，防止多形状串味） */
    _bgPD = (typeof sh.density === 'number' && isFinite(sh.density) && sh.density > 0) ? sh.density : 1;
    _bgPS = (typeof sh.grainSize === 'number' && isFinite(sh.grainSize) && sh.grainSize > 0) ? sh.grainSize : 1;
    for (var py = 0; py < imgH; py++) {
      var wy = y + (py + 0.5) * sY;
      for (var px = 0; px < imgW; px++) {
        var wx = x + (px + 0.5) * sX;
        fn(wx, wy, tVal, c1[0], c1[1], c1[2], c2[0], c2[1], c2[2], d, idx);
        idx += 4;
      }
    }
    _bgPD = 1; _bgPS = 1;
    cache.ctx.putImageData(cache.imgData, 0, 0);
    /* WS-D①：着色器输出后统一做一次颜色校正（缓存重建时才执行） */
    if (_bgColorAdjActive(sh)) {
      _applyColorAdjImageData(cache.imgData, sh);
      cache.ctx.putImageData(cache.imgData, 0, 0);
    }
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
    /* 临时通道（preview 缩略图专用）。见文件上方 _bgEphemeral 的说明。
       关键 1：必须把**缩略图空间的 w/h** 传给 _presetFn，而不是只缩放 ctx。
       关键 2：降采样系数取 min(z, maxPx/最长边) —— z 是形状在缩略图里的
       真实缩放（0.17~0.34），仅用小画布上限会漏掉绝大多数字形（它们本就
       小于上限）。 */
    if (_bgEphemeral) {
      var _zS = (_bgEphemeral.scale || 1) * (_bgEphemeral.ss || 1);
      var _k = Math.min(_zS, _bgEphemeral.maxPx / Math.max(1, Math.max(w, h)));
      if (!(_k > 0) || !isFinite(_k)) _k = 1;
      var _ew = Math.max(1, Math.round(w * _k));
      var _eh = Math.max(1, Math.round(h * _k));
      var _ec = _bgEphemeral.canvas, _ep = _bgEphemeral.ctx;
      if (_ec.width !== _ew || _ec.height !== _eh) { _ec.width = _ew; _ec.height = _eh; }
      _ep.setTransform(1, 0, 0, 1, 0, 0);
      _ep.clearRect(0, 0, _ew, _eh);
      _ep.save();
      if (_glow > 0.01) { _ep.shadowBlur = 12 * _glow * _pulse * _k; _ep.shadowColor = _gc; }
      else { _ep.shadowBlur = 0; }
      /* 网格预算由 _pxGrid 在临时通道下自行读取（见 _pxGrid 内 cellBudget 分支）。 */
      try { _presetFn(_ep, 0, 0, _ew, _eh, _c1, _c2, 1.0, _gc, _glow); } catch (e) { }
      _ep.restore();
      /* WS-D①：缩略图临时通道同样套用颜色校正（预览与正式观感一致） */
      _applyColorAdjCanvas(_ep, _ew, _eh, sh);
      var _edA = alpha;
      if (_psp > 0.0001) _edA = alpha * (0.85 + 0.15 * _pulse);
      g.globalAlpha = _edA;
      g.imageSmoothingEnabled = false;
      g.drawImage(_ec, 0, 0, _ew, _eh, x, y, w, h);
      g.globalAlpha = 1;
      g.restore();
      return;
    }
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
                  + _glow.toFixed(2) + _bgColorAdjKey(sh);
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
      /* WS-D①：预设图案离屏画布上的颜色校正（同样只在重建时执行一次） */
      _applyColorAdjCanvas(_pctx, _pcache.canvas.width, _pcache.canvas.height, sh);
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
  /* === 临时通道（preview 缩略图）下的网格预算 ===
     多个 _ps* 函数给网格设了 Math.max(60/40,…) 之类下限，
     即便传入缩略图尺寸的 w/h 也压不下去（440 个形状仍要 ~590 万格）。
     缩略图只有 340x150，完全不需要这种密度 → 按面积预算等比收缩两侧。
     注意 cs/rs 归一化对「缩小」同样成立：fn 看到的 c*cs 依旧落在 0..cols，
     只是采样点变稀，图案语义（轮廓/雪线/噪点）不变。
     仅当 _bgEphemeral 激活时生效 → 游戏内路径逐字不变（零回归）。 */
  if (typeof _bgEphemeral === 'object' && _bgEphemeral && _bgEphemeral.cellBudget > 0) {
    var _area = useCols * useRows;
    /* 预算 = 画布面积 / 每格像素²（w,h 此时已是**画布空间**尺寸）。
       ppc=每格覆盖多少画布像素：越小越精细、越慢。
       再用 cellBudget 作绝对上限（跨整屏的大形状不至于失控）。 */
    var _ppc = _bgEphemeral.pxPerCell > 0 ? _bgEphemeral.pxPerCell : 2.5;
    var _tgt = Math.ceil((w * h) / (_ppc * _ppc));
    var _bud = Math.max(48, Math.min(_bgEphemeral.cellBudget, _tgt));
    if (_area > _bud) {
      var _f = Math.sqrt(_bud / _area);
      useCols = Math.max(2, Math.round(useCols * _f));
      useRows = Math.max(2, Math.round(useRows * _f));
    }
  }
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
}/* ============================================================
   WS-D② 新增 12 个「预设像素图案」
   全部程序化（无外部图片资源）：
     · 归一化坐标 (u,v) + _pxGrid 派格，与既有 25 个图案同一套写法；
     · 随机部分一律走 _pr()（确定性哈希）⇒ 同参数同结果，缩略图与正式一致；
     · 颜色一律由 c1/c2 派生（_tint/_shadeC/_mixHex）⇒ 跟随编辑器的「主色/辅色」；
     · 每个图案都留出透明背景 ⇒ 与 shader 底、颜色校正、图层叠放天然兼容。
   ============================================================ */

/* 点到线段的距离（珊瑚 / 竹 / 桥 / 仙人掌等"骨架式"图案的公共基元） */
function _psSegD(px,py,ax,ay,bx,by){
  var dx=bx-ax, dy=by-ay;
  var l2=dx*dx+dy*dy;
  var t=l2>0?((px-ax)*dx+(py-ay)*dy)/l2:0;
  if(t<0)t=0; else if(t>1)t=1;
  var qx=ax+dx*t-px, qy=ay+dy*t-py;
  return Math.sqrt(qx*qx+qy*qy);
}

/* 1) 极光帘 —— 竖向褶皱光帘，自下渐隐 */
function _psAurora(g,x,y,w,h,c1,c2,pulse){
  var cols=48, rows=32;
  var hi=_tint(c1,0.70), mid=c1, lo=_mixHex(c1,c2,0.45), dark=_mixHex(c1,c2,0.78);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var band=0;
    for(var k=0;k<3;k++){
      var cx=0.16+k*0.34+Math.sin(v*2.6+k*1.7)*0.07;
      var sw=0.09+0.03*Math.sin(v*5.2+k*2.1);
      var dd=Math.abs(u-cx)/sw;
      var b=1-dd*dd;
      if(b>band)band=b;
    }
    var val=band*(1.05-v*1.25);
    if(val<=0.03)return null;
    if(val>0.70)return hi;
    if(val>0.45)return mid;
    if(val>0.22)return lo;
    return dark;
  });
}

/* 2) 珊瑚礁 —— 主干 + 多级分叉 */
function _psCoral(g,x,y,w,h,c1,c2,pulse){
  var cols=52, rows=30;
  var hi=_tint(c1,0.55), mid=c1, lo=_mixHex(c1,c2,0.45), dark=_mixHex(c1,c2,0.72);
  var segs=[];
  for(var i=0;i<5;i++){
    var bx=0.10+i*0.20+(_pr(i*7.1)-0.5)*0.05;
    var top=0.16+_pr(i*3.3)*0.20;
    segs.push([bx,0.98,bx,top,0.030]);
    for(var b=0;b<3;b++){
      var dir=(b%2===0)?1:-1;
      var ty=top+0.12+b*0.10;
      var ex=bx+dir*(0.06+b*0.035);
      segs.push([bx,ty,ex,ty-0.09,0.020]);
    }
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var best=1;
    for(var i=0;i<segs.length;i++){
      var s=segs[i];
      var d=_psSegD(u,v,s[0],s[1],s[2],s[3])/s[4];
      if(d<best)best=d;
      if(best<=0)break;
    }
    if(best>1)return null;
    var shade=1-best;
    if(shade>0.62)return hi;
    if(shade>0.34)return mid;
    if(shade>0.14)return lo;
    return dark;
  });
}

/* 3) 竹林 —— 直立竹节 + 叶 */
function _psBamboo(g,x,y,w,h,c1,c2,pulse){
  var cols=44, rows=34;
  var hi=_tint(c1,0.62), mid=c1, lo=_mixHex(c1,c2,0.42), dark=_mixHex(c1,c2,0.70);
  var culms=[];
  for(var i=0;i<6;i++){
    culms.push({x:0.07+i*0.17+(_pr(i*4.7)-0.5)*0.04, w:0.016+_pr(i*2.9)*0.012, top:0.10+_pr(i*6.1)*0.22});
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<culms.length;i++){
      var cm=culms[i];
      var dx=Math.abs(u-cm.x);
      if(v>cm.top && dx<cm.w){
        /* 竹节：每 0.14 高度画一道深色环 */
        var node=Math.abs(((v*7)%1)-0.5);
        if(node<0.10) return dark;
        return dx<cm.w*0.42 ? hi : mid;
      }
      /* 叶：在竹的上半部斜出 */
      if(v>cm.top && v<cm.top+0.30){
        var side=(i%2===0)?1:-1;
        var ly=cm.top+0.06+((i*3)%4)*0.05;
        var ld=_psSegD(u,v,cm.x,ly,cm.x+side*0.10,ly-0.10)/0.014;
        if(ld<1) return _mixHex(c1,c2,0.20);
      }
    }
    return null;
  });
}

/* 4) 蘑菇丛 —— 伞盖 + 柄 + 白点 */
function _psMushroom(g,x,y,w,h,c1,c2,pulse){
  var cols=46, rows=30;
  var capHi=_tint(c1,0.55), cap=c1, capLo=_mixHex(c1,c2,0.40);
  var stem=_mixHex(c1,c2,0.18), stemHi=_tint(stem,0.35), dark=_mixHex(c1,c2,0.80);
  var ms=[];
  for(var i=0;i<4;i++){
    var mx=0.14+i*0.24+(_pr(i*5.3)-0.5)*0.04;
    var mtop=0.24+_pr(i*2.7)*0.24;
    var mr=0.085+_pr(i*8.1)*0.045;
    ms.push({x:mx,top:mtop,r:mr});
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<ms.length;i++){
      var m=ms[i];
      /* 柄 */
      var sw=m.r*0.30;
      if(v>m.top && v<0.98 && Math.abs(u-m.x)<sw) return Math.abs(u-m.x)<sw*0.4?stemHi:stem;
      /* 伞盖（扁椭圆） */
      var dx=(u-m.x)/m.r, dy=(v-m.top)/(m.r*0.72);
      var dd=dx*dx+dy*dy;
      if(dd<1 && v<=m.top+0.02){
        /* 盖上的白点 */
        var spot=_pr(Math.floor(u*40)*3.1+Math.floor(v*40)*7.7);
        if(spot>0.80 && dd<0.55) return dark;
        return dd<0.28?capHi:(dd<0.70?cap:capLo);
      }
    }
    return null;
  });
}

/* 5) 仙人掌 —— 主柱 + 侧臂 */
function _psCactus(g,x,y,w,h,c1,c2,pulse){
  var cols=44, rows=32;
  var hi=_tint(c1,0.50), mid=c1, lo=_mixHex(c1,c2,0.45), dark=_mixHex(c1,c2,0.72), spine=_tint(c1,0.80);
  var segs=[[0.50,0.98,0.50,0.14,0.070]];
  segs.push([0.50,0.62,0.28,0.62,0.042]); segs.push([0.28,0.62,0.28,0.38,0.042]);
  segs.push([0.50,0.50,0.72,0.50,0.042]); segs.push([0.72,0.50,0.72,0.30,0.042]);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    var best=1;
    for(var i=0;i<segs.length;i++){
      var s=segs[i];
      var d=_psSegD(u,v,s[0],s[1],s[2],s[3])/s[4];
      if(d<best)best=d;
      if(best<=0)break;
    }
    if(best>1)return null;
    /* 竖纹：按 u 取模制造棱线 */
    var rib=((u*14)%1)<0.18;
    if(best>0.86)return spine;
    if(rib)return lo;
    if(best<0.42)return hi;
    return (best<0.75)?mid:dark;
  });
}

/* 6) 瀑布 —— 竖向水流 + 水潭 + 飞沫 */
function _psWaterfall(g,x,y,w,h,c1,c2,pulse){
  var cols=40, rows=34;
  var hi=_tint(c1,0.68), mid=c1, lo=_mixHex(c1,c2,0.42), dark=_mixHex(c1,c2,0.70), foam=_tint(c1,0.86);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 主水流：中间宽、两侧收 */
    var coreW=0.16+0.10*(1-v);
    var d=Math.abs(u-0.5)/coreW;
    if(v<0.78){
      if(d>1)return null;
      /* 垂直线条：制造流动感 */
      var streak=((u*26+Math.floor(v*10)*0.37)%1);
      if(streak<0.20)return hi;
      if(streak<0.55)return mid;
      if(streak<0.82)return lo;
      return dark;
    }
    /* 水潭 */
    var px=(u-0.5)/0.44, py=(v-0.88)/0.14;
    if(px*px+py*py<1){
      var fp=_pr(Math.floor(u*48)*5.3+Math.floor(v*48)*2.7);
      if(fp>0.72)return foam;
      return v<0.88?mid:lo;
    }
    /* 飞沫 */
    if(v>0.60 && v<0.88){
      var sp=_pr(Math.floor(u*56)*1.7+Math.floor(v*56)*9.1);
      if(sp>0.965 && Math.abs(u-0.5)<0.34) return foam;
    }
    return null;
  });
}

/* 7) 石桥 —— 拱 + 桥面 + 栏杆 */
function _psBridge(g,x,y,w,h,c1,c2,pulse){
  var cols=56, rows=26;
  var hi=_tint(c1,0.55), mid=c1, lo=_mixHex(c1,c2,0.45), dark=_mixHex(c1,c2,0.78);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 桥面 */
    if(v>0.44 && v<0.58) return (v<0.50)?hi:mid;
    /* 栏杆立柱 */
    if(v>0.22 && v<=0.44){
      for(var i=0;i<=10;i++){
        var rx=0.04+i*0.092;
        if(Math.abs(u-rx)<0.010) return lo;
      }
      if(v>0.24 && v<0.30) return lo;   /* 扶手 */
      return null;
    }
    /* 拱（下半）：半环 */
    if(v>=0.58){
      var cx2=(u-0.5)/0.46, cy2=(v-0.58)/0.42;
      var rr2=cx2*cx2+cy2*cy2;
      if(rr2<1 && rr2>0.30){
        /* 石砌纹理 */
        var brick=(((u*16)%1)<0.10 || ((v*14+Math.floor(u*16)*0.5)%1)<0.12);
        return brick?dark:mid;
      }
    }
    return null;
  });
}

/* 8) 飞艇 —— 椭圆艇身 + 吊舱 + 尾鳍 */
function _psAirship(g,x,y,w,h,c1,c2,pulse){
  var cols=54, rows=26;
  var hi=_tint(c1,0.58), mid=c1, lo=_mixHex(c1,c2,0.42), dark=_mixHex(c1,c2,0.72), win=_tint(c2,0.60);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 艇身：中心 y=0.40 */
    var hx=(u-0.48)/0.44, hy=(v-0.40)/0.20;
    var hd=hx*hx+hy*hy;
    if(hd<1){
      /* 分节环 */
      var ring=((u*11)%1)<0.09;
      if(ring)return dark;
      if(hy<-0.35)return hi;
      if(hy>0.45)return lo;
      return mid;
    }
    /* 尾鳍 */
    if(u>0.90 && v>0.24 && v<0.54){
      var fy=(v-0.39)/0.16;
      if(Math.abs(fy)>0.25) return lo;
    }
    /* 吊舱 */
    if(v>0.62 && v<0.78 && u>0.36 && u<0.62){
      return (v<0.68)?lo:dark;
    }
    /* 吊索 */
    if(v>=0.58 && v<=0.62 && (Math.abs(u-0.40)<0.008 || Math.abs(u-0.58)<0.008)) return dark;
    /* 舷窗 */
    if(hd<0.55){
      for(var i=0;i<5;i++){
        var wx=0.24+i*0.12;
        var wd=((u-wx)/0.030); var wd2=((v-0.40)/0.045);
        if(wd*wd+wd2*wd2<1) return win;
      }
    }
    return null;
  });
}

/* 9) 锦鲤池 —— 水面 + 鱼影 + 涟漪 */
function _psKoiPond(g,x,y,w,h,c1,c2,pulse){
  var cols=52, rows=28;
  var waterHi=_tint(c1,0.62), water=c1, waterLo=_mixHex(c1,c2,0.52), deep=_mixHex(c1,c2,0.78), dark=_mixHex(c1,c2,0.90);
  var fish=_tint(c2,0.80), fish2=_mixHex(c2,c1,0.42);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 池底深浅（下方更深，营造水体纵深） */
    var depth=v*0.55;
    var wv=Math.sin(u*13.0+v*2.4)*0.5+0.5;
    var base=(wv>0.70)?waterHi:((wv>0.36)?water:_mixHex(waterLo,deep,Math.min(1,depth+0.25)));
    /* 涟漪环：亮边 + 暗心，更清晰 */
    for(var k=0;k<3;k++){
      var rx=0.22+k*0.28, ry=0.34+(k%2)*0.30;
      var dx=(u-rx)/0.055, dy=(v-ry)/0.10;
      var rd=Math.sqrt(dx*dx+dy*dy);
      if(rd>0.62 && rd<0.80) return dark;
      if(rd>0.80 && rd<1.0) return waterHi;
    }
    /* 鱼（两条，椭圆身 + 三角尾） */
    for(var f=0;f<2;f++){
      var fx=0.30+f*0.42, fy=0.58-f*0.16, dir=(f===0)?1:-1;
      var col=(f===0)?fish:fish2;
      var bx=(u-fx)/0.085, by=(v-fy)/0.050;
      if(bx*bx+by*by<1) return col;
      var tx=(u-(fx-dir*0.095))/(0.040), ty=(v-fy)/0.058;
      if(Math.abs(tx)<=1 && Math.abs(ty)<=1-Math.abs(tx)) return col;
    }
    return base;
  });
}

/* 10) 灯笼串 —— 横索 + 垂挂灯笼 */
function _psLanterns(g,x,y,w,h,c1,c2,pulse){
  var cols=50, rows=30;
  var cord=_mixHex(c1,c2,0.65), bodyHi=_tint(c1,0.62), body=c1, bodyLo=_mixHex(c1,c2,0.38), glow=_tint(c1,0.90);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 悬索：下垂的二次曲线 */
    var sag=0.10+0.26*Math.sin(u*Math.PI);
    if(Math.abs(v-sag)<0.012) return cord;
    /* 灯笼 (5 盏) */
    for(var i=0;i<5;i++){
      var lx=0.10+i*0.20;
      var ls=0.10+0.26*Math.sin(lx*Math.PI);   /* 各自的挂点高度 */
      if(Math.abs(u-lx)<0.010 && v>ls && v<ls+0.07) return cord;   /* 吊线 */
      var ly=ls+0.07;
      var bx=(u-lx)/0.048, by=(v-(ly+0.052))/0.052;
      if(bx*bx+by*by<1){
        if((u-lx)*(u-lx)/(0.048*0.048*0.25)+(v-ly)*(v-ly)/(0.010*0.010)<1) return cord;  /* 顶盖 */
        if(v<ly+0.030) return bodyHi;
        if(v<ly+0.086) return body;
        return bodyLo;
      }
      /* 灯内高光 */
      if(Math.abs(u-lx)<0.012 && v>ly+0.035 && v<ly+0.080) return glow;
    }
    return null;
  });
}

/* 11) 悬崖 —— 层叠岩壁 + 草顶 */
function _psCliff(g,x,y,w,h,c1,c2,pulse){
  var cols=52, rows=30;
  var grass=_tint(c2,0.35), hi=_tint(c1,0.45), mid=c1, lo=_mixHex(c1,c2,0.50), dark=_mixHex(c1,c2,0.78);
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    /* 台阶式岩层：每层横向错位，形成崖壁 */
    var layer=Math.floor(v*6);
    var off=_pr(layer*3.7)*0.10;
    var lv=layer/6;
    var thickMin=0.10+lv*0.30;
    if(u<thickMin+off){
      var edge=Math.abs(u-(thickMin+off));
      if(edge<0.012) return lo;
      /* 岩纹 */
      var grain=_pr(Math.floor(u*30)*2.3+layer*5.1);
      if(grain>0.86) return dark;
      if(grain>0.55) return mid;
      return hi;
    }
    /* 顶部长草 */
    if(v<0.18){
      var gTop=0.18-0.06*Math.sin(u*9.0);
      if(v<gTop) return null;
      if(v<gTop+0.045 && u<thickMin+off) return grass;
    }
    return null;
  });
}

/* 12) 芦苇荡 —— 细茎 + 穗 */
function _psReeds(g,x,y,w,h,c1,c2,pulse){
  var cols=48, rows=32;
  var hi=_tint(c1,0.55), mid=c1, lo=_mixHex(c1,c2,0.45), dark=_mixHex(c1,c2,0.72), tip=_tint(c1,0.85);
  var reeds=[];
  for(var i=0;i<16;i++){
    reeds.push({x:0.03+i*0.062+(_pr(i*5.9)-0.5)*0.030, top:0.14+_pr(i*3.1)*0.34, sway:(_pr(i*8.3)-0.5)*0.05});
  }
  _pxGrid(g,x,y,w,h,cols,rows,function(c,r){
    var u=(c+0.5)/cols, v=(r+0.5)/rows;
    for(var i=0;i<reeds.length;i++){
      var rd=reeds[i];
      /* 茎：随高度微微弯 */
      var sx=rd.x+rd.sway*(1-v);
      if(v>rd.top && Math.abs(u-sx)<0.008) return (v>0.75)?lo:mid;
      /* 穗 */
      if(v>rd.top-0.10 && v<=rd.top+0.02){
        var tdx=(u-sx)/0.022, tdy=(v-rd.top+0.05)/0.062;
        if(tdx*tdx+tdy*tdy<1) return (tdy<-0.2)?tip:hi;
      }
    }
    /* 底部草丛 */
    if(v>0.92){
      var gs=_pr(Math.floor(u*60)*4.1);
      if(gs>0.55) return dark;
    }
    return null;
  });
}

var _PRESET_DRAWERS = {
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
  presetWindmill: _psWindmill,
  /* ---- WS-D② 新增 12 个 ---- */
  presetAurora: _psAurora,
  presetCoral: _psCoral,
  presetBamboo: _psBamboo,
  presetMushroom: _psMushroom,
  presetCactus: _psCactus,
  presetWaterfall: _psWaterfall,
  presetBridge: _psBridge,
  presetAirship: _psAirship,
  presetKoiPond: _psKoiPond,
  presetLanterns: _psLanterns,
  presetCliff: _psCliff,
  presetReeds: _psReeds
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
function _simTime(){ return (typeof Game !== 'undefined' && Game) ? (Game.simTime || 0) : 0; }
function drawIceTo(g, el, adj){
  var x = Math.round(el.x), y = Math.round(el.y);
  var w = Math.round(el.w || 8), h = Math.round(el.h || 8);
  g.save();
  g.globalAlpha = 0.92;
  drawBlockPixel(g, el, adj, _BLK_MATS.ice);
  g.globalAlpha = 1;
  /* 冰面反光：斜向 3px 闪线（比原来的十字星更像"冰"，且不抢眼） */
  if (el._melt > 0){
    g.globalAlpha = 0.35 + 0.35 * Math.sin(Date.now() / 80);
    _px(g, x, y, w, h, 'rgba(150,230,255,0.55)');
    g.globalAlpha = 1;
  }
  g.restore();
}
function _px(g,x,y,w,h,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h))); }
function _pxDot(g,x,y,c){ g.fillStyle=c; g.fillRect(Math.round(x),Math.round(y),1,1); }
/* ============================================================
   WS-C 方块美术层 v2 —— 软萌可爱 / 相邻紧贴融合 / 更精美
   ============================================================
   参考语言：蔚蓝 Celeste（低配色 + 1px 描边 + 破形）
             动物井 Animal Well（暗景高对比 + 无缝暗缝）
             闰跃之年（柔和暖调 + 圆润轮廓）
             泰拉瑞亚 Terraria（边缘融合 + 表面高光 + 分层纹理）
   ------------------------------------------------------------
   核心机制：
   1) 16×16 程序化材质 tile（离屏生成一次，_pr 确定性哈希，不逐帧随机）
      → 按「世界坐标 16px 网格」blit ⇒ 相邻块纹理天然连续、无相位跳变
        （这是"同区块紧贴融合"的关键）
      → 每块只需 ceil(w/16)×ceil(h/16) 次 drawImage；8×8 块 = 1 次
   2) 只在「无相邻」侧画边（hue shift）：上=暖高光 / 下=冷暗底 /
      左=暖中间调 / 右=冷暗调
   3) 边线的"端部缩进"只在「该端外露」时生效
      ⇒ 相邻处边线连续无断口（紧贴融合），外露端 1px 缩进成软角
   4) 有相邻的一侧 → 接缝内侧压 1px 极淡内阴影 ⇒ 读作「一整块」
   5) 孤立块（四边全不邻）→ 顶部双高光 + 全角缩进，读作「一颗软糖」
   注：不使用 clearRect（画布下是背景层/透明，打洞会露出底色）
   ============================================================ */
var _BKT = 32;                 /* 材质 tile 边长（8px 块的 4 倍周期） */
var _bktTileCache = {};

/* 材质表：软萌暖调（Sweetie-16 方向），specks = 内部颗粒点数 */
var _BLK_MATS = {
  platform:  { id:'platform',  seed:1, specks:11, base:'#4d4760',
               sl:'#615a78', sd:'#3b3649',
               light:'#93889f', light2:'#746c8a', mid:'#5c5574',
               dark:'#2b2638', dark2:'#1e1a29' },
  movable:   { id:'movable',   seed:2, specks:8,  base:'#5a8fc0',
               sl:'#75a9d8', sd:'#4577a6',
               light:'#a8cdea', light2:'#86b2d8', mid:'#6197c8',
               dark:'#2c4a6b', dark2:'#1e3450', detail:'rivet' },
  breakable: { id:'breakable', seed:3, specks:10, base:'#b07a52',
               sl:'#c68f66', sd:'#96643f',
               light:'#e0ab80', light2:'#c9926a', mid:'#a06e48',
               dark:'#5c3a24', dark2:'#412818', detail:'crack' },
  flammable: { id:'flammable', seed:4, specks:9,  base:'#c2603a',
               sl:'#d97a52', sd:'#a44c2c',
               light:'#f09d76', light2:'#d5845e', mid:'#b0552f',
               dark:'#62291a', dark2:'#451a10', detail:'ember' },
  disappear: { id:'disappear', seed:5, specks:14, base:'#a89ae0',
               sl:'#bcb0ec', sd:'#9484cc',
               light:'#ded6ff', light2:'#c6bdf2', mid:'#a89ae0',
               dark:'#4e4488', dark2:'#372f63' },
  ice:       { id:'ice',       seed:6, specks:13, base:'#8fd4ea',
               sl:'#aae4f6', sd:'#72bcd8',
               light:'#e8f8ff', light2:'#c6effc', mid:'#8fd4ea',
               dark:'#3f7f9c', dark2:'#2c5d75', detail:'frost' }
};

/* 16×16 材质 tile：一次性程序化生成（确定性 → 同一材质每帧完全一致） */
function _bktTile(mat){
  var cv = _bktTileCache[mat.id];
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = _BKT; cv.height = _BKT;
  var g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = mat.base;
  g.fillRect(0, 0, _BKT, _BKT);
  var s = mat.seed * 1.37, n = Math.round((mat.specks || 10) * 2.4);
  for (var i = 0; i < n; i++){
    var a = _pr(s * 3.1 + i * 7.3);
    var b = _pr(s * 5.7 + i * 11.9);
    var c = _pr(s * 9.3 + i * 4.1);
    g.fillStyle = (c > 0.62) ? mat.sl : mat.sd;
    g.fillRect(Math.floor(a * _BKT), Math.floor(b * _BKT), 1, 1);
  }
  /* 冰：断续高光点，暗示冰晶反光 */
  if (mat.detail === 'frost'){
    for (var k = 0; k < 14; k++){
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect((k * 7 + 2) % _BKT, (k * 5 + 1) % _BKT, 1, 1);
    }
  }
  /* 易碎：一道细裂纹（tile 级，跨块看是连续的碎石纹） */
  if (mat.detail === 'crack'){
    for (var k2 = 0; k2 < 16; k2++){
      g.fillStyle = 'rgba(58,28,14,0.5)';
      g.fillRect(3 + ((k2 * 2) % 5), 3 + k2, 1, 1);
    }
  }
  _bktTileCache[mat.id] = cv;
  return cv;
}

/* 世界坐标锚定的材质平铺：只 blit 与块矩形相交的部分，无需 clip */
function _blkFill(g, mat, x, y, w, h){
  var tile = _bktTile(mat);
  var sm = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  var x1 = x + w, y1 = y + h;
  var ty0 = Math.floor(y / _BKT) * _BKT, tx0 = Math.floor(x / _BKT) * _BKT;
  for (var ty = ty0; ty < y1; ty += _BKT){
    var dy = ty > y ? ty : y;
    var dy2 = (ty + _BKT) < y1 ? (ty + _BKT) : y1;
    if (dy2 <= dy) continue;
    for (var tx = tx0; tx < x1; tx += _BKT){
      var dx = tx > x ? tx : x;
      var dx2 = (tx + _BKT) < x1 ? (tx + _BKT) : x1;
      if (dx2 <= dx) continue;
      g.drawImage(tile, dx - tx, dy - ty, dx2 - dx, dy2 - dy, dx, dy, dx2 - dx, dy2 - dy);
    }
  }
  g.imageSmoothingEnabled = sm;
}

function drawBlockPixel(g, el, adj, mat){
  var x = Math.round(el.x), y = Math.round(el.y);
  var w = Math.round(el.w || 8), h = Math.round(el.h || 8);
  if (w < 1 || h < 1) return;
  adj = adj || {};
  var up = !!adj.up, dn = !!adj.down, lf = !!adj.left, rt = !!adj.right;
  var L = mat.light, L2 = mat.light2 || mat.light, M = mat.mid || mat.base;
  var D = mat.dark, D2 = mat.dark2 || mat.dark;

  /* (1) 主体：世界锚定的 16px 材质平铺（相邻块纹理天然连续） */
  _blkFill(g, mat, x, y, w, h);

  /* 边线端部缩进：外露端缩 1px（软角），相邻端不缩（保持连续） */
  var ax = lf ? 0 : 1, bx = rt ? 0 : 1;
  var aw = w - ax - bx; if (aw < 1) { ax = 0; aw = w; }
  var ay = up ? 0 : 1, by = dn ? 0 : 1;
  var ah = h - ay - by; if (ah < 1) { ay = 0; ah = h; }

  /* === 接缝修复（用户反馈"两个方块之间有细细的条纹"） ===
     根因：旧版在**相邻侧也画线** —— 上块底边压 1px + 下块顶边压 1px ⇒ 接缝处
     叠成 **2px 暗带**（实测 _seam_probe.cjs：y7 与 y8 同时变暗，
     platform 跌落 10.9 / movable 18.2 / breakable 15.3 / ice 26.4）。
     而材质平铺是「世界坐标 32px 锚定」的，相邻块纹理本身就天然连续，
     **任何**压暗线都会把它打断成可见条纹。
     修复原则：**只在"外露"侧画线**；相邻侧一律不画，让纹理自然连成一片。
     （不同类型之间不会有 adj，因此仍然保留彼此的边界 —— 只有同类型连排才融合。） */

  /* (2) 顶边：仅外露 → 暖高光双线 */
  if (!up){
    _px(g, x + ax, y, aw, 1, L);
    if (h >= 3 && aw >= 1) _px(g, x + ax, y + 1, aw, 1, L2);
  }
  /* (3) 底边：仅外露 → 冷暗底双线 */
  if (!dn){
    if (h >= 2) _px(g, x + ax, y + h - 1, aw, 1, D);
    if (h >= 4 && aw >= 1) _px(g, x + ax, y + h - 2, aw, 1, D2);
  }
  /* (4) 左右边：仅外露 → 左暖右冷（hue shift） */
  if (ah > 0){
    if (!lf) _px(g, x, y + ay, 1, ah, M);
    if (!rt) _px(g, x + w - 1, y + ay, 1, ah, D);
  }

  /* (5) 块级细节（铆钉 / 裂纹 / 余烬） */
  if (mat.detail === 'rivet' && w >= 6 && h >= 6){
    _pxDot(g, x + 1, y + 1, L);
    _pxDot(g, x + w - 2, y + 1, L);
    _pxDot(g, x + 1, y + h - 2, D);
    _pxDot(g, x + w - 2, y + h - 2, D);
  } else if (mat.detail === 'crack' && w >= 6 && h >= 6){
    var cxk = Math.floor(w * 0.38), cyk = Math.floor(h * 0.28);
    _pxDot(g, x + cxk, y + cyk, D2);
    _pxDot(g, x + cxk + 1, y + cyk + 1, D2);
    _pxDot(g, x + cxk, y + cyk + 2, D2);
    if (w >= 8 && h >= 8) _pxDot(g, x + Math.floor(w * 0.68), y + Math.floor(h * 0.68), D2);
  } else if (mat.detail === 'ember' && w >= 6 && h >= 6){
    var ex = Math.floor(w / 2), ey = Math.floor(h / 2);
    _pxDot(g, x + ex, y + ey, '#ffc070');
    _pxDot(g, x + ex - 1, y + ey + 1, 'rgba(255,150,70,0.75)');
  }
}
function drawPlatformTo(g, el, adj){
  drawBlockPixel(g, el, adj, _BLK_MATS.platform);
}
function drawMovableTo(g, el, adj){
  drawBlockPixel(g, el, adj, _BLK_MATS.movable);
}
function drawBreakableTo(g, el, adj){
  drawBlockPixel(g, el, adj, _BLK_MATS.breakable);
}
function drawFlammableTo(g, el, adj){
  drawBlockPixel(g, el, adj, _BLK_MATS.flammable);
}
function drawDisappearTo(g, el, adj){
  var x = Math.round(el.x), y = Math.round(el.y);
  var w = Math.round(el.w || 8), h = Math.round(el.h || 8);
  var period = (el.onTime || 1.5) + (el.offTime || 1.0);
  var t = ((_simTime() + (el.phase || 0)) % period);
  var visible = t < (el.onTime || 1.5);
  g.save();
  g.globalAlpha = visible ? 0.95 : 0.20;
  drawBlockPixel(g, el, adj, _BLK_MATS.disappear);
  g.globalAlpha = 1;
  /* 硬像素虚线外框（"幻影"读法，保留） */
  g.setLineDash([2, 2]);
  g.strokeStyle = visible ? 'rgba(222,214,255,0.95)' : 'rgba(120,120,160,0.75)';
  g.lineWidth = 1;
  var x1 = x + 0.5, y1 = y + 0.5, x2 = x + w - 0.5, y2 = y + h - 0.5;
  if (!adj.up){ g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y1); g.stroke(); }
  if (!adj.down){ g.beginPath(); g.moveTo(x1, y2); g.lineTo(x2, y2); g.stroke(); }
  if (!adj.left){ g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1, y2); g.stroke(); }
  if (!adj.right){ g.beginPath(); g.moveTo(x2, y1); g.lineTo(x2, y2); g.stroke(); }
  g.setLineDash([]);
  g.restore();
}
/* ============ 泡沫砖渲染（表现层，纯视觉）============
   读法：淡青白色块 + 内部**气泡孔洞**（散点，非规则纹理）+
   边缘比平台更圆润柔和（四角各缺 1px，暗示"软"）。
   `_squash`（穿行瞬间置 1）驱动一次压扁回弹；平时做极轻的呼吸明暗。
   注意：这里**不读也不写任何物理状态**（除只读的 _pass/_squash 用于表现），
   表现层出问题绝不影响可解性。 */
function drawFoamTo(g, el, adj){
  var x = Math.round(el.x), y = Math.round(el.y);
  var w = Math.round(el.w || 8), h = Math.round(el.h || 8);
  if (w < 1 || h < 1) return;
  adj = adj || {};
  var now = _simTime();
  /* 呼吸：幅度极小，避免抢视觉（周期 ~2.4s） */
  var breathe = 0.5 + 0.5 * Math.sin(now * 2.6);
  /* 压扁回弹：_squash 从 1 衰减到 0，期间整体轻微压扁 + 提亮 */
  var sq = el._squash || 0;
  if (sq > 0) el._squash = Math.max(0, sq - 0.12);
  var inset = Math.round(sq * 1.5);          /* 上下各内缩，形成"被压扁" */
  var yy = y + inset, hh = Math.max(1, h - inset * 2);

  g.save();
  /* 主体：淡青白，带呼吸明暗 */
  var base = 214 + Math.round(28 * breathe);
  g.fillStyle = 'rgba(' + (base - 20) + ',' + (base + 2) + ',' + (base + 16) + ',0.94)';
  g.fillRect(x, yy, w, hh);
  /* 上缘高光 / 下缘阴影（软材质读法） */
  g.fillStyle = 'rgba(245,255,255,' + (0.55 + 0.25 * breathe).toFixed(3) + ')';
  g.fillRect(x, yy, w, 1);
  g.fillStyle = 'rgba(150,182,200,0.75)';
  g.fillRect(x, yy + hh - 1, w, 1);
  /* 内部气泡孔洞：确定性散点（同一块砖每帧一致，不闪） */
  var seed = (el.x * 0.37 + el.y * 0.71);
  for (var i = 0; i < 5; i++) {
    var r1 = _pr(seed + i * 13.7), r2 = _pr(seed + i * 29.3), r3 = _pr(seed + i * 41.9);
    var bx = x + 1 + Math.floor(r1 * Math.max(1, w - 2));
    var by = yy + 1 + Math.floor(r2 * Math.max(1, hh - 2));
    if (r3 > 0.55) {                        /* 暗孔 */
      g.fillStyle = 'rgba(150,190,210,0.85)';
      g.fillRect(bx, by, 1, 1);
    } else {                                /* 亮泡 */
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(bx, by, 1, 1);
    }
  }
  /* 四角缺 1px → 圆润柔和（与平台的硬直角形成对比，"这是软的"） */
  var corners = [[x, yy], [x + w - 1, yy], [x, yy + hh - 1], [x + w - 1, yy + hh - 1]];
  g.fillStyle = 'rgba(0,0,0,0)';
  for (var k = 0; k < 4; k++) {
    var px = corners[k][0], py = corners[k][1];
    g.clearRect(px, py, 1, 1);
  }
  /* 外框：只在"外露"侧画（与 drawBlockPixel 的接缝修复同思路） */
  g.strokeStyle = 'rgba(176,212,232,0.9)';
  g.lineWidth = 1;
  if (!adj.up) { g.beginPath(); g.moveTo(x + 0.5, y + 0.5); g.lineTo(x + w - 0.5, y + 0.5); g.stroke(); }
  if (!adj.down) { g.beginPath(); g.moveTo(x + 0.5, y + h - 0.5); g.lineTo(x + w - 0.5, y + h - 0.5); g.stroke(); }
  if (!adj.left) { g.beginPath(); g.moveTo(x + 0.5, y + 0.5); g.lineTo(x + 0.5, y + h - 0.5); g.stroke(); }
  if (!adj.right) { g.beginPath(); g.moveTo(x + w - 0.5, y + 0.5); g.lineTo(x + w - 0.5, y + h - 0.5); g.stroke(); }
  g.restore();
}

/* ============ 旗杆渲染（表现层，纯视觉）============
   契约：玩家经过即激活 → 旗帜变红并展开飘扬，当前生效的旗杆高亮脉动。
   与"玩家自插旗"（`F` 键，金黄 `#ffdd44`）在视觉上必须能区分：
     · 旗杆          → 红色旗面（可配 `el.color`）
     · 未激活 / 已被更新的旗杆顶掉 → 画面垂下、低饱和（暗示"不是我"）
   ★高亮语言复用 5948–5979 那套既有旗子的 `easeS` 脉动，玩家一眼认出这是"重生点"。 */
function drawFlagPoleTo(g, fp, playMode){
  var x=Math.round(fp.x), y=Math.round(fp.y);
  var w=Math.round(fp.w||8), h=Math.round(fp.h||24);
  if(w<1||h<1)return;
  var now=_simTime();
  var active=(Play.currentFlag===fp);
  var base=active?(fp.color||'#cc3333'):'#7a4a4a';
  var cx=x+Math.floor(w/2);
  /* 杆：1px 竖线（顶到底），底部加一个小基座 */
  g.fillStyle='#5a5a66';
  g.fillRect(cx, y, 1, h);
  g.fillStyle='#8a8a96';
  g.fillRect(cx, y, 1, 1);
  g.fillStyle='#3a3a44';
  g.fillRect(cx-2, y+h-1, 5, 1);
  var flagH=Math.max(4, Math.round(h*0.45));
  var flagW=Math.max(5, w+2);
  if(active){
    /* ★已激活：展开飘扬★ 旗面整体随 sin 波动，右边缘做波浪 */
    var easeS=0.7+0.3*Math.sin(now*3);
    g.save();
    g.shadowBlur=14*easeS; g.shadowColor='rgba(255,90,90,0.85)';
    for(var ry=0;ry<flagH;ry++){
      var wave=Math.sin(now*5+ry*0.9)*1.6;      /* 逐行相位差 → 读作"风在吹" */
      var rw=flagW+wave;
      g.fillStyle=(ry<1)?'#ff8888':(ry<flagH-1?base:'#8a1a1a');
      g.fillRect(cx+1, y+ry, Math.max(1,Math.round(rw)), 1);
    }
    g.restore();
    /* 脉动光环：复用既有旗子的高亮语言（easeS 驱动 alpha / 半径） */
    g.strokeStyle='rgba(255,120,120,'+(0.35+0.45*easeS).toFixed(3)+')';
    g.lineWidth=1.2;
    g.beginPath(); g.arc(cx, y+flagH*0.5, 10+2*easeS, 0, Math.PI*2); g.stroke();
  }else{
    /* 未激活 / 已被更新：旗帜**垂下**（无风、低饱和，且顶端略暗） */
    for(var dy2=0;dy2<flagH;dy2++){
      g.fillStyle=(dy2<1?'#9a6a6a':base);
      g.fillRect(cx+1, y+dy2, flagW, 1);
    }
    g.fillStyle='rgba(0,0,0,0.28)';
    g.fillRect(cx+1, y, flagW, 1);
  }
  if(!playMode){
    /* 编辑态：给一个很淡的包围框，方便点选 */
    g.strokeStyle='rgba(204,51,51,0.35)';
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
  }
}

/* ============ 野兽渲染（表现层，纯视觉）============
   契约（用户原文）："要有被惊吓地睁大眼睛然后做出快速瞬移的速度线从画面上瞬移消失，
   让玩家看起来像是跑走了"。

   三阶段（`_t / fleeTime` 驱动）：
     ① 惊醒·睁大眼 0→0.20：身体上弹一下；眼睛从"两条缝"变成两个大圆（露眼白）。
     ② 蓄力        0.20→0.35：反向压扁（宽×1.15 高×0.88，像要起跑）；脚下扬尘。
     ③ 速度线瞬移  0.35→1.0：身后 4–6 条平行短横线（越长越靠本体、alpha 递减），
                              本体沿逃跑方向冲出 40–60px 并 alpha 渐隐 → 完全消失。
   ★注意：`scared` 结束会 `splice` 掉，所以这里不需要画 `gone`。 */
function drawBeastTo(g, bs, playMode){
  var x=Math.round(bs.x), y=Math.round(bs.y);
  var w=Math.round(bs.w||16), h=Math.round(bs.h||16);
  if(w<1||h<1)return;
  var now=_simTime();
  g.save();
  if(bs.state!=='scared'){
    /* ---- sleep：一团蜷着的深棕毛球，眼睛是闭着的两条缝 ---- */
    var breathe=(1+Math.sin(now*1.8)*0.04);
    var bw=Math.max(2,Math.round(w*breathe)), bh=Math.max(2,Math.round(h*breathe));
    var bx=x+Math.floor((w-bw)/2), by=y+Math.floor((h-bh)/2);
    g.fillStyle='#6a4a26';
    g.fillRect(bx,by,bw,bh);
    g.fillStyle='#8a6a3a';                       /* 背脊 */
    g.fillRect(bx,by,bw,Math.max(1,Math.round(bh*0.42)));
    g.fillStyle='#4a3218';                       /* 下缘阴影 */
    g.fillRect(bx,by+bh-1,bw,1);
    g.fillStyle='#3a2612';                       /* 左上的耳朵凸起 */
    g.fillRect(bx+1,by-1,2,1); g.fillRect(bx+bw-3,by-1,2,1);
    /* 闭着的眼（两条缝）—— 与"惊醒后的大圆眼"形成强烈对比 */
    g.fillStyle='#1a1208';
    g.fillRect(bx+Math.round(bw*0.22), by+Math.round(bh*0.40), 3, 1);
    g.fillRect(bx+Math.round(bw*0.58), by+Math.round(bh*0.40), 3, 1);
    /* 鼻子 */
    g.fillStyle='#d8a0a0';
    g.fillRect(bx+Math.floor(bw/2)-1, by+Math.round(bh*0.62), 2, 1);
  }else{
    /* ---- scared：三段动作 ---- */
    var ft=bs.fleeTime||0.75;
    var pr=Math.min(1,(bs._t||0)/ft);
    var dx=bs._dirX||1, dy=bs._dirY||0;
    var ebx=x, eby=y, ew=w, eh=h, alpha=1;
    if(pr<0.20){
      var t=pr/0.20;
      eby=y-2*Math.sin(t*Math.PI);               /* ① 上弹一下 */
      ebx=x+Math.sin(now*60)*1;                  /* 轻微抖动（±1px 高频） */
    }else if(pr<0.35){
      var t2=(pr-0.20)/0.15;
      ebx=x-Math.round(w*0.075*t2);              /* ② 反向压扁（起跑姿） */
      ew=Math.round(w*(1+0.15*t2));
      eh=Math.round(h*(1-0.12*t2));
      eby=y+Math.round(h*0.12*t2);
      /* 脚下扬尘 */
      if(t2<0.5){
        g.fillStyle='rgba(180,170,150,0.5)';
        g.fillRect(x+2,y+h-1,2,1); g.fillRect(x+w-4,y+h-1,2,1);
      }
    }else{
      var t3=(pr-0.35)/0.65;
      var dash=42*t3;                            /* ③ 一次性冲出去 42px+ */
      ebx=x+Math.round(dx*dash);
      eby=y+Math.round(dy*dash);
      alpha=Math.max(0,1-t3*1.15);
    }
    if(alpha>0.02){
      g.globalAlpha=alpha;
      g.fillStyle='#6a4a26'; g.fillRect(ebx,eby,ew,eh);
      g.fillStyle='#8a6a3a'; g.fillRect(ebx,eby,ew,Math.max(1,Math.round(eh*0.42)));
      g.fillStyle='#4a3218'; g.fillRect(ebx,eby+eh-1,ew,1);
      g.fillStyle='#3a2612';
      g.fillRect(ebx+1,eby-1,2,1); g.fillRect(ebx+ew-3,eby-1,2,1);
      /* ★睁大眼★：眼白大圆 + 瞳孔，半径按阶段放大（比 sleep 的缝大得多） */
      var eyeR=(pr<0.20)?2.0:(pr<0.35?2.5:2.0);
      var ecy=eby+Math.round(eh*0.42);
      var eL=ebx+Math.round(ew*0.26), eR=ebx+Math.round(ew*0.62);
      g.fillStyle='#ffffff';
      g.fillRect(eL-Math.floor(eyeR/2),ecy-Math.floor(eyeR/2),Math.round(eyeR),Math.round(eyeR));
      g.fillRect(eR-Math.floor(eyeR/2),ecy-Math.floor(eyeR/2),Math.round(eyeR),Math.round(eyeR));
      g.fillStyle='#111111';
      g.fillRect(eL,ecy,1,1); g.fillRect(eR,ecy,1,1);
      g.fillStyle='#d8a0a0';
      g.fillRect(ebx+Math.floor(ew/2)-1,eby+Math.round(eh*0.68),2,1);
      g.globalAlpha=1;
    }
    /* ★速度线★：身后 4–6 条平行短横线，长度递减、alpha 递减、间隔逐帧拉大。
       ★画法要点★：线是**水平**的（像素风的"速度感"就是横线），
       摆放位置沿"逃跑方向的反方向"排开（竖直逃跑时会把整簇线整体偏移，
       —— 横线本身不旋转，但簇的走向仍读得出方向）。 */
    if(pr>=0.30){
      var sp=(pr-0.30)/0.70;
      for(var li=0;li<5;li++){
        var ln=Math.round((7-li*1.1)*(1-sp*0.7));
        if(ln<1)continue;
        var off=6+li*6;                          /* 离本体越来越远 → 拉伸感 */
        var lx=Math.round(x - dx*off) - Math.round(dx*4);
        var ly=Math.round(y+h*0.5) - Math.round(dy*off) + (li*2-4);
        g.globalAlpha=Math.max(0,(0.6-li*0.1)*(1-sp));
        g.fillStyle='#e8e0c8';
        g.fillRect(lx,ly,ln,1);
      }
      g.globalAlpha=1;
    }
  }
  g.restore();
  if(!playMode && bs.state==='sleep'){
    g.strokeStyle='rgba(138,106,58,0.35)';
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
  }
}
/* 颜色插值（枯萎四段用；纯函数、无随机 ⇒ 可确定性重放） */
function _mixHex(a,b,t){
  function hx(s){s=String(s||'').replace('#','');if(s.length===3)s=s[0]+s[0]+s[1]+s[1]+s[2]+s[2];return [parseInt(s.slice(0,2),16)||0,parseInt(s.slice(2,4),16)||0,parseInt(s.slice(4,6),16)||0];}
  var A=hx(a),B=hx(b);t=Math.max(0,Math.min(1,t));
  function c(i){return Math.round(A[i]+(B[i]-A[i])*t);}
  return 'rgb('+c(0)+','+c(1)+','+c(2)+')';
}
/* ============ 巨花（flower）表现 ============
   造型（全部 `_px` / `_pxDot` 程序化像素，无图片资源）：
     花冠（petalCount 片放射花瓣）+ 1px 花茎 + 左右叶 + 地面藤底座。
   枯萎四段（`_t / witherTime` 插值，**无随机**）：
     ①失色 0→0.3  ②萎垂 0.3→0.6  ③凋落 0.6→0.9  ④消散 0.9→1.0 */
function drawFlowerTo(g, fl, playMode){
  var x=Math.round(fl.x), y=Math.round(fl.y);
  var w=Math.round(fl.w||16), h=Math.round(fl.h||24);
  if(w<2||h<2)return;
  var pc=Math.max(3,Math.min(12,fl.petalCount||6));
  var petal=fl.petalColor||'#e05a8a';
  var stem=fl.stemColor||'#4a8a3a';
  var now=_simTime();
  /* pr：枯萎进度（bloom 恒为 0） */
  var pr=0;
  if(fl.state==='withering')pr=Math.min(1,(fl._t||0)/(fl.witherTime||1.2));
  else if(fl.state==='gone')pr=1;
  /* 四段权重 */
  var fade=Math.min(1,pr/0.30);              /* ① 失色 */
  var droop=Math.max(0,Math.min(1,(pr-0.30)/0.30));   /* ② 萎垂 */
  var drop=Math.max(0,Math.min(1,(pr-0.60)/0.30));    /* ③ 凋落 */
  var goneT=Math.max(0,Math.min(1,(pr-0.90)/0.10));   /* ④ 消散 */
  var alpha=1-goneT;
  if(alpha<=0.02)return;
  var petalC=_mixHex(petal,'#6a5a4a',fade);
  var stemC=_mixHex(stem,'#6a5a4a',fade);
  var cx=x+Math.floor(w/2);
  var baseY=y+h;                             /* 扎根地面处 */
  var stemTopY=y+Math.round(h*0.30);
  g.save();
  g.globalAlpha=alpha;
  /* ---- 藤底座：地面处横向须根（"扎在地上"的视觉锚） ---- */
  _px(g,x,baseY-1,w,1,'#3a2a1a');
  for(var rxs=0;rxs<w;rxs+=3){_pxDot(g,x+rxs,baseY,_mixHex('#3a2a1a','#6a5a4a',fade));}
  /* ---- 花茎：1px 竖线；萎垂时**逐帧加大弯曲**（顶端下移，无随机） ---- */
  var bend=droop*droop*Math.round(h*0.35);
  var stemLen=baseY-stemTopY;
  for(var sy=0;sy<stemLen;sy++){
    var tt=stemLen>1?sy/(stemLen-1):0;
    var bx=cx+Math.round(Math.sin(tt*1.4)*droop*w*0.28);   /* 越靠顶弯得越多 */
    _pxDot(g,bx,stemTopY+sy+Math.round(bend*tt),stemC);
  }
  /* ---- 叶：左右各 1；bloom 时随 idle 摆动 ---- */
  if(drop<1){
    var sway=Math.sin(now*1.6)*0.6;
    var leafA=alpha*(1-drop);
    g.globalAlpha=leafA;
    var lY=stemTopY+Math.round(stemLen*0.62);
    _px(g,cx-3,lY,3,1,stemC); _px(g,cx-4,lY-1+Math.round(sway),2,1,stemC);
    _px(g,cx+1,lY+1,3,1,stemC); _px(g,cx+4,lY+Math.round(-sway),2,1,stemC);
    g.globalAlpha=alpha;
  }
  /* ---- 花冠：petalCount 片放射花瓣 ---- */
  if(drop<1){
    /* 花瓣"向内卷"：半径随萎垂缩小 40% */
    var bloomR=Math.max(2,Math.round(Math.min(w,h)*0.32*(1-droop*0.4)));
    var headY=(stemTopY+Math.round(bend*1.0))-bloomR;   /* 顶端随茎下移 */
    var petalH=Math.max(2,Math.round(h*0.22*(1-droop*0.25)));
    for(var pi=0;pi<pc;pi++){
      /* ★逐片独立脱落延迟★（纯确定性：用序号算相位，不用 random） */
      var pDelay=(pi/Math.max(1,pc))*0.5;
      var pFall=Math.max(0,Math.min(1,(drop-pDelay)/Math.max(0.15,1-pDelay)));
      if(pFall>=1)continue;                                /* 已脱落 */
      var ang=pi/pc*Math.PI*2-Math.PI/2;
      var r=bloomR*(1-pFall*0.55);
      var px=cx+Math.round(Math.cos(ang)*r);
      var py=headY+Math.round(Math.sin(ang)*r*0.55);
      var pc2=pFall>0?_mixHex(petalC,'#6a5a4a',pFall):petalC;
      g.globalAlpha=alpha*(1-pFall);
      _px(g,px-1,py-Math.floor(petalH/2),2,petalH,pc2);
      _px(g,px-2,py,petalH>3?3:2,1,pc2);                   /* 花瓣横向加宽一点 */
      g.globalAlpha=alpha;
    }
    /* 花心 */
    if(drop<0.85){
      g.globalAlpha=alpha*(1-drop*0.6);
      _px(g,cx-1,headY-1,2,2,_mixHex('#ffd24a','#6a5a4a',fade));
      g.globalAlpha=alpha;
    }
  }
  g.restore();
  /* 编辑态：淡淡的包围框 + **触发范围示意**（与墓碑/野兽/BOSS 同一套视觉语言）
     ★为什么必须有★ 用户原话：「编辑器里预览看不见激活范围的具体尺寸」——
     `triggerRadius` 直接决定"幽灵走到哪才枯萎"，没有示意图就只能靠猜，
     摆完进游戏发现判定不对（幽灵贴着花却不炸）却找不到原因。
     ★画法必须与 updateFlowers 的判定口径**完全一致**★：
     判定用的是"幽灵中心到**花矩形最近点**的距离 < triggerRadius"，
     等价于"幽灵中心落在 **花矩形向外膨胀 triggerRadius 的圆角矩形**内"。
     所以这里画的是那个圆角矩形（直线边 + 四角圆弧），
     而不是一个"以花心为圆心的圆" —— 花被拉高/拉宽时后者会严重骗人。
     正式游戏 playMode=true ⇒ 完全不画。 */
  if(!playMode && fl.state!=='gone'){
    g.strokeStyle='rgba(224,90,138,0.30)';
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
    var _tr=(fl.triggerRadius!==undefined?fl.triggerRadius:40);
    if(_tr>0){
      var _l=x-_tr, _t2=y-_tr, _r2=x+w+_tr, _b2=y+h+_tr;   /* 膨胀后的圆角矩形外框 */
      g.save();
      g.setLineDash([3,3]);
      g.strokeStyle='rgba(224,90,138,0.36)';g.lineWidth=0.8;
      g.beginPath();
      g.moveTo(_l+_tr,_t2); g.lineTo(_r2-_tr,_t2);
      g.arcTo(_r2,_t2,_r2,_t2+_tr,_tr);
      g.lineTo(_r2,_b2-_tr);
      g.arcTo(_r2,_b2,_r2-_tr,_b2,_tr);
      g.lineTo(_l+_tr,_b2);
      g.arcTo(_l,_b2,_l,_b2-_tr,_tr);
      g.lineTo(_l,_t2+_tr);
      g.arcTo(_l,_t2,_l+_tr,_t2,_tr);
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      g.fillStyle='rgba(224,90,138,0.045)';
      g.fill();
      g.restore();
    }
  }
}
/* ============ 火（fire）表现 ============
   burning：2–3 簇"下宽上尖"分层火苗，高度按 sin 跳动、相位按格子坐标错开
            （避免整片火同步跳 = 像 CSS 动画，很假）+ 暗红余烬底座 + 暖色危险区光晕。
   dousing：三段落灭（遭遇猛缩变暗 → 逐簇倒下 → 余烬转灰黑）。
   ★状态推进无 Math.random()★（粒子只在切换时喷）⇒ 可确定性重放。 */
function drawFireTo(g, fr, playMode){
  var x=Math.round(fr.x), y=Math.round(fr.y);
  var w=Math.round(fr.w||8), h=Math.round(fr.h||8);
  if(w<1||h<1)return;
  var now=_simTime();
  var dousing=(fr.state==='dousing');
  var pr=dousing?Math.min(1,(fr._t||0)/(fr.dousingTime||0.9)):0;
  var flame=fr.flameColor||'#ff7a1a';
  var rate=(fr.spreadSpeed||1.0)*6;
  /* ★危险区暖光晕★：给玩家的可读性提示（不是装饰）—— 火是致命的，
     边界必须一眼可见。两层叠加出柔和径向感；dousing 时快速收缩至消失。 */
  var halo=1-(dousing?Math.min(1,pr/0.6):0);
  if(halo>0.01){
    g.save();
    g.globalAlpha=0.10*halo;
    g.fillStyle='#ff7a1a';
    g.fillRect(x-3,y-3,w+6,h+6);
    g.globalAlpha=0.15*halo;
    g.fillStyle='#ffab4a';
    g.fillRect(x-1,y-2,w+2,h+4);
    g.restore();
  }
  g.save();
  /* 熄灭包络：遭遇段（0→0.25）整体猛地一缩 + 变暗，之后缓慢收缩到无 */
  var shrink=dousing&&pr<0.25?(1-0.4*(pr/0.25)):1;
  if(dousing&&pr>=0.25)shrink=1-(pr-0.25)*0.25;
  shrink=Math.max(0,shrink);

  var baseY=y+h;                                 /* 燃料面：火从底部往上烧 */
  /* 底座余烬带（先画，火苗覆盖其上；熄灭后转灰黑） */
  var eK=dousing?Math.min(1,pr/0.6):0;
  _px(g,x,baseY-1,w,1,dousing?_mixHex('#8a2a10','#2a2622',eK):'#8a2a10');

  /* ---- 火舌主体：按「列高度场」生成轮廓 ----
     ★为什么不再是三角形★：真实火焰是**下宽上尖、边缘圆润、且整体左右
     摆动**的不规则体。逐列算高度（中心列最高、向两侧平滑收窄）+ 双频
     正弦抖动，就能得到"舔动的火苗"轮廓，而不是僵直的等边三角。
     颜色按「温度」映射：中心 / 根部最热（白芯 → 黄 → 橙），
     边缘 / 顶端最冷（橙 → 红 → 暗红）—— 这正是烛火/篝火的真实分层。
     ★确定性★：全部相位由时间与列号算出，无 Math.random() ⇒ 可确定性重放。 */
  var coreC='#fffbe0',hotC='#ffd24a',lowC='#e0431a',tipC='#8a1f08';
  var swayC=0.5+0.05*Math.sin(now*rate*0.63);    /* 整体低频左右轻摆 */
  for(var cx=0;cx<w;cx++){
    var u=w>1?cx/(w-1):0.5;
    var dd=Math.abs(u-swayC)*2;                  /* 0=中心 1=边缘 */
    var distF=Math.max(0,1-dd*dd*(0.75+0.25*dd));/* 圆润火舌轮廓（中心=1） */
    if(w<=3&&distF<0.5)distF=0.5;                /* 极窄的火也要能看见 */
    var flick=0.80+0.20*Math.sin(now*rate*1.9+u*7.3)
                   +0.10*Math.sin(now*rate*3.1-u*4.1+1.3);
    var colH=Math.round(h*distF*flick*shrink);
    if(colH<1)continue;
    var topY=baseY-colH;
    /* 逐行算温度→颜色；把连续同色的行并成一次填充（减少 fillRect 次数） */
    var runC=null,runLen=0,runY=0;
    for(var rr=0;rr<colH;rr++){
      var b=colH>1?rr/(colH-1):1;                /* 0=顶(尖) 1=底(根) */
      var T=distF*(0.75+0.55*b)-0.30*(1-b);      /* 温度：越靠中心/根部越热 */
      if(T<0)T=0;else if(T>1)T=1;
      var c=T>0.86?coreC
        :(T>0.64?_mixHex(hotC,coreC,(T-0.64)/0.22)
          :(T>0.42?_mixHex(flame,hotC,(T-0.42)/0.22)
            :(T>0.22?_mixHex(lowC,flame,(T-0.22)/0.20)
              :_mixHex(tipC,lowC,T/0.22))));
      if(c!==runC){
        if(runC!==null)_px(g,x+cx,topY+runY,1,runLen,runC);
        runC=c;runY=rr;runLen=1;
      }else runLen++;
    }
    if(runC!==null)_px(g,x+cx,topY+runY,1,runLen,runC);
  }
  /* ---- 漂升的火星 / 断续的火舌尖（确定性：相位由序号算出）---- */
  var tipA=Math.max(0,shrink)*(dousing?Math.max(0,1-pr/0.6):1);
  if(tipA>0.06){
    g.globalAlpha=tipA;
    for(var k=0;k<3;k++){
      var ph=now*rate*(0.7+k*0.13)+k*2.1;
      var rs=ph-Math.floor(ph);                  /* 0..1 上升进度 */
      var ex=x+Math.round(w*(0.28+0.22*k)+Math.sin(ph*2.3)*1.4);
      var ey=Math.round(baseY-h*(0.70+rs*0.60));
      _pxDot(g,ex,ey,rs<0.5?coreC:_mixHex(hotC,lowC,rs));
      if(rs>0.18&&rs<0.6)_pxDot(g,ex,ey+1,_mixHex(flame,lowC,rs));
    }
    g.globalAlpha=1;
  }
  g.restore();
  if(!playMode){
    g.strokeStyle='rgba(255,122,26,0.35)';
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
  }
}
/* ★幽灵带水的表现（§5.5）：果冻/液体感的水珠环绕★
   全部程序化、**无 Math.random()**（相位由水珠序号算出）⇒ 可确定性重放。
   三个要点：
     环绕   N 颗水珠（N=ceil(wet×6)）绕幽灵本体做**椭圆轨道**运动，半径随 sin 搏动
     果冻感 每颗不是正圆：画成**竖向略长的椭圆**，并逐帧在"略高/略扁"间形变
     液体感 半透明 + 左上 1px 高光 + 相邻两颗间 1px 淡线（表面张力"拉丝"） */
function drawGhostWetTo(g, gh, now, fa, zoom){
  var w=gh.wet||0;
  if(w<=0.02)return;
  var cx=gh.x+4, cy=gh.y+4;
  var N=Math.ceil(Math.min(1,w)*6);            /* 水量越少，水珠越少 */
  if(N<1)return;
  var z=Math.max(zoom,0.5);
  g.save();
  g.lineWidth=1/z;
  for(var i=0;i<N;i++){
    var ph=(i/N)*Math.PI*2;
    var pulse=1+Math.sin(now*2.4+ph)*0.12;      /* 轨道半径轻微搏动 */
    var rx=6.0*pulse, ry=5.0*pulse;
    /* 轨道缓慢自转，读数像"环绕"而不是"上下抖" */
    var ang=now*1.5+ph;
    var bx=cx+Math.cos(ang)*rx;
    var by=cy+Math.sin(ang)*ry;
    /* 果冻形变：squash 在"略高↔略扁"之间循环（相位按序号错开） */
    var sq=1+Math.sin(now*5.0+i*1.7)*0.18;
    var bw=1.4, bh=1.4*sq*1.2;                  /* 高∶宽 ≈1.2 */
    var a=(0.55+Math.min(0.25,w*0.25))*fa;
    g.globalAlpha=a;
    /* 水珠本体（用两个圆角像素块近似椭圆） */
    g.fillStyle='#7ec8ff';
    g.fillRect(Math.round(bx-bw/2),Math.round(by-bh/2),Math.max(1,Math.round(bw)),Math.max(1,Math.round(bh)));
    /* 中心偏白，读出"透明液体" */
    g.fillStyle='rgba(230,246,255,'+(a*0.85)+')';
    g.fillRect(Math.round(bx),Math.round(by-bh/2+1),1,Math.max(1,Math.round(bh)-2));
    /* 左上 1px 高光点 */
    g.fillStyle='rgba(255,255,255,'+a+')';
    g.fillRect(Math.round(bx-bw/2),Math.round(by-bh/2),1,1);
    /* 相邻两颗间偶尔拉丝（表面张力）：只在两颗都靠得够近时画 */
    if(i<N-1){
      var ph2=((i+1)/N)*Math.PI*2;
      var ang2=now*1.5+ph2;
      var bx2=cx+Math.cos(ang2)*rx, by2=cy+Math.sin(ang2)*ry;
      var dx=bx2-bx, dy=by2-by;
      if(dx*dx+dy*dy<36){
        g.globalAlpha=a*0.35;
        g.strokeStyle='#7ec8ff';
        g.beginPath();g.moveTo(bx,by);g.lineTo(bx2,by2);g.stroke();
      }
    }
  }
  g.restore();
}
/* ★熄灭时的蒸汽粒子★：白→灰、向上漂、快速渐隐（配合火星下沉）。
   与既有 `mkParticle(x,y,vx,vy,life,r,g,b)` 复用同一粒子池。
   ⚠️ 纯表现：**不进 Play 的任何判定分支**，也因此允许用 Math.random() 造自然抖动。 */
function _spawnDouseSteam(x,y){
  if(!Play.particles)return;
  for(var i=0;i<8;i++){
    Play.particles.push(mkParticle(
      x+(Math.random()-0.5)*6, y+(Math.random()-0.5)*4,
      (Math.random()-0.5)*0.6, -0.5-Math.random()*0.8,
      420+Math.random()*260, 240, 240, 245));
  }
  for(var j=0;j<4;j++){
    Play.particles.push(mkParticle(
      x+(Math.random()-0.5)*6, y+(Math.random()-0.5)*4,
      (Math.random()-0.5)*0.9, 0.4+Math.random()*0.6,
      300+Math.random()*200, 255, 160, 60));
  }
}
/* ★传送门（v3）★：入口/出口两套外观。门对玩家完全无害、完全无感 ⇒
   视觉语言刻意做得"虚、淡、半透明"，像一层标记而非实体（与玩家机关区分开）。
   方向感：入口粒子**向心**收（吸进去），出口粒子**离心**喷（喷出来）。
   纯表现、无 Math.random()（相位按索引算）⇒ 可确定性重放。 */
function drawPortalTo(g, po, playMode){
  var x=Math.round(po.x), y=Math.round(po.y);
  var w=Math.round(po.w||16), h=Math.round(po.h||24);
  if(w<1||h<1)return;
  var now=_simTime();
  var isIn=(po.role==='in');
  var col=po.color||(isIn?'#7a5aff':'#ff9a3a');
  var cx=x+w/2, cy=y+h/2;
  var rx=w/2, ry=h/2;
  /* 门环：椭圆（用两段像素弧近似），半透明 ⇒ 读作"虚" */
  g.save();
  g.globalAlpha=0.55;
  g.strokeStyle=col;
  g.lineWidth=1.2;
  g.beginPath();
  g.ellipse?g.ellipse(cx,cy,rx,ry,0,0,Math.PI*2):g.arc(cx,cy,Math.max(rx,ry),0,Math.PI*2);
  g.stroke();
  /* 内层更淡的同心环（深度感） */
  g.globalAlpha=0.28;
  g.beginPath();
  g.ellipse?g.ellipse(cx,cy,rx*0.62,ry*0.62,0,0,Math.PI*2):g.arc(cx,cy,Math.max(rx*0.62,ry*0.62),0,Math.PI*2);
  g.stroke();
  g.restore();
  /* 流动光点：入口向心、出口离心（方向提示） */
  var N=5;
  for(var i=0;i<N;i++){
    var ph=now*1.6+i*(Math.PI*2/N);
    /* tt：入口从外→内（1→0），出口从内→外（0→1） */
    var tt=(now*0.7+i/N)%1;
    var rr=isIn?(1-tt):tt;
    var px=cx+Math.cos(ph)*rx*rr;
    var py=cy+Math.sin(ph)*ry*rr;
    var aa=(isIn?tt:1-tt)*0.8;
    g.globalAlpha=aa*0.9;
    g.fillStyle=col;
    g.fillRect(Math.round(px),Math.round(py),1,1);
  }
  g.globalAlpha=1;
  /* 方向缺口/箭头：入口在内侧、出口在外侧，暗示"从这进/从这出" */
  var ax=isIn?cx+rx*0.45:cx+rx+2;
  var ax2=isIn?cx+rx*0.8:cx+rx+5;
  g.strokeStyle=col;g.lineWidth=1;g.globalAlpha=0.7;
  g.beginPath();
  if(isIn){g.moveTo(ax-2,cy-2);g.lineTo(ax,cy);g.lineTo(ax-2,cy+2);}
  else    {g.moveTo(ax2-3,cy-2);g.lineTo(ax2,cy);g.lineTo(ax2-3,cy+2);}
  g.stroke();
  g.globalAlpha=1;
  if(!playMode){
    g.strokeStyle=(isIn?'rgba(122,90,255,0.35)':'rgba(255,154,58,0.35)');
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
  }
}

/* ============================================================================
   ★怪物与 BOSS —— 渲染层（v1）★
   ----------------------------------------------------------------------------
   统一纪律（与既有 drawFireTo / drawBeastTo 完全一致）：
     · 全部程序化像素（`_px` / `_pxDot` / fillRect），零图片资源；
     · 表现层相位一律由「序号 + `_simTime()`」算出，**不用 Math.random()**
       ⇒ 同一序列重放两次画面逐帧一致（可被重放缓存复现）。
     · `playMode=false`（编辑器）时额外画虚线包围盒，方便摆放与对齐。 */
function drawGraveTo(g, gr, playMode){
  var x=Math.round(gr.x), y=Math.round(gr.y);
  var w=Math.round(gr.w||8), h=Math.round(gr.h||8);
  if(w<1||h<1)return;
  var now=_simTime();
  var st=gr.state||'idle';
  g.save();
  if(st==='idle'){
    /* ---- 待机：圆顶墓碑 + 苔痕 + 刻痕，整体随呼吸极轻起伏 ---- */
    var br=Math.sin(now*1.5)*0.5;
    var bx=x, by=y+Math.round(br);
    /* 碑体：上圆下直（用逐行宽度画出圆顶） */
    var cap=Math.max(2,Math.round(w*0.5));
    for(var ry=0;ry<h;ry++){
      var rw=w;
      if(ry<cap){                      /* 圆顶：按椭圆收边 */
        var t=ry/cap;
        rw=Math.max(2,Math.round(w*Math.sqrt(1-(1-t)*(1-t))));
      }
      var rx=bx+Math.round((w-rw)/2);
      _px(g,rx,by+ry,rw,1,ry<Math.max(1,Math.round(h*0.25))?'#b6bcc4':'#9aa0a8');
    }
    /* 右侧阴影 + 底部压深：给一点体积感 */
    _px(g,bx+w-1,by+cap,1,h-cap,'#6e747c');
    _px(g,bx,by+h-1,w,1,'#5a6068');
    /* 顶部高光弧 */
    _px(g,bx+Math.round(w*0.28),by,Math.max(2,Math.round(w*0.44)),1,'#ccd2da');
    /* 刻痕：十字 */
    var cx2=bx+Math.floor(w/2);
    _px(g,cx2,by+cap+1,1,Math.max(2,h-cap-3),'#60666e');
    _px(g,cx2-1,by+cap+2,3,1,'#60666e');
    /* 苔痕：底部两点（相位错开，轻微明暗闪烁） */
    var mo=0.5+0.5*Math.sin(now*2.2);
    g.globalAlpha=0.55+0.25*mo;
    _pxDot(g,bx+1,by+h-2,'#5c7a48');
    _pxDot(g,bx+w-2,by+h-3,'#4d6a3c');
    g.globalAlpha=1;
  }else{
    /* ---- 粉碎（crumbling）：三段 —— ① 震动 ② 裂纹爬升 ③ 炸成碎石 ---- */
    var T=gr.crumbleTime||0.6, pr=Math.min(1,(gr._t||0)/T);
    var shx=(pr<0.25)?Math.round(Math.sin(now*70)*1):0;   /* ① 高频抖动 ±1px */
    var bx2=x+shx, by2=y;
    if(pr<0.72){
      /* ①② 碑体在原地（抖动）+ 竖向裂纹自上而下爬升 */
      var crack=pr/0.72;
      for(var cy=0;cy<h;cy++){
        var rw2=w, cap2=Math.max(2,Math.round(w*0.5));
        if(cy<cap2){var t2=cy/cap2;rw2=Math.max(2,Math.round(w*Math.sqrt(1-(1-t2)*(1-t2))));}
        var rx2=bx2+Math.round((w-rw2)/2);
        _px(g,rx2,by2+cy,rw2,1,'#8e949c');
      }
      /* 裂纹：主裂 + 两条分叉，长度随 crack 增长 */
      var cl=Math.round(crack*h);
      var jx=Math.floor(w*0.5);
      for(var k=0;k<cl;k++){
        var jit=(k%3===0)?1:((k%3===1)?-1:0);
        _px(g,bx2+jx+jit,by2+k,1,1,'#24282e');
        if(k>h*0.3)_px(g,bx2+jx+2+((k%2)?1:0),by2+k,1,1,'#24282e');
      }
      if(pr>0.35){ _px(g,bx2+1,by2+Math.round(h*0.55),1,Math.round(h*0.4),'#24282e'); }
    }else{
      /* ③ 炸成碎石：把碎片位置写成「序号 → 抛物线」的确定性函数 */
      var t3=(pr-0.72)/0.28;
      var N=9;
      for(var i=0;i<N;i++){
        var a=-Math.PI/2+(i/(N-1)-0.5)*2.2;                /* 扇形向上散开 */
        var sp=(0.9+_pr(gr.x*3.7+i*1.9)*1.6)*22;
        var vx=Math.cos(a)*sp, vy=Math.sin(a)*sp-6;
        var fxx=bx2+w/2+vx*t3, fyy=by2+h*0.5+vy*t3+46*t3*t3;  /* 重力抛物线 */
        if(t3>0.92)continue;
        var fs=Math.max(1,Math.round((1-t3)*2.4*(0.7+_pr(i*7.3)*0.6)));
        g.globalAlpha=Math.max(0,1-t3*1.05);
        _px(g,Math.round(fxx),Math.round(fyy),fs,fs,(i%3===0)?'#b6bcc4':((i%3===1)?'#8e949c':'#6e747c'));
      }
      g.globalAlpha=1;
    }
  }
  g.restore();
  if(!playMode){
    g.strokeStyle='rgba(154,160,168,0.4)';g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
    /* 触发距离：编辑器里以虚线圆示出 */
    var tr2=gr.triggerRadius||32;
    g.save();g.setLineDash([3,3]);
    g.strokeStyle='rgba(200,60,80,0.30)';g.lineWidth=0.6;
    g.beginPath();g.arc(x+w/2,y+h/2,tr2,0,Math.PI*2);g.stroke();
    g.restore();
  }
}

/* ★苍白鬼魂（小怪1）★：半透明飘浮 + 波浪拖尾 + 大而空洞的眼睛；
   出场从墓碑「钻出来」再放大；被击杀时惊讶表情（眼睛变 `!`）+ 炸成白雾。 */
function drawGhostFoeTo(g, foe, now, zoom){
  var x=Math.round(foe.x), y=Math.round(foe.y);
  var w=Math.round(foe.w||8), h=Math.round(foe.h||8);
  var x2=Math.max(0,(foe._t||0)/0.45);        /* 出场进度 0→1 */
  var app=x2<1?x2:1;
  var dying=(foe.state==='dying');
  var dp=dying?Math.min(1,(foe._anim||0)/0.35):0;
  var alpha=(dying?(1-dp):1)*(0.55+0.45*app);  /* 半透明（幽灵感） */
  var bob=Math.sin(now*2.4+(foe._ph||0))*1.2;  /* 上下浮 */
  var cx=x+w/2, cy=y+h/2+bob;
  var sc=0.35+0.65*app;
  g.save();
  g.globalAlpha=alpha;
  /* 拖尾：三团逐渐变淡的尾影（波浪相位随序号） */
  for(var t=2;t>=1;t--){
    g.globalAlpha=alpha*(0.10+t*0.06);
    var tx=cx-Math.round((foe._dir||1)*t*2.2), ty=cy+Math.sin(now*2.4-t*0.7+(foe._ph||0))*1.2;
    _px(g,tx-w*sc/2,ty-h*sc/2,w*sc,h*sc,'#cdd8ff');
  }
  g.globalAlpha=alpha;
  var hw=Math.max(2,Math.round(w*sc)), hh=Math.max(2,Math.round(h*sc));
  var hx=Math.round(cx-hw/2), hy=Math.round(cy-hh/2);
  /* ---- 本体：上半圆、下摆波浪（幽灵标准造型）---- */
  var cap=Math.max(1,Math.round(hh*0.55));
  for(var ry=0;ry<hh;ry++){
    var rw=hw;
    if(ry<cap){var tt=ry/cap;rw=Math.max(2,Math.round(hw*Math.sqrt(1-(1-tt)*(1-tt))));}
    /* 下摆做成波浪：底部 30% 每列高度随 x 相位起伏 */
    else if(ry>=hh-Math.max(1,Math.round(hh*0.3))){
      var k=ry-(hh-Math.max(1,Math.round(hh*0.3)));
      rw=Math.max(1,rw-Math.round(Math.abs(Math.sin((k/1.4)*Math.PI))*0.8));
    }
    var rx=Math.round(hx+(hw-rw)/2);
    var shade=(ry<cap)?'#e8eeff':'#dbe4ff';
    _px(g,rx,hy+ry,rw,1,shade);
  }
  /* 左侧一点更亮的边缘（体积） */
  for(var ry2=cap;ry2<hh-1;ry2++){ _px(g,hx+1,hy+ry2,1,1,'#f4f8ff'); }
  /* ---- 表情 ---- */
  var ey=hy+Math.round(hh*0.36);
  var eL=hx+Math.round(hw*0.26), eR=hx+Math.round(hw*0.60);
  if(dying){
    /* 惊讶：眼变 `!`（一竖一点） */
    _px(g,eL,ey-Math.max(1,Math.round(hh*0.12)),1,Math.max(2,Math.round(hh*0.26)),'#1a2030');
    _pxDot(g,eL,ey+Math.max(2,Math.round(hh*0.24)),'#1a2030');
    _px(g,eR,ey-Math.max(1,Math.round(hh*0.12)),1,Math.max(2,Math.round(hh*0.26)),'#1a2030');
    _pxDot(g,eR,ey+Math.max(2,Math.round(hh*0.24)),'#1a2030');
  }else{
    /* 空洞大眼：黑底 + 一点朝玩家的高光（追踪感） */
    var eS=Math.max(1,Math.round(hw*0.20));
    _px(g,eL,ey,eS,eS,'#161c2a');
    _px(g,eR,ey,eS,eS,'#161c2a');
    var gx=(foe._gaze||0);
    _pxDot(g,eL+(gx>0?eS-1:0),ey,'#9fc4ff');
    _pxDot(g,eR+(gx>0?eS-1:0),ey,'#9fc4ff');
    /* 小嘴：一条 1px 横线；开火冷却时张大（滑稽） */
    var mo=foe._fireCd!==undefined&&foe._fireCd>0&&foe._fireCd<0.25;
    _px(g,hx+Math.round(hw*0.42),hy+Math.round(hh*0.66),Math.max(1,Math.round(hw*0.18)),mo?2:1,'#161c2a');
  }
  /* 被击杀：白雾爆开 */
  if(dying){
    g.globalAlpha=(1-dp)*0.85;
    for(var i=0;i<8;i++){
      var a=(i/8)*Math.PI*2+dp*1.2;
      var rr=dp*11;
      _px(g,Math.round(cx+Math.cos(a)*rr-1),Math.round(cy+Math.sin(a)*rr-1),2,2,'#eef3ff');
    }
    g.globalAlpha=1;
  }
  g.restore();
}

/* ★火团怪（小怪2）★：一小团小人被火包裹；火苗用逐列高度场（与 drawFireTo 同语言），
   出场从火焰里"弹"出来（抛物小跳），被水扑灭时冒白烟缩小消失。 */
function drawFireFoeTo(g, foe, now){
  var x=Math.round(foe.x), y=Math.round(foe.y);
  var w=Math.round(foe.w||8), h=Math.round(foe.h||8);
  var x2=Math.max(0,(foe._t||0)/0.5), app=x2<1?x2:1;
  var dying=(foe.state==='dying');
  var dp=dying?Math.min(1,(foe._anim||0)/0.4):0;
  var bob=Math.sin(now*3.1+(foe._ph||0))*0.8;
  var cx=x+w/2, cy=y+h/2+bob;
  var sc=0.5+0.5*app;
  g.save();
  g.globalAlpha=dying?(1-dp*0.9):1;
  var hw=Math.max(2,Math.round(w*sc)), hh=Math.max(2,Math.round(h*sc));
  /* ---- 内核：一只小黑圆身 + 两点火眼（滑稽） ---- */
  var bx=Math.round(cx-hw/2), by=Math.round(cy-hh/2);
  var cap=Math.max(1,Math.round(hh*0.6));
  for(var ry=0;ry<hh;ry++){
    var rw=hw;
    if(ry<cap){var tt=ry/cap;rw=Math.max(2,Math.round(hw*Math.sqrt(1-(1-tt)*(1-tt))));}
    var rx=Math.round(bx+(hw-rw)/2);
    _px(g,rx,by+ry,rw,1,ry<Math.round(hh*0.4)?'#3a2018':'#2a1710');
  }
  var eS=Math.max(1,Math.round(hw*0.18));
  _px(g,bx+Math.round(hw*0.24),by+Math.round(hh*0.34),eS,eS,'#ffd24a');
  _px(g,bx+Math.round(hw*0.58),by+Math.round(hh*0.34),eS,eS,'#ffd24a');
  /* ---- 包裹的火焰：逐列高度场（与 drawFireTo 同一温度色带） ---- */
  var temp=dying?(1-dp):1;                       /* 被扑灭时火势衰减 */
  var n=Math.max(4,hw);
  for(var i=0;i<n;i++){
    var u=(n<=1)?0.5:i/(n-1);
    var dd=Math.abs(u-0.5)*2;
    var distF=Math.max(0,1-dd*dd*(0.75+0.25*dd));
    var flick=0.80+0.20*Math.sin(now*3.4+u*7.3+(foe._ph||0))
                   +0.10*Math.sin(now*5.9-u*4.1+1.3);
    var fh=Math.round(hh*(0.55+0.85*distF*flick)*temp);
    var fx=bx+i;
    for(var k=0;k<fh;k++){
      var bv=1-k/Math.max(1,fh);
      var T=distF*(0.75+0.55*bv)-0.30*(1-bv);
      var col=T>0.80?'#fffbe0':(T>0.60?'#ffd24a':(T>0.34?'#ff8a2a':(T>0.16?'#e0431a':'#8a1f08')));
      _px(g,fx,Math.round(cy-hh*0.25)-k,1,1,col);
    }
  }
  /* 火星：3 颗确定性漂升 */
  if(!dying){
    for(var s=0;s<3;s++){
      var sp=now*1.3+s*2.1+(foe._ph||0);
      var sx=bx+Math.round((0.25+0.5*_pr(s*3.1+foe.x))*hw);
      var sy=Math.round(cy-hh*0.4-((sp*14)%22));
      _pxDot(g,sx,sy,s%2?'#ffd24a':'#ffb040');
    }
  }
  /* 被扑灭：白烟 + 缩小 */
  if(dying){
    g.globalAlpha=(1-dp)*0.8;
    for(var q=0;q<6;q++){
      var aq=(q/6)*Math.PI*2;
      _px(g,Math.round(cx+Math.cos(aq)*dp*9-1),Math.round(cy+Math.sin(aq)*dp*9-dp*4-1),2,2,'#e8eef2');
    }
    g.globalAlpha=1;
  }
  g.restore();
  /* 暖色光晕（双层，极淡） */
  g.save();
  g.globalAlpha=0.10*(dying?(1-dp):1);
  g.fillStyle='#ff8a2a';
  g.beginPath();g.arc(cx,cy,hw*1.15,0,Math.PI*2);g.fill();
  g.globalAlpha=0.07*(dying?(1-dp):1);
  g.beginPath();g.arc(cx,cy,hw*1.7,0,Math.PI*2);g.fill();
  g.restore();
}

/* ★骷髅怪（小怪3）★：方块骷髅 + 左右两侧尖刺；三态动作。
   patrol 颠簸走 · charge 后仰蓄力 + 冲刺速度线 · stun 头顶自转星星 + 眼变 X。 */
function drawSkeletonTo(g, sk, playMode){
  var x=Math.round(sk.x), y=Math.round(sk.y);
  var w=Math.round(sk.w||12), h=Math.round(sk.h||10);
  if(w<1||h<1)return;
  var now=_simTime();
  var st=sk.state||'patrol';
  var dir=sk._dir||1;
  g.save();
  var bob=0, tilt=0;
  if(st==='patrol'){ bob=Math.round(Math.abs(Math.sin(now*7))*1); }
  else if(st==='charge'){
    var cw=sk._windup||0.35;
    var cp=Math.min(1,(sk._t||0)/cw);
    if((sk._t||0)<cw){ bob=-Math.round(cp*2); tilt=dir*Math.round(cp*1); }   /* 后仰蓄力 */
    else { bob=Math.round((sk._chargeFrom!==undefined?0:0)); }
  }
  var bx=x, by=y+bob;
  /* ---- 左右两侧尖刺（每侧 3 根，随状态伸缩） ---- */
  var spikeN=3, spikeLen=Math.max(2,Math.round(w*0.28));
  var grow=(st==='charge'&&(sk._t||0)<(sk._windup||0.35))?1:0.6;
  var sl=Math.max(1,Math.round(spikeLen*(0.7+0.5*grow)));
  for(var s=0;s<spikeN;s++){
    var sy=by+Math.round(h*0.18)+s*Math.max(2,Math.round(h*0.26));
    /* 左尖刺：向右为尖 —— 逐行画成三角 */
    for(var k=0;k<sl;k++){
      var th=Math.max(1,Math.round((spikeN*2)-k*0.9));
      _px(g,bx-k-1,sy+Math.floor((sl-k)*0.3),1,th,'#e8e8f0');
    }
    for(var k2=0;k2<sl;k2++){
      var th2=Math.max(1,Math.round((spikeN*2)-k2*0.9));
      _px(g,bx+w+k2,sy+Math.floor((sl-k2)*0.3),1,th2,'#e8e8f0');
    }
  }
  /* ---- 主体：方块头骨 ---- */
  _px(g,bx,by,w,h,'#eef0f6');
  _px(g,bx,by,w,1,'#ffffff');                     /* 顶部高光 */
  _px(g,bx,by+h-1,w,1,'#b8bcc6');                 /* 底部阴影 */
  _px(g,bx+w-1,by,1,h,'#c8ccd6');
  /* 眼窝（大而黑）+ 鼻洞 */
  var eS=Math.max(2,Math.round(h*0.30));
  var eY=by+Math.round(h*0.18);
  var eLX=bx+Math.round(w*0.16), eRX=bx+Math.round(w*0.60);
  if(st==='stun'){
    /* X 眼（眩晕）：两条对角 */
    for(var k3=0;k3<eS;k3++){
      _px(g,eLX+k3,eY+k3,1,1,'#1a1a22');_px(g,eLX+eS-1-k3,eY+k3,1,1,'#1a1a22');
      _px(g,eRX+k3,eY+k3,1,1,'#1a1a22');_px(g,eRX+eS-1-k3,eY+k3,1,1,'#1a1a22');
    }
  }else{
    _px(g,eLX,eY,eS,eS,'#1a1a22');
    _px(g,eRX,eY,eS,eS,'#1a1a22');
    /* 冲锋时眼窝发红（威胁预告） */
    if(st==='charge'){ _px(g,eLX+1,eY+1,Math.max(1,eS-2),Math.max(1,eS-2),'#ff3a3a'); _px(g,eRX+1,eY+1,Math.max(1,eS-2),Math.max(1,eS-2),'#ff3a3a'); }
  }
  _px(g,bx+Math.round(w*0.46),by+Math.round(h*0.52),Math.max(1,Math.round(w*0.10)),Math.max(1,Math.round(h*0.16)),'#1a1a22');
  /* 牙：底部一排 1px 竖线 */
  for(var tx=1;tx<w-1;tx+=2){ _px(g,bx+tx,by+h-Math.max(1,Math.round(h*0.16)),1,Math.max(1,Math.round(h*0.14)),'#9aa0ac'); }
  /* ---- 状态中的额外表现 ---- */
  if(st==='charge'&&(sk._t||0)>=(sk._windup||0.35)){
    /* 冲刺速度线（身后 4 条平行短横线，长度/alpha 递减） */
    var spd=Math.min(1,((sk._t||0)-(sk._windup||0.35))/0.5);
    for(var li=0;li<4;li++){
      var ln=Math.round((8-li*1.4)*(1-spd*0.4));
      if(ln<1)continue;
      g.globalAlpha=0.55-li*0.11;
      _px(g,bx-((dir>0)?0:(w))-((li+1)*3)-ln*(dir>0?1:0),by+Math.round(h*0.4)+li*2,ln,1,'#ffffff');
      g.globalAlpha=1;
    }
  }
  if(st==='stun'){
    /* 头顶 3 颗自转小星星（相位按序号错开 ⇒ 确定性、无 random） */
    var rot=now*4;
    for(var i=0;i<3;i++){
      var a=rot+i*(Math.PI*2/3);
      var rr=Math.max(3,Math.round(w*0.42));
      var sx=bx+w/2+Math.cos(a)*rr, sy=by-Math.max(2,Math.round(h*0.45))+Math.sin(a)*rr*0.42;
      _pxDot(g,Math.round(sx),Math.round(sy),'#ffe9a8');
      _pxDot(g,Math.round(sx),Math.round(sy)-1,'#ffd24a');
      _pxDot(g,Math.round(sx)-1,Math.round(sy),'#ffd24a');
    }
  }
  g.restore();
  if(!playMode){
    g.strokeStyle='rgba(232,232,240,0.4)';g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
    /* 巡视范围 + 察觉范围（编辑器可视化） */
    var pr2=sk.patrolRange||40, dr2=sk.detectRange||88;
    g.save();g.setLineDash([2,3]);g.lineWidth=0.6;
    g.strokeStyle='rgba(120,200,255,0.35)';
    g.beginPath();g.moveTo(sk._homeX-pr2/2,y+h+1);g.lineTo(sk._homeX+pr2/2,y+h+1);g.stroke();
    g.strokeStyle='rgba(255,90,90,0.28)';
    g.beginPath();g.arc(x+w/2,y+h/2,dr2,0,Math.PI*2);g.stroke();
    g.restore();
  }
}

/* ★弹幕（尖刺 / 火球 / 激光）★：统一分派。全部由「序号 + 时间」驱动相位。 */
function drawBulletTo(g, blt, now){
  var x=Math.round(blt.x), y=Math.round(blt.y);
  var w=Math.round(blt.w||3), h=Math.round(blt.h||3);
  var k=blt.kind||'spike';
  g.save();
  if(k==='spike'){
    /* 尖刺：向下为尖的三角 + 红白拖尾 */
    for(var ry=0;ry<h;ry++){
      var rw=Math.max(1,Math.round(w*(1-ry/Math.max(1,h))*0.9+1));
      _px(g,x+Math.round((w-rw)/2),y+ry,rw,1,ry<h*0.4?'#ffd0d8':'#ff5577');
    }
    g.globalAlpha=0.45;
    _px(g,x+Math.round(w/2)-1,y-Math.min(6,Math.round(w)),1,Math.min(6,Math.round(w)),'#ff9aa8');
    g.globalAlpha=1;
  }else if(k==='fireball'){
    /* 火球：白芯 + 橙边 + 尾焰 */
    _px(g,x,y,w,h,'#ff8a2a');
    _px(g,x+1,y+1,Math.max(1,w-2),Math.max(1,h-2),'#ffd24a');
    _pxDot(g,x+Math.round(w/2),y+Math.round(h/2),'#fffbe0');
    g.globalAlpha=0.4;
    _px(g,x+Math.round(w/2)-1,y-Math.min(5,h*2),1,Math.min(5,h*2),'#ff6a1a');
    g.globalAlpha=1;
  }else if(k==='ghostShot'){
    /* 鬼魂子弹：一小团圆润的白蓝球（可爱但致命） */
    _px(g,x,y,w,h,'#c8d8ff');
    _px(g,x+1,y+1,Math.max(1,w-2),Math.max(1,h-2),'#eef3ff');
    g.globalAlpha=0.35;
    _px(g,x+Math.round(w/2)-1,y+Math.round(h/2)-1,w*2,h*2,'#9fc4ff');
    g.globalAlpha=1;
  }else if(k==='laser'){
    /* 激光：0.5s 预警细虚线 → 0.35s 实心光柱（从顶向下扫） */
    var ph=blt._phase||0;                 /* 0=预警 1=实体 */
    var wcol=w;
    if(!ph){
      g.globalAlpha=0.55+0.25*Math.sin(now*20);
      g.fillStyle='#ff5577';
      for(var yy=y;yy<y+h;yy+=3){ g.fillRect(x+Math.round(wcol/2),yy,1,1.5); }
      g.globalAlpha=1;
    }else{
      _px(g,x,y,wcol,h,'#ff5577');
      _px(g,x+Math.max(1,Math.round(wcol*0.3)),y,Math.max(1,Math.round(wcol*0.4)),h,'#ffffff');
      g.globalAlpha=0.30;
      _px(g,x-Math.max(1,wcol),y,wcol*3,h,'#ff8aa0');
      g.globalAlpha=1;
    }
  }
  g.restore();
}

/* ★BOSS 门★：与普通门同语言（铁栅 + 恶魔纹章），关合时有下落动画 + 震屏。 */
/* ★BOSS 门渲染（v2：开门态一眼可辨）★
   ----------------------------------------------------------------
   用户反馈：「boss门的开启状态的美术表现看起来不像开启，会让玩家误会是墙
             而不是可以穿过的物体」。
   旧版问题：无论开还是关，**门框（两根立柱 + 上下横梁）始终是同一组暗红实心像素**
   —— 栅栏缩回后，剩下的框在视觉上跟"墙"没有区别；兽头纹章也只是变暗、仍然在，
   于是玩家第一反应是"这堵墙过不去"。

   ▍v2 的做法：开 / 关用**两套截然不同的视觉语言**，不靠"少几根栅栏"来暗示
     · 关（op≈0）：暗红实心门框 + 4 根亮红栅栏 + 高亮兽头 ⇒ 沉重、封闭、挡住去路；
     · 开（op≈1）：整个门化作**冷色幽灵通道**——
         - 实心门框淡出，换成半透明的**青色虚线轮廓**（"这里通了"）；
         - 无栅栏，中央是空的（能直接看到背景 ⇒ 天然读作"可穿过"）；
         - 门内叠一层**向上的冷光流**（青蓝小光点缓缓上行）⇒ 明确的"入口/通道"意象；
         - 兽头纹章淡出成极暗的轮廓残影（不再抢注意力）。
     两态之间用 `op` 平滑插值，开门过程本身就是"红 → 空 → 青虚线"的形变，观感自然。
   ★确定性★：时间相位全部来自 `now=_simTime()` 与索引 i，无 Math.random ⇒ 可被 lab 复现。 */
function drawBossDoorTo(g, d, playMode){
  var x=Math.round(d.x), y=Math.round(d.y);
  var w=Math.round(d.w||8), h=Math.round(d.h||64);
  if(w<1||h<1)return;
  var now=_simTime();
  var op=(d._openProgress!==undefined)?d._openProgress:(d.open?1:0);
  if(op<0)op=0; if(op>1)op=1;
  var cxd=x+Math.round(w/2), cyd=y+Math.round(h*0.5);
  g.save();

  /* ============ ① 关闭态：暗红实心门框（随 op 淡出） ============ */
  if(op<0.999){
    var solid=1-op;
    g.globalAlpha=solid;
    /* 门框：始终画（表示位置），但开门时整组淡出 ⇒ 不会残留"像墙"的实心感 */
    _px(g,x-1,y,1,h,'#2a2030');
    _px(g,x+w,y,1,h,'#2a2030');
    _px(g,x-1,y-1,w+2,1,'#3a2c44');
    _px(g,x-1,y+h,w+2,1,'#3a2c44');
    /* 栅栏：关门时占满，开门时逐格缩回上方 */
    var bars=4;
    for(var i=0;i<bars;i++){
      var bh=Math.max(1,Math.round(h*(1-op)));       /* op=1 开 ⇒ 栅栏收到 0 高 */
      var by=y;
      var bxx=x+Math.round((i+0.5)*w/bars)-1;
      if(1-op>0.001){
        _px(g,bxx,by,2,bh,'#8a2a3a');
        _px(g,bxx,by,1,Math.max(1,Math.round(bh*0.5)),'#c04a5a');
      }
    }
    /* 上下横梁（栅栏的横撑） */
    _px(g,x+1,y+Math.round(h*0.18),w-2,1,'#6a1e2e');
    _px(g,x+1,y+Math.round(h*0.62),w-2,1,'#6a1e2e');
    /* 恶魔纹章：门中央一颗兽头（关着时高亮）。开门时随实心层一起淡出，
       只在极暗处留一点残影 ⇒ 不再"像一堵刻着图腾的墙"。 */
    var glow=(1-op);
    g.globalAlpha=solid*(0.35+0.65*glow);
    _px(g,cxd-2,cyd-2,4,4,'#e0b040');
    _pxDot(g,cxd-2,cyd-1,'#5a1a1a');_pxDot(g,cxd+1,cyd-1,'#5a1a1a');
    _pxDot(g,cxd-1,cyd+1,'#5a1a1a');_pxDot(g,cxd,cyd+1,'#5a1a1a');
    _pxDot(g,cxd-3,cyd-3,'#e0b040');_pxDot(g,cxd+2,cyd-3,'#e0b040');
  }
  g.globalAlpha=1;

  /* ============ ② 开启态：冷色幽灵通道（随 op 淡入） ============ */
  if(op>0.001){
    g.globalAlpha=op;
    var pulse=0.6+0.4*Math.sin(now*3.1);          /* 缓慢呼吸，提示"这里活着/可通行" */
    var TEAL='#5fe6d6', TEAL_HI='#b8fff4', TEAL_DIM='rgba(95,230,214,0.55)';
    /* 上下门楣：两小段青虚线（够醒目又不糊住画面） */
    var capW=Math.max(3,w-2);
    for(var cx2=0;cx2<capW;cx2+=3){
      _px(g,x+1+cx2,y-1,2,1,TEAL_DIM);
      _px(g,x+1+cx2,y+h,2,1,TEAL_DIM);
    }
    /* 左右立柱：**半透明虚线竖线**（代替实心框 ⇒ 一眼看出"这是边界不是墙"） */
    for(var cy2=0;cy2<h;cy2+=4){
      _px(g,x-1,y+cy2,1,2,TEAL_DIM);
      _px(g,x+w,y+cy2,1,2,TEAL_DIM);
    }
    /* 门内的"上行冷光流"：5 条错位的光点缓缓上升，终点在门顶淡出 —— 
       这个动效是"通道/传送口"最强的视觉语义，比任何静态框都直观。 */
    var lanes=5;
    for(var li=0;li<lanes;li++){
      var lx=x+1+Math.round((li+0.5)*(w-2)/lanes);
      var phase=((now*0.55+li*0.19)%1);
      var ly=y+h-2-Math.round(phase*(h-3));
      var a2=(1-phase)*0.85*op;
      if(a2>0.03){
        g.globalAlpha=a2*pulse;
        _pxDot(g,lx,ly,TEAL_HI);
        if(phase<0.85)_pxDot(g,lx,ly+1,TEAL);
        g.globalAlpha=op;
      }
    }
    /* 中央"入口徽记"：一个青色的向内的双箭头/门户符号（取代恶魔兽头） */
    g.globalAlpha=op*(0.55+0.45*pulse);
    _px(g,cxd-3,cyd-4,6,1,TEAL_HI);
    _px(g,cxd-2,cyd-3,4,1,TEAL_HI);
    _px(g,cxd-1,cyd-2,2,1,TEAL_HI);
    _px(g,cxd-3,cyd+3,6,1,TEAL_HI);
    _px(g,cxd-2,cyd+2,4,1,TEAL_HI);
    _px(g,cxd-1,cyd+1,2,1,TEAL_HI);
    g.globalAlpha=1;
  }

  g.restore();
  /* 编辑器态：外描边框（开=青、关=红）—— 与游戏内两态配色保持一致 */
  if(!playMode){
    g.strokeStyle=op>0.5?'rgba(95,230,214,0.55)':'rgba(192,32,64,0.45)';
    g.lineWidth=1;
    g.strokeRect(x-0.5,y-0.5,w+1,h+1);
  }
}

/* ============ ★BOSS 渲染★ ============
   设计：BOSS 是「场景级背景主体」——锚点固定在 `boss.x/boss.y`（元素世界坐标），
   只画**上半身**：头（双角 + 发光眼 + 大嘴）+ 上身（胸甲 + 魔纹）+ 双手（爪）。
   它**不进 allSolids**，玩家无法与之直接碰撞（用户原话「始终停在原地与玩家无法直接交互」）。

   ★确定性★：全部演出相位来自 `now`（=_simTime）与 `_pr(序号)`，
   **无 Math.random** ⇒ 同一局同一帧渲染结果逐像素相同（可被 lab 复现）。

   ★死亡崩解★：`state==='dead'` 后 `_deathT` 递增到 `_deathTime`，其间整体下坠 + 淡出 +
   18 块暗红碎片沿确定性抛物线四散。 */
function drawBossTo(g, boss, now, cam, zoom){
  if(!boss||boss.state==='gone')return;
  var x=Math.round(boss.x), y=Math.round(boss.y);
  var w=Math.round(boss.w), h=Math.round(boss.h);
  if(w<8||h<8)return;
  /* 细节剔除：整个 BOSS 在视野外就完全不画（它是全场最大的绘制对象） */
  if(cam&&(x+w<cam.x-140||x>cam.x+cam.viewW+140))return;
  var dead=(boss.state==='dead');
  var awake=(boss.state==='awake');
  var dTime=boss._deathTime||2.0;
  var dp=dead?Math.min(1,Math.max(0,(boss._deathT||0)/dTime)):0;
  var hurt=boss._hurtFlash||0;
  /* 基础色带（受击时整体闪白） */
  var body='#5a1a26', plate='#7d2534', dark='#3a0e18', edge='#a83a4c', bone='#e8dcc0';
  if(hurt>0){
    var kk=Math.min(1,hurt/0.25)*0.72;
    body=_mixHex(body,'#ffffff',kk);
    plate=_mixHex(plate,'#ffffff',kk);
    dark=_mixHex(dark,'#ffffff',kk*0.6);
    edge=_mixHex(edge,'#ffffff',kk);
  }
  g.save();
  if(dead){
    g.globalAlpha=Math.max(0,1-dp*0.95);
    g.translate(0,Math.round(dp*28));
  }
  /* ★苏醒淡入★（用户原话「BOSS 苏醒前可以是几乎透明的，苏醒时慢慢由透明状态
     过渡到完全不透明」）：`_vis` 由 `updateBoss` 缓动到 0.10(dormant) / 1.0(awake)。
     ★与死亡淡出相乘★：`dead` 时 `_vis` 已是 1.0（不再被压暗），死亡淡出走
     `1-dp*0.95` 那条；两者的乘积保证"先淡入、再淡出"两个阶段互不干扰。
     ★编辑器（cam===null）强制 1.0★：否则刚摆下的 BOSS 是半透明的，
     根本看不清自己在摆什么 —— 编辑器要"所见即所得"，与"正式游戏里苏醒前淡"不冲突。 */
  var vis=(cam?(boss._vis!==undefined?boss._vis:1):1);
  if(vis<0.999)g.globalAlpha*=vis;
  /* ---- 双手（爪）：先画，压在肩后 ---- */
  for(var side=0;side<2;side++){
    var dir=side?-1:1;
    var aw=Math.max(4,Math.round(w*0.13));            /* 前臂宽 */
    var pw=Math.max(6,Math.round(w*0.18));            /* 掌宽 */
    var ph=Math.max(5,Math.round(h*0.16));            /* 掌高 */
    var armH=Math.max(8,Math.round(h*0.32));
    var ax=dir>0?(x-Math.round(aw*0.55)):(x+w-Math.round(aw*0.45));
    var ay=y+Math.round(h*0.46)+Math.round(Math.sin(now*1.3+side*1.7)*2);
    _px(g,ax,ay,aw,armH,plate);
    _px(g,ax,ay,1,armH,dark);
    _px(g,ax+aw-1,ay,1,armH,edge);
    var px1=dir>0?(ax-pw+Math.round(aw*0.9)):ax;
    var py1=ay+armH-Math.round(ph*0.5);
    _px(g,px1,py1,pw,ph,body);
    _px(g,px1,py1,pw,1,edge);
    _px(g,px1,py1+ph-1,pw,1,dark);
    /* 三根指甲：从掌底向下垂的白骨尖 */
    var fl=Math.max(2,Math.round(h*0.10));
    for(var fi=0;fi<3;fi++){
      var fx=px1+Math.round((fi+0.5)*pw/3);
      for(var fk=0;fk<fl;fk++){
        var fw2=Math.max(1,Math.round(2*(1-fk/Math.max(1,fl))+0.6));
        _px(g,fx-Math.round(fw2/2),py1+ph-1+fk,fw2,1,bone);
      }
    }
  }
  /* ---- 上身（胸甲：逐行收边的桶形 + 中线 + 魔纹）---- */
  var torY=y+Math.round(h*0.38);
  var torH=Math.max(4,h-(torY-y));
  var torW=w;
  for(var ty=0;ty<torH;ty++){
    var tw2=Math.max(4,Math.round(torW*(0.80+0.20*Math.min(1,ty/Math.max(1,torH*0.5)))));
    _px(g,x+Math.round((torW-tw2)/2),torY+ty,tw2,1,plate);
  }
  _px(g,x+Math.round(w/2)-1,torY+2,2,Math.max(2,torH-4),dark);
  var runeY=torY+Math.round(torH*0.30)+Math.round(Math.sin(now*2)*1);
  var runeGlow=dead?0.12:(0.45+0.35*(0.5+0.5*Math.sin(now*3.2)));
  g.globalAlpha*=1;
  g.save();
  g.globalAlpha=runeGlow;
  _px(g,x+Math.round(w*0.28),runeY,Math.max(2,Math.round(w*0.10)),2,'#ff6a4a');
  _px(g,x+Math.round(w*0.62),runeY,Math.max(2,Math.round(w*0.10)),2,'#ff6a4a');
  _px(g,x+Math.round(w*0.45),runeY+3,Math.max(2,Math.round(w*0.10)),2,'#ff6a4a');
  g.restore();
  /* 肩甲 */
  _px(g,x-1,torY,Math.max(3,Math.round(w*0.10)),Math.max(3,Math.round(torH*0.22)),edge);
  _px(g,x+w-Math.max(2,Math.round(w*0.10))+1,torY,Math.max(3,Math.round(w*0.10)),Math.max(3,Math.round(torH*0.22)),edge);
  /* ---- 头（梯形 + 双角 + 发光眼 + 大嘴）---- */
  var headW=Math.max(14,Math.round(w*0.46));
  var headH=Math.max(12,Math.round(h*0.36));
  var headX=x+Math.round((w-headW)/2);
  var headY=y+Math.round(h*0.06);
  for(var hs=0;hs<2;hs++){
    var hd=hs?-1:1;
    var baseX=hd>0?(headX+Math.round(headW*0.10)):(headX+headW-Math.round(headW*0.10));
    var baseY=headY+Math.round(headH*0.18);
    for(var si2=0;si2<4;si2++){
      var t2=si2/3;
      var segW=Math.max(2,Math.round(headW*0.14*(1-t2*0.55)));
      var segH=Math.max(2,Math.round(headH*0.26*(1-t2*0.30)));
      var sx2=baseX+hd*Math.round(t2*headW*0.30);
      var sy2=baseY-Math.round((si2+1)*headH*0.24);
      _px(g,sx2-Math.round(segW/2),sy2,segW,segH,si2===3?bone:plate);
    }
  }
  for(var ry=0;ry<headH;ry++){
    var rr2=Math.max(2,Math.round(headW*(1-Math.abs(ry/headH-0.35)*0.28)));
    _px(g,headX+Math.round((headW-rr2)/2),headY+ry,rr2,1,ry<headH*0.20?edge:body);
  }
  _px(g,headX+Math.round(headW*0.42),headY+Math.round(headH*0.05),Math.max(2,Math.round(headW*0.16)),1,dead?'#5a3038':'#ff6a4a');
  /* 眼睛 */
  var eyeY=headY+Math.round(headH*0.40);
  var eyeW=Math.max(2,Math.round(headW*0.20));
  var eyeH=Math.max(2,Math.round(headH*0.16));
  var eyeLx=headX+Math.round(headW*0.16), eyeRx=headX+Math.round(headW*0.62);
  if(dead){
    _px(g,eyeLx,eyeY,eyeW,eyeH,'#2a0f14');
    _px(g,eyeRx,eyeY,eyeW,eyeH,'#2a0f14');
  }else if(awake){
    var eg=0.75+0.25*Math.sin(now*4);
    _px(g,eyeLx,eyeY,eyeW,eyeH,'#2a0a10');
    _px(g,eyeRx,eyeY,eyeW,eyeH,'#2a0a10');
    g.save();
    g.globalAlpha=eg;
    _px(g,eyeLx+1,eyeY+1,Math.max(1,eyeW-2),Math.max(1,eyeH-2),'#ffd24a');
    _px(g,eyeRx+1,eyeY+1,Math.max(1,eyeW-2),Math.max(1,eyeH-2),'#ffd24a');
    g.globalAlpha=eg*0.32;
    g.fillStyle='#ff8a2a';
    g.beginPath();g.arc(eyeLx+eyeW/2,eyeY+eyeH/2,eyeW*1.5,0,Math.PI*2);g.fill();
    g.beginPath();g.arc(eyeRx+eyeW/2,eyeY+eyeH/2,eyeW*1.5,0,Math.PI*2);g.fill();
    g.restore();
  }else{
    /* 沉睡：眼睛闭成一条横线 */
    _px(g,eyeLx,eyeY+Math.round(eyeH/2),eyeW,1,'#1a060a');
    _px(g,eyeRx,eyeY+Math.round(eyeH/2),eyeW,1,'#1a060a');
  }
  /* 鼻梁 */
  _px(g,headX+Math.round(headW*0.46),headY+Math.round(headH*0.58),Math.max(1,Math.round(headW*0.09)),Math.max(2,Math.round(headH*0.14)),dark);
  /* 大嘴：`_mouth` 0=闭 1=大张（吐弹前由 updateBoss 拉起） */
  var mouthW=Math.max(6,Math.round(headW*0.64));
  var mouthH=Math.max(3,Math.round(headH*0.26));
  var mouthX=headX+Math.round((headW-mouthW)/2);
  var mouthY=headY+headH-Math.round(mouthH*0.90);
  var mo=Math.max(0,Math.min(1,boss._mouth||0));
  var openH=Math.max(2,Math.round(mouthH*(0.45+1.15*mo)));
  _px(g,mouthX,mouthY,mouthW,openH,'#1a0408');
  var tn=Math.max(3,Math.floor(mouthW/3));
  for(var ti=0;ti<tn;ti++){
    var tx2=mouthX+Math.round((ti+0.5)*mouthW/tn);
    if(ti%2===0)_px(g,tx2,mouthY,1,Math.max(1,Math.round(openH*0.32)),bone);
    else _px(g,tx2,mouthY+openH-Math.max(1,Math.round(openH*0.30)),1,Math.max(1,Math.round(openH*0.30)),bone);
  }
  if(mo>0.02&&!dead){
    g.save();
    g.globalAlpha=mo*0.55;
    g.fillStyle='#ff8a2a';
    g.beginPath();g.arc(mouthX+mouthW/2,mouthY+openH/2,mouthW*0.45,0,Math.PI*2);g.fill();
    g.restore();
  }
  /* 沉睡时头顶飘起的小 Z（滑稽） */
  if(!dead&&!awake){
    for(var zi=0;zi<3;zi++){
      var zt=((now*0.45+zi*0.33)%1);
      var zx2=x+Math.round(w*0.74)+Math.round(zt*10);
      var zy2=y+Math.round(h*0.05)-Math.round(zt*18);
      g.globalAlpha=(1-zt)*0.55;
      _px(g,zx2,zy2,4,1,'#cfd8e8');
      _px(g,zx2+2,zy2+1,1,1,'#cfd8e8');
      _px(g,zx2+1,zy2+2,1,1,'#cfd8e8');
      _px(g,zx2,zy2+3,4,1,'#cfd8e8');
    }
    g.globalAlpha=1;
  }
  /* 死亡崩解碎片 */
  if(dead&&dp>0.05){
    g.globalAlpha=Math.max(0,1-dp);
    var N=18;
    for(var i=0;i<N;i++){
      var a2=_pr(boss.x*1.7+i*2.3)*Math.PI*2;
      var sp=(1.2+_pr(i*5.1)*2.4)*16;
      var fx2=x+w*0.5+Math.cos(a2)*sp*dp;
      var fy2=y+h*0.30+Math.sin(a2)*sp*dp*0.7+48*dp*dp;
      var sz=Math.max(1,Math.round((1-dp)*3.2));
      _px(g,Math.round(fx2),Math.round(fy2),sz,sz,(i%3===0)?'#ff6a4a':((i%3===1)?'#7d2534':'#3a0e18'));
    }
  }
  g.restore();
  /* ★编辑器可视化：激活半径示意圆★（用户原话「BOSS 的苏醒触发半径编辑器里没有
     适宜 UI，应该像前面其他的触发半径一样有个能直观看到当前配置大小的示意圆，
     但是导入到正式游戏里不用显示」）。
     ★判定口径★：BOSS 从来没有 `playMode` 参数（`drawBossTo(g,boss,now,cam,zoom)`），
     编辑器是**以 `cam=null` 调用**的 ⇒ 这里用 `!cam` 当"编辑器态"。
     ★与墓碑/骷髅同语言★：`setLineDash` 虚线圆 + 极淡的填充；
     半径取 BOSS **包围盒中心**（与 `updateBoss` 里 `bcx/bcy` 的判定中心一致，
     否则圆会骗人）：`activeRadius` 用实一点的红色，`sleepRadius=×1.6`
     （`updateBoss` 里 `dist>b.activeRadius*1.6` 才开始计沉睡）用更淡的一圈。
     ★不画在 g.save() 里★：上面已经把 `g.restore()` 了，这里是干净的画布状态。 */
  if(!cam){
    var bcx2=x+w/2, bcy2=y+h/2;
    var ar=(boss.activeRadius!==undefined?boss.activeRadius:96);
    var sr=ar*1.6;
    g.save();
    g.setLineDash([4,4]);
    /* 沉睡回落圈（外圈，最淡） */
    g.strokeStyle='rgba(200,90,110,0.16)';g.lineWidth=0.6;
    g.beginPath();g.arc(bcx2,bcy2,sr,0,Math.PI*2);g.stroke();
    /* 激活圈（内圈，实一点） */
    g.setLineDash([3,3]);
    g.strokeStyle='rgba(230,70,90,0.34)';g.lineWidth=0.8;
    g.beginPath();g.arc(bcx2,bcy2,ar,0,Math.PI*2);g.stroke();
    /* 极淡填充：让"半径真的很大"一眼可见（纯编辑器） */
    g.setLineDash([]);
    g.fillStyle='rgba(200,60,80,0.045)';
    g.beginPath();g.arc(bcx2,bcy2,ar,0,Math.PI*2);g.fill();
    /* 半径数值：省得开属性面板去对 */
    g.restore();
  }
}

/* ★BOSS 血条★：**屏幕空间** HUD（在 renderPlay 尾部、`setTransform(dpr,...)` 恢复后调用），
   所以不受相机缩放/位移影响。只在 awake/dead 且 `_barFade>0` 时显示（滑入淡入）。 */
function drawBossHpBar(g, W, H, boss){
  if(!boss)return;
  if(boss.state!=='awake'&&boss.state!=='dead')return;
  var fade=Math.max(0,Math.min(1,boss._barFade||0));
  if(fade<=0.01)return;
  var now=_simTime();
  var barW=Math.round(Math.min(W*0.62,420));
  var barH=10;
  var bx=Math.round((W-barW)/2);
  var by=Math.round(H-14-barH);
  var ratio=Math.max(0,Math.min(1,boss.hp/Math.max(1,boss.maxHp)));
  g.save();
  g.globalAlpha=fade;
  g.translate(0,Math.round((1-fade)*18));
  /* 暗底 + 暗红十字边框 */
  _px(g,bx-3,by-3,barW+6,barH+6,'rgba(10,4,8,0.82)');
  _px(g,bx-3,by-3,barW+6,1,'#7d2534');
  _px(g,bx-3,by+barH+2,barW+6,1,'#7d2534');
  _px(g,bx-3,by-3,1,barH+6,'#7d2534');
  _px(g,bx+barW+2,by-3,1,barH+6,'#7d2534');
  /* 血量条（低血脉冲） */
  var hw2=Math.round(barW*ratio);
  var lowPulse=(ratio<0.25)?(0.55+0.45*Math.abs(Math.sin(now*6))):1;
  _px(g,bx,by,barW,barH,'#2a0a12');
  if(hw2>0){
    _px(g,bx,by,hw2,barH,_mixHex('#8a1226','#ff3a4a',lowPulse));
    _px(g,bx,by,hw2,1,'#ff8a96');
    _px(g,bx,by+barH-1,hw2,1,'#5a0812');
  }
  /* 受击白闪 */
  if((boss._barFlash||0)>0){
    g.globalAlpha=fade*Math.min(1,(boss._barFlash||0)/0.3);
    _px(g,bx,by,barW,barH,'#ffffff');
    g.globalAlpha=fade;
  }
  /* 分段刻痕 */
  var seg=Math.max(2,boss.maxHp);
  for(var i=1;i<seg;i++){
    _px(g,bx+Math.round(barW*i/seg),by,1,barH,'rgba(0,0,0,0.45)');
  }
  /* 骷髅图标（左侧） */
  var icX=bx-16, icY=by+1;
  _px(g,icX,icY,7,7,'#e8e0d0');
  _px(g,icX+1,icY+3,1,1,'#1a0a0c');
  _px(g,icX+5,icY+3,1,1,'#1a0a0c');
  _px(g,icX+2,icY+6,3,1,'#9a9080');
  /* 文本 */
  drawPixelText(g,'HP '+Math.max(0,boss.hp)+'/'+boss.maxHp,bx-34,by+Math.round(barH/2),7,'#ffd8c0',null,fade,1,'rgba(10,4,8,0.85)');
  var waves=boss.waves||[];
  drawPixelText(g,'WAVE '+((boss.waveIdx||0)+1)+'/'+Math.max(1,waves.length),bx+barW+38,by+Math.round(barH/2),7,'#ffb0a0',null,fade,1,'rgba(10,4,8,0.85)');
  g.restore();
}

function drawLampTo(g, l, playMode){
  var x = Math.round(l.x), y = Math.round(l.y);
  var w = Math.round(l.w || 8), h = Math.round(l.h || 32);
  var cx = Math.round(x + w / 2);
  var topY = y + Math.max(4, Math.round(h * 0.20));
  if (l.broken){
    _px(g, cx - 1, topY, 2, h - (topY - y), '#3a3040');
    _px(g, cx - 1, topY, 1, h - (topY - y), '#4d4056');
    _px(g, cx - 3, topY - 3, 5, 3, '#2e2636');
    _pxDot(g, cx - 2, topY - 2, '#6a5a78');
    return;
  }
  /* 灯柱：暖紫木，左高光 */
  for (var py = topY + 6; py < y + h - 3; py++){
    _pxDot(g, cx, py, '#5b4a58');
    if ((py - topY) % 3 === 0) _pxDot(g, cx - 1, py, 'rgba(196,178,206,0.22)');
  }
  /* 底座 */
  _px(g, cx - 3, y + h - 3, 6, 3, '#4a3c50');
  _px(g, cx - 3, y + h - 3, 6, 1, '#6d5a76');
  /* 灯罩（小梯形，暖黄芯） */
  _px(g, cx - 3, topY, 7, 1, '#7a6684');
  _px(g, cx - 3, topY + 1, 7, 5, '#453a4e');
  _px(g, cx - 2, topY + 2, 5, 3, '#ffe6a0');
  _px(g, cx - 2, topY + 2, 5, 1, '#fff8d0');
  _pxDot(g, cx - 2, topY + 2, '#ffffff');
  /* 双层暖光晕 */
  var pulse = playMode ? (0.85 + Math.sin(Date.now() / 900) * 0.15) : 0.9;
  g.save();
  var g1 = g.createRadialGradient(cx, topY + 3, 0, cx, topY + 3, h * 0.95);
  g1.addColorStop(0,    'rgba(255,224,150,' + (0.17 * pulse) + ')');
  g1.addColorStop(0.42, 'rgba(255,196,110,' + (0.07 * pulse) + ')');
  g1.addColorStop(1,    'rgba(255,196,110,0)');
  g.fillStyle = g1;
  g.beginPath(); g.arc(cx, topY + 3, h * 0.95, 0, Math.PI * 2); g.fill();
  var g2 = g.createRadialGradient(cx, topY + 3, 0, cx, topY + 3, h * 0.38);
  g2.addColorStop(0,   'rgba(255,240,190,' + (0.26 * pulse) + ')');
  g2.addColorStop(0.6, 'rgba(255,214,140,' + (0.09 * pulse) + ')');
  g2.addColorStop(1,   'rgba(255,214,140,0)');
  g.fillStyle = g2;
  g.beginPath(); g.arc(cx, topY + 3, h * 0.38, 0, Math.PI * 2); g.fill();
  g.restore();
  if (playMode && Math.random() < 0.5){
    _pxDot(g, cx + (Math.random() < 0.5 ? -1 : 1), topY + 1, 'rgba(255,228,160,0.75)');
  }
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
      var ot=(p.y+p.h)-r.y,ob=(r.y+r.h)-p.y;
      var xPen=ol<or?ol:or, yPen=ot<ob?ot:ob;
      /* 正常游玩时一个子步在 X 上最多只移动 3px（steps 已按 |v|/3 切分），
         所以 xPen 必然 ≲3px —— 直接走「就近边吸附」，与旧版逐字一致。
         只有 xPen 明显超出这个量级（= 玩家已被外部因素塞进实体深处，
         正常物理绝不会出现）且 Y 向侵入更浅时，才改走「最小平移轴」：
         沿 Y 把玩家推出（位移量 = yPen，很小），绝不沿 X 横推。
         这彻底消除了「嵌入宽实体 → 按最近边横弹几百像素」这条反常识路径。 */
      if(xPen>10&&yPen<xPen){
        if(ot<ob)p.y=r.y-p.h;else p.y=r.y+r.h;
        p.vy=0;stepVY=0;
        continue;
      }
      if(ol<or){p.x=r.x-p.w;p.onWall=-1;}
      else{p.x=r.x+r.w;p.onWall=1;}
      p.vx=0;stepVX=0;
    }
    p.y+=stepVY;
    for(var i2=0;i2<solids.length;i2++){
      var r2=solids[i2];
      if(!rectsOverlap(p,r2))continue;
      var ot=(p.y+p.h)-r2.y,ob=(r2.y+r2.h)-p.y;
      var ol2=(p.x+p.w)-r2.x,or2=(r2.x+r2.w)-p.x;
      var yPen2=ot<ob?ot:ob, xPen2=ol2<or2?ol2:or2;
      /* 与水平求解器对称：Y 向侵入已大到不可能是正常移动造成的
         （子步垂直位移 ≤3px），而 X 向侵入更浅时，沿 X 推出，
         避免「嵌入很高的实体 → 按上下最近边弹出很远」。 */
      if(yPen2>10&&xPen2<yPen2){
        if(ol2<or2)p.x=r2.x-p.w;else p.x=r2.x+r2.w;
        p.vx=0;stepVX=0;
        continue;
      }
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
  if(ghosts)for(var gi=0;gi<ghosts.length;gi++)collideGhost(p,ghosts[gi],solids);
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
/* 幽灵【带动】的逐轴预检：把玩家移动到 (x,y) 后是否与任一实体重叠。
   用途见 updatePlay 里 p.onGhost 分支 —— 防止带动把玩家顶进实体内部。
   （一旦嵌入，stepPlayerPhysics 的水平求解器会按"最近边"把玩家弹出；
     若被嵌入的实体很宽，最近的边可能是远端，单帧能弹几百像素 → 反常识瞬移。） */
function solidBlocksAt(p,x,y,solids){
  if(!solids||!solids.length)return false;
  var t={x:x,y:y,w:p.w,h:p.h};
  for(var i=0;i<solids.length;i++){if(rectsOverlap(t,solids[i]))return true;}
  return false;
}
/* ============ 泡沫砖（foam）============
   契约（用户指定）：玩家骑在幽灵头上被往上带、头顶恰好是泡沫砖时，直接穿上去。

   ★钩子为什么不在规划文档写的「Y 求解器最小平移轴分支」★
   规划（§5.2）把落点定在 `if(yPen2>10&&xPen2<yPen2)`，前提是
   「② 玩家与某墙体重叠」。但 Phase 0 给带动侧加了逐轴预检、给吸附侧加了
   落点守卫之后，**玩家再也不会被顶进实体**：实测（`_foam_probe2.cjs`）
   9 组「天花板厚 8/16/24 × 幽灵速 0.8/1.6/3.0」嵌入深度**恒为 0**；
   人为强行嵌入宽天花板也已被最小平移轴正确沿 Y 推出（dy=8、dx=0）。
   ⇒ 那条分支对泡沫砖已是**死代码**：照文档改 = 写一段永不执行的分支，
     而 L2 反证会**假通过**（因为压根没触发）。

   ★真正的阻塞点（逐帧实测 `_foam_dbg.cjs` 定位）★
   骑手跟随幽灵靠的是每帧「吸附」：collideGhost 把玩家吸到幽灵顶面
   p.y = gr.y - p.h。当头顶是泡沫砖时，吸附落点会嵌进砖里，
   于是 `collideGhost` 里那句落点守卫 `if(solidBlocksAt(p,p.x,snapY,solids))return false;`
   **拒绝吸附** → 玩家跟不上去 → 下一帧脱钩落地（实测 f131 onGhost 1→0）。
   ⇒ 泡沫砖要做的，正是在**这条守卫**上放行：若挡住落点的"恰好是头顶那块泡沫砖"，
     就给该砖打 `_pass` 闩锁（本帧起临时不参与玩家碰撞），
     下一帧起玩家就能随幽灵平滑穿过（每帧位移 = 幽灵位移 <5px，无异常瞬移）。

   ★因果链★：这段逻辑在 `collideGhost` 内，而 `collideGhost` 只在
   「玩家与幽灵重叠」时才可能走到守卫 ⇒ 不骑幽灵绝不可能触发，
   泡沫砖不会退化成电梯。解除条件：玩家整体穿出到砖上方，或不再骑幽灵。 */
var FOAM_SNAP=4;                      /* 头顶与砖底面的贴合判定阈值（像素） */
var FOAM_REL=0.6;                     /* 解闩的位置比较容差：位置是逐帧累加出来的，
                                         裸浮点比较会因 1e-13 的误差漏判（实测踩到） */

/* 吸附落点被挡时调用：若挡住落点的**只有**泡沫砖、且该砖正好贴在玩家头顶，
   就给砖打 `_pass` 并返回 true（调用方照常 return false，下帧即可穿过）。
   返回 false = 挡路的是普通实体，维持原行为（进不去）。 */
function foamRidePass(p,snapY,solids){
  if(!Play.foams||!Play.foams.length)return false;
  /* ★判据是"贴面"，不是"重叠"★
     不能拿吸附落点 (`snapY`) 去和砖做 rectsOverlap：吸附落点本身就落在砖内部
     （这正是本次被拒的原因），那是**同义反复**、恒真，等于不设防。
     真正要问的是："玩家此刻是不是头顶正贴着这块砖的底面？"
       · 砖在玩家上方 → 贴面 = 砖底面 fB 对上玩家头顶 p.y，差 gap = p.y - fB
       · 砖在玩家下方（反重力）→ 贴面 = 砖顶面 f.y 对上玩家脚底 p.y+p.h
     方向用**中心线**判定（而不是边）—— 玩家头顶恰好贴住砖底时，
     两者中心必然分居两侧，而"嵌入/重生在砖内"时中心关系正好相反，
     于是那类歧义情形天然落进下面的 else 分支、不给闩锁。 */
  var hit=null,dir=0;
  for(var i=0;i<Play.foams.length;i++){
    var f=Play.foams[i];
    if(!(p.x+p.w>f.x&&p.x<f.x+f.w))continue;   /* 水平方向必须真的在砖下方 */
    var fH=f.h||8,fB=f.y+fH,fC=f.y+fH*0.5,pC=p.y+p.h*0.5;
    if(fC<pC){                                  /* 砖在玩家上方 */
      var gap=p.y-fB;
      if(gap>FOAM_SNAP||gap<-2)continue;        /* 只认"贴着/刚好接上"，隔空不吸 */
      dir=1;
    }else{                                      /* 砖在玩家下方（反重力对称） */
      var gap2=f.y-(p.y+p.h);
      if(gap2>FOAM_SNAP||gap2<-2)continue;
      dir=-1;
    }
    hit=f;break;
  }
  if(!hit)return false;
  /* 再确认**除泡沫砖外**没有别的实体挡住落点：否则穿上去会嵌进那层实体 */
  if(solids&&solids.length){
    var others=[];
    for(var k=0;k<solids.length;k++){if(Play.foams.indexOf(solids[k])<0)others.push(solids[k]);}
    if(solidBlocksAt(p,p.x,snapY,others))return false;
  }
  hit._pass=1;hit._passDir=dir;       /* ★记下穿行方向★：解闩要按方向判定"穿出" */
  hit._squash=1;                      /* _squash 供表现层做压扁回弹（纯视觉） */
  return true;
}
/* 吸附的落点预检：吸附后玩家的新位置是否落进实体内部。
   这是「卡墙后长距离瞬移」的第二条、也是最后一条源头：
   幽灵沿轨迹上升时自身不与实体碰撞（可以钻进天花板），
   若此时把玩家强行吸附到幽灵顶面 p.y=gr.y-p.h，玩家就被塞进天花板里；
   下一帧 stepPlayerPhysics 的水平求解器只看 X 轴（ol/or 取小者），
   于是按「天花板左边缘」把玩家横推——天花板越宽推得越远（实测 268px），
   玩家随即离开 chamber → 触发"出界死"，观感就是「诡异地瞬移很远然后死掉」。
   这里在吸附前预判：若吸附落点会与实体重叠，就**放弃这次吸附**，
   玩家保持在原地（下一个物理帧正常下落/落地），外观上就是「幽灵钻进了天花板，
   我没跟上去」，完全符合直觉，且不产生任何可见的兜底痕迹。
   solids 为可选参数：不传时行为与旧版逐字一致（旧调用点零回归）。 */
function collideGhost(p,g,solids){
  var gr={x:g.x,y:g.y,w:8,h:8};
  if(!rectsOverlap(p,gr))return false;
  var towardGround=p.vy*p.gravityDir>=0;
  if(p.gravityDir>0){
    var overlapTop=(p.y+p.h)-gr.y;
    if(overlapTop>0&&overlapTop<12&&p.x+p.w>gr.x&&p.x<gr.x+gr.w){
      var hDist=Math.abs((p.x+p.w/2)-(gr.x+4));
      if(hDist<12&&(towardGround||overlapTop<6)){
        var snapY=gr.y-p.h;
        if(solidBlocksAt(p,p.x,snapY,solids)){
          /* ★泡沫砖★：若挡住吸附落点的只有泡沫砖（且贴在头顶），
             给砖打 `_pass` 闩锁 → 下帧起玩家随幽灵平滑穿过它。
             返回 false 使本帧维持原行为（这帧先不吸），下一帧砖已放行。 */
          foamRidePass(p,snapY,solids);
          return false;
        }
        p.y=snapY;p.vy=0;p.grounded=true;p.canDoubleJump=true;p.onGhost=g;
        return true;
      }
    }
  }else{
    var overlapBottom=(gr.y+gr.h)-p.y;
    if(overlapBottom>0&&overlapBottom<12&&p.x+p.w>gr.x&&p.x<gr.x+gr.w){
      var hDist2=Math.abs((p.x+p.w/2)-(gr.x+4));
      if(hDist2<12&&(towardGround||overlapBottom<6)){
        var snapY2=gr.y+gr.h;
        if(solidBlocksAt(p,p.x,snapY2,solids)){
          /* 对称处理（反重力），同上方注释 */
          foamRidePass(p,snapY2,solids);
          return false;
        }
        p.y=snapY2;p.vy=0;p.grounded=true;p.canDoubleJump=true;p.onGhost=g;
        return true;
      }
    }
  }
  return false;
}
/* 线段是否与任一实体相交（Liang–Barsky 裁剪判定）。
   用途：抽稀轨迹时防止产生"横穿实体"的直线段 —— 幽灵回放是在相邻采样点之间
   做**线性插值**的，一旦某个新段横穿墙体，幽灵就会"直接穿墙飞过去"。 */
function segCrossesSolids(x1,y1,x2,y2,solids,margin){
  if(!solids||!solids.length)return false;
  var m=margin||0;
  var dx=x2-x1,dy=y2-y1;
  for(var i=0;i<solids.length;i++){
    var r=solids[i];
    var rx=r.x-m,ry=r.y-m,rw=r.w+m*2,rh=r.h+m*2;
    var t0=0,t1=1,hit=true;
    var pp=[-dx,dx,-dy,dy];
    var qq=[x1-rx,rx+rw-x1,y1-ry,ry+rh-y1];
    for(var k=0;k<4;k++){
      if(Math.abs(pp[k])<1e-9){if(qq[k]<0){hit=false;break;}continue;}
      var t=qq[k]/pp[k];
      if(pp[k]<0){if(t>t1){hit=false;break;}if(t>t0)t0=t;}
      else{if(t<t0){hit=false;break;}if(t<t1)t1=t;}
    }
    if(hit)return true;
  }
  return false;
}
/* 轨迹抽稀（**安全版**）：目标是"尽量跳着取一半"，但每一条被接受的段
   都必须先通过"不与实体相交"的检查 —— 幽灵回放是在相邻采样点之间做
   线性插值的，任何一条横穿实体的段都会让幽灵"直接穿墙飞过去"。

   做法（贪心）：从已接受的点 i 出发，先尝试跳过 2 步（=抽稀一半），
   若该直线段穿墙就把落点逐步往回缩，直到"不穿墙"或缩到相邻点为止。
   因为玩家真实走过的相邻两点之间不可能穿墙（物理约束），
   所以最坏情况下退化成"不抽稀"，绝不会产出一条穿墙段。

   对比"先整段取一半、再把穿墙段的中间点补回来"的做法：
   后者在墙较厚、采样点较稀时，补回被丢弃的点仍然可能穿墙；
   贪心法从构造上就保证了每条接受段都经过验证。 */
function decimateTrajectory(traj,solids,cap){
  var n=traj.length;
  if(n<=2)return traj.slice();
  var lim=cap||6000;
  var hasSolids=!!(solids&&solids.length);
  var out=[traj[0]];
  var i=0;
  while(i<n-1&&out.length<lim-1){
    var j=Math.min(n-1,i+2);            /* 先试"跳过 1 点"（约 50% 抽稀） */
    if(hasSolids){
      while(j>i+1&&segCrossesSolids(
        traj[i].x+4,traj[i].y+4,traj[j].x+4,traj[j].y+4,solids,3))j--;
    }
    out.push(traj[j]);
    i=j;
  }
  /* 死亡时刻那一点必须保留：它是幽灵的爆炸位置（_explosionX/_explosionY） */
  if(out[out.length-1]!==traj[n-1])out.push(traj[n-1]);
  return out;
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
  /* ★音效是"游戏外壳"的能力，编辑器里没有★
     正式版（game.html）加载 audio.js 提供 window.AudioSystem；编辑器（index.html）
     不加载它。两端共用这一份代码，所以一律做存在性守卫：
     编辑器里守卫为假 → 跳过；正式版里恒真 → 行为不变。 */
  if(typeof AudioSystem!=='undefined'&&AudioSystem)AudioSystem.sfx("explosion",x,y);
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
  /* ★野兽被惊吓★：对所有爆炸来源生效（含 `'ghost'`，用户明确要求"幽灵爆炸也算"）。
     只惊吓 `sleep` 状态的（已在跑走的不用再跑）；半径用各自的 `scareRadius`（默认复用爆炸半径 32）。
     ★v1 曾担心"幽灵每圈引爆 → 反复把野兽吓得抖动"，该担忧不存在：
       野兽吓一次就 `gone` 并被移除，不会再有第二次。 */
  if(Play.beasts&&Play.beasts.length){
    for(var _bi=0;_bi<Play.beasts.length;_bi++){
      var _bs=Play.beasts[_bi];
      if(_bs.state!=='sleep')continue;
      var bdx=(_bs.x+(_bs.w||16)/2)-x, bdy=(_bs.y+(_bs.h||16)/2)-y;
      var bR=_bs.scareRadius||radius;
      if(Math.sqrt(bdx*bdx+bdy*bdy)<bR){
        _bs.state='scared';_bs._t=0;
        /* 逃跑方向 = 从爆炸中心指向野兽（自动与玩家站位相关，最符合直觉） */
        var bl=Math.sqrt(bdx*bdx+bdy*bdy)||1;
        _bs._dirX=bdx/bl; _bs._dirY=bdy/bl;
      }
    }
  }
  /* ★BOSS 受爆伤害★（用户原话「在 boss 旁边爆炸 1px 就造成 1 点伤害」）。
     与野兽同段、对所有爆炸来源生效（玩家自爆 / 幽灵爆炸）。
     钩子本身不做任何判定 —— 全部口径集中在 damageBossAt 里（含"沉睡打不动"）。 */
  if(Play.boss)damageBossAt(x,y,source);
}

/* ============ 幽灵 ============ */
/* ★传送门（v4）：全轨迹预扫描，找出"穿越事件"★
   用**线段**检测（不是逐点），因为 decimateTrajectory 抽稀后采样点可能
   直接**跳过**尺寸较小的门；线段检测天然覆盖这种情形。
   ★取"命中段的后一个索引 i"★：从该索引起施加偏移 ⇒ 幽灵在 i-1 仍在入口、
   在 i 已整体平移到出口，一帧之内完成跳变。

   ★★v4 关键修复：每个入口在一条轨迹里**最多只记一次**事件（sticky）★★
   v3 用的是"由外进入"边沿去重（命中 ⇒ inside=true，离开 ⇒ inside=false），
   它只挡住了"门有宽度导致相邻十几段连续命中"这一个问题，但**放过了另一种
   更常见的情形**：玩家在一段游玩里于入口附近**来回折返**（走过去 → 走回来 →
   再走过去），轨迹就会**多次**由外进入同一入口 ⇒ 一圈内记 k 条事件 ⇒
   幽灵被累加 k 倍 (出口−入口) 的位移。

   实测（_portal_repro.cjs 场景 S1）：折返 3 次的一条轨迹记了 5 条事件，
   位移累加 1200px（=5×240）。后果正是玩家报告的两种现象：
     · "从出口出来的幽灵还发生了多次瞬移" —— 每穿一次就跳一次；
     · "在后面没有传送门（出口入口都没有）的位置也出现了瞬移" ——
       偏移是**持续**的（一直加到回绕才清零），幽灵被整体挪到远离任何门的
       坐标上去渲染，看上去就是"凭空瞬移"。
   v4 的口径（与用户契约完全一致："只有通过入口才会触发传送"）：
   **一次通过 = 一次传送**；同一条轨迹里，同一个入口命中过就不再重复触发。
   ⇒ 位移在整圈内恒为 0 或恰好一份 (出口−入口)，**绝不可能**在无门处出现。 */
function _scanPortalCrossings(traj){
  var evs=[];
  if(!Play.portals||!Play.portals.length)return evs;
  if(!traj||traj.length<2)return evs;
  for(var q=0;q<Play.portals.length;q++){
    var pin=Play.portals[q];
    if(pin.role!=='in')continue;
    var pout=null;
    for(var r=0;r<Play.portals.length;r++){
      var o=Play.portals[r];
      if(o.link===pin.link&&o.role==='out'){pout=o;break;}
    }
    if(!pout)continue;
    /* ★sticky★：命中一次后立即收工（used 只置位、不复位）。
       这样门宽度（相邻多段连续命中）与折返（多次由外进入）**同时**被挡住。 */
    var used=false;
    for(var i=1;i<traj.length&&!used;i++){
      var a=traj[i-1],b=traj[i];
      if(_segHitsRect(a.x+4,a.y+4,b.x+4,b.y+4,pin)){
        evs.push({idx:i, dx:(pout.x-pin.x), dy:(pout.y-pin.y)});
        used=true;
      }
    }
  }
  evs.sort(function(p1,p2){return p1.idx-p2.idx;});
  return evs;
}
/* 线段 × 矩形相交（轻量采样版）。按 2px 步长走一遍线段，
   任一采样点落在矩形内即算相交 —— 对"门"这种小矩形已足够，且与抽稀无关。 */
function _segHitsRect(x1,y1,x2,y2,r){
  var steps=Math.max(2,Math.ceil(Math.max(Math.abs(x2-x1),Math.abs(y2-y1))/2));
  for(var s=0;s<=steps;s++){
    var t=s/steps,px=x1+(x2-x1)*t,py=y1+(y2-y1)*t;
    if(px>r.x&&px<r.x+(r.w||8)&&py>r.y&&py<r.y+(r.h||8))return true;
  }
  return false;
}
function PlayGhost(trajectory,dieX,dieY,originId,hasExplosion,sampleStride){
  this.trajectory=trajectory.map(function(p){return{x:p.x,y:p.y};});
  this.progress=0;this.x=dieX;this.y=dieY;
  this.lastX=dieX;this.lastY=dieY;
  this.trail=[];for(var i=0;i<8;i++)this.trail.push({x:dieX,y:dieY});
  this.originId=originId||'default';
  this.hasExplosion=!!hasExplosion;
  /* 录制时的采样步长：每个轨迹索引代表 sampleStride 个仿真帧。
     轨迹被抽稀过（步长>1）时，回放推进必须按同比例放慢索引速度，
     否则幽灵会在世界里变快。缺省 1 = 未抽稀，行为与旧版完全一致。 */
  this.sampleStride=sampleStride||1;
  this._pendingExplosion=false;
  this._explosionX=0;this._explosionY=0;
  this.released=false;
  /* ★幽灵带水（ghostWet）★
     wet 是"剩余水量"，用**进度单位**（不是帧、不是秒）。
     ★为什么必须是进度单位★：幽灵的索引推进速度是
        progress += baseSpeed × _speedMul / sampleStride，
     而 sampleStride 会因轨迹抽稀而放大。若衰减按 dt 算，
     抽稀过的长轨迹幽灵"在世界里走同样的距离"只花更少帧数 ⇒ 它会半路就干。
     按 progress 增量衰减，才能与"世界里的实际行进距离"严格挂钩。 */
  this.wet=0;this.wetMax=1.0;
  this._prevProgress=0;
  /* ★传送门（v3）：纯回放侧的"持续位移偏移"★
     _tpEvs   = 穿越事件表 [{idx,dx,dy}]（按 idx 升序）
     _tpCur   = 游标（已消费到第几个事件）
     _tpOx/_tpOy = 当前累计位移向量（出口−入口 的向量和）
     ★轨迹里**没有任何标记**★：它是一条普通的连续走位；
     位移只在这里、在回放时刻被施加。⇒ 录制侧 / 玩家物理 / 抽稀 全部零改动。 */
  this._tpEvs=_scanPortalCrossings(this.trajectory);
  this._tpCur=0;this._tpOx=0;this._tpOy=0;
  /* ★爆炸点的位移要按"轨迹终点"算，不能读回绕后的 _tpOx★
     幽灵爆炸是在 progress **回绕的那一帧**触发的，而回绕会把 _tpOx 清零。
     若爆炸直接读 _tpOx，就会得到"幽灵在出口、爆炸却回到入口"的分叉。
     所以这里预先把"走完整条轨迹时的累计位移"算出来（终点偏移）。 */
  this._tpEndOx=0;this._tpEndOy=0;
  for(var _te=0;_te<this._tpEvs.length;_te++){this._tpEndOx+=this._tpEvs[_te].dx;this._tpEndOy+=this._tpEvs[_te].dy;}
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
  /* 减速速度由「本帧慢放状态机」统一决定（见 updatePlay 里的 slowState）。
     能量消耗 / 回涨**不写在这里**：update() 每只已释放幽灵各调用一次，
     写在这里会让消耗速度随幽灵数量翻倍；而且旧逻辑的 else 分支在按住不放、
     能量已为 0 时仍会回涨 → 0 附近反复震荡 → 观感就是「条空了还在一直减速」。 */
  var baseSpeed=Play.slowActive?0.2:0.8;
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
  /* 索引推进速度按采样步长反比缩放：抽稀后每个索引代表更多帧，
     只有相应放慢索引速度，幽灵在**世界里的移动速度**才与录制时一致
     （否则抽稀过的轨迹会让幽灵看起来变快）。 */
  this.progress+=speed/(this.sampleStride||1);

  var L=this.trajectory.length-1;
  if(L<1){ this.offScreen=false; this.fadeAlpha=1; return; }
  /* 防御性回绕：无论 progress 因加速溢出多少，最终都落在 [0, L)
     ★传送门★：回绕 = 重开一圈 ⇒ 位移偏移必须**清零**（下一圈重新穿门）。
     这里有两段独立的回绕代码，**两处都必须清** —— 漏一处，
     加速（_speedMul 可达 3×）状态下就会出现"越绕越远"。 */
  while(this.progress>=L){this.progress-=L;this._tpCur=0;this._tpOx=0;this._tpOy=0;if(this.hasExplosion)this._pendingExplosion=true;}
  while(this.progress<0)this.progress+=L;
  if(this.progress>=L){
    this.progress-=L;
    this._tpCur=0;this._tpOx=0;this._tpOy=0;
    if(this.hasExplosion)this._pendingExplosion=true;
  }
  /* ★传送门★：跨过穿越索引就累加一次位移 ⇒ 天然支持"一关多个门 / 一条轨迹多次穿越"。
     必须放在**回绕之后**，否则刚清完零又被本帧的进度加回来。 */
  while(this._tpCur<this._tpEvs.length&&this.progress>=this._tpEvs[this._tpCur].idx){
    var ev=this._tpEvs[this._tpCur++];
    this._tpOx+=ev.dx; this._tpOy+=ev.dy;
  }

  var i=Math.floor(this.progress);var t=this.progress-i;
  if(i<0)i=0;
  if(i>=this.trajectory.length)i=this.trajectory.length-1;
  var p1=this.trajectory[i];var p2=this.trajectory[Math.min(i+1,this.trajectory.length-1)];
  /* ★传送门★：必须在插值之后**立刻写回 this.x/this.y**。
     它是 collideGhost / 压力板 / 爆炸点 / 渲染的**唯一坐标源** ⇒
     写这里 ⇒ 逻辑与视觉天然一致（不会出现"看着在出口、其实还在入口压板"）。 */
  this.x=p1.x+(p2.x-p1.x)*t;
  this.y=p1.y+(p2.y-p1.y)*t;
  this.x+=this._tpOx; this.y+=this._tpOy;
  this.trail.unshift({x:this.x,y:this.y});
  if(this.trail.length>8)this.trail.pop();
  this.offScreen=offScreen;

  // 轨迹首尾淡入/淡出，隐藏回绕瞬移（保留原逻辑）
  // 抽稀后一个索引代表更多帧 → 淡入淡出带按步长收窄，保持它在世界里的长度不变
  var fadeRange=Math.min(8,Math.floor(L/4));
  if((this.sampleStride||1)>1)fadeRange=Math.round(fadeRange/(this.sampleStride||1));
  if(fadeRange<2)fadeRange=2;
  var a=1;
  if(this.progress<fadeRange)a=this.progress/fadeRange;
  else if(this.progress>L-fadeRange)a=(L-this.progress)/fadeRange;
  this.fadeAlpha=Math.max(0,Math.min(1,a));
  /* ★暴露本帧的进度增量（供"幽灵带水"按世界行进距离衰减）★
     回绕时 progress 会从 L 跳回 0，直接用差会得到负数 ⇒ 加回 L 校正。
     WET_DRAIN 定义在幽灵更新循环那一段，这里只负责把增量算准。 */
  var _dp=this.progress-this._prevProgress;
  if(_dp<0)_dp+=L;
  this._dProgress=_dp;
  this._prevProgress=this.progress;
};
/* ★传送门★：重置必须**连位移一起清**。
   progress 拉回 0 ⇒ 幽灵又回到了入口之前，此时若保留 _tpOx/_tpOy，
   它会带着"上一轮已经传送过"的偏移在起点附近渲染 —— 起点附近往往没有任何
   传送门，观感正是"在没有传送门的位置也发生了瞬移"。
   （update() 里"跨过事件索引才累加"的语义也要求游标一并归零，
     否则 _tpCur 已指向表尾，重置后这一圈再也不会有门生效。） */
PlayGhost.prototype.reset=function(){this.progress=0;this._tpCur=0;this._tpOx=0;this._tpOy=0;this._prevProgress=0;};
/* 把场上所有幽灵拉回各自轨迹的起点（PC 的 L 键 / 手机版「起点」键共用）。
   玩家本身不动、不扣血；返回被重置的幽灵数量。 */
function rewindGhosts(){
  var list=Play.ghosts;
  if(!list||!list.length)return 0;
  var n=0;
  for(var i=0;i<list.length;i++){
    var g=list[i];
    if(g&&typeof g.reset==='function'){g.reset();n++;}
  }
  return n;
}

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
  /* 摄像机严格跟随玩家：不再叠加任何手动偏移（拖动看场景已停用）。 */
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
  foams:[],flagPoles:[],beasts:[],flowers:[],fires:[],portals:[],
  waterBubbleTimer:10,waterBubbleMax:10,_inWater:false,_smokeCanvas:null,
  worldBounds:null,cam:null,deathCount:0,
  trajectory:[],dashTrajectory:[],ghosts:[],particles:[],
  /* 轨迹采样状态（见 updatePlay 里的录制逻辑）：
     _trajStride   = 当前每个索引代表多少个仿真帧（点数超限抽稀后按真实压缩比放大）；
     _trajTick     = 距上一个记录点已过的帧数；
     _stillFrames  = 当前这段"疑似静止"已持续多少帧；
     _stillBaseX/Y = 这段"疑似静止"的锚点位置（漂移判定的基准）；
     _trajDecimAt  = 上次尝试抽稀时的轨迹长度（避免逐帧重算的节流水位）。
     轨迹清空后会在录制处自动复位。 */
  _trajStride:1,_trajTick:0,_stillFrames:0,_stillBaseX:0,_stillBaseY:0,_trajDecimAt:0,
  currentRespawnOrigin:'default',currentFlag:null,flagsCollected:0,
  placedFlags:[], /* === flag/ghost v2 === */
  lives:3,maxLives:3,
  camOffset:{x:0,y:0},freeLookTimer:0,dragStart:null,
  energy:1,screenShake:0,_flagGhostsCleared:false,
  /* 慢放能量状态机的状态位（见 updatePlay）：
     slowActive：本帧是否正在减速幽灵；slowLocked：触底后等待回满的锁定；
     slowRefill：正在进行的「触底雪崩回涨」的剩余秒数（>0 表示强制回涨中）。
     slowWarn：黄色→绿色渐变的进度（1=全黄，0=全绿）。 */
  slowActive:false,slowLocked:false,slowRefill:0,slowWarn:0,
  _dyingBySuicide:false,_flagKeyHeld:false,
  deathAnim:null,
  showGrid:false,
  /* ==================== ★怪物与 BOSS 系统（v1）★ ====================
     全部字段在这里统一声明，并在 startPlay / restartPlayFromLevel 里清空。
     `graves` 墓碑（触发器）· `skeletons` 骷髅怪 · `foes` 小怪（鬼魂/火团怪）
     · `bullets` 全部弹幕 · `boss` BOSS 单例 · `bossDoors` BOSS 门
     · `_bossHearts` BOSS 波次掉落的心（与既有 hearts 分开记，便于演出） */
  graves:[],skeletons:[],foes:[],bullets:[],boss:null,bossDoors:[],
  _bossHearts:[]
};

function startPlay(){
  var lv=LevelContext.levels[LevelContext.currentIdx];if(!lv)return;
  ['platforms','disappearPlats','spikes','fallingSpikes','lasers','doors','plates',
   'movables','breakables','flammables','iceBlocks','goals','hearts','flagPickups','gravityZones','labels','backgrounds','lamps','vines',
   'trophies','switches','switchDoors','waters','smokes','waterGrasses','foams','flagPoles','beasts','flowers','fires','portals',
   'graves','skeletons','foes','bullets','bossDoors','_bossHearts'
  ].forEach(function(k){Play[k]=[];});
  Play.boss=null;
  /* ★BOSS 专属 BGM 闩锁随关卡复位★：换关/重开时若不清零，
     新关卡里 BOSS 激活后会因为 `_bossBgmOn` 仍是上一次的 true 而**不切歌**。
     同时把「当前关卡」记下来，供 `_pbossBgm(false)` 恢复关卡曲时定位种子
     （与 game.js 的 `LevelContext.levels[LevelContext.currentIdx]` 同源）。 */
  Play._bossBgmOn=false;
  Play._bossBgmLevel=(typeof LevelContext!=='undefined'&&LevelContext&&LevelContext.levels)?LevelContext.levels[LevelContext.currentIdx]:null;
  Play.ghosts=[];Play.particles=[];Play.trajectory=[];Play.dashTrajectory=[];
  /* 轨迹采样状态必须与轨迹一起复位：否则上一关抽稀放大过的 _trajStride
     会残留，让新关卡的幽灵轨迹一开始就是稀疏的（观感=幽灵跳着走）。 */
  Play._trajStride=1;Play._trajTick=0;Play._stillFrames=0;
  Play._stillBaseX=Play.spawnX;Play._stillBaseY=Play.spawnY;Play._trajDecimAt=0;
  Play.deathCount=0;Play.won=false;
  Play.currentRespawnOrigin='default';Play.currentFlag=null;Play.placedFlags=[];
  Play.flagsCollected=lv.initialFlags||0;
  Play.lives=lv.initialLives||3;Play.maxLives=Play.lives;
  Play.energy=1;Play.slowActive=false;Play.slowLocked=false;Play.slowRefill=0;Play.slowWarn=0;
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
      case 'foam':c._squash=0;Play.foams.push(c);break;
      /* ★旗杆★：无运行时 state —— "是否激活"直接就是 `Play.currentFlag===this`。
         `isPole` 标记用来把旗杆与"玩家自插的临时旗"区分开（拔旗守卫 + 不同的绘制形态）。 */
      case 'flagPole':c.isPole=true;Play.flagPoles.push(c);break;
      /* ★野兽★：sleep(睡觉挡路/实心) → scared(惊吓动作中/不挡) → gone(移除)。
         `_pass` 阶段完全由 updateBeasts 推进；`state='gone'` 时从数组 splice 掉。 */
      case 'beast':c.state='sleep';c._t=0;Play.beasts.push(c);break;
      /* ★巨花★：bloom(盛开/实心，同时挡玩家) → withering(_t 驱动的中间态) → gone(移除)。
         触发源只有幽灵（见 updateFlowers）：幽灵进入 triggerRadius 即开始枯萎。 */
      case 'flower':c.state='bloom';c._t=0;Play.flowers.push(c);break;
      /* ★火★：burning(常驻致命) → dousing(扑灭动画中) → 移除。
         与 flammable 零交叉（不蔓延/不被爆炸点燃/不自行熄灭），只有这两态。 */
      case 'fire':c.state='burning';c._t=0;Play.fires.push(c);break;
      /* ★传送门（v3）★：**纯回放侧**的机制，元素本身无 state、**不进 allSolids**。
         玩家完全不传送（门对玩家只是半透明标记物）；只有幽灵回放时被"整体挪到出口再继续演"。
         `role` 区分入口/出口，`link` 是配对标。详见 PlayGhost 里的 _scanPortalCrossings。 */
      case 'portal':Play.portals.push(c);break;
      /* ★墓碑（grave）★：靠近触发 → 粉碎消失，并从墓碑位置刷出一只苍白鬼魂。
         触发过一次即永久消失（同一局内 `respawnPlay` 不重建；只有重开才会重建）。 */
      case 'grave':c.state='idle';c._t=0;Play.graves.push(c);break;
      /* ★骷髅怪（skeleton）★：方块骷髅，左右两侧有尖刺。
         双状态机 patrol（小范围左右巡视）/ charge（蓄力冲刺 → 最大距离眩晕）；
         `stun` 期间玩家可跳到它头顶踩死。其他时刻碰到即死。 */
      case 'skeleton':c.state='patrol';c._t=0;c._dir=1;c._homeX=c.x;c._anim=0;Play.skeletons.push(c);break;
      /* ★BOSS★：单例。走进 activeRadius 激活，离开一段时间沉睡；巨大恶魔上半身。 */
      case 'boss':Play.boss=makeBoss(c);break;
      /* ★BOSS 门（bossDoor）★：可配编号与 BOSS 绑定。BOSS 醒来 ⇒ 关；死亡/未激活 ⇒ 开。 */
      case 'bossDoor':c.open=true;c._openProgress=1;Play.bossDoors.push(c);break;
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
  /* ★泡沫砖闩锁必须随重生清零★：`_pass` 是"本次穿行"的临时通行证，
     而重生会凭空把玩家搬到别处 —— 若不清零，上一轮遗留的闩锁会让某块砖
     在本轮永久变成空气（玩家可穿过它 = 与编辑器里看到的不一致）。
     这里只清状态位，纯物理侧，无表现开销。 */
  if(Play.foams&&Play.foams.length){
    for(var _rf=0;_rf<Play.foams.length;_rf++){Play.foams[_rf]._pass=0;}
  }
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
/* ==================== ★怪物与 BOSS 逻辑层★ ====================
   （渲染层见 drawGraveTo / drawGhostFoeTo / drawFireFoeTo / drawSkeletonTo /
     drawBulletTo / drawBossTo / drawBossHpBar / drawBossDoorTo）

   ★三条硬纪律★（贯穿本文件全部函数）
     ① **双端逐字一致**：本文件全部函数都会用 `_sync_eng.py` 同步到 index.html，
        所以严禁出现 `Ed.` / `LevelContext.` 这类"端相关"标识符（一律用 `Play.`）。
     ② **确定性**：状态推进**零 Math.random()** —— 相位一律由「序号 + `_simTime()`」
        算出（`_pr` 是既有的确定性哈希）。只有**纯表现层粒子**（`mkParticle`）允许随机，
        与既有 `triggerExplosion` 完全一致。
     ③ **不破坏既有语义**：所有新实体**不进 `allSolids`**（唯一例外 = 关着的 BOSS 门），
        "碰到死"的判定一律挂在既有 `spike`/`fire` 的那一段里。 */

/* ---- AABB 命中（不含边贴边）----
   签名刻意用 (x,y,w,h) 而不是传对象：怪物寻路每帧要试探 3~4 次，
   传对象会每帧产生 4×N 个临时对象（GC 压力）。 */
function _boxHits(x,y,w,h,solids){
  if(!solids||!solids.length)return false;
  for(var i=0;i<solids.length;i++){
    var r=solids[i];
    if(!r)continue;
    if(x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y)return true;
  }
  return false;
}

/* ---- 世界实体快照：给「怪物寻路 / 落点搜索」用的只读地形表 ----
   注意**不含**怪物自身、不含墓碑/荆棘/火等"碰到死"的非固体，
   否则怪物会把自己当成墙。 */
function _buildWorldSolids(){
  var s=[];
  Play.platforms.forEach(function(o){s.push(o);});
  Play.movables.forEach(function(o){s.push(o);});
  Play.breakables.forEach(function(o){s.push(o);});
  Play.flammables.forEach(function(o){if(o.burning<=0)s.push(o);});
  Play.iceBlocks.forEach(function(o){s.push(o);});
  Play.foams.forEach(function(o){if(!o._pass)s.push(o);});
  Play.disappearPlats.forEach(function(o){if(isDisappearVisible(o))s.push(o);});
  Play.doors.forEach(function(o){if(!_doorPassable(o))s.push(o);});
  Play.switchDoors.forEach(function(o){if(!_doorPassable(o))s.push(o);});
  Play.beasts.forEach(function(o){if(o.state==='sleep')s.push(o);});
  Play.flowers.forEach(function(o){if(o.state!=='gone')s.push(o);});
  if(Play.bossDoors)Play.bossDoors.forEach(function(o){if(!_bossDoorPassable(o))s.push(o);});
  return s;
}

/* ★每帧一次的地形快照★：updatePlay 在推进怪物之前**每帧重建一次**
   （`Play._worldSolidsCache=_buildWorldSolids()`），同一帧内全部怪物/搜索共享
   同一份 ⇒ 不会退化成 N 只鬼魂 × M 个实体的 N·M 次遍历。
   本函数是"取用口"：缓存缺失时（例如 lab 里直接调单个 update*）就地兜底重建。 */
function resolveSolids(){
  var s=Play._worldSolidsCache;
  if(!s){s=_buildWorldSolids();Play._worldSolidsCache=s;}
  return s;
}

/* ==================== ★墓碑 + 苍白鬼魂（小怪1）★ ==================== */

/* 构造一只苍白鬼魂（从墓碑位置"钻出来"）。
   `gr` = 墓碑元素（提供 ghostSpeed / fireRange / fireCooldown / bulletSpeed）。 */
function makeFoeGhost(gr){
  var sx=(gr.x!==undefined?gr.x:0)+(gr.w!==undefined?gr.w:8)/2-4;
  return {
    kind:'ghost',
    x:sx,y:(gr.y!==undefined?gr.y:0)-2,w:8,h:8,
    hp:1,
    speed:(gr.ghostSpeed!==undefined?gr.ghostSpeed:0.9),
    fireRange:(gr.fireRange!==undefined?gr.fireRange:64),
    fireCooldown:(gr.fireCooldown!==undefined?gr.fireCooldown:1.6),
    bulletSpeed:(gr.bulletSpeed!==undefined?gr.bulletSpeed:2.6),
    homeX:sx,homeY:(gr.y!==undefined?gr.y:0),
    _t:0,_fireCd:0,_dir:1,_ph:_pr(gr.x*3.1+gr.y*7.7)*6.283,
    _anim:0,_gaze:1,_spawn:0,
    state:'chase'
  };
}

/* 构造一只火团怪（从火焰里"弹"出来）。`fr` = 火焰元素。 */
function makeFoeFire(fr){
  var cx=(fr.x||0)+(fr.w||8)/2-4;
  return {
    kind:'fireball',
    x:cx,y:((fr.y||0)-4),w:8,h:8,
    hp:1,
    speed:(fr.foeSpeed!==undefined?fr.foeSpeed:0.5),
    wanderRadius:(fr.foeWanderRadius!==undefined?fr.foeWanderRadius:24),
    homeX:cx,homeY:(fr.y||0),
    _t:0,_anim:0,_ph:_pr(fr.x*5.3+fr.y*2.9)*6.283,
    _fireRef:fr,
    state:'roam'
  };
}

/* ★墓碑★：
   ① 玩家**或已释放的幽灵**中心进入 `triggerRadius` ⇒ `crumbling` + 刷一只鬼魂；
   ② 播 `crumbleTime` 秒粉碎动画 ⇒ 从数组移除（**本局内不再出现**）；
   ③ 触发过一次即永久消失 —— 用数组 splice 实现，`respawnPlay` 不重建。 */
function updateGraves(dt){
  if(!Play.graves||!Play.graves.length)return;
  for(var i=Play.graves.length-1;i>=0;i--){
    var gr=Play.graves[i];
    if(gr.state==='gone'){Play.graves.splice(i,1);continue;}
    gr._t=(gr._t||0)+dt;
    if(gr.state==='idle'){
      var tr=gr.triggerRadius||32;
      var gcx=gr.x+(gr.w||8)/2, gcy=gr.y+(gr.h||8)/2;
      var hit=false;
      var p=Play.player;
      if(p&&!p.dead){
        var pdx=(p.x+p.w/2)-gcx, pdy=(p.y+p.h/2)-gcy;
        if(pdx*pdx+pdy*pdy<tr*tr)hit=true;
      }
      if(!hit){
        for(var gi=0;gi<Play.ghosts.length;gi++){
          var g=Play.ghosts[gi];
          if(!g.released)continue;
          var gdx=(g.x+4)-gcx, gdy=(g.y+4)-gcy;
          if(gdx*gdx+gdy*gdy<tr*tr){hit=true;break;}
        }
      }
      if(hit){
        gr.state='crumbling';gr._t=0;
        /* 从墓碑位置刷出鬼魂 —— 用户原话「墓碑触发过一次后会直接粉碎消失，
           鬼魂被触发后会以一个可配置的速度…紧随玩家飘来」 */
        Play.foes.push(makeFoeGhost(gr));
      _psfx('graveCrush', gr.x+(gr.w||8)/2, gr.y+(gr.h||8)/2);   /* 墓碑碎裂 */
      _psfx('foeGhostSpawn', gr.x+(gr.w||8)/2, gr.y);            /* 鬼魂破土而出 */
        /* 纯表现：碎石迸溅 + 一团灰白尘雾 */
        for(var k=0;k<14;k++){
          var a=Math.random()*Math.PI*2;
          var s=0.8+Math.random()*2.2;
          Play.particles.push(mkParticle(gcx,gcy,Math.cos(a)*s,Math.sin(a)*s-1.2,600,150,156,164));
        }
        for(var k2=0;k2<10;k2++){
          var a2=Math.random()*Math.PI*2;
          Play.particles.push(mkParticle(gcx,gcy,Math.cos(a2)*0.8,Math.sin(a2)*0.8-0.5,900,210,214,222));
        }
      }
      continue;
    }
    /* crumbling 播完 → 永久移除 */
    if(gr._t>=(gr.crumbleTime||0.6))gr.state='gone';
  }
}

/* ★小怪总更新★：鬼魂寻路 + 开火；火团怪游荡。 */
function updateFoes(dt){
  if(!Play.foes||!Play.foes.length)return;
  var p=Play.player;
  for(var i=Play.foes.length-1;i>=0;i--){
    var f=Play.foes[i];
    f._t=(f._t||0)+dt;
    /* ---- 死亡动画（被击杀）---- */
    if(f.state==='dying'){
      f._anim=(f._anim||0)+dt;
      if(f._anim>=(f.kind==='ghost'?0.35:0.4)){Play.foes.splice(i,1);}
      continue;
    }
    if(f.kind==='fireball'){
      /* ---- ★火团怪：围绕炉火巡视（不穿墙）★ ----
         用户原话「火焰怪应该也不能穿墙，只能围绕在炉火旁边巡视」。
         ★旧实现的 bug★：直接 `f.x=homeX+sin(...)` 是"瞬移到正弦轨迹上"，
         完全无视地形 ⇒ 火团怪会穿过墙壁/地板。
         ★新实现★：把正弦轨迹当成**期望点**（保留确定性 + 缓慢往复的观感），
         再逐轴碰撞试探 —— 与鬼魂寻路**同一套** `_boxHits` 语言：
           · 每轴独立试探，被挡就放弃该轴（贴墙滑行，不穿透）；
           · 最后一次世界边界夹住（防止飘出关卡）。
         ★缓动系数★：`speed` 决定"跟得多紧"，与正弦周期(2π/0.85≈7.4s)相比
         时间常数极小 ⇒ 轨迹几乎无滞后（实测振幅 23.96 / 期望 24），
         但不会瞬移 ⇒ 观感依旧是"缓慢巡视"。 */
      var R=f.wanderRadius||24;
      var t=f._t+f._ph;
      var wantX=f.homeX+Math.sin(t*0.85)*R;
      var wantY=f.homeY+Math.sin(t*1.31+1.7)*R*0.42+Math.sin(t*0.53)*2;
      var solids2=resolveSolids();
      var ease=Math.min(1,(f.speed||0.5)*0.5);
      var stepX=(wantX-f.x)*ease, stepY=(wantY-f.y)*ease;
      f._dir=(stepX>=0)?1:-1;
      var txp=f.x+stepX;
      if(!_boxHits(txp,f.y,f.w,f.h,solids2))f.x=txp;
      var typ=f.y+stepY;
      if(!_boxHits(f.x,typ,f.w,f.h,solids2))f.y=typ;
      var wb2=Play.worldBounds;
      if(wb2){
        if(f.x<wb2.minX)f.x=wb2.minX;
        if(f.x+f.w>wb2.maxX)f.x=wb2.maxX-f.w;
        if(f.y<wb2.minY)f.y=wb2.minY;
        if(f.y+f.h>wb2.maxY)f.y=wb2.maxY-f.h;
      }
      continue;
    }
    /* ---- 苍白鬼魂：简易寻路（不穿地形）---- */
    if(!p||p.dead)continue;
    /* ★地形快照复用★：resolveSolids() 每帧只重建一次（N 只鬼魂共享同一份），
       否则 N×M 的实体遍历会随墓碑数线性放大。 */
    var solids=resolveSolids();
    var tx=p.x+4, ty=p.y+4;
    var cx=f.x+4, cy=f.y+4;
    var dx=tx-cx, dy=ty-cy;
    var dist=Math.sqrt(dx*dx+dy*dy);
    var dir=(dx>0)?1:(-1);
    f._dir=dir;
    f._gaze=dir;
    var sp=f.speed;
    /* ① 水平逼近（步长随距离递减，避免贴脸抖动） */
    var nx=(Math.abs(dx)>1?(dir*Math.min(sp,Math.abs(dx))):0);
    /* ② 垂直逼近：目标高度差大时也缓慢上下飘（用户要求"飘来"，允许浮空） */
    var ny=0;
    if(Math.abs(dy)>2)ny=Math.max(-sp*0.7,Math.min(sp*0.7,dy*0.06));
    /* ③ 碰撞试探：不穿地形 */
    var moved=false;
    var blockedX=false;
    var tryX=f.x+nx;
    if(!_boxHits(tryX,f.y,f.w,f.h,solids)){f.x=tryX;moved=true;}
    else{
      /* 撞墙 → 沿墙向上爬（鬼魂会飘，符合直觉且天然不穿墙） */
      blockedX=true;
      var climb=f.y-Math.max(0.4,sp*0.8);
      if(!_boxHits(f.x,climb,f.w,f.h,solids)){
        f.y=climb;
        var half=f.x+dir*Math.max(0.3,sp*0.45);
        if(!_boxHits(half,f.y,f.w,f.h,solids)){f.x=half;moved=true;}
      }
    }
    /* ★撞墙那一帧**不做**垂直追赶★：否则"向上爬 max(0.4,sp*0.8)"与
       "向下追 min(sp*0.7, dy*0.06)"会互相抵消 —— 玩家在墙的另一侧且高度更低时，
       鬼魂会卡在墙面反复微抖，**永远翻不过去**（实测 600 帧只爬 43px）。
       跳过垂直追赶后，撞墙帧纯粹爬升 ⇒ 能在 ~95 帧内翻过 8 格高的墙。 */
    var tryY=f.y+ny;
    if(!blockedX&&!_boxHits(f.x,tryY,f.w,f.h,solids)){f.y=tryY;}
    /* ④ 世界边界内夹住（防止飘出关卡）*/
    var wb=Play.worldBounds;
    if(wb){
      if(f.x<wb.minX)f.x=wb.minX;
      if(f.x+f.w>wb.maxX)f.x=wb.maxX-f.w;
      if(f.y<wb.minY)f.y=wb.minY;
      if(f.y+f.h>wb.maxY)f.y=wb.maxY-f.h;
    }
    /* ⑤ 到玩家附近一定距离 ⇒ 按冷却发子弹 */
    f._fireCd=Math.max(0,(f._fireCd||0)-dt);
    var fr2=f.fireRange||64;
    if(dist<fr2&&f._fireCd<=0){
      f._fireCd=f.fireCooldown||1.6;
      var bs=f.bulletSpeed||2.6;
      var blen=Math.max(0.001,dist);
      var vx=dx/blen*bs, vy=dy/blen*bs;
      Play.bullets.push({
        kind:'ghostShot',x:cx-2,y:cy-2,w:4,h:4,
        vx:vx,vy:vy,life:3.2,_anim:0,owner:'foe',
        _ph:_pr(f.x+i*1.3)*6.283
      });
      _psfx('foeGhostShot', f.x+f.w/2, f.y+f.h/2);
      /* 纯表现：开火口的一小圈白雾 */
      for(var m=0;m<5;m++){
        var am=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(cx,cy,Math.cos(am)*1.1,Math.sin(am)*1.1,260,220,230,255));
      }
    }
  }
}

/* ★火刷怪★：`spawnInterval>0` 的火按频率在火焰邻近刷火团怪（上限 spawnMax）。 */
function updateFireSpawners(dt){
  if(!Play.fires||!Play.fires.length)return;
  for(var i=0;i<Play.fires.length;i++){
    var fr=Play.fires[i];
    if(fr.state!=='burning')continue;                 /* 被扑灭 ⇒ 不再刷新 */
    var iv=fr.spawnInterval||0;
    if(iv<=0)continue;
    var max=fr.spawnMax||3;
    var alive=0;
    for(var j=0;j<Play.foes.length;j++){
      var f=Play.foes[j];
      if(f.kind==='fireball'&&f._fireRef===fr&&f.state!=='dying')alive++;
    }
    if(alive>=max)continue;
    /* ★初始相位★：用 `_pr` 给同一关的多团火错开刷新时刻（否则多团火会同帧齐刷）。
       ★必须用 `===undefined` 判断，不能用 `||`★：`||` 会把「刚重置的 0」当作假值，
       于是每帧都重新播种相位（0.678），实际间隔被压成 `iv - phase` 而不是 `iv`
       —— 实测 `iv=1.0` 变成 0.33s（快 3 倍）。 */
    if(fr._spawnT===undefined)fr._spawnT=_pr(fr.x*2.7+fr.y*3.3)*iv;
    fr._spawnT+=dt;
    if(fr._spawnT>=iv){
      fr._spawnT=0;
      Play.foes.push(makeFoeFire(fr));
      _psfx('foeFireSpawn', fr.x+4, fr.y);
      /* 纯表现：出怪瞬间喷一撮火星（火团怪自己会播"从火里弹出来"的出场放大） */
      for(var k=0;k<10;k++){
        var a=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(fr.x+4,fr.y+2,Math.cos(a)*1.4,Math.sin(a)*1.4-1.2,520,255,160,60));
      }
    }
  }
}

/* ★弹幕位移 + 出界清理★。
   ★出界口径★：BOSS 弹幕以**摄像机视野**为准（用户原话「从摄像机顶部刷出、
   飞出摄像机即销毁」）；小怪的子弹以**世界边界**为准（它们是小范围武器）。 */
function updateBullets(dt){
  if(!Play.bullets||!Play.bullets.length)return;
  var cam=Play.cam;
  var wb=Play.worldBounds;
  for(var i=Play.bullets.length-1;i>=0;i--){
    var b=Play.bullets[i];
    b.life=(b.life||3)-dt;
    b.x+=(b.vx||0)*dt*60;
    b.y+=(b.vy||0)*dt*60;
    b._anim=(b._anim||0)+dt;
    /* 激光：预警 → 实体 */
    if(b.kind==='laser'){
      b._t=(b._t||0)+dt;
      if(!b._phase&&b._t>=0.5){b._phase=1;b._t=0;}
      else if(b._phase&&b._t>=0.35){Play.bullets.splice(i,1);continue;}
    }
    if(b.life<=0){Play.bullets.splice(i,1);continue;}
    if(b.owner==='boss'&&cam){
      if(b.x+b.w<cam.x-40||b.x>cam.x+cam.viewW+40||b.y>cam.y+cam.viewH+40||b.y+b.h<cam.y-160){
        Play.bullets.splice(i,1);continue;
      }
    }else if(wb){
      if(b.x+b.w<wb.minX-60||b.x>wb.maxX+60||b.y+b.h<wb.minY-120||b.y>wb.maxY+60){
        Play.bullets.splice(i,1);continue;
      }
    }
  }
}

/* ==================== ★骷髅怪（小怪3）★ ====================
   双状态机（用户原话「两个状态机」）：
     patrol  ──玩家进入 detectRange──▶  charge  ──到 chargeMaxDist / 撞墙──▶  stun
        ▲                                                                      │
        └──────────────────── stunTime 结束 ───────────────────────────────────┘
   · patrol：以 `_homeX` 为锚在 ±patrolRange/2 内左右走（碰墙/出界即反向）。
   · charge：windup(0.35s 后仰蓄力) → dash（朝玩家方向水平冲刺）。
   · stun  ：`stunTime` 秒内头顶转星星 —— **此时可被玩家踩顶踩死**。
   · patrol / charge 期间碰到玩家 ⇒ 玩家死（由"致命判定"段负责）。 */
function updateSkeletons(dt){
  if(!Play.skeletons||!Play.skeletons.length)return;
  var p=Play.player;
  var solids=resolveSolids();
  for(var i=Play.skeletons.length-1;i>=0;i--){
    var sk=Play.skeletons[i];
    sk._t=(sk._t||0)+dt;
    sk._anim=(sk._anim||0)+dt;
    if(sk.state==='dead'){
      if(sk._t>=(sk.deadTime||0.5))Play.skeletons.splice(i,1);
      continue;
    }
    /* ★★重力/贴地（关键修复：用户报告"骷髅怪贴墙时浮空"）★★
       骷髅在编辑器里是按"左上角坐标"手摆的，摆的 y 经常不落在任何平台上
       （摆在半空、或比地面高一格）。旧版**完全没有竖直位移** ——
       `sk.y` 只在生成时读一次、之后永远不变 ⇒ 骷髅就**悬在摆的那个高度**，
       既掉不下来也踩不到地 ⇒ 观感就是"浮空"。
       这里补一个极简的"竖直下落 + 落定"积分（1px 逐步试探，不穿模）：
         · 未落地：每帧按 `_vy` 下落，逐 1px 试探；一撞到固体就停在上一合法位置；
         · 已落地：若脚下地形消失（平台被打掉等）⇒ 重新进入下落。
       语义只要"落到最近的可站立面"这一个，不需要玩家那套跳跃/斜坡，
       所以刻意**不复用 stepPlayerPhysics**，保持极简且确定。 */
    if(sk._vy===undefined)sk._vy=0;
    if(!sk._grounded){
      sk._vy=Math.min(sk._vy+30*dt,8);
      var _fall=sk._vy*dt*60, _guard=0;
      while(_fall>0&&_guard++<256){
        var _mv=Math.min(1,_fall);
        if(_boxHits(sk.x,sk.y+_mv,sk.w,sk.h,solids)){ sk._vy=0; _fall=0; break; }
        sk.y+=_mv; _fall-=_mv;
      }
      /* 站定判定：再往下 0.5px 就会撞 ⇒ 已落地 */
      if(_boxHits(sk.x,sk.y+0.5,sk.w,sk.h,solids)){sk._grounded=true;sk._vy=0;}
    }else if(!_boxHits(sk.x,sk.y+0.6,sk.w,sk.h,solids)){
      sk._grounded=false;sk._vy=0;              /* 脚下地形没了 ⇒ 继续掉 */
    }
    var pcx=p?(p.x+p.w/2):0, pcy=p?(p.y+p.h/2):0;
    var scx=sk.x+sk.w/2, scy=sk.y+sk.h/2;
    var ddx=pcx-scx, ddy=pcy-scy;
    var dist2=ddx*ddx+ddy*ddy;
    var detect=sk.detectRange||88;
    var alive=p&&!p.dead;
    if(sk.state==='patrol'){
      /* ★骨骼行走的"咔哒"★：用 `_t` 取整做节拍器（每 0.42s 一下），
         只在**真的在移动**时响 ⇒ 不动不响。纯表现，不进任何判定。 */
      var _bp=Math.floor((sk._t||0)/0.42);
      if(_bp!==sk._beat){ sk._beat=_bp; _psfx('skelTick', sk.x+sk.w/2, sk.y+sk.h/2); }
      var half=(sk.patrolRange||40)/2;
      var spd=0.6;
      var nx2=sk.x+sk._dir*spd;
      /* 出巡视范围 / 撞墙 ⇒ 反向。
         ★锚点口径必须与比较量一致★：`_homeX` 存的是**左边缘**(c.x)，
         所以这里也拿左边缘 `nx2` 去比（曾误用"中心 vs 左边缘"，导致巡视带
         整体右移半个身位、实测偏离达 25.8 > 20）。 */
      var outRange=nx2>(sk._homeX+half)||nx2<(sk._homeX-half);
      var blocked=_boxHits(nx2,sk.y,sk.w,sk.h,solids);
      if(outRange||blocked){sk._dir=-(sk._dir||1);}
      else sk.x=nx2;
      /* 玩家进入范围 ⇒ 蓄力冲刺 */
      if(alive&&dist2<detect*detect){
        sk.state='charge';sk._t=0;sk._windup=0.35;
        sk._chargeFromX=sk.x;
        sk._chargeDir=(ddx>=0)?1:-1;
        sk._dir=sk._chargeDir;
        _psfx('skelAlert', sk.x+sk.w/2, sk.y);      /* 发现玩家：警觉一响 */
      }
      continue;
    }
    if(sk.state==='charge'){
      var wind=sk._windup||0.35;
      var cs=sk.chargeSpeed||5.2;
      if(sk._t<wind)continue;                     /* 蓄力中：原地后仰 */
      if(!sk._dashed){
        sk._dashed=true;
        _psfx('skelCharge', sk.x+sk.w/2, sk.y);   /* 蓄力收束 */
        _psfx('skelDash',   sk.x+sk.w/2, sk.y);   /* 破风起跑 */
      }
      var step=cs;
      var cnx=sk.x+sk._chargeDir*step;
      if(_boxHits(cnx,sk.y,sk.w,sk.h,solids)){sk.state='stun';sk._t=0;_psfx('skelStun',sk.x+sk.w/2,sk.y);continue;}
      sk.x=cnx;
      var travelled=Math.abs(sk.x-(sk._chargeFromX||sk.x));
      /* 到达最大冲刺距离 ⇒ 眩晕（用户原话「冲到最大距离后眩晕」）*/
      if(travelled>=(sk.chargeMaxDist||120)){sk.state='stun';sk._t=0;_psfx('skelStun',sk.x+sk.w/2,sk.y);}
      continue;
    }
    if(sk.state==='stun'){
      /* 眩晕期间：可被踩死（由"致命判定"段处理）；时间到 → 回到巡视 */
      if(sk._t>=(sk.stunTime||2.2)){
        sk.state='patrol';sk._t=0;sk._homeX=sk.x;
        sk._dashed=false;sk._beat=-1;              /* 复位冲刺/脚步节拍闩锁 */
        sk._dir=(p&&p.x>sk.x)?-1:1;
      }
      continue;
    }
  }
}

/* ==================== ★BOSS★ ====================
   用户原话逐条对齐：
     · 走到配置点位距离内激活，离开一段时间沉睡；
     · 巨大、上半身、恶魔造型、停在原地无法直接交互；
     · 从口中吐出尖刺 / 火球 / 激光弹幕；
     · 弹幕从摄像机顶部刷出、出摄像机立即销毁；
     · 随机但需刷新机制确保可配置难度且可通关；
     · 底部血条；旁爆炸造成伤害、每次 1 点、血量可配；
     · 波次刷新、每波时间与难度可配；每波结束掉生命心到最近可达平台；
     · 暂停 5~7s；全波打完从第一波重来直到打死。 */
function _defaultBossWaves(){
  return [
    {time:11,count:12,speedMul:1.00,safeGapMul:1.00,densityMul:1.00,aimMul:1.00,kinds:['spike']},
    {time:11,count:16,speedMul:1.16,safeGapMul:0.85,densityMul:1.20,aimMul:0.80,kinds:['spike','fireball']},
    {time:12,count:18,speedMul:1.34,safeGapMul:0.72,densityMul:1.45,aimMul:0.62,kinds:['spike','fireball','laser']}
  ];
}

/* `densityMul` = 弹幕密度倍率（乘到每波 count 上）；`aimMul` = 瞄准聚拢倍率
   （1=全屏均匀、越小越集中在玩家正上方；见 `_bossSpawnShot`）。
   两者都既可在**波次**里逐波配置，也可在**元素**上给一个全局倍率
   （`el.densityMul` / `el.aimMul`，编辑器只需两个滑块就能整体调难度）。 */
function makeBoss(el){
  var waves=(el.waves&&el.waves.length)?el.waves:_defaultBossWaves();
  return {
    id:(el.id!==undefined?el.id:''),
    x:el.x,y:el.y,w:el.w||160,h:el.h||120,
    state:'dormant',hp:(el.maxHp!==undefined?el.maxHp:12),maxHp:(el.maxHp!==undefined?el.maxHp:12),
    activeRadius:(el.activeRadius!==undefined?el.activeRadius:96),
    sleepDelay:(el.sleepDelay!==undefined?el.sleepDelay:4),
    damageRadius:(el.damageRadius!==undefined?el.damageRadius:40),
    wavePauseMin:(el.wavePauseMin!==undefined?el.wavePauseMin:5),
    wavePauseMax:(el.wavePauseMax!==undefined?el.wavePauseMax:7),
    waves:waves,
    /* ★全局难度倍率★：落在 **每一条** 弹幕生成上（逐波倍率再与它相乘） */
    _dMul:(el.densityMul!==undefined?el.densityMul:1),
    _aMul:(el.aimMul!==undefined?el.aimMul:1),
    /* ★`_vis` 可见度★（用户原话「BOSS 苏醒前可以是几乎透明的，苏醒时慢慢由
       透明状态过渡到完全不透明」）：`dormant` ⇒ 目标 0.10（几乎看不见），
       `awake` ⇒ 目标 1.0（完全实体），由 `updateBoss` 按指数缓动逼近。
       为什么不复用 `_hurtFlash` 之类的既有量：那些是**瞬时**表现量，
       这里需要的是"会停在目标值上的长期状态量"。 */
    _vis:0.10,
    waveIdx:0,phase:'idle',_t:0,_spawned:0,_seed:0,
    _sleepT:0,_hurtFlash:0,_barFlash:0,_barFade:0,_mouth:0,_anim:0,_deathT:0,_deathTime:2.0,
    _lastCamY:null
  };
}

/* 确定性伪随机（0..1）：种子固定 ⇒ 同一次激活可复现 */
function _bossRand(b,k){
  return _pr((b._seed||0)*1.37+k*7.91);
}

/* ★每波实际弹幕总数★ = `count × densityMul × BOSS 全局 _dMul`（下限 1）。
   用户原话「弹幕密度应该也可以配置，最高可以密度非常高几乎满屏弹幕那种超高难度」
   ⇒ 把"密度"做成一个**纯乘数**：既有波次不用改就保持原样（1.0），
   想把难度拉满只需把 `densityMul` 调到 3~6（配合更短的 `time`）。 */
function _bossWaveTotal(b,wv){
  var d=(wv.densityMul!==undefined?wv.densityMul:1)*((b._dMul!==undefined)?b._dMul:1);
  return Math.max(1,Math.round((wv.count||1)*d));
}

/* ★BOSS 门可通过性★：`bossDoor.bossId === boss.id` 绑定。
   BOSS `awake` ⇒ 关（挡路）；`dormant` / `dead` ⇒ 开；找不到绑定 boss ⇒ **恒开**。 */
function _bossDoorPassable(d){
  if(!d)return true;
  var b=Play.boss;
  if(!b)return true;                                  /* 本关没有 BOSS ⇒ 恒开 */
  var bid=(b.id===undefined?'':b.id);
  var want=(d.bossId===undefined?'':d.bossId);
  if(want!==''&&want!==bid)return true;               /* 编号不匹配 ⇒ 恒开 */
  if(b.state==='awake')return false;                  /* 醒来 ⇒ 关（同普通门语义直接判 false） */
  return true;
}

function updateBossDoors(dt){
  if(!Play.bossDoors||!Play.bossDoors.length)return;
  for(var i=0;i<Play.bossDoors.length;i++){
    var d=Play.bossDoors[i];
    var wantOpen=_bossDoorPassable(d);
    d.open=wantOpen;
    if(d._openProgress===undefined)d._openProgress=wantOpen?1:0;
    var t=wantOpen?1:0;
    var prev=d._openProgress;
    d._openProgress+= (t-d._openProgress)*Math.min(1,dt*10);
    if(Math.abs(d._openProgress-t)<0.01)d._openProgress=t;
    /* 关上那一帧：震屏 + 灰尘（纯表现） */
    if(!wantOpen&&prev<0.5&&d._openProgress>=0.5){
      Play.screenShake=Math.max(Play.screenShake||0,5);
      for(var k=0;k<10;k++){
        var a=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(d.x+d.w/2,d.y+d.h,Math.cos(a)*1.3,Math.sin(a)*1.3+0.4,520,150,140,130));
      }
    }
  }
}

/* ============================================================================
 * 怪物 / BOSS 音效接线（纯表现层）
 * ---------------------------------------------------------------------------
 *  · `_psfx(name,x,y)`：安全播一次音效。
 *      音效是「游戏外壳」能力：正式版 game.html 加载 audio.js 提供 window.AudioSystem；
 *      编辑器 index.html 不加载它。两端共用 runtime.js ⇒ 一律做存在性守卫，
 *      编辑器里守卫为假直接返回（观感不变），正式版里恒真。
 *  · `_pbossBgm(on)`：BOSS 专属 BGM 的开关。
 *        on=true  → setScene('boss')：淡出关卡 BGM、淡入 BOSS 主题
 *        on=false → setScene('level')：淡出 BOSS 主题、回到关卡 BGM（不重启关卡曲）
 *      audio.js 内部用 `_startTrackFromBuffer` 的 0.6s 交叉淡化做过渡，
 *      所以这里只负责「切场景」，不自己写 gain 包络。
 *  · `_bossBgmOn`：幂等闩锁 —— 同一状态重复调用不会反复切场景（切场景会重起曲子）。
 *     随 `startPlay()` 复位（见该函数末尾的 BOSS 段），保证换关/重开时归零。
 * ========================================================================== */
function _psfx(name, x, y) {
  if (typeof AudioSystem === 'undefined' || !AudioSystem || !AudioSystem.sfx) return;
  try { AudioSystem.sfx(name, x, y); } catch (e) { }
}
function _pbossBgm(on) {
  if (typeof AudioSystem === 'undefined' || !AudioSystem || !AudioSystem.setScene) return;
  if (Play._bossBgmOn === on) return;               /* 幂等：状态没变就不重起曲子 */
  Play._bossBgmOn = on;
  try { AudioSystem.setScene(on ? 'boss' : 'level', Play._bossBgmLevel || null); } catch (e) { }
}

/* ★立即止攻★：清掉所有 `owner==='boss'` 的弹幕（**含激光**：预警段与实体段一并清）。
   用户报的 bug：「boss死亡或者沉睡后弹幕和激光攻击都应该立即停止刷新」。
   ★只清 BOSS 自己的★：小怪（鬼魂 `ghostShot`）的 owner 是 `'foe'`，必须保留 ——
   否则 BOSS 一沉睡/死亡就把场上其他怪物的在飞子弹也抹掉（跨机制污染，
   表现为"鬼魂刚打出的子弹凭空消失"）。 */
function _bossClearShots(){
  var bs=Play.bullets;
  if(!bs||!bs.length)return;
  for(var i=bs.length-1;i>=0;i--){
    if(bs[i]&&bs[i].owner==='boss')bs.splice(i,1);
  }
}

/* ★BOSS 主更新★
   ★"止攻"的硬门★（用户 bug 修复）：只有 `awake` 才允许生成弹幕。
   三处早退，缺一不可 ——
     · `dead`  ：死亡崩解演出中（`_deathT` 未满）；
     · `gone`  ：★此前漏了这条★ 崩解演出结束、BOSS 彻底消散。旧代码没有 `gone`
       分支，`_deathT>=_deathTime` 把 state 改成 `'gone'` 后**下一帧就落进
       下文 `awake` 主循环**（因为 `if(b.state==='dead')` 不再成立），
       于是 `phase` 仍是 `'firing'`、`_spawned` 继续按 `_bossWaveTotal` 补弹，
       并且每满一波还掉生命心 / 循环波次 —— 实测死亡后 264 帧仍在刷 `spike`。
     · `dormant`：沉睡（含尚未激活）。除了不刷，还要**清掉在飞的弹幕与激光**，
       否则"BOSS 已经闭眼变透明了，头顶还挂着它之前吐的一片弹幕"。
   ★激光一并清★：`kind==='laser'` 的弹幕无论处于预警段(`_phase=0`)还是实体段，
   owner 都是 `'boss'`，`_bossClearShots` 天然覆盖，不会残留红色虚线或光柱。 */
function updateBoss(dt){
  var b=Play.boss;
  if(!b)return;
  b._anim=(b._anim||0)+dt;
  b._hurtFlash=Math.max(0,(b._hurtFlash||0)-dt);
  b._barFlash=Math.max(0,(b._barFlash||0)-dt);
  b._mouth=Math.max(0,(b._mouth||0)-dt*3.2);
  /* ★可见度渐变★（用户原话「苏醒前几乎透明，苏醒时慢慢过渡到完全不透明」）
     · 目标：`dormant` ⇒ 0.10（几乎看不见）；`awake`/`dead` ⇒ 1.0。
     · 实测速率（dt=1/60、乘子 3.0）：
         苏醒 0.10→0.99 约 **1.5 s**，完全贴到 1.0 约 2.0 s（lab W15 实测 1.98s）；
         沉睡回落 1.0→0.10 约 2.9 s（更慢，像"重新闭上眼"）。
       ⇒ 满足"慢慢过渡"，又不会慢到玩家以为没变化。
     · ★只在状态切换时改目标★：`_vis` 是**状态量**，渲染直接读它 ⇒
       死亡淡出（`drawBossTo` 里的 `1-dp*0.95`）与苏醒淡入相乘叠加，互不干扰。 */
  var visTarget=(b.state==='dormant')?0.10:1.0;
  var visRate=(b.state==='dormant')?0.70:1.00;
  if(b._vis===undefined)b._vis=visTarget;
  var vd=visTarget-b._vis;
  if(Math.abs(vd)<0.002)b._vis=visTarget;
  else b._vis+=vd*Math.min(1,dt*visRate*3.0);
  if(b.state==='dead'){
    b._deathT=(b._deathT||0)+dt;
    b._barFade=Math.max(0,(b._barFade||0)-dt*0.7);
    _bossClearShots();                                /* 死亡 ⇒ 已刷出的一律立即消失 */
    if(b._deathT>=b._deathTime)b.state='gone';
    return;
  }
  /* ★`gone`：彻底消散 ⇒ 永久止攻★（见函数头注释：旧版缺此分支导致死后继续刷弹幕）。
     ★不 splice 掉 `Play.boss`★：`_bossDoorPassable` / `drawBossHpBar` / 存档回放
     都以 `Play.boss` 是否存在为真源，直接置 null 会让"门"在死亡后瞬间卡住。
     保持一个 `state='gone'` 的空壳，绘制侧（`drawBossTo` 首行）与血条（只认 awake/dead）
     天然跳过它。 */
  if(b.state==='gone'){
    _bossClearShots();
    b._barFade=Math.max(0,(b._barFade||0)-dt*0.7);
    return;
  }
  var p=Play.player;
  var alive=p&&!p.dead;
  var pcx=p?(p.x+p.w/2):0, pcy=p?(p.y+p.h/2):0;
  var bcx=b.x+b.w/2, bcy=b.y+b.h/2;
  var dx=pcx-bcx, dy=pcy-bcy;
  var dist=Math.sqrt(dx*dx+dy*dy);
  /* ---- 激活 / 沉睡 ---- */
  if(b.state==='dormant'){
    if(alive&&dist<b.activeRadius){
      b.state='awake';b._seed=Math.floor((_simTime()*1000))%100000;
      /* ★专属音效 + BGM 切换★：激活那一刻长吼一声，并把关卡 BGM 换成 BOSS 主题。
         `_pbossBgm(true)` 是幂等的，重复激活不会重起曲子。 */
      _psfx('bossAwake', bcx, bcy);
      _pbossBgm(true);
      b.waveIdx=0;b.phase='firing';b._t=0;b._spawned=0;b._sleepT=0;
      Play.screenShake=Math.max(Play.screenShake||0,7);
      for(var k=0;k<26;k++){
        var a=Math.random()*Math.PI*2;
        Play.particles.push(mkParticle(bcx,b.cy||bcy,Math.cos(a)*2.2,Math.sin(a)*2.2-1,900,255,90,70));
      }
      if(typeof toast==='function')toast('★ 恶魔苏醒 ★');
      if(typeof AudioSystem!=='undefined'&&AudioSystem)AudioSystem.sfx('explosion',bcx,bcy);
      return;
    }
    /* ★沉睡中：也必须立即止攻★（用户原话「boss死亡或者**沉睡**后弹幕和激光攻击
       都应该立即停止刷新」）。注意这里**不是**只靠上面的 `return` ——
       沉睡是"从 awake 落回"的状态，此前已经吐出的弹幕/激光仍在 `Play.bullets` 里飞；
       若不在这里清，玩家会看到"BOSS 已闭眼变透明，头顶还挂着它吐的一片弹幕"。
       ★与"出摄像机销毁"的分工★：那条只保证弹幕**飞出视野后**消失（有延迟），
       这条保证"沉睡那一刻"立即消失 —— 二者互补，都要有。 */
    _bossClearShots();
    return;
  }
  /* ---- awake ---- */
  b._barFade=Math.min(1,(b._barFade||0)+dt*1.6);
  if(!alive||dist>b.activeRadius*1.6){
    b._sleepT=(b._sleepT||0)+dt;
    if(alive&&dist<b.activeRadius)b._sleepT=0;
    if(b._sleepT>=b.sleepDelay){
      b.state='dormant';b._sleepT=0;b.phase='idle';
      b._barFade=0;
      /* ★沉睡 → 一声低沉的「合眼」，并把 BGM 切回关卡主题★ */
      _psfx('bossSleep', bcx, bcy);
      _pbossBgm(false);
      return;
    }
  }else{
    b._sleepT=0;
  }
  var waves=b.waves||[];
  if(!waves.length)return;
  if(b.waveIdx>=waves.length)b.waveIdx=0;             /* ★全部波次打完 ⇒ 从第一波重来★ */
  var wv=waves[b.waveIdx];
  var total=_bossWaveTotal(b,wv);                     /* 密度倍率后的实际总数 */
  b._t=(b._t||0)+dt;
  if(b.phase==='firing'){
    if(b._t>=0.6&&((b._t-0.6)/(wv.time||10))*total>(b._spawned||0)){
      /* 一次补足本帧应生成的数量（帧率无关） */
      var want=Math.floor(((b._t-0.6)/(wv.time||10))*total);
      var n=Math.min(total-(b._spawned||0),Math.max(1,want-(b._spawned||0)));
      for(var si=0;si<n;si++){
        _bossSpawnShot(b,wv,(b._spawned||0)+si,p);
      }
      b._spawned=(b._spawned||0)+n;
      b._mouth=1;                                    /* 张口（表现）*/
      _psfx('bossSpit', b.x+b.w/2, b.y+b.h*0.42);    /* 吐弹音（每帧补弹只响一次） */
      Play.screenShake=Math.max(Play.screenShake||0,1.2);
    }
    if(b._t>=0.6+(wv.time||10)){
      b.phase='pause';b._t=0;
      b._pauseTime=b.wavePauseMin+_bossRand(b,77)*(b.wavePauseMax-b.wavePauseMin);
      _bossDropHeart(b,p);
    }
    return;
  }
  if(b.phase==='pause'){
    if(b._t>=(b._pauseTime||6)){
      b.waveIdx++;
      if(b.waveIdx>=waves.length)b.waveIdx=0;        /* ★循环★ */
      b.phase='firing';b._t=0;b._spawned=0;
      /* ★每波开始：一声咆哮★（用户原话「boss 每个波次开始时都要有咆哮的音效」）。
         放在「真正进入 firing」那一帧 ⇒ 不会因为暂停期间的重复判定而连响。 */
      _psfx('bossRoar', b.x+b.w/2, b.y+b.h/2);
      Play.screenShake=Math.max(Play.screenShake||0,2.4);
    }
    return;
  }
  /* idle：立刻开波（苏醒后的第一波同样要给一声咆哮） */
  b.phase='firing';b._t=0;b._spawned=0;
  _psfx('bossRoar', b.x+b.w/2, b.y+b.h/2);
}

/* ★弹幕生成（可配难度 + 保证可通关）★
   ★精准度★（用户原话「BOSS 的攻击应该更精准围绕玩家一点，现在经常打得子弹离玩家
   非常远」）：旧实现 `sx=viewW*(0.06+0.88*r)` 是**全屏均匀散布**，只有安全缝避开
   玩家 —— 于是绝大多数弹幕落在玩家不可能到达的屏幕角落，观感就是"乱打"。
   现在改为「以玩家屏幕 x 为**分布中心**」：由 `aim` 决定聚拢紧密度，
   `aim=1` ⇒ 退化成旧的全屏均匀（向后兼容），`aim→0` ⇒ 全部压在玩家正上方。
   ★安全走廊硬保证★（不能被精准度削弱）：每条弹幕刷出时，先算玩家当前 x（换到
   屏幕坐标），在 `[px-safeGap, px+safeGap]` 内**不生成**任何弹幕 ⇒ 玩家脚下永远
   有一条缝。`safeGap = max(playerW*2.6, viewW*0.075) * wv.safeGapMul`，有下限
   ⇒ 不可能被封死；再叠加 `densityMul` 拉满密度也依然有缝（安全缝是与密度无关的
   **空间**约束，只与 safeGap 有关）。
   ★抽签顺序★：kind 用 `k*3.1`、x 用 `k*5.7+tryN` —— 与旧实现保持一致，
   避免"改了散布后同 seed 的弹幕种类也变了"（lab 的确定性用例依赖此顺序）。 */
function _bossSpawnShot(b,wv,k,p){
  var cam=Play.cam;
  if(!cam)return;
  var viewW=cam.viewW, viewH=cam.viewH;
  var safeGap=Math.max(8*2.6,viewW*0.075)*(wv.safeGapMul!==undefined?wv.safeGapMul:1);
  /* 玩家在屏幕坐标里的 x */
  var px=p?(p.x+p.w/2-cam.x):(viewW/2);
  var kinds=wv.kinds||['spike'];
  var kind=kinds[Math.floor(_bossRand(b,k*3.1)*kinds.length)%kinds.length];
  /* ★瞄准聚拢★：`aim` 越小，采样区间越窄、越贴玩家。
     逐波 `aimMul` 与全局 `b._aMul` 相乘。
     ★采样半宽的下限是「安全缝 × 1.35」而不是某个绝对像素★：
     若半宽 < safeGap，则**所有**采样点都落在安全缝里 ⇒ 24 次全部失败 ⇒
     退化到"强制推到缝外同一侧"的兜底分支 ⇒ 弹幕挤成一条线（这既不是
     "精准"也不是"弹幕"，是坏掉）。下限保证"威胁确实落在玩家左右两侧
     不远处"，而上限由 `aim=1` 给到接近全屏（向后兼容旧行为）。 */
  var aim=(wv.aimMul!==undefined?wv.aimMul:1)*((b._aMul!==undefined)?b._aMul:1);
  if(aim<0.12)aim=0.12;
  var half=Math.max(safeGap*1.35,viewW*0.44*aim);
  /* 采样：最多 24 次找一个不在安全缝里的 x */
  var sx=0,ok=false;
  var safeW=safeGap;
  for(var tryN=0;tryN<24;tryN++){
    var u=(_bossRand(b,k*5.7+tryN*1.3)-0.5)*2;            /* −1..1 */
    sx=px+u*half;
    /* 夹进视口内侧（留一点边距，避免刚好贴着屏幕边缘生成） */
    var lo=viewW*0.06, hi=viewW*0.94;
    if(sx<lo)sx=lo; else if(sx>hi)sx=hi;
    if(Math.abs(sx-px)>safeW){ok=true;break;}
  }
  if(!ok){
    /* 24 次都在缝里 ⇒ 强制推到缝外（左或右，取更近的一侧）*/
    sx=(px>viewW/2)?Math.max(viewW*0.04,px-safeW-6):Math.min(viewW*0.96,px+safeW+6);
  }
  var wx=cam.x+sx;                                   /* 换回世界坐标 */
  var wy=cam.y-14;
  var speedMul=wv.speedMul||1;
  var wsp=wx;
  if(kind==='laser'){
    Play.bullets.push({
      kind:'laser',x:wsp-2,y:wy,w:4,h:viewH+120,
      vx:0,vy:0,life:6,_t:0,_phase:0,_anim:0,owner:'boss',_ph:_bossRand(b,k)*6.28
    });
    /* 激光也从嘴里"诞生"再落到顶部（表现）*/
    _bossMouthFlash(b);
    return;
  }
  var vy=(kind==='fireball')?(3.0*speedMul):(3.6*speedMul);
  var vx=(kind==='fireball')?((_bossRand(b,k*9.3)-0.5)*0.9):0;
  Play.bullets.push({
    kind:kind,x:wsp-2,y:wy,w:(kind==='fireball')?5:3,h:(kind==='fireball')?5:8,
    vx:vx,vy:vy,life:6,_anim:0,owner:'boss',
    _ph:_bossRand(b,k*2.7)*6.283
  });
  _bossMouthFlash(b);
}
function _bossMouthFlash(b){
  /* ★"吐出"演出★：弹幕其实是在摄像机顶部成形的（用户要求"从摄像机顶部刷出"），
     所以这里不做"口中飞出的实体"，而是从嘴部沿"向上"方向喷一道短促的粒子流
     —— 视觉上读作"它把东西吐上去"，但**不产生任何半路命中的不公平弹体**。 */
  var mx=b.x+b.w/2, my=b.y+b.h*0.42;
  for(var i=0;i<4;i++){
    var a=-Math.PI/2+(Math.random()-0.5)*0.9;
    Play.particles.push(mkParticle(mx,my,Math.cos(a)*1.4,Math.sin(a)*1.4,320,255,140,70));
  }
  Play.particles.push(mkParticle(mx,my,0,-0.4,180,255,220,160));
}

/* ★波次结束掉生命心到"玩家身边最近的可到达平台"★
   算法：遍历地形实体，取「顶面可站立（顶面在玩家脚下方附近或上方）」且
   「与玩家水平/垂直距离最小」的平台，取其顶部中点作为掉落点。
   找不到平台 ⇒ 退化为玩家当前位置正上方 40px（仍会落下，玩家能接到）。 */
function _bossDropHeart(b,p){
  var cam=Play.cam;
  if(!Play._bossHearts)Play._bossHearts=[];
  var hx,hy;
  if(!p){hx=b.x+b.w/2;hy=b.y+b.h+40;}
  else{
    var best=null,bestD=Infinity;
    var cands=Play.platforms.concat(Play.movables,Play.breakables,Play.iceBlocks);
    for(var i=0;i<cands.length;i++){
      var pl=cands[i];
      if(!pl||pl.broken)continue;
      var cx2=pl.x+pl.w/2, topY=pl.y;
      /* 只考虑"能站上去"的：顶面不能高于玩家头顶太多 */
      if(topY<p.y-40)continue;
      var ddx2=(cx2-(p.x+p.w/2));
      var ddy2=(topY-(p.y+p.h));
      var d2=ddx2*ddx2+ddy2*ddy2*0.35;              /* 垂直差异权重低一些（就近落脚） */
      if(d2<bestD){bestD=d2;best={x:cx2,y:topY-10};}
    }
    if(best){hx=best.x-4;hy=best.y;}
    else{hx=p.x;hy=p.y-40;}
  }
  var heart={x:hx,y:hy,w:8,h:8,_drop:true,_dropT:0,_fromY:hy-64};
  Play.hearts.push(heart);
  Play._bossHearts.push(heart);
  if(cam){
    Play.particles.push(mkParticle(hx+4,hy+4,0,-1.2,700,255,80,120));
  }
}

/* ★BOSS 受爆伤害★：由 triggerExplosion 调用（见该函数尾部新增的钩子）。
   口径按用户原话：「在boss旁边爆炸1px就造成1点伤害」。 */
function damageBossAt(x,y,source){
  var b=Play.boss;
  if(!b)return false;
  if(b.state!=='awake')return false;                 /* 沉睡/死亡时打不动（防作弊） */
  var r=b.damageRadius||40;
  var bcx=b.x+b.w/2, bcy=b.y+b.h*0.42;
  var dx=x-bcx, dy=y-bcy;
  /* 用矩形最近点距离：BOSS 巨大，"旁边 1px" 指贴到它的包围盒边缘 */
  var rx=Math.max(b.x,Math.min(x,b.x+b.w));
  var ry=Math.max(b.y,Math.min(y,b.y+b.h));
  var ddx=x-rx, ddy=y-ry;
  var d2=ddx*ddx+ddy*ddy;
  if(d2>r*r)return false;
  b.hp-=1;
  b._hurtFlash=0.25;b._barFlash=0.3;
  Play.screenShake=Math.max(Play.screenShake||0,6);
  if(typeof AudioSystem!=='undefined'&&AudioSystem)AudioSystem.sfx('explosion',bcx,bcy);
  for(var i=0;i<16;i++){
    var a=Math.random()*Math.PI*2;
    var s=1.2+Math.random()*2.4;
    Play.particles.push(mkParticle(rx,ry,Math.cos(a)*s,Math.sin(a)*s-0.8,520,255,120,90));
  }
  _psfx('bossHit', rx, ry);                          /* 被击中的实心反馈 */
  if(typeof toast==='function')toast('命中恶魔！剩余 '+Math.max(0,b.hp)+' HP');
  if(b.hp<=0){
    b.hp=0;b.state='dead';b._deathT=0;
    /* ★死亡 → 崩解长音 + BGM 交还给关卡★（`_pbossBgm(false)` 幂等，
       即便同时被沉睡/激活反复调用也只会切一次） */
    _psfx('bossDeath', b.x+b.w/2, b.y+b.h/2);
    _pbossBgm(false);
    Play.bullets=[];                                  /* 死亡 ⇒ 弹幕全清 */
    Play.screenShake=Math.max(Play.screenShake||0,10);
    for(var k=0;k<40;k++){
      var ak=Math.random()*Math.PI*2;
      var sk2=1.5+Math.random()*3;
      Play.particles.push(mkParticle(bcx,bcy,Math.cos(ak)*sk2,Math.sin(ak)*sk2-1.4,1200,255,90,70));
    }
    if(typeof toast==='function')toast('★ 恶魔已被击败 ★');
  }
  return true;
}

/* ★生命心掉落演出★：给 `_bossHearts` 里带 `_drop` 的心做抛物线落下 + 落地弹跳。
   `_fromY` = 出生高度（落点上方 64px），`_targetY` = 落点。
   在 updatePlay 的粒子段之后调用（纯表现，但必须推进，否则心会卡在半空）。 */
function updateBossHearts(dt){
  if(!Play._bossHearts||!Play._bossHearts.length)return;
  for(var i=Play._bossHearts.length-1;i>=0;i--){
    var h=Play._bossHearts[i];
    /* ★已被拾取★：既有的拾取循环会把它从 `Play.hearts` splice 掉，
       这里只需把悬空引用一起清掉（否则会一直做无意义的弹跳计算）。 */
    if(Play.hearts.indexOf(h)<0){Play._bossHearts.splice(i,1);continue;}
    if(!h._drop)continue;
    if(h._targetY===undefined)h._targetY=h.y;
    h._dropT=(h._dropT||0)+dt;
    var T=0.55;                                       /* 自由落体段 */
    if(h._dropT<T){
      var t=h._dropT/T;
      var ease=t*t;                                   /* 加速下落 */
      h.y=h._fromY+(h._targetY-h._fromY)*ease;
    }else{
      var bt=h._dropT-T;                              /* 落地后衰减弹跳 */
      if(bt>0.9){h._drop=false;h.y=h._targetY;continue;}
      h.y=h._targetY-Math.abs(Math.sin(bt*7.5))*Math.max(0,3.4-bt*4.2);
    }
  }
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
  /* ★野兽的惊吓动作必须在死亡动画期间也推进★：
     爆炸正是发生在"玩家死亡"这一刻，若只在存活分支更新，
     野兽会卡在 `scared` 第一帧、永远走不到 `gone`。 */
  updateBeasts(dt);
  /* ★巨花枯萎 / 火扑灭同理：都必须在死亡动画期间也推进★
     触发源是幽灵（它在死亡动画期间照常回放），若只在存活分支更新，
     枯萎/扑灭动作会卡在第一帧。 */
  updateFlowers(dt);
  updateFires(dt);
  /* ★怪物与 BOSS★：全部放在 `if(Play.deathAnim…)` **之前** ⇒ 死亡动画期间照常推进。
     理由（逐条，与上面野兽/巨花/火同构）：
       · graves   —— 玩家幽灵会触发墓碑（幽灵在死亡动画期间照常回放）；
       · foes     —— 鬼魂要与幽灵做"接触即死"判定；火团怪要继续游荡；
       · bullets  —— 已发射的弹幕必须继续飞，否则死亡瞬间全场弹幕"冻结"；
       · boss     —— 血条淡入淡出 / 波次计时 / 沉睡计时不该因玩家死亡而冻结。
     ★地形快照必须在最前面失效★：`resolveSolids()` 复用 `_worldSolidsCache`，
     每帧置 null ⇒ 本帧首次取用时重建一次，帧内全体怪物共享（避免 N·M 遍历）。 */
  Play._worldSolidsCache=null;
  updateGraves(dt);
  updateFoes(dt);
  updateFireSpawners(dt);
  updateBullets(dt);
  updateSkeletons(dt);
  updateBossDoors(dt);
  updateBoss(dt);
  updateBossHearts(dt);

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
  /* 泡沫砖：**平时是实体**（当墙挡玩家），只有被打上 `_pass` 闩锁
     （正在骑幽灵向上穿行）的那一块临时不参与碰撞。 */
  Play.foams.forEach(function(f){if(!f._pass)allSolids.push(f);});
  /* ★野兽★：只有 `sleep` 状态是实心的（睡觉挡路）；`scared`（正在跑走）
     与 `gone`（已移除）都不再参与碰撞，玩家可以立刻穿过它原来的位置。 */
  Play.beasts.forEach(function(bs){if(bs.state==='sleep')allSolids.push(bs);});
  /* ★巨花★：bloom / withering 期间都是实心（同时挡玩家）——枯萎动作播完才放行。
     与野兽不同，巨花的"挡路"是它**全部**的阻挡语义，所以只要没 gone 就 push。 */
  Play.flowers.forEach(function(fl){if(fl.state!=='gone')allSolids.push(fl);});
  /* ★BOSS 门★：与普通门同语义 —— 关着才挡路（BOSS 醒来时关、死亡/未激活时开）。 */
  Play.bossDoors.forEach(function(bd){if(!_bossDoorPassable(bd))allSolids.push(bd);});
  /* ★墓碑★：**不**进 allSolids（装饰+触发器，绝不挡路，与旗杆同策略）。
     ★骷髅怪★：**不**进 allSolids（"碰到死"而非"被挡住"；否则玩家无法跳上头顶踩死）。
     ★小怪/BOSS★：全部不进（它们是动态危险物，不是地形）。 */
  /* ★火★：**不**进 allSolids —— 与荆棘一样是"碰到死"而不是"被挡住"（非固体）。 */
  /* ★旗杆★：**不**进 allSolids —— 它是标记物，玩家经过即激活，绝不能挡路。 */
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
    if(Math.abs(dx)<5&&Math.abs(dy)<5){
      /* 逐轴预检后再搬：旧实现直接 p.x+=dx;p.y+=dy，不看实体，
         会把玩家顶进墙/天花板内部；而 stepPlayerPhysics 的水平求解器是
         "按最近边吸附"，嵌入宽实体时最近边可能在远端 → 单帧瞬移几百像素（反常识）。
         这里被挡的那个轴不搬：骑手会沿墙自然滑动（像合格的移动平台），
         从源头杜绝"嵌入"，也就永远不会触发那条反常识的弹出。
         正常骑乘（不与实体重叠）行为与旧版逐字一致。 */
      if(!solidBlocksAt(p,p.x+dx,p.y,allSolids))p.x+=dx;
      if(!solidBlocksAt(p,p.x,p.y+dy,allSolids))p.y+=dy;
    }
  }
  /* ★泡沫砖解闩★：`_pass` 只是"本次穿行"的临时通行证，必须及时失效，
     否则泡沫砖会永久变成空气（退化成完全不存在）。

     ★为什么不能用 `!p.onGhost` 直接解闩★
     闩锁是**拒绝吸附那一帧**打上的（collideGhost 返回 false），
     而那一帧 p.onGhost 恰好是 null（刚被清空、还没重新写上）
     ⇒ 若用 onGhost 判据，闩锁会在打上的同一帧被立刻撤掉，等于没打。
     （这是实测踩到的坑：A 用例一直 FAIL。）

     ★为什么不能用 `(p.y+p.h)<=_fTop` 这种裸浮点比较★
     实测（`_foam_latch.cjs`）：玩家贴住砖底那一帧 p.y+8 = 80.0000000000003、
     砖顶 = 80，差 3e-13 就判成"还没穿出" ⇒ 闩锁白白多留一帧、`_pass` 残留为 1。
     位置是逐帧 `+0.8` 累加出来的，误差必然存在 ⇒ 比较必须带容差 FOAM_REL。

     ★判据 = 「按本次穿行方向穿出」或个人「已远离砖体 >12px」★
     闩锁是方向性的（`_passDir`）：向上穿的砖，只有玩家整体绕到砖**上方**才算穿完。
     多加一条 `_far` 兜底，覆盖"中途放弃/被弹出/死亡重生"等没按原方向走完的情形。
     两条都要求"玩家与砖已无重叠"，所以泡沫砖恢复成实体时绝不会把玩家卡在里面。 */
  if(Play.foams&&Play.foams.length){
    for(var _fi=0;_fi<Play.foams.length;_fi++){
      var _fo=Play.foams[_fi];
      if(!_fo._pass)continue;
      var _fTop=_fo.y, _fBot=_fo.y+(_fo.h||8);
      var _passedUp=(p.y+p.h)<=_fTop+FOAM_REL;     /* 已整体绕到砖上方 */
      var _passedDown=p.y>=_fBot-FOAM_REL;         /* 已整体绕到砖下方 */
      var _cleared=(_fo._passDir>0)?_passedUp:_passedDown;
      var _far=(p.y>_fBot+12)||((p.y+p.h)<_fTop-12);
      if(_cleared||_far)_fo._pass=0;
    }
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
  // ---- 慢放能量状态机：每帧只在**这里**更新一次 ----
  //   规则（对应手感需求）：
  //    · 按住且未触底 → 消耗能量（幽灵减速）；按住期间**绝不回涨**。
  //    · 触底（能量=0）→ 进入「一次性慢慢涨满」的锁定态：
  //        期间即使按住也不再消耗、**回涨也不会被打断**（松开或按住都一样涨）；
  //        必须**回满一次**才解除锁定，其间幽灵恢复基准速（不再减速）。
  //        （修复旧版：能量在 0 附近反复回涨/消耗 → “条空了还在减速”；
  //          以及点按会打断回涨的问题。）
  //    · 未触底的普通回涨：只有**松开按键**才回涨，且可被再次按下**随时打断**。
  //    · 触底回涨期间进度条为黄色；回满后黄色**缓慢渐变**回原本的绿色。
  {
    var REFILL_FULL = 1.6;   /* 触底后“一次性慢慢涨满”所需秒数 */
    var holdJ = !!Play.keys['KeyJ'];
    if (Play.slowLocked) {
      /* —— 触底后的强制回涨：一次性、不可打断、按住也不消耗 —— */
      Play.slowActive = false;
      Play.energy = Math.min(1, Play.energy + dt * (1 / REFILL_FULL));
      Play.slowRefill = Math.max(0, Play.slowRefill - dt);
      if (Play.energy >= 1) { Play.slowLocked = false; Play.slowRefill = 0; }
    } else if (holdJ && Play.energy > 0) {
      /* —— 正常减速：按住且未触底 → 消耗 —— */
      Play.slowActive = true;
      Play.energy = Math.max(0, Play.energy - dt * (1 / 4));      /* ≈4s 耗尽 */
      if (Play.energy <= 0) { Play.slowLocked = true; Play.slowRefill = REFILL_FULL; Play.slowWarn = 1; Play.slowActive = false; }
    } else {
      /* —— 空闲 / 未触底普通回涨（仅松开时；可被打断） —— */
      Play.slowActive = false;
      if (!holdJ) Play.energy = Math.min(1, Play.energy + dt * (1 / 1.5));  /* ≈1.5s 回满 */
    }
    /* 触底回满后：黄色缓慢渐变为绿色（约 1.2s） */
    if (!Play.slowLocked) Play.slowWarn = Math.max(0, Play.slowWarn - dt * 0.85);
  }
  // 幽灵更新（仅已释放的）
  for(var gi=0;gi<Play.ghosts.length;gi++){
    var gh=Play.ghosts[gi];
    if(!gh.released)continue;
    gh.update();
    if(gh._pendingExplosion){
      gh._pendingExplosion=false;
      /* ★传送门★：爆炸点必须跟着位移 —— 否则会出现"幽灵在出口、爆炸在入口"的分叉。
         用**_tpEndOx**（走完轨迹时的累计位移）而不是回绕后已清零的 _tpOx。 */
      triggerExplosion(gh._explosionX+4+(gh._tpEndOx||0),gh._explosionY+4+(gh._tpEndOy||0),'ghost');
    }
    /* === 幽灵带水（ghostWet）=== 与"火"成对，必须在同一段里一次改对 ★
       ① 经过水 → 补满（wet = wetMax）
       ② 否则按**世界行进距离**衰减
       ③ 带水时靠近火 → 触发扑灭（火的状态由 updateFires 推进到"移除"） */
    var gcx=gh.x+4, gcy=gh.y+4;
    var _inWater=false;
    for(var wi=0;wi<Play.waters.length;wi++){
      if(rectsOverlap({x:gh.x,y:gh.y,w:8,h:8},Play.waters[wi])){_inWater=true;break;}
    }
    /* ★衰减口径（必须与 sampleStride 无关）★
       _dProgress 是"本帧推进了多少**轨迹索引**"。但抽稀后 1 个索引代表
       sampleStride 个录制帧（世界位移也放大 sampleStride 倍）⇒
       直接乘 _dProgress 会让抽稀过的轨迹**少扣 stride 倍**、半路都干不了。
       乘回 sampleStride 后：
         dProgress×sampleStride = speed = baseSpeed×_speedMul
       与 stride 无关，且正比于幽灵的**世界速度** ⇒ 单位世界距离耗水恒定。
       _WET_DRAIN_PER_STEP=1/400：满水可支撑 400 个"索引步"。按规划文档的
       标定（一条 120 点轨迹单程 L=119，应耗约 0.3 水量）⇒ 1/400×119≈0.30，
       即满水约能跑 3.3 个来回 ⇒ 足够让幽灵带水穿过大半张关卡去灭火。 */
    var _WET_DRAIN_PER_STEP=1/400;
    if(_inWater){
      gh.wet=gh.wetMax;          /* 泡在水里 = 满水（且本帧不扣，避免"补满即扣空"） */
    }else if(gh.wet>0){
      gh.wet=Math.max(0,gh.wet-(gh._dProgress||0)*(gh.sampleStride||1)*_WET_DRAIN_PER_STEP);
    }
    /* ★灭火★：只有"带水"的幽灵才熄火（用户明确：干幽灵经过火 → 火不变）。
       进入 douseRadius 即把火置为 dousing；水不额外扣除（一次扑灭即够），
       这避免"水不够 → 火灭到一半"这种难以理解的中间态。 */
    if(gh.wet>0){
      for(var fi=0;fi<Play.fires.length;fi++){
        var fr=Play.fires[fi];
        if(fr.state!=='burning')continue;
        var fcx=fr.x+(fr.w||8)/2, fcy=fr.y+(fr.h||8)/2;
        var fdx=fcx-gcx, fdy=fcy-gcy;
        var fr2=fr.douseRadius||24;
        if(fdx*fdx+fdy*fdy<fr2*fr2){
          fr.state='dousing';fr._t=0;fr._wetFromX=gcx;fr._wetFromY=gcy;
          /* ★纯表现★：接触点爆出蒸汽+火星（不进任何判定分支） */
          _spawnDouseSteam(fcx,fcy);
        }
      }
    }
    /* ★小怪与「玩家幽灵」的接触判定★（用户两条原话的落地点）
       · 鬼魂：「只要与玩家的幽灵接触就会立即死亡」—— 是**鬼魂**死（幽灵不死）。
         ⇒ 与玩家幽灵同归于尽式的"幽灵是消耗品"不符；这里只让鬼魂消失，
           幽灵继续按轨迹回放（幽灵本来就是不可摧毁的回放数据）。
       · 火团怪：「触碰携带水的玩家幽灵即死」—— 只有带水（`wet>0`）才算。
         干幽灵穿过火团怪**完全无效**（反向用例，防空洞）。
       ★为什么放在幽灵循环内★：这是"幽灵 × 小怪"的笛卡尔积，只有这里拿得到
       `gh` 的世界坐标与 `wet`。怪数 <20、幽灵 ≤4 ⇒ 每帧最多 80 次 AABB，可忽略。 */
    if(Play.foes&&Play.foes.length){
      var ghBox={x:gh.x,y:gh.y,w:8,h:8};
      for(var _fk=Play.foes.length-1;_fk>=0;_fk--){
        var _fo3=Play.foes[_fk];
        if(_fo3.state==='dying')continue;
        if(!rectsOverlap(ghBox,_fo3))continue;
        if(_fo3.kind==='ghost'){
          _fo3.state='dying';_fo3._anim=0;
          _psfx('foeGhostDie',_fo3.x+_fo3.w/2,_fo3.y+_fo3.h/2);
        }else if(_fo3.kind==='fireball'&&gh.wet>0){
          _fo3.state='dying';_fo3._anim=0;
          _psfx('foeFireDie',_fo3.x+_fo3.w/2,_fo3.y+_fo3.h/2);
          /* 带水幽灵扑灭火团怪：一小团白烟（复用既有的扑灭蒸汽语言） */
          _spawnDouseSteam(_fo3.x+4,_fo3.y+4);
        }
      }
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
  /* ---- 轨迹录制（幽灵回放的数据源）----
     旧实现：每帧 push 一点，超过 1500 点就 shift() 丢弃**最早**的点。
     遍历顺序是 trajectory[0]（最早）→ 末尾（死亡时刻），所以 shift() 砍掉的开头
     正是幽灵轨迹的起点 —— 玩家走远路（一关 2162~10810 帧，远超 1500）时开头必然被裁掉，
     死亡后生成的幽灵就从半路开始播放。这就是"走得比较远时幽灵轨迹缺开头"的根因。

     现行两条规则：
     ① **静止垃圾时间压缩**（用户要求）：玩家原地不动属于无意义的占用，
        连续静止超过 STILL_KEEP 帧后就不再逐帧记录 —— 轨迹里只留"进入静止的那一点"
        与"恢复运动的那一点"，中间的空档由幽灵在这两点间平滑掠过（两点重合或极近，
        观感上就是幽灵在原地停留了一下）。既省配额，也让轨迹更干净。
     ② **超限抽稀（安全版）**：点数超 TRAJ_CAP 时整段抽稀一半（首尾都保留），
        并把每个索引代表的帧数按实际压缩比放大（见下方注释）。
        关键：抽稀会拉大相邻采样点间距，而幽灵回放是**相邻两点间线性插值**的，
        一旦某个新段变成横穿实体的直线，幽灵就会"直接穿墙飞过去"——
        这正是长时间录制（数小时静止把配额撑爆）后暴露的问题。
        所以抽稀改走 `decimateTrajectory`：凡横穿实体的新段就把被丢弃的原点补回来。 */
  var TRAJ_CAP=12000;          /* 配额：静止压缩后足够长，正常一关远远用不到 */
  var STILL_KEEP=300;          /* 静止垃圾时间：最多保留 5s（300 帧 @60fps） */
  /* "在动"判定阈值。取值必须**小于一个正常的行走步长**（maxWalkSpeed=1.85px/帧），
     这样玩家一起步就在第 1 帧被判定为在动、轨迹立刻续上，接缝长度 ≤ 一个正常步长
     → 幽灵回放时那一段与普通段无法区分（真正"看不出兜底"）。
     若取大值（如 8px），一次起步会有 ~5 帧、约 9px 的真实位移被漏记，压缩成一段，
     幽灵会在此处以数倍速掠过 —— 这是肉眼可见的"抽一下"。
     取 1.5 仍远大于实测的静止抖动（50 个关卡全部为 **精确 0**，见 _diagjitter.cjs），
     因此绝不会把真静止误判成在动而让压缩失效。 */
  var STILL_DRIFT=1.5;
  /* 轨迹为空 = 新一次录制（开局或刚死亡重生）→ 采样状态整体复位。
     注意必须在这里复位，否则上一轮抽稀放大的 _trajStride 会残留，
     让新幽灵的轨迹一开始就是稀疏的。 */
  if(Play.trajectory.length===0){
    Play._trajStride=1;Play._trajTick=0;Play._stillFrames=0;
    Play._stillBaseX=p.x;Play._stillBaseY=p.y;Play._trajDecimAt=0;
  }
  /* 静止判定：只看"相对锚点的累计漂移是否达到 STILL_DRIFT"。
     单一条判据即可覆盖全部情形：
       · 正常行走/跳跃   → 起步第 1~2 帧漂移就超过 1.5px → 立刻算在动；
       · 骑幽灵被缓慢带动（0.2~0.8px/帧）→ 数帧内漂移也超过 1.5px → 算在动，
         绝不会被误判成静止而被截断（旧版正是栽在这种"慢速移动被当静止"上）；
       · 真的站着不动   → 漂移恒为 0（已实测 50 关全部精确为 0）→ 持续累加
         静止帧数，超过 5s 后停止记录。
     一旦判定在动，锚点重置到当前位置，静止计时从零开始。 */
  var _drift=Math.max(Math.abs(p.x-Play._stillBaseX),Math.abs(p.y-Play._stillBaseY));
  var _inMotion=(_drift>=STILL_DRIFT);
  if(_inMotion){Play._stillFrames=0;Play._stillBaseX=p.x;Play._stillBaseY=p.y;}
  else Play._stillFrames++;
  /* 静止超过 5s 后停止记录 —— 这段对幽灵回放毫无信息量，
     跳过它观感上完全不可见（前后两点位置相同，幽灵只是原地停留了一下）。 */
  var _allowRecord=_inMotion||Play._stillFrames<=STILL_KEEP;
  Play._trajTick++;
  /* 停录期间不让 tick 无限膨胀：恢复运动的那一帧应当立即记录。 */
  if(!_allowRecord&&Play._trajTick>Play._trajStride)Play._trajTick=Play._trajStride;
  if(_allowRecord&&Play._trajTick>=Play._trajStride){
    Play._trajTick=0;
    Play.trajectory.push({x:p.x,y:p.y});
    if(Play.trajectory.length>TRAJ_CAP&&Play.trajectory.length-Play._trajDecimAt>256){
      /* 目标压到 0.7×cap（留水位）：若只压到 cap，下一帧又立刻超限 →
         每帧都跑一次 O(n×实体数) 的抽稀，会造成周期性卡顿。压到水位以下
         后，需要再积累 0.3×cap 才会再次触发。 */
      var _target=Math.floor(TRAJ_CAP*0.7);
      var _thPrev=Play.trajectory;
      var _thOut=decimateTrajectory(_thPrev,allSolids,_target);
      var _nB=_thPrev.length,_nA=_thOut.length;
      /* 每个索引代表的帧数按"真实压缩比"放大：抽稀前后必须覆盖同样的总时长，
         即 nAfter * stride' = nBefore * stride → stride' = stride * nBefore/nAfter。
         贪心补点会让实际点数多于预期，若仍固定 ×2，幽灵在世界里会比玩家慢。 */
      if(_nA>0&&_nB>_nA){
        Play._trajStride*=(_nB/_nA);
        Play._trajStride=Math.max(1,Play._trajStride);
        Play.trajectory=_thOut;
      }
      /* 无论成功与否都记下这次尝试的位置：即使极罕见地"一点都压不动"，
         也只是继续追加（每 256 点才重试一次），不会退化成逐帧重算。 */
      Play._trajDecimAt=Play.trajectory.length;
    }
  }
  var inChamber=false;
  var chambers=LevelContext.levels[LevelContext.currentIdx].chambers;
  for(var ci=0;ci<chambers.length;ci++){
    var ch=chambers[ci];
    if(p.x+p.w>ch.x&&p.x<ch.x+ch.w&&p.y+p.h>ch.y&&p.y<ch.y+ch.h){inChamber=true;break;}
  }
  if(!inChamber){diePlay();return;}
  /* ★骷髅怪：眩晕期可踩顶踩死★
     ★为什么必须放在"碰到即死"之前★：同一帧里玩家与骷髅必然同时重叠
     （踩顶当然也算重叠），若先跑"碰到即死"，玩家会在踩到的一瞬间先被杀掉，
     永远不可能踩死它。所以踩死判定必须在**最前**，且命中后直接改状态、不 return
     （后续的"非眩晕碰到即死"会因为 state 已变 'dead' 而自然跳过）。
     ★判据与既有"踩碎易碎方块"同语言★：下落中 + 脚底压进顶边 <8px + 水平重叠。 */
  for(var _ski=0;_ski<Play.skeletons.length;_ski++){
    var _sk=Play.skeletons[_ski];
    if(_sk.state!=='stun')continue;
    var _falling=(p.gravityDir>0)?(p.vy>0):(p.vy<0);
    if(!_falling)continue;
    var _footY=(p.gravityDir>0)?(p.y+p.h):p.y;
    var _topY=(p.gravityDir>0)?_sk.y:(_sk.y+_sk.h);
    if(!(p.x+p.w>_sk.x+1&&p.x<_sk.x+_sk.w-1&&Math.abs(_footY-_topY)<8))continue;
    _sk.state='dead';_sk._t=0;
    _psfx('skelDie',_sk.x+_sk.w/2,_sk.y+_sk.h/2);   /* 骨堆崩塌 */
    p.vy=-6.5*p.gravityDir;                     /* 踩踏回弹（不受伤） */
    p.squashVY=0.5;
    Play.screenShake=Math.max(Play.screenShake||0,3);
    for(var _bk=0;_bk<16;_bk++){
      var _ba=Math.random()*Math.PI*2;
      Play.particles.push(mkParticle(_sk.x+_sk.w/2,_sk.y+_sk.h/2,Math.cos(_ba)*1.6,Math.sin(_ba)*1.6-1,700,232,232,240));
    }
    break;
  }
  for(var s=0;s<Play.spikes.length;s++)if(rectsOverlap(p,Play.spikes[s])){diePlay();return;}
  /* ★火★：常驻致命区域，与荆棘**完全对称**（重叠即死）。
     注意火**不**进 allSolids ⇒ 玩家不会"被火挡住"，而是"走进火里死掉"，
     这与用户原话「玩家走到有火的格子上就会死，机制上可能类似荆棘」一致。 */
  for(var _fs=0;_fs<Play.fires.length;_fs++)if(rectsOverlap(p,Play.fires[_fs])){diePlay();return;}
  /* ★骷髅怪（patrol / charge）★：碰到即死 —— 与荆棘/火**完全同一口径**。
     ★只有 `patrol` / `charge` 致命★：`stun`（眩晕，可踩死）与 `dead`（已被踩死）
     都**不**致命。这里必须**白名单**而不是 `state!=='stun'`：
     踩顶那一帧会把 state 改成 `'dead'`，若用黑名单，'dead' 恰好落进致命侧，
     玩家会在踩死它的同一帧被判死（实测 `playerDead=true`）—— 白名单天然规避。 */
  for(var _si=0;_si<Play.skeletons.length;_si++){
    var _skD=Play.skeletons[_si];
    if(_skD.state!=='patrol'&&_skD.state!=='charge')continue;
    if(rectsOverlap(p,_skD)){diePlay();return;}
  }
  /* ★苍白鬼魂 + 火团怪★：碰到即死（用户原话「只要与玩家的幽灵接触就会立即死亡」是反向的
     —— 见 updateFoes 里"鬼魂被幽灵撞死"；本段处理的是**鬼魂撞玩家**）。
     ★火团怪★：用户原话「玩家一旦碰到火焰怪就会被烧死」—— 与鬼魂**同一口径**：
     只要不是 `dying`（正在被水扑灭的动画里），碰到就死。
     ★为什么白名单是 `!=='dying'` 而骷髅用正向白名单★：骷髅有 `stun` 态需要
     "可踩不可杀"，火团怪没有可交互态（只能被水扑灭），所以"非 dying"就是全部活体。 */
  for(var _fi2=0;_fi2<Play.foes.length;_fi2++){
    var _fo2=Play.foes[_fi2];
    if(_fo2.state==='dying')continue;
    if(_fo2.kind==='ghost'&&rectsOverlap(p,_fo2)){diePlay();return;}
    if(_fo2.kind==='fireball'&&rectsOverlap(p,_fo2)){diePlay();return;}
  }
  /* ★弹幕★：命中即死扣 1 命。
     ★激光例外★：预警段（`_phase=0`，0.5s 的红色虚线）不致命 —— 那是给玩家的
     反应窗口，否则"看不见就死"违反可通关性要求。 */
  for(var _bl2=0;_bl2<Play.bullets.length;_bl2++){
    var _bl=Play.bullets[_bl2];
    if(_bl.kind==='laser'&&!_bl._phase)continue;
    if(rectsOverlap(p,_bl)){diePlay();return;}
  }
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


  /* ★生命心★：`Play.hearts` 同时承载"关卡里摆的心"与"BOSS 波次掉落的心"，
     二者语义完全一致（拾取 +1 命），所以不区分处理。 */
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
  /* ★旗杆：经过即激活★（不消耗库存）。放在这里与其它"重叠触发"标记物同一段，
     顺序无关紧要 —— 它只写 `Play.currentFlag`，不与上面的拾取共享任何状态。 */
  updateFlagPoles();
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
   'trophies','switches','switchDoors','waters','smokes','waterGrasses','foams','flagPoles','beasts','flowers','fires','portals',
   'graves','skeletons','foes','bullets','bossDoors','_bossHearts'
  ].forEach(function(k){Play[k]=[];});
  Play.boss=null;
  /* ★BOSS BGM 闩锁随重开复位★（与 `startPlay` 同形）：否则重开后闩锁仍是 true，
     而 BOSS 已回到 dormant ⇒ 关卡一开始就放 BOSS 曲、且再也切不回关卡曲
     （`_bugscan.cjs` 实证：afterRestart latch=true bossState='dormant'）。 */
  _pbossBgm(false);
  Play._bossBgmOn=false;
  Play._bossBgmLevel=lv;
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
      case 'foam':c._squash=0;Play.foams.push(c);break;
      /* ★旗杆★：无运行时 state —— "是否激活"直接就是 `Play.currentFlag===this`。
         `isPole` 标记用来把旗杆与"玩家自插的临时旗"区分开（拔旗守卫 + 不同的绘制形态）。 */
      case 'flagPole':c.isPole=true;Play.flagPoles.push(c);break;
      /* ★野兽★：sleep(睡觉挡路/实心) → scared(惊吓动作中/不挡) → gone(移除)。
         `_pass` 阶段完全由 updateBeasts 推进；`state='gone'` 时从数组 splice 掉。 */
      case 'beast':c.state='sleep';c._t=0;Play.beasts.push(c);break;
      /* ★巨花★：bloom(盛开/实心，同时挡玩家) → withering(_t 驱动的中间态) → gone(移除)。
         触发源只有幽灵（见 updateFlowers）：幽灵进入 triggerRadius 即开始枯萎。 */
      case 'flower':c.state='bloom';c._t=0;Play.flowers.push(c);break;
      /* ★火★：burning(常驻致命) → dousing(扑灭动画中) → 移除。
         与 flammable 零交叉（不蔓延/不被爆炸点燃/不自行熄灭），只有这两态。 */
      case 'fire':c.state='burning';c._t=0;Play.fires.push(c);break;
      /* ★传送门（v3）★：元素无 state、不进 allSolids（玩家必须能走过去）。 */
      case 'portal':Play.portals.push(c);break;
      case 'grave':c.state='idle';c._t=0;Play.graves.push(c);break;
      case 'skeleton':c.state='patrol';c._t=0;c._dir=1;c._homeX=c.x;c._anim=0;Play.skeletons.push(c);break;
      case 'boss':Play.boss=makeBoss(c);break;
      case 'bossDoor':c.open=true;c._openProgress=1;Play.bossDoors.push(c);break;
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
    // 把录制时的采样步长一并交给幽灵：抽稀过的轨迹回放要按同比例放慢索引推进
    var newGhost=new PlayGhost(compressed,Play.player.x,Play.player.y,Play.currentRespawnOrigin,wasSuicide,Play._trajStride);
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
  return((_simTime()+(d.phase||0))%period)<onT;
}

function bindPlayDrag(){
  /* 已停用：摄像机只跟随玩家，不允许拖动画面自由看场景。
     保留空函数，避免历史调用点报错。 */
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
  /* ★BOSS★：**场景级背景主体** —— 画在背景层之后、其余一切实体之前。
     它巨大（默认 160×120 世界像素），若画在平台之后会盖住地形；
     画在最前面又会有"穿模"错觉。置于此处 ⇒ 它像"从场景后方探出上半身"，
     与用户原话「只表现上半身」「始终停在原地」的观感一致。 */
  if(Play.boss)drawBossTo(g, Play.boss, now, cam, zoom);
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
    /* ★传送门★：轨迹在"穿越索引"处**断开**（moveTo），且 k 之后的点整体平移
       （与幽灵实际位置一致 ⇒ 一眼看出幽灵从这里被挪到了那里）。 */
    var _evs=gh._tpEvs||[], _ei=0, _ox=0, _oy=0;
    var _offAt=function(idx){
      while(_ei<_evs.length&&idx>=_evs[_ei].idx){_ox+=_evs[_ei].dx;_oy+=_evs[_ei].dy;_ei++;}
    };
    g.beginPath();
    g.moveTo(traj[0].x+4,traj[0].y+4);
    var step=Math.max(1,Math.floor(traj.length/240));
    for(var di=step;di<traj.length;di+=step){
      var _hadEv=(_ei<_evs.length&&di>=_evs[_ei].idx);
      _offAt(di);
      if(_hadEv)g.moveTo(traj[di].x+4+_ox,traj[di].y+4+_oy);   /* ★真断点★ */
      else     g.lineTo(traj[di].x+4+_ox,traj[di].y+4+_oy);
    }
    _offAt(traj.length-1);
    g.lineTo(traj[traj.length-1].x+4+_ox,traj[traj.length-1].y+4+_oy);
    g.stroke();
    g.setLineDash([]);
    var cur=gh.progress;
    var ci=Math.floor(cur);
    if(ci<0)ci=0;
    if(ci>traj.length-1)ci=traj.length-1;
    /* 白色高亮段：原本固定 ±11 个索引。抽稀后一个索引代表更多帧，
       若不按步长收窄，亮段会随抽稀被拉长（看起来像一长条白线）。
       收窄到 max(3, 11/stride) 后，亮段在世界坐标里的长度基本不变。 */
    var _hSpan=11;
    if((gh.sampleStride||1)>1)_hSpan=Math.max(3,Math.round(_hSpan/(gh.sampleStride||1)));
    var hs=Math.max(0,ci-_hSpan),he=Math.min(traj.length-1,ci+_hSpan);
    if(he>hs){
      g.strokeStyle='rgba(255,255,255,'+(0.92*fa)+')';
      g.lineWidth=lineW2;
      /* ★传送门★：白高亮段同理 —— 段内跨过事件索引也要断开+换偏移。 */
      var _ei2=0,_ox2=0,_oy2=0;
      var _offAt2=function(idx){
        while(_ei2<_evs.length&&idx>=_evs[_ei2].idx){_ox2+=_evs[_ei2].dx;_oy2+=_evs[_ei2].dy;_ei2++;}
      };
      _offAt2(hs);
      g.beginPath();
      g.moveTo(traj[hs].x+4+_ox2,traj[hs].y+4+_oy2);
      for(var hi=hs+1;hi<=he;hi++){
        var _hadEv2=(_ei2<_evs.length&&hi>=_evs[_ei2].idx);
        _offAt2(hi);
        if(_hadEv2)g.moveTo(traj[hi].x+4+_ox2,traj[hi].y+4+_oy2);
        else       g.lineTo(traj[hi].x+4+_ox2,traj[hi].y+4+_oy2);
      }
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
  // 泡沫砖
  Play.foams.forEach(function(f){
    var adj=getAdjacency(f,Play.foams);
    drawFoamTo(g, f, adj);
  });
  /* ★旗杆★：在标记物层（旗帜/奖杯附近）绘制。已激活的（`currentFlag===fp`）
     会画成"红色飘扬 + 脉动光环"，一眼认出这是当前重生点。 */
  if(Play.flagPoles)Play.flagPoles.forEach(function(fp){drawFlagPoleTo(g, fp, true);});
  /* ★野兽★：`sleep` 是实心挡路的大毛球；被炸后播完整"睁眼→速度线→瞬移"再移除。 */
  if(Play.beasts)Play.beasts.forEach(function(bs){drawBeastTo(g, bs, true);});
  /* ★巨花★：bloom 是张开的放射花冠；幽灵靠近后播四段枯萎（失色→萎垂→凋落→消散）。 */
  if(Play.flowers)Play.flowers.forEach(function(fl){drawFlowerTo(g, fl, true);});
  /* ★火★：burning 是分层跳动的火苗 + 危险区暖色光晕；湿幽灵靠近播三段落灭动作。 */
  if(Play.fires)Play.fires.forEach(function(fr){drawFireTo(g, fr, true);});
  /* ★传送门★：入口/出口两套外观（向心吸 / 离心喷）。门非固体、对玩家无感。 */
  if(Play.portals)Play.portals.forEach(function(po){drawPortalTo(g, po, true);});
  /* ★墓碑★：立着的石头（`idle`）/ 粉碎动画（`crumbling`）。不进 allSolids，绝不挡路。 */
  if(Play.graves)Play.graves.forEach(function(gr){drawGraveTo(g, gr, true);});
  /* ★骷髅怪★：方块骷髅 + 两侧尖刺；三态动作（颠簸走 / 后仰冲刺 / 眩晕转星星）。 */
  if(Play.skeletons)Play.skeletons.forEach(function(sk){drawSkeletonTo(g, sk, true);});
  /* ★BOSS 门★：在标记物层与门同区，关着时挡住地形。 */
  if(Play.bossDoors)Play.bossDoors.forEach(function(bd){drawBossDoorTo(g, bd, true);});
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
    /* ★幽灵带水★：湿幽灵身周环绕果冻水珠（§5.5 表现） */
    drawGhostWetTo(g, gh, now, fa, zoom);
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
  /* ★小怪（苍白鬼魂 / 火团怪）★：画在玩家**之后** ⇒ 贴脸时怪物在前，
     玩家能清楚看到自己被谁贴住（`dying` 时播惊讶表情 + 白雾消散）。 */
  if(Play.foes)Play.foes.forEach(function(fo){
    if(fo.kind==='ghost')drawGhostFoeTo(g, fo, now, zoom);
    else drawFireFoeTo(g, fo, now);
  });
  /* ★弹幕★：画在最上层（除了粒子）—— 它是"必须被看见"的致命物，
     被任何地形遮挡都会破坏可通关性（玩家躲不了看不见的东西）。 */
  if(Play.bullets)Play.bullets.forEach(function(bl){drawBulletTo(g, bl, now);});
  /* ★粒子绘制：零分配 + 跳过低 alpha 光晕★
     旧版每颗粒子每帧拼 2 个 `rgba(r,g,b,a)` 字符串 —— 实测局内常驻 192 颗
     ⇒ **384 次/帧字符串分配**（每帧丢弃 384 个小字符串），是局内 GC 压力
     的主要来源（GC 停顿 = 可见的周期性卡顿）。
     改法：颜色串在粒子上**惰性缓存一次**（r/g/b 是 `mkParticle` 时固定的），
     透明度改用 `globalAlpha` 施加 ⇒ 稳态**零字符串分配**。
     另外外层光晕的 alpha = 0.4×alpha2，当 alpha2 ≤ 0.06 时其实际不透明度
     只有 0.024（≈6/255），肉眼完全不可见 ⇒ 直接跳过，省下约 1/3 的粒子绘制调用。
     用 save/restore 包住，绝不把 globalAlpha 泄漏给后续绘制。 */
  g.save();
  for(var pi4=0;pi4<Play.particles.length;pi4++){
    var pt4=Play.particles[pi4];
    var alpha2=Math.max(0,pt4.life/pt4.maxLife);
    if(pt4._c===undefined)pt4._c='rgb('+pt4.r+','+pt4.g+','+pt4.b+')';
    var size=1+alpha2*1.5;
    g.fillStyle=pt4._c;
    if(alpha2>0.06){g.globalAlpha=alpha2*0.4;g.fillRect(pt4.x-size,pt4.y-size,size*2.6,size*2.6);}
    g.globalAlpha=alpha2;
    g.fillRect(pt4.x,pt4.y,size,size);
  }
  g.restore();
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
    /* ★缓存失效★：烟雾矩形集合或缩放变了（换关/换镜头/窗口 resize）就整体清空，
       保证缓存只装「当前这一屏」的矩形 —— 既不跨关累积内存，也绝不会淘汰+重烘抖动。
       用数值指纹（无字符串分配）；偶发哈希碰撞只会多留几条，不会渲染错（查表仍按精确几何键）。 */
    var _sig = (Play.smokes.length * 2654435761) | 0;
    for (var _si = 0; _si < Play.smokes.length; _si++){
      var _s2 = Play.smokes[_si];
      _sig = (_sig ^ ((_s2.x * 73856093) ^ (_s2.y * 19349663) ^ (_s2.w * 83492791) ^ (_s2.h * 2971215073))) | 0;
    }
    _sig = (_sig ^ Math.round(zoom * dpr * 1000)) | 0;
    if (_sig !== _smokeStaticSig){ _smokeStaticCache.clear(); _smokeStaticPx = 0; _smokeStaticSig = _sig; }
    Play.smokes.forEach(function(sm){
      var sx=sm.x, sy=sm.y, sw=sm.w, sh=sm.h;
      // ==================================================
      // 阶段 1+2（静态层）：边界柔雾 + 雾裙 + 实心内核
      //   ★只与矩形几何/缩放有关（柔圆位置由 _pr 完全确定），与动画时间 now 无关
      //   ⇒ 按 (几何, zoom×dpr) 烘焙一次，之后每帧只 1 次 drawImage 贴回。
      //   ★位图超限（超大矩形/超高缩放）时返回 null ⇒ 回退直绘，绝不炸内存。
      // ==================================================
      var _st = _getSmokeStatic(sm, zoom, dpr);
      if (_st) _sg.drawImage(_st.cv, _st.ox, _st.oy, _st.w, _st.h);
      else _drawSmokeStatic(_sg, sm);

      // ==================================================
      // 阶段 3：fbm 噪声纹理（纯 source-over 叠加，不挖孔）—— 动画，必须每帧画
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
        // 预烘焙挖孔精灵（内半径 0.30、剖面与旧渐变逐项一致），destination-out 只取 alpha
        _sg.drawImage(_SMOKE_DOT_GHOST, gx-rr, gy-rr, rr*2, rr*2);
      });
    }
    _sg.globalCompositeOperation = 'source-over';
    g.setTransform(dpr,0,0,dpr,0,0);
    g.drawImage(_sc, 0, 0, _cw, _ch);
  }
  /* ★BOSS 血条★：**屏幕空间** HUD —— 必须在 `setTransform(dpr,…)` 之后画，
     否则会被相机缩放/位移带走（那样条会随玩家跑）。只在 awake/dead 且
     `_barFade>0` 时可见（滑入 + 淡入）。 */
  if(Play.boss){
    g.setTransform(dpr,0,0,dpr,0,0);
    drawBossHpBar(g, W/dpr, H/dpr, Play.boss);
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
    /* ★旗杆守卫（R14）★：若当前出生点是**旗杆**（关卡内置、非玩家自插），
       拔掉一面临时旗**绝不能**把出生点顶掉 —— 旗杆的激活是不可逆的，
       它只会在"激活更新的旗杆"或"本关重开（生命耗尽）"时被替换。
       没有这个守卫的话：拔旗会把 `currentFlag` 覆盖成 null 或另一面临时旗，
       玩家的重生点会莫名其妙退回初始点。 */
    if(Play.currentFlag===picked&&!(Play.currentFlag&&Play.currentFlag.isPole)){
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

/* ============ 旗杆（flagPole）============
   契约（用户原话）：
     "玩家**经过**旗杆激活变成一面红色旗帜，**本关之后的默认重生点**改为这个点，
      直到激活更新的旗杆；当前作为默认重生点的旗**高亮**。"

   ★引擎已有 80%★：`Play.currentFlag` 早就是"重生点 + 幽灵轨迹起点"的**唯一真相源**
   （`getRespawnPos()` / `respawnPlay()` 都只看它；`respawnPlay` 之后 trajectory 天然从新起点录）。
   所以本机制**唯一的逻辑**就是：玩家与旗杆重叠 → 把 `currentFlag` 指过去。

   ★两个必须对齐的既有细节★
   1. `respawnPlay` 写的是 `y: rp.y - 8`（复活位置 = 旗坐标再上移一个身高）。
      旗杆的 `x,y` 语义必须与"玩家自插旗"一致（插旗用的是玩家左上角 `player.x/y`），
      所以验证时 `trajectory[0].y` 应该等于 **旗杆 y - 8**，不是 y。
   2. 旗杆**不消耗** `flagsCollected` —— 那是 `F` 键插旗的库存，两者互不干涉。 */
function updateFlagPoles(){
  if(!Play.flagPoles||!Play.flagPoles.length)return;
  var p=Play.player;
  if(!p||p.dead)return;
  for(var i=0;i<Play.flagPoles.length;i++){
    var fp=Play.flagPoles[i];
    if(Play.currentFlag===fp)continue;      /* 已生效的不用重复激活 */
    if(!rectsOverlap(p,fp))continue;
    Play.currentFlag=fp;
    Play._flagGhostsCleared=false;          /* ★新旗 = 允许一次"换旗首死清幽灵"★ */
    Play.currentRespawnOrigin='flag';
    /* ★★旗杆激活 = 轨迹重新起算（与 doFlagAction v5 完全同构）★★
       【用户原话】"旗杆被激活后的第一次死亡创建的幽灵就应该是从旗杆位置开始
        计算轨迹了，现在的版本似乎第一次还是会从上一个重生点开始。"
       根因：自助插旗（doFlagAction）在插旗时清空 trajectory，所以首死幽灵从旗子起算；
       而旗杆只是"经过激活"，**没有**清 —— 于是 trajectory 里还留着玩家从
       【上一个重生点】一路走到旗杆的那一整段前缀，首死时 compressTrajectory
       就会把这段前缀一起交给幽灵 ⇒ 看起来"幽灵从上一个重生点生成"。
       修复：激活即清空轨迹（并复位采样状态）。下一帧录制点 = 玩家当前所在
       （正与旗杆重叠），因此新幽灵的 trajectory[0] 就落在旗杆位置。
       ★与 doFlagAction 的差异★：那里还要 `newFlag`、扣库存、播特效；
         旗杆是"经过即生效、不消耗库存"，所以这里只做"轨迹重新起算"这一件事。 */
    Play.trajectory=[];Play.dashTrajectory=[];
    Play._trajStride=1;Play._trajTick=0;Play._stillFrames=0;
    Play._stillBaseX=p.x;Play._stillBaseY=p.y;Play._trajDecimAt=0;
    for(var k=0;k<14;k++){                  /* 激活星点（复用既有粒子语言） */
      var a=-Math.PI/2+(Math.random()-0.5)*1.6;
      var s=1+Math.random()*2;
      Play.particles.push(mkParticle(fp.x+(fp.w||8)/2,fp.y,Math.cos(a)*s,Math.sin(a)*s,600,255,221,68));
    }
    /* ★音效/提示同样是"游戏外壳"的能力★（正式版由 audio.js / game.js 提供）
       与 triggerExplosion 同理：存在性守卫，编辑器里跳过、正式版里恒真。 */
    if(typeof AudioSystem!=='undefined'&&AudioSystem)AudioSystem.sfx('flagPlace',fp.x,fp.y);
    if(typeof toast==='function')toast('旗杆已激活（本关重生点已更新）');
    break;
  }
}

/* ============ 野兽（beast）============
   契约（用户更正后）：
     · 初始 `sleep` —— 在原地**睡觉挡路**（实心固体）
     · 被**爆炸**（玩家自杀爆炸 或 幽灵爆炸）惊吓 → 完整"吓跑"动作 → **永久消失**
     · "本关重开之前不会重新刷新" —— 即生命耗尽重开（`restartPlayFromLevel` 重建元素）
       会**重新出现**（那是"重开"），而同一局内 `respawnPlay` 复活**不会**把它变回来。
       ⇒ 实现上天然满足：`scared` 阶段结束就 `splice` 掉，而 `respawnPlay` 不重建元素。 */
function updateBeasts(dt){
  if(!Play.beasts||!Play.beasts.length)return;
  for(var i=Play.beasts.length-1;i>=0;i--){
    var bs=Play.beasts[i];
    if(bs.state!=='scared')continue;
    var ft=bs.fleeTime||0.75;
    bs._t=(bs._t||0)+dt;
    if(bs._t>=ft){
      /* 完整动作播完 → 永久移除（同一局内不再出现） */
      Play.beasts.splice(i,1);
    }
  }
}

/* ============ 巨花（flower）============
   契约（用户更正后）：
     · **同时堵塞玩家和幽灵**
     · 触发源**只有幽灵**（玩家不能主动消除它）
     · 幽灵进入 `triggerRadius` 即触发 → 播完整枯萎动作 → 消失（不再挡路）

   ★"巨花挡幽灵"怎么落地★
   幽灵是纯轨迹回放、不与地形碰撞。本实现采用规划文档的**方案 A**：
     · 引擎只保证「花进 allSolids（挡玩家）」+「幽灵能触发它」；
     · "幽灵走不过花"是**录制侧的自洽后果** —— 花挡玩家 ⇒ 玩家录不出"穿过花"的轨迹
       ⇒ 幽灵回放时自然也不会穿过花。
   ⇒ 零额外代码，且严格遵守"幽灵 = 玩家走过的路"这条纪律。

   ★确定性★：状态推进**完全无 Math.random()**，所以同一序列重放两次，
   状态转移帧号逐帧一致（可被重放缓存复现）。 */
function updateFlowers(dt){
  if(!Play.flowers||!Play.flowers.length)return;
  for(var i=Play.flowers.length-1;i>=0;i--){
    var fl=Play.flowers[i];
    if(fl.state==='gone')continue;
    if(fl.state==='bloom'){
      /* 触发判定：任一**已释放**幽灵进入花的 triggerRadius 内。
         ★★v2 关键修复：距离必须算到**花矩形上最近的一点**，不能算到花心★★
         旧版用"幽灵中心 ↔ 花中心"的欧氏距离。对 `w=16,h=24` 的默认花
         （半宽 8 / 半高 12）看起来没问题；但花一旦被拉高拉宽，花心就远离
         幽灵能到达的地面线 ——
           · 高花 h=100：花心在 y+50，幽灵走地面（中心 y=196）时**垂直距离**
             就已经 46px > 40px 半径 ⇒ 幽灵站在花正下方正中间钻进花里也不枯萎；
           · 宽花 w=120：花心在 x+60，幽灵贴着花右缘时**水平距离** 60px > 40px
             ⇒ 同样不枯萎。
         这正是用户报告的症状①「幽灵已经到它身边了也不枯萎」。
         改用"到矩形的最近点距离"后，判定口径变成用户直觉：
         **幽灵离花本体任何一点在 triggerRadius 内 ⇒ 触发**，
         与花的大小无关（默认花的观感完全不变：贴到 40px 就触发）。 */
      var tr=fl.triggerRadius||40;
      var hit=false;
      for(var gi=0;gi<Play.ghosts.length&&!hit;gi++){
        var g=Play.ghosts[gi];
        if(!g.released)continue;
        var gdx=_distToRect((g.x+4),(g.y+4),fl);
        if(gdx<tr)hit=true;
      }
      if(hit){fl.state='withering';fl._t=0;}
      continue;
    }
    /* withering：播完 witherTime → gone（从数组移除） */
    fl._t=(fl._t||0)+dt;
    if(fl._t>=(fl.witherTime||1.2)){
      fl.state='gone';
      Play.flowers.splice(i,1);
    }
  }
}
/* 点到轴对齐矩形的**最短距离**（点在矩形内 ⇒ 0）。
   供巨花的触发判定使用。配合 drawFlowerTo 末尾的"圆角矩形"示意（口径完全一致，
   都是"矩形向外膨胀 triggerRadius"，所以编辑器里看到的边界就是游戏里的判定线）。 */
function _distToRect(px,py,r){
  var rx=r.x||0, ry=r.y||0, rw=(r.w||8), rh=(r.h||8);
  var cx=Math.max(rx,Math.min(px,rx+rw));
  var cy=Math.max(ry,Math.min(py,ry+rh));
  var dx=px-cx, dy=py-cy;
  return Math.sqrt(dx*dx+dy*dy);
}

/* ============ 火（fire）============
   契约（用户原话）：
     · "这个火**不会蔓延**，玩家走到有火的格子上**就会死**，机制上可能**类似荆棘**，
        扑灭后就**有扑灭的画面展现**，然后就**消失变成玩家可以通过的区域**"
     · 常驻致命：没有"燃烧时长"，**永不自行熄灭**；只有**湿幽灵**能扑灭它
     · ❌ **绝不**与 `flammable` 交叉（不蔓延 / 不被爆炸点燃 / 不自行熄灭）

   本函数只做一件事：推进 `dousing → 移除`。**没有任何蔓延/熄灭计时**。 */
function updateFires(dt){
  if(!Play.fires||!Play.fires.length)return;
  for(var i=Play.fires.length-1;i>=0;i--){
    var fr=Play.fires[i];
    if(fr.state!=='dousing')continue;      /* burning 是稳态：不做任何推进 */
    fr._t=(fr._t||0)+dt;
    if(fr._t>=(fr.dousingTime||0.9)){
      Play.fires.splice(i,1);               /* 直接从数组移除 ⇒ 该格变为可通过 */
    }
  }
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
/* ★★ 烟雾柔圆「精灵」★★
   【为什么必须这么做】烟雾层原本为**每个**柔圆新建一次径向渐变：
       createRadialGradient + 4~5 次 addColorStop（每次都解析一遍 CSS 颜色字符串）
       + beginPath + arc + fill。
   实测单个烟雾区（80×60）每帧要建 **122 个**渐变、三区（168×8×3）要建 **1457 次
   绘制调用** ⇒ renderPlay 从 0.6ms 飙到 **17~24ms/帧**（含烟雾的关卡是第 2/4/23~28 关，
   玩家开局就会遇到）。这是整个游戏最重的性能热点。
   改法：把「径向渐变的 alpha 剖面」**一次性烘进一张位图的 alpha 通道**，
   之后每个柔圆只剩一次 `drawImage`，调用方的 alpha 用 `globalAlpha` 施加。
   数学上等价：渐变版像素 alpha = aa × stop，精灵版 = globalAlpha(aa) × 精灵alpha(stop)。
   · 位图取 256×256（平滑径向，缩放无细节损失），一次性烘焙、全程复用。 */
var _smokeDots = {};
/* r0frac：内半径占外半径的比例，必须与旧 createRadialGradient 的内半径一致
   （环状/雾裙内半径 0；幽灵挖孔内半径 rr*0.30）。stop 位置是「内外半径之间的
   归一化参数 t」，故用同一 r0 复刻即可逐像素对齐。 */
function _smokeDot(key, stops, r0frac) {
  if (_smokeDots[key]) return _smokeDots[key];
  var N = 256, R = N / 2;
  var cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  var q = cv.getContext('2d');
  var gr = q.createRadialGradient(R, R, R * (r0frac || 0), R, R, R);
  for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], 'rgba(230,232,238,' + stops[i][1] + ')');
  q.fillStyle = gr; q.fillRect(0, 0, N, N);
  _smokeDots[key] = cv; return cv;
}
/* 剖面必须与旧渐变的 stop 位置/系数逐项一致（见下方三处调用点）。 */
var _SMOKE_DOT_RING = _smokeDot('ring', [[0, 1], [0.30, 0.85], [0.58, 0.55], [0.82, 0.22], [1, 0]], 0);
var _SMOKE_DOT_DRIFT = _smokeDot('drift', [[0, 1], [0.5, 0.55], [1, 0]], 0);
/* 幽灵挖孔用 destination-out：只看 alpha 通道，颜色无关。内半径 0.30（内部实心）。 */
var _SMOKE_DOT_GHOST = _smokeDot('ghost', [[0, 1], [0.55, 0.92], [0.82, 0.45], [1, 0]], 0.30);

/* ★★ 烟雾「静态层」烘焙缓存 ★★
   环状柔雾 + 雾裙 + 实心内核这三层**只与矩形几何和缩放有关，与动画时间 now 无关**
   （柔圆位置用 _pr(seedBase+…) 完全确定）。原实现每帧都要重画数百个柔圆；
   这里按 (几何, zoom×dpr) 烘焙成一张位图，之后每帧只 1 次 drawImage 贴回。
   · 位图坐标 = 世界坐标 × scale，贴图时 _sg 已带同样的世界变换 ⇒ 1:1 无重采样，逐像素等价。
   · 外扩 MARGIN 覆盖柔圆向外最大外溢（环 rr−inward ≤ 22、雾裙 outDist+rr2 ≤ 24）。
   · 位图超上限（超大矩形/超高缩放）自动返回 null ⇒ 调用方回退直绘，绝不炸内存。 */
var _smokeStaticCache = new Map();
var _smokeStaticPx = 0;          // 当前缓存占用像素（内存 ≈ px×4 字节）
var _smokeStaticSig = 0;         // 当前烟雾矩形集合 + 缩放的数值指纹
var _SMOKE_STATIC_MARGIN = 30;
var _SMOKE_STATIC_MAXPX = 6 * 1024 * 1024;      // 单个位图上限（≈24MB）
var _SMOKE_STATIC_BUDGET = 24 * 1024 * 1024;    // 全部缓存总上限（≈96MB）

/* 把静态三层画进 g（g 需已设好「世界坐标」变换）。等价于旧的内联代码。 */
function _drawSmokeStatic(g, sm){
  var sx=sm.x, sy=sm.y, sw=sm.w, sh=sm.h;
  var seedBase = sm.x*0.73 + sm.y*0.31;
  var minD = Math.min(sw, sh);
  var perimeter = (sw + sh) * 2;
  var ringCount = Math.max(80, Math.floor(perimeter / 3.2));
  for(var ci=0; ci<ringCount; ci++){
    var t = (ci / ringCount) * perimeter + (_pr(seedBase + ci*1.13) - 0.5) * 6;
    if(t < 0) t += perimeter;
    if(t >= perimeter) t -= perimeter;
    var px, py, outNX, outNY;
    if(t < sw){ px = sx + t; py = sy; outNX = 0; outNY = -1; }
    else if(t < sw+sh){ px = sx + sw; py = sy + (t-sw); outNX = 1; outNY = 0; }
    else if(t < 2*sw+sh){ px = sx + sw - (t-sw-sh); py = sy + sh; outNX = 0; outNY = 1; }
    else { px = sx; py = sy + sh - (t-2*sw-sh); outNX = -1; outNY = 0; }
    var inward = 3 + _pr(seedBase + ci*2.17) * 4;
    px += outNX * -inward;
    py += outNY * -inward;
    var rr = 15 + _pr(seedBase + ci*3.29) * 10;
    var aa = 0.55 + _pr(seedBase + ci*4.41) * 0.35;
    g.globalAlpha = aa;
    g.drawImage(_SMOKE_DOT_RING, px-rr, py-rr, rr*2, rr*2);
  }
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
    var outDist = 3 + _pr(seedBase + di*2.33 + 50) * 7;
    px2 += onx * outDist;
    py2 += ony * outDist;
    var rr2 = 7 + _pr(seedBase + di*3.47 + 50) * 7;
    var aa2 = 0.08 + _pr(seedBase + di*4.59 + 50) * 0.14;
    g.globalAlpha = aa2;
    g.drawImage(_SMOKE_DOT_DRIFT, px2-rr2, py2-rr2, rr2*2, rr2*2);
  }
  g.globalAlpha = 1;
  var inset = Math.min(4, minD * 0.15);
  var corner = Math.min(6, minD * 0.2);
  g.save();
  g.fillStyle = 'rgba(228,230,236,1)';
  roundRectPath(g, sx+inset, sy+inset, sw-inset*2, sh-inset*2, corner);
  g.fill();
  g.restore();
}

/* 取（或烘焙）某烟雾矩形的静态层位图。返回 {cv, ox, oy, w, h}（世界坐标），或 null 表示回退直绘。
   ★内存与抖动纪律★：
     · 调用方（renderPlay）在矩形集合/缩放变化时会清空缓存 ⇒ 缓存只装当前这一屏的矩形，不会跨关累积。
     · 单个位图超上限、或总占用将超预算时，**直接返回 null 走直绘**（绝不淘汰+重烘，
       否则会变成每帧重烘的抖动，比不缓存更糟）。 */
function _getSmokeStatic(sm, zoom, dpr){
  var scale = zoom * dpr;
  if(!(scale > 0)) return null;
  var key = sm.x+'|'+sm.y+'|'+sm.w+'|'+sm.h+'|'+scale.toFixed(3);
  var hit = _smokeStaticCache.get(key);
  if(hit) return hit;
  var bw = Math.ceil((sm.w + _SMOKE_STATIC_MARGIN*2) * scale);
  var bh = Math.ceil((sm.h + _SMOKE_STATIC_MARGIN*2) * scale);
  if(bw < 2 || bh < 2) return null;
  var px = bw * bh;
  if(px > _SMOKE_STATIC_MAXPX || _smokeStaticPx + px > _SMOKE_STATIC_BUDGET) return null;
  var cv = document.createElement('canvas'); cv.width = bw; cv.height = bh;
  var q = cv.getContext('2d');
  var ox = sm.x - _SMOKE_STATIC_MARGIN, oy = sm.y - _SMOKE_STATIC_MARGIN;
  q.setTransform(scale, 0, 0, scale, -ox*scale, -oy*scale);
  _drawSmokeStatic(q, sm);
  var rec = { cv: cv, ox: ox, oy: oy, w: sm.w + _SMOKE_STATIC_MARGIN*2, h: sm.h + _SMOKE_STATIC_MARGIN*2 };
  _smokeStaticCache.set(key, rec);
  _smokeStaticPx += px;
  return rec;
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
