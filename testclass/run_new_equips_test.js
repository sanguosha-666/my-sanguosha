/**
 * 藤甲 / 白银狮子 / 朱雀羽扇
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert'),path=require('path');
const ROOT=path.join(__dirname,'..');
let passed=0,failed=0;
function check(name,fn){ try{ fn(); console.log('  PASS',name); passed++; } catch(e){ console.log('  FAIL',name,'-',e.message); failed++; } }

function fresh(){
  const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}}});
  const context={
    firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
    document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},
    window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
    console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
  };
  context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
  const sandbox=vm.createContext(context);
  ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f}));
  vm.runInContext('tx=function(fn){return fn(__g);}; mySeat=0;', sandbox);
  return sandbox;
}
function R(s,code){ return vm.runInContext(code,s); }
function eq(s){ return R(s,'emptyEquips()'); }
function player(s,name,extra){
  return Object.assign({name,general:'zhangfei',hp:4,maxHp:4,hand:[],equips:eq(s),delays:[],alive:true}, extra||{});
}

console.log('\n== 藤甲/白银狮子/朱雀羽扇 ==\n');

check('数据表:三件装备 cap/slot/射程', ()=>{
  const s=fresh();
  const t=R(s,"getEquip('藤甲')");
  const b=R(s,"getEquip('白银狮子')");
  const z=R(s,"getEquip('朱雀羽扇')");
  assert.ok(t && t.slot==='armor' && t.cap==='tengjia', '藤甲');
  assert.ok(b && b.slot==='armor' && b.cap==='baiyin', '白银狮子');
  assert.ok(z && z.slot==='weapon' && z.range===4 && z.cap==='zhuque', '朱雀羽扇');
});

check('牌堆含藤甲2、白银狮子1、朱雀羽扇1', ()=>{
  const s=fresh();
  const deck=R(s,'buildDeck()');
  const names=deck.map(c=>c.name);
  assert.strictEqual(names.filter(n=>n==='藤甲').length, 2);
  assert.strictEqual(names.filter(n=>n==='白银狮子').length, 1);
  assert.strictEqual(names.filter(n=>n==='朱雀羽扇').length, 1);
});

check('藤甲:普通杀无效', ()=>{
  const s=fresh();
  const a=player(s,'甲');
  const b=player(s,'乙',{equips:Object.assign(eq(s),{armor:{id:2,name:'藤甲'}})});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  const sha={id:9,name:'杀',suit:'♥',rank:5};
  R(s,"resolveShaUse(__g,__g.players[0],1,'杀',singleCardShaColor({name:'杀',suit:'♥'}),{id:9,name:'杀',suit:'♥',rank:5})");
  assert.strictEqual(s.__g.phase,'play','普通杀应被藤甲无效,phase='+s.__g.phase);
  assert.strictEqual(s.__g.pending,null);
});

check('藤甲+青釭:普通杀进入出闪', ()=>{
  const s=fresh();
  const a=player(s,'甲',{equips:Object.assign(eq(s),{weapon:{id:1,name:'青釭剑'}})});
  const b=player(s,'乙',{equips:Object.assign(eq(s),{armor:{id:2,name:'藤甲'}}),hand:[{id:3,name:'闪'}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  R(s,"resolveShaUse(__g,__g.players[0],1,'杀',singleCardShaColor({name:'杀',suit:'♥'}),{id:9,name:'杀',suit:'♥',rank:5})");
  assert.strictEqual(s.__g.phase,'respond','青釭应破藤甲,phase='+s.__g.phase);
});

check('藤甲:火杀不免疫,火焰伤害+1', ()=>{
  const s=fresh();
  const a=player(s,'甲');
  const b=player(s,'乙',{hp:4,equips:Object.assign(eq(s),{armor:{id:2,name:'藤甲'}})});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  R(s,"dealDamage(__g,1,1,0,'火杀','sha',{name:'火杀',suit:'♥',rank:4})");
  assert.strictEqual(s.__g.players[1].hp, 2, '火杀1点+藤甲+1应变2,实际hp='+s.__g.players[1].hp);
});

check('白银狮子:2点伤害改为1点', ()=>{
  const s=fresh();
  const a=player(s,'甲');
  const b=player(s,'乙',{hp:4,equips:Object.assign(eq(s),{armor:{id:2,name:'白银狮子'}})});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  R(s,"dealDamage(__g,1,2,0,'杀','sha',{name:'杀',suit:'♥',rank:5})");
  assert.strictEqual(s.__g.players[1].hp, 3, '2点应收成1,实际hp='+s.__g.players[1].hp);
});

check('换下白银狮子回复1点体力', ()=>{
  const s=fresh();
  const a=player(s,'甲',{hp:2,maxHp:4,equips:Object.assign(eq(s),{armor:{id:2,name:'白银狮子'}})});
  s.__g={players:[a],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  R(s,"equipCard(__g,__g.players[0],{id:3,name:'八卦阵'})");
  assert.strictEqual(s.__g.players[0].hp, 3, '失去白银狮子应回1血,实际hp='+s.__g.players[0].hp);
  assert.strictEqual(s.__g.players[0].equips.armor.name, '八卦阵');
});

check('南蛮对藤甲不出杀不受伤', ()=>{
  const s=fresh();
  const a=player(s,'甲');
  const b=player(s,'乙',{hp:4,equips:Object.assign(eq(s),{armor:{id:2,name:'藤甲'}})});
  s.__g={players:[a,b],turn:0,phase:'aoeResp',pending:{type:'aoeResp',from:0,to:1,need:'杀'},aoe:{trick:'南蛮入侵',from:0,need:'杀'},log:[],discard:[],deck:[]};
  R(s,'mySeat=1; aoeRespond(false); mySeat=0;');
  assert.strictEqual(s.__g.players[1].hp, 4, '藤甲免疫南蛮,实际hp='+s.__g.players[1].hp);
});

check('朱雀羽扇:普通杀可改为火杀', ()=>{
  const s=fresh();
  const a=player(s,'甲',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}})});
  const b=player(s,'乙',{hp:4,hand:[{id:3,name:'闪'}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[]};
  R(s,"resolveShaUse(__g,__g.players[0],1,'杀',singleCardShaColor({name:'杀',suit:'♥'}),{id:9,name:'杀',suit:'♥',rank:5})");
  assert.strictEqual(s.__g.phase,'zhuqueAsk','应询问是否改为火杀,phase='+s.__g.phase);
  R(s,'mySeat=0; respondZhuque(true);');
  assert.ok(s.__g.phase==='respond' || (s.__g.pending && s.__g.pending.zhuqueFire) || (s.__g.pending && s.__g.pending.sourceCard && s.__g.pending.sourceCard.asFireSha),
    '改火后应进入杀响应且带火标记,phase='+s.__g.phase+' pending='+JSON.stringify(s.__g.pending&&{type:s.__g.pending.type,asFireSha:s.__g.pending.sourceCard&&s.__g.pending.sourceCard.asFireSha,zhuqueFire:s.__g.pending.zhuqueFire}));
});

console.log('\nnew equips: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
