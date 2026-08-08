/**
 * E类抽样复核(commit 9334e76 B类修复之后的追加审计):抽取16条E类名单里"有明显下行
 * 风险/多种选择差异较大"的技能,逐条验证它们是否真的有专属的runBotDecision分支在起
 * 作用(spy respond*函数直接被调),而不是像B类那样偷偷依赖botSafePrompt的safe/
 * mandatory正则侥幸命中——这次不是DOM渲染层面的验证(这16条的runBotDecision分支本身
 * 就是纯JS的g.phase/pending.type/actor匹配,不依赖DOM渲染,所以verifying"分支真的
 * 会触发"比B类当年那种"要不要靠DOM渲染出的按钮文本"更直接:只要spy到的函数被调用、
 * 且调用参数符合分支里写的判断逻辑,就证明这条分支是真实生效的专属代码,不是巧合)。
 *
 * 结论(见文档 docs/bot-skill-coverage-audit.md 新增小节):抽样的16条全部通过——
 * 每一条都能在runBotDecision里找到对应respond*函数的真实、有理由的专属分支,没有
 * 发现"看起来E类、实际靠正则侥幸命中"的情况。
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

const sandbox = vm.createContext(context, { name: 'sgs-eclass-sample-audit-sandbox' });

console.log('Loading E类抽样复核测试环境...\n');

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
console.log('  E类抽样复核(16条,确认专属分支真实生效,不依赖botSafePrompt正则侥幸)');
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

  aiApiKey = ''; aiProvider = null;
  db = { ref: function(){ return { set: function(){ return Promise.resolve(); } }; } };

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
    return { players: players, gameMode: 'ffa', roundNum: 1, phase: 'play', turn: 0, log: [], pending: null, aoe: null, started: true, discard: [], deck: [], exchangeCards: [] };
  }
  function card(name, id, suit, rank){ return { id: id || (name + ''), name: name, suit: suit || '♥', rank: rank || 5 }; }
  function spyOn(name){
    var real = eval(name);
    var calls = [];
    eval(name + ' = function(){ calls.push(Array.prototype.slice.call(arguments)); return real.apply(null, arguments); };');
    return { calls: calls, restore: function(){ eval(name + ' = real;'); } };
  }

  // 1. beigeDiscard:手牌非空时应弃手牌第0张(beigeDiscard(0,false,null))
  await check('beigeDiscard:走专属分支beigeDiscard(0,false,null),不是botSafePrompt兜底', async function(){
    var g = mkSeatG({ hands: { 0: [card('杀')] } });
    g.phase = 'beigeDiscard'; g.pending = { type: 'beigeDiscard', sourceSeat: 0, damagedSeat: 1, damageSource: null };
    _g = g;
    var sp = spyOn('beigeDiscard');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 0) throw new Error('应调beigeDiscard(0,...),实际 ' + JSON.stringify(sp.calls));
  });

  // 2. duanbingChoose:应按botTargetScore排序选目标,调用triggerDuanbing
  await check('duanbingChoose:走专属分支triggerDuanbing,按botTargetScore排序选目标', async function(){
    var g = mkSeatG({ n: 3 });
    g.phase = 'duanbingChoose'; g.pending = { type: 'duanbingChoose', sourceSeat: 0, baseTarget: 1, availableTargets: [1, 2] };
    _g = g;
    var sp = spyOn('triggerDuanbing');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1) throw new Error('应调triggerDuanbing恰1次,实际 ' + sp.calls.length);
  });

  // 3. ganglieChoice:决策已进BOT_DECISIONS.ganglieChoice(手牌够2张弃牌否则受伤)
  await check('ganglieChoice:BOT_DECISIONS.ganglieChoice真实注册,手牌够2张时应respondGanglieChoice(discard,...)', async function(){
    var g = mkSeatG({ hands: { 0: [card('杀'), card('闪')] } });
    g.phase = 'ganglieChoice'; g.pending = { type: 'ganglieChoice', seat: 1, sourceSeat: 0, resume: { type: 'sha' } };
    _g = g;
    var sp = spyOn('respondGanglieChoice');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'discard') throw new Error('手牌够2张应选discard,实际 ' + JSON.stringify(sp.calls));
  });

  // 4. guanshi:固定发动respondGuanshi,优先手牌
  await check('guanshi:走专属分支respondGuanshi,手牌优先选2项', async function(){
    var g = mkSeatG({ hands: { 0: [card('杀'), card('闪')] } });
    g.phase = 'guanshi'; g.pending = { type: 'guanshi', from: 0, to: 1 };
    _g = g;
    var sp = spyOn('respondGuanshi');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || !sp.calls[0][0] || sp.calls[0][0].length !== 2) throw new Error('应调respondGuanshi(2项),实际 ' + JSON.stringify(sp.calls));
  });

  // 5. hanbing:目标手牌非空时选'hand'
  await check('hanbing:走专属分支hanbingPick,目标手牌非空时选hand', async function(){
    var g = mkSeatG({ n: 3, hands: { 1: [card('杀')] } });
    g.phase = 'hanbing'; g.pending = { type: 'hanbing', from: 0, to: 1, round: 1 };
    _g = g;
    var sp = spyOn('hanbingPick');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'hand') throw new Error('应调hanbingPick(hand),实际 ' + JSON.stringify(sp.calls));
  });

  // 6. huogongReveal:固定亮第0张
  await check('huogongReveal:走专属分支respondHuogongReveal(0)', async function(){
    var g = mkSeatG({ hands: { 0: [card('杀')] } });
    g.phase = 'huogongReveal'; g.pending = { type: 'huogongReveal', from: 1, to: 0 };
    _g = g;
    var sp = spyOn('respondHuogongReveal');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 0) throw new Error('应调respondHuogongReveal(0),实际 ' + JSON.stringify(sp.calls));
  });

  // 7. jujianChooseEffect:体力未满选recover
  await check('jujianChooseEffect:走专属分支respondJujianEffect,体力未满时选recover', async function(){
    var g = mkSeatG({ hpOf: { 0: 2 } });
    g.phase = 'jujianChooseEffect'; g.pending = { type: 'jujianChooseEffect', sourceSeat: 1, targetSeat: 0, endingSeat: 1 };
    _g = g;
    var sp = spyOn('respondJujianEffect');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'recover') throw new Error('应调respondJujianEffect(recover),实际 ' + JSON.stringify(sp.calls));
  });

  // 8. jujianPickTarget:固定选候选第一个
  await check('jujianPickTarget:走专属分支respondJujianPickTarget,固定选候选第一个', async function(){
    var g = mkSeatG({});
    g.phase = 'jujianPickTarget'; g.pending = { type: 'jujianPickTarget', sourceSeat: 0, candidates: [1, 2], endingSeat: 0, cardIdx: 0, cardId: 'jj1' };
    g.players[0].hand = [card('杀', 'jj1')];
    _g = g;
    var sp = spyOn('respondJujianPickTarget');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 1) throw new Error('应调respondJujianPickTarget(1),实际 ' + JSON.stringify(sp.calls));
  });

  // 9. mengjin:固定选available第0项
  await check('mengjin:走专属分支mengjinPick,固定选available第0项', async function(){
    var g = mkSeatG({});
    g.phase = 'mengjin'; g.pending = { type: 'mengjin', from: 0, to: 1, available: ['a', 'b'] };
    _g = g;
    var sp = spyOn('mengjinPick');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'a') throw new Error('应调mengjinPick(a),实际 ' + JSON.stringify(sp.calls));
  });

  // 10. qiaomengPickEquip:固定选availableSlots第0项
  await check('qiaomengPickEquip:走专属分支pickQiaomengEquip,固定选第0个槽', async function(){
    var g = mkSeatG({});
    g.phase = 'qiaomengPickEquip'; g.pending = { type: 'qiaomengPickEquip', sourceSeat: 0, targetSeat: 1, availableSlots: ['weapon', 'armor'] };
    _g = g;
    var sp = spyOn('pickQiaomengEquip');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'weapon') throw new Error('应调pickQiaomengEquip(weapon),实际 ' + JSON.stringify(sp.calls));
  });

  // 11. renxinChoose:保守默认不发动(cancelRenxin)
  await check('renxinChoose:走专属分支cancelRenxin,保守默认不发动', async function(){
    var g = mkSeatG({});
    g.phase = 'renxinChoose'; g.pending = { type: 'renxinChoose', seat: 0, target: 1 };
    _g = g;
    var sp = spyOn('cancelRenxin');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1) throw new Error('应调cancelRenxin,实际 ' + sp.calls.length);
  });

  // 12. shaOffsetChoice:固定选available第0项
  await check('shaOffsetChoice:走专属分支respondShaOffsetChoice,固定选available第0项', async function(){
    var g = mkSeatG({});
    g.phase = 'shaOffsetChoice'; g.pending = { type: 'shaOffsetChoice', from: 0, to: 1, available: ['mengjin', 'qinglong'] };
    _g = g;
    var sp = spyOn('respondShaOffsetChoice');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'mengjin') throw new Error('应调respondShaOffsetChoice(mengjin),实际 ' + JSON.stringify(sp.calls));
  });

  // 13. yaowu_choose:体力未满选recover
  await check('yaowu_choose:走专属分支respondYaowu,体力未满时选recover', async function(){
    var g = mkSeatG({ hpOf: { 0: 2 } });
    g.phase = 'yaowu_choose'; g.pending = { type: 'yaowu_choose', seat: 0, target: 1 };
    _g = g;
    var sp = spyOn('respondYaowu');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'recover') throw new Error('应调respondYaowu(recover),实际 ' + JSON.stringify(sp.calls));
  });

  // 14. zhimengPick:防御性收录,固定选options第0项
  await check('zhimengPick:走专属分支respondZhimengPick,固定选options第0项', async function(){
    var g = mkSeatG({});
    g.phase = 'zhimengPick'; g.pending = { type: 'zhimengPick', from: 0, options: [{ type: 'hand', index: 0 }] };
    _g = g;
    var sp = spyOn('respondZhimengPick');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 'hand') throw new Error('应调respondZhimengPick(hand,0),实际 ' + JSON.stringify(sp.calls));
  });

  // 15. chengxiangAsk(chengxiangChoose,phase仍是chengxiangAsk):固定选sum最大的组合
  await check('chengxiangChoose:走专属分支confirmChengxiang,固定选sum最大组合', async function(){
    var g = mkSeatG({});
    g.phase = 'chengxiangAsk'; g.pending = { type: 'chengxiangChoose', seat: 0, revealedCards: [card('杀','c0'),card('闪','c1'),card('桃','c2'),card('酒','c3')], selectable: [{ indices: [0], sum: 3 }, { indices: [1, 2], sum: 9 }], sumLimit: 13 };
    _g = g;
    var sp = spyOn('confirmChengxiang');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0].sum !== 9) throw new Error('应选sum=9的组合,实际 ' + JSON.stringify(sp.calls));
  });

  // 16. haoshiPick:固定选候选第一个
  await check('haoshiPick:走专属分支respondHaoshi,固定选候选第一个', async function(){
    var g = mkSeatG({});
    g.phase = 'haoshiPick'; g.pending = { type: 'haoshiPick', seat: 0, half: 2, candidates: [1, 2] };
    _g = g;
    var sp = spyOn('respondHaoshi');
    await runBotDecision(g, 0);
    sp.restore();
    if(sp.calls.length !== 1 || sp.calls[0][0] !== 1) throw new Error('应调respondHaoshi(1),实际 ' + JSON.stringify(sp.calls));
  });

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败(共抽样16条)');
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
