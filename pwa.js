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

// 【已移除:pwaResetZoom】曾经加过一段"启动时把缩放归零"的逻辑,依据是"iOS standalone
// 会保留上次退出时的缩放级别"。**这个假设已被真机推翻**:即使退出前完全没有双指缩放过
// (缩放一直是 1.0),从主屏冷启动后画面依然是放大的 —— 所以放大与上次的缩放状态无关,
// 是每次冷启动都会发生的事。基于错误假设、且从未被真机证实有效的代码没有保留价值,
// 一并移除,同时也把它自己从"会不会是它人为造成了一次缩放跳动"的嫌疑里排除掉。
// 真正的原因正在排查中,排查手段见 pwaDiagnostics()(真机可读的实测数值)。

function pwaInit(){
  pwaSyncFullscreenBtn();
  pwaSyncHint();
}

// 和 checkLandscapeGate / unlockAudioOnce 同一套写法:加载后立即跑一次 + 注册监听。
// fullscreenchange 用来在用户按 ESC/系统手势退出全屏时把按钮图标同步回去。
if(typeof document!=='undefined'){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', pwaInit);
  else pwaInit();
  document.addEventListener('fullscreenchange', pwaSyncFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', pwaSyncFullscreenBtn);
  window.addEventListener('resize', pwaSyncFullscreenBtn);
}

// ===== 真机环境诊断 =====
//
// 【为什么需要它】"从主屏冷启动后画面被放大"这个问题,只在真机的 standalone 模式下出现,
// 而手机上没有开发者控制台,远程调试也不总是有条件。**继续按推断改代码是错的**——
// 需要先拿到真机上的实际数值。这个函数把判断这件事所需的全部量一次性列出来,
// 通过 ? 帮助弹窗底部就能看到,不需要任何调试工具。
//
// 【怎么用】在普通 Safari 里打开一次、记下数值;再从主屏快捷方式冷启动一次、记下数值;
// 两组一对比,就能确定放大到底来自哪一层:
//   - visualViewport.scale ≠ 1        → 真的是页面被缩放了(浏览器层)
//   - layoutViewport 宽高在两种模式下不同 → 视口尺寸本身变了(布局层,dvh/断点会跟着变)
//   - scale=1 但 innerWidth 明显小于 screen 长边 → viewport 按竖屏宽度算了再被拉大填满横屏
//     (iOS standalone 横屏启动的经典表现,此时元素会整体等比变大)
//   - 上面都正常但 cardWidth/座位卡实测尺寸跳档 → 是布局计算吃了不同的视口值,不是缩放
function pwaDiagnostics(){
  const vv = window.visualViewport || null;
  const de = document.documentElement;
  const seat = document.querySelector('#oppRow .seat');
  const seatR = seat ? seat.getBoundingClientRect() : null;
  const card = document.querySelector('.hand .card');
  const cardR = card ? card.getBoundingClientRect() : null;
  const metrics = (typeof cardMetricsForViewport==='function') ? cardMetricsForViewport() : null;
  const mq = (q) => (window.matchMedia && window.matchMedia(q).matches) ? '✓' : '✗';
  return {
    '运行形态': (pwaIsStandalone()? 'standalone(主屏启动)' : '浏览器内')
      + '  navigator.standalone=' + String(navigator.standalone),
    'display-mode': 'fullscreen'+mq('(display-mode: fullscreen)')
      + ' standalone'+mq('(display-mode: standalone)') + ' browser'+mq('(display-mode: browser)'),
    'window.inner': window.innerWidth + ' × ' + window.innerHeight,
    'layoutViewport(documentElement.client)': de.clientWidth + ' × ' + de.clientHeight,
    'visualViewport': vv ? (Math.round(vv.width) + ' × ' + Math.round(vv.height)
        + '   scale=' + vv.scale.toFixed(3) + '  offsetTop=' + Math.round(vv.offsetTop)) : '(不支持)',
    'screen': screen.width + ' × ' + screen.height
      + '  avail ' + screen.availWidth + ' × ' + screen.availHeight
      + '  dpr=' + window.devicePixelRatio,
    'viewport meta': (document.querySelector('meta[name="viewport"]')||{getAttribute:()=>'(无)'}).getAttribute('content'),
    // 【修正】第一版读的是 --sa-top 这类 CSS 变量,但项目里**从来没有定义过**这几个变量,
    // 所以真机上四项全是 "?" —— 一条读不到任何东西的诊断项。env() 只能在 CSS 属性值里
    // 求值,拿不到 JS 变量,所以造一个临时元素、把四个 env() 写进它的 padding,再读回
    // computed 值。这是 JS 侧唯一能拿到 safe-area 实际像素的办法。
    'safe-area(上右下左)': (()=>{
      try{
        const t=document.createElement('div');
        t.style.cssText='position:fixed;left:-9999px;top:-9999px;'
          +'padding:env(safe-area-inset-top) env(safe-area-inset-right) '
          +'env(safe-area-inset-bottom) env(safe-area-inset-left);';
        document.body.appendChild(t);
        const cs=getComputedStyle(t);
        const v=[cs.paddingTop,cs.paddingRight,cs.paddingBottom,cs.paddingLeft].join(' / ');
        t.remove();
        return v;
      }catch(e){ return '(读取失败)'; }
    })(),
    '关键断点': 'max-height:520+landscape+coarse ' + mq('(max-height:520px) and (orientation:landscape) and (pointer:coarse)')
      + '   max-width:640 ' + mq('(max-width:640px)'),
    '手牌卡计算值': metrics ? ('cardWidth=' + metrics.cardWidth + ' badge=' + metrics.badge) : '(不可用)',
    '手牌卡实测': cardR ? (Math.round(cardR.width) + ' × ' + Math.round(cardR.height)) : '(无手牌)',
    '对手座位卡实测': seatR ? (Math.round(seatR.width) + ' × ' + Math.round(seatR.height)
        + '   = ' + (seatR.height / (window.innerHeight||1) * 100).toFixed(1) + '% 视口高') : '(无座位卡)',
  };
}

// 渲染成一段 HTML,供 ? 帮助弹窗底部展示(手机上唯一随时可点、且不依赖房间的入口)
function pwaDiagnosticsHtml(){
  const d = pwaDiagnostics();
  let h = '<div class="sec">环境诊断（排查「主屏启动画面被放大」用）</div>'
        + '<div class="item" style="color:var(--paper-dim)">在普通浏览器里看一次、再从主屏快捷方式冷启动看一次，'
        + '把两组数值对比，就能定位放大来自哪一层。</div>';
  for(const k in d){
    h += '<div class="item"><b>' + escapeHtml(k) + '</b>：<code style="font-size:11px">'
       + escapeHtml(String(d[k])) + '</code></div>';
  }
  return h;
}
