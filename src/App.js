import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";

/* ─────────────────────────────────────────────
   BESTEA 出貨暨庫存管理 KPI 試算工具
   v3.4 — 嚴格校準版（依老闆回饋調整）
   相對 v3.3 的變更：

   【制度面】
   1. 庫存管理穩定度恢復硬門檻：盤點差異 ≥1 件 或 觸發事故 → 0 分
      （盤點是月底單一事件，不存在「當月後續誘因」問題，硬門檻合理）
   2. 訂單履行時效（漏寄=收單未出貨，重大疏失）加重：
      0件=25 / 1件=10 / ≥2件=0
      並新增硬性否決：單月漏寄 ≥3 件 → 整月獎金歸零（與①否決同級）
   3. 出貨包裝正確率階梯加嚴（取 v3.0 與 v3.2 中間值）：
      52→50 / 42→40 / 28→25 / 14→12；0% 滿分與 ≥0.5% 否決不變
   4. 40 分門檻、品質穩定月 ×1.2（上限120）維持不變

   【UI/UX 面】承襲 v3.3 全部修正
   （RWD 單欄、浮窗點外關閉、精確分帳、初載不誤報已儲存、
     防負值輸入、aria-label 無障礙）

   v3.5 — ② 改比率制（老闆定案：②隨單量長大、③固定）：
   - 訂單履行時效改為與①相同的比率制，基準 max(訂單量, 1000) 筆：
     0% = 25 / ≤0.1% = 10 / ≤0.2% = 0 / >0.2% = 整月否決
     （600 單時行為與 v3.4 完全相同：1件=10、2件歸零、3件否決；
       單量成長後容錯件數等比放大，如 2000 單 → 3件歸零、5件否決）
   - 庫存管理穩定度維持固定件數硬門檻不變

   v3.4.1 內容補充（計分數字不變）：
   - 三大項「計分範圍」補齊漏列樣態：
     ① 補：贈品/加購品漏放、發票明細錯誤、禮盒提袋卡片漏附、
           包裝不良致運送毀損、效期批號錯誤
     ② 補：逾時出貨（超過承諾時限）、物流單號未回填、
           補寄/換貨逾時、平台（蝦皮）逾期出貨
     ③ 補：入庫驗收未核對、效期疏失（未先進先出）；
           事故定義補「安全庫存未通報致斷貨」
   - 新增「計件認定原則」說明卡（同單多錯計1件、以發現月計、
     作業無誤之客訴不計）
   ───────────────────────────────────────────── */

