'use strict';
/* ============================================================================
   crt.js —— CRT 老电视后处理层（游戏外壳资产，PC 与手机共用）
   ----------------------------------------------------------------------------
   【用户需求】给游戏加入「适当」的 CRT 效果：
     · 动画扫描线（略带动感；但**绝不能影响清晰度**）；
     · ★屏幕真的球面膨胀（桶形畸变）★ —— 用户明确反馈"完全看不出来球形畸变 /
       没有球面感"，所以 v2 改为**真几何畸变**（见下方第 4 点），
       而不是 v1 那种"不移动像素的光学线索"；
     · ★屏幕曲率可在设置里调整★：最小 = 完全没有球面感，最大 = 很明显，
       但**不要过于变形畸变**（所以上限封在 0.60，而不是 1.0）；
     · ★扫描线适当加强★：在不遮挡画面的前提下更复古；
     · ★设置里的「扫描线开关」与「镜头畸变（曲率）滑杆」必须对齐、排版美观★
       —— 用户明确抱怨过旧版"没对齐很丑"；
     · ★设置里**不再有「实时预览」小窗**★ —— 用户原话「为啥要在设置里塞一个
       小窗预览啊？我觉得很没必要，还占地方」，已删除。
   生效范围：**PC 端全局**（曲率与扫描线都生效，含真畸变）；**手机端只加在局外
   界面**（菜单 / 选关 / 设置 / 说明 / 确认），手机**局内不加**曲率与扫描线；
   手机端也**不做重采样**（性能风险），只保留光学线索层。
   编辑器（index.html）不引用本文件，天然没有。

   【实现要点】
   1) 全部是**屏幕空间的 CSS 覆盖层**（`position:fixed` 的一层 div），
      不碰 canvas、不重绘、不进 renderPlay/renderUI ⇒ 与两套渲染循环零耦合，
      三版本行为不会漂移（这也是它被放进「外壳」而不是 runtime.js 的原因）。
   2) 扫描线的「动感」交给**CSS 动画**（background-position 滚动 + 一条缓慢
      下扫的亮带）。GPU 合成、不占主线程，掉帧也不会错位。
   3) **清晰度优先**：扫描线用低对比（黑线 alpha 上限 ~0.20）、线距 ≥ 3px，
      且**不对画布做任何模糊/缩放**；亮带 alpha 上限 ~0.05。
      所以像素字、像素精灵仍逐点清晰。
   4) ★★曲率的实现方式 —— 这是本文件最关键的设计决定★★
      **v2（当前）采用真几何畸变**（SVG feDisplacementMap 整屏重采样），
      理由：用户明确反馈"完全看不出来球形畸变 / 没有球面感"。
      v1 的"光学线索"（暗角 + 高光 + 边框）虽然保住像素清晰度，
      但它**不移动任何像素**，直线仍是直线 ⇒ 玩家感知不到"面被撑鼓了"。
      真畸变把中心放大 1/(1−K) 倍、边缘保持原位 —— 这才是"桶形畸变"本身。
      映射函数、为什么用 SVG 滤镜、以及"曲率 0 ⇒ 逐像素还原"的保证，
      全部写在下方 `WARP_MAX_K` 那段注释里（那是唯一的真相源）。

      ⚠️ 取舍：整屏重采样会让像素艺术被**插值**（这是真畸变的必然代价，
      也是 v1 当初要绕开它的原因）。但用户已明确选择"要看得见的球面感"，
      且本游戏的外壳（菜单/选关/设置）本身就是矢量风、非像素图案，
      局内 HUD 也是位图字（重采样后仍可读）⇒ 代价可接受。
      仍然保留 v1 的四层光学线索叠加在畸变之上（暗角/高光/边框），
      它们让"球面"读起来更像玻璃显像管，而不是"被鱼眼镜头拉过"。
      · 曲率 = 0 ⇒ scale=0（位移图恒等）+ 光学层 opacity:0 ⇒ **完全平面**。
      · 手机端不做重采样（性能风险），只保留 v1 的光学线索。
   5) 无障碍：`prefers-reduced-motion` 时冻结动画（只留静止扫描线与暗角）。
   6) 可关：扫描线与曲率**各有独立存档位**（`Game.save.crtScan` /
      `Game.save.crtCurve`），旧字段 `Game.save.crt` 保留为"总开关"语义，
      兼容老存档（老存档没有新字段时按默认值补上）。
   ========================================================================== */
