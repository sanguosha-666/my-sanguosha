/**
 * CORE-102(issue #149):强制关闭当前房间未清理AI托管状态,可能跨房间继承旧座位。
 *
 * AI托管是浏览器本地 {active,seat} 状态。正常游戏进入phase==='over'时会停止托管
 * (syncAiTestGamePhase),但房主强制关闭房间(cleanupRoom→backToLobby)或非房主被动
 * 收到房间删除(render.js的"room was deleted"分支→backToLobby)都没有调用
 * stopAiTestAutopilot()。托管状态也未绑定roomId/cid,render.js里"mySeat重定位后同步
 * 刷新托管座位"那行代码(if(aiTestAutopilot.active) aiTestAutopilot.seat=mySeat)会在
 * 进入新房间后,只要恰好分到同一个座位号,就把旧房间的托管状态原样套用到新房间——
 * bot.js的isAutopilotSeat会认为这个座位"正在被AI托管",即使从未在新房间里真正点过
 * "开始托管"按钮。
 *
 * 修复:
 * - backToLobby()开头补一段:active时调用stopAiTestAutopilot()(覆盖强制关房和被动收到
 *   房间删除两条路径,两者都收敛到这一个函数)。
 * - aiTestAutopilot新增roomId/cid快照(建立托管时记录),新增只读校验函数
 *   aiTestAutopilotContextValid()——active=true还不够,roomId/cid也必须和快照一致。
 * - render.js的座位同步钩子每次render都做这层校验,不匹配就主动stopAiTestAutopilot()
 *   (双重防线:即使backToLobby那条路径因故没生效,下一次render也会发现并清理)。
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const readSource = file => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

console.log('\n== CORE-102:强制关闭房间未清理AI托管状态,跨房间继承旧座位 ==\n');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

// ---- 单元级:aiTestAutopilotContextValid + start/stopAiTestAutopilot(直接加载ai-bot.js的相关片段) ----
function mkAutopilotContext(overrides){
  const state = { active:false, seat:null, roomId:null, cid:null };
  const published = [];
  const ctx = Object.assign({
    aiTestAutopilot: state,
    aiTestAutopilotDisconnectRef: null,
    aiApiKey: 'test-key', aiProvider: 'claude',
    mySeat: 0, roomId: null, myClientId: 'cidA',
    tx: function(fn){ /* no-op,publishAiTestAutopilot只用来记录调用 */ },
    gameRef: null,
    document: { getElementById: () => null },
    showAiKeyModal: function(){},
    publishAiTestAutopilot: function(active, seat){ published.push([active, seat]); },
    updateAiTestStatus: function(){},
  }, overrides || {});
  vm.createContext(ctx);
  const source = readSource('ai-bot.js');
  const s1 = source.indexOf('function startAiTestAutopilot(){');
  const s2 = source.indexOf('function aiTestAutopilotContextValid(){');
  const end2 = source.indexOf('\n}', s2) + 2;
  assert.ok(s1>=0 && s2>=0, '应能定位 startAiTestAutopilot/aiTestAutopilotContextValid');
  const snippet = source.slice(s1, end2);
  vm.runInContext(snippet, ctx, { filename: 'autopilot.js' });
  return { ctx, state, published };
}

check('startAiTestAutopilot:记录roomId/cid快照', ()=>{
  const { ctx, state } = mkAutopilotContext({ roomId: 'roomA', mySeat: 2 });
  vm.runInContext('startAiTestAutopilot()', ctx);
  assert.strictEqual(state.active, true);
  assert.strictEqual(state.seat, 2);
  assert.strictEqual(state.roomId, 'roomA');
  assert.strictEqual(state.cid, 'cidA');
});

check('aiTestAutopilotContextValid:roomId一致时有效', ()=>{
  const { ctx } = mkAutopilotContext({ roomId: 'roomA', mySeat: 1 });
  vm.runInContext('startAiTestAutopilot()', ctx);
  assert.strictEqual(vm.runInContext('aiTestAutopilotContextValid()', ctx), true);
});

