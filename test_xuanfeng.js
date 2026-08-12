describe('凌统【旋风】修复', function() {
  function player(name, general) {
    return {
      name: name, general: general, alive: true, hp: 4, maxHp: 4,
      hand: [], equips: { weapon: null, armor: null, plus1: null, minus1: null },
      delays: [], caps: {}, huashenPool: [], huashenGeneral: null, huashenSkillName: null
    };
  }

  it('Firebase省略空数组后仍保留刚触发的旋风选择状态', function() {
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    const g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: {
        type: 'xuanfengPick', from: 0, trigger: 'equip', maxRemaining: 2,
        stage: 'selecting', previousPhase: 'play'
      },
      deck: [], discard: [], log: []
    };

    normalize(g);

    assert.strictEqual(g.pending.type, 'xuanfengPick');
    assert.deepStrictEqual(Array.from(g.pending.targets), []);
    assert.deepStrictEqual(Array.from(g.pending.discardedCounts), []);
    assert.strictEqual(g.phase, 'xuanfengPick');
  });

  it('选择1张后可以主动完成并真实弃牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    finishXuanfengSelection();

    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard.length, 1);
    assert.strictEqual(_g.pending, null);
    assert.strictEqual(_g.phase, 'play');
  });

  it('选中目标后进入逐张选牌阶段', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }, { id: 'h2', name: '闪' }];
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [1], discardedCounts: [1], maxRemaining: 1, stage: 'selecting', previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengTarget(1);

    assert.strictEqual(_g.pending.currentTargetSeat, 1);
    assert.strictEqual(_g.pending.maxRemaining, 1);
    assert.strictEqual(_g.pending.stage, 'chooseCard');
  });

  it('可以指定弃置目标的装备而不是随机手牌', function() {
    mySeat = 0;
    const lingtong = player('凌统', 'lingtong');
    const target = player('目标', 'liubei');
    target.hand = [{ id: 'h1', name: '杀' }];
    target.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [lingtong, target], turn: 0, phase: 'xuanfengPick',
      pending: { type: 'xuanfengPick', from: 0, trigger: 'equip', targets: [], discardedCounts: [], selections: [], maxRemaining: 2, stage: 'chooseCard', currentTargetSeat: 1, previousPhase: 'play' },
      deck: [], discard: [], log: []
    };

    pickXuanfengCard('equip', 'armor');
    finishXuanfengSelection();

    assert.strictEqual(target.equips.armor, null);
    assert.strictEqual(target.hand.length, 1);
    assert.strictEqual(_g.discard[0].name, '八卦阵');
    assert.strictEqual(_g.pending, null);
  });

  it('骁果令凌统失去装备后保留旋风pending并记录续接', function() {
    mySeat = 1;
    const yuejin = player('乐进', 'yuejin');
    const lingtong = player('凌统', 'lingtong');
    lingtong.equips.armor = { id: 'e1', name: '八卦阵' };
    _g = {
      players: [yuejin, lingtong], turn: 1, phase: 'xiaoguoChoice',
      pending: { type: 'xiaoguoChoice', from: 0, endingSeat: 1, to: 1 },
      deck: [{ id: 'd1', name: '杀' }], discard: [], log: []
    };

    respondXiaoguoChoice('armor');

    assert.strictEqual(lingtong.equips.armor, null);
    assert.strictEqual(yuejin.hand.length, 1);
    assert.strictEqual(_g.pending.type, 'xuanfengPick');
    assert.strictEqual(_g.pending.from, 1);
    assert.strictEqual(_g.pending.resume.type, 'xiaoguo');
    assert.strictEqual(_g.pending.resume.endingSeat, 1);
    assert.strictEqual(_g.pending.resume.lastAsker, 0);
  });

  it('流离弃装备触发旋风后暂停，并在旋风结束后继续转移的杀', function() {
    mySeat = 1;
    const attacker = player('攻击者', 'caocao');
    const lingtong = player('兼具流离的凌统', 'lingtong');
    lingtong.caps = { liuli: true };
    lingtong.equips.armor = { id:'e-liuli', name:'八卦阵' };
    const redirected = player('转移目标', 'liubei');
    _g = {
      players:[attacker,lingtong,redirected], turn:0, phase:'liuli',
      pending:{type:'liuli',from:0,to:1,usedAs:'【杀】',shaColor:'red',targets:[2],sourceCard:{id:'sha-liuli',name:'杀',suit:'♥'}},
      deck:[],discard:[],log:[]
    };

    respondLiuli({kind:'equip',slot:'armor'},2);
    assert.strictEqual(_g.pending.type,'xuanfengPick','旋风 pending 不得被杀结算覆盖');
    assert.strictEqual(_g.pending.resume.type,'liuliAfterDiscard');
    assert.strictEqual(_g.pending.resume.newTargetSeat,2);

    cancelXuanfeng();
    assert.strictEqual(_g.phase,'respond','旋风完成后应继续转移目标的杀响应');
    assert.strictEqual(_g.pending.to,2);
    assert.strictEqual(_g.pending.from,0);
  });

  it('急救弃红色装备触发旋风后恢复原濒死上下文', function() {
    mySeat=1;
    const turnPlayer=player('当前回合角色','caocao');
    const lingtong=player('兼具急救的凌统','lingtong');
    lingtong.caps={jijiu:true};
    lingtong.equips.armor={id:'red-equip',name:'八卦阵',suit:'♥'};
    const dying=player('濒死角色','liubei'); dying.hp=0;
    _g={players:[turnPlayer,lingtong,dying],turn:0,phase:'dying',started:true,
      pending:{type:'dying',seat:2,asking:1,resume:{type:'sha'}},deck:[],discard:[],log:[],gameMode:'ffa'};

    respondDying(true,{kind:'equip',slot:'armor'});
    assert.strictEqual(_g.pending.type,'xuanfengPick','不得把旋风 pending 当作 dying 继续读取');
    assert.strictEqual(_g.pending.resume.type,'dyingJijiu');
    assert.strictEqual(dying.hp,0,'子技能完成前暂不结算回复');

    cancelXuanfeng();
    assert.strictEqual(dying.hp,1,'旋风完成后急救回复正确结算');
    assert.strictEqual(dying.dying,false,'应正常脱离濒死');
    assert.strictEqual(_g.pending,null,'不得残留旋风或 dying pending');
  });

  it('寒冰剑弃装备触发旋风后暂停，并从下一轮继续', function() {
    mySeat=0;
    const attacker=player('攻击者','caocao');
    attacker.hand=[{id:'h1',name:'杀'}];
    const lingtong=player('凌统','lingtong');
    lingtong.equips.armor={id:'e1',name:'八卦阵'};
    lingtong.equips.plus1={id:'e2',name:'的卢'};
    _g={players:[attacker,lingtong],turn:0,phase:'hanbing',started:true,
      pending:{type:'hanbing',from:0,to:1,round:0},deck:[],discard:[],log:[],gameMode:'ffa'};

    hanbingPick('armor');
    assert.strictEqual(_g.pending.type,'xuanfengPick','旋风 pending 不应被寒冰剑覆盖');
    assert.strictEqual(_g.pending.resume.type,'hanbing');
    assert.strictEqual(_g.pending.resume.round,1,'恢复时应从第二轮继续');

    mySeat=1;
    cancelXuanfeng();
    assert.strictEqual(lingtong.equips.plus1,null,'旋风结束后寒冰剑应继续弃第二张牌');
    assert.strictEqual(_g.pending.type,'xuanfengPick','第二次失去装备也应先完整结算旋风');
    assert.strictEqual(_g.pending.resume.round,2,'第二次旋风后应恢复到寒冰剑收尾');
    cancelXuanfeng();
    assert.strictEqual(_g.pending,null,'寒冰剑完成后应清空自身状态');
    assert.strictEqual(_g.phase,'play');
  });
});
