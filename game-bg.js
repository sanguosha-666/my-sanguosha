// 大厅背景视频 + 游戏内 Canvas 动态背景（飘牌 + 死亡特效）。
// 纯视觉层：不读游戏状态。死亡触发由 render.js 检测 alive 变化后调用 triggerDeathFx。
// 加载顺序：index.html 最后（render-log.js 之后），共享全局作用域。
// vm 测试沙箱不加载本文件；跨文件调用方一律 typeof 防御。

// ============ 大厅背景视频（随机播放） ============
var BG_VIDEOS = [
  'assets/video/bg-1.mp4',
  'assets/video/bg-2.mp4',
  'assets/video/bg-3.mp4'
];

// ============ CORE-144(issue #197):手机端不播大厅背景视频 ============
// 【为什么】<video id="bgVideo" autoplay muted loop> 里的 bg-1/2/3.mp4 各 5~6MB,loop
// 无限循环。视频硬件解码是持续性功耗负载,而大厅是"等朋友进房"的场景,可能停留好几分钟,
// 期间用户往往只是盯着屏幕等——纯装饰性的动态背景在这里性价比最低。而且每次进大厅
// pickRandomBgVideo() 都会随机换一个重新加载,手机上还额外吃 5~6MB 移动流量。
//
// 【范围:只砍手机,平板/桌面维持现状】和 CORE-141(#194)同一取舍与同一判定函数
// (isPhoneLayout,定义在本文件下方;函数声明会提升,这里调用时机没问题)。**不要只按宽度
// 判定**——本项目强制引导手机横屏,视口约 844x390,宽度正好落在平板断点(641~1199px)内,
// 只看宽度会把手机横屏误判成平板,详见 isPhoneLayout 处的完整说明与 CLAUDE.md 规则22。
//
// 【手机端的效果】不设置 v.src(**连下载都不发生**,这是省流量的关键——只 pause 不设 src
// 仍会把整个文件拉下来)、不播放,并隐藏视频与遮罩层,回到 body 本来的渐变默认背景——
// 和进房时 pauseBgVideo() 的视觉落点完全一致,不是一个新的空白状态。
//
// 【刻意不碰音轨解锁】unmuteBgVideo/unlockFxAudio 一个字节不动:它除了大厅视频,还负责
// 解锁死亡/闪电/过场三条全屏特效的音轨(FX_VIDEO_IDS 包含 bgVideo 但不止它),手机端
// 不播大厅视频**不等于**可以跳过那套解锁,否则手机上所有特效都会变成哑的。
function shouldPlayLobbyVideo(){
  return !(typeof isPhoneLayout === 'function' && isPhoneLayout());
}
// hideLobbyVideo:把大厅视频与遮罩收起来,回到 body 默认渐变背景。
// 视觉落点与 pauseBgVideo 一致;区别是这里还会在 src 已存在时一并释放(removeAttribute
// + load(),同 hideFxVideo 的既有做法),避免已经下载的那份继续占内存。
function hideLobbyVideo(v){
  if(!v) return;
  if(typeof v.pause === 'function') v.pause();
  v.style.visibility = 'hidden';
  // 只在确实设过 src 时才释放:没设过就调 load() 会在部分浏览器里报无源警告。
  if(v.getAttribute && v.getAttribute('src')){
    if(typeof v.removeAttribute === 'function') v.removeAttribute('src');
    if(typeof v.load === 'function') v.load();
  }
  var veil = document.getElementById('bgVeil');
  if(veil) veil.style.visibility = 'hidden';
}

// 回大厅时随机选一个视频并尝试播放（muted+playsinline 保证自动播放策略通过）
function pickRandomBgVideo(){
  var v = document.getElementById('bgVideo');
  if(!v) return;
  // CORE-144:手机端直接收起,不设 src、不下载、不播放。
  if(!shouldPlayLobbyVideo()){ hideLobbyVideo(v); return; }
  v.style.visibility = 'visible'; // 恢复可见(进房时被隐藏,避免停帧像卡住)
  v.src = BG_VIDEOS[Math.floor(Math.random() * BG_VIDEOS.length)];
  if(typeof v.load === 'function') v.load();
  if(typeof v.play === 'function'){
    var p = v.play();
    if(p && typeof p.catch === 'function') p.catch(function(){});
  }
}

