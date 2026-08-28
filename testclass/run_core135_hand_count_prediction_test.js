/**
 * CORE-135: 手牌数维度的「对方有没有闪/杀」概率预测
 *
 * 覆盖:
 *  1. 概率表与真实牌堆对账(超几何精确值,不是拍脑袋常数)
 *  2. 曲线形状:单调递增 + 边际增量递减(凹形);n=0 是精确 0
 *  3. botPredictKind 两种口径都认;不适用的 kind 返回 null
 *  4. 【不变量】已知反贼(8张手牌) vs 未知身份(0张手牌) 必须仍选已知反贼
 *     —— 含鉴别力验证:权重调到 200 时该断言确实变红
 *  5. 阵营硬过滤(botTargetRelationAllowed/botTargetPolicyAllows)完全不受影响
 *  6. -Infinity 硬边界仍是 -Infinity
 *  7. 【正面行为】同阵营/同嫌疑下,有闪概率低的目标被优先选中
 *  8. 既有 kind==='steal' 那行行为逐字不变
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
  window: { aiConversations:{}, addEventListener:function(){}, location:{search:'',href:'http://localhost',reload:function(){}} }
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-core135-sandbox' });

console.log('Loading CORE-135 测试环境...\n');
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
console.log('  CORE-135:手牌数维度的闪/杀概率预测');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    try { fn(); console.log('  PASS ' + name); pass++; }
    catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
  }

  // ---------- 1. 概率表与真实牌堆对账 ----------
  check('概率表与 buildDeck() 的超几何精确值对账(不是拍脑袋常数)', function(){
    var deck = buildDeck();
    var N = deck.length;
    var Kshan = deck.filter(function(c){ return c.name==='闪'; }).length;
    var Ksha  = deck.filter(function(c){ return isShaName(c.name); }).length;
    if(N !== 140) throw new Error('牌堆总数应为 140,实际 ' + N + '(牌堆改过就要重新打表)');
    if(Kshan !== 15) throw new Error('闪应为 15 张,实际 ' + Kshan + '(牌堆改过就要重新打表)');
    if(Ksha !== 44) throw new Error('杀系应为 44 张,实际 ' + Ksha + '(牌堆改过就要重新打表)');
    function hyper(N,K,n){ if(n<=0) return 0; if(n>N-K) return 1;
      var p=1; for(var i=0;i<n;i++) p*=(N-K-i)/(N-i); return 1-p; }
    var DECAY = 0.85;
    for(var n=1;n<=12;n++){
      var expDodge = Math.max(0.05, Math.min(0.90, hyper(N,Kshan,n)*DECAY));
      var expSlash = Math.max(0.05, Math.min(0.90, hyper(N,Ksha,n)*DECAY));
      if(Math.abs(BOT_DODGE_TABLE[n]-expDodge) > 0.0006)
        throw new Error('n='+n+' 闪表 '+BOT_DODGE_TABLE[n]+' 与超几何*0.85 的 '+expDodge.toFixed(4)+' 不符');
      if(Math.abs(BOT_SLASH_TABLE[n]-expSlash) > 0.0006)
        throw new Error('n='+n+' 杀表 '+BOT_SLASH_TABLE[n]+' 与超几何*0.85 的 '+expSlash.toFixed(4)+' 不符');
    }
  });

  // ---------- 2. 曲线形状 ----------
  check('n=0 是精确的 0(手牌数是公开事实,不套 0.05 下限)', function(){
    var p = botPredictCards(0);
    if(p.dodge !== 0) throw new Error('0张手牌的有闪概率必须是 0,实际 ' + p.dodge);
    if(p.slash !== 0) throw new Error('0张手牌的有杀概率必须是 0,实际 ' + p.slash);
  });

  check('概率随手牌数严格单调递增', function(){
    for(var n=1;n<=12;n++){
      if(!(BOT_DODGE_TABLE[n] > BOT_DODGE_TABLE[n-1])) throw new Error('闪表在 n='+n+' 处非递增');
      if(!(BOT_SLASH_TABLE[n] > BOT_SLASH_TABLE[n-1])) throw new Error('杀表在 n='+n+' 处非递增');
    }
  });

  check('边际增量递减(凹形:低手牌涨得快、高手牌趋平)', function(){
    for(var n=2;n<=12;n++){
      var dNow = BOT_DODGE_TABLE[n]-BOT_DODGE_TABLE[n-1];
      var dPrev = BOT_DODGE_TABLE[n-1]-BOT_DODGE_TABLE[n-2];
      if(dNow > dPrev + 1e-9) throw new Error('闪表边际增量在 n='+n+' 处反弹(' + dPrev.toFixed(3) + '→' + dNow.toFixed(3) + ')');
      var sNow = BOT_SLASH_TABLE[n]-BOT_SLASH_TABLE[n-1];
      var sPrev = BOT_SLASH_TABLE[n-1]-BOT_SLASH_TABLE[n-2];
      if(sNow > sPrev + 1e-9) throw new Error('杀表边际增量在 n='+n+' 处反弹');
    }
  });

  check('超过表长的手牌数取末值,不越界', function(){
    var big = botPredictCards(99), last = botPredictCards(12);
    if(big.dodge !== last.dodge || big.slash !== last.slash) throw new Error('超长手牌应取末值');
    var neg = botPredictCards(-3);
    if(neg.dodge !== 0) throw new Error('负数/异常输入应按 0 处理');
    if(botPredictCards(undefined).dodge !== 0) throw new Error('undefined 应按 0 处理');
  });

  check('闪维度全区间有分辨力、杀维度在高手牌区饱和(牌堆构成的真实反映)', function(){
    // 闪只有15张 → n=12 仍只有 0.654,整段都在有效区间
    if(!(BOT_DODGE_TABLE[12] < 0.70)) throw new Error('闪表 n=12 不应过早饱和,实际 ' + BOT_DODGE_TABLE[12]);
    // 杀有44张 → n=8 之后每格增量已 < 0.02
    if(!((BOT_SLASH_TABLE[9]-BOT_SLASH_TABLE[8]) < 0.02)) throw new Error('杀表 n>=8 应基本饱和');
  });

  // ---------- 3. botPredictKind 两种口径 ----------
  check('botPredictKind:语义类别口径', function(){
    if(botPredictKind('damage') !== 'damage') throw new Error('damage');
    if(botPredictKind('duel') !== 'duel') throw new Error('duel');
    if(botPredictKind('steal') !== null) throw new Error('steal 不适用预测项,应返回 null');
  });

  check('botPredictKind:牌名口径(enumerateAllLegalOneStepActions 透传的那种)', function(){
    if(botPredictKind('杀') !== 'damage') throw new Error('杀 应归一化成 damage');
    if(botPredictKind('火杀') !== 'damage') throw new Error('火杀');
    if(botPredictKind('雷杀') !== 'damage') throw new Error('雷杀');
    if(botPredictKind('决斗') !== 'duel') throw new Error('决斗 应归一化成 duel');
  });

  // CORE-137 起用例名做了修正:原文写的是"一律 null(**不加分**)",但顺手牵羊/过河拆桥
  // 现在会经 botNormalizeTargetKind 归一成 'steal' 拿到 ×4 的拆牌加分——它们只是不适用
  // **预测项**(拆牌不会被闪掉),不是"不加分"。断言本身(botPredictKind 返回 null)依然
  // 完全正确,过期的只是括号里那句描述,若不改会误导以后读测试的人。
  check('botPredictKind:不适用概率预测的 kind 一律 null(steal 类另有自己的加分)', function(){
    ['顺手牵羊','过河拆桥','铁索连环','乐不思蜀','兵粮寸断','火攻','借刀杀人','steal',null,undefined,'']
      .forEach(function(k){
        if(botPredictKind(k) !== null) throw new Error(String(k)+' 应返回 null,实际 ' + botPredictKind(k));
      });
  });

  // ---------- 局面构造 ----------
  // 身份局:座位0=忠臣(评分者), 1/2/3 = 待评目标
  function mkIdentityGame(){
    return {
      gameMode:'identity', phase:'play', turn:0, roundNum:3, pending:null,
      deck:[], aiSuspicionEvents:[], aiRebelSuspicion:{}, log:[],
      players:[
        { name:'我', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'zhong', roleRevealed:false },
        { name:'甲', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'fan',  roleRevealed:true  },
        { name:'乙', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'fan',  roleRevealed:false },
        { name:'丙', alive:true, hp:4, maxHp:4, hand:[], equips:{}, delays:[], role:'zhu',  roleRevealed:true  }
      ]
    };
  }
  function setHand(g, seat, n){
    g.players[seat].hand = [];
    for(var i=0;i<n;i++) g.players[seat].hand.push({ name:'未知', suit:'♠', rank:2 });
  }

  // ---------- 4. 不变量:预测项不得翻转身份判断 ----------
  check('【不变量】已知反贼(8张手牌) vs 未知身份(0张手牌) → 仍选已知反贼', function(){
    var g = mkIdentityGame();
    setHand(g, 1, 8);   // 已知反贼,手牌多(最可能有闪 → 预测项给它最低分)
    setHand(g, 2, 0);   // 身份未知,0张手牌(预测项给它最高分)
    g.aiRebelSuspicion[2] = 40; // 让未知目标也过忠臣的 suspicion>=35 门槛,否则它是 -Infinity、比较无意义
    var sFan = botTargetScore(g, 0, 1, 'damage');
    var sUnknown = botTargetScore(g, 0, 2, 'damage');
    if(!(sFan > sUnknown))
      throw new Error('已知反贼('+sFan.toFixed(1)+') 必须仍高于未知身份('+sUnknown.toFixed(1)+')');
  });

  // 破坏值用 400 而不是拍脑袋的 200:实测发现 W=200 都翻不动身份判断(291 vs 280),
  // 因为基础分里的 +2n 在这个场景里也站在"已知反贼(8张手牌)"那一边、和身份权重同向。
  // 真实临界约 W>373((180+16)/dodge(8))。破坏值应该反映真实临界,不是猜测值。
  check('【鉴别力验证】把权重临时调到 400(真实临界约373),上面那条不变量确实会红', function(){
    var saved = BOT_PREDICT_WEIGHT;
    BOT_PREDICT_WEIGHT = 400;
    try{
      var g = mkIdentityGame();
      setHand(g, 1, 8); setHand(g, 2, 0);
      g.aiRebelSuspicion[2] = 40;
      var sFan = botTargetScore(g, 0, 1, 'damage');
      var sUnknown = botTargetScore(g, 0, 2, 'damage');
      if(sFan > sUnknown)
        throw new Error('权重400时仍选反贼,说明不变量断言没有鉴别力(反贼'+sFan.toFixed(1)+' vs 未知'+sUnknown.toFixed(1)+')');
      console.log('       ↳ 权重400时确实翻转: 已知反贼 ' + sFan.toFixed(1) + ' < 未知身份 ' + sUnknown.toFixed(1) + ' (断言有鉴别力)');
    } finally { BOT_PREDICT_WEIGHT = saved; }
  });

  check('产品权重 40 下,预测项极差远小于身份权重(数学上不可能翻转)', function(){
    // 预测项的最大可能贡献差 = (1-0) - (1-最大概率) = 最大概率 × 权重
    var maxDodgeSwing = BOT_DODGE_TABLE[BOT_DODGE_TABLE.length-1] * BOT_PREDICT_WEIGHT;
    var maxSlashSwing = BOT_SLASH_TABLE[BOT_SLASH_TABLE.length-1] * BOT_PREDICT_WEIGHT;
    if(maxDodgeSwing >= 100) throw new Error('闪维度极差 '+maxDodgeSwing.toFixed(1)+' 过大,可能翻转身份判断');
    if(maxSlashSwing >= 100) throw new Error('杀维度极差 '+maxSlashSwing.toFixed(1)+' 过大');
    // 身份权重的最小差值:known==='fan' 给忠臣 +180
    if(!(maxDodgeSwing < 180 && maxSlashSwing < 180)) throw new Error('极差必须远小于身份权重 180');
    // 更强的一条:实测真实翻转临界(见鉴别力用例)约 W>373,产品值 40 有 9 倍以上余量
    if(!(BOT_PREDICT_WEIGHT * 9 < 373)) throw new Error('产品权重对真实翻转临界应保有 9 倍以上余量,实际 W='+BOT_PREDICT_WEIGHT);
  });

  // ---------- 5/6. 阵营硬过滤 + -Infinity 边界 ----------
  check('-Infinity 硬边界穿透:忠臣看已知主公仍是 -Infinity(加法对 -Infinity 无效)', function(){
    var g = mkIdentityGame();
    setHand(g, 3, 0); // 主公 0 张手牌 = 预测项给最高加分,若边界失守这里就会变成有限值
    var s = botTargetScore(g, 0, 3, 'damage');
    if(s !== -Infinity) throw new Error('忠臣→已知主公必须是 -Infinity,实际 ' + s);
  });

  check('-Infinity 硬边界穿透:反贼看已知反贼队友仍是 -Infinity', function(){
    var g = mkIdentityGame();
    g.players[0].role = 'fan';
    setHand(g, 1, 0);
    var s = botTargetScore(g, 0, 1, 'damage');
    if(s !== -Infinity) throw new Error('反贼→已知反贼必须是 -Infinity,实际 ' + s);
  });

  check('-Infinity 硬边界穿透:duel 口径同样成立', function(){
    var g = mkIdentityGame();
    setHand(g, 3, 0);
    if(botTargetScore(g, 0, 3, 'duel') !== -Infinity) throw new Error('duel 口径下边界失守');
    if(botTargetScore(g, 0, 3, '决斗') !== -Infinity) throw new Error('牌名口径下边界失守');
  });

  check('阵营硬过滤 botTargetRelationAllowed 完全不受影响(CORE-89 成果)', function(){
    var g = mkIdentityGame();
    setHand(g, 3, 0); setHand(g, 1, 8);
    if(botTargetRelationAllowed(g, 0, 3, null) !== false) throw new Error('忠臣→已知主公应被禁止');
    if(botTargetRelationAllowed(g, 0, 1, null) !== true) throw new Error('忠臣→已知反贼应被允许');
    // 硬过滤是布尔谓词,根本不读分数——手牌数怎么变都不该影响它
    setHand(g, 3, 12);
    if(botTargetRelationAllowed(g, 0, 3, null) !== false) throw new Error('手牌数不应影响硬过滤');
  });

  check('阵营硬过滤 botTargetPolicyAllows 完全不受影响(CORE-90 成果)', function(){
    var g = mkIdentityGame();
    setHand(g, 3, 0);
    if(botTargetPolicyAllows(g, 0, 3, 'harmful') !== false) throw new Error('harmful:忠臣→已知主公应禁止');
    if(botTargetPolicyAllows(g, 0, 1, 'helpful') !== false) throw new Error('helpful:忠臣→已知反贼应禁止');
    if(botTargetPolicyAllows(g, 0, 3, 'helpful') !== true) throw new Error('helpful:忠臣→已知主公应允许');
  });

  // ---------- 7. 正面行为断言 ----------
  check('【新行为】同阵营同嫌疑、其余条件相同时,手牌少(有闪概率低)的目标得分更高', function(){
    var g = mkIdentityGame();
    g.players[1].role='fan'; g.players[1].roleRevealed=true;
    g.players[2].role='fan'; g.players[2].roleRevealed=true; // 两个都是已知反贼,身份项相等
    setHand(g, 1, 0);  // 确定没闪
    setHand(g, 2, 8);  // 大概率有闪
    var sEmpty = botTargetScore(g, 0, 1, 'damage');
    var sFull  = botTargetScore(g, 0, 2, 'damage');
    if(!(sEmpty > sFull))
      throw new Error('0张手牌的目标('+sEmpty.toFixed(1)+') 应高于 8张手牌的('+sFull.toFixed(1)+')');
  });

  check('【新行为】改动前该场景是反过来的(手牌多反而加分),证明这是真实的行为变化', function(){
    // 改动前 botTargetScore 里手牌只有 (hand.length)*2 的加分项,没有任何"更难打中"的扣分。
    // 这里用同一份局面手算改动前的分差:8张手牌比0张高 8*2=16 分。
    var g = mkIdentityGame();
    g.players[1].role='fan'; g.players[1].roleRevealed=true;
    g.players[2].role='fan'; g.players[2].roleRevealed=true;
    setHand(g, 1, 0); setHand(g, 2, 8);
    var sEmpty = botTargetScore(g, 0, 1, 'damage');
    var sFull  = botTargetScore(g, 0, 2, 'damage');
    var predDelta = (1-BOT_DODGE_TABLE[0])*BOT_PREDICT_WEIGHT - (1-BOT_DODGE_TABLE[8])*BOT_PREDICT_WEIGHT;
    var oldDelta = sFull - sEmpty + predDelta; // 去掉预测项 = 改动前的分差
    if(!(oldDelta > 0))
      throw new Error('改动前 8张手牌应该更高分(手牌数纯加分),实际差 ' + oldDelta.toFixed(1));
    if(!(sEmpty > sFull))
      throw new Error('改动后应该反过来');
  });

  check('【新行为】duel 口径:手牌少(有杀概率低)的目标更值得决斗', function(){
    var g = mkIdentityGame();
    g.players[1].role='fan'; g.players[1].roleRevealed=true;
    g.players[2].role='fan'; g.players[2].roleRevealed=true;
    setHand(g, 1, 1); setHand(g, 2, 6);
    if(!(botTargetScore(g,0,1,'duel') > botTargetScore(g,0,2,'duel')))
      throw new Error('决斗应优先打手牌少的');
    // 牌名口径应给出完全相同的结果
    if(botTargetScore(g,0,1,'决斗') !== botTargetScore(g,0,1,'duel'))
      throw new Error('牌名口径与语义口径必须等价');
  });

  check('【新行为】botBestTarget 的 kind 判定已扩成三分支(决斗单列)', function(){
    var src = String(botBestTarget);
    if(src.indexOf("'duel'") < 0) throw new Error('botBestTarget 应能产出 duel 口径');
    if(src.indexOf("'steal'") < 0) throw new Error('steal 分支应保留');
  });

  // ---------- 8. 既有 steal 行为逐字不变 ----------
  check('既有 kind===steal 那行行为逐字不变(手牌数 ×4 加分,且预测项不参与)', function(){
    var g = mkIdentityGame();
    g.players[1].role='fan'; g.players[1].roleRevealed=true;
    setHand(g, 1, 0);
    var s0 = botTargetScore(g, 0, 1, 'steal');
    setHand(g, 1, 5);
    var s5 = botTargetScore(g, 0, 1, 'steal');
    // 差值 = 基础分的 hand*2 + steal 的 hand*4 = 5*2 + 5*4 = 30,预测项不该掺进来
    if(Math.abs((s5 - s0) - 30) > 1e-9)
      throw new Error('steal 口径下分差应恰为 30(纯既有项),实际 ' + (s5-s0).toFixed(3) + ' —— 预测项不应对 steal 生效');
  });

  check('预测项对不适用的牌(铁索连环)完全不加分', function(){
    var g = mkIdentityGame();
    g.players[1].role='fan'; g.players[1].roleRevealed=true;
    setHand(g, 1, 0);
    var a = botTargetScore(g, 0, 1, '铁索连环');
    setHand(g, 1, 6);
    var b = botTargetScore(g, 0, 1, '铁索连环');
    // 只剩基础分的 hand*2 = 12
    if(Math.abs((b - a) - 12) > 1e-9)
      throw new Error('铁索连环口径下分差应恰为 12(纯基础分),实际 ' + (b-a).toFixed(3));
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail > 0) throw new Error('CORE-135 测试有 ' + fail + ' 条失败');
})();
`;

try { vm.runInContext(testCode, sandbox, { filename: 'core135-test.js' }); }
catch(e){ console.error('\n' + (e && e.message || e)); process.exit(1); }
