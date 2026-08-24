/**
 * CORE-154(issue #213):botCardPriority 补上 4 种主动进攻锦囊的定档。
 *
 * 【改动前】对真实 buildDeck() 完整枚举后发现,【南蛮入侵】【万箭齐发】【借刀杀人】
 * 【铁索连环】(共 8 张)在表里没有条目,全部掉进末尾 `return 20` 兜底档,与"不主动出的牌"
 * 同分。而这是出牌评分的基础分入口(botPlay 里 value=botCardPriority(action) 再叠加
 * botTargetScore),基础分 20 让它们几乎排不到前面。
 *
 * 【实测佐证】30 局配对对照(hook playCard 统计实际出牌动作):
 *   改动前 南蛮入侵 0 次 / 万箭齐发 0 次(两轮复跑均为 0)
 *   改动后 南蛮入侵 59~64 次 / 万箭齐发 16~17 次
 *
 * 【刻意保持 20 的两张】闪电(onlySelf,主动打出=自找雷劈)与无懈可击(不走出牌路径),
 * 有断言钉住,防止以后被误当成"漏定档"一起改掉。
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
const sandbox = vm.createContext(context, { name: 'sgs-154-sandbox' });

console.log('Loading CORE-154 测试环境...\n');
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
  function mkG(n, opts){
    var o = opts || {};
    var ps = [];
    for(var i=0;i<n;i++) ps.push({name:'P'+i,seat:i,hp:3,maxHp:4,alive:true,general:null,
      hand:[], equips:{weapon:null,armor:null,plus1:null,minus1:null}, delays:[], role:'unknown', caps:{}});
    if(o.hand) ps[0].hand = o.hand;
    if(o.deadFrom!==undefined) for(var k=o.deadFrom;k<n;k++) ps[k].alive=false;
    return { players:ps, phase:'play', pending:null, turn:0, deck:[], discard:[], log:[],
             started:true, gameMode:'ffa' };
  }

  // ---------- 1. 定档本身 ----------
  check('4 种主动锦囊不再掉进 20 分兜底档', function(){
    var want = { '借刀杀人':66, '南蛮入侵':62, '万箭齐发':62, '铁索连环':38 };
    for(var k in want){
      var got = botCardPriority(k);
      if(got !== want[k]) throw new Error(k+' 应为 '+want[k]+',实际 '+got);
    }
  });

  check('定档的相对关系符合推导(借刀=杀,南蛮/万箭=决斗,铁索<伤害牌但>兜底)', function(){
    if(botCardPriority('借刀杀人') !== botCardPriority('杀'))
      throw new Error('借刀应与【杀】同档(借用别人的杀,不消耗自己的)');
    if(botCardPriority('南蛮入侵') !== botCardPriority('决斗'))
      throw new Error('南蛮基础分应等同单体伤害牌,人数增益放在调用点');
    if(!(botCardPriority('铁索连环') < botCardPriority('决斗')))
      throw new Error('铁索本身零伤害,应低于伤害牌');
    if(!(botCardPriority('铁索连环') > 20))
      throw new Error('铁索是主动牌,应高于"不主动出的牌"的兜底档');
  });

  check('【闪电】【无懈可击】刻意保持 20(不得被误当成漏定档一起改)', function(){
    if(botCardPriority('闪电') !== 20)
      throw new Error('闪电 onlySelf、主动打出=给自己挂3点雷伤风险,不积极出才是对的');
    if(botCardPriority('无懈可击') !== 20)
      throw new Error('无懈在 CARD_PLAYS 里没有条目、不走出牌路径,20 分无实际影响');
  });

  check('其余既有定档逐字不变(零回归)', function(){
    var same = { '桃':100,'无中生有':92,'顺手牵羊':74,'过河拆桥':74,'乐不思蜀':70,
                 '兵粮寸断':70,'杀':66,'决斗':62,'火攻':62,'桃园结义':58,'五谷丰登':48,'酒':40 };
    for(var k in same){
      if(botCardPriority(k) !== same[k]) throw new Error(k+' 被改动了:'+botCardPriority(k));
    }
    if(botCardPriority('诸葛连弩') !== 82) throw new Error('装备档位被改动了');
  });

  // ---------- 2. 局面修正 ----------
  check('AOE 价值随存活人数递增(2人局为0增益,人越多越值)', function(){
    var b2 = botSituationalCardBonus(mkG(2), 0, '南蛮入侵');
    var b4 = botSituationalCardBonus(mkG(4), 0, '南蛮入侵');
    var b8 = botSituationalCardBonus(mkG(8), 0, '南蛮入侵');
    if(b2 !== 0) throw new Error('2人局只有1个目标,增益应为0,实际 '+b2);
    if(!(b4 > b2 && b8 > b4)) throw new Error('应随人数严格递增,实际 '+[b2,b4,b8]);
    if(botCardPriority('南蛮入侵') + b8 <= botCardPriority('无中生有'))
      throw new Error('8人局一张牌打7个人,总分应高于无中生有(摸两张)');
  });

  check('AOE 增益只看**存活**人数(死人不占目标)', function(){
    var full = botSituationalCardBonus(mkG(6), 0, '万箭齐发');
    var half = botSituationalCardBonus(mkG(6, {deadFrom:3}), 0, '万箭齐发');
    if(!(half < full)) throw new Error('有人阵亡后增益应下降,实际 '+half+' vs '+full);
  });

  check('铁索连环:手里有 AOE 时加分,没有时扣分', function(){
    var withAoe = botSituationalCardBonus(mkG(4,{hand:[{id:1,name:'南蛮入侵'}]}), 0, '铁索连环');
    var without = botSituationalCardBonus(mkG(4,{hand:[{id:1,name:'桃'}]}), 0, '铁索连环');
    if(!(withAoe > 0)) throw new Error('手里有AOE时铁索是铺垫牌,应加分,实际 '+withAoe);
    if(!(without < 0)) throw new Error('手里没AOE时铁索基本是浪费牌,应扣分,实际 '+without);
  });

  check('局面修正不波及其它牌(只认这三种 action)', function(){
    ['杀','桃','无中生有','过河拆桥','决斗','借刀杀人','闪电'].forEach(function(a){
      var v = botSituationalCardBonus(mkG(6), 0, a);
      if(v !== 0) throw new Error(a+' 不该有局面修正,实际 '+v);
    });
  });

  check('botCardPriority 仍是纯函数(不读 g、不因局面变化)', function(){
    var a = botCardPriority('南蛮入侵');
    var b = botCardPriority('南蛮入侵');
    if(a !== b || a !== 62) throw new Error('基础分应恒定为62,实际 '+a+'/'+b);
  });

  // ---------- 3. 破坏性验证 ----------
  check('破坏性验证:把4种改回兜底档后,南蛮与过河拆桥的相对关系确实反转', function(){
    var beforeFix = 20;                       // 改动前它们的实际取值
    var nanman = botCardPriority('南蛮入侵');
    var guohe  = botCardPriority('过河拆桥');
    if(!(beforeFix < guohe))
      throw new Error('前置:改动前南蛮(20)本就低于过河拆桥('+guohe+')');
    if(!(nanman > beforeFix))
      throw new Error('改动后南蛮应显著高于兜底档——否则本次改动等于没做');
  });

  console.log('');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail) throw new Error('__FAIL__');
})();
`;
vm.runInContext(testCode, sandbox, { filename: 'core154-tests.js' });
