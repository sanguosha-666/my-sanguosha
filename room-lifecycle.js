// room-lifecycle.js — 房间/对局生命周期,从 game.js 拆分出来(纯重构,行为零变化)。
// 包含建房加入(joinRoom/enterGame)、开局武将分配(startGame/finishGeneralAssign/
// respondPickGeneral/debugPickGeneral)、重开/关闭/返回大厅(newGame/cleanupRoom/
// backToLobby)。这几组函数在调用图上彼此并不互相调用(joinRoom/enterGame 与
// startGame 一系是各自独立的连通分量),放进同一个文件是主题分组而非调用图发现的
// 聚类——但和 skills.js 同理,这批函数之间本来就没有调用关系,合并不会制造新耦合,
// 只是把"游戏从头到尾怎么开始/怎么结束"这条主线集中到一处。


function joinRoom(){
  const errEl = document.getElementById('lobbyErr');
  errEl.textContent = '';
  if (NOT_CONFIGURED){ errEl.textContent = '请先在文件里填入 Firebase 配置再部署。'; return; }
  const room = document.getElementById('roomInput').value.trim();
  const name = document.getElementById('nameInput').value.trim();
  if(!room){ errEl.textContent='请填房间号'; return; }
  // bug1:房间号被拼进 Firebase 路径,key 不允许 . # $ [ ] / 等字符,只放行字母/数字/-/_
  if(!/^[A-Za-z0-9_-]+$/.test(room)){ errEl.textContent='房间号只能用字母、数字、- 和 _'; return; }
  if(!name){ errEl.textContent='请填名字'; return; }
  roomId = room;
  gameRef = db.ref('rooms/'+roomId+'/game');
  chatRef = db.ref('rooms/'+roomId+'/chat');

  let joinError = null; // 在事务里设置,事务外提示

  gameRef.transaction(g => {
    joinError = null;
    if(g === null){
      g = { started:false, players:[], turn:0, phase:'lobby', deck:[], discard:[],
            pending:null, shaUsed:false, roundNum:1, roundSeatsActed:[], lastCardSound:null,
            lastSkillSound:null,
            log:['房间已创建,等待玩家加入'] };
    }
    g.players = g.players || [];
    // bug2:先按本地标识找"我自己"(刷新重连),能回到原座位
    const mine = g.players.findIndex(p=>p && p.cid===myClientId);
    if(mine>=0){ mySeat = mine; return g; }
    // 名字被房间里"别人"(不同 cid)占用 -> 拒绝,不复用座位
    const nameTaken = g.players.some(p=>p && p.name===name && p.cid!==myClientId);
    if(nameTaken){ joinError='这个名字已被占用,请换一个'; return g; }
    if(g.started){ return g; } // 这局已开始,且不是原座位的人 -> 事务外提示
    if(g.players.length >= SEATS) return g; // full
    mySeat = g.players.length;
    g.players.push({ name, cid:myClientId, hp:MAX_HP, maxHp:MAX_HP, hand:[], alive:true });
    g.log = pushLog(g.log, name+' 加入了房间（座位'+(mySeat+1)+'）');
    return g;
  }, (err, committed, snap)=>{
    if(err){ errEl.textContent='连接出错: '+err.message; return; }
    if(joinError){ errEl.textContent=joinError; return; }
    const g = snap.val();
    if(mySeat===null && (g.players||[]).length>=SEATS && !g.started){
      errEl.textContent='房间已满（已有3人）。'; return;
    }
    if(mySeat===null && g.started){
      errEl.textContent='这局已经开始了,换个房间号或等下一局。'; return;
    }
    enterGame();
  });
}

function enterGame(){
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('configWarn').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  gameRef.on('value', snap => render(snap.val()));
  if(chatQuery) chatQuery.off();
  chatQuery = chatRef.limitToLast(80);
  chatQuery.on('value', snap=>{
    const raw=snap.val()||{};
    chatMessages=Object.keys(raw).map(k=>Object.assign({id:k},raw[k]||{}))
      .sort((a,b)=>(a.ts||0)-(b.ts||0));
    if(currentG) renderLogPanel(currentG);
  });
}