// 进房暂停大厅视频（避免后台耗流量/CPU），并隐藏视频与遮罩层——
// 若只 pause 不隐藏,<video> 会停在最后一帧,背景看起来像卡住;
// 隐藏后回到本来的 body 渐变默认背景。
function pauseBgVideo(){
  var v = document.getElementById('bgVideo');
  if(v && typeof v.pause === 'function') v.pause();
  if(v) v.style.visibility = 'hidden';
  var veil = document.getElementById('bgVeil');
  if(veil) veil.style.visibility = 'hidden';
}

// 回大厅恢复：显示遮罩、随机换一个视频继续播
function resumeBgVideo(){
  // CORE-144:手机端不放遮罩(遮罩是用来压暗视频的,没有视频时它只会把默认渐变背景
  // 再压暗一层),直接交给 pickRandomBgVideo 走收起分支。
  if(!shouldPlayLobbyVideo()){ pickRandomBgVideo(); return; }
  var veil = document.getElementById('bgVeil');
  if(veil) veil.style.visibility = 'visible';
  pickRandomBgVideo();
}

// 取消视频静音。autoplay 策略要求 muted 才能无手势自动播放,
// 因此初始静音,用户首次交互后恢复声音(大厅背景 + 死亡/闪电/过场),并移除监听只生效一次。
var FX_VIDEO_IDS = ['bgVideo','deathFxVideo','lightningFxVideo','movieFxVideo'];
var fxAudioUnlocked = false;
function unlockFxAudio(){
  fxAudioUnlocked = true;
  if(typeof document === 'undefined') return;
  FX_VIDEO_IDS.forEach(function(id){
    var el = document.getElementById(id);
    if(el && 'muted' in el) el.muted = false;
  });
}
function applyFxAudio(v){
  if(v && fxAudioUnlocked) v.muted = false;
}
function unmuteBgVideo(){
  unlockFxAudio();
  if(typeof document.removeEventListener === 'function'){
    document.removeEventListener('click', unmuteBgVideo);
    document.removeEventListener('touchstart', unmuteBgVideo);
    document.removeEventListener('keydown', unmuteBgVideo);
  }
}
if(typeof document !== 'undefined' && typeof document.addEventListener === 'function'){
  document.addEventListener('click', unmuteBgVideo);
  document.addEventListener('touchstart', unmuteBgVideo);
  document.addEventListener('keydown', unmuteBgVideo);
}

// ============ 游戏内飘牌 Canvas ============
var bgCanvas = null, bgCtx = null, bgRafId = 0, bgRunning = false, bgLastTs = 0;
var fallingCards = [];

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// 画一张装饰牌（圆角矩形 + 花色符号），不读游戏状态
function drawDecoCard(ctx, c){
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rot);
  ctx.globalAlpha = c.alpha;
  var w = c.size, h = c.size * 1.4;
  var red = (c.suit === '♥' || c.suit === '♦');
  if(c.back){
    // 牌背：深棕底 + 金/朱红描边
    ctx.fillStyle = '#241f1b';
    roundRectPath(ctx, -w/2, -h/2, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = red ? 'rgba(216,73,44,.8)' : 'rgba(176,141,79,.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(233,225,210,.22)';
    ctx.font = Math.round(w*0.5) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.suit, 0, 0);
  }else{
    // 牌面：浅底 + 花色符号
    ctx.fillStyle = 'rgba(233,225,210,.92)';
    roundRectPath(ctx, -w/2, -h/2, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,23,20,.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = red ? '#b1361e' : '#2c2722';
    ctx.font = Math.round(w*0.55) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.suit, 0, 0);
  }
  ctx.restore();
}

// 生成一张新的飘牌粒子
function newDecoCard(){
  var suits = ['♠','♥','♣','♦'];
  // 注意：sizeBgCanvas 已 setTransform(dpr)，画布坐标系为 CSS 像素；
  // spawn/移除判定必须用 clientWidth/clientHeight（CSS 像素），不能用物理像素 width/height。
  var w = bgCanvas ? (bgCanvas.clientWidth || bgCanvas.width) : 800;
  return {
    x: Math.random() * w,
    y: -60 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 12,
    vy: 12 + Math.random() * 18,
    vrot: (Math.random() - 0.5) * 1.0,
    rot: (Math.random() - 0.5) * 0.6,
    size: 26 + Math.random() * 18,
    alpha: 0.22 + Math.random() * 0.23,
    suit: suits[Math.floor(Math.random() * 4)],
    back: Math.random() < 0.6
  };
}

