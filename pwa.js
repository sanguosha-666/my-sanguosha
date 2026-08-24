// ===== PWA 支持:消掉浏览器地址栏占掉的竖向空间 =====
//
// 【为什么值得做】手机横屏下视口只有 390~430px 高,浏览器 chrome(地址栏+底部工具栏)
// 吃掉的几十像素在这个高度上占比很可观 —— 而这个项目的横屏布局是按 390px 逐像素抠出来的
// (座位卡高度、装备条行数、手牌卡尺寸都卡着这个预算),多出来的每一像素都直接还给座位区。
//
// 【三条路径,按可靠性排序】
//   1. 从主屏启动(manifest display:"fullscreen" / iOS 的 apple-mobile-web-app-capable)
//      —— 最彻底,地址栏完全消失。需要用户主动"添加到主屏幕",所以有下面的引导提示。
//   2. Fullscreen API(requestFullscreen)—— Android Chrome 可用,一键进入。
//      **iPhone 上的 Safari 不支持非视频元素全屏**(iPad Safari 有 webkit 前缀版),
//      所以按钮必须做能力检测,不支持的平台直接不显示,而不是显示了点了没反应。
//   3. 什么都不做 —— 保持现状,布局本来就能在 390px 里装下。
//
// 本文件只做 2 和 3 的入口 + 1 的引导,不注册 Service Worker(理由见 index.html <head> 注释)。

// ---- 运行形态检测 ----
// standalone: 从主屏启动。三种写法覆盖不同平台:
//   - display-mode: fullscreen  → manifest display:"fullscreen" 生效时(Android)
//   - display-mode: standalone  → 部分平台会降级到 standalone
//   - navigator.standalone      → iOS Safari 的私有属性,iOS 上唯一可靠的判断
function pwaIsStandalone(){
  if(typeof navigator!=='undefined' && navigator.standalone===true) return true;
  if(typeof window==='undefined' || !window.matchMedia) return false;
  return window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches;
}