// 大厅机器人座位。机器人仍是标准 player，只以 isBot 区分；距离、身份、回合和胜负逻辑
// 继续复用同一套 players 数组。只有座位0的真人可增删，避免多人同时操作造成争抢。
// addBot(team):team 模式必须传队伍号(房主 mySeat===0 在选队面板指定),机器人入指定队;
// 传了队伍号=选队即锁定 gameMode='team'(对齐 joinTeam,修游离机器人软锁:旧实现大厅
// gameMode 恒 null,面板"+机器人"在选队前点会 botTeam=null 产游离机器人,选队锁定后
// 开始按钮 hasNoTeam 校验永远拦截)。team 房间无参调用(通用"添加机器人"入口)直接拒绝,
// 不产游离机器人。非 team 房间调用 addBot() 不带参,行为零变化(botTeam 恒 null)。
function addBot(team){
  tx(g=>{
    if(g.started || g.phase!=='lobby' || mySeat!==0 || g.players.length>=SEATS) return g;
    const wantTeam = Number.isInteger(team);
    if(g.gameMode && g.gameMode!=='team') return g;          // 已锁非team房间拒绝
    if(wantTeam && g.gameMode!=='team') g.gameMode='team';   // 传了队伍号=选队即锁定(对齐joinTeam)
    if(g.gameMode==='team' && !wantTeam) return g;           // team房间但没指定队伍:拒绝游离机器人
    const botNo=g.players.filter(p=>p&&p.isBot).length+1;
    const botTeam = (g.gameMode==='team' && wantTeam && team>=0 && team<SEATS) ? team : null;
    g.players.push({
      name:'机器人'+botNo,cid:'bot-'+Date.now()+'-'+Math.floor(Math.random()*1000000),
      isBot:true,botLevel:'smart',hp:MAX_HP,maxHp:MAX_HP,hand:[],alive:true,team:botTeam
    });
    g.log=pushLog(g.log,'已添加机器人'+botNo+(botTeam!=null?('·队'+(botTeam+1)):''));
    // 写 team 后再跑一次 normalize(与 joinTeam 同一先例):tx 只在本事务开始时 normalize,
    // push 机器人改完 team 后若不重跑,teamCount 停留在旧值,提交快照不自洽。
    normalize(g);
    return g;
  });
}
function removeBot(){
  tx(g=>{
    if(g.started || g.phase!=='lobby' || mySeat!==0) return g;
    for(let i=g.players.length-1;i>=0;i--){
      if(g.players[i]&&g.players[i].isBot){
        const name=g.players[i].name;
        g.players.splice(i,1);
        g.log=pushLog(g.log,'已移除'+name);
        break;
      }
    }
    return g;
  });
}

// joinTeam(team):组队模式大厅选队(玩家自由选队,先到先得)。tx 写自己 p.team,
// teamCount 由 normalize 推导(不手写,靠 normalize 收口)。队伍号 < SEATS(一人一队上限)。
// 写 team 后再跑一次 normalize:tx 只在本事务开始时 normalize,fn 里改完 team 若不重跑,
// 同一次提交快照里 teamCount 会停留在旧值(真实 Firebase 下靠 render→normalize 兜底,
// 这里主动收口让提交快照本身自洽)。
// 模式锁定:大厅 g.gameMode 恒 null(全项目只有 startGame 才写 gameMode),选队即写入
// 'team' 锁定组队模式——不能要求 gameMode==='team' 才放行(否则真实大厅选队永远被拒)。
function joinTeam(team){
  tx(g=>{
    if(g.started || g.phase!=='lobby') return g;
    if(g.gameMode && g.gameMode!=='team') return g; // 已锁非team模式的房间拒绝
    if(!Number.isInteger(team) || team<0 || team>=SEATS) return g;
    if(!g.players[mySeat]) return g;
    g.gameMode = 'team'; // 选队即锁定组队模式(大厅gameMode恒null,此处写入)
    g.players[mySeat].team = team;
    normalize(g);
    return g;
  });
}
// createNewTeam:建一个新队伍并入队。队伍号 = 当前 teamCount(由 normalize 保证整数)。
function createNewTeam(){
  tx(g=>{
    if(g.started || g.phase!=='lobby') return g;
    if(g.gameMode && g.gameMode!=='team') return g;
    const team = Number.isInteger(g.teamCount) ? g.teamCount : 0;
    if(team>=SEATS) return g;
    if(!g.players[mySeat]) return g;
    g.gameMode = 'team'; // 选队即锁定组队模式
    g.players[mySeat].team = team;
    normalize(g);
    return g;
  });
}

