// run_model_rotation_test.js —— 多模型轮换回归套件
// 用法: node run_model_rotation_test.js
const vm = require('vm');
const fs = require('fs');
let fetchCalls = [];
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } } }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage: { getItem: function(k){ return context.__ls && k in context.__ls ? context.__ls[k] : null; }, setItem: function(k,v){ if(!context.__ls) context.__ls={}; context.__ls[k]=String(v); }, removeItem: function(k){ if(context.__ls) delete context.__ls[k]; } }, sessionStorage: { getItem: function(k){ return context.__ss && k in context.__ss ? context.__ss[k] : null; }, setItem: function(k,v){ if(!context.__ss) context.__ss={}; context.__ss[k]=String(v); }, removeItem: function(k){ if(context.__ss) delete context.__ss[k]; } }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' }, fetch: function(url, opts){ fetchCalls.push({url:url, opts:opts}); return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ choices:[{ message:{ content:'{"choice":0}' } }] }); }, text:function(){ return Promise.resolve(''); } }); } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp
};
context.window.document = context.document;
// callAI 内部用裸 fetch(不是 window.fetch),桥接一层让全局 fetch 委托到 window.fetch,
// 测试里覆写 window.fetch 即对 callAI 生效。
context.fetch = function(url, opts){ return context.window.fetch(url, opts); };
const sandbox = vm.createContext(context);
const files = ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','bot-ai-bus.js','bot.js','ai-bot.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
async function check(name, fn){
  try{ await fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  // 0. 默认勾选列表(既有4条 + 全部20B+模型,用户确认)
  await check('默认勾选: groq 6模型(既有4条+全部20B+)', function(){
    const d = vm.runInContext('DEFAULT_GROQ_MODELS', sandbox);
    if(!d || d.length!==6) throw new Error('应6个,实际 '+(d&&d.length));
    ['groq/compound','llama-3.3-70b-versatile','openai/gpt-oss-120b','qwen/qwen3.6-27b','openai/gpt-oss-20b','openai/gpt-oss-safeguard-20b'].forEach(function(m){
      if(d.indexOf(m)<0) throw new Error('缺 '+m);
    });
  });
  // 0b. hf 默认勾选:groq 全部4个 + cerebras 全部3个 + cohere reasoning 1个(共8个)
  await check('默认勾选: hf groq全部+cerebras全部+cohere reasoning', function(){
    const d = vm.runInContext('DEFAULT_HF_MODELS', sandbox);
    if(!d || d.length!==8) throw new Error('应8个,实际 '+(d&&d.length));
    ['openai/gpt-oss-120b:groq','openai/gpt-oss-20b:groq','meta-llama/Llama-3.3-70B-Instruct:groq','openai/gpt-oss-safeguard-20b:groq',
     'openai/gpt-oss-120b:cerebras','google/gemma-4-31B-it:cerebras','zai-org/GLM-4.7:cerebras',
     'CohereLabs/command-a-reasoning-08-2025:cohere'].forEach(function(m){
      if(d.indexOf(m)<0) throw new Error('缺 '+m);
    });
  });
  // 0c. resolveAiModel: hf 走 provider 优先级(cerebras>groq>cohere),每次从头选最高优先级
  await check('resolveAiModel: hf 优先cerebras再groq再cohere', function(){
    vm.runInContext('aiProvider="hf"; aiApiModel=""; aiApiModels=["openai/gpt-oss-120b:groq","CohereLabs/c4ai-command-a-03-2025:cohere","openai/gpt-oss-120b:cerebras"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
    const r1 = vm.runInContext('resolveAiModel', sandbox)('hf');
    const r2 = vm.runInContext('resolveAiModel', sandbox)('hf');
    const r3 = vm.runInContext('resolveAiModel', sandbox)('hf');
    // 无冷却时三次都应选 cerebras(优先级最高),不是 round-robin 轮流
    if(r1!=='openai/gpt-oss-120b:cerebras' || r2!=='openai/gpt-oss-120b:cerebras' || r3!=='openai/gpt-oss-120b:cerebras')
      throw new Error('hf无冷却应恒选cerebras,实际 '+r1+'/'+r2+'/'+r3);
  });
  // 0d. hf 优先级冷却降级:cerebras 冷却中 → groq;再冷却 → cohere;全冷却 → 空串哨兵
  await check('resolveAiModel: hf 冷却自动降级到下一优先级', function(){
    vm.runInContext('aiProvider="hf"; aiApiModel=""; aiApiModels=["openai/gpt-oss-120b:groq","CohereLabs/c4ai-command-a-03-2025:cohere","openai/gpt-oss-120b:cerebras"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
    // cerebras 冷却中 → 应选 groq
    vm.runInContext('_modelCooldowns={"openai/gpt-oss-120b:cerebras": Date.now()+99999};', sandbox);
    const r1 = vm.runInContext('resolveAiModel', sandbox)('hf');
    if(r1!=='openai/gpt-oss-120b:groq') throw new Error('cerebras冷却应降级groq,实际 '+r1);
    // cerebras+groq 都冷却中 → 应选 cohere
    vm.runInContext('_modelCooldowns={"openai/gpt-oss-120b:cerebras": Date.now()+99999,"openai/gpt-oss-120b:groq": Date.now()+99999};', sandbox);
    const r2 = vm.runInContext('resolveAiModel', sandbox)('hf');
    if(r2!=='CohereLabs/c4ai-command-a-03-2025:cohere') throw new Error('cerebras+groq冷却应降级cohere,实际 '+r2);
    // 三家全冷却 → 空串哨兵
    vm.runInContext('_modelCooldowns={"openai/gpt-oss-120b:cerebras": Date.now()+99999,"openai/gpt-oss-120b:groq": Date.now()+99999,"CohereLabs/c4ai-command-a-03-2025:cohere": Date.now()+99999};', sandbox);
    const r3 = vm.runInContext('resolveAiModel', sandbox)('hf');
    if(r3!=='') throw new Error('全冷却应返回空串哨兵,实际 '+JSON.stringify(r3));
  });
  // 1. resolveAiModel: 非 groq 返回 undefined(零变化)
  await check('resolveAiModel: 非groq返回undefined', function(){
    vm.runInContext('aiProvider="claude"; aiApiModel=""; aiApiModels=[];', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('claude');
    if(r!==undefined) throw new Error('应undefined,实际 '+r);
  });
  // 2. resolveAiModel: 手动单选优先(aiApiModel 非空不轮换)
  await check('resolveAiModel: 手动单选优先', function(){
    vm.runInContext('aiProvider="groq"; aiApiModel="llama-3.3-70b-versatile"; aiApiModels=["groq/compound","openai/gpt-oss-120b"];', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='llama-3.3-70b-versatile') throw new Error('应手动单选,实际 '+r);
  });
  // 3. resolveAiModel: 多选轮换顺序 round-robin
  await check('resolveAiModel: 多选轮换顺序', function(){
    vm.runInContext('aiProvider="groq"; aiApiModel=""; aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
    const r1 = vm.runInContext('resolveAiModel', sandbox)('groq');
    const r2 = vm.runInContext('resolveAiModel', sandbox)('groq');
    const r3 = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r1!=='groq/compound' || r2!=='openai/gpt-oss-120b' || r3!=='groq/compound')
      throw new Error('轮换顺序错: '+r1+'/'+r2+'/'+r3);
  });
  // 4. 429 冷却: 命中冷却的模型被跳过
  await check('resolveAiModel: 冷却中的模型跳过', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()+99999999}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='openai/gpt-oss-120b') throw new Error('应跳过冷却中的compound,实际 '+r);
  });
  // 5. 全部冷却 → 返回空串哨兵(调用点短路,不发注定失败的请求)
  await check('resolveAiModel: 全部冷却返回空串哨兵', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()+9999,"openai/gpt-oss-120b": Date.now()+9999}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='') throw new Error('全冷却应返回空串哨兵,实际 '+JSON.stringify(r));
  });
  // 6. 429 解析: 正常格式
  await check('parseGroqRetrySeconds: 15m21s → 921', function(){
    const s = vm.runInContext('parseGroqRetrySeconds', sandbox)('Rate limit reached... Please try again in 15m21.023999999s. Need more tokens?');
    if(s!==921) throw new Error('应921,实际 '+s);
  });
  // 7. 429 解析: 失败默认 60
  await check('parseGroqRetrySeconds: 无时间字段→null(调用方默认60)', function(){
    const s = vm.runInContext('parseGroqRetrySeconds', sandbox)('Rate limit reached for model x');
    if(s!==null) throw new Error('应null,实际 '+s);
  });
  // 8. 冷却到点恢复
  await check('resolveAiModel: 冷却到点恢复', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()-1000}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='groq/compound') throw new Error('冷却已过应恢复,实际 '+r);
  });
  // 9. 429 接线:mock fetch 返回 429 → 冷却写入 → 轮换跳过
  await check('429接线: callAI收到429写冷却,resolveAiModel跳过该模型', async function(){
    // 覆写 fetch:对 /chat/completions 返回 429 + "try again in 2m"
    vm.runInContext('window.__origFetch = window.fetch; window.fetch = function(url, opts){ return Promise.resolve({ ok:false, status:429, text:function(){ return Promise.resolve("Rate limit reached for model x ... Please try again in 2m0.000000s. Need more tokens?"); }, json:function(){ return Promise.resolve({}); } }); };', sandbox);
    try{
      vm.runInContext('aiProvider="groq"; aiApiModel=""; aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
      var r = await vm.runInContext('callAI', sandbox)('groq','gsk_test',{ systemPrompt:'s', userPrompt:'u', model:'groq/compound' });
      if(r.ok) throw new Error('429应返回ok:false');
      // 冷却写入:2m → retryAt ≈ now+120000
      var cd = vm.runInContext('_modelCooldowns', sandbox);
      if(!cd['groq/compound'] || typeof cd['groq/compound']!=='number') throw new Error('应写入冷却,实际 '+JSON.stringify(cd));
      if(Math.abs(cd['groq/compound'] - Date.now() - 120000) > 5000) throw new Error('冷却应≈now+120000,实际差值 '+(cd['groq/compound']-Date.now()));
      // 轮换跳过冷却中的模型
      var m = vm.runInContext('resolveAiModel', sandbox)('groq');
      if(m!=='openai/gpt-oss-120b') throw new Error('应跳过冷却的compound选gpt-oss,实际 '+m);
    }finally{
      vm.runInContext('window.fetch = window.__origFetch;', sandbox);
    }
  });
  // 10. 413 接线:mock fetch 返回 413 → 冷却写入 300s → 轮换跳过(真实bug:413此前不写冷却)
  await check('413接线: callAI收到413写冷却300s,resolveAiModel跳过该模型', async function(){
    vm.runInContext('window.__origFetch2 = window.fetch; window.fetch = function(url, opts){ return Promise.resolve({ ok:false, status:413, text:function(){ return Promise.resolve("Request too large for model `openai/gpt-oss-120b` ... Limit 8000, Requested 9362, please reduce your message size and try again."); }, json:function(){ return Promise.resolve({}); } }); };', sandbox);
    try{
      vm.runInContext('aiProvider="groq"; aiApiModel=""; aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelRotateIdx=0; _modelCooldowns={};', sandbox);
      var r = await vm.runInContext('callAI', sandbox)('groq','gsk_test',{ systemPrompt:'s', userPrompt:'u', model:'openai/gpt-oss-120b' });
      if(r.ok) throw new Error('413应返回ok:false');
      var cd = vm.runInContext('_modelCooldowns', sandbox);
      if(!cd['openai/gpt-oss-120b'] || typeof cd['openai/gpt-oss-120b']!=='number') throw new Error('应写入冷却,实际 '+JSON.stringify(cd));
      if(Math.abs(cd['openai/gpt-oss-120b'] - Date.now() - 300000) > 5000) throw new Error('413冷却应≈now+300000,实际差值 '+(cd['openai/gpt-oss-120b']-Date.now()));
      var m = vm.runInContext('resolveAiModel', sandbox)('groq');
      if(m!=='groq/compound') throw new Error('应跳过413冷却的gpt-oss选compound,实际 '+m);
    }finally{
      vm.runInContext('window.fetch = window.__origFetch2;', sandbox);
    }
  });
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
