const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('debug-log.js', 'utf8');
const writes = [];
function makeClient(myClientId) {
  const context = {
    console,
    roomId: 'room-A',
    myClientId,
    db: { ref: path => ({ set: entry => { writes.push({ path, entry, myClientId }); return Promise.resolve(); } }) },
    window: { addEventListener: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'debug-log.js' });
  return context;
}
const game = {
  phase: 'play', turn: 0, roundNum: 1,
  pending: { type: 'testPending', seat: 0 },
  players: [
    { name: '甲', cid: 'client-A', isBot: false },
    { name: '乙', cid: 'client-B', isBot: false },
  ],
};
const controller = makeClient('client-A');
const observer = makeClient('client-B');
controller.g = game;
observer.g = game;
vm.runInContext("logPendingOrphan(g, 'A:共享异常')", observer);
vm.runInContext("logPendingOrphan(g, 'A:共享异常')", controller);

assert.strictEqual(writes.length, 1, '多客户端观察同一异常应仅由控制端上报一次');
assert.strictEqual(writes[0].myClientId, 'client-A', '应由第一名真人控制端上报');

const fallback = makeClient('single-client');
fallback.g = { ...game, players: [{ name: '本地玩家', isBot: false }] };
vm.runInContext("logPendingOrphan(g, 'A:本地异常')", fallback);
assert.strictEqual(writes.length, 2, '无法识别控制端时仍应保留单客户端上报能力');
console.log('debug log controller tests: 3/3 passed');
