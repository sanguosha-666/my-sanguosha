// 确定正收益技能自动发动(用户直接要求,非issue追踪):铁骑(马超)/烈弓(黄忠)/连营(陆逊)/
// 闭月(貂蝉)/礼让回收(孔融)/酒诗翻正面(曹植)/落英拾取(甄姬)/洛神判定(甄姬)——这8个技能
// 对发动者自己都是binary发动/不发动,且"不发动"完全没有意义(纯损失或和发动等价的空转),
// 不再向真人/机器人弹出确认框,直接在服务端自动生效。覆盖范围:游戏规则层(不再创建对应
// 的交互 pending),不影响 CARD_PLAYS.*.canTarget 等其它规则。
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const run=code=>vm.runInContext(code,sandbox);
run('tx=function(fn){return fn(__g);};mySeat=0;');
const eq=()=>run('emptyEquips')();
const card=(id,name,suit,rank)=>({id,name,suit:suit||'♠',rank:rank||7});

let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}

// ---- 1. 铁骑(马超):使用杀后直接判定,不再挂起 g.phase='tieqi' 询问 ----
check('铁骑(马超):出杀后不再挂起是否发动的询问,直接判定生效', function(){
  const machao={name:'马超',general:'machao',hp:4,maxHp:4,hand:[card('s1','杀')],equips:eq(),delays:[],alive:true};
  const target={name:'目标',hp:4,maxHp:4,hand:[card('h1','闪','♥')],equips:eq(),delays:[],alive:true};
  const g={players:[machao,target],deck:[card('d1','杀','♠')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)");
  if(g.phase==='tieqi') throw new Error('不应再出现tieqi询问阶段,实际phase='+g.phase);
  if(g.phase!=='respond') throw new Error('应直接判定完毕进入respond阶段等待闪,实际phase='+g.phase);
  if(g.log.some(l=>l.text&&l.text.indexOf('是否发动')>=0)) throw new Error('日志不应再出现"是否发动"字样');
});

// ---- 2. 烈弓(黄忠):数值条件满足时直接生效,noShan=true 直达respond ----
check('烈弓(黄忠):数值条件满足时不再挂起询问,直接令杀不可被闪抵消', function(){
  const huangzhong={name:'黄忠',general:'huangzhong',hp:4,maxHp:4,hand:[card('s1','杀')],equips:eq(),delays:[],alive:true};
  const target={name:'目标',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true}; // 手牌0张,满足数值条件
  const g={players:[huangzhong,target],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
  sandbox.__g=g;
  run("playCard(0,'杀',1)");
  if(g.phase==='liegong') throw new Error('不应再出现liegong询问阶段,实际phase='+g.phase);
  if(!g.pending || !g.pending.noShan) throw new Error('应直接生效,pending.noShan应为true,实际 '+JSON.stringify(g.pending));
});

// ---- 3. 连营(陆逊):失去最后一张手牌后直接摸牌,不再询问 ----
check('连营(陆逊):失去最后一张手牌后直接摸1张,不再挂起询问', function(){
  const luxun={name:'陆逊',general:'luxun',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true};
  const other={name:'对手',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
  const g={players:[luxun,other],deck:[card('d1','闪','♥')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,lianyingQueue:[]};
  sandbox.__g=g;
  // 直接模拟"手牌已变为0"这一刻(和 run_luxun_test.js 同一惯例),不经过完整杀/响应链路
  // (那条链路会在结算过程中打开另一个'respond'pending,tryFlushLianying要等它清空才会
  // 生效——这是队列本身"不抢占其它更高优先级pending"的既有设计,不是这次改动的对象)。
  const queued=run('maybeStartLianying(__g,0,1)');
  if(!queued) throw new Error('失去最后一张手牌应排入连营队列');
  const flushed=run('tryFlushLianying(__g)');
  if(!flushed) throw new Error('空闲时应直接生效');
  if(g.pending && g.pending.type==='lianyingAsk') throw new Error('不应再出现lianyingAsk询问阶段');
  if(g.players[0].hand.length!==1) throw new Error('应自动摸回1张,实际手牌数='+g.players[0].hand.length);
});

// ---- 4. 闭月(貂蝉):回合结束时直接摸牌,不再询问 ----
check('闭月(貂蝉):回合结束时直接摸1张,不再挂起询问', function(){
  const diaochan={name:'貂蝉',general:'diaochan',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true};
  const other={name:'对手',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
  const g={players:[diaochan,other],deck:[card('d1','闪','♥')],discard:[],log:[],phase:'discard',turn:0,roundNum:1,gameMode:'ffa',pending:null};
  sandbox.__g=g;
  run('continueBiyueCheck(__g,0)');
  if(g.phase==='biyue') throw new Error('不应再出现biyue询问阶段,实际phase='+g.phase);
  if(g.players[0].hand.length!==1) throw new Error('应自动摸1张,实际手牌数='+g.players[0].hand.length);
});

// ---- 5. 礼让回收(孔融):回合结束时直接拿回弃置的牌,不再询问 ----
check('礼让回收(孔融):回合结束时直接拿回本弃牌阶段弃置的牌,不再挂起询问', function(){
  const kong={name:'孔融',general:'kongrong',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true};
  const other={name:'对手',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
  const discardedCard=card('lr1','杀');
  const g={
    players:[kong,other],deck:[],discard:[discardedCard],log:[],phase:'discard',turn:1,roundNum:1,gameMode:'ffa',pending:null,
    liRangRecord:{round:1,from:0,to:1,discarded:[discardedCard]}
  };
  sandbox.__g=g;
  const opened=run('maybeStartLiRangRecover(__g,1)');
  if(!opened) throw new Error('应确认满足礼让回收条件(返回true)');
  if(g.phase==='lirangRecover') throw new Error('不应再出现lirangRecover询问阶段,实际phase='+g.phase);
  if(g.players[0].hand.length!==1 || g.players[0].hand[0].id!=='lr1') throw new Error('应自动拿回弃置的牌,实际手牌='+JSON.stringify(g.players[0].hand));
  if(g.discard.length!==0) throw new Error('拿回的牌应从弃牌堆移除');
});

// ---- 6. 酒诗翻正面(曹植):受伤后直接翻回正面,不再询问 ----
check('酒诗翻正面(曹植):受伤后直接翻回正面,不再挂起询问', function(){
  const caozhi={name:'曹植',general:'caozhi',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true,faceup:false,caps:{jiushi:true}};
  const g={players:[caozhi],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,
    afterDamageEffects:{seat:0,index:0,actions:['jiushi'],sourceSeat:0,amount:1,jiushiFacedownAtDamage:true}};
  sandbox.__g=g;
  const handled=run('continueAfterDamageEffects(__g)');
  if(g.phase==='jiushiFlipAsk') throw new Error('不应再出现jiushiFlipAsk询问阶段,实际phase='+g.phase);
  if(g.players[0].faceup!==true) throw new Error('应自动翻回正面,实际faceup='+g.players[0].faceup);
});

// ---- 7. 落英拾取(甄姬):弃牌堆出现梅花牌后直接拾取,不再询问 ----
check('落英拾取(甄姬):判定/弃牌产生梅花牌后直接拾取,不再挂起询问', function(){
  const other={name:'对手',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
  const zhenji={name:'甄姬',general:'zhenji',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true,caps:{luoying:true}};
  const clubCard=card('lu1','杀','♣');
  const g={players:[other,zhenji],deck:[],discard:[clubCard],log:[],phase:'discard',turn:0,roundNum:1,gameMode:'ffa',pending:null};
  sandbox.__g=g;
  const opened=run("maybeStartLuoying(__g,0,[__g.discard[0]],'discard',{phase:'discard'})");
  if(!opened) throw new Error('应确认满足落英拾取条件(返回true)');
  if(g.phase==='luoyingAsk') throw new Error('不应再出现luoyingAsk询问阶段,实际phase='+g.phase);
  if(g.players[1].hand.length!==1 || g.players[1].hand[0].id!=='lu1') throw new Error('应自动拾取梅花牌,实际手牌='+JSON.stringify(g.players[1].hand));
  if(g.discard.length!==0) throw new Error('拾取的牌应从弃牌堆移除');
});

// CORE-139:延时锦囊经鬼才改判后，梅花判定牌触发自动落英。落英会在内部直接续接
// 判定流程并保持 pending=null；finishGuicai 不得再把返回的 'pending' 当成对象读取.type。
check('CORE-139:鬼才改判延时锦囊触发自动落英时不得读取null pending.type', function(){
  const judged={name:'判定者',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true};
  const caozhi={name:'曹植',general:'caozhi',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true,caps:{luoying:true}};
  const finalCard=card('judge-club','杀','♣');
  const delayCard=card('delay-lebu','乐不思蜀','♥');
  const g={players:[judged,caozhi],deck:[],discard:[finalCard],log:[],phase:'guicai',turn:0,roundNum:1,gameMode:'ffa',pending:{
    type:'guicai',seat:0,asking:1,judgeCard:finalCard,
    resume:{kind:'delayJudge',seat:0,trickName:'乐不思蜀',card:delayCard}
  }};
  sandbox.__g=g;
  run('finishGuicai(__g,__g.pending.judgeCard)');
  if(g.pending!==null) throw new Error('自动落英续接后不应残留pending,实际 '+JSON.stringify(g.pending));
  if(g.players[1].hand.length!==1 || g.players[1].hand[0].id!=='judge-club') throw new Error('曹植应获得梅花判定牌');
  if(g.phase!=='draw') throw new Error('延时锦囊判定应只续接一次并进入摸牌阶段,实际phase='+g.phase);
});

// ---- 8. 洛神判定(甄姬):回合开始自动循环判定,黑色继续、红色结束,不再逐轮询问 ----
check('洛神判定(甄姬):黑色应自动继续判定(不逐轮询问),红色应结束并进入摸牌阶段', function(){
  const zhenji={name:'甄姬',general:'zhenji',hp:3,maxHp:3,hand:[],equips:eq(),delays:[],alive:true,caps:{luoshen:true},faceup:true};
  // 牌堆自底向上pop:黑桃(继续)、黑桃(继续)、红桃(结束) —— deck.pop()从数组末尾取,
  // 数组顺序写成[红桃, 黑桃, 黑桃]时pop顺序是黑桃→黑桃→红桃。
  const g={players:[zhenji],deck:[card('r1','A','♥',1),card('b2','2','♠',2),card('b1','3','♠',3)],discard:[],log:[],
    phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
  sandbox.__g=g;
  run('continueTurnStart(__g,0)');
  if(g.phase==='luoshen') throw new Error('不应再出现luoshen逐轮询问阶段,实际phase='+g.phase);
  // 应该已经循环判定完:黑、黑、红,拿到2张判定牌(2张黑桃),最终进入摸牌阶段
  if(g.players[0].hand.length!==2) throw new Error('应自动循环拿到2张黑色判定牌,实际手牌数='+g.players[0].hand.length);
  if(g.phase!=='draw') throw new Error('判红结束后应自动进入摸牌阶段,实际phase='+g.phase);
});

console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
if(fail>0) process.exit(1);
