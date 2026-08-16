/**
 * CORE-115(issue #115):身份猜测标记 — 座位卡中心的忠/反/内个人猜测标记。
 *
 * 锁定 issue 正文里已确认的四点设计决定,均已用真实 vm 沙箱验证:
 *  1. 数据存储:localStorage,key 含房间号+座位号,不写入 g/不经过 tx。
 *  2. 点击交互:座位卡独立小图标(.seat-identity-mark),onclick 里
 *     event.stopPropagation(),不干扰整卡 onclick(出牌选目标)。
 *  3. 适用范围:仅 gameMode==='identity' 且已开局(g.started)才渲染。
 *  4. 生命周期:newGame() 清空当前房间全部标记。
 *
 * 另含 CORE-115 验收标准要求的"程序化对比度验证"(WCAG 相对亮度公式),不依赖截图/
 * 肉眼判断——具体理由见文件底部对应测试块的注释。
 */
const vm = require('vm');
const fs = require('fs');

// ---- 真实内存 localStorage(支持 length/key(i),clearAllIdentityMarks 靠这个遍历) ----
function makeLocalStorage(){
  const store = new Map();
  return {
    getItem(k){ return store.has(k) ? store.get(k) : null; },
    setItem(k, v){ store.set(k, String(v)); },
    removeItem(k){ store.delete(k); },
    clear(){ store.clear(); },
    key(i){ return Array.from(store.keys())[i]; },
    get length(){ return store.size; },
    _store: store, // 测试直接读取内部状态用
  };
}

const localStorageStub = makeLocalStorage();

const context = {
  gameRef: { transaction: function(fn) { return fn(context.g || {}); } },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, querySelector: function() { return null; }, querySelectorAll: function() { return []; }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {}, insertAdjacentHTML: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; }, remove: function() {} }; },
    createTextNode: function(t) { return { nodeValue: t, textContent: t }; },
    createDocumentFragment: function() { return { appendChild: function() { return {}; }, querySelector: function() { return null; }, querySelectorAll: function() { return []; } }; },
    querySelector: function() { return null; }, querySelectorAll: function() { return []; },
    body: { innerHTML: '', appendChild: function() { return {}; }, removeChild: function() { return {}; }, insertBefore: function() { return {}; } },
    head: { appendChild: function() { return {}; } }, forms: [], images: [], scripts: [],
    addEventListener: function() {}, removeEventListener: function() {}
  },
  window: {
    firebase: null,
    location: { search: '', href: 'http://localhost', reload: function() {} },
    localStorage: localStorageStub,
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    setInterval: function(f, t) { return setInterval(f, t); }, clearInterval: function(t) { return clearInterval(t); },
    alert: function() {}, confirm: function() { return true; }, prompt: function() { return null; },
    open: function() { return null; }, close: function() {},
    history: { pushState: function() {}, replaceState: function() {} },
    navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', onLine: true }
  },
  localStorage: localStorageStub, // 裸标识符(渲染层代码里都是不带 window. 前缀直接调用)
  joinRoom: function() {},
  mySeat: 0,
  pushLog: function(log, text) { log.push({seq: log.length, text: text}); return log; },
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp,
  setTimeout: function(f, t){ return setTimeout(f, t); },
  clearTimeout: function(t){ return clearTimeout(t); }
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-identity-mark-sandbox' });

console.log('Loading CORE-115 身份标记 测试环境...\n');
const files = ['config.js', 'data.js', 'stages/stage-table.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    if (file === 'game.js') {
      vm.runInContext('tx = function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); };', sandbox);
      vm.runInContext('gameRef = { transaction: function(fn) { return tx(fn); } };', sandbox);
      vm.runInContext('mySeat = 0;', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});
console.log('  OK 全部源文件加载完成');

