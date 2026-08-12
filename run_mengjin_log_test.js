const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('game.js', 'utf8');
const start = source.indexOf('function mengjinPick(choice) {');
const end = source.indexOf('// respondMengjin:', start);
assert.ok(start >= 0 && end > start, '应能定位 mengjinPick');
const fn = source.slice(start, end);

const g = {
  phase: 'mengjin',
  pending: { type: 'mengjin', from: 0, to: 1, available: ['weapon'] },
  players: [
    { name: '庞德', alive: true },
    { name: '目标', alive: true, equips: { weapon: { name: '青釭剑' } } },
  ],
  log: [],
};
const context = {
  mySeat: 0,
  tx: callback => callback(g),
  applyTrickOnHand: () => {},
  applyTrickOnEquip: (state, info, slot) => { state.players[info.to].equips[slot] = null; },
  pushLog: (log, message) => log.concat(message),
  markSkillSound: () => {},
  canStartQinglong: () => false,
  canStartGuanshifu: () => false,
  continueShaOffsetEffects: () => {},
  finishSingleShaTarget: () => {},
};
vm.createContext(context);
vm.runInContext(fn, context, { filename: 'mengjinPick.js' });
vm.runInContext("mengjinPick('weapon')", context);

assert.strictEqual(g.players[1].equips.weapon, null, '装备仍应被正常移除');
assert.ok(g.log[0].includes('【青釭剑】'), '日志应显示移除前保存的真实装备名');
assert.ok(!g.log[0].includes('【weapon】'), '日志不应回退显示槽位标识');
console.log('mengjin log tests: 3/3 passed');
