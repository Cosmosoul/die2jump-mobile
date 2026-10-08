'use strict';
/* ============================================================================
   拼死跳跃 · Die to Jump  —— 游戏本体（无任何编辑功能）
   文字使用编辑器同源的位图字体：10 号字 / 0.5 像素块，可在 UI_STYLE 快速调整。
   ========================================================================== */
const UI_STYLE={fontSize:10,pixelSize:0.5,baseWidth:960,baseHeight:600};
const Game=window.Game={state:'boot',levels:[],elapsed:0,simTime:0,selected:0,page:0,tab:0,ready:false,
  toast:null,transition:0,hearts:[],saveKey:'die2jump_game_save_v1',newBest:false};
const ui=document.getElementById('ui'),g=ui.getContext('2d'),access=document.getElementById('accessibility');
/* 明亮基调 + 高饱和着色：白/米白卡片、深墨字、金红青三色点缀，鲜明但不压抑 */
const C={
  skyInk:'#fdfbf2', skyInkDim:'#e7e0c8',
  ink:'#23323b', inkSoft:'#53636b', inkFaint:'#8b979b',
  paper:'#fdfaf1', paperHi:'#ffffff', paperLo:'#efe8d4',
  line:'#546069', lineLo:'#3a464e',
  gold:'#e0a520', goldHi:'#f7d063', goldDeep:'#a9741a',
  red:'#d4384a', redDeep:'#8e1d28',
  teal:'#2f9e8f', tealHi:'#66c9b8',
  shadow:'rgba(38,51,58,0.26)'
};
let scale=1,W=960,H=600,last=performance.now(),acc=0,clock=0,buttons=[],pointer={x:-1,y:-1,down:false},dragSlider=null,hoverId='',focusId='',screenKey='';
/* 响应式布局单位（在 resize() 里重算）
   VS：纵向呼吸量。16:9 视口恒为 1（观感与既有版本完全一致）；
       高屏 / 4:3 等纵向更宽的视口放大，把固定面板纵向撑开、居中内容不再缩成一小块。
   HS：横向呼吸量。宽屏 / 超宽屏放大，用于选关网格横向铺开更多卡片。 */
let VS=1,HS=1;
const clone=x=>JSON.parse(JSON.stringify(x));
function readSave(){try{const v=JSON.parse(localStorage.getItem(Game.saveKey)||'{}');return{completed:v.completed||{},best:v.best||{},trophies:v.trophies||{},music:Math.max(0,Math.min(1,Number.isFinite(v.music)?v.music:.6)),sfx:Math.max(0,Math.min(1,Number.isFinite(v.sfx)?v.sfx:.8))};}catch(e){return{completed:{},best:{},trophies:{},music:.6,sfx:.8};}}
Game.save=readSave();
function persist(){try{localStorage.setItem(Game.saveKey,JSON.stringify(Game.save));}catch(e){notify('存档写入失败');}}
function trophyKey(id){return (Game.levels[Game.selected]?.key||'')+'::'+id;}
window.TrophyStore={has:id=>!!Game.save.trophies[trophyKey(id)],
  add(id){Game.save.trophies[trophyKey(id)]=true;persist();AudioSystem.sfx('trophy');notify('获得奖杯 · 已永久收藏');},
  count(){return Object.keys(Game.save.trophies).length;},clear(){Game.save.trophies={};persist();}};
function notify(t){Game.toast={text:String(t),until:clock+2.8};}
window.toast=notify;

/* ---------------------------------------------------------------- 位图文字 */
function text(s,x,y,color=C.ink,mul=1,alpha=1){g.save();if(alpha!==1)g.globalAlpha=alpha;g.translate(x,y);g.scale(mul,mul);drawPixelText(g,String(s),0,0,UI_STYLE.fontSize,color,null,1,UI_STYLE.pixelSize);g.restore();}
/* text() 默认以 x 为中心；下面两个助手用于左/右对齐排版 */
function textW(s,mul=1){const b=_getPxTextBitmap(String(s),UI_STYLE.fontSize,'#ffffff',UI_STYLE.pixelSize);return b.w*UI_STYLE.pixelSize*mul;}
function textLeft(s,x,y,color=C.ink,mul=1,alpha=1){text(s,x+textW(s,mul)/2,y,color,mul,alpha);}
function textRight(s,x,y,color=C.ink,mul=1,alpha=1){text(s,x-textW(s,mul)/2,y,color,mul,alpha);}
function bitmapOf(s,ps){const b=_getPxTextBitmap(String(s),UI_STYLE.fontSize,'#ffffff',ps);return{canvas:b.canvas,w:b.w*ps,h:b.h*ps};}
/* 明快卡通描边：内部金色纵向渐变 + 一圈均匀、克制的深色描边。
   不使用任何背景板；整块缓存，每帧仅一次 drawImage，保证性能。 */