console.log('\n' + '='.repeat(60));
console.log('  CORE-115:身份猜测标记');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(async function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    return Promise.resolve().then(fn).then(function(){
      console.log('  PASS ' + name); pass++;
    }, function(e){
      console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++;
    });
  }

  function mkPlayers(){
    return [
      { name:'p0', general:'liubei', isBot:false, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'zhu' },
      { name:'p1', general:'caocao', isBot:true, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'fan' },
      { name:'p2', general:'zhangfei', isBot:true, alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'zhong' }
    ];
  }

  // ============ 1. localStorage 增删改查(设计决定①) ============
  await check('CORE-115: getIdentityMark 初始为 null', function(){
    roomId = 'roomA'; localStorage.clear();
    if(getIdentityMark(1) !== null) throw new Error('未设置时应为 null');
  });
  await check('CORE-115: setIdentityMark 写入后 getIdentityMark 能读回', function(){
    setIdentityMark(1, 'fan');
    if(getIdentityMark(1) !== 'fan') throw new Error('应读回 fan,实际 ' + getIdentityMark(1));
  });
  await check('CORE-115: 重新设置(改) 覆盖旧值', function(){
    setIdentityMark(1, 'nei');
    if(getIdentityMark(1) !== 'nei') throw new Error('应改为 nei,实际 ' + getIdentityMark(1));
  });
  await check('CORE-115: setIdentityMark(seat, null) 清除标记', function(){
    setIdentityMark(1, null);
    if(getIdentityMark(1) !== null) throw new Error('应清空,实际 ' + getIdentityMark(1));
  });
  await check('CORE-115: 非法值一律视为清除(防脏数据)', function(){
    setIdentityMark(2, 'zhong');
    localStorage.setItem(identityMarkKey(2), 'garbage'); // 模拟手改localStorage
    if(getIdentityMark(2) !== null) throw new Error('非法值应读作 null,实际 ' + getIdentityMark(2));
  });
  await check('CORE-115: key 格式含房间号+座位号,不同房间/座位互不干扰', function(){
    localStorage.clear();
    roomId = 'roomA'; setIdentityMark(0, 'zhong');
    roomId = 'roomB'; setIdentityMark(0, 'fan');
    if(getIdentityMark(0) !== 'fan') throw new Error('roomB座位0应为fan,实际 ' + getIdentityMark(0));
    roomId = 'roomA';
    if(getIdentityMark(0) !== 'zhong') throw new Error('roomA座位0应仍为zhong(不受roomB影响),实际 ' + getIdentityMark(0));
    var k0 = identityMarkKey(0), k1 = identityMarkKey(1);
    if(k0.indexOf('roomA')<0 || k0.indexOf('0')<0) throw new Error('key应含房间号与座位号,实际 ' + k0);
  });
  await check('CORE-115: 不写入 g(共享房间状态),纯本地', function(){
    var g = { players: mkPlayers(), gameMode:'identity', started:true };
    var before = JSON.stringify(g);
    setIdentityMark(0, 'nei');
    if(JSON.stringify(g) !== before) throw new Error('setIdentityMark 不应触碰传入的 g 对象');
    // 也确认没有经过 tx/gameRef.transaction
    var txCalls = 0;
    var savedTx = tx;
    tx = function(){ txCalls++; return null; };
    setIdentityMark(0, 'fan');
    getIdentityMark(0);
    tx = savedTx;
    if(txCalls !== 0) throw new Error('不应经过 tx,实际调用 ' + txCalls + ' 次');
  });

  // ============ 2. 点击交互独立于整卡 onclick(设计决定②) ============
  await check('CORE-115: 座位卡渲染出的标记入口自带 stopPropagation,不占整卡点击区域', function(){
    roomId = 'roomA'; localStorage.clear();
    var g = { players: mkPlayers(), gameMode:'identity', started:true, turn:0 };
    var html = renderSeatCard(g, 1, false);
    if(html.indexOf('seat-identity-mark')<0) throw new Error('应渲染出标记入口元素');
    if(html.indexOf('event.stopPropagation();openIdentityMarkMenu(1)')<0)
      throw new Error('标记入口的onclick应先stopPropagation再调用openIdentityMarkMenu,和武将说明/装备/判定区角标同一套写法,实际html片段:' + html.slice(html.indexOf('seat-identity-mark')-30, html.indexOf('seat-identity-mark')+200));
  });
  await check('CORE-115: openIdentityMarkMenu 弹出忠/反/内/清除/取消五个选项', function(){
    var m = { innerHTML:'', classList:{ remove(){}, add(){} }, querySelectorAll: function(){ return []; }, querySelector: function(){ return { onclick:null }; }, onclick:null };
    var savedGetById = document.getElementById;
    document.getElementById = function(id){ return id==='confirmModal' ? m : savedGetById(id); };
    currentG = { players: mkPlayers() };
    openIdentityMarkMenu(1);
    document.getElementById = savedGetById;
    ['忠','反','内','清除标记','取消'].forEach(function(txt){
      if(m.innerHTML.indexOf(txt)<0) throw new Error('菜单应含选项"'+txt+'",实际 ' + m.innerHTML);
    });
  });
  await check('CORE-115: 点击菜单选项后 localStorage 写入对应标记', function(){
    roomId = 'roomA'; localStorage.clear();
    var buttons = [];
    var m = {
      innerHTML:'',
      classList:{ remove(){}, add(){} },
      querySelectorAll: function(sel){ return sel.indexOf('data-mark')>=0 ? buttons : []; },
      querySelector: function(){ return { onclick:null }; },
      onclick:null
    };
    var savedGetById = document.getElementById;
    document.getElementById = function(id){ return id==='confirmModal' ? m : savedGetById(id); };
    // 模拟真实DOM:openIdentityMarkMenu写完innerHTML后会querySelectorAll拿到按钮并挂onclick,
    // 这里手工构造3个"按钮"让querySelectorAll返回它们,拿到onclick后手动触发验证效果。
    buttons.push({ dataset:{mark:'zhong'}, onclick:null });
    currentG = { players: mkPlayers() };
    var savedRender = render;
    render = function(){}; // render-controls.js 未加载,真实 render() 会因 resetZhangba 等未定义而报错——
                            // 这里只关心"点击后localStorage是否写入",不关心真实重绘,mock掉即可
    openIdentityMarkMenu(2);
    document.getElementById = savedGetById;
    if(typeof buttons[0].onclick !== 'function') throw new Error('按钮应被挂上onclick');
    buttons[0].onclick(); // 触发时 render 仍是 mock(还没恢复),不会碰到未加载的 render-controls.js
    render = savedRender;
    if(getIdentityMark(2) !== 'zhong') throw new Error('点击"忠"按钮后应写入zhong,实际 ' + getIdentityMark(2));
  });

  // ============ 3. 仅 identity 模式且已开局才渲染(设计决定③) ============
  await check('CORE-115: gameMode!=="identity" 时不渲染入口(ffa)', function(){
    roomId='roomA';
    var g = { players: mkPlayers(), gameMode:'ffa', started:true, turn:0 };
    var html = renderSeatCard(g, 1, false);
    if(html.indexOf('seat-identity-mark')>=0) throw new Error('ffa模式不应渲染标记入口');
  });
  await check('CORE-115: gameMode!=="identity" 时不渲染入口(team)', function(){
    var g = { players: mkPlayers(), gameMode:'team', started:true, turn:0 };
    g.players.forEach(function(p,i){ p.team=i%2; });
    var html = renderSeatCard(g, 1, false);
    if(html.indexOf('seat-identity-mark')>=0) throw new Error('team模式不应渲染标记入口');
  });
  await check('CORE-115: identity模式但未开局(大厅/选将阶段)不渲染入口', function(){
    var g = { players: mkPlayers(), gameMode:'identity', started:false, turn:0 };
    var html = renderSeatCard(g, 1, false);
    if(html.indexOf('seat-identity-mark')>=0) throw new Error('未开局不应渲染标记入口(还没真的在玩)');
  });
  await check('CORE-115: identity模式且已开局才渲染入口', function(){
    var g = { players: mkPlayers(), gameMode:'identity', started:true, turn:0 };
    var html = renderSeatCard(g, 1, false);
    if(html.indexOf('seat-identity-mark')<0) throw new Error('identity模式+已开局应渲染标记入口');
  });
  await check('CORE-115: 已设置的标记同样仅在identity+已开局时显示(不因模式切换泄露)', function(){
    roomId='roomA'; setIdentityMark(1, 'fan');
    var gFfa = { players: mkPlayers(), gameMode:'ffa', started:true, turn:0 };
    var htmlFfa = renderSeatCard(gFfa, 1, false);
    if(htmlFfa.indexOf('has-mark')>=0) throw new Error('ffa模式不应显示已设置的标记');
    var gId = { players: mkPlayers(), gameMode:'identity', started:true, turn:0 };
    var htmlId = renderSeatCard(gId, 1, false);
    if(htmlId.indexOf('has-mark')<0) throw new Error('identity模式应显示已设置的fan标记');
    if(htmlId.indexOf('>反<')<0) throw new Error('应显示"反"这个字,实际未找到,html片段:' + htmlId.slice(htmlId.indexOf('has-mark')-20,htmlId.indexOf('has-mark')+150));
  });

  // ============ 4. newGame() 清空标记(设计决定④) ============
  await check('CORE-115: newGame() 清空当前房间全部座位的标记', function(){
    roomId = 'roomNG';
    localStorage.clear();
    setIdentityMark(0, 'zhong'); setIdentityMark(1, 'fan'); setIdentityMark(2, 'nei');
    if(getIdentityMark(0)!=='zhong' || getIdentityMark(1)!=='fan' || getIdentityMark(2)!=='nei')
      throw new Error('前置条件:三个座位应都已设置标记');
    // newGame() 内部会调用 tx(...)——room owner 判定等真实逻辑很重,这里只关心
    // "本地标记清空"这一件事是否在 tx 之前无条件执行(resetBotTwoStep 同款写法)。
    var savedTx = tx;
    tx = function(){ /* 不深入,避免拖入完整 owner/normalize 逻辑 */ return null; };
    var savedIsRoomOwner = (typeof isRoomOwner!=='undefined') ? isRoomOwner : undefined;
    newGame();
    tx = savedTx;
    if(getIdentityMark(0)!==null || getIdentityMark(1)!==null || getIdentityMark(2)!==null)
      throw new Error('newGame后三个座位的标记都应被清空,实际 ' +
        JSON.stringify([getIdentityMark(0),getIdentityMark(1),getIdentityMark(2)]));
  });
  await check('CORE-115: newGame() 只清空当前房间,不影响别的房间残留的标记', function(){
    localStorage.clear();
    roomId = 'roomX'; setIdentityMark(0, 'zhong');
    roomId = 'roomY'; setIdentityMark(0, 'fan');
    var savedTx = tx;
    tx = function(){ return null; };
    newGame(); // 此时 roomId==='roomY'
    tx = savedTx;
    if(getIdentityMark(0)!==null) throw new Error('roomY应已清空');
    roomId = 'roomX';
    if(getIdentityMark(0)!=='zhong') throw new Error('roomX不应受影响,实际 ' + getIdentityMark(0));
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  __testFail = fail > 0;
  __testDone = true;
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  __testFail = true;
  __testDone = true;
});
`;

vm.runInContext('var __testDone=false, __testFail=false;', sandbox);
vm.runInContext(testCode, sandbox, { filename: 'identity-mark-test' });

(function waitDone(){
  if (vm.runInContext('__testDone', sandbox)) {
    const fail = vm.runInContext('__testFail', sandbox);
    if (fail) { process.exitCode = 1; runContrastCheck(); return; }
    runContrastCheck();
    return;
  }
  setTimeout(waitDone, 20);
})();

// ============ 5. 视觉对比度验证(程序化,非截图/肉眼) ============
// 【为什么不用截图】这个环境(node vm 沙箱测试)没有可用的浏览器渲染环境(headless
// chromium 依赖的系统共享库在本沙箱缺失、且安装依赖需要 sudo 密码,当次会话内确认
// 不可获得)——不是"图省事跳过",是环境限制下选择了仍然严谨的替代验证路径。
// 【为什么这条替代路径仍然可信,不是"退而求其次的糊弄"】CLAUDE.md 里"视觉验证必须挑
// 最刁钻样本"这条教训,历史上两次踩坑的根因都是同一件事:元素用了**半透明**底衬,导致
// 有效对比度随立绘明暗漂移(最亮machao/最暗simayi给出完全不同的结果)。这次的
// .seat-identity-mark 从设计上就没有这个自由度可踩——background 是 #1a1410 这个**不透明
// 纯色**(不是 rgba,alpha=1),直接复用 .info-badge 已经验证过的同一个色值。不透明意味着
// 背后的立绘像素被 100% 遮盖,对比度在数学上就是纯前景色/背景色两个常量的函数,与立绘
// 完全无关——用最亮/最暗立绘各截一次图,结果必然是同一个数字,截图验证在这种情况下不会
// 比直接计算更可信,只是更慢。所以这里做两件事:①程序化确认 CSS 声明里的背景色确实是
// 不透明六位十六进制(不是 rgba(...,数字<1)),排除"想当然" ②对取出的真实前景色/背景色
// 跑标准 WCAG 2.1 相对亮度公式,断言比值 ≥ 4.5(项目统一遵循的 AA 门槛)。
function runContrastCheck(){
  console.log('='.repeat(60));
  console.log('  CORE-115:座位卡中心标记 —— 程序化对比度验证(非截图)');
  console.log('='.repeat(60) + '\n');
  let pass = 0, fail = 0;
  function check(name, fn){
    try { fn(); console.log('  PASS ' + name); pass++; }
    catch(e){ console.log('  FAIL ' + name + ' - ' + e.message); fail++; }
  }

  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const ruleMatch = /\.seat-identity-mark\{([^}]*)\}/.exec(indexHtml);

  check('index.html 中存在 .seat-identity-mark 规则', function(){
    if(!ruleMatch) throw new Error('未找到 .seat-identity-mark{...} 规则');
  });
  const rule = ruleMatch ? ruleMatch[1] : '';

  check('.seat-identity-mark 的 background 是不透明六位十六进制色(不是半透明rgba)', function(){
    const bgMatch = /background:\s*(#[0-9a-fA-F]{6})\b/.exec(rule);
    if(!bgMatch) throw new Error('未找到不透明六位hex背景色声明,实际片段: ' + rule);
    // 顺手确认真的不是 rgba(...,小数) 这种半透明写法——这条断言必须能红:如果有人把
    // background 改成 rgba(26,20,16,.5) 之类,上面的 hex 正则会匹配不到,这条会先炸。
    if(/background:\s*rgba\(/.test(rule)) throw new Error('background 不应是 rgba(半透明)形式');
  });

  function lum(hex){
    hex = hex.replace('#','');
    const r=parseInt(hex.slice(0,2),16)/255, g=parseInt(hex.slice(2,4),16)/255, b=parseInt(hex.slice(4,6),16)/255;
    const f=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
  }
  function contrastRatio(hexA, hexB){
    const L1=lum(hexA), L2=lum(hexB);
    const hi=Math.max(L1,L2), lo=Math.min(L1,L2);
    return (hi+0.05)/(lo+0.05);
  }

  // 提取 :root 里 --paper / --gold 的真实定义值,不手抄字面量(字面量会和源码脱钩,
  // 源码改了颜色这条测试也不会跟着改,变成假绿)。
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(indexHtml);
  const rootVars = rootMatch ? rootMatch[1] : '';
  function cssVar(name){
    const m = new RegExp('--'+name+':\\s*(#[0-9a-fA-F]{6})').exec(rootVars);
    if(!m) throw new Error('未找到 --' + name + ' 的定义');
    return m[1];
  }
  const bgHex = /background:\s*(#[0-9a-fA-F]{6})/.exec(rule)[1];
  const paperHex = cssVar('paper');
  const goldHex = cssVar('gold');

  check('WCAG对比度 ≥ 4.5:标记文字(--paper)对背景(#1a1410)', function(){
    const r = contrastRatio(paperHex, bgHex);
    console.log('    (' + paperHex + ' vs ' + bgHex + ' = ' + r.toFixed(2) + ')');
    if(r < 4.5) throw new Error('对比度 ' + r.toFixed(2) + ' 低于 WCAG AA 门槛 4.5');
  });
  check('WCAG对比度 ≥ 4.5:虚线边框(--gold)对背景(#1a1410)', function(){
    const r = contrastRatio(goldHex, bgHex);
    console.log('    (' + goldHex + ' vs ' + bgHex + ' = ' + r.toFixed(2) + ')');
    if(r < 4.5) throw new Error('对比度 ' + r.toFixed(2) + ' 低于 WCAG AA 门槛 4.5');
  });
  // 反向验证这条断言"能变红"(CLAUDE.md 第20条:断言必须真的会红,不能是形式主义)——
  // 用一个真实会挂科的低对比度组合(暗红字 on 同样暗的背景)证明 contrastRatio 函数本身
  // 是有鉴别力的,不是无论如何都返回一个大数字的摆设。
  check('对比度函数确实有鉴别力(低对比度组合会被正确判定为不达标)', function(){
    const r = contrastRatio('#2a2018', '#1a1410'); // 两个非常接近的暗色
    if(r >= 4.5) throw new Error('这组低对比度颜色不应通过4.5门槛,实际算出 ' + r.toFixed(2) + '(说明contrastRatio函数有问题)');
  });

  console.log('\n' + '='.repeat(60));
  console.log('  对比度验证结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  if(fail > 0) process.exitCode = 1;
}