check('aiTestAutopilotContextValid:roomId不一致时失效(核心场景:换了房间)', ()=>{
  const { ctx, state } = mkAutopilotContext({ roomId: 'roomA', mySeat: 1 });
  vm.runInContext('startAiTestAutopilot()', ctx);
  // 模拟"强制关房后进入了另一个房间roomB,座位号恰好相同"
  ctx.roomId = 'roomB';
  assert.strictEqual(vm.runInContext('aiTestAutopilotContextValid()', ctx), false,
    '房间已切换,旧托管状态不应继续视为有效');
});

check('aiTestAutopilotContextValid:cid不一致时失效(换了浏览器身份)', ()=>{
  const { ctx } = mkAutopilotContext({ roomId: 'roomA', mySeat: 1 });
  vm.runInContext('startAiTestAutopilot()', ctx);
  ctx.myClientId = 'cidB';
  assert.strictEqual(vm.runInContext('aiTestAutopilotContextValid()', ctx), false);
});

check('aiTestAutopilotContextValid:大厅阶段开启托管(roomId快照为null)不算漂移,进房后仍视为有效', ()=>{
  const { ctx, state } = mkAutopilotContext({ roomId: null, mySeat: 0 });
  vm.runInContext('startAiTestAutopilot()', ctx);
  assert.strictEqual(state.roomId, null, '大厅阶段快照应为null');
  ctx.roomId = 'roomA'; // 进房后roomId变成真实值,不应被判定为"漂移"
  assert.strictEqual(vm.runInContext('aiTestAutopilotContextValid()', ctx), true,
    '大厅先开托管、进房后roomId从null变为真实值,不应视为上下文失效');
});

check('aiTestAutopilotContextValid:active=false时恒为false', ()=>{
  const { ctx } = mkAutopilotContext({ roomId: 'roomA', mySeat: 0 });
  assert.strictEqual(vm.runInContext('aiTestAutopilotContextValid()', ctx), false);
});

// ---- backToLobby():应在active时调用stopAiTestAutopilot ----
check('backToLobby:托管active时应调用stopAiTestAutopilot(覆盖强制关房+被动收到房间删除两条路径)', ()=>{
  const source = readSource('room-lifecycle.js');
  const start = source.indexOf('function backToLobby(){');
  assert.ok(start >= 0, '应能定位 backToLobby');
  const fn = source.slice(start);

  let stopCalls = 0;
  const elements = {
    game: { classList: { add: () => {} } },
    lobby: { classList: { remove: () => {} } },
    lobbyErr: { textContent: '' },
  };
  const ctx = {
    chatQuery: { off: () => {} }, chatRef: {}, chatMessages: ['旧消息'],
    mySeat: 2, selectedCardIdx: 3,
    resetZhangba: () => {},
    aiSummaryReset: () => {},
    aiTestAutopilot: { active: true, seat: 2, roomId: 'roomA', cid: 'cidA' },
    stopAiTestAutopilot: () => { stopCalls += 1; },
    document: { getElementById: id => elements[id] },
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx, { filename: 'backToLobby.js' });
  vm.runInContext('backToLobby()', ctx);

  assert.strictEqual(stopCalls, 1, '离开房间且托管active时必须调用stopAiTestAutopilot');
});

check('backToLobby:托管未active时不应调用stopAiTestAutopilot(避免无意义的Firebase写入)', ()=>{
  const source = readSource('room-lifecycle.js');
  const start = source.indexOf('function backToLobby(){');
  const fn = source.slice(start);

  let stopCalls = 0;
  const elements = {
    game: { classList: { add: () => {} } },
    lobby: { classList: { remove: () => {} } },
    lobbyErr: { textContent: '' },
  };
  const ctx = {
    chatQuery: { off: () => {} }, chatRef: {}, chatMessages: [],
    mySeat: 2, selectedCardIdx: 3,
    resetZhangba: () => {},
    aiSummaryReset: () => {},
    aiTestAutopilot: { active: false, seat: null, roomId: null, cid: null },
    stopAiTestAutopilot: () => { stopCalls += 1; },
    document: { getElementById: id => elements[id] },
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx, { filename: 'backToLobby.js' });
  vm.runInContext('backToLobby()', ctx);

  assert.strictEqual(stopCalls, 0, '托管本就未激活时不应调用stopAiTestAutopilot');
});

