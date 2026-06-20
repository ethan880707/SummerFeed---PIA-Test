/* =============================================================================
 * cardgame-ui.js — SF.CardGameUI
 * 排行榜挑戰（Leaderboard Card Battle）DOM 控制器（FROZEN SPEC §6）。
 *
 * 渲染 HOME / DECK / BATTLE / SETTLEMENT 四個子畫面至 #panel-cardgame，
 * 驅動純引擎 SF.CardGame。原生 DOM、無框架、file:// 安全。
 *
 * 子畫面狀態機（私有 _view）：
 *   HOME ──[組成牌庫]──▶ DECK ──[確認 7~14]──▶ HOME
 *   HOME ──[挑戰 #n]───▶ BATTLE ──[一方 HP<=0]──▶ SETTLEMENT ──▶ HOME / BATTLE
 *   BATTLE 內以單一主要動作按鈕推進 §4 phase machine，不切 _view。
 *
 * 訂閱 SF.State.onChange 與 SF.CardGame.onChange，僅於 cardgame 分頁為 active 時重繪
 *   （避免每 tick 重建隱藏面板）。重繪一律「清空 .cg-stage → 重建」，並保留 _view，
 *   使 onChange 不會把玩家踢回 HOME。
 * ============================================================================= */
(function (global) {
  "use strict";

  var SF = global.SF = global.SF || {};
  var document = global.document;

  // ---- 小工具 --------------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function abbr(n) { return SF.Algorithm.abbreviate(n); }

  function toast(msg, kind) {
    var wrap = document.getElementById("toastWrap");
    if (!wrap) return;
    var t = el("div", "toast" + (kind ? " is-" + kind : ""), msg);
    wrap.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2900);
  }

  // ---- 私有狀態 ------------------------------------------------------------
  var _root = null;     // #panel-cardgame
  var _stage = null;    // .cg-stage 掛載點
  var _view = "HOME";   // "HOME" | "DECK" | "BATTLE" | "SETTLEMENT"
  var _draft = null;    // DECK 編輯中暫存（postId 陣列）；null = 尚未進編輯
  var _rewardTag = null; // SETTLEMENT 已選的詞條名稱
  var _scryPick = [];   // BATTLE scry 待決：已選卡 uid 陣列

  // ---- HP bar 元件（§6.3） -------------------------------------------------
  function hpBar(side, now, max, small) {
    var pct = max > 0 ? (now / max) * 100 : 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    var low = pct < 25;
    var bar = el("div", "cg-hpbar" + (small ? " cg-hpbar--sm" : "") + (low ? " is-low" : ""));
    bar.setAttribute("data-side", side);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(max));
    bar.setAttribute("aria-valuenow", String(Math.max(0, now)));
    var fill = el("div", "cg-hpbar__fill");
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    if (!small) {
      bar.appendChild(el("span", "cg-hpbar__txt", Math.max(0, now) + " / " + max));
    }
    return bar;
  }

  // ---- 卡片元件 ------------------------------------------------------------
  // card: { postId/name/likes }；opts: { tags?, selectable?, selected?, onClick?, large?, disabled? }
  // 取某貼文的卡牌效果定義（window.PIA_CARD_EFFECTS，含 effects[] 與 retain）。
  function cardFxFor(postId) {
    var FX = global.PIA_CARD_EFFECTS || {};
    return FX[postId] || null;
  }

  function cardEl(card, opts) {
    opts = opts || {};
    var cls = "cg-card";
    if (opts.large) cls += " cg-card--lg";
    if (opts.selectable) cls += " is-selectable";
    if (opts.playable) cls += " is-playable";
    if (opts.selected) cls += " is-selected";
    if (opts.disabled) cls += " is-disabled";
    var n = el("div", cls);
    n.appendChild(el("div", "cg-card__name", card.name || card.postId || "(無題)"));

    if (card.retain || opts.retain) {
      n.appendChild(el("span", "cg-card__flag cg-card__flag--retain", "保留"));
    }

    if (opts.tags && opts.tags.length) {
      var tw = el("div", "cg-card__tags");
      for (var i = 0; i < opts.tags.length; i++) {
        tw.appendChild(el("span", "cg-card__tag", opts.tags[i]));
      }
      n.appendChild(tw);
    }

    // 卡牌效果標籤（card-effects.js）：組牌/預覽時也看得到。
    var effs = opts.effects || (card && card.effects) || [];
    if (effs.length) {
      var ew = el("div", "cg-card__effects");
      for (var e = 0; e < effs.length; e++) {
        var lab = effs[e] && effs[e].label ? effs[e].label : effKindLabel(effs[e]);
        ew.appendChild(el("span", "cg-card__eff", lab));
      }
      n.appendChild(ew);
    }

    var foot = el("div", "cg-card__foot");
    foot.appendChild(el("span", "cg-card__likes", abbr(card.likes || 0)));
    n.appendChild(foot);

    if ((opts.selectable || opts.playable) && typeof opts.onClick === "function" && !opts.disabled) {
      n.onclick = opts.onClick;
    }
    return n;
  }

  // ===========================================================================
  // HOME — 牌庫摘要 + 排行榜
  // ===========================================================================
  function renderHome() {
    var cfg = SF.CardGame.config;
    var pp = SF.CardGame.playablePosts();
    var published = pp.length;
    var deck = SF.CardGame.getDeck();
    var deckReady = SF.CardGame.deckValid(deck);

    // 牌庫摘要列
    var bar = el("div", "cg-deckbar");
    var info = el("div", "cg-deckbar__info");
    info.appendChild(el("div", "cg-deckbar__title", "我的牌庫"));
    var hintTxt;
    if (deckReady) {
      hintTxt = "已組成 " + deck.length + " 張卡（發文 " + published + " 篇）";
    } else if (published >= cfg.DECK_MIN) {
      hintTxt = "尚未組成牌庫（需 " + cfg.DECK_MIN + "~" + cfg.DECK_MAX + " 張）";
    } else {
      hintTxt = "發文 " + published + " / " + cfg.DECK_MIN + " 篇（不足無法遊玩）";
    }
    info.appendChild(el("div", "cg-deckbar__hint", hintTxt));
    bar.appendChild(info);
    bar.appendChild(el("div", "cg-deckbar__spacer"));

    var buildBtn = el("button", "btn btn--primary", deckReady ? "重新組牌" : "組成牌庫");
    buildBtn.disabled = published < cfg.DECK_MIN;
    buildBtn.onclick = function () { _draft = deck.slice(); _view = "DECK"; render(); };
    bar.appendChild(buildBtn);
    _stage.appendChild(bar);

    // 排行榜
    _stage.appendChild(el("div", "section-label", "排行榜"));

    // 阻擋原因通知（只說一次）
    var notice = null;
    if (published < cfg.DECK_MIN) {
      notice = "發文不足 " + cfg.DECK_MIN + " 篇，無法挑戰（目前 " + published + " 篇）。";
    } else if (!deckReady) {
      notice = "請先「組成牌庫」後再挑戰。";
    }
    if (notice) {
      _stage.appendChild(el("div", "cg-board__notice", notice));
    }

    var board = el("div", "cg-board");
    var rows = SF.CardGame.leaderboard();
    for (var i = 0; i < rows.length; i++) {
      board.appendChild(rankRow(rows[i], deckReady));
    }
    _stage.appendChild(board);
  }

  function rankRow(row, deckReady) {
    var cls = "cg-rank";
    if (row.isPlayer) cls += " is-player";
    if (row.defeated) cls += " is-defeated";
    var n = el("div", cls);

    n.appendChild(el("div", "cg-rank__no", "#" + row.rank));

    var av = el("div", "cg-rank__avatar", row.isPlayer ? "你" : (row.avatar || "?"));
    n.appendChild(av);

    var id = el("div", "cg-rank__id");
    id.appendChild(el("div", "cg-rank__name", row.name || row.handle || "?"));
    id.appendChild(el("div", "cg-rank__handle", row.handle || ""));
    n.appendChild(id);

    var stat = el("div", "cg-rank__stat");
    var fol = el("div", "cg-rank__followers");
    fol.appendChild(document.createTextNode("粉絲 "));
    fol.appendChild(el("b", null, abbr(row.followers || 0)));
    stat.appendChild(fol);
    if (!row.isPlayer) {
      stat.appendChild(hpBar("opp", row.hp || 0, row.hp || 0, true));
    }
    n.appendChild(stat);

    if (!row.isPlayer) {
      var btn = el("button", "btn btn--sm cg-rank__btn");
      if (row.defeated) {
        btn.textContent = "已擊敗";
        btn.disabled = true;
      } else {
        btn.textContent = "挑戰";
        btn.className = "btn btn--primary btn--sm cg-rank__btn";
        btn.disabled = !deckReady;
        (function (oppId) {
          btn.onclick = function () { startBattle(oppId); };
        })(row.id);
      }
      n.appendChild(btn);
    }
    return n;
  }

  function startBattle(opponentId) {
    var b = SF.CardGame.startBattle(opponentId);
    if (!b) { toast("無法開始挑戰（牌庫不符或對手已擊敗）", "bad"); return; }
    // v2：startBattle 建立 ROUND_START 狀態，beginRound 推進至 P_DRAW（流量/金錢 tick + 發牌）。
    if (typeof SF.CardGame.beginRound === "function") SF.CardGame.beginRound();
    _rewardTag = null;
    _view = "BATTLE";
    render();
  }

  // ===========================================================================
  // DECK — 牌庫編輯
  // ===========================================================================
  function renderDeck() {
    var cfg = SF.CardGame.config;
    var pp = SF.CardGame.playablePosts();

    _stage.appendChild(el("div", "section-label", "組成牌庫"));

    if (pp.length < cfg.DECK_MIN) {
      var block = el("div", "cg-block");
      block.appendChild(el("div", "cg-block__title", "發文不足 " + cfg.DECK_MIN + " 篇，無法遊玩"));
      block.appendChild(el("div", "cg-block__prog", pp.length + " / " + cfg.DECK_MIN));
      block.appendChild(el("div", "cg-block__msg", "請先到「發文」分頁發布更多貼文，累積至少 " + cfg.DECK_MIN + " 篇。"));
      var back = el("button", "btn", "返回排行榜");
      back.onclick = function () { _draft = null; _view = "HOME"; render(); };
      block.appendChild(back);
      _stage.appendChild(block);
      return;
    }

    if (!Array.isArray(_draft)) _draft = SF.CardGame.getDeck().slice();
    // 過濾 draft 中已失效的 id（避免殘留）
    var validSet = Object.create(null);
    for (var v = 0; v < pp.length; v++) validSet[pp[v].post.id] = true;
    _draft = _draft.filter(function (id) { return validSet[id]; });

    var draftSet = Object.create(null);
    for (var d = 0; d < _draft.length; d++) draftSet[_draft[d]] = true;

    var deckWrap = el("div", "cg-deck");

    // live 摘要列
    var live = el("div", "cg-deck__live");
    var countCls = "cg-deck__count";
    var n = _draft.length;
    if (n < cfg.DECK_MIN || n > cfg.DECK_MAX) countCls += " is-bad";
    else countCls += " is-ok";
    var countEl = el("div", countCls, "已選 " + n + " / " + cfg.DECK_MAX);
    live.appendChild(countEl);

    var sum = 0;
    var likeById = Object.create(null);
    for (var s = 0; s < pp.length; s++) likeById[pp[s].post.id] = pp[s].likes;
    for (var t = 0; t < _draft.length; t++) sum += (likeById[_draft[t]] || 0);
    live.appendChild(el("div", "cg-deck__sum", "總讚 " + abbr(sum)));
    live.appendChild(el("div", "cg-deck__spacer"));
    deckWrap.appendChild(live);

    // 卡片網格
    var grid = el("div", "cg-cardgrid");
    for (var i = 0; i < pp.length; i++) {
      (function (rec) {
        var postId = rec.post.id;
        var selected = !!draftSet[postId];
        var atMax = _draft.length >= cfg.DECK_MAX;
        var fx = cardFxFor(postId);
        var card = cardEl(
          { postId: postId, name: cardName(rec.post), likes: rec.likes },
          {
            tags: postTags(rec.post),
            effects: fx ? fx.effects : [],
            retain: !!(fx && fx.retain),
            selectable: true,
            selected: selected,
            disabled: (!selected && atMax),
            onClick: function () { toggleDraft(postId); }
          }
        );
        grid.appendChild(card);
      })(pp[i]);
    }
    deckWrap.appendChild(grid);

    // footer
    var foot = el("div", "cg-deck__foot");
    var cancel = el("button", "btn", "取消");
    cancel.onclick = function () { _draft = null; _view = "HOME"; render(); };
    foot.appendChild(cancel);

    var confirm = el("button", "btn btn--primary", "確認牌庫");
    confirm.disabled = (n < cfg.DECK_MIN || n > cfg.DECK_MAX);
    confirm.onclick = function () {
      if (SF.CardGame.setDeck(_draft.slice())) {
        toast("牌庫已儲存（" + _draft.length + " 張）", "ok");
        _draft = null;
        _view = "HOME";
        render();
      } else {
        toast("牌庫不符規則，請重新確認", "bad");
      }
    };
    foot.appendChild(confirm);
    deckWrap.appendChild(foot);

    _stage.appendChild(deckWrap);
  }

  function toggleDraft(postId) {
    var cfg = SF.CardGame.config;
    if (!Array.isArray(_draft)) _draft = [];
    var idx = _draft.indexOf(postId);
    if (idx !== -1) {
      _draft.splice(idx, 1);
    } else {
      if (_draft.length >= cfg.DECK_MAX) { toast("已達上限 " + cfg.DECK_MAX + " 張", "warn"); return; }
      _draft.push(postId);
    }
    render();
  }

  // post 顯示名稱 / 標籤（防禦式取值，post 結構未必含 title）
  function cardName(post) {
    if (!post) return "(無題)";
    return post.title || post.name || post.id || "(無題)";
  }
  function postTags(post) {
    if (!post) return [];
    var t = post.tags || post.tagNames || null;
    if (!Array.isArray(t)) return [];
    var out = [];
    for (var i = 0; i < t.length && out.length < 3; i++) {
      var v = t[i];
      out.push(typeof v === "string" ? v : (v && (v.name || v.code)) || "");
    }
    return out.filter(function (x) { return !!x; });
  }

  // ===========================================================================
  // BATTLE（v2）— 流量條 / 雙方資源 / 手牌（效果標籤）/ 出牌 / 對手揭示 / 待決選擇
  //   完全依引擎 transient state（SF.CardGame.battle，SPEC §3）驅動，只讀不改。
  //   流程：startBattle → beginRound(P_DRAW) → playCard×≤3 / resolveChoice
  //         → endPlayerTurn(O_PLAY) → runOpponentTurn(O_END) → advance(下一 ROUND_START)
  // ===========================================================================

  // effLikes：手牌卡的「當前攻擊＝讚數」。優先用引擎提供的計算（流量/buff live），
  // 退而求其次估算 round(baseLikes * (1+traffic/100) * mulBuff + addBuff)。
  function effLikesOf(b, side, card) {
    if (SF.CardGame && typeof SF.CardGame.effLikes === "function") {
      try { return SF.CardGame.effLikes(side, card); } catch (e) { /* fall through */ }
    }
    var base = (card && typeof card.baseLikes === "number") ? card.baseLikes
             : (card && typeof card.likes === "number") ? card.likes : 0;
    var traffic = (b && typeof b.traffic === "number") ? b.traffic : 0;
    var addBuff = (card && typeof card._addBuff === "number") ? card._addBuff : 0;
    var mulBuff = (card && typeof card._mulBuff === "number") ? card._mulBuff : 1;
    var sb = b && b.buffs && b.buffs[side];
    if (sb) {
      addBuff += (typeof sb.addBuff === "number" ? sb.addBuff : 0);
      mulBuff *= (typeof sb.mulBuff === "number" ? sb.mulBuff : 1);
    }
    var v = Math.round(base * (1 + traffic / 100) * mulBuff + addBuff);
    return v < 0 ? 0 : v;
  }

  function likeMultOf(b) {
    var traffic = (b && typeof b.traffic === "number") ? b.traffic : 0;
    return 1 + traffic / 100;
  }

  // 是否處於玩家可出牌階段。
  function isPlayerPlayPhase(b) {
    return b.turn === "PLAYER" && (b.phase === "P_PLAY" || b.phase === "P_DRAW");
  }

  function renderBattle() {
    var b = SF.CardGame.battle;
    if (!b) { _view = "HOME"; renderHome(); return; }

    // 已結束 → 切結算
    if (b.phase === "ENDED" && b.result) {
      _view = "SETTLEMENT";
      renderSettlement();
      return;
    }

    var opp = SF.CardGame.opponentById(b.opponentId);
    var oppName = opp ? opp.name : "對手";
    var pending = (typeof SF.CardGame.hasPending === "function" && SF.CardGame.hasPending())
                ? b.pending : null;

    // ---- 流量條（共享） ----
    _stage.appendChild(trafficBar(b));

    // ---- 雙方資源面板 ----
    var sides = el("div", "cg-sides");
    sides.appendChild(sidePanel(b, "PLAYER", "你", null));
    sides.appendChild(el("div", "cg-sides__vs", "VS"));
    sides.appendChild(sidePanel(b, "OPPONENT", oppName, opp));
    _stage.appendChild(sides);

    // ---- 回合 / 階段指示 ----
    var meta = el("div", "cg-bmeta");
    meta.appendChild(el("span", "cg-bmeta__round", "第 " + b.round + " 回合"));
    meta.appendChild(el("span", "cg-bmeta__turn cg-bmeta__turn--" + (b.turn === "PLAYER" ? "p" : "o"),
      b.turn === "PLAYER" ? "我方回合" : "對手回合"));
    meta.appendChild(el("span", "cg-bmeta__phase", phaseLabel(b.phase)));
    _stage.appendChild(meta);

    // ---- 待決選擇（最優先，阻擋其餘互動） ----
    if (pending) {
      _stage.appendChild(pendingPanel(b, pending));
    }

    // ---- 對手揭示面板（O_* 階段） ----
    if (b.turn === "OPPONENT" || b.phase === "O_PLAY" || b.phase === "O_RESOLVE" || b.phase === "O_END") {
      _stage.appendChild(opponentRevealPanel(b, opp));
    }

    // ---- 手牌（我方回合） ----
    if (b.turn === "PLAYER") {
      _stage.appendChild(handSection(b, !!pending));
    }

    // ---- 動作列 ----
    if (!pending) _stage.appendChild(actionBar(b));

    // ---- 戰鬥記錄 ----
    _stage.appendChild(logSection(b));
  }

  // ---- 流量條 -------------------------------------------------------------
  function trafficBar(b) {
    var traffic = (typeof b.traffic === "number") ? b.traffic : 0;
    if (traffic < 0) traffic = 0; if (traffic > 100) traffic = 100;
    var lvl = traffic >= 67 ? "high" : (traffic >= 34 ? "med" : "low");
    var wrap = el("div", "cg-traffic cg-traffic--" + lvl);

    var head = el("div", "cg-traffic__head");
    head.appendChild(el("span", "cg-traffic__label", "流量"));
    head.appendChild(el("span", "cg-traffic__pct", traffic + "%"));
    var mult = likeMultOf(b);
    head.appendChild(el("span", "cg-traffic__mult", "讚數 ×" + mult.toFixed(2)));
    wrap.appendChild(head);

    var track = el("div", "cg-traffic__track");
    var fill = el("div", "cg-traffic__fill");
    fill.style.width = traffic + "%";
    track.appendChild(fill);
    wrap.appendChild(track);
    return wrap;
  }

  // ---- 單側資源面板（HP / 鐵粉 / 金錢） -----------------------------------
  function sidePanel(b, side, name, opp) {
    var u = (side === "PLAYER") ? b.player : b.opponent;
    u = u || {};
    var cls = "cg-side cg-side--" + (side === "PLAYER" ? "player" : "opp");
    var n = el("div", cls);

    var head = el("div", "cg-side__head");
    if (opp) {
      head.appendChild(el("div", "cg-side__avatar", opp.avatar || "?"));
    } else {
      head.appendChild(el("div", "cg-side__avatar cg-side__avatar--you", "你"));
    }
    var idBox = el("div", "cg-side__id");
    idBox.appendChild(el("div", "cg-side__name", name || "?"));
    if (opp) idBox.appendChild(el("div", "cg-side__handle", opp.handle || ""));
    head.appendChild(idBox);
    n.appendChild(head);

    var hpNow = (typeof u.hp === "number") ? u.hp : 0;
    var hpMax = (typeof u.hpMax === "number") ? u.hpMax : hpNow;
    var hpRow = el("div", "cg-side__hp");
    hpRow.appendChild(el("span", "cg-side__hplab", "粉絲團"));
    hpRow.appendChild(hpBar(side === "PLAYER" ? "player" : "opp", hpNow, hpMax, false));
    n.appendChild(hpRow);

    var pills = el("div", "cg-pills");
    pills.appendChild(resPill("shield", "鐵粉", (typeof u.shield === "number") ? u.shield : 0));
    pills.appendChild(resPill("money", "金錢", (typeof u.money === "number") ? u.money : 0));
    // 本回合累積讚數（攻擊）：回合結束才一次結算傷害。
    var atkPill = resPill("atk", "本回合讚數", (typeof u.turnAtk === "number") ? u.turnAtk : 0);
    if ((u.turnAtk || 0) > 0) atkPill.className += " is-charged";
    pills.appendChild(atkPill);
    n.appendChild(pills);
    return n;
  }

  function resPill(kind, label, value) {
    var p = el("div", "cg-pill cg-pill--" + kind);
    p.appendChild(el("span", "cg-pill__lab", label));
    p.appendChild(el("span", "cg-pill__val", abbr(value)));
    return p;
  }

  // ---- 手牌區 -------------------------------------------------------------
  function handSection(b, locked) {
    var cfg = SF.CardGame.config;
    var played = (typeof (b.player && b.player.playedThisTurn) === "number") ? b.player.playedThisTurn : 0;
    var canPlay = isPlayerPlayPhase(b) && played < cfg.PLAY_SIZE && !locked;

    var wrap = el("div");
    wrap.appendChild(el("div", "section-label",
      "你的手牌（本回合已出 " + played + " / " + cfg.PLAY_SIZE + "）"));

    var hand = el("div", "cg-hand");
    var cards = (b.player && b.player.hand) ? b.player.hand : [];
    if (!cards.length) {
      hand.appendChild(el("div", "cg-hand__empty", "手牌為空"));
    }
    for (var i = 0; i < cards.length; i++) {
      (function (idx) {
        var c = cards[idx];
        hand.appendChild(handCard(b, c, {
          disabled: !canPlay,
          onClick: function () {
            if (typeof SF.CardGame.playCard === "function") SF.CardGame.playCard(idx);
            render();
          }
        }));
      })(i);
    }
    wrap.appendChild(hand);
    return wrap;
  }

  // 手牌卡：名稱 + 攻擊（effLikes，live）+ 各效果中文標籤 + RETAIN/TEMP 標記。
  function handCard(b, card, opts) {
    opts = opts || {};
    var cls = "cg-card cg-card--battle is-playable";
    if (opts.disabled) cls += " is-disabled";
    if (card && card.retain) cls += " is-retain";
    if (card && card.temp) cls += " is-temp";
    var n = el("div", cls);

    var top = el("div", "cg-card__top");
    top.appendChild(el("div", "cg-card__name", (card && card.name) || (card && card.postId) || "(無題)"));
    if (card && card.retain) top.appendChild(el("span", "cg-card__flag cg-card__flag--retain", "保留"));
    if (card && card.temp) top.appendChild(el("span", "cg-card__flag cg-card__flag--temp", "暫時"));
    n.appendChild(top);

    // 效果標籤
    var effs = (card && card.effects) ? card.effects : [];
    if (effs.length) {
      var ew = el("div", "cg-card__effects");
      for (var i = 0; i < effs.length; i++) {
        var lab = effs[i] && effs[i].label ? effs[i].label : effKindLabel(effs[i]);
        ew.appendChild(el("span", "cg-card__eff", lab));
      }
      n.appendChild(ew);
    }

    var foot = el("div", "cg-card__foot");
    var atk = el("span", "cg-card__atk");
    atk.appendChild(el("span", "cg-card__atklab", "攻擊"));
    atk.appendChild(el("b", null, abbr(effLikesOf(b, "PLAYER", card))));
    foot.appendChild(atk);
    n.appendChild(foot);

    if (!opts.disabled && typeof opts.onClick === "function") n.onclick = opts.onClick;
    return n;
  }

  // ---- 對手揭示面板 -------------------------------------------------------
  function opponentRevealPanel(b, opp) {
    var wrap = el("div", "cg-oppturn");
    wrap.appendChild(el("div", "cg-oppturn__title", "對手出牌"));

    var card = lastPlayCard(b, "OPPONENT") || nextOppCard(b, opp);
    var body = el("div", "cg-oppturn__body");
    if (card) {
      var cardBox = el("div", "cg-card cg-card--lg cg-card--opp");
      var top = el("div", "cg-card__top");
      top.appendChild(el("div", "cg-card__name", card.name || card.postId || "對手貼文"));
      cardBox.appendChild(top);
      var effs = card.effects || [];
      if (effs.length) {
        var ew = el("div", "cg-card__effects");
        for (var i = 0; i < effs.length; i++) {
          var lab = effs[i] && effs[i].label ? effs[i].label : effKindLabel(effs[i]);
          ew.appendChild(el("span", "cg-card__eff", lab));
        }
        cardBox.appendChild(ew);
      }
      var foot = el("div", "cg-card__foot");
      var atk = el("span", "cg-card__atk");
      atk.appendChild(el("span", "cg-card__atklab", "攻擊"));
      var atkVal = (b.lastPlay && b.lastPlay.side === "OPPONENT" && typeof b.lastPlay.effLikes === "number")
                 ? b.lastPlay.effLikes : effLikesOf(b, "OPPONENT", card);
      atk.appendChild(el("b", null, abbr(atkVal)));
      foot.appendChild(atk);
      cardBox.appendChild(foot);
      body.appendChild(cardBox);
    } else {
      body.appendChild(el("div", "cg-card cg-card--lg", "—"));
    }
    wrap.appendChild(body);

    // 結算摘要（若 lastPlay 為對手）
    if (b.lastPlay && b.lastPlay.side === "OPPONENT") {
      var lp = b.lastPlay;
      var resTxt = "造成 " + abbr(lp.dealt || 0) + " 傷害";
      if (typeof lp.toShield === "number" && lp.toShield > 0) resTxt += "（鐵粉吸收 " + abbr(lp.toShield) + "）";
      if (typeof lp.reflected === "number" && lp.reflected > 0) resTxt += "，反傷 " + abbr(lp.reflected);
      wrap.appendChild(el("div", "cg-oppturn__res", resTxt));
    }
    return wrap;
  }

  function lastPlayCard(b, side) {
    if (b.lastPlay && b.lastPlay.side === side && b.lastPlay.card) return b.lastPlay.card;
    return null;
  }

  // 預覽：本回合對手即將打出的腳本貼文（O_PLAY 前）。
  function nextOppCard(b, opp) {
    if (!b.opponent || !b.opponent.posts || !b.opponent.posts.length) return null;
    var idx = (typeof b.opponent.nextPostIdx === "number")
            ? b.opponent.nextPostIdx
            : ((b.round - 1) % b.opponent.posts.length);
    return b.opponent.posts[idx] || null;
  }

  // ---- 待決選擇面板（choose_one / scry） ----------------------------------
  function pendingPanel(b, pending) {
    var wrap = el("div", "cg-pending");
    var d = pending.descriptor || {};

    if (pending.kind === "choose_one") {
      wrap.appendChild(el("div", "cg-pending__title", "選擇一項效果"));
      var opts = d.options || d.labels || [];
      var btns = el("div", "cg-pending__opts");
      for (var i = 0; i < opts.length; i++) {
        (function (idx) {
          var o = opts[idx];
          var lab = (o && o.label) ? o.label : (typeof o === "string" ? o : effKindLabel(o));
          var btn = el("button", "btn btn--primary cg-pending__opt", lab);
          btn.onclick = function () {
            if (typeof SF.CardGame.resolveChoice === "function") SF.CardGame.resolveChoice(idx);
            render();
          };
          btns.appendChild(btn);
        })(i);
      }
      wrap.appendChild(btns);
      return wrap;
    }

    if (pending.kind === "scry") {
      // descriptor.cards = 牌庫頂端可窺視的卡（含 pos 位置索引）；payload 回傳「位置索引」陣列。
      var look = Array.isArray(d.cards) ? d.cards : [];
      var pick = (typeof d.pick === "number") ? d.pick : 1;
      wrap.appendChild(el("div", "cg-pending__title", "預覽牌庫頂端，挑選 " + pick + " 張入手"));
      if (!Array.isArray(_scryPick)) _scryPick = [];

      if (look.length === 0) {
        wrap.appendChild(el("div", "cg-pending__empty", "牌庫頂端沒有可窺視的卡。"));
      }
      var grid = el("div", "cg-pending__scry");
      for (var j = 0; j < look.length; j++) {
        (function (card, pos) {
          var selected = _scryPick.indexOf(pos) !== -1;
          var c = el("div", "cg-card cg-card--battle cg-card--scry is-playable" + (selected ? " is-selected" : ""));
          var top = el("div", "cg-card__top");
          top.appendChild(el("div", "cg-card__name", (card && card.name) || (card && card.postId) || "?"));
          c.appendChild(top);
          var foot = el("div", "cg-card__foot");
          var atk = el("span", "cg-card__atk");
          atk.appendChild(el("span", "cg-card__atklab", "攻擊"));
          atk.appendChild(el("b", null, abbr(effLikesOf(b, "PLAYER", card))));
          foot.appendChild(atk);
          c.appendChild(foot);
          c.onclick = function () {
            var at = _scryPick.indexOf(pos);
            if (at !== -1) { _scryPick.splice(at, 1); }
            else { if (_scryPick.length >= pick) { toast("已達上限 " + pick + " 張", "warn"); return; } _scryPick.push(pos); }
            render();
          };
          grid.appendChild(c);
        })(look[j], (typeof look[j].pos === "number" ? look[j].pos : j));
      }
      wrap.appendChild(grid);

      // 可選張數受限於實際可窺視張數（牌庫不足 pick 時，選滿可選數即可確認，避免卡死）。
      var effPick = Math.min(pick, look.length);
      var confirm = el("button", "btn btn--primary cg-pending__confirm",
        "確認（" + _scryPick.length + " / " + effPick + "）");
      confirm.disabled = (_scryPick.length !== effPick);
      confirm.onclick = function () {
        var payload = _scryPick.slice();
        _scryPick = [];
        if (typeof SF.CardGame.resolveChoice === "function") SF.CardGame.resolveChoice(payload);
        render();
      };
      wrap.appendChild(confirm);
      return wrap;
    }

    // 未知 pending 類型：提供略過鈕，避免卡死。
    wrap.appendChild(el("div", "cg-pending__title", "待決事件"));
    var skip = el("button", "btn cg-pending__opt", "繼續");
    skip.onclick = function () {
      if (typeof SF.CardGame.resolveChoice === "function") SF.CardGame.resolveChoice(0);
      render();
    };
    wrap.appendChild(skip);
    return wrap;
  }

  // ---- 動作列：依 turn / phase 推進 v2 state machine ----------------------
  function actionBar(b) {
    var holder = el("div", "cg-actions");
    var btn = el("button", "btn btn--primary cg-actions__main");

    // 純依 phase 推進（不依賴 turn，避免 ROUND_START/OPPONENT 殘留導致卡死）。
    if (b.phase === "P_PLAY") {
      // 我方出牌中：可在 3 張前提早結束我方回合。
      btn.textContent = "結束我方回合";
      btn.onclick = function () {
        if (typeof SF.CardGame.endPlayerTurn === "function") SF.CardGame.endPlayerTurn();
        render();
      };
    } else if (b.phase === "O_PLAY") {
      // 對手出牌待揭示。
      btn.textContent = "對手出牌";
      btn.onclick = function () {
        if (typeof SF.CardGame.runOpponentTurn === "function") SF.CardGame.runOpponentTurn();
        render();
      };
    } else if (b.phase === "ROUND_START") {
      // 進入下一回合（流量/金錢 tick + 發牌）。
      btn.textContent = "下一回合";
      btn.onclick = function () {
        if (typeof SF.CardGame.beginRound === "function") SF.CardGame.beginRound();
        render();
      };
    } else {
      // 其他過渡相位（WINCHECK 等）：推進，必要時補 beginRound。
      btn.textContent = "下一回合";
      btn.onclick = function () {
        if (typeof SF.CardGame.advance === "function") SF.CardGame.advance();
        var nb = SF.CardGame.battle;
        if (nb && nb.phase === "ROUND_START" && typeof SF.CardGame.beginRound === "function") {
          SF.CardGame.beginRound();
        }
        render();
      };
    }
    holder.appendChild(btn);

    var giveUp = el("button", "btn btn--danger btn--sm cg-actions__give", "放棄挑戰");
    giveUp.onclick = function () {
      if (global.confirm && !global.confirm("確定放棄這場挑戰？不會獲得獎勵。")) return;
      SF.CardGame.endBattle();
      _view = "HOME";
      render();
    };
    holder.appendChild(giveUp);
    return holder;
  }

  function phaseLabel(phase) {
    switch (phase) {
      case "ROUND_START":   return "回合開始";
      case "P_DRAW":        return "抽牌";
      case "P_PLAY":        return "出牌";
      case "P_RESOLVE_CARD":return "結算卡片";
      case "P_END":         return "我方結束";
      case "O_PLAY":        return "對手出牌";
      case "O_RESOLVE":     return "對手結算";
      case "O_END":         return "對手結束";
      case "WINCHECK":      return "勝負判定";
      case "ENDED":         return "戰鬥結束";
      default:              return phase || "";
    }
  }

  // 效果 kind → 中文 fallback 標籤（理應 card-effects.js 已附 label）。
  function effKindLabel(eff) {
    if (!eff) return "效果";
    var map = {
      add_shield: "增加鐵粉", heal: "回復粉絲團", shield_to_hp: "鐵粉轉粉絲團",
      followers_to_atk: "粉絲轉攻擊", atk_to_followers: "攻擊吸粉", reflect: "反傷",
      traffic_add: "提升流量", traffic_sub: "降低流量",
      atk_from_traffic: "流量加攻", atk_from_low_traffic: "低流量加攻",
      traffic_to_money: "流量換金錢", gen_money: "獲得金錢",
      money_to_traffic: "金錢換流量", money_to_followers: "金錢換粉絲",
      money_to_shield: "金錢換鐵粉", money_to_atk: "金錢加攻",
      parity: "奇偶效果", combo: "連動效果", retain: "保留手牌",
      choose_one: "二選一", temp_card: "生成臨時卡", buff: "強化攻擊",
      draw: "抽牌", scry: "預覽選牌", repeat: "重複效果"
    };
    return map[eff.kind] || (eff.kind || "效果");
  }

  // ---- 戰鬥記錄 -----------------------------------------------------------
  function logSection(b) {
    var wrap = el("div");
    var log = (b.log && b.log.length) ? b.log : null;
    if (!log) return wrap;
    wrap.appendChild(el("div", "section-label", "戰鬥記錄"));
    var logWrap = el("div", "cg-log");
    for (var L = log.length - 1; L >= 0; L--) {
      logWrap.appendChild(logRow(b.log[L]));
    }
    wrap.appendChild(logWrap);
    return wrap;
  }

  // log entry 容忍兩種形態：字串、或 {round?, side?, text?/msg?} 物件。
  function logRow(entry) {
    var n = el("div", "cg-log__row");
    if (typeof entry === "string") {
      n.appendChild(el("div", "cg-log__detail", entry));
      return n;
    }
    if (entry && typeof entry.round === "number") {
      n.appendChild(el("div", "cg-log__round", "R" + entry.round));
    }
    var side = entry && entry.side;
    if (side) {
      n.classList.add(side === "PLAYER" ? "is-player" : "is-opp");
    }
    var txt = (entry && (entry.text || entry.msg || entry.detail)) || "";
    if (!txt && entry) {
      // 退而求其次：以 lastPlay 樣式描述。
      if (typeof entry.dealt === "number") {
        txt = (side === "PLAYER" ? "你" : "對手") + " 出牌，造成 " + abbr(entry.dealt) + " 傷害";
      } else {
        txt = JSON.stringify(entry);
      }
    }
    n.appendChild(el("div", "cg-log__detail", txt));
    return n;
  }

  // ===========================================================================
  // SETTLEMENT — 勝負 + 獎勵
  // ===========================================================================
  function renderSettlement() {
    var b = SF.CardGame.battle;
    if (!b || !b.result) { _view = "HOME"; renderHome(); return; }
    var result = b.result;
    var opponentId = result.opponentId;
    var opp = SF.CardGame.opponentById(opponentId);

    if (result.win) {
      renderWin(b, opp, opponentId);
    } else {
      renderLose(b, opp, opponentId);
    }
  }

  function renderWin(b, opp, opponentId) {
    var cfg = SF.CardGame.config;
    var result = b.result;

    var banner = el("div", "cg-settle is-win");
    banner.appendChild(el("div", "cg-settle__title", "挑戰成功！"));
    banner.appendChild(el("div", "cg-settle__sub", "你擊敗了 " + (opp ? opp.name : "對手")));
    _stage.appendChild(banner);

    if (result.rewardApplied) {
      _stage.appendChild(el("div", "section-label", "獎勵已領取"));
      var done = el("div", "cg-block");
      done.appendChild(el("div", "cg-block__title", "獎勵已領取"));
      done.appendChild(el("div", "cg-block__msg", "此對手已擊敗，無法再次挑戰。"));
      var backDone = el("button", "btn btn--primary", "返回排行榜");
      backDone.onclick = function () { SF.CardGame.endBattle(); _view = "HOME"; render(); };
      done.appendChild(backDone);
      _stage.appendChild(done);
      return;
    }

    _stage.appendChild(el("div", "section-label", "選擇 1 項獎勵"));
    var rewards = el("div", "cg-rewards");

    // 1. 奪取詞條
    var offer = SF.CardGame.rewardTagOffer(opponentId);
    var tagReward = el("div", "cg-reward");
    tagReward.setAttribute("data-kind", "tag");
    tagReward.appendChild(el("div", "cg-reward__title", "奪取詞條"));
    if (offer.length) {
      tagReward.appendChild(el("div", "cg-reward__desc", "從對手詞條中選 1 個解鎖："));
      var chips = el("div", "cg-reward__chips");
      for (var i = 0; i < offer.length; i++) {
        (function (name) {
          var chip = el("button", "chip" + (_rewardTag === name ? " is-selected" : ""), name);
          chip.onclick = function () {
            _rewardTag = (_rewardTag === name) ? null : name;
            render();
          };
          chips.appendChild(chip);
        })(offer[i]);
      }
      tagReward.appendChild(chips);
      var claimTag = el("button", "btn btn--primary btn--block", "領取詞條");
      claimTag.disabled = !_rewardTag;
      claimTag.onclick = function () {
        if (!_rewardTag) return;
        if (SF.CardGame.applyRewardStealTag(opponentId, _rewardTag)) {
          toast("已奪取詞條「" + _rewardTag + "」", "ok");
          render();
        } else {
          toast("奪取失敗", "bad");
        }
      };
      tagReward.appendChild(claimTag);
    } else {
      tagReward.classList.add("is-disabled");
      tagReward.appendChild(el("div", "cg-reward__desc", "無可奪取的新詞條（皆已解鎖）。"));
    }
    rewards.appendChild(tagReward);

    // 2. 奪取粉絲
    var folReward = el("div", "cg-reward");
    folReward.setAttribute("data-kind", "follower");
    folReward.appendChild(el("div", "cg-reward__title", "奪取粉絲"));
    var oppFol = opp ? opp.followers : 0;
    var amount = Math.max(cfg.STEAL_FOLLOWER_MIN, Math.round(oppFol * cfg.STEAL_FOLLOWER_PCT));
    amount = Math.min(amount, oppFol);
    folReward.appendChild(el("div", "cg-reward__desc", "搶奪粉絲 +" + abbr(amount) + "（對手 −" + abbr(amount) + "）"));
    var claimFol = el("button", "btn btn--primary btn--block", "領取粉絲");
    claimFol.onclick = function () {
      var got = SF.CardGame.applyRewardStealFollowers(opponentId);
      toast("已奪取 " + abbr(got) + " 粉絲", "ok");
      render();
    };
    folReward.appendChild(claimFol);
    rewards.appendChild(folReward);

    // 3. 道具（停用）
    var itemReward = el("div", "cg-reward is-disabled");
    itemReward.setAttribute("data-kind", "item");
    itemReward.appendChild(el("div", "cg-reward__title", "道具"));
    itemReward.appendChild(el("div", "cg-reward__desc", "未開放的獎勵類型。"));
    var itemBtn = el("button", "btn btn--block", "敬請期待");
    itemBtn.disabled = true;
    itemReward.appendChild(itemBtn);
    rewards.appendChild(itemReward);

    _stage.appendChild(rewards);
  }

  function renderLose(b, opp, opponentId) {
    var banner = el("div", "cg-settle is-lose");
    banner.appendChild(el("div", "cg-settle__title", "挑戰失敗"));
    banner.appendChild(el("div", "cg-settle__sub", "被 " + (opp ? opp.name : "對手") + " 擊敗了"));
    _stage.appendChild(banner);

    var foot = el("div", "cg-settle__foot");
    var retry = el("button", "btn btn--primary", "再次挑戰");
    retry.onclick = function () {
      SF.CardGame.endBattle();
      startBattle(opponentId);
    };
    foot.appendChild(retry);

    var back = el("button", "btn", "返回排行榜");
    back.onclick = function () { SF.CardGame.endBattle(); _view = "HOME"; render(); };
    foot.appendChild(back);

    _stage.appendChild(foot);
  }

  // ===========================================================================
  // render / init
  // ===========================================================================
  function ensureShell() {
    if (!_root) _root = document.getElementById("panel-cardgame");
    if (!_root) return false;
    // 若 shell 尚未建立或被清空，建立 .cg-root > .cg-stage
    if (!_stage || _stage.parentNode == null || !_root.contains(_stage)) {
      clear(_root);
      var rootDiv = el("div", "cg-root");
      _stage = el("div", "cg-stage");
      rootDiv.appendChild(_stage);
      _root.appendChild(rootDiv);
    }
    return true;
  }

  function render() {
    if (!ensureShell()) return;
    clear(_stage);

    // 引擎狀態與 _view 的一致性校正：
    // - BATTLE 但無 battle → HOME
    // - battle 已 ENDED → SETTLEMENT
    var b = SF.CardGame.battle;
    if (_view === "BATTLE" && !b) _view = "HOME";
    if (b && b.phase === "ENDED" && b.result && _view === "BATTLE") _view = "SETTLEMENT";

    switch (_view) {
      case "HOME":       renderHome();       break;
      case "DECK":       renderDeck();       break;
      case "BATTLE":     renderBattle();     break;
      case "SETTLEMENT": renderSettlement(); break;
      default:           _view = "HOME"; renderHome(); break;
    }
  }

  // 僅於 cardgame 分頁 active 時重繪（避免每 tick 重建隱藏面板）。
  function isActive() {
    return !!(_root && _root.classList && _root.classList.contains("is-active"));
  }

  function init() {
    _root = document.getElementById("panel-cardgame");
    // 訂閱兩條 bus：State（粉絲/時間）與 CardGame（defeated / 排行重排）。
    if (SF.State && SF.State.onChange) {
      SF.State.onChange(function () { if (isActive()) render(); });
    }
    if (SF.CardGame && SF.CardGame.onChange) {
      SF.CardGame.onChange(function () { if (isActive()) render(); });
    }
  }

  SF.CardGameUI = {
    init: init,
    render: render
  };

})(typeof window !== "undefined" ? window : this);
