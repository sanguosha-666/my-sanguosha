/**
 * AI 模型选择器动态拉取+搜索过滤测试(M1)
 *
 * 加载真实 ai-bot.js 进共享 vm 沙箱,覆盖:
 *   fetchProviderModels 的解析/鉴权头/失败回退/缓存/超时(1~7 条)
 *   renderModelListInto 顶层函数直接测(搜索过滤,第9条)+ 端到端驱动
 *   showAiKeyModal 的渲染/选中持久化/静态表回退/默认档位标注(8、10、11、12 条)
 *
 * 已知的 vm 坑(沿 run_ai_bus_core_test.js 惯例):aiApiKey/aiApiModel 是脚本作用域
 * let 绑定,必须用 runInContext 裸标识符赋值;fetch 是全局对象属性,同样在沙箱内
 * 裸赋值覆盖(和 callAI 函数声明整体替换同一手法)。modelListCache 是模块级 const
 * 对象,属性用 delete 清除即可。
 *
 * 测试间的状态隔离(踩过的坑,务必遵守):
 *   - fetchProviderModels 内部有会话缓存——每个用例开头 delete modelListCache.<provider>
 *   - 端到端用例之间:showAiKeyModal 每次重建弹窗内容,waitFor 必须盯"本次渲染独有
 *     的状态"(如状态行文案),不能盯"按钮数量"(上一用例的残留 DOM 会满足它)
 *   - 直测 renderModelListInto 时用局部元素引用(wrap.children),不要 getElementById
 *     (弹窗里也有同 id 的搜索框/列表,树搜索会先命中弹窗的)
 *
 * 第13条(回归)在宿主机执行:node --check ai-bot.js + 既有 run_ai_bus_* 套件全绿。
 */

const vm = require('vm');
const fs = require('fs');

// ---- 可用的最小 DOM:树形 appendChild/remove + 按树 getElementById + classList
//      真实增删 + button 收集 + oninput/onchange/onclick/onblur 属性事件 ----
function mkEl(tag){
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, _text: '', _html: '',
    id: '', className: '', disabled: false, parentEl: null,
    value: '', type: '', placeholder: '', autocomplete: '',
    onclick: null, oninput: null, onchange: null, onblur: null,
    _cls: {}, _ls: {},
    classList: {
      add: function(c){ el._cls[c] = 1; },
      remove: function(c){ delete el._cls[c]; },
      contains: function(c){ return !!el._cls[c]; },
    },
    appendChild: function(ch){ ch.parentEl = this; this.children.push(ch); return ch; },
    removeChild: function(ch){ const i = this.children.indexOf(ch); if(i>=0){ this.children.splice(i,1); ch.parentEl = null; } return ch; },
    remove: function(){ if(this.parentEl) this.parentEl.removeChild(this); },
    set textContent(v){ this._text = String(v==null?'':v); },
    get textContent(){ return this._text; },
    set innerHTML(v){ this._html = String(v==null?'':v); this.children = []; },
    get innerHTML(){ return this._html; },
    addEventListener: function(type, fn){ this._ls[type] = fn; },
    click: function(){ if(typeof this.onclick === 'function') this.onclick(); },
    querySelectorAll: function(sel){
      const out = [];
      const wantSelected = sel === 'button.selected';
      (function walk(n){
        if(n !== el && n.tagName === 'BUTTON' && (!wantSelected || n.classList.contains('selected'))) out.push(n);
        (n.children || []).forEach(walk);
      })(el);
      return out;
    }
  };
  return el;
}

const modalEl = mkEl('div'); modalEl.id = 'aiKeyModal';
const bodyEl = mkEl('body'); bodyEl.appendChild(modalEl);
const documentStub = {
  body: bodyEl,
  getElementById: function(id){
    let found = null;
    (function walk(n){
      if(found) return;
      if(n.id === id){ found = n; return; }
      (n.children || []).forEach(walk);
    })(bodyEl);
    return found;
  },
  createElement: function(tag){ return mkEl(tag); },
  createTextNode: function(t){ return { nodeValue: t, textContent: t }; },
};

const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  AbortController: AbortController,
  Date: Date,
  JSON: JSON,
  document: documentStub,
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  window: {
    aiConversations: {},
    sessionStorage: null, // 下面和裸 sessionStorage 指向同一 stub
    addEventListener: function(){},
    location: { search: '', href: 'http://localhost', reload: function(){} }
  },
};
context.window.sessionStorage = context.sessionStorage;

