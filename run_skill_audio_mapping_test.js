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

const emittedSkills = new Set();
for (const file of ['data.js', 'game.js', 'room-lifecycle.js', 'sha/sha-resolution.js', 'skills.js']) {
  const code = fs.readFileSync(file, 'utf8');
  for (const match of code.matchAll(/markSkillSound\(g,\s*['"]([^'"]+)['"]/g)) {
    emittedSkills.add(match[1]);
  }
}
for (const skill of emittedSkills) {
  check(read(`typeof SKILL_PINYIN[${JSON.stringify(skill)}] === 'string'`), `${skill} 应注册技能音频`);
}
const configuredSkills = new Set();
const dataSource = fs.readFileSync('data.js','utf8');
for (const match of dataSource.matchAll(/gender:'(?:male|female)'.*?skill:'([^']+)'/g)) {
  for (const rawSkill of match[1].split('/')) {
    configuredSkills.add(rawSkill.replace(/\([^)]*\)/g, '').trim());
  }
}
const newlyAuditedTriggers = [
  '英姿','化身','毅重','救援','巨象','空城','激将','血裔','巧变','克己','志继','断粮','挑衅','同疾','突袭','悲歌',
  '明策','洛神','烈弓','咆哮','帷幕','无双','义从','倾国','护驾','祸首','红颜','缠怨','观星','铁骑','马术','骁果'
];
for (const skill of newlyAuditedTriggers) {
  check(emittedSkills.has(skill), `${skill} 应有明确的技能语音触发点`);
}
for (const skill of configuredSkills) {
  check(read(`typeof SKILL_PINYIN[${JSON.stringify(skill)}] === 'string'`), `${skill} 应准备技能音频资源`);
}
check(read("SKILL_PINYIN['趫猛']") === 'qiaomeng', '趫猛显示名应映射到 qiaomeng 音频');

read('lastPlayedSkillSeq = 1');
read("maybePlaySkillSound({ lastSkillSound: { seq: 2, name: '不存在技能' } })");
check(audioCreated === 0, '未注册技能不应创建 Audio');
read("maybePlaySkillSound({ lastSkillSound: { seq: 3, name: '刚烈' } })");
check(audioCreated === 1, '已注册技能应正常创建 Audio');
read("maybePlaySkillSound({ lastSkillSound: { seq: 4, name: '神速' } })");
check(audioCreated === 2, '原有技能音频应继续正常创建 Audio');

console.log(`skill audio mapping tests: ${passed}/${passed} passed`);
