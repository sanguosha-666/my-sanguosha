/**
 * CORE-180(issue #239):本回合第二次无懈询问会跳过询问阶段。
 *
 * asking 缺失时 normalize 曾写成 -1，本人按钮 asking===mySeat 全失败。
 * 第二次开窗必须能问到持无懈的人，askedAt 必须是新戳。
 */
const vm=require('vm');
const fs=require('fs');
const assert=require('assert');
const path=require('path');
const ROOT=path.join(__dirname,'..');

let passed=0, failed=0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}

const context={
  firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
  document:{getElementById(){return{onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}};},querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){},createElement(){return{style:{},classList:{add(){},remove(){}}};}},
  window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
  console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
};
context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','bot-ai-bus.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R('tx=function(fn){return fn(__g);}; mySeat=0;');
const eq=()=>R('emptyEquips')();
const card=(id,name)=>({id,name,suit:'♠',rank:7});
const wuxie=id=>({id,name:'无懈可击',suit:'♠',rank:3});
const wuzhong=id=>({id,name:'无中生有',suit:'♥',rank:7});

function mkG(extra){
  return Object.assign({
    players:[
      {name:'甲',general:'caocao',hp:4,maxHp:4,hand:[wuzhong('z1'),wuzhong('z2')],equips:eq(),delays:[],alive:true},
      {name:'乙',general:'liubei',hp:4,maxHp:4,hand:[wuxie('w1')],equips:eq(),delays:[],alive:true}
    ],
    deck:[card('d1'),card('d2'),card('d3'),card('d4')],discard:[],log:[],phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null
  }, extra||{});
}

console.log('\n== CORE-180 第二次无懈询问 ==\n');

check('normalize: wuxie 缺 asking 不得写成 -1,应问到持无懈的人', ()=>{
  const g=mkG();
  g.phase='wuxie';
  g.pending={type:'wuxie', trick:'无中生有', from:0, to:0, exclude:0, depth:0, askAll:true, askStart:0, asked:[]};
  sandbox.__g=g;
  R('normalize(__g)');
  assert.notStrictEqual(g.pending.asking, -1, 'asking 不得为 -1');
  assert.strictEqual(g.pending.type, 'wuxie');
  assert.strictEqual(g.pending.asking, 1, '应问持无懈的乙,实际 '+g.pending.asking);
});

check('同回合第二张无中生有仍问持无懈玩家,askedAt 是新戳', ()=>{
  const g=mkG();
  sandbox.__g=g;
  R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.asking, 1);
  const firstAskedAt=g.pending.askedAt;
  R('mySeat=1; respondWuxie(false); mySeat=0;');
  assert.strictEqual(g.pending, null);
  R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.type, 'wuxie', '第二次应进无懈询问,实际 '+(g.pending&&g.pending.type));
  assert.strictEqual(g.pending.asking, 1, '第二次仍应问乙');
  assert.ok(typeof g.pending.askedAt==='number', '第二次应有 askedAt');
  assert.ok(g.pending.askedAt>=firstAskedAt, '第二次 askedAt 不得早于第一次');
  assert.strictEqual(R('maybeAutoRespondTimeout(__g)'), false, '新窗不得立刻超时跳过');
});

check('第二次无人无懈仍进公共窗,不立刻结算', ()=>{
  const g=mkG();
  g.players[1].hand=[];
  sandbox.__g=g;
  R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.type, 'wuxiePublicWait');
  g.pending.publicUntil=0; g.pending.askedAt=0;
  R('finishWuxiePublicWait()');
  R("startTrick(__g,{trick:'无中生有',from:0,to:0})");
  assert.strictEqual(g.pending.type, 'wuxiePublicWait', '第二次无人无懈仍应公共窗');
  assert.ok(g.pending.publicUntil-g.pending.askedAt>=3000, '公共窗应≥3秒');
});

console.log('\ncore180 wuxie second ask: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
