/**
 * issue #203:AI 不应把"必定无效的黑色【杀】"打在无防具的于禁(【毅重】)身上。
 *
 * 同一条结算规则的另一半——装备【仁王盾】的目标——一并覆盖:结算侧
 * (sha/sha-resolution.js 的 afterShaTargetSkills)就是同一个 if 的两支,
 * 且两支条件**不对称**(仁王盾受青釭剑 ignoreArmor 压制,毅重是武将技、不受):
 *
 *   黑色杀 且 ( 目标有毅重且无防具 || (攻击者无 ignoreArmor 且 目标有仁王盾) )
 *
 * 覆盖:
 *  1. 基线/黑杀/红杀/有防具/仁王盾/青釭剑 六种组合的对错
 *  2. 非伤害类 kind(steal/duel)完全不受影响
 *  3. 不传 card 时行为逐字不变(其余调用点零影响)
 *  4. 丈八蛇矛(card 是数组)保守不罚
 *  5. -Infinity 硬边界仍原样穿透
 *  6. botBestTarget 的实际选择:有替代目标时绝不选它;只剩它时仍照常出杀(刻意不硬禁)
 *  7. 破坏性验证:移除惩罚后断言确实变红
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
// botBestTarget 会查 CARD_PLAYS[actionId].canTarget 做合法性过滤,而 CARD_PLAYS 定义在
// game.js —— 这套脚手架(沿用 run_core135)不加载 game.js。这里注入一个最小 stub:
// 不提供 canTarget 就等于"不额外过滤",正好把测试聚焦在**评分与选择**上,
// 距离/射程那层另有专门的测试覆盖,不在本 issue 范围内。
context.CARD_PLAYS = { '杀': {} };
const sandbox = vm.createContext(context, { name: 'sgs-203-sandbox' });

console.log('Loading issue #203 测试环境...\n');
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
  var BLACK={id:1,name:'杀',suit:'♠',rank:7};
  var RED  ={id:2,name:'杀',suit:'♥',rank:7};

  // 乱斗模式(free):避开身份局的 role/suspicion 分支。
  // 【必须固定随机源】botTargetScore 在部分分支里带 Math.random(),不锁住的话
  // 两次调用本来就不同分,断言会变成噪声。这里在每次取分前把 Math.random 固定成常数。
  function mk(targetOpts, meOpts){
    function P(i,o){
      var b={name:'P'+i,seat:i,hp:3,maxHp:4,alive:true,general:null,hand:[],
             equips:{weapon:null,armor:null,plus1:null,minus1:null},
             delays:[],role:'unknown',caps:{}};
      for(var k in (o||{})) b[k]=o[k];
      return b;
    }
    return { players:[P(0,meOpts),P(1,targetOpts),P(2,{})],
      phase:'play',pending:null,turn:0,deck:[],discard:[],log:[],
      started:true,gameMode:'free' };
  }
  var realRandom = Math.random;
  function score(g,card,kind,targetSeat){
    Math.random = function(){ return 0.5; };
    try { return botTargetScore(g,0,targetSeat===undefined?1:targetSeat,kind||'damage',card); }
    finally { Math.random = realRandom; }
  }
  var PEN = -400;

  check('基线:普通目标 + 黑杀,分数正常(不被惩罚)', function(){
    var s=score(mk({}),BLACK);
    if(!isFinite(s) || s<=-100) throw new Error('普通目标不该被罚,实际 '+s);
  });

  check('无防具于禁 + 黑杀 → 重罚 '+PEN, function(){
    var base=score(mk({}),BLACK), s=score(mk({caps:{yizhong:true}}),BLACK);
    if(Math.abs((s-base)-PEN)>0.001) throw new Error('应恰好低 '+(-PEN)+',实际差 '+(s-base));
  });

  check('无防具于禁 + **红**杀 → 不罚(毅重只对黑杀生效)', function(){
    var base=score(mk({}),RED), s=score(mk({caps:{yizhong:true}}),RED);
    if(s!==base) throw new Error('红杀不该被罚,'+s+' vs '+base);
  });

  check('于禁**有防具** + 黑杀 → 不罚(毅重要求装备区无防具)', function(){
    var g=mk({caps:{yizhong:true},
      equips:{weapon:null,armor:{id:9,name:'八卦阵',suit:'♣',rank:2},plus1:null,minus1:null}});
    var base=score(mk({}),BLACK), s=score(g,BLACK);
    if(s!==base) throw new Error('有防具时毅重不生效,'+s+' vs '+base);
  });

  check('仁王盾 + 黑杀 → 重罚(同一条结算规则的另一支)', function(){
    var base=score(mk({}),BLACK), s=score(mk({caps:{renwang:true}}),BLACK);
    if(Math.abs((s-base)-PEN)>0.001) throw new Error('仁王盾同样应被罚,实际差 '+(s-base));
  });

  check('仁王盾 + 攻击者青釭剑(ignoreArmor) + 黑杀 → 不罚', function(){
    var base=score(mk({}),BLACK);
    var s=score(mk({caps:{renwang:true}},{caps:{ignoreArmor:true}}),BLACK);
    if(s!==base) throw new Error('青釭剑无视防具,仁王盾不生效,'+s+' vs '+base);
  });

  check('毅重**不**受青釭剑影响:攻击者有青釭剑仍要罚(两支条件不对称)', function(){
    var base=score(mk({}),BLACK);
    var s=score(mk({caps:{yizhong:true}},{caps:{ignoreArmor:true}}),BLACK);
    if(Math.abs((s-base)-PEN)>0.001)
      throw new Error('毅重是武将技不是防具,青釭剑无视不了,实际差 '+(s-base));
  });

  check('非伤害类 kind(steal/duel)完全不受影响', function(){
    ['steal','duel'].forEach(function(k){
      var base=score(mk({}),BLACK,k), s=score(mk({caps:{yizhong:true}}),BLACK,k);
      if(s!==base) throw new Error(k+' 不该被罚,'+s+' vs '+base);
    });
  });

  check('不传 card 时行为逐字不变(其余调用点零影响)', function(){
    var a=score(mk({caps:{yizhong:true}},null), undefined);
    var b=score(mk({}), undefined);
    if(a!==b) throw new Error('不传 card 时不判颜色,应同分,'+a+' vs '+b);
  });

  check('丈八蛇矛(card 是数组)保守不罚', function(){
    var base=score(mk({}),[BLACK,BLACK]);
    var s=score(mk({caps:{yizhong:true}}),[BLACK,BLACK]);
    if(s!==base) throw new Error('数组颜色另算,这里保守不罚,'+s+' vs '+base);
  });

  check('身份硬禁的 -Infinity 原样穿透(加法不能把它变成有限值)', function(){
    var g=mk({caps:{yizhong:true}});
    g.gameMode='identity'; g.players[0].role='zhong';
    g.players[1].role='zhu'; g.players[1].roleRevealed=true;
    var s=score(g,BLACK);
    if(s!==-Infinity) throw new Error('忠臣对已知主公必须恒为 -Infinity,实际 '+s);
  });

  check('botBestTarget:有替代目标时绝不选必定无效的那个', function(){
    var g=mk({caps:{yizhong:true}});
    g.players[2].hp=1;                       // seat2 残血,本该是更优目标
    Math.random=function(){return 0.5;};
    var best;
    try { best=botBestTarget(g,0,BLACK,'杀'); } finally { Math.random=realRandom; }
    if(best!==2) throw new Error('应选 seat2,实际 '+best);
  });

  check('botBestTarget:只剩它时仍是有限分、照常出杀(刻意不硬禁)', function(){
    var g=mk({caps:{yizhong:true}});
    g.players[2].alive=false;
    var s=score(g,BLACK);
    if(!isFinite(s)) throw new Error('应是有限分:雌雄双股剑在毅重判断之前结算,并非零收益');
    Math.random=function(){return 0.5;};
    var best;
    try { best=botBestTarget(g,0,BLACK,'杀'); } finally { Math.random=realRandom; }
    if(best!==1) throw new Error('只剩它时仍应选中,实际 '+best);
  });

  console.log('');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail) throw new Error('__FAIL__');
})();
`;
vm.runInContext(testCode, sandbox, { filename: 'core203-tests.js' });

// ---- 破坏性验证:必须用**全新的 sandbox**,否则 bot.js 里的 const/let 会重复声明 ----
console.log('\n【破坏性验证】移除惩罚后,于禁应与普通目标同分(证明断言能变红)');
const broken = fs.readFileSync('bot.js','utf8')
  .replace('score += BOT_SHA_VOIDED_PENALTY;', '/* 惩罚已移除(破坏性验证) */');
