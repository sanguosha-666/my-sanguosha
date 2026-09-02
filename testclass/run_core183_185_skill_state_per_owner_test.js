// CORE-183/184/185(issue #245/#246/#247):三个技能的"限次/记录"状态原本存成游戏级单份
// (g.guhuoUsed / g.luanwuUsed / g.liRangRound+g.liRangRecord),不记录是谁用掉的。
// 左慈化身可以让同一个技能同时有两个拥有者,于是一方用掉、另一方直接失效。
// 本测试锁定:三者都改成按拥有者各记一份,两个拥有者互不影响;单拥有者场景行为不变。
//
// (与 CORE-182/#244「缠怨按蛊惑来源分离」同一类缺陷,那条已单独有 run_core182_* 覆盖。)
const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);};');
const setSeat=s=>R('mySeat='+s+';');
const eq=()=>R('emptyEquips')();
const card=(id,name='杀')=>({id,name,suit:'♠',rank:7});
const mkP=(name,general,hand,extra={})=>Object.assign(
  {name,general,hp:4,maxHp:4,hand,equips:eq(),delays:[],alive:true,chanyuan:false,chanyuanSources:[]},extra);
const huashen=(general,skill)=>({huashenPool:[general],huashenGeneral:general,huashenSkillName:skill});
// 真实 tx 每次都会先跑 normalize,测试装载快照时同样先过一遍,保证字段默认值与线上一致
const use=gg=>{ sandbox.__g=gg; R('normalize(__g)'); return gg; };
let pass=0;
const check=(name,fn)=>{ fn(); console.log('  PASS '+name); pass++; };

// ============ CORE-183:于吉【蛊惑】每回合限一次 ============
// 三人局:座位0 甲(曹操,当前回合)、座位1 真实于吉、座位2 左慈化身于吉。
// 关键前提:蛊惑可以在【别人的回合】作为响应打出,所以两个拥有者会在同一个回合里相遇。
function guhuoG(){
  return {players:[
    mkP('甲','caocao',[card('a1','杀')]),
    mkP('于吉真','yuji',[card('y1','杀'),card('y2','杀')]),
    mkP('左慈','zuoci',[card('z1','杀'),card('z2','杀')],huashen('yuji','蛊惑'))
  ],deck:[card('d1'),card('d2'),card('d3')],discard:[],log:[],
  phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
}
let g=guhuoG(); use(g);
// 前提断言:两人确实都拥有蛊惑,否则后面的断言会因前提不成立而"永远绿"
check('CORE-183 前提:真实于吉与左慈化身于吉都拥有【蛊惑】',()=>{
  assert.ok(R('hasCap')(g.players[1],'guhuo'));
  assert.ok(R('hasCap')(g.players[2],'guhuo'));
});

check('CORE-183 一方在别人回合用蛊惑响应后,另一方同回合仍能用(核心)',()=>{
  g=guhuoG(); g.phase='respond'; g.pending={type:'sha',from:0,to:1}; use(g);
  assert.strictEqual(R('canStartGuhuoResponse')(g,1,'闪'),true,'于吉真被杀时应能用蛊惑当闪');
  setSeat(1); R("startGuhuoResponse(0,'闪')");
  assert.strictEqual(g.players[1].guhuoUsed,true,'消耗应记在发动者自己身上');
  assert.strictEqual(g.turn,0,'这确实发生在别人(座位0)的回合里');
  assert.strictEqual(g.players[2].guhuoUsed,false,'不得记到另一个拥有者头上');
  g.phase='respond'; g.pending={type:'sha',from:0,to:2};
  assert.strictEqual(R('canStartGuhuoResponse')(g,2,'闪'),true,'左慈同一回合内仍应能用自己的蛊惑');
});

check('CORE-183 各自的每回合限一次仍然有效(旧语义不回归)',()=>{
  g=guhuoG(); g.phase='respond'; g.pending={type:'sha',from:0,to:1}; use(g);
  setSeat(1); R("startGuhuoResponse(0,'闪')");
  g.phase='respond'; g.pending={type:'sha',from:0,to:1};
  assert.strictEqual(R('canStartGuhuoResponse')(g,1,'闪'),false,'自己本回合用过后不能再用');
});

check('CORE-183 一方用掉蛊惑不再影响另一方"是否值得被问无懈"',()=>{
  g=guhuoG(); use(g);
  g.players[1].guhuoUsed=true;                    // 于吉真本回合已用过
  R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.type,'wuxie','左慈仍有蛊惑,应逐人询问而不是公共等待窗');
  assert.strictEqual(g.pending.asking,2,'应问到仍能用蛊惑的左慈(座位2)');
});

