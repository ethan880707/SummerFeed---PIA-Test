# SummerFeed Web Demo — 內部測試版 規格（凍結契約）

> 此檔是建置的**權威契約**。所有 JS 模組依此實作；函式簽章與資料形狀**不得變動**。
> 目的：在純 HTML+JS 中重現 Unity 專案 **PIA 系統**的「詞條 → 配方 → 發文」與「貼文互動數據成長」流程，供內部測試玩法與調參。
> 三專案分離：本 demo 的文件自成一套（`Project/docs/`），**不**與 Unity（`.claude/`）或 Articy 的 md 混用。

---

## 0. 對應 Unity 來源（行為須一致）

| Web 模組 | Unity 對應 | 行為 |
|----------|-----------|------|
| `RecipeEngine` | `PIAPlayerPostComposer` | 簽章＝詞條集合排序後串接；精確集合比對；`getCompatibleTags` 漸進過濾 |
| `Algorithm` | `PIAStats` + `PIAGrowthConfig`（**強化版**） | 互動數據成長；本 demo 改為社群演算法模型（見 §4） |
| `GameState.tagInventory` | `PIATagInventory` | 已解鎖詞條集合 |
| `GameState.feed` | `PIAFeed` | 已發布貼文序列（含發文日期、來源） |
| `GameState.account` | `PIAAccountRuntime` / Resolver | 玩家帳號粉絲數（fan base） |
| 流量分級 | `PIA_Post.Traffic`（Low/Med/High=0/1/2） | 由配方表星級轉成 tier |

---

## 1. 檔案結構

```
Project/
├── index.html          # 單頁，分頁式 UI；以 <script> 載入 data/db.js（file:// 可直接開）
├── styles.css          # 全部樣式（深色、社群 App 風）
├── data/
│   ├── db.js           # window.PIA_DB = {tags, posts, gates}  ← 由 ../Data/convert.py 生成，勿手改
│   ├── tags.json       # 同源可讀版
│   ├── posts.json
│   └── gates.json
├── js/
│   ├── data.js         # DataStore：索引、查詢
│   ├── algorithm.js    # Algorithm：社群成長模型 + 可調參數
│   ├── recipes.js      # RecipeEngine：配方比對（鏡像 PIAPlayerPostComposer）
│   ├── state.js        # GameState：帳號 / 詞條庫存 / feed / 時鐘
│   └── app.js          # UI 控制器：渲染、事件、分頁
├── docs/               # 本專案文件（與 Unity/Articy 分離）
└── SPEC.md             # 本檔
```

載入順序（index.html 底部）：`db.js → data.js → algorithm.js → recipes.js → state.js → app.js`。
所有模組掛在全域（無 bundler），以單一全域物件命名空間 `window.SF`（SummerFeed）：`SF.Data`、`SF.Algorithm`、`SF.Recipes`、`SF.State`、`SF.App`。

---

## 2. 資料形狀（已由 convert.py 生成，凍結）

### tag（`db.tags[]`）
```js
{ name:"#汗水", code:"#健身01", type:"地點"|"NPC專屬"|"共通"|"劇情",
  source:"健身房", condition:"訓練1次拜訪解鎖", cumulativeAP:1|null,
  route:"COM", note:"...", unlockTrigger:"系統提示"|"無聲"|"旁白"|"小場景",
  section:"健身房", content:"" }
```
- 主鍵＝`name`（hashtag 字串，唯一）。`code` 為配方表代號（多數同 name）。

### post（`db.posts[]`）
```js
{ type:"story"|"image"|"text"|"filler"|"npc",
  id:"A1", name:"首約",
  recipes:[ ["#慾望","#自拍"], ... ],   // 替代配方群組（any-of），每群 all-of
  trafficTier:0|1|2|null, trafficName:"Low"|"Medium"|"High"|null, trafficStars:"★★",
  immoralEvidence:true|false,
  content:"",
  // 依類型附帶：route/unlockChunk/prereq(story)；relatedChar/art/artTrafficRaw(image)；
  //           category/direction(text)；acquire/direction(filler)；relatedNpc/direction(npc)
}
```
- `trafficTier===null`（9 則結局貼文無流量值）→ 演算法視為 `Medium(1)`。
- 主鍵＝`id`（唯一，跨類型不重覆）。

