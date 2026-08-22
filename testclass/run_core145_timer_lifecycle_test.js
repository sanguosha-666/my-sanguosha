/**
 * CORE-145(issue #198): 响应超时检测的 1s 定时器改为按需启停。
 *
 * 【最重要的不变量】超时托管本身不能被破坏——一旦出现询问型 pending 就必须能及时
 * 重新启动,否则挂机会永久卡死。测试里对"启动时机"和"单实例"两条都做了正面+反面覆盖。
 *
 * 覆盖:
 *  1. 无 pending → 不启动(改动前会启动并永远转下去)
 *  2. 有询问型 pending → 启动
 *  3. pending 消失 → 停掉,并清理残留倒计时文案
 *  4. 单实例不变量:反复调用不会起多个 interval
 *  5. 停掉后再出现 pending → 能重新启动(超时托管不被破坏)
 *  6. askedAt 未打戳的 pending 不算(与 maybeAutoRespondTimeout 口径一致)
 *  7. tick 里仍会调 maybeAutoRespondTimeout + refreshCountdownSpans
 *  8. 自我停机兜底:currentG 失去 pending 后下一拍自停
 *  9. 提交后不立刻自停(异步 tx 未回,仍需继续兜底)
 * 10. 破坏性验证:断言有鉴别力
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e && e.message) || e); failed++; }
}

function mkEnv(){
  const timers = { created: [], cleared: [], nextId: 1, active: new Map() };
  const spans = [];
  const context = {
    Math, console, Number, String, Array, Object, JSON, Date,
    setInterval(fn, ms){
      const id = timers.nextId++;
      timers.created.push({ id, ms, fn });
      timers.active.set(id, fn);
      return id;
    },
    clearInterval(id){ timers.cleared.push(id); timers.active.delete(id); },
    setTimeout(){ return 0; }, clearTimeout(){},
    document: {
      getElementById(){ return null; },
      querySelectorAll(sel){ return sel === '.resp-countdown' ? spans : []; },
      addEventListener(){}, removeEventListener(){},
      body:{}, createElement(){ return { style:{}, classList:{add(){},remove(){}}, appendChild(){} }; },
      querySelector(){ return null; }
    },
    window: { addEventListener(){}, removeEventListener(){}, matchMedia(){ return { matches:false }; },
      requestAnimationFrame(){ return 1; }, cancelAnimationFrame(){}, innerWidth:1400, innerHeight:900 },
    // 只加载 bot-ai-bus.js,不拉整条依赖链;它引用的跨文件函数按需 stub
    currentG: null,
    RESPONSE_TIMEOUT_MS: 30000
  };
  context.window.document = context.document;
  context.global = context;
  const sandbox = vm.createContext(context);
  // bot-ai-bus.js 里 maybeAutoRespondTimeout 会调 autoRespondAction/pendingResponderSeat 等
  // (定义在 stage-table/game.js),本用例只关心"定时器有没有起/停/tick 里调了谁",
  // 因此把这两个函数换成 spy——它们的真实行为由 run_ai_timeout_test.js 单独覆盖。
  vm.runInContext(fs.readFileSync(path.join(ROOT,'data.js'),'utf8'), sandbox, {filename:'data.js'});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'stages/stage-table.js'),'utf8'), sandbox, {filename:'stage-table.js'});
  vm.runInContext(fs.readFileSync(path.join(ROOT,'bot-ai-bus.js'),'utf8'), sandbox, {filename:'bot-ai-bus.js'});
  vm.runInContext(`
    window.__maybeCalls = 0; window.__refreshCalls = 0;
    maybeAutoRespondTimeout = function(){ window.__maybeCalls++; return false; };
    refreshCountdownSpans = function(){ window.__refreshCalls++; };
  `, sandbox);
  return {
    sandbox, timers, spans,
    get: e => vm.runInContext(e, sandbox),
    run: e => vm.runInContext(e, sandbox),
    setG(g){ vm.runInContext('currentG = ' + JSON.stringify(g), sandbox); },
    tick(){ timers.active.forEach(fn => fn()); }
  };
}
const asking = (extra) => Object.assign({ pending:{ type:'shan', askedAt: Date.now() }, phase:'respond', players:[] }, extra||{});

console.log('\n' + '='.repeat(60));
console.log('  CORE-145:1s 超时检测器按需启停');
console.log('='.repeat(60) + '\n');

check('无 pending → 不启动定时器(改动前会启动并永远转下去)', () => {
  const e = mkEnv();
  e.setG({ phase:'play', pending:null, players:[] });
  e.run('startAutoRespondTimer()');
  if(e.timers.created.length !== 0) throw new Error('不该起定时器,实际起了 ' + e.timers.created.length + ' 个');
  if(e.get('__autoRespondTimerId') !== null) throw new Error('timer id 应为 null');
});

check('currentG 为 null(还没进对局)→ 不启动', () => {
  const e = mkEnv();
  e.run('startAutoRespondTimer()');
  if(e.timers.created.length !== 0) throw new Error('不该起定时器');
});

check('出现询问型 pending → 启动,周期 1000ms', () => {
  const e = mkEnv();
  e.setG(asking());
  e.run('startAutoRespondTimer()');
  if(e.timers.created.length !== 1) throw new Error('应起 1 个定时器,实际 ' + e.timers.created.length);
  if(e.timers.created[0].ms !== 1000) throw new Error('周期应为 1000ms,实际 ' + e.timers.created[0].ms);
});

check('pending 消失 → 停掉定时器', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const id = e.timers.created[0].id;
  e.setG({ phase:'play', pending:null, players:[] });
  e.run('startAutoRespondTimer()');
  if(e.timers.cleared.indexOf(id) < 0) throw new Error('应 clearInterval 掉它');
  if(e.get('__autoRespondTimerId') !== null) throw new Error('timer id 应回到 null');
});

check('停机时清理残留倒计时文案(调 refreshCountdownSpans)', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const before = e.get('window.__refreshCalls');
  e.setG({ phase:'play', pending:null, players:[] });
  e.run('startAutoRespondTimer()');
  if(e.get('window.__refreshCalls') <= before)
    throw new Error('停机时应刷一次倒计时文案,避免"⏱ Ns 后自动…"定格在画面上');
});

check('★单实例不变量:反复调用不会起多个 interval', () => {
  const e = mkEnv();
  e.setG(asking());
  for(let i=0;i<20;i++) e.run('startAutoRespondTimer()');
  if(e.timers.created.length !== 1)
    throw new Error('反复调用应只有 1 个实例,实际 ' + e.timers.created.length + ' 个');
});

check('★停掉后再出现 pending → 能重新启动(超时托管不被破坏)', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  e.setG({ phase:'play', pending:null, players:[] }); e.run('startAutoRespondTimer()');
  if(e.get('__autoRespondTimerId') !== null) throw new Error('前置:应已停');
  e.setG(asking()); e.run('startAutoRespondTimer()');
  if(e.get('__autoRespondTimerId') === null) throw new Error('再次出现询问型 pending 时必须能重新启动');
  if(e.timers.created.length !== 2) throw new Error('应共起过 2 次,实际 ' + e.timers.created.length);
});

check('多轮启停循环后仍只有 1 个活跃实例(不泄漏)', () => {
  const e = mkEnv();
  for(let i=0;i<10;i++){
    e.setG(asking()); e.run('startAutoRespondTimer()');
    e.setG({ phase:'play', pending:null, players:[] }); e.run('startAutoRespondTimer()');
  }
  if(e.timers.active.size !== 0) throw new Error('最终应无活跃定时器,实际 ' + e.timers.active.size);
  if(e.timers.created.length !== e.timers.cleared.length)
    throw new Error('起 ' + e.timers.created.length + ' 次但只清了 ' + e.timers.cleared.length + ' 次(泄漏)');
});

check('askedAt 未打戳的 pending 不算(与 maybeAutoRespondTimeout 口径一致)', () => {
  const e = mkEnv();
  e.setG({ phase:'respond', pending:{ type:'shan' }, players:[] });   // 没有 askedAt
  e.run('startAutoRespondTimer()');
  if(e.timers.created.length !== 0)
    throw new Error('askedAt 不是数字时 maybeAutoRespondTimeout 会直接返回,不该起定时器');
});

check('autoRespondTimerNeeded 的口径:pending 存在且 askedAt 是数字', () => {
  const e = mkEnv();
  e.setG(null);
  if(e.get('autoRespondTimerNeeded()') !== false) throw new Error('currentG=null 应为 false');
  e.setG({ pending:null });
  if(e.get('autoRespondTimerNeeded()') !== false) throw new Error('无 pending 应为 false');
  e.setG({ pending:{ type:'shan' } });
  if(e.get('autoRespondTimerNeeded()') !== false) throw new Error('无 askedAt 应为 false');
  e.setG({ pending:{ type:'shan', askedAt: 123 } });
  if(e.get('autoRespondTimerNeeded()') !== true) throw new Error('有戳应为 true');
});

check('tick 里仍会调 maybeAutoRespondTimeout + refreshCountdownSpans(既有行为)', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const m0 = e.get('window.__maybeCalls'), r0 = e.get('window.__refreshCalls');
  e.tick();
  if(e.get('window.__maybeCalls') !== m0 + 1) throw new Error('每拍应调一次 maybeAutoRespondTimeout');
  if(e.get('window.__refreshCalls') <= r0) throw new Error('每拍应刷一次倒计时');
});

check('自我停机兜底:currentG 失去 pending 后下一拍自停(不依赖 render)', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const id = e.timers.created[0].id;
  e.setG({ phase:'play', pending:null, players:[] });   // 只改状态,不调 startAutoRespondTimer
  e.tick();
  if(e.timers.cleared.indexOf(id) < 0)
    throw new Error('tick 里应自我停机(防本端收不到 render 时永远转下去)');
});

check('★提交后不立刻自停:pending 仍在时继续兜底(tx 是异步的)', () => {
  const e = mkEnv();
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const id = e.timers.created[0].id;
  e.tick();  // 这一拍 maybeAutoRespondTimeout 提交了保守动作,但 currentG 还是旧快照
  if(e.timers.cleared.indexOf(id) >= 0)
    throw new Error('刚提交过就停掉的话,提交失败时就没人继续兜底了');
  if(e.timers.active.size !== 1) throw new Error('应仍在运行');
});

check('破坏性验证:让 autoRespondTimerNeeded 恒 true(=回到永不停止),停机断言确实会红', () => {
  const e = mkEnv();
  e.run('autoRespondTimerNeeded = function(){ return true; };');
  e.setG(asking()); e.run('startAutoRespondTimer()');
  const id = e.timers.created[0].id;
  e.setG({ phase:'play', pending:null, players:[] });
  e.run('startAutoRespondTimer()');
  if(e.timers.cleared.indexOf(id) >= 0)
    throw new Error('恒 true 时不该停,说明停机断言没有鉴别力');
  console.log('       ↳ 恒 true 时定时器确实永不停止(= 改动前行为),停机断言有鉴别力');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if(failed > 0) process.exit(1);
