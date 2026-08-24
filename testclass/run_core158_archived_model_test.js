/**
 * CORE-158(issue #217):已下架模型不得被反复请求。
 *
 * 用户实测报错:
 *   AI调用失败(provider=tri,model=cerebras:zai-glm-4.7):other - HTTP 404:
 *   {"message":"Model zai-glm-4.7 is archived ...","code":"model_archived"},耗时约2374ms
 *
 * 两个独立成因:
 *   A. hydrate 时只校验"是不是数组",不校验条目是否还在当前池里 —— 用户在模型下架前
 *      勾选的条目被原样恢复、继续参与轮换。
 *   B. 只有 429/413 写 _modelCooldowns,404 完全不记;而 resolveAiModel('tri') 是
 *      **优先级扫描、刻意不轮转**("可用时永远选它"),于是每次决策都重新选中它、
 *      重新吃一个 404。
 */
const assert=require('assert'), vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
let pass=0,fail=0;
const _pending=[];
// 【必须支持异步】callAI 返回 Promise,断言在 .then 里。第一版的 check 是纯同步的,
// 异步断言失败会变成 unhandled rejection 而不是 FAIL —— 那样失败会被算成"没报错",
// 是典型的假绿。这里把返回的 promise 收集起来,最后统一等待并计入结果。
const check=(n,fn)=>{
  let r;
  try{ r=fn(); }
  catch(e){ console.log('  FAIL '+n+' - '+(e&&e.message||e)); fail++; return; }
  if(r && typeof r.then==='function'){
    _pending.push(r.then(()=>{ console.log('  PASS '+n); pass++; })
                   .catch(e=>{ console.log('  FAIL '+n+' - '+(e&&e.message||e)); fail++; }));
  } else { console.log('  PASS '+n); pass++; }
};

// 可控的 sessionStorage + fetch,用来驱动 hydrate 与 404 响应
function load(sessionData, fetchImpl){
  const store=Object.assign({}, sessionData||{});
  const sb={ console:{log(){},warn(){},error(){}}, Math, JSON, Date, Object, Array, String,
    Number, Boolean, RegExp, isNaN, parseInt, parseFloat, Promise, setTimeout, clearTimeout,
    setInterval, clearInterval, AbortController: function(){ this.signal=null; this.abort=function(){}; },
    sessionStorage:{ getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v);},
                     removeItem:k=>{delete store[k];}, key:()=>null, length:0 },
    localStorage:{ getItem:()=>null,setItem(){},removeItem(){},key:()=>null,length:0 },
    document:{ getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[],
      addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}},
      appendChild(){},remove(){},setAttribute(){}}), body:{appendChild(){}} },
    navigator:{userAgent:'node'}, location:{search:'',href:'http://localhost'},
    fetch: fetchImpl || (()=>Promise.reject(new Error('no fetch'))) };
  sb.window=sb; sb.globalThis=sb; sb._store=store;
  const ctx=vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'ai-bot.js'),'utf8'), ctx, {filename:'ai-bot.js'});
  return ctx;
}
// sessionStorage 的键名。**硬编码 + 一条防漂移断言**:动态从源码正则提取过一版,
// 结果提错了键(拿到 sgsAiKey 当成 sgsAiModels),导致三条断言在错误的键上跑、看着像
// 实现有问题。键名是稳定的字面量,直接写死更不容易出错;下面这条断言保证它们改名时
// 本测试会立刻失败,而不是静默跑在错键上。
const K = { key:'sgsAiKey', prov:'sgsAiProvider', model:'sgsAiModel', models:'sgsAiModels' };
(function assertKeyNames(){
  const src=fs.readFileSync(path.join(ROOT,'ai-bot.js'),'utf8');
  const want=[['AI_KEY_STORAGE_KEY',K.key],['AI_PROVIDER_STORAGE_KEY',K.prov],
              ['AI_MODEL_STORAGE_KEY',K.model],['AI_MODELS_STORAGE_KEY',K.models]];
  want.forEach(function(w){
    if(src.indexOf("const "+w[0]+" = '"+w[1]+"'") < 0)
      throw new Error('storage key 名已变更,请同步本测试: '+w[0]+' 应为 '+w[1]);
  });
})();

