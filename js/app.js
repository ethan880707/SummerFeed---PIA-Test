/* =============================================================================
 * app.js — SF.App
 * UI 控制器（SPEC §3.5）。原生 DOM，無框架。
 *
 * 初始化順序：SF.Data.init(); SF.Recipes.build(); SF.State.load(); render。
 * 分頁：
 *   1. 詞條庫存：依類型→來源分組；顯示獲取方式；勾選解鎖 + 一鍵全解。
 *   2. 發文（配方）：左＝已解鎖詞條（getCompatibleTags 即時過濾、未命中變灰）；
 *      右＝已選籃；即時 tryMatch → 預覽卡（含發布）；未命中提示；canPostToday 限制。
 *   3. 動態（Feed）：feed 反序；即時 讚/分享/瀏覽/留言 + reach；快進6小時 / 下一天；
 *      粉絲數隨時間成長（recompute）。
 *   4. 演算法參數：所有 params 欄位即時可調 + 重置；canvas 畫 14 天成長曲線
 *      （3 種 traffic tier × 2 種粉絲基數），參數改動即重繪。
 *
 * 全域：sticky 頂列 handle + 粉絲數 + 重置存檔。SF.State.onChange 觸發重繪。
 * 列表重繪一律「清空容器→重建」。
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
  function $(id) { return document.getElementById(id); }

  function toast(msg, kind) {
    var wrap = $("toastWrap");
    if (!wrap) return;
    var t = el("div", "toast" + (kind ? " is-" + kind : ""), msg);
    wrap.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2900);
  }

  // 流量徽章 class / 文字。
  function trafficClass(tier) {
    if (tier === 0) return "is-low";
    if (tier === 2) return "is-high";
    if (tier === 1) return "is-med";
    return "is-none";
  }
  function trafficLabel(post) {
    if (post.trafficTier == null) return "Medium*"; // null → 視為 Medium
    return post.trafficName || ["Low", "Medium", "High"][post.trafficTier] || "Medium";
  }

  // 解鎖觸發 pill class。
  function triggerClass(trigger) {
    switch (trigger) {
      case "系統提示": return "trigger--system";
      case "無聲":     return "trigger--silent";
      case "旁白":     return "trigger--narration";
      case "小場景":   return "trigger--scene";
      default:        return "";
    }
  }

  // ---- App 狀態（純 UI 狀態，不入存檔） ------------------------------------
  var _activeTab = "inventory";
  var _selected = []; // 發文：已選詞條 name 陣列（保序）
  var _composeCategory = "全部";       // 發文左側詞條的分類子頁
  var _composeOnlyCompatible = false;  // 是否僅顯示「可組成文章」的詞條

  // 各分頁面板容器（init 時填入）。
  var panels = {};

  // ===========================================================================
  // 頂列 + 分頁框架
  // ===========================================================================
  function renderTopbar() {
    var handleEl = $("tbHandle");
    var folEl = $("tbFollowers");
    var deltaEl = $("tbDelta");
    var dayEl = $("tbDay");
    var ticksEl = $("tbTicks");
    var avatarEl = $("tbAvatar");

    var acc = SF.State.account;
    if (handleEl) handleEl.textContent = acc.handle;
    if (avatarEl) avatarEl.textContent = (acc.handle || "@?").replace(/^@/, "").charAt(0).toUpperCase() || "P";
    if (folEl) folEl.textContent = abbr(SF.State.followers());
    if (deltaEl) {
      var d = Math.round(acc.followerDelta || 0);
      deltaEl.textContent = d > 0 ? "+" + abbr(d) : "";
    }
    if (dayEl) dayEl.textContent = "Day " + SF.State.clock.day;
    if (ticksEl) ticksEl.textContent = SF.State.clock.ticks + "h";
  }

  function setActiveTab(name) {
    _activeTab = name;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-tab") === name);
    }
    for (var key in panels) {
      if (panels.hasOwnProperty(key)) {
        panels[key].classList.toggle("is-active", key === name);
      }
    }
    renderActivePanel();
  }

  function renderActivePanel() {
    switch (_activeTab) {
      case "inventory": renderInventory(); break;
      case "compose":   renderCompose();   break;
      case "feed":      renderFeed();       break;
      case "cardgame":  renderCardgame();   break;
      case "params":    renderParams();     break;
    }
  }

  // ===========================================================================
  // Tab 1：詞條庫存
  // ===========================================================================
  function renderInventory() {
    var root = panels.inventory;
    clear(root);

    var head = el("div", "panel__head");
    head.appendChild(el("h2", "panel__title", "詞條庫存"));
    var hint = el("p", "panel__hint", "依類型／來源分組；勾選即解鎖（測試用）。");
    head.appendChild(hint);
    root.appendChild(head);

    var toolbar = el("div", "toolbar");
    var unlockedCount = SF.State.tagInventory.size;
    var total = SF.Data.tags.length;
    var counter = el("span", "muted", "已解鎖 " + unlockedCount + " / " + total);
    var spacer = el("span", "spacer");
    var allBtn = el("button", "btn btn--primary btn--sm", "一鍵全解");
    allBtn.onclick = function () { SF.State.unlockAll(); SF.State.save(); toast("已解鎖全部詞條", "ok"); };
    var noneBtn = el("button", "btn btn--ghost btn--sm", "全部上鎖");
    noneBtn.onclick = function () {
      SF.State.tagInventory.clear(); // Set.clear 不觸發 onChange，手動重繪。
      SF.State.save();
      renderInventory();
      renderTopbar();
      toast("已清空詞條");
    };
    toolbar.appendChild(counter);
    toolbar.appendChild(spacer);
    toolbar.appendChild(noneBtn);
    toolbar.appendChild(allBtn);
    root.appendChild(toolbar);

    // 依類型分組（SF.Data.tagTypes 固定順序），組內再依 source 細分。
    var types = SF.Data.tagTypes;
    for (var ti = 0; ti < types.length; ti++) {
      var type = types[ti];
      var tagsOfType = SF.Data.tagsByType(type);
      if (tagsOfType.length === 0) continue;

      // 依 source 分桶（保出現序）。
      var bySource = {};
      var sourceOrder = [];
      for (var i = 0; i < tagsOfType.length; i++) {
        var src = tagsOfType[i].source || "（未分類）";
        if (!bySource[src]) { bySource[src] = []; sourceOrder.push(src); }
        bySource[src].push(tagsOfType[i]);
      }

      var typeLabel = el("div", "section-label", "類型：" + type + "（" + tagsOfType.length + "）");
      root.appendChild(typeLabel);

      for (var si = 0; si < sourceOrder.length; si++) {
        var source = sourceOrder[si];
        root.appendChild(buildSourceGroup(type, source, bySource[source]));
      }
    }
  }

  function buildSourceGroup(type, source, tags) {
    var group = el("div", "group");

    var unlockedInGroup = 0;
    for (var i = 0; i < tags.length; i++) {
      if (SF.State.isUnlocked(tags[i].name)) unlockedInGroup++;
    }

    var ghead = el("div", "group__head");
    ghead.appendChild(el("span", "group__title", source));
    ghead.appendChild(el("span", "group__sub", type));
    ghead.appendChild(el("span", "group__count", unlockedInGroup + " / " + tags.length));
    group.appendChild(ghead);

    var body = el("div", "group__body");
    for (var j = 0; j < tags.length; j++) {
      body.appendChild(buildTagCard(tags[j]));
    }
    group.appendChild(body);
    return group;
  }

  function buildTagCard(tag) {
    var unlocked = SF.State.isUnlocked(tag.name);
    var card = el("div", "tag-card" + (unlocked ? "" : " is-locked"));

    var nameWrap = el("div");
    var nameEl = el("span", "tag-card__name", tag.name);
    nameWrap.appendChild(nameEl);
    if (tag.code && tag.code !== tag.name) {
      nameWrap.appendChild(el("span", "tag-card__code", tag.code));
    }
    card.appendChild(nameWrap);

    // 解鎖開關（checkbox switch）。
    var toggleWrap = el("label", "switch tag-card__toggle");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = unlocked;
    cb.onchange = function () {
      if (cb.checked) SF.State.unlock(tag.name);
      else SF.State.lock(tag.name);
      SF.State.save();
    };
    toggleWrap.appendChild(cb);
    toggleWrap.appendChild(el("span", "track"));
    card.appendChild(toggleWrap);

    // 獲取方式 meta（source / condition / cumulativeAP / unlockTrigger）。
    var meta = el("div", "tag-card__meta");
    meta.appendChild(kv("來源", tag.source || "—"));
    if (tag.condition) meta.appendChild(kv("條件", tag.condition));
    if (tag.cumulativeAP != null) meta.appendChild(kv("累積AP", String(tag.cumulativeAP)));
    if (tag.route) meta.appendChild(kv("路線", tag.route));
    if (tag.unlockTrigger) {
      var trig = el("span", "kv");
      trig.appendChild(el("span", "k", "解鎖提示"));
      trig.appendChild(el("span", "trigger " + triggerClass(tag.unlockTrigger), tag.unlockTrigger));
      meta.appendChild(trig);
    }
    card.appendChild(meta);
    return card;
  }

  function kv(k, v) {
    var s = el("span", "kv");
    s.appendChild(el("span", "k", k));
    s.appendChild(el("b", null, v));
    return s;
  }

  // ===========================================================================
  // Tab 2：發文（配方）
  // ===========================================================================
  function renderCompose() {
    var root = panels.compose;
    clear(root);

    var head = el("div", "panel__head");
    head.appendChild(el("h2", "panel__title", "發文"));
    head.appendChild(el("p", "panel__hint", "從已解鎖詞條組合配方，命中後可發布（每天一篇）。"));
    root.appendChild(head);

    // 工具列：一鍵解鎖（發布）全部貼文（測試用，對應詞條庫存的「一鍵全解」）。
    var toolbar = el("div", "toolbar");
    var publishedCount = 0;
    for (var fi = 0; fi < SF.State.feed.length; fi++) {
      if (SF.State.feed[fi].source === "player") publishedCount++;
    }
    toolbar.appendChild(el("span", "muted", "已發布 " + publishedCount + " / " + SF.Data.posts.length + " 篇"));
    toolbar.appendChild(el("span", "spacer"));
    var pubAllBtn = el("button", "btn btn--primary btn--sm", "一鍵解鎖全部貼文");
    pubAllBtn.onclick = function () {
      var added = SF.State.publishAll();
      SF.State.save();
      toast(added > 0 ? ("已解鎖 " + added + " 篇貼文") : "已全部解鎖", "ok");
      renderCompose();
      renderTopbar();
    };
    toolbar.appendChild(pubAllBtn);
    root.appendChild(toolbar);

    var grid = el("div", "compose");

    // ---- 左：詞條池 ----
    var pool = el("div", "compose__pool");
    pool.appendChild(el("div", "section-label", "已解鎖詞條"));

    var compatible = SF.Recipes.getCompatibleTags(_selected); // Set<string>

    var unlockedTags = [];
    var tags = SF.Data.tags;
    for (var i = 0; i < tags.length; i++) {
      if (SF.State.isUnlocked(tags[i].name)) unlockedTags.push(tags[i]);
    }

    if (unlockedTags.length === 0) {
      pool.appendChild(el("div", "basket__empty", "尚無已解鎖詞條，請先到「詞條庫存」解鎖。"));
    } else {
      // 分類子頁 + 「僅顯示可組成文章的詞條」勾選。
      pool.appendChild(buildComposeControls(unlockedTags, compatible));

      // 「僅顯示可組成文章的詞條」：只留下「與已選詞條一起、且只用已解鎖詞條
      // 就能湊成某完整配方」的下一步詞條（排除其餘詞條未解鎖、永遠湊不出文章者）。
      var completable = _composeOnlyCompatible
        ? SF.Recipes.getCompletableTags(_selected, Array.from(SF.State.tagInventory))
        : null;

      // 套用分類篩選 + （可選）僅顯示可組成文章的詞條。
      var filtered = unlockedTags.filter(function (t) {
        if (_composeCategory !== "全部" && tagCategory(t) !== _composeCategory) return false;
        if (_composeOnlyCompatible &&
            !completable.has(t.name) &&
            _selected.indexOf(t.name) === -1) return false;
        return true;
      });

      if (filtered.length === 0) {
        pool.appendChild(el("div", "basket__empty",
          _composeOnlyCompatible
            ? "此分類沒有可與目前組合搭配成文章的詞條。"
            : "此分類沒有已解鎖詞條。"));
      } else {
        var chipGrid = el("div", "chip-grid");
        for (var k = 0; k < filtered.length; k++) {
          chipGrid.appendChild(buildPoolChip(filtered[k], compatible));
        }
        pool.appendChild(chipGrid);
      }
    }
    grid.appendChild(pool);

    // ---- 右：籃 + 比對 ----
    var side = el("div", "compose__side");
    side.appendChild(buildBasket());
    side.appendChild(buildMatch());
    grid.appendChild(side);

    root.appendChild(grid);
  }

  // 依 Excel 代號推導詞條分類：去掉 '#'、尾碼數字、以及「劇」「雙倍」後綴。
  //   #健身01 / #健身02 → 健身 ；#女A劇01 / #女A劇02 → 女A ；#共通01 → 共通；
  //   #巨巨雙倍 → 巨巨（與 #巨巨劇01 同組）。
  function tagCategory(tag) {
    if (!tag) return "其他";
    var s = String(tag.code || tag.name || "").replace(/^#/, "");
    s = s.replace(/\d+$/, "");        // 去尾碼數字
    s = s.replace(/(劇|雙倍)$/, "");   // 去「劇」「雙倍」後綴
    return s || (tag.type || "其他");
  }

  // 全部詞條的分類順序（依 SF.Data.tags 出現序，穩定且貼近 Excel 排列）。
  function allTagCategoriesOrdered() {
    var seen = {}, out = [];
    var tags = SF.Data.tags || [];
    for (var i = 0; i < tags.length; i++) {
      var c = tagCategory(tags[i]);
      if (!seen[c]) { seen[c] = true; out.push(c); }
    }
    return out;
  }

  // 發文左側詞條池的控制列：分類子頁 + 僅顯示可組成文章的詞條。
  function buildComposeControls(unlockedTags, compatible) {
    var controls = el("div", "pool__controls");

    // 只列出「目前有已解鎖詞條」的分類（依代號分類、保持資料出現序）。
    var present = {};
    for (var i = 0; i < unlockedTags.length; i++) {
      present[tagCategory(unlockedTags[i])] = true;
    }
    var ordered = [];
    var allCats = allTagCategoriesOrdered();
    for (var ci = 0; ci < allCats.length; ci++) {
      if (present[allCats[ci]]) ordered.push(allCats[ci]);
    }
    // 補上未涵蓋者（容錯）。
    for (var key in present) {
      if (present.hasOwnProperty(key) && ordered.indexOf(key) === -1) ordered.push(key);
    }
    // 目前分類若已無對應詞條（如全部上鎖）→ 回退「全部」。
    if (_composeCategory !== "全部" && ordered.indexOf(_composeCategory) === -1) {
      _composeCategory = "全部";
    }

    var subbar = el("div", "subtabs");
    var cats = ["全部"].concat(ordered);
    for (var c = 0; c < cats.length; c++) {
      (function (cat) {
        var b = el("button", "subtab" + (cat === _composeCategory ? " is-active" : ""), cat);
        b.onclick = function () { _composeCategory = cat; renderCompose(); };
        subbar.appendChild(b);
      })(cats[c]);
    }
    controls.appendChild(subbar);

    var lbl = el("label", "check");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = _composeOnlyCompatible;
    cb.onchange = function () { _composeOnlyCompatible = cb.checked; renderCompose(); };
    lbl.appendChild(cb);
    lbl.appendChild(el("span", null, "僅顯示可組成文章的詞條"));
    controls.appendChild(lbl);

    return controls;
  }

  function buildPoolChip(tag, compatibleSet) {
    var isSelected = _selected.indexOf(tag.name) !== -1;
    var isCompatible = compatibleSet.has(tag.name);
    var cls = "chip is-unlocked";
    if (isSelected) cls += " is-selected";
    else if (isCompatible) cls += " is-compatible";
    else cls += " is-dimmed"; // 無法朝任何配方前進 → 變灰

    var chip = el("button", cls);
    chip.appendChild(el("span", null, tag.name));
    if (tag.type) chip.appendChild(el("span", "chip__type", tag.type));

    if (isSelected) {
      chip.onclick = function () { toggleSelect(tag.name); };
    } else if (isCompatible) {
      chip.onclick = function () { toggleSelect(tag.name); };
    } else {
      // dimmed：不可點。
      chip.disabled = true;
    }
    return chip;
  }

  function toggleSelect(name) {
    var idx = _selected.indexOf(name);
    if (idx === -1) _selected.push(name);
    else _selected.splice(idx, 1);
    renderCompose(); // 重繪（清空→重建）
  }

  function buildBasket() {
    var basket = el("div", "basket");
    var bhead = el("div", "basket__head");
    bhead.appendChild(el("span", "basket__title", "已選詞條（" + _selected.length + "）"));
    var clearBtn = el("button", "basket__clear", "清空");
    clearBtn.onclick = function () { _selected = []; renderCompose(); };
    bhead.appendChild(clearBtn);
    basket.appendChild(bhead);

    var body = el("div", "basket__body");
    if (_selected.length === 0) {
      body.appendChild(el("div", "basket__empty", "點左側詞條加入配方"));
    } else {
      for (var i = 0; i < _selected.length; i++) {
        (function (name) {
          var chip = el("button", "chip is-selected chip--removable");
          chip.appendChild(el("span", null, name));
          chip.appendChild(el("span", "chip__x", "×"));
          chip.onclick = function () { toggleSelect(name); };
          body.appendChild(chip);
        })(_selected[i]);
      }
    }
    basket.appendChild(body);
    return basket;
  }

  function buildMatch() {
    var wrap = el("div", "match");
    var result = SF.Recipes.tryMatch(_selected);

    if (!result) {
      var miss = el("div", "match__miss");
      miss.appendChild(el("span", "big", "🔍"));
      if (_selected.length === 0) {
        miss.appendChild(el("div", null, "選擇詞條以組成配方"));
      } else {
        miss.appendChild(el("div", null, "目前組合尚未命中任何貼文配方"));
      }
      wrap.appendChild(miss);
      return wrap;
    }

    var post = result.post;
    wrap.appendChild(el("div", "section-label", "命中貼文"));
    wrap.appendChild(buildPostPreview(post));

    var canPost = SF.State.canPostToday();
    var foot = el("div", "post__foot");
    var pubBtn = el("button", "btn btn--primary btn--lg btn--block", canPost ? "發布" : "今日已發文");
    pubBtn.disabled = !canPost;
    pubBtn.onclick = function () {
      var entry = SF.State.publish(post.id, "player");
      if (entry) {
        SF.State.save();
        _selected = [];
        toast("已發布：" + post.name + "（" + post.id + "）", "ok");
        setActiveTab("feed");
      } else {
        toast("發布失敗：今日已發過或無效貼文", "bad");
      }
    };
    foot.appendChild(pubBtn);
    wrap.appendChild(foot);
    return wrap;
  }

  // 卡牌效果區塊：讀 window.PIA_CARD_EFFECTS[postId]，列出各效果中文標籤 + 「保留」旗標。
  function buildCardEffects(postId) {
    var wrap = el("div", "post__fx");
    var FX = global.PIA_CARD_EFFECTS || {};
    var rec = FX[postId];
    var effs = (rec && rec.effects) ? rec.effects : [];

    var head = el("div", "post__fx-head");
    head.appendChild(el("span", "post__fx-title", "卡牌效果"));
    if (rec && rec.support) head.appendChild(el("span", "post__fx-support", "輔助"));
    if (rec && rec.retain) head.appendChild(el("span", "post__fx-retain", "保留"));
    wrap.appendChild(head);

    if (!effs.length) {
      wrap.appendChild(el("div", "post__fx-empty", "（無特殊效果，僅基礎攻擊＝讚數）"));
      return wrap;
    }
    var list = el("div", "post__fx-list");
    for (var i = 0; i < effs.length; i++) {
      var lab = (effs[i] && effs[i].label) ? effs[i].label : (effs[i] && effs[i].kind) || "效果";
      list.appendChild(el("span", "post__fx-eff", lab));
    }
    wrap.appendChild(list);
    return wrap;
  }

  // 預覽卡（id/name/type/traffic/immoral/unlock/prereq）。
  function buildPostPreview(post) {
    var card = el("div", "post post--preview");

    var phead = el("div", "post__head");
    var avatar = el("div", "post__avatar", "P");
    phead.appendChild(avatar);
    var who = el("div", "post__who");
    who.appendChild(el("div", "post__handle", SF.State.account.handle));
    var sub = el("div", "post__sub");
    sub.appendChild(el("span", null, "預覽"));
    who.appendChild(sub);
    phead.appendChild(who);
    var typeEl = el("span", "post__type", post.type);
    typeEl.setAttribute("data-type", post.type);
    phead.appendChild(typeEl);
    phead.appendChild(el("span", "post__id", post.id));
    card.appendChild(phead);

    // 標題後方附上貼文編號，方便與配方表對照。
    card.appendChild(el("div", "post__title", (post.name || "（未命名）") + "（" + post.id + "）"));

    if (post.type === "image") {
      card.appendChild(el("div", "post__media", "圖片貼文"));
    }

    // badges：traffic + immoral
    var badges = el("div", "post__badges");
    var tb = el("span", "badge badge--traffic " + trafficClass(post.trafficTier));
    tb.appendChild(el("span", null, "流量 " + trafficLabel(post)));
    if (post.trafficStars) tb.appendChild(el("span", "badge__stars", post.trafficStars));
    badges.appendChild(tb);
    if (post.immoralEvidence) {
      badges.appendChild(el("span", "badge badge--immoral", "背德證據"));
    }
    card.appendChild(badges);

    // 卡牌效果（排行榜挑戰用）：顯示此貼文對應的卡牌效果（window.PIA_CARD_EFFECTS）。
    card.appendChild(buildCardEffects(post.id));

    // meta：route / unlockChunk / prereq
    var meta = el("div", "post__meta");
    if (post.route) meta.appendChild(metaKv("路線", post.route));
    if (post.unlockChunk) meta.appendChild(metaKv("解鎖Chunk", post.unlockChunk));
    if (post.prereq) meta.appendChild(metaKv("前置", post.prereq));
    if (post.category) meta.appendChild(metaKv("分類", post.category));
    if (post.relatedNpc) meta.appendChild(metaKv("關聯NPC", post.relatedNpc));
    if (post.relatedChar) meta.appendChild(metaKv("關聯角色", post.relatedChar));
    if (meta.childNodes.length) card.appendChild(meta);

    return card;
  }

  function metaKv(k, v) {
    var s = el("span", null);
    s.appendChild(document.createTextNode(k + "："));
    s.appendChild(el("b", null, v));
    return s;
  }

  // ===========================================================================
  // Tab 3：動態（Feed）
  // ===========================================================================
  function renderFeed() {
    var root = panels.feed;
    clear(root);

    var head = el("div", "panel__head");
    head.appendChild(el("h2", "panel__title", "動態"));
    head.appendChild(el("p", "panel__hint", "貼文隨時間擴散；推進時鐘看成長與漲粉。"));
    root.appendChild(head);

    // 時間資訊（時間控制按鈕已移至頂列）。
    var toolbar = el("div", "toolbar");
    var clockInfo = el("span", "muted",
      "Day " + SF.State.clock.day + " · " + SF.State.clock.ticks + "h · 共 " + SF.State.feed.length + " 則");
    toolbar.appendChild(clockInfo);
    toolbar.appendChild(el("span", "spacer"));
    toolbar.appendChild(el("span", "muted", "（時間控制在上方頂列）"));
    root.appendChild(toolbar);

    var feed = SF.State.feed;
    if (feed.length === 0) {
      var empty = el("div", "empty");
      empty.appendChild(el("span", "big", "📭"));
      empty.appendChild(el("p", null, "尚無貼文，去「發文」分頁發布第一則吧。"));
      root.appendChild(empty);
      return;
    }

    var list = el("div", "feed");
    var now = SF.State.nowTicks();
    // 反序（最新在上）。
    for (var i = feed.length - 1; i >= 0; i--) {
      list.appendChild(buildFeedCard(feed[i], now));
    }
    root.appendChild(list);
  }

  function buildFeedCard(entry, now) {
    var post = SF.Data.postById(entry.postId);
    if (!post) {
      var bad = el("div", "post");
      bad.appendChild(el("div", "post__title", "（缺失貼文 " + entry.postId + "）"));
      return bad;
    }

    var stats = SF.Algorithm.compute(entry, SF.State.account, now);
    var card = el("div", "post");

    // head
    var phead = el("div", "post__head");
    var srcClass = entry.source === "npc" ? "npc" : (entry.source === "event" ? "event" : "player");
    phead.appendChild(el("div", "post__avatar", srcClass === "player" ? "P" : "N"));
    var who = el("div", "post__who");
    var handle = entry.source === "player" ? SF.State.account.handle : ("@" + (post.relatedNpc || post.relatedChar || "npc"));
    who.appendChild(el("div", "post__handle", handle));
    var sub = el("div", "post__sub");
    var tpd = (SF.Algorithm.params && SF.Algorithm.params.TICKS_PER_DAY) || 24;
    var ageDays = Math.max(0, (now - entry.postedTick) / tpd);
    sub.appendChild(el("span", null, "發布於 " + ageDays.toFixed(1) + " 天前"));
    var srcPill = el("span", "src src--" + srcClass, entry.source);
    sub.appendChild(srcPill);
    who.appendChild(sub);
    phead.appendChild(who);
    var typeEl = el("span", "post__type", post.type);
    typeEl.setAttribute("data-type", post.type);
    phead.appendChild(typeEl);
    phead.appendChild(el("span", "post__id", post.id));
    card.appendChild(phead);

    // title
    card.appendChild(el("div", "post__title", post.name || "（未命名）"));
    if (post.type === "image") card.appendChild(el("div", "post__media", "圖片貼文"));

    // badges
    var badges = el("div", "post__badges");
    var tb = el("span", "badge badge--traffic " + trafficClass(post.trafficTier));
    tb.appendChild(el("span", null, "流量 " + trafficLabel(post)));
    if (post.trafficStars) tb.appendChild(el("span", "badge__stars", post.trafficStars));
    badges.appendChild(tb);
    if (post.immoralEvidence) badges.appendChild(el("span", "badge badge--immoral", "背德證據"));
    card.appendChild(badges);

    // stat row
    var statRow = el("div", "stats");
    statRow.appendChild(statItem("like", "❤", stats.likes));
    statRow.appendChild(statItem("comment", "💬", stats.comments));
    statRow.appendChild(statItem("share", "🔁", stats.shares));
    statRow.appendChild(statItem("view", "👁", stats.views));
    card.appendChild(statRow);

    // reach line
    var reach = el("div", "post__reach");
    reach.appendChild(document.createTextNode("觸及 "));
    reach.appendChild(el("span", "reach-num", abbr(stats.reach)));
    var fg = el("span", "fg", "+" + abbr(stats.followerGain) + " 粉");
    reach.appendChild(fg);
    card.appendChild(reach);

    return card;
  }

  function statItem(kind, icon, val) {
    var s = el("div", "stat stat--" + kind);
    s.appendChild(el("span", "stat__icon", icon));
    s.appendChild(el("span", "stat__val", abbr(val)));
    return s;
  }

  // ===========================================================================
  // Tab 4：演算法參數
  // ===========================================================================
  // 參數欄位定義（分組 + 描述 + 範圍）。對齊 SF.Algorithm.params。
  var PARAM_GROUPS = [
    { title: "時間", fields: [
      { key: "TICKS_PER_DAY", label: "TICKS_PER_DAY", min: 1, max: 48, step: 1, desc: "1 天的 ticks 數（1 tick = 1 小時）" }
    ]},
    { title: "種子（fan base → 起跑觸及）", fields: [
      { key: "followerReachRate", label: "followerReachRate", min: 0, max: 1, step: 0.01, desc: "自然觸及率：每篇先投放 followers×此比例" },
      { key: "discoveryFloor", label: "discoveryFloor", min: 0, max: 500, step: 5, desc: "冷啟動曝光底（無粉也有的探索流量）" }
    ]},
    { title: "曝光度（Traffic tier 倍率）", fields: [
      { key: "tierExposure", label: "tierExposure", triple: ["Low", "Med", "High"], min: 0, max: 8, step: 0.1, desc: "同時影響擴散速率 r 與容量上限 Carry" }
    ]},
    { title: "擴散（logistic）", fields: [
      { key: "baseGrowthRate", min: 0, max: 2, step: 0.01, desc: "基礎每日擴散速率 r0" },
      { key: "viralGain", min: 0, max: 5, step: 0.05, desc: "互動率 → 病毒係數放大" },
      { key: "amplifyMax", min: 0, max: 30, step: 0.5, desc: "容量相對種子的最大倍數" },
      { key: "saturateDays", min: 1, max: 60, step: 1, desc: "觀察視窗天數" }
    ]},
    { title: "互動漏斗（reach → 各指標）", fields: [
      { key: "ctrBase", min: 0, max: 0.5, step: 0.005, desc: "基礎互動率（觸及→互動）" },
      { key: "likeRate", min: 0, max: 0.5, step: 0.005, desc: "觸及→讚" },
      { key: "shareRate", min: 0, max: 0.3, step: 0.002, desc: "觸及→分享（< like）" },
      { key: "viewRate", min: 0, max: 1, step: 0.01, desc: "觸及→瀏覽（> 讚 > 分享）" },
      { key: "shareAmplify", min: 0, max: 8, step: 0.1, desc: "每次分享再帶來的觸及（社群迴路 1）" }
    ]},
    { title: "漲粉回饋（社群迴路 2）", fields: [
      { key: "followerConvRate", min: 0, max: 0.05, step: 0.0005, desc: "觸及→新粉絲（隨 reach 成長）" },
      { key: "followerBaseGain", min: 0, max: 100, step: 1, desc: "每篇漲粉基數（再乘流量倍率 E）：救初期/低粉" },
      { key: "followerRampDays", min: 0.1, max: 7, step: 0.1, desc: "基數在發文後幾天內漸進到位（越小越快）" }
    ]},
    { title: "品質與抖動", fields: [
      { key: "qualityImmoralBonus", min: 0, max: 1, step: 0.01, desc: "背德/結局加成" },
      { key: "jitterRatio", min: 0, max: 0.3, step: 0.005, desc: "確定性抖動幅度（±）" }
    ]}
  ];

  function renderParams() {
    var root = panels.params;
    clear(root);

    var head = el("div", "panel__head");
    head.appendChild(el("h2", "panel__title", "演算法參數"));
    head.appendChild(el("p", "panel__hint", "即時調整擴散模型參數；下方曲線同步重繪。"));
    root.appendChild(head);

    var toolbar = el("div", "toolbar");
    toolbar.appendChild(el("span", "spacer"));
    var resetBtn = el("button", "btn btn--danger btn--sm", "重置參數");
    resetBtn.onclick = function () {
      SF.Algorithm.params = SF.Algorithm.defaultParams();
      SF.State.recompute();
      renderParams();
      renderTopbar();
      toast("已重置演算法參數");
    };
    toolbar.appendChild(resetBtn);
    root.appendChild(toolbar);

    var gridWrap = el("div", "params");

    for (var g = 0; g < PARAM_GROUPS.length; g++) {
      var grp = PARAM_GROUPS[g];
      var gtitle = el("div", "param-group");
      gtitle.appendChild(el("div", "param-group__title", grp.title));
      gridWrap.appendChild(gtitle);

      for (var f = 0; f < grp.fields.length; f++) {
        gridWrap.appendChild(buildParamControl(grp.fields[f]));
      }
    }

    // 模擬曲線（canvas）。
    gridWrap.appendChild(buildSim());

    root.appendChild(gridWrap);

    // 首繪曲線。
    drawSim();
  }

  function buildParamControl(field) {
    var params = SF.Algorithm.params;
    var box = el("div", "param");

    var top = el("div", "param__top");
    top.appendChild(el("span", "param__name", field.label || field.key));
    var valEl = el("span", "param__val");
    box.appendChild(top);

    if (field.triple) {
      // 陣列（tierExposure）：三個 number input。
      valEl.textContent = "[" + params[field.key].join(", ") + "]";
      top.appendChild(valEl);

      var triple = el("div", "param__triple");
      for (var i = 0; i < field.triple.length; i++) {
        (function (idx) {
          var cell = el("div");
          cell.appendChild(el("label", null, field.triple[idx]));
          var inp = document.createElement("input");
          inp.type = "number";
          inp.min = field.min; inp.max = field.max; inp.step = field.step;
          inp.value = params[field.key][idx];
          inp.oninput = function () {
            var v = parseFloat(inp.value);
            if (isNaN(v)) return;
            params[field.key][idx] = v;
            valEl.textContent = "[" + params[field.key].join(", ") + "]";
            onParamChanged();
          };
          cell.appendChild(inp);
          triple.appendChild(cell);
        })(i);
      }
      box.appendChild(triple);
    } else {
      // 數值：slider + number 互綁。
      valEl.textContent = fmtNum(params[field.key]);
      top.appendChild(valEl);

      var row = el("div", "param__row");
      var range = document.createElement("input");
      range.type = "range";
      range.min = field.min; range.max = field.max; range.step = field.step;
      range.value = params[field.key];
      updateRangeFill(range);

      var num = document.createElement("input");
      num.type = "number";
      num.className = "param__num";
      num.min = field.min; num.max = field.max; num.step = field.step;
      num.value = params[field.key];

      range.oninput = function () {
        var v = parseFloat(range.value);
        params[field.key] = v;
        num.value = v;
        valEl.textContent = fmtNum(v);
        updateRangeFill(range);
        onParamChanged();
      };
      num.oninput = function () {
        var v = parseFloat(num.value);
        if (isNaN(v)) return;
        params[field.key] = v;
        range.value = v;
        valEl.textContent = fmtNum(v);
        updateRangeFill(range);
        onParamChanged();
      };

      row.appendChild(range);
      row.appendChild(num);
      box.appendChild(row);
    }

    if (field.desc) box.appendChild(el("div", "param__desc", field.desc));
    return box;
  }

  function fmtNum(v) {
    if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(v);
    return Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function updateRangeFill(range) {
    var min = parseFloat(range.min), max = parseFloat(range.max), val = parseFloat(range.value);
    var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    range.style.setProperty("--fill", pct + "%");
  }

  // 參數改變：重算漲粉、更新頂列、重繪曲線（但不整頁重繪，避免 input 失焦）。
  function onParamChanged() {
    SF.State.recompute();
    renderTopbar();
    drawSim();
  }

  // ---- 模擬曲線 ------------------------------------------------------------
  function buildSim() {
    var sim = el("div", "sim");
    var shead = el("div", "sim__head");
    shead.appendChild(el("div", "sim__title", "成長曲線模擬（觸及 reach）"));
    var controls = el("div", "sim__controls");
    controls.appendChild(el("span", "muted", "實線＝1.2K 粉 · 虛線＝150 粉"));
    shead.appendChild(controls);
    sim.appendChild(shead);

    var wrap = el("div", "sim__canvas-wrap");
    var canvas = document.createElement("canvas");
    canvas.id = "simCanvas";
    canvas.width = 900;
    canvas.height = 360;
    wrap.appendChild(canvas);
    sim.appendChild(wrap);

    var legend = el("div", "sim__legend");
    var days = (SF.Algorithm.params.saturateDays || 14);
    legend.appendChild(legendItem("low", "Low 流量"));
    legend.appendChild(legendItem("med", "Medium 流量"));
    legend.appendChild(legendItem("high", "High 流量"));
    legend.appendChild(el("span", "legend-item", days + " 天視窗"));
    sim.appendChild(legend);

    return sim;
  }

  function legendItem(cls, text) {
    var item = el("span", "legend-item");
    item.appendChild(el("span", "legend-swatch " + cls));
    item.appendChild(document.createTextNode(text));
    return item;
  }

  // 畫一則貼文在 3 種 traffic tier × 2 種粉絲基數下的 reach 曲線。
  function drawSim() {
    var canvas = $("simCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    var padL = 56, padR = 20, padT = 18, padB = 34;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    var params = SF.Algorithm.params;
    var days = Math.max(1, params.saturateDays || 14);
    var tpd = params.TICKS_PER_DAY > 0 ? params.TICKS_PER_DAY : 24;
    var STEPS = 80;

    var tiers = [0, 1, 2];
    var tierColors = ["#6b7585", "#38bdf8", "#fb7185"]; // low/med/high
    var bases = [
      { F: 1200, dash: [] },   // 實線
      { F: 150, dash: [5, 4] } // 虛線
    ];

    // 先掃一次求 y 最大值（取所有曲線最高 reach）。
    function curveReach(tier, F, dayT) {
      var entry = {
        postId: "__sim_t" + tier,           // 穩定 id → 抖動確定
        postedTick: 0,
        followersAtPost: F
      };
      // 暫時覆蓋 trafficTier：用一個假的 post 解析。compute 透過 SF.Data.postById
      // 取 trafficTier；模擬用 id 不存在 → compute 內 tier 退回 1。為精確控制 tier，
      // 改為直接覆蓋：建立一個 inline 解析（見下方 simCompute）。
      return simReach(tier, F, dayT, params, tpd);
    }

    var yMax = 1;
    var series = [];
    for (var bi = 0; bi < bases.length; bi++) {
      for (var ti = 0; ti < tiers.length; ti++) {
        var pts = [];
        for (var s = 0; s <= STEPS; s++) {
          var dayT = (s / STEPS) * days;
          var rv = curveReach(tiers[ti], bases[bi].F, dayT);
          pts.push({ x: dayT, y: rv });
          if (rv > yMax) yMax = rv;
        }
        series.push({ pts: pts, color: tierColors[tiers[ti]], dash: bases[bi].dash });
      }
    }
    yMax *= 1.08;

    // 背景格線 + 軸。
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "#828da0";
    ctx.font = "11px -apple-system, 'Segoe UI', sans-serif";
    ctx.lineWidth = 1;

    var yTicks = 4;
    for (var g = 0; g <= yTicks; g++) {
      var yy = padT + plotH - (g / yTicks) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(W - padR, yy);
      ctx.stroke();
      var label = SF.Algorithm.abbreviate((g / yTicks) * yMax);
      ctx.textAlign = "right";
      ctx.fillText(label, padL - 8, yy + 4);
    }
    // x 軸刻度（天）。
    var xTicks = Math.min(days, 7);
    ctx.textAlign = "center";
    for (var xg = 0; xg <= xTicks; xg++) {
      var dval = (xg / xTicks) * days;
      var xx = padL + (dval / days) * plotW;
      ctx.fillText("D" + Math.round(dval), xx, H - 12);
    }

    // 畫曲線。
    function plotX(dayT) { return padL + (dayT / days) * plotW; }
    function plotY(val) { return padT + plotH - (val / yMax) * plotH; }

    for (var si = 0; si < series.length; si++) {
      var ser = series[si];
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ser.color;
      ctx.setLineDash(ser.dash);
      for (var p = 0; p < ser.pts.length; p++) {
        var px = plotX(ser.pts[p].x), py = plotY(ser.pts[p].y);
        if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 模擬版 reach：複刻 §4.3 logistic，但 tier 為直接參數（不靠 SF.Data 解析）。
  // 與 SF.Algorithm.compute 數學一致；品質抖動以固定 seed 取（不背德、無時間相依）。
  function simReach(tier, F, dayT, p, tpd) {
    var exposure = p.tierExposure || [1.0, 1.8, 3.2];
    var tIdx = tier < 0 ? 0 : (tier > exposure.length - 1 ? exposure.length - 1 : tier);
    var E = exposure[tIdx];
    if (F < 0) F = 0;

    // quality（不背德；抖動以穩定 seed，使曲線可重現）。
    var simId = "__sim_t" + tIdx;
    var qJit = (SF.Algorithm.hash01(SF.Algorithm.seed(simId, "q")) * 2 - 1) * 0.15;
    var quality = clamp01(0.5 + qJit);

    var seedReach = F * p.followerReachRate + p.discoveryFloor * E;
    if (seedReach < 1) seedReach = 1;

    var engageRate = clamp(p.ctrBase * (0.6 + quality), 0, 0.5);
    var viralK = engageRate * E * p.viralGain;
    var r = p.baseGrowthRate * (1 + viralK);

    var Carry = seedReach * (1 + p.amplifyMax * E * quality);
    Carry *= (1 + p.shareRate * p.shareAmplify * quality);
    if (Carry < seedReach) Carry = seedReach;

    var ratio = (Carry - seedReach) / seedReach;
    var reach = Carry / (1 + ratio * Math.exp(-r * dayT));
    if (!isFinite(reach) || reach < seedReach) reach = seedReach;
    return reach;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v, 0, 1); }

  // ===========================================================================
  // Tab 5：排行榜挑戰（委派給 SF.CardGameUI）
  // ===========================================================================
  function renderCardgame() {
    if (SF.CardGameUI && typeof SF.CardGameUI.render === "function") {
      SF.CardGameUI.render();
    }
  }

  // ===========================================================================
  // 全域控制
  // ===========================================================================
  function init() {
    // 面板容器。
    panels.inventory = $("panel-inventory");
    panels.compose = $("panel-compose");
    panels.feed = $("panel-feed");
    panels.cardgame = $("panel-cardgame");
    panels.params = $("panel-params");

    // 分頁按鈕。
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.onclick = function () { setActiveTab(btn.getAttribute("data-tab")); };
      })(tabs[i]);
    }

    // 頂列時間控制（快進 / 下一天）—— 移至頂列，不再放在 Feed 分頁內。
    var ffBtn = $("btnFastForward");
    if (ffBtn) ffBtn.onclick = function () { SF.State.advance(6); SF.State.save(); };
    var ndBtn = $("btnNextDay");
    if (ndBtn) ndBtn.onclick = function () { SF.State.nextDay(); SF.State.save(); };

    // 重置存檔。
    var resetBtn = $("btnResetSave");
    if (resetBtn) {
      resetBtn.onclick = function () {
        if (global.confirm && !global.confirm("確定要重置存檔？所有解鎖、貼文與排行榜挑戰進度將清空。")) return;
        _selected = [];
        SF.State.reset();
        // 同時重置排行榜挑戰（牌庫、對手 runtime 粉絲、擊敗旗標）。
        if (SF.CardGame && typeof SF.CardGame.reset === "function") SF.CardGame.reset();
        toast("已重置存檔", "ok");
        renderAll();
      };
    }

    // 狀態變更 → 重繪當前面板 + 頂列。
    SF.State.onChange(function () {
      renderTopbar();
      renderActivePanel();
    });

    renderAll();
  }

  function renderAll() {
    renderTopbar();
    setActiveTab(_activeTab);
  }

  SF.App = {
    init: init,
    setActiveTab: setActiveTab
  };

})(typeof window !== "undefined" ? window : this);
