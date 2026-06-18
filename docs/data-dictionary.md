# 資料字典（Data Dictionary）

> 本文件記錄 SummerFeed Web Demo 的**資料層**：詞條（tag）、貼文（post）與角色推進對照（gate）的完整欄位定義、計數與形狀。
> 權威來源：[`../SPEC.md`](../SPEC.md) §2「資料形狀」。本文件僅作說明，**不得**與 SPEC 的欄位定義衝突；如有出入以 SPEC 為準。
> 三專案文件分離：本檔屬於 Web Demo（`Project/docs/`），**不**與 Unity（`.claude/`）或 Articy 的 md 混用。

---

## 0. 總覽

| 資料集 | 檔案（可讀版） | 載入版 | 全域路徑 | 筆數 | 主鍵 |
|--------|----------------|--------|----------|------|------|
| 詞條 tags | `data/tags.json` | `data/db.js` | `window.PIA_DB.tags` → `SF.Data.tags` | **124** | `name` |
| 貼文 posts | `data/posts.json` | `data/db.js` | `window.PIA_DB.posts` → `SF.Data.posts` | **121** | `id` |
| 推進對照 gates | `data/gates.json` | `data/db.js` | `window.PIA_DB.gates` → `SF.Data.gates`（參考用） | **34** | `character`+`chunk` |

- `data/*.json` 與 `data/db.js` **同源**，由 `../Data/convert.py` 生成。**請勿手改** `db.js`；要改資料請改 convert 來源再重新生成。
- `index.html` 以 `<script>` 直接載入 `db.js`（規避 `file://` 的 `fetch` 限制），故雙擊即可開。
- 所有物件的 `content` 欄位**目前一律為空字串 `""`**，屬刻意保留（見 §5）。

---

## 1. 詞條 tag（`db.tags[]`）

### 1.1 形狀

```js
{
  name:          "#汗水",          // 主鍵：hashtag 字串，全集合唯一
  code:          "#健身01",        // 配方表代號；多數與 name 相同
  type:          "地點",           // 四選一，見 §1.3
  source:        "健身房",         // 取得來源（地點 / 事件 / NPC）
  condition:     "訓練1次拜訪解鎖", // 解鎖條件的人話描述
  cumulativeAP:  1,                // 累計行動點門檻（int），無門檻為 null
  route:         "COM",            // 路線標記，見 §1.4
  note:          "健身01，女A推進貼文需求", // 企劃備註，可為 null
  unlockTrigger: "系統提示",        // 解鎖呈現方式，見 §1.5
  section:       "健身房",          // 來源分組（UI 分組標題用）
  content:       ""                // 解鎖時的文字內容（保留待填，見 §5）
}
```

### 1.2 欄位逐項說明

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `name` | string | ✔ | **主鍵**。以 `#` 開頭的 hashtag 字串，全 124 筆唯一。配方比對與 `SF.State.tagInventory` 都以此字串為識別。 |
| `code` | string | ✔ | 配方表代號（如 `#健身01`、`#女A劇02`）。多數地點詞條的 `code` 與 `name` 不同（name 是顯示用 hashtag，code 是表格座標）；多數劇情詞條兩者相同。**比對配方時用的是 `name` 不是 `code`。** |
| `type` | string(enum) | ✔ | 詞條分類，四選一。見 §1.3。 |
| `source` | string | ✔ | 取得來源描述（地點名、事件代號或 NPC）。 |
| `condition` | string | ✔ | 解鎖條件的自然語言描述（如「訓練4次後解鎖」「Day 2 早自動」）。 |
| `cumulativeAP` | int \| null | ✔ | 累計行動點（Action Point）門檻。**地點詞條**多為 `1/4/8/12` 的階梯；**NPC專屬 / 共通 / 劇情**詞條多為 `null`（靠事件而非 AP 解鎖）。 |
| `route` | string | ✔ | 路線標記。`COM` 為通用主線；其餘為分歧路線，見 §1.4。 |
| `note` | string \| null | ✔ | 企劃備註，可為 `null`。常見標註「★」表示關鍵詞條（如觸發結局 Chunk 的最終詞條）、或「同一組擇一獲得」「同一事件同時獲得」等分歧說明。 |
| `unlockTrigger` | string(enum) | ✔ | 解鎖時的呈現方式，四選一。見 §1.5。 |
| `section` | string | ✔ | 來源分組標題，UI 詞條庫存頁用此分組（如「健身房」「共同情境詞條（11 個）」「女A劇情詞條」）。 |
| `content` | string | ✔ | 解鎖時要顯示的旁白／提示文字。**現階段全為 `""`**，待後續填入（見 §5）。 |