check('CORE-183 startTurn 对全员重置(不是只重置回合玩家)',()=>{
  g=guhuoG(); use(g);
  g.players[1].guhuoUsed=true; g.players[2].guhuoUsed=true;
  R('startTurn(__g, 0)');
  assert.strictEqual(g.players[1].guhuoUsed,false);
  assert.strictEqual(g.players[2].guhuoUsed,false,'非回合玩家的本回合标志同样要清(规则27)');
});

// ============ CORE-184:贾诩【乱武】限定技(每人整局一次) ============
// 【重要:本段的场景在 CORE-191(issue #253)之后已不可达,断言随之改写】
// CORE-184 当初修的是"左慈化身贾诩和真贾诩共用全局 g.luanwuUsed,一方发动会把另一方的
// 限定技整局消耗掉"。CORE-191 按官方【化身】规则把限定技/觉醒技/主公技整体排除出可借用
// 范围,乱武已从 HUASHEN_SKILL_TABLE 移除——**左慈再也借不到乱武,"两个乱武拥有者同时
// 在场"这个前提不复存在**,原来那三条"两个拥有者互不影响"的断言现在连场景都构造不出来。
// 改动本身依然正确且保留:限定技状态记在玩家身上(p.luanwuUsed)本来就比全局一份更准确,
// 也和同为限定技的庞统涅槃 p.nirvanaUsed 口径一致;只是它现在守的是一个不再可达的场景。
// 所以这里不再假装测"两个拥有者",改为钉住仍然成立、且真正在生效的那部分语义:
// 限定技状态是玩家级的、startTurn 不重置、跨局重置。
// (删掉整段也是一种选择,但那样 p.luanwuUsed 的玩家级语义就完全没有断言覆盖了。)
function luanwuG(){
  return {players:[
    mkP('甲','caocao',[card('a1','杀')]),
    mkP('贾诩真','jiaxu',[card('j1','杀')]),
    mkP('乙','liubei',[card('b1','杀')])
  ],deck:[card('d1'),card('d2')],discard:[],log:[],
  phase:'play',turn:1,roundNum:1,gameMode:'ffa',pending:null};
}
check('CORE-191 前提:乱武是限定技,左慈已不可借用(CORE-184 的两拥有者场景因此不可达)',()=>{
  const zuoci=mkP('左慈','zuoci',[],huashen('jiaxu','乱武'));
  g=luanwuG(); g.players[2]=zuoci; use(g);
  assert.ok(R('hasCap')(g.players[1],'luanwu'),'真贾诩当然仍有乱武');
  assert.strictEqual(R('hasCap')(g.players[2],'luanwu'),false,'左慈不得再通过化身获得乱武');
  assert.strictEqual(R('validateHuashenPick')(['jiaxu'],'jiaxu','乱武'),false,'声明本身就该被拒绝');
});

check('CORE-184 限定技消耗记在发动者自己身上(玩家级,不是全局一份)',()=>{
  g=luanwuG(); use(g);
  setSeat(1); R('startLuanwu()');
  assert.strictEqual(g.players[1].luanwuUsed,true,'消耗应记在发动者身上');
  assert.strictEqual(g.players[2].luanwuUsed,false,'不得记到别人头上');
  assert.strictEqual(g.phase,'luanwuChoose','本人发动应正常开启选择阶段');
});

