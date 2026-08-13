const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync('room-lifecycle.js','utf8');
const start=source.indexOf('function resetPlayerForNewGame');
const end=source.indexOf('function cleanupRoom',start);
assert.ok(start>=0&&end>start,'应能定位新局重置实现');
const state={
  started:true,phase:'over',players:[{
    name:'玩家',cid:'stable-cid',team:2,general:'zuoci',hp:0,hand:[{name:'杀'}],
    skillsLost:true,caps:{wusheng:true},huashenPool:['caocao'],huashenGeneral:'caocao',
    huashenSkillName:'奸雄',buquCards:[{rank:7}],nirvanaUsed:true,chanyuan:true,
    customFuturePerGameFlag:true
  }],log:[]
};
const context={
  Number,Object,
  randomGeneralId:()=> 'guanyu', generalMaxHp:()=>4,
  emptyEquips:()=>({weapon:null,armor:null,plus1:null,minus1:null}),
  pushLog:(log,text)=>log.concat({text}), tx:fn=>fn(state)
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context,{filename:'new-game-reset.js'});
vm.runInContext('newGame()',context);
const p=state.players[0];
assert.strictEqual(p.cid,'stable-cid');
assert.strictEqual(p.team,2);
assert.strictEqual(p.general,'guanyu');
for(const key of ['skillsLost','caps','huashenPool','huashenGeneral','huashenSkillName','buquCards','nirvanaUsed','chanyuan','customFuturePerGameFlag']){
  assert.ok(!(key in p),key+' 不应跨局残留');
}
assert.strictEqual(p.hp,4);
assert.strictEqual(p.hand.length,0);
console.log('new game player reset tests: 14/14 passed');
