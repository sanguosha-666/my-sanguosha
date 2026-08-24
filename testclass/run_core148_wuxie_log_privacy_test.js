/**
 * CORE-148(issue #205):无懈轮询日志不得向机器人泄露具体被询问玩家。
 *
 * 【为什么这是隐私问题】无懈轮询**只会询问真正持有【无懈可击】的角色**,或手牌非空且
 * 仍满足【蛊惑】响应条件的于吉。所以"正在问谁"本身就等价于暴露那个人的隐藏持牌/
 * 隐藏响应能力。改动前脱敏只做在 render-log.js(issue #59),而 AI 可见状态
 * (buildBotKeyEvents → buildBotVisibleState().recentLog)**整个绕过了它**,
 * 原始文本会随决策 prompt 和 updateAiSummary 的摘要 prompt 一起发给模型。
 *
 * 覆盖:
 *  1. 规则本体在规则层(game.js),展示层与 AI 层共用同一条
 *  2. recentLog 里不出现被询问者姓名/座位,只留公开语义
 *  3. "某人打出【无懈可击】"这类**已公开的实际动作**必须原样保留
 *  4. 脱敏后相邻重复项折叠,不让一轮询问挤占 recentLog 名额
 *  5. 折叠只针对那一句公开文本,不误伤其它重复日志
 *  6. 无无懈日志时行为与改动前逐字一致
 *  7. 破坏性验证:移除脱敏后姓名确实会出现在 recentLog 里
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
const sandbox = vm.createContext(context, { name: 'sgs-148-sandbox' });

console.log('Loading CORE-148 测试环境...\n');
['data.js', 'stages/stage-table.js', 'room-lifecycle.js', 'game.js', 'sha/sha-resolution.js', 'weapons.js', 'skills.js', 'ai-bot.js', 'bot-ai-bus.js', 'bot.js'].forEach(function(file){
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
  var SECRET = '张三';   // 唯一持有【无懈可击】的真人玩家
  function mkG(logs){
    return { players:[
        {name:'机器人A',seat:0,hp:4,maxHp:4,alive:true,hand:[],role:'unknown',
         equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]},
        {name:SECRET,seat:1,hp:4,maxHp:4,alive:true,hand:[],role:'unknown',
         equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]},
        {name:'李四',seat:2,hp:4,maxHp:4,alive:true,hand:[],role:'unknown',
         equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]}],
      phase:'play',pending:null,turn:0,deck:[],discard:[],
      log:logs.map(function(t){ return {text:t}; }),
      started:true,gameMode:'free' };
  }
  var PUB = '等待其他玩家响应【无懈可击】…';

  check('规则本体在规则层(game.js),展示层薄封装委托给它', function(){
    if(typeof redactWuxiePollingLog!=='function')
      throw new Error('game.js 应导出 redactWuxiePollingLog');
    if(redactWuxiePollingLog('询问 '+SECRET+' 是否使用【无懈可击】…')!==PUB)
      throw new Error('"使用"分支未被脱敏');
    if(redactWuxiePollingLog('询问 '+SECRET+' 是否反制【无懈可击】…')!==PUB)
      throw new Error('"反制"分支(depth>0)未被脱敏');
  });

  check('recentLog 不含被询问者姓名(核心验收)', function(){
    var g=mkG(['某某 使用了【南蛮入侵】','询问 '+SECRET+' 是否使用【无懈可击】…']);
    var ev=buildBotKeyEvents(g,15).join(' | ');
    if(ev.indexOf(SECRET)>=0) throw new Error('姓名泄露到 recentLog:'+ev);
    if(ev.indexOf(PUB)<0) throw new Error('应保留公开语义,实际:'+ev);
  });

  check('座位/编号形式也不会残留(脱敏是整条替换,不是抠掉名字)', function(){
    var g=mkG(['询问 '+SECRET+' 是否反制【无懈可击】…']);
    var ev=buildBotKeyEvents(g,15);
    if(ev.length!==1 || ev[0]!==PUB)
      throw new Error('应恰好剩一条公开文本,实际:'+JSON.stringify(ev));
  });

  check('已公开的实际动作必须原样保留("某人打出【无懈可击】")', function(){
    var g=mkG(['询问 '+SECRET+' 是否使用【无懈可击】…',
               SECRET+' 打出了【无懈可击】']);
    var ev=buildBotKeyEvents(g,15).join(' | ');
    if(ev.indexOf('打出了【无懈可击】')<0)
      throw new Error('公开动作被误删:'+ev);
    // 姓名在这一条里会被 botScrubLogText 换成 AI 代号,这是既有行为(CORE-101),
    // 这里只确认这条动作日志本身没有被脱敏规则吃掉。
  });

  check('脱敏后相邻重复项折叠:一轮询问只占一条', function(){
    var g=mkG(['某某 使用了【万箭齐发】',
               '询问 '+SECRET+' 是否使用【无懈可击】…',
               '询问 李四 是否使用【无懈可击】…',
               '询问 机器人A 是否使用【无懈可击】…']);
    var ev=buildBotKeyEvents(g,15);
    var n=ev.filter(function(t){ return t===PUB; }).length;
    if(n!==1) throw new Error('三次询问应折叠成 1 条,实际 '+n+':'+JSON.stringify(ev));
    if(ev.indexOf('某某 使用了【万箭齐发】')<0 && ev.join('|').indexOf('万箭齐发')<0)
      throw new Error('折叠不应影响其它日志');
  });

  check('折叠只针对那一句公开文本,不误伤其它重复日志', function(){
    var g=mkG(['李四 摸了1张牌x','李四 摸了1张牌x','李四 摸了1张牌x']);
    var ev=buildBotKeyEvents(g,15);
    if(ev.length!==3) throw new Error('其它重复日志不该被折叠,实际 '+ev.length+' 条');
  });

  check('非相邻的两轮询问各留一条(中间隔着别的事件)', function(){
    var g=mkG(['询问 '+SECRET+' 是否使用【无懈可击】…',
               '某某 使用了【顺手牵羊】',
               '询问 李四 是否使用【无懈可击】…']);
    var n=buildBotKeyEvents(g,15).filter(function(t){ return t===PUB; }).length;
    if(n!==2) throw new Error('隔开的两轮应各留一条,实际 '+n);
  });

  check('折叠发生在截断之前:窗口不会被重复项吃掉', function(){
    var logs=[];
    for(var i=0;i<10;i++) logs.push('询问 '+SECRET+' 是否使用【无懈可击】…');
    logs.push('事件甲'); logs.push('事件乙');
    var ev=buildBotKeyEvents(mkG(logs),3);
    if(ev.length!==3) throw new Error('应取满 3 条,实际 '+ev.length);
    if(ev.indexOf('事件甲')<0 || ev.indexOf('事件乙')<0)
      throw new Error('先截断的话真实事件会被重复项挤出去,实际:'+JSON.stringify(ev));
  });

  check('无无懈日志时行为与改动前逐字一致', function(){
    var logs=['甲 使用了【杀】','乙 打出了【闪】','丙 受到1点伤害','丁 进入濒死'];
    var ev=buildBotKeyEvents(mkG(logs),15);
    if(ev.length!==4) throw new Error('条数应不变,实际 '+ev.length);
    if(ev.join('|').indexOf('无懈')>=0) throw new Error('不该凭空多出无懈相关内容');
  });

  check('limit 截断语义不变(取最后 N 条)', function(){
    var ev=buildBotKeyEvents(mkG(['a1','a2','a3','a4','a5']),2);
    if(ev.length!==2 || ev[0]!=='a4' || ev[1]!=='a5')
      throw new Error('应取最后两条,实际 '+JSON.stringify(ev));
  });

  console.log('');
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if(fail) throw new Error('__FAIL__');
})();
`;
vm.runInContext(testCode, sandbox, { filename: 'core148-tests.js' });

// ---- 破坏性验证:必须用全新 sandbox,否则 const/let 重复声明 ----
console.log('\n【破坏性验证】移除脱敏后,姓名应确实出现在 recentLog 里');
const brokenBot = fs.readFileSync('bot.js','utf8')
  .replace('const t = redactFn(events[i]);', 'const t = events[i];');
if(brokenBot === fs.readFileSync('bot.js','utf8')){ console.log('  FAIL 替换未命中'); process.exit(1); }
const ctx2 = vm.createContext(Object.assign({}, context), { name:'sgs-148-broken' });
['data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js',
 'weapons.js','skills.js','ai-bot.js','bot-ai-bus.js'].forEach(function(f){
  vm.runInContext(fs.readFileSync(f,'utf8'), ctx2, { filename:f });
});
vm.runInContext(brokenBot, ctx2, { filename:'bot-broken.js' });
const probe = String.raw`
(function(){
  var S='张三';
  var g={ players:[{name:'机器人A',seat:0,hp:4,maxHp:4,alive:true,hand:[],role:'unknown',
            equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]},
          {name:S,seat:1,hp:4,maxHp:4,alive:true,hand:[],role:'unknown',
            equips:{weapon:null,armor:null,plus1:null,minus1:null},delays:[]}],
    phase:'play',pending:null,turn:0,deck:[],discard:[],
    log:[{text:'询问 '+S+' 是否使用【无懈可击】…'}],started:true,gameMode:'free' };
  var ev=buildBotKeyEvents(g,15).join(' | ');
  // botScrubLogText 会把姓名换成 AI 代号,所以这里查"询问 … 是否使用"这个句式还在不在
  // —— 只要这条轮询日志本身进了 recentLog,它指向的就是某个具体座位,泄露即成立。
  if(/询问 .+ 是否使用【无懈可击】/.test(ev))
    console.log('  PASS 移除脱敏后轮询日志确实进入 recentLog —— 断言能变红 ('+ev+')');
  else { console.log('  FAIL 移除脱敏后竟然仍未泄露:'+ev); throw new Error('__FAIL__'); }
})();
`;
vm.runInContext(probe, ctx2, { filename:'core148-broken-probe.js' });