check('CORE-184 整局只能发动一次,且 startTurn 不重置(限定技语义不变)',()=>{
  g=luanwuG(); use(g);
  setSeat(1); R('startLuanwu()');
  R('startTurn(__g, 1)');
  assert.strictEqual(g.players[1].luanwuUsed,true,'限定技不得被 startTurn 重置');
  g.phase='play'; g.turn=1; g.pending=null;
  setSeat(1); R('startLuanwu()');
  assert.strictEqual(g.pending,null,'自己发动过之后本局不能再发动');
});

// ============ CORE-185:孔融【礼让】每轮限一次 + 送牌记录 ============
function lirangG(round){
  return {players:[
    mkP('甲','caocao',[card('a1','杀')]),
    mkP('孔融真','kongrong',[card('k1','杀'),card('k2','闪'),card('k3','桃')]),
    mkP('左慈','zuoci',[card('z1','杀'),card('z2','闪'),card('z3','桃')],huashen('kongrong','礼让'))
  ],deck:[card('d1'),card('d2')],discard:[],log:[],
  phase:'lirangAsk',turn:1,roundNum:round,gameMode:'ffa',pending:{type:'lirangAsk',from:1,to:0}};
}
g=lirangG(3); use(g);
check('CORE-185 前提:真实孔融与左慈化身孔融都拥有【礼让】',()=>{
  assert.ok(R('hasCap')(g.players[1],'lirang'));
  assert.ok(R('hasCap')(g.players[2],'lirang'));
});

check('CORE-185 一方本轮用过礼让后,另一方同轮仍会被询问、仍能发动(核心)',()=>{
  g=lirangG(3); use(g);
  setSeat(1); R('respondLiRang(true,[0,1])');
  assert.strictEqual(g.players[1].liRangRound,3,'每轮限一次应记在发动者自己身上');
  assert.strictEqual(g.players[2].liRangRound,0,'不得顶掉另一个拥有者');
  assert.strictEqual(R('eligibleLiRangSeat')(g,0),2,'同轮内左慈仍应被认作礼让候选人');
  g.phase='lirangAsk'; g.turn=2; g.pending={type:'lirangAsk',from:2,to:0}; use(g);
  const before=g.players[2].hand.length;
  setSeat(2); R('respondLiRang(true,[0,1])');
  assert.strictEqual(g.players[2].hand.length,before-2,'左慈应真的送出两张牌(发动成功)');
  assert.strictEqual(g.players[2].liRangRound,3);
});

check('CORE-185 各自的每轮限一次仍然有效(旧语义不回归)',()=>{
  g=lirangG(3); use(g);
  setSeat(1); R('respondLiRang(true,[0,1])');
  g.phase='lirangAsk'; g.pending={type:'lirangAsk',from:1,to:0};
  const before=g.players[1].hand.length;
  setSeat(1); R('respondLiRang(true,[0,0])');
  assert.strictEqual(g.players[1].hand.length,before,'同一个人同一轮不能再发动第二次');
  assert.strictEqual(R('eligibleLiRangSeat')(g,0),2,'但另一个拥有者仍是候选人');
});

