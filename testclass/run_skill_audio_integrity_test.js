const fs=require('fs');
const path=require('path');
const assert=require('assert');
const source=fs.readFileSync('render.js','utf8');
const match=source.match(/const SKILL_PINYIN = \{([\s\S]*?)\n\};/);
assert(match,'SKILL_PINYIN not found');
const entries=[...match[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
assert(entries.length>0,'至少保留一个有效技能音频映射');
for(const entry of entries){
  const skill=entry[1], base=entry[2];
  const file=path.join('assets','audio',base+'.mp3');
  assert(fs.existsSync(file),`${skill}: missing ${file}`);
  assert(fs.statSync(file).size>0,`${skill}: empty ${file}`);
}
console.log(`skill audio integrity tests: ${entries.length*2+2}/${entries.length*2+2} passed`);
