# 更新日誌 — SummerFeed Web Demo

> 本專案（網頁測試版）的更新紀錄，**獨立**於 Unity（`00_Program/.claude/changelog/`）與 Articy 的紀錄系統。

## 2026-06-22（v3.3：排行榜對手加密）

### 新增（10 名對手填補名次落差）
- `data/opponents.js` 由 10 名擴充為 **20 名**（新增 OPP11~OPP20），填補「第 7 名往上」的大落差。
- 粉絲階梯由原本每階 ~3.8x 細化到 ~1.5~2x（最大階差 2.42x，且僅落在第 7 名以下的 950→2300；第 7 名以上每階皆 ≤2x）。
- 新對手主題各異（選秀歌姬／直播天王／開箱王／親子部落客／穿搭／健身教練／美食探店／獨立書店／地下樂團／底片攝影），粉絲分布：5.2M / 4.2M / 2.7M / 1.1M / 700K / 320K / 200K / 62K / 16K / 4.5K。
- 排行榜 `leaderboard()` 依粉絲數動態排序，新舊對手自動交錯（OPP01→OPP11→OPP12→OPP13→OPP02…）。
- 註：新對手貼文目前為「純攻擊」（無特殊效果）；如需比照舊對手加上效果再告知。

## 2026-06-22（v3.2：依《貼文配方表_v2》重做 + 費用/消耗 + 演算法調參）

### 修改（卡牌全面重做：費用 / 消耗）
- 玩家卡效果改由 `Data/貼文配方表_v2.xlsx` 解析（`gen_from_table.py` 改讀 v2，130 張全覆蓋、0 未識別）；以「編號」對應 `posts.json` 貼文。v2 已移除的舊貼文（D7a/b/c、N08~10）給預設「1費純攻擊」。
- **費用（能量）系統**：新增與代幣分開的能量資源，每回合**回滿至 `ENERGY_MAX=3`**。出牌需支付卡片費用（0/1/2 費），能量不足不能出（UI 卡片變灰）；輔助牌為 0 費。`gain_energy`（F07「獲得1點費用」）本回合 +1。
- **消耗（exhaust）**：標「消耗」的牌（增手牌上限、流量歸0 等）打出後**移除出遊戲**（不入棄牌堆，整場不再出現）；UI 顯示黃色「消耗」標籤。
- **「本回合X獲得兩倍」→「+X%」**：改為 `turn_gain_bonus`（加成比例，+100%＝×2；+50%＝×1.5），可疊加。
- 新增效果 `traffic_to_shield`（流量X%轉鐵粉）。
- UI：對戰資源列新增「費用 N/3」能量條；手牌左上顯示費用徽章；保留/輔助/消耗/暫時皆有標籤。
- 重生 `data/card-effects.js` + `_card_effects.json` + 對照表 Excel（新增 費用/輔助/消耗 欄）。

### 修改（演算法基礎數值）
- `algorithm.js`：`likeRate` 0.090 → **0.2**；`followerConvRate` 0.004 → **0.08**。（讚數與漲粉皆大幅提高）

### 新增（編號對照）
- **發布貼文預覽**與**組成牌庫**的卡牌名稱後方加上貼文編號（如「首約（A1）」），方便與配方表對照。

## 2026-06-22（v3.1：重置/牌庫/輔助牌/隨機抽牌）

### 修復
- **重置存檔同時重置排行榜挑戰**：`app.js` 重置鈕現在也呼叫 `SF.CardGame.reset()`（清牌庫、對手 runtime 粉絲、擊敗旗標）。
- **重複發布同貼文取讚數高者**：`playablePosts()` 改為同一 postId 取「讚數最高」的那筆作為牌庫卡數值（仍去重為 1 張）。

### 新增 / 修改
- **輔助牌（共通牌）**：詞條配方全為「共通」的貼文（F01~F10）標記為 `support`。
  - 顯示：發文預覽 / 組牌 / 對戰手牌都顯示藍色「輔助」標籤（如同「保留」）。
  - 機制：輔助牌**不消耗出牌次數**（可在打滿 3 張後續打），且**無讚數**（baseLikes=0、不累積攻擊），純功能牌。
  - `cardgame.js`：`playCard` 不以 PLAY_SIZE 擋輔助牌；`finishCardAttack` 對輔助牌只跑效果、不加攻擊也不增 `playedThisTurn`。
