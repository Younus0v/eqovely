// ─── ImpactDashboard.jsx ──────────────────────────────────────────────────────
// Live impact metrics grid for Eqovely.
// Fetches directly from Supabase on mount and refreshes every 30s.
// Usage:
//   import ImpactDashboard from './ImpactDashboard';
//   <ImpactDashboard />   ← drop anywhere on the page

const SUPABASE_URL = "https://dwpqeuuqfbmbuqpuufup.supabase.co/rest/v1";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cHFldXVxZmJtYnVxcHV1ZnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDY4MjIsImV4cCI6MjA5NDU4MjgyMn0.lzhbbl49fPMDc-YKzT2fxR1BL58eDOXgWo4T-HM2CBM";

import { useState, useEffect } from "react";

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

// ── Animated counter hook ────────────────────────────────────────────────────
function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }
    let start = 0;
    const step = Math.ceil(target / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setValue(target);
        clearInterval(timer);
      } else setValue(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return value;
}

// ── Single stat card ─────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, bg, border, loading }) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  return (
    <div
      className={`${bg} ${border} border rounded-2xl px-6 py-6 flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}
    >
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center ${color} bg-opacity-10`}
      >
        {icon}
      </div>
      <div>
        {loading ? (
          <div className="h-9 w-20 bg-slate-200 rounded-lg animate-pulse mb-1" />
        ) : (
          <p className={`text-4xl font-bold tracking-tight ${color}`}>
            {typeof value === "number" ? animated.toLocaleString() : value}
          </p>
        )}
        <p className="text-[14px] font-semibold text-slate-700 mt-1">{label}</p>
        <p className="text-[12px] text-slate-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ImpactDashboard() {
  const [metrics, setMetrics] = useState({
    handoffs: 0,
    institutions: 0,
    regions: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchMetrics = async () => {
    try {
      // 1. Successful handoffs: listings where status = 'claimed' or 'transferred'
      const handoffRes = await fetch(
        `${SUPABASE_URL}/listings?select=id&or=(status.eq.claimed,status.eq.transferred)`,
        { headers: baseHeaders }
      );

      // 2. All listings for institution + region analysis
      const allRes = await fetch(
        `${SUPABASE_URL}/listings?select=owner_type,region_country,owner_region`,
        { headers: baseHeaders }
      );

      if (!handoffRes.ok || !allRes.ok) throw new Error("Fetch failed");

      const handoffData = await handoffRes.json();
      const allData = await allRes.json();

      // Count verified institution listings
      const institutions = new Set(
        allData
          .filter((l) => l.owner_type === "School/Non-Profit Recipient")
          .map((l) => l.owner_region || l.region_country)
          .filter(Boolean)
      ).size;

      // Count distinct active regions
      const regions = new Set(
        allData.map((l) => l.region_country || l.owner_region).filter(Boolean)
      ).size;

      setMetrics({
        handoffs: Array.isArray(handoffData) ? handoffData.length : 0,
        institutions: institutions,
        regions: regions,
      });
      setLastUpdated(new Date());
    } catch (_) {
      // Fail silently — keep last known values
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const cards = [
    {
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-5 h-5"
        >
          <path
            d="M22 11.08V12a10 10 0 11-5.93-9.14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      label: "Successful Handoffs",
      value: metrics.handoffs,
      sub: "Items finalized via 6-digit escrow PIN",
      color: "text-green-600",
      bg: "bg-green-50",
      border: "border-green-100",
    },
    {
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-5 h-5"
        >
          <path
            d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
      label: "Verified Institutions",
      value: metrics.institutions,
      sub: "Edu hubs & non-profits with active Tax IDs",
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
    },
    {
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-5 h-5"
        >
          <circle cx="12" cy="12" r="10" />
          <path
            d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
      label: "Active Regions",
      value: metrics.regions,
      sub: "Distinct countries & regions on platform",
      color: "text-violet-600",
      bg: "bg-violet-50",
      border: "border-violet-100",
    },
  ];

  return (
    <div className="w-full">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-widest">
              Live Impact Metrics
            </span>
          </div>
          <h3 className="text-[22px] font-bold text-slate-900 tracking-tight">
            Platform Impact
          </h3>
        </div>
        <div className="text-right">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="text-[12px] font-medium text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-3.5 h-3.5 animate-spin"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-3.5 h-3.5"
              >
                <polyline points="23 4 23 10 17 10" />
                <path
                  d="M20.49 15a9 9 0 11-2.12-9.36L23 10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            Refresh
          </button>
          {lastUpdated && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              Updated{" "}
              {lastUpdated.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} loading={loading} />
        ))}
      </div>
    </div>
  );
}
