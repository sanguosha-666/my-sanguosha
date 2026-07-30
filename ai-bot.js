// ai-bot.js — AI机器人接入,第一阶段:适配层 + 密钥输入UI。
//
// 【范围声明,务必遵守】本文件本身、以及本次改动对 render-controls.js 的追加,
// 完全不接入任何游戏逻辑——callAI/PROVIDER_ADAPTERS 目前没有任何调用方连到
// botPlay/botBestTarget/runBotDecision/scheduleBotTurn 等既有机器人调度代码,
// 那批文件(bot.js)在本次改动中一行未动。这里只是把"密钥怎么存、怎么识别提供商、
// 怎么发起一次AI调用"这三件事先做成独立、可单测的模块,接入机器人决策是后续阶段
// 的范围。
//
// 【确认方案:Claude直连 + OpenRouter覆盖其它模型,不加后端】
// Claude(api.anthropic.com)官方支持浏览器直连(anthropic-dangerous-direct-browser-
// access 请求头,是 Anthropic 自己文档化的"自带密钥的客户端应用"场景);OpenAI 的
// api.openai.com 不支持浏览器直连 CORS,要接 GPT 必须经服务器代理——这个项目是纯静态
// 多文件、无构建流程、无后端(见 CLAUDE.md),不引入服务器。所以"GPT/其它模型"这个槽位
// 统一走 OpenRouter(和 OpenAI 的 Chat Completions 格式兼容、且支持浏览器直连
// CORS)中转,不是直接调用 OpenAI 官方接口——UI 上必须如实标注"OpenRouter(GPT/多模型)"
// 而不是让用户误以为在直接用自己的 OpenAI 密钥。持有 OpenAI 密钥的用户需要另外去
// OpenRouter 申请一把密钥,这是这个方案已知、已确认接受的代价。
//
// 【密钥安全设计,务必遵守】密钥只存在 sessionStorage(本标签页内存级持久化,刷新/
// 关闭标签页即清空)+ 本文件的模块级变量里,绝不写入 g/Firebase 共享状态、绝不用
// localStorage(那会跨标签页/跨刷新持久化,超出"这一局"的生命周期)、绝不出现在
// 任何会被其他玩家读到的地方(座位卡、日志、pending 等)。持有密钥的只有触发
// addBot() 的那个人(mySeat===0,和现有"添加机器人"按钮同一个身份边界,
// room-lifecycle.js 的 addBot()/removeBot() 服务端本来就要求 mySeat===0),
// 费用由这把密钥的账户承担,UI 上必须给出明确提示。

// ---------- sessionStorage 持久化 ----------
const AI_KEY_STORAGE_KEY = 'sgsAiKey';
const AI_PROVIDER_STORAGE_KEY = 'sgsAiProvider';

// 模块级变量,和 game.js 顶部 myClientId 同一处理方式:加载时尝试从 sessionStorage
// 恢复一次(应对"同一标签页内因为JS错误等原因整页刷新"这类场景——标签页本身没关闭,
// sessionStorage 依然在),之后由输入面板的事件处理器持续保持同步、并写回 storage。
let aiApiKey = '';
let aiProvider = null; // 'claude' | 'openrouter' | null(尚未识别/尚未选择)

(function hydrateAiKeyFromSession(){
  try{
    aiApiKey = sessionStorage.getItem(AI_KEY_STORAGE_KEY) || '';
    aiProvider = sessionStorage.getItem(AI_PROVIDER_STORAGE_KEY) || null;
  }catch(e){
    // 隐私模式等场景下 sessionStorage 可能整体不可用——静默回退到空值,不影响
    // 本次会话内内存里正常使用,只是刷新后无法恢复。
    aiApiKey = ''; aiProvider = null;
  }
})();

function persistAiKeyToSession(){
  try{
    if(aiApiKey) sessionStorage.setItem(AI_KEY_STORAGE_KEY, aiApiKey);
    else sessionStorage.removeItem(AI_KEY_STORAGE_KEY);
    if(aiProvider) sessionStorage.setItem(AI_PROVIDER_STORAGE_KEY, aiProvider);
    else sessionStorage.removeItem(AI_PROVIDER_STORAGE_KEY);
  }catch(e){ /* 同上,静默忽略 */ }
}

// ---------- 密钥格式识别(纯函数) ----------
// Claude 密钥固定 sk-ant- 前缀(Anthropic 官方格式);OpenRouter 密钥固定 sk-or- 前缀。
// 两者都识别不出时返回 null,由 UI 侧退化成手动选择下拉框。
function detectAiProvider(key){
  const k = (key||'').trim();
  if(!k) return null;
  if(/^sk-ant-/.test(k)) return 'claude';
  if(/^sk-or-/.test(k)) return 'openrouter';
  return null;
}

