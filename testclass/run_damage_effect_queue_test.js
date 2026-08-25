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

R(`
  tx=function(fn){ return fn(__g); };
  mySeat=0;
`);
const card=(name,suit,rank,id)=>({name,suit,rank,id});
const emptyEq=()=>R('emptyEquips')();
const players=[
  {name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  // 郭嘉本体提供遗计；运行时 caps 模拟同时拥有耀武、称象，复现多个受伤后能力共存。
  {name:'多技能目标',general:'guojia',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true,caps:{yaowu:true,chengxiang:true}}
];
const g={players,deck:[card('桃','♥',3,'d1'),card('闪','♦',4,'d2'),card('杀','♣',5,'d3')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g;

assert.strictEqual(R(`dealDamage(__g,1,1,0,'测试红杀','sha',${JSON.stringify(card('杀','♥',7,'sha1'))})`),true);
assert.strictEqual(g.pending.type,'yaowu_choose','第一个稳定触发耀武');
assert.strictEqual(g.afterDamageEffects.index,1);

R('mySeat=0; respondYaowu("draw")');
assert.strictEqual(g.pending.type,'yijiAsk','耀武完成后继续遗计');
assert.strictEqual(g.afterDamageEffects.index,3);

R('mySeat=1; respondYijiAsk(false)');
assert.strictEqual(g.pending.type,'chengxiangAsk','遗计完成后继续称象');
assert.strictEqual(g.afterDamageEffects.index,5);

// 用称象现有取消入口完成最后一个交互，队列必须清空且回到原杀流程。
R('cancelChengxiangAsk()');
assert.strictEqual(g.afterDamageEffects,null,'全部受伤后技能完成后清空队列');
assert.strictEqual(g.pending,null,'不得残留旧 pending');
assert.strictEqual(g.phase,'play','只在全部技能完成后恢复原流程');

// CORE-02 独立复现：恩怨先挂起时，完成后必须继续同一角色的其它 onDamaged 技能。
R(`GENERALS.fazheng.hooks={onDamaged:function(g,seat,ctx){
  g.pending={type:'probeDamageHook',seat:seat,resume:{type:ctx.srcType}};
  g.phase='probeDamageHook';
}};`);
const g2={players:[
  {name:'无红桃伤害者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  {name:'恩怨复合目标',general:'fazheng',hp:3,maxHp:3,hand:[],equips:emptyEq(),delays:[],alive:true}
],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g2;
assert.strictEqual(R('dealDamage(__g,1,1,0,"恩怨队列复现","sha")'),true);
assert.strictEqual(g2.pending.type,'enyuanChoose','恩怨必须先进入交互');
R('mySeat=0; triggerEnyuan()');
assert.strictEqual(g2.players[0].hp,3,'无红桃时伤害来源因恩怨失去1点体力');
assert.strictEqual(g2.pending.type,'probeDamageHook','恩怨完成后必须继续其它受伤后技能');
assert.strictEqual(g2.pending.resume.type,'afterDamageEffects','后续技能仍由统一队列接管');

// CORE-55：左慈借用【恩怨】时，借来的 cap 先挂起也不能吞掉左慈本体【新生】hook。
const gZuoci={players:[
  {name:'伤害者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  {name:'借恩怨的左慈',general:'zuoci',hp:3,maxHp:3,hand:[],equips:emptyEq(),delays:[],alive:true,
   huashenPool:['fazheng'],huashenGeneral:'fazheng',huashenSkillName:'恩怨'}
],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=gZuoci;
assert.strictEqual(R('dealDamage(__g,1,1,0,"化身恩怨与新生组合","sha")'),true);
assert.strictEqual(gZuoci.pending.type,'enyuanChoose','左慈借用的恩怨应先进入交互');
R('mySeat=0; triggerEnyuan()');
assert.strictEqual(gZuoci.pending.type,'xinshengAsk','借用恩怨完成后必须继续左慈本体新生');
assert.strictEqual(gZuoci.pending.resume.type,'afterDamageEffects','新生仍由统一受伤后队列接管');

// CORE-33：濒死获救不是伤害结算终点，必须接回同一套受伤后队列。
const g3={players:[
  {name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  {name:'曹冲',general:'caochong',hp:1,maxHp:3,hand:[],equips:emptyEq(),delays:[],alive:true}
],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g3;
assert.strictEqual(R('dealDamage(__g,1,1,0,"濒死称象","sha")'),true);
assert.ok(['dying','dyingPublicWait'].includes(g3.pending.type),'濒死应挂起 dying 或无人可救公共窗');
assert.strictEqual(g3.pending.resume.type,'afterDamageEffects');
g3.players[1].hp=1;
R('finishDying(__g,false)');
assert.strictEqual(g3.pending.type,'chengxiangAsk','曹冲获救后必须继续称象');

const g4={players:[
  {name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  {name:'李典',general:'lidian',hp:1,maxHp:3,hand:[],equips:emptyEq(),delays:[],alive:true}
],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g4;
assert.strictEqual(R('dealDamage(__g,1,1,0,"濒死忘隙","sha")'),true);
g4.players[1].hp=1;
R('finishDying(__g,false)');
assert.strictEqual(g4.pending.type,'wangxiAsk','李典获救后必须继续忘隙');

const g5={players:[
  {name:'攻击者',general:'caocao',hp:4,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true},
  {name:'普通角色',general:'caocao',hp:1,maxHp:4,hand:[],equips:emptyEq(),delays:[],alive:true}
],deck:[],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null};
sandbox.__g=g5;
R('dealDamage(__g,1,1,0,"普通濒死","sha")');
g5.players[1].hp=1;
R('finishDying(__g,false)');
assert.strictEqual(g5.pending,null,'普通角色获救后不得制造额外询问');
assert.strictEqual(g5.phase,'play','普通角色获救后应恢复原流程');

const source=fs.readFileSync('game.js','utf8');
assert.ok(source.includes("actions:['yaowu','enyuan','hooks','jiushi','chengxiang','beige']"));
assert.ok(source.includes("resume.type==='afterDamageEffects'"));
console.log('damage effect queue: 29/29 passed');
