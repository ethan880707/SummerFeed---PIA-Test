/* =============================================================================
 * algorithm.js — SF.Algorithm
 * 社群演算法成長模型（SPEC §3.3 / §4）。
 *
 * 對應 Unity：PIAStats + PIAGrowthConfig（強化版）。
 * 本模組將 Unity 的簡易飽和曲線升級為「類社群演算法」的 logistic 擴散模型：
 *   粉絲基數(fan base) → 起跑種子 seed
 *   流量分級(Traffic)  → 曝光度 E（同時抬高擴散速率 r 與容量 Carry）
 *   社群迴路           → 分享放大 (shareAmplify) + 漲粉回饋 (followerConv)
 *
 * 嚴格要求：compute() 為純函式、確定性。
 *   - 不使用 Math.random。
 *   - 所有抖動只來自 hash01(seed(postId, metric))，且不含時間 → 隨天數單調。
 *   - 相同 (entry, account 狀態, nowTicks) 必得相同整數結果。
 *
 * 全域命名空間：window.SF.Algorithm
 * 依賴：SF.Data.postById（解析貼文），於 compute 時讀取。
 * ========================================================================== */
(function (global) {
  'use strict';

  var SF = global.SF = global.SF || {};

  // ---------------------------------------------------------------------------
  // 預設參數（§4.2 表，逐欄對齊，數值不得偏離）
  // ---------------------------------------------------------------------------
  function defaultParams() {
    // 回傳一份「深拷貝」的全新物件，供 UI 重置使用（陣列亦需獨立複製）。
    return {
      TICKS_PER_DAY:      24,        // 1 tick = 1 小時（時間以 ticks 計）

      // 種子（fan base → 起跑觸及）
      followerReachRate:  0.18,      // 自然觸及率：每篇先投放 followers*此比例
      discoveryFloor:     80,        // 冷啟動曝光底（無粉也有的探索流量）

      // 曝光度（Traffic tier 倍率）—— 同時影響「擴散速率 r」與「容量上限 Carry」
      tierExposure:       [1.0, 1.8, 3.2], // Low / Medium / High

      // 擴散（logistic）
      baseGrowthRate:     0.45,      // 基礎每日擴散速率 r0
      viralGain:          1.6,       // 互動率 → 病毒係數的放大
      amplifyMax:         9.0,       // 容量相對種子的最大倍數（高互動高曝光可達）
      saturateDays:       14,        // 觀察視窗（曲線大致在此天數內走完）

      // 互動漏斗（reach → 各指標），quality 調變
      ctrBase:            0.06,      // 基礎互動率（觸及→互動）
      likeRate:           0.2,       // 觸及→讚
      shareRate:          0.022,     // 觸及→分享（< like）
      viewRate:           0.62,      // 觸及→瀏覽（瀏覽 > 讚 > 分享）
      shareAmplify:       2.4,       // 每次分享再帶來的觸及（社群迴路 1）

      // 漲粉回饋（社群迴路 2）
      followerConvRate:   0.08,      // 觸及→新粉絲（隨 reach 成長）
      followerBaseGain:   18,        // 每篇「漲粉基數」（再乘流量倍率 E）：救初期/低粉
      followerRampDays:   1.0,       // 基數在發文後幾天內漸進到位（越小越快）

      // 品質（每則貼文固定，影響互動率）：背德/結局加成 + 確定性抖動
      qualityImmoralBonus: 0.25,
      jitterRatio:         0.06      // ±6% 確定性抖動（種子＝hash(postId,metric)）
    };
  }

  // ---------------------------------------------------------------------------
  // 工具：32-bit 無號運算（鏡像 Unity 之 unchecked uint 行為）
  // ---------------------------------------------------------------------------
  // JS 的位元運算為帶號 32-bit；用 >>> 0 還原為無號，用 Math.imul 做 32-bit 乘法。
  function mul32(a, b) { return Math.imul(a >>> 0, b >>> 0) >>> 0; }

  // 將字串 postId（如 "A1"、"B7a"）穩定映射為 32-bit 無號整數。
  // Unity 端 PostId 為 ulong；本 demo 的 id 為字串，故先以 FNV-1a 衍生數值鍵，
  // 再餵入與 Unity 一致的 Seed/Hash01 混合流程，確保確定性且分佈良好。
  function postKey(postId) {
    var s = String(postId == null ? '' : postId);
    var h = 2166136261 >>> 0;        // FNV-1a offset basis
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = mul32(h, 16777619);        // FNV prime
    }
    return h >>> 0;
  }

  // metric salt：字串/數字皆可。對齊 PIAStats 的整數 salt 概念。
  // 'l'/'like'=0, 's'/'share'=1, 'v'/'view'=2, 其餘以字元碼累加，確保穩定唯一。
  function metricSalt(metric) {
    if (typeof metric === 'number') return metric | 0;
    switch (metric) {
      case 'l': case 'like':  case 'likes':  return 0;
      case 's': case 'share': case 'shares': return 1;
      case 'v': case 'view':  case 'views':  return 2;
      default: break;
    }
    var m = String(metric == null ? '' : metric);
    var acc = 0;
    for (var i = 0; i < m.length; i++) acc = (acc + m.charCodeAt(i) * (i + 1)) | 0;
    return acc;
  }

  // seed(postId, metricSalt)：鏡像 PIAStats.Seed（以 64-bit 概念，於 JS 用兩個
  // 32-bit lane 模擬高低位混合）。回傳一個 32-bit 帶號整數（與 Unity 回傳 int 對齊）。
  // Unity:
  //   ulong h = postId * 1099511628211;
  //   h ^= (ulong)metricSalt * 2654435761;
  //   return (int)(h ^ (h >> 32));
  function seed(postId, metricSaltArg) {
    var key = postKey(postId);                 // 取代 ulong postId
    var salt = metricSalt(metricSaltArg) >>> 0;

    // postId * 1099511628211 —— 以 32-bit lane 拆解此 64-bit 質數乘法。
    // 1099511628211 = 0x100000001B3 → 高 lane = 0x100, 低 lane = 0x000001B3
    var P_LO = 0x000001B3 >>> 0;   // 435
    var P_HI = 0x00000100 >>> 0;   // 256（對應 << 32 的部分）
    var loP = mul32(key, P_LO);                    // 低 32 位乘積（取低）
    var hiP = (mul32(key, P_HI) + mulHi32(key, P_LO)) >>> 0; // 高 32 位累積

    // salt * 2654435761（Knuth）：取其高低 lane 進行 XOR。
    var SK = 2654435761 >>> 0;
    var loS = mul32(salt, SK);
    var hiS = mulHi32(salt, SK);

    var lo = (loP ^ loS) >>> 0;
    var hi = (hiP ^ hiS) >>> 0;

    // return (int)(h ^ (h >> 32)) → 低 lane XOR 高 lane
    var mixed = (lo ^ hi) >>> 0;
    return mixed | 0;   // 轉回帶號 int（與 Unity int 一致）
  }

  // 32-bit 無號乘法的「高 32 位」（mulhi）。用於模擬 64-bit 乘法的進位。
  function mulHi32(a, b) {
    a = a >>> 0; b = b >>> 0;
    var aL = a & 0xFFFF, aH = a >>> 16;
    var bL = b & 0xFFFF, bH = b >>> 16;
    var ll = aL * bL;
    var lh = aL * bH;
    var hl = aH * bL;
    var hh = aH * bH;
    var cross = (lh >>> 0) + (hl >>> 0) + (ll >>> 16);
    var hi = (hh >>> 0) + (cross >>> 16) + 0;
    return hi >>> 0;
  }

  // hash01(seed)：鏡像 PIAStats.Hash01，回傳 [0,1)。
  // Unity:
  //   uint x = (uint)seed * 2654435761;
  //   x ^= x >> 15; x *= 2246822519;
  //   x ^= x >> 13; x *= 3266489917;
  //   x ^= x >> 16;
  //   return (x & 0xFFFFFF) / (float)0x1000000;
  function hash01(seedVal) {
    var x = mul32(seedVal >>> 0, 2654435761);
    x = (x ^ (x >>> 15)) >>> 0; x = mul32(x, 2246822519);
    x = (x ^ (x >>> 13)) >>> 0; x = mul32(x, 3266489917);
    x = (x ^ (x >>> 16)) >>> 0;
    return (x & 0xFFFFFF) / 0x1000000;
  }

  // ---------------------------------------------------------------------------
  // 數字縮寫（鏡像 PIAStats.Abbreviate）：1234 → "1.2K"，3_400_000 → "3.4M"
  // ---------------------------------------------------------------------------
  function abbreviate(num) {
    var n = Math.round(Number(num) || 0);
    var neg = n < 0;
    var a = Math.abs(n);
    var out;
    if (a < 1000) {
      out = String(a);
    } else if (a < 1000000) {
      out = (a / 1000).toFixed(1) + 'K';
    } else {
      out = (a / 1000000).toFixed(1) + 'M';
    }
    return neg ? '-' + out : out;
  }

  // ---------------------------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v, 0, 1); }

  // jitter(id,m) = 1 + (hash01(seed(id,m))*2 - 1) * jitterRatio
  // 不含時間 → 隨天數單調，不逐日跳動。
  function jitter(postId, metric, jitterRatio) {
    return 1 + (hash01(seed(postId, metric)) * 2 - 1) * jitterRatio;
  }

  // ---------------------------------------------------------------------------
  // compute(entry, account, nowTicks) — §4.3 數學，純函式 / 確定性
  // entry: { postId, postedTick, followersAtPost, ... }
  // account: { followers, ... }（fan base，於發布快照入 entry.followersAtPost）
  // nowTicks: 當下時間（ticks）
  // 回傳：{ views, likes, shares, comments, reach, followerGain }（皆整數）
  // ---------------------------------------------------------------------------
  function compute(entry, account, nowTicks) {
    var p = SF.Algorithm.params || defaultParams();

    // 解析貼文（透過 SF.Data.postById）
    var post = (SF.Data && typeof SF.Data.postById === 'function')
      ? SF.Data.postById(entry && entry.postId)
      : null;

    var postId = (entry && entry.postId != null) ? entry.postId
               : (post && post.id != null ? post.id : '');

    // t = max(0, (nowTicks - postedTick) / TICKS_PER_DAY)（天）
    var ticksPerDay = p.TICKS_PER_DAY > 0 ? p.TICKS_PER_DAY : 24;
    var postedTick = (entry && typeof entry.postedTick === 'number') ? entry.postedTick : 0;
    var t = Math.max(0, ((Number(nowTicks) || 0) - postedTick) / ticksPerDay);

    // tier：post.trafficTier ?? 1（null → Medium(1)）；夾在 tierExposure 有效範圍內
    var tier = (post && post.trafficTier != null) ? post.trafficTier : 1;
    var exposure = p.tierExposure || [1.0, 1.8, 3.2];
    if (tier < 0) tier = 0;
    if (tier > exposure.length - 1) tier = exposure.length - 1;
    var E = exposure[tier];

    // 兩種粉絲基數：
    //   Fdisp = 帳號「當下」粉絲數（base + delta）→ 顯示數據（reach/views/likes/shares）。
    //           ★ 修正：舊貼文的流量/讚數會隨帳號粉絲成長而更新，而非永遠停在發文當下的數字。
    //   Fgrow = 發布當下快照（entry.followersAtPost）→ 漲粉(followerGain)。
    //           保留快照是為了避免「漲粉 → 粉絲變多 → reach 變大 → 更多漲粉」於 recompute 內循環爆衝。
    var Fgrow = (entry && typeof entry.followersAtPost === 'number') ? entry.followersAtPost : 0;
    if (Fgrow < 0) Fgrow = 0;
    var Fdisp;
    if (account && (typeof account.baseFollowers === 'number' || typeof account.followerDelta === 'number')) {
      Fdisp = (account.baseFollowers || 0) + (account.followerDelta || 0);
    } else if (account && typeof account.followers === 'number') {
      Fdisp = account.followers; // 容錯：合成 account
    } else {
      Fdisp = Fgrow;
    }
    if (Fdisp < 0) Fdisp = 0;

    // immoral 旗標
    var immoral = !!(post && post.immoralEvidence);

    // quality = clamp01( 0.5 + (immoral?bonus:0) + (hash01(seed(id,'q'))*2-1)*0.15 )
    var qJit = (hash01(seed(postId, 'q')) * 2 - 1) * 0.15;
    var quality = clamp01(0.5 + (immoral ? p.qualityImmoralBonus : 0) + qJit);

    // engageRate / viralK / r（與粉絲基數無關，兩種 reach 共用）
    var engageRate = clamp(p.ctrBase * (0.6 + quality), 0, 0.5);
    var viralK = engageRate * E * p.viralGain;
    var r = p.baseGrowthRate * (1 + viralK);

    // 依給定粉絲基數算 logistic 觸及（seed = Fval*followerReachRate + discoveryFloor*E）。
    function reachFrom(Fval) {
      var sr = Fval * p.followerReachRate + p.discoveryFloor * E;
      if (sr < 1) sr = 1;
      var carry = sr * (1 + p.amplifyMax * E * quality);
      carry *= (1 + p.shareRate * p.shareAmplify * quality);
      if (carry < sr) carry = sr;
      var rat = (carry - sr) / sr;
      var rch = carry / (1 + rat * Math.exp(-r * t));
      if (!isFinite(rch) || rch < sr) rch = sr;
      return rch;
    }

    var reach = reachFrom(Fdisp);       // 顯示用觸及（當下粉絲）
    var reachGrow = reachFrom(Fgrow);   // 漲粉用觸及（發布快照）

    // 互動漏斗（reach → 各指標），含確定性抖動（不含時間 → 隨天數單調）
    var jr = p.jitterRatio;
    var views    = Math.round(reach * p.viewRate  * jitter(postId, 'v', jr));
    var likes    = Math.round(reach * p.likeRate  * jitter(postId, 'l', jr));
    var shares   = Math.round(reach * p.shareRate * jitter(postId, 's', jr));

    // comments：UI 顯示用，取 round(likes*0.06)，留言不成長
    var comments = Math.round(likes * 0.06);

    // followerGain = 漲粉基數（依流量 E、隨 t 漸進到位）+ 觸及回饋（用發布快照 reachGrow）
    var rampDays = p.followerRampDays > 0 ? p.followerRampDays : 1;
    var followerSat = 1 - Math.exp(-t / rampDays);          // 0 → 1，隨天數單調
    var followerBase = (p.followerBaseGain || 0) * E * followerSat;
    var followerGain = Math.round(followerBase + reachGrow * p.followerConvRate * quality);

    return {
      views:        views   < 0 ? 0 : views,
      likes:        likes   < 0 ? 0 : likes,
      shares:       shares  < 0 ? 0 : shares,
      comments:     comments < 0 ? 0 : comments,
      reach:        Math.round(reach),
      followerGain: followerGain < 0 ? 0 : followerGain
    };
  }

  // ---------------------------------------------------------------------------
  // 公開 API（凍結簽章，SPEC §3.3）
  // ---------------------------------------------------------------------------
  SF.Algorithm = {
    params:        defaultParams(),   // UI 參數面板雙向綁定的可調參數物件
    defaultParams: defaultParams,     // 回傳一份全新預設（重置用，深拷貝）
    compute:       compute,           // (entry, account, nowTicks) -> {...}
    abbreviate:    abbreviate,        // 數字縮寫
    hash01:        hash01,            // 確定性抖動 [0,1)
    seed:          seed               // 內部種子（postId, metricSalt）— 鏡像 PIAStats
  };

})(typeof window !== 'undefined' ? window : this);
