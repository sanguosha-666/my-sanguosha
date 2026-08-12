const vm = require('vm');
const fs = require('fs');
const assert = require('assert');

const element = () => ({
  onclick: null, onchange: null, style: {}, innerHTML: '', textContent: '', value: '',
  classList: { add(){}, remove(){}, toggle(){} }
});
const context = {
  firebase: {
    initializeApp(){ return { database(){ return { ref(){ return { on(){}, once(){}, transaction(){}, set(){}, update(){}, child(){ return this; }, remove(){} }; } }; } }; },
    database(){ return this.initializeApp().database(); }
  },
  document: { getElementById: element, createElement: element, querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){} },
  window: { location: { search: '', href: '' }, localStorage: { getItem(){ return null; }, setItem(){} }, addEventListener(){}, setTimeout, clearTimeout, alert(){} },
  console, Math, Date, JSON, RegExp, Array, Object, String, Number, Boolean, parseInt, isNaN, setTimeout, clearTimeout
};
context.window.document = context.document;
context.window.firebase = context.firebase;
context.global = context;
const sandbox = vm.createContext(context);
['config.js', 'data.js', 'room-lifecycle.js', 'game.js', 'weapons.js', 'skills.js']
  .forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }));
const run = code => vm.runInContext(code, sandbox);
run('tx=function(fn){return fn(__g);};mySeat=0;');

const equips = () => run('emptyEquips')();
const player = (name, general) => ({ name, general, hp: 4, maxHp: 4, hand: [], equips: equips(), delays: [], alive: true });
const diamond = id => ({ id, name: '杀', suit: '♦', rank: 7 });
const indulgence = id => ({ id, name: '乐不思蜀', suit: '♥', rank: 6 });
function state(targetCaps) {
  const players = [player('大乔', 'daqiao'), player('目标', 'liubei'), player('旁观者', 'caocao')];
  players[0].hand = [diamond('d1')];
  if(targetCaps) players[1].caps = targetCaps;
  return { players, deck: [], discard: [], log: [], phase: 'play', turn: 0, roundNum: 1, gameMode: 'ffa', pending: null };
}

let g = state({ qianxun: true });
g.players[0].hand = [indulgence('l0')];
sandbox.__g = g;
run("playCard(0,'乐不思蜀',1)");
assert.strictEqual(g.players[0].hand.length, 1, '真正的乐不思蜀不能以谦逊角色为目标');

g = state({ qianxun: true });
sandbox.__g = g;
run('guoSe(0,1)');
assert.strictEqual(g.players[0].hand.length, 1, '国色转化的乐不思蜀同样不能以谦逊角色为目标');
assert.strictEqual(g.pending, null, '非法国色目标不能开启锦囊结算');

g = state();
sandbox.__g = g;
run('guoSe(0,1)');
assert.strictEqual(g.players[0].hand.length, 0, '国色对合法目标应正常消耗方块牌');
assert.strictEqual(g.players[1].delays.length, 1, '无人使用无懈可击时国色应正常放置乐不思蜀');
assert.strictEqual(g.players[1].delays[0].name, '乐不思蜀', '国色放入判定区的牌名应为乐不思蜀');

g = state();
g.players[1].delays.push(indulgence('l1'));
sandbox.__g = g;
run('guoSe(0,1)');
assert.strictEqual(g.players[0].hand.length, 1, '目标已有乐不思蜀时国色不能重复放置');
assert.strictEqual(g.pending, null, '重复延时锦囊不能开启结算');

console.log('guose target validation: 8/8 passed');
