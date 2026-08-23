/**
 * CORE-146: 手机横屏装备条的"2字简称"。
 *
 * 【这个测试真正在钉什么】简称是 render.js 里 `String(c.name).slice(0,2)` 取的前 2 字,
 * 没有维护简称表 —— 好处是新增装备零维护,风险是**两件装备的前 2 字可能撞车**,撞了以后
 * 手机横屏上会显示成同一个词、玩家分不清。当前 19 件装备实测无冲突,但这条断言的价值
 * 全在"以后有人往 EQUIPS 里加一件新装备时会立刻变红"。
 *
 * 覆盖:
 *  1. 全部装备的前2字互不冲突(新增装备撞车时立刻变红)
 *  2. 简称非空、且不超过 2 字
 *  3. render.js 确实输出了 data-s 属性,取值 = 前2字
 *  4. 完整名仍在 DOM 里(桌面/平板要显示全名,不能被简称替换掉)
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', (e && e.message) || e); failed++; }
}

const sandbox = vm.createContext({ console, Math, JSON, Object, Array, String, Number });
vm.runInContext(fs.readFileSync(path.join(ROOT,'data.js'),'utf8'), sandbox, { filename:'data.js' });
const EQUIPS = vm.runInContext('EQUIPS', sandbox);
const names = Object.keys(EQUIPS);
const shortOf = n => String(n).slice(0, 2);

console.log('\n' + '='.repeat(60));
console.log('  CORE-146:装备2字简称的唯一性');
console.log('='.repeat(60) + '\n');

check('装备表非空且规模合理(解析口径没失效)', () => {
  if(names.length < 15) throw new Error('EQUIPS 只解析出 ' + names.length + ' 项,口径可能失效');
});

check('★全部装备的前2字互不冲突(以后新增装备撞车会立刻变红)', () => {
  const m = {};
  names.forEach(n => { const s = shortOf(n); (m[s] = m[s] || []).push(n); });
  const dup = Object.entries(m).filter(([, v]) => v.length > 1);
  if(dup.length){
    throw new Error('前2字冲突 ' + dup.length + ' 组: '
      + dup.map(([k, v]) => '「' + k + '」← ' + v.join('/')).join('; ')
      + ' —— 需要给冲突项单独指定简称,不能继续用 slice(0,2)');
  }
  console.log('       ↳ ' + names.length + ' 件装备,简称互不冲突');
});

check('简称非空且不超过 2 字', () => {
  names.forEach(n => {
    const s = shortOf(n);
    if(!s) throw new Error(n + ' 的简称为空');
    if(s.length > 2) throw new Error(n + ' 的简称 "' + s + '" 超过 2 字');
  });
});

check('render.js 输出 data-s 且取值为前2字', () => {
  const src = fs.readFileSync(path.join(ROOT,'render.js'), 'utf8');
  if(src.indexOf("String(c.name).slice(0, 2)") < 0)
    throw new Error('render.js 里找不到"取前2字"的实现,本测试的前提失效');
  if(src.indexOf('data-s="') < 0)
    throw new Error('render.js 未输出 data-s 属性,CSS 侧的 content:attr(data-s) 会取到空');
});

check('完整装备名仍在 DOM 里(桌面/平板显示全名,不能被简称替换)', () => {
  const src = fs.readFileSync(path.join(ROOT,'render.js'), 'utf8');
  // <span class="enm" data-s="简称">全名</span> —— 全名必须仍然作为文本内容输出
  if(!/class="enm" data-s="'\+shortName\+'">'\+escapeHtml\(c\.name\)\+'<\/span>/.test(src))
    throw new Error('装备名的 DOM 结构变了:简称应放 data-s、全名仍作为文本内容');
});

check('CSS 只在手机横屏断点里用简称(桌面/平板不受影响)', () => {
  const html = fs.readFileSync(path.join(ROOT,'index.html'), 'utf8');
  const i = html.indexOf('content:attr(data-s)');
  if(i < 0) throw new Error('index.html 里找不到 content:attr(data-s)');
  // 往前找最近的 @media,必须是手机横屏那条(带 pointer:coarse)
  const before = html.slice(0, i);
  const lastMedia = before.lastIndexOf('@media');
  const mediaLine = html.slice(lastMedia, html.indexOf('{', lastMedia));
  if(mediaLine.indexOf('pointer:coarse') < 0 || mediaLine.indexOf('orientation:landscape') < 0)
    throw new Error('简称规则所在的断点不是"手机横屏+触屏",实际: ' + mediaLine.trim());
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
if(failed > 0) process.exit(1);