console.log('== CORE-158: 已下架模型不得被反复请求 ==\n');

// ---------- 成因 A ----------
check('hydrate:历史选择里的已下架模型被剔除,有效条目保留',()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'a/b/c',
    [K.models]:JSON.stringify(['cerebras:zai-glm-4.7','cerebras:gpt-oss-120b','groq:groq/compound']) });
  const models=vm.runInContext('aiApiModels',ctx);
  assert.ok(!models.includes('cerebras:zai-glm-4.7'), '已下架模型应被剔除,实际 '+JSON.stringify(models));
  assert.ok(models.includes('cerebras:gpt-oss-120b') && models.includes('groq:groq/compound'),
    '有效条目必须保留(不能因为有一个失效就整体丢弃),实际 '+JSON.stringify(models));
});

check('hydrate:全部失效时回落到默认池,而不是留一个空池',()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'a/b/c',
    [K.models]:JSON.stringify(['cerebras:zai-glm-4.7','cerebras:some-other-dead-model']) });
  const models=vm.runInContext('aiApiModels',ctx);
  const def=vm.runInContext('DEFAULT_TRI_MODELS',ctx);
  assert.deepStrictEqual(models, def, '交集为空应回落默认池,实际 '+JSON.stringify(models));
});

check('hydrate:全部有效时一个都不动(零回归)',()=>{
  const keep=['cerebras:gpt-oss-120b','groq:groq/compound'];
  const ctx=load({ [K.prov]:'tri', [K.key]:'a/b/c', [K.models]:JSON.stringify(keep) });
  assert.deepStrictEqual(vm.runInContext('aiApiModels',ctx), keep);
});

check('hydrate:未配置过多选时仍走默认填充(既有行为不变)',()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'a/b/c' });
  assert.deepStrictEqual(vm.runInContext('aiApiModels',ctx), vm.runInContext('DEFAULT_TRI_MODELS',ctx));
});

// ---------- 成因 B ----------
function archived404(){
  return ()=>Promise.resolve({ ok:false, status:404,
    text:()=>Promise.resolve('{"message":"Model zai-glm-4.7 is archived and unavailable for the organization.","type":"model_archived_error","code":"model_archived"}'),
    json:()=>Promise.resolve({}) });
}
check('404 model_archived → 写入冷却,且用带 provider 前缀的完整 id 作 key',async()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'ka/kb/kc' }, archived404());
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7','cerebras:gpt-oss-120b'];",ctx);
  const p=vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx);
  return p.then(()=>{
    const cd=vm.runInContext('_modelCooldowns',ctx);
    // 【这是 issue 里点名的坑】tri 分发后 opts.model 变成去前缀的 'zai-glm-4.7',
    // 若用它当 key,resolveAiModel('tri') 匹配的是带前缀的条目 → 冷却写了等于没写。
    assert.ok(cd['cerebras:zai-glm-4.7']>Date.now(),
      '冷却 key 必须是带前缀的完整 id,实际 keys='+JSON.stringify(Object.keys(cd)));
    assert.ok(!('zai-glm-4.7' in cd), '不应写成去前缀的 key(那样轮换匹配不上)');
  });
});

check('冷却后 resolveAiModel 不再选中它,自动降级到同 provider 的下一个',async()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'ka/kb/kc' }, archived404());
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7','cerebras:gpt-oss-120b'];",ctx);
  const before=vm.runInContext("resolveAiModel('tri')",ctx);
  assert.strictEqual(before,'cerebras:zai-glm-4.7','前置:优先级扫描本应先选它');
  return vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx).then(()=>{
    const after=vm.runInContext("resolveAiModel('tri')",ctx);
    assert.strictEqual(after,'cerebras:gpt-oss-120b',
      '404 后应跳到下一个可用模型,实际 '+after);
  });
});

check('已下架模型同时从轮换池移除并落盘(防下次会话再踩)',async()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'ka/kb/kc' }, archived404());
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7','cerebras:gpt-oss-120b'];",ctx);
  return vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx).then(()=>{
    assert.ok(!vm.runInContext('aiApiModels',ctx).includes('cerebras:zai-glm-4.7'),'应从内存池移除');
    const saved=JSON.parse(vm.runInContext('_store',ctx)[K.models]||'[]');
    assert.ok(!saved.includes('cerebras:zai-glm-4.7'),'应已落盘,实际 '+JSON.stringify(saved));
  });
});

