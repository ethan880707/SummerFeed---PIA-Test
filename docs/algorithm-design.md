# 社群成長演算法設計（Algorithm Design）

> 對應模組：`js/algorithm.js`（`SF.Algorithm`）。本文為 **SPEC.md §4** 的設計說明與推導；
> 公式以 SPEC §4.3 為**凍結契約**，本文不得偏離，僅補充直覺、推導與調參指引。
> 三專案分離：本文件屬於 Web Demo（`Project/docs/`），不與 Unity（`.claude/`）或 Articy 的文檔混用。

---

## 1. 從 Unity 飽和曲線 升級到 社群擴散模型

### 1.1 Unity 現況（簡易飽和曲線）

Unity 端的 `PIAStats` + `PIAGrowthConfig` 使用單一**飽和（saturation）曲線**：

```
value(t) = base * (1 + ratio * tier * (1 - e^{-t/τ}))
```

它的行為很單純：

- 從 `base` 起步，隨時間 `t` **單調逼近**一個上限 `base*(1+ratio*tier)`。
- `tier`（流量分級）只是線性放大「上限的高度」。
- 曲線一開始就以最快速度成長，之後逐漸趨緩——是一條「**先快後慢**」的指數逼近線。

問題在於：它看起來像「**數值動畫**」，而不像「**演算法**」。真實的社群演算法不是一條預先畫好的飽和線，而是一個**回饋系統**——平台先小量投放、量測互動、再決定要不要把內容推得更廣更快。互動好的內容會「爆」，互動差的會「沉」，而粉絲基數只決定你的**起跑線**，不決定你的**天花板**。

### 1.2 本 Demo 升級（logistic 病毒擴散 + 兩個社群迴路）

本 Demo 把成長改寫為 **logistic（邏輯斯諦）擴散模型**，並引入兩個社群回饋迴路：

| 升級點 | Unity 飽和曲線 | 本 Demo 擴散模型 |
|--------|---------------|------------------|
| 曲線形狀 | 指數逼近（先快後慢） | S 形（前期加速 → 中期爆發 → 後期飽和） |
| 粉絲基數的角色 | 影響 `base`（同時是起跑與上限） | 只決定**種子 seed（起跑點）**，不決定上限 |
| Traffic tier 的角色 | 線性放大上限 | **同時**放大擴散速率 `r` 與容量上限 `Carry` |
| 互動率 | 與成長脫鉤 | 互動率 → 病毒係數 `viralK` → 反饋進 `r`、`Carry` |
| 社群迴路 | 無 | 迴路①分享放大、迴路②漲粉飛輪 |

三個 SPEC 設計要求一一對應：

1. **fan base → seed（起跑）**：粉絲只墊高你的投放起點。
2. **Traffic exposure → E（同時影響 r 與 Carry）**：曝光度決定平台願意推**多快**、推**多廣**。
3. **social → 兩個回饋迴路**：分享放大容量（迴路①）、觸及外溢成新粉（迴路②）。

---

## 2. 直覺：一則貼文如何擴散（SPEC §4.1）

把一則貼文的觸及（reach）想成傳染病/採用曲線：

1. **撒種子**：平台先把貼文投放給「**一部分粉絲**」＋「**冷啟動探索流量**」。
   起跑點 `seed` 由 fan base（粉絲數）與曝光度共同決定。
2. **量測互動**：平台觀察互動率（engageRate）。互動好 → 病毒係數 `viralK` 變高。
3. **決定推力**：曝光度 tier 越高，平台越敢推 → 速率 `r` 更快、容量 `Carry` 更大。
4. **分享放大（迴路①）**：每次分享把內容帶給分享者的受眾，等於再擴大容量。
5. **漲粉飛輪（迴路②）**：觸及帶來新粉絲（followerGain），墊高**下一篇**的種子。

於是：**看 feed 越久 → 貼文擴散越遠 → 帳號粉絲上升 → 之後發文 seed 更大 → 成長飛輪**。

---

## 3. 參數說明（SPEC §4.2 `SF.Algorithm.params`）

所有參數掛在 `SF.Algorithm.params`，UI「演算法參數」分頁可即時雙向綁定調整，並可用 `SF.Algorithm.defaultParams()` 重置。

### 3.1 時間
| 參數 | 預設 | 意義 |
|------|------|------|
| `TICKS_PER_DAY` | `24` | 1 tick = 1 小時；時間以 ticks 計，`t`（天）＝ ticks / 24。 |

