# 更新日誌 — SummerFeed Web Demo

> 本專案（網頁測試版）的更新紀錄，**獨立**於 Unity（`00_Program/.claude/changelog/`）與 Articy 的紀錄系統。

## 2026-06-17

### 新增（建立專案）
- 從企劃表 `260525_SummerFeed_詞條&貼文配方系統_vDEMO修正.xlsx` 抽出資料層：
  - `data/tags.json` — 124 個詞條（地點 32 / 共通 11 / NPC專屬 3 / 劇情 78），含獲取來源、條件、累計 AP、解鎖觸發類型。
  - `data/posts.json` — 121 則貼文配方（劇情推進 42 / 帶圖探索 29 / 文字探索 30 / 填充 10 / NPC私房 10），含詞條配方、流量分級、背德證據旗標。內文留空待補。
  - `data/gates.json` — 33 筆角色 Chunk 推進對照。
  - `data/db.js` — `file://` 可直接載入的 bundle。
  - 轉換腳本：`../Data/convert.py`。
- `SPEC.md` — 凍結契約（資料形狀、模組 API、社群成長演算法 §4）。
- 網頁實作：`index.html` + `styles.css` + `js/{data,algorithm,recipes,state,app}.js`。
  - 4 分頁：詞條庫存 / 發文（配方比對）/ 動態 Feed / 演算法參數。
  - `SF.Recipes` 鏡像 Unity `PIAPlayerPostComposer`（精確集合比對 + 相容詞條過濾）。
  - `SF.Algorithm` 將互動數據成長升級為 logistic 擴散模型（粉絲種子 + Traffic 曝光倍率 + 分享/漲粉雙迴路）。
- 專案文件：`PROJECT.md`、`docs/README.md`、`docs/data-dictionary.md`、`docs/algorithm-design.md`。

### 修改（UI 調整）
- **時間控制移至頂列**：「快進 6 小時／下一天」按鈕從動態 Feed 分頁搬到 sticky 頂列（`index.html`），任何分頁皆可推進時間；Feed 分頁僅保留時間資訊與提示。
- **初始粉絲數設為 0**：`state.js` `seedAccount.baseFollowers` 改為 0、初始 Feed 改為空（移除 NPC 種子貼文），帳號從 0 粉、無貼文開始養。
- **發文分頁新增詞條分類子頁 + 篩選勾選**（`app.js` `buildComposeControls` + `styles.css`）：
  - 分類子頁依 **Excel 代號** 分組（`app.js` `tagCategory`）：去掉 `#`、尾碼數字與「劇／雙倍」後綴，得 16 類「健身／理髮／圖書／自宅／學校／公司／街道／咖啡／巨巨／學妹／阿姨／共通／女A／女B／女C／女D」（例：`健身01/健身02→健身`、`女A劇01/女A劇02→女A`、`巨巨雙倍`併入`巨巨`）。僅列出有已解鎖詞條的分類。
  - 勾選「僅顯示可組成文章的詞條」→ 用新函式 `SF.Recipes.getCompletableTags(已選, 已解鎖)`：只顯示「與已選詞條一起、且**只用已解鎖詞條**即可湊成某完整配方」的下一步詞條；排除其餘詞條未解鎖、永遠湊不出文章者（修正先前誤用 `getCompatibleTags` 導致幾乎不過濾的問題）。

- **加快初期漲粉：新增「漲粉基數」**（`algorithm.js`）。原本 `followerGain` 只有 `reach·followerConvRate·quality`，0 粉起步時 reach 太小、前期幾乎不漲粉。改為：
  `followerGain = followerBaseGain·E·(1−e^(−t/followerRampDays)) + reach·followerConvRate·quality`
  - 新增可調參數 `followerBaseGain`（預設 18）與 `followerRampDays`（預設 1.0），加入「演算法參數」頁。
  - 基數依流量倍率 E 增減（低≈18／中≈34／高≈65 粉，約 1~3 天到位），維持確定性與單調成長。

> 待補：各詞條與貼文的實際內文（`content` 欄位目前為空字串）。