check('错误分类为 model_unavailable(不再混进笼统的 other)',async()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'ka/kb/kc' }, archived404());
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7'];",ctx);
  return vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx).then(r=>{
    assert.strictEqual(r.reason,'model_unavailable','实际 '+r.reason);
    assert.ok(/404/.test(r.detail||''),'detail 应保留原始响应');
  });
});

check('普通 404(非 archived)不写冷却(不误伤其它 404)',async()=>{
  const ctx=load({ [K.prov]:'tri', [K.key]:'ka/kb/kc' },
    ()=>Promise.resolve({ ok:false, status:404,
      text:()=>Promise.resolve('{"message":"Not Found"}'), json:()=>Promise.resolve({}) }));
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7'];",ctx);
  return vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx).then(r=>{
    assert.strictEqual(Object.keys(vm.runInContext('_modelCooldowns',ctx)).length,0,'普通404不该冷却');
    assert.strictEqual(r.reason,'other','普通404仍归 other');
  });
});

check('429 的既有冷却行为逐字不变(零回归)',async()=>{
  const ctx=load({ [K.prov]:'cerebras', [K.key]:'k' },
    ()=>Promise.resolve({ ok:false, status:429,
      text:()=>Promise.resolve('try again in 1m30s'), json:()=>Promise.resolve({}) }));
  vm.runInContext("aiApiModels=['gpt-oss-120b','gemma-4-31b'];",ctx);
  return vm.runInContext("callAI('cerebras','k',{systemPrompt:'s',userPrompt:'u',model:'gpt-oss-120b'})",ctx).then(r=>{
    const cd=vm.runInContext('_modelCooldowns',ctx);
    const left=(cd['gpt-oss-120b']-Date.now())/1000;
    assert.ok(left>80 && left<100, '429 应按 retry_after≈90s 冷却,实际 '+Math.round(left)+'s');
    assert.strictEqual(r.reason,'other','429 仍归 other(未被本次改动波及)');
    assert.ok(vm.runInContext('aiApiModels',ctx).includes('gpt-oss-120b'),'429 不该把模型移出池(只是临时限流)');
  });
});

// ---------- 破坏性验证 ----------
check('破坏性验证:移除 404 冷却分支后,该模型确实会被反复选中',async()=>{
  const src=fs.readFileSync(path.join(ROOT,'ai-bot.js'),'utf8');
  const broken=src.replace('|| archived)){',')){');
  assert.notStrictEqual(broken,src,'替换未命中');
  const store={ [K.prov]:'tri', [K.key]:'ka/kb/kc' };
  const sb={ console:{log(){},warn(){},error(){}}, Math,JSON,Date,Object,Array,String,Number,
    Boolean,RegExp,isNaN,parseInt,parseFloat,Promise,setTimeout,clearTimeout,setInterval,clearInterval,
    AbortController:function(){this.signal=null;this.abort=function(){};},
    sessionStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},
      removeItem:k=>{delete store[k];},key:()=>null,length:0},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){},key:()=>null,length:0},
    document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},
      createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}},appendChild(){},remove(){},setAttribute(){}}),
      body:{appendChild(){}}},
    navigator:{userAgent:'node'}, location:{search:'',href:''}, fetch: archived404() };
  sb.window=sb; sb.globalThis=sb;
  const ctx2=vm.createContext(sb);
  vm.runInContext(broken, ctx2, {filename:'ai-bot-broken.js'});
  vm.runInContext("aiApiModels=['cerebras:zai-glm-4.7','cerebras:gpt-oss-120b'];",ctx2);
  return vm.runInContext("callAI('tri','ka/kb/kc',{systemPrompt:'s',userPrompt:'u',model:'cerebras:zai-glm-4.7'})",ctx2).then(()=>{
    assert.strictEqual(vm.runInContext("resolveAiModel('tri')",ctx2),'cerebras:zai-glm-4.7',
      '移除冷却分支后应仍选中已下架模型——说明断言确实能变红');
  });
});

(async()=>{
  await Promise.all(_pending);
  console.log('\n结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail?1:0);
})();
