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

// 回大厅时随机选一个视频并尝试播放（muted+playsinline 保证自动播放策略通过）
function pickRandomBgVideo(){
  var v = document.getElementById('bgVideo');
  if(!v) return;
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

// 启动飘牌（进房时调用）
function startGameBg(){
  bgCanvas = document.getElementById('gameBgCanvas');
  if(!bgCanvas || typeof bgCanvas.getContext !== 'function') return;
  bgCtx = bgCanvas.getContext('2d');
  if(!bgCtx) return;
  sizeBgCanvas();
  bgRunning = true;
  bgLastTs = 0;
  if(bgRafId) cancelAnimationFrame(bgRafId);
  bgRafId = requestAnimationFrame(bgTick);
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
if(typeof document !== 'undefined'){
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){
      if(bgRafId){ cancelAnimationFrame(bgRafId); bgRafId = 0; }
    }else if(bgRunning && !bgRafId){
      bgLastTs = 0;
      bgRafId = requestAnimationFrame(bgTick);
    }
  });
}
if(typeof window !== 'undefined'){
  window.addEventListener('resize', sizeBgCanvas);
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
  zhongLose:  ['assets/video/han.mp4']      // 结算忠臣输 → 忠臣玩家
};

function triggerMovieFx(kind){
  if(typeof document === 'undefined') return;
  var list = MOVIE_VIDEOS[kind];
  var v = document.getElementById('movieFxVideo');
  if(!v || !list || !list.length) return;
  applyFxAudio(v);
  v.src = list[Math.floor(Math.random() * list.length)];
  v.style.visibility = 'visible';
  if(typeof v.load === 'function') v.load();
  var p = v.play();
  if(p && typeof p.catch === 'function') p.catch(function(){ hideFxVideo(v); });
  bindFxVideo(v); // 绑定 ended/error,播放完/失败即隐藏恢复
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
