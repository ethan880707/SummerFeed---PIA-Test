# 排行榜挑戰 (Leaderboard Card Battle) — FROZEN SPEC v1

> This is the single binding contract. All build agents MUST obey names, signatures, file
> names, load order and numbers exactly as written here. Where the four source designs
> disagreed, this document is the resolution; the rejected alternative is noted inline.
>
> Constraints (non-negotiable): ZERO-dependency, ZERO-build, `file://`-safe (double-click
> `index.html`). NO `fetch` / XHR / ES-modules / `import` / `Math.random` / `Date.now`.
> Every new JS file is an IIFE attaching to `window.SF` (logic) or `window.PIA_*` (data),
> using the canonical wrapper:
> ```js
> (function (global) { "use strict";
>   var SF = global.SF = global.SF || {};
>   /* ... */ SF.Xxx = { /* ... */ };
> })(typeof window !== "undefined" ? window : this);
> ```

---

## §0. Overview & 5th-tab placement

A turn-based card mini-game. The player builds a deck from their own published posts
(`SF.State.feed` entries with `source==="player"`), challenges a 10-opponent leaderboard,
and on victory steals a tag or followers.

- **5th tab**, placed **immediately to the RIGHT of「動態 Feed」** and LEFT of「演算法參數」.
  - `data-tab="cardgame"`, label **「排行榜挑戰」**.
  - RESOLUTION: Design 3 places it right of Feed (label 排行榜挑戰); Design 4 placed it
    after 演算法參數 (label 卡牌對戰). **We adopt Design 3's position and label** (matches the
    literal task requirement "right of 動態 Feed").
- All in-game screens live inside the **single** `#panel-cardgame` section. The mini-game
  has its OWN internal sub-view state machine (`SF.CardGameUI._view`); it does NOT create
  additional browser top-level tabs or routing.
- Card "讚數" (likes) come from `SF.Algorithm.compute(entry, SF.State.account,
  SF.State.nowTicks()).likes`, **snapshotted** at deck-build and re-snapshotted at
  battle-start, then **frozen for the whole battle** (never recomputed per round).

### Module split (FROZEN — Design 4 wins: engine/UI are separate files)

| Concern | Global | File |
|---|---|---|
| Pure data | `window.PIA_OPPONENTS` | `data/opponents.js` |
| Engine + persisted state (NO DOM) | `SF.CardGame` | `js/cardgame.js` |
| DOM controller for `#panel-cardgame` | `SF.CardGameUI` | `js/cardgame-ui.js` |
| Styles (`cg-*` only) | — | `styles-cardgame.css` |

RESOLUTION: Design 3 proposed putting all logic in one `js/cardgame.js` exporting
`SF.CardGameUI`. Design 4 split engine (`SF.CardGame`) from UI (`SF.CardGameUI`). **We adopt
the split** — it is cleaner, Unity-portable, and lets persistence/determinism live in a
DOM-free engine. So there are **two** new JS files plus data + CSS.

---

## §1. File list & load order

### 1.1 New files (4)

| File (absolute under project root) | Role |
|---|---|
| `data/opponents.js` | sets `window.PIA_OPPONENTS` (Array length 10). Pure literal, no logic. |
| `js/cardgame.js` | defines `SF.CardGame`. Pure engine + persisted state. **No `document`.** |
| `js/cardgame-ui.js` | defines `SF.CardGameUI`. DOM controller. May reference `SF.App`. |
| `styles-cardgame.css` | `cg-*` classes only, reuse `:root` tokens. **Do NOT touch `styles.css`.** |

### 1.2 `index.html` edits

**Edit A — `<head>`, after line 8** (`<link rel="stylesheet" href="styles.css" />`):
```html
  <link rel="stylesheet" href="styles-cardgame.css" />
```

**Edit B — tabbar (`<nav class="tabbar">`), insert between line 47 (feed) and line 48 (params):**
```html
      <button class="tab" data-tab="feed">動態 Feed</button>
      <button class="tab" data-tab="cardgame">排行榜挑戰</button>   <!-- NEW: right of Feed -->
      <button class="tab" data-tab="params">演算法參數</button>
```

**Edit C — `<main class="panels">`, insert between line 57 (feed) and line 58 (params):**
```html
      <section class="panel" id="panel-feed"></section>
      <section class="panel" id="panel-cardgame"></section>   <!-- NEW -->
      <section class="panel" id="panel-params"></section>
```

**Edit D — script block (lines 72–77).** Final order:
```html
  <script src="data/db.js"></script>
  <script src="data/opponents.js"></script>   <!-- NEW: after db.js (contiguous data layer) -->
  <script src="js/data.js"></script>
  <script src="js/algorithm.js"></script>
  <script src="js/recipes.js"></script>
  <script src="js/state.js"></script>
  <script src="js/cardgame.js"></script>       <!-- NEW: after state.js & algorithm.js, before app.js -->
  <script src="js/app.js"></script>
  <script src="js/cardgame-ui.js"></script>    <!-- NEW: after app.js (references SF.App) -->
```
Rationale: engine methods call `SF.State.*`/`SF.Algorithm.*` at call-time, so strict
definition-time ordering is not required; positions chosen are correct and
self-documenting. `data/opponents.js` is a bare global literal (no IIFE required), placed
beside `data/db.js`.