if(broken === fs.readFileSync('bot.js','utf8')) { console.log('  FAIL 替换未命中'); process.exit(1); }
const ctx2 = vm.createContext(Object.assign({}, context), { name: 'sgs-203-broken' });
['data.js','stages/stage-table.js','ai-bot.js','bot-ai-bus.js'].forEach(function(f){
  vm.runInContext(fs.readFileSync(f,'utf8'), ctx2, { filename:f });
});
vm.runInContext(broken, ctx2, { filename:'bot-broken.js' });
const probe = String.raw`
(function(){
  function P(i,o){ var b={name:'P'+i,seat:i,hp:3,maxHp:4,alive:true,general:null,hand:[],
    equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[],role:'unknown',caps:{}};
    for(var k in (o||{})) b[k]=o[k]; return b; }
  function mk(t){ return {players:[P(0,{}),P(1,t),P(2,{})],phase:'play',pending:null,turn:0,
    deck:[],discard:[],log:[],started:true,gameMode:'free'}; }
  var B={id:1,name:'杀',suit:'♠',rank:7};
  var r=Math.random; Math.random=function(){return 0.5;};
  var a,b;
  try { a=botTargetScore(mk({caps:{yizhong:true}}),0,1,'damage',B);
        b=botTargetScore(mk({}),0,1,'damage',B); } finally { Math.random=r; }
  if(a===b) console.log('  PASS 移除惩罚后两者同分 ('+a+') —— 断言确实能变红');
  else { console.log('  FAIL 移除惩罚后仍不同分:'+a+' vs '+b); throw new Error('__FAIL__'); }
})();
`;
vm.runInContext(probe, ctx2, { filename:'core203-broken-probe.js' });
