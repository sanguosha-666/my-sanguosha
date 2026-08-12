const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('bot.js', 'utf8');
const start = source.indexOf('let aiThinkingRequestCount = 0;');
const end = source.indexOf('// botCardBrief/', start);
assert.ok(start >= 0 && end > start, '应能定位 AI 思考提示实现');

const classes = new Set(['hidden']);
const indicator = {
  textContent: '',
  classList: {
    add: value => classes.add(value),
    remove: value => classes.delete(value),
  },
};
const context = {
  document: { getElementById: id => id === 'aiThinkingIndicator' ? indicator : null },
  g: { players: [{ name: '机器人甲' }, { name: '机器人乙' }] },
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context, { filename: 'ai-thinking-indicator.js' });

vm.runInContext('showAiThinkingIndicator(g, 0)', context);
vm.runInContext('showAiThinkingIndicator(g, 1)', context);
assert.ok(!classes.has('hidden'), '两个并发请求开始后应显示提示');

vm.runInContext('hideAiThinkingIndicator()', context);
assert.ok(!classes.has('hidden'), '先完成的请求不能隐藏仍在进行的请求');

vm.runInContext('hideAiThinkingIndicator()', context);
assert.ok(classes.has('hidden'), '所有请求完成后才隐藏提示');

vm.runInContext('hideAiThinkingIndicator()', context);
assert.strictEqual(vm.runInContext('aiThinkingRequestCount', context), 0, '额外结束调用不能令计数为负');
console.log('AI thinking indicator tests: 4/4 passed');
