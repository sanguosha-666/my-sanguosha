/**
 * CORE-126(issue #164):手机/平板聊天区不可用——手机横屏整个 .log-panel{display:none}
 * 把日志和聊天一起隐藏了(聊天完全不存在、无备用入口),平板上聊天消息区被压缩到约4px。
 *
 * 【锁定什么】分两部分:
 *  A. JS 行为(真实加载 render-log.js 到 vm 沙箱,不重新实现一遍逻辑):
 *     toggleChatPanel/closeChatPanel/updateChatUnreadBadge 的开关与未读计数语义。
 *  B. CSS 源码结构:浮层规则/入口按钮/手机断点从 display:none 改成 display:contents
 *     这几条关键规则确实写在源码里,防止以后被误改回去。
 *
 * 【为什么 CSS 用 #game:not(.desktop-layout) 而不是 @media】"是不是桌面布局"在本项目里
 * 已有唯一权威判定 isDesktopLayout()(render.js),结果写成 #game 上的 .desktop-layout
 * class。CSS 复用这个 class 取反,和 JS 判定永远同步,不会出现"两套条件各自演化后漂移"
 * 这类本项目反复踩过的坑(CLAUDE.md 规则22)。下面有一条断言专门钉住这个选择。
 *
 * 【真实渲染验证不在这里】浮层实际尺寸/位置/不遮挡/桌面零回归/真实点击与触屏tap,已用
 * Playwright 在 手机横屏SE·手机横屏15/16·平板横竖屏·桌面1280/1440 六档视口实测过
 * (含14项功能性断言),见 commit 记录;这份测试只锁定纯逻辑与源码结构。
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

console.log('\n' + '='.repeat(60));
console.log('  CORE-126: 手机/平板聊天浮层(开关 + 未读计数 + CSS结构)');
console.log('='.repeat(60) + '\n');

// ---------- A. JS 行为:真实加载 render-log.js ----------
// 最小 DOM stub:只实现这几个函数真正用到的能力。#chatBtn 的 class/attr 变化是未读
// 徽标的唯一可观测出口,所以 classList.toggle 要真实记录状态而不是空实现。
function makeClassList(){
  const set = new Set();
  return {
    _set: set,
    add: n => set.add(n),
    remove: n => set.delete(n),
    contains: n => set.has(n),
    toggle: (n, force) => { const on = (force===undefined) ? !set.has(n) : !!force; if(on) set.add(n); else set.delete(n); return on; }
  };
}
function makeEl(){
  return {
    classList: makeClassList(),
    _attrs: {},
    setAttribute(k,v){ this._attrs[k]=v; },
    getAttribute(k){ return this._attrs[k]===undefined ? null : this._attrs[k]; },
    scrollTop: 0, scrollHeight: 500,
    innerHTML: '', textContent: ''
  };
}

const chatBtn = makeEl();
const chatSection = makeEl();
const chatScroll = makeEl();

const context = {
  console: console,
  chatMessages: [],
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: id => (id === 'chatBtn' ? chatBtn : null),
    querySelector: sel => {
      if(sel === '.chat-panel-section') return chatSection;
      if(sel === '.chat-panel-scroll') return chatScroll;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  },
  window: { addEventListener: () => {}, matchMedia: () => ({ matches:false, addEventListener(){}, }) }
};
context.global = context;
const sandbox = vm.createContext(context, { name: 'sgs-core126-sandbox' });

check('真实加载 render-log.js,三个新函数都已定义', function(){
  vm.runInContext(fs.readFileSync(path.join(ROOT,'render-log.js'),'utf8'), sandbox, { filename:'render-log.js' });
  ['toggleChatPanel','closeChatPanel','updateChatUnreadBadge'].forEach(fn=>{
    if(typeof sandbox[fn] !== 'function') throw new Error(fn + ' 未定义,加载失败或函数名被改动');
  });
});

const toggle = () => vm.runInContext('toggleChatPanel()', sandbox);
const closePanel = () => vm.runInContext('closeChatPanel()', sandbox);
const updateBadge = () => vm.runInContext('updateChatUnreadBadge()', sandbox);
const setMsgs = n => vm.runInContext('chatMessages = Array.from({length:'+n+'},(_,i)=>({id:"m"+i,text:"t"+i}));', sandbox);
const isOpen = () => vm.runInContext('chatPanelOpen', sandbox);

check('初始为关闭态', function(){
  if(isOpen() !== false) throw new Error('chatPanelOpen 初值应为 false');
});

check('关闭态下,已有消息全部计为未读(红点亮起,数字正确)', function(){
  setMsgs(3);
  updateBadge();
  if(chatBtn.getAttribute('data-unread') !== '3') throw new Error('data-unread 应为3,实际' + chatBtn.getAttribute('data-unread'));
  if(!chatBtn.classList.contains('has-unread')) throw new Error('关闭态有未读时应该有 has-unread class');
});

check('打开面板:未读清零、红点消失、.chat-open class 挂上、消息区滚到底', function(){
  chatScroll.scrollTop = 0;
  toggle();
  if(isOpen() !== true) throw new Error('打开后 chatPanelOpen 应为 true');
  if(!chatSection.classList.contains('chat-open')) throw new Error('.chat-panel-section 应挂上 chat-open');
  if(chatBtn.classList.contains('has-unread')) throw new Error('打开后不应再有 has-unread(消息就在眼前)');
  if(chatBtn.getAttribute('data-unread') !== '0') throw new Error('打开后 data-unread 应为0,实际' + chatBtn.getAttribute('data-unread'));
  if(chatScroll.scrollTop !== chatScroll.scrollHeight) throw new Error('打开时应把消息区滚到底');
});

check('面板开着时新到的消息不计未读', function(){
  setMsgs(6); // 又来了3条
  updateBadge();
  if(chatBtn.classList.contains('has-unread')) throw new Error('面板开着时不应该亮红点');
});

check('关闭面板:.chat-open 摘掉,状态回到关闭', function(){
  closePanel();
  if(isOpen() !== false) throw new Error('关闭后 chatPanelOpen 应为 false');
  if(chatSection.classList.contains('chat-open')) throw new Error('.chat-open class 应被摘掉');
});

check('关闭期间新到的消息才计未读(此前已读的不重复计)', function(){
  // 关闭前已读到6条;现在来到9条 → 未读应为3,不是9
  setMsgs(9);
  updateBadge();
  if(chatBtn.getAttribute('data-unread') !== '3')
    throw new Error('未读应为3(只算关闭后新增的),实际' + chatBtn.getAttribute('data-unread'));
  if(!chatBtn.classList.contains('has-unread')) throw new Error('关闭期间有新消息应该亮红点');
});

check('closeChatPanel 对已关闭的面板是幂等的(不会误切成打开)', function(){
  closePanel();
  if(isOpen() !== false) throw new Error('对已关闭的面板再调 closeChatPanel 不应把它打开');
});

check('未读数超过99时显示为 99+(不撑破徽标)', function(){
  setMsgs(200);
  updateBadge();
  if(chatBtn.getAttribute('data-unread') !== '99+')
    throw new Error("超过99应显示 '99+',实际" + chatBtn.getAttribute('data-unread'));
});

// ---------- B. CSS / HTML 源码结构 ----------
const html = fs.readFileSync(path.join(ROOT,'index.html'), 'utf8');

function extractBlock(src, startMarker){
  const start = src.indexOf(startMarker);
  if(start < 0) return null;
  let depth = 0, blockStart = -1;
  for(let i = start; i < src.length; i++){
    if(src[i] === '{'){ if(depth === 0) blockStart = i; depth++; }
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(blockStart, i + 1); }
  }
  return null;
}

check('手机横屏断点:.log-panel 已从 display:none 改为 display:contents(父元素不生成盒子,子元素照常渲染)', function(){
  const block = extractBlock(html, '@media (max-height:460px) and (orientation:landscape){');
  if(!block) throw new Error('未能定位到手机横屏紧凑断点');
  if(/\.log-panel\{display:none;\}/.test(block))
    throw new Error('仍是 .log-panel{display:none} —— 那会连带把聊天区一起隐藏,正是本次要修的 bug');
  if(!/\.log-panel\{display:contents;\}/.test(block))
    throw new Error('未找到 .log-panel{display:contents}');
  if(!/\.log-panel-section\{display:none;\}/.test(block))
    throw new Error('未找到 .log-panel-section{display:none} —— 手机上日志半边仍应隐藏(纵向预算),只有聊天浮起来');
});

check('聊天浮层规则用 #game:not(.desktop-layout) 门控(复用 isDesktopLayout 的唯一判定,不另写 @media 条件)', function(){
  if(!/#game:not\(\.desktop-layout\) \.chat-panel-section\{/.test(html))
    throw new Error('未找到 #game:not(.desktop-layout) .chat-panel-section 规则');
  if(!/#game:not\(\.desktop-layout\) \.chat-panel-section\.chat-open\{display:flex;\}/.test(html))
    throw new Error('未找到 .chat-open 打开态规则');
});

check('浮层默认关闭(display:none)且是 position:fixed(脱离 #logPanel 的高度预算)', function(){
  const m = html.match(/#game:not\(\.desktop-layout\) \.chat-panel-section\{[\s\S]*?\}/);
  if(!m) throw new Error('未能提取浮层规则');
  if(!/position:fixed/.test(m[0])) throw new Error('浮层应为 position:fixed');
  if(!/display:none/.test(m[0])) throw new Error('浮层默认应为 display:none(点按钮才打开)');
});

check('浮层右边界让开 💬 按钮那一格(right:64px,不是12px),避免按钮压住关闭按钮', function(){
  const m = html.match(/#game:not\(\.desktop-layout\) \.chat-panel-section\{[\s\S]*?\}/);
  if(!/right:64px/.test(m[0]))
    throw new Error('浮层 right 应为 64px —— 实测 right:12px 时 #chatBtn(top:64/right:12)会压在浮层关闭按钮上、拦截点击');
});

check('💬 入口按钮存在,且只在"非桌面布局 + 已进房间"时显示', function(){
  if(!/id="chatBtn"[^>]*onclick="toggleChatPanel\(\)"/.test(html))
    throw new Error('未找到 #chatBtn 按钮或其 onclick 绑定');
  if(!/#chatBtn\{[^}]*display:none[^}]*\}/.test(html))
    throw new Error('#chatBtn 基础规则应为 display:none');
  if(!/body:has\(#game:not\(\.hidden\):not\(\.desktop-layout\)\) #chatBtn\{display:flex;\}/.test(html))
    throw new Error('未找到 :has() 门控规则(非桌面布局 + 非大厅 才显示)');
});

check('未读徽标用 data-unread 属性驱动(::after content:attr)', function(){
  if(!/#chatBtn\.has-unread::after\{[\s\S]*?content:attr\(data-unread\)/.test(html))
    throw new Error('未找到未读徽标的 ::after content:attr(data-unread) 规则');
});

check('聊天标题栏文字写进独立的 .chat-head-text(不能直接给 .chat-panel-head 设 textContent,会清掉关闭按钮)', function(){
  const js = fs.readFileSync(path.join(ROOT,'render-log.js'), 'utf8');
  if(!/chatHeadText\.textContent=/.test(js))
    throw new Error('render-log.js 应把标题文字写进 .chat-head-text');
  if(/chatHead\.textContent='聊天/.test(js))
    throw new Error('仍在给整个 .chat-panel-head 设 textContent —— 会把同在 head 里的关闭按钮一起清掉');
  if(!/class="chat-head-text"/.test(js) || !/class="chat-close-btn"/.test(js))
    throw new Error('聊天标题栏应同时包含 .chat-head-text 与 .chat-close-btn');
});

// 零回归:桌面聊天不受影响。
// 【必须先剥注释再匹配】第一版直接在原文上跑 /#game\.desktop-layout[^{]*\.chat-panel-section/
// 就误报了——[^{]* 会跨过 CSS 注释里的散文,而本次新增的注释里恰好同时提到了
// "#game.desktop-layout:has(...)"(引用项目既有写法)和 ".chat-panel-section",于是两段
// 毫不相干的说明文字被当成一条选择器匹配上了。断言只该看真正的 CSS 规则,不该看注释。
const cssOnly = html.replace(/\/\*[\s\S]*?\*\//g, '');
check('零回归:桌面布局下没有任何针对 .chat-panel-section 的规则(桌面聊天保持原样)', function(){
  if(/#game\.desktop-layout[^{}]*\.chat-panel-section/.test(cssOnly))
    throw new Error('本次改动不应为桌面布局新增任何 .chat-panel-section 规则');
});

// 破坏性验证:确认"手机断点不能是 display:none"这条断言真的会红
check('破坏性验证:把手机断点还原成 .log-panel{display:none},对应断言确实会报红(证明有鉴别力)', function(){
  const block = extractBlock(html, '@media (max-height:460px) and (orientation:landscape){');
  const reverted = block.replace('.log-panel{display:contents;}', '.log-panel{display:none;}');
  if(reverted === block) throw new Error('还原文本没有生效,替换目标字符串找不到');
  if(!/\.log-panel\{display:none;\}/.test(reverted))
    throw new Error('还原后应该能匹配到旧写法,如果匹配不到说明这条破坏性验证本身没有意义');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