- **每回合隨機抽牌**：`startBattle` 改用「隨機 nonce」（`Math.random`）起始洗牌，使重新挑戰同一對手也會有不同手牌（對戰為暫態、不持久化，故可用亂數；單場內仍由種子衍生可重現）。

## 2026-06-21（v3：依「貼文配方表」重做卡牌效果）

### 修改（玩家貼文效果改採設計表）
- 玩家所有貼文效果改由 `02_WebDemo/Data/貼文配方表.xlsx`（『能力（效果展開）』欄）定義，由新腳本 `Data/gen_from_table.py` 解析（122 筆全數解析、0 未識別）→ 重生 `data/card-effects.js` + `_card_effects.json` + 對照表 `Data/SummerFeed_卡牌效果對照表.xlsx`。對手卡沿用既有效果。`posts.json` 的 `D4` 自動沿用表中 `D4a` 效果（覆蓋全部 121 篇）。
- **代幣（金錢）**：初始 **10**、每回合 **+5**（首回合維持初始值，不加）。新增匯率：`MONEY_ATK_FRAC=0.05`（花費 1 代幣 = 該卡讚數 5%）、`TRAFFIC_ATK_FRAC=0.01`（消耗 1% 流量 = 讚數 1%）。
- **引擎效果大擴充**（`cardgame.js`）：新增 43 種效果 kind 處理，含
  - 增益／轉換：`gain_atk`、`likes_to_shield`、`shield_to_atk`、`shield_to_hp(%)`、`hp_to_atk`、`hp_to_shield`、`traffic_to_atk/hp/money(%)`、`money_to_atk(花費%)`、`money_mult`、`money_pack(+代幣&永久增加)`、`gain_money`。
  - 條件／回合：`cond_traffic`（當流量高於 Y%）、`turn_double`（本回合 讚數/鐵粉/粉絲 兩倍，經乘區結算）、`hand_size_up`（最大手牌+N）。
  - 集中式 `gainShield/gainHp/gainAtk/gainMoney` 套用「本回合兩倍」乘區與「取消對手下一次獲得」。
  - 進階近似：`nth_card_amp`／`next_amp`（第N張／下一個奇偶效果放大）、`nth_card_repeat`（第N張發動多次）、`all_in`（隨機 50~100% 代幣換 2×）、`random_gain`、`random_post`（生成臨時卡）、`copy_last`（複製上一張）、`cancel_opponent`（取消對手下一次獲得）、`draw_discard`、`retain_n`（保留N張手牌）、`retain_gain`（學妹：被保留額外加成）。標為近似，後續可精修。
- 驗證：全檔 `node --check` 通過、無 `Math.random`/`Date.now`；天梯與多場對戰 0 卡死。
- 註：玩家卡偏防禦/利用型，貪心 AI（只出最高攻擊）下勝帶較窄（F≈626 約勝 OPP10/09）；實際策略運用（護盾/回復/轉換/代幣爆發）應更強。如需再調平衡（如 `OPP_HP_FOLLOWER_RATIO`）再告知。

## 2026-06-20（續：v2.3 結算時機與測試工具）

### 修改（出牌改為「回合結算傷害」）
- 打出的牌**不再立即造成傷害**：每張卡的讚數（攻擊）累進該側 `turnAtk`（狀態欄新增「本回合讚數」pill 即時顯示），**回合結束時一次結算**為傷害（`cardgame.js` 新增 `settleTurnDamage`；`finishCardAttack` 改為累積；玩家於 `endPlayerTurn`、對手於 `runOpponentTurn` 結束時結算）。
  - 反傷讀結算時的總攻擊、吸血依累積攻擊回粉；防禦卡（加鐵粉）與其他效果仍於出牌時即時觸發。
  - `turnAtk`/`turnLifestealHeal` 於各自回合開始重置；對手揭示面板沿用其打出卡＋結算傷害摘要。
  - 模擬驗證：連出 3 張時對手血量不變、`本回合讚數` 由 150→244→446 累積，回合結束一次扣 446。