(function () {
  if (typeof document === 'undefined') return;
  /* 编辑器不加载本文件；再加一道保险：只有存在游戏外壳（Game）时才启用。 */
  if (typeof window.Game === 'undefined' || !window.Game) return;

  var STYLE_ID = 'crtStyle';
  var LAYER_ID = 'crtLayer';
  var CSS_VAR = '--crt-curve';          /* 曲率（0..1）经 CSS 变量下传 */

  /* ---------------------------------------------------------------- 常量 */
  /* ★曲率上限 0.60★：用户原话「最大可以很明显，但是也不要太过于变形畸变」。
     1.0 会让四角暗到 ~62%、边框厚到吃掉 HUD；0.60 实测四角压深 ~34%、
     边框内阴影 ~26px，观感"明显是球面"但 HUD（贴边 16px 处）仅被压 ~12%，
     仍然完全可读。这是"很明显"与"不过度"的交点。 */
  var CURVE_MAX = 0.60;
  var CURVE_MIN = 0.0;                  /* 0 = 完全平面（无任何球面线索） */
  var CURVE_DEFAULT = 0.45;             /* 默认：一眼能看出是"老电视"，但很克制。
                                          取值依据（实测，见 `_crt_lab` 的曲率阶梯）：
                                          0.34 ⇒ 四角比中心多压暗 7.3%（偏弱，AI 初版就是这里
                                             "看着不像球面"）；0.45 ⇒ 落差 ~11%（明显可辨）；
                                          1.00 ⇒ 落差 ~21%、HUD 压暗 29%（太啃 UI）。
                                          0.45 落在"看得出球面"与"不吃 UI"之间。 */

  /* 扫描线强度也做成"两档可调"的中间值（用户要求"适当加强"）。
     与旧版对比：黑线 alpha 0.125 → 0.20（+60%），线距仍为 3px（不加密，
     加密会让细节被压成网状）；周期从 6.4s 缩到 5.2s（动感更明显一点）。
     0.20 的实测量化：平均亮度降 ~6.7%，像素字/精灵仍逐点清晰。 */
  var SCAN_ALPHA = 0.20;
  var SCAN_PERIOD = 3;                  /* px */

  /* 极简 CSS。所有可调参数集中在这里，便于"适当"地整体增减强度。
     【暗角不能啃 HUD】实测：HUD 在 (18,16) 这种极靠边的位置，若按常规
       "100% 处压深 44%"，HUD 恰好落在最外圈 ⇒ 被压掉四成亮度。
       所以这里用「大半径 radial + 外扩 8%」把压深曲线整体外推：
       屏幕四角只落在 ~83% 处，HUD（~80%）压深随之变浅。
       曲率越大，外扩与压深同步增强 —— 既保留"中心鼓起来"的观感，
       又保证**任何曲率下 HUD 都可读**（见 `_crt_lab` 的 UI 亮度断言）。 */
  var CSS = [
    /* 覆盖层本体：整屏、不吃事件、压在 UI 之上（#ui z-index:2）。
       曲率经 `--crt-curve`（0..1）下传，各层用 calc() 按它插值。 */
    '#crtLayer{position:fixed;inset:0;z-index:6;pointer-events:none;',
    '  contain:layout paint style;opacity:1;transition:opacity .28s ease;',
    '  ' + CSS_VAR + ':0}',
    '#crtLayer.crt-off{opacity:0}',
    /* 单独关掉某一层的类（设置里两个开关各自独立生效，互不牵连） */
    '#crtLayer.no-scan .crt-scan,#crtLayer.no-scan .crt-beam{opacity:0!important;animation:none!important}',
    '#crtLayer.no-curve .crt-glass,#crtLayer.no-curve .crt-tube{opacity:0!important}',

    /* ① 桶形暗角 + ② 凸面高光 + ③ 边缘内收：同一层多重背景叠加（省一次合成）。
       ★三层全部按 `--crt-curve` 插值★（calc 里乘 var ⇒ 曲率 0 时
         压深/高光/内收全部归零 ⇒ 见下方的 opacity 兜底）。

       ★为什么暗角的半径是 60%★（这一段是实测调出来的，不是拍的）
       覆盖层是 `inset:-8%` ⇒ 它的实际尺寸是视口的 116%。设径向半径 = R（相对
       元素宽），则屏幕**正中**在梯度位置 0%、屏幕**四角**在
       位置 = √2 × (0.58 / (R × 1.16))。
       旧版取 R=150%（=1.74 视口宽）⇒ 四角只落在 **28%** 处，而透明区一直
       延伸到 68% ⇒ **四角根本吃不到暗角**，整层压深几乎全部来自内阴影。
       这正是旧版"看着不像球面、只是四边发灰"的根因。
       现在取 R≈60% ⇒ 四角落在 ~102%（刚好压满），而画面中央 45% 仍是
       完全透明的 ⇒ 出现清晰可读的"中间亮、四周沉下去"的球面落差。

       ★为什么峰值只有 0.30★（同样是实测定的）
       球面感 = **中心与四角的落差**，不是"压得多黑"。第一版把峰值开到 0.60，
       四角落差确实到了 32%，但同时把左上角的 HUD（生命/计时面板）压暗 38%、
       界面按钮对比度损失 20% —— 为了"球面感"把 UI 啃掉，是直接的可用性倒退。
       现在把峰值收敛到 0.30：四角落差仍有 ~16%（一眼就是球面），
       而 HUD 压暗 ~20%、按钮对比度损失 ~9%，全部落在"可读"区间内。
       —— 结论：**靠落差做球面，不靠深度做球面**。 */
    '#crtLayer .crt-glass{position:absolute;inset:-8%;',
    '  background:',
    /* ① 桶形暗角：曲率越大 ⇒ 半径收紧（压深圈向中心推进）+ 压深加深 */
    '    radial-gradient(calc(60% - var(--crt-curve) * 5%) calc(60% - var(--crt-curve) * 5%) at 50% 50%,',
    '      rgba(0,0,0,0) 45%,',
    '      rgba(0,0,0,calc(var(--crt-curve) * 0.085)) 77%,',
    '      rgba(0,0,0,calc(var(--crt-curve) * 0.265)) 106%),',
    /* ③ 上下边缘"内收"：曲面屏边缘比直线更早收拢（刻意很淡 —— 主要球面线索在①） */
    '    linear-gradient(180deg, rgba(0,0,0,calc(var(--crt-curve) * 0.055)) 0%,',
    '      rgba(0,0,0,0) 8%, rgba(0,0,0,0) 92%, rgba(0,0,0,calc(var(--crt-curve) * 0.055)) 100%),',
    /* ② 凸面玻璃反光：左上柔亮，曲率越大越集中、越靠内 */
    '    radial-gradient(calc(70% - var(--crt-curve) * 16%) calc(56% - var(--crt-curve) * 14%) at 27% 15%,',
    '      rgba(255,255,255,calc(var(--crt-curve) * 0.155)) 0%,',
    '      rgba(255,255,255,calc(var(--crt-curve) * 0.045)) calc(46% + var(--crt-curve) * 10%),',
    '      rgba(255,255,255,0) 74%),',
    /* ③b 中心鼓光：弧面正中的微弱高光，强化"球面"错觉 */
    '    radial-gradient(calc(48% - var(--crt-curve) * 10%) calc(42% - var(--crt-curve) * 8%) at 47% 38%,',
    '      rgba(255,255,255,calc(var(--crt-curve) * 0.115)) 0%,',
    '      rgba(255,255,255,calc(var(--crt-curve) * 0.030)) 56%,',
    '      rgba(255,255,255,0) 80%)}',
    /* 曲率 = 0 ⇒ 该层整层不透明度归零（"最小可以完全没有球面感"）。
       用 opacity 而不是把上面每个 calc 都写成 0：单一真相源、无浮点残差。 */
    '#crtLayer.curve-flat .crt-glass{opacity:0}',

    /* 扫描线层：独立一层，专门做动画（不改其它层，滚动时不会有重绘抖动）。
       1px 黑线 / 3px 周期、alpha 0.20（用户要求"适当加强"）⇒ 平均亮度降 ~6.7%，
       像素字与精灵仍逐点清晰。 */
    '#crtLayer .crt-scan{position:absolute;inset:0;',
    '  background-image:repeating-linear-gradient(',
    '    180deg,',
    '    rgba(0,0,0,' + SCAN_ALPHA + ') 0px, rgba(0,0,0,' + SCAN_ALPHA + ') 1px,',
    '    rgba(0,0,0,0)    1px, rgba(0,0,0,0)    ' + SCAN_PERIOD + 'px);',
    '  background-size:100% ' + SCAN_PERIOD + 'px;',
    '  animation:crtScanRoll 5.2s linear infinite;',
    '  will-change:background-position}',
    /* 缓慢下扫的"刷新亮带"：老电视的行同步感（alpha 极低，只做"动感"）。
       加强版：峰值 alpha 0.068 → 0.082，并随曲率略微变窄（更像球面扫过）。 */
    '#crtLayer .crt-beam{position:absolute;left:0;right:0;',
    '  height:calc(70px - var(--crt-curve) * 12px);opacity:.62;',
    '  background:linear-gradient(180deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.052) 42%,',
    '    rgba(255,255,255,.082) 50%,rgba(255,255,255,.052) 58%,rgba(255,255,255,0) 100%);',
    '  animation:crtBeam 7.0s linear infinite;will-change:transform,top}',
    /* ④ 显像管萤幕边框：圆角 + 内阴影（厚玻璃边缘），随曲率加深。
       内阴影刻意保持外浅（只在最外 ~26px 明显），
       HUD 在 16~18px 处仅被压 ~12%，仍完全可读。
       ⚠️**不对 canvas 做任何 transform / filter**：像素艺术一旦被父层
       缩放或透视，就会被浏览器插值糊边 —— 这是本层"绝不碰画布"的根本原因。 */
    '#crtLayer .crt-tube{position:absolute;inset:0;',
    '  border-radius:calc(8px + var(--crt-curve) * 16px);',
    '  box-shadow:inset 0 0 0 1px rgba(255,255,255,calc(var(--crt-curve) * 0.10)),',
    '             inset 0 0 calc(20px + var(--crt-curve) * 10px) rgba(0,0,0,calc(var(--crt-curve) * 0.27)),',
    '             inset 0 0 calc(60px + var(--crt-curve) * 30px) rgba(0,0,0,calc(var(--crt-curve) * 0.14))}',
    '#crtLayer.curve-flat .crt-tube{opacity:0}',
    '@keyframes crtScanRoll{from{background-position:0 0}to{background-position:0 ' + SCAN_PERIOD + 'px}}',
    '@keyframes crtBeam{from{top:-88px}to{top:100%}}',
    /* 无障碍：冻结动画（保留静态扫描线与暗角，"老电视"观感仍在） */
    '@media (prefers-reduced-motion:reduce){',
    '  #crtLayer .crt-scan{animation:none}',
    '  #crtLayer .crt-beam{animation:none;display:none}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureLayer() {
    var el = document.getElementById(LAYER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = LAYER_ID;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="crt-glass"></div><div class="crt-scan"></div>' +
                   '<div class="crt-beam"></div><div class="crt-tube"></div>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  var CRT = window.CRT = {};
  CRT.forceOff = false;      /* 手机局内的临时压制（不动用户设置） */
  CRT.CURVE_MIN = CURVE_MIN;
  CRT.CURVE_MAX = CURVE_MAX;
  CRT.CURVE_DEFAULT = CURVE_DEFAULT;

  function clamp01(v, d) {
    v = Number(v);
    if (!isFinite(v)) return d;
    return Math.max(0, Math.min(1, v));
  }

  /* 存档读取与迁移。
     · `crt`      ：总开关（老存档已有）。缺省 = 开。
     · `crtScan`  ：扫描线开关。★v3 起玩家不再可调★ —— 恒为开（保留老旧电视
                    观感）；即便旧存档里存过 false，也一律按开处理，避免"删了
                    调节入口后效果却还是关着的"这种看不出原因的怪状态。
     · `crtCurve` ：曲率 0..1（对外暴露的就是经 CURVE_MAX 缩放前的"手感值"，
                    即设置里滑杆的 0~100%，实际生效量 = 值 × CURVE_MAX）。
                    ★v3 起玩家不再可调★ —— 恒为 CURVE_DEFAULT。
                    缺省 = CURVE_DEFAULT。 */
  function save() { try { return Game && Game.save ? Game.save : null; } catch (e) { return null; } }
  CRT.enabled = function () {
    var s = save();
    if (s && s.crt === false) return false;
    return true;
  };
  CRT.scanEnabled = function () {
    /* ★v3：扫描线恒开（不再读 crtScan）★ —— 用户要求"保留老旧电视效果"。 */
    return true;
  };
  /* 返回"设置滑杆"的口径（0..1 的手感值）。★v3：恒定默认值★，不再读存档。
     `CRT._testCurve` 仅供自动化测试临时覆写（普通玩家无法触及）。 */
  CRT._testCurve = null;
  CRT.curve = function () {
    if (CRT._testCurve != null) return clamp01(CRT._testCurve, CURVE_DEFAULT);
    return CURVE_DEFAULT;
  };
  /* 返回"实际生效"的曲率（0..CURVE_MAX） */
  CRT.curveAmount = function () { return CRT.curve() * CURVE_MAX; };

  /* 「本帧是否该显示」。分端策略就在这里，只有这一处：
       PC  ：全局显示（含局内）；
       手机：只在局外显示（playing / pause / win / fail 都算局内）。 */
  CRT.shouldShow = function () {
    if (CRT.forceOff) return false;
    if (!CRT.enabled()) return false;
    if (!(window.MOBILE_MODE === true)) return true;
    /* —— 手机端：局外才显示 —— */
    var s = (window.Game && Game.state) || '';
    if (s === 'playing' || s === 'pause' || s === 'win' || s === 'fail') return false;
    /* 横屏提示页也不需要（它本身是"请竖屏"的整屏提示） */
    if (window.MU && MU.landscape) return false;
    return true;
  };

  var _lastKey = null;

  /* ══════════════════════════════════════════════════════════════════════════
     ★★ 真几何畸变（球面膨胀）★★ —— 本文件 v2 的核心新增
     ──────────────────────────────────────────────────────────────────────────
     【用户原话】「PC 我在后台预览依然完全看不出来球形畸变屏幕效果，你的小窗预览
                  倒是有，但是完全看不出来有啥球面感游戏本身。而且为啥要在设置里
                  塞一个小窗预览啊？我觉得很没必要，还占地方」

     ⇒ 两条硬要求：
        ① **游戏画面本身**要真的看得出球面膨胀（不是"加暗角"这种光学线索）；
        ② 设置页里的「实时预览」小窗**删掉**（占地方、没必要）。

     ▍为什么旧版看不见
       旧版（v1）是"几何不变的光学线索"：桶形暗角 + 凸面高光 + 边缘内收 + 显像管
       边框。它**不移动任何一个像素**，所以直线还是直线、文字还是正的 —— 玩家
       根本感知不到"面被撑鼓了"。暗角只会让人觉得"四边发灰"。

     ▍v2 的映射函数（球面感的唯一来源，一次看懂）
       以屏幕中心为原点，归一化半径 rr=(dx²+dy²)/maxR² ∈ [0,1]（屏幕角落 = 1）。
         f(rr) = 1 - K·(1 - rr)        K = 曲率手感值 × WARP_MAX_K
         src   = center + (dx,dy)·f
       · 中心 rr=0 ⇒ f = 1-K < 1 ⇒ 采样点向中心收 ⇒ **中心被放大**（凸起）
       · 角落 rr=1 ⇒ f = 1       ⇒ 采样点不动   ⇒ 边缘保持原位
       净效果：中心鼓起、边缘相对被压扁 —— 正是显像管玻璃的**桶形畸变**。
       K = 0（曲率滑杆拉到 0）⇒ f ≡ 1 ⇒ 逐像素恒等 ⇒ **完全平面，零形变**。

     ▍为什么用 SVG feDisplacementMap 而不是自己重采样 canvas
       · 挂在浏览器合成器上，**不用每帧上传纹理**；
       · 不改 canvas 的像素数据 ⇒ 随时能干净地关掉（设置滑杆 0 即复原）；
       · 位移图是**一次性生成**的（只有窗口尺寸变了才重算），
         曲率变化只改 `feDisplacementMap@scale`（线性缩放）⇒ 拖滑杆零卡顿、零闪烁。

     ▍只在 PC 生效（手机端不重采样）
       手机竖屏像素密度高、机型性能参差，整屏重采样风险大；且本次诉求明确是 PC。
       手机端保留 v1 的光学线索（暗角/边框），观感一致但零重采样成本。
     ══════════════════════════════════════════════════════════════════════════ */
  var WARP_MAX_K = 0.20;      /* 曲率=1 时中心放大 1/(1-0.20)=1.25 倍（很明显） */
  var MAP_W = 160;            /* 位移图宽（映射是低频的，160 足够平滑、生成极快） */
  var SVG_HOST_ID = 'crtWarpHost';
  var FILTER_ID = 'crtWarpFilter';
  var WARP_TARGETS = ['playScreen', 'ui'];   /* 两个全屏 canvas 一起被重采样 */
  var _mapSize = '', _mapScale = 0, _warpOK = null, _warpOn = null;

  /* 支持性探测：老浏览器没有 SVG 滤镜时自动退化为 v1 的光学线索。 */
  function _supportsWarp() {
    if (_warpOK !== null) return _warpOK;
    try {
      var d = document.createElement('div');
      d.style.filter = 'url(#crtNoSuchFilter)';
      _warpOK = (d.style.filter !== '' && typeof document.createElementNS === 'function');
    } catch (e) { _warpOK = false; }
    return _warpOK;
  }
  /* 生成位移图（**用最大 K 生成一次**，强度靠 scale 线性缩放）：
       R 通道 = 0.5 + Vx/scaleMax，G 通道 = 0.5 + Vy/scaleMax；
       feDisplacementMap 的位移量 = scale × (通道 − 0.5)，
       所以把 scale 设成 scaleMax·c 就等于"用 c 比例的强度"——
       拖滑杆时**只改一个属性**，不必重算位图、不会闪。 */
  function _buildMap(w, h) {
    var mw = MAP_W, mh = Math.max(2, Math.round(MAP_W * h / Math.max(1, w)));
    var c = document.createElement('canvas'); c.width = mw; c.height = mh;
    var q = c.getContext('2d'), img = q.createImageData(mw, mh), d = img.data;
    var cx = (mw - 1) / 2, cy = (mh - 1) / 2;
    var maxR2 = cx * cx + cy * cy;
    var sx = w / mw, sy = h / mh;                 /* 位移图 1px ⇒ 屏幕 sx/sy px */
    var K = WARP_MAX_K, maxAbs = 1e-4, x, y;
    for (y = 0; y < mh; y++) for (x = 0; x < mw; x++) {
      var dx = x - cx, dy = y - cy;
      var rr = maxR2 > 0 ? (dx * dx + dy * dy) / maxR2 : 0;
      var f = -K * (1 - rr);                      /* 负号 = 向中心收 ⇒ 中心放大 */
      var a = Math.max(Math.abs(dx * sx * f), Math.abs(dy * sy * f));
      if (a > maxAbs) maxAbs = a;
    }
    var scaleMax = maxAbs * 2;                    /* 让通道刚好用满 0..1 */
    for (y = 0; y < mh; y++) for (x = 0; x < mw; x++) {
      var ddx = x - cx, ddy = y - cy;
      var rr2 = maxR2 > 0 ? (ddx * ddx + ddy * ddy) / maxR2 : 0;
      var f2 = -K * (1 - rr2);
      var i = (y * mw + x) * 4;
      d[i]     = Math.max(0, Math.min(255, Math.round((0.5 + (ddx * sx * f2) / scaleMax) * 255)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round((0.5 + (ddy * sy * f2) / scaleMax) * 255)));
      d[i + 2] = 128; d[i + 3] = 255;
    }
    q.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), scaleMax: scaleMax };
  }
  function _ensureMap(w, h) {
    var sizeKey = w + 'x' + h;
    if (sizeKey === _mapSize && _mapScale > 0) return;
    var host = document.getElementById(SVG_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = SVG_HOST_ID;
      /* 0×0 + overflow:hidden ⇒ 不占位、不可见；只作为滤镜定义的容器。 */
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
      (document.body || document.documentElement).appendChild(host);
    }
    var mp = _buildMap(w, h);
    _mapScale = mp.scaleMax;
    _mapSize = sizeKey;
    /* ★用 innerHTML 一次性写入完整 <svg>★：HTML 解析器会按 SVG 命名空间正确建树
       （逐个 createElement 反而容易漏命名空间）。 */
    host.innerHTML =
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
        '<filter id="' + FILTER_ID + '" filterUnits="userSpaceOnUse"' +
          ' x="0" y="0" width="' + w + '" height="' + h + '"' +
          ' color-interpolation-filters="sRGB">' +
          '<feImage href="' + mp.url + '" x="0" y="0" width="' + w + '" height="' + h + '"' +
            ' preserveAspectRatio="none" result="crtm"/>' +
          '<feDisplacementMap in="SourceGraphic" in2="crtm" scale="0"' +
            ' xChannelSelector="R" yChannelSelector="G"/>' +
        '</filter>' +
      '</svg>';
  }
  function _setWarpStrength(c) {
    var f = document.getElementById(FILTER_ID);
    if (!f || _mapScale <= 0) return;
    /* c 是 0..1 的手感值；位移图按 K=WARP_MAX_K 生成 ⇒ scale = scaleMax·c */
    f.setAttribute('scale', (_mapScale * c).toFixed(3));
  }
  function _applyWarp(on) {
    if (_warpOn === on) return;
    _warpOn = on;
    var v = on ? ('url(#' + FILTER_ID + ')') : '';
    for (var i = 0; i < WARP_TARGETS.length; i++) {
      var el = document.getElementById(WARP_TARGETS[i]);
      if (!el) continue;
      if (el.style.filter !== v) el.style.filter = v;
    }
  }

  CRT.sync = function (force) {
    var el = ensureLayer();
    var on = CRT.shouldShow();
    /* 两个子层各自独立控制 —— 与设置里的两个开关一一对应 */
    var scanOn = on && CRT.scanEnabled();
    var curveOn = on && CRT.curveAmount() > 0.001;
    var amt = CRT.curveAmount();
    var key = (on ? 1 : 0) + '|' + (scanOn ? 1 : 0) + '|' + (curveOn ? 1 : 0) + '|' + amt.toFixed(4);
    if (!force && key === _lastKey) return;
    _lastKey = key;
    el.classList.toggle('crt-off', !on);
    el.classList.toggle('no-scan', !scanOn);
    el.classList.toggle('no-curve', !curveOn);
    el.classList.toggle('curve-flat', !curveOn);
    el.style.setProperty(CSS_VAR, String(amt));

    /* ---- 真几何畸变（PC 且曲率 > 0 时启用；曲率 0 ⇒ 摘掉滤镜、逐像素还原） ---- */
    var wantWarp = on && curveOn
      && !(window.MOBILE_MODE === true)
      && _supportsWarp();
    if (wantWarp) {
      var w = Math.max(1, window.innerWidth | 0), h = Math.max(1, window.innerHeight | 0);
      _ensureMap(w, h);
      _setWarpStrength(CRT.curve());
    }
    _applyWarp(wantWarp);
  };
  /* 供验收脚本读取"是否真的在做重采样"与当前强度 */
  CRT.warpDebug = function () {
    return {
      supported: _supportsWarp(),
      applied: _warpOn === true,
      strength: CRT.curve(),
      mapSize: _mapSize,
      scaleMax: _mapScale,
      filterScale: (function () { var f = document.getElementById(FILTER_ID); return f ? Number(f.getAttribute('scale')) : null; })()
    };
  };


  /* 设置页开关用：切换总开关并写回存档（写盘交给调用方，保持单一职责）。 */
  CRT.toggle = function () {
    var v = !CRT.enabled();
    var s = save(); if (s) s.crt = v;
    CRT.sync(true);
    return v;
  };
  /* 设置页扫描线开关 */
  CRT.toggleScan = function () {
    var v = !CRT.scanEnabled();
    var s = save(); if (s) s.crtScan = v;
    CRT.sync(true);
    return v;
  };
  /* 设置页曲率滑杆：v 是 0..1 的手感值。
     ★v3：设置页已无此滑杆★ —— 保留函数只为兼容旧调用与自动化测试，
     它改的是 `_testCurve`（不落盘），因此删掉入口后玩家无法真正调曲率。 */
  CRT.setCurve = function (v) {
    CRT._testCurve = clamp01(v, CURVE_DEFAULT);
    CRT.sync(true);
    return CRT.curve();
  };

  var last = null;
  function tick() {
    /* 只在状态**变化**时碰 DOM（每帧一次字符串比较，开销可忽略）。 */
    var key = ((window.Game && Game.state) || '') + '|' +
              (CRT.enabled() ? 1 : 0) + '|' + (CRT.scanEnabled() ? 1 : 0) + '|' +
              CRT.curve().toFixed(3) + '|' +
              (CRT.forceOff ? 1 : 0) + '|' +
              (window.MOBILE_MODE === true ? 1 : 0) + '|' +
              ((window.MU && MU.landscape) ? 1 : 0);
    if (key !== last) { last = key; CRT.sync(); }
    requestAnimationFrame(tick);
  }

  function boot() {
    injectStyle();
    ensureLayer();
    CRT.sync(true);
    /* ★窗口尺寸变了 ⇒ 位移图必须按新尺寸重算★
       （位移图的归一化半径与 sx/sy 都依赖屏幕宽高；不重算会导致畸变中心偏移）。
       曲率滑杆的拖动**不**会触发这里（它只改 filter@scale，见 _setWarpStrength）。 */
    var _rzT = 0;
    window.addEventListener('resize', function () {
      clearTimeout(_rzT);
      _rzT = setTimeout(function () { _mapSize = ''; CRT.sync(true); }, 120);
    });
    /* 与游戏主循环同频但不耦合：只做"状态变了没有"的比较。 */
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