### 3.2 種子（fan base → 起跑觸及）
| 參數 | 預設 | 意義 |
|------|------|------|
| `followerReachRate` | `0.18` | 自然觸及率：每篇先投放給 `followers * 0.18` 的粉絲。提高 → 大帳號起跑更高。 |
| `discoveryFloor` | `80` | 冷啟動曝光底：即使 0 粉，也有的探索流量（再乘曝光度 E）。是新帳號「破不破得了零」的關鍵。 |

> `seed = F * followerReachRate + discoveryFloor * E`。注意 `discoveryFloor` 會被曝光度 `E` 放大——高流量貼文連冷啟動底都更高。

### 3.3 曝光度（Traffic tier 倍率，雙重作用）
| 參數 | 預設 | 意義 |
|------|------|------|
| `tierExposure` | `[1.0, 1.8, 3.2]` | Low / Medium / High 三級的曝光倍率 `E`。**同時**進入 `r` 與 `Carry`，是「爆款」的主開關。 |

> `post.trafficTier` 為 `null`（9 則結局貼文）時 → 視為 `Medium(1)`（SPEC §2）。

### 3.4 擴散（logistic 核心）
| 參數 | 預設 | 意義 |
|------|------|------|
| `baseGrowthRate` | `0.45` | 基礎每日擴散速率 `r0`。所有貼文的共同底速。 |
| `viralGain` | `1.6` | 把「互動率×曝光度」放大成病毒係數 `viralK` 的增益。提高 → 互動好的貼文加速更猛。 |
| `amplifyMax` | `9.0` | 容量相對種子的最大倍數。高互動×高曝光×高品質時，`Carry` 最多可達種子的近 9×（再乘 E、quality）。 |
| `saturateDays` | `14` | 觀察視窗：曲線大致在此天數內走完（也是 UI 模擬圖與本文範例的時間軸）。 |

### 3.5 互動漏斗（reach → 各指標）
| 參數 | 預設 | 意義 |
|------|------|------|
| `ctrBase` | `0.06` | 基礎互動率（觸及→互動），會被 quality 調變成 `engageRate`。 |
| `likeRate` | `0.090` | 觸及 → 讚 的轉換率。 |
| `shareRate` | `0.022` | 觸及 → 分享 的轉換率（刻意 < like，分享比讚難）。 |
| `viewRate` | `0.62` | 觸及 → 瀏覽 的轉換率（瀏覽 > 讚 > 分享，符合漏斗）。 |
| `shareAmplify` | `2.4` | **迴路①**：每次分享再帶來的觸及倍數，併入 `Carry`。 |

### 3.6 漲粉回饋（迴路②）
| 參數 | 預設 | 意義 |
|------|------|------|
| `followerConvRate` | `0.004` | 觸及 → 新粉絲 的轉換率。乘上 quality 即 `followerGain`。 |

### 3.7 品質（每則貼文固定）
| 參數 | 預設 | 意義 |
|------|------|------|
| `qualityImmoralBonus` | `0.25` | 背德/結局貼文（`immoralEvidence`）的 quality 加成——獵奇內容更易擴散。 |
| `jitterRatio` | `0.06` | ±6% 確定性抖動，種子＝`hash(postId, metric)`；**不含時間**，故隨天數單調、不逐日跳動。 |

---

## 4. 計算公式（SPEC §4.3，凍結）

`SF.Algorithm.compute(entry, account, nowTicks)` 為**純函式、確定性**：相同輸入必得相同輸出，`compute` 內**不得**使用 `Math.random`。

### 4.1 中間量

```text
t          = max(0, (nowTicks - entry.postedTick) / TICKS_PER_DAY)         // 天
tier       = post.trafficTier ?? 1                                         // null → Medium
E          = tierExposure[tier]                                            // 曝光度
F          = entry.followersAtPost                                         // 發布當下粉絲快照（§4.5）
quality    = clamp01( 0.5 + (immoral ? qualityImmoralBonus : 0) + (hash01(seed)*2 - 1) * 0.15 )

seed       = F * followerReachRate + discoveryFloor * E                    // 起跑觸及
engageRate = clamp( ctrBase * (0.6 + quality), 0, 0.5 )                    // 互動率
viralK     = engageRate * E * viralGain                                    // 病毒係數
r          = baseGrowthRate * (1 + viralK)                                 // 擴散速率（E 抬高）
Carry      = seed * (1 + amplifyMax * E * quality)                         // 容量上限（E 抬高）
Carry     *= (1 + shareRate * shareAmplify * quality)                      // 迴路①：分享併入容量
```