check('CORE-185 两份送牌记录互不覆盖,各自只回收自己送出的那份',()=>{
  g=lirangG(3); use(g);
  // 两个孔融本轮都把牌送给了座位0
  setSeat(1); R('respondLiRang(true,[0,1])');
  g.phase='lirangAsk'; g.turn=2; g.pending={type:'lirangAsk',from:2,to:0}; use(g);
  setSeat(2); R('respondLiRang(true,[0,1])');
  const r1=g.players[1].liRangRecord, r2=g.players[2].liRangRecord;
  assert.ok(r1 && r2,'两份记录都应存在,不被对方覆盖');
  assert.strictEqual(r1.to,0); assert.strictEqual(r2.to,0);
  assert.notStrictEqual(r1,r2,'必须是两份独立记录,不是同一个对象');
  // 座位0 在自己弃牌阶段弃掉两张牌 -> 两份记录都应记账
  g.phase='discard'; g.turn=0; g.pending=null;
  // 手牌必须真的超出上限,discardCards 才会受理(hp4 -> 上限4,给6张、弃2张)
  g.players[0].hand=[card('x1','杀'),card('x2','闪'),card('x3','桃'),card('x4','杀'),card('x5','闪'),card('x6','桃')];
  use(g);
  setSeat(0); R('discardCards([0,1])');
  assert.strictEqual(r1.discarded.length,2,'孔融真的记录应记到弃牌');
  assert.strictEqual(r2.discarded.length,2,'左慈的记录同样应记到弃牌(各记各的)');
  // 回收:两张牌总共只有两张,先手的孔融拿走后,后一位过滤时弃牌堆里已没有,不重复回收
  const h1=g.players[1].hand.length, h2=g.players[2].hand.length;
  const handled=R('maybeStartLiRangRecover')(g,0);
  assert.strictEqual(handled,true,'应触发礼让回收');
  const gained=(g.players[1].hand.length-h1)+(g.players[2].hand.length-h2);
  assert.strictEqual(gained,2,'两人合计只应回收实际弃掉的2张,不得重复回收');
});

check('CORE-185 争义查的是这名孔融自己的礼让记录,不被另一个孔融顶掉',()=>{
  g=lirangG(3); use(g);
  setSeat(1); R('respondLiRang(true,[0,1])');          // 孔融真 送给座位0
  g.phase='lirangAsk'; g.turn=2; g.pending={type:'lirangAsk',from:2,to:0}; use(g);
  setSeat(2); R('respondLiRang(true,[0,1])');          // 左慈 也送给座位0(后发生)
  assert.strictEqual(R('zhengyiRecipient')(g,1),0,'孔融真的争义仍应找到自己那份记录的接收者');
});

check('CORE-185 单个礼让拥有者场景行为不变',()=>{
  g=lirangG(5);
  g.players[2]=mkP('乙','liubei',[card('b1','杀')]);   // 场上只剩一个孔融
  use(g);
  assert.strictEqual(R('eligibleLiRangSeat')(g,0),1);
  setSeat(1); R('respondLiRang(true,[0,1])');
  assert.strictEqual(g.players[1].liRangRound,5);
  assert.strictEqual(R('eligibleLiRangSeat')(g,0),null,'本轮已用过,不应再被询问');
});

// ============ normalize 防御 ============
check('normalize 对三个新玩家级字段都补默认值',()=>{
  g=guhuoG();
  delete g.players[1].guhuoUsed; delete g.players[1].luanwuUsed;
  delete g.players[1].liRangRound; delete g.players[1].liRangRecord;
  sandbox.__g=g; R('normalize(__g)');
  const p=g.players[1];
  assert.strictEqual(p.guhuoUsed,false);
  assert.strictEqual(p.luanwuUsed,false);
  assert.strictEqual(p.liRangRound,0);
  assert.strictEqual(p.liRangRecord,null);
});

check('normalize 只清结构性脏数据,不清"还没弃牌"的合法中间态(规则25)',()=>{
  g=lirangG(3);
  g.players[1].liRangRecord={round:3,to:0,discarded:[]};   // 刚送完牌、接收者还没弃牌
  sandbox.__g=g; R('normalize(__g)');
  assert.ok(g.players[1].liRangRecord,'空的 discarded 是合法中间态,不得被当脏数据清掉');
  g.players[1].liRangRecord={round:3};                     // 缺 to,结构性无效
  R('normalize(__g)');
  assert.strictEqual(g.players[1].liRangRecord,null,'结构不完整的记录应被清空');
});

console.log('CORE-183/184/185 技能状态按拥有者分离 tests: '+pass+'/'+pass+' passed');
