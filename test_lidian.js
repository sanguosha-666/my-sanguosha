function card(name, suit, rank){
  return { id:name+'-'+suit+'-'+rank+'-'+Math.random(), name, suit, rank };
}

function player(name, general){
  return {
    name,
    general,
    hp:3,
    maxHp:3,
    alive:true,
    hand:[],
    equips:{weapon:null, armor:null, atkHorse:null, defHorse:null},
    delays:[]
  };
}

function baseGame(){
  return {
    players:[player('李典','lidian'), player('张飞','zhangfei')],
    deck:[
      card('杀','♠',1),
      card('闪','♥',2),
      card('桃','♦',3),
      card('杀','♣',4),
      card('闪','♠',5)
    ],
    discard:[],
    log:[],
    pending:null,
    phase:'draw',
    turn:0,
    roundNum:1
  };
}

describe('李典【恂恂/忘隙】', function(){
  it('恂恂可以放弃摸牌,获得2张并将其余牌置底', function(){
    mySeat=0;
    _g=baseGame();
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'xunxunPick');
    assert.strictEqual(_g.pending.cards.length, 4);
    respondXunxun([0,3], [1,2]);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.players[0].hand.length, 2);
    assert.strictEqual(_g.deck.length, 3);
    assert.deepStrictEqual(_g.deck.slice(0,2).map(c=>c.rank), [3,4]);
  });

  it('非李典不能发动恂恂', function(){
    mySeat=0;
    _g=baseGame();
    _g.players[0].general='zhangfei';
    respondXunxunStart();
    assert.strictEqual(_g.phase, 'draw');
    assert.strictEqual(_g.pending, null);
  });

  it('忘隙发动后双方各摸指定数量的牌', function(){
    mySeat=0;
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    respondWangxi(true);
    assert.strictEqual(_g.players[0].hand.length, 1);
    assert.strictEqual(_g.players[1].hand.length, 1);
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  // ============ normalize校验 bug 修复:致命伤害场景(death:true)不应被误判为脏数据 ============

  it('normalize:忘隙致死场景(death:true,otherSeat已死亡)不应清空pending', function(){
    _g=baseGame();
    _g.players[1].alive=false; // otherSeat(张飞)已经死亡结算完毕
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.phase, 'wangxiAsk');
    assert.notStrictEqual(_g.pending, null);
    assert.strictEqual(_g.pending.type, 'wangxiAsk');
  });

  it('normalize+respondWangxi:致死场景发动忘隙,只有李典自己摸牌,流程正确推进', function(){
    mySeat=0;
    _g=baseGame();
    _g.players.push(player('第三人','yuJi')); // 3人局,otherSeat死亡后仍有2人存活,不会触发checkWin结束游戏
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g); // 模拟真实tx()入口:respondWangxi被调用前,服务端总会先跑一次normalize
    assert.notStrictEqual(_g.pending, null, 'normalize不应误杀这条致死场景的pending');
    respondWangxi(true);
    assert.strictEqual(_g.players[0].hand.length, 1, '李典应摸1张牌');
    assert.strictEqual(_g.players[1].hand.length, 0, '已死亡的对方不应摸牌');
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  it('normalize+respondWangxi:致死场景选择不发动忘隙,流程正确推进', function(){
    mySeat=0;
    _g=baseGame();
    _g.players.push(player('第三人','yuJi'));
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.notStrictEqual(_g.pending, null);
    respondWangxi(false);
    assert.strictEqual(_g.players[0].hand.length, 0, '不发动不应摸牌');
    assert.strictEqual(_g.phase, 'play');
    assert.strictEqual(_g.pending, null);
  });

  it('normalize:忘隙一般场景(death:false,otherSeat存活)原有行为不受影响', function(){
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.phase, 'wangxiAsk');
    assert.notStrictEqual(_g.pending, null);
  });

  it('normalize:忘隙一般场景(death:false)若otherSeat已死亡,仍应判定为脏数据清空(对照组)', function(){
    _g=baseGame();
    _g.players[1].alive=false;
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:1, death:false, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.pending, null, 'death:false时otherSeat必须存活,否则仍是脏数据');
    assert.strictEqual(_g.phase, 'play');
  });

  it('normalize:otherSeat座位号越界(玩家不存在)依然要被正确拦截清空(负向场景,防止这次修复整体放水)', function(){
    _g=baseGame();
    _g.phase='wangxiAsk';
    _g.pending={type:'wangxiAsk', seat:0, otherSeat:99, death:true, amount:1, resume:{type:'sha'}};
    normalize(_g);
    assert.strictEqual(_g.pending, null, 'otherSeat对应玩家不存在,即使death:true也应判定为脏数据');
    assert.strictEqual(_g.phase, 'play');
  });
});
