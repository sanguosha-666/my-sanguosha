/**
 * CORE-179(issue #238):动画全屏拉伸未自适应。
 *
 * 锁定：
 *  1. 大厅 #bgVideo 仍用 .bg-video + object-fit:cover 铺满
 *  2. 死亡/闪电/过场三条特效 video 改用独立 .fx-video，不再复用 .bg-video
 *  3. .fx-video 全视口背景层 + contain 留黑边，不 cover 裁切、不 stretch；不要 max-width/max-height 小窗
 */
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn){
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e){ console.log('  FAIL', name, '-', e.message); failed++; }
}
const norm = t => String(t).replace(/\s+/g,'');

const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');

function classOf(id){
  const m = html.match(new RegExp('<video\\s+id="'+id+'"\\s+class="([^"]*)"'));
  if(!m) throw new Error('找不到 <video id="'+id+'">');
  return m[1].trim().split(/\s+/);
}
function cssRule(selector){
  const re = new RegExp(selector.replace('.','\\.')+'\\s*\\{([^}]+)\\}');
  const m = html.match(re);
  if(!m) throw new Error('找不到 CSS 规则 '+selector);
  return norm(m[1]);
}

console.log('\n== CORE-179 特效视频自适应 ==\n');

check('大厅 bgVideo 仍用 bg-video', function(){
  const cls = classOf('bgVideo');
  assert.ok(cls.indexOf('bg-video') >= 0, 'bgVideo 应保留 bg-video，实际 '+cls.join(' '));
  assert.ok(cls.indexOf('fx-video') < 0, '大厅背景不应挂 fx-video');
});

check('三条特效 video 用 fx-video，不再挂 bg-video', function(){
  ['deathFxVideo','lightningFxVideo','movieFxVideo'].forEach(id=>{
    const cls = classOf(id);
    assert.ok(cls.indexOf('fx-video') >= 0, id+' 应有 fx-video，实际 '+cls.join(' '));
    assert.ok(cls.indexOf('bg-video') < 0, id+' 不应再挂 bg-video，实际 '+cls.join(' '));
  });
});

check('.bg-video 仍是 cover 铺满', function(){
  const rule = cssRule('.bg-video');
  assert.ok(rule.indexOf('object-fit:cover') >= 0, '.bg-video 应保持 cover，实际 '+rule);
});

check('.fx-video 全视口 contain 黑边，不 cover、不小窗', function(){
  const rule = cssRule('.fx-video');
  assert.ok(rule.indexOf('object-fit:contain') >= 0, '.fx-video 应为 contain，实际 '+rule);
  assert.ok(rule.indexOf('width:100%') >= 0, '.fx-video 应为 width:100%，实际 '+rule);
  assert.ok(rule.indexOf('height:100%') >= 0, '.fx-video 应为 height:100%，实际 '+rule);
  assert.ok(/background:#000|background:#000000|background:black/.test(rule), '.fx-video 背景应为黑，实际 '+rule);
  assert.ok(rule.indexOf('visibility:hidden') >= 0, '.fx-video 默认必须 hidden，否则进房三条空 video 全屏黑底盖住界面，实际 '+rule);
  assert.ok(rule.indexOf('object-fit:cover') < 0, '.fx-video 不应 cover 裁切');
  assert.ok(rule.indexOf('max-width') < 0, '.fx-video 不应有 max-width 小窗限制');
  assert.ok(rule.indexOf('max-height') < 0, '.fx-video 不应有 max-height 小窗限制');
});

console.log('\ncore179 fx video fit: '+passed+'/'+(passed+failed)+' passed');
if(failed) process.exit(1);