// startGame(mode, gameMode):
//   mode = 'random' | 'pick'  武将分配方式
//   gameMode = 'ffa' | 'identity' | 'team'  对战模式(乱斗/身份局/组队);缺省或非法当 'ffa'
// 身份局(identity)仅允许 pick、人数 4~8;先发身份再主公 5 选 1。
// 守卫须同时检查 pickingGeneral / pickingLordGeneral,不能只查 g.started。
function startGame(mode, gameMode){
  tx(g=>{
    if(g.started || g.phase==='pickingGeneral' || g.phase==='pickingLordGeneral') return g;
    const gm = (gameMode==='identity') ? 'identity' : (gameMode==='team') ? 'team' : 'ffa';
    const n = g.players.length;
    if(gm==='identity'){
      if(n<4 || n>8) return g;
      if(mode!=='pick') return g;
    } else if(gm==='team'){
      if(n<2) return g;
      if(mode!=='pick' && mode!=='random') return g;
      // 队伍校验:队伍数≥2且每队≥1人、所有人 team 非 null(防无队玩家通过服务端校验)
      const teamSet = {};
      g.players.forEach(p=>{ if(p && Number.isInteger(p.team)) teamSet[p.team]=true; });
      if(Object.keys(teamSet).length<2) return g;
      if(g.players.some(p=>p && p.team==null)) return g;
    } else {
      if(n<MIN_PLAYERS) return g;
      if(mode!=='random' && mode!=='pick') return g;
    }
    if(g.gameMode && g.gameMode!==gm) return g; // 已锁其它模式的房间拒绝改开局(选队已锁team)
    g.gameMode = gm;
    if(gm==='team'){
      g.log = pushLog(g.log, '组队模式开启,队伍分配: '+g.players.map(p=>((p.name||'?')+'·队'+((Number.isInteger(p.team)?p.team:-1)+1))).join(', '));
    }
    g.generalMode = mode;
    g.winSide = null;
    g.aiRebelSuspicion = {};
    g.lordGeneralPool = null;
    // 乱斗:清身份字段
    if(gm!=='identity'){
      g.players.forEach(p=>{ if(p){ p.role=null; p.roleRevealed=false; } });
    }

    const allIds = Object.keys(GENERALS);
    const shuffled = [...allIds].sort(()=>Math.random()-0.5);

    // ----- 身份局:发身份 + 主公 5 选 1 -----
    if(gm==='identity'){
      assignIdentities(g.players);
      const lord = getLordSeat(g);
      if(lord<0) return g;
      const LORD_PICK = 5;
      const OTHER_PICK = 3;
      const needed = LORD_PICK + OTHER_PICK * (n - 1);
      g.log = pushLog(g.log, '身份模式开启，主公是 '+g.players[lord].name);
      if(shuffled.length < needed){
        // 武将不足:退化随机分将,直接开局收尾
        g.players.forEach((p,i)=>{
          p.general = shuffled[i % shuffled.length];
          p.generalChoices = null;
        });
        g.lordGeneralPool = null;
        checkHuashenBeforeAssign(g);
        return g;
      }
      g.lordGeneralPool = shuffled.slice(0, LORD_PICK);
      g.players[lord].generalChoices = g.lordGeneralPool.slice();
      g.players[lord].general = null;
      g.players.forEach((p,i)=>{
        if(!p || i===lord) return;
        p.generalChoices = null;
        p.general = null;
      });
      g.phase = 'pickingLordGeneral';
      g.log = pushLog(g.log, '请主公从 5 名武将中选择…');
      return g;
    }

    // ----- 乱斗:原有 random / pick -----
    if(mode==='pick'){
      const perPlayer = 3;
      const needed = n*perPlayer;
      if(shuffled.length < needed){
        g.players.forEach((p,i)=>{ p.general = shuffled[i % shuffled.length]; });
        checkHuashenBeforeAssign(g);
        return g;
      }
      const pool = shuffled.slice(0, needed);
      g.players.forEach((p,i)=>{
        p.generalChoices = pool.slice(i*perPlayer, (i+1)*perPlayer);
        p.general = null;
      });
      g.phase = 'pickingGeneral';
      g.log = pushLog(g.log, '选将阶段:请各位玩家从候选中选择一名武将');
      return g;
    }

    g.players.forEach((p,i)=>{ p.general = shuffled[i]; });
    checkHuashenBeforeAssign(g);
    return g;
  });
}