// ── Icons (inline SVG) ──
const Icon = ({ d, size = 20, color = "currentColor", strokeWidth = 2 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const Icons = {
  package: () => (
    <Icon d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
  ),
  users: () => (
    <Icon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 3a4 4 0 110 8 4 4 0 010-8z M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  ),
  alert: () => (
    <Icon d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4M12 17h.01" />
  ),
  trending: () => <Icon d="M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6" />,
  star: () => (
    <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  ),
  info: () => (
    <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4M12 8h.01" />
  ),
  crown: () => (
    <Icon d="M2 20h20 M4 20l2-14 4 6 2-8 2 8 4-6 2 14" strokeWidth={1.8} />
  ),
  ban: () => (
    <Icon d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M4.93 4.93l14.14 14.14" />
  ),
};

// ── 比率制門檻（以每 1,000 筆為基準） ──
// 合併「出貨正確率 + 包裝客訴」= 55 分
const RATE_THRESHOLDS = {
  fulfillmentQuality: [
    { maxRate: 0, score: 55, label: "0%（0 件）" },
    { maxRate: 0.001, score: 50, label: "0.1%（1 件 / 1000）" },
    { maxRate: 0.002, score: 40, label: "0.2%（2 件 / 1000）" },
    { maxRate: 0.003, score: 25, label: "0.3%（3 件 / 1000）" },
    { maxRate: 0.004, score: 12, label: "0.4%（4 件 / 1000）" },
    { maxRate: Infinity, score: 0, label: "≥0.5%（5 件 / 1000）" },
  ],
  // 訂單履行（漏寄）：比率制，隨單量等比放大
  fulfillment: [
    { maxRate: 0, score: 25, label: "0%（0 件）" },
    { maxRate: 0.001, score: 10, label: "0.1%（1 件 / 1000）" },
    { maxRate: Infinity, score: 0, label: "0.2%（2 件 / 1000）" },
  ],
};

// 漏寄率超過此值 → 整月獎金否決（收單未出貨屬重大疏失）
const FULFILLMENT_VETO_RATE = 0.002;

// ── 庫存管理：硬門檻（盤點差異 ≥1 件即 0 分） ──
const INVENTORY_TIERS = [
  { maxCount: 0, score: 20, label: "0 件（無差異）" },
  { maxCount: Infinity, score: 0, label: "≥1 件" },
];

// ── 比率制計分函式 ──
function scoreByRate(errorCount, orderCount, thresholds) {
  // 最低基準 1,000 筆
  const baseOrders = Math.max(orderCount, 1000);
  const errorRate = errorCount / baseOrders;
  for (const tier of thresholds) {
    if (errorRate <= tier.maxRate) return tier.score;
  }
  return 0;
}

// ── 件數階梯計分函式 ──
function scoreByCount(count, tiers) {
  for (const tier of tiers) {
    if (count <= tier.maxCount) return tier.score;
  }
  return 0;
}

// ── 超過某比率門檻所需的最少件數（用於動態提示） ──
function countToExceedRate(orderCount, rate) {
  const baseOrders = Math.max(orderCount, 1000);
  return Math.floor(baseOrders * rate) + 1;
}

// ── 精確分帳：各人金額加總必等於 total ──
function splitByWeights(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    base[i] += 1;
    remainder -= 1;
  }
  return base;
}

// ── Tooltip 規則組 ──
const tierColor = (score, max) =>
  score === max
    ? "#22c55e"
    : score >= max * 0.5
    ? "#eab308"
    : score > 0
    ? "#f97316"
    : "#ef4444";

const FULFILLMENT_RULES = [
  { range: "0%（0 件）", score: 25, color: "#22c55e" },
  { range: "0.1%（1 件 / 1000）", score: 10, color: "#f97316" },
  { range: "0.2%（2 件 / 1000）", score: 0, color: "#ef4444" },
  {
    range: ">0.2%（≥3 件 / 1000）",
    scoreText: "整月否決",
    color: "#ef4444",
  },
];

const INVENTORY_RULES = [
  ...INVENTORY_TIERS.map((t) => ({
    range: t.label,
    score: t.score,
    color: tierColor(t.score, 20),
  })),
  { range: "觸發營運事故", score: 0, color: "#ef4444" },
];

const RuleTooltip = ({ rules, isOpen, onToggle }) => (
  <div style={{ position: "relative", display: "inline-block" }}>
    <button
      onClick={onToggle}
      aria-label="查看評分規則"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        opacity: 0.4,
        padding: "2px",
      }}
      title="查看評分規則"
    >
      <Icons.info />
    </button>
    {isOpen && (
      <>
        {/* 點外部任意處關閉 */}
        <div
          onClick={onToggle}
          style={{ position: "fixed", inset: 0, zIndex: 40 }}
        />
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: 8,
            background: "#1e293b",
            color: "#e2e8f0",
            borderRadius: 12,
            padding: "12px 16px",
            zIndex: 50,
            minWidth: 220,
            maxWidth: "calc(100vw - 32px)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              marginBottom: 6,
              fontSize: 11,
              color: "#94a3b8",
              letterSpacing: "0.05em",
            }}
          >
            評分標準
          </div>
          {rules.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <span>{r.range || r.label}</span>
              <span style={{ fontWeight: 700, color: r.color || "#22c55e" }}>
                {r.scoreText ? r.scoreText : `${r.score} 分`}
              </span>
            </div>
          ))}
        </div>
      </>
    )}
  </div>
);

// ── Stepper ──
const Stepper = ({ value, onChange, danger }) => {
  const btnStyle = {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "1.5px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    fontSize: 18,
    fontWeight: 600,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        style={btnStyle}
        aria-label="減少一件"
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <span
        style={{
          width: 48,
          textAlign: "center",
          fontSize: 28,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color: danger ? "#ef4444" : "#22c55e",
        }}
      >
        {value}
      </span>
      <button
        style={btnStyle}
        aria-label="增加一件"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
};

// ── ScoreBadge ──
const ScoreBadge = ({ score, max }) => {
  const pct = score / max;
  const bg = pct === 1 ? "#dcfce7" : pct >= 0.5 ? "#fef9c3" : "#fee2e2";
  const fg = pct === 1 ? "#15803d" : pct >= 0.5 ? "#a16207" : "#dc2626";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 10,
        padding: "6px 14px",
        textAlign: "center",
        minWidth: 72,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: fg,
          opacity: 0.7,
          marginBottom: 2,
        }}
      >
        得分
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: fg,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {score}
        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.6 }}>
          /{max}
        </span>
      </div>
    </div>
  );
};

