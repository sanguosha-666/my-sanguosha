const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

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

R('observeDiscardReveal({discard:[{id:"old",name:"杀"}],exchangeCards:[]})');
assert.strictEqual(el.innerHTML,'','首次观察不应补播历史牌');

R('observeDiscardReveal({discard:[{id:"old",name:"杀"},{id:"new",name:"闪"}],exchangeCards:[]})');
assert.ok(el.innerHTML.includes('闪'),'新增弃牌应公开展示');
assert.strictEqual(timers[0].ms,1500);

timers.shift().fn();
R('observeDiscardReveal({discard:[{id:"old",name:"杀"},{id:"new",name:"闪"},{id:"used",name:"桃"}],exchangeCards:[{card:{id:"used"}}]})');
assert.strictEqual(el.innerHTML,'','已经作为使用/打出展示的牌不应重复展示');

R('observeDiscardReveal({discard:[],exchangeCards:[]})');
R('observeDiscardReveal({discard:[{id:"a",name:"杀"},{id:"b",name:"闪"}],exchangeCards:[]})');
assert.ok(el.innerHTML.includes('杀')&&el.innerHTML.includes('闪'),'同批多张牌应一起展示');
assert.strictEqual(timers[0].ms,1800);

console.log('discard reveal: 7/7 passed');