// 是否移动端。刻意**不**用 UA 字符串做主判据(UA 既容易被改写又难以穷举),而是用
// "有触摸 + 视口窄"这组能力特征 —— 和项目里既有的 isPhoneLayout(game-bg.js)、
// LANDSCAPE_GATE_MAX_WIDTH(render.js) 同一套思路,阈值也对齐到那两处用的值。
function pwaIsMobile(){
  if(typeof window==='undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touch = (typeof navigator!=='undefined' && navigator.maxTouchPoints > 0)
             || ('ontouchstart' in window);
  const shortSide = Math.min(window.innerWidth||0, window.innerHeight||0);
  return !!(coarse || touch) && shortSide > 0 && shortSide <= 640;
}

// Fullscreen API 可用性。**iPhone Safari 在这里会返回 false**:它既没有
// document.fullscreenEnabled,也没有 documentElement.webkitRequestFullscreen
// (iOS 上只有 <video> 有 webkitEnterFullscreen)。iPad Safari 有 webkit 前缀版,会返回 true。
function pwaFullscreenSupported(){
  if(typeof document==='undefined' || !document.documentElement) return false;
  const el = document.documentElement;
  const hasReq = typeof el.requestFullscreen==='function'
              || typeof el.webkitRequestFullscreen==='function';
  if(!hasReq) return false;
  // fullscreenEnabled 为 false 表示被 iframe 的 allowfullscreen 之类的策略禁用了;
  // 属性不存在(undefined)时不能当成禁用 —— 老一点的 webkit 只有带前缀的那个。
  if(document.fullscreenEnabled===false) return false;
  if(document.webkitFullscreenEnabled===false && document.fullscreenEnabled===undefined) return false;
  return true;
}

function pwaIsFullscreenNow(){
  if(typeof document==='undefined') return false;
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// ---- 全屏按钮 ----
function pwaToggleFullscreen(){
  const el = document.documentElement;
  if(pwaIsFullscreenNow()){
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if(exit) { try { exit.call(document); } catch(e){} }
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if(!req) return;
  try {
    const r = req.call(el, {navigationUI:'hide'});
    // 标准版返回 Promise,用户拒绝/被策略拦截时会 reject —— 必须接住,否则控制台报
    // unhandled rejection。这里不做任何提示:进不了全屏就维持现状,布局本来就装得下。
    if(r && typeof r.catch==='function') r.catch(()=>{});
  } catch(e){}
}

// 按钮的显隐:只在"支持 Fullscreen API"且"当前不是从主屏启动"时显示 —— 已经从主屏
// 启动的话地址栏本来就没了,再放一个全屏按钮是纯噪音(而且工具栏在手机横屏下寸土寸金)。
function pwaSyncFullscreenBtn(){
  const btn = document.getElementById('fullscreenBtn');
  if(!btn) return;
  const show = pwaFullscreenSupported() && !pwaIsStandalone();
  btn.classList.toggle('hidden', !show);
  if(show){
    const on = pwaIsFullscreenNow();
    btn.textContent = on ? '🗗' : '⛶';
    btn.title = on ? '退出全屏' : '全屏游玩(隐藏地址栏,给座位区腾出竖向空间)';
  }
}

// ---- 首次访问的一次性引导 ----
const PWA_HINT_DISMISS_KEY = 'sgs_pwa_hint_dismissed';

function pwaHintDismissed(){
  try { return localStorage.getItem(PWA_HINT_DISMISS_KEY)==='1'; } catch(e){ return false; }
}
function pwaDismissHint(){
  try { localStorage.setItem(PWA_HINT_DISMISS_KEY, '1'); } catch(e){}
  const el = document.getElementById('pwaHint');
  if(el) el.classList.add('hidden');
}

// iOS 和 Android 的"添加到主屏幕"入口位置完全不同,提示文案要分开写,否则等于没说清。
function pwaHintText(){
  const ua = (typeof navigator!=='undefined' && navigator.userAgent) || '';
  const iOS = /iPad|iPhone|iPod/.test(ua)
           || (/Macintosh/.test(ua) && typeof navigator!=='undefined' && navigator.maxTouchPoints>1);
  return iOS
    ? '添加到主屏幕可全屏游玩：点底部「分享」→「添加到主屏幕」'
    : '添加到主屏幕可全屏游玩：点浏览器菜单「⋮」→「添加到主屏幕」/「安装应用」';
}

// 显示条件:移动端 + 不是从主屏启动 + 用户没有永久关闭过。
// 三个条件缺一不可 —— 尤其"不是从主屏启动",否则已经装好的用户每次进来都被劝一遍。
function pwaSyncHint(){
  const el = document.getElementById('pwaHint');
  if(!el) return;
  const show = pwaIsMobile() && !pwaIsStandalone() && !pwaHintDismissed();
  el.classList.toggle('hidden', !show);
  if(show){
    const txt = el.querySelector('.pwa-hint-text');
    if(txt) txt.textContent = pwaHintText();
  }
}

// ---- 从主屏恢复时把缩放归零 ----
//
// 【症状】从主屏启动(standalone)时画面是放大的,而且是"上次退出时的放大状态"。
//
// 【排查过的两个方向,都不是原因】
//   - 代码里恢复了 transform:scale/zoom:**没有**。全项目 grep `transform:scale` /
//     `style.zoom` / `scale(` 零命中;localStorage/sessionStorage 只用于身份猜测标记、
//     AI 密钥、PWA 提示,没有任何缩放相关的存取。
//   - viewport meta 带了非 1.0 的 initial-scale:**没有**,一直是 initial-scale=1.0。
//     但它同时**没有** maximum-scale / user-scalable 限制,所以双指缩放是完全开放的
//     —— 这是"能被放大"的前提,不是"启动时是放大的"的原因。
//
// 【真正的原因】iOS 的 standalone web app 会把缩放级别(以及滚动位置)当成 app 状态
// 由系统保留,下次从主屏启动时一并恢复。所以只要用户在游戏中双指误触放大过一次,
// 那个放大就会被记住、每次启动都带着。这是系统行为,页面这边只能在启动/恢复时主动归零。
//
// 【为什么不用 user-scalable=no / maximum-scale=1 一禁了之】
//   ① iOS 10 起 Safari **故意忽略** user-scalable=no(无障碍考虑),靠它并不可靠;
//   ② 这个项目手机横屏下最小字号只有 9px,彻底禁用缩放会让看不清的人没有任何补救手段。
// 所以保留"用户可以主动放大看细节"的能力,只在**启动/恢复**这个时刻归零。
//
// 【归零的手法】WebKit 只在 viewport meta 的 content **发生变化**时才重新应用缩放约束。
// 所以先临时加上 maximum-scale=1.0 逼它把当前缩放压回 1,再在随后的一帧撤掉,
// 让页面重新变回可缩放。只设一次同样的值是不会触发重新应用的。
const PWA_VIEWPORT_BASE = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
function pwaResetZoom(){
  const vp = document.querySelector('meta[name="viewport"]');
  if(!vp) return;
  // 只在从主屏启动时做。普通浏览器里页面不会保留缩放,反而可能打断用户正在进行的缩放。
  if(!pwaIsStandalone()) return;
  vp.setAttribute('content', PWA_VIEWPORT_BASE + ', maximum-scale=1.0, user-scalable=no');
  const restore = () => vp.setAttribute('content', PWA_VIEWPORT_BASE);
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>requestAnimationFrame(restore));
  else setTimeout(restore, 50);
}

function pwaInit(){
  pwaSyncFullscreenBtn();
  pwaSyncHint();
  pwaResetZoom();
}

// 和 checkLandscapeGate / unlockAudioOnce 同一套写法:加载后立即跑一次 + 注册监听。
// fullscreenchange 用来在用户按 ESC/系统手势退出全屏时把按钮图标同步回去。
if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', pwaInit);
  else pwaInit();
  // pageshow 覆盖两种恢复:普通加载,以及从 bfcache/后台恢复(event.persisted=true)。
  // **刻意不挂 visibilitychange**:那个事件每次切回前台都会触发,如果用户是主动放大了
  // 想看清某处细节,切出去接个消息再回来就被强行复位,反而是干扰。只在真正的
  // "启动/恢复"这个时刻归零,不干预用户主动的缩放。
  // 注意:归零只改缩放,**不动任何游戏状态**——对局状态由 Firebase 实时同步,
  // 退出重进后保留当前进度是期望行为,这里不会让它跳回大厅。
  window.addEventListener('pageshow', pwaResetZoom);
  document.addEventListener('fullscreenchange', pwaSyncFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', pwaSyncFullscreenBtn);
  window.addEventListener('resize', pwaSyncFullscreenBtn);
}
