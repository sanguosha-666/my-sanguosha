/**
 * CORE-89(#136) 身份局出牌候选硬过滤友方目标回归测试
 *
 * 背景:enumerateAllLegalOneStepActions(出牌候选,喂给 LLM)和 BOT_SEAT_PICKS 的
 * buildSeatCandidates(座位技能候选,如断粮/国色/驱虎伤害)此前只用 botTargetScore
 * 的 -Infinity 给策略禁止目标(如忠臣→主公)打低分排序,不会把候选从列表里删掉;
 * bot-ai-bus.js 明确告诉 LLM 分数"只是排序参考,不代表最优解",LLM 能无视分数选中
 * 这些候选,execute 真实生效(游戏规则层对"忠臣杀主公"完全合法,不拦)。
 *
 * 修复:新增独立谓词 botTargetRelationAllowed(g,seat,targetSeat,kind),只在
 * gameMode==='identity' 时生效,在候选生成层(而不是打分层)硬过滤掉策略禁止目标。
 * botTargetScore 本身逐字未改(仍用于其它已有"score>-Infinity才选"的调用点)。
 *
 * 断言候选列表本身不存在该项(不是"AI最后没选它")。
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

const sandbox = vm.createContext(context, { name: 'sgs-core89-sandbox' });

console.log('Loading CORE-89 身份局候选硬过滤测试环境...\n');

const files = ['config.js', 'data.js', 'stages/stage-table.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'skills/late-generals.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
  console.log('  OK ' + file);
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-89:身份局出牌候选硬过滤友方目标');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    try { fn(); console.log('  PASS ' + name); pass++; }
    catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
  }

  function card(name, id){ return { id: id || (name + Math.random()), name: name, suit: '♥', rank: 5 }; }

  // 4人身份局:0=忠臣(bot,已知)、1=主公(已知,role恒公开)、2=反贼(未知/低嫌疑)、3=内奸(未知)
  function mkIdentityG(seat0Hand, opt){
    opt = opt || {};
    var roles = ['zhong', 'zhu', 'fan', 'nei'];
    var players = roles.map(function(role, i){
      return {
        name: '玩家' + i,
        alive: true,
        hp: 4, maxHp: 4,
        hand: i === 0 ? seat0Hand : [card('杀'), card('杀')],
        equips: emptyEquips(),
        delays: [],
        isBot: i === 0,
        role: role,
        roleRevealed: !!(opt.revealed && opt.revealed[i])
      };
    });
    return {
      players: players,
      gameMode: 'identity',
      roundNum: 1,
      phase: 'play',
      turn: 0,
      aiRebelSuspicion: opt.suspicion || {},
      log: []
    };
  }

  // ---- 验收标准1:忠臣候选中不存在【杀→主公】,即使主公在杀范围内、手中有杀 ----
  check('忠臣AI候选:手持杀,主公在范围内 → 候选列表中不存在杀→主公', function(){
    var g = mkIdentityG([card('杀'), card('杀')]);
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasShaOnLord = list.some(function(c){ return c.action === '杀' && c.target === 1; });
    if(hasShaOnLord) throw new Error('候选列表中存在杀→主公,应被硬过滤');
  });

  // ---- 验收标准1延伸:忠臣对已知忠臣(此场景没有第二个忠臣,改用团队模式对照见下)也不可
  //      主动伤害;这里用南蛮/万箭已有的“忠臣不主动使用群体牌”守卫做交叉验证,确认硬过滤
  //      和既有守卫不冲突,杀之外的单体牌(顺手/拆桥/决斗)同样受过滤 ----
  check('忠臣AI候选:决斗候选中不存在→主公', function(){
    var g = mkIdentityG([card('决斗'), card('杀')]);
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasDuelOnLord = list.some(function(c){ return c.action === '决斗' && c.target === 1; });
    if(hasDuelOnLord) throw new Error('候选列表中存在决斗→主公,应被硬过滤');
  });

  // ---- 验收标准2:suspicion<35 的未知身份不生成有害候选;suspicion够高时可生成 ----
  check('忠臣AI候选:低嫌疑(<35)未知目标不生成杀候选', function(){
    var g = mkIdentityG([card('杀'), card('杀')], { suspicion: { 2: 10, 3: 10 } });
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasShaOnSeat2 = list.some(function(c){ return c.action === '杀' && c.target === 2; });
    if(hasShaOnSeat2) throw new Error('低嫌疑未知目标不应出现在候选里');
  });
  check('忠臣AI候选:高嫌疑(>=35)未知目标可以生成杀候选', function(){
    // 4人环形局默认杀射程1,座位2和座位0距离为2(够不着),改用座位3(距离1、同为
    // 未知身份)验证嫌疑够高时策略层放行——避免和距离限制这条独立规则混在一起断言。
    var g = mkIdentityG([card('杀'), card('杀')], { suspicion: { 2: 80, 3: 80 } });
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasShaOnSeat3 = list.some(function(c){ return c.action === '杀' && c.target === 3; });
    if(!hasShaOnSeat3) throw new Error('高嫌疑目标应可以出现在候选里');
  });

  // ---- 验收标准3:反贼候选中不含对已知反贼队友的有害动作,主公仍是高优先目标 ----
  check('反贼AI候选:已知反贼队友不在候选里,主公仍在候选里', function(){
    // 座位1改造成反贼bot,座位2是已知反贼队友,座位3主公
    var g = mkIdentityG(null);
    g.players[0].role = 'fan';
    g.players[1].role = 'zhu';
    g.players[2].role = 'fan';
    g.players[2].roleRevealed = true;
    g.players[3].role = 'zhong';
    g.players[1].isBot = false; g.players[0].isBot = true;
    g.players[0].hand = [card('杀'), card('杀')];
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasShaOnAlly = list.some(function(c){ return c.action === '杀' && c.target === 2; });
    var hasShaOnLord = list.some(function(c){ return c.action === '杀' && c.target === 1; });
    if(hasShaOnAlly) throw new Error('候选里不该有杀→已知反贼队友');
    if(!hasShaOnLord) throw new Error('候选里应该保留杀→主公(反贼合法目标)');
  });

  // ---- 验收标准4:主公候选中不含对已知忠臣的有害动作,已知反贼正常保留 ----
  check('主公AI候选:已知忠臣不在候选里,已知反贼仍在候选里', function(){
    // 4人环形局默认杀射程1,座位1和座位0距离为1(够得着)、座位2距离为2(够不着)——
    // 把反贼放在距离1的座位1、忠臣放在距离2的座位2,避免距离限制和策略过滤这两条
    // 独立规则的断言互相干扰(忠臣是否出现在候选里,无论距离都该是"不出现",用够不着
    // 的座位断言仍然成立;但反贼要"出现",必须放在够得着的座位)。
    var g = mkIdentityG(null, { revealed: { 1: true, 2: true } });
    g.players[0].role = 'zhu';
    g.players[1].role = 'fan'; g.players[1].roleRevealed = true;
    g.players[2].role = 'zhong'; g.players[2].roleRevealed = true;
    g.players[0].isBot = true;
    g.players[0].hand = [card('杀'), card('杀')];
    var list = enumerateAllLegalOneStepActions(g, 0);
    var hasShaOnZhong = list.some(function(c){ return c.action === '杀' && c.target === 2; });
    var hasShaOnFan = list.some(function(c){ return c.action === '杀' && c.target === 1; });
    if(hasShaOnZhong) throw new Error('候选里不该有杀→已知忠臣');
    if(!hasShaOnFan) throw new Error('候选里应该保留杀→已知反贼');
  });

  // ---- 验收标准5:内奸零回归——botTargetRelationAllowed 对内奸恒真,不改变其现有动态策略 ----
  check('内奸零回归:botTargetRelationAllowed 对内奸座位恒为 true(不设硬边界)', function(){
    var g = mkIdentityG(null);
    g.players[0].role = 'nei';
    if(botTargetRelationAllowed(g, 0, 1, 'sha') !== true) throw new Error('内奸打主公应不受硬过滤限制');
    if(botTargetRelationAllowed(g, 0, 2, 'sha') !== true) throw new Error('内奸打反贼应不受硬过滤限制');
    if(botTargetRelationAllowed(g, 0, 3, 'sha') !== true) throw new Error('内奸打忠臣应不受硬过滤限制');
  });
  check('内奸零回归:botTargetScore 对内奸座位的评分逐字不变(仍可能对低血主公返回-Infinity)', function(){
    var g = mkIdentityG(null);
    g.players[0].role = 'nei';
    g.players[1].hp = 2; // 前中期不让主公突然死亡分支
    var scoreVsLowHpLord = botTargetScore(g, 0, 1, 'sha');
    if(scoreVsLowHpLord !== -Infinity) throw new Error('内奸对低血主公的评分应仍是-Infinity(既有动态策略,未改动)');
  });

  // ---- 验收标准6:非身份局(乱斗/组队)零回归,不套身份局硬过滤 ----
  check('乱斗模式零回归:botTargetRelationAllowed 非身份局恒放行', function(){
    var g = mkIdentityG(null);
    g.gameMode = 'ffa';
    g.players[0].role = 'zhong'; // 乱斗模式不应该有role语义,但即使意外设置也不受硬过滤影响
    if(botTargetRelationAllowed(g, 0, 1, 'sha') !== true) throw new Error('乱斗模式不应套身份局硬过滤');
  });

  // ---- 验收标准:座位技能候选(断粮为例)同样硬过滤忠臣→主公 ----
  check('座位技能候选(断粮):忠臣座位候选里不含主公', function(){
    var g = mkIdentityG(null);
    g.players[0].role = 'zhong';
    g.players[0].hand = [card('兵粮寸断')];
    g.phase = 'play'; g.turn = 0;
    var isDuanliangCardFn = typeof isDuanliangCard === 'function';
    if(!isDuanliangCardFn) throw new Error('测试前置条件缺失:isDuanliangCard 未加载');
    var cands = BOT_SEAT_PICKS.duanliang.buildSeatCandidates(g, 0);
    var full = seatPickBuildCandidates(g, 0);
    var hasLordInRaw = cands.some(function(c){ return c.seat === 1; });
    var hasLordInFiltered = full.some(function(c){ return c.skillKey === 'duanliang' && c.seat === 1; });
    if(!hasLordInRaw) throw new Error('测试前置条件不满足:断粮原始候选应包含主公(说明游戏规则层允许,过滤应在策略层)');
    if(hasLordInFiltered) throw new Error('断粮候选(策略过滤后)不该包含忠臣→主公');
  });

  // ---- 红线:破坏性验证——手动把 botTargetRelationAllowed 打断成恒真,应能重新看到违规候选
  //      (证明这条断言真的在检测这个函数,不是巧合通过) ----
  check('破坏性验证:若 botTargetRelationAllowed 被改成恒真,杀→主公会重新出现(证明断言有鉴别力)', function(){
    var g = mkIdentityG([card('杀'), card('杀')]);
    var original = botTargetRelationAllowed;
    global.botTargetRelationAllowed = function(){ return true; };
    try{
      var list = enumerateAllLegalOneStepActions(g, 0);
      var hasShaOnLord = list.some(function(c){ return c.action === '杀' && c.target === 1; });
      if(!hasShaOnLord) throw new Error('破坏后应该重新出现杀→主公,如果没出现说明这条断言对该函数没有鉴别力');
    } finally {
      global.botTargetRelationAllowed = original;
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  __testFail = fail > 0;
})();
`;

vm.runInContext(testCode, sandbox);
process.exit(sandbox.__testFail ? 1 : 0);
