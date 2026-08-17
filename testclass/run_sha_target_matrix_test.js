const vm=require('vm');
const fs=require('fs');
const assert=require('assert');

const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document;
context.window.firebase=context.firebase;
context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js', 'stages/stage-table.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js'].forEach(file=>{
  vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
});
function R(code){return vm.runInContext(code,sandbox);}
R('tx=function(fn){ return fn(__g); }; mySeat=0;');

const card=(name,suit='♠',rank=7,id=name+Math.random())=>({name,suit,rank,id});
const emptyEq=()=>R('emptyEquips')();
function player(name, general, hand){
  return {name,general,hp:4,maxHp:4,hand:hand||[],equips:emptyEq(),delays:[],alive:true,caps:{}};
}
function game(players){
  return {players,deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,shaUsed:false};
}
function restrict(g,kind,targetSeat,attackerSeat,tongjiSeat){
  sandbox.__g=g;
  if(kind==='kongcheng'){
    g.players[targetSeat].caps.kongcheng=true;
    g.players[targetSeat].hand=[];
  }else if(kind==='zhichi'){
    g.zhichiImmunity={seat:targetSeat,turn:g.turn};
  }else if(kind==='tongji'){
    const owner=g.players[tongjiSeat];
    owner.caps.tongji=true;
    owner.hp=1;
    owner.hand=[card('闪'),card('桃')];
    owner.equips.weapon={name:'丈八蛇矛'};
    assert.ok(R('distance(__g,'+tongjiSeat+','+attackerSeat+')<=attackRange(__g,'+tongjiSeat+')'),'同疾测试前提：攻击者在袁术攻击范围内');
  }
}

// 乱武：座位1视角,座位0(发动者)和座位2(最近目标)同距离并列最近(4人环形局座位1到
// 座位0/座位2均为距离1,座位3距离2)。CORE-94(issue #141)修复前发动者被无条件排除、
// 修复后发动者和座位2按同距离并列——若座位2因规则保护失去合法性,座位0应仍留在候选
// 集合里(不能整体清空)。
// 同疾例外：restrict('tongji',...) 把 caps.tongji 设在座位3(owner)身上,而同疾的效果是
// "拥有者在攻击者射程内时,攻击者只能以拥有者为目标"——这会连座位0(发动者)一并排除,
// 只剩座位3(不在最短距离1以内)合法,因此这一档并列的两个候选(0和2)会同时被过滤为空集,
// 和 kongcheng/zhichi(只影响座位2本身)行为不同,需要单独断言。
[
  {kind:'kongcheng', expect:[0]},
  {kind:'zhichi', expect:[0]},
  {kind:'tongji', expect:[]},
].forEach(({kind,expect})=>{
  const g=game([
    player('贾诩','jiaxu',[]),
    player('响应者','caocao',[card('杀')]),
    player('最近目标','caocao',[card('闪')]),
    player('远处角色','caocao',[card('闪')])
  ]);
  g.players[0].caps.luanwu=true;
  restrict(g,kind,2,1,3);
  sandbox.__g=g;
  R('startLuanwu()');
  assert.deepStrictEqual(g.pending.targetMap[1]||[],expect,'乱武 '+kind+'：候选集合应为 '+JSON.stringify(expect));
});
{
  const g=game([player('贾诩','jiaxu',[]),player('响应者','caocao',[card('杀')]),player('正常目标','caocao',[card('闪')]),player('远处角色','caocao',[])]);
  g.players[0].caps.luanwu=true; sandbox.__g=g; R('startLuanwu()');
  // 4人环形局,座位1到座位0(发动者)、座位2均距离1,无规则限制时两者并列合法。
  assert.deepStrictEqual(g.pending.targetMap[1],[0,2],'乱武：正常最近目标(含并列的发动者)仍可选择');
}

// 明策：接牌者座位1视为使用杀，第二目标座位2必须走完整 canTarget。
['kongcheng','tongji','zhichi'].forEach(kind=>{
  const g=game([player('陈宫','chengong',[]),player('接牌者','caocao',[card('闪')]),player('候选目标','caocao',[card('闪')]),player('同疾拥有者','yuanshu',[card('闪')])]);
  restrict(g,kind,2,1,3);
  g.pending={type:'mingcePickTarget',sourceSeat:0,targetSeat:null,cardToGive:[card('杀')],cardName:'杀'};
  g.phase='mingcePickTarget'; sandbox.__g=g; R('pickMingceTarget(1)');
  assert.ok(!g.pending.candidates || !g.pending.candidates.includes(2),'明策 '+kind+'：非法第二目标不得进入候选');
});
{
  const g=game([player('陈宫','chengong',[]),player('接牌者','caocao',[]),player('正常目标','caocao',[card('闪')]),player('其他角色','caocao',[])]);
  g.pending={type:'mingcePickTarget',sourceSeat:0,targetSeat:null,cardToGive:[card('杀')],cardName:'杀'};
  g.phase='mingcePickTarget'; sandbox.__g=g; R('pickMingceTarget(1)');
  assert.ok(g.pending.candidates.includes(2),'明策：正常第二目标仍可选择');
}

// 方天画戟：服务端提交非法目标时必须原子拒绝，不消耗最后一张杀。
['kongcheng','tongji','zhichi'].forEach(kind=>{
  const sha=card('杀');
  const g=game([player('攻击者','lvbu',[sha]),player('候选目标','caocao',[card('闪')]),player('其他角色','caocao',[]),player('同疾拥有者','yuanshu',[card('闪')])]);
  g.players[0].caps.fangtian=true;
  restrict(g,kind,1,0,3);
  sandbox.__g=g; R('playShaFangtian(0,[1])');
  assert.strictEqual(g.players[0].hand.length,1,'方天 '+kind+'：非法提交不得消耗杀');
  assert.strictEqual(g.pending,null,'方天 '+kind+'：非法提交不得进入杀响应');
});
{
  const g=game([player('攻击者','lvbu',[card('杀')]),player('正常目标','caocao',[card('闪')]),player('其他角色','caocao',[])]);
  g.players[0].caps.fangtian=true; sandbox.__g=g; R('playShaFangtian(0,[1])');
  assert.strictEqual(g.players[0].hand.length,0,'方天：正常目标仍会消耗杀');
  assert.ok(g.pending && g.phase==='respond','方天：正常目标仍进入杀响应');
}

console.log('sha target matrix: 12/12 passed');