// finishGeneralAssign: 武将确定之后的开局收尾。原样对照迁移自原 startGame 函数体"分配完武将
// 之后"的全部逻辑(buildDeck/每人发牌堆状态/drawN初始手牌/g.started/g.pending/开局日志/
// startTurn(g,0)),一步不少。注意:原函数从未手写 g.phase(完全交给 startTurn 内部的
// continueQiaobianCheck 链路决定该进入哪个阶段),这里同样不手写 g.phase,维持原有行为
// ——这正是"开局第一回合甄姬洛神不触发"那个bug当年的教训(见下面 startTurn 调用处的注释),
// 不能因为这次改动顺手引入新的手写 g.phase。
function finishGeneralAssign(g){
  g.deck = buildDeck(); g.discard=[];
  g.lordGeneralPool = null;
  g.players.forEach((p,i)=>{
    p.maxHp = generalMaxHp(p.general);       // 体力上限按武将,异常回退 MAX_HP
    // 身份局主公 +1 体力上限
    if(g.gameMode==='identity' && p.role==='zhu') p.maxHp += 1;
    p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.chained=false; p.faceup=true; p.turnedOver=false; p.nirvanaUsed=false; p.chanyuan=false; p.delays=[];
    p.equips = emptyEquips();                // 装备区:开局四槽全空
    drawN(g,i,START_HAND);
  });
  g.started=true; g.pending=null;
  g.log = pushLog(g.log, '游戏开始！');
  // 第一回合也要走 startTurn(不能手写 g.turn/g.phase),否则会跳过判定区处理和洛神触发链路
  // ——这正是"开局第一回合甄姬洛神不触发"这个 bug 的根因,第二回合起走 endTurn→startTurn 就正常。
  // 身份局从主公座位起手;乱斗仍从座位 0。
  let startSeat = 0;
  if(g.gameMode==='identity'){
    const lord = getLordSeat(g);
    if(lord>=0) startSeat = lord;
  }
  startTurn(g, startSeat);
}