const STORAGE_KEY = "bestea-kpi-data-v2";
const MIN_THRESHOLD_SCORE = 40; // 低於此分數獎金歸零

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToDisk(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

// ── Main App ──
export default function App() {
  const saved = useRef(loadSaved());
  const s = saved.current;

  const [revenue, setRevenue] = useState(s?.revenue ?? 1940000);
  const [orderCount, setOrderCount] = useState(s?.orderCount ?? 600);
  const [staffMode, setStaffMode] = useState(s?.staffMode ?? "3_even");
  const [fulfillmentQualityErrors, setFulfillmentQualityErrors] = useState(
    s?.fulfillmentQualityErrors ?? 0
  );
  const [fulfillmentErrors, setFulfillmentErrors] = useState(
    s?.fulfillmentErrors ?? 0
  );
  const [inventoryErrors, setInventoryErrors] = useState(
    s?.inventoryErrors ?? 0
  );
  const [inventoryIncident, setInventoryIncident] = useState(
    s?.inventoryIncident ?? false
  );
  const [openTooltip, setOpenTooltip] = useState(null);
  const [showSaved, setShowSaved] = useState(false);
  const firstRun = useRef(true);

  useEffect(() => {
    const data = {
      revenue,
      orderCount,
      staffMode,
      fulfillmentQualityErrors,
      fulfillmentErrors,
      inventoryErrors,
      inventoryIncident,
    };
    saveToDisk(data);
    // 初次載入不顯示「已自動儲存」
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 1500);
    return () => clearTimeout(t);
  }, [
    revenue,
    orderCount,
    staffMode,
    fulfillmentQualityErrors,
    fulfillmentErrors,
    inventoryErrors,
    inventoryIncident,
  ]);

  const handleReset = useCallback(() => {
    if (!window.confirm("確定要清除所有數據，恢復預設值嗎？")) return;
    setRevenue(1940000);
    setOrderCount(600);
    setStaffMode("3_even");
    setFulfillmentQualityErrors(0);
    setFulfillmentErrors(0);
    setInventoryErrors(0);
    setInventoryIncident(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const fqVetoCount = useMemo(
    () => countToExceedRate(orderCount, 0.004),
    [orderCount]
  );
  const fulfillZeroCount = useMemo(
    () => countToExceedRate(orderCount, 0.001),
    [orderCount]
  );
  const fulfillVetoCount = useMemo(
    () => countToExceedRate(orderCount, FULFILLMENT_VETO_RATE),
    [orderCount]
  );

  const results = useMemo(() => {
    // ① 出貨包裝正確率（55分）— 比率制（合併出貨+包裝）
    const fulfillmentQualityScore = scoreByRate(
      fulfillmentQualityErrors,
      orderCount,
      RATE_THRESHOLDS.fulfillmentQuality
    );

    // ② 訂單履行時效（25分）— v3.5 比率制（隨單量放大）
    const fulfillmentScore = scoreByRate(
      fulfillmentErrors,
      orderCount,
      RATE_THRESHOLDS.fulfillment
    );

    // ③ 庫存管理穩定度（20分）— v3.3 階梯制 + 事故條款
    const inventoryScore = inventoryIncident
      ? 0
      : scoreByCount(inventoryErrors, INVENTORY_TIERS);

    const rawTotalScore =
      fulfillmentQualityScore + fulfillmentScore + inventoryScore;

    // 出貨包裝硬性否決：該項得 0 分（錯誤率 ≥0.5%）→ 整月獎金歸零
    const isFulfillmentQualityFailed = fulfillmentQualityScore === 0;

    // 漏寄硬性否決：漏寄率 >0.2% → 整月獎金歸零
    const isFulfillmentVetoed =
      fulfillmentErrors / Math.max(orderCount, 1000) > FULFILLMENT_VETO_RATE;

    // 否決原因（fq = 出貨包裝、fulfill = 漏寄）
    const vetoReason = isFulfillmentQualityFailed
      ? "fq"
      : isFulfillmentVetoed
      ? "fulfill"
      : null;

    // 品質穩定月（全項目零錯誤）
    const isQualityMonth =
      fulfillmentQualityErrors === 0 &&
      fulfillmentErrors === 0 &&
      inventoryErrors === 0 &&
      !inventoryIncident;

    // 加成後分數（上限 120）
    const finalScore = isQualityMonth
      ? Math.min(rawTotalScore * 1.2, 120)
      : rawTotalScore;

    // < 40 分 或 觸發任一否決條款 → 獎金歸零
    const isBelowThreshold =
      finalScore < MIN_THRESHOLD_SCORE || vetoReason !== null;

    const bonusPool = Math.round(revenue * 0.001);

    const actualTotalBonus = isBelowThreshold
      ? 0
      : Math.round(bonusPool * (finalScore / 100));

    // 精確分帳：加總必等於 actualTotalBonus
    const makeStaff = (labels, weights, ratios) => {
      const amounts = splitByWeights(actualTotalBonus, weights);
      return labels.map((label, i) => ({
        label,
        amount: amounts[i],
        ratio: ratios[i],
        weight: weights[i],
      }));
    };

    let staffDistribution = [];
    if (staffMode === "2_even") {
      staffDistribution = makeStaff(
        ["員工 A", "員工 B"],
        [1, 1],
        ["50%", "50%"]
      );
    } else if (staffMode === "3_even") {
      staffDistribution = makeStaff(
        ["員工 A", "員工 B", "員工 C"],
        [1, 1, 1],
        ["33.3%", "33.3%", "33.3%"]
      );
    } else if (staffMode === "3_weighted") {
      staffDistribution = makeStaff(
        ["資深人員 A", "資深人員 B", "新進人員 C"],
        [2, 2, 1],
        ["40%", "40%", "20%"]
      );
    }

    return {
      scores: {
        fulfillmentQualityScore,
        fulfillmentScore,
        inventoryScore,
      },
      rawTotalScore,
      finalScore,
      isQualityMonth,
      isBelowThreshold,
      vetoReason,
      bonusPool,
      actualTotalBonus,
      staffDistribution,
    };
  }, [
    revenue,
    orderCount,
    staffMode,
    fulfillmentQualityErrors,
    fulfillmentErrors,
    inventoryErrors,
    inventoryIncident,
  ]);

  const baseOrdersDisplay = Math.max(orderCount, 1000);
  const isUsingMinBase = orderCount < 1000;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(160deg, #f0f4f8 0%, #e8edf5 50%, #f5f0eb 100%)",
        fontFamily:
          "'Noto Sans TC', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#1e293b",
        padding: "24px 16px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700;900&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes scoreIn { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        .main-grid { display: grid; grid-template-columns: 1fr 380px; gap: 24px; align-items: start; }
        @media (max-width: 900px) {
          .main-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        {/* HEADER */}
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 20,
            marginBottom: 32,
            animation: "slideUp 0.5s ease-out",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "#1e293b",
                color: "#f8fafc",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              <Icons.package /> BESTEA 內部管理 ・ v3.5
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 900,
                lineHeight: 1.3,
                background: "linear-gradient(135deg, #1e293b 0%, #475569 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              出貨暨庫存管理 KPI 試算
            </h1>
            <p
              style={{
                color: "#94a3b8",
                fontSize: 13,
                marginTop: 4,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              比率制 ・ 最低基準 1,000 筆 ・ 總分 {MIN_THRESHOLD_SCORE} 分為獎金門檻
              {showSaved && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#22c55e",
                    background: "#f0fdf4",
                    padding: "2px 8px",
                    borderRadius: 6,
                    animation: "fadeIn 0.2s ease-out",
                  }}
                >
                  ✓ 已自動儲存
                </span>
              )}
            </p>
            <button
              onClick={handleReset}
              style={{
                marginTop: 8,
                fontSize: 11,
                fontWeight: 600,
                color: "#94a3b8",
                background: "none",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "4px 12px",
                cursor: "pointer",
              }}
            >
              清除數據並重置
            </button>
          </div>

          {/* Revenue + Orders */}
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "16px 24px",
              boxShadow:
                "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
              border: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: 24,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#94a3b8",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                當月總營收 (TWD)
              </div>
              <input
                type="number"
                min="0"
                value={revenue}
                onChange={(e) =>
                  setRevenue(Math.max(0, Number(e.target.value) || 0))
                }
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#1e293b",
                  border: "none",
                  outline: "none",
                  width: 140,
                  background: "transparent",
                  fontFamily: "inherit",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: "#94a3b8",
                  marginTop: 2,
                }}
              >
                NT$ {revenue.toLocaleString()}
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: "#e2e8f0" }} />
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#94a3b8",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                當月訂單量
              </div>
              <input
                type="number"
                min="0"
                value={orderCount}
                onChange={(e) =>
                  setOrderCount(Math.max(0, Number(e.target.value) || 0))
                }
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: isUsingMinBase ? "#d97706" : "#1e293b",
                  border: "none",
                  outline: "none",
                  width: 100,
                  background: "transparent",
                  fontFamily: "inherit",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: isUsingMinBase ? "#d97706" : "#94a3b8",
                  marginTop: 2,
                }}
              >
                {isUsingMinBase
                  ? `⚠ <1000 筆，計分基準採 1,000`
                  : `計分基準：${baseOrdersDisplay.toLocaleString()} 筆`}
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: "#e2e8f0" }} />
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#94a3b8",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                獎金池 (0.1%)
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#2563eb",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                ${results.bonusPool.toLocaleString()}
              </div>
            </div>
          </div>
        </header>

        {/* MAIN GRID */}
        <div className="main-grid">
          {/* LEFT */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              animation: "slideUp 0.6s ease-out",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow:
                  "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  background: "linear-gradient(135deg, #1e293b, #334155)",
                  padding: "16px 24px",
                  color: "#f8fafc",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    letterSpacing: "0.02em",
                  }}
                >
                  KPI 扣分項錄入
                </span>
                <span
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}
                >
                  比率以 {baseOrdersDisplay.toLocaleString()} 筆為基準計算
                </span>
              </div>

              <div style={{ padding: "8px 0" }}>
                {/* ① 出貨包裝正確率（合併版）— 比率制 */}
                <KpiRow
                  title="出貨包裝正確率"
                  subtitle="裝錯、少裝、多裝、貼錯標籤、缺漏、備註未看、贈品/加購品漏放、發票明細錯誤、禮盒提袋卡片漏附、包裝不良致運送毀損、效期批號錯誤"
                  weight={55}
                  score={results.scores.fulfillmentQualityScore}
                  maxScore={55}
                  value={fulfillmentQualityErrors}
                  onChange={setFulfillmentQualityErrors}
                  rules={RATE_THRESHOLDS.fulfillmentQuality.map((r) => ({
                    range: r.label,
                    score: r.score,
                    color:
                      r.score === 55
                        ? "#22c55e"
                        : r.score >= 40
                        ? "#eab308"
                        : r.score >= 12
                        ? "#f97316"
                        : "#ef4444",
                  }))}
                  openTooltip={openTooltip}
                  tooltipKey="fq"
                  onToggleTooltip={() =>
                    setOpenTooltip(openTooltip === "fq" ? null : "fq")
                  }
                  hint={`⚠ 否決 ≥${fqVetoCount} 件`}
                  hintColor="#dc2626"
                />

                <div
                  style={{
                    height: 1,
                    background: "#f1f5f9",
                    margin: "0 24px",
                  }}
                />

                {/* ② 訂單履行 — v3.3 階梯制 */}
                <KpiRow
                  title="訂單履行時效"
                  subtitle="漏寄（收單未出貨）、逾時出貨（超過承諾時限）、誤放、遺漏處理、物流單號未回填、補寄/換貨逾時、平台（蝦皮）逾期出貨"
                  weight={25}
                  score={results.scores.fulfillmentScore}
                  maxScore={25}
                  value={fulfillmentErrors}
                  onChange={setFulfillmentErrors}
                  rules={FULFILLMENT_RULES}
                  openTooltip={openTooltip}
                  tooltipKey="fulfill"
                  onToggleTooltip={() =>
                    setOpenTooltip(
                      openTooltip === "fulfill" ? null : "fulfill"
                    )
                  }
                  hint={`⚠ ${fulfillZeroCount}件歸零・${fulfillVetoCount}件否決`}
                  hintColor="#dc2626"
                />

                <div
                  style={{
                    height: 1,
                    background: "#f1f5f9",
                    margin: "0 24px",
                  }}
                />

                {/* ③ 庫存管理 — v3.3 階梯制 */}
                <KpiRow
                  title="庫存管理穩定度"
                  subtitle="盤點帳貨差異、入庫驗收未核對、效期疏失（未先進先出/過期短效未回報）"
                  weight={20}
                  score={results.scores.inventoryScore}
                  maxScore={20}
                  value={inventoryErrors}
                  onChange={setInventoryErrors}
                  rules={INVENTORY_RULES}
                  openTooltip={openTooltip}
                  tooltipKey="inv"
                  onToggleTooltip={() =>
                    setOpenTooltip(openTooltip === "inv" ? null : "inv")
                  }
                  hint="⚠ 1件/事故歸零"
                  hintColor="#dc2626"
                  extra={
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        marginTop: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: inventoryIncident ? "#dc2626" : "#94a3b8",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={inventoryIncident}
                        onChange={(e) =>
                          setInventoryIncident(e.target.checked)
                        }
                        style={{
                          width: 16,
                          height: 16,
                          accentColor: "#dc2626",
                          cursor: "pointer",
                        }}
                      />
                      觸發營運事故（缺貨延遲 / 取消 / 安全庫存未通報致斷貨）
                    </label>
                  }
                />
              </div>
            </div>

            {/* Staff Config */}
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: 24,
                boxShadow:
                  "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "#f1f5f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                  }}
                >
                  <Icons.users />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    部門人力配置與分配比例
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#94a3b8",
                      fontWeight: 500,
                    }}
                  >
                    選擇當前人數與分配規則
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                }}
              >
                {[
                  { key: "2_even", name: "2 人平分", desc: "1 : 1", tag: null },
                  {
                    key: "3_even",
                    name: "3 人平分",
                    desc: "1 : 1 : 1",
                    tag: "目前",
                  },
                  {
                    key: "3_weighted",
                    name: "3 人加權",
                    desc: "2 : 2 : 1",
                    tag: "未來",
                  },
                ].map((opt) => {
                  const active = staffMode === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setStaffMode(opt.key)}
                      style={{
                        padding: "14px 12px",
                        borderRadius: 14,
                        cursor: "pointer",
                        border: active
                          ? "2px solid #2563eb"
                          : "1.5px solid #e2e8f0",
                        background: active
                          ? "linear-gradient(135deg, #2563eb, #3b82f6)"
                          : "#fff",
                        color: active ? "#fff" : "#475569",
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {opt.tag && (
                        <span
                          style={{
                            position: "absolute",
                            top: -8,
                            right: -4,
                            fontSize: 9,
                            fontWeight: 800,
                            background: active ? "#fbbf24" : "#e2e8f0",
                            color: active ? "#78350f" : "#64748b",
                            padding: "2px 8px",
                            borderRadius: 20,
                          }}
                        >
                          {opt.tag}
                        </span>
                      )}
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {opt.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          opacity: 0.7,
                          fontWeight: 500,
                        }}
                      >
                        比例 {opt.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              animation: "slideUp 0.7s ease-out",
            }}
          >
            {/* Score Card */}
            <div
              style={{
                background: results.isBelowThreshold
                  ? "linear-gradient(145deg, #1f2937, #374151, #4b5563)"
                  : results.isQualityMonth
                  ? "linear-gradient(145deg, #059669, #047857, #065f46)"
                  : results.finalScore >= 80
                  ? "linear-gradient(145deg, #1e40af, #2563eb, #1d4ed8)"
                  : results.finalScore >= 60
                  ? "linear-gradient(145deg, #b45309, #d97706, #ca8a04)"
                  : "linear-gradient(145deg, #b91c1c, #dc2626, #ef4444)",
                borderRadius: 24,
                padding: 28,
                color: "#fff",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -40,
                  right: -40,
                  width: 160,
                  height: 160,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.06)",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 20,
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.85 }}>
                  KPI 最終得分
                </div>
                {results.isQualityMonth && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(251, 191, 36, 0.9)",
                      color: "#78350f",
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontSize: 10,
                      fontWeight: 800,
                      animation: "pulse 2s ease-in-out infinite",
                    }}
                  >
                    <Icons.crown /> 品質穩定月 ×1.2
                  </div>
                )}
                {results.isBelowThreshold && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(239, 68, 68, 0.9)",
                      color: "#fff",
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontSize: 10,
                      fontWeight: 800,
                    }}
                  >
                    <Icons.ban />{" "}
                    {results.vetoReason === "fq"
                      ? "出貨包裝否決"
                      : results.vetoReason === "fulfill"
                      ? "漏寄否決"
                      : `未達 ${MIN_THRESHOLD_SCORE} 分門檻`}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 4,
                  marginBottom: 4,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    fontSize: 72,
                    fontWeight: 900,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    animation: "scoreIn 0.4s ease-out",
                  }}
                >
                  {results.finalScore}
                </span>
                <span style={{ fontSize: 20, fontWeight: 500, opacity: 0.5 }}>
                  / {results.isQualityMonth ? "120" : "100"}
                </span>
              </div>

              <div
                style={{
                  width: "100%",
                  height: 6,
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.15)",
                  overflow: "hidden",
                  marginBottom: 24,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.8)",
                    width: `${Math.min(
                      (results.finalScore /
                        (results.isQualityMonth ? 120 : 100)) *
                        100,
                      100
                    )}%`,
                    transition: "width 0.6s",
                  }}
                />
                {/* 40 分門檻線 */}
                <div
                  title={`獎金門檻 ${MIN_THRESHOLD_SCORE} 分`}
                  style={{
                    position: "absolute",
                    top: -4,
                    bottom: -4,
                    left: `${
                      (MIN_THRESHOLD_SCORE /
                        (results.isQualityMonth ? 120 : 100)) *
                      100
                    }%`,
                    width: 2,
                    background: "rgba(255,255,255,0.6)",
                  }}
                />
              </div>

              <div
                style={{
                  background: "rgba(255,255,255,0.1)",
                  borderRadius: 14,
                  padding: "16px 20px",
                  backdropFilter: "blur(10px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    可領獎金總額
                  </span>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 900,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ${results.actualTotalBonus.toLocaleString()}
                  </span>
                </div>
                <div
                  style={{
                    height: 1,
                    background: "rgba(255,255,255,0.15)",
                    marginBottom: 10,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    opacity: 0.7,
                    marginBottom: 4,
                  }}
                >
                  <span>獎金池基數</span>
                  <span>${results.bonusPool.toLocaleString()}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    opacity: 0.7,
                    marginBottom: 4,
                  }}
                >
                  <span>得分係數</span>
                  <span>
                    {results.isBelowThreshold
                      ? "0.00（未達門檻）"
                      : (results.finalScore / 100).toFixed(2)}
                  </span>
                </div>
                {results.isBelowThreshold && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      opacity: 0.9,
                      color: "#fecaca",
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: "1px dashed rgba(255,255,255,0.2)",
                    }}
                  >
                    <span>
                      {results.vetoReason === "fq"
                        ? "出貨包裝正確率不及格"
                        : results.vetoReason === "fulfill"
                        ? `漏寄達 ${fulfillVetoCount} 件（重大疏失）`
                        : `未達 ${MIN_THRESHOLD_SCORE} 分門檻`}
                    </span>
                    <span>本月不發獎金</span>
                  </div>
                )}
              </div>
            </div>

            {/* Distribution */}
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow:
                  "0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)",
                border: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  fontSize: 14,
                  color: "#475569",
                }}
              >
                <Icons.users /> 人員獎金分配明細
              </div>
              <div
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {results.staffDistribution.map((staff, idx) => {
                  const maxAmt = Math.max(
                    ...results.staffDistribution.map((s) => s.amount),
                    1
                  );
                  const barPct = (staff.amount / maxAmt) * 100;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "14px 16px",
                        borderRadius: 14,
                        background: "#f8fafc",
                        border: "1px solid #e8edf5",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${barPct}%`,
                          background:
                            "linear-gradient(90deg, rgba(37,99,235,0.06), rgba(37,99,235,0.02))",
                        }}
                      />
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              color: "#334155",
                            }}
                          >
                            {staff.label}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "#94a3b8",
                              fontWeight: 700,
                              marginTop: 2,
                            }}
                          >
                            權重 {staff.ratio}
                            {staff.weight > 1 && ` (×${staff.weight})`}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 900,
                            color: results.isBelowThreshold
                              ? "#94a3b8"
                              : "#1e40af",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ${staff.amount.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <StatusAlert
              isQualityMonth={results.isQualityMonth}
              isBelowThreshold={results.isBelowThreshold}
              vetoReason={results.vetoReason}
              finalScore={results.finalScore}
              rawScore={results.rawTotalScore}
            />

            <div
              style={{
                background: "#fffbeb",
                borderRadius: 16,
                border: "1px solid #fde68a",
                padding: "14px 18px",
                fontSize: 11,
                color: "#92400e",
                lineHeight: 1.8,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: 4,
                  color: "#78350f",
                  fontSize: 12,
                }}
              >
                計件認定原則
              </div>
              <div>同一筆訂單多項錯誤 → 以 1 件計，歸入最嚴重項目（不重複扣）</div>
              <div>錯誤以「發現當月」計入該月 KPI，跨月客訴不回溯改分</div>
              <div>作業無誤的客訴（口味偏好、物流延誤等非倉庫責任）不計件</div>
            </div>

            <div
              style={{
                background: "#f8fafc",
                borderRadius: 16,
                border: "1px solid #e2e8f0",
                padding: "14px 18px",
                fontSize: 11,
                color: "#64748b",
                lineHeight: 1.8,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: 4,
                  color: "#475569",
                  fontSize: 12,
                }}
              >
                公式速查
              </div>
              <div>獎金池 = 月營收 × 0.1%</div>
              <div>
                出貨包裝採比率制（基準 max(訂單量, 1000) 筆）
              </div>
              <div>訂單履行採重罰階梯、庫存採硬門檻（點各項 ⓘ 查看）</div>
              <div>實際獎金 = 獎金池 × (KPI得分 ÷ 100)</div>
              <div>品質穩定月 = 全項目零錯誤 → 得分 ×1.2（上限120）</div>
              <div style={{ color: "#dc2626", fontWeight: 600 }}>
                總分 &lt; {MIN_THRESHOLD_SCORE} 分 → 獎金歸零
              </div>
              <div style={{ color: "#dc2626", fontWeight: 600 }}>
                出貨包裝得 0 分（≥0.5%）→ 整月否決，不發獎金
              </div>
              <div style={{ color: "#dc2626", fontWeight: 600 }}>
                漏寄率 &gt;0.2% → 整月否決（本月基準 ≥{fulfillVetoCount} 件）
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI Row ──
function KpiRow({
  title,
  subtitle,
  weight,
  score,
  maxScore,
  value,
  onChange,
  rules,
  openTooltip,
  tooltipKey,
  onToggleTooltip,
  hint,
  hintColor,
  extra,
}) {
  return (
    <div style={{ padding: "20px 24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
              {title}
            </h3>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 6,
                background: "#eff6ff",
                color: "#2563eb",
              }}
            >
              {weight}分
            </span>
            {hint && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background:
                    hintColor === "#dc2626" ? "#fef2f2" : "#ecfeff",
                  color: hintColor,
                }}
              >
                {hint}
              </span>
            )}
            <RuleTooltip
              rules={rules}
              isOpen={openTooltip === tooltipKey}
              onToggle={onToggleTooltip}
            />
          </div>
          <p
            style={{
              fontSize: 12,
              color: "#94a3b8",
              marginTop: 4,
              fontWeight: 500,
            }}
          >
            {subtitle}
          </p>
          {extra}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Stepper value={value} onChange={onChange} danger={value > 0} />
          <ScoreBadge score={score} max={maxScore} />
        </div>
      </div>
    </div>
  );
}

// ── Status Alert ──
function StatusAlert({
  isQualityMonth,
  isBelowThreshold,
  vetoReason,
  finalScore,
  rawScore,
}) {
  if (isBelowThreshold) {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #f9fafb, #f3f4f6)",
          border: "1px solid #d1d5db",
          borderRadius: 16,
          padding: "16px 20px",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ color: "#4b5563", marginTop: 2, flexShrink: 0 }}>
          <Icons.ban />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1f2937" }}>
            {vetoReason === "fq"
              ? "出貨包裝否決：本月不發獎金"
              : vetoReason === "fulfill"
              ? "漏寄否決：本月不發獎金"
              : "未達獎金門檻"}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#4b5563",
              marginTop: 4,
              lineHeight: 1.6,
            }}
          >
            {vetoReason === "fq"
              ? `出貨包裝正確率錯誤率達 ≥0.5%（核心職責不及格），依否決條款本月不發 KPI 獎金，無論其他項目得分。建議立即召開檢討會議找出根因。`
              : vetoReason === "fulfill"
              ? `單月漏寄率超過 0.2%（每 1,000 筆最多容忍 2 件）。收到訂單未出貨屬重大疏失，依否決條款本月不發 KPI 獎金，無論其他項目得分。建議立即檢討每日出貨核對流程。`
              : `本月得分 ${finalScore} 分，低於 ${MIN_THRESHOLD_SCORE} 分標準，本月不發 KPI 獎金。建議召開檢討會議找出根因。`}
          </div>
        </div>
      </div>
    );
  }
  if (isQualityMonth) {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
          border: "1px solid #a7f3d0",
          borderRadius: 16,
          padding: "16px 20px",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ color: "#059669", marginTop: 2, flexShrink: 0 }}>
          <Icons.star />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#065f46" }}>
            卓越表現：品質穩定月
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#047857",
              marginTop: 4,
              lineHeight: 1.6,
            }}
          >
            本月全項目零錯誤，獎金已套用 120% 加成。原始得分 {rawScore} → 最終{" "}
            {finalScore}。
          </div>
        </div>
      </div>
    );
  }
  if (finalScore < 60) {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #fef2f2, #fee2e2)",
          border: "1px solid #fca5a5",
          borderRadius: 16,
          padding: "16px 20px",
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ color: "#dc2626", marginTop: 2, flexShrink: 0 }}>
          <Icons.alert />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#991b1b" }}>
            營運預警
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#b91c1c",
              marginTop: 4,
              lineHeight: 1.6,
            }}
          >
            得分接近 {MIN_THRESHOLD_SCORE} 分歸零門檻，建議立即檢討錯誤環節。
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
        border: "1px solid #93c5fd",
        borderRadius: 16,
        padding: "16px 20px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ color: "#2563eb", marginTop: 2, flexShrink: 0 }}>
        <Icons.trending />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#1e40af" }}>
          穩定運作
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#1d4ed8",
            marginTop: 4,
            lineHeight: 1.6,
          }}
        >
          目前運作良好，持續保持零錯誤即可獲得品質穩定月 120% 加成。
        </div>
      </div>
    </div>
  );
}
