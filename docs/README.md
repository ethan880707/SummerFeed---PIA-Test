# SummerFeed Web Demo

> SummerRetake 專案內部測試用網頁 Demo。
> 在純 HTML + JS（零相依、零建置、原生 DOM）環境中重現 Unity 專案 **PIA 系統** 的「詞條 → 配方 → 發文」與「貼文互動數據成長」流程，供企劃／程式測試玩法、調整演算法參數。

---

## 目的

本 Demo 是給內部使用的測試工具，不對外發布。主要解決三件事：

1. **詞條 / 配方驗證**
   把 PIA 的詞條（hashtag）與貼文配方表搬到瀏覽器，讓企劃可以即時試組合：選哪些詞條會命中哪一則貼文、命中後流量分級（Traffic）與背德旗標長怎樣。
2. **發文流程模擬**
   重現玩家在 PIA 中「解鎖詞條 → 組配方 → 發布貼文」的完整動線，不必開 Unity 專案即可走過一遍。
3. **社群成長演算法調參**（核心需求）
   把 Unity 端的簡易飽和曲線升級成「類社群演算法的擴散模型」，讓**粉絲基數**、**話題曝光度（Traffic）**、**分享回饋**、**漲粉回饋**共同驅動成長。所有參數可在頁面上即時調整並看到曲線變化，方便找出手感數值後再回填 Unity。

> 完整的權威契約（函式簽章、資料形狀、演算法公式）請見 [`../SPEC.md`](../SPEC.md)。本 README 為導覽說明，**遇衝突一律以 SPEC.md 為準**。

---

## 文件範圍：三套獨立文件系統

本 Demo 的文件（`Project/docs/`）**自成一套，與下列兩套互不混用**：

| 文件系統 | 位置 | 用途 |
|----------|------|------|
| **本 Demo 文件** | `02_WebDemo/Project/docs/` | 網頁 Demo 的說明、操作、結構 |
| Unity 協作文件 | `00_Program/.claude/` | Unity 專案的索引／分析／更新日誌 |
| Articy 文件 | Articy:draft 內的 md / 匯出 | 對話與劇情原始資料 |

三者是**三個獨立專案**，請勿把本 Demo 的內容寫進 `.claude/`，也勿把 Unity／Articy 的紀錄塞進本資料夾。

---

## 如何開啟

**最簡單：雙擊 `index.html`。**

- 直接用瀏覽器以 `file://` 開啟即可運作，**不需要架站、不需要 Node、不需要任何安裝**。
- 之所以雙擊就能跑，是因為資料以 `data/db.js`（`window.PIA_DB`）的形式用 `<script>` 載入，刻意避開了 `fetch()`（`file://` 下 `fetch` 會被瀏覽器 CORS 擋掉）。
- 建議瀏覽器：較新版的 Chrome / Edge / Firefox。

**亦可部署到 GitHub Pages：**

- 整個 `Project/` 為純靜態檔，把它推上 GitHub 後在 repo 設定開啟 GitHub Pages（指向該資料夾或其建置分支）即可線上瀏覽，方便分享給沒有本機環境的成員測試。
- 線上版同樣不依賴後端，所有運算都在前端完成。

---

## 資料來源

所有遊戲資料由 **`../Data/convert.py`** 從企劃維護的 xlsx（詞條表、配方表、Chunk 推進表）轉出，產生下列檔案：

| 檔案 | 內容 | 說明 |
|------|------|------|
| `data/db.js` | `window.PIA_DB = { tags, posts, gates }` | 程式實際載入的版本，雙擊可用；**由 convert.py 生成，請勿手改** |
| `data/tags.json` | 詞條陣列 | 同源、可讀的 JSON 版（方便 diff／檢視） |
| `data/posts.json` | 貼文陣列 | 同上 |
| `data/gates.json` | 角色 Chunk 推進對照 | 參考用，UI 可選擇顯示 |

> 來源 xlsx 路徑與轉換流程細節**留待補充**（待企劃確認後填入）。
>
> 原則：**改資料就改 xlsx → 重跑 `convert.py`**，不要直接編輯 `db.js` / `*.json`，以免下次轉檔被覆蓋。

### 主要資料形狀（摘要）

- **tag**：主鍵＝`name`（hashtag 字串，唯一）。欄位含 `code`（配方表代號）、`type`（地點／NPC專屬／共通／劇情）、`source`、`condition`、`cumulativeAP`、`unlockTrigger` 等。
- **post**：主鍵＝`id`（跨類型唯一）。含 `type`（story／image／text／filler／npc）、`recipes`（替代配方群組，**any-of**；每群內為 **all-of**）、`trafficTier`（0/1/2，`null` 視為 Medium）、`immoralEvidence`。
- **gate**：角色每個 Chunk 對應的貼文與配方、預估天數、事件，純參考。

> 完整欄位定義見 SPEC.md §2。

---

## 四個分頁操作說明

頁面為單頁分頁式 UI，頂部固定顯示**帳號粉絲數**與「重置存檔」按鈕。

### 1. 詞條庫存

- 依**類型 / 來源**分組列出**全部詞條**，每張卡顯示獲取方式：來源（`source`）、解鎖條件（`condition`）、累積 AP（`cumulativeAP`）、解鎖提示型態（`unlockTrigger`）。
- 可**勾選解鎖／鎖定**任意詞條（測試用，不受遊戲流程限制）。
- 提供**一鍵全解**，快速把所有詞條打開以便測配方。
- 此處解鎖的詞條，才會出現在「發文」分頁的左側可用清單。