// checkHuashenBeforeAssign: 左慈【化身】v2 完整调度器——生成初始库存(p.huashenPool)+
// 依次询问所有"还没声明借用哪个技能"的左慈(按座位顺序一次问一个,respondHuashenPick
// 结算后会再次调用本函数找下一个待处理的座位),全部问完才真正进入 finishGeneralAssign
// ——和三选一武将"全部选完才finishGeneralAssign"同一衔接结构。
//
// 【候选生成这次必须是幂等的,这是对第一块产出代码的一处必要修改】——第一块设计时
// checkHuashenBeforeAssign 只做候选生成、只会被独立调用一次,所以当时"不需要考虑
// 已经有pool了"这种情况;但这次把它和"排队询问"合并成一个函数后,respondHuashenPick
// 会反复调用它来找下一个待处理的左慈,如果候选生成部分不做"只在pool为空时才生成"
// 这个幂等判断,后一次调用会把还在等待声明的左慈的pool重新洗一遍——这正是v1版本
// (checkHuashenBeforeAssign/checkHuashenBeforeAssign 那次)踩过的"先有鸡先有蛋"
// 时序坑的另一种变体,这次必须一开始就避开。
//
// 排除条件统一:候选 = GENERAL_IDS - ['zuoci', ...p.huashenPool] ——不管是这里(开局)
// 还是以后的【新生】重选,排除逻辑都是这一条,不额外排除"场上其他玩家在用的武将"。
function checkHuashenBeforeAssign(g){
  g.players.forEach(p=>{
    if(hasCap(p,'huashen') && p.huashenPool.length===0){
      const excluded = ['zuoci', ...p.huashenPool];
      const avail = GENERAL_IDS.filter(id=>!excluded.includes(id));
      const shuffled = [...avail].sort(()=>Math.random()-0.5);
      p.huashenPool = shuffled.slice(0,2);
    }
  });
  // 找第一个"有pool但还没声明技能"的座位——不假设"一局只会有一个左慈"(遍历全部玩家,
  // findIndex按座位顺序找,不break提前退出;若还有其他左慈待处理,respondHuashenPick
  // 结算后会再次调用本函数,自然找到下一个)。
  const pendingSeat = g.players.findIndex(p=>p && hasCap(p,'huashen') && p.huashenPool.length>0 && p.huashenGeneral===null);
  if(pendingSeat<0){
    finishGeneralAssign(g);
    return;
  }
  // pending不缓存候选副本——respondHuashenPick/UI都直接实时读g.players[seat].huashenPool
  // 本体,不在pending里存一份快照。理由:①这次范围内pool在"开出pending"到"处理完毕"之间
  // 不可能变化(新生/更改化身都不在本块范围内),缓存防的是一个眼下不存在的问题;②这个
  // 项目里"化身借用"相关的查询函数(hasCap/huashenSkillEntry等)一贯坚持"只动态查询,
  // 绝不静态复制"这条架构原则,pending存副本正是在开一个新的静态复制实例,和既有原则
  // 相悖;③少一份数据意味着normalize要防御的字段更少,也免疫"副本和本体不同步"这整
  // 一类bug;④为后续"更改化身"铺路更顺,那个流程大概率也要从pool里选,统一走实时读取
  // 不需要为"pending里有没有缓存"分两套逻辑。
  g.pending = { type:'huashenPick', seat:pendingSeat };
  g.phase = 'huashenPick';
  // 日志刻意不透露候选内容/最终选择——和 respondPickGeneral 同一个"正式开局
  // (finishGeneralAssign的g.started=true)前都是隐藏信息"的窗口期。
  g.log = pushLog(g.log, g.players[pendingSeat].name+' 是否发动【化身】,选择借用一名武将的技能…');
}

// respondHuashenPick v2: 左慈从 p.huashenPool(实时读取,不是pending里的快照)里选一个
// 武将,声明借用它的一个具体技能。**和v1最大的行为差异:选完不清空 huashenPool**——
// 库存只增不减,已经声明的技能对应的武将依然留在库存里,为将来"更改化身"时可以切回来
// 做准备(这是第三块的范围,这里只负责"不要清空",不实现"切换"本身)。
function respondHuashenPick(generalId, skillName){
  tx(g=>{
    if(g.phase!=='huashenPick' || !g.pending || g.pending.type!=='huashenPick' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !validateHuashenPick(me.huashenPool, generalId, skillName)) return g;
    me.huashenGeneral = generalId;
    me.huashenSkillName = skillName;
    // 不清空 me.huashenPool —— v2的关键行为差异,见函数注释。
    g.log = pushLog(g.log, me.name+' 已选定借用的技能,等待其他玩家…');
    g.pending = null;
    checkHuashenBeforeAssign(g); // 不直接调finishGeneralAssign——可能还有其他左慈待处理
    return g;
  });
}

