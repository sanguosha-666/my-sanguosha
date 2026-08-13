const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('render.js', 'utf8');
const mapping = source.match(/const SKILL_PINYIN = \{[\s\S]*?\n\};/);
const player = source.match(/let lastPlayedSkillSeq = undefined;[\s\S]*?\n\}/);
if (!mapping || !player) throw new Error('无法定位技能音频实现');

let audioCreated = 0;
const context = {
  console,
  Audio: class {
    constructor() { audioCreated += 1; }
    play() { return Promise.resolve(); }
  },
};
vm.createContext(context);
vm.runInContext(`${mapping[0]}\n${player[0]}`, context, { filename: 'render-skill-audio.js' });

let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
}
const read = expression => vm.runInContext(expression, context);

for (const skill of ['短兵', '奋迅', '恩怨', '眩惑']) {
  check(read(`SKILL_PINYIN['${skill}']`) === undefined, `${skill} 不应注册空音频资源`);
}
check(read("SKILL_PINYIN['神速']") === 'shensu', '真实存在的技能音频映射应保留');

read('lastPlayedSkillSeq = 1');
read("maybePlaySkillSound({ lastSkillSound: { seq: 2, name: '短兵' } })");
check(audioCreated === 0, '未注册技能不应创建 Audio');
read("maybePlaySkillSound({ lastSkillSound: { seq: 3, name: '神速' } })");
check(audioCreated === 1, '已注册技能应正常创建 Audio');

console.log(`skill audio mapping tests: ${passed}/7 passed`);
