/* =============================================================================
 * recipes.js — SF.Recipes
 * 鏡像 Unity `PIAPlayerPostComposer`：詞條集合 → 配方 → 貼文 的比對引擎。
 *
 * 核心概念（與 Unity 一致）：
 *   - 「簽章（signature）」＝把一組詞條名稱排序後以 "," 串接，順序無關。
 *   - 每則 post 的 `recipes` 是「替代配方群組（any-of）」陣列，每個群組內部是
 *     「all-of」的詞條清單。對每個群組各建一條簽章 → { postId, recipeIndex }。
 *   - 精確集合命中（exact-set match）：玩家選取的詞條集合簽章 === 某配方簽章。
 *   - 同簽章衝突取「先掃到者」（first-seen wins，與 Unity 一致），但 console.warn
 *     列出衝突的 post id 供企劃檢查。
 *
 * 必須先呼叫 SF.Recipes.build() 建表，之後查詢才有效。
 * 依賴：SF.Data（data.js）— 取得 posts 清單。
 * =========================================================================== */
(function (global) {
  "use strict";

  var SF = global.SF = global.SF || {};

  // 內部建表狀態 -------------------------------------------------------------
  // signatureMap: signature(string) -> { postId, recipeIndex }（先掃到者勝）
  var _signatureMap = null;
  // tagToPosts: tagName(string) -> post[]（含此詞條的所有貼文，去重、保序）
  var _tagToPosts = null;
  // allRecipeTags: 所有配方群組中出現過的詞條名稱集合（getCompatibleTags 空選取用）
  var _allRecipeTags = null;
  var _built = false;

  /**
   * 把一組詞條名稱轉成順序無關的簽章字串。
   * 排序後以 "," 串接。重複名稱會在排序後保留（鏡像 Unity 直接 join 行為；
   * 正常資料無重複詞條，呼叫端 tryMatch 也應傳入集合）。
   *
   * @param {string[]} tagNames
   * @returns {string}
   */
  function signature(tagNames) {
    if (!tagNames || tagNames.length === 0) return "";
    // 複製後排序，避免污染呼叫端陣列。
    var arr = tagNames.slice();
    arr.sort();
    return arr.join(",");
  }

  /**
   * 建表：掃描全部 posts，對每則 post 的每個替代配方群組各登記一條簽章。
   * 同簽章衝突 → 保留先掃到者，並 console.warn 列出衝突 id。
   * 可重複呼叫（會重建，供 reset / 測試使用）。
   *
   * @returns {object} SF.Recipes（方便鏈式呼叫）
   */
  function build() {
    _signatureMap = Object.create(null);
    _tagToPosts = Object.create(null);
    _allRecipeTags = new Set();

    var posts = (SF.Data && SF.Data.posts) ? SF.Data.posts : [];

    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var groups = post && post.recipes ? post.recipes : [];

      // 追蹤本 post 已加入 tagToPosts 的詞條，避免同一 post 因多群組重複入列。
      var seenTagsForPost = Object.create(null);

      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!group || group.length === 0) continue;

        var sig = signature(group);

        // ---- 簽章建表（先掃到者勝）----
        if (Object.prototype.hasOwnProperty.call(_signatureMap, sig)) {
          var existing = _signatureMap[sig];
          // 衝突：保留既有，警告列出雙方 id（含 recipeIndex 方便定位）。
          console.warn(
            "[SF.Recipes] 配方簽章衝突（取先掃到者）：簽章 \"" + sig + "\" — " +
            "保留 " + existing.postId + " (recipe#" + existing.recipeIndex + ")，" +
            "忽略 " + post.id + " (recipe#" + g + ")"
          );
          // 不覆寫，維持 first-seen。
        } else {
          _signatureMap[sig] = { postId: post.id, recipeIndex: g };
        }

        // ---- tagToPosts 與 allRecipeTags 收集 ----
        for (var t = 0; t < group.length; t++) {
          var tagName = group[t];
          _allRecipeTags.add(tagName);

          if (!Object.prototype.hasOwnProperty.call(seenTagsForPost, tagName)) {
            seenTagsForPost[tagName] = true;
            if (!_tagToPosts[tagName]) _tagToPosts[tagName] = [];
            _tagToPosts[tagName].push(post);
          }
        }
      }
    }

    _built = true;
    return SF.Recipes;
  }

  /** 確保已建表；未建表時警告並嘗試自動建一次（防呆，不取代正式 build 流程）。 */
  function _ensureBuilt() {
    if (!_built) {
      console.warn("[SF.Recipes] 查詢前尚未呼叫 build()，已自動建表。請於初始化階段呼叫 SF.Recipes.build()。");
      build();
    }
  }

  /**
   * 精確集合比對：把選取詞條轉成簽章，命中某配方則回傳 { post, recipeIndex }。
   *
   * @param {string[]} selectedTagNames
   * @returns {{ post: object, recipeIndex: number } | null}
   */
  function tryMatch(selectedTagNames) {
    _ensureBuilt();
    if (!selectedTagNames || selectedTagNames.length === 0) return null;

    var sig = signature(selectedTagNames);
    if (!Object.prototype.hasOwnProperty.call(_signatureMap, sig)) return null;

    var hit = _signatureMap[sig];
    var post = SF.Data.postById(hit.postId);
    if (!post) return null;
    return { post: post, recipeIndex: hit.recipeIndex };
  }

  /**
   * 漸進過濾：回傳「仍能朝某配方前進」的候選詞條。
   *   - 對每個配方群組 r：若 current ⊆ r，則把 (r \ current) 併入結果。
   *   - 空選取時 → 回所有配方中出現過的詞條聯集。
   * 與 Unity 規則一致。
   *
   * @param {string[]} currentTagNames
   * @returns {Set<string>}
   */
  function getCompatibleTags(currentTagNames) {
    _ensureBuilt();

    // 空選取：回所有配方詞條聯集（新建一份，避免外部修改內部集合）。
    if (!currentTagNames || currentTagNames.length === 0) {
      return new Set(_allRecipeTags);
    }

    // 將 current 轉為 Set 以利子集合判斷與差集計算。
    var current = new Set(currentTagNames);
    var result = new Set();

    var posts = (SF.Data && SF.Data.posts) ? SF.Data.posts : [];
    for (var i = 0; i < posts.length; i++) {
      var groups = posts[i].recipes || [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!group || group.length === 0) continue;

        // current ⊆ group 嗎？current 內每個詞條都要在 group 中。
        var isSubset = true;
        // 先用一個 Set 加速 group 查找。
        var groupSet = new Set(group);
        current.forEach(function (name) {
          if (!groupSet.has(name)) isSubset = false;
        });
        if (!isSubset) continue;

        // group \ current 併入結果。
        for (var t = 0; t < group.length; t++) {
          var name = group[t];
          if (!current.has(name)) result.add(name);
        }
      }
    }

    return result;
  }

  /**
   * 「可組成文章」過濾：回傳「與 current 一起、且只用 available（已解鎖）詞條，
   * 就能湊成某個完整配方」的下一步候選詞條。
   *   - 對每個配方群組 r：需 current ⊆ r，且 r 完全落在 (available ∪ current) 內
   *     （= 該配方可被實際完成），才把 (r \ current) 併入結果。
   *   - available 省略時退化為 getCompatibleTags（不檢查解鎖、只看子集合可前進）。
   * 與 getCompatibleTags 的差別：本函式排除「雖然子集合相容、但其餘詞條尚未解鎖、
   * 永遠湊不出文章」的詞條，符合「能與現有詞條組合出文章」的語意。
   *
   * @param {string[]} currentTagNames  已選詞條
   * @param {string[]} [availableTagNames]  可用（已解鎖）詞條
   * @returns {Set<string>}
   */
  function getCompletableTags(currentTagNames, availableTagNames) {
    _ensureBuilt();

    var current = new Set(currentTagNames || []);
    var available = availableTagNames ? new Set(availableTagNames) : null;
    var result = new Set();

    var posts = (SF.Data && SF.Data.posts) ? SF.Data.posts : [];
    for (var i = 0; i < posts.length; i++) {
      var groups = posts[i].recipes || [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!group || group.length === 0) continue;

        var groupSet = new Set(group);

        // current ⊆ group？
        var ok = true;
        current.forEach(function (n) { if (!groupSet.has(n)) ok = false; });
        if (!ok) continue;

        // 配方需可完成：group 每個詞條都在 available 或 current 中。
        if (available) {
          for (var t = 0; t < group.length; t++) {
            var n = group[t];
            if (!current.has(n) && !available.has(n)) { ok = false; break; }
          }
          if (!ok) continue;
        }

        // group \ current 併入候選。
        for (var t2 = 0; t2 < group.length; t2++) {
          var nm = group[t2];
          if (!current.has(nm)) result.add(nm);
        }
      }
    }

    return result;
  }

  /**
   * 回傳任一配方群組含此詞條的所有貼文（UI 提示用）。
   * 去重、保 posts 原始順序；無命中回空陣列。
   *
   * @param {string} tagName
   * @returns {object[]}
   */
  function matchesForTag(tagName) {
    _ensureBuilt();
    if (!tagName) return [];
    var list = _tagToPosts[tagName];
    return list ? list.slice() : [];
  }

  // 公開 API ----------------------------------------------------------------
  SF.Recipes = {
    signature: signature,
    build: build,
    tryMatch: tryMatch,
    getCompatibleTags: getCompatibleTags,
    getCompletableTags: getCompletableTags,
    matchesForTag: matchesForTag
  };

})(typeof window !== "undefined" ? window : this);