### gate（`db.gates[]`）：角色 Chunk 推進對照（參考用，UI 可選顯示）。

---

## 3. 模組 API（凍結簽章）

### 3.1 `SF.Data`（data.js）
```js
SF.Data.init()                         // 從 window.PIA_DB 建索引；回傳 SF.Data
SF.Data.tags          // tag[]
SF.Data.posts         // post[]
SF.Data.tagByName(name) -> tag|null
SF.Data.postById(id)  -> post|null
SF.Data.tagTypes      // ["地點","共通","NPC專屬","劇情"]
SF.Data.tagsByType(type) -> tag[]
SF.Data.postTypes     // ["story","image","text","filler","npc"]
SF.Data.postsByType(type) -> post[]
```

### 3.2 `SF.Recipes`（recipes.js）— 鏡像 `PIAPlayerPostComposer`
```js
SF.Recipes.signature(tagNames) -> string      // 排序後以 "," 串接（順序無關）
// 建表：對每則 post 的每個替代配方群組各建一條簽章 → postId
SF.Recipes.tryMatch(selectedTagNames) -> { post, recipeIndex } | null   // 精確集合命中
SF.Recipes.getCompatibleTags(currentTagNames) -> Set<string>  // 仍能朝某配方前進的候選詞條（不檢查解鎖）
SF.Recipes.getCompletableTags(currentTagNames, availableTagNames) -> Set<string>
   // 「能與現有詞條組合出文章」：只回傳「與 current 一起、且只用 available(已解鎖) 詞條
   //  即可湊成某完整配方」的下一步詞條；排除其餘詞條未解鎖、永遠湊不出文章者。
   //  發文 UI「僅顯示可組成文章的詞條」勾選即用此函式（availableTagNames = 已解鎖詞條）。
SF.Recipes.matchesForTag(tagName) -> post[]   // 含此詞條的所有貼文（UI 提示用）
```
- 規則同 Unity：`current ⊆ recipe` 時把 `recipe \ current` 納入候選；空選取時回所有配方中出現過的詞條聯集。
- 同簽章衝突取先掃到者（與 Unity 一致），但需 `console.warn` 列出衝突 id 供企劃檢查。

### 3.3 `SF.Algorithm`（algorithm.js）— 見 §4（社群成長模型）
```js
SF.Algorithm.params           // 可調參數物件（UI 參數面板雙向綁定）
SF.Algorithm.defaultParams()  // 回傳一份預設參數（重置用）
// 給定一則已發布貼文的快照 + 當下時間，算出顯示數據
SF.Algorithm.compute(entry, account, nowTicks) -> {
  views:int, likes:int, shares:int, comments:int,
  reach:int, followerGain:int           // 該貼文累積帶來的新粉絲
}
SF.Algorithm.abbreviate(n) -> "1.2K"    // 數字縮寫（同 PIAStats.Abbreviate）
SF.Algorithm.hash01(seed) -> 0..1       // 確定性抖動（同 PIAStats.Hash01）
```
- **純函式、確定性**：相同 (entry, account 狀態, nowTicks) 必得相同結果（可重現，無 Math.random 於 compute）。

### 3.4 `SF.State`（state.js）
```js
SF.State.account     // { handle, baseFollowers, followerDelta }  followers = base+delta
SF.State.followers() -> int
SF.State.tagInventory  // Set<string> 已解鎖詞條 name
SF.State.unlock(name) / lock(name) / unlockAll() / isUnlocked(name)
SF.State.feed        // entry[]：{ postId, postedTick, source:"player"|"npc"|"event" }
SF.State.clock       // { day:1, ticks:0 }  1 day = TICKS_PER_DAY；UI 可「下一天」或「快進數小時」
SF.State.nowTicks() -> int
SF.State.advance(ticks)        // 推進時間
SF.State.nextDay()             // 推進一天、重置今日已發文
SF.State.canPostToday() -> bool
SF.State.publish(postId, source="player") -> entry|null  // 發布；累加粉絲（依各貼文 followerGain 重算）
SF.State.reset()
SF.State.save()/load()         // localStorage（純值 + id，可序列化；對齊「GameData 可存檔」目標）
SF.State.onChange(cb)          // 狀態變更廣播（UI 重繪）
```

