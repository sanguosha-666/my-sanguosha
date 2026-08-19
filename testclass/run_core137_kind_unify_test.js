/**
 * CORE-137: botTargetScore 的 kind 参数口径统一
 *
 * 缺陷:kind 存在两种互不相通的口径——一类调用点传 'damage'/'steal'/'duel' 语义标签,
 * 另一类(enumerateAllLegalOneStepActions 3处 + botTryStartExtraSkills)直接透传中文
 * 牌名。导致 `if(kind==='steal')` 在后一类调用点从未生效,顺手牵羊/过河拆桥在出牌
 * 候选枚举里一直少算了「手牌越多越值得拆」的 ×4 加成。
 *
 * 覆盖:
 *  1. 修复验证:牌名口径与语义口径给出**完全相同**的分数(不再有 20 分差异)
 *  2. botNormalizeTargetKind 的完整映射表
 *  3. botPredictKind 与 botNormalizeTargetKind 的职责分离(steal 是合法类别但不适用预测)
 *  4. 不适用的牌仍然一分不加(不能矫枉过正)
 *  5. 阵营硬边界 -Infinity 仍然穿透
 *  6. 端到端:enumerateAllLegalOneStepActions 里顺手/拆桥的候选分数确实上升了 4n
 *  7. 破坏性验证:还原成 `kind==='steal'` 的旧写法,断言确实会红
 */

const vm = require('vm');
const fs = require('fs');

const context = {
  console: console, Math: Math,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: setInterval, clearInterval: clearInterval,
  mySeat: 0, myClientId: 'test-client',
  distance: function(){ return 1; },
  attackRange: function(){ return 1; },
  nextAlive: function(g, from){ return ((from||0)+1) % ((g.players||[]).length||1); },
  getLordSeat: function(g){ var r=-1; (g.players||[]).forEach(function(p,i){ if(p&&p.role==='zhu') r=i; }); return r; },
  sameTeam: function(g,a,b){ return g.players[a] && g.players[b] && g.players[a].team===g.players[b].team; },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k]!==undefined?this._d[k]:null; },
    setItem: function(k,v){ this._d[k]=String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  document: {
    getElementById: function(){ return { textContent:'', className:'', style:{},
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      addEventListener:function(){}, appendChild:function(){return {};}, remove:function(){},
      insertAdjacentHTML:function(){}, querySelector:function(){return null;} }; },
    createElement: function(){ return { textContent:'', className:'', style:{},
      classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false;}},
      addEventListener:function(){}, appendChild:function(){return {};}, setAttribute:function(){} }; },
    addEventListener: function(){}, body:{ appendChild:function(){return {};} },
    querySelector: function(){ return null; }, querySelectorAll: function(){ return []; }
  },
  window: { aiConversations:{}, addEventListener:function(){}, location:{search:'',href:'http://localhost',reload:function(){}} },
  // CARD_PLAYS 定义在 game.js(未加载进本沙箱——拉进来会牵出整条依赖链)。端到端用例
  // 只需要 enumerateAllLegalOneStepActions 能枚举出「顺手牵羊→某座位」这一条候选,
  // 给一个最小 stub 即可:字段取自 game.js 里 CARD_PLAYS['顺手牵羊'] 的真实形状
  // (canPlay/target/canTarget)。canTarget 恒真是刻意的——真实实现限制距离≤1,而本用例
  // 的两个座位距离恒为 1(distance stub),等价;本用例验的是**评分**,不替距离规则背书。
  CARD_PLAYS: {
    '顺手牵羊': { canPlay: function(){ return true; }, target: true, canTarget: function(){ return true; } }
  }
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core137-sandbox' });

console.log('Loading CORE-137 测试环境...\n');
['data.js', 'stages/stage-table.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'].forEach(function(file){
  try {
    vm.runInContext(fs.readFileSync(file,'utf8'), sandbox, { filename: file });
    console.log('  OK ' + file);
  } catch (e) {
    console.log('  FAIL ' + file + ': ' + e.message);
    if(e.stack) console.log('     ' + e.stack.split('\n').slice(1,3).join('\n     '));
    process.exit(1);
  }
});

