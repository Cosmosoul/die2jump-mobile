'use strict';
/* ============================================================================
   拼死跳跃 · Die to Jump  —— 游戏本体（无任何编辑功能）
   文字使用编辑器同源的位图字体：10 号字 / 0.5 像素块，可在 UI_STYLE 快速调整。
   ========================================================================== */
const UI_STYLE={fontSize:10,pixelSize:0.5,baseWidth:960,baseHeight:600};
const Game=window.Game={state:'boot',levels:[],elapsed:0,simTime:0,selected:0,page:0,tab:0,ready:false,
  toast:null,transition:0,hearts:[],saveKey:'die2jump_game_save_v1',newBest:false,
  /* ── 可操作主菜单（菜单关卡）相关 ── */
  menuLevel:null,menuRecs:[],levels2:[],activeLevels:null,
  menuPopup:null,menuWorldFade:0,menuSwitchActions:[],menuSwitchWas:[],menuIntro:false,menuBoot:1};
var D=D||{};
const ui=document.getElementById('ui'),g=ui.getContext('2d'),access=document.getElementById('accessibility');
/* WS-B v2 基调：**统一靛蓝暗域 + 单一暖金点缀 + 近白墨字**。
   依据（2026-10-10 联网实拍参考，见 docs/reference/）：
     动物井 / 空洞骑士 / 丝之歌 / 闰跃之年 / Baba Is You / 地狱把妹王
   这六款的菜单共同语言是三条，恰好是本版之前做错的：
     ① **文字即 UI**：主菜单没有任何按钮底板/边框/图标，只有字；
     ② **整屏统一色调**：画面全在一个暗色域里，靠 6%~12% 的明度差分层，
        不用描边、不用高光切线、不用铆钉（那些是 RPG 素材包语言）；
     ③ **强调色面积极小**：唯一的高饱和色只出现在"当前项"，占比 < 2%。
   因此本版：面板只保留一张**大圆角柔和暗卡**（无描边高光、四角无装饰），
   主菜单改为**裸文字**，强调色统一收进 C.gold。 */
const C={
  skyInk:'#f2f5fa', skyInkDim:'#c3ccdb',
  ink:'#f4f2ff', inkSoft:'#bdb4d6', inkFaint:'#837a9e',
  /* 暗紫夜域四级：整屏底色到卡片面，只靠明度差分层（赛博朋克配色） */
  night0:'#0a0618', night1:'#150d2a', night2:'#1f1440', night3:'#2c1d55',
  paper:'#18102e', paperHi:'#221640', paperLo:'#0f0820',
  line:'#4a3577', lineLo:'#2a1d4a',
  gold:'#ffcc66', goldHi:'#ffe9a8', goldDeep:'#b4821f',
  /* 霓虹三色：品红 / 青 / 紫（赛博朋克的招牌色，饱和度刻意不过分） */
  neonPink:'#ff4d9d', neonCyan:'#22d3ee', neonViolet:'#a78bfa',
  red:'#ff5577', redDeep:'#8e1d28',
  teal:'#22d3ee', tealHi:'#7dd3e8',
  shadow:'rgba(4,2,12,0.50)',
  edge:'#05030e', well:'#0f0822', face:'#1c1238', faceHot:'#2a1a52'
};
/* 每屏额外的压暗量。
   ⚠️ WS-B v3：**这里已经不需要"盖黑纱"了** —— `sky()` 直接绘制原生暗色夜景
   （深靛夜空 + 冷月 + 星野 + 剪影群山），整幅画面本身就在暗色域里，
   这正是参考（动物井 / 空洞骑士 / 闰跃之年）的做法。
   给亮图盖半透明黑纱只会把插画压成灰糊底、还露出原来的亮蓝天，两头不讨好。
   因此本表数值全部为 0；仅**模态弹窗**保留一点点压暗（让底层画面退后，聚焦弹窗）。 */
const SCRIM={boot:0,menu:0,levels:0,settings:0,help:0,quit:0,
  pause:.16,win:.20,fail:.20,resetConfirm:.34,exitConfirm:.34};
let scale=1,W=960,H=600,last=performance.now(),acc=0,clock=0,buttons=[],pointer={x:-1,y:-1,down:false},dragSlider=null,hoverId='',focusId='',screenKey='';
/* 响应式布局单位（在 resize() 里重算）
   VS：纵向呼吸量。16:9 视口恒为 1（观感与既有版本完全一致）；
       高屏 / 4:3 等纵向更宽的视口放大，把固定面板纵向撑开、居中内容不再缩成一小块。
   HS：横向呼吸量。宽屏 / 超宽屏放大，用于选关网格横向铺开更多卡片。 */
let VS=1,HS=1;
const clone=x=>JSON.parse(JSON.stringify(x));
/* ============================================================================
   WS-B · 界面重制（动效 / 调色 / 无障碍）
   ----------------------------------------------------------------------------
   调研结论（2026-10-10 联网检索，见 docs/四工作流实施规划.md §2）：
     · 时长：hover/press 80~150ms；小元素 150~200ms；面板 250~350ms；页面转场 300~400ms
     · 缓动：进入 ease-out（快进慢停）／离开 ease-in／位移 ease-in-out／循环 linear
     · 曲线只定义 3~5 条，多了风格会散；hover 缩放 1.03~1.06（超过就廉价）
     · press 位移 1~2px；音高随机 0.9~1.1 避免听觉疲劳
     · 无障碍：prefers-reduced-motion 时以淡入淡出替代位移/缩放，不用动画承载唯一信息
   本模块只做「求值 + 曲线」，不持有绘制状态；所有动效都可由 clock 纯函数式推出，
   因此**不引入累积误差、不依赖帧率**（掉帧只会跳帧不会错位）。
   ========================================================================== */
const MOTION=(function(){
  let reduce=false,rmq=null;
  try{rmq=window.matchMedia('(prefers-reduced-motion: reduce)');reduce=!!rmq.matches;
      if(rmq.addEventListener)rmq.addEventListener('change',e=>{reduce=!!e.matches;});}catch(e){}
  return{
    get reduced(){return reduce;},
    dur:ms=>reduce?Math.min(90,ms):ms,
    /* 进入：快进慢停（三次方 ease-out，收敛快、无过冲，比二次方更“干净”） */
    easeOut:t=>{t=t<0?0:t>1?1:t;const u=1-t;return 1-u*u*u;},
    /* 离开：慢起快走 */
    easeIn:t=>{t=t<0?0:t>1?1:t;return t*t*t;},
    /* 位移：两端平滑 */
    easeInOut:t=>{t=t<0?0:t>1?1:t;return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;},
    /* 强调：轻微过冲（只用于“被选中/获得”这类需要强调的瞬间，不用于常规反馈） */
    back:t=>{t=t<0?0:t>1?1:t;const c=1.70158+1;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);},
    /* 最省事的“入场进度”：s 秒前开始、d 秒内完成 */
    at:(startS,s,d)=>{const t=(s-startS)/Math.max(.0001,d);return t<0?0:t>1?1:t;},
    /* 高阻尼弹簧（无过冲），用于 hover 缩放 —— 比裸 lerp 更有生命感又不会“弹” */
    spring:(current,target,dt,k)=>{const kk=k||16;return current+(target-current)*Math.min(1,kk*dt);}
  };
})();
/* 交互音效统一出口：同一交互恒用同一音，只做音高微随机（0.9~1.1）与音量分层。
   一致性 > 丰富度；厚音给主要动作，薄音给次要动作。 */
function snd(name,opt){try{AudioSystem.sfx(name,undefined,undefined,opt);}catch(e){}}
function sndUI(kind){
  if(kind==='hover')snd('uiHover',{rate:0.96+Math.random()*0.08,vol:0.5});
  else if(kind==='press')snd('uiClick',{rate:0.94+Math.random()*0.10,vol:1});
  else if(kind==='confirm')snd('uiClick',{rate:1.06+Math.random()*0.06,vol:1.1});
  else if(kind==='back')snd('uiHover',{rate:0.82+Math.random()*0.06,vol:0.8});
}
/* ★CRT 存档字段★
     · crt      —— 总开关（唯一可调项：设置/暂停页只保留这一枚开关）。
     · crtScan  —— 扫描线开关（★v3 起不再暴露调节入口★，恒为开；
                    旧存档若存过 false 也一律读回 true，保证"保留老旧电视效果"）。
     · crtCurve —— 曲率手感值 0..1（★v3 起不再暴露调节入口★，恒为默认值）。
       保留字段只为兼容旧存档的读写，不再参与 UI；缺省值必须与 crt.js 的
       CURVE_DEFAULT 一致，避免"存的值与实际画的曲率漂移"。 */
function readSave(){try{const v=JSON.parse(localStorage.getItem(Game.saveKey)||'{}');
  return{completed:v.completed||{},best:v.best||{},trophies:v.trophies||{},
    music:Math.max(0,Math.min(1,Number.isFinite(v.music)?v.music:.6)),
    sfx:Math.max(0,Math.min(1,Number.isFinite(v.sfx)?v.sfx:.8)),
    crt:v.crt!==false,
    crtScan:true,
    crtCurve:.45};}
  catch(e){return{completed:{},best:{},trophies:{},music:.6,sfx:.8,crt:true,crtScan:true,crtCurve:.45};}}
Game.save=readSave();
function persist(){try{localStorage.setItem(Game.saveKey,JSON.stringify(Game.save));}catch(e){notify('存档写入失败');}}
function trophyKey(id){return (Game.levels[Game.selected]?.key||'')+'::'+id;}
window.TrophyStore={has:id=>!!Game.save.trophies[trophyKey(id)],
  add(id){Game.save.trophies[trophyKey(id)]=true;persist();AudioSystem.sfx('trophy');notify('获得奖杯 · 已永久收藏');},
  count(){return Object.keys(Game.save.trophies).length;},clear(){Game.save.trophies={};persist();}};
function notify(t){Game.toast={text:String(t),born:clock,until:clock+TOAST_HOLD+TOAST_SLIDE+0.05};}
window.toast=notify;
/* ★局内弹出式小提示（toast）★ —— 右侧边缘偏上、从右侧边缘伸出、1.5s 后收回右侧边缘消失。
   用户原话：「将PC版本游戏局内的拿到旗子插下旗子之类的提示移到界面右侧边缘处偏上方位置区域，
   不遮挡当前任何UI的地方，提示弹出方式为从右侧边缘伸出，1.5s后收回进右侧边缘消失」。
   · 位置：右边缘内缩 14px、顶边 y=74 —— 暂停键在 y16..60（右上）、计时面板居中、
     旗子库存/慢放条在左下、关卡名在右下，全部不遮挡；
   · 动画：0.30s 从右侧边缘外伸入（easeOut）→ 保持至 1.5s → 0.30s 收回进右侧边缘（easeIn）；
   · 宽度按文字实测自适应（150~min(320,W-60)），超宽按实测截断补「…」，绝不溢出屏幕。
   旧的底部居中金条（y=H-104）已退役：它会压住左下角旗子库存与慢放条。 */
const TOAST_HOLD=1.5,TOAST_SLIDE=0.30;
function drawToast(){
  const t=Game.toast;if(!t)return;
  const born=(t.born!=null?t.born:clock-(TOAST_HOLD+TOAST_SLIDE));
  const age=clock-born;
  if(age<0||age>TOAST_HOLD+TOAST_SLIDE)return;
  const mul=1.05,maxW=Math.min(320,Math.max(120,W-60));
  const label=fitName(t.text,maxW-34,mul);
  const w=Math.max(150,Math.min(maxW,textW(label,mul)+34));
  const h=38,x=W-14-w,y=74;
  let p;                                              /* 0=完全在右边缘外，1=完全到位 */
  if(age<TOAST_SLIDE)p=MOTION.easeOut(age/TOAST_SLIDE);
  else if(age<=TOAST_HOLD)p=1;
  else p=1-MOTION.easeIn((age-TOAST_HOLD)/TOAST_SLIDE);
  if(p<=0.004)return;
  const dx=Math.round((1-p)*(w+18));                  /* 伸出/收回的位移量（ px ） */
  g.save();g.globalAlpha=Math.min(1,p);
  panel(x+dx,y,w,h,{tone:'gold',r:10});
  textLeft(label,x+dx+18,y+h/2,C.ink,mul);
  g.restore();
}

/* ---------------------------------------------------------------- 位图文字 */
/* text(s,x,y,color,mul,alpha,outline)：以 (x,y) 为中心绘制。
   `outline` 是**可选的暗色描边**——runtime 的 drawPixelText 原生支持四向描边，
   这里把它接出来。赛博朋克背景（楼宇窗格）对比度极高，裸文字极易被亮点吃掉，
   描边是像素游戏标题的通行解法，比压暗背景更稳且不损失画面。 */
function text(s,x,y,color=C.ink,mul=1,alpha=1,outline=null){g.save();if(alpha!==1)g.globalAlpha=alpha;g.translate(x,y);g.scale(mul,mul);drawPixelText(g,String(s),0,0,UI_STYLE.fontSize,color,null,1,UI_STYLE.pixelSize,outline);g.restore();}
/* text() 默认以 x 为中心；下面两个助手用于左/右对齐排版 */
function textW(s,mul=1){const b=_getPxTextBitmap(String(s),UI_STYLE.fontSize,'#ffffff',UI_STYLE.pixelSize);return b.w*UI_STYLE.pixelSize*mul;}
function textLeft(s,x,y,color=C.ink,mul=1,alpha=1){text(s,x+textW(s,mul)/2,y,color,mul,alpha);}
function textRight(s,x,y,color=C.ink,mul=1,alpha=1){text(s,x-textW(s,mul)/2,y,color,mul,alpha);}
/* ★按可用宽度截断文字（超出补「…」）★
   关卡名可能很长（如「测试关 1 · 基础与危险」）：居中/左对齐绘制会顶出卡片边缘，
   或压到右侧「进入 / 未解锁」上。按实测宽度截断，保证排版不被撑破。 */
function fitName(s,maxW,mul=1){s=String(s==null?'':s);if(textW(s,mul)<=maxW+0.5)return s;const ell='…';let out='';for(let i=0;i<s.length;i++){const t=out+s[i];if(textW(t+ell,mul)>maxW)break;out=t;}return out+ell;}
/* ★放不下时先自动缩字号，仍放不下才截断★
   关卡名是卡片上最醒目的文字，直接截断会让玩家看不到自己的关卡叫什么。
   这里在 [minMul, mul] 之间等比缩小到刚好放下；缩到下限还放不下才补「…」。 */
function fitText(s,maxW,mul=1,minMul=0.78){s=String(s==null?'':s);let m=mul;if(textW(s,m)>maxW){m=Math.max(minMul,m*maxW/textW(s,m));}return {s:fitName(s,maxW,m),mul:m};}
/* ★数字型「每帧都在变」的文字：逐字位图合成★
   典型场景 = 局内 HUD 计时器（`00:12.34`）。若沿用 text() 的**整串**缓存，
   字符串每帧都不同 ⇒ 每帧必然 cache miss ⇒ 每帧新建两个 canvas +
   `getImageData` 回读（GPU→CPU 同步，真机会卡管线）+ O(cols·rows·SS²) 二值化
   双循环（实测 **1.62ms/帧**），而且会把 384 条 FIFO 缓存冲刷干净
   （选关页的关卡名/时间值被驱逐，重进又要冷建）。
   计时器只用 `0-9 : . -` 共 13 个字形 ⇒ 逐字缓存后**稳态零重建、零分配**。
   · 间距正确性：整串渲染的字进 = charWidth + gap；单字位图宽 = ceil((charWidth+SS)/SS)
     个输出列 = (charWidth+SS) 超采样像素。10 号字实测两者都 = 72 超采样像素
     ⇒ 逐字拼接与整串渲染**逐像素吻合**，观感不变（`:`/`.` 差 0.25 列，不可见）。
   · 必须走 text() 同一条路径（translate+scale），保证与其它 UI 文字同一缩放/取整口径。 */
const _monoGlyphCache=new Map();
function _monoGlyph(ch,color){
  const key=ch+'|'+color;
  let v=_monoGlyphCache.get(key);
  if(v)return v;
  const b=_getPxTextBitmap(ch,UI_STYLE.fontSize,color,UI_STYLE.pixelSize);
  v={cv:b.canvas,w:b.w,h:b.h};_monoGlyphCache.set(key,v);return v;
}
function textMono(s,x,y,color=C.ink,mul=1,alpha=1){
  s=String(s);if(!s)return;
  const ps=UI_STYLE.pixelSize;
  let tot=0;const gl=[];
  for(let i=0;i<s.length;i++){const v=_monoGlyph(s[i],color);gl.push(v);tot+=v.w;}
  g.save();if(alpha!==1)g.globalAlpha=alpha;g.imageSmoothingEnabled=false;
  g.translate(x,y);g.scale(mul,mul);
  let cx=-tot*ps/2;
  for(let i=0;i<gl.length;i++){const v=gl[i],tw=v.w*ps;g.drawImage(v.cv,cx,-v.h*ps/2,tw,v.h*ps);cx+=tw;}
  g.restore();
}
function bitmapOf(s,ps){const b=_getPxTextBitmap(String(s),UI_STYLE.fontSize,'#ffffff',ps);return{canvas:b.canvas,w:b.w*ps,h:b.h*ps};}
/* 明快卡通描边：内部金色纵向渐变 + 一圈均匀、克制的深色描边。
   不使用任何背景板；整块缓存，每帧仅一次 drawImage，保证性能。 */
const _styledCache=new Map();
const GOLD=['#ffffff','#fff6c4','#ffcb33','#e08c0e'];
const GOLD_RED=['#fff4f4','#ff9aa2','#e23450','#8e1d28'];
/* ★把"造位图"从"贴位图"里拆出来★
   原因：预热必须在**不污染画面**的前提下，走**与渲染完全相同**的那条代码路径。
   旧版预热是"手工照抄一份字符串/颜色清单"，一旦渲染侧改色值/改字号，
   预热清单就静默失效 —— 实测手机端 header() 走 styledText（渐变金 + basePs 0.25）、
   textLeft() 内部还会调 textW()（白色变体），手工清单全都漏了，
   于是进选关页仍要冷烘 44 个字 ≈ 79ms ⇒ 长任务。拆开后可被预热直接复用。 */
function _styledNormalize(colors){return Array.isArray(colors)&&colors.length>=4?colors:GOLD;}
function _styledKeyOf(s,mul,colors,outline,basePs){
  const cs=_styledNormalize(colors);
  return s+'|'+mul+'|'+cs.join('')+'|'+outline+'|'+basePs;
}
/* 只负责"算并缓存"，不碰 g —— 预热与渲染都调它，保证同一条路径、同一份缓存。 */
function _styledBuild(s,mul,colors,outline,basePs){
  const cs=_styledNormalize(colors);
  const key=_styledKeyOf(s,mul,cs,outline,basePs);
  let out=_styledCache.get(key);
  if(out)return out;
  const b=bitmapOf(s,basePs),w=Math.max(1,Math.round(b.w*mul)),h=Math.max(1,Math.round(b.h*mul));
  const core=document.createElement('canvas');core.width=w;core.height=h;
  const cg=core.getContext('2d');cg.imageSmoothingEnabled=false;cg.drawImage(b.canvas,0,0,w,h);
  cg.globalCompositeOperation='source-in';const gr=cg.createLinearGradient(0,0,0,h);
  gr.addColorStop(0,cs[0]);gr.addColorStop(.46,cs[1]);gr.addColorStop(.52,cs[2]);gr.addColorStop(1,cs[3]);
  cg.fillStyle=gr;cg.fillRect(0,0,w,h);
  /* 深色剪影仅用于描边，颜色偏暖，避免发黑发脏 */
  const mat=document.createElement('canvas');mat.width=w;mat.height=h;const mg=mat.getContext('2d');
  mg.imageSmoothingEnabled=false;mg.drawImage(core,0,0);mg.globalCompositeOperation='source-in';mg.fillStyle='#4a2f06';mg.fillRect(0,0,w,h);
  const o=Math.max(1,Math.round(outline)),pad=o+2;
  out=document.createElement('canvas');out.width=w+pad*2;out.height=h+pad*2;
  const og=out.getContext('2d');og.imageSmoothingEnabled=false;
  for(let dx=-o;dx<=o;dx++)for(let dy=-o;dy<=o;dy++){if(Math.abs(dx)+Math.abs(dy)>o*1.45)continue;og.drawImage(mat,pad+dx,pad+dy);}
  og.drawImage(core,pad,pad);
  _styledCache.set(key,out);
  if(_styledCache.size>64)_styledCache.delete(_styledCache.keys().next().value);
  return out;
}
function styledText(s,cx,cy,mul,colors,outline=2,basePs=0.25){
  const out=_styledBuild(s,mul,colors,outline,basePs);
  g.imageSmoothingEnabled=false;g.drawImage(out,Math.round(cx-out.width/2),Math.round(cy-out.height/2));
}
/* ------------------------------------------------------------- 基础绘制件 */
/* 圆角矩形：改用**真实贝塞尔圆弧**。
   旧版为迁就"全局关抗锯齿"的像素语言，用 2px 阶梯近似圆角 —— 小半径尚可，
   一旦卡片半径 >6px 就会露出明显锯齿，正是"廉价感"的来源之一。
   实测：Canvas 的路径填充**不受** imageSmoothingEnabled 影响，始终带抗锯齿，
   因此大圆角卡片用圆弧既平滑又零额外代价（与像素块、位图文字互不干扰）。 */
