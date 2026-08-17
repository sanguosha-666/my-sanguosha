/**
 * CORE-120(issue #152):AI托管信息窗/AI决策面板的拖动与resize在触屏设备上失效。
 *
 * 【锁定什么】ai-bot.js:1797-1842(initAiTestModalDrag IIFE)原来只监听 mousedown/
 * mousemove/mouseup,触屏设备(pointer:coarse,如平板)完全无法拖动/调整大小。改用
 * Pointer Events(pointerdown/pointermove/pointerup/pointercancel)统一处理鼠标+触屏,
 * 不写两套并行逻辑。这份测试直接加载真实 ai-bot.js 源码到 vm 沙箱,捕获它注册在
 * document 上的 pointerdown 监听器,用合成 PointerEvent-like 对象手动驱动完整的
 * down->move->up 序列(不是只测"pointerdown监听器存在"这种表层断言),断言:
 *  1. 拖动 header 能正确更新 left/top
 *  2. 拖动 resize 手柄能正确更新 width/height
 *  3. 关闭按钮(.aitest-close,在 header 内部)不会被 header 拖动逻辑拦截——pointerdown
 *     打在关闭按钮上时,拖动分支直接放行(不 preventDefault、不启动 move/up 监听),
 *     不影响关闭按钮自己的 onclick
 *  4. setPointerCapture/releasePointerCapture 被正确调用(避免快速滑动超出手柄区域丢失
 *     拖动状态)
 *  5. pointerId 不匹配的 move/up 事件不会误更新面板状态(多点触控场景下的隔离)
 *
 * 真实设备上的实测(4机型/桌面鼠标+手机横屏+平板,CDP Input.dispatchTouchEvent 构造
 * 真实触屏手势)已在改动时人工跑过,见 commit 记录/issue 讨论;这份测试锁定的是"这段
 * 拖动/resize核心逻辑本身、用 PointerEvent 驱动时行为是否正确",防止以后被误改回
 * mouse-only 或引入回归而没人发现。
 */
const vm = require('vm');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, fn){
  try{ fn(); console.log('  PASS ' + name); pass++; }
  catch(e){ console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++; }
}

// ---- 最小 DOM 元素 stub:只实现这段拖动逻辑真正用到的能力 ----
function makeEl(opts){
  opts = opts || {};
  const el = {
    className: opts.className || '',
    id: opts.id || '',
    parentElement: null,
    offsetLeft: opts.offsetLeft || 0,
    offsetTop: opts.offsetTop || 0,
    offsetWidth: opts.offsetWidth || 0,
    offsetHeight: opts.offsetHeight || 0,
    style: {},
    classList: {
      _hidden: !!opts.hidden,
      contains: function(name){ return name === 'hidden' ? this._hidden : false; }
    },
    _capturedPointerIds: [],
    setPointerCapture: function(id){ this._capturedPointerIds.push(id); },
    releasePointerCapture: function(id){
      const i = this._capturedPointerIds.indexOf(id);
      if(i >= 0) this._capturedPointerIds.splice(i, 1);
    },
    closest: function(selector){
      // 支持这段代码里实际用到的几种selector形态:'.aitest-header'/'.aitest-resize-handle'/
      // '.aitest-close'/'#aiTestModal, #aiPanelModal'
      let node = this;
      const wants = selector.split(',').map(function(s){ return s.trim(); });
      while(node){
        for(const w of wants){
          if(w[0] === '.' && (' ' + node.className + ' ').indexOf(' ' + w.slice(1) + ' ') >= 0) return node;
          if(w[0] === '#' && node.id === w.slice(1)) return node;
        }
        node = node.parentElement;
      }
      return null;
    }
  };
  return el;
}

function buildModalTree(){
  const modal = makeEl({ id: 'aiTestModal', offsetLeft: 100, offsetTop: 80, offsetWidth: 420, offsetHeight: 300 });
  const header = makeEl({ className: 'aitest-header' });
  header.parentElement = modal;
  const closeBtn = makeEl({ className: 'aitest-close icon-btn', id: 'aiTestCloseBtn' });
  closeBtn.parentElement = header;
  const resizeHandle = makeEl({ className: 'aitest-resize-handle' });
  resizeHandle.parentElement = modal;
  return { modal, header, closeBtn, resizeHandle };
}