**Edit E — bottom init IIFE (lines 80–87):**
```html
  <script>
    (function () {
      SF.Data.init();
      SF.Recipes.build();
      SF.State.load();
      SF.CardGame.load();      // NEW: after State.load (overlays runtime, reads player row)
      SF.App.init();
      SF.CardGameUI.init();    // NEW: after App.init (App owns tab wiring & panels map)
    })();
  </script>
```

### 1.3 `js/app.js` edits (3, minimal — `setActiveTab` already generic)

`init()` wires all `.tab` via `querySelectorAll(".tab")` and `setActiveTab` toggles all
`panels` keys, so a 5th tab works once registered. No change to `setActiveTab` itself.

**Edit 1 — register panel in `init()` (after line 1008 `panels.params = $("panel-params");`):**
```js
    panels.cardgame = $("panel-cardgame");
```

**Edit 2 — add case in `renderActivePanel()` switch (between the `feed` and `params` cases, lines 116–117):**
```js
      case "feed":      renderFeed();       break;
      case "cardgame":  renderCardgame();   break;   // NEW
      case "params":    renderParams();     break;
```

**Edit 3 — thin delegate at module scope (near other `render*` functions):**
```js
  function renderCardgame() {
    if (SF.CardGameUI && typeof SF.CardGameUI.render === "function") {
      SF.CardGameUI.render();
    }
  }
```
`SF.App` export list is UNCHANGED (`{init, setActiveTab}`). The existing
`SF.State.onChange` listener (app.js ~line 1037) calls `renderActivePanel()`, which only
fires `renderCardgame` when the cardgame tab is active (gated by `_activeTab`) — safe.

---

## §2. `data/opponents.js` — `window.PIA_OPPONENTS`

### 2.1 Shape (frozen keys — reconciled across Designs 1/2/4)

```js
window.PIA_OPPONENTS = [ /* exactly 10 */
  {
    id:            "OPP01",   // string, unique, STABLE (persistence key)
    name:          "顯示名",   // display
    handle:        "@handle", // display
    avatar:        "T",       // single char / short string for avatar bubble
    followers:     6500000,   // SEED followers. Runtime current value lives in SF.CardGame state, NOT here.
    hp:            650000,    // battle HP = round(followers * config.OPP_HP_FOLLOWER_RATIO) = followers*0.10
    theme:         "風格描述", // flavor (display only)
    posts: [                  // 3–4 posts; each post IS a battle card
      { id:"OPP01-P1", name:"貼文標題", tags:["#城市","#深夜"], likes:260000, frac:0.04 }
      // ...
    ]
  }
  // ... 9 more, sorted however; leaderboard() sorts by current followers DESC at runtime.
];
```

RESOLUTION of the opponent model conflict:
- Design 1/2/3 use **`opponent.posts[]`** where each post carries its own pre-baked `likes`
  (and `tags`), and the opponent plays cards round-robin by `round % posts.length`.
- Design 4 used `deck:[postId...]` referencing the player DB + a separate `rewardTags`.
- **We adopt the Design 1/2/3 `posts[]` model.** It is self-contained (no dependency on
  `PIA_DB` post ids existing), the `likes` are authored directly, and `tags` double as the
  steal-tag reward pool. Field `frac` is informational (likes ÷ followers) and may be
  ignored by code.

Constraints the data file MUST satisfy:
- `id` unique across all 10.
- `hp === round(followers * 0.10)`.
- Each post `likes === round(followers * frac)`, `frac` varied per post in `[0.04, 0.09]`
  so each opponent has weak/strong cards (avg ≈ 0.06).
- Every tag in every `posts[].tags` MUST be a real `SF.Data.tagByName(name)` name
  (validated at reward time; misses are skipped).
- 3–4 posts per opponent.

### 2.2 FINAL 10-opponent roster (Design 2, adopted verbatim)