function rrect(x,y,w,h,r,c){r=Math.max(0,Math.min(r,Math.floor(Math.min(w,h)/2)));x=Math.round(x);y=Math.round(y);w=Math.round(w);h=Math.round(h);
  if(r<=0){rect(x,y,w,h,c);return;}
  g.fillStyle=c;g.beginPath();
  if(g.roundRect){g.roundRect(x,y,w,h,r);}else{
    g.moveTo(x+r,y);g.lineTo(x+w-r,y);g.quadraticCurveTo(x+w,y,x+w,y+r);
    g.lineTo(x+w,y+h-r);g.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    g.lineTo(x+r,y+h);g.quadraticCurveTo(x,y+h,x,y+h-r);
    g.lineTo(x,y+r);g.quadraticCurveTo(x,y,x+r,y);}
  g.fill();}
function rect(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
/* 极简点缀：一颗 3px 暖金菱点（替换旧版四角铆钉）。
   参考里唯一的装饰就是"一两个小色点"，多了立刻变素材包。 */
function stud(x,y){rect(x,y-1,1,3,C.gold);rect(x-1,y,3,1,C.gold);rect(x,y,1,1,C.goldHi);}
function shadowRect(x,y,w,h){rrect(x+2,y+6,w,h,10,'rgba(2,3,10,0.55)');}
/* 统一暗域：把整屏压进同一个靛蓝暗域，让亮天空只作氛围底。
   一张 1×N 竖向渐变就够（比径向便宜），并缓存为精灵；
   顶部略透、底部略实，模拟"地底光源从上方渗入"的观感（动物井同感）。 */
let _scrimPx=null;
function _scrimFor(a){
  if(_scrimPx&&Math.abs(_scrimPx._a-a)<0.01)return _scrimPx;
  const c=document.createElement('canvas');c.width=1;c.height=256;
  const q=c.getContext('2d');const gr=q.createLinearGradient(0,0,0,256);
  gr.addColorStop(0,`rgba(9,12,24,${(a*0.82).toFixed(3)})`);
  gr.addColorStop(.40,`rgba(10,14,28,${(a*0.94).toFixed(3)})`);
  gr.addColorStop(1,`rgba(6,8,18,${Math.min(1,a*1.08).toFixed(3)})`);
  q.fillStyle=gr;q.fillRect(0,0,1,256);c._a=a;_scrimPx=c;return c;}
function scrim(state){
  const a=SCRIM[state];if(!a)return;
  const sp=_scrimFor(a);
  g.imageSmoothingEnabled=true;g.drawImage(sp,0,0,1,256,0,0,W,H);g.imageSmoothingEnabled=false;
}
/* 柔和暗卡：本版的**唯一**面板语言。
   层级 —— 柔和投影 → 大圆角暗面 → 内侧一道极淡顶缘色线 →（tone=gold/teal 时）霓虹顶缘。
   WS-B v4 加入**入场扫光**：面板首次出现时，一道霓虹光带从左扫到右（380ms，只扫一次）。
   这是"画面是活的"最廉价的一招 —— 无需改变任何静态构图。 */
/* 柔和暗卡：本版的**唯一**面板语言。
   层级 —— 柔和投影 → 大圆角暗面 → 内侧一道极淡顶缘色线 →（tone=gold/teal 时）霓虹顶缘。
   WS-B v4 加入**入场扫光**：面板首次出现时，一道霓虹光带从左扫到右（380ms，只扫一次）。
   这是"画面是活的"最廉价的一招 —— 无需改变任何静态构图。 */
function panel(x,y,w,h,opt={}){const tone=opt.tone||'paper',r=opt.r==null?12:opt.r;
  shadowRect(x,y,w,h);
  /* === 对比度修复（用户反馈"卡片与背景糊在一起"） ===
     根因：旧版是「外壳 + 内缩 2px 的**更暗**内面」，而 C.paper(#18102e)
     比 C.face(#1c1238) 还暗 —— 等于把卡片做成了一块与赛博夜雨背景同色的暗斑，
     完全没有边界；仅靠一条 alpha 0.22 的短顶线根本立不住。
     改为明确的三层结构（无论背景是暗紫楼宇还是霓虹亮斑都清晰可辨）：
       ① 亮描边：外扩 1px 的紫罗兰/金/青 —— 给卡片一条明确边界；
       ② 暗外壳 C.face —— 把卡片从背景里"切"出来；
       ③ 较亮内面 C.paperHi —— 制造"抬起受光"的明度差（比外壳亮一档）。 */
  const edgeCol=tone==='gold'?'rgba(255,204,102,0.46)':tone==='teal'?'rgba(34,211,238,0.42)':'rgba(157,131,228,0.46)';
  const edge2=tone==='gold'?'rgba(255,204,102,0.20)':tone==='teal'?'rgba(34,211,238,0.18)':'rgba(157,131,228,0.20)';
  const face=tone==='gold'?C.faceHot:tone==='teal'?C.faceHot:C.face;
  const inner=(tone==='gold'||tone==='teal')?C.faceHot:C.paperHi;
  /* 三层边界：外晕(2px) + 亮描边(1px) + 暗外壳 + 较亮内面。
     两层递减描边替代 shadowBlur（filter 每帧开销大），零额外代价却同样有"霓虹外晕"感。 */
  rrect(x-2,y-2,w+4,h+4,r+2,edge2);
  rrect(x-1,y-1,w+2,h+2,r+1,edgeCol);
  rrect(x,y,w,h,r,face);
  rrect(x+1,y+1,w-2,h-2,Math.max(2,r-1),inner);
  /* 顶部高光：**整宽渐隐**的亮线（两端淡出），比旧版短硬线更像受光边缘 */
  if(tone==='gold')rect(x+1,y+2,w-2,1,'rgba(255,222,140,0.55)');
  else if(tone==='teal')rect(x+1,y+2,w-2,1,'rgba(150,235,255,0.50)');
  else{const hl=g.createLinearGradient(x,0,x+w,0);
    hl.addColorStop(0,'rgba(214,198,255,0)');hl.addColorStop(.5,'rgba(214,198,255,0.34)');hl.addColorStop(1,'rgba(214,198,255,0)');
    g.fillStyle=hl;g.fillRect(x+1,y+2,w-2,1);}
  /* 入场扫光：页面出现后 0.42s 内，每块面板扫过一道斜向霓虹亮带。
     基准用 `_pageT0`（本页面出场时刻）而不是"面板首次被绘制"——
     后者需要在 map 里记每个面板、且停留久了会反复重扫（踩过这个坑）。 */
  if(!MOTION.reduced&&w>60&&h>36){
    const age=clock-_pageT0;
    if(age>=0&&age<0.42){const p=age/0.42,wx=x-Math.round(w*0.5)+Math.round(w*1.6*p);
      g.save();g.beginPath();g.rect(x,y,w,h);g.clip();
      g.globalCompositeOperation='lighter';g.globalAlpha=(1-p)*0.20;
      const sg2=g.createLinearGradient(wx-40,0,wx+40,0);
      sg2.addColorStop(0,'rgba(167,139,250,0)');sg2.addColorStop(.5,'rgba(210,190,255,0.9)');
      sg2.addColorStop(1,'rgba(167,139,250,0)');
      g.fillStyle=sg2;g.fillRect(wx-40,y,80,h);g.restore();}
  }
}
/* 凹槽（暗色内嵌，用于滑条轨道 / 信息条底）：去描边，只留一层暗面 */
function inset(x,y,w,h){rrect(x,y,w,h,3,C.well);rect(x+3,y+1,w-6,1,'rgba(0,0,0,0.30)');}
function heart(x,y,s=2,color=C.red,broken=0){const map=['01100110','11111111','11111111','01111110','00111100','00011000'];map.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1'){const dx=broken?(i<4?-broken:broken):0;rect(x+i*s+dx,y+j*s+(broken?Math.abs(i-3.5)*broken*.32:0),s,s,color);}}));if(!broken){rect(x+s,y+s,2*s,s,'#ff9aa2');rect(x+2*s,y+3*s,s,s,C.redDeep);}}
function flagIcon(x,y,s=2){rect(x,y,s,10*s,'#4b565f');rect(x+s,y,7*s,4*s,C.gold);rect(x+s,y+s,5*s,s,C.goldHi);rect(x-2*s,y+10*s,5*s,s,'#5f6f4e');}
function icon(name,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);if(name==='trophy')drawTrophyTo(g,{x:-6,y:-7,w:12,h:14});else if(name==='flag')flagIcon(-4,-8,1);else if(name==='heart')heart(-4,-3,1);else if(name==='pause'){rrect(-5,-6,3,12,1,C.ink);rrect(2,-6,3,12,1,C.ink);}else if(name==='lock'){rrect(-6,-1,12,9,2,C.inkSoft);rrect(-4,-6,8,6,3,C.inkSoft);rect(-3,-1,6,8,C.well);rect(-1,1,2,4,C.gold);}else if(name==='back'){for(let i=0;i<5;i++){rect(-7+i,-5+i,2,2,C.ink);rect(-7+i,5-i,2,2,C.ink);}rect(-3,-1,11,2,C.ink);}else if(name==='play'){for(let i=0;i<9;i++)rect(-5+i,-7+i,2,15-2*i,C.gold);}else if(name==='gear'){rect(-5,-5,10,10,C.ink);rect(-2,-9,4,18,C.ink);rect(-9,-2,18,4,C.ink);rect(-2,-2,4,4,C.well);}else if(name==='book'){rect(-7,-6,14,12,C.ink);rect(-5,-4,4,8,C.paperHi);rect(1,-4,4,8,C.paperHi);rect(-1,-6,2,12,C.ink);}else if(name==='exit'){rect(-7,-7,11,14,C.ink);rect(-5,-5,7,10,C.well);rect(0,-1,11,2,C.ink);rect(7,-3,2,6,C.ink);rect(4,-5,2,3,C.ink);rect(4,2,2,3,C.ink);}else if(name==='sound'){rect(-7,-2,4,4,C.ink);rect(-3,-5,3,10,C.ink);rect(1,-7,2,14,C.gold);rect(4,-5,2,10,C.gold);}
  /* ★复古电视三枚图标★（设置页专用：总开关 / 扫描线 / 曲率）
     与其它图标同一规格：以 (0,0) 为中心、约 16×14 的可视盒。 */
  else if(name==='crt'){rect(-8,-7,16,12,C.ink);rect(-6,-5,12,7,C.well);
    rect(-5,-4,10,2,'rgba(255,255,255,0.22)');rect(-8,5,16,1,C.ink);
    rect(-5,6,3,2,C.ink);rect(2,6,3,2,C.ink);}
  else if(name==='scan'){rect(-8,-7,16,14,C.ink);rect(-6,-4,12,1,C.well);
    rect(-6,-1,12,1,C.well);rect(-6,2,12,1,C.well);}
  else if(name==='curve'){rect(-8,-7,16,14,C.ink);
    /* 同心像素圆（外圈=暗角、内圈=中心鼓光）⇒ 一眼读作"球面" */
    const _cr=[[-5,6],[-4,10],[-3,12],[-2,12],[-1,12],[0,12],[1,12],[2,12],[3,10],[4,6]];
    for(const _r of _cr)rect(-_r[1]/2,_r[0],_r[1],1,C.well);
    const _cr2=[[-3,4],[-2,6],[-1,8],[0,8],[1,6],[2,4]];
    for(const _r of _cr2)rect(-_r[1]/2,_r[0],_r[1],1,C.paperHi);
    rect(-3,-3,2,2,C.goldHi);}
  g.restore();}
let _pageT0=0;
function inRect(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
/* ---------- 霓虹涟漪（点击反馈的"视觉回声"） ----------
   每次按下按钮，在落点炸开一圈扩散的霓虹方环（像素风：用 4 段矩形边框画出）。
   与音效（sndUI('press')）同帧触发，视觉与听觉一起给到"我按到了"的确认。
   涟漪只是**加法**：不改变按钮本身的位置/颜色，因此不干扰既有 hover 逻辑。 */
const _ripples=[];
function ripple(x,y,col){if(MOTION.reduced)return;if(_ripples.length>10)_ripples.shift();
  _ripples.push({x,y,t0:clock,col:col||C.neonViolet});}
function drawRipples(){if(!_ripples.length)return;
  for(let i=_ripples.length-1;i>=0;i--){const rp=_ripples[i],age=clock-rp.t0;
    if(age>0.46){_ripples.splice(i,1);continue;}
    const p=age/0.46,rad=14+p*46,al=(1-p)*(1-p)*0.72;
    g.save();g.globalAlpha=al;g.fillStyle=rp.col;
    for(let k=0;k<4;k++){const side=k<2?rad*2:rad*1.1;
      if(k===0){g.fillRect(rp.x-rad, rp.y-rad, side,2);}
      else if(k===1){g.fillRect(rp.x-rad, rp.y+rad-2, side,2);}
      else if(k===2){g.fillRect(rp.x-rad, rp.y-rad, 2, side);}
      else{g.fillRect(rp.x+rad-2, rp.y-rad, 2, side);}}
    g.restore();}
}
/* ---------- 差动入场（stagger） ----------
   把「本轮界面出现后经过的时间」换算成 0→1 的进度，供每个元素按序号错开淡入上浮。
   进度由 clock 推出，掉帧只会跳帧不会卡在半路。seq 越大越晚出场。
   ⚠️ **必须始终调用 draw()**（哪怕进度还是 0）：
   若在进度为 0 时跳过绘制，页面刚出现的那一瞬间该按钮根本不存在 ——
   点击热区与无障碍 DOM 节点都会缺失（看似被输入闸门掩盖，但闸门只对触摸生效，
   鼠标玩家的快速点击会直接落空）。让"按钮始终存在、只有外观在动"才是正确语义。 */
function enterT(seq){if(MOTION.reduced)return 1;
  const t=clock-_pageT0-seq*0.055;if(t<=0)return 0;
  return MOTION.easeOut(Math.min(1,t/0.34));}
function staggerBlock(scale,seq,draw){
  const a=enterT(seq);
  g.save();g.globalAlpha=a;g.translate(0,Math.round((1-a)*14)*scale);draw();g.restore();}
/* 按钮：两种语言，对应参考里的两种真实场景。
   · **裸文字（opt.plain）**——主菜单专用。参考中六款游戏的主菜单都没有按钮底板，
     只有字。选中项靠：字色转暖金 + 左侧一颗小菱点 + 轻微右移 4px（位移而非缩放，
     更克制）。这让菜单从"一组控件"变成"一幅排版好的画面"。
   · **柔和卡片（默认）**——选关页/设置/弹窗等需要明确点击区的地方。
     不再用描边 + 内高光 + 四角铆钉，只保留一张大圆角暗面，hover 时整块微亮。
   文字一律放大（1.34~1.52 倍），这也是"糊/小"问题的直接解法。 */
const _btnH=Object.create(null), _btnX=Object.create(null);
function button(id,label,x,y,w,h,fn,opt={}){const b={id,label,x,y,w,h,fn,disabled:!!opt.disabled,primary:!!opt.primary};buttons.push(b);
  const hot=!b.disabled&&(inRect(pointer,b)||focusId===id);const gold=!!opt.primary;
  /* 弹簧逼近 hover 进度（0=未选中，1=完全选中）。
     注意：**不能**在这里清理失效按钮 —— 本帧 buttons 才刚开始填充，
     那时会把上一帧的进度全清掉 ⇒ hover 永远到不了满值。清理在 rollButtons()。 */
  const prev=_btnH[id]||0;_btnH[id]=MOTION.spring(prev,hot?1:0,1/60,14);
  const hv=MOTION.reduced?(hot?1:0):_btnH[id];
  const px=Math.round((MOTION.reduced?0:4)*hv);      /* 选中右移量（克制） */
  if(opt.plain){
    const on=hot||gold;
    const mul=opt.big?1.94:1.74;
    const col=b.disabled?C.inkFaint:on?C.gold:C.ink;
    /* 裸文字在**高对比像素背景**（赛博朋克楼宇窗格）上会读不清。
       解法不是压暗带（会糊掉背景），而是给文字加一圈**暗色描边**（见 text() 第 7 参）。 */
    text(label,x+w/2+px,y+h/2,col,mul,1,'rgba(5,3,14,0.80)');
    /* 选中标记：左侧一颗暖金菱点（尺寸随 hv 渐显），替代"按钮高亮块" */
    if(!b.disabled&&hv>0.02){const ax=x+w/2-textW(label,mul)/2-20-px;
      g.save();g.globalAlpha=Math.min(1,hv*1.25);
      stud(ax+px,y+h/2);g.restore();}
    return;}
  const dy=hot?(pointer.down?2:-1):0;
  const face=opt.disabled?C.well:hot?C.faceHot:gold?C.faceHot:C.face;
  shadowRect(x,y+dy+2,w,h);
  rrect(x,y+dy,w,h,10,face);
  if(!opt.disabled)rrect(x+2,y+2+dy,w-4,h-4,8,hot?C.paperHi:C.paper);
  /* 选中态：一道极短的金色顶缘，随 hv 渐显（替代旧版的上下双金线） */
  if(hv>0.02&&w>20&&!opt.disabled)rect(x+Math.round(w*0.34),y+dy+1,Math.round(w*0.32*hv),2,C.gold);
  if(opt.icon)icon(opt.icon,x+30+px,y+h/2+dy,1.42);
  text(label,x+w/2+(opt.icon?12:0)+px,y+h/2+dy,opt.disabled?C.inkFaint:C.ink,1.34);}
/* 整帧绘制结束后清理：删掉本帧不再出现的按钮的 hover 进度，
   避免长会话里 map 无限增长（否则每进一个新界面都会留下旧 id）。 */
function rollButtons(){for(const k in _btnH){let found=false;for(let i=0;i<buttons.length;i++)if(buttons[i].id===k){found=true;break;}if(!found)delete _btnH[k];}}
function syncAccess(){const key=buttons.map(b=>b.id+'|'+b.x+'|'+b.y+'|'+b.w+'|'+b.h+'|'+b.disabled).join(';');if(key===screenKey)return;screenKey=key;access.replaceChildren();for(const b of buttons){const el=document.createElement('button');el.id=b.id;el.setAttribute('aria-label',b.label);el.title=b.label;el.disabled=b.disabled;el.style.cssText=`left:${b.x*scale}px;top:${b.y*scale}px;width:${b.w*scale}px;height:${b.h*scale}px`;el.onfocus=()=>focusId=b.id;el.onblur=()=>focusId='';el.onclick=()=>activate(b.id);access.appendChild(el);}}
/* ---- 输入闸门：防止「界面切换瞬间的连点」穿透到下一层界面 ----
   触屏上这一点尤其明显：在旧界面按下、界面已换掉、手指抬起时落在新界面的
   按钮上，于是新人物的第一个动作莫名其妙地被执行了（例：在菜单点「设置」，
   连点第二下正好命中设置页的「清除存档」）。

   策略（严格按需求划分）：
   · 【局外各界面】菜单 / 选关 / 设置 / 说明 / 确认弹窗 —— 切换后短暂屏蔽点击；
   · 【局内外衔接处】进入关卡、暂停、胜负结算 —— 同样屏蔽一小段，避免进场
     瞬间就误触局内按键；
   · 【局内 playing】不做任何处理 —— 只要状态没变，闸门自然过期，
     移动 / 跳跃 / 插旗等操作保持原始灵敏度。

   闸门按 `clock`（主循环时钟）计时，因此在任何机型、任何帧率下时长一致。

   闸门**只对触摸类输入（touch / pen）生效**：鼠标落点精确，不存在
   “手指抬起时界面已换掉”的穿透问题，因此 PC 端不做任何延时屏蔽，
   保持即点即应的手感（也避免把键盘/鼠标玩家误伤成“点了没反应”）。 */
let gateUntil=0;
let gateArmed=false;     /* 本次输入是否为触摸类；由 pointerdown 的 pointerType 决定 */
const GATE_UI=0.30;      /* 局外界面之间切换后的基础屏蔽时长（秒） */
const GATE_ENTER=0.36;   /* 进入关卡后的基础屏蔽时长（秒） */
const GATE_BURST=0.30;   /* 连点续闸：每挡下一次，窗口从该次重新起算（秒） */
function gateNow(sec){gateUntil=Math.max(gateUntil,clock+sec);}
/* 标记“本次输入属于触摸/手写笔”。鼠标落点精确、不会穿透，所以不设闸门。
   局内按键会 stopPropagation，window 收不到它们的 pointerdown，
   因此在那边也直接调用本函数来标记。 */
function armGate(pointerType){gateArmed=(pointerType==='touch'||pointerType==='pen');}
/* 是否处于屏蔽窗口。
   固定时长在“连点末次刚好压线”时会随机漏一次点击（实测只差 30ms 就会穿透），
   所以这里改成**查询并续闸**：只要还有点击落在窗口内，说明用户仍在同一串
   连点里，就把窗口从“本次”重新起算，保证整串连点都被挡下。
   关键性质——窗口永远从“本次点击”起算，因此它离当下最多 GATE_BURST 远，
   不会随连点次数累积。玩家一停手，最多 GATE_BURST 后就恢复响应，不存在锁死。 */
function gated(){
  if(!gateArmed||clock>=gateUntil)return false;
  gateUntil=Math.max(gateUntil,clock+GATE_BURST);
  return true;
}
function activate(id){const b=buttons.find(v=>v.id===id);if(!b||b.disabled||fxBusy||gated())return;sndUI('press');
  /* 按下瞬间在**控件中心**炸开霓虹涟漪（视觉与听觉同帧确认）；键盘/焦点触发也在中心。
     Ctrl/Cmd+点击视为"新标签打开"，不产生涟漪，避免误触感的视觉噪声。 */
  if(!fxBusy&&b)ripple(b.x+b.w/2,b.y+b.h/2,b.primary?C.neonPink:C.neonViolet);
  pointer.down=false;b.fn();}
/* ---- 场景切换：状态落地 + shader 遮罩转场 ---- */
let fxBusy=false;
let Entering=false;   /* 正在进入关卡（防重入） */
/* 转场白名单：只在「进出关卡选择页」与「进出关卡」时播放遮罩转场。
   主菜单 ↔ 设置/说明/退出/确认弹窗 这类同层页面切换一律瞬时完成，
   避免频繁闪烁、也让转场只在真正跨越页面时才出现、更有分量。
   （进入关卡由 begin() 单独负责，见下方注释。） */
function fxEdge(from,to){
  if(to==='levels')return from!=='levels';   /* 进入选关页：主菜单 / 暂停 / 胜负页 → 选关 */
  if(to==='menu')return from==='levels';     /* 离开选关页：选关 → 主菜单 */
  return false;                              /* 其余页面切换不转场 */
}
function fxEnabled(){return !!(window.SceneFX&&SceneFX.enabled());}
function applyState(state){Game.state=state;Game.transition=fxEnabled()?0:1;screenKey='';focusId='';Play.keys={};const gaming=['playing','pause','win','fail'].includes(state);D.playScreen.classList.toggle('active',gaming);Play.active=gaming;
  /* 离开「可操作主菜单」：只要新状态不再是 playing，就清掉 menuMode 与菜单弹窗，
     防止菜单状态泄漏到选关 / 设置 / 结算等其它界面。 */
  if(typeof Play!=='undefined'&&Play&&state!=='playing'){Play.menuMode=false;Game.menuPopup=null;}
  /* 记录本界面的"出场时刻"：差动入场（staggerBlock）与面板扫光都以它为基准 */
  _pageT0=clock;
  /* 回到启动页时重置开机序列（正常流程只会经历一次，这里是防御性处理） */
  if(state==='boot'){_bootT0=-1;_bootSkip=false;bootArmed=false;}
  /* 落地新界面后开启输入闸门：局外页面切换用 UI 时长，进出关卡用稍长的时长。
     局内（playing 且来源也是局内）不加闸门，保持操作灵敏。 */
  gateNow(state==='playing'?GATE_ENTER:GATE_UI);
  /* 局内（playing/win/fail）保持关卡音乐连续（不因结算页而硬切到菜单主题，避免突兀）；
     仅 pause→pause 主题、quit→静音、其余页面→菜单主题。
     ★BOSS 战期间必须保持 BOSS 主题★：否则「暂停 → 继续」会把场景强制切回 'level'，
     而 runtime 的幂等闩锁 `Play._bossBgmOn` 仍是 true ⇒ `_pbossBgm(true)` 被拦下，
     本场战斗再也听不到 BOSS 曲（`_bugscan.cjs` 实证：onResume=['level'] 且闩锁卡死）。 */
  const _bossAwake=(typeof Play!=='undefined'&&Play&&Play.boss&&Play.boss.state==='awake');
  /* 当前关卡的来源集可能是 levels2，因此优先取 activeLevels，保证 BGM 种子正确。 */
  const _cur=(Game.activeLevels&&Game.activeLevels[Game.selected])||Game.levels[Game.selected];
  AudioSystem.setScene((state==='playing'||state==='win'||state==='fail')?(_bossAwake?'boss':'level'):state==='pause'?'pause':state==='quit'?'silent':'menu',_cur?_cur.lv:null);}
function change(state,opts){opts=opts||{};
  /* 「返回主菜单」一律进入可操作关卡式主菜单（menu 关卡）；若该关卡文件缺失则退回选关页。
     ★手机端不在本范围内★：mobile 没有 menu-level.js，保持旧版文字菜单。 */
  if(state==='menu'){
    if(window.MOBILE_MODE){applyState('menu');return;}
    if(Game.menuLevel)enterMenuLevel(false);else applyState('levels');return;}
  const from=Game.state;
  /* 只有跨越页面（进出选关页）的切换才播遮罩转场；其余瞬时切换。
     统一在遮罩“全遮”那一刻才落地新状态（onSwap），避免先看到新页面再被遮罩扫过。 */
  if(!fxEnabled()||opts.immediate||!fxEdge(from,state)){applyState(state);return;}
  const mode=opts.mode||SceneFX.mode();
  /* 节奏放慢：简单遮罩 0.85s、华丽遮罩 1.35s（原 0.55/0.9 偏快） */
  const dur=opts.dur||((SceneFX.isFancy&&SceneFX.isFancy(mode))?1.35:0.85);
  fxBusy=true;
  SceneFX.play(mode,dur,()=>applyState(state)).then(()=>{fxBusy=false;});
}
function formatTime(v){if(!Number.isFinite(v))return '--:--.--';const m=Math.floor(v/60),s=(v%60).toFixed(2).padStart(5,'0');return String(m).padStart(2,'0')+':'+s;}
function unlocked(i){return i===0||!!Game.save.completed[Game.levels[i-1]?.key];}
function unlockedLevel(recs,i){return i===0||!!Game.save.completed[recs[i-1]?.key];}
/* 进入关卡（按来源数组）：menu 关卡之外的真实关卡统一入口。
   begin(i) 始终作用于「当前正在玩的来源集」(Game.activeLevels)，
   因此从 menu 关卡点开选关 → 进真实关卡、或关卡内「重玩本关 / 下一关」都能正确定位。
   enterLevel 同时清除 menuMode 并关闭菜单弹窗，保证从可操作主菜单切到真实关卡时状态干净。 */
async function begin(i){return enterLevel(Game.activeLevels||Game.levels,i);}
async function enterLevel(recs,i){
  if(!recs||!recs[i]||!unlockedLevel(recs,i)||Entering)return;Entering=true;
  try{Game.activeLevels=recs;Game.selected=i;const lv=recs[i].lv;
    if(AudioSystem&&AudioSystem.trackReady&&!AudioSystem.trackReady('level',lv)){
      /* 兜底加载页：出现时至少停留 2s，避免一闪而过；正常预热下不会走到这里 */
      if(window.Loading){Loading.show();Loading.setProgress(0.12);}
      let fin=false;const p=AudioSystem.ensureTrack?AudioSystem.ensureTrack('level',lv):Promise.resolve();
      const guard=new Promise(r=>setTimeout(r,900));await Promise.race([p,guard]);if(window.Loading)Loading.setProgress(0.95);
      if(window.Loading){Loading.done();await Loading.waitMin();}
    }
    Game.elapsed=0;Game.simTime=0;Game.hearts=[];Game.newBest=false;
    /* ★LevelContext.levels 必须是「稀疏数组」★ */
    if(!LevelContext.levels||LevelContext.levels.length!==recs.length){
      LevelContext.levels=new Array(recs.length);}
    LevelContext.levels[i]=lv;LevelContext.currentIdx=i;FEEL=sanitizeFeel(lv.feel);
    const doEnter=()=>{if(typeof Play!=='undefined'&&Play){Play.boss=null;Play._bossBgmOn=false;Play.menuMode=false;Game.menuPopup=null;}applyState('playing');Play.menuMode=false;startPlay();updateCamera(Play.cam,Play.player,Play.worldBounds,Play.camOffset);AudioSystem.setListener(Play.player);AudioSystem.sfx('respawn');acc=0;if(window.Loading)Loading.hide();};
    const fromPage=!['playing','pause'].includes(Game.state);
    if(fromPage&&fxEnabled()&&!fxBusy){fxBusy=true;const m=SceneFX.mode();const d=(SceneFX.isFancy&&SceneFX.isFancy(m))?1.45:0.95;await SceneFX.play(m,d,doEnter);fxBusy=false;}
    else{doEnter();}
  }finally{Entering=false;}
}
function pause(){if(Game.state==='playing')change('pause');else if(Game.state==='pause'){change('playing');AudioSystem.update(Play.player,Play,0);}}
function victory(){if(Game.state!=='playing')return;const r=Game.levels[Game.selected],old=Game.save.best[r.key];Game.newBest=!Number.isFinite(old)||Game.elapsed<old;Game.save.best[r.key]=Math.min(old??Infinity,Game.elapsed);Game.save.completed[r.key]=true;persist();change('win');AudioSystem.sfx('win');}
function resetProgress(){Game.save={completed:{},best:{},trophies:{},music:.6,sfx:.8,crt:true,crtScan:true,crtCurve:.45};persist();AudioSystem.setVolumes(.6,.8);if(window.CRT)CRT.setCurve(.45),CRT.sync(true);change('settings');notify('存档已清空');}
function slider(id,label,x,y,w,val,set){textLeft(label,x,y,C.inkSoft,1.14);const bar={x:x+118,y:y-10,w,h:22};buttons.push({id,label:label+' '+Math.round(val*100)+'%',...bar,slider:true,fn:()=>set(Math.max(0,Math.min(1,(pointer.x-bar.x)/w)))});
  rrect(bar.x,bar.y+6,w,10,5,C.well);
  const fill=w*val;if(fill>1){rrect(bar.x,bar.y+6,fill,10,5,C.gold);rect(bar.x+3,bar.y+8,Math.max(1,fill-6),3,C.goldHi);}
  rrect(bar.x+fill-8,bar.y,16,22,8,C.goldHi);rect(bar.x+fill-4,bar.y+4,3,14,'#fffdf0');
  text(Math.round(val*100)+'%',bar.x+w+58,y+6,C.ink,1.20);if(dragSlider===id)set(Math.max(0,Math.min(1,(pointer.x-bar.x)/w)));}
function setVol(k,v){Game.save[k]=v;AudioSystem.setVolumes(Game.save.music,Game.save.sfx);persist();}
function keyboard(key,x,y,w=54,fs=1.05){rrect(x,y,w,32,8,C.well);text(key,x+w/2,y+15,C.inkSoft,fs);}

/* ------------------------------------------------------ 夜空 · 群山 · 月光 */
/* 性能关键：静态图层（夜空/明月/星野/银河/群山/森林/遗迹/山丘/地面/暗角）只烘焙一次到
   离屏画布，每帧仅重绘动态的薄云、月光束。全量重绘约 320ms/帧，现降到 1~3ms/帧。

   ⚠️ WS-B v3 设计变更：**不再用"亮蓝天 + 半透明黑纱"**。
   参考（动物井 / 空洞骑士 / 闰跃之年）的高级感来自「整幅画面本身就画在暗色域里」，
   而不是给亮图盖一层纱 —— 盖纱会把插画压成灰糊底，还要露出原来的亮蓝天，
   两头不讨好。因此这里直接重绘一套**原生暗色夜景**：深靛夜空 + 冷月 + 星野 +
   剪影群山，层级全靠**明度压缩**表达（近处最暗，远处略亮），与参考同法。 */
const sceneCanvas=document.createElement('canvas');sceneCanvas.width=480;sceneCanvas.height=300;const sg=sceneCanvas.getContext('2d');
const _skyBG=document.createElement('canvas');_skyBG.width=480;_skyBG.height=300;
const _skyVig=document.createElement('canvas');_skyVig.width=480;_skyVig.height=300;
let _skyBaked=false;const _cloudSprites=new Map();
/* ---------- WS-B v4：赛博朋克夜景 · 调色与工具 ----------
   混合模式只允许用 **multiply / destination-in** —— 它们不会抬起透明像素的 alpha。
   `screen`（可分离混合模式）会把 alpha=0 的区域也点亮，精灵立刻显出一块矩形底板。 */
function _nightGrade(cv,strength){
  const w=cv.width,h=cv.height,q=cv.getContext('2d');q.save();
  q.globalCompositeOperation='multiply';
  const gr=q.createLinearGradient(0,0,0,h);
  gr.addColorStop(0,'#3a2260');gr.addColorStop(.55,'#4a2a6e');gr.addColorStop(1,'#5b3a80');
  q.globalAlpha=strength;q.fillStyle=gr;q.fillRect(0,0,w,h);q.restore();}
function _gradeSprite(cv,strength){
  const m=document.createElement('canvas');m.width=cv.width;m.height=cv.height;
  m.getContext('2d').drawImage(cv,0,0);
  _nightGrade(cv,strength);
  const q=cv.getContext('2d');q.save();q.globalCompositeOperation='destination-in';q.drawImage(m,0,0);q.restore();}
/* 雾团：像素云原语调成暗紫，靠 multiply 压进夜色（云顶自然受光，无需画边） */
function _cloudSprite(w,h){w=Math.round(w);h=Math.round(h);const key=w+'x'+h;let s=_cloudSprites.get(key);if(s)return s;
  s=document.createElement('canvas');s.width=w+8;s.height=h+16;
  const lay=document.createElement('canvas');lay.width=s.width;lay.height=s.height;const q=lay.getContext('2d');
  _psCloud(q,4,12,w,h,'#6b5a9e','#3a2a60',1);
  _gradeSprite(lay,0.94);
  s.getContext('2d').drawImage(lay,0,0);
  s._ox=4;s._oy=10;_cloudSprites.set(key,s);return s;}
function _bakeSky(){
  const c=_skyBG.getContext('2d');
  /* ===== WS-B v4：赛博朋克雨夜 =====
     美术语言：**暗紫夜空 + 霓虹塔楼天际线 + 光污染辉光 + 雨丝**。
     参考对象是《赛博朋克 2077》《Blade Runner》《VA-11 HALL-A》的夜景构成，
     但保持像素语言（塔楼窗格是 2×2 像素、招牌是横向像素条）。
     分层顺序：天空渐变 → 光污染辉光 → 远塔 → 近塔（含霓虹招牌）→ 地面水洼反光。
     所有"霓虹"都刻意只用低饱和的冷紫 / 青 / 品红三种，避免花成圣诞树。 */
  const NEO=['#ff4d9d','#22d3ee','#a78bfa','#f472b6','#38bdf8'];
  const gr=c.createLinearGradient(0,0,0,300);
  gr.addColorStop(0,'#0a0618');gr.addColorStop(.30,'#140c2c');
  gr.addColorStop(.58,'#221444');gr.addColorStop(.80,'#341c56');gr.addColorStop(1,'#4a2560');
  c.fillStyle=gr;c.fillRect(0,0,480,300);
  /* 光污染：地平线附近的三团大范围霓虹辉光 —— 赛博夜景"空气里有光"的关键 */
  [[96,'#7c3aed',.30],[268,'#e0398a',.24],[398,'#0ea5e9',.20]].forEach(([gx,gcol,ga])=>{
    const gg=c.createRadialGradient(gx,258,4,gx,258,190);
    gg.addColorStop(0,`${gcol}`);gg.addColorStop(1,'rgba(0,0,0,0)');
    c.save();c.globalAlpha=ga;c.fillStyle=gg;c.fillRect(gx-190,68,380,380);c.restore();});
  /* 星野：赛博夜空的星比自然夜空更稀（光污染冲淡）—— 只留 90 颗 */
  for(let i=0;i<90;i++){
    const s1=_pr(i*2.7+1),s2=_pr(i*5.1+9),s3=_pr(i*3.3+17);
    c.fillStyle=`rgba(216,226,255,${(0.12+0.48*s3).toFixed(3)})`;
    c.fillRect(Math.round(s1*480),Math.round(s2*s2*150),s3>.94?2:1,s3>.94?2:1);}
  /* ---------- 塔楼生成器 ----------
     每栋楼：主体暗紫 → 左侧受霓虹侧光（1px 亮边）→ 窗格（亮 / 灭随机，
     靠 `_pr` 确定性决定，且有 8% 的"闪烁窗"在逐帧里单独点）→ 部分楼顶加霓虹招牌横条。 */
  const tower=(x,w,h,seed,depth)=>{
    const top=300-h;
    const body=depth===0?'#120a22':depth===1?'#160e2c':'#0d0719';
    c.fillStyle=body;c.fillRect(x,top,w,h);
    /* 左侧受光边：远处塔楼被身后霓虹照亮 */
    c.fillStyle=depth===0?'rgba(167,139,250,0.34)':'rgba(124,58,237,0.22)';
    c.fillRect(x,top,1,h);
    c.fillStyle='rgba(0,0,0,0.26)';c.fillRect(x+w-1,top,1,h);
  /* 窗格：3×2 像素、行距 7、列距 6（比第一版稀一倍）——
     赛博朋克夜景的高级感来自"大面积暗楼 + 稀疏窗光"，
     窗太密会变成一张"星空地毯"，反而糊掉天际线轮廓。 */
    const litCols=NEO[Math.floor(_pr(seed*3.7)*NEO.length)];
    const off=depth===0?0.66:depth===1?0.78:0.88;
    c.fillStyle='rgba(255,238,180,0.92)';
    for(let wy=top+5;wy<294;wy+=7){
      for(let wx=x+4;wx<x+w-4;wx+=6){
        const r=_pr(wx*1.7+wy*3.1+seed*13);
        if(r<off)continue;
        if(r>0.965){c.fillStyle=litCols;}else if(r>0.925){c.fillStyle='rgba(180,220,255,0.72)';}
        else{c.fillStyle='rgba(255,230,158,0.78)';}
        c.fillRect(wx,wy,3,2);}}
    /* 楼顶霓虹招牌：横向短条（赛博朋克的城市名片）。只有少数楼有，避免"招牌森林" */
    if(_pr(seed*7.3)>0.80){const sw=Math.min(w-4,Math.round(w*(0.42+_pr(seed*2.1)*0.4)));
      const sx=x+Math.round((w-sw)/2),sc=NEO[Math.floor(_pr(seed*5.9)*NEO.length)];
      c.save();c.globalAlpha=.80;c.fillStyle=sc;c.fillRect(sx,top-7,sw,2);
      c.globalAlpha=.26;c.fillRect(sx-2,top-9,sw+4,6);c.restore();}
    /* 天线 + 顶端航空警示灯（红点，逐帧闪） */
    if(_pr(seed*4.4)>0.74){c.fillStyle='#241a3c';c.fillRect(x+Math.round(w/2)-1,top-16,2,16);
      c.save();c.globalAlpha=.9;c.fillStyle='#ff3355';c.fillRect(x+Math.round(w/2)-1,top-18,2,2);c.restore();}
  };
  /* 远景塔群（矮、暗、窗少）→ 中景（高、亮）→ 近景（最高、最暗、只作剪影） */
  let sd=11;for(let x=-10;x<490;){const w=22+Math.round(_pr(sd*1.3)*26);tower(x,w,66+Math.round(_pr(sd*2.7)*54),sd,2);x+=w+3+Math.round(_pr(sd*3.1)*7);sd++;}
  sd=71;for(let x=-14;x<490;){const w=30+Math.round(_pr(sd*1.7)*34);tower(x,w,104+Math.round(_pr(sd*2.3)*78),sd,1);x+=w+5+Math.round(_pr(sd*3.9)*10);sd++;}
  sd=131;for(let x=-20;x<490;){const w=40+Math.round(_pr(sd*1.9)*44);tower(x,w,138+Math.round(_pr(sd*2.9)*92),sd,0);x+=w+8+Math.round(_pr(sd*4.3)*14);sd++;}
  /* 近景剪影：两栋贴脸的黑塔 + 空调外机方块，把画面压住（不点火，纯暗） */
  c.fillStyle='#0b0718';c.fillRect(-6,150,74,150);
  c.fillStyle='#0e0920';c.fillRect(404,124,86,176);
  c.fillStyle='#150e28';for(let k=0;k<5;k++)c.fillRect(20,196+k*26,12,8);
  c.fillStyle='#170f2c';c.fillRect(416,150,24,16);c.fillRect(452,206,22,14);
  /* 地面：湿沥青 + 霓虹倒影（倒影用竖向拖尾的极淡色条，像素里读作"积水反光"） */
  c.fillStyle='#0a0616';c.fillRect(0,282,480,18);
  c.save();c.globalAlpha=.30;
  [[96,'#7c3aed'],[268,'#e0398a'],[398,'#0ea5e9']].forEach(([gx,gcol])=>{const rg=c.createLinearGradient(0,282,0,300);
    rg.addColorStop(0,gcol);rg.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=rg;c.fillRect(gx-30,282,60,18);});
  c.restore();
  c.save();c.globalAlpha=.22;c.fillStyle='#d8b4fe';
  for(let i=0;i<40;i++){const r=_pr(i*2.3);if(r<.6)continue;c.fillRect(Math.round(_pr(i*3.7)*480),283+Math.round(_pr(i*5.1)*14),1+Math.round(_pr(i*7.3)*2),1);}
  c.restore();
  /* 暗角：冷紫，压边不压中 */
  const vc=_skyVig.getContext('2d');
  const vig=vc.createRadialGradient(240,150,110,240,150,344);
  vig.addColorStop(0,'rgba(0,0,0,0)');vig.addColorStop(.66,'rgba(8,4,18,0.18)');vig.addColorStop(1,'rgba(4,2,12,0.52)');
  vc.fillStyle=vig;vc.fillRect(0,0,480,300);
  _skyBaked=true;}
/* 场景合成：把 480×300 的赛博夜景合成为一张图（PC 与手机版**共用**这一段）。
   手机版只需按竖屏的缩放/裁切方式把它贴出去，不必复制一份着色源码 ——
   这样两版永远同一色系，不会再出现"手机版是暖色、电脑版是冷色"的漂移。 */
function _composeScene(t){
  if(!_skyBaked)_bakeSky();
  sg.setTransform(1,0,0,1,0,0);sg.clearRect(0,0,480,300);
  sg.drawImage(_skyBG,0,0);
  /* 低空雾团：暗紫、少而小，慢速横移（赛博夜景的雾，不是白天的云） */
  for(let i=0;i<5;i++){const x=((i*151+t*(.60+(i%3)*.44))%720)-180,y=150+(i%3)*36,w=90+(i%3)*34,h=30+(i%2)*12;
    const sp=_cloudSprite(w,h);sg.drawImage(sp,Math.round(x-sp._ox),Math.round(y-sp._oy));}
  /* 霓虹辉光扫动：三盏大范围色光缓慢左右漂移，让塔楼"被光扫过"（这是动态感的主要来源） */
  sg.save();sg.globalCompositeOperation='screen';
  [[96,'167,58,237'],[268,'224,57,138'],[398,'14,165,233']].forEach(([gx,rgb],i)=>{
    const cx=gx+Math.sin(t*(.09+i*.035)+i*2.1)*46;
    const gg=sg.createRadialGradient(cx,250,2,cx,250,150);
    gg.addColorStop(0,`rgba(${rgb},0.16)`);gg.addColorStop(1,`rgba(${rgb},0)`);
    sg.fillStyle=gg;sg.fillRect(cx-150,100,300,300);});
  sg.restore();
  /* 雨：斜向雨丝（逐帧位置由 clock 推函数算出，不累积状态 ⇒ 掉帧不错位）。
     分两档：细密小雨 + 少量长雨，只有 60+26 条，代价可忽略。 */
  sg.save();sg.globalAlpha=.34;sg.fillStyle='#cbb6ff';
  for(let i=0;i<60;i++){
    const s1=_pr(i*1.7),s2=_pr(i*3.1+5),s3=_pr(i*5.3+11);
    const span=340, y=((s1*span+t*(210+s2*180))%span)-40;
    const x=((s2*520+t*(58+s3*46))%540)-30;
    sg.fillRect(Math.round(x),Math.round(y),1,2+Math.round(s3*4));}
  sg.globalAlpha=.50;sg.fillStyle='#e6dcff';
  for(let i=0;i<26;i++){
    const s1=_pr(i*2.9+61),s2=_pr(i*4.7+83),s3=_pr(i*6.1+97);
    const span=340, y=((s1*span+t*(300+s2*220))%span)-40;
    const x=((s2*520+t*(70+s3*54))%540)-30;
    sg.fillRect(Math.round(x),Math.round(y),1,7+Math.round(s3*9));}
  sg.restore();
  /* 塔楼窗的闪烁：只在**整屏静态塔图之上**补少量随机亮点（每帧 6 个），
     代价极低却让"城市是活的"——这是赛博夜景最廉价有效的动态。 */
  sg.save();
  for(let i=0;i<6;i++){
    const s=_pr(Math.floor(t*7)*13.7+i*29.3);
    const x=8+Math.round(_pr(i*7.1+Math.floor(t*7)*3.3)*464);
    const y=140+Math.round(_pr(i*11.3+Math.floor(t*7)*5.7)*132);
    sg.fillStyle=s>.5?'rgba(255,238,180,0.85)':'rgba(167,139,250,0.75)';
    sg.fillRect(x,y,2,2);}
  sg.restore();
}
function sky(){_composeScene(clock);
  g.imageSmoothingEnabled=false;g.drawImage(sceneCanvas,0,0,W,H);}
/* 霓虹全息圆环：启动页与菜单的"主题图形"。
   一圈沿圆周分布的霓虹点 + 每点外扩的辉光 + 缓慢自转 —— 呼应"死亡留下幽灵"的环形回响。 */
function holoRing(cx,cy,r,alpha){
  if(alpha<=.01)return;const t=clock;
  g.save();g.globalAlpha=alpha;
  g.globalCompositeOperation='lighter';
  for(let i=0;i<56;i++){
    const a=i/56*Math.PI*2+t*.22;
    const rr=r+Math.sin(i*1.7+t*1.6)*2.4;
    const px=cx+Math.cos(a)*rr,py=cy+Math.sin(a)*rr*0.42;
    const s=0.35+0.65*(0.5+0.5*Math.sin(i*2.3-t*2.1));
    const col=i%3===0?'#ff4d9d':i%3===1?'#22d3ee':'#a78bfa';
    g.globalAlpha=alpha*(0.30+0.55*s);
    g.fillStyle=col;g.fillRect(Math.round(px),Math.round(py),2,2);}
  g.restore();}
/* 标题：参考六款游戏的做法 —— **只用字**，不做渐变描边浮雕。
   改为"近白墨字 + 一层极淡的深色投影"，靠字号与留白立住，而不是靠描边撑。
   标题背后叠一圈**霓虹全息环**（呼应"死亡留下幽灵"的环形回响），作为主题图形。 */
function titleBlock(cx,cy,k){holoRing(cx,cy-Math.round(6*k),Math.round(168*k),0.60);
  styledText('拼 死 跳 跃',cx,cy-Math.round(12*k),k*2.42,TITLE_COL,2.6,0.25);renderSubtitle(cx,cy+Math.round(56*k),k);}
function renderSubtitle(cx,cy,k){const label='D I E   T O   J U M P';
  const bw=Math.round(300*k);
  text(label,cx,cy,C.inkSoft,Math.max(.9,1.05*k));
  rect(cx-bw/2-40,cy-1,16,2,'rgba(255,77,157,0.80)');rect(cx+bw/2+24,cy-1,16,2,'rgba(34,211,238,0.80)');}
/* 标题配色：近白 → 极淡暖白，几乎不渐变（渐变越弱越"高级"） */
const TITLE_COL=['#ffffff','#fdfaf0','#f4e6c2','#e9d9ad'];

/* ------------------------------------------------------------- 启动 / 主菜单 */
/* 启动页的「开机时间线」：以首次进入 boot 的时刻为 0，各元素按时序淡入。
   总时长 1.55s（调研建议 1.2~1.8s），任意输入可跳过 —— 跳过不是“瞬间显示”，
   而是把时间线快进到末尾，仍然完成一次干净的淡入，观感不突兀。
   PC 与手机版共用这一条时间线（手机版 boot 由 mobile-ui.js 覆写，但复用本函数）。 */
let _bootT0=-1,_bootSkip=false;
const BOOT_T={logo:0.05,sub:0.34,line:0.62,tag:0.80,hint:1.05,ver:1.30,end:1.55};
function bootProgress(){
  if(_bootT0<0)_bootT0=clock;
  const t=(_bootSkip?BOOT_T.end:clock-_bootT0);
  const EN=(s,d)=>{const k=MOTION.at(s,t,d);return MOTION.reduced?k:MOTION.easeOut(k);};
  return{raw:t,logo:EN(BOOT_T.logo,.50),sub:EN(BOOT_T.sub,.38),line:EN(BOOT_T.line,.34),
         tag:EN(BOOT_T.tag,.44),hint:EN(BOOT_T.hint,.42),ver:EN(BOOT_T.ver,.50),vig:Math.max(.18,Math.min(1,EN(0,.9)))};
}
/* 启动页的公共层（标题/副标题/分隔线/标语/提示/版本号/暗角），PC 与手机版共用。
   传入 H 相关位置用比例表达，两版即使画布尺寸不同也能保持同一构图比例。 */
function bootCommon(L,cy,W2,H2,opt){
  opt=opt||{};
  const hintY=opt.hintY==null?H2*.82:opt.hintY, hintS=opt.hint||'按 任 意 键 开 始';
  const dy=MOTION.reduced?0:(1-L.logo)*10;
  /* 标题放大后必须同步拉开后续元素间距，否则副标题会被标题下缘压住（实测 2.64 倍时重叠 8px）。 */
  if(L.logo>0){g.save();g.globalAlpha=L.logo;styledText('拼 死 跳 跃',W2,cy-H2*.070+dy,2.64,TITLE_COL,1.6,0.25);g.restore();}
  const sw=(L.raw-0.28)/0.45;
  if(sw>0&&sw<1&&!MOTION.reduced){const x0=W2-280+560*sw;g.save();g.globalAlpha=.42*Math.sin(sw*Math.PI);
    rect(x0-30,cy-H2*.070-34,30,68,'rgba(255,255,255,.42)');g.restore();}
  if(L.sub>0){g.save();g.globalAlpha=L.sub;text('D I E   T O   J U M P',W2,cy+H2*.012+((MOTION.reduced?0:(1-L.sub)*8)),C.inkSoft,1.20,1,'rgba(5,3,14,0.75)');g.restore();}
  if(L.line>0){g.save();g.globalAlpha=L.line;const lw=Math.round(W2*.26*L.line);rect(W2-lw/2,cy+H2*.052,lw,1,'rgba(255,77,157,0.46)');g.restore();}
  if(L.tag>0){g.save();g.globalAlpha=L.tag;text('每一次陨落，都是下一次起跳的回响',W2,cy+H2*.094+((MOTION.reduced?0:(1-L.tag)*6)),C.inkSoft,1.02,1,'rgba(5,3,14,0.72)');g.restore();}
  if(L.hint>0){const pulse=.40+.60*(.5+.5*Math.sin(clock*2.2));g.save();g.globalAlpha=pulse*L.hint;
    text(hintS,W2,hintY,C.ink,1.34,1,'rgba(5,3,14,0.78)');g.restore();}
  if(L.ver>0){const v=opt.version||'v1.0 · 独立游戏版';
    g.save();g.globalAlpha=.40*L.ver;if(opt.versionCenter)text(v,W2,opt.versionY==null?H2-16:opt.versionY,C.inkFaint,.82);else textRight(v,W2-20,H2-16,C.inkFaint,.82);g.restore();}
  if(L.vig>.02){g.save();g.globalAlpha=.44*L.vig;const gr=g.createRadialGradient(W2,H2*.44,H2*.20,W2,H2*.44,H2*.98);
    gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(6,2,16,0.74)');g.fillStyle=gr;g.fillRect(0,0,W2,H2);g.restore();}
}
/* 浮尘粒子：局外界面（菜单/选关）的“空气感”。位置由 clock 纯函数推出，
   不累积状态 ⇒ 掉帧不会错位；预算固定 26 颗 × 2 次 fillRect，代价可忽略。 */
function motes(cx0,cy0,cw,ch,n,seed){
  const a=clock*0.5;
  for(let i=0;i<n;i++){
    const s=_pr(seed+i*3.7),s2=_pr(seed+i*7.1+11),s3=_pr(seed+i*5.3+23);
    const x=cx0+((s*cw+a*(6+s2*16))%(cw));
    const y=cy0+((s2*ch - a*(8+s3*22))%ch+ch)%ch;
    const tw=.22+.5*(.5+.5*Math.sin(clock*(1.1+s3*1.6)+i));
    const r=s3>.86?2:1;
    rect(x,y,r,r,`rgba(216,180,254,${(tw*.46).toFixed(3)})`);
  }
}
let bootArmed=false;
/* 音频解锁 + 音量 + 后台预热：PC / 手机共用。绝不阻塞界面切换。 */
async function _bootGoMenu(){
  await Promise.race([AudioSystem.init(),new Promise(r=>setTimeout(r,220))]).catch(()=>{});
  AudioSystem.setVolumes(Game.save.music,Game.save.sfx);
  try{if(AudioSystem.prewarm)_lazyPrewarm();}catch(e){}
}
async function startGame(){
  /* ★PC 新版：启动页就是菜单关卡本身★（世界隐藏 + 运镜拉近，见 enterMenuLevel(true)）——
     首次任意输入不再是"切换页面"，只是"开始揭示"：渐显世界 + 相机拉回设置机位。 */
  if(!window.MOBILE_MODE&&Game.menuIntro){Game.menuIntro=false;bootArmed=true;_bootSkip=true;Play.keys={};_bootGoMenu();return;}
  if(Game.state!=='boot'||bootArmed)return;bootArmed=true;_bootSkip=true;
  await _bootGoMenu();
  if(window.MOBILE_MODE){change('menu',{noFx:true});return;}   /* 手机：本范围为 PC 专属，走旧版文字菜单 */
  enterMenuLevel(true);
}
/* 启动页标题（可淡出）：上半屏像素大字 "Die to Jump"（每字母黑边白字、依次缓慢上下浮动）。
   withHint 为 true 时附底部"点击任意键开始游戏"呼吸提示。
   ★启动页就是菜单关卡本身（世界隐藏 + 运镜拉近）★：标题只是浮在真实游戏画面上的一层文字。 */
function drawBootTitle(alpha,withHint){
  const t=clock;
  const title='Die to Jump';
  const mul=Math.max(1.7,Math.min(2.5,(W-100)/110));
  const ws=[];let total=0;for(const ch of title){const w=textW(ch,mul);ws.push(w);total+=w+5;}
  let x=W/2-total/2;const cy=H*0.28;
  g.save();g.globalAlpha=alpha;
  for(let i=0;i<title.length;i++){
    const ch=title[i];
    if(ch!==' '){
      const float=Math.sin(t*1.3+i*0.55)*10;                    /* 每字符依次缓慢上下浮动 */
      text(ch,x+ws[i]/2,cy+float,'#ffffff',mul,1,'#000000');    /* 黑边白字 */
    }
    x+=ws[i]+5;
  }
  if(withHint){const pulse=.55+.45*(.5+.5*Math.sin(t*2.2));     /* 底部提示呼吸 */
    g.save();g.globalAlpha=alpha*pulse;
    text('点击任意键开始游戏',W/2,H*0.88,'#ffffff',1.18,1,'#000000');
    g.restore();}
  g.restore();
}
/* 启动页兜底页（仅手机 / 菜单关卡缺失时再现）：开机序列时间线，与手机版共用同一函数。 */
function boot(){
  /* 开机序列（独立游戏式）：logo → 副标题 → 分隔线 → 标语 → 提示 → 版本号，
     逐级 ease-out 淡入 + 上浮；logo 处一道光扫（克制，只扫一次）。
     实现全部在 bootProgress()/bootCommon()，手机版 boot 直接复用（避免两套源码漂移）。 */
  bootCommon(bootProgress(),H*.40,W/2,H);
}
/* 主菜单：**裸文字版式**（参考六款游戏的主菜单全部如此）。
   不再有按钮底板 —— 四行文字纵向排列，选中项转暖金 + 左侧菱点 + 右移 4px。
   版式上把标题压到偏上（.175），菜单块居中偏下，底部留大片负空间。
   唯一补偿：文字带下铺一层**局部柔和暗压**（不是整屏盖纱！），
   只把文字所在的纵向区间压暗一点点，保证裸文字在纹理背景上依然读得清 ——
   空洞骑士 / 动物井的标题区也都是这么局部压的。 */
function menu(){skyMotes();titleBlock(W/2,H*.175,1.06);
  const step=74,h=60,y=Math.round(H*.43);
  textBandHalo(H*.175-56,H*.175+70);      /* 标题带 */
  textBandHalo(y-18,y+step*3+h+18);       /* 菜单带 */
  const items=[['chooseLevels','选择关卡','flag',()=>change('levels'),false],
    ['settings','设置','gear',()=>change('settings'),false],
    ['help','游戏说明','book',()=>change('help'),false],
    ['exit','退出游戏','exit',()=>change('exitConfirm'),false]];
  items.forEach(([id,label,ic,fn,primary],j)=>staggerBlock(1,j,()=>
    button(id,label,W/2-210,y+j*step,420,h,fn,{primary,plain:true,big:true})));}
/* 文字带柔和暗压：上下各 40px 渐隐，中段略实（峰值仅 .30，只是"把背景往后推"）。
   与整屏 scrim 的区别：这是**局部**的，画面四周的夜景插画完全不受影响。 */
function textBandHalo(y0,y1){const hh=Math.round(y1-y0);if(hh<=0)return;
  const c=document.createElement('canvas');c.width=1;c.height=8;const q=c.getContext('2d');
  const gr=q.createLinearGradient(0,0,0,8);
  gr.addColorStop(0,'rgba(5,8,18,0)');gr.addColorStop(.30,'rgba(5,8,18,0.30)');
  gr.addColorStop(.70,'rgba(5,8,18,0.30)');gr.addColorStop(1,'rgba(5,8,18,0)');
  q.fillStyle=gr;q.fillRect(0,0,1,8);
  g.drawImage(c,0,0,1,8,0,Math.round(y0),W,hh);}
/* ============================================================================
   ★可操作主菜单（菜单关卡）★
   把"启动页 + 主菜单"整体改造成一个可操作的关卡：玩家在关卡里走动、跳到开关上
   打开对应悬浮弹窗。实现完全复用现有引擎（runtime.js 不动），所有逻辑在 PC 专用
   的 game.js 里；菜单关卡通过 Play.menuMode 区分：无敌 / 无限命 / 无 HUD /
   不触发终点胜利 / 沿用主菜单 BGM / 打开弹窗时冻结关卡。
   ========================================================================== */
/* 进入菜单关卡：把 menu-level.js 喂给引擎（startPlay 只读 LevelContext），
   设 menuMode、无限命、菜单 BGM。withIntro=true 时进入"启动页"相位：
   ★启动页就是本关卡本身★ —— 只是隐藏了背景图层与砖块平台（menuWorldFade=0）、
   把相机拉近紧绷在主角身上（viewTarget 收窄）、主角悬浮在出生点不降落；
   玩家首次任意输入后开始"揭示"（drawMenuBootOverlay → frame 里的运镜分支）：
   渐显世界 + 相机丝滑拉回设置机位，随后主角自然下落、进入可操作主菜单。 */
function enterMenuLevel(withIntro){
  withIntro=(withIntro!==false);
  if(!Game.menuLevel){change('levels');return;}
  Game.menuPopup=null;Game.menuPopupT=0;
  const rec=Game.menuLevel,lv=rec.lv;
  LevelContext.levels=new Array(Math.max(1,Game.levels.length));
  LevelContext.currentIdx=0;LevelContext.levels[0]=lv;
  FEEL=sanitizeFeel(lv.feel);
  Game.selected=0;Game.activeLevels=Game.levels;Game.elapsed=0;Game.simTime=0;Game.hearts=[];
  applyState('playing');                       /* 激活游戏画布 + 置 state='playing' */
  AudioSystem.setScene('menu',null);           /* 菜单关卡沿用主菜单 BGM，不播关卡自身 BGM */
  startPlay();
  Play.menuMode=true;
  Play.lives=9999;Play.maxLives=9999;           /* 无敌 + 无限命 */
  Play.energy=1;Play.slowWarn=0;
  Play.goals=[];                               /* 菜单关卡无"通关"概念：抽掉终点，避免误触胜利横幅 */
  /* 运镜两个机位：设置机位（关卡自带 viewTarget，缺省 300×100）与紧绷机位（120×80）。 */
  Game._menuBaseVW=Play.cam.viewTargetW;Game._menuBaseVH=Play.cam.viewTargetH;
  if(withIntro){
    Game.menuIntro=true;Game.menuBoot=0;Game.menuWorldFade=0;   /* 启动页：等首次输入 */
    _menuCamFrame(0);
  }else{
    Game.menuIntro=false;Game.menuBoot=1;Game.menuWorldFade=1;  /* 直接可操作 */
  }
  buildMenuSwitchMap();
  Game.menuSwitchWas=new Array(Play.switches.length).fill(false);
  try{AudioSystem.setListener(Play.player);AudioSystem.sfx('respawn');}catch(e){}
  acc=0;
}
/* 菜单运镜一步：e=0 紧绷机位（拉近），e=1 设置机位（拉回）。每帧调用，保持相机框住主角。
   ★启动页（e=0）主角精确居中★：位于画面中心、标题文字正下方（用户明确要求）。
   揭示开始后交回引擎的死区跟随相机（带 lerp），从居中机位丝滑滑到设置机位，不跳变。 */
function _menuCamFrame(e){
  const bvw=Game._menuBaseVW||300,bvh=Game._menuBaseVH||100;
  Play.cam.viewTargetW=bvw+(120-bvw)*(1-e);
  Play.cam.viewTargetH=bvh+(80-bvh)*(1-e);
  if(D.playCanvas)updateCameraView(Play.cam,D.playCanvas);
  updateCamera(Play.cam,Play.player,Play.worldBounds,Play.camOffset);
  if(e<=0){
    /* 启动页：主角精确居中（标题正下方）。世界边界钳制与引擎完全一致
       （关卡世界顶已抬高，出生点不再贴顶，钳制不会把主角顶出画面）。 */
    const p=Play.player,cam=Play.cam,b=Play.worldBounds;
    cam.x=p.x+p.w/2-cam.viewW/2;cam.y=p.y+p.h/2-cam.viewH/2;
    if(b){
      if(b.maxX-b.minX<=cam.viewW)cam.x=(b.minX+b.maxX)/2-cam.viewW/2;
      else cam.x=Math.max(b.minX,Math.min(b.maxX-cam.viewW,cam.x));
      if(b.maxY-b.minY<=cam.viewH)cam.y=(b.minY+b.maxY)/2-cam.viewH/2;
      else cam.y=Math.max(b.minY,Math.min(b.maxY-cam.viewH,cam.y));
    }
  }
}
/* 开关 → 功能 的映射：按"最近文字标签的文本"决定（以文字为准，不以触发标签为准）。
   这样改关卡文件里的标签文字即可改功能，无需改代码。 */
function menuActionForLabel(t){
  switch(t){
    case '按键说明':return 'keyhelp';
    case '开始游戏':return 'levels';
    case '设置':return 'settings';
    case '退出游戏':return 'exitConfirm';
    case '玩法说明':return 'rules';
    case '成就':return 'achievements';
    case '更多关卡':return 'levels2';
    default:return null;
  }
}
function buildMenuSwitchMap(){
  const lv=(Game.menuLevel&&Game.menuLevel.lv)||{elements:[]};
  const sws=(lv.elements||[]).filter(e=>e.type==='switch');
  const lbs=(lv.elements||[]).filter(e=>e.type==='label');
  Game.menuSwitchActions=sws.map(sw=>{
    let best=null,bd=Infinity;
    for(const lb of lbs){const dx=(sw.x+sw.w/2)-(lb.x+lb.w/2),dy=(sw.y+sw.h/2)-(lb.y+lb.h/2);const d=dx*dx+dy*dy;if(d<bd){bd=d;best=lb;}}
    return menuActionForLabel(best?best.text:'');
  });
}
function openMenuPopup(type){if(!type)return;Game.menuPopup=type;Game.menuPopupT=0;Play.keys={};Game.menuPopupPage=0;}
function closeMenuPopup(){Game.menuPopup=null;Game.menuPopupT=0;Play.keys={};}
/* 开关检测：玩家"真正踩上开关"（落地 grounded）的上升沿才打开弹窗；半空中掠过不触发。
   弹窗打开时冻结（不检测触发）；关闭弹窗后须离开开关再踩入（wasOn 已记录为 true）才重开，
   避免站在开关上反复打开界面。 */
function updateMenuSwitches(){
  if(!Play.menuMode||!Play.switches)return;
  const p=Play.player;if(!p)return;
  if(Play.won)Play.won=false;                  /* 防御：菜单关卡不应有任何胜利判定 */
  for(let i=0;i<Play.switches.length;i++){
    const sw=Play.switches[i],box={x:sw.x,y:sw.y-4,w:sw.w,h:sw.h+6};
    /* ★必须真正落到开关上（grounded）才算按下，空中踩到的不算★ */
    const on=(p.grounded===true)&&rectsOverlap(p,box);
    if(on&&!Game.menuSwitchWas[i]&&!Game.menuPopup){Game.menuSwitchWas[i]=true;openMenuPopup(Game.menuSwitchActions[i]);return;}
    Game.menuSwitchWas[i]=on;
  }
}
/* 悬浮弹窗：冻结的菜单关卡（或游戏画面）之上盖一层压暗，再画对应界面。
   ★开启动效：内容从屏幕中间向两边展开（水平裁剪）。★ */
function drawMenuPopup(){
  const e=Game.menuPopupT||0, a=Math.min(1,e*1.8);
  g.save();g.fillStyle='rgba(6,4,16,'+(0.58*a)+')';g.fillRect(0,0,W,H);g.restore();  /* 压暗底层，随动效淡入 */
  const half=(W/2+2)*Math.min(1,e);                       /* 从中间向两边展开的宽度 */
  g.save();g.beginPath();g.rect(W/2-half,0,half*2,H);g.clip();
  switch(Game.menuPopup){
    case 'levels':drawLevelSelect(Game.activeLevels||Game.levels,'选择关卡',false);break;
    case 'levels2':drawLevelSelect(Game.levels2,'更多关卡',true);break;
    case 'settings':settings(false);break;
    case 'keyhelp':drawKeyHelp();break;
    case 'rules':drawRules();break;
    case 'achievements':achievements();break;
    case 'exitConfirm':confirmScreen('exitConfirm');break;
  }
  g.restore();
}
/* 局外面板的“空气感”：浮尘 + 极淡顶部光晕（只在菜单与选关页调用，局内不调用） */
function skyMotes(){motes(0,0,W,H*.94,26,7);}
function header(title,sub){button('back','返回',28,30,116,44,()=>{if(Game.menuPopup){closeMenuPopup();}else{change('menu');}},{icon:'back'});text(title,W/2,54,C.ink,1.92,1,'rgba(5,3,14,0.78)');if(sub)text(sub,W/2,84,C.inkSoft,1.10,1,'rgba(5,3,14,0.70)');}
function trophyPlate(ex,ey,taken,total){const w=228,h=52,x=ex-w,y=ey;panel(x,y,w,h,{tone:'gold'});icon('trophy',x+36,y+h/2,2.1);text('奖杯',x+80,y+21,C.inkSoft,1.06);text(`${taken} / ${total}`,x+176,y+32,C.ink,1.42);}
/* --------------------------------------------------------------- 选择关卡 */
function drawLevelSelect(recs,title){
  header(title,'');
  /* ★预热对准当前这份 recs★（主菜单浮窗可能开的是 levels2「更多关卡」，与 Game.levels
     不是同一批）。drawLevelSelect 每帧都会被调用，这里只在不一致时纠偏一次（零开销）。
     不发这个指令时，levels2 的缩略图永远焐不到 ⇒ 黑框。 */
  if(_prewarmRecs!==recs){_prewarmRecs=recs;_prewarmHdrDone=false;_prewarmI=0;}
  /* ★奖杯计数已移至「成就」界面；选关页（含菜单内弹窗）不再常驻显示★ */
  const per=colsPerRow(),start=Game.page*per,gap=28,cw=Math.min(258,(W-190-gap*(per-1))/per),ch=Math.min(300,H-244),y=Math.max(114,(H-ch)/2+16),count=Math.min(per,Math.max(0,recs.length-start)),offset=(W-(cw*count+gap*Math.max(0,count-1)))/2;
  if(!recs.length){panel(W/2-250,y+20,500,120);text('尚无可用关卡',W/2,y+70,C.ink,1.36);}
  for(let j=0;j<per;j++){const i=start+j,r=recs[i];if(!r)continue;const x=offset+j*(cw+gap),on=unlockedLevel(recs,i);
    panel(x,y,cw,ch);
    const pad=16,iw=cw-pad*2,th=Math.round(iw*150/340);          /* 按 preview 原始比例，不拉伸 */
    rrect(x+pad,y+pad,iw,th,8,C.well);
    /* ★用 peekPreview（只读缓存）而不是 r.preview★ */
    const _pv=peekPreview(r);
    if(_pv)g.drawImage(_pv,x+pad,y+pad,iw,th);
    rrect(x+pad,y+pad,iw,th,8,'rgba(8,12,24,0.34)');
    rect(x+pad,y+pad,iw,28,'rgba(6,9,18,0.66)');
    if(!on){rrect(x+pad,y+pad,iw,th,8,'rgba(6,9,18,0.80)');icon('lock',x+cw/2,y+pad+th/2,2.9);}
    text(String(i+1).padStart(2,'0'),x+pad+18,y+pad+15,C.goldHi,1.30);
    if(Game.save.completed[r.key]){const cxm=x+cw-pad-46;rect(cxm,y+pad+15,2,2,'rgba(134,217,201,0.9)');
      text('已通关',x+cw-pad-38,y+pad+15,'rgba(134,217,201,0.82)',.96);}
    const btnH=42,btnY=y+ch-pad-btnH;
    const statY=btnY-26;
    const _nm=fitText(r.lv.name,cw-14,1.60);
    text(_nm.s,x+cw/2,statY-56,on?C.ink:C.inkFaint,_nm.mul,1,'rgba(5,3,14,0.70)');
    textLeft('最快时间',x+pad+2,statY,C.inkFaint,.96);
    textRight(formatTime(Game.save.best[r.key]),x+cw-pad-2,statY,
      Number.isFinite(Game.save.best[r.key])?C.goldHi:C.inkSoft,1.44);
    button('level-'+i,on?'进入':'未解锁',x+22,btnY,cw-44,btnH,()=>enterLevel(recs,i),{primary:on,disabled:!on,icon:on?'play':'lock'});}
  const by=H-82,pages=Math.max(1,Math.ceil(recs.length/per));
  if(pages>1){button('pagePrev','◀',W/2-190,by,62,38,()=>{Game.page--;if(recs===Game.levels)refocusPreviewPrewarm();},{disabled:Game.page===0});text(`第 ${Game.page+1} / ${pages} 页`,W/2,by+19,C.inkSoft,1.20);button('pageNext','▶',W/2+128,by,62,38,()=>{Game.page++;if(recs===Game.levels)refocusPreviewPrewarm();},{disabled:Game.page>=pages-1});}}
function levels(){skyMotes();drawLevelSelect(Game.levels,'选择关卡');}
/* 像素木纹填充：横向木板 + 细纹 + 板缝 + 顶部高光，呈现"木纹展示橱窗"质感。 */
function woodFill(x,y,w,h,r){
  r=r||10;_rrPath(g,x,y,w,h,r);g.fillStyle='#49301a';g.fill();
  const plankH=Math.max(12,Math.floor(h/7));
  for(let yy=0;yy<h;yy+=plankH){
    const ph=Math.min(plankH,h-yy), py=y+yy;
    g.fillStyle=(((yy/plankH)|0)%2)?'#52351c':'#442c16';g.fillRect(x+1,py,w-2,ph);
    g.fillStyle='rgba(20,11,5,0.55)';g.fillRect(x,py,w,1);                 /* 木板缝 */
    for(let gx=x+5;gx<x+w-3;gx+=9){g.fillStyle='rgba(28,15,7,0.35)';g.fillRect(gx,py+3+((gx*5)%Math.max(2,ph-5)),3,1);}
  }
  g.fillStyle='rgba(255,224,176,0.12)';g.fillRect(x,y,w,2);                /* 顶部高光 */
  g.strokeStyle='#2a1809';g.lineWidth=2;_rrPath(g,x,y,w,h,r);g.stroke();
}
/* ─────────────────────────────── 成就界面 ───────────────────────────────
   像素木纹展示橱窗：读取 levels.js / levels2.js 内全部内置奖杯；已获得高亮（暖金辉光），
   未获得灰显；每枚下方仅显示颁发它的关卡（★绝不展示 id★），
   levels2 内置奖杯来源标为「隐藏关xx」；右上角显示 已得 / 总数。 */
function achievements(){
  header('成就','');
  const list=[];
  const scan=(recs,hidden)=>{if(!recs)return;recs.forEach(r=>{(r.trophyIds||[]).forEach(id=>{
    const el=(r.lv&&r.lv.elements)?r.lv.elements.find(e=>e.type==='trophy'&&e.id===id):null;
    const src=hidden?('隐藏关'+r.order):(r.name||('第 '+r.order+' 关'));   /* 只显示出处关卡 */
    list.push({key:r.key+'::'+id,src,earned:!!Game.save.trophies[r.key+'::'+id]});});});};
  scan(Game.levels,false);scan(Game.levels2,true);
  const taken=list.filter(t=>t.earned).length;
  textRight(taken+' / '+list.length,W-34,54,C.goldHi,1.42);               /* 右上角：已得 / 总数 */
  if(!list.length){const yy=Math.max(150,(H-90)/2);panel(W/2-180,yy,360,80);text('暂无奖杯',W/2,yy+44,C.ink,1.3);return;}
  const cols=Math.max(4,Math.min(8,Math.floor((W-110)/132))),gap=14;
  const cell=Math.min(132,(W-110-gap*(cols-1))/cols);
  const rows=Math.ceil(list.length/cols);
  const gridH=rows*(cell+gap)-gap;
  const startY=Math.max(96,Math.min(H-gridH-40,(H-gridH)/2+20));
  const sx=(W-(cols*cell+(cols-1)*gap))/2;
  /* 木纹展示橱窗外框 */
  const pad=18, bx=sx-pad, by=startY-pad, bw=cols*cell+(cols-1)*gap+pad*2, bh=gridH+pad*2;
  woodFill(bx,by,bw,bh,14);
  for(let i=0;i<list.length;i++){
    const t=list[i],c=i%cols,rr=Math.floor(i/cols);
    const x=sx+c*(cell+gap),y=startY+rr*(cell+gap);
    _rrPath(g,x,y,cell,cell,8);                                     /* 每枚奖杯一个木格 */
    g.fillStyle=t.earned?'rgba(255,210,120,0.18)':'rgba(10,7,4,0.46)';g.fill();
    g.strokeStyle=t.earned?'#ffcf6e':'#1c1109';g.lineWidth=2;_rrPath(g,x,y,cell,cell,8);g.stroke();
    if(t.earned){g.save();g.shadowColor='#ffcf6e';g.shadowBlur=12;g.globalAlpha=1;icon('trophy',x+cell/2,y+cell*0.34,1.9);g.restore();}
    else{g.save();g.globalAlpha=0.32;icon('trophy',x+cell/2,y+cell*0.34,1.9);g.restore();}
    /* ★只显示出处关卡，绝不显示 id★ */
    const ss=fitText(t.src,cell-12,0.84);
    text(ss.s,x+cell/2,y+cell*0.80,C.inkFaint,ss.mul,1);
  }
}
/* ----------------------------------------------------------- 设置 / 暂停 */
/* ══════════════════════════════════════════════════════════════════════════
   ★设置页的「列对齐」规范★

   用户原话：「设置里的扫描线开关和镜头畸变调整的UI要对齐要注重整体排版，
              你现在的版本没对齐很丑！！」

   ▍旧版为什么丑（根因，不是"再挪几像素"能解决的）
     · 音量行用 `slider()`，它的**标签**画在 `x+0`、**滑条**画在 `x+118`
       —— 即 slider 内部的偏移是写死的；
     · 而 CRT 开关直接用 `button()` 摆在 `x+100`（想跟滑条对齐），
       但它的标签是按钮**自己的文字**，居中在按钮里 ⇒ 标签与滑条行的标签
       根本不在同一列；
     · 于是屏幕上出现三条互不对齐的左缘（音量标签 / 按钮文字 / 滑条），
       再加一个单独的齿轮图标，视线上完全散掉。

   ▍本版的做法：**只允许两条左缘**
     · 标签列 `LBL_X`：每行说明文字的左缘，**全部**贴在这里；
     · 控件列 `CTRL_X`：滑条轨道左端 / 开关按钮左缘，**全部**贴在这里。
     行基线（`ry`）等距排列（48px），右侧留同一列读数（`%`）。
     两列 + 一个预览窗，构成"左标签 | 控件 | 读数 | 预览"的四段式网格。
   ══════════════════════════════════════════════════════════════════════════ */
function _rrPath(c,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.floor(Math.min(w,h)/2)));x=Math.round(x);y=Math.round(y);
  w=Math.round(w);h=Math.round(h);
  c.beginPath();
  if(c.roundRect){c.roundRect(x,y,w,h,r);return;}
  c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
}
/* ★已删除「实时预览」小窗（crtPreview）★
   用户原话：「为啥要在设置里塞一个小窗预览啊？我觉得很没必要，还占地方」。
   v2 起球面感来自**游戏画面本身**的真几何畸变（见 crt.js 的 WARP_MAX_K 段注释），
   拖「屏幕曲率」滑杆时整屏画面实时变化 —— 玩家直接看着真实画面调，
   不再需要一块等比缩放的假预览（它反而占了 170×100 的宝贵版面）。 */
/* 一行：标签（左对齐到 LBL_X）
   ★标签**不再由控件自己画**★（旧版正是"滑条内部画标签 + 按钮居中画文字"
   导致三条左缘错位）。现在标签与控件彻底解耦，各自锚在自己的列上。 */
function uiLabel(label,lx,ry){
  textLeft(label,lx,ry,C.inkSoft,1.10);
}
/* 一行：滑条（轨道左端锚在 CTRL_X，读数锚在 CTRL_END 右对齐） */
function uiSlider(id,lx,ry,barX,barW,endX,val,set){
  const bh2=22;
  buttons.push({id,label:id,x:Math.round(barX),y:Math.round(ry-bh2/2),w:Math.round(barW),h:bh2,slider:true,
    fn:()=>set(Math.max(0,Math.min(1,(pointer.x-barX)/barW)))});
  rrect(barX,ry-5,barW,10,5,C.well);
  const fill=barW*val;
  if(fill>1){rrect(barX,ry-5,fill,10,5,C.gold);rect(barX+3,ry-3,Math.max(1,fill-6),3,C.goldHi);}
  rrect(barX+fill-8,ry-11,16,22,8,C.goldHi);
  rect(barX+fill-4,ry-7,3,14,'#fffdf0');
  /* 读数**右对齐到 endX**（而不是像旧版那样"滑条右端 + 固定 58px"）——
     这样无论面板多宽，所有读数都在同一条右缘上。 */
  textRight(Math.round(val*100)+'%',endX,ry+6,C.ink,1.20);
  if(dragSlider===id)set(Math.max(0,Math.min(1,(pointer.x-barX)/barW)));
}
/* 一行：开关（按钮左缘锚在 CTRL_X，宽度与滑条轨道一致 ⇒ 左缘严丝合缝） */
function uiToggle(id,label,btnX,ry,btnW,on,fn,disabled){
  button(id,label,btnX,ry-20,btnW,40,fn,{primary:!!on&&!disabled,disabled:!!disabled});
}
function settings(paused=false){
  /* ★暂停态 = 悬浮窗★：恢复正式的悬浮面板（用户明确要求"没有悬浮窗口非常难看"），
     只保留音乐/音效两条滑条 + 三枚按钮；"返回选关"打开与主菜单同款的选关浮窗
     （进入可操作主菜单，其内"返回"回到可操作主菜单，而不是重启）。 */
  const pw=Math.min(620,W-40);
  const ph=300;
  const x=(W-pw)/2;
  const y=Math.max(10,(H-ph)/2);
  if(!paused)header('设置','');
  panel(x,y,pw,ph);                                   /* 悬浮窗口展板（窗口之外才是无背景的游戏画面） */
  text('设置',W/2,y+42,C.ink,1.72);
  rect(x+pw*0.30,y+66,pw*0.40,1,'rgba(167,139,250,0.34)');
  const narrow=pw<560;
  const PAD_R=30;                 /* 面板右侧统一内边距 */
  const LBL_X=x+(narrow?56:78);
  const LBL_W=Math.max(textW('音乐音量',1.10),textW('音效音量',1.10));
  const CTRL_X=LBL_X+LBL_W+18;
  const RD_RES=58;                /* 读数（百分比）预留宽度 */
  const CTRL_END=x+pw-PAD_R;
  const BAR_W=Math.max(96,CTRL_END-CTRL_X-RD_RES);
  const RD_X=CTRL_END;
  const RY_V1=y+128, RY_V2=RY_V1+56;   /* 仅两行音量，行距 56 保持舒适 */
  /* ---- 音量两行 ---- */
  icon('sound',x+42,RY_V1,1.42);
  uiLabel('音乐音量',LBL_X,RY_V1+6);
  uiSlider('musicSlider',LBL_X,RY_V1,CTRL_X,BAR_W,RD_X,Game.save.music,v=>setVol('music',v));
  icon('sound',x+42,RY_V2,1.42);
  uiLabel('音效音量',LBL_X,RY_V2+6);
  uiSlider('sfxSlider',LBL_X,RY_V2,CTRL_X,BAR_W,RD_X,Game.save.sfx,v=>setVol('sfx',v));
  /* ---- 底部 ---- */
  if(paused){
    const by=y+ph-66, bw=Math.max(108,(pw-90)/3);
    button('resume','返回游戏',x+28,by,bw,44,()=>pause(),{primary:true,icon:'play'});
    button('returnLevels','返回选关',x+28+bw+15,by,bw,44,()=>{change('menu');openMenuPopup('levels');},{icon:'flag'});
    button('replayLevel','重玩本关',x+28+2*(bw+15),by,bw,44,()=>begin(Game.selected),{icon:'play'});
    /* ★底部「按 ESC 继续游戏」提示已删除★（用户：「不要画蛇添足」）。
       ESC 继续的功能本身保留在 keydown 分支里，不受影响。 */
  }else{
    button('resetSave','清除存档',x+pw/2-124,y+ph-66,248,44,()=>{closeMenuPopup();change('resetConfirm');},{icon:'exit'});
    text('清空进度、奖杯、纪录与声音设置',W/2,y+ph-16,C.inkFaint,1.06);
  }
}
/* 游戏说明共用面板：tab=0 键位说明，tab=1 玩法说明。两个内容各自独立成界面，不共用页签。 */
function _helpPanel(tab){
  /* 面板宽度自适应视口：窄窗口下整体等比缩小，保证按键列与文字列都不越界、不裁切。 */
  const maxW=704,pw=Math.min(maxW,W-40),k=pw/maxW;
  const x=W/2-pw/2,ph=Math.min(426,H-140),y=Math.max(88,Math.min(104,(H-ph)/2));
  panel(x,y,pw,ph);
  if(tab===0){const rows=[['A / D','左右移动'],['W / ↑','跳跃 · 长按更高 · 空中二段跳 / 蹬墙跳'],['空格','跳跃'],['F','插旗 / 拔旗 · 设置重生点'],['K','主动爆破 · 推箱 / 碎块 / 引燃'],['J','按住减缓幽灵回放 · 消耗慢放能量'],['L','幽灵回到轨迹起点'],['ESC','暂停 / 继续']];
    /* 行距随可用高度压缩，避免高/矮窗口下行溢出面板 */
    const step=Math.min(46,(ph-104)/rows.length);
    rows.forEach(([key,s],i)=>{const dy=94+i*step;keyboard(key,x+40*k,y+dy,104*k,1.08*Math.max(.8,k));textLeft(s,x+198*k,y+dy+15,C.ink,1.22*Math.max(.82,k));});}
  else{const lines=['抵达终末之门即可通关，通关后解锁下一关。','阵亡会留下回放幽灵：可承载你、压住机关、阻隔激光。','爆破与幽灵回放的爆炸能推箱、碎块、引燃与融冰。','旗子可设新重生点；拔旗清除幽灵并回退上一个重生点。','生命耗尽则本关失败，可即时重试；奖杯一经拾取永久保留。','冰面打滑、重力区倒转、消失台周期隐现、开关联动门扉。','水中移动迟滞，连续浸水十秒窒息，出水即恢复呼吸。','烟雾遮蔽视野，幽灵周围会开辟可视范围。','用时包含阵亡过程，不含暂停；最快时间支持反复刷新。'];
    const step=Math.min(32,(ph-108)/lines.length);
    lines.forEach((l,i)=>{const ly=y+100+i*step;stud(x+52*k,ly-4);textLeft(l,x+76*k,ly,C.ink,1.20*Math.max(.82,k));});}
}
/* ★独立的"按键说明"界面（不再复用页签）★ */
function drawKeyHelp(){header('按键说明','');_helpPanel(0);}
/* ★独立的"玩法说明"界面（不再复用页签）★ */
function drawRules(){header('玩法说明','');_helpPanel(1);}
/* 旧的独立"游戏说明"页（已废弃页签机制，仅保留作兜底展示玩法说明） */
function help(){header('玩法说明','');_helpPanel(1);}
function confirmScreen(kind){const reset=kind==='resetConfirm';const pw=Math.min(560,W-40),ph=252,x=(W-pw)/2,y=(H-ph)/2;panel(x,y,pw,ph);
  text(reset?'确认清除存档？':'结束这次冒险？',W/2,y+50,reset?'#ff9aa5':C.ink,1.72);
  text(reset?'进度、奖杯、纪录与设置都会重置，无法恢复':'进度已自动保存，下次仍可继续',W/2,y+100,C.inkSoft,1.16);
  const bw=Math.max(110,(pw-108)/2);
  button('confirmNo','取消',x+50,y+164,bw,44,()=>{if(Game.menuPopup){closeMenuPopup();}else{change(reset?'settings':'menu');}});
  button('confirmYes',reset?'确认清空':'退出',x+pw-50-bw,y+164,bw,44,()=>{if(reset)resetProgress();else{change('quit');window.close();}},{primary:true});}
/* ------------------------------------------------------------------- 局内 HUD */
function hud(){
  panel(18,16,Math.max(104,Play.lives*26+30),44,{r:10});
  for(let i=0;i<Play.lives;i++)heart(32+i*26,30,2);
  for(const a of Game.hearts){const t=clock-a.time;if(t<.8){g.save();g.globalAlpha=1-t/.8;heart(a.x,30+t*30,2,C.red,t*8);g.restore();}}
  panel(W/2-94,16,188,44,{r:10});textMono(formatTime(Game.elapsed),W/2,36,C.ink,1.46);
  button('pauseButton','',W-72,16,54,44,()=>pause(),{icon:'pause'});
  panel(18,H-70,Math.max(104,Play.flagsCollected*26+30),48,{r:10});
  for(let i=0;i<Play.flagsCollected;i++)flagIcon(32+i*26,H-58,1.9);
  if(!Play.flagsCollected)text('无旗',64,H-44,C.inkFaint,.95);
  const bx=170+Play.flagsCollected*26;
  /* 慢放条：平时隐藏（满能量），一旦消耗过就常显。
     触底回涨期间为黄色，回满后黄色缓慢渐变为原本的绿色（slowWarn 1→0）。 */
  if(Play.energy<.999||Play.slowWarn>.01){
    const w=Math.max(0,Math.min(1,Play.slowWarn||0));
    const mix=(a,b)=>Math.round(a+(b-a)*w);
    const fill=`rgb(${mix(92,240)},${mix(195,187)},${mix(178,74)})`;      /* teal → amber */
    const hi=`rgb(${mix(134,255)},${mix(217,227)},${mix(201,145)})`;
    rrect(bx-4,H-46,96,10,4,C.well);
    if(Play.energy>0.004){rrect(bx-2,H-44,92*Play.energy,6,3,fill);rect(bx-2,H-44,92*Play.energy,2,hi);}
    if(Play.slowLocked)text('回能中',bx+44,H-56,'#ffe391',.90);else text('慢放',bx+44,H-56,C.skyInk,.90);
  }
  if(Play._inWater){panel(W/2-86,H-58,172,32,{tone:'teal',r:9});text('呼吸 '+Play.waterBubbleTimer.toFixed(1)+' 秒',W/2,H-42,C.ink,1.08);}
  const _cur=(Game.activeLevels&&Game.activeLevels[Game.selected])||Game.levels[Game.selected];
  text(_cur?(_cur.lv.name||''):'',W-94,H-46,C.skyInk,.96);}
function result(win){const pw=560,ph=340,x=(W-pw)/2,y=(H-ph)/2;panel(x,y,pw,ph);
  if(win)icon('trophy',W/2,y+52,2.4);else heart(W/2-11,y+44,2,C.red,4);
  text(win?'关 卡 完 成':'生 命 耗 尽',W/2,y+104,win?C.goldHi:'#ff9aa5',1.76);
  if(win){text(formatTime(Game.elapsed),W/2,y+150,C.ink,1.52);
    if(Game.newBest)text('新的最快纪录',W/2,y+186,C.gold,1.12);
    else text('已记录通过时间',W/2,y+186,C.inkSoft,1.12);}
  else{text('本次用时 '+formatTime(Game.elapsed),W/2,y+150,C.ink,1.18);text('阵亡 '+Play.deathCount+' 次',W/2,y+180,C.inkSoft,1.12);}
  const next=Game.selected<Game.levels.length-1;
  button('retry','再次挑战',x+46,y+232,220,44,()=>begin(Game.selected),{primary:true});
  button('resultLevels',win&&next?'下一关':'返回选关',x+294,y+232,220,44,()=>win&&next?begin(Game.selected+1):change('levels'),{icon:win&&next?'play':'flag'});}
/* ---------------------------------------------------------------- 渲染总入口 */
/* 响应式缩放：让任意分辨率 / 缩放 / 宽高比下的观感保持一致。
   基准设计格 960x600（16:9）。scale 为“总缩放”，直接作用于绘制矩阵与指针换算，
   因此所有以设计单位书写的 UI 都会等比放大，无需逐个改坐标。
   · 16:9 视口：K=1，行为与旧版逐像素一致（16:9 是用户认可的效果，不动它）。
   · 比 16:9 更“高”（4:3 / 5:4 / 竖屏窗口）：K>1，把内容撑大，避免缩在中间一小块。
   · 比 16:9 更“宽”（21:9 等）：K=1，改为让选关网格横向铺更多列，保持元素物理尺寸一致。 */
function layoutK(){const ar=innerWidth/innerHeight,REF=UI_STYLE.baseWidth/UI_STYLE.baseHeight;
  if(!isFinite(ar)||ar<=0)return 1;
  /* 越“高”放大越多，用 0.6 次幂平滑过渡；上限 1.55 防止极端窗口把内容撑爆 */
  return ar<REF?Math.min(1.55,Math.pow(REF/ar,0.6)):1;}
function colsPerRow(){ /* 让选关网格在宽屏铺开；窄屏保持 3 列不挤压 */
  const gap=28,avail=W-190;
  let per=3;while(per<5&&avail>=240*(per+1)+gap*per)per++;
  return per;}
function resize(){
  /* DPR 动态化：窗口在不同缩放比的显示器之间移动、或浏览器缩放时，
     devicePixelRatio 会变化。若沿用启动时的旧值，canvas 后备缓冲会与
     CSS 尺寸失配 → 画面模糊 / 尺寸错位。这里每次 resize 都重新取。 */
  const nd=Math.min(window.devicePixelRatio||1,2);
  if(nd!==dpr){window.dpr=nd;dpr=nd;}
  const fit=Math.min(innerWidth/UI_STYLE.baseWidth,innerHeight/UI_STYLE.baseHeight);
  const K=layoutK();
  scale=fit*K;
  W=innerWidth/scale;H=innerHeight/scale;
  /* VS/HS：纵向 / 横向可用余量，供个别面板按需微调 */
  VS=H/UI_STYLE.baseHeight;HS=Math.max(1,W/UI_STYLE.baseWidth);
  ui.width=Math.round(innerWidth*dpr);ui.height=Math.round(innerHeight*dpr);
  screenKey='';resizePlayCanvas();}
/* 启动页浮层：只有标题与提示文字。
   ★启动页不是新界面，而是菜单关卡本体★（世界隐藏 + 运镜拉近 + 主角悬浮，
   全部由 renderPlay 包装器与 frame 的运镜分支完成），这里只叠文字。 */
function drawMenuBootOverlay(){
  if(Game.menuIntro)drawBootTitle(1,true);                      /* 待输入：标题 + 呼吸提示 */
  else drawBootTitle(Math.max(0,1-(Game.menuBoot||0)/0.5),false); /* 揭示中：标题随运镜淡出 */
}
function renderUI(){g.setTransform(dpr*scale,0,0,dpr*scale,0,0);g.clearRect(0,0,W,H);buttons=[];
  /* ★原版「雨夜」菜单背景彻底退役：除游戏画面本身外，任何界面都不再绘制雨夜场景。
     暂停时游戏画面直接透出（不铺任何背景）；其余局外用纯暗底，绝不出现原版背景图。
     注意：删的只是"窗口之外的背景"，各界面的悬浮窗展板（panel / 木纹橱窗）全部保留。 */
  if(Game.state!=='playing'&&Game.state!=='pause'){g.fillStyle='#0a0e1a';g.fillRect(0,0,W,H);}
  if(['pause','win','fail'].includes(Game.state))rect(0,0,W,H,'rgba(10,16,30,0.34)');
  switch(Game.state){case'boot':boot();break;case'menu':menu();break;case'levels':levels();break;case'settings':settings();break;case'help':help();break;
    case'playing':if(Play&&Play.menuMode){
        if(Game.menuIntro||(Game.menuBoot||0)<1)drawMenuBootOverlay();
        else if(Game.menuPopup)drawMenuPopup();
        /* ★底部「跳到发光开关上开启功能 · 按 ESC 或点击空白处关闭」提示已删除★
           （用户：「PC版所有菜单的底部提示文字全删掉……不要画蛇添足」）。
           ESC 关闭浮窗保留（keydown 分支）；「点击空白处关闭」已一并移除（见 pointerdown）。 */
      }
      else hud();break;
    case'pause':if(Game.menuPopup)drawMenuPopup();else settings(true);break;   /* 暂停：浮窗优先，否则悬浮于游戏画面 */
    case'win':result(true);break;case'fail':result(false);break;
    case'resetConfirm':confirmScreen('resetConfirm');break;case'exitConfirm':confirmScreen('exitConfirm');break;
    case'quit':titleBlock(W/2,H*.36,1.1);text('冒险已结束 · 进度已保存',W/2,H*.58,C.skyInk,1.2);text('可以安全关闭此窗口',W/2,H*.65,C.skyInkDim,1.0);button('backToMenu','返回主菜单',W/2-120,H*.74,240,46,()=>change('menu'));break;}
  if(Game.toast&&Game.toast.until>clock)drawToast();
  drawRipples();
  if(Game.transition>0){g.save();g.globalAlpha=Game.transition*.22;rect(0,0,W,H,'#ffffff');g.restore();}
  rollButtons();syncAccess();}
/* ---------------------------------------------- 真实生产路径上的输入与物理 */
const oldPhysics=stepPlayerPhysics;
stepPlayerPhysics=function(p,keys,dt,solids,ghosts,mods){const was=p.grounded,prevHold=p.jumpHold,can=p.canDoubleJump,wall=p.wallJumpUsed,vy=p.vy;oldPhysics(p,keys,dt,solids,ghosts,mods);if(p.jumpHold>prevHold&&prevHold===0&&p.vy*p.gravityDir<0)AudioSystem.sfx(p.wallJumpUsed&&!wall?'wallJump':'jump',p.x,p.y);else if(can&&!p.canDoubleJump&&p.vy*p.gravityDir<0)AudioSystem.sfx('doubleJump',p.x,p.y);if(!was&&p.grounded&&vy*p.gravityDir>.5)AudioSystem.sfx('land',p.x,p.y);if(p.grounded&&Math.abs(p.vx)>.3&&Game.simTime-(p._lastStep||0)>.30){AudioSystem.sfx('step',p.x,p.y);p._lastStep=Game.simTime;}};
const originalDie=diePlay;
diePlay=function(){if(!Play.player||Play.player.dead||(Play.deathAnim&&Play.deathAnim.active))return;const n=Play.lives;Game.hearts.push({x:32+(n-1)*26,time:clock});AudioSystem.sfx('death',Play.player.x,Play.player.y);if(n<=1){Play.lives=0;Play.deathCount++;Play.player.dead=true;change('fail');AudioSystem.sfx('fail');return;}originalDie();};
const originalRespawn=respawnPlay;
respawnPlay=function(origin){originalRespawn(origin);if(Game.state==='playing')AudioSystem.sfx('respawn',Play.player.x,Play.player.y);};
const originalFlag=doFlagAction;
doFlagAction=function(){const n=Play.placedFlags.length;originalFlag();if(n!==Play.placedFlags.length)AudioSystem.sfx(n<Play.placedFlags.length?'flagPlace':'flagPull',Play.player.x,Play.player.y);};
/* ★启动页 / 运镜揭示：隐藏世界 + 主角无缝重绘★
   启动页不是新界面，而是菜单关卡本体：背景图层与砖块平台被"盖"掉（menuWorldFade=0 全盖，
   揭示时按进度半盖），主角随即以**与 runtime 逐字一致的画法**重绘在黑幕之上
   （复制自 runtime.js 10916-10934 的主角渲染），因此揭示结束切回引擎原画时零跳变。 */
const originalRenderPlay=renderPlay;
renderPlay=function(){
  originalRenderPlay();
  var p=Play&&Play.player,cam=Play&&Play.cam;
  if(Game.state==='playing'&&Play&&Play.menuMode&&p&&cam&&(Game.menuBoot||0)<1&&(Game.menuWorldFade||0)<1){
    var c=D.playCanvas,cx2=c&&c.getContext('2d');if(!cx2)return;
    var cw=c.width,chh=c.height;
    /* 1) 按"世界隐藏度"整屏压暗（盖住背景图层与砖块平台） */
    cx2.save();cx2.setTransform(dpr,0,0,dpr,0,0);
    cx2.globalAlpha=1-(Game.menuWorldFade||0);cx2.fillStyle='#0a0e1a';cx2.fillRect(0,0,cw,chh);
    /* 2) 重绘主角：与引擎同变换（含像素吸附 / 重力翻转 / 挤压），保证无缝 */
    var zoom=cam.zoom,_ps=zoom*dpr;
    if(_ps>0){
      var snapX=Math.round(cam.x*_ps)/_ps,snapY=Math.round(cam.y*_ps)/_ps;
      cx2.scale(zoom,zoom);cx2.translate(-snapX,-snapY);
      if(p.gravityDir>0){cx2.translate(p.x+p.w/2,p.y+p.h);cx2.scale(p.squashX,p.squashY);cx2.translate(-p.w/2,-p.h);}
      else{cx2.translate(p.x+p.w/2,p.y);cx2.scale(p.squashX,p.squashY);cx2.translate(-p.w/2,0);}
      cx2.shadowBlur=12;cx2.shadowColor='#00ffaa';
      cx2.fillStyle='#00ffaa';cx2.fillRect(0,0,p.w,p.h);
      cx2.shadowBlur=0;
      cx2.fillStyle='#0a0e1a';
      cx2.fillRect(2,2,1.5,1.5);cx2.fillRect(4.5,2,1.5,1.5);
    }
    cx2.restore();
  }
};
function eventSnapshot(){return{water:Play._inWater,flags:Play.flagPickups.length,hearts:Play.hearts.length,breaks:Play.breakables.length,ice:Play.iceBlocks.length,gravity:Play.player.gravityDir,ghosts:Play.ghosts.length,doors:[...Play.doors,...Play.switchDoors].map(v=>v.open),plates:Play.plates.map(v=>v.active),switches:Play.switches.map(v=>v._pressed),burns:Play.flammables.map(v=>v.burning>0),falls:Play.fallingSpikes.map(v=>v._f),smoke:Play.smokes.some(s=>rectsOverlap(Play.player,s))};}
function simulation(){if(Game.state!=='playing')return;Game.elapsed+=1/60;Game.simTime+=1/60;const b=eventSnapshot();updatePlay(1/60);AudioSystem.update(Play.player,Play,1/60);const a=eventSnapshot(),p=Play.player,sound=n=>AudioSystem.sfx(n,p.x,p.y);
  if(a.water!==b.water)sound(a.water?'waterEnter':'waterExit');if(a.flags<b.flags)sound('flagPickup');if(a.hearts<b.hearts)sound('heart');if(a.breaks<b.breaks)sound('break');if(a.ice<b.ice)sound('melt');if(a.gravity!==b.gravity)sound('gravity');if(a.ghosts>b.ghosts)sound('ghost');if(a.smoke&&!b.smoke)sound('smokeEnter');
  a.doors.forEach((v,i)=>{if(v!==b.doors[i])sound(v?'doorOpen':'doorClose');});a.plates.forEach((v,i)=>{if(v&&!b.plates[i])sound('plate');});a.switches.forEach((v,i)=>{if(v&&!b.switches[i])sound('switch');});a.burns.forEach((v,i)=>{if(v&&!b.burns[i])sound('ignite');});a.falls.forEach((v,i)=>{if(v&&!b.falls[i])sound('fallingSpike');});
  if(a.water&&Math.floor(Game.simTime*1.2)!==Math.floor((Game.simTime-1/60)*1.2))sound('bubble');if(Play.won)victory();
  /* 可操作主菜单：逐帧检测开关踩压（仅在未弹窗时），由上升沿触发弹窗。 */
  if(Play&&Play.menuMode)updateMenuSwitches();}
function frame(now){const dt=Math.min(.12,(now-last)/1000);last=now;clock+=dt;Game.transition=Math.max(0,Game.transition-dt*4);
  if(window.MU&&MU.updateTilt)MU.updateTilt(dt);
  if(Game.state==='playing'){
    /* 菜单浮窗开启动效计时（从中间向两边展开） */
    if(Game.menuPopup){Game.menuPopupT=Math.min(1,(Game.menuPopupT||0)+dt/0.22);}
    if(Play&&Play.menuMode&&Game.menuIntro){
      /* 启动页：世界隐藏 + 运镜拉近 + 主角悬浮出生点 —— 等首次任意输入。 */
      _menuCamFrame(0);renderPlay();
    } else if(Play&&Play.menuMode&&(Game.menuBoot||0)<1){
      /* ★揭示★：渐显背景图层与砖块平台 + 相机丝滑拉回设置机位。期间不推进物理，
         主角保持悬浮；揭示结束才自然下落，进入可操作主菜单。 */
      const e=Math.min(1,(Game.menuBoot||0)+dt/1.2);Game.menuBoot=e;
      Game.menuWorldFade=Math.max(0,Math.min(1,(e-0.12)/0.88));
      _menuCamFrame(e);
      renderPlay();
      if(Game.menuBoot>=1){Game.menuWorldFade=1;Play.keys={};}
    } else {
      /* 可操作主菜单：弹窗打开时冻结关卡（不推进物理），仅渲染冻结画面 + 弹窗。 */
      const frozen=(Play&&Play.menuMode&&Game.menuPopup);
      if(!frozen){acc+=dt;let guard=0;while(acc>=1/60&&guard++<8){simulation();acc-=1/60;}}
      renderPlay();
    }
  }
  else if(['pause','win','fail'].includes(Game.state))renderPlay();else acc=0;renderUI();
  /* ★选关缩略图预热泵（性能优化）★：仅当"选关浮窗 / 选关页"可见时才泵，
     启动页 / 主菜单 / 游戏内不浪费每帧 5ms 预算。 */
  if(typeof pumpPreviewPrewarm==='function'){const pp=Game.menuPopup;if((Play&&Play.menuMode&&(pp==='levels'||pp==='levels2'))||Game.state==='levels')pumpPreviewPrewarm();}
  requestAnimationFrame(frame);}
function point(e){pointer.x=e.clientX/scale;pointer.y=e.clientY/scale;}
/* hover 只对「精确指针」（鼠标/触控板/笔）生效。
   触摸屏上手指抬起后浏览器仍会保留 hover，导致按钮一直停在选中态
   （观感上像“某个按钮坏了”），所以 touch 直接不参与 hover。 */
window.addEventListener('pointermove',e=>{point(e);if(e.pointerType==='touch'){return;}
  const b=buttons.find(v=>!v.disabled&&inRect(pointer,v));if((b?b.id:'')!==hoverId){hoverId=b?b.id:'';if(hoverId)sndUI('hover');}});
window.addEventListener('pointerup',e=>{pointer.down=false;dragSlider=null;if(e&&e.pointerType==='touch')hoverId='';});
window.addEventListener('pointerdown',e=>{point(e);
  /* 记录本次输入的指针类型：只有触摸/手写笔才会遭受“抬起时界面已换掉”的穿透，
     所以闸门仅对它们生效（鼠标/键盘玩家的点击立即响应，不受影响）。 */
  armGate(e.pointerType);
  pointer.down=true;
  /* 启动页（菜单关卡 · 世界隐藏态）：首次点击 = 开始揭示（不是切页面） */
  if(!window.MOBILE_MODE&&Game.menuIntro){if(window.MU&&MU.enableGyro)MU.enableGyro();startGame();return;}
  if(Game.state==='boot'){if(window.MU&&MU.enableGyro)MU.enableGyro();startGame();return;}
  /* 菜单弹窗打开时：点中控件则交由其处理（含滑条拖拽）。
     ★「点空白处关闭弹窗」已删除★（用户原话：「把ESC关闭菜单弹窗的功能保留，但是点击空白处
     关闭的功能删掉，PC版不许点击空白处直接关闭界面」）—— ESC 的关闭行为见下方 keydown 分支，
     此处对空白处点击不再做任何处理（也不会关掉任何界面）。 */
  if(Game.menuPopup){const b=buttons.find(v=>inRect(pointer,v)&&!v.disabled);if(b&&b.slider){dragSlider=b.id;e.preventDefault();}return;}
  const b=buttons.find(v=>inRect(pointer,v));if(b&&b.slider){dragSlider=b.id;e.preventDefault();}});
window.addEventListener('keydown',e=>{const code=e.code;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(code))e.preventDefault();
  /* 启动页（菜单关卡 · 世界隐藏态）：首次任意键 = 开始揭示（不是切页面） */
  if(!window.MOBILE_MODE&&Game.menuIntro){if(!e.repeat&&!['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(code))startGame();return;}
  if(Game.state==='boot'){if(!e.repeat&&!['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(code))startGame();return;}
  if(code==='Escape'&&!e.repeat){if(Game.menuPopup){closeMenuPopup();return;}if(Play&&Play.menuMode)return;if(['playing','pause'].includes(Game.state))pause();else if(['settings','help','levels'].includes(Game.state))change('menu');else if(Game.state==='resetConfirm')change('settings');else if(Game.state==='exitConfirm')change('menu');return;}
  if(Game.state!=='playing'||e.repeat)return;Play.keys[code==='Space'?'ArrowUp':code]=true;if(code==='KeyK')doSuicidePlay();if(code==='KeyF')doFlagAction();if(code==='KeyJ')AudioSystem.sfx('slow');if(code==='KeyL'){if(rewindGhosts())AudioSystem.sfx('ghost');}if(code==='KeyR')begin(Game.selected);});
window.addEventListener('keyup',e=>{Play.keys[e.code==='Space'?'ArrowUp':e.code]=false;});
window.addEventListener('blur',()=>{Play.keys={};pointer.down=false;dragSlider=null;hoverId='';if(Game.state==='playing'&&!Play.menuMode&&!Game.menuPopup)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&Game.state==='playing'&&!Play.menuMode&&!Game.menuPopup)pause();});
/* resize 监听由 mobile-ui.js 接管（它有自己的整套竖屏布局流程），
   手机版在 index.html 里先置 window.MOBILE_MODE=true，这里就不再注册，
   避免两套缩放逻辑互相覆盖。电脑版没有该标志，正常走下面的 resize()。
   —— 用同一个开关而非两套文件，可避免电脑版/手机版源码漂移。 */
if(!window.MOBILE_MODE)window.addEventListener('resize',resize);
/* ------------------------------------------------------------ 关卡载入 */
const _pvOrder=[];let _pvBytes=0;
/* 缩略图有界 LRU 预算：48 张 × 340×150×4B ≈ 9.4MB。
   关卡很多时若无限缓存会吃掉大量常驻内存（且大部分永远不再翻到）。 */
const PV_CACHE_MAX=48;
/* ══════════════════════════════════════════════════════════════════════════
   ★关卡来源★ —— 只读 levels.js 的 `levels` 数组（编辑器导出的经典关卡）
   ══════════════════════════════════════════════════════════════════════════
   游戏**不做任何关卡生成**：所有关卡都保存在根目录的 levels.js 里。
   流程：编辑器做好关卡 →「保存」导出 levels.js → 复制到游戏根目录覆盖同名文件
        → 游戏里就是你自己做的全部关卡（编辑器所见 = 游戏里玩到）。
   下面兼容 data 直接是数组 / 单关对象 / 元素表等旧写法。 */
function normalize(data){
  const source=Array.isArray(data)?data:(data&&Array.isArray(data.levels))?data.levels:(data&&data.level)?[data.level]:(data&&data.elements)?[data]:[];const out=[];
  source.forEach((raw,i)=>{if(!raw||!Array.isArray(raw.elements))return;const kinds=new Set(raw.elements.map(e=>e&&e.type));
    if(!kinds.has('goal')||!kinds.has('spawn'))return;const lv=clone(raw);
    lv.name=String(lv.name||('第 '+(i+1)+' 关'));lv.id=lv.id==null?(i+1):lv.id;
    lv.chambers=Array.isArray(lv.chambers)&&lv.chambers.length?lv.chambers:[{id:'c1',x:0,y:0,w:200,h:88}];
    lv.backgrounds=Array.isArray(lv.backgrounds)?lv.backgrounds:[];
    if(!lv.backgrounds.length){const old=lv.elements.filter(e=>e&&e.type==='bg');if(old.length)lv.backgrounds=[{id:'legacy',layer:0,chambers:[{id:'legacyCanvas',x:0,y:0,w:600,h:400}],shapes:old.map(e=>Object.assign({},e,{type:'bgShape',shape:e.shape||'rect',shader:e.shader||'gradient',chamberId:'legacyCanvas'}))}];}
    lv.backgrounds.forEach(bg=>{(bg.shapes||[]).forEach(sh=>{if(!sh.chamberId&&bg.chambers&&bg.chambers[0])sh.chamberId=bg.chambers[0].id;});});
    lv.elements=lv.elements.filter(e=>e&&e.type!=='bg').map((e,j)=>{if(!Number.isFinite(e.x)||!Number.isFinite(e.y)){e.x=Number(e.x)||0;e.y=Number(e.y)||0;}if(!e.w)e.w=8;if(!e.h)e.h=8;if(e.type==='trophy'&&!e.id)e.id='t'+(lv.id||i)+'_'+j;return e;});
    lv.feel=sanitizeFeel(lv.feel||(data&&data.feel));lv.camera=lv.camera||{};
    lv.initialLives=Math.max(1,Math.floor(lv.initialLives||3));lv.initialFlags=Math.max(0,Math.floor(lv.initialFlags||0));
    const order=(()=>{const m=String(lv.id).match(/(\d+)/);return m?Number(m[1]):i+1;})();
    /* trophyIds 预存：选关页统计奖杯时直接用，避免每帧扫全部元素 */
    out.push({lv,key:'lv'+order+'#'+i,order,preview:null,name:lv.name,theme:lv.theme||'',trophyIds:lv.elements.filter(e=>e.type==='trophy').map(e=>e.id)});});
  out.sort((a,b)=>a.order-b.order);
  /* === 缩略图惰性化 + 有界 LRU（启动性能 + 大规模地图稳定性） ===
     旧版在 normalize() 里对每关**同步**渲染 340x150 缩略图：20 关 × 约 250ms
     → 阻塞主线程 5~90 秒（视机型），这正是"关卡文件一大就加载不出来"的根因。
     改为按需计算 + 缓存：启动时一次都不算，进入选关页只算当前可见的几张。
     ★ 规模问题 ★：缩略图 340×150×4B ≈ 204KB/张。若无限缓存，上千关就是**数百 MB**
       常驻内存（且大部分永远不再翻到）。这里改为**有界 LRU**：
       只保留最近访问的 `PV_CACHE_MAX` 张（默认 48 = 约 9.4MB），
       被淘汰的关卡下次翻到时重算（单张仅 5~7ms，无感）。 */
  out.forEach(r=>_definePreview(r));
  schedulePreviewPrewarm(out);
  return out;}
/* 惰性 BGM 预热：只把「窗口内那几关」喂给 AudioSystem.prewarm。
   ★为什么不能直接传 Game.levels.map(r=>r.lv)★
     AudioSystem 的音乐种子取自关卡内容（canonicalFeature 读 elements/backgrounds），
     所以 prewarm 确实需要**真关卡对象**。但直接全量 map 会把全部关卡都展开。
     做法：传一个**惰性数组**（元素用 getter，访问时才展开），
     prewarm 内部只索引 [fromIdx, fromIdx+WINDOW)，因此只会展开那几关。 */
function _lazyPrewarm(){
  const start=Math.max(0,Game.selected|0);
  const win=(AudioSystem.PREWARM_WINDOW||8)+2;
  const arr=[];
  for(let k=0;k<win&&start+k<Game.levels.length;k++){
    const idx=start+k;
    Object.defineProperty(arr,k,{configurable:true,enumerable:true,
      get(){const r=Game.levels[idx];return r?r.lv:null;}});
  }
  arr.length=Math.min(win,Math.max(0,Game.levels.length-start));
  /* 菜单/暂停轨排最前（prewarm 内部本来就 push 它们，这里无需重复） */
  AudioSystem.prewarm(arr,0);
}
/* 缩略图有界 LRU（按需计算 + 缓存，避免启动时一次性同步渲染全部缩略图）。
   ★必须放在 normalize 之前或提升★：这里用函数声明（会提升），两条分支都能调。 */
function _definePreview(r){
  Object.defineProperty(r,'preview',{
    configurable:true,enumerable:true,
    get(){
      /* 命中缓存的键 → 提到队尾（LRU touch） */
      const idx=_pvOrder.indexOf(r);
      if(idx>=0){_pvOrder.splice(idx,1);_pvOrder.push(r);return r._pv;}
      const cv=preview(r.lv);
      r._pv=cv;_pvOrder.push(r);_pvBytes+=204800;
      /* 淘汰最旧的若干张，直到回到预算内 */
      while(_pvOrder.length>PV_CACHE_MAX){
        const old=_pvOrder.shift();
        if(old&&old!==r){old._pv=undefined;_pvBytes-=204800;}
      }
      return cv;
    },
    set(v){r._pv=v;}
  });
}
/* ★只读缓存、绝不触发计算★（选关页渲染路径专用）
   背景：`r.preview` 是 getter，**未命中缓存时会同步现算**（实测手机单张约
   12ms、一页 6 张 74ms＞50ms 长任务阈值）。若在 renderUI 里直接读 `r.preview`，
   只要预热没赶上，这一帧就必然卡一下。
   所以渲染路径改用 `peekPreview()`：
     · 命中缓存 → 立刻拿到 canvas，零成本；
     · 未命中   → 返回 null，画个占位（空槽），并让预热在后台补。
   因为局外界面本来就逐帧重绘（frame() 每帧都调 renderUI），
   预热算好后**下一帧缩略图自然出现**（轻微 pop-in，但绝无卡顿）。
   —— 这是"用一帧的延迟换掉一次长任务"的取舍，选关页尤其值得。 */
function peekPreview(rec){
  if(!rec)return null;
  if(_pvOrder.indexOf(rec)>=0)return rec._pv;
  return null;
}
/* 空闲预热：一次算一关，绝不与交互抢主线程。
   刻意**跳过局内状态**（playing/pause/win/fail）：缩略图只在选关页用得到，
   若在玩家操作时抢主线程算它会掉帧。等回到菜单/选关页再继续预热。
   实测（_pvsplit.cjs）：单关 preview 的耗时 98% 在背景形状上，参数调优后
   单关降到 5~7ms（低于 50ms 长任务阈值），因此这里的逐关预热不再制造卡顿；
   但仍保留「一次一关 + 让路局内」的策略，避免极端机型上叠加成可感停顿。 */
/* === 文字位图预热（消除"首次进选关页 58ms 长任务"） ===
   实测（_lvline.cjs）：`text()` 对**未缓存**的字符串要 ~2.5ms（4 倍超采样 +
   getImageData 回读 + 建 canvas）。首屏 3 张卡要画约 15 个字符串 + 描边变体
   ⇒ 一次 ~58ms 长任务，正是"菜单→选关"那一次可感卡顿。
   位图缓存键是 `size|ps|color|text`，**不含 mul**（缩放发生在绘制矩阵上），
   所以这里按 (color,text) 预热一次，对所有字号都生效。
   与 preview 一起放进同一个空闲循环：算完一关的缩略图，顺手把它那几个字符串也烘好。 */
function warmLevelText(rec,i,per){
  const S=(s,c)=>{try{_getPxTextBitmap(String(s),UI_STYLE.fontSize,c,UI_STYLE.pixelSize);}catch(e){}};
  const num=String(i+1).padStart(2,'0');
  /* ★名字用 rec.name（配方里已有），不要用 rec.lv.name★
     后者会触发懒展开 —— 为了焐一个文字位图而展开整关（含约 90KB 背景）不值得。
     （缩略图那一步本来就要展开，所以这里顺便省掉重复的 lv 访问。） */
  const nm=rec.name!=null?rec.name:(rec.lv?rec.lv.name:'');
  const tm=formatTime(Game.save.best[rec.key]);
  /* ★★ 必须按"渲染真正请求的键"逐条焐 ★★
     缓存键是 `size|ps|color|text`。实测漏掉任何一路颜色，进选关页就会冷烘：
       textLeft()/textRight() 内部会先调 textW()，而 textW 固定用 **#ffffff**
       ⇒ 凡走 textLeft/textRight 的字符串都多出一个白键，旧清单全漏了；
       关卡名还带一层暗描边 rgba(5,3,14,0.70)（drawPixelText 的 outlineColor）；
       关号在解锁/未解锁两态用不同色（金 / 极淡紫）。
     下面把这三路色一次焐全（每关 10 个键、每个约 1ms），换掉"进页时同步冷烘 44 串
     ≈ 79ms 长任务"。 */
  /* 关号：textLeft → textW(#ffffff) + text(金 / 极淡) */
  S(num,C.goldHi);S(num,C.inkFaint);S(num,'#ffffff');
  /* 关卡名：textLeft → textW(#ffffff) + text(主色 / 极淡) + 暗描边 */
  S(nm,C.ink);S(nm,C.inkFaint);S(nm,'#ffffff');S(nm,'rgba(5,3,14,0.70)');
  /* 时间值：textRight / textLeft → textW(#ffffff) + text(金 / 柔) */
  S(tm,C.goldHi);S(tm,C.inkSoft);S(tm,'#ffffff');
}
/* 页首固定元素预热（与关卡无关，整页只做一次）。
   ★为什么要单独拆出来★：它一次要焐约十几个字符串（实测 20~30ms），
   若塞在 i===0 那一关里，会让**第一次回调**叠加「缩略图 13ms + 页首 25ms」
   = 38~44ms，逼近 50ms 长任务阈值，制造一笔无谓的卡顿。
   拆开后：页首一次 ≤30ms、每关一次 ≤12ms，**单次回调稳定低于阈值**。
   ★页码文字只焐「当前页 ± 1」★：关卡很多时手机端有上百页，全焐会挤爆
   _pxTextCache（上限 384），导致边焐边被驱逐，反而白做。 */
function warmPageHeader(per,recs){
  const S=(s,c)=>{try{_getPxTextBitmap(String(s),UI_STYLE.fontSize,c,UI_STYLE.pixelSize);}catch(e){}};
  /* ★header() 的字符串必须一起焐★
     `header()` 每帧都画「返回 / 标题」，实测单个字符串冷烘焙 1.7~5ms，
     合起来 13.7ms —— 若留给首帧同步做，就是那笔残余卡顿的主要部分。
     这里把标题、返回、奖杯、计数全部并入页首预热（一次性）。 */
  /* ★标题与"返回"要把**三路颜色**都焐上★
     PC：header() 画 text(标题, C.ink, ..., 'rgba(5,3,14,0.78)') ⇒ 主色 + 描边两键；
     「返回」是普通按钮文字（C.ink，无描边）；
     手机：header() 改走 styledText（渐变金 + basePs 0.25）⇒ 完全另一套缓存键。
     旧清单只写了描边色、漏了主色，也没有 styledText 变体 ⇒ 手机端每次进页
     都要冷烘「选择关卡」。三路补齐后两端都不再冷烘。 */
  S('选择关卡',C.ink);S('选择关卡','rgba(5,3,14,0.78)');S('选择关卡','#ffffff');
  S('更多关卡',C.ink);S('更多关卡','rgba(5,3,14,0.78)');S('更多关卡','#ffffff');
  S('返回',C.ink);S('返回','#ffffff');
  S('设置',C.ink);S('游戏说明',C.ink);
  /* 奖杯盘：`奖杯` + `已收集 / 总数`。
     ★这里必须用**真实计数**（配方 rec.trophyIds 累加即可，不触发懒展开），
       旧版写死 '0 / 0' ⇒ 真实值 '0 / 989' 永远冷烘。 */
  let total=0;
  if(recs){for(let k=0;k<recs.length;k++){const t=recs[k]&&recs[k].trophyIds;if(t)total+=t.length;}}
  const taken=(()=>{let n=0;try{if(recs){for(let k=0;k<recs.length;k++){const r=recs[k];const ids=r&&r.trophyIds;if(!ids)continue;for(let q=0;q<ids.length;q++)if(Game.save.trophies[r.key+'::'+ids[q]])n++;}}}catch(e){}return n;})();
  S('奖杯',C.inkSoft);S(taken+' / '+total,C.ink);
  /* 页码：per 必须与**当前端的真实每页行数**一致（手机 6 / PC 3），
     否则算出来的是"另一个页数"（167 vs 334），页码串照样冷烘。 */
  const perN=Math.max(1,per||colsPerRow());
  const pages=Math.max(1,Math.ceil(Game.levels.length/perN));
  const cur=Math.max(0,Math.min(pages-1,Game.page|0));
  for(let pg=cur-1;pg<=cur+1;pg++){
    if(pg<0||pg>=pages)continue;
    S('第 '+(pg+1)+' / '+pages+' 页',C.inkSoft);
  }
  S('尚无可用关卡',C.ink);
  /* 关卡卡片上的固定字符串（每行都会画，且与关卡无关）——
     放进页首一起焐，避免"每关都冷烘焙一次"的重复代价。 */
  S('最快时间',C.inkFaint);S('最快时间','#ffffff');
  S('进入',C.ink);S('未解锁',C.inkFaint);S('未解锁','rgba(5,3,14,0.80)');
  S('已通关','rgba(134,217,201,0.82)');
  S('◀',C.ink);S('▶',C.ink);
  /* ★手机端 header() 走 styledText★：它内部是「白字位图 → 渐变上色 → 加描边」，
     缓存键是 `s|mul|colors|outline|basePs`，与上面的颜色常量体系**完全不同**。
     这里直接调 _styledBuild（只算不画）把它烘进 _styledCache。 */
  try{_styledBuild('选择关卡',1.42,['#ffffff','#ffe98a','#e8a92c','#96630e'],3.0,0.25);}catch(e){}
}
/* 空闲预热：一次算一关，绝不与交互抢主线程。
   刻意**跳过局内状态**（playing/pause/win/fail）：缩略图只在选关页用得到，
   若在玩家操作时抢主线程算它会掉帧。等回到菜单/选关页再继续预热。
   实测（_pvsplit.cjs）：单关 preview 的耗时 98% 在背景形状上，参数调优后
   单关降到 5~7ms（低于 50ms 长任务阈值），因此这里的逐关预热不再制造卡顿；
   但仍保留「一次一关 + 让路局内」的策略，避免极端机型上叠加成可感停顿。

   ★★ 滚动窗口（支撑 1000+ 关）★★
     旧版从第 0 关一路预热到最后一关。关卡少时没问题，但关卡很多时：
       ① 要跑 1000 × (缩略图 5~7ms + 文字位图) ≈ 8~15 秒的持续占用
       ② 更重要的是，**缩略图缓存只有 48 张（有界 LRU）**，
          预热到第 100 关时前 48 张已被驱逐 ⇒ 前面 900 多关的预热**纯属白做**
     改为「只预热当前页 + 前后各一页」：
       · 总和 ≤ 3 页 ≈ 36 关，远小于 LRU 48 张 ⇒ 预热结果**真的会保留**
       · 翻页时重新对准窗口（followPage），只补新露出的那几关
     ——与音频 prewarm 的 PREWARM_WINDOW 思路一致。 */
let _prewarmRecs=null,_prewarmI=0,_prewarmPer=3,_prewarmLive=false,_prewarmHdrDone=false;
/* 预热顺序：**当前页优先**，然后上一页、下一页。
   为什么不是"从上一页顺序扫到下一页"：用户进选关页时眼睛先看当前页，
   若从上一页开头扫，当前页的 6 张要等 6×32ms ≈ 190ms 才陆续出现（pop-in 太慢）。
   按优先级排后，当前页第 1 张在**第一次空闲回调**后就能出现。 */
function _prewarmOrder(){
  const per=_prewarmPer>0?_prewarmPer:3;
  const page=Math.max(0,Game.page|0);
  /* ★关数必须取 _prewarmRecs（当前正在预热的那份名单）★
     选关浮窗可能是 levels2「更多关卡」（与 Game.levels 不是同一批、关数也不同），
     旧版写死 Game.levels.length 会算出「别的页」⇒ 真正的当前页缩略图仍要同步现算。 */
  const N=_prewarmRecs?_prewarmRecs.length:0;
  const seg=p=>{const a=Math.max(0,p*per),b=Math.min(N,(p+1)*per),out=[];
    for(let k=a;k<b;k++)out.push(k);return out;};
  return {order:seg(page).concat(seg(page-1),seg(page+1)),per};
}
function _prewarmWindow(){
  /* 兼容旧调用点：返回窗口区间（当前页 ±1 页） */
  const {order}=_prewarmOrder();
  return {from:order.length?order[0]:0,to:order.length?order[order.length-1]+1:0};
}
function schedulePreviewPrewarm(recs){
  if(!recs||!recs.length)return;
  _prewarmRecs=recs;
  /* ★不要在这里用 colsPerRow() 覆盖 _prewarmPer★
     手机端选关是竖排列表，per 由竖屏高度算出（2~6），与 PC 的横向列数不同。
     手机版进入选关页时会调 alignPreviewPrewarm(per) 显式对齐；
     这里只在**尚未被显式设定过**时才用 PC 口径兜底。 */
  if(!(_prewarmPer>0))_prewarmPer=colsPerRow();
  _prewarmI=0;
  _prewarmLive=true;
  /* 页首固定元素（只焐一次），交给 pump 的第一刀顺带做掉。 */
  _prewarmHdrDone=false;
}

/* ★★ 帧预算预热泵 ★★（手机端选关卡顿的真正解法）
   ▍为什么不能再用 requestIdleCallback（实测数据）
     浏览器在**持续 rAF 重绘**（本游戏局外界面每帧都在画）时，会把 idle 回调
     排到很后面 —— 实测每 2~4 秒才执行一次 "算 1 关"。而一页要 6 关
     ⇒ 进入选关页时预热**永远追不上**，于是 6 张缩略图被同步现算，
     单帧 82.6ms（> 50ms 长任务阈值）⇒ 用户感到的"明显卡顿"。
   ▍解法：把预热切进**游戏自己的帧循环**，每帧只花固定预算（默认 5ms）
     挂到 frame() 末尾调用。好处：
       · 每帧都保证推进（不像 idle 会被饿死）
       · 单帧增量 ≤5ms ⇒ 绝不制造长任务、不掉帧
       · 一页 6 张 ≈ 82ms ⇒ 约 16 帧 ≈ 270ms 补齐，用户几乎无感（pop-in）
       · 局内（playing/pause/win/fail）直接 return ⇒ 不抢玩家操作的主线程 */
const PREWARM_BUDGET_MS=5;
/* 选关页附近放宽预算：此时玩家正在看关卡列表，"缩略图尽快出现"的收益
   远大于"每帧多花几毫秒"。实测单张缩略图 ≈12ms、每关文字 ≈11ms，
   预算放到 14ms 可保证**每帧稳定完成一整关**（缩略图+文字），
   且 14ms 仍远低于 50ms 长任务阈值、60fps 下也留足 2ms 余量。 */
const PREWARM_BUDGET_LEVELS_MS=14;
function pumpPreviewPrewarm(budgetMs){
  if(!_prewarmLive||!_prewarmRecs)return;
  const s=Game&&Game.state;
  /* ★选关浮窗也必须预热★（用户原话：「必须要在保证性能的前提下恢复关卡界面卡片预览关卡的
     预览图显示……应该一直都显示」）。
     根因：主菜单的「选择关卡 / 更多关卡」是**浮窗**（state 仍是 'playing' + Play.menuMode），
     旧版被下面那句「局内让路」一并挡下 ⇒ 浮窗里的缩略图永远是黑框；只有进过一次真关、
     从结算页「返回选关」走到 state='levels' 把缓存焐热之后才显示 —— 正是用户报的现象。
     判据收紧为：**真对局**（playing/pause/win/fail 且没有选关浮窗打开）才让路；
     浮窗打开时关卡画面本就冻结（不推进物理），此时预热不抢玩家操作的主线程。 */
  const popupLevels=(Game.menuPopup==='levels'||Game.menuPopup==='levels2');
  const inRealGame=(s==='playing'||s==='pause'||s==='win'||s==='fail')&&!popupLevels;
  if(inRealGame)return;                              /* 真局内让路 */
  const onLevels=(s==='levels')||popupLevels;
  const budget=(budgetMs==null?(onLevels?PREWARM_BUDGET_LEVELS_MS:PREWARM_BUDGET_MS):budgetMs);
  const t0=performance.now();
  /* ★页首固定元素必须最先热★
     它包含"选择关卡 / 返回 / 奖杯 / 0 / 0 / 第 N / M 页"等**每帧都要画的字符串**。
     首帧若未预热，光 `header()` 就要 13.7ms（实测），叠加其它字符串可达 55ms。
     所以这里**无条件优先**做它，且不吃预算（它是一次性的）。 */
  if(!_prewarmHdrDone){
    try{warmPageHeader(_prewarmPer,_prewarmRecs);}catch(e){}
    _prewarmHdrDone=true;
    /* 页首那一刀可能已超预算 ⇒ 本轮到此为止，下一帧再开始算缩略图 */
    return;
  }
  /* 每轮重新按**当前页优先级**取顺序：翻页后自动优先新页 */
  const {order}=_prewarmOrder();
  if(!order.length)return;
  /* ★★ 每个"工作单元"只做一件事 ★★
     实测：一张缩略图 ≈18ms、一关文字 ≈10ms。旧写法把两者塞进同一次循环迭代
     ⇒ 单帧 28~31ms（手机直接掉到 30fps）。这里改成**每帧最多做一件事**：
       ① 窗口内还有缺的缩略图 → 只算一张就收手（可见性最强，优先）；
       ② 缩略图齐了 → 每帧只焐**一关**的文字（10 个键）；
       ③ 全部就绪 → 直接返回待命。
     用 rec._txtW 记录"该关文字已按哪种锁定态焐过"，避免重复劳动；
     关卡被通关后 locked 态会变（关号换色），标记随之失效并自动重焐。 */
  while(performance.now()-t0<budget){
    /* ① 缩略图：窗口内第一个还没算的 */
    let did=false;
    for(let k=0;k<order.length;k++){
      const rec=_prewarmRecs[order[k]];
      if(rec&&_pvOrder.indexOf(rec)<0){try{void rec.preview;}catch(e){}did=true;break;}
    }
    if(!did){
      /* ② 文字：窗口内第一关还没焐（或锁定态变了）的 */
      for(let k=0;k<order.length;k++){
        const idx=order[k],rec=_prewarmRecs[idx];
        if(!rec)continue;
        const tag=unlocked(idx)?'1':'0';
        if(rec._txtW===tag)continue;
        try{warmLevelText(rec,idx,_prewarmPer);}catch(e){}
        rec._txtW=tag;did=true;break;
      }
    }
    if(!did)return;                                   /* 窗口内全部就绪 */
    /* 一件就够（缩略图那件本身已超预算）⇒ 本帧到此为止，下一帧继续 */
    break;
  }
}
/* 翻页时调用：把预热游标重新对准新页（已在窗口内的不重复算）。
   ★可选参数 per★：手机端选关是**竖排列表**，每页行数由竖屏高度算出，
   与 PC 的 colsPerRow()（横向网格列数）不是同一个量。若不显式告知，
   手机端预热算的就是"别的页"⇒ 真正的当前页缩略图仍要绘制时**同步现算**，
   于是翻页/首屏又串成一条长任务。手机版在算完 per 后调用本函数对齐。 */
function refocusPreviewPrewarm(per){
  const np=Number(per)>0?Math.max(1,Math.floor(per)):_prewarmPer;
  /* ★per 变了 ⇒ 页数也变 ⇒ 页码串（'第 N / M 页'）必须重焐★
     手机端竖屏 per=6（167 页）、PC per=3（334 页），同一个 '第 1 页' 也是两个串。
     若不重焐，切到另一边时页码要冷烘（实测单串 2.6ms，加上其它串就是一笔长任务）。 */
  if(np!==_prewarmPer){_prewarmPer=np;_prewarmHdrDone=false;}
  if(!_prewarmLive||!_prewarmRecs)return;
  /* 优先级顺序变了（当前页换了）⇒ 游标归零重新从"新的当前页"开始 */
  _prewarmI=0;
}
/* 供手机端在进入选关页时显式对齐预热窗口（见 refocusPreviewPrewarm 注释）。
   ★为什么不直接让 mobile-ui.js 改 _prewarmPer★：它是顶层 `let`，
   跨脚本可写但**容易被后续 schedulePreviewPrewarm 用 colsPerRow() 覆盖**。
   统一走这个入口，保证"对齐"这件事只有一处实现。
   ★per 变了要重焐页首★（页码串随 per 变），故显式调 refocusPreviewPrewarm(per)。 */
function alignPreviewPrewarm(per){
  refocusPreviewPrewarm(per);
}
/* === 选关缩略图：只画「出生点一屏」（摄像机视口大小） ===
   旧实现把**整个箱庭包围盒**（实测可达 2600×616）连同全部背景形状（253~482 个）
   一起渲染，单张耗时 100~1035ms、50 关全量预热 10.9s，是选关/进游戏卡顿的主因。
   改为只取出生点周围一个「一屏」窗口（默认 300×100，与摄像机 viewTarget 一致）：
   窗口内需绘制的形状降到 11~22 个（相交面积仅 0.5~1%），且画面更聚焦、更像"关卡开场"。 */
function previewWindow(lv){
  const els=lv.elements||[];
  const sp=els.find(e=>e&&e.type==='spawn');
  const bb=(lv.chambers||[]).reduce((b,ch)=>({x:Math.min(b.x,ch.x),y:Math.min(b.y,ch.y),r:Math.max(b.r,ch.x+ch.w),d:Math.max(b.d,ch.y+ch.h)}),{x:Infinity,y:Infinity,r:-Infinity,d:-Infinity});
  const W0=isFinite(bb.x)?bb:{x:0,y:0,r:200,d:88};
  const cam=lv.camera||{};
  /* 窗口尺寸 = 摄像机目标视口（与游戏内一屏一致）；缺省 300×100。 */
  const wi=Math.max(120,Number(cam.viewW)||300),hi=Math.max(80,Number(cam.viewH)||100);
  let cx=sp?sp.x+(sp.w||8)/2:(W0.x+W0.r)/2,cy=sp?sp.y+(sp.h||8)/2:(W0.y+W0.d)/2;
  let x=cx-wi/2,y=cy-hi/2;
  /* 与摄像机一致：世界比窗口小就居中，否则贴边 */
  if(W0.r-W0.x<=wi)x=(W0.x+W0.r)/2-wi/2;else x=Math.max(W0.x,Math.min(W0.r-wi,x));
  if(W0.d-W0.y<=hi)y=(W0.y+W0.d)/2-hi/2;else y=Math.max(W0.y,Math.min(W0.d-hi,y));
  return{x,y,w:wi,h:hi};
}
function preview(lv){const c=document.createElement('canvas');c.width=340;c.height=150;const q=c.getContext('2d');q.imageSmoothingEnabled=false;
  /* 用「出生点一屏」当包围盒（局部变量名沿用 bx，后续逻辑不变） */
  const win=previewWindow(lv);const bx={x:win.x,y:win.y,r:win.x+win.w,d:win.y+win.h};
  const z=Math.min(340/(bx.r-bx.x),150/(bx.d-bx.y));
  q.fillStyle='#0c1520';q.fillRect(0,0,340,150);q.save();q.translate((340-(bx.r-bx.x)*z)/2,(150-(bx.d-bx.y)*z)/2);q.scale(z,z);q.translate(-bx.x,-bx.y);
  /* 只画与窗口相交的元素/形状（窗口外的一定不可见）。
     相交测试放在「世界坐标」下做，与缩放无关；裁剪是纯保守的（宁多勿漏），
     不会改变窗口内的绘制结果。 */
  const hit=(e,m)=>{const mm=m||0;return e&&(e.x+(e.w||8)>=bx.x-mm&&e.x<=bx.r+mm&&e.y+(e.h||8)>=bx.y-mm&&e.y<=bx.d+mm);};
  /* 缩略图只有 340x150（实际显示约 226x128），因此背景走「临时渲染通道」：
     共享一块小画布、过采样、每格最多覆盖若干画布像素、不写持久缓存。
     此前直接走正常路径：每个形状都按真实尺寸（最大 3150x1432）独立占一块
     离屏画布且永不释放 → 启动被阻塞近 90 秒、4K 下直接崩渲染进程。
    参数经 _pvsweep.cjs / _pvsplit.cjs 实测重扫取"性价比拐点"：
    · 拆分实测：单关 preview 的耗时 **98% 在背景形状**（20 关 194ms），
      元素绘制 + 邻接计算合计仅 3ms —— 因此优化只需打背景这一处。
    · 参数扫描（20 关合计 / 单关最大 / 画质代理）：
        256/2500/1 → 757ms / 113ms      ← 旧值，单关一次就是长任务
        192/1400/1 → 325ms /  28ms
        128/600/1  → 158ms /  12.4ms
         96/260/1  →  90ms /   7.3ms    ← 采用（单关已低于 50ms 长任务阈值）
         64/140/1  →  56ms /   5.2ms
      缩略图实际显示仅 ~226×128（手机上更小），96px 超采样已远超可分辨精度。
    · 结果：单关 12~57ms → 5~7ms，**空闲预热时不再产生任何长任务**。 */
  if(typeof _bgEphBegin==='function')_bgEphBegin(96,260,z,1,4);
  try{
    for(const bg of lv.backgrounds.slice().sort((a,b2)=>(a.layer||0)-(b2.layer||0)))for(const s of bg.shapes||[]){if(!hit(s,60))continue;try{drawBgShape(q,s,s.x,s.y,s.w,s.h,s.alpha==null?.8:s.alpha,0,false,true,[],z);}catch(e){}}
  }finally{if(typeof _bgEphEnd==='function')_bgEphEnd();}
  for(const e of lv.elements){if(e.type!=='bg'&&!hit(e,40))continue;const a=getAdjacency(e,lv.elements);switch(e.type){case'platform':drawPlatformTo(q,e,a);break;case'ice':drawIceTo(q,e,a);break;case'movable':drawMovableTo(q,e,a);break;case'breakable':drawBreakableTo(q,e,a);break;case'flammable':drawFlammableTo(q,e,a);break;case'water':drawWaterTo(q,e,false);break;case'goal':drawGoalPortalShader(q,e,0);break;case'trophy':drawTrophyTo(q,e);break;case'switchDoor':drawSwitchDoorTo(q,e,false);break;case'switch':drawSwitchTo(q,e,false);break;case'gravityFlip':drawGravityZoneShader(q,e,0);break;case'door':q.fillStyle='#c19748';q.fillRect(e.x,e.y,e.w,e.h);break;case'spike':case'fallingSpike':q.fillStyle='#cf4e65';q.beginPath();q.moveTo(e.x,e.y+e.h);q.lineTo(e.x+e.w/2,e.y);q.lineTo(e.x+e.w,e.y+e.h);q.fill();break;case'spawn':q.fillStyle='#6affa9';q.fillRect(e.x,e.y-8,8,8);break;case'flagPickup':q.fillStyle='#edce61';q.fillRect(e.x,e.y,6,4);break;case'heart':q.fillStyle='#e46376';q.fillRect(e.x,e.y,7,6);break;case'laserRight':case'laserLeft':case'laserUp':case'laserDown':q.fillStyle='#ff4d6a';q.fillRect(e.x,e.y,7,7);break;case'disappear':q.fillStyle='rgba(190,170,255,.75)';q.fillRect(e.x,e.y,Math.max(6,e.w),Math.max(4,e.h));break;case'bounce':{const _bn=Math.max(3,Math.min(6,Math.round(e.sides||4)));const _br=Math.min(e.w||16,e.h||16)/2;q.fillStyle='#4fe3ff';q.beginPath();for(let _bi=0;_bi<_bn;_bi++){const _ba=-Math.PI/2+_bi*2*Math.PI/_bn;const _bpx=e.x+(e.w||16)/2+Math.cos(_ba)*_br;const _bpy=e.y+(e.h||16)/2+Math.sin(_ba)*_br;if(_bi===0)q.moveTo(_bpx,_bpy);else q.lineTo(_bpx,_bpy);}q.closePath();q.fill();break;}case'mover':q.fillStyle='#7a828c';q.fillRect(e.x,e.y,e.w||16,e.h||16);q.fillStyle='#ffcc22';q.fillRect(e.x,e.y+Math.max(1,Math.round((e.h||16)*0.34)),e.w||16,2);break;case'jelly':q.fillStyle='rgba(75,214,160,.4)';q.fillRect(e.x,e.y,e.w||32,e.h||32);q.strokeStyle='#4bd6a0';q.lineWidth=1;q.strokeRect(e.x+.5,e.y+.5,(e.w||32)-1,(e.h||32)-1);break;}}
  q.restore();return c;}
/* 菜单关卡（可操作主菜单的底层关卡）：独立全局 MENU_LEVEL_DATA，缺失则留空。
   最后再 normalize 战役数据，确保 _prewarmRecs 落在战役上（不污染选关预热）。 */
function loadMenuLevel(){try{const d=window.MENU_LEVEL_DATA;Game.menuRecs=d?normalize(d):[];Game.menuLevel=Game.menuRecs&&Game.menuRecs[0]?Game.menuRecs[0]:null;}catch(e){Game.menuRecs=[];Game.menuLevel=null;}}
/* 更多关卡（levels2.js）：与战役同结构，缺失（404/无全局）时置空数组，游戏照常启动。 */
function loadLevels2(){try{const d=window.LEVELS_DATA2;Game.levels2=d?normalize(d):[];}catch(e){Game.levels2=[];}if(!Game.levels2)Game.levels2=[];}
function loadLevels(){
  loadMenuLevel();
  loadLevels2();
  Game.levels=normalize(window.LEVELS_DATA);
  /* 页数按**实际列数**算（旧版写死 /3，宽屏铺 4~6 列时最后一页会算错），
     关卡很多时这个偏差会放大到十几页。 */
  const per=Math.max(1,colsPerRow());
  Game.page=Math.min(Game.page,Math.max(0,Math.ceil(Game.levels.length/per)-1));
  Game.ready=true;screenKey='';}
['playScreen','playCanvas','playCanvasWrap','playInfo','playWin','playControls'].forEach(k=>D[k]=document.getElementById(k));
resize();loadLevels();
/* ★PC：启动页就是菜单关卡本体★ —— 加载即进入（世界隐藏 + 运镜拉近 + 主角悬浮出生点），
   首次任意输入触发"揭示"（渐显世界 + 相机拉回设置机位 + 主角下落）。
   手机端不在本范围内：保持自己的 boot → startGame → 文字菜单流程。 */
if(!window.MOBILE_MODE&&Game.menuLevel)enterMenuLevel(true);
requestAnimationFrame(frame);
window.GameAPI={begin,pause,normalize,loadLevels,formatTime,unlocked,resetProgress,simulation,change,
  transitioning:()=>fxBusy||(window.SceneFX?SceneFX.isPlaying():false),
  /* 调试用状态。★levels 不能用 r.lv.name★（会展开全部关卡）——
     名字就存在记录本身（r.name），直接用。 */
  getState:()=>({state:Game.state,elapsed:Game.elapsed,simTime:Game.simTime,level:Game.selected,lives:Play.lives,flags:Play.flagsCollected,save:clone(Game.save),levels:Game.levels.map(r=>({name:r.name!=null?r.name:(r.lv?r.lv.name:''),key:r.key})),audio:AudioSystem.debug()})};
