/**
 * 出杀预填朱雀/雌雄：playCard 第5参 extra 跳过 Ask；无 extra 仍问；流离后标志还在。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert'),path=require('path');
const ROOT=path.join(__dirname,'..');
let passed=0,failed=0;
function check(name,fn){ try{ fn(); console.log('  PASS',name); passed++; } catch(e){ console.log('  FAIL',name,'-',e.message); failed++; } }

function fresh(){
  const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
  const context={
    firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},
    document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},
    window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},
    console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
  };
  context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
  const sandbox=vm.createContext(context);
  ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f}));
  vm.runInContext("tx=function(fn,cb){var r=fn(__g);__g=r||__g;if(cb)cb(__g);return r;}; mySeat=0;", sandbox);
  return sandbox;
}
function R(s,code){ return vm.runInContext(code,s); }
function eq(s){ return R(s,'emptyEquips()'); }
function player(s,name,general,extra){
  const gen=R(s,"getGeneral('"+general+"')");
  return Object.assign({
    name, general, gender:gen&&gen.gender,
    hp:gen?gen.maxHp:4, maxHp:gen?gen.maxHp:4,
    hand:[], equips:eq(s), delays:[], alive:true
  }, extra||{});
}

console.log('\n== 出杀预填朱雀/雌雄 ==\n');

check('无 extra:朱雀仍问 zhuqueAsk', ()=>{
  const s=fresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'乙','guanyu',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1)");
  assert.strictEqual(s.__g.phase,'zhuqueAsk','phase='+s.__g.phase);
});

check('extra.zhuqueFire=true:跳过 Ask,带火', ()=>{
  const s=fresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'乙','guanyu',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{zhuqueFire:true})");
  assert.notStrictEqual(s.__g.phase,'zhuqueAsk','不应再问朱雀,phase='+s.__g.phase);
  const src=s.__g.pending&&s.__g.pending.sourceCard;
  assert.ok(src&&src.asFireSha,'sourceCard 应带 asFireSha');
});

check('extra.zhuqueFire=false:跳过 Ask,不是火', ()=>{
  const s=fresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'乙','guanyu',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{zhuqueFire:false})");
  assert.notStrictEqual(s.__g.phase,'zhuqueAsk','不应再问朱雀,phase='+s.__g.phase);
  const src=s.__g.pending&&s.__g.pending.sourceCard;
  assert.ok(!src||!src.asFireSha,'不改火则无 asFireSha');
});

check('预填火杀破藤甲(1+1=2)', ()=>{
  const s=fresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'乙','guanyu',{hp:4,equips:Object.assign(eq(s),{armor:{id:9,name:'藤甲'}})});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{zhuqueFire:true})");
  if(s.__g.phase==='respond') R(s,'mySeat=1; respondShan(null); mySeat=0;');
  assert.strictEqual(s.__g.players[1].hp, 2, '火杀+藤甲应2点,hp='+s.__g.players[1].hp);
});

check('无 extra:雌雄仍问 cixiongAsk', ()=>{
  const s=fresh();
  const a=player(s,'张飞','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'雌雄双股剑'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'大乔','daqiao',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1)");
  assert.strictEqual(s.__g.phase,'cixiongAsk','phase='+s.__g.phase);
});

check('extra.cixiongActivate=true:跳过 Ask,进 Choice', ()=>{
  const s=fresh();
  const a=player(s,'张飞','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'雌雄双股剑'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'大乔','daqiao',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{cixiongActivate:true})");
  assert.notStrictEqual(s.__g.phase,'cixiongAsk','不应再问是否发动,phase='+s.__g.phase);
  assert.strictEqual(s.__g.phase,'cixiongChoice','有手牌应进 Choice,phase='+s.__g.phase);
});

check('extra.cixiongActivate=false:跳过 Ask,不发动', ()=>{
  const s=fresh();
  const a=player(s,'张飞','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'雌雄双股剑'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'大乔','daqiao',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{cixiongActivate:false})");
  assert.notStrictEqual(s.__g.phase,'cixiongAsk','不应再问,phase='+s.__g.phase);
  assert.notStrictEqual(s.__g.phase,'cixiongChoice','不发动不应进 Choice');
});

check('流离后预填不改火:不再问朱雀', ()=>{
  const s=fresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'大乔','daqiao',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  const c=player(s,'丙','liubei',{hand:[{id:4,name:'闪',suit:'♦',rank:3}]});
  s.__g={players:[a,b,c],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{zhuqueFire:false})");
  assert.strictEqual(s.__g.phase,'liuli','应先问流离,phase='+s.__g.phase);
  R(s,"mySeat=1; respondLiuli({kind:'hand',idx:0},2); mySeat=0;");
  assert.notStrictEqual(s.__g.phase,'zhuqueAsk','流离后预填不改火不应再问朱雀,phase='+s.__g.phase);
});

check('流离到异性:预填不发动雌雄不再问', ()=>{
  const s=fresh();
  const a=player(s,'张飞','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'雌雄双股剑'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}]});
  const b=player(s,'大乔','daqiao',{hand:[{id:3,name:'闪',suit:'♦',rank:2}]});
  const c=player(s,'甄姬','zhenji',{hand:[{id:4,name:'闪',suit:'♦',rank:3}]});
  s.__g={players:[a,b,c],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  R(s,"playCard(0,'杀',1,null,{cixiongActivate:false})");
  assert.strictEqual(s.__g.phase,'liuli','应先问流离,phase='+s.__g.phase);
  R(s,"mySeat=1; respondLiuli({kind:'hand',idx:0},2); mySeat=0;");
  assert.notStrictEqual(s.__g.phase,'cixiongAsk','预填不发动,流离后异性也不该再问,phase='+s.__g.phase);
  assert.notStrictEqual(s.__g.phase,'cixiongChoice','不应进 Choice');
});

function botFresh(){
  const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};},remove(){},setAttribute(){},getAttribute(){return null;},addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}});
  const context={
    firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){},get(){return{val(){return null;}};}};}};}};},database(){return this.initializeApp().database();}},
    document:{getElementById:el,createElement:el,createTextNode(t){return{textContent:t};},createDocumentFragment(){return{appendChild(){}};},querySelector(){return null;},querySelectorAll(){return[];},body:{appendChild(){}},head:{appendChild(){}},addEventListener(){}},
    window:{location:{search:'',href:'http://localhost'},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){},confirm(){return true;},navigator:{userAgent:'test'}},
    console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout
  };
  context.window.document=context.document; context.window.firebase=context.firebase; context.global=context;
  const sandbox=vm.createContext(context);
  ['config.js','data.js','stages/stage-table.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','bot-ai-bus.js','bot.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f}));
  vm.runInContext("tx=function(fn,cb){var r=fn(__g);__g=r||__g;if(cb)cb(__g);return r;}; mySeat=0;", sandbox);
  return sandbox;
}

console.log('\n== 出杀枚举拆候选 ==\n');

check('朱雀:普通杀按目标拆普通/改火两条', ()=>{
  const s=botFresh();
  const a=player(s,'甲','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'朱雀羽扇'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}],isBot:true});
  const b=player(s,'乙','guanyu',{hp:4});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  const list=R(s,'enumerateAllLegalOneStepActions(__g,0)');
  const sha=list.filter(c=>c.action==='杀');
  assert.strictEqual(sha.length, 2, '应2条(普通+改火),实际'+sha.length+' '+JSON.stringify(sha.map(c=>c.label)));
  const fires=sha.filter(c=>c.extra&&c.extra.zhuqueFire===true);
  const plains=sha.filter(c=>c.extra&&c.extra.zhuqueFire===false);
  assert.strictEqual(fires.length,1,'改火一条');
  assert.strictEqual(plains.length,1,'普通一条');
  assert.ok(fires[0].label.indexOf('火')>=0 || fires[0].label.indexOf('朱雀')>=0, '改火 label 应标明,实际 '+fires[0].label);
});

check('雌雄对异性:拆不发动/发动两条', ()=>{
  const s=botFresh();
  const a=player(s,'张飞','zhangfei',{equips:Object.assign(eq(s),{weapon:{id:1,name:'雌雄双股剑'}}),hand:[{id:2,name:'杀',suit:'♥',rank:7}],isBot:true});
  const b=player(s,'大乔','daqiao',{hp:3});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  const list=R(s,'enumerateAllLegalOneStepActions(__g,0)');
  const sha=list.filter(c=>c.action==='杀');
  assert.strictEqual(sha.length, 2, '应2条,实际'+sha.length+' '+JSON.stringify(sha.map(c=>c.label)));
  const yes=sha.filter(c=>c.extra&&c.extra.cixiongActivate===true);
  const no=sha.filter(c=>c.extra&&c.extra.cixiongActivate===false);
  assert.strictEqual(yes.length,1,'发动一条');
  assert.strictEqual(no.length,1,'不发动一条');
});

check('无朱雀无雌雄:杀仍每目标一条、无 extra', ()=>{
  const s=botFresh();
  const a=player(s,'甲','zhangfei',{hand:[{id:2,name:'杀',suit:'♥',rank:7}],isBot:true});
  const b=player(s,'乙','guanyu',{hp:4});
  s.__g={players:[a,b],turn:0,phase:'play',pending:null,log:[],discard:[],deck:[],shaUsed:false,gameMode:'ffa'};
  const list=R(s,'enumerateAllLegalOneStepActions(__g,0)');
  const sha=list.filter(c=>c.action==='杀');
  assert.strictEqual(sha.length, 1, '应1条,实际'+sha.length);
  assert.ok(!sha[0].extra, '无武器不应带 extra');
});

console.log('\nsha predeclare: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