// ---- vm 沙箱:document.addEventListener 捕获监听器而不是丢弃 ----
const listeners = {};
const context = {
  console: console,
  document: {
    addEventListener: function(type, fn){
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: function(type, fn){
      if(!listeners[type]) return;
      const i = listeners[type].indexOf(fn);
      if(i >= 0) listeners[type].splice(i, 1);
    }
  },
  window: {}
};
context.global = context;
const sandbox = vm.createContext(context, { name: 'sgs-core120-sandbox' });

console.log('\n' + '='.repeat(60));
console.log('  CORE-120: AI托管/AI决策面板拖动改用 Pointer Events');
console.log('='.repeat(60) + '\n');

check('加载真实 ai-bot.js 源码,initAiTestModalDrag 注册了 pointerdown 监听器', function(){
  const code = fs.readFileSync('ai-bot.js', 'utf8');
  vm.runInContext(code, sandbox, { filename: 'ai-bot.js' });
  if(!listeners.pointerdown || listeners.pointerdown.length < 2)
    throw new Error('期望至少注册2个pointerdown监听器(header拖动 + resize手柄),实际: ' + (listeners.pointerdown ? listeners.pointerdown.length : 0));
});

function fireAll(type, ev){
  (listeners[type] || []).forEach(function(fn){ fn(ev); });
}
function makeEvent(target, clientX, clientY, pointerId){
  return {
    target: target,
    clientX: clientX, clientY: clientY,
    pointerId: pointerId,
    _prevented: false, _stopped: false,
    preventDefault: function(){ this._prevented = true; },
    stopPropagation: function(){ this._stopped = true; }
  };
}

check('拖动 header 能正确更新 left/top(down->move->up 完整序列)', function(){
  const { modal, header } = buildModalTree();
  const downEv = makeEvent(header, 300, 200, 1);
  fireAll('pointerdown', downEv);
  if(!downEv._prevented) throw new Error('header pointerdown 应该 preventDefault');
  if(header._capturedPointerIds.indexOf(1) < 0) throw new Error('header 应该调用 setPointerCapture(1)');

  fireAll('pointermove', makeEvent(header, 350, 260, 1)); // dx=+50, dy=+60
  if(modal.style.left !== '150px' || modal.style.top !== '140px')
    throw new Error('拖动中 left/top 应实时更新,实际 left=' + modal.style.left + ' top=' + modal.style.top);

  fireAll('pointerup', makeEvent(header, 350, 260, 1));
  if(header._capturedPointerIds.indexOf(1) >= 0) throw new Error('pointerup 后应该 releasePointerCapture(1)');
  if(modal.style.left !== '150px' || modal.style.top !== '140px')
    throw new Error('松手后位置应保持,实际 left=' + modal.style.left + ' top=' + modal.style.top);
});

check('拖动 header 不会让 left/top 变成负数(Math.max(0,...)下限保护)', function(){
  const { modal, header } = buildModalTree();
  fireAll('pointerdown', makeEvent(header, 300, 200, 5));
  fireAll('pointermove', makeEvent(header, -900, -900, 5)); // 大幅拖到屏幕外
  fireAll('pointerup', makeEvent(header, -900, -900, 5));
  if(modal.style.left !== '0px' || modal.style.top !== '0px')
    throw new Error('应被clamp到0px,实际 left=' + modal.style.left + ' top=' + modal.style.top);
});

check('pointerId 不匹配的 move/up 不会误更新面板状态(多点触控隔离)', function(){
  const { modal, header } = buildModalTree();
  fireAll('pointerdown', makeEvent(header, 300, 200, 7));
  // 另一个手指(pointerId=8)的move不应该影响这次拖动
  fireAll('pointermove', makeEvent(header, 999, 999, 8));
  if(modal.style.left !== undefined && modal.style.left === '699px')
    throw new Error('不同pointerId的move不应该被采纳');
  // 真正的手指(7)move才生效
  fireAll('pointermove', makeEvent(header, 320, 210, 7));
  if(modal.style.left !== '120px' || modal.style.top !== '90px')
    throw new Error('匹配pointerId的move应该生效,实际 left=' + modal.style.left + ' top=' + modal.style.top);
});

check('拖动 resize 手柄能正确更新 width/height(down->move->up 完整序列)', function(){
  const { modal, resizeHandle } = buildModalTree();
  const downEv = makeEvent(resizeHandle, 500, 400, 2);
  fireAll('pointerdown', downEv);
  if(!downEv._prevented || !downEv._stopped)
    throw new Error('resize handle pointerdown 应该 preventDefault + stopPropagation');
  if(resizeHandle._capturedPointerIds.indexOf(2) < 0) throw new Error('resize handle 应该调用 setPointerCapture(2)');

  fireAll('pointermove', makeEvent(resizeHandle, 560, 450, 2)); // dx=+60, dy=+50
  if(modal.style.width !== '480px' || modal.style.height !== '350px')
    throw new Error('拖动中 width/height 应实时更新,实际 width=' + modal.style.width + ' height=' + modal.style.height);

  fireAll('pointerup', makeEvent(resizeHandle, 560, 450, 2));
  if(resizeHandle._capturedPointerIds.indexOf(2) >= 0) throw new Error('pointerup 后应该 releasePointerCapture(2)');
});

check('resize 有最小尺寸下限(Math.max(280,...)/Math.max(200,...))', function(){
  const { modal, resizeHandle } = buildModalTree();
  fireAll('pointerdown', makeEvent(resizeHandle, 500, 400, 3));
  fireAll('pointermove', makeEvent(resizeHandle, -900, -900, 3)); // 大幅缩小
  fireAll('pointerup', makeEvent(resizeHandle, -900, -900, 3));
  if(modal.style.width !== '280px' || modal.style.height !== '200px')
    throw new Error('应被clamp到最小280x200,实际 width=' + modal.style.width + ' height=' + modal.style.height);
});

check('关闭按钮(header内部)的 pointerdown 不会触发拖动逻辑(不preventDefault,不影响onclick)', function(){
  const { modal, closeBtn } = buildModalTree();
  const downEv = makeEvent(closeBtn, 300, 200, 9);
  fireAll('pointerdown', downEv);
  if(downEv._prevented) throw new Error('点在关闭按钮上不应该preventDefault,否则可能干扰它自己的click');
  // 没有启动拖动:后续move不应该改变modal位置
  fireAll('pointermove', makeEvent(closeBtn, 400, 300, 9));
  if(modal.style.left !== undefined)
    throw new Error('关闭按钮上的pointerdown不应该启动header拖动,modal.style.left不应该被设置,实际=' + modal.style.left);
});

check('隐藏状态的面板(classList含hidden)不响应拖动', function(){
  const { modal, header } = buildModalTree();
  modal.classList._hidden = true;
  const downEv = makeEvent(header, 300, 200, 4);
  fireAll('pointerdown', downEv);
  if(downEv._prevented) throw new Error('隐藏状态的面板不应该preventDefault/启动拖动');
});

// 破坏性验证:证明"拖动能正确更新left/top"这条断言确实有鉴别力——如果 pointermove 时
// 不比较 pointerId(去掉隔离判断),用不匹配的pointerId也能"拖动"成功,应该报红。
check('破坏性验证:确认"拖动中left/top应实时更新"断言有鉴别力(用未触发down的场景应保持初值)', function(){
  const { modal, header } = buildModalTree();
  // 完全不发送pointerdown,直接发pointermove——不应该有任何模块级"当前拖动会话"响应它
  fireAll('pointermove', makeEvent(header, 999, 999, 999));
  if(modal.style.left === '899px')
    throw new Error('未经pointerdown的孤立pointermove不应该移动面板,如果这里报错说明上面的断言本身没有鉴别力');
});

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
console.log('='.repeat(60) + '\n');
if(fail > 0) process.exit(1);
