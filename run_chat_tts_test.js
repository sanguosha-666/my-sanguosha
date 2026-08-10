// run_chat_tts_test.js —— 聊天语音播报回归套件
// 用法: node run_chat_tts_test.js
const vm = require('vm');
const fs = require('fs');
const speakCalls = [];
const voicesMock = [
  { name: 'Microsoft Huihui - Chinese (Simplified)', lang: 'zh-CN' },   // 女
  { name: 'Microsoft Kangkang - Chinese (Simplified)', lang: 'zh-CN' }, // 男
  { name: 'Google US English', lang: 'en-US' }
];
const context = {
  gameRef: { transaction: function(fn){ return fn(context.g || {}); } },
  firebase: { initializeApp: function(){ return { database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, update: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } }; }, database: function(){ return { ref: function(){ return { on: function(){}, once: function(){}, push: function(){ return { set: function(){}, key:'k' }; }, transaction: function(){}, set: function(){}, child: function(){ return {}; }, remove: function(){}, get: function(){ return { val: function(){ return null; } }; } }; } }; } },
  document: { getElementById: function(){ return { onclick: function(){}, innerHTML:'', style:{}, className:'', classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } }, querySelector: function(){ return null; }, appendChild: function(){ return {}; }, remove: function(){}, setAttribute: function(){}, addEventListener: function(){}, removeEventListener: function(){} }; }, createElement: function(){ return { textContent:'', innerHTML:'', className:'', style:{}, onclick: function(){}, appendChild: function(){}, setAttribute: function(){}, classList:{ add:function(){}, remove:function(){}, toggle:function(){}, contains:function(){ return false; } } }; }, body:{ innerHTML:'', appendChild:function(){} }, head:{ appendChild:function(){} }, addEventListener: function(){}, removeEventListener: function(){}, querySelector: function(){ return null; }, querySelectorAll: function(){ return []; } },
  window: { location:{ search:'', href:'http://localhost' }, localStorage: { getItem: function(k){ return context.__ls && k in context.__ls ? context.__ls[k] : null; }, setItem: function(k,v){ if(!context.__ls) context.__ls={}; context.__ls[k]=String(v); }, removeItem: function(k){ if(context.__ls) delete context.__ls[k]; } }, addEventListener:function(){}, removeEventListener:function(){}, setTimeout:function(f,t){ return setTimeout(f,t); }, clearTimeout:function(){}, alert:function(){}, confirm:function(){ return true; }, open:function(){}, navigator:{ userAgent:'test' }, speechSynthesis: { speak: function(u){ speakCalls.push({ text: u.text, voice: u.voice && u.voice.name || null, pitch: u.pitch, lang: u.lang }); }, cancel: function(){}, getVoices: function(){ return voicesMock; } } },
  joinRoom: function(){}, mySeat: 0, console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp,
  // speechSynthesis.speak 需要 utterance 对象(text/lang/pitch/voice 由 speak stub 读取),补构造器 stub
  SpeechSynthesisUtterance: function(text){ this.text=String(text==null?'':text); this.lang=''; this.pitch=1; this.voice=null; }
};
context.window.document = context.document;
const sandbox = vm.createContext(context);
const files = ['config.js','data.js','debug-log.js','room-lifecycle.js','game.js','weapons.js','skills.js','render-log.js'];
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
    if(speakCalls.length!==2) throw new Error('应念2条(m2新+m1不重复),实际 '+speakCalls.length);
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
  // 5. gender→pitch 映射(无对应 voice 时 fallback pitch)
  await check('speakChatMessage: male→pitch 0.8 / female→pitch 1.2', function(){
    speakCalls.length = 0;
    vm.runInContext('speakChatMessage', sandbox)('男声', 'male');
    vm.runInContext('speakChatMessage', sandbox)('女声', 'female');
    if(speakCalls[0].pitch!==0.8) throw new Error('male应pitch0.8,实际 '+speakCalls[0].pitch);
    if(speakCalls[1].pitch!==1.2) throw new Error('female应pitch1.2,实际 '+speakCalls[1].pitch);
  });
  // 6. voice 选择:列表里有女声 Huihui 时 female 选中它
  await check('pickChatVoice: 女→Huihui, 男→Kangkang', function(){
    const vf = vm.runInContext('pickChatVoice', sandbox)('female');
    const vm2 = vm.runInContext('pickChatVoice', sandbox)('male');
    if(!vf || vf.name.indexOf('Huihui')<0) throw new Error('female应选Huihui,实际 '+(vf&&vf.name));
    if(!vm2 || vm2.name.indexOf('Kangkang')<0) throw new Error('male应选Kangkang,实际 '+(vm2&&vm2.name));
  });
  console.log('\n 结果: '+pass+' 通过, '+fail+' 失败');
  process.exit(fail>0?1:0);
})();