// ---- 端到端:真实bot.js的isAutopilotSeat在"跨房间同座位"场景下的行为 ----
check('端到端:isAutopilotSeat在roomId漂移+backToLobby清理后,不应继续认定旧座位为托管中', ()=>{
  const context = {
    console,
    document: { getElementById: () => null },
  };
  vm.createContext(context);
  const aiBotSrc = readSource('ai-bot.js');
  const s1 = aiBotSrc.indexOf('let aiTestAutopilot');
  const s2 = aiBotSrc.indexOf('function aiTestAutopilotContextValid(){');
  const end2 = aiBotSrc.indexOf('\n}', s2) + 2;
  vm.runInContext(aiBotSrc.slice(s1, end2), context, { filename: 'ai-bot-slice.js' });
  const botSrc = readSource('bot.js');
  const b1 = botSrc.indexOf('function isAutopilotSeat(seat){');
  const b2 = botSrc.indexOf('\n}', b1) + 2;
  vm.runInContext(botSrc.slice(b1, b2), context, { filename: 'bot-slice.js' });

  // 房间A:座位2开启托管
  vm.runInContext('aiTestAutopilot.active=true; aiTestAutopilot.seat=2; aiTestAutopilot.roomId="roomA"; aiTestAutopilot.cid="cidA";', context);
  assert.strictEqual(vm.runInContext('isAutopilotSeat(2)', context), true, '房间A座位2应被认定为托管中');

  // 模拟"强制关闭房间A、进入房间B、恰好又分到座位2"——render.js的watchdog逻辑手动内联复现:
  // roomId已经变化,先校验再决定是否保留.active
  const roomIdNow = 'roomB';
  context.roomId = roomIdNow;
  const stillValid = vm.runInContext('aiTestAutopilotContextValid()', context);
  assert.strictEqual(stillValid, false, '房间已切换,校验应判定为失效');
  // 校验失效后调用方(render.js真实逻辑)应该stopAiTestAutopilot;这里直接模拟其效果
  vm.runInContext('aiTestAutopilot.active=false; aiTestAutopilot.seat=null; aiTestAutopilot.roomId=null; aiTestAutopilot.cid=null;', context);

  assert.strictEqual(vm.runInContext('isAutopilotSeat(2)', context), false,
    '清理后,房间B座位2不应被误判为托管中(修复前的bug:这里会错误返回true)');
});

// ---- 破坏性验证:还原成旧版backToLobby(没有stopAiTestAutopilot那段),证明上面的断言有鉴别力 ----
check('破坏性验证:还原成旧版backToLobby(不清理托管),托管状态确实会原样残留(证明断言有鉴别力)', ()=>{
  const source = readSource('room-lifecycle.js');
  const start = source.indexOf('function backToLobby(){');
  let fn = source.slice(start);
  // 手动还原成修复前的旧版本:删掉新增的stopAiTestAutopilot那一段
  fn = fn.replace(
    /\/\/ CORE-102[\s\S]*?stopAiTestAutopilot\(\);\n/,
    ''
  );
  let stopCalls = 0;
  const elements = {
    game: { classList: { add: () => {} } },
    lobby: { classList: { remove: () => {} } },
    lobbyErr: { textContent: '' },
  };
  const ctx = {
    chatQuery: { off: () => {} }, chatRef: {}, chatMessages: [],
    mySeat: 2, selectedCardIdx: 3,
    resetZhangba: () => {},
    aiSummaryReset: () => {},
    aiTestAutopilot: { active: true, seat: 2, roomId: 'roomA', cid: 'cidA' },
    stopAiTestAutopilot: () => { stopCalls += 1; },
    document: { getElementById: id => elements[id] },
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx, { filename: 'backToLobby-old.js' });
  vm.runInContext('backToLobby()', ctx);
  if(stopCalls !== 0)
    throw new Error('旧版backToLobby不应调用stopAiTestAutopilot,如果调用了说明还原文本没有正确剔除修复代码');
  if(ctx.aiTestAutopilot.active !== true)
    throw new Error('旧写法下托管状态应该(错误地)原样残留active=true,如果没有说明上面的断言对这段逻辑没有鉴别力');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败\n');
if (failed > 0) process.exit(1);
