const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const gameSource=fs.readFileSync('game.js','utf8');
const skillSource=fs.readFileSync('skills.js','utf8');
const weaponSource=fs.readFileSync('weapons.js','utf8');
const indexSource=fs.readFileSync('index.html','utf8');

const timers=[];
const classes=new Set();
const el={
  innerHTML:'', offsetWidth:1,
  style:{setProperty(name,value){ this[name]=value; }},
  classList:{add(name){classes.add(name);},remove(name){classes.delete(name);}}
};
const context={
  console,
  document:{getElementById(id){return id==='discardReveal'?el:null;}},
  setTimeout(fn,ms){timers.push({fn,ms}); return timers.length;},
  escapeHtml(s){return String(s);},
  tableCardFaceHtml(card){return '<card>'+card.name+'</card>';}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('render-discard.js','utf8'),context,{filename:'render-discard.js'});
const R=code=>vm.runInContext(code,context);

assert.strictEqual(R('discardRevealDuration(1)'),1500);
assert.strictEqual(R('discardRevealDuration(4)'),2400);
assert.strictEqual(R('discardRevealDuration(20)'),4000);

R('observeDiscardReveal({discard:[{id:"old",name:"杀"}],discardRevealEvents:[]})');
assert.strictEqual(el.innerHTML,'','首次观察不应补播历史牌');

// 单纯进入弃牌堆（判定、打出、延时锦囊离场等）不得触发展示。
R('observeDiscardReveal({discard:[{id:"old",name:"杀"},{id:"judge",name:"闪"}],discardRevealEvents:[]})');
assert.strictEqual(el.innerHTML,'','discard 数组变化本身不得触发弃置展示');

R('observeDiscardReveal({discardRevealEvents:[{seq:1,seat:0,cards:[{id:"new",name:"闪"}]}]})');
assert.ok(el.innerHTML.includes('闪'),'显式弃置事件应公开展示');
assert.strictEqual(timers[0].ms,1500);

timers.shift().fn();
R('observeDiscardReveal({discardRevealEvents:[{seq:1,seat:0,cards:[{id:"new",name:"闪"}]},{seq:2,seat:1,cards:[{id:"a",name:"杀"},{id:"b",name:"桃"}]}]})');
assert.ok(el.innerHTML.includes('杀')&&el.innerHTML.includes('桃'),'显式批量弃置应一起展示');
assert.strictEqual(timers[0].ms,1800);

timers.shift().fn();
R('observeDiscardReveal({discardRevealEvents:[{seq:2,seat:1,cards:[{id:"a",name:"杀"}]}]})');
assert.strictEqual(el.innerHTML,'','较早快照只应重建基准，不应补播');

assert.ok(gameSource.includes('function markDiscardReveal(g, seat, cards)'), '缺少显式弃置事件入口');
assert.ok(!/function judge\(g\)[\s\S]*?markDiscardReveal/.test(gameSource.slice(gameSource.indexOf('function judge(g)'), gameSource.indexOf('function tryBagua'))), '判定牌不得产生弃置事件');
assert.ok(!gameSource.slice(gameSource.indexOf('function equipCard('), gameSource.indexOf('// ===== 距离机制')).includes('markDiscardReveal'), '同槽旧装备离场不得冒充弃置事件');
assert.ok(!gameSource.slice(gameSource.indexOf('function discardOrVanish('), gameSource.indexOf('// continueDelayResolution')).includes('markDiscardReveal'), '延时锦囊离场不得产生弃置事件');
assert.ok(!gameSource.slice(gameSource.indexOf('function respondGuidu('), gameSource.indexOf('function askNextGuidu')).includes('markDiscardReveal'), '鬼道响应牌不得产生弃置事件');
assert.ok(gameSource.slice(gameSource.indexOf('function discardCards('), gameSource.indexOf('function endTurn')).includes('markDiscardReveal'), '弃牌阶段必须产生显式弃置事件');
assert.ok(skillSource.includes("markDiscardReveal(g, mySeat, moved);"), '制衡技能弃牌必须产生显式弃置事件');
assert.ok(weaponSource.includes('markDiscardReveal(g, from, discardedHands);'), '贯石斧技能弃牌必须产生显式弃置事件');
assert.ok(gameSource.slice(gameSource.indexOf('function applyIdentityKillReward('), gameSource.indexOf('// 决斗中')).includes('markDiscardReveal'), '主公误杀忠臣的弃置惩罚必须产生显式弃置事件');
assert.ok(indexSource.includes('render-discard.js?v=395'), '弃牌展示脚本必须更新缓存版本');

console.log('discard reveal explicit events: 17/17 passed');