const sandbox = vm.createContext(context, { name: 'sgs-ai-model-picker-sandbox' });

console.log('Loading AI 模型选择器测试环境...\n');

try {
  vm.runInContext(fs.readFileSync('ai-bot.js', 'utf8'), sandbox, { filename: 'ai-bot.js' });
  console.log('  OK ai-bot.js');
} catch (e) {
  console.log('  FAIL ai-bot.js: ' + e.message);
  if (e.stack) console.log('     ' + e.stack.split('\n').slice(1, 3).join('\n     '));
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('  AI 模型选择器动态拉取+搜索过滤测试');
console.log('='.repeat(60) + '\n');

const testCode = String.raw`
(async function(){
  var pass = 0, fail = 0;
  function check(name, fn){
    return Promise.resolve().then(fn).then(function(){
      console.log('  PASS ' + name); pass++;
    }, function(e){
      console.log('  FAIL ' + name + ' - ' + (e && e.message || e)); fail++;
    });
  }

  // ---- fetch mock 基础设施:裸标识符覆盖全局 fetch,记录每次调用的 url/headers ----
  window.__fetchLog = [];
  window.__fetchImpl = function(){ return Promise.reject(new Error('no impl')); };
  fetch = function(url, opts){
    window.__fetchLog.push({ url: url, opts: opts || {} });
    return window.__fetchImpl(url, opts || {});
  };
  function jsonRes(data, status){
    status = status || 200;
    return Promise.resolve({ status: status, ok: status >= 200 && status < 300,
      json: function(){ return Promise.resolve(data); } });
  }
  function lastFetch(){
    if(!window.__fetchLog.length) throw new Error('fetch 未被调用');
    return window.__fetchLog[window.__fetchLog.length - 1];
  }

  // 1. cohere: Bearer 头 + entriesOf 过滤 is_deprecated + label=name
  await check('1. cohere Bearer 头 + entriesOf 过滤 is_deprecated + label=name', async function(){
    delete modelListCache.cohere;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ models: [
      { name: 'command-a-03-2025', is_deprecated: false }, { name: 'command-r-08-2024', is_deprecated: false }, { name: 'command-r-plus-08-2024', is_deprecated: true } ] }); };
    var r = await fetchProviderModels('cohere', 'co_test123');
    var f = lastFetch();
    if((f.url || '').indexOf('/v1/models') < 0 || (f.url || '').indexOf('endpoint=chat') < 0) throw new Error('url 应含 /v1/models?endpoint=chat,实际 ' + f.url);
    var h = f.opts.headers || {};
    if(h['authorization'] !== 'Bearer co_test123') throw new Error('authorization 头应为 Bearer co_test123,实际 ' + JSON.stringify(h));
    if(!r || r.length !== 2) throw new Error('应解析出2项(过滤已弃用),实际 ' + JSON.stringify(r));
    if(r[0].id !== 'command-a-03-2025' || r[0].label !== 'command-a-03-2025') throw new Error('第0项错误,实际 ' + JSON.stringify(r[0]));
    if(r[1].id !== 'command-r-08-2024') throw new Error('第1项错误,实际 ' + JSON.stringify(r[1]));
  });

  // 2. cerebras: 公开接口无鉴权头 + label=id
  await check('2. cerebras 公开接口无鉴权头 + label=id', async function(){
    delete modelListCache.cerebras;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: [ { id: 'zai-glm-4.7' }, { id: 'gpt-oss-120b' } ] }); };
    var r = await fetchProviderModels('cerebras', 'csk_test');
    var f = lastFetch();
    if((f.url || '').indexOf('cerebras.ai/public/v1/models') < 0) throw new Error('url 应含 cerebras.ai/public/v1/models,实际 ' + f.url);
    var h = f.opts.headers || {};
    if('authorization' in h || 'x-api-key' in h) throw new Error('cerebras 不应带鉴权头,实际 ' + JSON.stringify(h));
    if(!r || r.length !== 2 || r[0].id !== 'zai-glm-4.7') throw new Error('解析错误,实际 ' + JSON.stringify(r));
    if(r[0].label !== 'zai-glm-4.7') throw new Error('label 应等于 id,实际 ' + JSON.stringify(r[0]));
  });

  // 3. groq:Bearer 头 + label 取 id
  await check('3. groq Bearer 头 + label=id', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: [ { id: 'llama-3.3-70b-versatile' } ] }); };
    var r = await fetchProviderModels('groq', 'gsk_test');
    var h = lastFetch().opts.headers || {};
    if(h['authorization'] !== 'Bearer gsk_test') throw new Error('authorization 头应为 Bearer gsk_test,实际 ' + JSON.stringify(h));
    if(!r || r[0].id !== 'llama-3.3-70b-versatile' || r[0].label !== 'llama-3.3-70b-versatile') throw new Error('label 应回退 id,实际 ' + JSON.stringify(r && r[0]));
  });

  // 3c. tri:三家并发合并加 provider: 前缀;某一家动态拉取失败 → 该家静态表兜底
  //     (真实 bug:tri 模式下 cohere 动态失败时模型缺失——cohere 密钥有效但模型列表
  //     接口限流/超时,而 cerebras/groq 成功导致整个列表非空不回退静态表)
  await check('3c. tri 合并三家 + cohere 动态失败静态表兜底', async function(){
    delete modelListCache.tri;
    delete modelListCache.cohere;
    delete modelListCache.groq;
    delete modelListCache.cerebras;
    window.__fetchLog.length = 0;
    // 并发三家:cohere 失败(非 2xx → null)、groq 成功、cerebras 成功
    window.__fetchImpl = function(url, opts){
      if(String(url).indexOf('api.cohere.com') >= 0) return Promise.resolve({ ok:false, status:500, json:function(){ return Promise.resolve({}); }, text:function(){ return Promise.resolve(''); } });
      return jsonRes({ data: [ { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' } ] });
    };
    var r = await fetchProviderModels('tri', 'co_test/gsk_test/csk_test');
    if(!r) throw new Error('tri 应返回合并列表');
    var ids = r.map(function(x){ return x.id; }).join(',');
    // groq/cerebras 动态成功,带 provider: 前缀
    if(ids.indexOf('groq:llama-3.3-70b-versatile') < 0) throw new Error('应含 groq 动态模型,实际 ' + ids);
    if(ids.indexOf('cerebras:llama-3.3-70b-versatile') < 0) throw new Error('应含 cerebras 动态模型,实际 ' + ids);
    // cohere 动态失败 → 静态表兜底(cohere:command-a-plus-05-2026 等)
    if(ids.indexOf('cohere:command-a-plus-05-2026') < 0) throw new Error('cohere 动态失败应回退静态表(cohere:command-a-plus-05-2026),实际 ' + ids);
    if(ids.indexOf('cohere:command-a-03-2025') < 0) throw new Error('cohere 静态表应含 command-a-03-2025,实际 ' + ids);
  });

  // 4. 结构不符(data 不是数组)→ null
  await check('4. data 不是数组 → null', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: 'nope' }); };
    var r = await fetchProviderModels('groq', 'k');
    if(r !== null) throw new Error('应返回 null,实际 ' + JSON.stringify(r));
  });

  // 5. fetch reject(网络错误)→ null
  await check('5. fetch reject → null', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return Promise.reject(new Error('boom')); };
    var r = await fetchProviderModels('groq', 'k');
    if(r !== null) throw new Error('应返回 null,实际 ' + JSON.stringify(r));
  });

  // 5b. 未知 provider → null 且不发起 fetch
  await check('5b. 未知 provider → null 且不调 fetch', async function(){
    window.__fetchLog.length = 0;
    var r = await fetchProviderModels('unknown', 'k');
    if(r !== null) throw new Error('应返回 null,实际 ' + JSON.stringify(r));
    if(window.__fetchLog.length !== 0) throw new Error('未知 provider 不应发起 fetch');
  });

  // 6. 超时:mock fetch 永不 resolve + 立即触发的 abort → AbortError → null
  await check('6. 超时(立即 abort)→ null', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    var _origSt = setTimeout;
    setTimeout = function(fn){ fn(); return 1; }; // 调度即触发 → controller.abort() 同步发生
    try{
      window.__fetchImpl = function(url, opts){
        if(opts && opts.signal && opts.signal.aborted){
          var e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e);
        }
        return new Promise(function(){}); // 永不 resolve
      };
      var r = await fetchProviderModels('groq', '');
      if(r !== null) throw new Error('应返回 null,实际 ' + JSON.stringify(r));
    } finally {
      setTimeout = _origSt;
    }
  });

  // 7. 缓存:同 provider 第二次调用不再发 fetch (基于 groq)
  await check('7. 缓存:同 provider 连续两次只 fetch 一次', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: [ { id: 'a', name: 'A' } ] }); };
    var r1 = await fetchProviderModels('groq', '');
    var r2 = await fetchProviderModels('groq', '');
    if(!r1 || !r2 || r1.length !== 1) throw new Error('两次都应成功,实际 ' + JSON.stringify(r1));
    if(window.__fetchLog.length !== 1) throw new Error('应只 fetch 1 次,实际 ' + window.__fetchLog.length);
  });

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  async function waitFor(fn, desc){
    var t0 = Date.now();
    while(!fn()){
      if(Date.now() - t0 > 2000) throw new Error('等待超时: ' + desc);
      await sleep(20);
    }
  }
  function listButtons(){
    var l = document.getElementById('aiModelList');
    return l ? l.querySelectorAll('button') : [];
  }
  function statusNoteText(){
    var n = document.getElementById('aiModelStatusNote');
    return n ? n.textContent : '';
  }

  // ---- 端到端:驱动真实 showAiKeyModal(provider=groq,mock fetch 2 个模型)----
  await check('8. 端到端渲染:showAiKeyModal → 列表含 2 模型 + 自定义项', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: [
      { id: 'groq/compound' }, { id: 'llama-3.3-70b-versatile' } ] }); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = '';
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('共 2 个模型') >= 0; }, '模型列表渲染');
    var btns = listButtons();
    if(btns.length !== 3) throw new Error('应为 2 模型 + 1 自定义,实际 ' + btns.length);
    if(btns[0].textContent.indexOf('groq/compound') < 0) throw new Error('第0项应为 groq/compound,实际 ' + btns[0].textContent);
    if(btns[2].textContent.indexOf('自定义') < 0) throw new Error('末尾应为自定义项,实际 ' + btns[2].textContent);
  });

  // 9. 搜索过滤(renderModelListInto 顶层函数直测;用局部引用,不用 getElementById)
  await check('9. 搜索过滤:gemini 只剩 1 项,清空恢复全量', async function(){
    var wrap = document.createElement('div');
    document.body.appendChild(wrap);
    try{
      renderModelListInto(wrap, [
        { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
        { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      ], { selectedId: '', defaultValueId: 'openai/gpt-4o-mini', onPick: function(){} });
      var si = wrap.children[0];   // #aiModelSearchInput
      var lw = wrap.children[1];   // #aiModelList
      function localBtns(){ return lw.querySelectorAll('button'); }
      if(si.id !== 'aiModelSearchInput') throw new Error('应渲染搜索框 #aiModelSearchInput');
      if(si.placeholder !== '搜索模型…') throw new Error('搜索框 placeholder 应为 搜索模型…');
      if(localBtns().length !== 3) throw new Error('初始应为 2 项 + 自定义,实际 ' + localBtns().length);
      si.value = 'gemini';
      si.oninput();
      var btns = localBtns();
      if(btns.length !== 2) throw new Error('过滤后应为 1 项 + 自定义,实际 ' + btns.length);
      if(btns[0].textContent.indexOf('Gemini') < 0) throw new Error('过滤后应只剩 Gemini,实际 ' + btns[0].textContent);
      si.value = '';
      si.oninput();
      if(localBtns().length !== 3) throw new Error('清空搜索应恢复全量,实际 ' + localBtns().length);
    } finally {
      wrap.remove();
    }
  });

  // 10. 勾选只改画面草稿,不写实际调用池(点确定才提交)
  await check('10. 点击选项不写入调用池,点确定才提交', async function(){
    delete modelListCache.groq;
    window.__fetchImpl = function(){ return jsonRes({ data: [
      { id: 'groq/compound' }, { id: 'openai/gpt-oss-20b' }, { id: 'llama-3.1-8b-instant' } ] }); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = ''; aiApiModels = ['groq/compound'];
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('共 3 个模型') >= 0; }, '模型列表渲染');
    var btns = listButtons();
    var target = null;
    btns.forEach(function(b){ if(b.textContent.indexOf('llama-3.1-8b-instant') >= 0) target = b; });
    if(!target) throw new Error('应找到 llama-3.1-8b-instant 按钮');
    target.click();
    if(aiApiModels.indexOf('llama-3.1-8b-instant') >= 0) throw new Error('未点确定前调用池不应含 8b,实际 ' + JSON.stringify(aiApiModels));
    if(aiApiModels.indexOf('groq/compound') < 0) throw new Error('未点确定前旧池应保留 groq/compound');
    var saveBtn = document.getElementById('aiKeySaveBtn');
    if(!saveBtn) throw new Error('应有确定按钮');
    saveBtn.click();
    if(aiApiModels.indexOf('llama-3.1-8b-instant') < 0) throw new Error('点确定后调用池应含 8b,实际 ' + JSON.stringify(aiApiModels));
    if(aiApiModels.indexOf('groq/compound') < 0) throw new Error('点确定后应保留画面上仍勾着的 groq/compound,实际 ' + JSON.stringify(aiApiModels));
    if(aiApiModels.indexOf('openai/gpt-oss-20b') < 0) throw new Error('拉列表应自动勾上 ≥20B,实际 ' + JSON.stringify(aiApiModels));
  });

  await check('10b. 确定时剔除画面上没有的死模型', async function(){
    delete modelListCache.groq;
    window.__fetchImpl = function(){ return jsonRes({ data: [
      { id: 'groq/compound' }, { id: 'openai/gpt-oss-20b' } ] }); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = '';
    aiApiModels = ['groq/compound','dead-model-gone'];
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('共 2 个模型') >= 0; }, '模型列表渲染');
    var saveBtn = document.getElementById('aiKeySaveBtn');
    saveBtn.click();
    if(aiApiModels.indexOf('dead-model-gone') >= 0) throw new Error('确定后应剔除不在画面上的 dead-model-gone,实际 ' + JSON.stringify(aiApiModels));
    if(aiApiModels.indexOf('groq/compound') < 0) throw new Error('确定后应保留画面勾选的 groq/compound,实际 ' + JSON.stringify(aiApiModels));
  });

  await check('10c. 跳过丢弃草稿,调用池不变', async function(){
    delete modelListCache.groq;
    window.__fetchImpl = function(){ return jsonRes({ data: [
      { id: 'groq/compound' }, { id: 'openai/gpt-oss-20b' } ] }); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = ''; aiApiModels = ['groq/compound'];
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('共 2 个模型') >= 0; }, '模型列表渲染');
    var target = null;
    listButtons().forEach(function(b){ if(b.textContent.indexOf('openai/gpt-oss-20b') >= 0) target = b; });
    target.click();
    var skipBtn = document.getElementById('aiKeySkipBtn');
    skipBtn.click();
    if(aiApiModels.indexOf('openai/gpt-oss-20b') >= 0) throw new Error('跳过后草稿不应写入调用池,实际 ' + JSON.stringify(aiApiModels));
  });

  // 11. 回退:fetch 失败 → 静态表 AI_MODEL_OPTIONS[groq] + 失败提示
  await check('11. fetch 失败回退静态表 + 失败提示', async function(){
    delete modelListCache.groq;
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return Promise.reject(new Error('net down')); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = '';
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('模型列表加载失败') >= 0; }, '回退渲染');
    var found = false;
    listButtons().forEach(function(b){ if(b.textContent.indexOf('Groq Compound') >= 0) found = true; });
    if(!found) throw new Error('回退列表应含静态表 groq 项 Groq Compound');
  });

  // 12. 默认标注:列表含默认 id → label 追加「(默认)」;aiApiModel 空 → 默认项高亮但不写入 (groq)
  await check('12. 默认档位标注 + 空 aiApiModel 默认高亮不写入', async function(){
    delete modelListCache.groq;
    window.__fetchImpl = function(){ return jsonRes({ data: [
      { id: 'groq/compound' }, { id: 'llama-3.3-70b-versatile' } ] }); };
    aiApiKey = 'gsk_test'; aiProvider = 'groq'; aiApiModel = '';
    showAiKeyModal();
    await waitFor(function(){ return statusNoteText().indexOf('共 2 个模型') >= 0; }, '模型列表渲染');
    var def = null;
    listButtons().forEach(function(b){ if(b.textContent.indexOf('groq/compound') >= 0) def = b; });
    if(!def) throw new Error('应找到默认模型项 groq/compound');
    if(def.textContent.indexOf('(默认)') < 0) throw new Error('默认项 label 应含 (默认),实际 ' + def.textContent);
    if(aiApiModel !== '') throw new Error('多选轮换模式下 aiApiModel 应保持空(轮换池为准),实际 ' + JSON.stringify(aiApiModel));
  });

  // ---- D3:AI_DEFAULT_MODEL 单源 —— defaultModel 字段 + buildRequest 缺省用 defaultModel ----
  await check('D3-1. 四家 PROVIDER_ADAPTERS.defaultModel 与既有默认档位一致', async function(){
    var expected = {
      groq: 'groq/compound',
      cohere: 'command-a-03-2025',
      cerebras: 'gpt-oss-120b',
      tri: 'cerebras:gpt-oss-120b'
    };
    Object.keys(expected).forEach(function(p){
      if(!PROVIDER_ADAPTERS[p]) throw new Error('缺 provider ' + p);
      if(PROVIDER_ADAPTERS[p].defaultModel !== expected[p]) throw new Error(p+'.defaultModel 应为 '+expected[p]+',实际 ' + JSON.stringify(PROVIDER_ADAPTERS[p].defaultModel));
    });
    if(Object.keys(PROVIDER_ADAPTERS).length !== 4) throw new Error('PROVIDER_ADAPTERS 应为4家,实际 ' + Object.keys(PROVIDER_ADAPTERS).length);
  });

  // D3-2. AI_DEFAULT_MODEL 派生自 adapters(单源,不再各自写死)
  await check('D3-2. AI_DEFAULT_MODEL 四家均派生自 PROVIDER_ADAPTERS.defaultModel', async function(){
    ['groq','cohere','cerebras','tri'].forEach(function(p){
      if(AI_DEFAULT_MODEL[p] !== PROVIDER_ADAPTERS[p].defaultModel) throw new Error('AI_DEFAULT_MODEL.'+p+' 应等于 PROVIDER_ADAPTERS.'+p+'.defaultModel,实际 ' + JSON.stringify(AI_DEFAULT_MODEL[p]) + ' vs ' + JSON.stringify(PROVIDER_ADAPTERS[p].defaultModel));
    });
    if(Object.keys(AI_DEFAULT_MODEL).length !== 4) throw new Error('AI_DEFAULT_MODEL 应为4家,实际 ' + Object.keys(AI_DEFAULT_MODEL).length);
  });

  // D3-3. buildRequest 缺省 model 时 body.model === defaultModel(行为与旧硬编码等价)
  //      tri 不直接构造请求(callAI 分发),单独断言其 buildRequest 抛错
  await check('D3-3. buildRequest 无 opts.model 时 body.model === defaultModel', async function(){
    ['groq','cohere','cerebras'].forEach(function(p){
      var req = PROVIDER_ADAPTERS[p].buildRequest('k', { userPrompt:'hi' });
      var body = JSON.parse(req.body);
      if(body.model !== PROVIDER_ADAPTERS[p].defaultModel) throw new Error(p+' 缺省 model 应为 '+PROVIDER_ADAPTERS[p].defaultModel+',实际 ' + JSON.stringify(body.model));
    });
    // tri:无独立请求构造,必须经 callAI 分发——buildRequest 应抛错
    var triThrew = false;
    try { PROVIDER_ADAPTERS.tri.buildRequest('k', { userPrompt:'hi' }); } catch(e){ triThrew = true; }
    if(!triThrew) throw new Error('tri.buildRequest 应抛错(必须经 callAI 分发)');
  });

  // D3-4. 显式 opts.model 仍优先(回归:行为不变)
  await check('D3-4. buildRequest 显式 opts.model 优先于 defaultModel', async function(){
    ['groq','cohere','cerebras'].forEach(function(p){
      var req = PROVIDER_ADAPTERS[p].buildRequest('k', { userPrompt:'hi', model:'custom/x' });
      var body = JSON.parse(req.body);
      if(body.model !== 'custom/x') throw new Error(p+' 显式 model 应为 custom/x,实际 ' + JSON.stringify(body.model));
    });
  });

  // 回归余项(第13条):node --check + 既有 run_ai_bus_* 套件在宿主机执行,见测试文件尾部注释

  console.log('\n' + '='.repeat(60));
  console.log('  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(60) + '\n');
  __testFail = fail > 0;
  __testDone = true;
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  __testFail = true;
  __testDone = true;
});
`;

vm.runInContext(testCode, sandbox);

(async function(){
  while (sandbox.__testDone !== true) {
    await new Promise(function(r){ setTimeout(r, 10); });
  }
  process.exit(sandbox.__testFail ? 1 : 0);
})().catch(function(e){
  console.log('FATAL: ' + (e && e.stack || e));
  process.exit(1);
});

// 第13条回归(宿主机,不依赖沙箱):
//   node --check ai-bot.js
//   node run_ai_bus_core_test.js && node run_ai_bus_l1_test.js
//   (其余 run_ai_bus_* 同批跑,见任务报告)
