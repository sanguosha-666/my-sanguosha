const fs = require('fs');

const source = fs.readFileSync('render-controls.js', 'utf8');
const ownStart = source.indexOf("if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie' && g.pending.asking===mySeat){");
const spectatorStart = source.indexOf("if(g.phase==='wuxie' && g.pending && g.pending.type==='wuxie'){", ownStart + 1);
const spectatorEnd = source.indexOf("if(g.phase==='guicai'", spectatorStart);

if(ownStart < 0 || spectatorStart < 0 || spectatorEnd < 0){
  throw new Error('无法定位无懈可击本人/旁观者渲染分支');
}

const ownBranch = source.slice(ownStart, spectatorStart);
const spectatorBranch = source.slice(spectatorStart, spectatorEnd);

if(!ownBranch.includes("b1.textContent='打出【无懈可击】'")){
  throw new Error('当前被询问者的无懈按钮丢失');
}
if(!ownBranch.includes("b2.textContent='不出'")){
  throw new Error('当前被询问者的不出按钮丢失');
}
if(spectatorBranch.includes('g.pending.asking')){
  throw new Error('旁观者分支仍读取 pending.asking');
}
if(!spectatorBranch.includes('等待其他玩家响应【无懈可击】…')){
  throw new Error('旁观者等待提示缺失');
}
if(!spectatorBranch.includes('useDesc') || !spectatorBranch.includes('g.pending.trick')){
  throw new Error('旁观者提示未保留当前锦囊信息');
}
if(!spectatorBranch.includes("g.pending.depth>0")){
  throw new Error('旁观者提示未保留反制无懈分支');
}

console.log('PASS: 无懈可击本人按钮保留，旁观者提示不公开当前轮询玩家');
