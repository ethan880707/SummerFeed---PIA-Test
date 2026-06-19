# 更新日誌 — SummerFeed Web Demo

> 本專案（網頁測試版）的更新紀錄，**獨立**於 Unity（`00_Program/.claude/changelog/`）與 Articy 的紀錄系統。

## 2026-06-19

### 修復（排行榜挑戰 — 傷害與對手讚數）
- **扣血改為「完整讚數差」**：原 `DAMAGE_SCALE = 0.05` 會把傷害縮小（388 vs 115 顯示 −14 而非 −273）。改為 `DAMAGE_SCALE = 1.0`，傷害 = `|雙方讚數總和差|`，符合「對方多 x 讚 → 扣 x 血」的設計。
- **對手貼文讚數改為依粉絲數 + 基數動態計算**：原本是 roster 烤死的小固定值。改為 `oppLikes = round(OPP_LIKES_BASE + 當前粉絲 × post.frac × OPP_LIKES_FRAC_MULT)`（預設 base 60、mult 2.0），與玩家卡量級相當；對手 **血量也改用當前粉絲** 計算（`round(粉絲 × 0.10)`），奪取粉絲後血量／讚數同步下降。
- **玩家血量 100 → 6000**：配合「完整讚數差」傷害（量級為數百~數千）重新調整的固定值。模擬（玩家約 520 粉、最佳牌組）：對 rank 10~7（約 ≤4 倍體量）一回合輾壓、對 rank 6（約 16 倍）為約 15 回合的險勝拉鋸、rank ≤5 會被秒。`PLAYER_HP`／`DAMAGE_SCALE`／`OPP_LIKES_BASE`／`OPP_LIKES_FRAC_MULT` 皆為 `SF.CardGame.config` 可調旋鈕。
- 同步更新 `docs/cardgame-spec.md`（§3 config、§7 平衡）。

### 新增（排行榜挑戰卡牌小遊戲）
- 新分頁「**排行榜挑戰**」，位置在「動態 Feed」右側（`index.html` 第 5 個 tab / `#panel-cardgame`）。
- 凍結契約：`docs/cardgame-spec.md`（玩法、引擎 API、對手資料、平衡數值）。
- 新檔案：
  - `data/opponents.js` — `window.PIA_OPPONENTS`，10 名對手（粉絲 6.5M→320 的等比階梯，`hp = round(粉絲×10%)`），每人 3~4 篇固定貼文（含 2 個**真實**詞條 name + 讚數）。
  - `js/cardgame.js` — `SF.CardGame` 引擎（無 DOM）：牌組、排行榜、戰鬥相位機、獎勵、存檔。
  - `js/cardgame-ui.js` — `SF.CardGameUI` 控制器，4 個子畫面 HOME／DECK／BATTLE／SETTLEMENT。
  - `styles-cardgame.css` — `cg-*` 樣式（沿用 `styles.css` 的 design tokens，未改動 `styles.css`）。
- 玩法：
  - **組成牌庫**：從玩家**自己已發布**的貼文選 7~14 篇；發文不足 7 篇則無法遊玩（阻擋＋提示）。牌庫卡片讚數取自 `SF.Algorithm.compute(...).likes`（牌組組成時的最新狀態，開戰時 snapshot 凍結）。
  - **排行榜**：依**當前粉絲數**降序排列；含玩家合成列。
  - **對戰**：玩家血量固定 100；對手血量 = 粉絲×10%。回合相位 `抽牌(5) → 打出(3，其餘回牌庫；對手出 1 張固定貼文且可見) → 效果判定1(佔位) → 比大小(讚數總和、算差) → 效果判定2(佔位) → 狀態改變(依讚數差扣血) → 回合結束(回牌重洗)`。效果判定 1/2 為未來卡片效果保留的 no-op 相位。
  - **結算**：勝利可三選一獎勵 —— 奪取詞條（隨機 3 選 1，解鎖真實 tag）、奪取粉絲（取對手當前粉絲 10%、下限 50，並自對手扣除）、道具（`ITEM_REWARD_ENABLED:false`，停用「敬請期待」）。對手擊敗後一次性、不可重刷。
  - 平衡數值集中於 `SF.CardGame.config`（`PLAYER_HP`、`DAMAGE_SCALE`、`STEAL_FOLLOWER_PCT` 等），可日後調參。
- 確定性：洗牌與對手抽樣皆用 `SF.Algorithm.hash01/seed`（無 `Math.random`/`Date.now`），`file://` 雙擊可玩；存檔獨立鍵 `summerfeed.cardgame.v1`（只存純值＋id：牌組、對手 runtime 粉絲、擊敗旗標）。
- 引擎防護：`applyReward*` 需「對該對手剛獲勝且未領取」才生效，避免無勝利領獎或雙領；`playablePosts()` 以 `post.id` 去重。

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