### 3.5 `SF.App`（app.js）
- 初始化：`SF.Data.init(); SF.Recipes.build(); SF.State.load(); SF.App.init();`
- 分頁（tabs）：
  1. **詞條庫存**：依類型/來源分組列出全部詞條，顯示獲取方式（source/condition/cumulativeAP/unlockTrigger）；可勾選解鎖（測試用）、一鍵全解。
  2. **發文（配方）**：左＝已解鎖詞條（依 `getCompatibleTags` 即時過濾、未命中變灰）；右＝已選詞條籃；即時 `tryMatch` → 命中顯示貼文預覽卡（id/name/type/traffic/immoral/unlock/prereq），可「發布」；未命中顯示提示。
  3. **動態（Feed）**：依 feed 反序（最新在上）渲染貼文卡，顯示即時 讚/分享/瀏覽/留言 + reach；隨時鐘成長。頂部時間列：目前 Day/ticks、「快進 6 小時」「下一天」。
  4. **演算法參數**：所有 `SF.Algorithm.params` 欄位可即時調整 + 重置；附一個「模擬曲線」小圖（canvas）展示一則貼文在不同 traffic / 粉絲基數下 30 天的成長。
- 全域：帳號粉絲數即時顯示；「重置存檔」按鈕。
- UI 規則遵守專案鐵則：動態生成節點後不需 Unity 式 rebuild，但列表重繪一律「清空容器→重建」，避免殘留。

---

## 4. 社群演算法成長模型（核心，需求 3）

> Unity 現況：簡易飽和曲線 `base*(1+ratio*tier*(1-e^{-t/τ}))`。本 demo **升級為類社群演算法的擴散模型**，讓「粉絲基數」與「話題曝光度（Traffic）」共同驅動成長，並加入**分享回饋**與**漲粉回饋**兩個社群迴路。

### 4.1 直覺
一則貼文的觸及（reach）像病毒擴散：先投放給一部分粉絲（**種子**，由 fan base 決定起跑點），平台量測互動率，互動好就把貼文推給更多非粉絲（**曝光度 Traffic 決定平台願意推多廣、多快**）。分享會再擴大受眾；觸及帶來新粉絲，墊高下一篇的種子 → 形成成長飛輪。

### 4.2 參數（`SF.Algorithm.params`，UI 可調）
```
TICKS_PER_DAY      = 24            // 1 tick = 1 小時（時間以 ticks 計）
// 種子（fan base → 起跑觸及）
followerReachRate  = 0.18         // 自然觸及率：每篇先投放 followers*此比例
discoveryFloor     = 80           // 冷啟動曝光底（無粉也有的探索流量）
// 曝光度（Traffic tier 倍率）—— 同時影響「擴散速率 r」與「容量上限 Carry」
tierExposure       = [1.0, 1.8, 3.2]   // Low / Medium / High
// 擴散（logistic）
baseGrowthRate     = 0.45         // 基礎每日擴散速率 r0
viralGain          = 1.6          // 互動率 → 病毒係數的放大
amplifyMax         = 9.0          // 容量相對種子的最大倍數（高互動高曝光可達）
saturateDays       = 14          // 觀察視窗（曲線大致在此天數內走完）
// 互動漏斗（reach → 各指標），quality 調變
ctrBase            = 0.06         // 基礎互動率（觸及→互動）
likeRate           = 0.090        // 觸及→讚
shareRate          = 0.022        // 觸及→分享（< like）
viewRate           = 0.62         // 觸及→瀏覽（瀏覽 > 讚 > 分享）
shareAmplify       = 2.4          // 每次分享再帶來的觸及（社群迴路 1）
// 漲粉回饋（社群迴路 2）
followerConvRate   = 0.004        // 觸及→新粉絲（隨 reach 成長）
followerBaseGain   = 18           // 每篇漲粉基數（再乘流量倍率 E）：救初期/低粉
followerRampDays   = 1.0          // 基數在發文後幾天內漸進到位（越小越快）
// 品質（每則貼文固定，影響互動率）：背德/結局加成 + 確定性抖動
qualityImmoralBonus= 0.25
jitterRatio        = 0.06         // ±6% 確定性抖動（種子＝hash(postId,metric)）
```

