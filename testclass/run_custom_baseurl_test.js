/**
 * 自定义 BaseURL 模型拉取测试
 *
 * 钉死：
 *   1. resolveAiBaseModelsUrl 不得把 /v1/chat/completions 拼成 /v1/v1/models
 *   2. resolveAiBaseChatUrl 完整 chat URL 保持 /v1/chat/completions
 *   3. fetchCustomModels 解析 OpenAI data[] / models[] / 顶层数组
 *   4. 拉取失败不得静默回退 groq 静态表（调用方应拿到 error + 空列表）
 */
const vm = require('vm');
const fs = require('fs');

const context = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  AbortController: AbortController,
  Date: Date,
  JSON: JSON,
  document: {
    getElementById: function(){ return null; },
    createElement: function(){ return { style:{}, classList:{add:function(){},remove:function(){},contains:function(){return false;}}, appendChild:function(){}, children:[] }; },
    createTextNode: function(t){ return { textContent: t }; },
  },
  sessionStorage: {
    _d: {},
    getItem: function(k){ return this._d[k] !== undefined ? this._d[k] : null; },
    setItem: function(k, v){ this._d[k] = String(v); },
    removeItem: function(k){ delete this._d[k]; }
  },
  window: { addEventListener: function(){}, location: { search: '', href: 'http://localhost' } },
};
context.window.sessionStorage = context.sessionStorage;
const sandbox = vm.createContext(context, { name: 'sgs-custom-baseurl-sandbox' });

vm.runInContext(fs.readFileSync('ai-bot.js', 'utf8'), sandbox, { filename: 'ai-bot.js' });

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

  window.__fetchLog = [];
  window.__fetchImpl = function(){ return Promise.reject(new Error('no impl')); };
  fetch = function(url, opts){
    window.__fetchLog.push({ url: url, opts: opts || {} });
    return window.__fetchImpl(url, opts || {});
  };
  function jsonRes(data, status){
    status = status || 200;
    return Promise.resolve({
      status: status, ok: status >= 200 && status < 300,
      json: function(){ return Promise.resolve(data); },
      text: function(){ return Promise.resolve(JSON.stringify(data)); }
    });
  }

  await check('1. /v1/chat/completions → /v1/models（禁止 /v1/v1/models）', function(){
    var u = resolveAiBaseModelsUrl('https://api.openai.com/v1/chat/completions');
    if(u !== 'https://api.openai.com/v1/models') throw new Error('实际 ' + u);
    u = resolveAiBaseModelsUrl('https://proxy.example/v1/chat/completions/');
    if(u !== 'https://proxy.example/v1/models') throw new Error('尾斜杠实际 ' + u);
  });

  await check('2. /v1 前缀 → /v1/models', function(){
    var u = resolveAiBaseModelsUrl('https://api.openai.com/v1');
    if(u !== 'https://api.openai.com/v1/models') throw new Error('实际 ' + u);
    u = resolveAiBaseModelsUrl('https://openrouter.ai/api/v1/');
    if(u !== 'https://openrouter.ai/api/v1/models') throw new Error('openrouter 实际 ' + u);
  });

  await check('3. 仅主机 → /v1/models', function(){
    var u = resolveAiBaseModelsUrl('https://llm.example.com');
    if(u !== 'https://llm.example.com/v1/models') throw new Error('实际 ' + u);
  });

  await check('4. chat URL 不得拼成 /v1/v1/chat/completions', function(){
    var u = resolveAiBaseChatUrl('https://api.openai.com/v1/chat/completions');
    if(u !== 'https://api.openai.com/v1/chat/completions') throw new Error('实际 ' + u);
    u = resolveAiBaseChatUrl('https://api.openai.com/v1');
    if(u !== 'https://api.openai.com/v1/chat/completions') throw new Error('/v1 实际 ' + u);
  });

  await check('5. fetchCustomModels 解析 data[]', async function(){
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ data: [ { id: 'gpt-4o-mini' }, { id: 'gpt-4o' } ] }); };
    var r = await fetchCustomModels('https://api.openai.com/v1', 'sk-test');
    var models = r && (r.models || r);
    if(!models || models.length !== 2) throw new Error('应解析 2 项,实际 ' + JSON.stringify(r));
    if(models[0].id !== 'gpt-4o-mini') throw new Error('第0项 ' + JSON.stringify(models[0]));
    if(window.__fetchLog[0].url !== 'https://api.openai.com/v1/models') throw new Error('url ' + window.__fetchLog[0].url);
  });

  await check('6. fetchCustomModels 解析 models[]（非 data[]）', async function(){
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return jsonRes({ models: [ { id: 'foo' }, { name: 'bar' } ] }); };
    var r = await fetchCustomModels('https://proxy.example/v1', '');
    var models = r && (r.models || r);
    if(!models || models.length !== 2) throw new Error('应解析 models[],实际 ' + JSON.stringify(r));
    if(models[1].id !== 'bar') throw new Error('name 应作 id,实际 ' + JSON.stringify(models[1]));
  });

  await check('7. 拉取失败返回 error，不得假装成功', async function(){
    window.__fetchLog.length = 0;
    window.__fetchImpl = function(){ return Promise.reject(new Error('Failed to fetch')); };
    var r = await fetchCustomModels('https://no-cors.example/v1', 'sk-x');
    var models = r && r.models;
    if(Array.isArray(r) && r.length) throw new Error('失败不应返回模型数组,实际 ' + JSON.stringify(r));
    if(models && models.length) throw new Error('失败不应返回模型列表,实际 ' + JSON.stringify(r));
    if(r && r.error){
      if(String(r.error).indexOf('Failed to fetch') < 0 && String(r.error).indexOf('网络') < 0 && String(r.error).indexOf('CORS') < 0)
        throw new Error('error 应含失败原因,实际 ' + r.error);
    } else if(r !== null && r !== undefined && !r.error){
      throw new Error('失败应返回 {models:[], error} 或 null,实际 ' + JSON.stringify(r));
    }
  });

  console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
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
})();
