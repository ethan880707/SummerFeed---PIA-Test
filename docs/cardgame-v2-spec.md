# CardGame v2 — Frozen Implementation Contract

> Single reconciled spec merging DESIGN A (systems/flow), DESIGN B (effect vocabulary),
> DESIGN C (balance). This document is **FROZEN**: the engine, UI, data files and the
> Excel generator implement exactly what is written here.
>
> ZERO-dependency vanilla JS. Must run by double-clicking `index.html` (`file://`):
> NO `fetch` / `import` / ES-modules. Logic = IIFE on `window.SF`; data = `<script>`
> globals (`window.PIA_*`). **No `Math.random` / `Date.now` anywhere** — all randomness
> and shuffles use `SF.Algorithm.hash01(SF.Algorithm.seed(str, salt))` (deterministic;
> `seed(str,salt)→int`, `hash01(int)→[0,1)`).
>
> Conflicts between the three designs were resolved in favor of DESIGN C's
> scale-relative balance model (because both sides' attack and HP ride followers,
> flat numbers do not survive the ladder). See §10 for the resolution log.

---

## §0. Overview — v2 overhaul vs v1

### What is KEPT (verbatim, do not touch)
- **Tab / app integration**: same `index.html` init order
  (`data/opponents.js` after `db.js`; `js/cardgame.js` after `state.js` before `app.js`;
  `js/cardgame-ui.js` after `app.js`). Init still calls `SF.CardGame.load()` + `SF.CardGameUI.init()`.
- **Deck-building**: `playablePosts()`, `canPlay()`, `getDeck()`, `setDeck()`, `deckValid()`,
  `DECK_MIN`/`DECK_MAX`.
- **Leaderboard / opponents**: `opponents()`, `opponentById()`, `leaderboard()`,
  opponent persistence (defeated state survives save/load).
- **Rewards**: `rewardTagOffer()`, `applyRewardStealTag()`, `applyRewardStealFollowers()`
  (steal writes `SF.State.account.baseFollowers`, **never** `followerDelta`).
- **Save/load/onChange**: `save()`, `load()`, `reset()`, `onChange(cb)`.
- **Opponent data model** (`data/opponents.js`): unchanged. 10 opponents,
  `posts:[{id,name,tags:[2 names],likes,frac}]`. Opponent HP = `round(followers*0.10)`.
- **HOME / DECK / SETTLEMENT** sub-views in `SF.CardGameUI`.

### What is REWRITTEN
- **Battle engine** in `js/cardgame.js`: v1 phase machine
  (`DRAW/PLAY/EFFECT_1/COMPARE/EFFECT_2/RESOLVE/ROUND_END`, `drawPhase/pickCard/
  playPicked/nextRound/runEffects`) is **replaced** by the v2 state machine (§2) and
  new stepping API (§3).
- **BATTLE sub-view** in `js/cardgame-ui.js`: rewired to v2 (traffic bar, both sides'
  HP/shield/money, hand effect labels, play-3 flow, pending-choice overlay, opponent reveal).
- **Save key bumped**: `STORAGE_KEY = "summerfeed.cardgame.v2"`. (v1 saves are not migrated;
  fresh start. Deck/defeated-opponents schema unchanged so the only effect is a key rename.)

### What is NEW
- Shared **TRAFFIC** resource, **SHIELD** (鐵粉), **MONEY** (金錢) per side.
- Per-card effect system driven by **tag→category→effect template** (16 families).
- `data/card-effects.js` (`window.PIA_CARD_EFFECTS`) + parallel `data/_card_effects.json`.
- Excel deliverable generated into `…/02_WebDemo/Data`.

---

## §1. Resource model

Per side: `hp`, `shield`, `money`. One **shared** global: `traffic`.

| Resource | 中文 | Owner | Init | Sources | Sinks |
|---|---|---|---|---|---|
| `hp` | 粉絲團 | player & opp | player `max(followers, PLAYER_HP_FLOOR)`; opp `round(followers*OPP_HP_FOLLOWER_RATIO)` | `heal`, lifesteal, `money_to_followers`, `shield_to_hp` | incoming damage overflow past shield |
| `shield` | 鐵粉 | player & opp | `0` | `add_shield`, parity-even, `money_to_shield` | absorbs damage before hp; `shield_to_hp` drains it |
| `money` | 金錢 | player & opp | `0` | `+MONEY_PER_ROUND`/round, `gen_money`, `traffic_to_money` | `money_to_*` (錢轉X). **Pure conversion — never a gate/cost for other effects.** |
| `traffic` | 流量 | **shared** | `0` | `+TRAFFIC_PER_ROUND`/round, `traffic_add`, `money_to_traffic{+}` | `traffic_sub`, `money_to_traffic{-}`, `traffic_to_money` |

