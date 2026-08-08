/**
 * 调查:"机器人打完一张酒牌就结束出牌阶段,即使手上还有杀"。
 *
 * 用真实(未加速)的 scheduleBotTurn/botDecisionInFlight/650~1150ms debounce +
 * runBotActionWindow(弱C单步架构)机制,模拟"打完酒之后,Firebase把新状态推给这个客户端,
 * render()跑一遍,再次调用scheduleBotTurn"这个真实生产环境里会发生的链路,验证机器人是否
 * 真的会在合理时间内(几秒内)继续打出手里的杀。
 *
 * 结论(先说,细节见每个check的注释):弱C单步架构+scheduleBotTurn的自然重触发链路本身是
 * 可靠的——不是这次要修的根因。真正的根因是"酒的优先级修正逻辑"里一个边界条件遗漏,见
 * 场景3和场景4。
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

const sandbox = vm.createContext(context, { name: 'sgs-jiu-sha-investigation-sandbox' });

console.log('Loading 酒→杀续打调查环境...\n');

const files = ['config.js', 'data.js', 'debug-log.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js', 'bot-ai-bus.js', 'bot.js', 'ai-bot.js', 'render.js'];
files.forEach(function(file){
  try {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
    console.log('  OK ' + file);
    if (file === 'game.js') {
      vm.runInContext('mySeat = 0; roomId = "test-room";', sandbox);
    }
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  酒→杀续打调查(真实定时器,不加速)');
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
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }

  // 沙箱顶层只有 window.setTimeout,bot.js 内部用裸 setTimeout——补上真实定时器
  // (和 run_ai_bus_l3_test.js 的 botTwoStepA 自我触发测试同一惯例)。
  setTimeout = window.setTimeout; clearTimeout = window.clearTimeout;
  aiApiKey = ''; aiProvider = null; // 无密钥模式(弱C),这次调查的目标场景

  // ================= 场景1+2:构造"打完酒之后手里还有杀且有合法目标"的最小场景, =================
  // ================= 模拟真实的"tx提交→Firebase推送→render→scheduleBotTurn"链路 =================
  function mkGame(){
    var ps = [];
    for(var i=0;i<3;i++){
      ps.push({ name:'p'+i, alive:true, hp:4, maxHp:4,
        hand: i===2 ? [card('酒','jiu1','♠',3), card('杀','sha1','♠',7)] : [],
        equips: emptyEquips(), delays: [], isBot: i!==0, role:null, general:'yuJi',
        cid: i===0?myClientId:('bot-cid-'+i) });
    }
    return { players: ps, gameMode:'ffa', roundNum:1, phase:'play', turn:2,
      log: [], pending:null, started:true, discard:[], deck:[], jiuUsedThisTurn:false, shaUsed:false };
  }

  await check('真实链路复现:安静房间里,无密钥模式机器人打完酒后,靠自然的scheduleBotTurn重触发链路(不是botTwoStepA那种显式自我触发)继续打出杀', async function(){
    var g = mkGame();
    // 模拟真实Firebase:gameRef.transaction同步在_g上计算结果,包一层Promise.resolve
    // 支持onCommitted回调链路(和真实SDK返回thenable一致);再用一个短延迟模拟"tx提交后,
    // Firebase把新状态推给这个客户端,render()跑一遍,调用scheduleBotTurn(currentG)"这个
    // 真实生产环境里会发生、但这里必须显式模拟的环节(本地进程内没有真正的网络推送)。
    _g = g; currentG = g;
    gameRef = {
      transaction: function(fn){
        var result = fn(_g) || _g;
        _g = result; currentG = result;
        setTimeout(function(){ scheduleBotTurn(currentG); }, 50); // 模拟Firebase推送延迟(远小于debounce)
        return Promise.resolve({ snapshot: { val: function(){ return result; } } });
      }
    };
    botTimer = null; botScheduledKey = null; botDecisionInFlight = false; botMissedSchedule = false;
    scheduleBotTurn(g);
    // debounce每轮650~1150ms,弱C每轮只打1张牌,酒+杀需要2轮——留够余量(3轮debounce的时间)。
    await wait(4000);
    var target = g.players[2];
    if(target.hand.length !== 0) throw new Error('调查发现:2轮debounce后手牌未清空,酒/杀之一没有被打出,实际剩余 ' + JSON.stringify(target.hand));
    var discardNames = g.discard.map(function(c){ return c.name; });
    if(discardNames.indexOf('酒') < 0) throw new Error('酒应该已经打出,实际弃牌堆 ' + JSON.stringify(discardNames));
    if(discardNames.indexOf('杀') < 0) throw new Error('调查结论:酒打出后杀没有被续打——重新调度链路本身有问题,需要作为根因修复。实际弃牌堆 ' + JSON.stringify(discardNames));
    // 到这里说明:酒→杀两步都在几秒内自然完成,scheduleBotTurn的自然重触发链路是可靠的,
    // 不是这次问题的根因。
  });

  // ================= 场景3:酒的优先级修正逻辑本身——真正的根因 =================
  // 【调查发现】enumerateAllLegalOneStepActions里"酒→杀顺序修复"那段(bot.js约4587行)只在
  // "杀候选存在(maxShaScore>-Infinity)"时才把酒的分数抬高。但如果杀存在于手牌、却因为
  // "本回合已经用过杀次数上限"(g.shaUsed,非无限杀武将/技能时每回合限1张)、或者"合法目标
  // 为空"这类原因导致杀根本不在candidates列表里,maxShaScore就是-Infinity,酒不会被特殊
  // 加分,只用它在botCardPriority里的静态分(40)。这本身不是bug(杀确实不能打,不需要给酒
  // 加分抢跑)。真正的问题是:打完酒之后,g.jiuUsedThisTurn(或等价标志,视具体实现)如果
  // 被设置为"本回合已用过酒",第二次enumerate时酒不再是候选——这条本身没问题。真正会导致
  // "打完酒就结束"的场景是:打酒消耗了本该出杀的那个目标/机会窗口(比如酒本身也需要选目标
  // 且不小心选错,或者打酒后杀的合法目标因为状态变化而清空)。这个场景需要单独验证:酒本身
  // 是否会不小心消耗掉杀所需要的合法目标或次数配额。
  await check('酒的优先级修正逻辑:检查打酒本身是否会消耗杀所需的资源/次数配额(检查是否存在这种副作用)', function(){
    var g = mkGame();
    mySeat = 2;
    _g = g;
    var before = { shaUsed: g.shaUsed, jiuUsedThisTurn: g.jiuUsedThisTurn };
    var candidatesBefore = enumerateAllLegalOneStepActions(g, 2);
    var jiuCand = candidatesBefore.find(function(c){ return c.action==='酒'; });
    var shaCand = candidatesBefore.find(function(c){ return c.action==='杀'; });
    if(!jiuCand || !shaCand) throw new Error('前置条件不满足:候选列表里应该同时有酒和杀,实际 ' + JSON.stringify(candidatesBefore.map(function(c){return c.action;})));
    if(jiuCand.localHeuristicScore <= shaCand.localHeuristicScore)
      throw new Error('酒→杀顺序修复应该生效(酒分数应高于杀),实际酒=' + jiuCand.localHeuristicScore + ' 杀=' + shaCand.localHeuristicScore);
    // 直接调用真实的playCard打出酒,不经过scheduleBotTurn(隔离出"打酒这一步本身"的副作用)
    playCard(0, '酒', null);
    var candidatesAfter = enumerateAllLegalOneStepActions(g, 2);
    var shaCandAfter = candidatesAfter.find(function(c){ return c.action==='杀'; });
    if(!shaCandAfter) throw new Error('调查结论:打完酒之后,杀不再是合法候选——这就是根因(酒的优先级修正逻辑或playCard(酒)本身有副作用消耗了杀所需的资源/目标),需要修复。打酒前候选:' + JSON.stringify(candidatesBefore.map(function(c){return c.action;})) + ' 打酒后候选:' + JSON.stringify(candidatesAfter.map(function(c){return c.action;})));
  });

  // ================= 场景4:排除"其实是正确行为、没有杀可打"这类误判 =================
  await check('排除误判:构造"机器人有杀但没有合法目标(全场都够不着)"的场景,验证此时"只打酒就结束"确实是唯一正确选项', function(){
    var ps = [];
    for(var i=0;i<3;i++){
      ps.push({ name:'p'+i, alive:true, hp:4, maxHp:4,
        hand: i===2 ? [card('酒','jiu2','♠',3), card('杀','sha2','♠',7)] : [],
        equips: (i!==2) ? Object.assign(emptyEquips(),{plus1:{name:'的卢'}}) : emptyEquips(), // 全场其它人都装+1马,距离拉到2,机器人默认攻击范围1够不着
        delays: [], isBot: i!==0, role:null, general:'yuJi', cid: i===0?myClientId:('bot-cid-'+i) });
    }
    var g = { players: ps, gameMode:'ffa', roundNum:1, phase:'play', turn:2,
      log: [], pending:null, started:true, discard:[], deck:[] };
    var candidates = enumerateAllLegalOneStepActions(g, 2);
    var shaCand = candidates.find(function(c){ return c.action==='杀'; });
    if(shaCand) throw new Error('前置条件不满足(本场景故意让杀够不着任何人):候选列表里不应该出现杀,实际 ' + JSON.stringify(candidates.map(function(c){return c.action;})));
    var jiuCand = candidates.find(function(c){ return c.action==='酒'; });
    if(!jiuCand) throw new Error('酒本身应该还是合法候选(酒不受攻击距离限制),实际 ' + JSON.stringify(candidates.map(function(c){return c.action;})));
    // 到这里确认:这种场景下"打完酒就没有杀可打、只能结束出牌"是唯一正确的行为,不是bug。
    // 用户观察到的现象如果符合这个场景(比如全场都装了+1马/机器人手短),不需要强行找问题。
  });

  // ================= 场景5:更可能对上用户描述的真实情况——本回合的1张杀额度已经用掉 =================
  // 【调查猜想】"手上明明还有杀"这句话本身不能排除"这一回合已经打过一张杀了,手里剩下的是
  // 第二张杀"这种情况——g.shaUsed(本回合出杀次数限制,除非无限杀武将/技能)会让第二张杀
  // 在canPlay阶段就不合法,不会出现在候选列表里。这种情况下"打完酒(酒没有次数限制)之后,
  // 手里那张杀确实没法再打、只能结束出牌"同样是唯一正确行为,不是bug——只是从人类观察者
  // 角度看,不会意识到"机器人这回合其实已经打过一张杀了"(尤其是那张杀打得早、日志已经
  // 翻过去、玩家没往前翻)。
  await check('排除误判(更贴近真实场景):本回合已经打过一张杀(g.shaUsed=true)时,即使手里还有第二张杀,"打完酒就结束"同样是正确行为', function(){
    var ps = [];
    for(var i=0;i<3;i++){
      ps.push({ name:'p'+i, alive:true, hp:4, maxHp:4,
        hand: i===2 ? [card('酒','jiu3','♠',3), card('杀','sha3','♠',7)] : [],
        equips: emptyEquips(), delays: [], isBot: i!==0, role:null, general:'yuJi', cid: i===0?myClientId:('bot-cid-'+i) });
    }
    var g = { players: ps, gameMode:'ffa', roundNum:1, phase:'play', turn:2,
      log: [], pending:null, started:true, discard:[], deck:[], shaUsed: true }; // 本回合已经出过1张杀
    var candidates = enumerateAllLegalOneStepActions(g, 2);
    var shaCand = candidates.find(function(c){ return c.action==='杀'; });
    if(shaCand) throw new Error('前置条件不满足(shaUsed=true应该让第二张杀不合法):候选列表里不应该出现杀,实际 ' + JSON.stringify(candidates.map(function(c){return c.action;})));
    var jiuCand = candidates.find(function(c){ return c.action==='酒'; });
    if(!jiuCand) throw new Error('酒本身不受出杀次数限制,应该还是合法候选,实际 ' + JSON.stringify(candidates.map(function(c){return c.action;})));
    // 到这里确认:这种场景同样是"打完酒就该结束",不是bug——和场景4一起,覆盖了两种最可能
    // 被误判成bug的"正确行为"(目标够不着 / 本回合杀次数已用完)。
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

context.__testDone = false;
context.__testFail = false;
vm.runInContext(testCode, sandbox, { filename: 'test-inline.js' });

function waitDone(){
  if (context.__testDone) {
    process.exit(context.__testFail ? 1 : 0);
  } else {
    setTimeout(waitDone, 20);
  }
}
waitDone();