const _styledCache=new Map();
const GOLD=['#ffffff','#fff6c4','#ffcb33','#e08c0e'];
const GOLD_RED=['#fff4f4','#ff9aa2','#e23450','#8e1d28'];
function styledText(s,cx,cy,mul,colors,outline=2,basePs=0.25){
  const key=s+'|'+mul+'|'+colors.join('')+'|'+outline+'|'+basePs;
  let out=_styledCache.get(key);
  if(!out){
    const b=bitmapOf(s,basePs),w=Math.max(1,Math.round(b.w*mul)),h=Math.max(1,Math.round(b.h*mul));
    const core=document.createElement('canvas');core.width=w;core.height=h;
    const cg=core.getContext('2d');cg.imageSmoothingEnabled=false;cg.drawImage(b.canvas,0,0,w,h);
    cg.globalCompositeOperation='source-in';const gr=cg.createLinearGradient(0,0,0,h);
    gr.addColorStop(0,colors[0]);gr.addColorStop(.46,colors[1]);gr.addColorStop(.52,colors[2]);gr.addColorStop(1,colors[3]);
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
  }
  g.imageSmoothingEnabled=false;g.drawImage(out,Math.round(cx-out.width/2),Math.round(cy-out.height/2));
}
/* ------------------------------------------------------------- 基础绘制件 */
function rect(x,y,w,h,c){g.fillStyle=c;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
function stud(x,y){rect(x,y,2,2,C.gold);rect(x+1,y+1,1,1,C.goldDeep);}
function shadowRect(x,y,w,h){rect(x+4,y+5,w,h,C.shadow);}
/* 浅色硬边框卡片：亮底深字，鲜明而不压抑 */
function panel(x,y,w,h,opt={}){const tone=opt.tone||'paper';
  shadowRect(x,y,w,h);
  rect(x,y,w,h,C.lineLo);
  rect(x+2,y+2,w-4,h-4,opt.border||C.line);
  rect(x+4,y+4,w-8,h-8,tone==='gold'?C.goldHi:tone==='teal'?C.tealHi:C.paper);
  rect(x+6,y+6,w-12,2,tone==='gold'?C.gold:tone==='teal'?'#1d6f66':C.paperHi);
  rect(x+6,y+h-8,w-12,2,tone==='gold'?'#c98f18':tone==='teal'?'#1d6f66':C.paperLo);
  stud(x+8,y+8);stud(x+w-10,y+8);stud(x+8,y+h-10);stud(x+w-10,y+h-10);}
function inset(x,y,w,h){rect(x,y,w,h,C.lineLo);rect(x+2,y+2,w-4,h-4,'#fdf8e6');rect(x+2,y+2,w-4,1,'#cbbf9e');}
function heart(x,y,s=2,color=C.red,broken=0){const map=['01100110','11111111','11111111','01111110','00111100','00011000'];map.forEach((row,j)=>[...row].forEach((v,i)=>{if(v==='1'){const dx=broken?(i<4?-broken:broken):0;rect(x+i*s+dx,y+j*s+(broken?Math.abs(i-3.5)*broken*.32:0),s,s,color);}}));if(!broken){rect(x+s,y+s,2*s,s,'#ff9aa2');rect(x+2*s,y+3*s,s,s,C.redDeep);}}
function flagIcon(x,y,s=2){rect(x,y,s,10*s,'#4b565f');rect(x+s,y,7*s,4*s,C.gold);rect(x+s,y+s,5*s,s,C.goldHi);rect(x-2*s,y+10*s,5*s,s,'#5f6f4e');}
function icon(name,x,y,s=1){g.save();g.translate(x,y);g.scale(s,s);if(name==='trophy')drawTrophyTo(g,{x:-6,y:-7,w:12,h:14});else if(name==='flag')flagIcon(-4,-8,1);else if(name==='heart')heart(-4,-3,1);else if(name==='pause'){rect(-5,-6,3,12,C.ink);rect(2,-6,3,12,C.ink);}else if(name==='lock'){rect(-6,-1,12,9,C.inkSoft);rect(-4,-6,8,6,C.inkSoft);rect(-3,-1,6,8,'#fdf8e6');rect(-1,1,2,4,C.inkSoft);}else if(name==='back'){for(let i=0;i<5;i++){rect(-7+i,-5+i,2,2,C.ink);rect(-7+i,5-i,2,2,C.ink);}rect(-3,-1,11,2,C.ink);}else if(name==='play'){for(let i=0;i<9;i++)rect(-5+i,-7+i,2,15-2*i,C.goldDeep);}else if(name==='gear'){rect(-5,-5,10,10,C.ink);rect(-2,-9,4,18,C.ink);rect(-9,-2,18,4,C.ink);rect(-2,-2,4,4,C.paper);}else if(name==='book'){rect(-7,-6,14,12,C.ink);rect(-5,-4,4,8,C.paper);rect(1,-4,4,8,C.paper);rect(-1,-6,2,12,C.ink);}else if(name==='exit'){rect(-7,-7,11,14,C.ink);rect(-5,-5,7,10,C.paper);rect(0,-1,11,2,C.ink);rect(7,-3,2,6,C.ink);rect(4,-5,2,3,C.ink);rect(4,2,2,3,C.ink);}else if(name==='sound'){rect(-7,-2,4,4,C.ink);rect(-3,-5,3,10,C.ink);rect(1,-7,2,14,C.goldDeep);rect(4,-5,2,10,C.goldDeep);}g.restore();}
function inRect(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
/* 亮底按钮：悬停转金色、主要动作转金底深字，文字始终深色保证可读 */
function button(id,label,x,y,w,h,fn,opt={}){const b={id,label,x,y,w,h,fn,disabled:!!opt.disabled};buttons.push(b);
  const hot=!b.disabled&&(inRect(pointer,b)||focusId===id);const dy=hot?(pointer.down?2:-2):0;const gold=!!opt.primary;
  const face=opt.disabled?'#e2ddcc':hot?'#ffe294':gold?C.goldHi:C.paper;
  shadowRect(x,y+dy,w,h);
  rect(x,y+dy,w,h,C.lineLo);
  rect(x+2,y+2+dy,w-4,h-4,opt.disabled?'#c8c3b0':hot?C.gold:gold?C.gold:C.line);
  rect(x+4,y+4+dy,w-8,h-8,face);
  rect(x+6,y+6+dy,w-12,2,opt.disabled?'#efeadd':hot?'#fff6cf':gold?'#fffbe8':C.paperHi);
  rect(x+6,y+h-8+dy,w-12,2,opt.disabled?'#cbc6b4':hot?'#d3a12a':gold?'#d3a12a':C.paperLo);
  if(hot&&w>20){rect(x+3,y+14+dy,w-6,2,'#e8b83a');rect(x+3,y+h-16+dy,w-6,2,'#e8b83a');}
  if(opt.icon)icon(opt.icon,x+26,y+h/2+dy,1.35);
  text(label,x+w/2+(opt.icon?10:0),y+h/2+dy,opt.disabled?C.inkFaint:C.ink,1.16);}
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
function activate(id){const b=buttons.find(v=>v.id===id);if(!b||b.disabled||fxBusy||gated())return;AudioSystem.sfx('uiClick');pointer.down=false;b.fn();}
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
  /* 落地新界面后开启输入闸门：局外页面切换用 UI 时长，进出关卡用稍长的时长。
     局内（playing 且来源也是局内）不加闸门，保持操作灵敏。 */
  gateNow(state==='playing'?GATE_ENTER:GATE_UI);
  /* 局内（playing/win/fail）保持关卡音乐连续（不因结算页而硬切到菜单主题，避免突兀）；
     仅 pause→pause 主题、quit→静音、其余页面→菜单主题。 */
  AudioSystem.setScene((state==='playing'||state==='win'||state==='fail')?'level':state==='pause'?'pause':state==='quit'?'silent':'menu',Game.levels[Game.selected]?.lv);}
function change(state,opts){opts=opts||{};
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
/* 进入关卡：先确保 BGM 就绪（预热命中则瞬时），只在极端未就绪时才显示兜底加载页 */
async function begin(i){if(!Game.levels[i]||!unlocked(i)||Entering)return;Entering=true;
  try{Game.selected=i;const lv=Game.levels[i].lv;
    if(AudioSystem&&AudioSystem.trackReady&&!AudioSystem.trackReady('level',lv)){
      /* 兜底加载页：出现时至少停留 2s，避免一闪而过；正常预热下不会走到这里 */
      if(window.Loading){Loading.show();Loading.setProgress(0.12);}
      let fin=false;const p=AudioSystem.ensureTrack?AudioSystem.ensureTrack('level',lv):Promise.resolve();
      const guard=new Promise(r=>setTimeout(r,900));await Promise.race([p,guard]);if(window.Loading)Loading.setProgress(0.95);
      if(window.Loading){Loading.done();await Loading.waitMin();}
    }
    Game.elapsed=0;Game.simTime=0;Game.hearts=[];Game.newBest=false;LevelContext.levels=Game.levels.map(r=>r.lv);LevelContext.currentIdx=i;FEEL=sanitizeFeel(lv.feel);
    /* 真正“落地”到关卡：重建局内状态并显示游戏画面。必须在遮罩全遮时调用。 */
    const doEnter=()=>{applyState('playing');startPlay();updateCamera(Play.cam,Play.player,Play.worldBounds,Play.camOffset);AudioSystem.setListener(Play.player);AudioSystem.sfx('respawn');acc=0;if(window.Loading)Loading.hide();};
    /* 从页面（选关/胜负页）进入游戏 = 页面级切换 → 播一次遮罩转场。
       关键：遮罩必须在“旧页面仍然可见”时就铺开，并在全遮的瞬间才切到关卡
       （onSwap 回调），否则会先看到关卡场景、再被遮罩扫过，逻辑反了。
       从暂停恢复则视为局内继续，不整屏转场，避免打断节奏。 */
    const fromPage=!['playing','pause'].includes(Game.state);
    if(fromPage&&fxEnabled()&&!fxBusy){fxBusy=true;const m=SceneFX.mode();const d=(SceneFX.isFancy&&SceneFX.isFancy(m))?1.45:0.95;await SceneFX.play(m,d,doEnter);fxBusy=false;}
    else{doEnter();}
  }finally{Entering=false;}
}
function pause(){if(Game.state==='playing')change('pause');else if(Game.state==='pause'){change('playing');AudioSystem.update(Play.player,Play,0);}}
function victory(){if(Game.state!=='playing')return;const r=Game.levels[Game.selected],old=Game.save.best[r.key];Game.newBest=!Number.isFinite(old)||Game.elapsed<old;Game.save.best[r.key]=Math.min(old??Infinity,Game.elapsed);Game.save.completed[r.key]=true;persist();change('win');AudioSystem.sfx('win');}
function resetProgress(){Game.save={completed:{},best:{},trophies:{},music:.6,sfx:.8};persist();AudioSystem.setVolumes(.6,.8);change('settings');notify('存档已清空');}
function slider(id,label,x,y,w,val,set){textLeft(label,x,y,C.ink);const bar={x:x+112,y:y-10,w,h:20};buttons.push({id,label:label+' '+Math.round(val*100)+'%',...bar,slider:true,fn:()=>set(Math.max(0,Math.min(1,(pointer.x-bar.x)/w)))});
  rect(bar.x-2,bar.y+4,w+4,12,C.line);rect(bar.x,bar.y+6,w,8,'#fdf8e6');rect(bar.x,bar.y+6,w,2,'#cbbf9e');
  const fill=w*val;if(fill>1){rect(bar.x,bar.y+6,fill,8,C.gold);rect(bar.x,bar.y+6,fill,3,C.goldHi);}
  rect(bar.x+fill-7,bar.y,14,20,C.line);rect(bar.x+fill-5,bar.y+2,10,16,C.goldHi);rect(bar.x+fill-3,bar.y+4,2,12,'#fffdf0');
  text(Math.round(val*100)+'%',bar.x+w+54,y+6,C.inkSoft,1.05);if(dragSlider===id)set(Math.max(0,Math.min(1,(pointer.x-bar.x)/w)));}
function setVol(k,v){Game.save[k]=v;AudioSystem.setVolumes(Game.save.music,Game.save.sfx);persist();}
function keyboard(key,x,y,w=54,fs=1.05){shadowRect(x,y,w,31);rect(x,y,w,31,C.lineLo);rect(x+2,y+2,w-4,27,C.line);rect(x+4,y+4,w-8,23,'#fffdf2');rect(x+6,y+6,w-12,3,'#ffffff');rect(x+4,y+25,w-8,2,'#cfc4a4');text(key,x+w/2,y+14,C.ink,fs);}

/* ------------------------------------------------------ 天空 · 群山 · 光扫 */
/* 性能关键：静态图层（天空/太阳/群山/森林/遗迹/山丘/草地/暗角）只烘焙一次到离屏画布，
   每帧仅重绘动态的云与光束。全量重绘约 320ms/帧，现降到 1~3ms/帧。 */
const sceneCanvas=document.createElement('canvas');sceneCanvas.width=480;sceneCanvas.height=300;const sg=sceneCanvas.getContext('2d');
const _skyBG=document.createElement('canvas');_skyBG.width=480;_skyBG.height=300;
const _skyTerrain=document.createElement('canvas');_skyTerrain.width=480;_skyTerrain.height=300;
const _skyVig=document.createElement('canvas');_skyVig.width=480;_skyVig.height=300;
let _skyBaked=false;const _cloudSprites=new Map();
function _cloudSprite(w,h){w=Math.round(w);h=Math.round(h);const key=w+'x'+h;let s=_cloudSprites.get(key);if(s)return s;
  s=document.createElement('canvas');s.width=w+8;s.height=h+10;const c=s.getContext('2d');
  _psCloud(c,4,8,w,h,'#bfe0f2','#6f9dc0',1);
  _psCloud(c,7,1,Math.round(w*.74),Math.round(h*.62),'#ffffff','#a9c6da',1);
  c.fillStyle='rgba(255,246,214,0.55)';c.fillRect(6,6,Math.round(w*.5),2);
  s._ox=4;s._oy=8;_cloudSprites.set(key,s);return s;}
function _bakeSky(){
  const c=_skyBG.getContext('2d');
  const gr=c.createLinearGradient(0,0,0,300);
  gr.addColorStop(0,'#2f8fe0');gr.addColorStop(.30,'#5fb0ea');gr.addColorStop(.58,'#9fd4f0');gr.addColorStop(.82,'#d9ecf4');gr.addColorStop(1,'#f6f0d2');
  c.fillStyle=gr;c.fillRect(0,0,480,300);
  const sunX=368,sunY=58,glow=c.createRadialGradient(sunX,sunY,0,sunX,sunY,160);
  glow.addColorStop(0,'rgba(255,252,224,1)');glow.addColorStop(.14,'rgba(255,240,170,0.62)');glow.addColorStop(.42,'rgba(255,214,120,0.24)');glow.addColorStop(1,'rgba(255,200,110,0)');
  c.fillStyle=glow;c.fillRect(sunX-160,sunY-160,320,320);
  c.fillStyle='#fffbdc';c.fillRect(sunX-12,sunY-12,24,24);c.fillStyle='#fff4b4';c.fillRect(sunX-16,sunY-7,32,14);c.fillRect(sunX-7,sunY-16,14,32);
  const tc=_skyTerrain.getContext('2d');
  for(let i=0;i<5;i++)_psMountain(tc,i*123-70,74+(i%2)*8,196,150,'#7fa8c4','#5b86a8',1);
  for(let i=0;i<6;i++)_psMountain(tc,i*101-48,106+(i%3)*9,172,146,'#5b86a8','#41688c',1);
  _psPineForest(tc,-24,170,300,102,'#3f7a63','#2a5a4c',1);_psPineForest(tc,250,168,280,100,'#3f7a63','#2a5a4c',1);
  _psRuins(tc,54,198,120,80,'#6e8f9e','#4d6f85',1);_psTower(tc,330,180,54,96,'#6e8f9e','#4d6f85',1);
  _psHill(tc,-40,252,320,102,'#79b46a','#4e8c52',1);_psHill(tc,202,248,346,102,'#82bd6e','#548c55',1);
  tc.fillStyle='#6ba85e';tc.fillRect(0,286,480,14);
  for(let i=0;i<480;i+=3){tc.fillStyle=i%2?'#a9d788':'#4d8347';tc.fillRect(i,284+(i%5),2,4);}
  const vc=_skyVig.getContext('2d');
  const vig=vc.createRadialGradient(240,150,110,240,150,340);
  vig.addColorStop(0,'rgba(0,0,0,0)');vig.addColorStop(.70,'rgba(32,64,96,0.10)');vig.addColorStop(1,'rgba(24,52,84,0.30)');
  vc.fillStyle=vig;vc.fillRect(0,0,480,300);
  _skyBaked=true;}
function sky(){const t=clock;if(!_skyBaked)_bakeSky();
  sg.setTransform(1,0,0,1,0,0);sg.clearRect(0,0,480,300);
  sg.drawImage(_skyBG,0,0);
  /* 云：唯一逐帧位移的图层，使用预烘焙精灵，代价极低 */
  for(let i=0;i<9;i++){const x=((i*97+t*(1.1+(i%4)*.75))%640)-140,y=20+(i%4)*32,w=92+(i%3)*48,h=36+(i%2)*14;
    const sp=_cloudSprite(w,h);sg.drawImage(sp,Math.round(x-sp._ox),Math.round(y-sp._oy));}
  sg.drawImage(_skyTerrain,0,0);
  /* 缓慢横扫的阳光光束（程序化光影 shader 观感） */
  const center=(Math.sin(t*.055)*.5+.5)*700-110;
  for(let x=0;x<480;x+=3){const d=(x-center)/115;const beam=Math.exp(-(d*d));if(beam<.004)continue;sg.fillStyle=`rgba(255,250,214,${(beam*.30).toFixed(3)})`;sg.fillRect(x,0,3,300);}
  sg.save();sg.globalCompositeOperation='screen';
  sg.beginPath();sg.moveTo(384,0);sg.lineTo(424,0);sg.lineTo(206+Math.sin(t*.07)*36,300);sg.lineTo(60+Math.sin(t*.07)*36,300);sg.fillStyle='rgba(255,244,196,0.15)';sg.fill();
  sg.beginPath();sg.moveTo(292,0);sg.lineTo(318,0);sg.lineTo(116+Math.sin(t*.05)*26,300);sg.lineTo(14+Math.sin(t*.05)*26,300);sg.fillStyle='rgba(255,232,168,0.10)';sg.fill();
  sg.restore();
  sg.drawImage(_skyVig,0,0);
  g.imageSmoothingEnabled=false;g.drawImage(sceneCanvas,0,0,W,H);}
/* 标题：不使用背景板，仅靠加大字号 + 金色渐变 + 粗描边保证清晰 */
function titleBlock(cx,cy,k){styledText('拼 死 跳 跃',cx,cy-Math.round(14*k),k*2.05,['#ffffff','#ffe98a','#e8a92c','#96630e'],3.4,0.25);renderSubtitle(cx,cy+Math.round(46*k),k);}
function renderSubtitle(cx,cy,k){const label='D I E   T O   J U M P';
  /* 与主标题同源的渐变描边，无背景板；两侧红色短线作点缀 */
  const bw=Math.round(300*k);
  styledText(label,cx,cy,Math.max(1,1.18*k),['#ffffff','#ffe98a','#e8a92c','#96630e'],2.2,0.25);
  rect(cx-bw/2-44,cy-2,14,4,C.red);rect(cx+bw/2+30,cy-2,14,4,C.red);}

/* ------------------------------------------------------------- 启动 / 主菜单 */
let bootArmed=false;
async function startGame(){if(Game.state!=='boot'||bootArmed)return;bootArmed=true;
  /* 菜单 BGM 与音频解锁**并行**等待：启动预热通常已把 menu 轨算好（缓存命中立即返回）；
     万一没赶上，就等它算完再切页面，避免“进了主菜单但音乐要等一阵才响”。
     用 Promise.race 限制上限，极端情况也不至于卡住开始流程。 */
  const warmMenu=Promise.resolve().then(()=>{
    if(AudioSystem&&AudioSystem.ensureTrack)return AudioSystem.ensureTrack('menu',null);
  }).catch(()=>{});
  await Promise.all([AudioSystem.init(),Promise.race([warmMenu,new Promise(r=>setTimeout(r,1500))])]);
  AudioSystem.setVolumes(Game.save.music,Game.save.sfx);change('menu',{noFx:true});
  /* 后台空闲预热全部关卡 BGM：之后进任何关卡都是零延迟、音乐立刻正确 */
  try{if(AudioSystem.prewarm)AudioSystem.prewarm(Game.levels.map(r=>r.lv));}catch(e){}}
/* 起始页：只有跳动的提示文字，不摆放任何按钮 */
function boot(){
  /* 简约独立游戏启动页：居中 logo + 一行标语 + 呼吸提示，其余一律留白。
     移除了旧版的左右箭头、双行提示与副标题短线，观感更接近独立游戏开场。 */
  const cy=H*.40;
  styledText('拼 死 跳 跃',W/2,cy-H*.030,2.30,['#ffffff','#ffe98a','#e8a92c','#96630e'],3.6,0.25);
  styledText('D I E   T O   J U M P',W/2,cy+H*.048,1.06,['#ffffff','#fff3cf','#f4c96a','#b8811c'],1.9,0.25);
  rect(W/2-Math.round(W*.15),cy+H*.086,Math.round(W*.30),1,'rgba(255,255,255,.34)');
  styledText('每一次陨落，都是下一次起跳的回响',W/2,cy+H*.124,.98,['#ffffff','#fff3cf','#f4c96a','#b8811c'],1.5,0.25);
  const pulse=.30+.70*(.5+.5*Math.sin(clock*2.4));
  g.save();g.globalAlpha=pulse;
  styledText('按 任 意 键 开 始',W/2,H*.82,1.30,['#ffffff','#fff2b0','#f0b73e','#a9770f'],2.2,0.25);
  g.restore();
  g.save();g.globalAlpha=.42;textRight('v1.0 · 独立游戏版',W-18,H-16,C.skyInkDim,.75);g.restore();}
function menu(){titleBlock(W/2,H*.21,1.0);
  const items=[['chooseLevels','选择关卡','flag',()=>change('levels'),true],
    ['settings','设置','gear',()=>change('settings'),false],
    ['help','游戏说明','book',()=>change('help'),false],
    ['exit','退出游戏','exit',()=>change('exitConfirm'),false]];
  const x=W/2-152,step=54,h=46,th=(items.length-1)*step+h,y=Math.round(H*.46);
  items.forEach(([id,label,ic,fn,primary],j)=>button(id,label,x,y+j*step,304,h,fn,{primary,icon:ic}));}
function header(title,sub){button('back','返回',28,26,104,36,()=>change('menu'),{icon:'back'});styledText(title,W/2,52,1.7,['#ffffff','#ffe98a','#e8a92c','#96630e'],3.0,0.25);if(sub)text(sub,W/2,80,C.skyInkDim,1.0);}
function trophyPlate(ex,ey,taken,total){const w=206,h=46,x=ex-w,y=ey;panel(x,y,w,h,{tone:'gold'});icon('trophy',x+32,y+h/2,2.0);rect(x+56,y+9,2,h-18,C.goldDeep);text('奖杯',x+74,y+17,C.ink,1.0);text(`${taken} / ${total}`,x+160,y+29,C.ink,1.3);}
/* --------------------------------------------------------------- 选择关卡 */
function levels(){const all=Game.levels.flatMap(r=>r.lv.elements.filter(e=>e.type==='trophy').map(e=>r.key+'::'+e.id)),taken=all.filter(k=>Game.save.trophies[k]).length;
  header('选择关卡','');trophyPlate(W-30,26,taken,all.length);
  /* 列数自适应：宽屏/超宽屏铺更多列，避免整块面板缩在中间显得空 */
  const per=colsPerRow(),start=Game.page*per,gap=28,cw=Math.min(258,(W-190-gap*(per-1))/per),ch=Math.min(300,H-244),y=Math.max(114,(H-ch)/2+16),count=Math.min(per,Math.max(0,Game.levels.length-start)),offset=(W-(cw*count+gap*Math.max(0,count-1)))/2;
  if(!Game.levels.length){panel(W/2-250,y+20,500,120);text('尚无可用关卡',W/2,y+70,C.ink,1.2);}
  for(let j=0;j<per;j++){const i=start+j,r=Game.levels[i];if(!r)continue;const x=offset+j*(cw+gap),on=unlocked(i);
    panel(x,y,cw,ch);
    rect(x+14,y+14,cw-28,132,'#ffffff');
    if(r.preview)g.drawImage(r.preview,x+16,y+16,cw-32,128);
    rect(x+14,y+14,cw-28,1,'#ffffffcc');rect(x+14,y+142,cw-28,1,'#00000033');
    if(!on){rect(x+14,y+14,cw-28,130,'rgba(247,239,215,0.72)');icon('lock',x+cw/2,y+80,2.8);}
    panel(x+20,y+20,46,26,{tone:'gold'});text(String(i+1).padStart(2,'0'),x+43,y+35,C.ink,1.0);
    if(Game.save.completed[r.key]){panel(x+cw-76,y+20,58,24,{tone:'teal'});text('已通关',x+cw-47,y+33,C.ink,.82);}
    rect(x+20,y+156,cw-40,2,'#cbbf9e');
    text(r.lv.name,x+cw/2,y+178,on?C.ink:C.inkFaint,1.22);
    text('最快时间',x+cw/2,y+206,C.inkSoft,.88);
    text(formatTime(Game.save.best[r.key]),x+cw/2,y+232,Number.isFinite(Game.save.best[r.key])?C.ink:C.inkFaint,1.18);
    button('level-'+i,on?'进入':'未解锁',x+20,y+ch-56,cw-40,38,()=>begin(i),{primary:on,disabled:!on,icon:on?'play':'lock'});}
  const by=H-84,pages=Math.max(1,Math.ceil(Game.levels.length/per));
  if(pages>1){button('pagePrev','◀',W/2-190,by,62,36,()=>{Game.page--;},{disabled:Game.page===0});panel(W/2-114,by,228,36);text(`第 ${Game.page+1} / ${pages} 页`,W/2,by+18,C.ink,1.05);button('pageNext','▶',W/2+128,by,62,36,()=>{Game.page++;},{disabled:Game.page>=pages-1});}}
/* ----------------------------------------------------------- 设置 / 暂停 */
function settings(paused=false){if(!paused)header('设置','');const pw=Math.min(600,W-40),ph=306,x=(W-pw)/2,y=(H-ph)/2;panel(x,y,pw,ph);
  text(paused?'已暂停':'声音与存档',W/2,y+38,C.ink,1.55);
  rect(x+28,y+60,pw-56,2,'#cbbf9e');
  /* 滑条长度按面板实际宽度自适应，窄窗口下不会被裁掉 */
  const sw=Math.max(150,pw-354);
  icon('sound',x+38,y+116,1.35);slider('musicSlider','音乐音量',x+92,y+110,sw,Game.save.music,v=>setVol('music',v));
  icon('sound',x+38,y+172,1.35);slider('sfxSlider','音效音量',x+92,y+166,sw,Game.save.sfx,v=>setVol('sfx',v));
  if(paused){const bw=Math.max(110,(pw-100)/2);button('resume','继续游戏',x+44,y+214,bw,42,()=>pause(),{primary:true,icon:'play'});button('returnLevels','返回选关',x+pw-44-bw,y+214,bw,42,()=>change('levels'),{icon:'flag'});text('按 ESC 继续',W/2,y+282,C.inkSoft,.95);}
  else{button('resetSave','清除存档',x+pw/2-120,y+216,240,42,()=>change('resetConfirm'),{icon:'exit'});text('清空进度、奖杯、纪录与声音设置',W/2,y+284,C.inkSoft,1.0);}}
function help(){header('游戏说明','');
  /* 面板宽度自适应视口：窄窗口下整体等比缩小，保证按键列与文字列都不越界、不裁切。 */
  const maxW=704,pw=Math.min(maxW,W-40),k=pw/maxW;
  const x=W/2-pw/2,ph=Math.min(426,H-140),y=Math.max(88,Math.min(104,(H-ph)/2));
  panel(x,y,pw,ph);
  button('helpKeys','键位说明',x+22*k,y+20,168*k,36,()=>{Game.tab=0;},{primary:Game.tab===0});
  button('helpRules','玩法说明',x+202*k,y+20,168*k,36,()=>{Game.tab=1;},{primary:Game.tab===1});
  rect(x+22*k,y+68,pw-44*k,2,'#cbbf9e');
  if(!Game.tab){const rows=[['A / D','左右移动'],['W / ↑','跳跃 · 长按更高 · 空中二段跳 / 蹬墙跳'],['空格','跳跃'],['F','插旗 / 拔旗 · 设置重生点'],['K','主动爆破 · 推箱 / 碎块 / 引燃'],['J','按住减缓幽灵回放 · 消耗慢放能量'],['L','幽灵回到轨迹起点'],['ESC','暂停 / 继续']];
    /* 行距随可用高度压缩，避免高/矮窗口下行溢出面板 */
    const step=Math.min(46,(ph-104)/rows.length);
    rows.forEach(([key,s],i)=>{const dy=92+i*step;keyboard(key,x+40*k,y+dy,104*k,1.05*Math.max(.8,k));textLeft(s,x+196*k,y+dy+15,C.ink,1.14*Math.max(.82,k));});}
  else{const lines=['抵达终末之门即可通关，通关后解锁下一关。','阵亡会留下回放幽灵：可承载你、压住机关、阻隔激光。','爆破与幽灵回放的爆炸能推箱、碎块、引燃与融冰。','旗子可设新重生点；拔旗清除幽灵并回退上一个重生点。','生命耗尽则本关失败，可即时重试；奖杯一经拾取永久保留。','冰面打滑、重力区倒转、消失台周期隐现、开关联动门扉。','水中移动迟滞，连续浸水十秒窒息，出水即恢复呼吸。','烟雾遮蔽视野，幽灵周围会开辟可视范围。','用时包含阵亡过程，不含暂停；最快时间支持反复刷新。'];
    const step=Math.min(32,(ph-108)/lines.length);
    lines.forEach((l,i)=>{const ly=y+98+i*step;rect(x+48*k,ly-6,6,6,C.gold);rect(x+50*k,ly-4,2,2,'#fff4c4');textLeft(l,x+72*k,ly,C.ink,1.12*Math.max(.82,k));});}}
function confirmScreen(kind){const reset=kind==='resetConfirm';const pw=Math.min(540,W-40),ph=240,x=(W-pw)/2,y=(H-ph)/2;panel(x,y,pw,ph);
  text(reset?'确认清除存档？':'结束这次冒险？',W/2,y+46,reset?'#8e1d28':C.ink,1.55);
  text(reset?'进度、奖杯、纪录与设置都会重置，无法恢复':'进度已自动保存，下次仍可继续',W/2,y+94,C.inkSoft,1.05);
  const bw=Math.max(110,(pw-108)/2);
  button('confirmNo','取消',x+48,y+156,bw,42,()=>change(reset?'settings':'menu'));
  button('confirmYes',reset?'确认清空':'退出',x+pw-48-bw,y+156,bw,42,()=>{if(reset)resetProgress();else{change('quit');window.close();}},{primary:true});}
/* ------------------------------------------------------------------- 局内 HUD */
function hud(){
  panel(18,16,Math.max(104,Play.lives*26+30),44);
  for(let i=0;i<Play.lives;i++)heart(32+i*26,30,2);
  for(const a of Game.hearts){const t=clock-a.time;if(t<.8){g.save();g.globalAlpha=1-t/.8;heart(a.x,30+t*30,2,C.red,t*8);g.restore();}}
  panel(W/2-94,16,188,44);text(formatTime(Game.elapsed),W/2,36,C.ink,1.38);
  button('pauseButton','',W-72,16,54,44,()=>pause(),{icon:'pause'});
  panel(18,H-70,Math.max(104,Play.flagsCollected*26+30),48);
  for(let i=0;i<Play.flagsCollected;i++)flagIcon(32+i*26,H-58,1.9);
  if(!Play.flagsCollected)text('无旗',64,H-44,C.inkFaint,.95);
  const bx=170+Play.flagsCollected*26;
  /* 慢放条：平时隐藏（满能量），一旦消耗过就常显。
     触底回涨期间为黄色，回满后黄色缓慢渐变为原本的绿色（slowWarn 1→0）。 */
  if(Play.energy<.999||Play.slowWarn>.01){
    const w=Math.max(0,Math.min(1,Play.slowWarn||0));
    const mix=(a,b)=>Math.round(a+(b-a)*w);
    const fill=`rgb(${mix(47,232)},${mix(158,176)},${mix(143,38)})`;      /* teal → amber */
    const hi=`rgb(${mix(102,255)},${mix(201,226)},${mix(184,122)})`;
    rect(bx-4,H-46,96,10,C.line);rect(bx-2,H-44,92,6,'#fdf8e6');
    if(Play.energy>0.004){rect(bx-2,H-44,92*Play.energy,6,fill);rect(bx-2,H-44,92*Play.energy,2,hi);}
    if(Play.slowLocked)text('回能中',bx+44,H-56,'#ffe08a',.78);else text('慢放',bx+44,H-56,C.skyInk,.78);
  }
  if(Play._inWater){panel(W/2-86,H-58,172,32,{tone:'teal'});text('呼吸 '+Play.waterBubbleTimer.toFixed(1)+' 秒',W/2,H-42,C.ink,1.0);}
  text(Game.levels[Game.selected]?.lv.name||'',W-94,H-46,C.skyInk,.88);}
function result(win){const pw=540,ph=326,x=(W-pw)/2,y=(H-ph)/2;panel(x,y,pw,ph);
  if(win)icon('trophy',W/2,y+50,2.3);else heart(W/2-11,y+42,2,C.red,4);
  styledText(win?'关 卡 完 成':'生 命 耗 尽',W/2,y+98,1.55,win?['#ffffff','#ffe98a','#e8a92c','#96630e']:['#fff0f0','#ff8f96','#d4384a','#8e1d28'],3.0,0.25);
  if(win){text(formatTime(Game.elapsed),W/2,y+142,C.ink,1.4);panel(W/2-118,y+168,236,32,{tone:Game.newBest?'gold':'paper'});text(Game.newBest?'新的最快纪录':'已记录通过时间',W/2,y+184,C.ink,1.05);}
  else{text('本次用时 '+formatTime(Game.elapsed),W/2,y+142,C.ink,1.1);text('阵亡 '+Play.deathCount+' 次',W/2,y+170,C.inkSoft,1.05);}
  const next=Game.selected<Game.levels.length-1;
  button('retry','再次挑战',x+42,y+222,214,42,()=>begin(Game.selected),{primary:true});
  button('resultLevels',win&&next?'下一关':'返回选关',x+284,y+222,214,42,()=>win&&next?begin(Game.selected+1):change('levels'),{icon:win&&next?'play':'flag'});}
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
function renderUI(){g.setTransform(dpr*scale,0,0,dpr*scale,0,0);g.clearRect(0,0,W,H);buttons=[];
  if(Game.state!=='playing')sky();
  if(['pause','win','fail'].includes(Game.state))rect(0,0,W,H,'rgba(28,48,70,0.40)');
  switch(Game.state){case'boot':boot();break;case'menu':menu();break;case'levels':levels();break;case'settings':settings();break;case'help':help();break;case'playing':hud();break;case'pause':settings(true);break;case'win':result(true);break;case'fail':result(false);break;case'resetConfirm':confirmScreen('resetConfirm');break;case'exitConfirm':confirmScreen('exitConfirm');break;case'quit':titleBlock(W/2,H*.36,1.1);text('冒险已结束 · 进度已保存',W/2,H*.58,C.skyInk,1.2);text('可以安全关闭此窗口',W/2,H*.65,C.skyInkDim,1.0);button('backToMenu','返回主菜单',W/2-120,H*.74,240,44,()=>change('menu'));break;}
  if(Game.toast&&Game.toast.until>clock){const s=Game.toast.text;panel(W/2-238,H-104,476,42,{tone:'gold'});text(s,W/2,H-83,C.ink,1.05);}
  if(Game.transition>0){g.save();g.globalAlpha=Game.transition*.22;rect(0,0,W,H,'#ffffff');g.restore();}
  syncAccess();}
/* ---------------------------------------------- 真实生产路径上的输入与物理 */
const oldPhysics=stepPlayerPhysics;
stepPlayerPhysics=function(p,keys,dt,solids,ghosts,mods){const was=p.grounded,prevHold=p.jumpHold,can=p.canDoubleJump,wall=p.wallJumpUsed,vy=p.vy;oldPhysics(p,keys,dt,solids,ghosts,mods);if(p.jumpHold>prevHold&&prevHold===0&&p.vy*p.gravityDir<0)AudioSystem.sfx(p.wallJumpUsed&&!wall?'wallJump':'jump',p.x,p.y);else if(can&&!p.canDoubleJump&&p.vy*p.gravityDir<0)AudioSystem.sfx('doubleJump',p.x,p.y);if(!was&&p.grounded&&vy*p.gravityDir>.5)AudioSystem.sfx('land',p.x,p.y);if(p.grounded&&Math.abs(p.vx)>.3&&Game.simTime-(p._lastStep||0)>.30){AudioSystem.sfx('step',p.x,p.y);p._lastStep=Game.simTime;}};
const originalDie=diePlay;
diePlay=function(){if(!Play.player||Play.player.dead||(Play.deathAnim&&Play.deathAnim.active))return;const n=Play.lives;Game.hearts.push({x:32+(n-1)*26,time:clock});AudioSystem.sfx('death',Play.player.x,Play.player.y);if(n<=1){Play.lives=0;Play.deathCount++;Play.player.dead=true;change('fail');AudioSystem.sfx('fail');return;}originalDie();};
const originalRespawn=respawnPlay;
respawnPlay=function(origin){originalRespawn(origin);if(Game.state==='playing')AudioSystem.sfx('respawn',Play.player.x,Play.player.y);};
const originalFlag=doFlagAction;
doFlagAction=function(){const n=Play.placedFlags.length;originalFlag();if(n!==Play.placedFlags.length)AudioSystem.sfx(n<Play.placedFlags.length?'flagPlace':'flagPull',Play.player.x,Play.player.y);};
function eventSnapshot(){return{water:Play._inWater,flags:Play.flagPickups.length,hearts:Play.hearts.length,breaks:Play.breakables.length,ice:Play.iceBlocks.length,gravity:Play.player.gravityDir,ghosts:Play.ghosts.length,doors:[...Play.doors,...Play.switchDoors].map(v=>v.open),plates:Play.plates.map(v=>v.active),switches:Play.switches.map(v=>v._pressed),burns:Play.flammables.map(v=>v.burning>0),falls:Play.fallingSpikes.map(v=>v._f),smoke:Play.smokes.some(s=>rectsOverlap(Play.player,s))};}
function simulation(){if(Game.state!=='playing')return;Game.elapsed+=1/60;Game.simTime+=1/60;const b=eventSnapshot();updatePlay(1/60);AudioSystem.update(Play.player,Play,1/60);const a=eventSnapshot(),p=Play.player,sound=n=>AudioSystem.sfx(n,p.x,p.y);
  if(a.water!==b.water)sound(a.water?'waterEnter':'waterExit');if(a.flags<b.flags)sound('flagPickup');if(a.hearts<b.hearts)sound('heart');if(a.breaks<b.breaks)sound('break');if(a.ice<b.ice)sound('melt');if(a.gravity!==b.gravity)sound('gravity');if(a.ghosts>b.ghosts)sound('ghost');if(a.smoke&&!b.smoke)sound('smokeEnter');
  a.doors.forEach((v,i)=>{if(v!==b.doors[i])sound(v?'doorOpen':'doorClose');});a.plates.forEach((v,i)=>{if(v&&!b.plates[i])sound('plate');});a.switches.forEach((v,i)=>{if(v&&!b.switches[i])sound('switch');});a.burns.forEach((v,i)=>{if(v&&!b.burns[i])sound('ignite');});a.falls.forEach((v,i)=>{if(v&&!b.falls[i])sound('fallingSpike');});
  if(a.water&&Math.floor(Game.simTime*1.2)!==Math.floor((Game.simTime-1/60)*1.2))sound('bubble');if(Play.won)victory();}
function frame(now){const dt=Math.min(.12,(now-last)/1000);last=now;clock+=dt;Game.transition=Math.max(0,Game.transition-dt*4);
  if(window.MU&&MU.updateTilt)MU.updateTilt(dt);
  if(Game.state==='playing'){acc+=dt;let guard=0;while(acc>=1/60&&guard++<8){simulation();acc-=1/60;}renderPlay();}
  else if(['pause','win','fail'].includes(Game.state))renderPlay();else acc=0;renderUI();requestAnimationFrame(frame);}
function point(e){pointer.x=e.clientX/scale;pointer.y=e.clientY/scale;}
window.addEventListener('pointermove',e=>{point(e);const b=buttons.find(v=>!v.disabled&&inRect(pointer,v));if((b?b.id:'')!==hoverId){hoverId=b?b.id:'';if(hoverId)AudioSystem.sfx('uiHover');}});
window.addEventListener('pointerdown',e=>{point(e);
  /* 记录本次输入的指针类型：只有触摸/手写笔才会遭受“抬起时界面已换掉”的穿透，
     所以闸门仅对它们生效（鼠标/键盘玩家的点击立即响应，不受影响）。 */
  armGate(e.pointerType);
  pointer.down=true;if(Game.state==='boot'){if(window.MU&&MU.enableGyro)MU.enableGyro();startGame();return;}const b=buttons.find(v=>inRect(pointer,v));if(b&&b.slider){dragSlider=b.id;e.preventDefault();}});
window.addEventListener('pointerup',()=>{pointer.down=false;dragSlider=null;});
window.addEventListener('keydown',e=>{const code=e.code;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(code))e.preventDefault();
  if(Game.state==='boot'){if(!e.repeat&&!['ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight'].includes(code))startGame();return;}
  if(code==='Escape'&&!e.repeat){if(['playing','pause'].includes(Game.state))pause();else if(['settings','help','levels'].includes(Game.state))change('menu');else if(Game.state==='resetConfirm')change('settings');else if(Game.state==='exitConfirm')change('menu');return;}
  if(Game.state!=='playing'||e.repeat)return;Play.keys[code==='Space'?'ArrowUp':code]=true;if(code==='KeyK')doSuicidePlay();if(code==='KeyF')doFlagAction();if(code==='KeyJ')AudioSystem.sfx('slow');if(code==='KeyL'){if(rewindGhosts())AudioSystem.sfx('ghost');}if(code==='KeyR')begin(Game.selected);});
window.addEventListener('keyup',e=>{Play.keys[e.code==='Space'?'ArrowUp':e.code]=false;});
window.addEventListener('blur',()=>{Play.keys={};pointer.down=false;dragSlider=null;if(Game.state==='playing')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&Game.state==='playing')pause();});
/* resize 监听由 mobile-ui.js 接管（它有自己的整套竖屏布局流程），
   手机版在 index.html 里先置 window.MOBILE_MODE=true，这里就不再注册，
   避免两套缩放逻辑互相覆盖。电脑版没有该标志，正常走下面的 resize()。
   —— 用同一个开关而非两套文件，可避免电脑版/手机版源码漂移。 */