```js
window.PIA_OPPONENTS = [
  {
    "id": "OPP01", "name": "TaiwanIcon 官方帳號", "handle": "@TaiwanIcon_official",
    "avatar": "T", "followers": 6500000, "hp": 650000, "theme": "跨界天后級全民偶像",
    "posts": [
      { "id": "OPP01-P1", "name": "城市夜景", "tags": ["#城市", "#深夜"], "likes": 260000, "frac": 0.04 },
      { "id": "OPP01-P2", "name": "真實的我", "tags": ["#真實", "#自拍"], "likes": 390000, "frac": 0.06 },
      { "id": "OPP01-P3", "name": "掀開帷幕", "tags": ["#掀開帷幕", "#慾望"], "likes": 520000, "frac": 0.08 },
      { "id": "OPP01-P4", "name": "蟬鳴夏夜", "tags": ["#蟬鳴", "#日常"], "likes": 325000, "frac": 0.05 }
    ]
  },
  {
    "id": "OPP02", "name": "健身狂魔 阿肌", "handle": "@musclemax_tw",
    "avatar": "肌", "followers": 1700000, "hp": 170000, "theme": "健身網紅",
    "posts": [
      { "id": "OPP02-P1", "name": "汗水見證", "tags": ["#汗水", "#肌肉痠痛"], "likes": 85000, "frac": 0.05 },
      { "id": "OPP02-P2", "name": "鐵的味道", "tags": ["#鐵的味道", "#巨巨的吼聲"], "likes": 119000, "frac": 0.07 },
      { "id": "OPP02-P3", "name": "拉筋日常", "tags": ["#拉筋", "#鏡中的自己"], "likes": 68000, "frac": 0.04 }
    ]
  },
  {
    "id": "OPP03", "name": "環島女子 小漫", "handle": "@wander_man",
    "avatar": "漫", "followers": 450000, "hp": 45000, "theme": "旅遊背包客",
    "posts": [
      { "id": "OPP03-P1", "name": "城市漫遊", "tags": ["#城市", "#街燈"], "likes": 27000, "frac": 0.06 },
      { "id": "OPP03-P2", "name": "深夜便利店", "tags": ["#便利商店", "#深夜"], "likes": 36000, "frac": 0.08 },
      { "id": "OPP03-P3", "name": "陌生街角", "tags": ["#陌生人", "#咖啡香"], "likes": 22500, "frac": 0.05 },
      { "id": "OPP03-P4", "name": "搬家那天", "tags": ["#搬家", "#房間一角"], "likes": 18000, "frac": 0.04 }
    ]
  },
  {
    "id": "OPP04", "name": "深夜食堂 阿食", "handle": "@midnight_eats",
    "avatar": "食", "followers": 120000, "hp": 12000, "theme": "美食帳",
    "posts": [
      { "id": "OPP04-P1", "name": "吃飽了", "tags": ["#吃飽了", "#便利商店"], "likes": 6000, "frac": 0.05 },
      { "id": "OPP04-P2", "name": "窗邊午餐", "tags": ["#窗邊", "#咖啡香"], "likes": 8400, "frac": 0.07 },
      { "id": "OPP04-P3", "name": "深夜街頭", "tags": ["#深夜", "#街燈"], "likes": 10800, "frac": 0.09 }
    ]
  },
  {
    "id": "OPP05", "name": "喵主子日記", "handle": "@nyan_diary",
    "avatar": "喵", "followers": 32000, "hp": 3200, "theme": "寵物貓奴帳",
    "posts": [
      { "id": "OPP05-P1", "name": "房間一角", "tags": ["#房間一角", "#自拍"], "likes": 1280, "frac": 0.04 },
      { "id": "OPP05-P2", "name": "無聊的夜晚", "tags": ["#無聊的夜晚", "#天花板"], "likes": 1920, "frac": 0.06 },
      { "id": "OPP05-P3", "name": "發呆時光", "tags": ["#發呆", "#窗邊"], "likes": 2560, "frac": 0.08 },
      { "id": "OPP05-P4", "name": "無所事事", "tags": ["#無所事事", "#日常"], "likes": 1600, "frac": 0.05 }
    ]
  },
  {
    "id": "OPP06", "name": "Cos 少女 莉莉", "handle": "@lily_cosplay",
    "avatar": "莉", "followers": 8500, "hp": 850, "theme": "cosplay",
    "posts": [
      { "id": "OPP06-P1", "name": "新造型", "tags": ["#新造型", "#自拍"], "likes": 425, "frac": 0.05 },
      { "id": "OPP06-P2", "name": "鏡中的自己", "tags": ["#鏡中的自己", "#理髮03"], "likes": 595, "frac": 0.07 },
      { "id": "OPP06-P3", "name": "校園午後", "tags": ["#校園午後", "#走廊"], "likes": 340, "frac": 0.04 }
    ]
  },
  {
    "id": "OPP07", "name": "咖啡因中毒者", "handle": "@brewdaily",
    "avatar": "咖", "followers": 2300, "hp": 230, "theme": "咖啡廳文青",
    "posts": [
      { "id": "OPP07-P1", "name": "咖啡香氣", "tags": ["#咖啡香", "#窗邊"], "likes": 138, "frac": 0.06 },
      { "id": "OPP07-P2", "name": "陌生人觀察", "tags": ["#陌生人", "#發呆"], "likes": 184, "frac": 0.08 },
      { "id": "OPP07-P3", "name": "某段文字", "tags": ["#某段文字", "#書頁的味道"], "likes": 115, "frac": 0.05 },
      { "id": "OPP07-P4", "name": "深夜城市", "tags": ["#深夜", "#城市"], "likes": 207, "frac": 0.09 }
    ]
  },
  {
    "id": "OPP08", "name": "釣魚大叔阿勇", "handle": "@uncle_fishing",
    "avatar": "勇", "followers": 950, "hp": 95, "theme": "釣魚大叔",
    "posts": [
      { "id": "OPP08-P1", "name": "烏魚季", "tags": ["#烏魚", "#街道04"], "likes": 48, "frac": 0.05 },
      { "id": "OPP08-P2", "name": "深夜出航", "tags": ["#深夜", "#街燈"], "likes": 67, "frac": 0.07 },
      { "id": "OPP08-P3", "name": "城市邊緣", "tags": ["#城市", "#便利商店"], "likes": 38, "frac": 0.04 }
    ]
  },
  {
    "id": "OPP09", "name": "圖書館幽靈", "handle": "@booknerd_ghost",
    "avatar": "書", "followers": 520, "hp": 52, "theme": "書蟲讀書帳",
    "posts": [
      { "id": "OPP09-P1", "name": "書頁的味道", "tags": ["#書頁的味道", "#某段文字"], "likes": 31, "frac": 0.06 },
      { "id": "OPP09-P2", "name": "圖書館午後", "tags": ["#圖書03", "#校園午後"], "likes": 42, "frac": 0.08 },
      { "id": "OPP09-P3", "name": "教室一角", "tags": ["#教室", "#走廊"], "likes": 26, "frac": 0.05 }
    ]
  },
  {
    "id": "OPP10", "name": "夏日罐頭", "handle": "@summer_canned",
    "avatar": "罐", "followers": 320, "hp": 32, "theme": "高中生隨手拍",
    "posts": [
      { "id": "OPP10-P1", "name": "教室日常", "tags": ["#教室", "#日常"], "likes": 16, "frac": 0.05 },
      { "id": "OPP10-P2", "name": "蟬鳴午後", "tags": ["#蟬鳴", "#校園午後"], "likes": 22, "frac": 0.07 },
      { "id": "OPP10-P3", "name": "走廊閒晃", "tags": ["#走廊", "#無所事事"], "likes": 29, "frac": 0.09 },
      { "id": "OPP10-P4", "name": "天花板發呆", "tags": ["#天花板", "#發呆"], "likes": 13, "frac": 0.04 }
    ]
  }
];
```