// respondHuashenChangeAskEnd/respondHuashenChangePickEnd: 回合结束阶段"是否更改化身"
// 询问及其两级选择结算。不能复用 respondHuashenPick——那个函数的守卫写死了
// g.phase!=='huashenPick',且收尾调 checkHuashenBeforeAssign/finishGeneralAssign,
// 是开局专属的一次性流程,不能套在"回合中途重新声明"这个场景上;这里各自独立定义,
// 收尾统一 continueBiyueCheck(和 continueHuashenChangeCheckAtTurnEnd 在没有化身/拒绝
// 更改时落到的下一环完全一致)。
function respondHuashenChangeAskEnd(activate){
  tx(g=>{
    if(g.phase!=='huashenChangeAskEnd' || !g.pending || g.pending.type!=='huashenChangeAskEnd' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || !me.alive){ g.pending=null; g.phase='discard'; return g; }
    const endingSeat = g.pending.seat;
    if(!activate){
      g.log = pushLog(g.log, me.name+'：不更改【化身】');
      g.pending = null;
      continueBiyueCheck(g, endingSeat);
      return g;
    }
    // 同上,setResponseAskedAt 补时间戳(不补则超时机制对这个中间阶段同样失效)。
    g.pending = setResponseAskedAt({type:'huashenChangePickEnd', seat:endingSeat});
    g.phase = 'huashenChangePickEnd';
    g.log = pushLog(g.log, me.name+' 重新选择借用一名武将的技能…');
    return g;
  });
}
function respondHuashenChangePickEnd(generalId, skillName){
  tx(g=>{
    if(g.phase!=='huashenChangePickEnd' || !g.pending || g.pending.type!=='huashenChangePickEnd' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    const endingSeat = g.pending.seat;
    if(!me || !validateHuashenPick(me.huashenPool, generalId, skillName)){ return g; }
    me.huashenGeneral = generalId;
    me.huashenSkillName = skillName;
    g.log = pushLog(g.log, me.name+' 已更改【化身】声明的技能');
    g.pending = null;
    continueBiyueCheck(g, endingSeat);
    return g;
  });
}
// abandonHuashenChangePickEnd: 回合结束一侧的同款边界收尾,见 skills.js 的
// abandonHuashenChangePickStart 注释——找不到任何合法候选时,按"未更改"处理,推进到
// continueBiyueCheck,不让pending永久悬空。
function abandonHuashenChangePickEnd(){
  tx(g=>{
    if(g.phase!=='huashenChangePickEnd' || !g.pending || g.pending.type!=='huashenChangePickEnd' || g.pending.seat!==mySeat) return g;
    const me = g.players[mySeat];
    const endingSeat = g.pending.seat;
    g.log = pushLog(g.log, (me?me.name:'左慈')+'：【化身】候选武将均无可用技能,放弃这次更改');
    g.pending = null;
    continueBiyueCheck(g, endingSeat);
    return g;
  });
}

// respondPickGeneral: 三选一模式下,玩家从自己的候选(p.generalChoices)里选一个。
// finishLordGeneralPick: 主公选将结算的共用主体(respondPickLordGeneral/debugPickLordGeneral
// 校验各自的合法性之后都调用它)——选完后全场立刻可见主公武将(p.general 已写入;渲染层对
// 主公放开 avatarReady),再给其余玩家各发 3 张进入 pickingGeneral。
// **不做候选合法性校验**——校验是两个入口各自的职责,这里只负责"选定之后要做的事"。
function finishLordGeneralPick(g, lord, generalId){
  const me = g.players[lord];
  me.general = generalId;
  me.generalChoices = null;
  // 主公武将对全场立刻可见,日志可写武将名
  g.log = pushLog(g.log, me.name+' 选择了武将【'+GENERALS[generalId].name+'】');
  const pool5 = Array.isArray(g.lordGeneralPool) ? g.lordGeneralPool : [];
  // 池外调试选将:剩余池 = 全部武将去掉已选
  const leftover = pool5.filter(id=>id!==generalId);
  const unused = Object.keys(GENERALS).filter(id=>id!==generalId && !pool5.includes(id));
  const rest = [...leftover, ...unused].sort(()=>Math.random()-0.5);
  const OTHER_PICK = 3;
  let k = 0;
  g.players.forEach((p,i)=>{
    if(!p || i===lord) return;
    p.generalChoices = rest.slice(k, k+OTHER_PICK);
    k += OTHER_PICK;
    p.general = null;
  });
  g.phase = 'pickingGeneral';
  g.log = pushLog(g.log, '请其他玩家选将…');
}

// respondPickLordGeneral: 正式入口——身份局主公从发给他的 5 张候选(g.lordGeneralPool)里
// 选 1,只能点自己的候选池,不能选池外武将。**这条候选池校验是这个函数存在的意义**,和
// respondPickGeneral(他人三选一正式入口)对 p.generalChoices 的 includes 校验同一原则,
// 不能因为调试场景需要放开限制就把这条校验从正式入口里拿掉——调试需求应该走独立的
// debugPickLordGeneral,不能共用这一个函数(这正是 6e3db94 那次改动踩的坑:当时把校验直接
// 从这个正式入口里删掉了,导致正式流程里主公理论上能绕过UI选到候选池外的任意武将)。
function respondPickLordGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingLordGeneral' || g.gameMode!=='identity') return g;
    const lord = getLordSeat(g);
    if(lord!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || me.general) return g;
    if(!GENERALS[generalId]) return g;
    if(!Array.isArray(me.generalChoices) || !me.generalChoices.includes(generalId)) return g;
    finishLordGeneralPick(g, lord, generalId);
    return g;
  });
}