### 4.2 logistic 擴散（以 seed 為 t=0 值）

```text
reach(t) = Carry / (1 + ((Carry - seed) / seed) * exp(-r * t))
```

- `t = 0` 時 `reach = seed`（起跑＝種子）。
- `t → ∞` 時 `reach → Carry`（趨近容量上限）。
- 曲線為 **S 形**：前期加速、中段最陡、後期飽和。

### 4.3 顯示指標

```text
views        = round( reach * viewRate  * jitter(postId,'v') )
likes        = round( reach * likeRate  * jitter(postId,'l') )
shares       = round( reach * shareRate * jitter(postId,'s') )
comments     = round( likes * 0.06 )            // UI 顯示用；留言不成長
followerGain = round( reach * followerConvRate * quality )    // 該貼文累積帶來的新粉
```

其中抖動：

```text
jitter(id, m) = 1 + (hash01(seed(id, m)) * 2 - 1) * jitterRatio
```

`jitter` **不含時間**，故各指標隨天數**單調**、不會逐日亂跳。`hash01` 同 `PIAStats.Hash01`，確保跨重繪一致。

---

## 5. 為何「看起來像演算法」（SPEC §4.4）

1. **logistic ＝ 採用/病毒傳播的標準模型**：前期加速、後期飽和，正是真實貼文「冷啟動 → 爆發 → 退燒」的形狀，而非 Unity 那條單調逼近線。
2. **曝光度 tier 雙重作用**：`E` 同時抬高速率 `r`（推得**快**）與容量 `Carry`（推得**廣**），所以高流量貼文「爆」得明顯——這正是平台「加權推送」的觀感。
3. **去中心化／可破圈**：粉絲只給**起跑種子**，不是天花板。小帳號靠高 `quality × E` 一樣能撐高 `Carry` 破圈，符合真實演算法「不看你是誰、只看內容互動」的去中心化印象。
4. **兩個回饋迴路**：分享迴路讓容量隨互動再放大；漲粉迴路把單篇成功**外溢到帳號**，使後續篇章水漲船高——系統有了**記憶與複利**，而不只是各篇獨立播放動畫。

---

## 6. 漲粉飛輪（SPEC §4.5）

- 發布時對帳號粉絲取快照：`entry.followersAtPost = account.followers`。
  → 確保任何時刻重算同一則貼文都用**同一個 F**，結果可重現。
- 帳號粉絲：`followers = baseFollowers + followerDelta`，其中

  ```text
  account.followerDelta = Σ ( 各 feed 貼文當下的 followerGain )
  ```

  此和在每次推進時間 / 重繪時由 `SF.State` **重算**（不逐筆存演進值，符合「純值 + id、可序列化」的存檔目標）。
- 飛輪邏輯：**看 feed 久一點 → 既有貼文擴散 → followerGain 累積 → 帳號粉絲上升 → 之後新發的貼文 seed 更大 → 起跑更高**。

---

## 7. 實例對照：小帳號高流量 vs 大帳號低流量（14 天）

用以下兩個對照組驗證「**粉絲只決定起跑、流量決定爆發**」的設計意圖。
為求清晰，兩例皆取 `immoral=false`、抖動取中位（`jitter ≈ 1`），其餘採 §4.2 預設參數。
數字由 §4.3 公式逐項代入算出。

### 7.1 兩例的起跑參數

| 量 | A：小帳號 / High（500 粉，tier 2） | B：大帳號 / Low（50,000 粉，tier 0） |
|----|-----------------------------------|--------------------------------------|
| 曝光度 `E` | 3.2 | 1.0 |
| quality | 0.50 | 0.50 |
| `seed` 起跑觸及 | **346** | **9,080** |
| `engageRate` | 0.066 | 0.066 |
| `viralK` 病毒係數 | 0.338 | 0.106 |
| `r` 擴散速率 | **0.602** | 0.498 |
| `Carry` 容量上限 | **5,469** | 51,258 |
| Carry / seed（破圈倍率） | **≈ 15.8×** | ≈ 5.6× |