> NOTE on the ladder: a strict geometric step from 320 floor to "a few million" is
> mathematically impossible to hold constant; Design 2's pragmatic ramp (≈3.7–3.8× across
> the meaningful top, gentler 1.6–2.4× near the floor) is adopted because it keeps rank-10
> card likes in the "tens" beginner-winnable band, which is the binding gameplay
> constraint. Design 1's pure-geometric table is informational only; the real numbers are
> the roster above.

---

## §3. `SF.CardGame` API (engine — FROZEN)

**Architecture: STATEFUL singleton** (mirrors `SF.State`). Holds one persisted root state
(deck, opponent runtime overrides) plus at most one transient active battle object.
Stepping methods mutate `SF.CardGame.battle` in place and return it. Pure-reducer style is
rejected for consistency with `SF.State`.

**Determinism (MANDATORY):** all "randomness" (deck shuffle, opponent card pick, 3-tag
reward offer) derives from `SF.Algorithm.hash01(SF.Algorithm.seed(seedStr, salt))`.
NO `Math.random`, NO `Date.now`.

### 3.1 Config — `SF.CardGame.config` (every tunable number)

```js
SF.CardGame.config = {
  // ---- Deck building ----
  DECK_MIN:            7,      // min cards; player published posts < this -> cannot play
  DECK_MAX:           14,      // max cards in a deck
  // ---- Hand / play ----
  HAND_SIZE:           5,      // cards drawn into hand each DRAW phase
  PLAY_SIZE:           3,      // cards the player must play each round (other HAND_SIZE-PLAY_SIZE return to deck)
  // ---- HP ----
  PLAYER_HP:        6000,      // player fixed HP per battle (sized for FULL likes-delta damage)
  OPP_HP_FOLLOWER_RATIO: 0.10, // opponent HP = round(CURRENT followers * this) (dynamic, not baked)
  // ---- Damage ----
  DAMAGE_SCALE:       1.0,     // damage = round(|delta| * this); 1.0 = full likes difference (per spec)
  MIN_DAMAGE:           1,     // non-tie rounds deal at least this (avoids 0-damage stall)
  // ---- Opponent card likes (follower-derived + base; computed at battle time) ----
  // oppLikes = round(OPP_LIKES_BASE + CURRENT followers * post.frac * OPP_LIKES_FRAC_MULT)
  OPP_LIKES_BASE:       60,    // base likes every opponent card has, follower-independent
  OPP_LIKES_FRAC_MULT: 2.0,    // multiplier on each post's frac (0.04–0.09) to reach player-card scale
  // ---- Rewards ----
  STEAL_FOLLOWER_PCT:  0.10,   // steal-followers: fraction of opponent's CURRENT followers
  STEAL_FOLLOWER_MIN:   50,    // minimum followers transferred on a steal
  STEAL_TAG_OFFER:       3,    // tags offered (player picks 1)
  ITEM_REWARD_ENABLED: false   // item reward not implemented -> disabled "敬請期待" button
};
SF.CardGame.defaultConfig();  // -> fresh deep copy of the above
```

