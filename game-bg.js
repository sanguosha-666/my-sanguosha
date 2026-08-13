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
  v.src = BG_VIDEOS[Math.floor(Math.random() * BG_VIDEOS.length)];
  if(typeof v.load === 'function') v.load();
  if(typeof v.play === 'function'){
    var p = v.play();
    if(p && typeof p.catch === 'function') p.catch(function(){});
  }
}

// 进房暂停大厅视频（避免后台耗流量/CPU）
function pauseBgVideo(){
  var v = document.getElementById('bgVideo');
  if(v && typeof v.pause === 'function') v.pause();
}

// 回大厅恢复：随机换一个继续播
function resumeBgVideo(){
  pickRandomBgVideo();
}

// ============ 游戏内飘牌 Canvas ============
var bgCanvas = null, bgCtx = null, bgRafId = 0, bgRunning = false, bgLastTs = 0;
var fallingCards = [];
var bgFx = null; // 当前死亡特效状态

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

  drawBgFx(ts, dt); // dt 同源传参,血滴运动不依赖固定帧步长
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
  bgFx = null;
  if(bgCtx && bgCanvas) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
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
// kind='self'：血滴滴落→落地晕染→渐隐恢复；kind='other'：全屏血雾弥漫→退去
// 时间基准：rAF 回调的 timestamp 与 performance.now() 同源；Date.now() 差页面加载时长
// （~1e12ms），与 drawBgFx 的 now 混用会导致 prog 恒负（特效不可见/不清理）。必须同源。
function bgNow(){
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}
function triggerDeathFx(kind){
  if(!bgCtx || !bgCanvas || !bgRunning) return;
  if(kind === 'self'){
    var n = 5 + Math.floor(Math.random() * 4); // 5~8 滴
    var drops = [];
    var cw = bgCanvas.clientWidth || bgCanvas.width;
    var ch = bgCanvas.clientHeight || bgCanvas.height;
    for(var i = 0; i < n; i++){
      drops.push({
        x: Math.random() * cw,      // CSS 像素坐标（setTransform(dpr) 后）
        y: -20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 40,
        vy: 60 + Math.random() * 90,
        r: 3 + Math.random() * 3,
        landY: ch * (0.55 + Math.random() * 0.4),
        landed: false, landAt: 0
      });
    }
    bgFx = { kind: 'self', t0: bgNow(), dur: 2800, drops: drops };
  }else if(kind === 'other'){
    bgFx = { kind: 'other', t0: bgNow(), dur: 1300 };
  }
}

// 绘制当前死亡特效（在飘牌之上）；now 为 rAF timestamp，dt 为当前帧真实步长（秒）
function drawBgFx(now, dt){
  if(!bgFx) return;
  var el = now - bgFx.t0;
  if(el > bgFx.dur){ bgFx = null; return; }
  var prog = el / bgFx.dur;
  if(bgFx.kind === 'self'){
    var drops = bgFx.drops;
    for(var i = 0; i < drops.length; i++){
      var d = drops[i];
      if(!d.landed){
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        if(d.y >= d.landY){ d.landed = true; d.landAt = el; }
      }else{
        var age = el - d.landAt;
        var radius = d.r * 6 * Math.min(age / 400, 1);
        var g = bgCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, radius);
        g.addColorStop(0, 'rgba(150,30,20,' + (0.55 * (1 - prog)) + ')');
        g.addColorStop(1, 'rgba(150,30,20,0)');
        bgCtx.fillStyle = g;
        bgCtx.beginPath();
        bgCtx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        bgCtx.fill();
      }
    }
    // 未落地的血滴画实心圆
    for(var j = 0; j < drops.length; j++){
      var d2 = drops[j];
      if(d2.landed) continue;
      bgCtx.fillStyle = 'rgba(150,30,20,' + Math.min(0.8, 0.3 + (d2.y / d2.landY) * 0.5) + ')';
      bgCtx.beginPath();
      bgCtx.arc(d2.x, d2.y, d2.r, 0, Math.PI * 2);
      bgCtx.fill();
    }
  }else{
    // 全屏血雾：0→0.35→0 alpha，从边缘向中心
    var fade = prog < 0.5 ? prog / 0.5 : (1 - prog) / 0.5;
    var a = Math.min(0.35 * fade, 0.35);
    var w = bgCanvas.width, h = bgCanvas.height;
    var grd = bgCtx.createRadialGradient(w/2, h/2, Math.min(w, h) * 0.25, w/2, h/2, Math.max(w, h) * 0.75);
    grd.addColorStop(0, 'rgba(140,28,18,0)');
    grd.addColorStop(1, 'rgba(140,28,18,' + a + ')');
    bgCtx.fillStyle = grd;
    bgCtx.fillRect(0, 0, w, h);
  }
}
