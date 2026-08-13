const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const src=fs.readFileSync('skills.js','utf8');
const start=src.indexOf('function isWeaponCard');
const end=src.indexOf('function startQiangxi',start);
assert.ok(start>=0&&end>start,'应能定位强袭武器判断');
const equips={
  '青釭剑':{slot:'weapon'},'八卦阵':{slot:'armor'},
  '赤兔':{slot:'minus1'},'的卢':{slot:'plus1'}
};
const context={getEquip:name=>equips[name]||null};
vm.createContext(context);
vm.runInContext(src.slice(start,end),context,{filename:'qiangxi-weapon.js'});
const run=expr=>vm.runInContext(expr,context);
context.weapon={name:'青釭剑'}; context.armor={name:'八卦阵'};
context.attackMount={name:'赤兔'}; context.defenseMount={name:'的卢'};
assert.strictEqual(run('isWeaponCard(weapon)'),true);
assert.strictEqual(run('isWeaponCard(armor)'),false);
assert.strictEqual(run('isWeaponCard(attackMount)'),false);
assert.strictEqual(run('isWeaponCard(defenseMount)'),false);
context.player={alive:true,equips:{weapon:null},hand:[context.armor,context.attackMount]};
assert.strictEqual(run('hasWeaponToDiscard(player)'),false);
context.player.hand.push(context.weapon);
assert.strictEqual(run('hasWeaponToDiscard(player)'),true);
context.player.hand=[]; context.player.equips.weapon=context.weapon;
assert.strictEqual(run('hasWeaponToDiscard(player)'),true);
console.log('qiangxi weapon card tests: 7/7 passed');
