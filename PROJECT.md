# SummerFeed Web Demo — 專案指南（獨立專案）

> ⚠️ **三專案分離**：本資料夾（`02_WebDemo/Project/`）是一個**獨立**的網頁測試專案，其文件紀錄
> **不與** Unity 專案（`00_Program/.claude/`）或 Articy 專案（`00_Articy/`）的 md 檔混用。
> 三者視為三個不同專案，各自維護自己的文件與更新紀錄。

## 這是什麼

純 **HTML + JS**（零相依、零建置、原生 DOM）製作的內部測試工具，重現 Unity 專案 **PIA 系統** 的：

1. **詞條系統**（`PIA_Tag`）— 詞條池與獲取方式。
2. **發文配方系統**（`PIA_PlayerPost` 配方比對）— 選詞條 → 配方命中 → 預覽 → 發布。
3. **貼文互動數據演算法**（強化版 `PIAStats`）— 把 Unity 的簡易飽和曲線升級成**類社群演算法的擴散模型**：
   成長同時受**帳號粉絲基數**（起跑種子）與**話題曝光度 Traffic**（低/中/高）驅動，並加入分享放大與漲粉飛輪兩個社群迴路。

內文（貼文/詞條文字）目前**留空**，待後續補檔。

## 如何開啟

- 直接雙擊 `index.html`（已用 `data/db.js` 規避 `file://` 的 fetch 限制，可離線開啟）。
- 或部署到 GitHub Pages 供內部測試者瀏覽。

## 檔案結構

```
Project/
├── index.html              # 單頁入口
├── styles.css
├── SPEC.md                 # 凍結契約（資料形狀 + 模組 API + 演算法）
├── PROJECT.md              # 本檔
├── data/                   # 由 ../Data/convert.py 從 xlsx 生成（勿手改）
│   ├── db.js               #   window.PIA_DB = {tags, posts, gates}
│   ├── tags.json (124)
│   ├── posts.json (121)
│   └── gates.json (33)
├── js/
│   ├── data.js             # SF.Data   資料索引
│   ├── algorithm.js        # SF.Algorithm  社群成長演算法
│   ├── recipes.js          # SF.Recipes    配方比對（鏡像 PIAPlayerPostComposer）
│   ├── state.js            # SF.State      帳號/詞條庫存/feed/時鐘
│   └── app.js              # SF.App        UI 控制器（4 分頁）
└── docs/                   # 本專案文件（與 Unity/Articy 分離）
    ├── README.md
    ├── data-dictionary.md
    ├── algorithm-design.md
    └── CHANGELOG.md
```

## 資料來源與重建

原始企劃表：`02_WebDemo/Data/260525_SummerFeed_詞條&貼文配方系統_vDEMO修正.xlsx`
轉換腳本：`02_WebDemo/Data/convert.py`（`python convert.py` 重新生成 `Project/data/`）。

## 與 Unity PIA 的對應

| 本 demo | Unity |
|---------|-------|
| `SF.Recipes` | `PIAPlayerPostComposer`（簽章＝詞條排序串接、精確集合比對、相容詞條過濾） |
| `SF.Algorithm` | `PIAStats` + `PIAGrowthConfig`（**升級**為擴散模型） |
| `SF.State.tagInventory` | `PIATagInventory` |
| `SF.State.feed` | `PIAFeed` |
| 流量分級 | `PIA_Post.Traffic`（Low/Medium/High = 0/1/2） |

詳見 `SPEC.md`（§0 對應表）與 `docs/`。

---
*建立：2026-06-17*