### 1.3 `type`：詞條四型 + 計數（合計 124）

| type | 筆數 | 說明 | `cumulativeAP` 慣例 |
|------|------|------|----------------------|
| `地點` | **32** | 場所環境詞條（健身房 / 理髮廳 / 圖書館 / 自宅 / 學校 / 公司 / 街道 / 咖啡廳，各 4 個階梯）。萬用配方原料多在此（如 `#自拍`）。 | `1 / 4 / 8 / 12`（按拜訪/行動次數階梯） |
| `共通` | **11** | 跨角色的通用情境詞條（`#搬家`、`#日常`、`#慾望`…）。多由時間或首次事件自動給予。 | 多為 `null` |
| `NPC專屬` | **3** | 付雙倍金錢請 NPC 指導才解鎖（巨巨 / 學妹 / 阿姨各 1）。 | `null` |
| `劇情` | **78** | 各角色（女A/B/C/D、學妹、阿姨、巨巨）劇情事件後自動獲得的詞條，是推進貼文與結局的核心原料。 | `null` |

> `SF.Data.tagTypes` 的順序為 `["地點","共通","NPC專屬","劇情"]`（SPEC §3.1）。

### 1.4 `route`：路線標記

主線詞條為 `COM`（common，通用）。劇情分歧詞條帶分支路線碼，在「同一組擇一獲得」的設定下，玩家依劇情選擇只會拿到其中一個：

| route | 含意 | 出現範例 |
|-------|------|----------|
| `COM` | 通用主線（不分歧） | 絕大多數詞條與貼文 |
| `MASKED` / `UNMASK` | 女A 二番戰「摘/不摘面紗」分歧 | `#規矩` / `#越界` |
| `DATE` / `NODATE` | 交往 / 不交往分歧 | 各角色交往事件詞條 |
| `ANGRY` | 女C 撕破臉分支 | `#女C劇11`、`#女C劇17` |
| `WHIP` / `NOWHIP` | 女C H模式03「鞭笞/不鞭笞」分歧 | `#女C劇12` / `#女C劇13` |
| `NOWAY` / `SURE` | 色色事件「拒絕/接受」分歧 | 學妹、阿姨、巨巨各組 |
| `FAIR` / `UNFAIR` / `SINGLE` | 女D 結局「忠誠/出軌/單身」三分歧 | `#女D劇13/14/15` |
| `COM/ANGRY` | 兼容兩路線（共用詞條） | `#女C劇14` |

> 路線碼供企劃辨識分歧；本 demo 演算法不依 route 改變數值，僅 UI 與配方需求中體現。

### 1.5 `unlockTrigger`：解鎖呈現方式

| 值 | 說明 |
|----|------|
| `系統提示` | 系統彈窗/提示條告知玩家解鎖 |
| `旁白` | 以旁白文字帶出 |
| `小場景` | 播放一段小過場 |
| `無聲` | 無提示、靜默入庫（多數劇情詞條採此） |

---

## 2. 貼文 post（`db.posts[]`）

### 2.1 形狀（共通欄位）