if(!window.MOBILE_MODE)window.addEventListener('resize',resize);
/* ------------------------------------------------------------ 关卡载入 */
function normalize(data){const source=Array.isArray(data)?data:(data&&Array.isArray(data.levels))?data.levels:(data&&data.level)?[data.level]:(data&&data.elements)?[data]:[];const out=[];
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
    out.push({lv,key:'lv'+order+'#'+i,order,preview:preview(lv)});});
  out.sort((a,b)=>a.order-b.order);return out;}
function preview(lv){const c=document.createElement('canvas');c.width=340;c.height=150;const q=c.getContext('2d');q.imageSmoothingEnabled=false;
  const b=(lv.chambers||[]).reduce((b,ch)=>({x:Math.min(b.x,ch.x),y:Math.min(b.y,ch.y),r:Math.max(b.r,ch.x+ch.w),d:Math.max(b.d,ch.y+ch.h)}),{x:Infinity,y:Infinity,r:-Infinity,d:-Infinity});
  const bx=isFinite(b.x)?b:{x:0,y:0,r:200,d:88};const z=Math.min(340/(bx.r-bx.x),150/(bx.d-bx.y));
  q.fillStyle='#0c1520';q.fillRect(0,0,340,150);q.save();q.translate((340-(bx.r-bx.x)*z)/2,(150-(bx.d-bx.y)*z)/2);q.scale(z,z);q.translate(-bx.x,-bx.y);
  for(const bg of lv.backgrounds.slice().sort((a,b2)=>(a.layer||0)-(b2.layer||0)))for(const s of bg.shapes||[])try{drawBgShape(q,s,s.x,s.y,s.w,s.h,s.alpha==null?.8:s.alpha,0,false,true,[],z);}catch(e){}
  for(const e of lv.elements){const a=getAdjacency(e,lv.elements);switch(e.type){case'platform':drawPlatformTo(q,e,a);break;case'ice':drawIceTo(q,e,a);break;case'movable':drawMovableTo(q,e,a);break;case'breakable':drawBreakableTo(q,e,a);break;case'flammable':drawFlammableTo(q,e,a);break;case'water':drawWaterTo(q,e,false);break;case'goal':drawGoalPortalShader(q,e,0);break;case'trophy':drawTrophyTo(q,e);break;case'switchDoor':drawSwitchDoorTo(q,e,false);break;case'switch':drawSwitchTo(q,e,false);break;case'gravityFlip':drawGravityZoneShader(q,e,0);break;case'door':q.fillStyle='#c19748';q.fillRect(e.x,e.y,e.w,e.h);break;case'spike':case'fallingSpike':q.fillStyle='#cf4e65';q.beginPath();q.moveTo(e.x,e.y+e.h);q.lineTo(e.x+e.w/2,e.y);q.lineTo(e.x+e.w,e.y+e.h);q.fill();break;case'spawn':q.fillStyle='#6affa9';q.fillRect(e.x,e.y-8,8,8);break;case'flagPickup':q.fillStyle='#edce61';q.fillRect(e.x,e.y,6,4);break;case'heart':q.fillStyle='#e46376';q.fillRect(e.x,e.y,7,6);break;case'laserRight':case'laserLeft':case'laserUp':case'laserDown':q.fillStyle='#ff4d6a';q.fillRect(e.x,e.y,7,7);break;case'disappear':q.fillStyle='rgba(190,170,255,.75)';q.fillRect(e.x,e.y,Math.max(6,e.w),Math.max(4,e.h));break;}}
  q.restore();return c;}
function loadLevels(){Game.levels=normalize(window.LEVELS_DATA);Game.page=Math.min(Game.page,Math.max(0,Math.ceil(Game.levels.length/3)-1));Game.ready=true;screenKey='';}
['playScreen','playCanvas','playCanvasWrap','playInfo','playWin','playControls'].forEach(k=>D[k]=document.getElementById(k));
resize();loadLevels();requestAnimationFrame(frame);
window.GameAPI={begin,pause,normalize,loadLevels,formatTime,unlocked,resetProgress,simulation,change,
  transitioning:()=>fxBusy||(window.SceneFX?SceneFX.isPlaying():false),
  getState:()=>({state:Game.state,elapsed:Game.elapsed,simTime:Game.simTime,level:Game.selected,lives:Play.lives,flags:Play.flagsCollected,save:clone(Game.save),levels:Game.levels.map(r=>({name:r.lv.name,key:r.key})),audio:AudioSystem.debug()})};
