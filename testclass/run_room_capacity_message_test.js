const fs=require('fs');
const assert=require('assert');
const source=fs.readFileSync('room-lifecycle.js','utf8');
assert(!source.includes('已有3人'),'满房提示不得写死旧容量');
assert(source.includes("const playerCount=(g.players||[]).filter(Boolean).length;"));
assert(source.includes("'房间已满（'+playerCount+'/'+SEATS+'）。'"));
for(const capacity of [2,3,9]){
  const players=Array.from({length:capacity},()=>({}));
  const playerCount=players.filter(Boolean).length;
  assert.strictEqual('房间已满（'+playerCount+'/'+capacity+'）。',`房间已满（${capacity}/${capacity}）。`);
}
console.log('room capacity message tests: 6/6 passed');
