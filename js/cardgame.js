/* =============================================================================
 * cardgame.js — SF.CardGame
 * 排行榜挑戰（Leaderboard Card Battle）純引擎 + 持久化狀態（FROZEN SPEC §3/§4/§5）。
 *
 * 架構：STATEFUL singleton（鏡像 SF.State）。持有一份持久化 root state
 *   （deck、opponent runtime overrides）＋ 至多一個 transient 的進行中 battle。
 *
 * 確定性（MANDATORY）：所有「隨機」（洗牌、對手出牌、奪詞條抽樣）皆由
 *   SF.Algorithm.hash01(SF.Algorithm.seed(seedStr, salt)) 推導。
 *   不使用 Math.random、不使用 Date.now。
 *
 * 無 DOM：本檔案不得引用 document / window UI。資料來源 window.PIA_OPPONENTS，
 *   依賴 SF.State（帳號/粉絲/詞條/feed/時鐘）、SF.Algorithm（讚數/種子）、SF.Data（驗證）。
 *
 * 凍結簽章（SPEC §3）。localStorage 鍵 "summerfeed.cardgame.v1"。
 * ============================================================================= */
(function (global) {
  "use strict";

  var SF = global.SF = global.SF || {};

  var STORAGE_KEY = "summerfeed.cardgame.v1";
  var SAVE_VERSION = 1;

  // ---- 預設 config（§3.1，每個可調數字） ----------------------------------
  function defaultConfig() {
    return {
      // ---- 牌庫組成 ----
      DECK_MIN: 7,
      DECK_MAX: 14,
      // ---- 手牌 / 出牌 ----
      HAND_SIZE: 5,
      PLAY_SIZE: 3,
      // ---- HP ----
      PLAYER_HP: 6000,            // 玩家固定血量（配合「滿額讚數差」傷害；可調）
      OPP_HP_FOLLOWER_RATIO: 0.10, // 對手血量 = 粉絲 × 此比例
      // ---- 傷害 ----
      DAMAGE_SCALE: 1.0,          // 傷害 = |雙方讚數差| × 此係數（1 = 完整讚數差）
      MIN_DAMAGE: 1,
      // ---- 對手貼文讚數（依其粉絲數 + 基數，依當前粉絲動態計算） ----
      // oppLikes = round(OPP_LIKES_BASE + followers × post.frac × OPP_LIKES_FRAC_MULT)
      OPP_LIKES_BASE: 60,         // 對手每張卡的基數讚數（與粉絲無關的底）
      OPP_LIKES_FRAC_MULT: 2.0,   // 各貼文 frac(0.04~0.09) 的放大倍率（拉到與玩家卡相當的量級）
      // ---- 獎勵 ----
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

  // ---- 資料存取輔助 --------------------------------------------------------
  function rosterData() {
    var r = global.PIA_OPPONENTS;
    return (r && r.length) ? r : [];
  }

  function round(n) { return Math.round(Number(n) || 0); }

  // 從 data + 持久化 override 重建一個 runtime opponent view（read-only）。
  function buildOppView(data) {
    var ov = _opp[data.id] || {};
    var followers = (ov && typeof ov.followers === "number") ? ov.followers : data.followers;
    var defeated = !!(ov && ov.defeated);
    // HP 依「當前粉絲」動態計算（奪取粉絲後血量同步下降），不沿用 data.hp 烤死值。
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

  // 對手單張卡的讚數：依「當前粉絲 + 基數」動態計算（§ 對手讚數規則）。
  //   likes = round(OPP_LIKES_BASE + followers × post.frac × OPP_LIKES_FRAC_MULT)
  function oppCardLikes(followers, post) {
    var cfg = CardGame.config;
    var base = (cfg && typeof cfg.OPP_LIKES_BASE === "number") ? cfg.OPP_LIKES_BASE : 0;
    var mult = (cfg && typeof cfg.OPP_LIKES_FRAC_MULT === "number") ? cfg.OPP_LIKES_FRAC_MULT : 1;
    var frac = (post && typeof post.frac === "number") ? post.frac : 0.06;
    return round(base + (followers || 0) * frac * mult);
  }

  // ---- 種子 / 確定性輔助 ---------------------------------------------------
  // 以 SF.Algorithm.hash01(seed(seedStr, salt)) 取 [0,1)。
  function rand01(seedStr, salt) {
    return SF.Algorithm.hash01(SF.Algorithm.seed(seedStr, salt));
  }

  // ---- 玩家牌組（讚數 live 由 SF.Algorithm.compute 計算） ------------------
  function playablePosts() {
    var out = [];
    var feed = (SF.State && SF.State.feed) ? SF.State.feed : [];
    var account = SF.State ? SF.State.account : null;
    var now = SF.State ? SF.State.nowTicks() : 0;
    var seen = Object.create(null); // 以 post.id 去重（feed 理論上每篇唯一，防禦性）
    for (var i = 0; i < feed.length; i++) {
      var entry = feed[i];
      if (!entry || entry.source !== "player") continue;
      var post = (SF.Data && SF.Data.postById) ? SF.Data.postById(entry.postId) : null;
      if (!post) continue;
      if (seen[post.id]) continue;    // 同一 postId 只取一次（避免牌組重複卡）
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

  // 目前玩家 feed 中（source==player）的合法 postId 集合。
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
      if (!valid[id]) return false;     // 必須是目前玩家貼文
      if (seen[id]) return false;        // 不可重複
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
    // 加入合成的玩家列。
    var handle = (SF.State && SF.State.account) ? SF.State.account.handle : "@player";
    var followers = (SF.State && typeof SF.State.followers === "function") ? SF.State.followers() : 0;
    rows.push({
      id: "__player",
      handle: handle,
      name: "你",
      followers: followers,
      isPlayer: true
    });
    // 依目前 followers DESC 排序，標註 rank。
    rows.sort(function (a, b) { return (b.followers || 0) - (a.followers || 0); });
    for (var i = 0; i < rows.length; i++) rows[i].rank = i + 1;
    return rows;
  }

  // ---- 戰鬥引擎 ------------------------------------------------------------
  // 將某 deck postId 轉成 battle 卡片快照 { postId, name, likes }（讚數凍結）。
  function snapshotDeck(deckIds) {
    // 以目前 playablePosts 的 live 讚數建立映射。
    var byId = Object.create(null);
    var pp = playablePosts();
    for (var i = 0; i < pp.length; i++) byId[pp[i].post.id] = pp[i];
    var cards = [];
    for (var j = 0; j < deckIds.length; j++) {
      var rec = byId[deckIds[j]];
      if (!rec) continue; // 不在目前 feed 的略過（deckValid 已先擋，但保險）
      var post = rec.post;
      var name = (post && (post.title || post.name || post.id)) || rec.post.id;
      cards.push({ postId: post.id, name: name, likes: rec.likes });
    }
    return cards;
  }

  // 種子 Fisher–Yates 洗牌（NO Math.random）；回傳打亂後的 deck index 陣列。
  function shuffledDrawPile(opponentId, nonce, deckLen) {
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

  function startBattle(opponentId) {
    if (!canPlay()) return null;
    if (!deckValid(_deck)) return null;
    var opp = opponentById(opponentId);
    if (!opp || opp.defeated) return null;

    var cfg = CardGame.config;
    var deck = snapshotDeck(_deck);
    if (deck.length < cfg.DECK_MIN) return null;

    // nonce：確定性（時鐘 ^ 由 opponentId 衍生的種子）。
    var nowTicks = SF.State ? SF.State.nowTicks() : 0;
    var oppSeed = SF.Algorithm.seed("cg:" + opponentId + ":nonce", 0) | 0;
    var nonce = (nowTicks ^ oppSeed) | 0;

    var oppHpMax = opp.hp;

    var battle = {
      phase: "DRAW",
      round: 1,
      nonce: nonce,
      opponentId: opponentId,
      playerHp: cfg.PLAYER_HP, playerHpMax: cfg.PLAYER_HP,
      oppHp: oppHpMax, oppHpMax: oppHpMax,
      deck: deck,
      drawPile: shuffledDrawPile(opponentId, nonce, deck.length),
      hand: [],
      picked: [],
      playerCards: null,
      oppCard: null,
      playerSum: 0, oppLikes: 0, delta: 0,
      lastDamage: 0,
      log: [],
      result: null
    };
    CardGame.battle = battle;
    return battle;
  }

  // 取得本回合對手出牌（round-robin）。
  function oppCardForRound(opponentId, roundNo) {
    var opp = opponentById(opponentId);
    if (!opp || !opp.posts || !opp.posts.length) return null;
    var idx = (roundNo - 1) % opp.posts.length;
    var p = opp.posts[idx];
    return { postId: p.id, name: p.name, likes: oppCardLikes(opp.followers, p), tags: p.tags };
  }

  // DRAW：發牌至 HAND_SIZE、揭示對手卡、phase -> PLAY。
  function drawPhase() {
    var b = CardGame.battle;
    if (!b || b.phase !== "DRAW") return b;
    var cfg = CardGame.config;
    b.hand = [];
    b.picked = [];
    while (b.hand.length < cfg.HAND_SIZE && b.drawPile.length > 0) {
      var idx = b.drawPile.shift();
      var card = b.deck[idx];
      if (card) b.hand.push({ postId: card.postId, name: card.name, likes: card.likes });
    }
    b.oppCard = oppCardForRound(b.opponentId, b.round);
    b.playerCards = null;
    b.playerSum = 0; b.oppLikes = 0; b.delta = 0; b.lastDamage = 0;
    b.phase = "PLAY";
    return b;
  }

  // PLAY：toggle handIdx（上限 PLAY_SIZE）。
  function pickCard(handIdx) {
    var b = CardGame.battle;
    if (!b || b.phase !== "PLAY") return b;
    if (typeof handIdx !== "number" || handIdx < 0 || handIdx >= b.hand.length) return b;
    var pos = b.picked.indexOf(handIdx);
    if (pos !== -1) {
      b.picked.splice(pos, 1);
    } else {
      if (b.picked.length >= CardGame.config.PLAY_SIZE) return b; // 已達上限
      b.picked.push(handIdx);
    }
    return b;
  }

  // EFFECT_1 / EFFECT_2：NO-OP 佔位（未來卡片效果掛鉤）。
  function runEffects(phase, ctx) {
    // 目前無作用；保留簽章供未來擴充。
    return;
  }

  // playPicked：picked.length === PLAY_SIZE → EFFECT_1 → COMPARE → EFFECT_2 → RESOLVE → 檢查勝負。
  function playPicked() {
    var b = CardGame.battle;
    if (!b || b.phase !== "PLAY") return b;
    var cfg = CardGame.config;
    if (b.picked.length !== cfg.PLAY_SIZE) return b;

    // 取出已選卡片（依 picked 順序）。
    var played = [];
    for (var i = 0; i < b.picked.length; i++) {
      var c = b.hand[b.picked[i]];
      if (c) played.push({ postId: c.postId, name: c.name, likes: c.likes });
    }
    b.playerCards = played;

    // EFFECT_1（no-op）
    b.phase = "EFFECT_1";
    runEffects("EFFECT_1", b);

    // COMPARE
    b.phase = "COMPARE";
    var sum = 0;
    for (var k = 0; k < played.length; k++) sum += (played[k].likes || 0);
    b.playerSum = sum;
    b.oppLikes = b.oppCard ? (b.oppCard.likes || 0) : 0;
    b.delta = b.playerSum - b.oppLikes;

    // EFFECT_2（no-op）
    b.phase = "EFFECT_2";
    runEffects("EFFECT_2", b);

    // RESOLVE：套用傷害。
    b.phase = "RESOLVE";
    var delta = b.delta;
    var mag = Math.round(Math.abs(delta) * cfg.DAMAGE_SCALE);
    if (delta !== 0) mag = Math.max(mag, cfg.MIN_DAMAGE);
    var target;
    if (delta > 0) { b.oppHp -= mag; target = "opp"; }
    else if (delta < 0) { b.playerHp -= mag; target = "player"; }
    else { target = "none"; }
    b.lastDamage = (delta >= 0) ? mag : -mag;

    b.log.push({
      round: b.round,
      playerSum: b.playerSum,
      oppLikes: b.oppLikes,
      delta: b.delta,
      dmg: (target === "none") ? 0 : mag,
      target: target
    });

    // 勝負檢查（同時致死判玩家勝）。
    if (b.oppHp <= 0 && b.playerHp <= 0) {
      b.result = { win: true, opponentId: b.opponentId, rewardApplied: false };
      b.phase = "ENDED";
    } else if (b.oppHp <= 0) {
      b.result = { win: true, opponentId: b.opponentId, rewardApplied: false };
      b.phase = "ENDED";
    } else if (b.playerHp <= 0) {
      b.result = { win: false, opponentId: b.opponentId, rewardApplied: false };
      b.phase = "ENDED";
    } else {
      b.phase = "ROUND_END";
    }
    return b;
  }

  // nextRound：歸還桌面卡、種子重洗、round++、phase -> DRAW。
  function nextRound() {
    var b = CardGame.battle;
    if (!b || b.phase !== "ROUND_END") return b;
    b.round += 1;
    // 全部桌面卡（已出 + 未出）歸還牌庫 → 以整副 deck 重新洗（保證 drawPile 不枯竭）。
    b.drawPile = shuffledDrawPile(b.opponentId, b.nonce ^ b.round, b.deck.length);
    b.hand = [];
    b.picked = [];
    b.playerCards = null;
    b.oppCard = null;
    b.phase = "DRAW";
    return b;
  }

  // endBattle：強制放棄進行中的戰鬥（無獎勵）。
  function endBattle() {
    CardGame.battle = null;
  }

  // ---- 獎勵（§5；引擎不自動套用） -----------------------------------------
  // 引擎層防護：唯有「對該對手剛獲勝、且尚未領取」的戰鬥才能套用獎勵。
  // 避免在無勝利的情況下奪取粉絲/詞條，或重複領取（雙領）。
  function canApplyReward(opponentId) {
    var b = CardGame.battle;
    return !!(b && b.result && b.result.win === true &&
              b.result.opponentId === opponentId && !b.result.rewardApplied);
  }

  // 奪取詞條：回傳最多 STEAL_TAG_OFFER 個 tag NAME（種子化、去重、過濾已解鎖/無效）。
  function rewardTagOffer(opponentId) {
    var opp = opponentById(opponentId);
    var cfg = CardGame.config;
    if (!opp || !opp.posts) return [];

    // 池：對手 posts[].tags 的唯一名稱，能由 SF.Data.tagByName 解析、且尚未解鎖。
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

    // 種子抽樣：seed = SF.Algorithm.seed("cg:"+opponentId+":reward", k)，去重。
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
    if (!canApplyReward(opponentId)) return false; // 未獲勝 / 已領取 → 拒絕
    // 驗證 tagName 在當前 offer 且為合法 tag。
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
    if (!canApplyReward(opponentId)) return 0; // 未獲勝 / 已領取 → 拒絕
    var cfg = CardGame.config;

    var amount = Math.max(cfg.STEAL_FOLLOWER_MIN, round(opp.followers * cfg.STEAL_FOLLOWER_PCT));
    amount = Math.min(amount, opp.followers); // 不可奪取超過對手所有
    if (amount < 0) amount = 0;

    // 對手 runtime followers 扣除（持久化）。
    var cur = ensureOppOverride(opponentId);
    cur.followers = (typeof cur.followers === "number" ? cur.followers : opp.followers) - amount;
    if (cur.followers < 0) cur.followers = 0;
    cur.defeated = true;

    // 玩家粉絲：寫 baseFollowers（永久 base，切勿寫 followerDelta）。
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

    // 先以資料 seed runtime（followers=data.followers、defeated=false）。
    seedOppRuntime();
    _deck = [];
    CardGame.battle = null; // 進行中戰鬥為 transient，reload 即放棄。

    if (!raw) {
      // 首次：seed 後存一次。
      save();
      return CardGame;
    }

    try {
      var data = JSON.parse(raw);

      // deck：只取目前資料中存在的 postId（前向相容；UI 仍應以 deckValid 再驗）。
      if (Array.isArray(data.deck)) {
        var d = [];
        for (var i = 0; i < data.deck.length; i++) {
          if (typeof data.deck[i] === "string") d.push(data.deck[i]);
        }
        _deck = d;
      }

      // opponents override：覆蓋至已 seed 的 runtime；資料中不存在的 id 丟棄。
      if (data.opponents && typeof data.opponents === "object") {
        var roster = rosterData();
        for (var j = 0; j < roster.length; j++) {
          var id = roster[j].id;
          var ov = data.opponents[id];
          if (!ov) continue; // 缺漏 → 沿用 seed（data.followers / 未敗）
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

    // 戰鬥控制
    startBattle: startBattle,
    drawPhase: drawPhase,
    pickCard: pickCard,
    playPicked: playPicked,
    nextRound: nextRound,
    endBattle: endBattle,
    runEffects: runEffects,

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
