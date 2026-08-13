/**
 * 修复郭嘉【遗计】机器人无法主动发动的bug(yijiAsk此前完全没有在BOT_PHASE_ACTOR/
 * runBotDecision里登记,机器人被botFallbackSeats+botSafePrompt兜底点掉"不发动"按钮),
 * 以及系统性扫描发现的三个同类遗漏(ganglieAsk/guiduAsk/jiangchiAsk)。
 *
 * 覆盖:
 *  - yijiAsk:无密钥模式下机器人应主动调用respondYijiAsk(true),正确推进到yijiAssign。
 *  - ganglieAsk:同一批遗漏,机器人应主动发动(respondGanglieAsk(true))。
 *  - guiduAsk:同一批遗漏,机器人保守默认不发动(cancelGuidu)。
 *  - jiangchiAsk:同一批遗漏,机器人保守默认不发动(respondJiangchi('none'))。
 *  - 每个都补一条"改动前会被botSafePrompt兜底点掉'不发动'"的差分对照(用git stash验证,
 *    这里用回归复核:BOT_PHASE_ACTOR缺失时botSeatForState解析不出行动者)。
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  gameRef: { transaction: function(fn) { return fn(context.g || {}); } },
  firebase: {
    initializeApp: function() { return { database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function(fn) { var cb = fn(function() {}); if (cb) cb(); return {}; }, set: function() {}, update: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; } }; },
    database: function() { return { ref: function() { return { on: function() {}, once: function() {}, push: function() { return { set: function() {}, key: 'mock_key' }; }, transaction: function() { return {}; }, set: function() {}, child: function() { return {}; }, remove: function() {}, get: function() { return { val: function() { return null; } }; } }; } }; }
  },
  document: {
    getElementById: function(id) { return { onclick: function() {}, innerHTML: '', style: {}, className: '', classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } }, appendChild: function() { return {}; }, remove: function() {}, setAttribute: function() {}, getAttribute: function() { return null; }, addEventListener: function() {}, removeEventListener: function() {} }; },
    createElement: function(tag) { return { src: '', href: '', rel: '', type: '', textContent: '', innerHTML: '', onclick: function() {}, onerror: function() {}, onload: function() {}, className: '', id: '', style: {}, setAttribute: function() {}, getAttribute: function() { return null; }, appendChild: function() { return {}; } }; },
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
    localStorage: { getItem: function() { return null; }, setItem: function() {}, removeItem: function() {}, clear: function() {} },
    sessionStorage: { getItem: function() { return null; }, setItem: function() {} },
    addEventListener: function() {}, removeEventListener: function() {},
    setTimeout: function(f, t) { return setTimeout(f, t); }, clearTimeout: function(t) { return clearTimeout(t); },
    setInterval: function(f, t) { return setInterval(f, t); }, clearInterval: function(t) { return clearInterval(t); },
    alert: function() {}, confirm: function() { return true; }, prompt: function() { return null; },
    open: function() { return null; }, close: function() {},
    history: { pushState: function() {}, replaceState: function() {} },
    navigator: { userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', onLine: true }
  },
  joinRoom: function() {},
  mySeat: 0,
  pushLog: function(log, text) { log.push({seq: log.length, text: text}); return log; },
  setTimeout: function(f, t) { return setTimeout(f, t); },
  clearTimeout: function(t) { return clearTimeout(t); },
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.firebase = context.firebase;
context.window.document = context.document;
context.global = context;

const sandbox = vm.createContext(context, { name: 'sgs-yijiask-bot-sandbox' });

console.log('Loading 遗计/刚烈/鬼道/将驰 机器人接线测试环境...\n');

const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('gameRef = { transaction: function(fn) { return fn(typeof _g !== "undefined" ? _g : {}); } }; mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  郭嘉遗计/刚烈/鬼道/将驰 机器人主动发动接线测试');
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

  aiApiKey = ''; aiProvider = null; // 全程无密钥模式

  function mkSeatG(opt){
    opt = opt || {};
    var n = opt.n || 3;
    var players = [];
    for(var i = 0; i < n; i++){
      players.push({
        name: i === 0 ? '机器人0' : ('玩家' + i), alive: true,
        hp: (opt.hpOf && opt.hpOf[i] !== undefined) ? opt.hpOf[i] : 4, maxHp: 4,
        hand: (opt.hands && opt.hands[i]) || [], equips: emptyEquips(), delays: [],
        isBot: i === 0, role: null, general: (opt.generalOf && opt.generalOf[i]) || 'yuJi'
      });
    }
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: opt.deck || [], exchangeCards: [] };
  }

  // ================= 郭嘉【遗计】yijiAsk =================
  await check('BOT_PHASE_ACTOR 已登记 yijiAsk:seat', function(){
    if(stageActorField('yijiAsk') !== 'seat') throw new Error('应登记 yijiAsk:seat,实际 ' + stageActorField('yijiAsk'));
  });

  await check('yijiAsk:无密钥模式下机器人应主动调用respondYijiAsk(true),推进到yijiAssign', async function(){
    var g = mkSeatG({ deck: [{id:'d1',name:'杀',suit:'♠',rank:3},{id:'d2',name:'闪',suit:'♥',rank:5}] });
    _g = g;
    g.phase = 'yijiAsk';
    g.pending = { type: 'yijiAsk', seat: 0, askedAt: Date.now(), resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(g.phase !== 'yijiAssign') throw new Error('应推进到yijiAssign,实际phase=' + g.phase + ' pending=' + JSON.stringify(g.pending));
    if(!g.pending || g.pending.type !== 'yijiAssign') throw new Error('pending应为yijiAssign,实际 ' + JSON.stringify(g.pending));
  });

  await check('yijiAsk:创建时应带askedAt(30秒超时兜底才能生效)', function(){
    var g = mkSeatG({ deck: [{id:'d3',name:'桃',suit:'♥',rank:6}] });
    _g = g;
    var self = g.players[0];
    self.hp = 3;
    GENERALS.guojia.hooks.onDamaged(g, 0, { srcType: 'sha' });
    if(g.pending === null || g.pending.type !== 'yijiAsk') throw new Error('应挂起yijiAsk,实际 ' + JSON.stringify(g.pending));
    if(typeof g.pending.askedAt !== 'number') throw new Error('yijiAsk pending应带askedAt,实际 ' + JSON.stringify(g.pending));
  });

  await check('bot-ai-bus.js autoRespondAction: yijiAsk超时兜底=respondYijiAsk(false)', function(){
    var g = mkSeatG({});
    _g = g;
    g.phase = 'yijiAsk';
    g.pending = { type: 'yijiAsk', seat: 0, askedAt: Date.now() - 1000, resume: { type: 'sha' } };
    var act = autoRespondAction(g);
    if(typeof act !== 'function') throw new Error('autoRespondAction应返回函数,实际 ' + act);
    act();
    if(g.pending !== null) throw new Error('respondYijiAsk(false)后pending应清空,实际 ' + JSON.stringify(g.pending));
  });

  // ================= 系统性扫描发现的遗漏:夏侯惇【刚烈】ganglieAsk =================
  await check('BOT_PHASE_ACTOR 已登记 ganglieAsk:seat', function(){
    if(stageActorField('ganglieAsk') !== 'seat') throw new Error('应登记 ganglieAsk:seat,实际 ' + stageActorField('ganglieAsk'));
  });

  await check('ganglieAsk:无密钥模式下机器人应主动发动(respondGanglieAsk(true))', async function(){
    var g = mkSeatG({ deck: [{id:'jc1',name:'杀',suit:'♥',rank:5}] });
    _g = g;
    g.phase = 'ganglieAsk';
    g.pending = { type: 'ganglieAsk', seat: 0, sourceSeat: 1, askedAt: Date.now(), resume: { type: 'sha' } };
    await runBotDecision(g, 0);
    if(g.phase === 'ganglieAsk') throw new Error('应已推进离开ganglieAsk,实际仍是 ' + g.phase);
  });

  // ================= 系统性扫描发现的遗漏:张角【鬼道】guiduAsk =================
  await check('BOT_PHASE_ACTOR 已登记 guiduAsk:sourceSeat', function(){
    if(stageActorField('guiduAsk') !== 'sourceSeat') throw new Error('应登记 guiduAsk:sourceSeat,实际 ' + stageActorField('guiduAsk'));
  });

  await check('guiduAsk:无密钥模式下机器人保守默认不发动(cancelGuidu)', async function(){
    var g = mkSeatG({ hands: { 0: [{id:'gd1',name:'杀',suit:'♠',rank:3}] } });
    _g = g;
    g.phase = 'guiduAsk';
    g.pending = { type: 'guiduAsk', sourceSeat: 0, judgedSeat: 1, judgeCard: { name:'杀', suit:'♠', rank:5 }, resume: { type:'sha' }, askedSeats: [], askedAt: Date.now() };
    await runBotDecision(g, 0);
    if(g.phase === 'guiduAsk' && g.pending && g.pending.sourceSeat === 0) throw new Error('应已推进(cancelGuidu继续问下一个/收尾),实际原地不动 ' + JSON.stringify(g.pending));
  });

  // ================= 系统性扫描发现的遗漏:曹彰【将驰】jiangchiAsk =================
  await check('BOT_PHASE_ACTOR 已登记 jiangchiAsk:seat', function(){
    if(stageActorField('jiangchiAsk') !== 'seat') throw new Error('应登记 jiangchiAsk:seat,实际 ' + stageActorField('jiangchiAsk'));
  });

  await check('jiangchiAsk:无密钥模式下机器人保守默认不发动(respondJiangchi(none))', async function(){
    var g = mkSeatG({});
    g.players[0].caps = { jiangchi: true };
    _g = g;
    g.phase = 'jiangchiAsk';
    g.pending = { type: 'jiangchiAsk', seat: 0, baseDraw: 2, askedAt: Date.now() };
    await runBotDecision(g, 0);
    if(g.phase !== 'play') throw new Error('respondJiangchi(none)应推进到play阶段(finishDrawPhase内部推进),实际 ' + g.phase);
    if(g.pending !== null) throw new Error('pending应清空,实际 ' + JSON.stringify(g.pending));
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

vm.runInContext(testCode, sandbox);

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})();