### 4.3 計算（`compute(entry, account, nowTicks)`）
令：
```
t          = max(0, (nowTicks - entry.postedTick) / TICKS_PER_DAY)        // 天
tier       = post.trafficTier ?? 1
E          = tierExposure[tier]
F          = account.followers (發布當下快照 entry.followersAtPost，§4.5)
quality    = clamp01( 0.5 + (immoral?qualityImmoralBonus:0) + (hash01(seed)*2-1)*0.15 )

seed       = F * followerReachRate + discoveryFloor * E
engageRate = clamp( ctrBase * (0.6 + quality), 0, 0.5 )
viralK     = engageRate * E * viralGain
r          = baseGrowthRate * (1 + viralK)
Carry      = seed * (1 + amplifyMax * E * quality)              // 容量上限
// 分享迴路：把分享帶來的額外觸及併入容量
Carry     *= (1 + shareRate * shareAmplify * quality)

// logistic 擴散（以 seed 為 t=0 值）
reach(t)   = Carry / (1 + ((Carry - seed)/seed) * exp(-r * t))

views  = round( reach * viewRate  * jitter(postId,'v') )
likes  = round( reach * likeRate  * jitter(postId,'l') )
shares = round( reach * shareRate * jitter(postId,'s') )
comments = (UI 顯示用，本 demo 取 round(likes*0.06) 或 0；留言不成長)
// 漲粉 = 基數（依流量 E、隨天數漸進）+ 觸及回饋
followerSat   = 1 - exp(-t / followerRampDays)            // 0 → 1，單調
followerGain  = round( followerBaseGain * E * followerSat + reach * followerConvRate * quality )
```
- **漲粉基數**（`followerBaseGain * E`）解決「0 粉起步時 reach 太小、前期幾乎不漲粉」；以曝光度 E 控制流量越高漲越多，`followerRampDays` 控制基數到位速度。基數隨 `t` 單調、確定性，不破壞重現性。
- `jitter(id,m) = 1 + (hash01(seed(id,m))*2 - 1) * jitterRatio`（不含時間 → 隨天數單調，不逐日跳動）。
- 確定性：無 `Math.random`；種子來自 postId（同 PIAStats）。
- 三條設計要求對應：**fan base→seed（起跑）**、**Traffic→E（影響 r 與 Carry，決定擴散快慢與上限）**、**social→shareAmplify + followerConv 兩個回饋迴路**。

### 4.4 為何「像演算法」
- logistic 擴散＝採用/病毒傳播的標準模型：前期加速、後期飽和。
- 曝光度 tier 同時抬高速率 `r`（推得快）與容量 `Carry`（推得廣）→ 高流量貼文「爆」得明顯。
- 粉絲只給**起跑種子**而非天花板，故小帳號好內容仍可破圈（高 quality×E 撐高 Carry），符合真實演算法「去中心化」觀感。
- 分享迴路使容量隨互動再放大；漲粉迴路把成功外溢到帳號，後續篇章水漲船高。

### 4.5 漲粉飛輪
- 發布時 `entry.followersAtPost = account.followers`（快照，確保重算一致）。
- `account.followerDelta` ＝ Σ(各 feed 貼文之 `followerGain`)（隨時間成長，於每次重繪/推進時由 `SF.State` 重算，不逐筆存演進值）。
- 即：看 feed 久一點、貼文擴散 → 帳號粉絲上升 → 之後發的貼文 seed 更大。

---

## 5. 建置注意
- 純前端、零相依、零建置；`index.html` 雙擊即可（已用 `db.js` 規避 fetch）。亦可 GitHub Pages 部署。
- 繁體中文 UI。程式註解可中英混用，對齊既有 Unity 風格。
- 不引入框架（無 React/Vue）；原生 DOM。
- 所有金額/數字顯示走 `SF.Algorithm.abbreviate`。
