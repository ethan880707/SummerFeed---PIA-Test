/* data/opponents.js — 排行榜挑戰對手資料 (FROZEN SPEC v1 §2)
 * 設定 window.PIA_OPPONENTS（長度 10 的純資料陣列）。
 * 純字面值、無邏輯；file:// 安全（無 fetch / import / Math.random）。
 * 約束：id 全域唯一；hp === round(followers * 0.10)；
 *       每篇 likes === round(followers * frac)，frac ∈ [0.04, 0.09]。
 */
(function (global) {
  "use strict";
  global.PIA_OPPONENTS = [
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
        { "id": "OPP08-P1", "name": "烏魚季", "tags": ["#烏魚", "#無聊的夜晚"], "likes": 48, "frac": 0.05 },
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
})(typeof window !== "undefined" ? window : this);
