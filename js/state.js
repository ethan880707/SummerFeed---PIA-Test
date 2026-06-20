/* =============================================================================
 * state.js — SF.State
 * 帳號 / 詞條庫存 / feed / 時鐘（SPEC §3.4 / §4.5）。
 *
 * 對應 Unity：
 *   account       ← PIAAccountRuntime / Resolver（粉絲 fan base）
 *   tagInventory  ← PIATagInventory（已解鎖詞條集合）
 *   feed          ← PIAFeed（已發布貼文序列）
 *   clock         ← 時間（ticks，1 tick = 1 小時；TICKS_PER_DAY = 24）
 *
 * 設計原則（對齊「GameData 可存檔」目標）：
 *   - 序列化只存「純值 + Articy/資料 id」，不存演進中的衍生值。
 *   - followerDelta 不持久演進；每次 recompute() 由各 feed 貼文之
 *     Algorithm.compute(...).followerGain 在當下時間重新加總得出。
 *   - publish 當下對 entry.followersAtPost 做粉絲快照，確保重算一致（§4.5）。
 *
 * 凍結簽章（SPEC §3.4）。依賴：SF.Algorithm（重算漲粉）、SF.Data（驗證 postId）。
 * ============================================================================= */
(function (global) {
  "use strict";

  var SF = global.SF = global.SF || {};

  // localStorage 鍵與存檔版本。
  var STORAGE_KEY = "summerfeed.state.v1";
  var SAVE_VERSION = 1;

  // 1 day = TICKS_PER_DAY（與 Algorithm.params.TICKS_PER_DAY 對齊；此處取常數預設）。
  function ticksPerDay() {
    var p = SF.Algorithm && SF.Algorithm.params;
    var v = p && typeof p.TICKS_PER_DAY === "number" ? p.TICKS_PER_DAY : 24;
    return v > 0 ? v : 24;
  }

  // ---- onChange 廣播 --------------------------------------------------------
  var _listeners = [];
  function emit() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) { console.error("[SF.State] onChange listener error", e); }
    }
  }

  // ---- 種子初始狀態 ---------------------------------------------------------
  // 玩家帳號：handle '@player'、基礎粉絲 0（從零開始養帳號）。
  function seedAccount() {
    return { handle: "@player", baseFollowers: 0, followerDelta: 0 };
  }

  // 初始 Feed 為空：帳號從 0 粉、無貼文開始，靠玩家發文與漲粉飛輪成長。
  function seedFeed() {
    return [];
  }

  var State = {
    // ---- 公開狀態（SPEC §3.4） ---------------------------------------------
    account: seedAccount(),
    tagInventory: new Set(),
    feed: [],
    clock: { day: 1, ticks: 0 },

    // 今日是否已發過玩家貼文（每天一篇限制；nextDay 重置）。
    _postedToday: false,

    // ---- 帳號 / 粉絲 -------------------------------------------------------
    /** followers = baseFollowers + followerDelta */
    followers: function () {
      return Math.round((this.account.baseFollowers || 0) + (this.account.followerDelta || 0));
    },

    // ---- 詞條庫存 ----------------------------------------------------------
    unlock: function (name) {
      if (!name) return;
      if (!this.tagInventory.has(name)) {
        this.tagInventory.add(name);
        emit();
      }
    },
    lock: function (name) {
      if (!name) return;
      if (this.tagInventory.has(name)) {
        this.tagInventory.delete(name);
        emit();
      }
    },
    unlockAll: function () {
      var tags = (SF.Data && SF.Data.tags) ? SF.Data.tags : [];
      for (var i = 0; i < tags.length; i++) {
        if (tags[i] && tags[i].name) this.tagInventory.add(tags[i].name);
      }
      emit();
    },
    isUnlocked: function (name) {
      return this.tagInventory.has(name);
    },

    // ---- 時鐘 --------------------------------------------------------------
    /** 目前絕對時間（ticks）。 */
    nowTicks: function () {
      return (this.clock.day - 1) * ticksPerDay() + this.clock.ticks;
    },

    /** 推進時間（ticks）；跨日時自動進位 day 並重置今日已發文旗標。 */
    advance: function (ticks) {
      var add = Math.max(0, Math.floor(Number(ticks) || 0));
      if (add === 0) { this.recompute(); emit(); return; }
      var tpd = ticksPerDay();
      var total = this.clock.ticks + add;
      var dayGain = Math.floor(total / tpd);
      this.clock.ticks = total % tpd;
      if (dayGain > 0) {
        this.clock.day += dayGain;
        this._postedToday = false; // 跨日後可再發文
      }
      this.recompute();
      emit();
    },

    /** 推進整整一天並重置今日已發文。 */
    nextDay: function () {
      this.clock.day += 1;
      this.clock.ticks = 0;
      this._postedToday = false;
      this.recompute();
      emit();
    },

    // ---- 發文 --------------------------------------------------------------
    /** 今日是否還能發玩家貼文（每天一篇）。 */
    canPostToday: function () {
      return !this._postedToday;
    },

    /**
     * 發布一則貼文。source 預設 'player'。
     * - player 來源受「每天一篇」限制；非 player（npc/event）不受限。
     * - 發布當下對 followersAtPost 做粉絲快照（§4.5）。
     * @returns {object|null} entry，或受限/無效時 null。
     */
    publish: function (postId, source) {
      source = source || "player";
      if (!postId) return null;
      if (SF.Data && SF.Data.postById && !SF.Data.postById(postId)) {
        console.warn("[SF.State] publish 未知 postId：" + postId);
        return null;
      }
      if (source === "player" && !this.canPostToday()) {
        return null;
      }

      var entry = {
        postId: postId,
        postedTick: this.nowTicks(),
        source: source,
        followersAtPost: this.followers() // 快照（§4.5）
      };
      this.feed.push(entry);
      if (source === "player") this._postedToday = true;

      this.recompute();
      emit();
      return entry;
    },

    /**
     * 測試用：一鍵發布（解鎖）全部貼文至 feed（source="player"），忽略「每天一篇」限制。
     * 與詞條庫存的 unlockAll() 對應；供排行榜挑戰快速備齊牌庫測試。
     * @returns {number} 本次新增的貼文數
     */
    publishAll: function () {
      var posts = (SF.Data && SF.Data.posts) ? SF.Data.posts : [];
      var existing = Object.create(null);
      for (var i = 0; i < this.feed.length; i++) existing[this.feed[i].postId] = true;
      var now = this.nowTicks();
      var snap = this.followers();
      var added = 0;
      for (var j = 0; j < posts.length; j++) {
        var p = posts[j];
        if (!p || typeof p.id !== "string" || existing[p.id]) continue;
        this.feed.push({ postId: p.id, postedTick: now, source: "player", followersAtPost: snap });
        existing[p.id] = true;
        added++;
      }
      if (added > 0) { this.recompute(); emit(); }
      return added;
    },

    // ---- 漲粉重算（§4.5） --------------------------------------------------
    /**
     * followerDelta = Σ(各 feed 貼文之 Algorithm.compute(...).followerGain) 於當下時間。
     * 不逐筆存演進值；每次推進 / 重繪呼叫此函式重算。
     */
    recompute: function () {
      var now = this.nowTicks();
      var delta = 0;
      if (SF.Algorithm && typeof SF.Algorithm.compute === "function") {
        for (var i = 0; i < this.feed.length; i++) {
          var entry = this.feed[i];
          var r = SF.Algorithm.compute(entry, this.account, now);
          delta += (r && typeof r.followerGain === "number") ? r.followerGain : 0;
        }
      }
      this.account.followerDelta = delta;
      return delta;
    },

    // ---- 重置 --------------------------------------------------------------
    reset: function () {
      this.account = seedAccount();
      this.tagInventory = new Set();
      this.feed = seedFeed();
      this.clock = { day: 1, ticks: 0 };
      this._postedToday = false;
      this.recompute();
      try { global.localStorage && global.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      this.save();
      emit();
    },

    // ---- 序列化（純值 + id） -----------------------------------------------
    save: function () {
      try {
        if (!global.localStorage) return;
        var data = {
          v: SAVE_VERSION,
          account: {
            handle: this.account.handle,
            baseFollowers: this.account.baseFollowers
            // followerDelta 不存：屬衍生值，load 後由 recompute 還原。
          },
          tags: Array.from(this.tagInventory),
          feed: this.feed.map(function (e) {
            return {
              postId: e.postId,
              postedTick: e.postedTick,
              source: e.source,
              followersAtPost: e.followersAtPost
            };
          }),
          clock: { day: this.clock.day, ticks: this.clock.ticks },
          postedToday: this._postedToday
        };
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("[SF.State] save 失敗", e);
      }
    },

    /**
     * 從 localStorage 載入；無存檔則初始化種子狀態並存一次。
     * 載入後一律 recompute（followerDelta 為衍生值，不從存檔取）。
     */
    load: function () {
      var raw = null;
      try { raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY); }
      catch (e) { raw = null; }

      if (!raw) {
        // 首次：種子狀態。
        this.account = seedAccount();
        this.tagInventory = new Set();
        this.feed = seedFeed();
        this.clock = { day: 1, ticks: 0 };
        this._postedToday = false;
        this.recompute();
        this.save();
        return this;
      }

      try {
        var data = JSON.parse(raw);

        this.account = seedAccount();
        if (data.account) {
          if (typeof data.account.handle === "string") this.account.handle = data.account.handle;
          if (typeof data.account.baseFollowers === "number") this.account.baseFollowers = data.account.baseFollowers;
        }

        this.tagInventory = new Set(Array.isArray(data.tags) ? data.tags : []);

        this.feed = [];
        if (Array.isArray(data.feed)) {
          for (var i = 0; i < data.feed.length; i++) {
            var e = data.feed[i];
            if (!e || typeof e.postId !== "string") continue;
            // 過濾掉資料中不存在的 postId（資料更新後的容錯）。
            if (SF.Data && SF.Data.postById && !SF.Data.postById(e.postId)) continue;
            this.feed.push({
              postId: e.postId,
              postedTick: typeof e.postedTick === "number" ? e.postedTick : 0,
              source: typeof e.source === "string" ? e.source : "player",
              followersAtPost: typeof e.followersAtPost === "number" ? e.followersAtPost : (this.account.baseFollowers || 0)
            });
          }
        }

        this.clock = { day: 1, ticks: 0 };
        if (data.clock) {
          if (typeof data.clock.day === "number" && data.clock.day >= 1) this.clock.day = data.clock.day;
          if (typeof data.clock.ticks === "number" && data.clock.ticks >= 0) this.clock.ticks = data.clock.ticks;
        }

        this._postedToday = !!data.postedToday;
      } catch (e) {
        console.warn("[SF.State] load 解析失敗，改用種子狀態", e);
        this.account = seedAccount();
        this.tagInventory = new Set();
        this.feed = seedFeed();
        this.clock = { day: 1, ticks: 0 };
        this._postedToday = false;
      }

      this.recompute(); // followerDelta 為衍生值，載入後重算。
      return this;
    },

    // ---- 變更廣播 ----------------------------------------------------------
    onChange: function (cb) {
      if (typeof cb === "function" && _listeners.indexOf(cb) === -1) {
        _listeners.push(cb);
      }
      return function off() {
        var idx = _listeners.indexOf(cb);
        if (idx !== -1) _listeners.splice(idx, 1);
      };
    }
  };

  SF.State = State;
})(typeof window !== "undefined" ? window : this);