關鍵觀察：

- B 起跑（seed 9,080）是 A（346）的 **26 倍**——大帳號起跑碾壓。
- 但 A 的**速率** `r` 更快（0.602 vs 0.498）、**破圈倍率**更高（15.8× vs 5.6×）——高流量讓 A「爆」的潛力遠大於 B。

### 7.2 14 天 reach（觸及）曲線

| Day | A：reach | B：reach |
|-----|---------:|---------:|
| 0 | 346 | 9,080 |
| 1 | 600 | 13,403 |
| 2 | 1,005 | 18,863 |
| 3 | 1,593 | 25,075 |
| 5 | 3,162 | 36,981 |
| 7 | 4,487 | 44,856 |
| 10 | 5,279 | 49,665 |
| 14 | 5,451 | 51,035 |

### 7.3 14 天 顯示指標對照（瀏覽 / 讚 / 分享 / 漲粉）

A（小帳號 / High）：

| Day | views | likes | shares | followerGain |
|-----|------:|------:|-------:|-------------:|
| 0 | 215 | 31 | 8 | 1 |
| 3 | 988 | 143 | 35 | 3 |
| 7 | 2,782 | 404 | 99 | 9 |
| 14 | 3,380 | 491 | 120 | 11 |

B（大帳號 / Low）：

| Day | views | likes | shares | followerGain |
|-----|------:|------:|-------:|-------------:|
| 0 | 5,630 | 817 | 200 | 18 |
| 3 | 15,546 | 2,257 | 552 | 50 |
| 7 | 27,811 | 4,037 | 987 | 90 |
| 14 | 31,641 | 4,593 | 1,123 | 102 |

> 顯示時所有數字走 `SF.Algorithm.abbreviate`（如 31,641 → `31.6K`）。

### 7.4 解讀

- **絕對量**：B（大帳號）始終領先——50,000 粉的起跑種子太大，14 天累積觸及 ≈ 51K，遠勝 A 的 ≈ 5.5K。**這符合直覺：大帳號隨便發都比小帳號多。**
- **成長動態**：A 的曲線**陡**得多——14 天內從 346 暴衝到 5,451（**約 15.8×**），而 B 只從 9,080 漲到 51,035（**約 5.6×**）。A 在 Day 1→3 期間幾乎每天倍增，呈現典型「爆款」加速段；B 較早進入飽和、後段近乎走平。
- **設計意圖達成**：粉絲基數決定**你站得多高（seed）**，流量曝光決定**你衝得多猛、能破多遠（r 與 Carry）**。一個高流量的小帳號貼文，能在短時間內展現遠超其粉絲量級的爆發力（15.8× 破圈），這正是「去中心化、看內容不看身份」的演算法觀感；而大帳號低流量貼文則是「穩、量大、但不爆」。
- **飛輪含意**：B 單篇 14 天帶來 ≈ 102 新粉、A ≈ 11 新粉。若持續發文，這些 followerGain 累進 `account.followerDelta`，墊高下一篇 seed——大帳號複利更穩，小帳號則靠抓住高流量題材搏一次破圈躍升。

---

## 8. 調參速查（給企劃）

| 想要的效果 | 調哪個參數 |
|------------|-----------|
| 新帳號更容易「破零」 | ↑ `discoveryFloor`、↑ `followerReachRate` |
| 高流量貼文「爆」得更誇張 | ↑ `tierExposure[2]`、↑ `amplifyMax`、↑ `viralGain` |
| 拉開 Low/Med/High 的差距 | 調整 `tierExposure` 三元素的比例 |
| 整體曲線更早走完（更快飽和） | ↑ `baseGrowthRate`、↓ `saturateDays`（視窗） |
| 分享對擴散更重要 | ↑ `shareAmplify`、↑ `shareRate` |
| 漲粉更快（飛輪更強） | ↑ `followerConvRate` |
| 背德/結局內容更吃香 | ↑ `qualityImmoralBonus` |
| 數據看起來更「真」（雜訊） | ↑ `jitterRatio`（但破壞單調性的觀感，建議 ≤ 0.1） |

> 改參數後務必確認 §4.3 的形狀仍成立：`reach(0)=seed`、`reach(∞)→Carry`、曲線單調遞增。`SF.Algorithm.defaultParams()` 可一鍵還原本文所用的預設值。