// 每帧：更新并绘制飘牌 + 死亡特效
function bgTick(ts){
  bgRafId = requestAnimationFrame(bgTick);
  if(!bgCtx || !bgCanvas) return;
  var dt = bgLastTs ? Math.min((ts - bgLastTs) / 1000, 0.1) : 0.016;
  bgLastTs = ts;
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  // 飘牌：期望约 1.5~4s 一张、同屏 12~18 张
  if(Math.random() < dt * 0.55 && fallingCards.length < 18){
    fallingCards.push(newDecoCard());
  }
  for(var i = fallingCards.length - 1; i >= 0; i--){
    var c = fallingCards[i];
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vrot * dt;
    if(c.y - c.size > (bgCanvas.clientHeight || bgCanvas.height)){
      fallingCards.splice(i, 1);
      continue;
    }
    drawDecoCard(bgCtx, c);
  }
}

// ============ CORE-141(issue #194):手机端不跑飘牌动画 ============
// 【为什么】bgTick 是全屏 Canvas 的 rAF 循环,整局游戏期间持续运行:画布按 DPR 放大
// (手机横屏 844x390 @DPR3 → 2532x1170 ≈ 296 万像素),每帧全量 clearRect,再画最多 18 张
// 卡、每张都要重设 ctx.font 并 fillText(canvas 文字是 2D 上下文最贵的操作之一)。它是纯
// 装饰(本文件开头就写着"纯视觉层:不读游戏状态"),却是手机端最大的单项持续耗电源。
// 平板/桌面维持现状不变——只砍手机。
//
// 【设备判定为什么不能只看宽度 —— 这是这次改动最容易做错的地方】
// 本项目强制引导手机横屏游玩(render.js 的 checkLandscapeGate/isPortrait),所以手机的
// 实际游玩形态是横屏、视口约 844x390 —— **宽度 844px 正好落在平板断点
// (min-width:641px) and (max-width:1199px) 区间内**。只按宽度判定的话,手机横屏会被当成
// 平板,这次改动对真实使用场景等于完全没生效。CLAUDE.md 规则22 与 CORE-122/CORE-126 都
// 记录过"按宽度分档把手机横屏误当平板"这个已经踩过多次的坑。
//
// 所以这里**逐字复用 index.html 里既有的两条手机断点**,不新造判定口径:
//   @media (max-width:640px)                                   竖屏/窄屏
//   @media (max-height:460px) and (orientation:landscape)      手机横屏矮视口
// 两者取并集 = 手机。测试里有断言把这两条查询串和 index.html 的 CSS 断点对账,
// 防止以后改了 CSS 而这里不同步。
var BG_PHONE_MEDIA_QUERIES = [
  '(max-width:640px)',
  '(max-height:460px) and (orientation:landscape)'
];
function isPhoneLayout(){
  if(typeof window === 'undefined') return false;
  if(typeof window.matchMedia === 'function'){
    for(var i = 0; i < BG_PHONE_MEDIA_QUERIES.length; i++){
      if(window.matchMedia(BG_PHONE_MEDIA_QUERIES[i]).matches) return true;
    }
    return false;
  }
  // 旧浏览器/测试环境没有 matchMedia:退回等价的宽高比较(和上面两条断点同口径)。
  // 安全方向选"不判成手机"——宁可多跑动画(维持改动前行为),也不要在判定不可靠时
  // 把平板/桌面的既有效果误砍掉。
  var w = window.innerWidth, h = window.innerHeight;
  if(!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  return w <= 640 || (h <= 460 && w > h);
}
// bgShouldAnimate:飘牌该不该跑。把三个条件收敛到一处,避免散落在 start/visibilitychange/
// resize 三个地方各判一次导致口径分叉。
//   bgRunning       —— 在对局中(进房 startGameBg 置真,回大厅 stopGameBg 置假)
//   !isPhoneLayout()—— 非手机(本次新增的唯一一条限制)
//   !document.hidden—— 页面可见(改动前就有的切后台暂停,逐字保留)
function bgShouldAnimate(){
  if(!bgRunning) return false;
  if(isPhoneLayout()) return false;
  if(typeof document !== 'undefined' && document.hidden) return false;
  return true;
}
// applyBgAnimationPolicy:按 bgShouldAnimate() 的结论启停 rAF,幂等(重复调用不会起多个
// 循环、也不会重复取消)。start/visibilitychange/resize 三处统一走它。
function applyBgAnimationPolicy(){
  if(bgShouldAnimate()){
    if(!bgRafId){
      // 起循环前先确保画布已按当前视口/DPR 分配好(手机端此前刻意没分配,见下方说明;
      // 桌面窗口跨断点变宽时也要在这里补上)。sizeBgCanvas 幂等,重复调用无副作用。
      sizeBgCanvas();
      bgLastTs = 0;
      bgRafId = requestAnimationFrame(bgTick);
    }
    return;
  }
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
  // 停下来时把画面擦干净,避免最后一帧的飘牌定格在屏幕上(手机端进房即停、以及桌面窗口
  // 被拉窄跨过 640px 断点这两种情况都会走到这里)。fallingCards 不清空:切后台暂停时
  // 保留粒子状态是改动前的既有行为,回来能接着飘,不因为这次重构改掉。
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
}

// 启动飘牌（进房时调用）
function startGameBg(){
  bgCanvas = document.getElementById('gameBgCanvas');
  if(!bgCanvas || typeof bgCanvas.getContext !== 'function') return;
  bgCtx = bgCanvas.getContext('2d');
  if(!bgCtx) return;
  bgRunning = true;
  bgLastTs = 0;
  if(bgRafId) cancelAnimationFrame(bgRafId);
  // CORE-141:改动前这里是无条件 sizeBgCanvas() + requestAnimationFrame(bgTick),
  // 现在两件事都交给统一策略。
  // 【为什么连 sizeBgCanvas 也要挪进策略里】它会把画布 backing store 按 DPR 放大分配:
  // 手机横屏 844x390 @DPR3 → 2532x1170 ≈ 296 万像素 ≈ 11.8MB。手机端既然不画,这块内存
  // 就不该占——在正要优化的那类设备上白占 11.8MB 还会加剧 GC 压力。不分配时画布保持
  // 默认的 300x150,几乎不占内存;真要开始画时 applyBgAnimationPolicy 会先补上 sizeBgCanvas()。
  // 非手机 + 页面可见的落点与改动前逐字一致(照样先 size 再立刻起一帧)。
  applyBgAnimationPolicy();
}

// 停止并清空（回大厅时调用）
function stopGameBg(){
  bgRunning = false;
  if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
  fallingCards = [];
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  // 回大厅兜底:若全屏特效动画仍在播放/显示,立即停止并隐藏,恢复默认背景
  if(typeof document !== 'undefined'){
    ['deathFxVideo','lightningFxVideo','movieFxVideo'].forEach(function(id){
      var dv = document.getElementById(id);
      if(dv) hideFxVideo(dv);
    });
  }
}

// 适配 DPR 与画布尺寸
function sizeBgCanvas(){
  if(!bgCanvas || !bgCtx) return;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  var cw = bgCanvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
  var ch = bgCanvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
  bgCanvas.width = Math.round(cw * dpr);
  bgCanvas.height = Math.round(ch * dpr);
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 页面隐藏暂停、恢复继续；窗口尺寸变化重适配
// CORE-141:两处都改走 applyBgAnimationPolicy——语义与改动前一致(隐藏则停、可见且在对局
// 中则续),只是多叠了一条"手机不跑"。
if(typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', applyBgAnimationPolicy);
}
if(typeof window !== 'undefined'){
  // CORE-141:resize/orientationchange 时除了重算画布尺寸,还要重新评估该不该跑——
  // 桌面窗口拉宽拉窄会跨过 640px 断点,手机横竖屏切换会在两条手机断点之间移动。
  // orientationchange 单独监听:部分移动浏览器旋转时 resize 触发时机不可靠(render.js
  // 的 checkLandscapeGate 也是 resize + orientationchange 两个都听,同一惯例)。
  // 只在真的会画时才重算画布尺寸(手机端不分配,理由见 startGameBg 里的说明);
  // applyBgAnimationPolicy 内部在需要起循环时会自己补 sizeBgCanvas()。
  window.addEventListener('resize', function(){
    if(bgShouldAnimate()) sizeBgCanvas();
    applyBgAnimationPolicy();
  });
  window.addEventListener('orientationchange', function(){
    if(bgShouldAnimate()) sizeBgCanvas();
    applyBgAnimationPolicy();
  });
}

// ============ 角色死亡特效 ============
// 每名角色死亡时，复制其座位上的武将立绘：先短暂停留并显出裂纹，再切成九块向外碎裂。
// 这是纯 DOM 视觉层；找不到座位/立绘（例如旧存档首次渲染）时静默跳过，不影响游戏。
var DEATH_SHARDS = [
  {clip:'polygon(0 0,34% 0,29% 36%,0 31%)',       x:-20,y:-22,r:-13},
  {clip:'polygon(34% 0,68% 0,61% 34%,29% 36%)',   x:  1,y:-30,r:  6},
  {clip:'polygon(68% 0,100% 0,100% 34%,61% 34%)', x: 22,y:-20,r: 15},
  {clip:'polygon(0 31%,29% 36%,35% 69%,0 64%)',   x:-28,y: -2,r:-18},
  {clip:'polygon(29% 36%,61% 34%,66% 67%,35% 69%)',x: 2,y:  3,r: -5},
  {clip:'polygon(61% 34%,100% 34%,100% 67%,66% 67%)',x:29,y:1,r:19},
  {clip:'polygon(0 64%,35% 69%,31% 100%,0 100%)', x:-23,y: 27,r:-15},
  {clip:'polygon(35% 69%,66% 67%,70% 100%,31% 100%)',x:0,y:34,r:8},
  {clip:'polygon(66% 67%,100% 67%,100% 100%,70% 100%)',x:24,y:25,r:17}
];

function triggerDeathPortraitFx(seat){
  if(typeof document === 'undefined' || !document.body) return false;
  var card = document.querySelector('.seat[data-seat="'+seat+'"]');
  var art = card && card.querySelector('.seat-art');
  if(!card || !art || !art.querySelector('.avatar')) return false;
  var rect = card.getBoundingClientRect();
  if(!rect || rect.width < 2 || rect.height < 2) return false;

  var fx = document.createElement('div');
  fx.className = 'death-shatter-fx';
  fx.setAttribute('aria-hidden','true');
  fx.style.left = rect.left+'px'; fx.style.top = rect.top+'px';
  fx.style.width = rect.width+'px'; fx.style.height = rect.height+'px';

  var flash = art.cloneNode(true);
  flash.className += ' death-shatter-base';
  fx.appendChild(flash);
  DEATH_SHARDS.forEach(function(spec, index){
    var shard = document.createElement('div');
    shard.className = 'death-shatter-shard';
    shard.style.clipPath = spec.clip;
    shard.style.setProperty('--shard-x',spec.x+'px');
    shard.style.setProperty('--shard-y',spec.y+'px');
    shard.style.setProperty('--shard-r',spec.r+'deg');
    shard.style.setProperty('--shard-delay',(index%3)*22+'ms');
    shard.appendChild(art.cloneNode(true));
    fx.appendChild(shard);
  });
  var cracks = document.createElement('div');
  cracks.className = 'death-shatter-cracks';
  fx.appendChild(cracks);
  document.body.appendChild(fx);
  setTimeout(function(){ if(fx.parentNode) fx.parentNode.removeChild(fx); }, 1150);
  return true;
}

// 他人死亡不再播放任何特效(原全屏血雾已删除);
// 自己死亡时在网页背景全屏播放随机一段死亡动画视频,播放完毕自动恢复原背景。
// 新增动画文件:命名 death-N.mp4 放入 assets/video/,并在本数组追加文件名。
var DEATH_VIDEOS = [
  'assets/video/death-1.mp4',
  'assets/video/death-2.mp4'
];

// ============ 闪电判定特效 ============
// 任何角色的【闪电】判定一有结果,所有客户端全屏播放对应动画(判定不中 hit:false 播
// flash0、判定劈中 hit:true 播 flash1),播放完毕自动隐藏恢复原背景——与死亡动画同款
// 机制,触发由 render.js 检测 g.lastLightningFx.seq 变化后调用 triggerLightningFx。
// 新增动画文件:命名 flash0.mp4(未劈中)/ flash1.mp4(劈中)放入 assets/video/,
// 可在下面数组追加候选(多段随机播放)。
var LIGHTNING_VIDEOS = {
  false: ['assets/video/flash0.mp4'],
  true:  ['assets/video/flash1.mp4']
};

function triggerLightningFx(hit){
  if(typeof document === 'undefined') return;
  var list = LIGHTNING_VIDEOS[hit ? 'true' : 'false'];
  var v = document.getElementById('lightningFxVideo');
  if(!v || !list || !list.length) return;
  applyFxAudio(v);
  v.src = list[Math.floor(Math.random() * list.length)];
  v.style.visibility = 'visible';
  if(typeof v.load === 'function') v.load();
  var p = v.play();
  if(p && typeof p.catch === 'function') p.catch(function(){ hideFxVideo(v); });
  bindFxVideo(v); // 绑定 ended/error,播放完/失败即隐藏恢复
}

// ============ 过场动画(武将死亡/胜负结算剧情点) ============
// 触发由 render.js 检测 g.lastMovieFx.seq 变化 + 座位/身份过滤后调用 triggerMovieFx(key)。
// 各 key 播放条件见 render.js movieVideoKeyForMe 的注释;素材命名按下面数组放入 assets/video/,
// 每 key 可追加多段候选(随机播放)。
var MOVIE_VIDEOS = {
  yujiDeath:  ['assets/video/yuji1.mp4'],   // 于吉死 → 于吉以外的玩家
  yujiKill:   ['assets/video/yuji0.mp4'],   // 于吉杀人 → 于吉以外且仍存活的玩家
  zuociDeath: ['assets/video/zuoci0.mp4'],  // 左慈死 → 仅杀死左慈的玩家
  zuociLose:  ['assets/video/zuoci1.mp4'],  // 结算左慈所在阵营输 → 仅使用左慈的玩家(最优先)
  fanLose:    ['assets/video/fanze-lost.mp4'], // 结算反贼输 → 反贼玩家
  fanWin:     ['assets/video/fanzei-win.mp4'], // 结算反贼胜 → 反贼玩家
  lordLose:   ['assets/video/zhuzhong-lost.mp4'], // 结算主公输 → 主公玩家
  zhongLose:  ['assets/video/han.mp4'],     // 结算忠臣输 → 忠臣玩家
  neiWin:     ['assets/video/neijian-win.mp4','assets/video/neijian-win-0.mp4'] // 结算内奸胜 → 内奸玩家(随机二选一)
};

// kind 既可以是 MOVIE_VIDEOS 的键(legacy),也可以直接是具体视频路径(三人表情按客户端
// 分派,render.js 已算好每客户端各自要播的文件,这里不再做随机)。
function triggerMovieFx(kind){
  if(typeof document === 'undefined') return;
  var v = document.getElementById('movieFxVideo');
  if(!v) return;
  var list = MOVIE_VIDEOS[kind];
  var src;
  if(list){
    if(!list.length) return;
    src = list[Math.floor(Math.random() * list.length)];
  } else {
    src = kind; // 已是具体路径
  }
  applyFxAudio(v);
  v.src = src;
  v.style.visibility = 'visible';
  if(typeof v.load === 'function') v.load();
  var p = v.play();
  if(p && typeof p.catch === 'function') p.catch(function(){ hideFxVideo(v); });
  bindFxVideo(v); // 绑定 ended/error,播放完/失败即隐藏恢复
}

// ============ 三姐妹表情动画:头像化播放层(纯判定/几何) ============
// 触发由 render.js maybePlayMovieFx 在算好"要播的具体视频路径 + 锚点女孩座位"后调用
// triggerGirlFx({path, seat, selfSeat})。设备三分支(口径复用既有断点,见 isPhoneLayout 注释):
//   手机  → 头像矩形 FLIP 放大到"按视频真实比例的最大居中盒"(自适应全屏), 播完缩回原位;
//   桌面  → 锚定女孩座位头像: 自己座位=原尺寸贴合(头像活起来), 他人座位=1.8x 放大悬浮;
//   平板/回退 → 转调 triggerMovieFx 走既有全屏 #movieFxVideo, 零改动。
// 座位不可见(找不到/可见面积<50%/<2px)一律回退全屏, 不静默丢动画。
function girlFxComputeMode(){
  if(typeof window==='undefined') return 'fullscreen';
  if(typeof isPhoneLayout==='function' && isPhoneLayout()) return 'phone';
  if(typeof window.matchMedia==='function' &&
     window.matchMedia('(hover:hover) and (pointer:fine)').matches) return 'desktop';
  return 'fullscreen'; // 平板, 或无 matchMedia 的旧环境: 安全回退现状全屏
}
function girlFxDecide(anchorSeat, selfSeat){
  const mode=girlFxComputeMode();
  if(mode!=='desktop') return mode==='phone' ? 'phone' : 'fullscreen';
  return anchorSeat===selfSeat ? 'desktop-self' : 'desktop-other';
}
// anchor: 头像 getBoundingClientRect(视口坐标); vw/vh: 视口; aspect: videoWidth/videoHeight(兜底 3:4=0.75)
function girlFxTargetBox(mode, anchor, vw, vh, aspect){
  if(mode==='fullscreen' || !anchor) return null;
  const a = (typeof aspect==='number' && aspect>0) ? aspect : 0.75;
  if(mode==='desktop-self') return {left:anchor.left, top:anchor.top, width:anchor.width, height:anchor.height};
  if(mode==='desktop-other'){
    let w=anchor.width*1.8, h=anchor.height*1.8;
    if(w>vw){ h*=vw/w; w=vw; }
    if(h>vh){ w*=vh/h; h=vh; }
    const cx=anchor.left+anchor.width/2, cy=anchor.top+anchor.height/2;
    return {left:Math.max(0,Math.min(cx-w/2, vw-w)), top:Math.max(0,Math.min(cy-h/2, vh-h)), width:w, height:h};
  }
  // phone: 保持视频比例的最大居中盒(横屏下通常高撑满、左右黑边)
  let h=vh, w=h*a;
  if(w>vw){ w=vw; h=w/a; }
  return {left:(vw-w)/2, top:(vh-h)/2, width:w, height:h};
}
// 解析锚点头像矩形 + 可见性阈值; 不可见返回 null(调用方回退全屏)
function girlFxAnchorRect(seat){
  if(typeof document==='undefined') return null;
  var art=document.querySelector('.seat[data-seat="'+seat+'"] .seat-art');
  if(!art || typeof art.getBoundingClientRect!=='function') return null;
  var r=art.getBoundingClientRect();
  if(!r || r.width<2 || r.height<2) return null;
  var vw=(typeof window!=='undefined'&&window.innerWidth)||0;
  var vh=(typeof window!=='undefined'&&window.innerHeight)||0;
  var ix=Math.max(0, Math.min(r.right,vw)-Math.max(r.left,0));
  var iy=Math.max(0, Math.min(r.bottom,vh)-Math.max(r.top,0));
  if(vw&&vh && ix*iy < r.width*r.height*0.5) return null; // 可见面积<50%
  return {left:r.left, top:r.top, width:r.width, height:r.height};
}

function triggerDeathFx(kind){
  if(kind !== 'self') return; // 他人死亡:无特效
  if(typeof document === 'undefined') return;
  // 动画走 DOM 视频层而非飘牌 canvas,故不再要求 bgRunning/bgCtx 就绪
  var v = document.getElementById('deathFxVideo');
  if(!v || !DEATH_VIDEOS.length) return;
  applyFxAudio(v);
  v.src = DEATH_VIDEOS[Math.floor(Math.random() * DEATH_VIDEOS.length)];
  v.style.visibility = 'visible';
  if(typeof v.load === 'function') v.load();
  var p = v.play();
  if(p && typeof p.catch === 'function') p.catch(function(){ hideFxVideo(v); });
  bindFxVideo(v); // 绑定 ended/error,播放完/失败即隐藏恢复
}

// 播放结束或失败:隐藏视频,原背景(飘牌 canvas)自然恢复
function hideFxVideo(v){
  if(!v) return;
  if(typeof v.pause === 'function') v.pause();
  v.style.visibility = 'hidden';
  v.removeAttribute('src');
  if(typeof v.load === 'function') v.load(); // 释放视频资源
}

function bindFxVideo(v){
  if(v.__fxBound) return;
  v.__fxBound = true;
  v.addEventListener('ended', function(){ hideFxVideo(v); });
  v.addEventListener('error', function(){ hideFxVideo(v); });
}

// 页面首次加载时初始化一个随机背景视频。
// script 在 </body> 前加载,此时 #bgVideo 已在 DOM(muted+playsinline 下无手势 autoplay 放行)。
if(typeof document !== 'undefined') pickRandomBgVideo();