// ---------- Provider 适配层 ----------
// 每个 adapter 只负责两件事:①按自己的协议格式构造请求(url/headers/body,纯函数,
// 不发起网络请求)②从响应 JSON 里把纯文本抠出来。网络请求本身、超时、错误归类统一
// 收在下面的 callAI() 里,不在每个 adapter 里重复实现——以后新增 provider 只需要在
// 这里加一项,不需要碰 callAI。
const PROVIDER_ADAPTERS = {
  claude: {
    label: 'Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildRequest(apiKey, opts){
      const body = {
        model: opts.model || 'claude-haiku-4-5-20251001',
        max_tokens: opts.maxTokens || 512,
        messages: [{ role:'user', content: opts.userPrompt }],
      };
      if(opts.systemPrompt) body.system = opts.systemPrompt;
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // 【必需】没有这个头,api.anthropic.com 会直接拒绝浏览器发起的跨域请求——
          // 这是 Anthropic 自己文档化的、专门为"用户自带密钥的客户端应用"场景开的口子。
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      };
    },
    parseResponse(json){
      const block = json && Array.isArray(json.content) && json.content[0];
      if(!block || typeof block.text !== 'string') throw new Error('未识别的 Claude 响应结构');
      return block.text;
    },
  },
  openrouter: {
    label: 'OpenRouter(GPT/多模型)',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    buildRequest(apiKey, opts){
      const messages = [];
      if(opts.systemPrompt) messages.push({ role:'system', content: opts.systemPrompt });
      messages.push({ role:'user', content: opts.userPrompt });
      return {
        url: this.endpoint,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer '+apiKey,
        },
        body: JSON.stringify({
          model: opts.model || 'openai/gpt-4o-mini',
          max_tokens: opts.maxTokens || 512,
          messages,
        }),
      };
    },
    parseResponse(json){
      const msg = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
      if(!msg || typeof msg.content !== 'string') throw new Error('未识别的 OpenRouter 响应结构');
      return msg.content;
    },
  },
};

// ---------- 统一网络层 ----------
// callAI(provider, apiKey, {systemPrompt, userPrompt, maxTokens, model}) ->
//   Promise<{ok:true, text} | {ok:false, reason:'network'|'auth'|'timeout'|'parse'|'other', detail}>
// fetch/超时竞速/错误归类只在这一处实现,adapter 本身完全不碰网络。
const AI_CALL_TIMEOUT_MS = 15000;

function callAI(provider, apiKey, opts){
  const adapter = PROVIDER_ADAPTERS[provider];
  if(!adapter){
    return Promise.resolve({ ok:false, reason:'other', detail:'未知的AI提供商: '+provider });
  }
  let req;
  try{
    req = adapter.buildRequest(apiKey, opts||{});
  }catch(e){
    return Promise.resolve({ ok:false, reason:'other', detail:'构造请求失败: '+e.message });
  }
  const hasAbort = typeof AbortController !== 'undefined';
  const controller = hasAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(()=>controller.abort(), AI_CALL_TIMEOUT_MS) : null;
  return fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal: controller ? controller.signal : undefined,
  }).then(res=>{
    if(timeoutId) clearTimeout(timeoutId);
    if(res.status===401 || res.status===403){
      return res.text().then(t=>({ ok:false, reason:'auth', detail:'密钥无效或无权限('+res.status+'): '+t.slice(0,200) }));
    }
    if(!res.ok){
      return res.text().then(t=>({ ok:false, reason:'other', detail:'HTTP '+res.status+': '+t.slice(0,200) }));
    }
    return res.json().then(json=>{
      try{
        const text = adapter.parseResponse(json);
        return { ok:true, text };
      }catch(e){
        return { ok:false, reason:'parse', detail:'响应解析失败: '+e.message };
      }
    }, e=>({ ok:false, reason:'parse', detail:'响应不是合法JSON: '+e.message }));
  }, e=>{
    if(timeoutId) clearTimeout(timeoutId);
    if(e && e.name==='AbortError'){
      return { ok:false, reason:'timeout', detail:'请求超时(超过 '+(AI_CALL_TIMEOUT_MS/1000)+' 秒)' };
    }
    return { ok:false, reason:'network', detail:'网络请求失败: '+(e && e.message || String(e)) };
  });
}

