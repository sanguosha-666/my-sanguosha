const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync('room-lifecycle.js','utf8');
const start=source.indexOf('function isRoomOwner');
const end=source.indexOf('function backToLobby',start);
assert(start>=0&&end>start,'room owner functions not found');

let seat=1;
let snapshot={players:[{name:'owner'},{name:'guest'}],started:false,phase:'lobby',deck:[],discard:[]};
let removed=0;
const context={
  mySeat:seat,currentG:snapshot,MIN_PLAYERS:2,SEATS:8,GENERALS:{},
  tx(fn){ snapshot=fn(snapshot); },
  gameRef:{off(){},remove(){removed++;return Promise.resolve();}},
  chatQuery:null,chatRef:null,confirm(){return true;},alert(){},
  Promise,console
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context);

assert.strictEqual(context.isRoomOwner(snapshot,0),true);
assert.strictEqual(context.isRoomOwner(snapshot,1),false);
context.startGame('random','ffa');
assert.strictEqual(snapshot.started,false,'guest must not start game');
context.newGame();
assert.strictEqual(snapshot.log,undefined,'guest must not reset game');
context.cleanupRoom();
assert.strictEqual(removed,0,'guest must not remove room');

const controls=fs.readFileSync('render-controls.js','utf8');
assert(controls.includes("waiting.textContent='等待房主开始游戏'"));
assert(controls.includes("if(mySeat===0) c.appendChild(btnPick)"));
assert(/if\(mySeat===0\)\{\r?\n\s+const btn=document\.createElement\('button'\); btn\.className='primary';/.test(controls));
const render=fs.readFileSync('render.js','utf8');
assert(render.includes("closeRoomBtn.classList.toggle('hidden', !isRoomOwner(g,mySeat))"));

console.log('room owner guard tests: 8/8 passed');