```js
{
  type:            "story",         // 五型之一，見 §2.3
  id:              "A1",            // 主鍵，跨型別唯一
  name:            "首約",          // 顯示標題
  recipes:         [["#慾望","#自拍"]], // 替代配方群組（巢狀陣列），見 §2.2
  trafficTier:     1,              // 流量階 0/1/2，9 則結局為 null，見 §2.4
  trafficName:     "Medium",       // 流量名 Low/Medium/High，結局為 null
  trafficStars:    "★★",           // 星級字串，結局為 null
  immoralEvidence: false,          // 是否為「背德證據」貼文，見 §2.5
  content:         ""              // 貼文文案（保留待填，見 §5）
  // …外加各型別專屬欄位，見 §2.3
}
```

### 2.2 `recipes`：巢狀配方陣列（any-of / all-of）

`recipes` 是**二維陣列**，語意為「**外層 any-of、內層 all-of**」：

```
recipes = [ 群組1, 群組2, … ]            // 外層：任一群組命中即算命中此貼文（OR）
群組   = [ "#詞條A", "#詞條B", … ]        // 內層：須「精確等於」此集合才命中（AND，且不可多也不可少）
```

- **內層＝精確集合比對**（exact set）：玩家選取的詞條集合須**恰好等於**某個群組（順序無關），多一個或少一個都不命中。鏡像 Unity `PIAPlayerPostComposer`：對群組排序後串接成「簽章」，與玩家選取的簽章做相等比對。
- **外層＝替代配方**：一則貼文可有多組可達成路徑（例如同一 Chunk 的不同分歧共用同一貼文）。
- **絕大多數貼文只有 1 個群組**；目前資料中**唯一**擁有 2 組替代配方的是 `C6`「平靜」：

```js
"recipes": [
  ["#女C劇14", "#圖書04"],   // 群組0
  ["#女C劇11", "#圖書04"]    // 群組1
]
```

- 群組大小範圍：**1～3 個詞條**。結局貼文（A8/B7/C7/D7…）多為**單詞條**配方（如 `["#掀開帷幕"]`）。
- 簽章衝突（兩貼文產生相同簽章）時，`SF.Recipes` 取**先掃到者**並 `console.warn` 列出衝突 id（SPEC §3.2）。

> `SF.Recipes.tryMatch(selected)` 命中時回 `{ post, recipeIndex }`，`recipeIndex` 即命中的外層群組索引。

### 2.3 五種貼文型別與專屬欄位（合計 121）

`type` 為主分類，五選一。`SF.Data.postTypes` 順序為 `["story","image","text","filler","npc"]`（SPEC §3.1）。

| type | 中文 | 筆數 | 專屬欄位 |
|------|------|------|----------|
| `story` | 劇情推進貼文 | **42** | `route`、`unlockChunk`、`prereq` |
| `image` | 圖片探索貼文 | **29** | `relatedChar`、`art`、`artTrafficRaw` |
| `text` | 文字貼文 | **30** | `category`、`direction` |
| `filler` | 填充貼文 | **10** | `acquire`、`direction` |
| `npc` | NPC 語錄貼文 | **10** | `relatedNpc`、`direction` |

#### 2.3.1 `story`（42 則）— 角色 Chunk 推進

| 欄位 | 型別 | 說明 |
|------|------|------|
| `route` | string | 路線碼（同 §1.4）。分歧貼文用 a/b/c 後綴 id（如 `A3a`/`A3b`、`D7a/b/c`）。 |
| `unlockChunk` | string | 此貼文推進到的 Chunk 編號（`"1"`～`"7"`），結局貼文為 `"結局"`。 |
| `prereq` | string \| null | 前置條件描述（如「二番戰選不摘面紗」「結局檢定貼文」），無前置為 `null`。 |

涵蓋女A（A1–A8）、女B（B1–B7）、女C（C1–C7）、女D（D1–D7），含分歧分支。

#### 2.3.2 `image`（29 則，id `E01`–`E29`）— 圖片探索

