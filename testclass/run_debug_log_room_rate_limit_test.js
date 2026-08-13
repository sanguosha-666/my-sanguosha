const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const writes = [];
const context = {
  console,
  roomId: 'room-A',
  db: { ref: path => ({ set: entry => { writes.push({ path, entry }); return Promise.resolve(); } }) },
  window: { addEventListener: () => {} },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('debug-log.js', 'utf8'), context, { filename: 'debug-log.js' });

const makeGame = () => ({
  phase: 'play', turn: 0, roundNum: 1,
  pending: { type: 'testPending', seat: 0 },
  players: [],
});

context.g = makeGame();
vm.runInContext("logPendingOrphan(g, 'B:同一异常')", context);
vm.runInContext("logPendingOrphan(g, 'B:同一异常')", context);
assert.strictEqual(writes.length, 1, '同房间同类异常在 60 秒内应去重');

context.roomId = 'room-B';
vm.runInContext("logPendingOrphan(g, 'B:同一异常')", context);
assert.strictEqual(writes.length, 2, '不同房间的同类异常不应互相抑制');
assert.ok(writes[0].path.startsWith('debugLogs/room-A/'));
assert.ok(writes[1].path.startsWith('debugLogs/room-B/'));
console.log('debug log room rate-limit tests: 4/4 passed');
