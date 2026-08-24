/**
 * CORE-153(issue #212):【五谷丰登】机器人按价值挑牌,不再按池中顺序取第一张。
 *
 * 改动前 localFallback 就是 `return candidates[0]` —— 恒取池中第一张,毫无评分。
 *
 * 关键设计约束(issue 里点名):**不能直接复用 botCardPriority**,它建模的是"该先**出**
 * 哪张牌";【闪】【无懈可击】在那张表里都是最低档 20(因为出牌阶段确实不会主动打出),
 * 但在**拿牌**语境下价值很高,直接复用只会从"按顺序拿"变成"最后才拿闪"。
 */

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
const sandbox = vm.createContext(context, { name: 'sgs-153-sandbox' });

console.log('Loading CORE-153 测试环境...\n');
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


const testCode = String.raw`
(function(){
  var pass=0, fail=0;
  function check(name, fn){
    try { fn(); console.log('  PASS ' + name); pass++; }
    catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
  }
  function C(name, suit, rank, id){ return {id:id||Math.floor(Math.random()*1e6), name:name,
    suit:suit||'♠', rank:rank||5}; }
  function mkG(pool, opts){
    var o = opts || {};
    var me = {name:'P0',seat:0,hp:o.hp||4,maxHp:o.maxHp||4,alive:true,general:o.general||null,
      hand:o.hand||[], equips:o.equips||{weapon:null,armor:null,plus1:null,minus1:null},
      delays:[], role:'unknown', caps:o.caps||{}};
    var p1 = {name:'P1',seat:1,hp:4,maxHp:4,alive:true,general:null,hand:[],
      equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[],role:'unknown',caps:{}};
    return { players:[me,p1], phase:'wugu',
      pending:{type:'wugu', order:[0,1], idx:0, pool:pool},
      turn:0, deck:[], discard:[], log:[], started:true, gameMode:'ffa' };
  }
  function pickName(g){
    var cands = BOT_DECISIONS.wuguPick.buildCandidates(g, 0);
    var got = BOT_DECISIONS.wuguPick.localFallback(g, 0, cands);
    return got ? g.pending.pool[got.poolIdx].name : null;
  }
  var V = function(g, card){ return botWuguCardValue(g, 0, card); };

  check('不再恒取第一张:同一个池子在不同局面下选出不同的牌', function(){
    var pool = [C('杀'), C('桃')];
    var full = pickName(mkG(pool, {hp:4, maxHp:4}));      // 满血:桃没用
    var hurt = pickName(mkG(pool, {hp:1, maxHp:4}));      // 濒死:桃救命
    if(full === hurt) throw new Error('两种局面应选出不同的牌,都选了 '+full);
    if(hurt !== '桃') throw new Error('hp=1 时应拿【桃】,实际 '+hurt);
  });

  check('hp===1 且池中有【桃】时必拿桃(压过池中一切)', function(){
    var pool = [C('无中生有'), C('诸葛连弩'), C('桃'), C('杀')];
    var got = pickName(mkG(pool, {hp:1, maxHp:4}));
    if(got !== '桃') throw new Error('实际拿了 '+got);
  });

  check('满血时【桃】主动降权(占手牌又用不上)', function(){
    var g = mkG([C('桃')], {hp:4, maxHp:4});
    if(!(V(g, C('桃')) < V(g, C('杀')))) throw new Error('满血时桃不该高于杀');
  });

  check('手里没有【闪】时,闪的权重高于普通进攻牌', function(){
    var g = mkG([], {hand:[]});
    var vShan = V(g, C('闪')), vSha = V(g, C('杀'));
    if(!(vShan > vSha)) throw new Error('无闪时应更想要闪,闪='+vShan+' 杀='+vSha);
  });

  check('【闪】【无懈可击】不再是出牌语境的最低档(核心设计约束)', function(){
    var g = mkG([], {hand:[]});
    if(botCardPriority('闪') !== 20) throw new Error('前置:出牌语境下闪仍应是20');
    if(!(V(g, C('闪')) > 20)) throw new Error('拿牌语境下闪必须被拉回,实际 '+V(g,C('闪')));
    if(!(V(g, C('无懈可击')) > 20)) throw new Error('拿牌语境下无懈必须被拉回,实际 '+V(g,C('无懈可击')));
  });

  check('防御牌按已有张数递减加权(第三张边际很低)', function(){
    var v0 = V(mkG([], {hand:[]}), C('闪'));
    var v1 = V(mkG([], {hand:[C('闪')]}), C('闪'));
    var v2 = V(mkG([], {hand:[C('闪'),C('闪')]}), C('闪'));
    if(!(v0 > v1 && v1 > v2)) throw new Error('应严格递减,实际 '+[v0,v1,v2]);
  });

  check('空武器槽时装备权重高于已有更好武器时', function(){
    var empty = V(mkG([], {}), C('诸葛连弩'));
    var hasBetter = V(mkG([], {equips:{weapon:C('青龙偃月刀'),armor:null,plus1:null,minus1:null}}),
                      C('诸葛连弩'));
    if(!(empty > hasBetter)) throw new Error('空槽应更值钱,'+empty+' vs '+hasBetter);
  });

  check('同槽换更长射程的武器仍保留较高价值(不是一律降权)', function(){
    var upgrade = V(mkG([], {equips:{weapon:C('诸葛连弩'),armor:null,plus1:null,minus1:null}}),
                    C('青龙偃月刀'));   // range 1 → 3
    var downgrade = V(mkG([], {equips:{weapon:C('青龙偃月刀'),armor:null,plus1:null,minus1:null}}),
                      C('诸葛连弩'));   // range 3 → 1
    if(!(upgrade > downgrade)) throw new Error('升级应优于降级,'+upgrade+' vs '+downgrade);
  });

  check('有 unlimitedSha(诸葛连弩/咆哮)时【杀】权重提升', function(){
    var plain = V(mkG([], {}), C('杀'));
    var nu    = V(mkG([], {caps:{unlimitedSha:true}}), C('杀'));
    if(!(nu > plain)) throw new Error('应提升,'+nu+' vs '+plain);
  });

  check('武将转化走 canUseAs seam(关羽【武圣】红牌当杀),测试不硬编码武将名', function(){
    // 用 caps 声明能力,不写"关羽";canUseAs 内部据此判定红牌可当杀。
    var g = mkG([], {caps:{wusheng:true}});
    var plainG = mkG([], {});
    // 【用例必须挑"本身价值低于当杀用"的牌】转化的估值是 max(这张牌自己的价值,
    // 当杀用的价值×0.9) —— 过河拆桥基线 74 本就高于当杀的 59,max 不会变化,
    // 那样这条断言什么都验证不到。红色【铁索连环】基线 38,低于 59,才能看出差异。
    var redTrick = C('铁索连环','♥',6);
    if(!canUseAs(g.players[0], redTrick, '杀'))
      throw new Error('前置:带 wusheng 时红牌应可当杀(canUseAs)');
    if(!(V(g, redTrick) > V(plainG, redTrick)))
      throw new Error('可转化为杀应体现在估值里,'+V(g,redTrick)+' vs '+V(plainG,redTrick));
    // 反向:本身就比"当杀用"更值钱的牌不该被转化拉低
    var redStrong = C('过河拆桥','♥',6);
    if(V(g, redStrong) !== V(plainG, redStrong))
      throw new Error('高价值牌不该因为"能当杀"而变动估值');
  });

  check('候选带上花色点数与 localHeuristicScore(交给模型的信息)', function(){
    var g = mkG([C('杀','♠',7)]);
    var c = BOT_DECISIONS.wuguPick.buildCandidates(g, 0)[0];
    if(c.label.indexOf('♠') < 0) throw new Error('label 应含花色,实际 '+c.label);
    if(typeof c.localHeuristicScore !== 'number') throw new Error('应附本地分');
  });

  check('poolIdx 与池中下标严格对应(execute 依赖它定位)', function(){
    var g = mkG([C('杀'), C('桃'), C('闪')]);
    var cands = BOT_DECISIONS.wuguPick.buildCandidates(g, 0);
    cands.forEach(function(c, i){
      if(c.poolIdx !== i) throw new Error('第'+i+'项 poolIdx='+c.poolIdx);
      if(c.cardId !== g.pending.pool[i].id) throw new Error('cardId 与池不对应');
    });
  });

  check('破坏性验证:改回取第一张后,hp=1 也不会优先拿桃', function(){
    var pool = [C('杀'), C('桃')];
    var g = mkG(pool, {hp:1, maxHp:4});
    var cands = BOT_DECISIONS.wuguPick.buildCandidates(g, 0);
    var oldPick = cands[0];                       // 旧实现:恒取第一张
    if(g.pending.pool[oldPick.poolIdx].name === '桃')
      throw new Error('用例构造有误:第一张不该是桃,否则这条验证不出鉴别力');
    var now = BOT_DECISIONS.wuguPick.localFallback(g, 0, cands);
    if(g.pending.pool[now.poolIdx].name !== '桃')
      throw new Error('现实现应拿桃');
  });

  console.log('');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail) throw new Error('__FAIL__');
})();
`;
vm.runInContext(testCode, sandbox, { filename: 'core153-tests.js' });