// debugPickLordGeneral: 仅供测试用的调试入口——身份局主公选将阶段专属,不受候选池
// (g.lordGeneralPool/me.generalChoices)限制,可以直接指定任意已实现的武将,方便测试某个
// 具体主公武将不用靠随机等它出现在候选池里。和 debugPickGeneral(他人三选一的调试入口)同一
// 定位、同一"不校验候选池"的既有约定,只是各自对应正式入口不同(这个对应 respondPickLordGeneral,
// 后者对应 respondPickGeneral)——两条身份局选将路径(主公/他人)现在都各自有一对独立的
// 正式/调试函数,不再像 6e3db94 之前那样共用一个函数导致调试需求波及正式校验。
function debugPickLordGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingLordGeneral' || g.gameMode!=='identity') return g;
    const lord = getLordSeat(g);
    if(lord!==mySeat) return g;
    const me = g.players[mySeat];
    if(!me || me.general) return g;
    if(!GENERALS[generalId]) return g;
    finishLordGeneralPick(g, lord, generalId);
    return g;
  });
}

function respondPickGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingGeneral') return g;
    const me=g.players[mySeat];
    if(!me || me.general || !Array.isArray(me.generalChoices) || !me.generalChoices.includes(generalId)) return g;
    me.general = generalId;
    me.generalChoices = null;
    // 日志刻意不写具体武将名字——候选和最终选择在正式开局(finishGeneralAssign)前都是
    // 隐藏信息,g.log 是所有玩家共享同步的字段(配合"新日志自动弹toast提醒所有人"机制),
    // 写具体牌名会让所有人立刻收到暴露选择的弹窗提示。
    // (身份局主公已在 respondPickLordGeneral 写过名,此处是非主公)
    g.log = pushLog(g.log, me.name+' 已选定武将,等待其他玩家…');
    if(g.players.every(p=>p && p.general)){
      checkHuashenBeforeAssign(g); // 全部选完,检查是否需要先问左慈化身,再进入正式开局
    }
    return g;
  });
}

