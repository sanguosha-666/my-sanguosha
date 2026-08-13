const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const stages=fs.readFileSync('stages/stage-table.js','utf8');
const game=fs.readFileSync('game.js','utf8');
const dataBlock=stages.match(/const STAGE_TABLE = Object\.create\(null\);[\s\S]*?\}\)\.forEach\(\(\[type,actor\]\)=>registerStage\(type,\{actor\}\)\);/);
const normalizeBlock=stages.match(/function normalizeRegisteredStage\(g\)\{[\s\S]*?\n\}/);
assert(dataBlock&&normalizeBlock,'应能提取统一阶段表和声明式校验入口');
const logs=[];
const ctx=vm.createContext({Number,Array,logPendingOrphan:(g,msg)=>logs.push(msg)});
vm.runInContext(dataBlock[0]+'\n'+normalizeBlock[0],ctx);
vm.runInContext(`registerStage('demoStage',{
  actor:'seat', required:['seat','cards'], alive:['seat'], orphanPhase:'play',
  timeoutAction:function(){}, render:function(){}, botDecision:function(){}
});`,ctx);
const read=expr=>vm.runInContext(expr,ctx);
assert.strictEqual(read("stageActorField('demoStage')"),'seat');
assert.strictEqual(read("typeof STAGE_TABLE.demoStage.timeoutAction"),'function');
assert.strictEqual(read("typeof STAGE_TABLE.demoStage.render"),'function');
assert.strictEqual(read("typeof STAGE_TABLE.demoStage.botDecision"),'function');
assert.strictEqual(read("STAGE_TABLE.demoStage.required.join(',')"),'seat,cards');
const valid={phase:'demoStage',players:[{alive:true}],pending:{type:'demoStage',seat:0,cards:[]}};
ctx.valid=valid; read('normalizeRegisteredStage(valid)');
assert(valid.pending,'合法新阶段不得被清理');
const invalid={phase:'demoStage',players:[{alive:false}],pending:{type:'demoStage',seat:0,cards:[]}};
ctx.invalid=invalid; read('normalizeRegisteredStage(invalid)');
assert.strictEqual(invalid.pending,null);
assert.strictEqual(invalid.phase,'play');
assert.strictEqual(logs.length,1);
assert(!game.includes('const RESPONSE_PENDING_TYPES'),'不得保留平行超时白名单');
assert(!game.includes('BOT_PHASE_ACTOR'),'game 不得依赖平行 actor 表');
const bot=fs.readFileSync('bot.js','utf8');
assert(bot.includes("const stageSpec=STAGE_TABLE[g.phase]"),'机器人必须从统一阶段表读取 botDecision');
assert(!bot.includes('const BOT_PHASE_ACTOR'),'不得保留平行 actor 表');
console.log('stage table contract tests: 10/10 passed (single-row zero-registration demo)');
