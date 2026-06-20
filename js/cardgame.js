/* =============================================================================
 * cardgame.js — SF.CardGame（v2 引擎）
 * 排行榜挑戰：回合制卡牌對戰（FROZEN SPEC docs/cardgame-v2-spec.md §1–§6）。
 *
 * 架構：STATEFUL singleton（鏡像 SF.State）。持有一份持久化 root state
 *   （deck、opponent runtime overrides）＋ 至多一個 transient 的進行中 battle。
 *
 * 確定性（MANDATORY）：所有「隨機」（洗牌、重洗、scry 順序、對手二選一、奪詞條抽樣）皆由
 *   SF.Algorithm.hash01(SF.Algorithm.seed(seedStr, salt)) 推導。
 *   不使用任何亂數 API、不使用任何系統時間 API。
 *
 * 無 DOM：本檔不引用 document / UI。資料來源 window.PIA_OPPONENTS、
 *   window.PIA_CARD_EFFECTS；依賴 SF.State（帳號/粉絲/詞條/feed/時鐘）、
 *   SF.Algorithm（讚數/種子）、SF.Data（驗證）。
 *
 * 凍結簽章（SPEC §3）。localStorage 鍵 "summerfeed.cardgame.v2"。
 * ============================================================================= */
(function (global) {
  "use strict";

  var SF = global.SF = global.SF || {};

  var STORAGE_KEY = "summerfeed.cardgame.v2";
  var SAVE_VERSION = 2;

  // ---- 預設 config（§6，所有可調數字） ------------------------------------
  function defaultConfig() {
    return {
      // ---- 牌庫組成 ----
      DECK_MIN: 7,
      DECK_MAX: 14,
      // ---- 手牌 / 出牌 ----
      HAND_SIZE: 5,
      PLAY_SIZE: 3,
      // ---- 共享流量（整數百分比） ----
      TRAFFIC_PER_ROUND: 10,
      TRAFFIC_MAX: 100,
      // ---- 金錢 ----
      MONEY_PER_ROUND: 1,
      // ---- HP ----
      PLAYER_HP_FLOOR: 300,            // 玩家起始 hp = max(followers, this)
      OPP_HP_FOLLOWER_RATIO: 4.0,      // 對手 hp = round(followers × this)。v2 攻擊=讚數(數百~千)，
                                       // 故對手血量需放大；4.0 讓同量級對戰為 2~4 回合可勝的拉鋸。
      // ---- 對手貼文讚數模型（v1 保留；攻擊量級用） ----
      OPP_LIKES_BASE: 60,
      OPP_LIKES_FRAC_MULT: 2.0,
      // ---- 效果量值係數（LEGACY，僅供參）：v2.1 起，add_shield/heal/atk_from_traffic/
      //   money_to_X 等量值改由「card-effects.js 內的 pct/perMoneyPct × 本卡 live 讚數」於引擎
      //   動態計算（amountOf/perMoneyOf），故此區數字引擎不再讀取。調整效果量值請改 gen_card_effects.py。 ----
      SHIELD_FRAC_M: 0.50,
      HEAL_FRAC_HPMAX: 0.06,
      F2A_RATIO: 0.0008, F2A_K: 1,
      LIFESTEAL_RATIO: 0.05,
      REFLECT_PCT: 50, REFLECT_ROUNDS: 1,
      TRAFFIC_ADD_PCT: 15, TRAFFIC_SUB_PCT: 15,
      ATK_PER_10TRAFFIC_FRAC_M: 0.10,
      T2M_RATIO: 1.0,
      GEN_MONEY_BASE: 2,
      M2T_RATIO: 1, M2T_SIGN: 1,
      M2F_FRAC_OPPHP: 0.01,
      M2S_FRAC_M: 0.50,
      M2A_FRAC_M: 0.15,
      PARITY_C_ODD_FRAC: 0.30, PARITY_C_EVEN_FRAC_M: 0.40,
      PARITY_CAFE_ODD_FRAC: 0.25, PARITY_CAFE_EVEN_FRAC_M: 0.30,
      COMBO_BUFF_FRAC: 0.25,
      BASE_BUFF_FRAC: 0.20,
      BASE_CHOOSE_BUFF_FRAC: 0.50,
      BASE_STRIKE_FRAC_M: 0.50,
      DRAW_BASE: 1, SCRY_LOOK: 3, SCRY_PICK: 1,
      // ---- 獎勵（沿用 v1） ----
      STEAL_FOLLOWER_PCT: 0.10,
      STEAL_FOLLOWER_MIN: 50,
      STEAL_TAG_OFFER: 3,
      ITEM_REWARD_ENABLED: false
    };
  }

  // ---- onChange 廣播（鏡像 SF.State） -------------------------------------
  var _listeners = [];
  function emit() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) { console.error("[SF.CardGame] onChange listener error", e); }
    }
  }

  // ---- 持久化 runtime 狀態 -------------------------------------------------
  // _opp: { OPPID: { followers:int, defeated:bool } }（runtime overrides）
  // _deck: [ postId... ]（玩家牌庫，純 id）
  var _deck = [];
  var _opp = {};
  var _uidSeq = 0; // CardInstance uid 序號（per session，不持久化；非確定性需求）

  // ---- 資料存取輔助 --------------------------------------------------------
  function rosterData() {
    var r = global.PIA_OPPONENTS;
    return (r && r.length) ? r : [];
  }

  function effectsData() {
    return global.PIA_CARD_EFFECTS || {};
  }

  function round(n) { return Math.round(Number(n) || 0); }
  function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); if (v < lo) v = lo; if (v > hi) v = hi; return v; }

  // 從 data + 持久化 override 重建一個 runtime opponent view（read-only）。
  function buildOppView(data) {
    var ov = _opp[data.id] || {};
    var followers = (ov && typeof ov.followers === "number") ? ov.followers : data.followers;
    var defeated = !!(ov && ov.defeated);
    var ratio = (CardGame.config && CardGame.config.OPP_HP_FOLLOWER_RATIO) || 0.10;
    return {
      id: data.id,
      name: data.name,
      handle: data.handle,
      avatar: data.avatar,
      theme: data.theme,
      hp: round(followers * ratio),
      posts: data.posts,
      baseFollowers: data.followers,
      followers: followers,
      defeated: defeated,
      rank: 0
    };
  }

  // 對手單張卡的讚數：依「當前粉絲 + 基數」動態計算（與 v1 一致）。
  function oppCardLikes(followers, post) {
    var cfg = CardGame.config;
    var base = (cfg && typeof cfg.OPP_LIKES_BASE === "number") ? cfg.OPP_LIKES_BASE : 0;
    var mult = (cfg && typeof cfg.OPP_LIKES_FRAC_MULT === "number") ? cfg.OPP_LIKES_FRAC_MULT : 1;
    var frac = (post && typeof post.frac === "number") ? post.frac : 0.06;
    return round(base + (followers || 0) * frac * mult);
  }

  // ---- 種子 / 確定性輔助 ---------------------------------------------------
  function rand01(seedStr, salt) {
    return SF.Algorithm.hash01(SF.Algorithm.seed(seedStr, salt));
  }

  // ---- 玩家牌組（讚數 live 由 SF.Algorithm.compute 計算） ------------------
  function playablePosts() {
    var out = [];
    var feed = (SF.State && SF.State.feed) ? SF.State.feed : [];
    var account = SF.State ? SF.State.account : null;
    var now = SF.State ? SF.State.nowTicks() : 0;
    var seen = Object.create(null);
    for (var i = 0; i < feed.length; i++) {
      var entry = feed[i];
      if (!entry || entry.source !== "player") continue;
      var post = (SF.Data && SF.Data.postById) ? SF.Data.postById(entry.postId) : null;
      if (!post) continue;
      if (seen[post.id]) continue;
      seen[post.id] = true;
      var r = SF.Algorithm.compute(entry, account, now);
      var likes = (r && typeof r.likes === "number") ? r.likes : 0;
      out.push({ entry: entry, post: post, likes: likes });
    }
    return out;
  }

  function canPlay() {
    return playablePosts().length >= CardGame.config.DECK_MIN;
  }

  function playerPostIdSet() {
    var set = Object.create(null);
    var pp = playablePosts();
    for (var i = 0; i < pp.length; i++) set[pp[i].post.id] = true;
    return set;
  }

  function getDeck() {
    return _deck.slice();
  }

  function deckValid(postIds) {
    if (!Array.isArray(postIds)) return false;
    var cfg = CardGame.config;
    if (postIds.length < cfg.DECK_MIN || postIds.length > cfg.DECK_MAX) return false;
    var valid = playerPostIdSet();
    var seen = Object.create(null);
    for (var i = 0; i < postIds.length; i++) {
      var id = postIds[i];
      if (typeof id !== "string") return false;
      if (!valid[id]) return false;
      if (seen[id]) return false;
      seen[id] = true;
    }
    return true;
  }

  function setDeck(postIds) {
    if (!deckValid(postIds)) return false;
    _deck = postIds.slice();
    save();
    return true;
  }

  // ---- 排行榜 / 對手（read） ----------------------------------------------
  function opponents() {
    var roster = rosterData();
    var out = [];
    for (var i = 0; i < roster.length; i++) out.push(buildOppView(roster[i]));
    return out;
  }

  function opponentById(id) {
    var roster = rosterData();
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].id === id) return buildOppView(roster[i]);
    }
    return null;
  }

  function leaderboard() {
    var rows = opponents();
    var handle = (SF.State && SF.State.account) ? SF.State.account.handle : "@player";
    var followers = (SF.State && typeof SF.State.followers === "function") ? SF.State.followers() : 0;
    rows.push({
      id: "__player",
      handle: handle,
      name: "你",
      followers: followers,
      isPlayer: true
    });
    rows.sort(function (a, b) { return (b.followers || 0) - (a.followers || 0); });
    for (var i = 0; i < rows.length; i++) rows[i].rank = i + 1;
    return rows;
  }

  /* =========================================================================
   * 戰鬥引擎（v2，FROZEN SPEC §1–§5）
   * ========================================================================= */

  // 深拷貝一個 effect 物件（含巢狀 odd/even/effect/options），避免共用 PIA_CARD_EFFECTS 字面值。
  function cloneEffect(e) {
    if (e == null || typeof e !== "object") return e;
    var out = {};
    for (var k in e) {
      if (!Object.prototype.hasOwnProperty.call(e, k)) continue;
      var v = e[k];
      if (Array.isArray(v)) {
        var arr = [];
        for (var i = 0; i < v.length; i++) arr.push(cloneEffect(v[i]));
        out[k] = arr;
      } else if (v && typeof v === "object") {
        out[k] = cloneEffect(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function cloneEffects(list) {
    var out = [];
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) out.push(cloneEffect(list[i]));
    return out;
  }

  // 由 postId 取得 effects / retain（player 與 opponent 共用 PIA_CARD_EFFECTS）。
  function effectsForPost(postId) {
    var rec = effectsData()[postId];
    if (!rec) return { effects: [], retain: false, category: [] };
    return {
      effects: cloneEffects(rec.effects),
      retain: !!rec.retain,
      category: Array.isArray(rec.category) ? rec.category.slice() : []
    };
  }

  // 建立一張玩家 CardInstance（從 deck postId + 凍結讚數）。
  function makePlayerCard(postId, name, baseLikes) {
    var rec = effectsForPost(postId);
    return {
      uid: "c" + (++_uidSeq),
      postId: postId,
      name: name,
      baseLikes: baseLikes,
      effects: rec.effects,
      temp: false,
      retain: !!rec.retain,
      _addBuff: 0,
      _mulBuff: 1,
      _isDefenseOnly: false
    };
  }

  // 內建臨時打擊卡（__BASE_STRIKE__）：atk = round(BASE_STRIKE_FRAC_M * M(母卡))，無效果，回合結束消失。
  function makeBaseStrikeCard(motherEffLikes) {
    var cfg = CardGame.config;
    var atk = Math.max(1, round((cfg.BASE_STRIKE_FRAC_M || 0.5) * (motherEffLikes || 0)));
    return {
      uid: "c" + (++_uidSeq),
      postId: "__BASE_STRIKE__",
      name: "臨時打擊",
      baseLikes: atk,
      effects: [],
      temp: true,
      retain: false,
      _addBuff: 0,
      _mulBuff: 1,
      _isDefenseOnly: false
    };
  }

  // 由 deck postId 建立凍結快照（讚數來自目前 playablePosts 的 live 值）。
  function snapshotDeckCards(deckIds) {
    var byId = Object.create(null);
    var pp = playablePosts();
    for (var i = 0; i < pp.length; i++) byId[pp[i].post.id] = pp[i];
    var cards = [];
    for (var j = 0; j < deckIds.length; j++) {
      var rec = byId[deckIds[j]];
      if (!rec) continue;
      var post = rec.post;
      var name = (post && (post.title || post.name || post.id)) || rec.post.id;
      cards.push(makePlayerCard(post.id, name, rec.likes));
    }
    return cards;
  }

  // 對手出牌牌組（每篇一個 CardInstance；effects 來自 PIA_CARD_EFFECTS，已於 generator 階段
  // 移除 draw/scry/temp_card/choose_one/retain 與 共通 base，引擎再防禦性過濾一次）。
  var OPP_SKIP_KINDS = { draw: 1, scry: 1, temp_card: 1, choose_one: 1, retain: 1 };
  function buildOpponentPosts(opp) {
    var posts = [];
    var list = (opp && opp.posts) ? opp.posts : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var rec = effectsForPost(p.id);
      var effs = [];
      for (var k = 0; k < rec.effects.length; k++) {
        if (OPP_SKIP_KINDS[rec.effects[k].kind]) continue;
        effs.push(rec.effects[k]);
      }
      posts.push({
        uid: "o" + (++_uidSeq),
        postId: p.id,
        name: p.name,
        tags: p.tags,
        baseLikes: oppCardLikes(opp.followers, p),
        effects: effs,
        temp: false,
        retain: false,
        _addBuff: 0,
        _mulBuff: 1,
        _isDefenseOnly: false
      });
    }
    return posts;
  }

  // 種子 Fisher–Yates 初洗（無亂數 API）；回傳打亂後的 deck index 陣列。
  function shuffledInitial(opponentId, nonce, deckLen) {
    var arr = [];
    for (var i = 0; i < deckLen; i++) arr.push(i);
    var seedStr = "cg:" + opponentId + ":shuffle:" + nonce;
    for (var k = arr.length - 1; k > 0; k--) {
      var j = Math.floor(rand01(seedStr, k) * (k + 1));
      if (j < 0) j = 0; if (j > k) j = k;
      var tmp = arr[k]; arr[k] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // 棄牌堆重洗回抽牌堆（§2.1，種子化、monotonic reshuffleCount）。
  function reshuffleDiscardIntoDrawPile(b, side) {
    var arr = [];
    for (var i = 0; i < side.discard.length; i++) arr.push(side.discard[i]); // deck index
    var seedStr = "cg:" + b.opponentId + ":reshuffle:" + b.nonce + ":" + side.reshuffleCount;
    for (var k = arr.length - 1; k > 0; k--) {
      var j = Math.floor(rand01(seedStr, k) * (k + 1));
      if (j < 0) j = 0; if (j > k) j = k;
      var tmp = arr[k]; arr[k] = arr[j]; arr[j] = tmp;
    }
    side.drawPile = arr;
    side.discard = [];
    side.reshuffleCount++;
  }

  // mintHandInstance：依 deck index 取出原卡，建立一個「新鮮」實例（_addBuff=0,_mulBuff=1，retain 依資料）。
  function mintHandInstance(card) {
    return {
      uid: "c" + (++_uidSeq),
      postId: card.postId,
      name: card.name,
      baseLikes: card.baseLikes,
      effects: cloneEffects(card.effects),
      temp: false,
      retain: !!card.retain,
      _addBuff: 0,
      _mulBuff: 1,
      _isDefenseOnly: false
    };
  }

  // §2.1 drawN：抽 n 張（空牌堆重洗）。回傳實際抽到數。
  function drawN(b, side, n) {
    var drawn = 0;
    while (drawn < n) {
      if (side.drawPile.length === 0) {
        if (side.discard.length === 0) break; // 真的空了
        reshuffleDiscardIntoDrawPile(b, side);
      }
      var idx = side.drawPile.shift();
      var card = side.deck[idx];
      if (card) side.hand.push(mintHandInstance(card));
      drawn++;
    }
    return drawn;
  }

  // ---- effLikes / likeMult（§1） ------------------------------------------
  function likeMult(b) {
    return 1 + (b.traffic / 100);
  }

  function turnBuffsFor(b, side) {
    return (side === b.player) ? b.buffs.PLAYER : b.buffs.OPPONENT;
  }

  // computeEffLikes：effective likes（讀取當前 traffic + 卡片 buff + 該側回合 buff）。
  function computeEffLikes(b, side, card) {
    var tb = turnBuffsFor(b, side);
    var mul = (card._mulBuff || 1) * (tb.mulBuff || 1);
    var add = (card._addBuff || 0) + (tb.addBuff || 0);
    var v = Math.round((card.baseLikes || 0) * likeMult(b) * mul + add);
    return Math.max(0, v);
  }

  // ---- 傷害管線（§2.2） ---------------------------------------------------
  function applyToShieldThenHp(unit, dmg) {
    var toShield = 0, toHp = 0;
    if (unit.shield > 0 && dmg > 0) {
      toShield = Math.min(unit.shield, dmg);
      unit.shield -= toShield;
      dmg -= toShield;
    }
    if (dmg > 0) { toHp = dmg; unit.hp -= dmg; }
    return { toShield: toShield, toHp: toHp };
  }

  function otherSide(b, side) { return (side === b.player) ? b.opponent : b.player; }
  function sideName(b, side) { return (side === b.player) ? "PLAYER" : "OPPONENT"; }

  // dealDamage：reflect 讀「shield 前」金額；reflected 直接套用攻方 shield→hp（不再反彈）。
  function dealDamage(b, attacker, defender, amount) {
    amount = Math.max(0, round(amount));
    var reflected = 0;
    var defBuffs = turnBuffsFor(b, defender);
    if (defBuffs.reflect && defBuffs.reflect.pct > 0 && amount > 0) {
      reflected = round(amount * defBuffs.reflect.pct / 100);
      if (reflected > 0) applyToShieldThenHp(attacker, reflected);
    }
    var res = applyToShieldThenHp(defender, amount);
    return { amount: amount, toShield: res.toShield, toHp: res.toHp, reflected: reflected };
  }

  /* =========================================================================
   * EFFECT EXECUTOR（§4；每個 kind 皆有 case）
   *
   * ctx = { b, side, card, isFirstPlay }
   * runEffect 可能 push battle.pending（choose_one / scry）：此時回傳 "PENDING"，
   *   resolveCard 迴圈中止，待 resolveChoice() 從 pending.resumeIdx 續跑。
   * ========================================================================= */
  function logEvt(b, msg) { b.log.push(msg); if (b.lastPlay) b.lastPlay.log.push(msg); }

  // 「% of 本卡讚數」量值：pct 存在則取 round(anchorLikes×pct)，否則沿用舊式固定 amount。
  function amountOf(ctx, eff, pctField, amtField) {
    if (eff[pctField] != null) return Math.max(0, round((ctx.anchorLikes || 0) * (Number(eff[pctField]) || 0)));
    return Math.max(0, round(eff[amtField]));
  }
  // 「每 1 元 = 讚數×perMoneyPct」單位量；否則沿用舊式固定 perMoney。
  function perMoneyOf(ctx, eff) {
    if (eff.perMoneyPct != null) return Math.max(0, round((ctx.anchorLikes || 0) * (Number(eff.perMoneyPct) || 0)));
    return Math.max(0, round(eff.perMoney));
  }

  function runEffect(eff, ctx) {
    var b = ctx.b, side = ctx.side, card = ctx.card;
    var cfg = CardGame.config;
    var tb = turnBuffsFor(b, side);

    switch (eff.kind) {

      case "add_shield":
        side.shield += amountOf(ctx, eff, "pct", "amount"); // % of 本卡讚數
        break;

      case "heal": {
        var h = amountOf(ctx, eff, "pct", "amount"); // % of 本卡讚數
        side.hp = Math.min(side.hpMax, side.hp + h); // clamped
        break;
      }

      case "shield_to_hp": {
        var conv = (eff.amount === "all") ? side.shield : Math.min(side.shield, Math.max(0, round(eff.amount)));
        if (conv < 0) conv = 0;
        side.shield -= conv;
        side.hp += conv; // 轉換：不封頂
        break;
      }

      case "followers_to_atk": {
        var ratio = Number(eff.ratio) || 0;
        var kf = (typeof eff.k === "number") ? eff.k : 1;
        var cost = round(side.hp * ratio);
        if (cost < 0) cost = 0;
        side.hp = Math.max(1, side.hp - cost); // floor 1
        card._addBuff += round(cost * kf);
        break;
      }

      case "atk_to_followers":
        // post-hit 轉換，於攻擊結算後處理（resolveCard 內讀 card._lifestealRatio）。
        card._lifestealRatio = (card._lifestealRatio || 0) + (Number(eff.ratio) || 0);
        break;

      case "reflect":
        tb.reflect = { pct: Number(eff.pct) || 0, rounds: Math.max(0, round(eff.rounds)) };
        break;

      case "traffic_add":
        b.traffic = Math.min(cfg.TRAFFIC_MAX, b.traffic + Math.max(0, round(eff.pct)));
        break;

      case "traffic_sub":
        b.traffic = Math.max(0, b.traffic - Math.max(0, round(eff.pct)));
        break;

      case "atk_from_traffic": {
        var kHi = (eff.pctPer10 != null) ? round((ctx.anchorLikes || 0) * (Number(eff.pctPer10) || 0)) : (round(eff.kPer10) || 0);
        card._addBuff += Math.floor(b.traffic / 10) * Math.max(0, kHi); // 每 10% 流量 +（讚數×pctPer10）
        break;
      }

      case "atk_from_low_traffic": {
        var kLo = (eff.pctPer10 != null) ? round((ctx.anchorLikes || 0) * (Number(eff.pctPer10) || 0)) : (round(eff.kPer10) || 0);
        card._addBuff += Math.floor((cfg.TRAFFIC_MAX - b.traffic) / 10) * Math.max(0, kLo);
        break;
      }

      case "traffic_to_money": {
        var gain = Math.floor(Math.floor(b.traffic / 10) * (Number(eff.ratio) || 0));
        if (gain < 0) gain = 0;
        side.money += gain; // 只讀流量，不消耗
        break;
      }

      case "gen_money":
        side.money += Math.max(0, round(eff.amount));
        break;

      case "money_to_traffic": {
        var spend = Math.floor(side.money);
        if (spend < 0) spend = 0;
        side.money -= spend;
        var sign = (Number(eff.sign) < 0) ? -1 : 1;
        b.traffic = clampInt(b.traffic + sign * round(spend * (Number(eff.ratio) || 0)), 0, cfg.TRAFFIC_MAX);
        break;
      }

      case "money_to_followers": {
        var sp1 = Math.floor(side.money); if (sp1 < 0) sp1 = 0;
        side.money -= sp1;
        side.hp += sp1 * perMoneyOf(ctx, eff); // 轉換：不封頂；每 1 元 = 讚數×perMoneyPct
        break;
      }

      case "money_to_shield": {
        var sp2 = Math.floor(side.money); if (sp2 < 0) sp2 = 0;
        side.money -= sp2;
        side.shield += sp2 * perMoneyOf(ctx, eff);
        break;
      }

      case "money_to_atk": {
        var sp3 = Math.floor(side.money); if (sp3 < 0) sp3 = 0;
        side.money -= sp3;
        card._addBuff += sp3 * perMoneyOf(ctx, eff);
        break;
      }

      case "parity": {
        // 基準 = 此為本回合第 N 張（playedThisTurn+1）。
        var nth = side.playedThisTurn + 1;
        var branch = (nth % 2 === 1) ? eff.odd : eff.even;
        if (branch) return runEffect(branch, ctx);
        break;
      }

      case "combo":
        if (!ctx.isFirstPlay && eff.effect) return runEffect(eff.effect, ctx);
        break;

      case "retain":
        card.retain = true;
        break;

      case "choose_one": {
        // pending：暫停 resolveCard 迴圈，待 resolveChoice(i) 續跑。
        b.pending = {
          kind: "choose_one",
          side: sideName(b, side),
          options: eff.options || [],
          descriptor: { label: eff.label || "二選一", options: eff.options || [] }
        };
        return "PENDING";
      }

      case "temp_card": {
        var motherM = computeEffLikes(b, side, card);
        var tc;
        if (eff.cardRef === "__BASE_STRIKE__") {
          tc = makeBaseStrikeCard(motherM);
        } else if (eff.cardRef && typeof eff.cardRef === "object") {
          tc = mintHandInstance(eff.cardRef); tc.temp = true;
        } else {
          tc = makeBaseStrikeCard(motherM);
        }
        side.hand.push(tc);
        break;
      }

      case "buff": {
        var atkFlat = round(eff.atkFlat) || 0;
        var atkFrac = Number(eff.atkFrac) || 0;
        var target = eff.target || "self";
        if (target === "self") {
          card._addBuff += atkFlat;
          card._mulBuff *= (1 + atkFrac);
        } else { // nextCard / allHand → 寫入該側回合 buff（後續卡片透過 computeEffLikes 讀取）
          tb.addBuff += atkFlat;
          tb.mulBuff *= (1 + atkFrac);
        }
        break;
      }

      case "draw":
        drawN(b, side, Math.max(0, round(eff.n)));
        break;

      case "scry": {
        var look = Math.max(0, round(eff.look));
        var pick = Math.max(0, round(eff.pick));
        // 牌庫為 0 才先重洗（棄牌堆有牌時）；剩 1~look-1 張則不重洗，直接看現有的。
        if (side.drawPile.length === 0 && side.discard.length > 0) {
          reshuffleDiscardIntoDrawPile(b, side);
        }
        // 窺視 drawPile 頂 look 張（不足則取全部），放進 descriptor.cards 供 UI 顯示。
        var lookN = Math.min(look, side.drawPile.length);
        var peek = [];
        for (var pk = 0; pk < lookN; pk++) {
          var dcard = side.deck[side.drawPile[pk]];
          if (dcard) peek.push({ pos: pk, postId: dcard.postId, name: dcard.name, baseLikes: dcard.baseLikes });
        }
        // pending：UI 從這 look 張中挑 pick 張入手（payload = 位置索引陣列）；其餘置底。
        b.pending = {
          kind: "scry",
          side: sideName(b, side),
          look: look,
          pick: pick,
          descriptor: { look: look, pick: pick, cards: peek, label: eff.label || ("窺視 " + look + " 張，選 " + pick) }
        };
        return "PENDING";
      }

      case "repeat": {
        var times = Math.max(0, round(eff.times));
        for (var t = 0; t < times; t++) {
          if (eff.effect) {
            var rr = runEffect(eff.effect, ctx);
            if (rr === "PENDING") return "PENDING"; // repeat 內含 pending（罕見）→ 由 resolve 續跑
          }
        }
        break;
      }

      default:
        // 未知 kind：忽略（防禦；shipped 資料不應出現）。
        break;
    }
    return "OK";
  }

  // resolveCard：依 §2.2 跑 effects（可中途 pending）→ 攻擊/防禦 → 傷害 → WINCHECK。
  // startIdx 用於 pending 續跑（跳過已完成的 effect）。
  function resolveCard(b, side, card, startIdx) {
    // anchorLikes = 本卡「讚數」（攻擊量）於出牌當下的值（含流量倍率與該側回合 buff，
    // 不含本卡自身效果後續的加成）；作為 add_shield/heal 等「% of 讚數」效果的基準。
    // 只算一次並存於 card，pending 續跑時沿用同一基準。
    if (card._anchorLikes == null) card._anchorLikes = computeEffLikes(b, side, card);
    var ctx = {
      b: b,
      side: side,
      card: card,
      anchorLikes: card._anchorLikes,
      isFirstPlay: (side.playedThisTurn === 0)
    };
    var i = startIdx || 0;
    for (; i < card.effects.length; i++) {
      var r = runEffect(card.effects[i], ctx);
      if (r === "PENDING") {
        b.pending.resumeIdx = i + 1; // 此 effect 已 push pending；續跑從下一個開始
        return "PENDING";
      }
    }
    finishCardAttack(b, side, card);
    return "DONE";
  }

  // finishCardAttack：effects 全跑完後的攻擊/防禦 + 傷害 + lifesteal + WINCHECK。
  function finishCardAttack(b, side, card) {
    var effLikes = computeEffLikes(b, side, card);
    var lp = {
      side: sideName(b, side), card: card, effLikes: effLikes,
      dealt: 0, toShield: 0, toHp: 0, reflected: 0, log: []
    };
    b.lastPlay = lp;

    if (card._isDefenseOnly) {
      side.shield += effLikes;
      lp.dealt = 0;
      logEvt(b, sideName(b, side) + " 防禦 +" + effLikes + " 鐵粉");
    } else {
      var def = otherSide(b, side);
      var dmg = dealDamage(b, side, def, effLikes);
      lp.dealt = dmg.amount;
      lp.toShield = dmg.toShield;
      lp.toHp = dmg.toHp;
      lp.reflected = dmg.reflected;
      logEvt(b, sideName(b, side) + " 攻擊 " + effLikes +
        "（破鐵粉 " + dmg.toShield + "，扣粉絲團 " + dmg.toHp + "）" +
        (dmg.reflected ? "；反傷 " + dmg.reflected : ""));
      // lifesteal（atk_to_followers）：依實際打入 hp 的量回粉（不封頂）。
      if (card._lifestealRatio) {
        var heal = round(dmg.toHp * card._lifestealRatio);
        if (heal > 0) { side.hp += heal; logEvt(b, sideName(b, side) + " 吸取粉絲團 +" + heal); }
      }
    }

    side.playedThisTurn++;
    checkWin(b); // 每次傷害事件後檢查（reflect 可能反殺攻方）
  }

  // §2.3 WINCHECK（同時致死 → 玩家勝）。
  function checkWin(b) {
    if (b.phase === "ENDED") return;
    var pAlive = b.player.hp > 0;
    var oAlive = b.opponent.hp > 0;
    if (pAlive && oAlive) return;
    var win;
    if (!pAlive && !oAlive) win = true;       // 同時致死 → 玩家勝
    else if (!oAlive) win = true;
    else win = false;                          // !pAlive
    b.result = { win: win, opponentId: b.opponentId, rewardApplied: false };
    b.phase = "ENDED";
  }

  // ---- 對手二選一/scry 自動解（§5 #5；理論上不應觸發） --------------------
  function autoResolveOpponentPending(b) {
    var p = b.pending;
    if (!p) return;
    if (p.kind === "choose_one") {
      var n = (p.options && p.options.length) ? p.options.length : 1;
      var i = Math.floor(rand01("cg:" + b.opponentId + ":choice", b.round) * n);
      if (i < 0) i = 0; if (i >= n) i = n - 1;
      var card = b._pendingCard;
      var resumeIdx = p.resumeIdx || 0;
      b.pending = null;
      var ctx = { b: b, side: b.opponent, card: card, isFirstPlay: (b.opponent.playedThisTurn === 0) };
      if (p.options && p.options[i]) runEffect(p.options[i], ctx);
      resolveCard(b, b.opponent, card, resumeIdx);
    } else {
      // scry：對手不應有；保險直接續跑（不撿牌）。
      var card2 = b._pendingCard;
      var resumeIdx2 = p.resumeIdx || 0;
      b.pending = null;
      resolveCard(b, b.opponent, card2, resumeIdx2);
    }
  }

  /* =========================================================================
   * 戰鬥控制 API（§3）
   * ========================================================================= */

  function startBattle(opponentId) {
    if (!canPlay()) return null;
    if (!deckValid(_deck)) return null;
    var opp = opponentById(opponentId);
    if (!opp || opp.defeated) return null;

    var cfg = CardGame.config;
    var deck = snapshotDeckCards(_deck);
    if (deck.length < cfg.DECK_MIN) return null;

    var nowTicks = SF.State ? SF.State.nowTicks() : 0;
    var oppSeed = SF.Algorithm.seed("cg:" + opponentId + ":nonce", 0) | 0;
    var nonce = (nowTicks ^ oppSeed) | 0;

    var playerHpMax = Math.max(SF.State ? SF.State.followers() : 0, cfg.PLAYER_HP_FLOOR);
    var oppHpMax = opp.hp;

    var battle = {
      opponentId: opponentId,
      nonce: nonce,
      round: 1,
      turn: "PLAYER",
      phase: "ROUND_START",
      result: null,

      traffic: 0,
      oppHpMax: oppHpMax,
      playerHpMax: playerHpMax,

      player: {
        hp: playerHpMax, hpMax: playerHpMax, shield: 0, money: 0,
        deck: deck,
        drawPile: shuffledInitial(opponentId, nonce, deck.length),
        hand: [],
        discard: [],
        playedThisTurn: 0,
        reshuffleCount: 0
      },
      opponent: {
        hp: oppHpMax, hpMax: oppHpMax, shield: 0, money: 0,
        posts: buildOpponentPosts(opp),
        nextPostIdx: 0,
        playedThisTurn: 0
      },

      buffs: {
        PLAYER: { addBuff: 0, mulBuff: 1, reflect: { pct: 0, rounds: 0 } },
        OPPONENT: { addBuff: 0, mulBuff: 1, reflect: { pct: 0, rounds: 0 } }
      },

      pending: null,
      lastPlay: null,
      log: [],
      _pendingCard: null
    };
    CardGame.battle = battle;
    return battle;
  }

  // ROUND_START → P_DRAW：流量 +10（首回合 +0，cap 100）、雙方金錢 +1、buff 重置、reflect 倒數、發牌。
  function beginRound() {
    var b = CardGame.battle;
    if (!b || b.phase !== "ROUND_START") return b;
    var cfg = CardGame.config;

    var add = (b.round === 1) ? 0 : cfg.TRAFFIC_PER_ROUND;
    b.traffic = Math.min(cfg.TRAFFIC_MAX, b.traffic + add);

    b.player.money += cfg.MONEY_PER_ROUND;
    b.opponent.money += cfg.MONEY_PER_ROUND;

    // 重置回合 buff（addBuff/mulBuff）；reflect 倒數，歸零則移除。
    tickReflect(b.buffs.PLAYER);
    tickReflect(b.buffs.OPPONENT);
    b.buffs.PLAYER.addBuff = 0; b.buffs.PLAYER.mulBuff = 1;
    b.buffs.OPPONENT.addBuff = 0; b.buffs.OPPONENT.mulBuff = 1;

    b.turn = "PLAYER";
    b.phase = "P_DRAW";

    // P_DRAW：補牌至 HAND_SIZE。
    drawN(b, b.player, cfg.HAND_SIZE - b.player.hand.length);
    b.player.playedThisTurn = 0;
    b.phase = "P_PLAY";
    return b;
  }

  function tickReflect(buffs) {
    if (buffs.reflect && buffs.reflect.rounds > 0) {
      buffs.reflect.rounds -= 1;
      if (buffs.reflect.rounds <= 0) buffs.reflect = { pct: 0, rounds: 0 };
    }
  }

  // P_PLAY：出一張手牌（≤ PLAY_SIZE）。effects → 攻擊。可能 push pending。
  function playCard(handIdx) {
    var b = CardGame.battle;
    if (!b || b.phase !== "P_PLAY") return b;
    if (b.pending) return b; // 有 pending 未解：禁止
    if (typeof handIdx !== "number" || handIdx < 0 || handIdx >= b.player.hand.length) return b;
    if (b.player.playedThisTurn >= CardGame.config.PLAY_SIZE) return b;

    var card = b.player.hand.splice(handIdx, 1)[0];
    b._pendingCard = card;
    b.phase = "P_RESOLVE_CARD";

    var r = resolveCard(b, b.player, card, 0);
    if (r === "PENDING") return b; // 等 resolveChoice
    finishPlayerCard(b, card);
    return b;
  }

  // 玩家卡 resolve 完成後：歸位（discard，除非 retain/temp）＋回到 P_PLAY 或維持（UI 決定是否 endPlayerTurn）。
  function finishPlayerCard(b, card) {
    if (b.phase === "ENDED") { b._pendingCard = null; return; }
    if (!card.retain && !card.temp) {
      var idx = findDeckIndex(b.player, card.postId);
      if (idx >= 0) b.player.discard.push(idx);
    }
    // retain → 放回手牌；temp → 消失（不入任何堆）。
    if (card.retain) b.player.hand.push(card);
    b._pendingCard = null;
    b.phase = "P_PLAY";
  }

  // 由 postId 找 deck index（discard/drawPile 存的是 deck 索引）。
  function findDeckIndex(side, postId) {
    for (var i = 0; i < side.deck.length; i++) {
      if (side.deck[i].postId === postId) return i;
    }
    return -1;
  }

  function hasPending() {
    var b = CardGame.battle;
    return !!(b && b.pending);
  }

  // resolveChoice：解 pending（choose_one: payload=index；scry: payload=已選 uid 陣列）並續跑。
  function resolveChoice(payload) {
    var b = CardGame.battle;
    if (!b || !b.pending) return b;
    var p = b.pending;
    var card = b._pendingCard;
    var resumeIdx = p.resumeIdx || 0;
    var side = (p.side === "PLAYER") ? b.player : b.opponent;

    if (p.kind === "choose_one") {
      var i = (typeof payload === "number") ? payload : 0;
      if (i < 0) i = 0;
      if (p.options && i >= p.options.length) i = p.options.length - 1;
      b.pending = null;
      if (p.options && p.options[i]) {
        var ctx = { b: b, side: side, card: card, isFirstPlay: (side.playedThisTurn === 0) };
        var rr = runEffect(p.options[i], ctx);
        if (rr === "PENDING") { b.pending.resumeIdx = resumeIdx; return b; } // 罕見巢狀
      }
    } else if (p.kind === "scry") {
      applyScry(b, side, p, payload);
      b.pending = null;
    } else {
      b.pending = null;
    }

    // 續跑該卡剩餘 effects → 攻擊。
    var res = resolveCard(b, side, card, resumeIdx);
    if (res === "PENDING") return b; // 同卡又 push 新 pending
    if (side === b.player) finishPlayerCard(b, card);
    else b._pendingCard = null; // 對手卡的歸位於 runOpponentTurn 處理
    return b;
  }

  // scry：從 drawPile 頂 look 張中挑選 picked uid（這裡 uid 以 deck index 代表）入手，其餘置底。
  function applyScry(b, side, p, picked) {
    var look = Math.min(p.look, side.drawPile.length);
    var top = side.drawPile.slice(0, look);       // deck index 陣列
    var rest = side.drawPile.slice(look);
    var pickSet = Object.create(null);
    var pickList = Array.isArray(picked) ? picked : [];
    var taken = [];
    var keepBottom = [];
    // payload 為 top 中的「位置索引」陣列（UI 以位置選取）；上限 pick。
    var limit = Math.min(p.pick, pickList.length);
    for (var q = 0; q < pickList.length && taken.length < limit; q++) {
      var pos = pickList[q];
      if (typeof pos === "number" && pos >= 0 && pos < top.length && !pickSet[pos]) {
        pickSet[pos] = true;
        taken.push(top[pos]);
      }
    }
    for (var r = 0; r < top.length; r++) if (!pickSet[r]) keepBottom.push(top[r]);
    // 撿選者入手。
    for (var t = 0; t < taken.length; t++) {
      var card = side.deck[taken[t]];
      if (card) side.hand.push(mintHandInstance(card));
    }
    // 其餘置底：rest 在前，未撿的 top 在後（置底）。
    side.drawPile = rest.concat(keepBottom);
  }

  // endPlayerTurn：P_END → O_PLAY。棄掉非 retain 的手牌、temp 消失、清玩家回合 buff（reflect 保留）。
  function endPlayerTurn() {
    var b = CardGame.battle;
    if (!b) return b;
    if (b.phase === "ENDED") return b;
    if (b.phase !== "P_PLAY") return b;
    if (b.pending) return b;

    var keep = [];
    for (var i = 0; i < b.player.hand.length; i++) {
      var c = b.player.hand[i];
      if (c.retain) { keep.push(c); continue; }
      if (c.temp) continue; // 消失
      var idx = findDeckIndex(b.player, c.postId);
      if (idx >= 0) b.player.discard.push(idx);
    }
    b.player.hand = keep;

    b.buffs.PLAYER.addBuff = 0; b.buffs.PLAYER.mulBuff = 1; // reflect 保留
    b.turn = "OPPONENT";
    b.phase = "O_PLAY";
    return b;
  }

  // runOpponentTurn：O_PLAY → O_RESOLVE → O_END。出 1 張腳本貼文（round-robin），effect 先、攻擊後。
  function runOpponentTurn() {
    var b = CardGame.battle;
    if (!b || b.phase !== "O_PLAY") return b;
    var opp = b.opponent;
    if (!opp.posts || opp.posts.length === 0) {
      b.phase = "WINCHECK";
      return advance();
    }

    var idx = (b.round - 1) % opp.posts.length;
    opp.nextPostIdx = idx;
    var src = opp.posts[idx];
    // 每回合新鮮實例（_addBuff/_mulBuff 歸零）。
    var card = {
      uid: "o" + (++_uidSeq),
      postId: src.postId,
      name: src.name,
      baseLikes: src.baseLikes,
      effects: cloneEffects(src.effects),
      temp: false, retain: false,
      _addBuff: 0, _mulBuff: 1, _isDefenseOnly: false
    };
    opp.playedThisTurn = 0;
    b._pendingCard = card;
    b.phase = "O_RESOLVE";

    var r = resolveCard(b, opp, card, 0);
    while (r === "PENDING") {        // 對手 pending 自動解（§5 #5）
      autoResolveOpponentPending(b);
      r = (b.pending) ? "PENDING" : "DONE";
    }
    b._pendingCard = null;

    if (b.phase === "ENDED") return b;

    // O_END：清對手回合 buff（reflect 保留）。
    b.buffs.OPPONENT.addBuff = 0; b.buffs.OPPONENT.mulBuff = 1;
    b.phase = "WINCHECK";
    return advance();
  }

  // advance：WINCHECK → 下一個 ROUND_START 或 ENDED。
  function advance() {
    var b = CardGame.battle;
    if (!b) return b;
    checkWin(b);
    if (b.phase === "ENDED") return b;
    // 未分勝負 → 進下一回合。turn 先歸 PLAYER，避免 UI 的對手分支在 ROUND_START 誤判而卡死。
    b.round += 1;
    b.turn = "PLAYER";
    b.phase = "ROUND_START";
    return b;
  }

  function endBattle() {
    CardGame.battle = null;
  }

  /* =========================================================================
   * 獎勵（§5；引擎不自動套用）
   * ========================================================================= */
  function canApplyReward(opponentId) {
    var b = CardGame.battle;
    return !!(b && b.result && b.result.win === true &&
              b.result.opponentId === opponentId && !b.result.rewardApplied);
  }

  function rewardTagOffer(opponentId) {
    var opp = opponentById(opponentId);
    var cfg = CardGame.config;
    if (!opp || !opp.posts) return [];

    var poolSet = Object.create(null);
    var pool = [];
    for (var i = 0; i < opp.posts.length; i++) {
      var tags = opp.posts[i].tags || [];
      for (var j = 0; j < tags.length; j++) {
        var name = tags[j];
        if (poolSet[name]) continue;
        if (!SF.Data || !SF.Data.tagByName || !SF.Data.tagByName(name)) continue;
        if (SF.State && SF.State.isUnlocked && SF.State.isUnlocked(name)) continue;
        poolSet[name] = true;
        pool.push(name);
      }
    }
    if (pool.length <= cfg.STEAL_TAG_OFFER) return pool.slice();

    var picked = [];
    var pickedSet = Object.create(null);
    var k = 0;
    var guard = 0;
    var maxGuard = pool.length * 8 + 16;
    while (picked.length < cfg.STEAL_TAG_OFFER && guard < maxGuard) {
      var idx = Math.floor(rand01("cg:" + opponentId + ":reward", k) * pool.length);
      if (idx < 0) idx = 0; if (idx >= pool.length) idx = pool.length - 1;
      var name2 = pool[idx];
      if (!pickedSet[name2]) {
        pickedSet[name2] = true;
        picked.push(name2);
      }
      k++; guard++;
    }
    return picked;
  }

  function applyRewardStealTag(opponentId, tagName) {
    var b = CardGame.battle;
    var opp = opponentById(opponentId);
    if (!opp) return false;
    if (!canApplyReward(opponentId)) return false;
    var offer = rewardTagOffer(opponentId);
    if (offer.indexOf(tagName) === -1) return false;
    if (!SF.Data || !SF.Data.tagByName || !SF.Data.tagByName(tagName)) return false;

    SF.State.unlock(tagName);
    SF.State.save();

    markDefeated(opponentId);
    save();

    if (b && b.result) b.result.rewardApplied = true;
    emit();
    return true;
  }

  function applyRewardStealFollowers(opponentId) {
    var b = CardGame.battle;
    var opp = opponentById(opponentId);
    if (!opp) return 0;
    if (!canApplyReward(opponentId)) return 0;
    var cfg = CardGame.config;

    var amount = Math.max(cfg.STEAL_FOLLOWER_MIN, round(opp.followers * cfg.STEAL_FOLLOWER_PCT));
    amount = Math.min(amount, opp.followers);
    if (amount < 0) amount = 0;

    var cur = ensureOppOverride(opponentId);
    cur.followers = (typeof cur.followers === "number" ? cur.followers : opp.followers) - amount;
    if (cur.followers < 0) cur.followers = 0;
    cur.defeated = true;

    if (SF.State && SF.State.account) {
      SF.State.account.baseFollowers = (SF.State.account.baseFollowers || 0) + amount;
    }

    save();
    if (SF.State) { SF.State.recompute(); SF.State.save(); }

    if (b && b.result) b.result.rewardApplied = true;
    emit();
    return amount;
  }

  // ---- 對手 override 輔助 --------------------------------------------------
  function ensureOppOverride(opponentId) {
    var data = null;
    var roster = rosterData();
    for (var i = 0; i < roster.length; i++) if (roster[i].id === opponentId) data = roster[i];
    if (!_opp[opponentId]) {
      _opp[opponentId] = {
        followers: data ? data.followers : 0,
        defeated: false
      };
    } else if (typeof _opp[opponentId].followers !== "number") {
      _opp[opponentId].followers = data ? data.followers : 0;
    }
    return _opp[opponentId];
  }

  function markDefeated(opponentId) {
    var cur = ensureOppOverride(opponentId);
    cur.defeated = true;
  }

  // ---- 持久化（鏡像 SF.State） --------------------------------------------
  function seedOppRuntime() {
    _opp = {};
    var roster = rosterData();
    for (var i = 0; i < roster.length; i++) {
      _opp[roster[i].id] = { followers: roster[i].followers, defeated: false };
    }
  }

  function save() {
    try {
      if (!global.localStorage) return;
      var oppOut = {};
      var roster = rosterData();
      for (var i = 0; i < roster.length; i++) {
        var id = roster[i].id;
        var ov = _opp[id];
        if (!ov) continue;
        oppOut[id] = {
          followers: (typeof ov.followers === "number") ? ov.followers : roster[i].followers,
          defeated: !!ov.defeated
        };
      }
      var data = {
        v: SAVE_VERSION,
        deck: _deck.slice(),
        opponents: oppOut
      };
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("[SF.CardGame] save 失敗", e);
    }
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY); }
    catch (e) { raw = null; }

    seedOppRuntime();
    _deck = [];
    CardGame.battle = null;

    if (!raw) {
      save();
      return CardGame;
    }

    try {
      var data = JSON.parse(raw);

      if (Array.isArray(data.deck)) {
        var d = [];
        for (var i = 0; i < data.deck.length; i++) {
          if (typeof data.deck[i] === "string") d.push(data.deck[i]);
        }
        _deck = d;
      }

      if (data.opponents && typeof data.opponents === "object") {
        var roster = rosterData();
        for (var j = 0; j < roster.length; j++) {
          var id = roster[j].id;
          var ov = data.opponents[id];
          if (!ov) continue;
          if (typeof ov.followers === "number") _opp[id].followers = ov.followers;
          _opp[id].defeated = !!ov.defeated;
        }
      }
    } catch (e) {
      console.warn("[SF.CardGame] load 解析失敗，改用 seed", e);
      seedOppRuntime();
      _deck = [];
    }
    return CardGame;
  }

  function reset() {
    try { global.localStorage && global.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    seedOppRuntime();
    _deck = [];
    CardGame.battle = null;
    save();
    emit();
  }

  function onChange(cb) {
    if (typeof cb === "function" && _listeners.indexOf(cb) === -1) {
      _listeners.push(cb);
    }
    return function off() {
      var idx = _listeners.indexOf(cb);
      if (idx !== -1) _listeners.splice(idx, 1);
    };
  }

  // ---- 公開 API（凍結簽章，SPEC §3） --------------------------------------
  var CardGame = {
    config: defaultConfig(),
    defaultConfig: defaultConfig,

    // 進行中戰鬥（transient，永不持久化）
    battle: null,

    // 排行榜 / 對手
    opponents: opponents,
    opponentById: opponentById,
    leaderboard: leaderboard,

    // 玩家牌組
    playablePosts: playablePosts,
    canPlay: canPlay,
    getDeck: getDeck,
    setDeck: setDeck,
    deckValid: deckValid,

    // 戰鬥控制（v2）
    startBattle: startBattle,
    beginRound: beginRound,
    playCard: playCard,
    hasPending: hasPending,
    resolveChoice: resolveChoice,
    endPlayerTurn: endPlayerTurn,
    runOpponentTurn: runOpponentTurn,
    advance: advance,
    endBattle: endBattle,

    // 輔助（UI 計算 live 攻擊用；read-only）
    computeEffLikes: function (side, card) {
      var b = CardGame.battle;
      if (!b) return 0;
      var s = (side === "PLAYER" || side === b.player) ? b.player : b.opponent;
      return computeEffLikes(b, s, card);
    },
    // 別名（UI effLikesOf 以此名呼叫；與 computeEffLikes 同）。
    effLikes: function (side, card) {
      var b = CardGame.battle;
      if (!b) return 0;
      var s = (side === "PLAYER" || side === b.player) ? b.player : b.opponent;
      return computeEffLikes(b, s, card);
    },
    likeMult: function () { var b = CardGame.battle; return b ? likeMult(b) : 1; },

    // 獎勵
    rewardTagOffer: rewardTagOffer,
    applyRewardStealTag: applyRewardStealTag,
    applyRewardStealFollowers: applyRewardStealFollowers,

    // 持久化
    save: save,
    load: load,
    reset: reset,
    onChange: onChange
  };

  SF.CardGame = CardGame;
})(typeof window !== "undefined" ? window : this);