// debugPickGeneral: 仅供测试用的调试入口——不受 p.generalChoices(三选一候选池)限制,可以
// 直接指定任意已实现的武将。**刻意不检查"武将是否已被其他玩家选择过"这条唯一性限制**——
// 正式对局(respondPickGeneral)靠开局前不放回抽样天然保证同局武将互不重复,但测试场景下
// 经常需要让多人都选到同一个武将来单独反复验证某个技能,不应该受人数/候选池随机性影响,
// 所以这里放宽这条规则,允许重复选择同一个武将。这不代表正式对局允许重复,只是测试专用的
// 例外通道,和 render.js 里明显标注"仅供调试测试使用"的 UI 入口配套。
function debugPickGeneral(generalId){
  tx(g=>{
    if(g.phase!=='pickingGeneral') return g;
    const me=g.players[mySeat];
    if(!me || me.general) return g; // 已经选过了不能重复选,和正式respondPickGeneral保持同样的基本约束
    if(!GENERALS[generalId]) return g; // 必须是真实存在的武将id
    me.general = generalId;
    me.generalChoices = null;
    g.log = pushLog(g.log, me.name+' (调试模式)选择了武将【'+GENERALS[generalId].name+'】');
    if(g.players.every(p=>p && p.general)){
      checkHuashenBeforeAssign(g); // 调试选将同样要走化身询问,不能绕开(否则选到左慈会静默无技能)
    }
    return g;
  });
}

function newGame(){
  tx(g=>{
    g.started=false; g.phase='lobby'; g.pending=null; g.winner=null; g.aoe=null;
    g.gameMode=null; g.winSide=null; g.lordGeneralPool=null; g.generalMode=null;
    g.aiRebelSuspicion={};
    g.deck=[]; g.discard=[];
    g.players.forEach(p=>{
      p.general = randomGeneralId();     // 每局重新随机换将
      p.maxHp = generalMaxHp(p.general); // 异常回退 MAX_HP
      p.hp = p.maxHp; p.hand=[]; p.alive=true; p.dying=false; p.chained=false; p.faceup=true; p.turnedOver=false; p.nirvanaUsed=false; p.chanyuan=false; p.delays=[];
      p.equips = emptyEquips();          // 装备区:每局重置为四槽全空
      p.role=null; p.roleRevealed=false; p.generalChoices=null;
    });
    g.log=pushLog(g.log,'重置房间,可再次开始');
    return g;
  });
}

function cleanupRoom(){
  // 常驻按钮任何阶段都能点到(见 render.js #closeRoomBtn),游戏进行中点击等于强制中断
  // 所有人的对局且不可恢复——提示文案明确说清楚这一点,不区分"进行中"/"已结束"两套逻辑,
  // 行为本身(删除房间数据+所有人回大厅)完全一致,只是让玩家点之前多一层警示。
  if(!confirm('确定要关闭本房间吗?这会删除本房间数据,所有人会立即回到大厅——如果游戏正在进行中,会直接中断当前对局且无法恢复。')) return;
  if(gameRef) gameRef.off();
  if(chatQuery) chatQuery.off();
  Promise.all([gameRef.remove(), chatRef ? chatRef.remove() : Promise.resolve()]).then(backToLobby).catch(err=>{
    alert('清理失败: '+err.message);
  });
}

function backToLobby(){
  if(chatQuery) chatQuery.off();
  chatQuery=null; chatRef=null; chatMessages=[];
  mySeat = null; selectedCardIdx = null; resetZhangba();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('lobbyErr').textContent = '房间已清理,可重新进入。';
}
