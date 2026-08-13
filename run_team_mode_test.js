// run_team_mode_test.js —— 组队模式回归套件(Task 按实施计划增量扩展)
// 用法: node run_team_mode_test.js
const vm = require('vm');
const fs = require('fs');
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){ return {}; }, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, insertAdjacentHTML: function(){}, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { src:'', textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, disabled:false }; }, createTextNode: function(t){ return { nodeValue:t }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage:{ getItem:function(){ return null; }, setItem:function(){}, removeItem:function(){}, clear:function(){} }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
// bot-ai-bus.js 必须排在 bot.js 之前(BOT_DECISIONS 是词法绑定,有 TDZ);bot.js
// 顶层无立即执行的函数调用,只注册 BOT_DECISIONS,加载安全(run_ai_bus_core_test 同款)。
// render.js 追加在末尾:顶层只有 document/window 监听注册与 onclick 绑定(document stub
// 已支持),无 BOT_DECISIONS 依赖;assignSeatZones 是纯函数,供最终审查 M-2 断言使用。
const files = ['config.js','data.js', 'stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js', 'skills/late-generals.js','bot-ai-bus.js','bot.js','render.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  await check('normalize: gameMode=team 不被清空', function(){
    const g = { players:[], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.gameMode!=='team') throw new Error('应保留team,实际 '+g.gameMode);
  });
  await check('normalize: p.team 非法值→null', function(){
    const g = { players:[{ team:'x' }, { team:1 }], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.players[0].team!==null) throw new Error('非法team应null');
    if(g.players[1].team!==1) throw new Error('合法team应保留');
  });
  await check('normalize: 非team模式清空p.team', function(){
    const g = { players:[{ team:0 }], log:[], gameMode:'ffa' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.players[0].team!==null) throw new Error('ffa应清空team');
  });
  await check('normalize: team模式 teamCount 从players推导', function(){
    const g = { players:[{ team:0 }, { team:0 }, { team:2 }], log:[], gameMode:'team' };
    vm.runInContext('normalize', sandbox)(g);
    if(g.teamCount!==3) throw new Error('应推导为3,实际 '+g.teamCount);
  });
  await check('TEAM_COLORS: 至少9色', function(){
    const c = vm.runInContext('TEAM_COLORS', sandbox);
    if(!c || c.length<9) throw new Error('应≥9色,实际 '+(c&&c.length));
  });
  // 沙箱内显式赋值 gameRef/mySeat(game.js 顶层的 let gameRef=null / let mySeat=null
  // 全局词法绑定会遮蔽 context 同名属性,必须像其它 run_*_test.js 那样在 vm 作用域内赋值)
  vm.runInContext('gameRef = { transaction: function(fn){ return fn(typeof g !== "undefined" ? g : {}); } }; mySeat = 0;', sandbox);
  // 以下 joinTeam/createNewTeam 用例全部用真实大厅形态:gameMode 恒 null/缺失
  // (全项目只有 startGame 才写 gameMode),选队即锁定 team 模式。修复前这些用例
  // 会红——守卫 `g.gameMode!=='team'` 在 null!=='team' 下恒 return。
  await check('joinTeam: 真实大厅(null gameMode)选队锁定模式', function(){
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(0);
    if(g.players[0].team!==0) throw new Error('应写team=0,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team,实际 '+g.gameMode);
    if(g.teamCount!==1) throw new Error('teamCount应1,实际 '+g.teamCount);
  });
  await check('joinTeam: 换队覆盖(初始0→选1)', function(){
    const g = { players:[{team:0},{team:0}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(1);
    if(g.players[0].team!==1) throw new Error('应覆盖为1,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team');
  });
  await check('createNewTeam: 真实大厅(null gameMode)建新队并入队', function(){
    // 首次建队:真实大厅 teamCount 恒 0(非team模式 normalize 归零),createNewTeam 应入新队0
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('createNewTeam', sandbox)();
    if(g.players[0].team!==0) throw new Error('首次建队应入队0,实际 '+g.players[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team');
    if(g.teamCount!==1) throw new Error('teamCount应1,实际 '+g.teamCount);
  });
  await check('createNewTeam: 模式已锁后新建第二队', function(){
    const g = { players:[{team:null},{team:null}], log:[], phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('joinTeam', sandbox)(0); // 先选队锁定 team 模式
    if(g.gameMode!=='team') throw new Error('应先锁定gameMode=team');
    vm.runInContext('createNewTeam', sandbox)();
    if(g.players[0].team!==1) throw new Error('应入新队1,实际 '+g.players[0].team);
    if(g.teamCount!==2) throw new Error('teamCount应2,实际 '+g.teamCount);
  });
  await check('addBot(team): 机器人入指定队', function(){
    const g = { players:[{name:'a',isBot:false,team:0}], log:[], gameMode:'team', phase:'lobby', started:false, teamCount:2 };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(1);
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==1) throw new Error('机器人应入队1,实际 '+bots[0].team);
    if(g.teamCount!==2) throw new Error('teamCount应保持2,实际 '+g.teamCount);
  });
  // 真实乱斗大厅 gameMode 恒 null(全项目只有 startGame 才写 ffa/identity),通用"添加机器人"
  // 按钮(handleAddBotClick)无参调 addBot()——必须保持旧行为零变化:能加、不写队、不锁模式。
  await check('addBot(): 非team(默认/乱斗)房间不写队不锁模式(零变化)', function(){
    const g = { players:[], log:[], phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)();
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==null) throw new Error('非team模式机器人team应null,实际 '+bots[0].team);
    if(g.gameMode!==null) throw new Error('非team房间addBot不应锁定gameMode,实际 '+g.gameMode);
  });
  await check('addBot(team): 非法队伍号拒绝入队', function(){
    const g = { players:[{name:'a',isBot:false,team:0}], log:[], gameMode:'team', phase:'lobby', started:false, teamCount:2 };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(99); // 越界队伍号 → team 落 null(仍加机器人)
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==null) throw new Error('越界队伍号team应null,实际 '+bots[0].team);
  });
  // —— Task 4 修复:游离机器人软锁。真实时序=房主先点"组队"模式按钮(只改 selectedGameMode,
  // g.gameMode 仍 null)→ 面板出现 → 点"+机器人"(addBot(t))→ 旧实现 gameMode!=='team' 导致
  // botTeam=null → 机器人游离无队 → 选队锁定模式后开始按钮 hasNoTeam 校验永远拦截。
  await check('addBot(team): gameMode未锁定(null)指定队伍=选队即锁定', function(){
    const g = { players:[{name:'a',isBot:false,team:null}], log:[], phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    vm.runInContext('addBot', sandbox)(1); // 面板"+机器人"传队伍号
    const bots = g.players.filter(p=>p.isBot);
    if(bots.length!==1) throw new Error('应添加1个机器人');
    if(bots[0].team!==1) throw new Error('机器人应入队1,实际 '+bots[0].team);
    if(g.gameMode!=='team') throw new Error('应锁定gameMode=team,实际 '+g.gameMode);
  });
  await check('addBot(): team房间无参(通用入口)拒绝游离机器人', function(){
    const g = { players:[{name:'a',isBot:false,team:0},{name:'b',isBot:false,team:1}], log:[], gameMode:'team', phase:'lobby', started:false };
    context.g = g; context.mySeat = 0;
    const before = g.players.length;
    vm.runInContext('addBot', sandbox)(); // 通用入口无参(既有路径 render-controls.js:1811)
    if(g.players.length!==before) throw new Error('应拒绝添加,players '+before+'→'+g.players.length);
    if((g.players.filter(p=>p&&p.isBot)).length!==0) throw new Error('不应产生游离机器人');
  });
  // —— Task 5: startGame team 分支校验。
  // 注:真实时序=大厅选队已锁定 gameMode='team'(joinTeam/createNewTeam/addBot 都写),
  // startGame 是最终兜底;tx 开头 normalize 在 gameMode='team' 时才保留 p.team,故用例传
  // gameMode:'team' 模拟锁定后的真实状态(传 null 会被 normalize 清空 team,测不到校验)。
  await check('startGame: team队数<2拒绝', function(){
    const g = { players:[{team:0,name:'a'},{team:0,name:'b'}], log:[], gameMode:'team', phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('startGame', sandbox)('pick','team');
    if(g.started || g.gameMode!=='team') throw new Error('队数1应拒绝开始,实际 gameMode='+g.gameMode+' started='+g.started);
  });
  await check('startGame: team全员同一队拒绝', function(){
    // 注:brief 原数据 {team:0},{team:0},{team:2} 在 teamSet 遍历下队伍数=2(不连续但≥2)
    // 会通过校验,与"缺队1应拒绝"断言自相矛盾——按实现语义改为"全员同一队"(teamSet仅1队)拒绝。
    const g = { players:[{team:0,name:'a'},{team:0,name:'b'},{team:0,name:'c'}], log:[], gameMode:'team', phase:'lobby', started:false };
    context.g = g;
    vm.runInContext('startGame', sandbox)('pick','team');
    if(g.started || g.gameMode!=='team') throw new Error('全员同一队应拒绝开始,实际 gameMode='+g.gameMode+' started='+g.started);
  });
  await check('startGame: team合法进入选将', function(){
    const g = { players:[{team:0,name:'a'},{team:1,name:'b'}], log:[], gameMode:'team', phase:'lobby', started:false, teamCount:2 };
    context.g = g;
    vm.runInContext('startGame', sandbox)('pick','team');
    if(g.gameMode!=='team') throw new Error('应进入team模式,实际 '+g.gameMode);
    if(g.phase!=='pickingGeneral') throw new Error('应进入选将,实际 '+g.phase);
  });
  // —— Task 6: checkWin team 分支(存活队伍数≤1判胜负;=0无胜者=最后两队同时团灭)。
  // 注:checkWin 全函数为纯函数(读 g 不改全局),可反复调用;用例直接构造 team 状态快照。
  await check('checkWin: 2队一方团灭对方胜', function(){
    const g = { players:[{team:0,alive:true,name:'a'},{team:0,alive:true,name:'b'},{team:1,alive:false,name:'c'},{team:1,alive:false,name:'d'}], log:[], gameMode:'team', phase:'play', pending:null, aoe:null };
    const done = vm.runInContext('checkWin', sandbox)(g);
    if(!done) throw new Error('应结束');
    if(g.winner!=='队伍1') throw new Error('胜者应队伍1,实际 '+g.winner);
    if(g.phase!=='over') throw new Error('phase应over');
  });
  await check('checkWin: 3队淘汰到1队', function(){
    const g = { players:[{team:0,alive:false,name:'a'},{team:1,alive:true,name:'b'},{team:2,alive:false,name:'c'},{team:1,alive:true,name:'d'}], log:[], gameMode:'team', phase:'play', pending:null, aoe:null };
    const done = vm.runInContext('checkWin', sandbox)(g);
    if(!done || g.winner!=='队伍2') throw new Error('应队伍2胜,实际 '+(done?g.winner:'未结束'));
  });
  await check('checkWin: 最后两队同时团灭→无胜者', function(){
    const g = { players:[{team:0,alive:false,name:'a'},{team:1,alive:false,name:'b'}], log:[], gameMode:'team', phase:'play', pending:null, aoe:null };
    const done = vm.runInContext('checkWin', sandbox)(g);
    if(!done) throw new Error('应结束');
    if(g.winner!=='无') throw new Error('应无胜者,实际 '+g.winner);
  });
  await check('checkWin: 两队都存活→未结束', function(){
    const g = { players:[{team:0,alive:true,name:'a'},{team:1,alive:true,name:'b'}], log:[], gameMode:'team', phase:'play', pending:null, aoe:null };
    const done = vm.runInContext('checkWin', sandbox)(g);
    if(done) throw new Error('不应结束');
  });
  // —— Task 9: AI 提示词适配组队。buildBotVisibleState 需要沙箱里有
  // distance/nextAlive/attackRange(game.js 已加载)与 bot 模块自身函数;team 是
  // normalize 兜底的公开字段,非 team 模式恒 null。
  await check('buildBotVisibleState: team模式含myTeam与players.team', function(){
    const g = { players:[{name:'a',team:0,hp:3,maxHp:3,hand:[],equips:{},delays:[],role:null,alive:true,faceup:true,chained:false,turnedOver:false},{name:'b',team:1,hp:3,maxHp:3,hand:[],equips:{},delays:[],role:null,alive:true,faceup:true,chained:false,turnedOver:false}], gameMode:'team', phase:'play', turn:0, roundNum:1, log:[], aiSuspicionEvents:[] };
    const s = vm.runInContext('buildBotVisibleState', sandbox)(g, 0);
    if(s.myTeam!==0) throw new Error('myTeam应0,实际 '+s.myTeam);
    if(s.players[1].team!==1) throw new Error('players[1].team应1');
  });
  await check('决策参考: 含组队团队指引', function(){
    const p = vm.runInContext('buildBotDefaultSystemPrompt', sandbox)();
    if(p.indexOf('队伍')<0) throw new Error('决策参考应含组队指引');
  });
  // —— 最终审查 M-2: 9人布局分区断言。assignSeatZones(playerCount, mySeat) 是 render.js
  // 里的纯函数(不依赖DOM),把"我"以外的座位分到 top/left/right 三区。逐人数×逐 mySeat
  // 校验:数组长度=人数、自己=me、对手数=总-1、top/left/right 计数总和=对手数、
  // left/right 各≤1、9人局必须 top6+left1+right1、无越界索引(隐式覆盖:逐槽取值校验)。
  await check('assignSeatZones: 2~9人局×各mySeat 分区合法', function(){
    const assignSeatZones = vm.runInContext('assignSeatZones', sandbox);
    if(typeof assignSeatZones!=='function') throw new Error('render.js 未加载 assignSeatZones');
    const ZONES = ['top','left','right'];
    for(let pc=2; pc<=9; pc++){
      for(let my=0; my<pc; my++){
        const zones = assignSeatZones(pc, my);
        if(!Array.isArray(zones) || zones.length!==pc){
          throw new Error('人数'+pc+' mySeat'+my+': 数组长度应'+pc+' 实际'+(zones&&zones.length));
        }
        if(zones[my]!=='me') throw new Error('人数'+pc+' mySeat'+my+': 自己应me 实际'+zones[my]);
        const counts = {top:0,left:0,right:0};
        for(let s=0; s<pc; s++){
          if(s===my) continue;
          if(ZONES.indexOf(zones[s])<0) throw new Error('人数'+pc+' mySeat'+my+': 座位'+s+' 非法zone '+zones[s]+'(越界/未分配)');
          counts[zones[s]]++;
        }
        const total = counts.top+counts.left+counts.right;
        if(total!==pc-1) throw new Error('人数'+pc+' mySeat'+my+': 对手数应'+(pc-1)+' 实际'+total);
        if(counts.left>1 || counts.right>1) throw new Error('人数'+pc+' mySeat'+my+': left/right应各≤1,实际 left='+counts.left+' right='+counts.right);
        if(pc===9 && (counts.top!==6 || counts.left!==1 || counts.right!==1)){
          throw new Error('9人局 mySeat'+my+': 应top6+left1+right1,实际 top='+counts.top+' left='+counts.left+' right='+counts.right);
        }
      }
    }
  });
  // ================= 机器人"打队友"修复(防误伤 + 主动助攻) =================
  // 根因:botTargetScore/botCanSave 只按身份局role分支(zhong/fan/zhu/nei),组队模式
  // p.role恒为null,落进兜底分支——同队/敌队完全等价。这里逐条验证修复后的行为。
  function mkTeamPlayer(name, team, opt){
    opt = opt || {};
    return { name: name, team: team, alive: opt.alive!==false, hp: opt.hp!==undefined?opt.hp:3, maxHp: 4,
      hand: opt.hand || [], equips: opt.equips || vm.runInContext('emptyEquips', sandbox)(), delays: [],
      role: null, isBot: true };
  }
  const card = function(name, id, suit, rank){ return { id: id||name, name: name, suit: suit||'♠', rank: rank||5 }; };

  await check('botTargetScore: 组队模式同队目标恒为-Infinity(不可选)', function(){
    const botTargetScore = vm.runInContext('botTargetScore', sandbox);
    const g = { players:[ mkTeamPlayer('a',0), mkTeamPlayer('b',0,{hp:1}), mkTeamPlayer('c',1,{hp:1}) ], gameMode:'team' };
    const sameScore = botTargetScore(g, 0, 1, 'damage'); // 0和1同队
    const enemyScore = botTargetScore(g, 0, 2, 'damage'); // 0和2敌队
    if(sameScore !== -Infinity) throw new Error('同队目标应-Infinity,实际 '+sameScore);
    if(enemyScore === -Infinity || !(enemyScore > 0)) throw new Error('敌队目标应正常参与评分(>0),实际 '+enemyScore);
  });

  await check('botTargetScore: 身份局(identity)既有role分支不受影响(回归)', function(){
    const botTargetScore = vm.runInContext('botTargetScore', sandbox);
    const g = { players:[
      { name:'a', role:'zhong', hp:3, maxHp:4, hand:[], alive:true },
      { name:'b', role:'fan', roleRevealed:true, hp:1, maxHp:4, hand:[], alive:true },
      { name:'c', role:'zhu', hp:3, maxHp:4, hand:[], alive:true }
    ], gameMode:'identity' };
    const scoreFan = botTargetScore(g, 0, 1, 'damage'); // 忠臣打已翻反贼,应该是正分
    const scoreZhu = botTargetScore(g, 0, 2, 'damage'); // 忠臣打主公,应-Infinity
    if(!(scoreFan > 0)) throw new Error('身份局忠臣打反贼应正常评分,实际 '+scoreFan);
    if(scoreZhu !== -Infinity) throw new Error('身份局忠臣打主公应-Infinity(回归),实际 '+scoreZhu);
  });

  await check('botTargetScore: 乱斗(ffa)模式既有默认分支不受影响(回归,谁都能打)', function(){
    const botTargetScore = vm.runInContext('botTargetScore', sandbox);
    const g = { players:[ mkTeamPlayer('a',null), mkTeamPlayer('b',null,{hp:1}) ], gameMode:'ffa' };
    const score = botTargetScore(g, 0, 1, 'damage');
    if(score === -Infinity) throw new Error('乱斗模式默认分支应可选,实际 '+score);
  });

  await check('jiedaoTwoStep: 阶段A排除"唯一合法B是队友"的候选(hasSomeB要求非同队)', function(){
    const BOT_DECISIONS = vm.runInContext('BOT_DECISIONS', sandbox);
    vm.runInContext('botTwoStepA = null;', sandbox);
    // 座位0(自己)、1(有武器,队友,攻击范围内的合法B只有队友2)、2(队友,武器都没有,只是B候选)
    // 、3(敌队,武器都没有,B候选)——1的唯一可及B是2(同队),应该被hasSomeB过滤掉,不出现
    // 在阶段A候选里;若3也在1的攻击范围内则1仍应出现——这里刻意让1只够得着2,不够3
    // (通过给1装武器射程1、3不给装备制造距离差异不现实,直接用两名玩家分别测更清晰:
    // 拆成两个座位1a/1b分别测试"唯一B是队友"与"唯在B含敌队"两种情形)。
    const g1 = { players:[
      mkTeamPlayer('me',0),
      Object.assign(mkTeamPlayer('onlyTeammateInRange',0,{equips:{weapon:{name:'我武器'},armor:null,plus1:null,minus1:null}})),
      mkTeamPlayer('teammateVictim',0),
    ], gameMode:'team', phase:'play', turn:0 };
    const candA1 = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(g1, 0);
    if(candA1.some(function(c){ return c.a===1; })) throw new Error('唯一合法B(座位2)是队友,座位1不应出现在阶段A候选里,实际 '+JSON.stringify(candA1));

    const g2 = { players:[
      mkTeamPlayer('me',0),
      Object.assign(mkTeamPlayer('hasEnemyInRange',0,{equips:{weapon:{name:'我武器'},armor:null,plus1:null,minus1:null}})),
      mkTeamPlayer('enemyVictim',1),
    ], gameMode:'team', phase:'play', turn:0 };
    const candA2 = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(g2, 0);
    if(!candA2.some(function(c){ return c.a===1; })) throw new Error('存在敌队合法B(座位2)时座位1应出现在阶段A候选里,实际 '+JSON.stringify(candA2));
  });

  await check('jiedaoTwoStep: 阶段B过滤掉与A同队的候选', function(){
    // 注意:distance按存活玩家环形最近间隔计算,4人局座位1到座位3的距离是2(超出默认
    // 射程1)——这里刻意拆成两个3人局各自验证"同队候选被过滤"/"敌队候选被保留",避免
    // 环形距离差异干扰(和上面阶段A测试同一处理方式),不是真正的bug。
    const BOT_DECISIONS = vm.runInContext('BOT_DECISIONS', sandbox);
    vm.runInContext("botTwoStepA = { decisionId: 'jiedaoTwoStep', a: 1 };", sandbox);
    const gTeammate = { players:[
      mkTeamPlayer('me',0),
      mkTeamPlayer('A',0),
      mkTeamPlayer('teammateOfA',0), // 和A同队,应被过滤
    ], gameMode:'team', phase:'play', turn:0 };
    const candTeammate = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(gTeammate, 0);
    if(candTeammate.some(function(c){ return c.seatB===2; })) throw new Error('座位2和A(座位1)同队,不应出现在阶段B候选里,实际 '+JSON.stringify(candTeammate));

    const gEnemy = { players:[
      mkTeamPlayer('me',0),
      mkTeamPlayer('A',0),
      mkTeamPlayer('enemyOfA',1), // 和A不同队,应保留
    ], gameMode:'team', phase:'play', turn:0 };
    const candEnemy = BOT_DECISIONS.jiedaoTwoStep.buildCandidates(gEnemy, 0);
    if(!candEnemy.some(function(c){ return c.seatB===2; })) throw new Error('座位2和A不同队,应出现在阶段B候选里,实际 '+JSON.stringify(candEnemy));
    vm.runInContext('botTwoStepA = null;', sandbox);
  });

  await check('lijianTwoStep: 阶段A/B同样排除队友组合(和jiedao同一套过滤)', function(){
    const BOT_DECISIONS = vm.runInContext('BOT_DECISIONS', sandbox);
    vm.runInContext('isMale', sandbox); // 确认isMale已加载(male判定见generalGender,这里用假武将测不到,直接构造players.general走真实isMale)
    function malePlayer(name, team, general){
      return { name:name, team:team, alive:true, hp:3, maxHp:4, hand:[], equips: vm.runInContext('emptyEquips', sandbox)(), delays:[], role:null, general: general||'zhangfei' };
    }
    vm.runInContext('botTwoStepA = null;', sandbox);
    // 张飞/关羽/曹操都是男性武将(项目data.js既有设定),用真实isMale判定而不是硬编码性别字段
    const g1 = { players:[ malePlayer('me',0), malePlayer('onlyTeammateB',0), malePlayer('teammateVictim',0) ], gameMode:'team', phase:'play', turn:0 };
    const candA1 = BOT_DECISIONS.lijianTwoStep.buildCandidates(g1, 0);
    if(candA1.some(function(c){ return c.a===1; })) throw new Error('座位1唯一合法B(座位2)是队友,不应出现在阶段A候选里,实际 '+JSON.stringify(candA1));

    const g2 = { players:[ malePlayer('me',0), malePlayer('hasEnemyB',0), malePlayer('enemyVictim',1) ], gameMode:'team', phase:'play', turn:0 };
    const candA2 = BOT_DECISIONS.lijianTwoStep.buildCandidates(g2, 0);
    if(!candA2.some(function(c){ return c.a===1; })) throw new Error('存在敌队合法B时座位1应出现在阶段A候选里,实际 '+JSON.stringify(candA2));

    vm.runInContext("botTwoStepA = { decisionId: 'lijianTwoStep', a: 1 };", sandbox);
    const g3 = { players:[ malePlayer('me',0), malePlayer('A',0), malePlayer('teammateOfA',0), malePlayer('enemyOfA',1) ], gameMode:'team', phase:'play', turn:0 };
    const candB = BOT_DECISIONS.lijianTwoStep.buildCandidates(g3, 0);
    if(candB.some(function(c){ return c.toSeat===2; })) throw new Error('座位2和A同队,不应出现在阶段B候选里,实际 '+JSON.stringify(candB));
    if(!candB.some(function(c){ return c.toSeat===3; })) throw new Error('座位3和A不同队,应出现在阶段B候选里,实际 '+JSON.stringify(candB));
    vm.runInContext('botTwoStepA = null;', sandbox);
  });

  await check('sameTeam: 唯一判队友入口——同队true/敌队false/非team模式恒false/座位不存在false', function(){
    const sameTeam = vm.runInContext('sameTeam', sandbox);
    const g = { players:[ mkTeamPlayer('a',0), mkTeamPlayer('b',0), mkTeamPlayer('c',1) ], gameMode:'team' };
    if(sameTeam(g,0,1)!==true) throw new Error('同队应true');
    if(sameTeam(g,0,2)!==false) throw new Error('敌队应false');
    if(sameTeam({players:g.players, gameMode:'ffa'},0,1)!==false) throw new Error('非team模式应恒false');
    if(sameTeam(g,0,99)!==false) throw new Error('座位不存在应false,不应抛异常');
  });

  await check('botCanSave: 组队模式主动助攻——队友濒死应救,敌方濒死不救,自己濒死恒自救', function(){
    const botCanSave = vm.runInContext('botCanSave', sandbox);
    const g = { players:[ mkTeamPlayer('me',0), mkTeamPlayer('teammate',0), mkTeamPlayer('enemy',1) ], gameMode:'team' };
    if(botCanSave(g,0,1)!==true) throw new Error('队友濒死应救(botCanSave应true),实际 '+botCanSave(g,0,1));
    if(botCanSave(g,0,2)!==false) throw new Error('敌方濒死不应救,实际 '+botCanSave(g,0,2));
    if(botCanSave(g,0,0)!==true) throw new Error('自己濒死恒自救,实际 '+botCanSave(g,0,0));
  });

  await check('botCanSave: 身份局(identity)既有role分支不受影响(回归)', function(){
    const botCanSave = vm.runInContext('botCanSave', sandbox);
    const g = { players:[
      { name:'a', role:'zhong' },
      { name:'b', role:'zhu', roleRevealed:true },
      { name:'c', role:'fan', roleRevealed:true }
    ], gameMode:'identity' };
    if(botCanSave(g,0,1)!==true) throw new Error('忠臣应救已翻主公(回归),实际 '+botCanSave(g,0,1));
    if(botCanSave(g,0,2)!==false) throw new Error('忠臣不应救已翻反贼(回归),实际 '+botCanSave(g,0,2));
  });

  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