| 欄位 | 型別 | 說明 |
|------|------|------|
| `relatedChar` | string | 關聯角色（`女A`/`女B`/`女C`/`女D`），無特定角色為 `"-"`。 |
| `art` | string | 美術來源：`CG復用` / `BG復用` / `新繪`。 |
| `artTrafficRaw` | string | 美術側標的原始星級（資料中**一律 `"★★"`**，與最終 `trafficStars` 可能不同；後者才是生效流量）。 |
| `prereq` | string | 解鎖前置描述（如「H模式00（新手教學）」「街道5次+」）。 |

> 注意：`image` 的 `prereq` 為一般 string（非 `null`）；`story` 的 `prereq` 才可為 `null`。

#### 2.3.3 `text`（30 則，id `W01`–`W30`）— 文字貼文

| 欄位 | 型別 | 說明 |
|------|------|------|
| `category` | string | 內容分類：`思考` / `日常` / `八卦` / `Meta` / `回憶`。 |
| `direction` | string | 給寫手的內容方向提示（如「失眠時讀到一句話的延伸」）。 |

#### 2.3.4 `filler`（10 則，id `F01`–`F10`）— 填充貼文

| 欄位 | 型別 | 說明 |
|------|------|------|
| `acquire` | string | 取得方式：`自動` 或地點次數（如 `學校1`、`健身4`）。 |
| `direction` | string \| null | 內容方向提示，可為 `null`。 |

filler 全為**單詞條配方**、流量一律 `Low(0)`。

#### 2.3.5 `npc`（10 則，id `N01`–`N10`）— NPC 語錄

| 欄位 | 型別 | 說明 |
|------|------|------|
| `relatedNpc` | string | 關聯 NPC：`巨巨` / `學妹` / `阿姨`。 |
| `direction` | string | 內容方向提示。 |

npc 貼文配方多為「NPC專屬詞條 + 該 NPC 劇情詞條」的雙詞條組合，流量一律 `Medium(1)`。

### 2.4 流量分級（traffic tier）對照

貼文以三個彼此一致的欄位表達流量強度（由配方表星級轉換而來，鏡像 Unity `PIA_Post.Traffic`）：

| `trafficStars` | `trafficName` | `trafficTier` | 對應 Unity enum | 演算法曝光倍率 `tierExposure[tier]` |
|----------------|---------------|---------------|-----------------|--------------------------------------|
| `★` | `Low` | `0` | `Low` | `1.0` |
| `★★` | `Medium` | `1` | `Med` | `1.8` |
| `★★★` | `High` | `2` | `High` | `3.2` |
| `null`（無星） | `null` | `null` | —（結局貼文無流量值） | 演算法視為 `Medium(1)` |

- 星級↔tier 為**嚴格 1:1**：★=0、★★=1、★★★=2。
- **`trafficTier === null` 的 9 則貼文**＝各角色結局貼文：`A8`、`B7a`、`B7b`、`C7a`、`C7b`、`C7c`、`D7a`、`D7b`、`D7c`。三欄（tier/name/stars）同時為 `null`。演算法 `compute()` 內以 `tier = post.trafficTier ?? 1` 落到 `Medium`（SPEC §2、§4.3）。
- `image` 另有 `artTrafficRaw`（美術側原始星級，皆 `★★`），**僅供參考**；生效流量以 `trafficTier/trafficName/trafficStars` 為準（例：`E15` 咖啡廳窗邊 `artTrafficRaw="★★"` 但最終 `trafficStars="★"`/`Low`）。

#### 各型別流量分布（速查）

| type | Low(0) | Medium(1) | High(2) | null |
|------|--------|-----------|---------|------|
| story | 0 | 24 | 9 | 9 |
| image | 5 | 12 | 12 | 0 |
| text | 0 | 30 | 0 | 0 |
| filler | 10 | 0 | 0 | 0 |
| npc | 0 | 10 | 0 | 0 |

