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

    if (opts.tags && opts.tags.length) {
      var tw = el("div", "cg-card__tags");
      for (var i = 0; i < opts.tags.length; i++) {
        tw.appendChild(el("span", "cg-card__tag", opts.tags[i]));
      }
      n.appendChild(tw);
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
    SF.CardGame.drawPhase();
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
        var card = cardEl(
          { postId: postId, name: cardName(rec.post), likes: rec.likes },
          {
            tags: postTags(rec.post),
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
  // BATTLE — HUD / 對手 / 組合 banner / 手牌 / log
  // ===========================================================================
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

    // HUD
    var hud = el("div", "cg-hud");
    var bars = el("div", "cg-hud__bars");

    var pSide = el("div", "cg-hud__side cg-hud__side--player");
    pSide.appendChild(el("div", "cg-hud__who", "你"));
    pSide.appendChild(hpBar("player", b.playerHp, b.playerHpMax, false));
    bars.appendChild(pSide);

    bars.appendChild(el("div", "cg-hud__vs", "VS"));

    var oSide = el("div", "cg-hud__side cg-hud__side--opp");
    oSide.appendChild(el("div", "cg-hud__who", oppName));
    oSide.appendChild(hpBar("opp", b.oppHp, b.oppHpMax, false));
    bars.appendChild(oSide);

    hud.appendChild(bars);

    var meta = el("div", "cg-hud__meta");
    meta.appendChild(el("span", "cg-hud__round", "第 " + b.round + " 回合"));
    meta.appendChild(el("span", "cg-hud__phase", phaseLabel(b.phase)));
    hud.appendChild(meta);
    _stage.appendChild(hud);

    // 對手出牌列
    var oppWrap = el("div", "cg-opp");
    var oppCardBox = el("div", "cg-opp__card");
    if (b.oppCard) {
      oppCardBox.appendChild(cardEl(b.oppCard, { large: true, tags: oppCardTags(opp, b) }));
    } else {
      oppCardBox.appendChild(el("div", "cg-card cg-card--lg", "—"));
    }
    oppWrap.appendChild(oppCardBox);

    var action = el("div", "cg-opp__action");
    action.appendChild(buildActionButton(b));
    oppWrap.appendChild(action);
    _stage.appendChild(oppWrap);

    // 組合效果 banner（EFFECT 佔位）
    _stage.appendChild(el("div", "cg-combo is-disabled", "詞條與詞條間有組合效果"));

    // 手牌
    var cfg = SF.CardGame.config;
    _stage.appendChild(el("div", "section-label", "你的手牌（選 " + cfg.PLAY_SIZE + " 張）"));
    var hand = el("div", "cg-hand");
    var pickedSet = Object.create(null);
    for (var p = 0; p < b.picked.length; p++) pickedSet[b.picked[p]] = true;
    var canPick = (b.phase === "PLAY");
    for (var i = 0; i < b.hand.length; i++) {
      (function (idx) {
        var c = b.hand[idx];
        var selected = !!pickedSet[idx];
        var full = b.picked.length >= cfg.PLAY_SIZE;
        hand.appendChild(cardEl(c, {
          playable: true,
          selected: selected,
          disabled: !canPick || (!selected && full),
          onClick: function () { SF.CardGame.pickCard(idx); render(); }
        }));
      })(i);
    }
    _stage.appendChild(hand);

    // log
    if (b.log && b.log.length) {
      _stage.appendChild(el("div", "section-label", "回合紀錄"));
      var logWrap = el("div", "cg-log");
      for (var L = b.log.length - 1; L >= 0; L--) {
        logWrap.appendChild(logRow(b.log[L]));
      }
      _stage.appendChild(logWrap);
    }
  }

  // 動作按鈕：依 phase 改變文字 / disabled，不切 _view。
  function buildActionButton(b) {
    var cfg = SF.CardGame.config;
    var btn = el("button", "btn btn--primary cg-opp__btn");

    if (b.phase === "PLAY") {
      var need = cfg.PLAY_SIZE;
      var have = b.picked.length;
      btn.textContent = "打出（" + have + "/" + need + "）";
      btn.disabled = (have !== need);
      btn.onclick = function () {
        SF.CardGame.playPicked();
        render();
      };
    } else if (b.phase === "ROUND_END") {
      btn.textContent = "下一回合";
      btn.onclick = function () {
        SF.CardGame.nextRound();
        SF.CardGame.drawPhase();
        render();
      };
    } else if (b.phase === "ENDED") {
      btn.textContent = "查看結算";
      btn.onclick = function () { _view = "SETTLEMENT"; render(); };
    } else {
      // DRAW 等過渡態：補一次 draw
      btn.textContent = "繼續";
      btn.onclick = function () {
        if (b.phase === "DRAW") SF.CardGame.drawPhase();
        render();
      };
    }

    // 放棄按鈕
    var giveUp = el("button", "btn btn--danger btn--sm", "放棄挑戰");
    giveUp.onclick = function () {
      if (global.confirm && !global.confirm("確定放棄這場挑戰？不會獲得獎勵。")) return;
      SF.CardGame.endBattle();
      _view = "HOME";
      render();
    };

    var holder = el("div", "cg-opp__btnholder");
    holder.appendChild(btn);
    holder.appendChild(giveUp);
    return holder;
  }

  function phaseLabel(phase) {
    switch (phase) {
      case "DRAW":      return "抽牌";
      case "PLAY":      return "出牌";
      case "EFFECT_1":  return "效果";
      case "COMPARE":   return "比拼";
      case "EFFECT_2":  return "效果";
      case "RESOLVE":   return "結算";
      case "ROUND_END": return "回合結束";
      case "ENDED":     return "戰鬥結束";
      default:          return phase || "";
    }
  }

  function oppCardTags(opp, b) {
    if (!opp || !opp.posts || !b.oppCard) return [];
    for (var i = 0; i < opp.posts.length; i++) {
      if (opp.posts[i].id === b.oppCard.postId) return (opp.posts[i].tags || []).slice(0, 3);
    }
    return [];
  }

  function logRow(entry) {
    var n = el("div", "cg-log__row");
    n.appendChild(el("div", "cg-log__round", "R" + entry.round));
    var detail = "你 " + abbr(entry.playerSum) + " vs 對手 " + abbr(entry.oppLikes);
    n.appendChild(el("div", "cg-log__detail", detail));
    var dmgCls = "cg-log__dmg is-" + entry.target;
    var dmgTxt;
    if (entry.target === "opp") dmgTxt = "對手 −" + entry.dmg;
    else if (entry.target === "player") dmgTxt = "你 −" + entry.dmg;
    else dmgTxt = "平手";
    n.appendChild(el("div", dmgCls, dmgTxt));
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