### 2. 發文（配方）

- **左側＝已解鎖詞條**：會依目前已選詞條即時呼叫 `getCompatibleTags` 過濾——**仍可能朝某配方前進的詞條維持可點，其餘變灰**，引導玩家組出有效配方。
- **右側＝已選詞條籃**：點左側詞條加入、再點移除。
- 每次變動即時 `tryMatch`：
  - **命中** → 顯示貼文預覽卡（`id` / `name` / `type` / Traffic 星級 / 背德旗標 / 解鎖資訊 / 劇情前置條件），並可按「**發布**」把它送進 Feed。
  - **未命中** → 顯示提示，告訴你目前選取尚未對上任何配方。
- 配方比對規則鏡像 Unity 的 `PIAPlayerPostComposer`：**集合精確比對、順序無關**；同簽章衝突取先掃到者（並於 console 警告，供企劃檢查）。

### 3. 動態（Feed）

- 依 Feed **反序**渲染貼文卡（最新在上）。
- 每張卡顯示**即時 讚 / 分享 / 瀏覽 / 留言 + 觸及（reach）**，數值隨時鐘成長（logistic 擴散曲線）。
- 頂部時間列顯示目前 **Day / ticks**，並提供「**快進 6 小時**」「**下一天**」。
- 觀念：時間往前走 → 貼文持續擴散 → 帶來新粉絲 → 帳號粉絲上升 → 之後發的貼文起跑種子更大（漲粉飛輪）。

### 4. 演算法參數

- 列出 `SF.Algorithm.params` 的**所有可調欄位**（觸及率、曝光倍率、擴散速率、互動漏斗、分享／漲粉回饋等），可即時調整，並提供「**重置**」回預設值。
- 附一張 **canvas 模擬曲線**：展示一則貼文在不同 Traffic 分級 / 粉絲基數下 30 天的成長走勢，方便直觀比較參數效果。
- 調好的數值即為回填 Unity `PIAGrowthConfig` 的參考。

---

## 與 Unity PIA 系統的對應

本 Demo 的每個模組都對應到 Unity 端的實作，行為需保持一致：

| Web 模組（`window.SF`） | Unity 對應 | 行為 |
|------------------------|-----------|------|
| `SF.Recipes`（RecipeEngine） | `PIAPlayerPostComposer` | 簽章＝詞條集合排序後串接；精確集合比對；`getCompatibleTags` 漸進過濾 |
| `SF.Algorithm`（Algorithm） | `PIAStats` + `PIAGrowthConfig`（**強化版**） | 互動數據成長；Demo 升級為社群擴散模型 |
| `SF.State.tagInventory` | `PIATagInventory` | 已解鎖詞條集合 |
| `SF.State.feed` | `PIAFeed` | 已發布貼文序列（含發文時間、來源） |
| `SF.State.account` | `PIAAccountRuntime` / Resolver | 玩家帳號粉絲數（fan base） |
| 流量分級 | `PIA_Post.Traffic`（Low / Med / High = 0/1/2） | 由配方表星級轉成 tier |

- **演算法是強化版**：Unity 現況為簡易飽和曲線 `base*(1+ratio*tier*(1-e^{-t/τ}))`；Demo 改為 logistic 擴散 + 分享回饋 + 漲粉回饋（詳見 SPEC.md §4）。
- 數值縮寫（`1.2K` 等）對齊 `PIAStats.Abbreviate`；確定性抖動對齊 `PIAStats.Hash01`（**compute 為純函式、無 `Math.random`**，相同輸入必得相同結果）。
- 存檔以 localStorage 序列化（純值 + Articy id），對齊「GameData 可存檔／讀取」的長期目標。

---

## 檔案結構

```
Project/
├── index.html          # 單頁、分頁式 UI；以 <script> 載入 data/db.js（file:// 可直接開）
├── styles.css          # 全部樣式（深色、社群 App 風）
├── data/
│   ├── db.js           # window.PIA_DB = {tags, posts, gates}  ← 由 ../Data/convert.py 生成，勿手改
│   ├── tags.json       # 同源可讀版
│   ├── posts.json
│   └── gates.json
├── js/
│   ├── data.js         # SF.Data：索引、查詢
│   ├── algorithm.js    # SF.Algorithm：社群成長模型 + 可調參數
│   ├── recipes.js      # SF.Recipes：配方比對（鏡像 PIAPlayerPostComposer）
│   ├── state.js        # SF.State：帳號 / 詞條庫存 / feed / 時鐘
│   └── app.js          # SF.App：UI 控制器（渲染、事件、分頁）
├── docs/               # 本專案文件（與 Unity / Articy 分離）★ 本檔位於此
└── SPEC.md             # 凍結契約（權威）
```

**載入順序**（`index.html` 底部）：
`db.js → data.js → algorithm.js → recipes.js → state.js → app.js`

所有模組掛在單一全域命名空間 `window.SF`：`SF.Data`、`SF.Algorithm`、`SF.Recipes`、`SF.State`、`SF.App`。

---

## 延伸閱讀

- [`../SPEC.md`](../SPEC.md) — 凍結契約：函式簽章、資料形狀、演算法公式（**權威，以此為準**）。
