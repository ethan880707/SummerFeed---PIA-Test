/* =============================================================================
 * SF.Data — DataStore（索引、查詢）
 * SPEC §3.1
 *
 * 從 window.PIA_DB（由 data/db.js 提供）建立索引：
 *   - tagByName  : Map<name, tag>
 *   - postById   : Map<id, post>
 *   - tagTypes   : tag.type 的固定排序陣列
 *   - postTypes  : post.type 的固定排序陣列
 *   - tagsByType / postsByType
 *
 * 對應 Unity：PIATagInventory / PIAFeed 的資料來源層（唯讀）。
 *
 * 凍結簽章（不得變動）：
 *   SF.Data.init() -> SF.Data
 *   SF.Data.tags / SF.Data.posts
 *   SF.Data.tagByName(name) -> tag|null
 *   SF.Data.postById(id) -> post|null
 *   SF.Data.tagTypes / SF.Data.tagsByType(type) -> tag[]
 *   SF.Data.postTypes / SF.Data.postsByType(type) -> post[]
 * ============================================================================= */
(function (global) {
  "use strict";

  // 確保全域命名空間存在。
  var SF = global.SF || (global.SF = {});

  // 依 SPEC §3.1 凍結的型別顯示／列舉順序。
  // 任何不在此清單中的 type 會被附加到尾端（容錯，理論上不會發生）。
  var TAG_TYPE_ORDER = ["地點", "共通", "NPC專屬", "劇情"];
  var POST_TYPE_ORDER = ["story", "image", "text", "filler", "npc"];

  /**
   * 依「指定順序優先、其餘照出現序」對實際出現過的型別做排序。
   * @param {string[]} present 實際資料中出現過的型別（去重後）
   * @param {string[]} order   偏好順序
   * @returns {string[]}
   */
  function orderTypes(present, order) {
    var result = [];
    var seen = Object.create(null);
    var i, t;
    // 先放偏好順序中、且實際存在的型別。
    for (i = 0; i < order.length; i++) {
      t = order[i];
      if (present.indexOf(t) !== -1 && !seen[t]) {
        result.push(t);
        seen[t] = true;
      }
    }
    // 再補上偏好順序外、但實際存在的型別（保持原出現序）。
    for (i = 0; i < present.length; i++) {
      t = present[i];
      if (!seen[t]) {
        result.push(t);
        seen[t] = true;
      }
    }
    return result;
  }

  var Data = {
    // ---- 公開資料（init 後填入） ---------------------------------------------
    tags: [],
    posts: [],
    gates: [],
    tagTypes: [],
    postTypes: [],

    // ---- 內部狀態 ------------------------------------------------------------
    _initialized: false,
    _tagByName: null,   // Map<string, tag>
    _postById: null,    // Map<string, post>
    _tagsByType: null,  // Map<string, tag[]>
    _postsByType: null, // Map<string, post[]>

    /**
     * 從 window.PIA_DB 建立所有索引。
     * 冪等：重複呼叫不會重建，直接回傳同一個 SF.Data。
     * @returns {object} SF.Data
     */
    init: function () {
      if (this._initialized) {
        return this;
      }

      var db = global.PIA_DB;
      if (!db) {
        throw new Error("[SF.Data] window.PIA_DB 不存在；請確認 data/db.js 在 data.js 之前載入。");
      }

      this.tags = Array.isArray(db.tags) ? db.tags : [];
      this.posts = Array.isArray(db.posts) ? db.posts : [];
      this.gates = Array.isArray(db.gates) ? db.gates : [];

      // --- 建立主鍵索引 -------------------------------------------------------
      var tagByName = new Map();
      var tagsByType = new Map();
      var tagTypesPresent = [];
      var i, tag, post, type;

      for (i = 0; i < this.tags.length; i++) {
        tag = this.tags[i];
        if (!tag || typeof tag.name !== "string") {
          continue;
        }
        // 主鍵＝name（唯一）。若意外重覆，警告並保留先掃到者（與 Unity 一致）。
        if (tagByName.has(tag.name)) {
          console.warn("[SF.Data] 重複的 tag.name：" + tag.name + "（保留先出現者）");
        } else {
          tagByName.set(tag.name, tag);
        }

        type = tag.type;
        if (!tagsByType.has(type)) {
          tagsByType.set(type, []);
          tagTypesPresent.push(type);
        }
        tagsByType.get(type).push(tag);
      }

      var postById = new Map();
      var postsByType = new Map();
      var postTypesPresent = [];

      for (i = 0; i < this.posts.length; i++) {
        post = this.posts[i];
        if (!post || typeof post.id !== "string") {
          continue;
        }
        // 主鍵＝id（唯一，跨類型不重覆）。
        if (postById.has(post.id)) {
          console.warn("[SF.Data] 重複的 post.id：" + post.id + "（保留先出現者）");
        } else {
          postById.set(post.id, post);
        }

        type = post.type;
        if (!postsByType.has(type)) {
          postsByType.set(type, []);
          postTypesPresent.push(type);
        }
        postsByType.get(type).push(post);
      }

      this._tagByName = tagByName;
      this._postById = postById;
      this._tagsByType = tagsByType;
      this._postsByType = postsByType;

      // tagTypes / postTypes 採固定偏好順序。
      this.tagTypes = orderTypes(tagTypesPresent, TAG_TYPE_ORDER);
      this.postTypes = orderTypes(postTypesPresent, POST_TYPE_ORDER);

      this._initialized = true;
      return this;
    },

    /**
     * 以 name（hashtag 字串）查 tag。
     * @param {string} name
     * @returns {object|null}
     */
    tagByName: function (name) {
      if (!this._tagByName) {
        return null;
      }
      var t = this._tagByName.get(name);
      return t === undefined ? null : t;
    },

    /**
     * 以 id 查 post。
     * @param {string} id
     * @returns {object|null}
     */
    postById: function (id) {
      if (!this._postById) {
        return null;
      }
      var p = this._postById.get(id);
      return p === undefined ? null : p;
    },

    /**
     * 取得某型別的所有 tag（依原始載入序）。
     * 回傳的是內部陣列的淺拷貝，避免呼叫端意外改動索引。
     * @param {string} type
     * @returns {object[]}
     */
    tagsByType: function (type) {
      if (!this._tagsByType) {
        return [];
      }
      var arr = this._tagsByType.get(type);
      return arr ? arr.slice() : [];
    },

    /**
     * 取得某型別的所有 post（依原始載入序）。
     * @param {string} type
     * @returns {object[]}
     */
    postsByType: function (type) {
      if (!this._postsByType) {
        return [];
      }
      var arr = this._postsByType.get(type);
      return arr ? arr.slice() : [];
    }
  };

  SF.Data = Data;
})(typeof window !== "undefined" ? window : this);