### 新增（測試工具）
- **發文頁「一鍵解鎖全部貼文」**：對應詞條庫存的「一鍵全解」，一鍵把全部貼文發布到 feed（`SF.State.publishAll()`，忽略每日一篇限制），方便快速備齊牌庫測試排行榜挑戰。工具列另顯示「已發布 N / 總數」。

## 2026-06-20（續：v2.2 效果顯示與保留修正）

### 新增（卡牌效果顯示）
- **發文分頁預覽**：預覽貼文時一併顯示該貼文對應的卡牌效果（`app.js` `buildCardEffects`，讀 `window.PIA_CARD_EFFECTS`），含「保留」旗標；無效果者顯示「僅基礎攻擊＝讚數」。
- **組牌（編組牌庫）**：每張可選卡也顯示其效果標籤與「保留」旗標（`cardgame-ui.js` `cardEl` 改讀 `opts.effects` + `cardFxFor`）。
- 樣式 `post__fx*` 加於 `styles-cardgame.css`（不改 `styles.css`）。

### 修復（保留 retain）
- **打出後的 retain 牌改入棄牌堆**：原 `finishPlayerCard` 會把已打出的 retain 牌放回手牌（bug，打出後仍留在手上）。修正為「打出的牌一律入棄牌堆（temp 例外消失）」；`retain` 旗標只影響「回合結束時仍在手、未打出的牌」是否保留。
- **保留牌跨回合清暫態**：`endPlayerTurn` 保留未打出的 retain 牌時，清除其 `_addBuff/_mulBuff/_anchorLikes` 等暫態，下回合以乾淨狀態重算。
- **抽牌補滿至 5**：抽牌階段為「補滿至 HAND_SIZE」（`HAND_SIZE − 手牌數`），手上有保留牌時只補不足數（如保留 1 張則抽 4 張＝共 5 張）。此前「抽到 6 張」是上述 retain bug 的連帶現象，已隨之修正（模擬驗證：保留 3 張＋補 2 張＝5）。

## 2026-06-20（續：v2.1 效果調整）

### 修改（效果固定值 → 本卡讚數的 %）
- 多數效果原為**固定整數**（增加攻擊、回復血量、鐵粉等），高讚卡時顯得雞肋；改為**該貼文讚數的百分比**，由引擎於出牌當下以該卡 live 讚數動態計算：
  - 引擎新增 `amountOf`/`perMoneyOf` 與每張卡的 `_anchorLikes`（出牌當下讚數基準），效果改讀 `pct`/`perMoneyPct`/`pctPer10`（沿用舊 `amount`/`perMoney`/`kPer10` 為後備）。
  - 套用範圍：學校/咖啡廳/女C 的 `add_shield`、健身房 `heal`、女B/阿姨 `atk_from_traffic(_low)`、街道 `money_to_followers`/`money_to_shield`、自宅 `money_to_atk`、共通 base 二選一的 `add_shield`。
  - 預設百分比（可於 `gen_card_effects.py` 調整）：鐵粉 50%、回復 50%、流量每 10% 攻擊 +讚數 10%、錢轉粉絲 25%/元、錢轉鐵粉 40%/元、錢轉攻擊 20%/元、女C 偶數鐵粉 40%、咖啡偶數 30%。
  - 已是相對值者（buff 的 `atkFrac`、巨巨 ratio、反傷、流量增減、`gen_money`）維持不變。
  - 卡面與 Excel 標籤改為顯示「= 本卡讚數 X%」。
- **scry（查看牌庫挑卡）洗牌時機**：牌庫數量為 **0** 才先重洗棄牌堆再查看；剩 1~（查看數-1）張則**不重洗**，直接看現有的（`cardgame.js` scry case）。
- 重新生成 `data/card-effects.js` + `_card_effects.json` + Excel 對照表（156 張）。
  - ⚠️ 原 Excel `SummerFeed_卡牌效果對照表.xlsx` 產生當下被 Excel 開啟鎖定，更新版暫存為 `SummerFeed_卡牌效果對照表_NEW.xlsx`；關閉舊檔後重跑 `python gen_card_effects.py` 即可覆蓋回正名。

