const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('room-lifecycle.js', 'utf8');
const start = source.indexOf('function backToLobby(){');
assert.ok(start >= 0, '应能定位 backToLobby');
const fn = source.slice(start);

let resetCalls = 0;
const elements = {
  game: { classList: { add: () => {} } },
  lobby: { classList: { remove: () => {} } },
  lobbyErr: { textContent: '' },
};
const context = {
  chatQuery: { off: () => {} }, chatRef: {}, chatMessages: ['旧消息'],
  mySeat: 2, selectedCardIdx: 3,
  resetZhangba: () => {},
  aiSummaryReset: () => { resetCalls += 1; },
  document: { getElementById: id => elements[id] },
};
vm.createContext(context);
vm.runInContext(fn, context, { filename: 'backToLobby.js' });
vm.runInContext('backToLobby()', context);

assert.strictEqual(resetCalls, 1, '离开房间时必须清理 AI 摘要');
assert.strictEqual(vm.runInContext('mySeat', context), null, '仍应正常清理当前座位');
assert.strictEqual(elements.lobbyErr.textContent, '房间已清理,可重新进入。');
console.log('AI summary room lifecycle tests: 3/3 passed');