console.log('\n' + '='.repeat(60));
console.log('  CORE-137:botTargetScore 的 kind 参数口径统一');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    try { fn(); console.log('  PASS ' + name); pass++; }
    catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
  }

  // 身份局「忠臣看已知反贼」:走确定性分支(+180),避开中性分支的 Math.random()*10,
  // 分数可以精确比对。这正是发现该缺陷时用的那套确定性测量方法。
  function mkG(handCount){
    return {
      gameMode:'identity', phase:'play', turn:0, roundNum:3, pending:null,
      deck:[], aiSuspicionEvents:[], aiRebelSuspicion:{}, log:[],
      players:[
        { name:'我', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'zhong', roleRevealed:false },
        { name:'敌', alive:true, hp:4, maxHp:4,
          hand: Array.from({length: handCount}, function(){ return { name:'x', suit:'♠', rank:2 }; }),
          equips:{}, delays:[], role:'fan', roleRevealed:true }
      ]
    };
  }
  function scoreOf(kind, handCount){ return botTargetScore(mkG(handCount), 0, 1, kind); }
  function diffOf(kind){ return scoreOf(kind, 5) - scoreOf(kind, 0); }

  // ---------- 1. 修复验证:两种口径分数完全相同 ----------
  check('【修复】顺手牵羊 的分数与 steal 口径完全一致(绝对值,不只是分差)', function(){
    [0,1,3,5,8].forEach(function(n){
      var a = scoreOf('steal', n), b = scoreOf('顺手牵羊', n);
      if(a !== b) throw new Error('n='+n+' 时 steal='+a.toFixed(1)+' 但 顺手牵羊='+b.toFixed(1));
    });
  });

  check('【修复】过河拆桥 的分数与 steal 口径完全一致', function(){
    [0,1,3,5,8].forEach(function(n){
      var a = scoreOf('steal', n), b = scoreOf('过河拆桥', n);
      if(a !== b) throw new Error('n='+n+' 时 steal='+a.toFixed(1)+' 但 过河拆桥='+b.toFixed(1));
    });
  });

  check('【修复】5张 vs 0张的分差:三种口径都是 30.0(= 基础分10 + steal加成20)', function(){
    ['steal','顺手牵羊','过河拆桥'].forEach(function(k){
      var d = diffOf(k);
      if(Math.abs(d - 30) > 1e-9) throw new Error('kind='+k+' 分差应为 30.0,实际 ' + d.toFixed(1));
    });
  });

  check('【修复前的缺陷已消失】牌名口径与语义口径之间不再有 20 分差异', function(){
    var gap = diffOf('steal') - diffOf('顺手牵羊');
    if(Math.abs(gap) > 1e-9) throw new Error('两种口径的分差差异应为 0,实际 ' + gap.toFixed(1));
  });

  // ---------- 2. 归一化映射表 ----------
  check('botNormalizeTargetKind:语义标签原样透传', function(){
    ['damage','duel','steal'].forEach(function(k){
      if(botNormalizeTargetKind(k) !== k) throw new Error(k + ' 应原样返回');
    });
  });

  check('botNormalizeTargetKind:中文牌名 → 语义标签', function(){
    var map = { '杀':'damage', '火杀':'damage', '雷杀':'damage', '决斗':'duel',
                '顺手牵羊':'steal', '过河拆桥':'steal' };
    Object.keys(map).forEach(function(k){
      if(botNormalizeTargetKind(k) !== map[k])
        throw new Error(k + ' 应归一成 ' + map[k] + ',实际 ' + botNormalizeTargetKind(k));
    });
  });

  check('botNormalizeTargetKind:未建模的 kind 一律 null(不套任何 kind 修正)', function(){
    ['铁索连环','乐不思蜀','兵粮寸断','火攻','借刀杀人','南蛮入侵','万箭齐发','桃',
     'sha','unknown',null,undefined,'',0,{}].forEach(function(k){
      if(botNormalizeTargetKind(k) !== null)
        throw new Error(JSON.stringify(k) + ' 应返回 null,实际 ' + botNormalizeTargetKind(k));
    });
  });

  // ---------- 3. 两个函数的职责分离 ----------
  check('职责分离:steal 是合法语义类别,但不适用概率预测', function(){
    if(botNormalizeTargetKind('steal') !== 'steal') throw new Error('归一化应认 steal');
    if(botPredictKind('steal') !== null) throw new Error('预测项不该套用到 steal(拆牌不会被闪掉)');
    if(botNormalizeTargetKind('顺手牵羊') !== 'steal') throw new Error('归一化应把顺手牵羊认成 steal');
    if(botPredictKind('顺手牵羊') !== null) throw new Error('顺手牵羊不该套预测项');
  });

  check('职责分离:damage/duel 两者都认', function(){
    if(botPredictKind('杀') !== 'damage' || botNormalizeTargetKind('杀') !== 'damage') throw new Error('杀');
    if(botPredictKind('决斗') !== 'duel' || botNormalizeTargetKind('决斗') !== 'duel') throw new Error('决斗');
  });

  // ---------- 4. 不能矫枉过正 ----------
  check('未建模的牌仍然一分不加(分差恰为基础分 10,没有被误加 steal 或预测项)', function(){
    ['铁索连环','乐不思蜀','兵粮寸断','火攻','借刀杀人'].forEach(function(k){
      var d = diffOf(k);
      if(Math.abs(d - 10) > 1e-9)
        throw new Error('kind='+k+' 分差应恰为 10(纯基础分),实际 ' + d.toFixed(1));
    });
  });

  check('damage/duel 口径不受本次改动影响(仍是 CORE-135 的行为)', function(){
    // 5张手牌 vs 0张:基础分 +10,预测项 -(dodge(5)-dodge(0))*W
    var expected = 10 - (BOT_DODGE_TABLE[5]-BOT_DODGE_TABLE[0]) * BOT_PREDICT_WEIGHT;
    ['damage','杀','火杀','雷杀'].forEach(function(k){
      if(Math.abs(diffOf(k) - expected) > 1e-9)
        throw new Error('kind='+k+' 分差应为 '+expected.toFixed(2)+',实际 ' + diffOf(k).toFixed(2));
    });
    var expectedDuel = 10 - (BOT_SLASH_TABLE[5]-BOT_SLASH_TABLE[0]) * BOT_PREDICT_WEIGHT;
    ['duel','决斗'].forEach(function(k){
      if(Math.abs(diffOf(k) - expectedDuel) > 1e-9)
        throw new Error('kind='+k+' 分差应为 '+expectedDuel.toFixed(2)+',实际 ' + diffOf(k).toFixed(2));
    });
  });

  // ---------- 5. 阵营硬边界仍然穿透 ----------
  check('-Infinity 硬边界不受归一化影响(忠臣→已知主公,四种口径都是 -Infinity)', function(){
    var g = mkG(0);
    g.players[1].role = 'zhu'; // 目标改成已知主公
    ['steal','顺手牵羊','过河拆桥','damage','杀','duel','决斗'].forEach(function(k){
      if(botTargetScore(g, 0, 1, k) !== -Infinity)
        throw new Error('kind='+k+' 应为 -Infinity,实际 ' + botTargetScore(g,0,1,k));
    });
  });

  // ---------- 6. 端到端:候选枚举里顺手/拆桥的分数确实上升 ----------
  check('【端到端】enumerateAllLegalOneStepActions 里顺手牵羊的候选分现在含 steal 加成', function(){
    var g = mkG(0);
    // 给评分者一张顺手牵羊;目标(座位1,已知反贼)手上 5 张牌
    g.players[0].hand = [{ name:'顺手牵羊', suit:'♠', rank:3 }];
    g.players[1].hand = Array.from({length:5}, function(){ return { name:'x', suit:'♠', rank:2 }; });
    var out = enumerateAllLegalOneStepActions(g, 0);
    var cand = out.filter(function(c){ return c.action==='顺手牵羊' && c.target===1; })[0];
    if(!cand) throw new Error('应枚举出「顺手牵羊→座位1」这条候选');
    // 期望 = botCardPriority('顺手牵羊') + botTargetScore(g,0,1,'顺手牵羊')
    var expected = botCardPriority('顺手牵羊') + botTargetScore(g, 0, 1, '顺手牵羊');
    if(Math.abs(cand.localHeuristicScore - expected) > 1e-9)
      throw new Error('候选分应为 ' + expected.toFixed(1) + ',实际 ' + cand.localHeuristicScore.toFixed(1));
    // 且必须已经包含 steal 的 ×4 加成(5张*4=20)
    var withoutSteal = botCardPriority('顺手牵羊') + botTargetScore(g, 0, 1, '铁索连环'); // 同基础分、无steal
    if(!(cand.localHeuristicScore - withoutSteal > 19.9))
      throw new Error('候选分应比"无 steal 加成"高出 20,实际高出 ' + (cand.localHeuristicScore-withoutSteal).toFixed(1));
  });

  check('【端到端】目标手牌越多,顺手牵羊的候选分越高(修复前不成立的性质)', function(){
    function candScore(targetHand){
      var g = mkG(0);
      g.players[0].hand = [{ name:'顺手牵羊', suit:'♠', rank:3 }];
      g.players[1].hand = Array.from({length:targetHand}, function(){ return { name:'x', suit:'♠', rank:2 }; });
      var out = enumerateAllLegalOneStepActions(g, 0);
      var c = out.filter(function(x){ return x.action==='顺手牵羊' && x.target===1; })[0];
      return c ? c.localHeuristicScore : null;
    }
    var s1 = candScore(1), s5 = candScore(5);
    if(s1===null || s5===null) throw new Error('候选未枚举出来');
    // 修复后每多一张手牌 +6(基础分2 + steal 4);修复前只有 +2
    var perCard = (s5 - s1) / 4;
    if(Math.abs(perCard - 6) > 1e-9)
      throw new Error('每张手牌应贡献 6 分(基础2+steal4),实际 ' + perCard.toFixed(2) + ' —— 修复前是 2');
  });

  // ---------- 7. 破坏性验证 ----------
  check('破坏性验证:把归一化换成旧的 kind===steal 直判,修复断言确实会红', function(){
    var saved = botNormalizeTargetKind;
    // 模拟修复前:只认语义标签,不认牌名
    botNormalizeTargetKind = function(kind){
      return (kind==='damage'||kind==='duel'||kind==='steal') ? kind : null;
    };
    try{
      var gap = diffOf('steal') - diffOf('顺手牵羊');
      if(Math.abs(gap) < 1e-9)
        throw new Error('破坏后两种口径仍然一致,说明修复断言没有鉴别力');
      if(Math.abs(gap - 20) > 1e-9)
        throw new Error('破坏后差异应恰为 20 分,实际 ' + gap.toFixed(1));
      console.log('       ↳ 还原旧写法后差异重现: steal 分差 ' + diffOf('steal').toFixed(1)
        + ' vs 顺手牵羊 ' + diffOf('顺手牵羊').toFixed(1) + ' (断言有鉴别力)');
    } finally { botNormalizeTargetKind = saved; }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0) throw new Error('CORE-137 测试有 ' + fail + ' 条失败');
})();
`;

try { vm.runInContext(testCode, sandbox, { filename: 'core137-test.js' }); }
catch(e){ console.error('\n' + (e && e.message || e)); process.exit(1); }