### 2.5 `immoralEvidence`：背德證據旗標

- `boolean`。`true` 表示該貼文為「背德證據」性質（CG/H 模式相關的露骨內容）。
- 共 **14 則** 為 `true`，全部集中在 `image` 型別（玩家探索貼文 E02–E13 多數 + E20、E22），其餘型別皆 `false`。
- 演算法用途：`true` 會給予品質加成 `qualityImmoralBonus = 0.25`（SPEC §4.2/§4.3），使背德貼文擴散更廣。

---

## 3. 推進對照 gate（`db.gates[]`，34 筆）

角色 Chunk 推進的對照表，**參考用**（UI 可選擇顯示），不參與演算法計算。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `character` | string | 角色（`女A`/`女B`/`女C`/`女D`）。 |
| `chunk` | string | Chunk 編號（`"0"`～`"6"`，結局為 `"結局"`）。`"0"` 多為自動橋段。 |
| `post` | string | 對應貼文標題（可能列多個分歧，如「A3a 界限a / A3b 界限b」）。 |
| `recipeRaw` | string | 配方的人話寫法（含 `+`、`／` 分隔），`—` 表示無配方（自動）。 |
| `recipes` | string[][] | 與 post 同形狀的巢狀配方陣列；自動橋段為空陣列 `[]`。 |
| `route` | string | 該 Chunk 的路線（可能是 `DATE/NODATE` 等複合字串）。 |
| `estDay` | string | 預估觸發日（`Day N` 或 `Day N-M`）。 |
| `event` | string | 觸發此 Chunk 的劇情事件描述。 |

> 四角色各約 8–9 條（Chunk 0 → 結局），合計 34 筆。

---

## 4. 主鍵、唯一性與交叉參照

- **tag 主鍵 = `name`**：124 筆唯一。`SF.State.tagInventory`（`Set<string>`）與 `recipes` 內的字串都引用此值。
- **post 主鍵 = `id`**：121 筆唯一，**跨型別不重覆**（id 前綴隱含型別：`A/B/C/D`=story、`E`=image、`W`=text、`F`=filler、`N`=npc）。`SF.State.feed` 的 entry 以 `postId` 引用。
- **recipes → tags**：`recipes` 內每個字串都應對應一筆 tag 的 `name`（玩家須先解鎖該 tag 才能湊出配方）。
- **gates ↔ posts**：`gate.recipes` 與對應 `post.recipes` 形狀一致，可交叉核對。

---

## 5. content 欄位刻意留空（重要）

- tag 與 post（以及未列的相關文案欄位）的 **`content` 一律為空字串 `""`**。
- 這是**刻意保留**：本 demo 階段聚焦「詞條 → 配方 → 發文 → 互動數據成長」的**機制與調參**，實際文案（旁白、貼文文案）**待後續填入**。
- 程式端不得假設 `content` 非空；UI 顯示文案時應對空字串做容錯（顯示佔位或留白），未來補字僅需回填 `content`，不影響資料形狀。

---

## 6. 計數速查（驗證基準）

| 項目 | 數值 |
|------|------|
| tags 總數 | **124** |
| ├ 地點 | 32 |
| ├ 共通 | 11 |
| ├ NPC專屬 | 3 |
| └ 劇情 | 78 |
| posts 總數 | **121** |
| ├ story | 42 |
| ├ image | 29 |
| ├ text | 30 |
| ├ filler | 10 |
| └ npc | 10 |
| 流量 null 的貼文（結局） | 9 |
| `immoralEvidence === true` | 14 |
| 擁有多組替代配方的貼文 | 1（`C6`） |
| gates 總數 | 34 |

> 任何 convert.py 重新生成後，請以本表回歸驗證；數值變動須同步更新本文件與 [`../SPEC.md`](../SPEC.md)。

---

*資料字典版本：對齊 SPEC 凍結契約（§2 資料形狀）。所有欄位定義以 SPEC 為最終權威。*
