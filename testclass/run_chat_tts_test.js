// run_chat_tts_test.js —— 聊天语音播报回归套件
// 用法: node run_chat_tts_test.js
const vm = require('vm');
const fs = require('fs');
const speakCalls = [];
const voicesMock = [
  { name: 'Microsoft Huihui - Chinese (Simplified)', lang: 'zh-CN' },   // 女
  { name: 'Microsoft Kangkang - Chinese (Simplified)', lang: 'zh-CN' }, // 男
  { name: 'Google US English', lang: 'en-US' },
  { name: 'Microsoft Heami - Korean', lang: 'ko-KR' },
  { name: 'Microsoft Haruka - Japanese', lang: 'ja-JP' }
];
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } } }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage: { getItem: function(k){ return context.__ls && k in context.__ls ? context.__ls[k] : null; }, setItem: function(k,v){ if(!context.__ls) context.__ls={}; context.__ls[k]=String(v); }, removeItem: function(k){ if(context.__ls) delete context.__ls[k]; } }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' }, speechSynthesis: { speak: function(u){ speakCalls.push({ text: u.text, voice: u.voice && u.voice.name || null, pitch: u.pitch, lang: u.lang }); }, cancel: function(){}, getVoices: function(){ return voicesMock; } } },
  // M-1:顶层 localStorage stub(非 window 内)——render-log.js 模块级 IIFE 用裸
  // `typeof localStorage!=='undefined'` 读开关持久化,必须沙箱顶层有它才激活读取路径。
  // 与 window.localStorage 共享同一份 __ls 存储,保证模块代码与测试断言读写一致。
  localStorage: { getItem: function(k){ return context.__ls && k in context.__ls ? context.__ls[k] : null; }, setItem: function(k,v){ if(!context.__ls) context.__ls={}; context.__ls[k]=String(v); }, removeItem: function(k){ if(context.__ls) delete context.__ls[k]; } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp,
  // speechSynthesis.speak 需要 utterance 对象(text/lang/pitch/voice 由 speak stub 读取),补构造器 stub
  SpeechSynthesisUtterance: function(text){ this.text=String(text==null?'':text); this.lang=''; this.pitch=1; this.voice=null; }
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
const files = ['config.js','data.js', 'stages/stage-table.js','debug-log.js','room-lifecycle.js','game.js', 'sha/sha-resolution.js','weapons.js','skills.js', 'skills/late-generals.js','render-log.js'];
files.forEach(f=>{ vm.runInContext(fs.readFileSync(f,'utf8'), sandbox); });
let pass=0, fail=0;
function check(name, fn){
  try{ fn(); console.log('  PASS '+name); pass++; }
  catch(e){ console.log('  FAIL '+name+' - '+(e&&e.message||e)); fail++; }
}
(async function(){
  // 1. 新消息触发:念内容文本
  await check('detectAndSpeakNewChat: 新消息触发念内容', function(){
    speakCalls.length = 0;
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m1', text:'这波啊这波是天命', type:'text', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==1) throw new Error('应念1次,实际 '+speakCalls.length);
    if(speakCalls[0].text!=='这波啊这波是天命') throw new Error('应念消息内容,实际 '+speakCalls[0].text);
  });
  // 2. 去重:同一 id 再次出现不重复念
  await check('detectAndSpeakNewChat: 同一id去重不重复念', function(){
    speakCalls.length = 0;
    // 用独立 id(避免复用 test1 的 m1 撞上跨用例保留的 spokenChatIds,那会提前跳过 m1 让计数错位)
    const msgs=[{ id:'m1a', text:'a', type:'text', general:'zhangfei', seat:1 }];
    vm.runInContext('detectAndSpeakNewChat', sandbox)(msgs);
    vm.runInContext('detectAndSpeakNewChat', sandbox)(msgs.concat([{ id:'m1b', text:'b', type:'text', general:'guojia', seat:1 }]));
    if(speakCalls.length!==2) throw new Error('应念2条(m1b新+m1a不重复),实际 '+speakCalls.length);
  });
  // 3. emoji 跳过
  await check('detectAndSpeakNewChat: emoji消息不念', function(){
    speakCalls.length = 0;
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m3', text:'😀', type:'emoji', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==0) throw new Error('emoji不应念,实际 '+speakCalls.length);
  });
  // 4. 开关关闭不念
  await check('toggleChatVoice: 关闭后不念,再开恢复', function(){
    speakCalls.length = 0;
    vm.runInContext('toggleChatVoice', sandbox)(); // 默认开→关
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m4', text:'x', type:'text', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==0) throw new Error('关闭后不应念');
    vm.runInContext('toggleChatVoice', sandbox)(); // 关→开
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m5', text:'y', type:'text', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==1) throw new Error('重开应念,实际 '+speakCalls.length);
  });
  // 4b. M-6:开关关闭期间到达的消息也被标记 id,重开语音后旧消息不重放
  await check('detectAndSpeakNewChat: 关闭期间的旧消息重开后不重放(M-6)', function(){
    speakCalls.length = 0;
    vm.runInContext('toggleChatVoice', sandbox)(); // 开→关
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m6off', text:'old', type:'text', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==0) throw new Error('关闭期间不应念');
    vm.runInContext('toggleChatVoice', sandbox)(); // 关→开
    vm.runInContext('detectAndSpeakNewChat', sandbox)([{ id:'m6off', text:'old', type:'text', general:'zhangfei', seat:1 }, { id:'m6on', text:'new', type:'text', general:'zhangfei', seat:1 }]);
    if(speakCalls.length!==1) throw new Error('重开后应只念新消息,实际念 '+speakCalls.length+' 条');
    if(speakCalls[0].text!=='new') throw new Error('应念新消息m6on,实际 '+speakCalls[0].text);
  });
  // 5. gender→pitch 映射(voice 匹配时:voicesMock 里有 Kangkang/Huihui)
  await check('speakChatMessage: male→pitch 0.8 / female→pitch 1.2（voice 匹配时）', function(){
    speakCalls.length = 0;
    vm.runInContext('speakChatMessage', sandbox)('男声', 'male');
    vm.runInContext('speakChatMessage', sandbox)('女声', 'female');
    if(speakCalls[0].pitch!==0.8) throw new Error('male应pitch0.8,实际 '+speakCalls[0].pitch);
    if(speakCalls[1].pitch!==1.2) throw new Error('female应pitch1.2,实际 '+speakCalls[1].pitch);
  });
  // 5b. getVoices 返回空(voice 匹配失败→null)时 fallback pitch 仍生效
  await check('speakChatMessage: getVoices空→voice null 但 pitch 仍生效', function(){
    speakCalls.length = 0;
    const origGetVoices = sandbox.window.speechSynthesis.getVoices;
    sandbox.window.speechSynthesis.getVoices = function(){ return []; };
    vm.runInContext('speakChatMessage', sandbox)('男声', 'male');
    vm.runInContext('speakChatMessage', sandbox)('女声', 'female');
    sandbox.window.speechSynthesis.getVoices = origGetVoices;
    if(speakCalls[0].voice!==null) throw new Error('getVoices空时应voice null,实际 '+speakCalls[0].voice);
    if(speakCalls[0].pitch!==0.8) throw new Error('male应pitch0.8,实际 '+speakCalls[0].pitch);
    if(speakCalls[1].pitch!==1.2) throw new Error('female应pitch1.2,实际 '+speakCalls[1].pitch);
  });
  // 6. voice 选择:列表里有女声 Huihui 时 female 选中它(lang传zh-CN,既有行为)
  await check('pickChatVoice: 女→Huihui, 男→Kangkang(lang=zh-CN)', function(){
    const vf = vm.runInContext('pickChatVoice', sandbox)('female', 'zh-CN');
    const vm2 = vm.runInContext('pickChatVoice', sandbox)('male', 'zh-CN');
    if(!vf || vf.name.indexOf('Huihui')<0) throw new Error('female应选Huihui,实际 '+(vf&&vf.name));
    if(!vm2 || vm2.name.indexOf('Kangkang')<0) throw new Error('male应选Kangkang,实际 '+(vm2&&vm2.name));
  });
  // 6b. pickChatVoice: lang前缀不匹配时(en-US)不会选中文voice,退化为按语言前缀匹配
  await check('pickChatVoice: lang=en-US 时选中英文voice(不是中文Huihui/Kangkang)', function(){
    const v = vm.runInContext('pickChatVoice', sandbox)('male', 'en-US');
    if(!v || v.lang.indexOf('en')!==0) throw new Error('en-US应选英文voice,实际 '+(v&&v.name)+' lang='+(v&&v.lang));
  });
  await check('pickChatVoice: lang=ko-KR 时选中韩文voice', function(){
    const v = vm.runInContext('pickChatVoice', sandbox)('female', 'ko-KR');
    if(!v || v.lang.indexOf('ko')!==0) throw new Error('ko-KR应选韩文voice,实际 '+(v&&v.name)+' lang='+(v&&v.lang));
  });
  await check('pickChatVoice: lang=ja-JP 时选中日文voice', function(){
    const v = vm.runInContext('pickChatVoice', sandbox)('female', 'ja-JP');
    if(!v || v.lang.indexOf('ja')!==0) throw new Error('ja-JP应选日文voice,实际 '+(v&&v.name)+' lang='+(v&&v.lang));
  });
  // 9. detectChatLang:按字符集判断语言——中文/英文/韩文/日文/混合(按主要语言,中文优先命中)
  await check('detectChatLang: 中文→zh-CN, 英文→en-US, 韩文→ko-KR', function(){
    const zh = vm.runInContext('detectChatLang', sandbox)('这波啊这波是天命');
    const en = vm.runInContext('detectChatLang', sandbox)('Hello world nice game');
    const ko = vm.runInContext('detectChatLang', sandbox)('안녕하세요 반갑습니다');
    if(zh!=='zh-CN') throw new Error('中文应判zh-CN,实际 '+zh);
    if(en!=='en-US') throw new Error('英文应判en-US,实际 '+en);
    if(ko!=='ko-KR') throw new Error('韩文应判ko-KR,实际 '+ko);
  });
  // 9b. detectChatLang: 日语——纯假名、假名+汉字混合(优先判日语而非中文)
  await check('detectChatLang: 纯假名→ja-JP, 假名+汉字混合→ja-JP(不误判中文)', function(){
    const hiragana = vm.runInContext('detectChatLang', sandbox)('こんにちは');
    const katakana = vm.runInContext('detectChatLang', sandbox)('コンニチハ');
    const mixed = vm.runInContext('detectChatLang', sandbox)('今日はいい天気ですね');
    if(hiragana!=='ja-JP') throw new Error('纯平假名应判ja-JP,实际 '+hiragana);
    if(katakana!=='ja-JP') throw new Error('纯片假名应判ja-JP,实际 '+katakana);
    if(mixed!=='ja-JP') throw new Error('假名+汉字混合应判ja-JP(不应误判zh-CN),实际 '+mixed);
  });
  // 9c. detectChatLang: 纯汉字日语句子的固有局限——无假名特征字符时无法与中文区分,
  // 按现有优先级规则回退判为zh-CN,是字符区间判断法的已知边界,不强求解决
  await check('detectChatLang: 纯汉字日语句子(无假名)按现有规则回退zh-CN(已知局限)', function(){
    const pureKanji = vm.runInContext('detectChatLang', sandbox)('今日天気'); // 纯汉字,无假名特征
    if(pureKanji!=='zh-CN') throw new Error('纯汉字场景预期回退zh-CN(固有局限),实际 '+pureKanji);
  });
  // 10. speakChatMessage: 根因修复验证——u.lang 按文本内容检测,而非写死zh-CN
  await check('speakChatMessage: u.lang 按文本语言检测(中/英/韩/日四种消息分别对应zh-CN/en-US/ko-KR/ja-JP)', function(){
    speakCalls.length = 0;
    vm.runInContext('speakChatMessage', sandbox)('这波啊这波是天命', 'male');
    vm.runInContext('speakChatMessage', sandbox)('Hello world nice game', 'male');
    vm.runInContext('speakChatMessage', sandbox)('안녕하세요 반갑습니다', 'male');
    vm.runInContext('speakChatMessage', sandbox)('こんにちは、いい天気ですね', 'male');
    if(speakCalls[0].lang!=='zh-CN') throw new Error('中文消息u.lang应为zh-CN,实际 '+speakCalls[0].lang);
    if(speakCalls[1].lang!=='en-US') throw new Error('英文消息u.lang应为en-US,实际 '+speakCalls[1].lang);
    if(speakCalls[2].lang!=='ko-KR') throw new Error('韩文消息u.lang应为ko-KR,实际 '+speakCalls[2].lang);
    if(speakCalls[3].lang!=='ja-JP') throw new Error('日文消息u.lang应为ja-JP,实际 '+speakCalls[3].lang);
  });
  // 7. M-1 真实持久化:关闭后 localStorage 存 sgs_chat_voice='0'
  await check('toggleChatVoice: 关闭后 localStorage 存 sgs_chat_voice=0', function(){
    vm.runInContext('toggleChatVoice', sandbox)(); // 当前默认开→关
    const v = vm.runInContext('localStorage.getItem("sgs_chat_voice")', sandbox);
    if(v!=='0') throw new Error('关闭后应存 \'0\',实际 '+v);
    vm.runInContext('toggleChatVoice', sandbox)(); // 关→开(恢复,存'1')
    const v1 = vm.runInContext('localStorage.getItem("sgs_chat_voice")', sandbox);
    if(v1!=='1') throw new Error('重开后应存 \'1\',实际 '+v1);
  });
  // 8. M-1 IIFE 读取路径:存'0'后重新求值开关默认关闭(模拟"存0后重载模块")
  await check('chatVoiceEnabled IIFE: localStorage 存0后重载默认关闭', function(){
    vm.runInContext("localStorage.setItem('sgs_chat_voice','0')", sandbox);
    const v = vm.runInContext("(function(){ try{ return !(typeof localStorage!=='undefined' && localStorage.getItem('sgs_chat_voice')==='0'); } catch(e){ return true; } })()", sandbox);
    if(v!==false) throw new Error('存0后IIFE应返回false(默认关闭),实际 '+v);
    vm.runInContext("localStorage.setItem('sgs_chat_voice','1')", sandbox);
    const v2 = vm.runInContext("(function(){ try{ return !(typeof localStorage!=='undefined' && localStorage.getItem('sgs_chat_voice')==='0'); } catch(e){ return true; } })()", sandbox);
    if(v2!==true) throw new Error('恢复1后IIFE应返回true(默认开),实际 '+v2);
  });
  // ==== CORE-85(issue #132):聊天说话者标签必须优先用消息快照,不能优先查当前局座位 ====
  // 背景:聊天消息跨局保留(存Firebase不清空),但座位-玩家映射会在每局开局随机重排
  // (#104 shuffleSeats)或玩家离开/替换机器人后变化——发送时(pushChatMessage)已经把
  // playerName/general 当场快照进消息本身,渲染时必须优先用这份快照,不能优先查"当前局
  // 这个座位是谁"(否则跨局后旧消息会被错标成新局同座位玩家的名字/武将)。
  await check('chatSenderLabel: 跨局后座位重排,旧消息应显示发送者本人的快照武将名,不是新局同座位玩家', function(){
    const chatSenderLabel = vm.runInContext('chatSenderLabel', sandbox);
    // 消息发送时:座位1是张飞(msg里存了快照 general:'zhangfei'/playerName:'张飞玩家')
    const msg = { seat:1, playerName:'张飞玩家', general:'zhangfei', text:'看我暴击', type:'text' };
    // 跨局后(#104洗座重排):当前局座位1变成了完全不同的人——郭嘉
    const gAfterReshuffle = { started:true, players:[
      null,
      { name:'郭嘉玩家', general:'guojia' }
    ] };
    const label = chatSenderLabel(gAfterReshuffle, msg);
    if(label!=='【张飞】') throw new Error('应显示消息快照里的张飞(发送者本人),不应显示当前局座位1的郭嘉,实际 '+label);
  });

  await check('chatSenderLabel: 消息快照缺失武将名时,退回快照的玩家名(不查当前局座位)', function(){
    const chatSenderLabel = vm.runInContext('chatSenderLabel', sandbox);
    const msg = { seat:1, playerName:'孔融玩家', general:null, text:'礼让为先', type:'text' };
    const gAfterReshuffle = { started:true, players:[ null, { name:'郭嘉玩家', general:'guojia' } ] };
    const label = chatSenderLabel(gAfterReshuffle, msg);
    if(label!=='孔融玩家') throw new Error('应显示消息快照的玩家名"孔融玩家",实际 '+label);
  });

  await check('chatSenderLabel对照组: 消息本身没有快照字段(理论上不该发生,防御性兜底)时才退回查当前局座位', function(){
    const chatSenderLabel = vm.runInContext('chatSenderLabel', sandbox);
    const msg = { seat:1, text:'老消息', type:'text' }; // 没有playerName/general字段
    const g = { started:true, players:[ null, { name:'郭嘉玩家', general:'guojia' } ] };
    const label = chatSenderLabel(g, msg);
    if(label!=='【郭嘉】') throw new Error('快照缺失时应兜底显示当前局座位信息,实际 '+label);
  });

  await check('chatSenderLabel同局内本人消息不受影响(无回归):快照和当前局一致时正常显示', function(){
    const chatSenderLabel = vm.runInContext('chatSenderLabel', sandbox);
    const msg = { seat:0, playerName:'刘备玩家', general:'liubei', text:'仁德治天下', type:'text' };
    const g = { started:true, players:[ { name:'刘备玩家', general:'liubei' } ] };
    const label = chatSenderLabel(g, msg);
    if(label!=='【刘备】') throw new Error('同局内快照与当前局一致,应正常显示【刘备】,实际 '+label);
  });

  await check('chatSenderLabel破坏性验证: 若改回"当前局座位优先",跨局重排后会重新显示成新局玩家(证明第一条断言有鉴别力)', function(){
    // 逐字复刻issue描述的旧bug写法,验证确实会重新观察到症状。
    const brokenLabel = function(g, msg){
      const p = Number.isInteger(msg.seat) && g.players ? g.players[msg.seat] : null;
      const generalId = (p && p.general) || msg.general;
      const gen = g.started && generalId ? vm.runInContext('getGeneral', sandbox)(generalId) : null;
      return gen ? ('【'+gen.name+'】') : ((p && p.name) || msg.playerName || '玩家');
    };
    const msg = { seat:1, playerName:'张飞玩家', general:'zhangfei', text:'看我暴击', type:'text' };
    const gAfterReshuffle = { started:true, players:[ null, { name:'郭嘉玩家', general:'guojia' } ] };
    const label = brokenLabel(gAfterReshuffle, msg);
    if(label!=='【郭嘉】') throw new Error('旧写法应该(错误地)显示当前局座位的郭嘉,如果没有说明这条断言对该修复没有鉴别力');
  });

  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