- `traffic` is an **integer percent in `[0, TRAFFIC_MAX]`** (stored as `0..100`, not a fraction).
- `hpMax` = the init value (frozen at `startBattle`). `heal` clamps to `hpMax`;
  **conversion-class HP gains (lifesteal, `money_to_followers`, `shield_to_hp`) are NOT
  clamped** and may exceed `hpMax` (resolves DESIGN B open-Q #1: heal capped, conversions uncapped).

### likeMult & effective-likes (applied to EVERY card, both sides, at attack time)
```
likeMult = 1 + traffic/100                 // 0% → ×1.0 ; 100% → ×2.0
effLikes(card) = round( card.baseLikes * likeMult * card._mulBuff + card._addBuff )
effLikes = max(0, effLikes)
```
- `card.baseLikes` (frozen snapshot): player card = `SF.Algorithm.compute(entry,account,now).likes`;
  opponent card = its `post.likes`.
- `_addBuff` (flat, **post-multiplier**, NOT traffic-scaled) and `_mulBuff` (multiplicative)
  accumulate from `buff{}` effects and effect-emitted deltas during this play, **plus**
  the side's in-scope turn buffs (`battle.buffs[side].addBuff/mulBuff`).
- **Traffic is read at attack time** (after this turn's traffic-mutating effects have run),
  so 公司 / 理髮廳 played earlier in the same turn affect later cards.

### Scale anchors (DESIGN C — frozen, pure serializable values)
Computed once at `startBattle`, used by the generator to pick concrete numbers:

| Anchor | Definition |
|---|---|
| `oppHpMax` | `round(currentFollowers * OPP_HP_FOLLOWER_RATIO)` |
| `M` (per card) | the card's own current `effLikes` at the moment its effect resolves |
| `playerHpMax` | `max(SF.State.followers(), PLAYER_HP_FLOOR)` |
| `likeMult` | `1 + traffic/100` |

> **Why relative, not flat:** both sides' attack (`likes ∝ followers`) and both HP
> scale ~linearly with follower count `S`. A flat `+50 shield` is decisive at S=320 and
> noise at S=6.5M. Every magnitude in §4 is therefore a ratio of `M`, `playerHpMax`, or
> `oppHpMax`, so one coefficient works across the whole ladder.

---

## §2. Round / turn state machine

`battle.phase` enum (string):
```
ROUND_START
  → P_DRAW → P_PLAY ⇄ P_RESOLVE_CARD (≤ PLAY_SIZE) → P_END
  → O_PLAY → O_RESOLVE → O_END
  → WINCHECK → (ROUND_START | ENDED)
```
`battle.turn` = `"PLAYER"` during `P_*`, `"OPPONENT"` during `O_*`.

| Phase | Action | Next |
|---|---|---|
| `ROUND_START` | `traffic = min(TRAFFIC_MAX, traffic + (round===1 ? 0 : TRAFFIC_PER_ROUND))` (additive form — never recompute from round, because effects mutate it mid-round). `player.money += MONEY_PER_ROUND; opponent.money += MONEY_PER_ROUND`. Reset both `buffs[*].addBuff=0, mulBuff=1`; **decrement `reflect.rounds`**, drop reflect at 0. `turn="PLAYER"`. | `P_DRAW` |
| `P_DRAW` | `drawN(player, HAND_SIZE - currentHandCount)` via §2.1. Reset each newly drawn card `_addBuff=0,_mulBuff=1`. `player.playedThisTurn=0`. | `P_PLAY` |
| `P_PLAY` | UI calls `playCard(handIdx)` (≤ `PLAY_SIZE` total this turn). May push `battle.pending` (choose_one/scry). | `P_RESOLVE_CARD` |
| `P_RESOLVE_CARD` | Resolve one card: **effects in order FIRST, then ATTACK/DEFENSE** (§2.2). `WINCHECK` after the damage event. Increment `playedThisTurn`. Move card → `discard` unless `retain`/`temp`. If plays remain and player continues → `P_PLAY`; else `P_END`. | `P_PLAY` \| `P_END` \| `WINCHECK` |
| `P_END` | Discard all remaining hand **except** `retain:true` (those stay in hand); **temp cards vanish** (never enter discard/deck). Clear `buffs.PLAYER` (addBuff→0, mulBuff→1; reflect kept). `turn="OPPONENT"`. | `O_PLAY` |
| `O_PLAY` | Mint scripted post `posts[(round-1) % posts.length]`. No draw, no pile. | `O_RESOLVE` |
| `O_RESOLVE` | Resolve opponent card: **effect(s) FIRST, then ATTACK vs player**. `WINCHECK` after damage. Opponent `pending` is auto-resolved (§5). | `O_END` |
| `O_END` | Clear `buffs.OPPONENT` (reflect kept). | `WINCHECK` |
| `WINCHECK` | §2.3 lethal check. If neither dead → `round++`, `ROUND_START`. | `ROUND_START` \| `ENDED` |
| `ENDED` | `result` set; battle frozen; UI → SETTLEMENT. | — |

**Player turn = play UP TO `PLAY_SIZE`** (not exactly). Player may stop early via
`endPlayerTurn()`. (Resolves A open-Q #2.)

### §2.1 Draw with empty-pile reshuffle (exact)
```
drawN(side, n):
  drawn = 0
  while drawn < n:
    if side.drawPile.length === 0:
      if side.discard.length === 0: break               // truly empty: stop short
      reshuffleDiscardIntoDrawPile(side)                 // seeded Fisher–Yates, below
    idx = side.drawPile.shift()
    side.hand.push( mintHandInstance(side.deck[idx]) )   // resets _addBuff=0,_mulBuff=1
    drawn++
  return drawn
```
Worked example (need 5, pile has 3): pull 3 → empty → reshuffle discard → pull 2.

**Seeded reshuffle** (no `Math.random`; monotonic `reshuffleCount` so successive shuffles differ):
```
seedStr = "cg:" + opponentId + ":reshuffle:" + nonce + ":" + player.reshuffleCount
arr = [deck indices currently in discard]
for (k = arr.length-1; k > 0; k--):
   j = floor( hash01( seed(seedStr, k) ) * (k+1) );  clamp j to [0,k]
   swap(arr[k], arr[j])
player.drawPile = arr ; player.discard = [] ; player.reshuffleCount++
```
Initial deck shuffle at `startBattle` uses salt `":shuffle:"` (same scheme as v1).
**Invariant:** temp-vanish + retain-stay can shrink circulating cards below `HAND_SIZE`;
`drawN` tolerates a short hand (the `break`). UI must render a short hand gracefully.
No per-round `PLAY_SIZE` guarantee at very low deck counts — accepted.

### §2.2 Play-a-card pipeline (effect THEN atk/def)
```
resolveCard(side, card):
  ctx = { battle, side, card, isFirstPlay: (side.playedThisTurn === 0) }
  for eff in card.effects:                 // 1) effects, declared order
     runEffect(eff, ctx)                    // may mutate resources/buffs; may push `pending`
                                            // pending → engine returns; resolveChoice() resumes loop
  effLikes = computeEffLikes(side, card)    // 2) ATTACK (reads traffic NOW)
  if card._isDefenseOnly: side.shield += effLikes
  else: dealDamage(attacker=side, defender=other(side), amount=effLikes)
  side.playedThisTurn++                     // AFTER resolve (combo on 2nd card sees prev increment)
```
Default: **every card deals its `effLikes` as damage.** A card may also add shield via an
`add_shield` effect (effect runs first). `_isDefenseOnly` is reserved; default false.

**Damage pipeline:**
```
dealDamage(attacker, defender, amount):
  amount = max(0, round(amount))
  if defender.reflect.pct > 0 and amount > 0:           // reflect reads PRE-shield amount
     refl = round(amount * defender.reflect.pct / 100)
     applyToShieldThenHp(attacker, refl)                // reflected hit absorbed by attacker's own shield→hp
     record reflected
  applyToShieldThenHp(defender, amount)

applyToShieldThenHp(unit, dmg):
  if unit.shield > 0: a = min(unit.shield, dmg); unit.shield -= a; dmg -= a
  if dmg > 0: unit.hp -= dmg
```
- Reflect reads the **pre-shield** amount (chip damage punishes even through shields);
  reflected hits call `applyToShieldThenHp` directly → **never re-reflect** (no loop).
  Reflect is symmetric: opponent cards carrying `reflect` bounce the player's attacks (resolves B open-Q #2).
- `WINCHECK` runs after **every** `dealDamage` (a reflect may kill the attacker).

**Lifesteal / heal capping (frozen):**
- `heal{amount}`: `hp = min(hpMax, hp + amount)` — clamped (no overheal).
- `atk_to_followers{ratio}`: heal attacker `round(dealtToHp * ratio)` — **not clamped** (conversion).
- `followers_to_atk{ratio}`: `cost = round(hp * ratio); hp = max(1, hp - cost)` (floor 1, no suicide);
  `card._addBuff += round(cost * k)`.
- `shield_to_hp{amount|"all"}`: `conv = (amount==="all") ? shield : min(shield, amount);
  shield -= conv; hp += conv` — **not clamped** (conversion).

### §2.3 Win / lose
```
WINCHECK:
  pAlive = player.hp   > 0 ; oAlive = opponent.hp > 0
  if !pAlive && !oAlive: result = WIN          // simultaneous lethal → PLAYER WIN
  else if !oAlive:       result = WIN
  else if !pAlive:       result = LOSE
  else: continue
  result = { win, opponentId, rewardApplied:false } ; phase = "ENDED"
```
- **Player HP floor** applies to the **starting** value only: `hpMax = max(followers, PLAYER_HP_FLOOR)`.
  Mid-battle hp may still drop ≤0 and lose.
- Opponent HP uses **current** followers at battle start (`round(followers*0.10)`); stolen-follower
  changes affect future battles, not the live one.
- `result` consumed by SETTLEMENT; `applyRewardStealTag`/`applyRewardStealFollowers` set `rewardApplied=true`.

---

## §3. Battle state shape + engine API

`battle` is transient (never persisted). `startBattle(opponentId)` builds it; stepping
methods mutate it in place.

```js
battle = {
  opponentId : "OPP10",
  nonce      : (SF.State.nowTicks() ^ SF.Algorithm.seed("cg:"+opponentId+":nonce", 0)) | 0,
  round      : 1,
  turn       : "PLAYER",
  phase      : "ROUND_START",
  result     : null,                 // null | { win, opponentId, rewardApplied }

  traffic    : 0,                    // %, [0,TRAFFIC_MAX]
  oppHpMax   : 0,                    // anchor (= opponent.hpMax), frozen
  playerHpMax: 0,                    // anchor (= player.hpMax), frozen

  player : {
    hp:0, hpMax:0, shield:0, money:0,
    deck     : [ /* CardInstance */ ],
    drawPile : [ /* deckIdx... */ ],
    hand     : [ /* CardInstance */ ],
    discard  : [ /* CardInstance */ ],
    playedThisTurn : 0,
    reshuffleCount : 0
  },
  opponent : {
    hp:0, hpMax:0, shield:0, money:0,
    posts : [ /* {postId,name,tags,baseLikes,effects[]} */ ],
    nextPostIdx : 0                  // = (round-1) % posts.length
  },

  buffs : {
    PLAYER   : { addBuff:0, mulBuff:1, reflect:{pct:0, rounds:0} },
    OPPONENT : { addBuff:0, mulBuff:1, reflect:{pct:0, rounds:0} }
  },

  pending  : null,   // null | { kind:"choose_one"|"scry", side:"PLAYER", descriptor:{...} }
  lastPlay : null,   // { side, card, effLikes, dealt, toShield, toHp, reflected, log:[] }
  log      : []      // append-only event log
}
```

**CardInstance** (minted at `startBattle` / on draw):
```js
{ uid, postId, name, baseLikes, effects:[…], temp:false, retain:false,
  _addBuff:0, _mulBuff:1, _isDefenseOnly:false }
```

**EffectInstance** (emitted by generator, executed by engine): `{ kind, …params, label }`.

### Engine API (`SF.CardGame`)
KEPT v1 (verbatim): `opponents`, `opponentById`, `leaderboard`, `playablePosts`, `canPlay`,
`getDeck`, `setDeck`, `deckValid`, `rewardTagOffer`, `applyRewardStealTag`,
`applyRewardStealFollowers`, `save`, `load`, `reset`, `onChange`, `config`, `defaultConfig`.

NEW v2 battle (stateful-object model; `SF.CardGame.battle` is the object above):
```
startBattle(opponentId)   // build §3 state, phase ROUND_START, return battle (or null if !deckValid)
beginRound()              // ROUND_START → P_DRAW (traffic + money tick, buff reset)
playCard(handIdx)         // P_PLAY: resolve one card (effects→atk); may set battle.pending
hasPending()              // → bool
resolveChoice(payload)    // resolve pending, resume the suspended resolveCard loop
endPlayerTurn()           // P_END → O_PLAY (discard non-retain, drop temp)
runOpponentTurn()         // O_PLAY → O_RESOLVE → O_END (one scripted post; auto-resolve its pending)
advance()                 // convenience: run WINCHECK and step to next ROUND_START or ENDED
endBattle()               // abandon current battle (clear battle, no reward)
battle                    // the transient object (read for UI)
```
Determinism: shuffle (§2.1), scry order, reward offer all via `hash01(seed(...))`.
Opponent round-robin is index-based, not RNG. **No `Math.random` / `Date.now`.**

---

## §4. Effect-kind enum + category→effect template

### §4.1 Effect-kind enum (exact strings + params)
`Effect` = `{ kind, …params, label }`. Nested effects (in `parity`/`combo`/`choose_one`/`repeat`)
are themselves `Effect` objects. `scope ∈ {"turn","persist","card"}`, default `"turn"`.

| kind | params | semantics |
|---|---|---|
| `add_shield` | `{amount:int}` | `shield += amount` |
| `heal` | `{amount:int}` | `hp = min(hpMax, hp+amount)` (clamped) |
| `shield_to_hp` | `{amount:int\|"all"}` | conv = `"all"?shield:min(shield,amount)`; `shield-=conv; hp+=conv` (uncapped) |
| `followers_to_atk` | `{ratio:float, k:1}` | `cost=round(hp*ratio); hp=max(1,hp-cost); card._addBuff += round(cost*k)` |
| `atk_to_followers` | `{ratio:float}` | post-hit: `hp += round(dealtToHp*ratio)` (uncapped) |
| `reflect` | `{pct:float, rounds:int}` | set `buffs[side].reflect = {pct,rounds}` |
| `traffic_add` | `{pct:int}` | `traffic = min(TRAFFIC_MAX, traffic+pct)` |
| `traffic_sub` | `{pct:int}` | `traffic = max(0, traffic-pct)` |
| `atk_from_traffic` | `{kPer10:int}` | `card._addBuff += floor(traffic/10) * kPer10` |
| `atk_from_low_traffic` | `{kPer10:int}` | `card._addBuff += floor((TRAFFIC_MAX-traffic)/10) * kPer10` |
| `traffic_to_money` | `{ratio:float}` | `gain = floor(floor(traffic/10) * ratio)`; `money += gain`; (read-only on traffic — does NOT drain it) |
| `gen_money` | `{amount:int}` | `money += amount` |
| `money_to_traffic` | `{ratio:float, sign:+1\|-1}` | `spend=floor(money); money-=spend; traffic = clamp(traffic + sign*round(spend*ratio))` |
| `money_to_followers` | `{perMoney:int}` | `spend=floor(money); money-=spend; hp += spend*perMoney` (uncapped) |
| `money_to_shield` | `{perMoney:int}` | `spend=floor(money); money-=spend; shield += spend*perMoney` |
| `money_to_atk` | `{perMoney:int}` | `spend=floor(money); money-=spend; card._addBuff += spend*perMoney` |
| `parity` | `{odd:Effect, even:Effect}` | run `odd` if `(playedThisTurn+1)` is odd else `even` |
| `combo` | `{effect:Effect}` | run `effect` only if `!ctx.isFirstPlay` (not the first card this turn) |
| `retain` | `{}` | set `card.retain=true` (stays in hand at P_END) |
| `choose_one` | `{options:[Effect,Effect]}` | **pending**; `resolveChoice(i)` runs `options[i]` |
| `temp_card` | `{cardRef:string\|inlineCard}` | mint a `temp:true` card into hand (vanishes at P_END) |
| `buff` | `{atkFlat?:int, atkFrac?:float, scope, target:"self"\|"nextCard"\|"allHand"}` | add atk modifier (see below) |
| `draw` | `{n:int}` | `drawN(side, n)` |
| `scry` | `{look:int, pick:int}` | **pending**; peek top `look` of drawPile, pick `pick` to hand, rest to bottom |
| `repeat` | `{times:int, effect:Effect}` | run `effect` `times` times |

`buff` resolution: `target:"self"` → `card._addBuff += atkFlat; card._mulBuff *= (1+atkFrac)`.
`target` ∈ {nextCard, allHand} → write into `buffs[side]` (turn scope) so subsequent cards
read it via `computeEffLikes`. `atkFrac` is a fraction (0.25 = +25%).

> **`parity` parity basis = "this is the Nth card played this turn"** = `(playedThisTurn+1)`
> (odd = 1st/3rd, even = 2nd). NOT round number, NOT pile size. (Resolves B open-Q #4.)

### §4.2 Category→effect template (16 families, FROZEN defaults)
`tagCategory` derivation (ported EXACTLY from `js/app.js` L327–333):
```
s = String(tag.code || tag.name).replace(/^#/,'').replace(/\d+$/,'').replace(/(劇|雙倍)$/,'')
category = s || tag.type || "其他"
```
Aliases → effect family: `健身`=健身房, `理髮`=理髮廳, `圖書`=圖書館, `咖啡`=咖啡廳.

Anchors: `M` = card's current `effLikes`. `K10 = max(1, round(M*0.10))` (one "10%-of-card" atk unit).

| # | Family | Contributed effects (frozen defaults) |
|---|---|---|
| 1 | **共通** | exactly ONE base attribute (§4.3); contributes no other family effect |
| 2 | **女A** | `shield_to_hp{amount:"all"}` |
| 3 | **學校** | `add_shield{amount: round(0.5*M)}` |
| 4 | **健身房** | `heal{amount: round(0.06*playerHpMax)}` |
| 5 | **巨巨** | `followers_to_atk{ratio:0.0008,k:1}` + `atk_to_followers{ratio:0.05}` + `reflect{pct:50,rounds:1}` |
| 6 | **女B** | `atk_from_traffic{kPer10: K10}` + `traffic_to_money{ratio:1.0}` |
| 7 | **公司** | `traffic_add{pct:15}` |
| 8 | **理髮廳** | `traffic_sub{pct:15}` |
| 9 | **阿姨** | `atk_from_low_traffic{kPer10: K10}` |
| 10 | **女C** | `parity{ odd:{kind:"buff",atkFrac:0.30,scope:"turn",target:"self"}, even:{kind:"add_shield",amount:round(0.4*M)} }` |
| 11 | **咖啡廳** | `parity{ odd:{kind:"buff",atkFrac:0.25,scope:"turn",target:"self"}, even:{kind:"add_shield",amount:round(0.3*M)} }` |
| 12 | **圖書館** | `combo{ effect:{kind:"gen_money",amount:2} }` + `combo{ effect:{kind:"buff",atkFrac:0.25,scope:"turn",target:"self"} }` |
| 13 | **學妹** | `retain{}` (sets `card.retain=true`) |
| 14 | **女D** | `gen_money{amount:2}` + `money_to_traffic{ratio:1,sign:+1}` |
| 15 | **街道** | `money_to_followers{perMoney: round(0.01*oppHpMax)}` + `money_to_shield{perMoney: round(0.5*M)}` |
| 16 | **自宅** | `money_to_atk{perMoney: round(0.15*M)}` |

> `M`, `playerHpMax`, `oppHpMax` are the anchors from §1; the generator computes the concrete
> integer once per card (using that card's `baseLikes` and the battle anchors) and writes the
> literal number into `card-effects.js`. `K10`, `round(0.5*M)` etc. are **generator-time** formulas,
> not engine-time — shipped effect instances carry plain integers.
>
> **Known 街道 interaction:** `money_to_followers` then `money_to_shield` both `floor(money)` and
> drain it → the second sees `money=0`. **Frozen decision = accept** (followers first, shield step
> usually 0). No multi-spend reconciliation. (Resolves B open-Q #5.)

### §4.3 共通 base-attribute assignment (deterministic)
6 base slots (index 0–5):
```
0: choose_one{ options:[ {kind:"buff",atkFrac:0.50,scope:"turn",target:"self"},
                         {kind:"add_shield",amount:round(0.5*M)} ] }
1: temp_card{ cardRef:"__BASE_STRIKE__" }   // engine-builtin temp card: atk=round(0.5*M), no effects, vanishes P_END
2: buff{ atkFrac:0.20, scope:"turn", target:"self" }
3: draw{ n:1 }
4: scry{ look:3, pick:1 }
5: repeat{ times:2, effect:{kind:"gen_money",amount:1} }   // = +2 money, no conversion
```
Slot key (frozen, deterministic, no Math.random):
```
slot = (hash01( seed(postId, "base_attr") ) * 6) | 0      // 0..5
```
`__BASE_STRIKE__` is an engine-builtin temp template (temp, never enters discard/deck).
`choose_one` / `scry` raise a **pending** (§5).

### §4.4 Multi-category combination rule (frozen, deterministic)
For a post's chosen recipe (first recipe / its tag list):
1. Run `tagCategory` on each tag → category.
2. **Dedup**: each category counts once (no double 街道 money-drain from two `#街道xx`).
3. Concatenate all **non-共通** families' effects in **fixed family order** (table #2→16),
   appended to `effects[]`.
4. If ANY tag is `共通` → prepend **exactly one** base attribute (§4.3) at the **front** of
   `effects[]` (base resolves first — choose_one/scry/temp_card decided up front). Multiple 共通
   tags still yield only one base.
5. If `學妹` present → `card.retain=true` (and keep `{kind:"retain"}` in `effects[]` for UI display).

Determinism: steps 2–4 depend only on the category set + fixed order + `postId` hash → no RNG.

---

## §5. `data/card-effects.js` format + opponent mapping

`js/cardgame.js` and `js/cardgame-ui.js` read `window.PIA_CARD_EFFECTS`. A parallel
`data/_card_effects.json` holds the SAME content (machine-readable) for the Excel generator.
Both are committed; the JS file is loaded in `index.html` (after `data/opponents.js`,
before `js/cardgame.js`).

```js
// data/card-effects.js
(function (global) {
  "use strict";
  global.PIA_CARD_EFFECTS = {
    // player posts (ids from posts.json) AND opponent posts (OPPxx-Py)
    "A1": { category:["共通","自宅"], retain:false, effects:[
      { kind:"buff", atkFrac:0.20, scope:"turn", target:"self", label:"本回合此貼文讚數 +20%" },
      { kind:"money_to_atk", perMoney:8, label:"消耗全部金錢，每 1 元攻擊 +8" }
    ]},
    "OPP04-P3": { category:["街道"], retain:false, effects:[
      { kind:"money_to_followers", perMoney:120, label:"消耗金錢回粉絲" },
      { kind:"money_to_shield",    perMoney:5400, label:"消耗金錢加鐵粉" }
    ]}
    // … all player posts + all opponent posts …
  };
})(typeof window !== "undefined" ? window : this);
```
- Keys cover **both** player posts (every id in `posts.json`) and opponent posts (`OPPxx-Py`).
- `effects[]` entries are plain integers (generator pre-computed from anchors) + a `label`
  (繁中) for the UI.

### Opponent mapping (frozen, simplified)
1. For each opponent-post tag **name**: look up in `SF.Data.tags` to get `code` → `tagCategory`.
2. If not found (pure-mood name with no code, e.g. `#掀開帷幕`/`#慾望`/`#蟬鳴`): run
   `tagCategory` on the name directly. If result ∉ the 16 families → **ignore that tag**
   (no effect); the card still ATTACKS.
3. Opponents have **no draw, no 共通 base, no retain**. If a mapped family effect is
   `draw`/`scry`/`temp_card`/`choose_one`/`retain` → **skip that kind** for opponents
   (e.g. 圖書館's `combo{draw}` is dropped; its `gen_money` combo stays). `money_to_*`,
   `gen_money`, `traffic_*`, `reflect`, shields, parity stay (opponent has its own money, +1/round).
4. Round-robin: round `r` plays `posts[(r-1) % posts.length]`; effect first, ATTACK
   (`round(post.likes * likeMult)`) second.
5. Opponent `choose_one`/`scry` can never appear (skipped per #3); if one ever did, the engine
   auto-resolves with `floor(hash01(seed("cg:"+oppId+":choice", round)) * options.length)`.

---

## §6. Config defaults (`SF.CardGame.config`)

```js
SF.CardGame.config = {
  // deck building
  DECK_MIN: 7, DECK_MAX: 14,
  // hand / play
  HAND_SIZE: 5, PLAY_SIZE: 3,
  // shared traffic (integer percent)
  TRAFFIC_PER_ROUND: 10, TRAFFIC_MAX: 100,   // round 1 adds 0; round 2+ adds 10
  // money
  MONEY_PER_ROUND: 1,
  // hp
  PLAYER_HP_FLOOR: 300,            // = OPP10 followers (320) tier → fresh player ≈ weakest opp
  OPP_HP_FOLLOWER_RATIO: 4.0,      // opp HP = round(followers * this). v2 attack=讚數(hundreds~thousands)
                                   // so v1's 0.10 made opponents die round 1; 4.0 makes matched-tier
                                   // fights last 2–4 winnable rounds (sim-tuned 2026-06-20).
  // opponent card likes model (v1 kept)
  OPP_LIKES_BASE: 60, OPP_LIKES_FRAC_MULT: 2.0,
  // ---- effect magnitude COEFFICIENTS (generator multiplies by anchors) ----
  SHIELD_FRAC_M: 0.50,             // 學校 add_shield = round(this * M)
  HEAL_FRAC_HPMAX: 0.06,           // 健身房 heal   = round(this * playerHpMax)
  F2A_RATIO: 0.0008, F2A_K: 1,     // 巨巨 followers_to_atk
  LIFESTEAL_RATIO: 0.05,           // 巨巨 atk_to_followers
  REFLECT_PCT: 50, REFLECT_ROUNDS: 1,
  TRAFFIC_ADD_PCT: 15, TRAFFIC_SUB_PCT: 15,
  ATK_PER_10TRAFFIC_FRAC_M: 0.10,  // 女B/阿姨 kPer10 = max(1, round(this*M))  (= K10 when 0.10)
  T2M_RATIO: 1.0,                  // 女B traffic_to_money
  GEN_MONEY_BASE: 2,               // 女D / 圖書 combo
  M2T_RATIO: 1, M2T_SIGN: 1,       // 女D money_to_traffic (1 money → 1% traffic)
  M2F_FRAC_OPPHP: 0.01,            // 街道 money_to_followers perMoney = round(this*oppHpMax)
  M2S_FRAC_M: 0.50,                // 街道 money_to_shield perMoney   = round(this*M)
  M2A_FRAC_M: 0.15,                // 自宅 money_to_atk perMoney       = round(this*M)
  PARITY_C_ODD_FRAC: 0.30, PARITY_C_EVEN_FRAC_M: 0.40,   // 女C
  PARITY_CAFE_ODD_FRAC: 0.25, PARITY_CAFE_EVEN_FRAC_M: 0.30, // 咖啡廳
  COMBO_BUFF_FRAC: 0.25,           // 圖書館 combo buff
  BASE_BUFF_FRAC: 0.20,            // 共通 slot2 buff
  BASE_CHOOSE_BUFF_FRAC: 0.50,     // 共通 slot0 option a
  BASE_STRIKE_FRAC_M: 0.50,        // __BASE_STRIKE__ atk
  DRAW_BASE: 1, SCRY_LOOK: 3, SCRY_PICK: 1,
  // rewards (unchanged v1)
  STEAL_FOLLOWER_PCT: 0.10, STEAL_FOLLOWER_MIN: 50,
  STEAL_TAG_OFFER: 3, ITEM_REWARD_ENABLED: false
};
SF.CardGame.defaultConfig();   // returns a fresh deep copy
```
Top balance levers (by leverage): `PLAY_SIZE`(3) > `OPP_HP_FOLLOWER_RATIO`(4.0) >
`TRAFFIC_PER_ROUND`(10) > the §4 coefficients.

> **2026-06-20 balance pass (對手加強):** `OPP_HP_FOLLOWER_RATIO` 0.10 → 4.0 (×40 opponent HP).
> Sim (greedy highest-attack AI): a fresh ~316-follower player beats the entry opponent OPP10 in 2
> rounds and is competitive with OPP09; a grown ~626-follower player beats opponents up to ~1.5× its
> size (OPP10/09/08) over 2–4 rounds and walls above. Opponents far larger than the player still
> one-round the player (attack=讚數 scales with their followers) — intended hard gate; out-grow them.

---

## §7. UI requirements (`SF.CardGameUI` BATTLE view)

KEEP HOME / DECK / SETTLEMENT. Rewrite BATTLE to show:
- **Traffic bar** (流量 0–100%, with current `likeMult` ×1.0–×2.0).
- **Both sides' HP / shield / money**: player (粉絲團 hp/hpMax, 鐵粉 shield, 金錢 money) and
  opponent (same), plus opponent avatar/name/handle.
- **Hand**: each card shows name, **attack = effLikes** (live, recomputed as traffic/buffs change),
  and its **effect labels** (the `label` strings from `card-effects.js`). RETAIN cards marked.
- **Play-3 flow**: click a card → `playCard(handIdx)`; per-card effect resolution appended to a
  **battle log**; primary "結束我方回合" button calls `endPlayerTurn()` (player may stop before 3).
- **Pending-choice overlay**: when `hasPending()`, gate all other actions; render
  `choose_one` (two option buttons → `resolveChoice(i)`) or `scry` (peek list, pick `pick`
  cards → `resolveChoice([uid…])`).
- **Opponent turn**: reveal the scripted post, show its effect then attack, animate damage
  (shield→hp), append to log; `runOpponentTurn()`.
- **Win/lose** → SETTLEMENT (existing).
- Must render a **short hand** (< HAND_SIZE) gracefully (temp/retain shrink the pile).

UI reads only `SF.CardGame.battle` + KEPT getters; never reaches into private engine state.

---

## §8. Excel deliverable

A Python generator reads `data/_card_effects.json` + `posts.json` + `opponents.js`(as data)
and writes an `.xlsx` to:
```
E:\Work\00_Projects\2025_01_SummerRetake\03_Project\00_Program\02_WebDemo\Data
```
Filename: `cardgame_v2_cards.xlsx`. One row per card (player + opponent), columns:

| Column (中文) | Source |
|---|---|
| 貼文ID | post id / OPPxx-Py |
| 名稱 | post name |
| 來源/類型 | `玩家`(+ post type story/filler) or `對手:<oppName>` |
| 詞條 | tag names joined |
| 詞條分類 | `category[]` joined (post `tagCategory` results) |
| 攻擊=讚數來源 | baseLikes source note (`快照讚數` / `post.likes 值`) + the literal baseLikes if known |
| 效果列表 | each effect's `label`, one per line (逐項中文說明) |
| retain | `是` / `否` |
| 對手/玩家 | `玩家` / `對手` |

The generator imports magnitudes already baked into `_card_effects.json` (no re-derivation);
it is a pure read+format step. Standalone (`openpyxl`); not part of the `file://` web runtime.

---

## §9. Determinism & file list

- All randomness via `SF.Algorithm.hash01(SF.Algorithm.seed(str, salt))`. Salts used:
  `":shuffle:"` (initial deck), `":reshuffle:"+count` (reshuffle), `"base_attr"` (共通 slot),
  `"cg:"+oppId+":choice"` (opponent auto-resolve), `"cg:"+oppId+":nonce"` (battle nonce).
- **No `Math.random` / `Date.now`** anywhere in shipped JS.

Files:
| File | Role |
|---|---|
| `js/cardgame.js` | engine — rewrite battle, keep deck/leaderboard/playablePosts/rewards/save/load/onChange; key→`summerfeed.cardgame.v2` |
| `js/cardgame-ui.js` | UI — rewrite BATTLE, keep HOME/DECK/SETTLEMENT |
| `data/card-effects.js` | `window.PIA_CARD_EFFECTS` (player + opponent) — NEW, loaded in index.html |
| `data/_card_effects.json` | same content, for the generator — NEW |
| `data/opponents.js` | unchanged |
| `styles-cardgame.css` | add traffic bar / resource pips (cg-* classes) |
| `index.html` | add `<script src="data/card-effects.js">` after `data/opponents.js` |
| `…/02_WebDemo/Data/cardgame_v2_cards.xlsx` | generated Excel deliverable |
| (generator) `…/02_WebDemo/Data/gen_cardgame_xlsx.py` | Python generator (openpyxl) |

---

## §10. Conflict-resolution log (between the three designs)

| Item | A | B | C | FROZEN |
|---|---|---|---|---|
| `PLAYER_HP_FLOOR` | 30 | 100 | 300 | **300** (C: anchored to OPP10's 320 followers) |
| Effect magnitudes | flat config (2,2,…) | flat (3,5,…) | scale-relative (M/anchor) | **C's relative model**; A's engine semantics; B's labels/order |
| `traffic_add/sub` | 20 | 0.20 | 15 | **15** (C balance) |
| Traffic storage | int % 0–100 | fraction 0–1 | int % | **int % 0–100** (A) |
| `traffic_to_money` | drains traffic 10-pt units | read-only | read-only | **read-only** (B/C; does not drain) |
| `heal` cap | clamp hpMax | cap, conversions uncapped | — | **heal clamps; conversions uncapped** (B Q1) |
| Reflect symmetry | one-sided | symmetric | symmetric | **symmetric** (B Q2) |
| Play count | up to 3 + endPlayerTurn | — | — | **up to 3, explicit endPlayerTurn** (A Q2) |
| parity basis | round# (咖啡) | Nth card this turn | round# | **Nth card this turn = playedThisTurn+1** (B Q4) |
| 街道 double-drain | — | accept互搶 | — | **accept** (followers first, shield≈0) (B Q5) |
| 共通 base slot key | — | hash01(seed(postId,"base_attr")) | — | **hash01(seed(postId,"base_attr"))*6\|0** |
| Shield persistence | persistent | persistent | persistent | **persistent across rounds** (A Q1) |
| Money cap/carry | uncapped, carries | — | small int | **uncapped, carries across rounds** (A Q3) |

Remaining tuning note (non-blocking): matched-tier fights are short by raw math
(3-vs-1 card economy); fight length is carried by opponents' defensive scripted effects.
If a tier's posts map to pure-attack tags only, that fight will be ~1 round — review each
opponent's tag→effect mapping before final balance sign-off (drop `PLAY_SIZE` to 2 or grant a
baseline opponent shield if needed). Engine/data contract above is unaffected.
