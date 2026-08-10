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
const sandbox = vm.createContext(context);
const files = ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','bot-ai-bus.js','bot.js','ai-bot.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  // 0. 默认勾选列表(用户确认的4模型)
  await check('默认勾选: groq 4模型', function(){
    const d = vm.runInContext('DEFAULT_GROQ_MODELS', sandbox);
    if(!d || d.length!==4) throw new Error('应4个,实际 '+(d&&d.length));
    ['groq/compound','llama-3.3-70b-versatile','openai/gpt-oss-120b','qwen/qwen3.6-27b'].forEach(function(m){
      if(d.indexOf(m)<0) throw new Error('缺 '+m);
    });
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
  // 5. 全部冷却 → 返回第一个(注定429走本地兜底)
  await check('resolveAiModel: 全部冷却返回第一个', function(){
    vm.runInContext('aiApiModels=["groq/compound","openai/gpt-oss-120b"]; _modelCooldowns={"groq/compound": Date.now()+9999,"openai/gpt-oss-120b": Date.now()+9999}; _modelRotateIdx=0;', sandbox);
    const r = vm.runInContext('resolveAiModel', sandbox)('groq');
    if(r!=='groq/compound') throw new Error('全冷却应返回第一个,实际 '+r);
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
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