// ---------- 大厅密钥输入面板 UI ----------
// 由 render-controls.js 在 renderControls() 的大厅阶段(!g.started)、mySeat===0
// 分支里调用——和现有"添加机器人"按钮同一个身份边界、同一次渲染。
//
// 【为什么面板自身的输入/识别交互不走 render(g) 整体重绘】renderControls 每次调用
// 都会先 c.innerHTML='' 整体清空再重建(见文件头部 render-controls.js 的既有实现)。
// 如果密钥输入框的 input 事件处理器自己也去调 render(g),等于每敲一个字符就整体
// 销毁重建一次 #controls,新生成的 input 节点不会继承旧节点的焦点——用户连续输入
// 会在敲下第一个字符后立即失焦,必须每敲一下重新点回输入框,这在密码类输入框上是
// 破坏性的。所以这个面板内部的状态更新(重新识别提供商、显示/隐藏手动选择下拉框)
// 全部走面板自己内部的局部 DOM 操作,不触发全局 render——只有"另一名玩家加入房间"
// 这类外部事件触发的 render(g) 才会重建这个面板,那时候由 input.value=aiApiKey
// 从模块级变量里正确恢复已输入的内容(这正是 blur+input 双重保存的意义:保证即使
// 面板被外部重渲染打断,恢复出来的值也是最新的,不会丢字)。
function renderAiKeyPanel(container){
  const wrap = document.createElement('div');
  wrap.id = 'aiKeyPanel';
  wrap.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--line);';

  const label = document.createElement('label');
  label.textContent = 'AI 机器人密钥(可选)';
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.id = 'aiKeyInput';
  input.placeholder = '粘贴 Claude 或 OpenRouter 密钥,留空则机器人使用本地规则';
  input.autocomplete = 'off';
  input.value = aiApiKey;
  wrap.appendChild(input);

  const statusLine = document.createElement('div');
  statusLine.id = 'aiProviderStatus';
  statusLine.style.cssText = 'margin-top:6px;font-size:12px;color:var(--paper-dim);';
  wrap.appendChild(statusLine);

  const warn = document.createElement('div');
  warn.style.cssText = 'margin-top:6px;font-size:12px;color:var(--paper-dim);';
  warn.textContent = '填入密钥后,本局全部AI机器人的调用费用由这把密钥的账户承担;'
    +'密钥仅保存在本标签页内存中,刷新或关闭页面即清空,不会写入房间数据、不会被其他玩家看到。';
  wrap.appendChild(warn);

  function updateStatusLine(){
    statusLine.innerHTML = '';
    if(!aiApiKey){
      statusLine.textContent = '未填写密钥,机器人将使用本地规则(不产生任何费用)。';
      return;
    }
    const detected = detectAiProvider(aiApiKey);
    if(detected){
      aiProvider = detected;
      statusLine.appendChild(document.createTextNode('已识别为 '+PROVIDER_ADAPTERS[detected].label));
    } else {
      statusLine.appendChild(document.createTextNode('未能自动识别密钥格式,请手动选择提供商:'));
      const sel = document.createElement('select');
      sel.id = 'aiProviderSelect';
      sel.style.cssText = 'margin-left:8px;';
      const optNone = document.createElement('option');
      optNone.value = ''; optNone.textContent = '请选择…';
      sel.appendChild(optNone);
      Object.keys(PROVIDER_ADAPTERS).forEach(key=>{
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = PROVIDER_ADAPTERS[key].label;
        if(aiProvider===key) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = ()=>{
        aiProvider = sel.value || null;
        persistAiKeyToSession();
      };
      statusLine.appendChild(sel);
    }
  }

  function commitKey(){
    aiApiKey = input.value;
    persistAiKeyToSession();
    updateStatusLine();
  }
  // 【blur+input 双重保存兜底】用 input 事件(不是字面的 keydown)——keydown 在字符
  // 真正插入输入框之前就先触发,这一刻读 input.value 会读到"慢一拍"的旧值,粘贴/
  // 输入法候选字这类场景也未必逐字触发 keydown;input 事件在值真正变化后才触发,
  // 覆盖打字、粘贴、自动填充等全部输入方式,是这个"每次改动都立即保存"需求在技术上
  // 更准确的实现,行为效果和"keydown 就保存"完全一致,只是换了正确的事件名。blur
  // 是第二层兜底,和 input 是同一份保存逻辑,重复调用无副作用。
  input.addEventListener('input', commitKey);
  input.addEventListener('blur', commitKey);

  updateStatusLine();
  container.appendChild(wrap);
}
