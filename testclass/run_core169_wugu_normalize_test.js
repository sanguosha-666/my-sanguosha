/**
 * CORE-169(issue #228)回归锁定:五谷 wugu 的 normalize 把"回退默认值"和"结构校验"写在
 * 同一条判断里,`order.length===0`(Firebase 吞空数组读回 undefined 后被回退成 [])被当成
 * 脏数据,直接 `pending=null` —— 而 pending.pool 里是**真实的牌**,这么清等于凭空销毁牌。
 * 修复后:先补默认,再只校验真正的结构性字段(from/idx);"没人可挑了"改走 finishWugu,
 * 把剩余牌弃进弃牌堆再收尾。
 */
const vm=require('vm'),fs=require('fs'),assert=require('assert');
const el=()=>({onclick:null,onchange:null,style:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},appendChild(){return{};}});
const context={firebase:{initializeApp(){return{database(){return{ref(){return{on(){},once(){},transaction(){},set(){},update(){},child(){return this;},remove(){}};}};}};},database(){return this.initializeApp().database();}},document:{getElementById:el,createElement:el,querySelector(){return null;},querySelectorAll(){return[];},addEventListener(){}},window:{location:{search:'',href:''},localStorage:{getItem(){return null;},setItem(){}},addEventListener(){},setTimeout,clearTimeout,alert(){}},console,Math,Date,JSON,RegExp,Array,Object,String,Number,Boolean,parseInt,isNaN,setTimeout,clearTimeout};
context.window.document=context.document;context.window.firebase=context.firebase;context.global=context;
const sandbox=vm.createContext(context);
['config.js','data.js','stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js','sha/sha-resolution.js','weapons.js','skills.js','skills/late-generals.js'].forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),sandbox,{filename:f}));
const R=code=>vm.runInContext(code,sandbox);
R("gameRef={transaction:function(fn){return fn(__g);}};tx=function(fn,cb){var r=fn(__g);if(r&&typeof r==='object')__g=r;if(cb)cb(__g);return r;};mySeat=0;");
const eq=()=>R('emptyEquips')();
const mk=(name)=>({name,general:'liubei',hp:4,maxHp:4,hand:[],equips:eq(),delays:[],alive:true});
const card=(id)=>({id,name:'桃',suit:'♥',rank:5});
function state(pending){
  const g={players:[mk('甲'),mk('乙'),mk('丙')],deck:[],discard:[],log:[],
    phase:'wugu',turn:0,roundNum:1,gameMode:'ffa',pending,exchangeCards:[]};
  sandbox.__g=g; return g;
}

// 1) 正常进行中的 wugu(还有人没挑)不得被清空
let g=state({type:'wugu',from:0,pool:[card('c1'),card('c2')],order:[0,1,2],idx:1});
R("normalize(__g)");
assert.ok(g.pending && g.pending.type==='wugu','进行中的五谷不得被 normalize 清掉');
assert.strictEqual(g.phase,'wugu','阶段保持不变');

// 2) order 读回 undefined(Firebase 吞空数组)时不得直接销毁池中真牌
g=state({type:'wugu',from:0,pool:[card('c1'),card('c2')],idx:0}); // order 缺失
R("normalize(__g)");
assert.strictEqual(g.pending,null,'没有人可挑时这条链应当收尾');
assert.strictEqual(g.phase,'play','收尾后回到出牌阶段');
assert.strictEqual(g.discard.length,2,'池中剩余的真实牌必须弃进弃牌堆,不能凭空消失');

// 3) pool 读回 undefined(池子已挑空)同样安全收尾,不报错不丢牌
g=state({type:'wugu',from:0,order:[0,1,2],idx:2}); // pool 缺失
R("normalize(__g)");
assert.strictEqual(g.pending,null,'池子空时收尾');
assert.strictEqual(g.discard.length,0,'没有牌可弃时弃牌堆不变');

// 4) idx 已经排到队尾(挑完最后一人)时收尾并弃掉剩余牌
g=state({type:'wugu',from:0,pool:[card('c3')],order:[0,1,2],idx:3});
R("normalize(__g)");
assert.strictEqual(g.pending,null,'排完队尾应收尾');
assert.strictEqual(g.discard.length,1,'剩余牌进弃牌堆');

// 5) 真正的结构性非法(from 不是数字/指向不存在的玩家)仍然按脏数据清掉
g=state({type:'wugu',from:'x',pool:[card('c4')],order:[0,1,2],idx:0});
R("normalize(__g)");
assert.strictEqual(g.pending,null,'from 非数字属结构性非法,应清空');
assert.strictEqual(g.phase,'play','清空后回到出牌阶段');

g=state({type:'wugu',from:9,pool:[card('c5')],order:[0,1,2],idx:0});
R("normalize(__g)");
assert.strictEqual(g.pending,null,'from 指向不存在的玩家同样属结构性非法');

g=state({type:'wugu',from:0,pool:[card('c6')],order:[0,1,2],idx:-1});
R("normalize(__g)");
assert.strictEqual(g.pending,null,'idx 为负同样属结构性非法');

// 6) 端到端:真实走一遍五谷,挑到最后一人时不被误清空
const gg={players:[mk('甲'),mk('乙'),mk('丙')],
  deck:[card('d1'),card('d2'),card('d3'),card('d4')],discard:[],log:[],
  phase:'play',turn:0,roundNum:1,gameMode:'ffa',pending:null,exchangeCards:[]};
gg.players[0].hand=[{id:'w1',name:'五谷丰登',suit:'♥',rank:3}];
sandbox.__g=gg;
R("mySeat=0;playCard(0,'五谷丰登')");
let guard=0, picks=0;
while(guard++<40){
  const s=sandbox.__g;
  R("normalize(__g)");   // 每一步都过一遍 normalize,模拟真实 tx 的入口行为
  if(s.phase==='wuxie'){
    if(s.pending.type==='wuxiePublicWait'){s.pending.publicUntil=0;R('finishWuxiePublicWait()');}
    else R('mySeat='+s.pending.asking+';respondWuxie(false)');
  } else if(s.phase==='wugu'){
    const picker=s.pending.order[s.pending.idx];
    R('mySeat='+picker+';wuguPick(0,'+s.pending.idx+',"'+s.pending.pool[0].id+'")');
    picks++;
  } else break;
}
assert.strictEqual(picks,3,'三名存活角色都应各挑到一张牌');
assert.strictEqual(sandbox.__g.phase,'play','五谷正常结算完毕');
assert.strictEqual(sandbox.__g.pending,null,'结算完毕后 pending 清空');
sandbox.__g.players.forEach((p,i)=>{ assert.strictEqual(p.hand.length,1,'三人各挑到一张牌(座位0的五谷牌本身已消耗)'); });

console.log('CORE-169 wugu normalize: all passed');