## 2026-06-20

### 新增 / 重構（排行榜挑戰 v2 — 回合制大改版）
- **凍結契約**：`docs/cardgame-v2-spec.md`。`localStorage` 鍵升至 `summerfeed.cardgame.v2`。
- **新資源系統**：
  - **流量(traffic)**：共享值，第 1 回合 0%、每回合 +10%、上限 100%；雙方卡牌讚數 ×(1+流量/100)，100% 時為 2 倍。
  - **粉絲團 = 血量(HP)**：玩家 HP = 粉絲數（下限 `PLAYER_HP_FLOOR=300`）；對手 HP = 粉絲 × `OPP_HP_FOLLOWER_RATIO`。
  - **鐵粉 = 護盾(shield)**：僅由卡牌效果增加；受擊先扣鐵粉後扣血。
  - **金錢(money)**：每回合 +1，作為「錢轉X」效果的純轉換媒介。
  - **讚數 = 攻擊力**；可由 buff/debuff 調整基礎讚數。
- **回合流程**：抽 5 →（每張先觸發效果、後結算攻防，最多 3 張）→ 棄手牌 → 對手回合（腳本出 1 張固定貼文：效果＋攻擊）。棄牌堆＋空牌堆種子重洗（含「抽 3 重洗再抽 2」分段抽牌）。暫時卡回合末消失、學妹保留卡不棄。
- **卡牌效果引擎**：依貼文「組成詞條的分類」決定效果，涵蓋 16 家族（共通/女A/學校/健身房/巨巨/女B/公司/理髮廳/阿姨/女C/咖啡廳/圖書館/學妹/女D/街道/自宅）＋ 6 base 屬性（攻擊/二選一/暫時卡/buff/抽牌含查看X選1/重複X次）。
- **效果資料 + Excel 對照表**：由單一來源 `02_WebDemo/Data/gen_card_effects.py` 生成 `data/card-effects.js`（`window.PIA_CARD_EFFECTS`，156 張＝121 玩家＋35 對手）、`data/_card_effects.json`，以及對照表 `02_WebDemo/Data/SummerFeed_卡牌效果對照表.xlsx`（4 分頁：卡牌效果/效果說明/README/fallbacks）。
- 改寫 `js/cardgame.js`（v2 引擎）、`js/cardgame-ui.js`（BATTLE 子畫面）、`styles-cardgame.css`；`index.html` 載入 `data/card-effects.js`。HOME/DECK/SETTLEMENT 與獎勵（奪詞條/奪粉絲）沿用。

### 修復（v2 審查後）
- **scry（查看X選1）卡死**：引擎的 scry pending 現帶 `descriptor.cards`（牌庫頂端可窺視卡），UI 改以「位置索引」回傳並對齊 `applyScry`；牌庫不足時可選張數收斂為實際可選數，避免確認鈕永遠 disabled。
- **對手回合卡死**：`advance()` 進入下一回合時 `turn` 先歸 `PLAYER`；動作列改為「純依 phase」推進（P_PLAY→結束我方回合 / O_PLAY→對手出牌 / ROUND_START→下一回合），消除 `turn==="OPPONENT"` 殘留導致的無限迴圈。
- **`effLikes` 別名**：引擎補上 `SF.CardGame.effLikes`（＝`computeEffLikes`），UI 攻擊顯示改用引擎權威值，避免重算漂移。

### 調整（對手加強，配合 v2）
- `OPP_HP_FOLLOWER_RATIO` 0.10 → **4.0**（對手血量 ×40）。原本 v2 攻擊量級為數百~數千，對手 0.10 倍血量會「秒殺」（第 1 回合結束）；4.0 讓同量級對戰成為 2~4 回合可勝的拉鋸（模擬調校）。遠大於玩家的對手仍會一回合壓制玩家（攻擊=讚數隨其粉絲放大）＝刻意的成長硬門檻。

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