RESOLUTION of the combat model conflict (Design 1 vs Design 4):
- Combat model: play 3 cards/round, `delta = playerSum − oppLikes`, **damage = full likes
  difference** (`DAMAGE_SCALE = 1.0`, per the user's spec: "若對方讚數比玩家多 x，玩家扣除 x 點血量").
  Opponent plays round-robin by round index. Likes used directly.
- **2026-06-19 revision** (user feedback): the original `DAMAGE_SCALE=0.05` shrank the damage
  number (e.g. 388 vs 115 showed −14 instead of −273) and was removed → damage is now the raw
  `|delta|`. Because full-delta hits are in the hundreds/thousands, `PLAYER_HP` was raised
  100 → 6000. Opponent card likes are no longer pre-baked; they are computed from the
  opponent's CURRENT followers + a base (`OPP_LIKES_BASE + followers*frac*OPP_LIKES_FRAC_MULT`),
  and opponent HP is likewise computed from current followers (both drop when followers are
  stolen). Design 4's `cardPower` divisor model is rejected; its engineering scaffolding
  (engine/UI split, frozen battle-state shape, seeded determinism, persistence, `onChange`) is KEPT.

### 3.2 Leaderboard / opponents (read)

```js
SF.CardGame.opponents()        // -> runtime opponent views (data + current followers + defeated)
SF.CardGame.opponentById(id)   // -> runtime opponent view | null
SF.CardGame.leaderboard()      // -> opponents() sorted by CURRENT followers DESC, each annotated {rank}
                               //    INCLUDES a synthetic player row:
                               //    {id:"__player", handle:SF.State.account.handle,
                               //     name:"你", followers:SF.State.followers(), isPlayer:true}
                               //    (player has no hp/posts; UI shows rank only, no 挑戰 button)
```
Runtime opponent view (read-only, rebuilt from data + persisted overrides):
```js
{ id, name, handle, avatar, theme, hp, posts,
  baseFollowers /* === data.followers seed */,
  followers     /* CURRENT, persisted, mutable via steal */,
  defeated      /* bool, persisted */,
  rank          /* set only by leaderboard() */ }
```

### 3.3 Player deck

```js
SF.CardGame.playablePosts()
  // -> [{ entry, post, likes }] for each SF.State.feed entry with source==="player":
  //    entry = feed entry, post = SF.Data.postById(entry.postId),
  //    likes = SF.Algorithm.compute(entry, SF.State.account, SF.State.nowTicks()).likes
SF.CardGame.canPlay()          // -> bool: playablePosts().length >= config.DECK_MIN
SF.CardGame.getDeck()          // -> string[] postIds (persisted player deck)
SF.CardGame.setDeck(postIds)   // validate + store; on success calls save(); returns bool
SF.CardGame.deckValid(postIds) // -> bool: DECK_MIN<=len<=DECK_MAX, all ids are CURRENT player posts, no dups
```
Deck stores **postIds only** (pure values). Likes are recomputed live in `playablePosts()`
and snapshotted (frozen) at `startBattle`. `deckValid` rejects ids no longer in the player
feed (e.g. after a save reset); UI must never trust `getDeck()` blindly.

### 3.4 Battle controller

```js
SF.CardGame.startBattle(opponentId)
  // -> battle object (also stored as SF.CardGame.battle).
  //    Returns null if !canPlay(), deck invalid, or opponent missing/defeated.
SF.CardGame.battle             // current active battle | null (TRANSIENT, never persisted)
```

**Battle state shape (the contract the UI reads; mutated in place):**
```js
{
  phase: "DRAW"|"PLAY"|"EFFECT_1"|"COMPARE"|"EFFECT_2"|"RESOLVE"|"ROUND_END"|"ENDED",
  round: 1,
  nonce: <int>,                 // deterministic per-battle: (SF.State.nowTicks() ^ seedFromOpponentId)
  opponentId: "OPP10",
  playerHp: 100, playerHpMax: 100,
  oppHp: 32,    oppHpMax: 32,
  deck:    [ { postId, name, likes } ],   // player snapshot deck (likes frozen at startBattle)
  drawPile: [ <deckIdx>... ],             // indices into deck still drawable this shuffle
  hand:    [ { postId, name, likes } ],   // current hand (up to HAND_SIZE)
  picked:  [ <handIdx>... ],              // player's chosen indices (must reach PLAY_SIZE to play)
  playerCards: null | [ {postId,name,likes} x PLAY_SIZE ],  // set at COMPARE
  oppCard:     null | { postId, name, likes },              // this round's opponent card
  playerSum:   0, oppLikes: 0, delta: 0,  // computed at COMPARE
  lastDamage:  0,                          // computed at RESOLVE (signed: + = opp took dmg)
  log: [ { round, playerSum, oppLikes, delta, dmg, target:"opp"|"player"|"none" } ],
  result: null | { win: bool, opponentId, rewardApplied: bool }
}
```

**Stepping methods** (all mutate `SF.CardGame.battle`, return it; do NOT auto-render):
```js
SF.CardGame.drawPhase()        // phase "DRAW": deal up to HAND_SIZE from drawPile into hand; reveal oppCard for the round; phase->"PLAY"
SF.CardGame.pickCard(handIdx)  // toggle handIdx in battle.picked (cap PLAY_SIZE); only in "PLAY"; returns battle
SF.CardGame.playPicked()       // requires picked.length===PLAY_SIZE; runs EFFECT_1(no-op)->COMPARE->EFFECT_2(no-op)->RESOLVE->checks; see §4
SF.CardGame.nextRound()        // from "ROUND_END": return cards, reshuffle (seeded), round++, phase->"DRAW"
SF.CardGame.endBattle()        // force-abandon active battle (battle=null), no reward; returns void
SF.CardGame.runEffects(phase, ctx) // internal no-op hook for EFFECT_1/EFFECT_2 (returns immediately; future card effects)
```
> The two EFFECT phases are named NO-OP placeholders that MUST exist (future card-effect
> hooks) but currently do nothing. The UI MAY surface them as a "繼續" step or fold them
> invisibly into `playPicked()`; either is conformant since they are no-ops.

**Opponent card selection (deterministic round-robin — Design 1, adopted):**
```js
oppCardIndex = (battle.round - 1) % opponent.posts.length;
oppCard      = opponent.posts[oppCardIndex];   // revealed at start of PLAY
```

**Seeded shuffle (Fisher–Yates, NO Math.random):** at `nextRound`, reshuffle `drawPile`
using xorshift/`hash01` seeded by `SF.Algorithm.seed("cg:"+opponentId+":shuffle:"+nonce, round)`:
```js
j = Math.floor(SF.Algorithm.hash01(SF.Algorithm.seed("cg:"+opponentId+":shuffle:"+battle.nonce, i)) * (i+1));
```

### 3.5 Persistence (mirror `SF.State`)

```js
SF.CardGame.save()    // write localStorage key "summerfeed.cardgame.v1"
SF.CardGame.load()    // read; if absent, seed runtime from PIA_OPPONENTS and save once
SF.CardGame.reset()   // clear key, re-seed opponent runtime from data, empty deck, save, emit
SF.CardGame.onChange(cb) // mirror SF.State.onChange; returns off()
```
**Persisted payload (pure values + ids ONLY):**
```js
{
  v: 1,
  deck: [ postId... ],                                  // player deck ids only
  opponents: { "OPP01": { followers: 5850000, defeated: true }, ... }  // runtime OVERRIDES only
}
```
- Do NOT persist: card likes, battle object, leaderboard order — all derived/recomputed.
- On `load`: for each `PIA_OPPONENTS` entry start `followers=data.followers`,
  `defeated=false`, then overlay persisted overrides. Saved ids absent from data are dropped
  (forward-compat). Saved opponents missing from data fall back to seed.
- The **active battle is transient**: a page reload abandons any in-progress battle.
- `STORAGE_KEY = "summerfeed.cardgame.v1"`, `SAVE_VERSION = 1`. Wrap every `localStorage`
  access in `try/catch` exactly like `SF.State` (file:// availability).
- Separate key (NOT bumping `summerfeed.state.v1`) keeps the frozen `SF.State` save shape
  untouched. RESOLUTION of Design 1's open question: **separate key, confirmed.**

---

## §4. Battle phase machine (7 phases + ENDED)

Ordered enum (string values used in `battle.phase`):
```
DRAW → PLAY → EFFECT_1 → COMPARE → EFFECT_2 → RESOLVE → ROUND_END → (DRAW | ENDED)
```
| Phase | Action |
|---|---|
| `DRAW` | Deal up to `HAND_SIZE` (5) from `drawPile` into `hand`. Reveal this round's `oppCard` (round-robin). → `PLAY` |
| `PLAY` | Player picks exactly `PLAY_SIZE` (3) hand cards; others stay in hand/return to deck. Opponent card already visible (full information). |
| `EFFECT_1` | **NO-OP placeholder.** `runEffects("EFFECT_1", ctx)` returns immediately. |
| `COMPARE` | `playerSum = Σ played card likes`; `oppLikes = oppCard.likes`; `delta = playerSum − oppLikes`. |
| `EFFECT_2` | **NO-OP placeholder.** `runEffects("EFFECT_2", ctx)` returns immediately. |
| `RESOLVE` | Apply damage (formula below); append `log`; check win/lose. |
| `ROUND_END` | Return played + unplayed table cards to deck; seeded reshuffle; `round++`; → `DRAW`. |
| `ENDED` | Battle over; `result` set. |

**RESOLVE damage formula (Design 1, adopted):**
```js
mag = Math.round(Math.abs(delta) * config.DAMAGE_SCALE);
if (delta !== 0) mag = Math.max(mag, config.MIN_DAMAGE);  // non-tie guarantees >= MIN_DAMAGE
if      (delta > 0) { oppHp    -= mag; target = "opp";    }  // player ahead -> opponent loses HP
else if (delta < 0) { playerHp -= mag; target = "player"; }  // opponent ahead -> player loses HP
else                {                  target = "none";   }  // tie -> no damage
lastDamage = (delta >= 0) ? mag : -mag;
```

**Win/lose check (after RESOLVE):**
```js
if (oppHp <= 0 && playerHp <= 0) -> WIN  (simultaneous-lethal judged player WIN — Design 1 proposal, frozen)
else if (oppHp    <= 0)          -> WIN  -> result={win:true,...,rewardApplied:false}; phase "ENDED"
else if (playerHp <= 0)          -> LOSE -> result={win:false,...}; phase "ENDED"
else                             -> phase "ROUND_END" -> nextRound() -> "DRAW"
```
`drawPile` never exhausts in practice: all table cards return each `ROUND_END`, so deck
always ≥ `DECK_MIN` ≥ `HAND_SIZE`. (When future card-removal effects go live in EFFECT_1/2,
re-verify this invariant.)

---

## §5. Rewards (player WIN → choose exactly 1 of 3)

Engine MUST NOT auto-apply rewards. On a winning `ENDED` battle the engine leaves
`result.rewardApplied=false`; the UI presents the choice and calls one `applyReward*`; the
engine then sets `battle.result.rewardApplied=true`.

### 5.1 Steal tag (奪取詞條)
```js
SF.CardGame.rewardTagOffer(opponentId)
  // -> array of up to config.STEAL_TAG_OFFER (3) tag NAMES, SEEDED (no Math.random).
  //    Pool = unique tag names across the defeated opponent's posts[].tags,
  //           filtered to those that resolve via SF.Data.tagByName (skip misses)
  //           and that are NOT already unlocked (SF.State.isUnlocked === false).
  //    If pool < 3, offer whatever exists. Seeded sample:
  //    seed = SF.Algorithm.seed("cg:"+opponentId+":reward", k) for k=0..n, dedup.

SF.CardGame.applyRewardStealTag(opponentId, tagName)
  // validate tagName in the current offer & SF.Data.tagByName(tagName);
  // SF.State.unlock(tagName); SF.State.save();
  // marks opponent.defeated=true; SF.CardGame.save();
  // sets battle.result.rewardApplied=true; returns bool.
```

### 5.2 Steal followers (奪取粉絲)
```js
SF.CardGame.applyRewardStealFollowers(opponentId)
  // amount = max(config.STEAL_FOLLOWER_MIN, round(opp.followers * config.STEAL_FOLLOWER_PCT));
  // amount = min(amount, opp.followers);                 // cannot steal more than they have
  // opponent.followers (runtime, persisted) -= amount;   // -> leaderboard re-sorts, opp may drop rank
  // SF.State.account.baseFollowers += amount;            // PERMANENT base grant (NOT followerDelta)
  // opponent.defeated = true;
  // SF.CardGame.save(); SF.State.recompute(); SF.State.save();
  // sets battle.result.rewardApplied=true; returns the integer amount stolen.
```
> CRITICAL: write `SF.State.account.baseFollowers`, NEVER `followerDelta` / `followers()`.
> `followerDelta` is a derived value recomputed from feed every tick (`state.js` line ~179)
> and would erase the grant on next `recompute()`. Confirmed against `state.js`.

### 5.3 Item (道具) — disabled
`config.ITEM_REWARD_ENABLED === false`. UI renders a disabled button labelled「敬請期待」.
No engine method, no logic.

> Defeated opponents are marked `defeated=true` and are NOT re-challengeable (steal is
> one-time, no farming). RESOLUTION of Design 1 open question #3: **one-time, frozen.**

---

## §6. `SF.CardGameUI` (DOM controller — FROZEN)

```js
SF.CardGameUI.init()    // cache #panel-cardgame; subscribe BOTH SF.State.onChange AND
                        // SF.CardGame.onChange to re-render — but ONLY when the cardgame
                        // tab is active (guard: do not rebuild a hidden panel every tick).
SF.CardGameUI.render()  // render current sub-view into #panel-cardgame (clear -> rebuild,
                        // like app.js panels). Preserves _view/_phase across re-renders so
                        // an onChange tick never kicks the player back to HOME mid-battle.
```
> The UI MUST subscribe to BOTH buses: the app.js global listener only watches
> `SF.State.onChange`, so cardgame-only changes (e.g. `defeated` flag, stolen followers
> re-sorting the board) need `SF.CardGame.onChange` too. UI sub-view buttons manage `_view`
> + `render()` directly; they must NOT re-call `SF.App.setActiveTab`.

### 6.1 Sub-views (`_view`, private)
```
_view ∈ { "HOME", "DECK", "BATTLE", "SETTLEMENT" }

HOME ──[組成牌庫]──▶ DECK ──[確認 7~14]──▶ HOME (deck ready)
HOME ──[挑戰 #n]───▶ BATTLE (snapshot deck likes + opponent HP)
BATTLE ─[一方 HP<=0]▶ SETTLEMENT
SETTLEMENT ─[勝:領獎 / 敗:再戰或返回]─▶ HOME (or back to BATTLE)
```
Within `BATTLE`, the phase machine (§4) advances via a single primary action button
(textContent/disabled change by phase) WITHOUT switching `_view`.

### 6.2 DOM / class plan (`cg-*` only, in `styles-cardgame.css`)
Reuse `:root` tokens (`--bg-*`,`--txt-*`,`--accent`,`--traffic-*`,`--stat-*`,`--r-*`,
`--ok/--warn/--bad/--immoral`,`--line*`,`--font-stack`) and reusable classes
(`.btn .btn--primary/ghost/danger/sm/lg/block`, `.panel__head/__title/__hint`,
`.section-label`, `.chip`, `.badge`, `.post`, `.toolbar`). Add NO new tokens; do NOT touch
`styles.css`. Native DOM; redraw = clear container → rebuild.

Outer shell: `#panel-cardgame > .cg-root > .cg-stage` (sub-view mount). `render()` clears
`.cg-stage` then builds per `_view`.

- **HOME:** `.cg-deckbar` (牌庫摘要 + 「組成牌庫」) · `.section-label「排行榜」` · `.cg-board`
  with 10 `.cg-rank` rows + a player row. Row: `.cg-rank__no/__avatar/__id(__name/__handle)/
  __stat(__followers + .cg-hpbar--sm)/__btn`. 挑戰 button disabled if published posts <
  `DECK_MIN` or deck not built; a single `.cg-board__notice` (`color:var(--warn)`) states the
  reason once.
- **DECK:** if `playablePosts().length < DECK_MIN` → `.cg-block` blocking message
  (「發文不足 7 篇，無法遊玩」+ progress N/7 + 返回). Else `.cg-deck` with `.cg-deck__live`
  (已選 N/14 · 總讚 X, live), `.cg-cardgrid` of `.cg-card.is-selectable` (toggle
  `.is-selected`; cap `DECK_MAX`), `.cg-deck__foot` (取消 / 確認牌庫, latter disabled while
  count < `DECK_MIN`).
- **BATTLE:** `.cg-hud` (persistent: `.cg-hud__bars` = player side / `.cg-hud__vs` / opp side,
  each a `.cg-hpbar`; `.cg-hud__meta` round + phase label) · `.cg-opp` (opponent's current
  post as `.cg-card.cg-card--lg` + primary action button) · `.cg-combo.is-disabled` (dashed
  dim banner「詞條與詞條間有組合效果」, EFFECT placeholder) · `.section-label「你的手牌（選 3 張）」`
  · `.cg-hand` of `.cg-card.is-playable` (select highlight) · `.cg-log` rows.
- **SETTLEMENT:** WIN → `.cg-settle.is-win` banner「挑戰成功！」(`--ok`) + `.section-label
  「選擇 1 項獎勵」` + `.cg-rewards` of 3 `.cg-reward` (data-kind `tag`/`follower`/`item`):
  tag = 3 mutually-exclusive `.chip.is-selected` then 領取; follower =「搶奪粉絲 +N（對手 −N）」
  then 領取; item = `.is-disabled` +「敬請期待」. LOSE → `.cg-settle.is-lose` banner「挑戰失敗」
  (`--bad`) + 再次挑戰 / 返回排行榜.

### 6.3 HP bars (`.cg-hpbar`)
```html
<div class="cg-hpbar" data-side="opp" role="progressbar"
     aria-valuemin="0" aria-valuemax="32" aria-valuenow="20">
  <div class="cg-hpbar__fill" style="width:62.5%"></div>
  <span class="cg-hpbar__txt">20 / 32</span>
</div>
```
`data-side="player"` fill = `--ok`; `data-side="opp"` fill = `--immoral`/`--bad`. Below 25%
add `.is-low` (fill → `--warn`). Update by setting `__fill` width % + `__txt` text only —
never rebuild the bar. Width is a **percentage**, never derived from pixel readback.

### 6.4 Reference battle-screen layout & responsiveness
App container `max-width:980px`. Desktop battle: HUD three-column (你 / VS / 對手), opponent
card row (card left, action button right), then hand grid, then log. Mobile (`@media
max-width:560px`): leaderboard `.cg-rank` collapses to two rows (no+avatar+id; then
stat+button); HUD bars stack vertically; opponent card + button stack (button →
`.btn--block`). Card grids: `display:grid; grid-template-columns:repeat(auto-fill,
minmax(150px,1fr)); gap:10px` (hand may use `overflow-x:auto`). All numbers shown via
`SF.Algorithm.abbreviate()`. Touch targets ≥ 44px. Respect existing `.panel.is-active`
`fadeIn`.

---

## §7. Balance summary

### Final numbers
| Knob | Value | Role |
|---|---|---|
| `DECK_MIN` / `DECK_MAX` | 7 / 14 | deck size bounds; <7 published posts blocks play |
| `HAND_SIZE` / `PLAY_SIZE` | 5 / 3 | draw 5, play 3 each round |
| `PLAYER_HP` | 6000 | fixed player HP, sized for full likes-delta damage |
| `OPP_HP_FOLLOWER_RATIO` | 0.10 | opp HP = round(CURRENT followers × 0.10) (dynamic) |
| `DAMAGE_SCALE` | 1.0 | damage = round(\|playerSum−oppLikes\| × 1.0) = full likes difference |
| `MIN_DAMAGE` | 1 | non-tie floor |
| `OPP_LIKES_BASE` | 60 | base likes on every opponent card |
| `OPP_LIKES_FRAC_MULT` | 2.0 | ×each post's frac (0.04–0.09) → oppLikes = round(60 + followers·frac·2) |
| `STEAL_FOLLOWER_PCT` / `_MIN` | 0.10 / 50 | steal-followers amount |
| `STEAL_TAG_OFFER` | 3 | tag choices on win |
| `ITEM_REWARD_ENABLED` | false | item reward disabled |

Opponent followers ladder (roster): 6.5M / 1.7M / 450K / 120K / 32K / 8.5K / 2.3K / 950 /
520 / 320 (ranks 1→10); HP = CURRENT followers × 0.10; opponent card likes = 60 + followers·frac·2.

### Reasoning (one paragraph)
Damage is the **full likes difference** (`DAMAGE_SCALE=1.0`) per the user's rule, and a round
only damages the side that *loses* the likes comparison — so a player who out-likes the
opponent (3 cards vs 1) takes ~0 damage and grinds the opponent's HP (= followers×10%) down by
`playerSum−oppLikes` each round. `PLAYER_HP=6000` is a fixed variance buffer for unlucky draws.
Opponent card likes (`60 + followers·frac·2`, frac 0.04–0.09) sit on roughly the same scale as
a single player card at equal followers, so 3 player cards beat 1 opponent card at parity and
the ladder favours challenging *up*. Simulation (player ≈ 520 followers, best-deck): the player
1-round-stomps ranks 10–7 (≤~4× its size), wins rank 6 (~16×) only as a tense ~15-round grind,
and is one-rounded by ranks ≤5 — players must grow real followers (raising card likes via the
live `SF.Algorithm`, or via the steal-followers reward) to climb. Primary tuning knobs:
`DAMAGE_SCALE` (fight length), `PLAYER_HP` (variance buffer / win-band width), `OPP_LIKES_BASE`
& `OPP_LIKES_FRAC_MULT` (opponent card strength). Note: with fixed HP and follower-scaled
everything else, the absolute buffer shrinks as the player grows very large — raise `PLAYER_HP`
(or make it scale) if late-game fights feel too swingy.

---

## Appendix — naming cross-reference (must agree EXACTLY across files)

| Concept | Frozen name |
|---|---|
| Data global | `window.PIA_OPPONENTS` |
| Engine global | `SF.CardGame` |
| UI global | `SF.CardGameUI` |
| Opponent id field | `id` (e.g. `"OPP01"`) |
| Opponent followers field | `followers` (seed) / runtime `followers` |
| Opponent HP field | `hp` |
| Opponent cards | `posts[]` each `{id,name,tags,likes,frac}` |
| Config object | `SF.CardGame.config` (UPPER_SNAKE keys) |
| Battle object | `SF.CardGame.battle` |
| Battle phases | `"DRAW","PLAY","EFFECT_1","COMPARE","EFFECT_2","RESOLVE","ROUND_END","ENDED"` |
| UI sub-views | `"HOME","DECK","BATTLE","SETTLEMENT"` |
| localStorage key | `"summerfeed.cardgame.v1"` |
| CSS prefix | `cg-` (in `styles-cardgame.css`) |
| Tab | `data-tab="cardgame"`, label「排行榜挑戰」, panel `#panel-cardgame` |

*Frozen 2026-06-19.*
