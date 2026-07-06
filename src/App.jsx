import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT VARIABLES — copy this block into your StackBlitz .env file:
//
//  VITE_SUPABASE_URL=https://dwpqeuuqfbmbuqpuufup.supabase.co/rest/v1
//  VITE_SUPABASE_STORAGE=https://dwpqeuuqfbmbuqpuufup.supabase.co/storage/v1
//  VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cHFldXVxZmJtYnVxcHV1ZnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDY4MjIsImV4cCI6MjA5NDU4MjgyMn0.lzhbbl49fPMDc-YKzT2fxR1BL58eDOXgWo4T-HM2CBM
//  VITE_AUTH_URL=https://dwpqeuuqfbmbuqpuufup.supabase.co/auth/v1
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Supabase Config ─────────────────────────────────────────────────────────
// Values are read from .env (VITE_* variables) when available, and fall back
// to the hardcoded project values below — so the app works in VS Code or any
// environment that doesn't have a .env file configured.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://dwpqeuuqfbmbuqpuufup.supabase.co/rest/v1";

const SUPABASE_STORAGE =
  import.meta.env.VITE_SUPABASE_STORAGE ||
  "https://dwpqeuuqfbmbuqpuufup.supabase.co/storage/v1";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cHFldXVxZmJtYnVxcHV1ZnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDY4MjIsImV4cCI6MjA5NDU4MjgyMn0.lzhbbl49fPMDc-YKzT2fxR1BL58eDOXgWo4T-HM2CBM";

const AUTH_URL =
  import.meta.env.VITE_AUTH_URL ||
  "https://dwpqeuuqfbmbuqpuufup.supabase.co/auth/v1";

const getHeaders = (token = null) => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
});

// SECURITY: localStorage is convenient but vulnerable to XSS token theft.
// In production, use HttpOnly secure cookies via a server-side auth proxy instead.
const getToken = () => localStorage.getItem("eq_token");
const getUserId = () => {
  try {
    return JSON.parse(localStorage.getItem("eq_user"))?.id;
  } catch {
    return null;
  }
};

// ─── Global Unread Message Count ─────────────────────────────────────────────
async function fetchUnreadCount(user) {
  if (!user) return 0;
  try {
    const since =
      localStorage.getItem("eq_msgs_seen_" + user.email) ||
      "1970-01-01T00:00:00Z";
    const receiverParam = encodeURIComponent(user.email);
    // Fetch listing_id instead of id — we count distinct conversations,
    // not individual messages. 5 messages from one chat = 1 badge dot, not 5.
    const res = await fetch(
      `${SUPABASE_URL}/messages?receiver_id=eq.${receiverParam}&created_at=gt.${encodeURIComponent(
        since
      )}&select=listing_id`,
      { headers: getHeaders(getToken()) }
    );
    if (!res.ok) return 0;
    const msgs = await res.json();
    if (!Array.isArray(msgs) || msgs.length === 0) return 0;
    // One badge count per unique conversation, not per message
    const uniqueConversations = new Set(msgs.map(m => String(m.listing_id)));
    return uniqueConversations.size;
  } catch {
    return 0;
  }
}

function markMessagesRead(userEmail) {
  localStorage.setItem("eq_msgs_seen_" + userEmail, new Date().toISOString());
}

// ─── Edge Function URLs ───────────────────────────────────────────────────────
const EDGE_FUNCTION_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(
  "/rest/v1",
  "/functions/v1/send-whatsapp-otp"
);

// ─── Founder Access Control ───────────────────────────────────────────────────
// UI ONLY: this controls frontend visibility of the PDF button.
// SECURITY WARNING: true admin privileges MUST be enforced via Supabase RLS policies
// and server-side role checks — never trust client-side email matching for data access.
const FOUNDER_EMAIL = "younus.abdulkadir09@gmail.com";

// ─── Time helper ─────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

// ─── Password Strength ────────────────────────────────────────────────────────
function getPasswordStrength(pwd) {
  if (!pwd) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 2) return { score, label: "Fair", color: "bg-amber-500" };
  if (score <= 3) return { score, label: "Good", color: "bg-blue-500" };
  return { score, label: "Strong", color: "bg-green-500" };
}

// ─── Focus Trap Hook ──────────────────────────────────────────────────────────
// Keeps keyboard focus inside a modal — critical for WCAG 2.1 SC 2.1.2
function useFocusTrap(isActive) {
  const ref = useRef(null);
  useEffect(() => {
    if (!isActive || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const prev = document.activeElement;
    first?.focus();
    const handler = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const escHandler = (e) => {
      if (e.key === "Escape") el.dispatchEvent(new CustomEvent("trap:escape", { bubbles: true }));
    };
    el.addEventListener("keydown", handler);
    el.addEventListener("keydown", escHandler);
    return () => {
      el.removeEventListener("keydown", handler);
      el.removeEventListener("keydown", escHandler);
      prev?.focus();
    };
  }, [isActive]);
  return ref;
}

// ─── Offline Detection Hook ───────────────────────────────────────────────────
function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

// ─── Offline Banner ───────────────────────────────────────────────────────────
function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="alert" aria-live="assertive" className="fixed top-0 left-0 right-0 z-[999] bg-amber-500 text-white text-[13px] font-semibold text-center py-2.5 px-4 flex items-center justify-center gap-2">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" strokeLinecap="round" strokeLinejoin="round"/></svg>
      You're offline — some features may not work until your connection is restored.
    </div>
  );
}

// ─── Skip to Content ──────────────────────────────────────────────────────────
// First element on the page — allows keyboard/screen reader users to skip nav
function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-[14px] focus:font-semibold"
    >
      Skip to main content
    </a>
  );
}

// ─── Skeleton Loader ──────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden animate-pulse">
      <div className="w-full h-44 bg-slate-200" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-slate-200 rounded-full w-3/4" />
        <div className="h-3 bg-slate-100 rounded-full w-1/2" />
        <div className="flex gap-2">
          <div className="h-6 bg-slate-100 rounded-full w-16" />
          <div className="h-6 bg-slate-100 rounded-full w-20" />
        </div>
        <div className="h-9 bg-slate-100 rounded-xl w-full mt-2" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 animate-pulse border-b border-slate-50">
      <div className="w-12 h-12 bg-slate-200 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-slate-200 rounded-full w-1/3" />
        <div className="h-3 bg-slate-100 rounded-full w-2/3" />
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon, title, body, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-3xl">{icon}</div>
      <h3 className="text-[16px] font-bold text-slate-800 mb-2">{title}</h3>
      <p className="text-[13px] text-slate-500 max-w-xs leading-relaxed mb-5">{body}</p>
      {action && (
        <button onClick={onAction} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl text-[13px] transition-all">
          {action}
        </button>
      )}
    </div>
  );
}

// ─── XSS-Safe Sanitizer (HTML entity encoder) ────────────────────────────────
// Encodes dangerous characters as safe HTML entities instead of stripping them,
// preserving user-typed spaces and structure while blocking script injection.
const sanitize = (str) =>
  String(str || "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
// NOTE: apostrophes and quotes are NOT escaped here to allow normal typing.
// HTML entity encoding happens only at the DB/render layer, not on user input.

// ─── Anti-Spam Throttle (Client-Side) ────────────────────────────────────────
// SECURITY WARNING: this frontend throttle provides UX feedback only.
// It can be bypassed by direct API calls. For real protection, enforce
// rate limiting via Supabase Edge Function middleware or database triggers.
const submissionLog = { times: [] };
const checkThrottle = () => {
  const now = Date.now();
  submissionLog.times = submissionLog.times.filter((t) => now - t < 60_000);
  if (submissionLog.times.length >= 3) return false;
  submissionLog.times.push(now);
  return true;
};
const claimLog = { times: {} };
const checkClaimThrottle = (listingId) => {
  const now = Date.now();
  if (!claimLog.times[listingId]) claimLog.times[listingId] = [];
  claimLog.times[listingId] = claimLog.times[listingId].filter(
    (t) => now - t < 300_000
  );
  if (claimLog.times[listingId].length >= 2) return false;
  claimLog.times[listingId].push(now);
  return true;
};

// ─── Validation Helpers ───────────────────────────────────────────────────────
const INSTITUTIONAL_DOMAINS =
  /\.(edu|org|gov|ac\.[a-z]{2}|k12\.[a-z]{2}\.us|sch\.uk)$/i;
const validatePhone = (dialCode, phone) => {
  const digits = phone.replace(/[\s\-().]/g, "");
  if (!/^\d+$/.test(digits)) return false;
  const total = (dialCode + digits).replace("+", "").length;
  return total >= 7 && total <= 15;
};

// ─── Country Codes (60 countries, sorted alphabetically) ─────────────────────
const COUNTRY_CODES = [
  { code: "+213", country: "Algeria", flag: "🇩🇿" },
  { code: "+54", country: "Argentina", flag: "🇦🇷" },
  { code: "+61", country: "Australia", flag: "🇦🇺" },
  { code: "+43", country: "Austria", flag: "🇦🇹" },
  { code: "+973", country: "Bahrain", flag: "🇧🇭" },
  { code: "+880", country: "Bangladesh", flag: "🇧🇩" },
  { code: "+32", country: "Belgium", flag: "🇧🇪" },
  { code: "+55", country: "Brazil", flag: "🇧🇷" },
  { code: "+1", country: "Canada", flag: "🇨🇦" },
  { code: "+56", country: "Chile", flag: "🇨🇱" },
  { code: "+86", country: "China", flag: "🇨🇳" },
  { code: "+57", country: "Colombia", flag: "🇨🇴" },
  { code: "+45", country: "Denmark", flag: "🇩🇰" },
  { code: "+20", country: "Egypt", flag: "🇪🇬" },
  { code: "+251", country: "Ethiopia", flag: "🇪🇹" },
  { code: "+358", country: "Finland", flag: "🇫🇮" },
  { code: "+33", country: "France", flag: "🇫🇷" },
  { code: "+49", country: "Germany", flag: "🇩🇪" },
  { code: "+233", country: "Ghana", flag: "🇬🇭" },
  { code: "+30", country: "Greece", flag: "🇬🇷" },
  { code: "+91", country: "India", flag: "🇮🇳" },
  { code: "+62", country: "Indonesia", flag: "🇮🇩" },
  { code: "+353", country: "Ireland", flag: "🇮🇪" },
  { code: "+39", country: "Italy", flag: "🇮🇹" },
  { code: "+81", country: "Japan", flag: "🇯🇵" },
  { code: "+962", country: "Jordan", flag: "🇯🇴" },
  { code: "+254", country: "Kenya", flag: "🇰🇪" },
  { code: "+82", country: "South Korea", flag: "🇰🇷" },
  { code: "+965", country: "Kuwait", flag: "🇰🇼" },
  { code: "+60", country: "Malaysia", flag: "🇲🇾" },
  { code: "+52", country: "Mexico", flag: "🇲🇽" },
  { code: "+212", country: "Morocco", flag: "🇲🇦" },
  { code: "+31", country: "Netherlands", flag: "🇳🇱" },
  { code: "+64", country: "New Zealand", flag: "🇳🇿" },
  { code: "+234", country: "Nigeria", flag: "🇳🇬" },
  { code: "+47", country: "Norway", flag: "🇳🇴" },
  { code: "+968", country: "Oman", flag: "🇴🇲" },
  { code: "+92", country: "Pakistan", flag: "🇵🇰" },
  { code: "+63", country: "Philippines", flag: "🇵🇭" },
  { code: "+351", country: "Portugal", flag: "🇵🇹" },
  { code: "+974", country: "Qatar", flag: "🇶🇦" },
  { code: "+7", country: "Russia", flag: "🇷🇺" },
  { code: "+966", country: "Saudi Arabia", flag: "🇸🇦" },
  { code: "+65", country: "Singapore", flag: "🇸🇬" },
  { code: "+27", country: "South Africa", flag: "🇿🇦" },
  { code: "+34", country: "Spain", flag: "🇪🇸" },
  { code: "+46", country: "Sweden", flag: "🇸🇪" },
  { code: "+41", country: "Switzerland", flag: "🇨🇭" },
  { code: "+90", country: "Turkey", flag: "🇹🇷" },
  { code: "+971", country: "United Arab Emirates", flag: "🇦🇪" },
  { code: "+44", country: "United Kingdom", flag: "🇬🇧" },
  { code: "+1", country: "United States", flag: "🇺🇸" },
];

// ─── Tax ID Labels by Country ────────────────────────────────────────────────
// Maps dial codes to the correct local term and whether it's required
const TAX_ID_CONFIG = {
  "+1": {
    label: "EIN / Tax ID Number",
    placeholder: "e.g. 12-3456789",
    required: true,
  },
  "+44": {
    label: "Charity Commission Number",
    placeholder: "e.g. 1234567",
    required: true,
  },
  "+966": {
    label: "Commercial Registration No.",
    placeholder: "e.g. 1010XXXXXX",
    required: true,
  },
  "+971": {
    label: "Trade License / Registration No.",
    placeholder: "e.g. CN-123456",
    required: true,
  },
  "+49": {
    label: "Vereinsregisternummer",
    placeholder: "e.g. VR 12345",
    required: true,
  },
  "+33": {
    label: "SIRET / RNA Number",
    placeholder: "e.g. W123456789",
    required: true,
  },
  "+91": {
    label: "NGO / Trust Registration No.",
    placeholder: "e.g. DIT/E/2020/...",
    required: true,
  },
  "+86": {
    label: "Organization Code",
    placeholder: "e.g. 12345678-9",
    required: true,
  },
  "+55": {
    label: "CNPJ Number",
    placeholder: "e.g. 00.000.000/0001",
    required: true,
  },
  "+61": {
    label: "ABN / ACN Number",
    placeholder: "e.g. 51 824 753 556",
    required: true,
  },
  "+27": {
    label: "NPO Registration Number",
    placeholder: "e.g. 123-456 NPO",
    required: true,
  },
  "+234": {
    label: "CAC Registration Number",
    placeholder: "e.g. RC 123456",
    required: true,
  },
  "+254": {
    label: "NGO Registration Number",
    placeholder: "e.g. OP.218/051/...",
    required: true,
  },
  "+20": {
    label: "Ministry of Social Solidarity No.",
    placeholder: "e.g. 1234/2020",
    required: true,
  },
  "+92": {
    label: "SECP / NGO Registration No.",
    placeholder: "e.g. SECP/NGO/...",
    required: true,
  },
  "+60": {
    label: "ROS Registration Number",
    placeholder: "e.g. PPM-001-10-...",
    required: true,
  },
  "+65": {
    label: "UEN / Charity Registration",
    placeholder: "e.g. 201012345K",
    required: true,
  },
  "+81": {
    label: "Corporate Number (法人番号)",
    placeholder: "e.g. 1234567890123",
    required: true,
  },
  "+82": {
    label: "Business Registration Number",
    placeholder: "e.g. 123-45-67890",
    required: true,
  },
  "+90": {
    label: "Dernek / Vakıf Registration No.",
    placeholder: "e.g. 06-123-456",
    required: true,
  },
  // Countries where Tax ID is optional or uncommon for NGOs
  "+251": {
    label: "Registration Number (optional)",
    placeholder: "If applicable",
    required: false,
  },
  "+233": {
    label: "Registration Number (optional)",
    placeholder: "If applicable",
    required: false,
  },
  "+212": {
    label: "Registration Number (optional)",
    placeholder: "If applicable",
    required: false,
  },
  "+213": {
    label: "Registration Number (optional)",
    placeholder: "If applicable",
    required: false,
  },
  "+880": {
    label: "NGO Bureau Registration (opt.)",
    placeholder: "If applicable",
    required: false,
  },
  "+62": {
    label: "Registration Number (optional)",
    placeholder: "If applicable",
    required: false,
  },
  "+63": {
    label: "SEC / BIR Registration (opt.)",
    placeholder: "If applicable",
    required: false,
  },
};

// Helper: get Tax ID config for selected dial code, fallback to generic
const getTaxIdConfig = (dialCode) =>
  TAX_ID_CONFIG[dialCode] || {
    label: "Non-Profit Registration Number",
    placeholder: "e.g. REG-123456",
    required: true,
  };

// ─── Countries for listing form (derived from COUNTRY_CODES) ─────────────────
const COUNTRIES = COUNTRY_CODES.map((c) => ({
  name: c.country,
  flag: c.flag,
  code: c.code,
}));

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  "Technology",
  "Furniture",
  "Office Supplies",
  "Food & Beverage",
  "Clothing",
  "Medical Supplies",
  "Educational Materials",
  "Pets",
  "Other",
];
const REGIONS = [
  "All Regions",
  "North America",
  "South America",
  "Europe",
  "Middle East",
  "Africa",
  "Asia Pacific",
  "South Asia",
  "Other",
];
const ACCOUNT_TYPES = [
  "Individual Donor",
  "Corporate/Lab Donor",
  "School/Non-Profit Recipient",
  "Individual Recipient",
];

const CATEGORY_COLORS = {
  Technology: "bg-blue-50 text-blue-700 ring-blue-200",
  Furniture: "bg-amber-50 text-amber-700 ring-amber-200",
  "Office Supplies": "bg-slate-50 text-slate-700 ring-slate-200",
  "Food & Beverage": "bg-green-50 text-green-700 ring-green-200",
  Clothing: "bg-rose-50 text-rose-700 ring-rose-200",
  "Medical Supplies": "bg-teal-50 text-teal-700 ring-teal-200",
  "Educational Materials": "bg-violet-50 text-violet-700 ring-violet-200",
  Pets: "bg-orange-50 text-orange-700 ring-orange-200",
  Other: "bg-gray-50 text-gray-600 ring-gray-200",
};

const OWNER_TYPE_BADGE = {
  "Corporate/Lab Donor": { label: "Lab Donor", cls: "bg-blue-600 text-white" },
  "Individual Donor": {
    label: "Verified Donor",
    cls: "bg-slate-700 text-white",
  },
  "School/Non-Profit Recipient": {
    label: "Verified Recipient",
    cls: "bg-green-600 text-white",
  },
};

const EWASTE_WEIGHTS = {
  Technology: 8,
  Furniture: 15,
  "Office Supplies": 2,
  "Food & Beverage": 1,
  Clothing: 3,
  "Medical Supplies": 4,
  "Educational Materials": 2,
  Pets: 2,
  Other: 3,
};

// ─── Map Region Pins (mock geo data) ─────────────────────────────────────────
const REGION_PINS = [
  { region: "North America", x: "18%", y: "32%", color: "bg-blue-500" },
  { region: "South America", x: "28%", y: "62%", color: "bg-green-500" },
  { region: "Europe", x: "48%", y: "22%", color: "bg-violet-500" },
  { region: "Middle East & Africa", x: "55%", y: "42%", color: "bg-amber-500" },
  { region: "South Asia", x: "65%", y: "38%", color: "bg-rose-500" },
  { region: "Asia Pacific", x: "78%", y: "35%", color: "bg-teal-500" },
  { region: "Other", x: "85%", y: "65%", color: "bg-slate-500" },
];

// ─── Icons ────────────────────────────────────────────────────────────────────
const IconLink = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    className="w-5 h-5"
  >
    <path
      d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconPlus = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    className="w-4 h-4"
  >
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);
const IconBox = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-4 h-4"
  >
    <path
      d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-14v10l8 4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconGlobe = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-5 h-5"
  >
    <circle cx="12" cy="12" r="10" />
    <path
      d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconCheck = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className="w-4 h-4"
  >
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconLoader = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-5 h-5 animate-spin"
  >
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);
const IconArrow = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <path
      d="M5 12h14M12 5l7 7-7 7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconMapPin = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-3.5 h-3.5"
  >
    <path
      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);
const IconFlag = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-3.5 h-3.5"
  >
    <path
      d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <line x1="4" y1="22" x2="4" y2="15" strokeLinecap="round" />
  </svg>
);
const IconX = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);
const IconAward = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-5 h-5"
  >
    <circle cx="12" cy="8" r="6" />
    <path
      d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconShield = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <path
      d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconMsg = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <path
      d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconPhone = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-3.5 h-3.5"
  >
    <path d="M22 16.92v3a2 2 0 01-2.18 2A19.79 19.79 0 0112 18.85a19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
  </svg>
);
const IconEmail = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-3.5 h-3.5"
  >
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);
const IconEye = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-3.5 h-3.5"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconSend = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);
const IconDownload = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const IconSearch = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-4 h-4"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IconUpload = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="w-6 h-6"
  >
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
  </svg>
);


// ─── PinCopyButton ────────────────────────────────────────────────────────────
function PinCopyButton({ pin }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(String(pin));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
      title="Copy your PIN"
    >
      {copied ? "✓ Copied" : `PIN: ${pin}`}
    </button>
  );
}

// ─── ExpandableDescription ────────────────────────────────────────────────────
function ExpandableDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 120;
  return (
    <div>
      <p className="text-[13px] text-slate-500 leading-relaxed">
        {isLong && !expanded ? text.slice(0, 120) + "…" : text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(p => !p)}
          className="text-[12px] text-blue-600 hover:text-blue-800 font-medium mt-1"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// ─── Chat Window ──────────────────────────────────────────────────────────────
function ChatWindow({ listing, user, onClose }) {
  const otherName =
    listing.owner_email === user?.email
      ? listing.claimer_id || "Claimer"
      : listing.owner_org_name || listing.organization || "Owner";
  const defaultMsg =
    listing.owner_email !== user?.email
      ? `Hi ${otherName}, I am interested in your listed item: "${listing.title}". Let\'s coordinate pickup!`
      : "";

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(defaultMsg);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastCount, setLastCount] = useState(0);
  const bottomRef = useRef(null);
  const pollRef = useRef(null);
  const isMounted = useRef(true);

  // ── Fetch all messages for this listing from Supabase ─────────────────────
  const fetchMessages = async () => {
    if (!isMounted.current || !user) return;
    const safeId = String(listing.id).replace(/[^a-zA-Z0-9-]/g, "");
    if (!safeId) return;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/messages?listing_id=eq.${safeId}&order=created_at.asc&select=*&limit=200`,
        { headers: getHeaders(getToken()) }
      );
      if (!res.ok || !isMounted.current) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setMessages(prev => {
        // Belt-and-suspenders: drop ALL temp messages whenever fresh server
        // data arrives. The send() function now swaps temp → real immediately
        // on success, so any surviving temp is either a failed send (already
        // removed) or a stale ghost from a previous session — either way, gone.
        return data;
      });
      setLastCount(data.length);
    } catch (_) {
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    isMounted.current = true;
    fetchMessages();

    // ── Supabase Realtime WebSocket subscription ──────────────────────────
    // Listens for INSERT events on messages table filtered by listing_id
    // This gives instant delivery with zero polling delay — 100% free tier
    const REALTIME_URL =
      (SUPABASE_URL || "")
        .replace("/rest/v1", "")
        .replace("https://", "wss://") +
      "/realtime/v1/websocket?apikey=" +
      SUPABASE_ANON_KEY +
      "&vsn=1.0.0";

    let ws = null;
    let pingInterval = null;

    try {
      ws = new WebSocket(REALTIME_URL);

      ws.onopen = () => {
        // Join the messages channel filtered to this listing
        ws.send(
          JSON.stringify({
            topic: `realtime:public:messages:listing_id=eq.${listing.id}`,
            event: "phx_join",
            payload: {},
            ref: "1",
          })
        );
        // Keep connection alive with pings every 20s
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                topic: "phoenix",
                event: "heartbeat",
                payload: {},
                ref: "hb",
              })
            );
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Only react to INSERT events on messages table
          if (msg.event === "INSERT" && msg.payload?.record) {
            const newMsg = msg.payload.record;
            if (String(newMsg.listing_id) === String(listing.id)) {
              setMessages((prev) => {
                // Don't add if already exists (avoid duplicates)
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                // Replace matching temp message if exists
                const withoutTemp = prev.filter(
                  (m) =>
                    !(
                      String(m.id).startsWith("temp-") &&
                      m.message_text === newMsg.message_text
                    )
                );
                return [...withoutTemp, newMsg];
              });
            }
          }
        } catch (_) {}
      };

      ws.onerror = () => {
        // Fallback to polling if WebSocket fails
        if (!pollRef.current) {
          pollRef.current = setInterval(fetchMessages, 4000);
        }
      };

      ws.onclose = () => {
        clearInterval(pingInterval);
        // Fallback to polling on disconnect
        if (isMounted.current && !pollRef.current) {
          pollRef.current = setInterval(fetchMessages, 4000);
        }
      };
    } catch (_) {
      // WebSocket not available — fall back to polling
      pollRef.current = setInterval(fetchMessages, 4000);
    }

    return () => {
      isMounted.current = false;
      clearInterval(pollRef.current);
      clearInterval(pingInterval);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [listing.id]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Send message ─────────────────────────────────────────────────────────
  const send = async () => {
    if (!user) return;
    const text = input.trim();
    if (!text) return;
    setInput("");
    setSending(true);

    const senderName = user.username || user.org_name || user.email || "User";
    const senderEmail = user.email || "";
    const senderId = user.id || senderEmail;
    const isOwner = listing.owner_email === user.email;
    // FIXED: receiver_id logic
    // Non-owner always messages the owner
    // Owner replies to whoever last messaged them (found in messages state)
    // Falls back to a general thread ID so message is never lost
    let receiverId = "";
    if (!isOwner) {
      // Recipient/claimer sends to owner
      receiverId = listing.owner_email || "";
    } else {
      // Owner replies to the most recent non-owner sender
      const otherMsg = [...messages].reverse().find(
        m => m.sender_email && m.sender_email !== user.email
      );
      receiverId = otherMsg?.sender_email || otherMsg?.sender_id || listing.claimer_id || senderId;
    }
    const tempId = "temp-" + Date.now();

    // STEP 1 — Add a local placeholder only as a fallback if DB returns no record.
    // We immediately swap it for the real saved record on success, so it
    // should almost never be visible. If the DB save fails we remove it.
    const localMsg = {
      id: tempId,
      listing_id: String(listing.id),
      sender_id: senderId,
      sender_email: senderEmail,
      sender_name: senderName,
      receiver_id: receiverId,
      message_text: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localMsg]);

    // STEP 2 — Save to DB and immediately replace the placeholder
    try {
      const msgHeaders = getHeaders(getToken());
      msgHeaders["Prefer"] = "return=representation";
      const res = await fetch(SUPABASE_URL + "/messages", {
        method: "POST",
        headers: msgHeaders,
        body: JSON.stringify({
          listing_id: String(listing.id),
          sender_id: String(senderId),
          sender_email: String(senderEmail),
          sender_name: String(senderName),
          sender_avatar_url: String(user?.avatar_url || ""),
          receiver_id: String(receiverId),
          message_text: String(text),
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        const savedMsg = Array.isArray(saved) ? saved[0] : saved;
        if (savedMsg?.id) {
          // Replace placeholder with real record — WebSocket / polling won't
          // add it again because they check `m.id === newMsg.id` first.
          setMessages(prev =>
            prev.map(m => String(m.id) === tempId ? { ...savedMsg } : m)
          );
        } else {
          // Supabase didn't return representation — refetch to clear placeholder
          if (isMounted.current) fetchMessages();
        }
        if (receiverId && receiverId !== senderEmail) {
          sendEmailNotification(
            receiverId,
            `New message about "${escapeHtml(listing.title)}" on Eqovely`,
            `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
              <h2 style="color:#1d4ed8">Eqovely — New Message</h2>
              <p><strong>${escapeHtml(senderName)}</strong> sent you a message about <strong>${escapeHtml(listing.title)}</strong>:</p>
              <blockquote style="border-left:3px solid #1d4ed8;padding-left:12px;color:#334155">${escapeHtml(text.slice(0,200))}${text.length > 200 ? "..." : ""}</blockquote>
              <p>Log in to Eqovely to reply.</p>
              <p style="color:#64748b;font-size:13px">Founded by Younus Abdulkadir · Eqovely Global Resource Marketplace</p>
            </div>`
          );
        }
      } else {
        const e = await res.json().catch(() => ({}));
        console.error("CHAT DB ERROR:", res.status, e.message || e.hint || e.code || e);
        // Remove the placeholder on failure so it doesn't get stuck
        setMessages(prev => prev.filter(m => String(m.id) !== tempId));
        setInput(text); // Restore so user can retry
      }
    } catch (err) {
      console.error("CHAT NETWORK ERROR:", err.message);
      // Local message stays visible — no alert
    } finally {
      setSending(false);
    }
  };
  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      className="fixed bottom-0 right-0 left-0 sm:bottom-6 sm:right-6 sm:left-auto z-50 w-full sm:w-96 bg-white sm:rounded-2xl shadow-2xl border-t sm:border border-slate-200 flex flex-col overflow-hidden"
      style={{ maxHeight: "520px" }}
    >
      {/* Header */}
      <div className="bg-blue-600 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <p className="text-white font-semibold text-[13px] truncate">
            {otherName}
          </p>
          <p className="text-blue-200 text-[11px] truncate">{listing.title}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Show PIN to claimer directly in chat header */}
          {listing.verification_pin && listing.owner_email !== user?.email && (
            <PinCopyButton pin={listing.verification_pin} />
          )}
          <span className="flex items-center gap-1 text-[10px] text-blue-200">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            Live
          </span>
          <button
            onClick={onClose}
            className="text-blue-200 hover:text-white transition-colors ml-1"
          >
            <IconX />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
        {loading ? (
          <div className="flex justify-center py-8">
            <IconLoader />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-[12px] text-slate-400 text-center italic py-6">
            No messages yet. Say hello!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe =
              msg.sender_email === user?.email ||
              msg.sender_id === user?.id ||
              msg.sender_id === user?.email;
            const isTemp = String(msg.id).startsWith("temp-");
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  isMe ? "items-end" : "items-start"
                }`}
              >
                {!isMe && (
                  <p className="text-[10px] font-semibold text-blue-600 mb-1 px-1">
                    {msg.sender_name || "Other"}
                  </p>
                )}
                <div
                  className={`max-w-[80%] px-3 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                    isMe
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"
                  } ${isTemp ? "opacity-70" : ""}`}
                >
                  <p className="break-words whitespace-pre-wrap">
                    {msg.message_text ||
                      msg.body ||
                      msg.text ||
                      msg.content ||
                      ""}
                  </p>
                  <p
                    className={`text-[10px] mt-1 ${
                      isMe ? "text-blue-200 text-right" : "text-slate-400"
                    }`}
                  >
                    {isTemp
                      ? "sending…"
                      : new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-100 flex gap-2 shrink-0 bg-white">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          placeholder="Type a message… (Enter to send)"
          className="flex-1 text-[13px] border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-800 placeholder-slate-400"
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="self-end bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white p-2.5 rounded-xl transition-all"
        >
          {sending ? <IconLoader /> : <IconSend />}
        </button>
      </div>
    </div>
  );
}

// ─── Impact PDF Generator ─────────────────────────────────────────────────────
function generateImpactPDF(listings) {
  const claimed = listings.filter(
    (l) => l.status === "claimed" || l.status === "transferred"
  );
  const eWaste = claimed.reduce(
    (s, l) => s + (EWASTE_WEIGHTS[l.category] || 3) * (l.quantity || 1),
    0
  );
  const orgs = new Set(
    listings.map((l) => l.owner_org_name || l.organization).filter(Boolean)
  ).size;
  const institutions = listings.filter(
    (l) => l.owner_type === "School/Non-Profit Recipient"
  ).length;
  const regions = new Set(
    listings.map((l) => l.region_country || l.owner_region).filter(Boolean)
  ).size;
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Eqovely Impact Report</title>
<style>
  body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px;color:#0f172a;background:#fff;}
  .header{background:linear-gradient(135deg,#1d4ed8,#1e40af);color:white;padding:40px;border-radius:16px;margin-bottom:32px;}
  .header h1{margin:0 0 8px;font-size:28px;font-weight:800;}
  .header p{margin:0;opacity:.85;font-size:14px;}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;}
  .stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;}
  .stat .value{font-size:36px;font-weight:800;color:#1d4ed8;display:block;}
  .stat .label{font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:4px;}
  .section{margin-bottom:24px;}
  .section h2{font-size:16px;font-weight:700;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px;}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;}
  .footer{margin-top:40px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:20px;}
  .badge{display:inline-block;background:#dcfce7;color:#166534;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;}
</style></head><body>
<div class="header">
  <h1>Eqovely Impact Report</h1>
  <p>Global Resource Redistribution Platform &nbsp;·&nbsp; Generated ${date}</p>
  <p style="margin-top:8px;font-size:13px;">Founded by Younus Abdulkadir &nbsp;·&nbsp; Bridging the Digital Divide</p>
</div>
<div class="stats">
  <div class="stat"><span class="value">${
    claimed.length
  }</span><span class="label">Successful Handoffs</span></div>
  <div class="stat"><span class="value">${eWaste.toLocaleString()} lbs</span><span class="label">Est. E-Waste Diverted</span></div>
  <div class="stat"><span class="value">${regions}</span><span class="label">Active Regions</span></div>
</div>
<div class="section">
  <h2>Platform Overview</h2>
  <div class="row"><span>Total Listings</span><span><strong>${
    listings.length
  }</strong></span></div>
  <div class="row"><span>Available Items</span><span><strong>${
    listings.filter((l) => l.status === "available").length
  }</strong></span></div>
  <div class="row"><span>Items Claimed / Transferred</span><span><strong>${
    claimed.length
  }</strong></span></div>
  <div class="row"><span>Verified Institutions</span><span><strong>${institutions}</strong></span></div>
  <div class="row"><span>Participating Organizations</span><span><strong>${orgs}</strong></span></div>
  <div class="row"><span>Report Date</span><span><strong>${date}</strong></span></div>
</div>
<div class="section">
  <h2>Mission Statement</h2>
  <p style="font-size:13px;color:#475569;line-height:1.7;">Eqovely exists to eliminate the structural inequality of technology access by creating a verified, secure pipeline from corporate surplus to educational institutions and non-profits worldwide. Every handoff recorded in this report represents a child gaining access to technology, a school equipping its classrooms, and a community building toward a more equitable digital future.</p>
  <p style="margin-top:12px;"><span class="badge">✓ Verified Platform Data</span></p>
</div>
<div class="footer">
  <p>Eqovely Global Resource Marketplace &nbsp;·&nbsp; eqovely.com &nbsp;·&nbsp; © 2025 Younus Abdulkadir</p>
  <p>This report was auto-generated from live Supabase database statistics.</p>
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Eqovely-Impact-Report-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Email Notification via Supabase Edge Function ───────────────────────────
// Calls the send-email Edge Function which uses Resend.com to deliver emails
const EDGE_EMAIL_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  "https://dwpqeuuqfbmbuqpuufup.supabase.co/rest/v1"
).replace("/rest/v1", "/functions/v1/send-email");

async function sendEmailNotification(toEmail, subject, htmlBody) {
  if (!toEmail) return;
  try {
    await fetch(EDGE_EMAIL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (getToken() || SUPABASE_ANON_KEY),
      },
      body: JSON.stringify({ to: toEmail, subject, html: htmlBody }),
    });
  } catch (err) {
    console.warn("Email notification failed:", err.message);
  }
}

// Escape user-provided text before embedding in HTML email bodies.
// Without this, a username like <script>...</script> becomes a stored
// XSS vector delivered to every recipient's email client.
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function fetchNotifications(user) {
  if (!user) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/notifications?recipient_email=eq.${encodeURIComponent(
        user.email
      )}&order=created_at.desc&limit=20`,
      { headers: getHeaders(getToken()) }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function markNotifRead(id) {
  try {
    await fetch(`${SUPABASE_URL}/notifications?id=eq.${id}`, {
      method: "PATCH",
      headers: getHeaders(getToken()),
      body: JSON.stringify({ read: true }),
    });
  } catch {}
}

async function createNotification(recipientEmail, type, message, listingId) {
  if (!recipientEmail) return;
  try {
    await fetch(`${SUPABASE_URL}/notifications`, {
      method: "POST",
      headers: getHeaders(getToken()),
      body: JSON.stringify({
        recipient_email: recipientEmail,
        type,
        message,
        listing_id: listingId,
        read: false,
      }),
    });
  } catch {}
}

function NotificationBell({ user, onOpenChat, listings }) {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const filtered = notifs.filter(
    (n) => n.type === "claim" || n.type === "transfer"
  );
  const unread = filtered.filter((n) => !n.read).length;

  const load = async () => {
    setLoading(true);
    const data = await fetchNotifications(user);
    setNotifs(data.filter((n) => n.type === "claim" || n.type === "transfer"));
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [user]);

  const handleOpen = () => {
    setOpen((p) => !p);
    if (!open) load();
  };

  const handleRead = async (id) => {
    await markNotifRead(id);
    setNotifs((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 border border-slate-200 hover:border-slate-300 rounded-full transition-all bg-white hover:bg-slate-50"
        title="Notifications"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-4 h-4 text-slate-500"
        >
          <path
            d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-slate-900">
              Notifications
            </h3>
            <div className="flex items-center gap-2">
              {notifs.some((n) => !n.read) && (
                <button
                  onClick={async () => {
                    await Promise.all(
                      notifs
                        .filter((n) => !n.read)
                        .map((n) => markNotifRead(n.id))
                    );
                    setNotifs((p) => p.map((n) => ({ ...n, read: true })));
                  }}
                  className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <IconX />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <IconLoader />
              </div>
            ) : notifs.length === 0 ? (
              <p className="text-[13px] text-slate-400 text-center py-6">
                No notifications yet
              </p>
            ) : (
              notifs.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    handleRead(n.id);
                    if (
                      n.type === "message" &&
                      n.listing_id &&
                      onOpenChat &&
                      listings
                    ) {
                      const listing = listings.find(
                        (l) => String(l.id) === String(n.listing_id)
                      );
                      if (listing) {
                        onOpenChat(listing);
                        setOpen(false);
                      }
                    }
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                    !n.read ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg shrink-0">
                      {n.type === "claim"
                        ? "box"
                        : n.type === "message"
                        ? "chat"
                        : "bell"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-slate-700 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {new Date(n.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Recipient PIN Modal ──────────────────────────────────────────────────────
// Shown to the RECIPIENT immediately after claiming — displays the 6-digit PIN
// they must show to the donor at pickup to verify the handoff.
function RecipientPinModal({ pin, listing, onClose }) {
  const [copied, setCopied] = useState(false);
  const trapRef = useFocusTrap(true);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(String(pin)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const digits = String(pin).padStart(6, "0").split("");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pin-modal-title">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center">
        {/* Success icon */}
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8 text-green-600" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h2 id="pin-modal-title" className="text-[20px] font-bold text-slate-900 mb-1">Item Claimed!</h2>
        <p className="text-[13px] text-slate-500 mb-6 leading-relaxed">
          Show this 6-digit PIN to <strong>{listing?.owner_email?.split("@")[0] || "the donor"}</strong> when you meet to collect <strong>"{listing?.title}"</strong>.
        </p>

        {/* PIN digits */}
        <div className="flex items-center justify-center gap-2 mb-2" aria-label={`Your PIN is ${String(pin)}`}>
          {digits.map((d, i) => (
            <div key={i} className="w-10 h-12 bg-blue-50 border-2 border-blue-200 rounded-xl flex items-center justify-center text-[22px] font-black text-blue-700 select-none">
              {d}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mb-5">Keep this PIN private — only share it with the donor in person</p>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {copied ? (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4" aria-hidden="true"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied!</>
          ) : (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeLinecap="round"/></svg> Copy PIN</>
          )}
        </button>
        <button onClick={onClose} className="w-full text-[13px] text-slate-500 hover:text-slate-700 py-2 transition-all focus:outline-none focus:underline">
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Privacy Policy Modal ─────────────────────────────────────────────────────
function PrivacyPolicyModal({ onClose }) {
  const trapRef = useFocusTrap(true);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pp-title">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 id="pp-title" className="text-[17px] font-bold text-slate-900">Privacy Policy</h2>
          <button onClick={onClose} aria-label="Close Privacy Policy" className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 text-[13px] text-slate-600 leading-relaxed space-y-4">
          <p className="text-[11px] text-slate-400">Last updated: {new Date().getFullYear()} · Eqovely Nonprofit Platform</p>

          <p>Eqovely ("we", "our", "the platform") is a nonprofit initiative dedicated to connecting surplus resources with those who need them. This Privacy Policy explains what data we collect, why we collect it, and how we protect it.</p>

          <h3 className="text-[14px] font-bold text-slate-800">1. Data We Collect</h3>
          <p><strong>Account data:</strong> When you register, we collect your email address, username, account type (donor or recipient), organization name (if applicable), phone number, and region. This is required to operate the platform.</p>
          <p><strong>Listing data:</strong> Information you provide when posting surplus items — title, description, category, quantity, location, and photos.</p>
          <p><strong>Message data:</strong> Messages exchanged between donors and recipients through the platform.</p>
          <p><strong>Usage data:</strong> Basic interaction logs (claims, transfers, listings posted) used to calculate impact statistics and improve the platform.</p>
          <p><strong>Profile photos:</strong> If you upload a profile photo, it is stored securely in our cloud storage.</p>

          <h3 className="text-[14px] font-bold text-slate-800">2. How We Use Your Data</h3>
          <p>We use your data to: operate and improve the platform; connect donors with recipients; send notifications about your listings and claims; ensure platform security; calculate and display anonymous impact statistics; comply with legal obligations.</p>
          <p>We do <strong>not</strong> use your data for advertising. We do <strong>not</strong> sell your data to any third party. We do <strong>not</strong> share your data with partners without your consent.</p>

          <h3 className="text-[14px] font-bold text-slate-800">3. Data Storage & Security</h3>
          <p>All data is stored securely using Supabase, a SOC 2 Type II compliant database platform. Access is protected by Row Level Security (RLS) policies — meaning each user can only access their own data. Passwords are hashed and never stored in plain text. Authentication tokens are managed securely.</p>

          <h3 className="text-[14px] font-bold text-slate-800">4. Your Rights (GDPR / CCPA)</h3>
          <p>You have the right to: access all data we hold about you (use the "Download My Data" button in Settings); correct inaccurate information; delete your account and all associated data (use "Delete My Account" in Settings); withdraw consent at any time.</p>
          <p>For EU/EEA users, we act as the data controller under GDPR. For California residents, we comply with CCPA requirements.</p>

          <h3 className="text-[14px] font-bold text-slate-800">5. Cookies</h3>
          <p>We use minimal, essential cookies and local browser storage only to maintain your login session. We do not use tracking cookies or third-party analytics cookies.</p>

          <h3 className="text-[14px] font-bold text-slate-800">6. Data Retention</h3>
          <p>We retain your data for as long as your account is active. When you delete your account, your listings, messages, and notifications are deleted within 30 days. Some anonymized aggregate data (e.g. total transfers completed) may be retained for impact reporting.</p>

          <h3 className="text-[14px] font-bold text-slate-800">7. Third-Party Services</h3>
          <p>We use Supabase for database and authentication infrastructure. Their privacy policy applies to infrastructure-level data processing. We do not integrate with social media platforms, advertising networks, or data brokers.</p>

          <h3 className="text-[14px] font-bold text-slate-800">8. Children's Privacy</h3>
          <p>Eqovely is not directed at children under 13. We do not knowingly collect data from children under 13. If you believe a child has created an account, contact us immediately.</p>

          <h3 className="text-[14px] font-bold text-slate-800">9. Changes to This Policy</h3>
          <p>We may update this Privacy Policy as the platform grows. We will notify registered users of significant changes via the platform's notification system.</p>

          <h3 className="text-[14px] font-bold text-slate-800">10. Contact</h3>
          <p>Questions about your privacy? Contact the Eqovely team through the platform. Founded by Younus Abdulkadir.</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar({
  onDonate,
  onBrowse,
  onMission,
  onPartners,
  onImpact,
  onContact,
  user,
  onAuth,
  onSignOut,
  onInbox,
  onSettings,
  onOpenChat,
  allListings = [],
  unreadCount = 0,
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const navLink =
    "text-[15px] font-medium text-slate-700 hover:text-blue-600 transition-colors py-3 border-b border-slate-100 text-left";

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled || menuOpen
          ? "bg-white/95 backdrop-blur-xl shadow-sm border-b border-slate-100"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-md shadow-blue-200 text-white">
            <IconLink />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            Eqovely
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <button
            onClick={onMission}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Mission
          </button>
          <button
            onClick={onBrowse}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Browse
          </button>
          <button
            onClick={onPartners}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Partners
          </button>
          <button onClick={onImpact} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors">
            Impact
          </button>
          <button onClick={onContact} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors">
            Contact
          </button>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-[12px] text-slate-700 font-semibold truncate max-w-[160px]">
                  {user.username || user.org_name || user.email}
                </span>
                <span className="text-[10px] text-slate-400">
                  {user.account_type}
                </span>
              </div>
              <button
                onClick={onSignOut}
                className="text-[13px] font-medium text-slate-500 hover:text-slate-900 border border-slate-200 px-3 py-1.5 rounded-full transition-all"
              >
                Log Out
              </button>
              <NotificationBell
                user={user}
                onOpenChat={onOpenChat}
                listings={allListings}
              />
              {/* Inbox button with unread badge */}
              <button
                onClick={onInbox}
                className="relative flex items-center justify-center w-9 h-9 border border-slate-200 hover:border-blue-300 rounded-full transition-all bg-white hover:bg-blue-50"
                title="Messages"
              >
                <IconMsg />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {/* Settings button */}
              <button
                onClick={onSettings}
                className="flex items-center justify-center w-9 h-9 border border-slate-200 hover:border-slate-300 rounded-full transition-all bg-white hover:bg-slate-50"
                title="Settings"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-4 h-4 text-slate-500"
                >
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>
              <button
                onClick={onDonate}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium px-4 py-2 rounded-full transition-all shadow-md shadow-blue-200 hover:-translate-y-0.5"
                title={!user ? "Sign in to list surplus" : "List a new item"}
              >
                <IconPlus /> {user ? "List Surplus" : "Sign In to List"}
              </button>
            </>
          ) : (
            <button
              onClick={onAuth}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium px-4 py-2 rounded-full transition-all shadow-md shadow-blue-200 hover:-translate-y-0.5"
            >
              Sign In
            </button>
          )}
        </div>
        {/* Hamburger button — mobile only */}
        <button
          onClick={() => setMenuOpen((p) => !p)}
          className="md:hidden flex flex-col gap-1.5 p-2 rounded-lg hover:bg-slate-100 transition-all"
        >
          <span
            className={`block w-5 h-0.5 bg-slate-700 transition-all ${
              menuOpen ? "rotate-45 translate-y-2" : ""
            }`}
          />
          <span
            className={`block w-5 h-0.5 bg-slate-700 transition-all ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block w-5 h-0.5 bg-slate-700 transition-all ${
              menuOpen ? "-rotate-45 -translate-y-2" : ""
            }`}
          />
        </button>
      </div>
      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-6 py-4 flex flex-col">
          <button
            onClick={() => {
              onMission();
              setMenuOpen(false);
            }}
            className={navLink}
          >
            Mission
          </button>
          <button
            onClick={() => {
              onBrowse();
              setMenuOpen(false);
            }}
            className={navLink}
          >
            Browse
          </button>
          <button
            onClick={() => {
              onPartners();
              setMenuOpen(false);
            }}
            className={navLink}
          >
            Partners
          </button>
          <button onClick={() => { onImpact(); setMenuOpen(false); }} className={navLink}>
            Impact
          </button>
          <button onClick={() => { onContact(); setMenuOpen(false); }} className={navLink}>
            Contact
          </button>
          {user ? (
            <>
              <button
                onClick={() => {
                  onInbox();
                  setMenuOpen(false);
                }}
                className={navLink}
              >
                Messages{" "}
                {unreadCount > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  onSettings();
                  setMenuOpen(false);
                }}
                className={navLink}
              >
                Settings
              </button>
              <button
                onClick={() => {
                  onDonate();
                  setMenuOpen(false);
                }}
                className={navLink}
              >
                List Surplus
              </button>
              <button
                onClick={() => {
                  onSignOut();
                  setMenuOpen(false);
                }}
                className="text-[15px] font-medium text-red-500 hover:text-red-700 py-3 text-left"
              >
                Log Out
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                onAuth();
                setMenuOpen(false);
              }}
              className="mt-2 w-full bg-blue-600 text-white font-semibold py-3 rounded-xl"
            >
              Sign In
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

// ─── Password Reset Modal ─────────────────────────────────────────────────────
// Shown when a user clicks the reset link from their email. Supabase redirects
// back to the app with #access_token=...&type=recovery in the URL hash.
function PasswordResetModal({ token, onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const trapRef = useFocusTrap(true);
  const strength = getPasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (strength.score < 2) { setError("Password is too weak. Add numbers or symbols."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.message || "Failed to reset password.");
      setDone(true);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reset-pwd-title">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">
        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-8 h-8 text-green-600"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
            <h2 className="text-[20px] font-bold text-slate-900 mb-2">Password Updated!</h2>
            <p className="text-[13px] text-slate-500 mb-6">Your password has been reset. You can now sign in with your new password.</p>
            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">
              Sign In
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
              <span className="font-semibold text-slate-900">Eqovely</span>
            </div>
            <h2 id="reset-pwd-title" className="text-[22px] font-bold text-slate-900 mb-1">Set New Password</h2>
            <p className="text-[13px] text-slate-500 mb-5">Choose a strong password for your account.</p>
            {error && <div role="alert" className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">⚠ {error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-pwd" className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">New Password *</label>
                <div className="relative">
                  <input id="reset-pwd" type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500" aria-required="true" />
                  <button type="button" onClick={() => setShowPwd(s => !s)} aria-label={showPwd ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d={showPwd ? "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" : "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z"} strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
                {password && (
                  <div className="mt-2" aria-live="polite">
                    <div className="flex gap-1 mb-1">{[1,2,3,4].map(i => <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : "bg-slate-200"}`} />)}</div>
                    <p className="text-[11px] text-slate-500">Strength: <span className={`font-semibold ${strength.score <= 1 ? "text-red-500" : strength.score <= 2 ? "text-amber-500" : strength.score <= 3 ? "text-blue-500" : "text-green-600"}`}>{strength.label || "—"}</span></p>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="reset-confirm" className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Confirm Password *</label>
                <input id="reset-confirm" type={showPwd ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your password" autoComplete="new-password" required className={`w-full bg-slate-50 border rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 transition-all ${confirm && confirm !== password ? "border-red-400 focus:ring-red-400" : "border-slate-200 focus:ring-blue-500"}`} aria-required="true" />
                {confirm && confirm !== password && <p className="text-[11px] text-red-500 mt-1">⚠ Passwords don't match</p>}
              </div>
              <button type="submit" disabled={loading || !password || !confirm} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">
                {loading ? "Updating…" : "Set New Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Terms of Service Modal ───────────────────────────────────────────────────
function TermsModal({ onClose }) {
  const trapRef = useFocusTrap(true);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="tos-title">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="tos-title" className="text-[17px] font-bold text-slate-900">Terms of Service</h2>
          <button onClick={onClose} aria-label="Close Terms of Service" className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 text-[13px] text-slate-600 leading-relaxed space-y-4">
          <p className="text-[11px] text-slate-400">Last updated: {new Date().getFullYear()}</p>
          <p>Welcome to <strong>Eqovely</strong>. By creating an account, you agree to these Terms. Please read them carefully.</p>
          <h3 className="text-[14px] font-bold text-slate-800">1. About Eqovely</h3>
          <p>Eqovely is a nonprofit platform that connects individuals and organizations with surplus resources to those who need them. We facilitate listing, claiming, and transfer of surplus items at no cost.</p>
          <h3 className="text-[14px] font-bold text-slate-800">2. Eligibility</h3>
          <p>You must be at least 13 years old. Organizations must be registered legal entities. All information you provide must be accurate and truthful.</p>
          <h3 className="text-[14px] font-bold text-slate-800">3. Acceptable Use</h3>
          <p>You agree not to: post fraudulent or misleading listings; harass or harm other users; circumvent security measures; use the platform for commercial resale; list illegal items or controlled substances; impersonate others.</p>
          <h3 className="text-[14px] font-bold text-slate-800">4. Medical Supplies</h3>
          <p>By claiming medical supplies, you confirm your organization is qualified to receive and safely use them. Eqovely is not responsible for the condition or suitability of donated medical items.</p>
          <h3 className="text-[14px] font-bold text-slate-800">5. Transfer Responsibility</h3>
          <p>Eqovely facilitates connections but is not a party to any transfer. Donors and recipients are solely responsible for safe, legal handoffs. Always use the 6-digit PIN to verify every transfer.</p>
          <h3 className="text-[14px] font-bold text-slate-800">6. Account Termination</h3>
          <p>We reserve the right to suspend accounts that violate these terms. You may delete your account at any time from Settings.</p>
          <h3 className="text-[14px] font-bold text-slate-800">7. Limitation of Liability</h3>
          <p>Eqovely is provided "as is." We are not liable for damages arising from your use of the platform, item quality, or disputes between users.</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">I Understand</button>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
// ── Username sanitizer: alphanumeric + underscore, max 25 chars ──────────────
const sanitizeUsername = (val) =>
  val.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 25);

// ── Deep XSS sanitizer: escapes HTML and strips scripts ──────────────────────
const deepSanitize = (str) =>
  String(str || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim();
// deepSanitize intentionally preserves apostrophes and quotes for natural text

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot" | "forgot-sent"
  const [form, setForm] = useState({
    email: "", password: "", username: "", org_name: "", region: "",
    phone: "", dialCode: "+1", account_type: "", institution_domain: "", tax_id: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [isUsernameTaken, setIsUsernameTaken] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const usernameDebounce = useRef(null);
  const trapRef = useFocusTrap(true);

  const isRecipient = form.account_type === "School/Non-Profit Recipient";
  const taxIdCfg = getTaxIdConfig(form.dialCode);
  const pwdStrength = getPasswordStrength(form.password);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const checkUsername = (val) => {
    const clean = sanitizeUsername(val);
    if (!clean || clean.length < 3) { setIsUsernameTaken(false); return; }
    clearTimeout(usernameDebounce.current);
    usernameDebounce.current = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await fetch(
          `${SUPABASE_URL}/profiles?username=eq.${encodeURIComponent(clean)}&select=username&limit=1`,
          { headers: getHeaders() }
        );
        if (res.ok) {
          const data = await res.json();
          setIsUsernameTaken(Array.isArray(data) && data.length > 0 && data[0]?.username?.toLowerCase() === clean.toLowerCase());
        } else { setIsUsernameTaken(false); }
      } catch { setIsUsernameTaken(false); }
      finally { setCheckingUsername(false); }
    }, 500);
  };

  const validate = (f = form) => {
    const errs = {};
    if (mode === "signup") {
      if (!f.email) errs.email = "Email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errs.email = "Enter a valid email address.";
      if (f.email && isRecipient) {
        const domain = f.email.split("@")[1] || "";
        if (!INSTITUTIONAL_DOMAINS.test(domain)) errs.email = "Please use your official institutional or school email.";
      }
      if (!f.password) errs.password = "Password is required.";
      else if (f.password.length < 8) errs.password = "Password must be at least 8 characters.";
      else if (pwdStrength.score < 2) errs.password = "Password is too weak. Add numbers or symbols.";
      if (f.username && f.username.trim().length < 3) errs.username = "Username must be at least 3 characters.";
      if (f.username && /[^a-zA-Z0-9_]/.test(f.username)) errs.username = "Letters, numbers, and underscores only.";
      if (isUsernameTaken) errs.username = "This username is already taken.";
      if (f.phone && !validatePhone(f.dialCode, f.phone)) errs.phone = "Enter a valid phone number (7–15 digits).";
    }
    return errs;
  };

  const set = (e) => {
    let val = e.target.value;
    if (e.target.name === "username") { val = sanitizeUsername(val); checkUsername(val); }
    const updated = { ...form, [e.target.name]: val };
    setForm(updated);
    if (mode === "signup") setFieldErrors(validate(updated));
  };

  const signupComplete = (() => {
    if (mode !== "signup") return true;
    const base = form.email && form.password.length >= 8 && form.username.trim().length >= 3 && form.region && form.account_type;
    const orgRequired = ["Corporate/Lab Donor", "School/Non-Profit Recipient"].includes(form.account_type);
    const orgOk = !orgRequired || !!form.org_name.trim();
    const phoneOk = validatePhone(form.dialCode, form.phone);
    const taxRequired = taxIdCfg.required;
    const recipientOk = !isRecipient || (form.institution_domain && (!taxRequired || form.tax_id));
    const isIndividual = ["Individual Donor", "Individual Recipient"].includes(form.account_type);
    const agreementsOk = termsAgreed && privacyAgreed && (!isIndividual || ageConfirmed);
    const usernameOk = !isUsernameTaken && !checkingUsername && form.username.trim().length >= 3;
    return !!(base && orgOk && phoneOk && recipientOk && agreementsOk && usernameOk && Object.keys(validate()).length === 0);
  })();

  // ── Forgot Password ──────────────────────────────────────────────────────────
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setForgotLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: forgotEmail }),
      });
      // Always show success — never reveal if email exists (prevents enumeration)
      setMode("forgot-sent");
    } catch {
      // Same: always show success to prevent email enumeration
      setMode("forgot-sent");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); setError("Please fix the errors above."); return; }
    if (mode === "signup") {
      if (!form.username.trim()) { setError("Username cannot be empty."); return; }
      if (!termsAgreed || !privacyAgreed) { setError("Please agree to the Terms and Privacy Policy."); return; }
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        const DONOR_TYPES = ["Individual Donor", "Corporate/Lab Donor"];
        const isDonor = DONOR_TYPES.includes(form.account_type);
        const metadata = {
          username: deepSanitize(form.username.trim()),
          org_name: deepSanitize(form.org_name.trim()),
          phone: `${form.dialCode}${form.phone.replace(/[\s\-().]/g, "")}`,
          region: deepSanitize(form.region.trim()),
          account_type: form.account_type,
          institution_domain: deepSanitize(form.institution_domain.trim()),
          tax_id: deepSanitize(form.tax_id.trim()),
          avatar_url: "",
        };
        const res = await fetch(`${AUTH_URL}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ email: deepSanitize(form.email), password: form.password, data: metadata }),
        });
        const rawText = await res.text();
        let data = {};
        try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = {}; }
        if (!res.ok) throw new Error(data.msg || data.message || data.error_description || `Signup failed (${res.status}). Please try again.`);
        if (data.access_token) {
          localStorage.setItem("eq_token", data.access_token);
          if (data.refresh_token) localStorage.setItem("eq_refresh_token", data.refresh_token);
          const m = data.user?.user_metadata || {};
          const u = { id: data.user.id, email: data.user.email, ...metadata };
          localStorage.setItem("eq_user", JSON.stringify(u));
          if (onSuccess) onSuccess(u);
        } else {
          // Email confirmation required
          setMode("login");
          setError(null);
          setForm(f => ({ ...f, password: "" }));
          // Show friendly confirmation message
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("eq:toast", { detail: { message: "Account created! Check your email to confirm before signing in.", type: "success" } }));
          }, 200);
        }
      } else {
        const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ email: deepSanitize(form.email), password: form.password }),
        });
        const rawLoginText = await res.text();
        let data = {};
        try { data = rawLoginText ? JSON.parse(rawLoginText) : {}; } catch { data = {}; }
        if (!res.ok) throw new Error("Email or password is incorrect. Please try again.");
        if (!data.access_token) throw new Error("Login failed. Please try again.");
        // Check email confirmation
        if (data.user?.email_confirmed_at === null || data.user?.confirmed_at === null) {
          throw new Error("Please confirm your email address before signing in. Check your inbox for a confirmation link.");
        }
        localStorage.setItem("eq_token", data.access_token);
        if (data.refresh_token) localStorage.setItem("eq_refresh_token", data.refresh_token);
        const m = data.user?.user_metadata || {};
        let storedUser = {};
        try { storedUser = JSON.parse(localStorage.getItem("eq_user") || "{}"); } catch {}
        const u = {
          id: data.user.id, email: data.user.email,
          username: m.username || storedUser.username || "",
          phone: m.phone || storedUser.phone || "",
          org_name: m.org_name || storedUser.org_name || "",
          region: m.region || storedUser.region || "",
          account_type: m.account_type || storedUser.account_type || "",
          institution_domain: m.institution_domain || storedUser.institution_domain || "",
          tax_id: m.tax_id || storedUser.tax_id || "",
          avatar_url: m.avatar_url || storedUser.avatar_url || "",
        };
        localStorage.setItem("eq_user", JSON.stringify(u));
        if (onSuccess) onSuccess(u);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inp = (field) => {
    const hasErr = fieldErrors[field] || (field === "username" && isUsernameTaken);
    return `w-full bg-slate-50 border rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${hasErr ? "border-red-400 focus:ring-red-400" : "border-slate-200 focus:ring-blue-500"}`;
  };
  const lbl = "block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide";
  const fErr = (f) => fieldErrors[f] ? (
    <p role="alert" id={`err-${f}`} className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
      <span aria-hidden="true">⚠</span> {fieldErrors[f]}
    </p>
  ) : null;

  const modalTitle = mode === "login" ? "Welcome back" : mode === "signup" ? "Join Eqovely" : mode === "forgot" ? "Reset your password" : "Check your email";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
      {showPrivacy && <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 max-h-[92vh] overflow-y-auto">
        <button onClick={onClose} aria-label="Close sign in dialog" className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500">
          <IconX />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white" aria-hidden="true"><IconLink /></div>
          <span className="font-semibold text-slate-900">Eqovely</span>
        </div>

        <h2 id="auth-modal-title" className="text-2xl font-bold text-slate-900 mb-1">{modalTitle}</h2>

        {/* Forgot password — sent */}
        {mode === "forgot-sent" && (
          <div className="py-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-blue-600"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
            <p className="text-[14px] text-slate-600 text-center leading-relaxed mb-6">
              If an account exists for <strong>{forgotEmail}</strong>, you'll receive a password reset link shortly. Check your spam folder if you don't see it.
            </p>
            <button onClick={() => { setMode("login"); setError(null); }} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all text-[14px]">
              Back to Sign In
            </button>
          </div>
        )}

        {/* Forgot password — form */}
        {mode === "forgot" && (
          <div>
            <p className="text-[13px] text-slate-500 mb-5">Enter your email and we'll send you a link to reset your password.</p>
            {error && <div role="alert" className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3"><span className="text-red-500 shrink-0" aria-hidden="true">⚠</span><p className="text-[13px] text-red-700">{error}</p></div>}
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className={lbl}>Email address *</label>
                <input id="forgot-email" type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" className={inp("email")} aria-required="true" />
              </div>
              <button type="submit" disabled={forgotLoading} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 rounded-xl transition-all text-[14px]">
                {forgotLoading ? <><IconLoader /> Sending…</> : "Send Reset Link"}
              </button>
              <button type="button" onClick={() => { setMode("login"); setError(null); }} className="w-full text-[13px] text-slate-500 hover:text-slate-700 py-2 transition-all">
                ← Back to Sign In
              </button>
            </form>
          </div>
        )}

        {/* Login / Signup */}
        {(mode === "login" || mode === "signup") && (
          <>
            <p className="text-[13px] text-slate-500 mb-5">
              {mode === "login" ? "Sign in to access the global marketplace." : "Create your account to list and claim surplus worldwide."}
            </p>
            <div className="flex bg-slate-100 rounded-xl p-1 mb-5" role="tablist">
              {["login", "signup"].map((m) => (
                <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); setFieldErrors({}); }}
                  className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {m === "login" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>

            {error && <div role="alert" className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3"><span className="text-red-500 shrink-0" aria-hidden="true">⚠</span><p className="text-[13px] text-red-700">{error}</p></div>}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {mode === "signup" && (
                <div>
                  <label htmlFor="auth-username" className={lbl}>Username * <span className="text-slate-400 font-normal normal-case">(max 25 chars)</span></label>
                  <div className="relative">
                    <input id="auth-username" name="username" value={form.username} onChange={set} placeholder="e.g. younus_a" className={inp("username") + " pr-8"} maxLength={25} autoComplete="username" aria-required="true" aria-describedby={fieldErrors.username ? "err-username" : undefined} aria-invalid={!!fieldErrors.username} />
                    {checkingUsername && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true"><IconLoader /></span>}
                    {!checkingUsername && form.username.length >= 3 && !isUsernameTaken && !fieldErrors.username && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 text-[12px] font-bold" aria-hidden="true">✓</span>}
                  </div>
                  {fErr("username")}
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className={lbl}>Email *</label>
                <input id="auth-email" name="email" type="email" value={form.email} onChange={set} placeholder="you@example.com" required autoComplete="email" className={inp("email")} aria-required="true" aria-describedby={fieldErrors.email ? "err-email" : undefined} aria-invalid={!!fieldErrors.email} />
                {fErr("email")}
                {mode === "signup" && !fieldErrors.email && <p className="text-[11px] text-slate-400 mt-1.5">A confirmation email will be sent — click the link to activate your account.</p>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="auth-password" className={lbl} style={{marginBottom:0}}>Password *</label>
                  {mode === "login" && <button type="button" onClick={() => { setMode("forgot"); setForgotEmail(form.email); setError(null); }} className="text-[11px] text-blue-600 hover:text-blue-700 font-medium focus:outline-none focus:underline">Forgot password?</button>}
                </div>
                <div className="relative">
                  <input id="auth-password" name="password" type={showPassword ? "text" : "password"} value={form.password} onChange={set} placeholder={mode === "signup" ? "Min. 8 characters" : "Your password"} required autoComplete={mode === "signup" ? "new-password" : "current-password"} className={inp("password") + " pr-10"} aria-required="true" aria-describedby={fieldErrors.password ? "err-password" : mode === "signup" ? "pwd-strength" : undefined} aria-invalid={!!fieldErrors.password} />
                  <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-blue-500">
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
                {mode === "signup" && form.password && (
                  <div id="pwd-strength" className="mt-2" aria-live="polite">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= pwdStrength.score ? pwdStrength.color : "bg-slate-200"}`} />
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500">Password strength: <span className={`font-semibold ${pwdStrength.score <= 1 ? "text-red-500" : pwdStrength.score <= 2 ? "text-amber-500" : pwdStrength.score <= 3 ? "text-blue-500" : "text-green-600"}`}>{pwdStrength.label || "—"}</span></p>
                  </div>
                )}
                {fErr("password")}
              </div>

              {mode === "signup" && (
                <>
                  <div>
                    <label htmlFor="auth-account-type" className={lbl}>Account Type *</label>
                    <select id="auth-account-type" name="account_type" value={form.account_type} onChange={set} required className={inp("account_type")} aria-required="true">
                      <option value="">Select your role</option>
                      {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {["Corporate/Lab Donor","School/Non-Profit Recipient"].includes(form.account_type) && (
                    <div>
                      <label htmlFor="auth-org-name" className={lbl}>Organization Name *</label>
                      <input id="auth-org-name" name="org_name" value={form.org_name} onChange={set} placeholder="e.g. Acme Corp / Lincoln High School" className={inp("org_name")} aria-required="true" />
                    </div>
                  )}
                  <div>
                    <label htmlFor="auth-region" className={lbl}>Region / Country *</label>
                    <input id="auth-region" name="region" value={form.region} onChange={set} placeholder="e.g. United States, United Kingdom" className={inp("region")} aria-required="true" />
                  </div>
                  <div>
                    <label htmlFor="auth-phone" className={lbl}>Phone Number *</label>
                    <div className="flex gap-2">
                      <select value={form.dialCode} onChange={e => setForm(f => ({...f, dialCode: e.target.value}))} className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 w-24 shrink-0" aria-label="Country dial code">
                        {COUNTRY_CODES.map(c => <option key={c.code + c.country} value={c.code}>{c.flag} {c.code}</option>)}
                      </select>
                      <input id="auth-phone" name="phone" type="tel" value={form.phone} onChange={set} placeholder="Phone number" className={inp("phone")} aria-required="true" aria-describedby={fieldErrors.phone ? "err-phone" : undefined} aria-invalid={!!fieldErrors.phone} />
                    </div>
                    {fErr("phone")}
                  </div>
                  {isRecipient && (
                    <>
                      <div>
                        <label htmlFor="auth-institution" className={lbl}>Institution Website *</label>
                        <input id="auth-institution" name="institution_domain" value={form.institution_domain} onChange={set} placeholder="e.g. lincoln.edu" className={inp("institution_domain")} aria-required="true" />
                      </div>
                      {taxIdCfg.show && (
                        <div>
                          <label htmlFor="auth-tax-id" className={lbl}>{taxIdCfg.label} {taxIdCfg.required ? "*" : "(optional)"}</label>
                          <input id="auth-tax-id" name="tax_id" value={form.tax_id} onChange={set} placeholder={taxIdCfg.placeholder} className={inp("tax_id")} aria-required={taxIdCfg.required} />
                        </div>
                      )}
                    </>
                  )}
                  <div className="space-y-2 pt-1">
                    {[
                      { id: "terms", checked: termsAgreed, set: setTermsAgreed, label: <>I agree to the <button type="button" onClick={() => setShowTerms(true)} className="text-blue-600 underline hover:text-blue-700 focus:outline-none">Terms of Service</button></> },
                      { id: "privacy", checked: privacyAgreed, set: setPrivacyAgreed, label: <>I agree to the <button type="button" onClick={() => setShowPrivacy(true)} className="text-blue-600 underline hover:text-blue-700 focus:outline-none">Privacy Policy</button></> },
                      ...( ["Individual Donor","Individual Recipient"].includes(form.account_type) ? [{ id: "age", checked: ageConfirmed, set: setAgeConfirmed, label: "I confirm I am 13 years of age or older" }] : []),
                    ].map(({ id, checked, set: setter, label }) => (
                      <label key={id} className="flex items-start gap-2.5 cursor-pointer group">
                        <input type="checkbox" id={`check-${id}`} checked={checked} onChange={e => setter(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-2 shrink-0" />
                        <span className="text-[12px] text-slate-600 leading-snug">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 text-center">Your data is protected under our Privacy Policy. We never sell your information.</p>
                </>
              )}

              <button type="submit" disabled={loading || (mode === "signup" && !signupComplete)} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                {loading ? <><IconLoader /> {mode === "login" ? "Signing in…" : "Creating account…"}</> : <><IconCheck /> {mode === "login" ? "Sign In" : "Create Account"}</>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// KEY B — Donor (owner) view only. Rendered exclusively when auth.uid === owner_id.
// Contains the input field, validation, and handleHandshakeVerify submission.
function OwnerVerifyModal({ listing, user, onVerified, onClose, fetchPin }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [realPin, setRealPin] = useState(listing.verification_pin ?? null);
  const [pinLoading, setPinLoading] = useState(false);

  // Fetch the real PIN on mount — listing object may not have it if stripped from public fetch
  useEffect(() => {
    if (fetchPin && (realPin === null || realPin === undefined)) {
      setPinLoading(true);
      fetchPin().then(p => {
        if (p !== null) setRealPin(p);
        setPinLoading(false);
      });
    }
  }, []);

  // ── Security gate: only render submission logic if session owner matches ──
  const isAuthorizedOwner =
    user && user.email && listing.owner_email &&
    user.email.toLowerCase() === listing.owner_email.toLowerCase();

  // ── handleHandshakeVerify: dual-key validation loop ───────────────────────
  const [attempts, setAttempts] = useState(0);
  const MAX_ATTEMPTS = 3;

  const handleHandshakeVerify = async () => {
    if (!isAuthorizedOwner) {
      setError(
        "Security violation: your session does not match the listing owner."
      );
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      setError(
        "Too many incorrect attempts. Please contact the claimer to resend their PIN."
      );
      return;
    }
    if (realPin === null || realPin === undefined) {
      setError("Could not load PIN. Please close and try again.");
      return;
    }
    if (input.trim() !== String(realPin)) {
      const remaining = MAX_ATTEMPTS - attempts - 1;
      setAttempts((a) => a + 1);
      setError(
        remaining > 0
          ? `Incorrect PIN. ${remaining} attempt${
              remaining !== 1 ? "s" : ""
            } remaining.`
          : "Too many incorrect attempts. Transfer locked."
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Mark as transferred — the row is KEPT (not deleted). Deleting it used
      // to wipe out the history that "Items Claimed", "Units Transferred",
      // and the Impact report all depend on. It's hidden from active
      // marketplace browsing separately, but stays in the database for stats.
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: getHeaders(getToken()),
        body: JSON.stringify({ status: "transferred" }),
      });
      if (!res.ok) throw new Error("Could not complete the transfer. Please try again.");
      setSuccess(true);
      createNotification(
        listing.claimer_id,
        "transfer",
        `Transfer of "${listing.title}" is complete. Thank you for using Eqovely!`,
        listing.id
      );
      setTimeout(() => {
        onVerified(listing.id);
        onClose();
      }, 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Show loading while fetching PIN ────────────────────────────────────────
  if (pinLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-3">
          <IconLoader />
          <p className="text-[14px] text-slate-500">Loading verification…</p>
        </div>
      </div>
    );
  }

  // ── If not the owner, render blocked state — no inputs exposed ────────────
  if (!isAuthorizedOwner) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <IconX />
          </button>
          <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-red-500">
            <IconShield />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">
            Access Restricted
          </h3>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Key B verification is only available to the original listing owner.
            Your session does not have authorization to complete this handshake.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
        >
          <IconX />
        </button>

        {/* Donor identity confirmed badge */}
        <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-3 py-1 mb-5">
          <IconCheck />
          <span className="text-[11px] font-semibold text-green-700">
            Donor Identity Verified — Key B Active
          </span>
        </div>

        <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mb-4 text-blue-600">
          <IconShield />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-1">
          Authorize Transfer
        </h3>
        <p className="text-[13px] text-slate-500 mb-5">
          Ask the recipient to show their Key A PIN. Enter it below to finalize
          the transfer of
          <strong>{listing.title}</strong>.
        </p>

        <p className="text-[11px] text-slate-500 text-center mb-3">
          Enter the recipient's 6-digit PIN below
        </p>

        {success ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3 text-white">
              <IconCheck />
            </div>
            <p className="text-[14px] font-bold text-green-800">
              Transfer Complete!
            </p>
            <p className="text-[12px] text-green-600 mt-1">
              Listing status updated to Transferred.
            </p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
                {error}
              </div>
            )}
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={input}
              onChange={(e) => {
                setInput(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              placeholder="— — — — — —"
              className="w-full text-center text-3xl font-bold tracking-[0.4em] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <button
              onClick={handleHandshakeVerify}
              disabled={loading || input.length < 6}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-[14px] shadow-lg shadow-blue-200 hover:-translate-y-0.5 disabled:translate-y-0"
            >
              {loading ? (
                <>
                  <IconLoader /> Verifying…
                </>
              ) : (
                <>
                  <IconShield /> Authorize Handshake
                </>
              )}
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-3">
              Both keys must match to complete the transfer. This action is
              irreversible.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ user, onClose, onUpdated, onDeleted }) {
  const [tab, setTab] = useState("profile");
  const [username, setUsername] = useState(user?.username || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  const saveProfile = async () => {
    if (!username.trim()) {
      setError("Username cannot be empty.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${AUTH_URL}/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ data: {
          username: username.trim(),
          account_type: user?.account_type || "",
          phone: user?.phone || "",
          region: user?.region || "",
          org_name: user?.org_name || "",
          email: user?.email || "",
          institution_domain: user?.institution_domain || "",
          tax_id: user?.tax_id || "",
        } }),
      });
      if (!res.ok) throw new Error("Failed to update profile.");
      const updated = { ...user, username: username.trim() };
      localStorage.setItem("eq_user", JSON.stringify(updated));
      onUpdated(updated);
      setSuccess("Username updated successfully!");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setError("");
    try {
      // Sign out and clear — actual deletion requires admin API
      localStorage.removeItem("eq_token");
      localStorage.removeItem("eq_user");
      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-[17px] font-bold text-slate-900">Settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-all"
          >
            <IconX />
          </button>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {["profile", "account"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-[13px] font-medium transition-all ${
                tab === t
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "profile" ? "Profile" : "Account"}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === "profile" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Username
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your username"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-slate-700">Email:</span>{" "}
                  {user?.email}
                </p>
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-slate-700">
                    Account Type:
                  </span>{" "}
                  {user?.account_type}
                </p>
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-slate-700">Region:</span>{" "}
                  {user?.region || "Not set"}
                </p>
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-slate-700">Phone:</span>{" "}
                  {user?.phone || "Not set"}
                </p>
              </div>
              {error && <p className="text-[12px] text-red-500">{error}</p>}
              {success && (
                <p className="text-[12px] text-green-600">{success}</p>
              )}
              <button
                onClick={saveProfile}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all text-[14px]"
              >
                {saving ? (
                  <>
                    <IconLoader /> Saving…
                  </>
                ) : (
                  <>
                    <IconCheck /> Save Changes
                  </>
                )}
              </button>
            </div>
          )}
          {tab === "account" && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <h3 className="text-[14px] font-bold text-red-800 mb-1">
                  Delete Account
                </h3>
                <p className="text-[12px] text-red-600 leading-relaxed mb-4">
                  This will permanently delete your account and all your
                  listings. This action cannot be undone.
                </p>
                {!confirmDel ? (
                  <button
                    onClick={() => setConfirmDel(true)}
                    className="w-full py-2.5 text-[13px] font-semibold text-red-600 border border-red-300 hover:bg-red-100 rounded-xl transition-all"
                  >
                    Delete My Account
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[12px] text-red-700 font-semibold text-center">
                      Are you absolutely sure?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDel(false)}
                        className="flex-1 py-2.5 text-[13px] font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={deleteAccount}
                        disabled={deleting}
                        className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all"
                      >
                        {deleting ? "Deleting…" : "Yes, Delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {error && <p className="text-[12px] text-red-500">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inbox Modal ─────────────────────────────────────────────────────────────
function InboxModal({ user, onClose, onOpenChat, allListings, inline, autoOpenListing, onAutoOpenHandled }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeListing, setActiveListing] = useState(null);

  useEffect(() => {
    if (user) markMessagesRead(user.email);
    fetchThreads();
  }, [user]);

  // Auto-open a listing chat when navigating from a listing card
  useEffect(() => {
    if (autoOpenListing && !activeListing) {
      setActiveListing({ ...autoOpenListing, _otherName: autoOpenListing.owner_org_name || autoOpenListing.owner_email || "Donor" });
      if (onAutoOpenHandled) onAutoOpenHandled();
    }
  }, [autoOpenListing]);

  const fetchThreads = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/messages?or=(sender_email.eq.${encodeURIComponent(user.email)},receiver_id.eq.${encodeURIComponent(user.email)},receiver_id.eq.${encodeURIComponent(user.id || "")})&order=created_at.desc&select=*&limit=300`,
        { headers: getHeaders(getToken()) }
      );
      if (!res.ok) return;
      const msgs = await res.json();
      if (!Array.isArray(msgs)) return;
      const grouped = {};
      msgs.forEach((m) => {
        const lid = String(m.listing_id);
        if (!grouped[lid]) grouped[lid] = [];
        grouped[lid].push(m);
      });
      const threadList = Object.entries(grouped).map(([lid, messages]) => {
        const last = messages[0];
        const otherEmail = last?.sender_email === user.email
          ? last?.receiver_id
          : last?.sender_email;
        const otherName = messages.find(m => m.sender_email !== user.email)?.sender_name || otherEmail || "User";
        // unread = true/false per conversation — not a message count.
        // The badge shows how many conversations have unread, not how many messages.
        const hasUnread = messages.some(m => m.sender_email !== user.email && !m.read_by?.includes(user.email));
        const listing = (allListings || []).find(l => String(l.id) === lid);
        return { listing_id: lid, last, unread: hasUnread ? 1 : 0, listing, otherName, otherEmail };
      });
      setThreads(threadList);
    } catch (_) {}
    finally { setLoading(false); }
  };

  const initials = (name) => (name || "U").slice(0, 2).toUpperCase();
  const avatarColor = (name) => {
    const colors = ["bg-blue-500","bg-purple-500","bg-green-500","bg-amber-500","bg-rose-500","bg-teal-500"];
    return colors[(name || "U").charCodeAt(0) % colors.length];
  };

  // ── If a listing is selected, show inline full chat ──
  if (activeListing) {
    const otherName = activeListing._otherName || "User";
    const otherInitials = otherName.slice(0,2).toUpperCase();
    const otherColor = ["bg-purple-500","bg-green-500","bg-amber-500","bg-rose-500","bg-teal-500","bg-indigo-500"][otherName.charCodeAt(0) % 6];
    return (
      <div className="flex flex-col h-full min-h-0 flex-1">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
          <button onClick={() => setActiveListing(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className={`w-9 h-9 rounded-full ${otherColor} flex items-center justify-center text-white font-bold text-[13px] shrink-0`}>
            {otherInitials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-slate-900 truncate">{otherName}</p>
            <p className="text-[11px] text-slate-400 truncate">{activeListing.title}</p>
          </div>
          {/* Current user's own photo in the top-right of the header */}
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="You" className="w-8 h-8 rounded-full object-cover border-2 border-blue-100 shrink-0" title={user?.username || "You"} />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[11px] shrink-0" title={user?.username || "You"}>
              {(user?.username || user?.email || "U").slice(0,2).toUpperCase()}
            </div>
          )}
        </div>
        {/* Inline chat body */}
        <InlineChatBody listing={activeListing} user={user} />
      </div>
    );
  }

  // ── Thread list ──
  const content = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-100 shrink-0 flex items-center justify-between">
        <h2 className="text-[18px] font-bold text-slate-900">Messages</h2>
        {!inline && <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"><IconX /></button>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            {[1,2,3].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-12 h-12 bg-slate-100 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-100 rounded-full w-1/2" />
                  <div className="h-3 bg-slate-100 rounded-full w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-400"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-[15px] font-semibold text-slate-700 mb-1">No messages yet</p>
            <p className="text-[13px] text-slate-400">Open a listing and tap Message to start a conversation</p>
          </div>
        ) : (
          <div>
            {threads.map(({ listing_id, last, unread, listing, otherName }) => {
              const tColor = ["bg-purple-500","bg-green-500","bg-amber-500","bg-rose-500","bg-teal-500","bg-indigo-500"][(otherName||"U").charCodeAt(0) % 6];
              return (
                <button
                  key={listing_id}
                  onClick={() => {
                    const l = listing
                      ? { ...listing, _otherName: otherName }
                      : { id: listing_id, title: last?.topic || "Conversation", owner_email: last?.receiver_id || "", _otherName: otherName };
                    setActiveListing(l);
                  }}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-50 text-left"
                >
                  <div className={`w-12 h-12 rounded-full ${tColor} flex items-center justify-center text-white font-bold text-[15px] shrink-0`}>
                    {(otherName||"U").slice(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className={`text-[14px] truncate ${unread > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>
                        {otherName}
                      </p>
                      <p className="text-[11px] text-slate-400 shrink-0">{timeAgo(last?.created_at)}</p>
                    </div>
                    <p className={`text-[13px] truncate ${unread > 0 ? "font-semibold text-slate-800" : "text-slate-400"}`}>
                      {last?.sender_email === user.email ? (
                        <span className="flex items-center gap-1">
                          {user?.avatar_url
                            ? <img src={user.avatar_url} className="w-4 h-4 rounded-full object-cover inline shrink-0" alt="" />
                            : null}
                          You: {last?.message_text || ""}
                        </span>
                      ) : last?.message_text || ""}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{listing?.title || "Listing"}</p>
                  </div>
                  {unread > 0 && (
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl h-[80vh] flex flex-col overflow-hidden">
        {content}
      </div>
    </div>
  );
}

// ─── Inline Chat Body (used inside InboxModal when a thread is open) ──────────
function InlineChatBody({ listing, user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const isMounted = useRef(true);
  const pollRef = useRef(null);

  useEffect(() => {
    isMounted.current = true;
    fetchMsgs();
    pollRef.current = setInterval(fetchMsgs, 5000);
    return () => {
      isMounted.current = false;
      clearInterval(pollRef.current);
    };
  }, [listing?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const fetchMsgs = async () => {
    if (!listing?.id || !isMounted.current) return;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/messages?listing_id=eq.${encodeURIComponent(String(listing.id))}&order=created_at.asc&select=*&limit=200`,
        { headers: getHeaders(getToken()) }
      );
      if (!res.ok || !isMounted.current) return;
      const data = await res.json();
      if (Array.isArray(data) && isMounted.current) {
        // Drop all temp messages when fresh server data arrives.
        // send() now adds the real saved record directly, so no temp should
        // survive. Any that do are stale ghosts — clear them.
        setMessages(data);
        // Mark received messages as read
        const unread = data.filter(m => m.sender_email !== user?.email && !(m.read_by || []).includes(user?.email));
        unread.forEach(m => {
          fetch(`${SUPABASE_URL}/messages?id=eq.${m.id}`, {
            method: "PATCH",
            headers: getHeaders(getToken()),
            body: JSON.stringify({ read_by: [...(m.read_by || []), user.email] }),
          }).catch(() => {});
        });
      }
    } catch (_) {}
    finally { if (isMounted.current) setLoading(false); }
  };

  const send = async () => {
    if (!user || !input.trim()) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    const senderName = user.username || user.org_name || user.email || "User";
    const senderEmail = user.email || "";
    const senderId = user.id || senderEmail;
    const isOwner = listing.owner_email === user.email;
    let receiverId = "";
    if (!isOwner) {
      receiverId = listing.owner_email || "";
    } else {
      const otherMsg = [...messages].reverse().find(m => m.sender_email && m.sender_email !== user.email);
      receiverId = otherMsg?.sender_email || otherMsg?.sender_id || senderId;
    }
    try {
      const h = getHeaders(getToken());
      h["Prefer"] = "return=representation";
      const res = await fetch(SUPABASE_URL + "/messages", {
        method: "POST", headers: h,
        body: JSON.stringify({
          listing_id: String(listing.id),
          sender_id: String(senderId),
          sender_email: String(senderEmail),
          sender_name: String(senderName),
          sender_avatar_url: String(user?.avatar_url || ""),
          receiver_id: String(receiverId),
          message_text: String(text),
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        const savedMsg = Array.isArray(saved) ? saved[0] : saved;
        if (savedMsg?.id) {
          // Add the real saved record directly — no temp message, no dedup needed,
          // no race with polling. The polling's fetchMsgs will see it by ID and skip it.
          setMessages(prev => {
            if (prev.some(m => String(m.id) === String(savedMsg.id))) return prev;
            return [...prev, savedMsg];
          });
        } else {
          // Supabase didn't return representation — fall back to a fresh fetch
          if (isMounted.current) fetchMsgs();
        }
      } else {
        const e = await res.json().catch(() => ({}));
        console.error("MSG ERROR:", res.status, e);
        setInput(text); // Restore so user can retry
      }
    } catch (err) {
      console.error("MSG SEND:", err.message);
      setInput(text);
    }
    finally { setSending(false); }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-50 h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-10"><IconLoader /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-14 h-14 bg-white border border-slate-100 rounded-full flex items-center justify-center mb-3 shadow-sm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-slate-300"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-[14px] font-semibold text-slate-600">Start the conversation</p>
            <p className="text-[12px] text-slate-400 mt-1">Say hello to get things started</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.sender_email === user?.email || msg.sender_id === user?.id || msg.sender_id === user?.email;
            const isTemp = String(msg.id).startsWith("temp-");
            const prevMsg = messages[idx - 1];
            const sameSenderAsPrev = prevMsg && (prevMsg.sender_email === msg.sender_email);

            // Avatar for this message
            const senderName = msg.sender_name || msg.sender_email || "User";
            const avatarColors = ["bg-purple-500","bg-green-500","bg-amber-500","bg-rose-500","bg-teal-500","bg-indigo-500"];
            const otherAvatarColor = avatarColors[(senderName).charCodeAt(0) % avatarColors.length];
            const myAvatarUrl = user?.avatar_url;
            const otherAvatarUrl = msg.sender_avatar_url || "";
            const myInitials = (user?.username || user?.org_name || user?.email || "U").slice(0,2).toUpperCase();
            const otherInitials = senderName.slice(0,2).toUpperCase();

            return (
              <div key={msg.id} className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : "flex-row"} ${sameSenderAsPrev ? "mt-0.5" : "mt-3"}`}>
                {/* Avatar — always visible, hidden when same sender as previous */}
                <div className="shrink-0 w-8 h-8">
                  {!sameSenderAsPrev && (
                    isMe ? (
                      myAvatarUrl
                        ? <img src={myAvatarUrl} alt="You" className="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-sm" />
                        : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[11px] shadow-sm">{myInitials}</div>
                    ) : (
                      otherAvatarUrl
                        ? <img src={otherAvatarUrl} alt={senderName} className="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-sm" />
                        : <div className={`w-8 h-8 rounded-full ${otherAvatarColor} flex items-center justify-center text-white font-bold text-[11px] shadow-sm`}>{otherInitials}</div>
                    )
                  )}
                </div>

                {/* Bubble + name */}
                <div className={`flex flex-col max-w-[72%] ${isMe ? "items-end" : "items-start"}`}>
                  {!sameSenderAsPrev && (
                    <p className={`text-[11px] font-semibold mb-1 px-1 ${isMe ? "text-blue-400 text-right" : "text-slate-500"}`}>
                      {isMe ? (user?.username || user?.org_name || "You") : senderName}
                    </p>
                  )}
                  <div className={`px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed ${
                    isMe
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-white border border-slate-100 text-slate-800 rounded-bl-sm shadow-sm"
                  } ${isTemp ? "opacity-60" : ""}`}>
                    <p className="break-words whitespace-pre-wrap">{msg.message_text || msg.body || msg.text || ""}</p>
                    <div className={`flex items-center gap-1 mt-1 ${isMe ? "justify-end" : "justify-start"}`}>
                      <p className={`text-[10px] ${isMe ? "text-blue-200" : "text-slate-400"}`}>
                        {isTemp ? "sending…" : new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {isMe && !isTemp && (
                        <span className="text-[11px] leading-none">
                          {msg.read_by && msg.read_by.length > 0
                            ? <span className="text-blue-300" title="Seen">✓✓</span>
                            : <span className="text-blue-200" title="Delivered">✓</span>}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      {/* Input bar */}
      <div className="px-4 py-3 bg-white border-t border-slate-100 flex items-end gap-2 shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Message…"
          className="flex-1 text-[14px] bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-800 placeholder-slate-400 max-h-32"
          style={{ overflowY: "auto" }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-10 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 text-white rounded-2xl transition-all shrink-0"
        >
          {sending ? <IconLoader /> : <IconSend />}
        </button>
      </div>
    </div>
  );
}

// ─── Photo Lightbox ───────────────────────────────────────────────────────────
function PhotoLightbox({ images, startIdx, onClose }) {
  const [idx, setIdx] = useState(startIdx || 0);
  const touchStartX = useRef(null);

  const prev = useCallback(
    () => setIdx((p) => (p - 1 + images.length) % images.length),
    [images.length]
  );
  const next = useCallback(
    () => setIdx((p) => (p + 1) % images.length),
    [images.length]
  );

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [next, prev]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const diff = touchStartX.current - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 50) {
          diff > 0 ? next() : prev();
        }
        touchStartX.current = null;
      }}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center z-10"
      >
        <IconX />
      </button>
      {/* Counter */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 text-white text-[12px] font-medium px-3 py-1 rounded-full">
        {idx + 1} / {images.length}
      </div>
      {/* Left arrow */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center z-10"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="w-5 h-5"
          >
            <path
              d="M15 18l-6-6 6-6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {/* Image — no transition class so switching is instant */}
      <img
        key={idx}
        src={images[idx]}
        alt={`Photo ${idx + 1}`}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
      />
      {/* Right arrow */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/25 text-white rounded-full flex items-center justify-center z-10"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="w-5 h-5"
          >
            <path
              d="M9 18l6-6-6-6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {/* Dot indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setIdx(i);
              }}
              className={`w-2 h-2 rounded-full ${
                i === idx ? "bg-white scale-125" : "bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Impact Certificate Modal ─────────────────────────────────────────────────
function CertificateModal({ listing, onClose }) {
  const date = new Date(listing.updated_at || Date.now()).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );
  const eWaste =
    (EWASTE_WEIGHTS[listing.category] || 3) * (listing.quantity || 1);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 px-8 py-8 text-white text-center">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <IconAward />
          </div>
          <p className="text-blue-200 text-[11px] font-semibold tracking-widest uppercase mb-1">
            Eqovely Impact Certificate
          </p>
          <h2 className="text-2xl font-bold">Resource Transfer Verified</h2>
          <p className="text-blue-200 text-[13px] mt-1">{date}</p>
        </div>
        <div className="px-8 py-7">
          <p className="text-center text-[13px] text-slate-500 mb-5">
            This certifies the successful eco-friendly reallocation of:
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 mb-5 text-center">
            <h3 className="text-xl font-bold text-slate-900">
              {listing.title}
            </h3>
            {listing.organization && (
              <p className="text-[13px] text-slate-500 mt-0.5">
                via {listing.organization}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: "Items Transferred", value: listing.quantity || 1 },
              { label: "E-Waste Diverted", value: `${eWaste} lbs` },
              { label: "Category", value: listing.category || "General" },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center"
              >
                <div className="text-[15px] font-bold text-blue-700">
                  {value}
                </div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-[12px] text-slate-400 italic mb-5">
            "Every surplus item rehomed is a step toward a more equitable
            world." — Eqovely
          </p>
          <button
            onClick={onClose}
            className="w-full bg-slate-900 hover:bg-slate-700 text-white font-semibold py-3 rounded-xl transition-all text-[14px]"
          >
            Close Certificate
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Toast Notification System ────────────────────────────────────────────────
const ToastContext = React.createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {/* aria-live="polite" announces toasts to screen readers without interrupting.
          Errors use aria-live="assertive" so they're announced immediately. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl text-white text-[13px] font-semibold animate-bounce-in pointer-events-auto ${
              t.type === "success" ? "bg-green-600" : t.type === "error" ? "bg-red-600" : "bg-blue-600"
            }`}
          >
            {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"} {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast() {
  return React.useContext(ToastContext) || (() => {});
}


// ─── Cookie Consent Banner ────────────────────────────────────────────────────
function CookieBanner({ onPrivacy }) {
  const [visible, setVisible] = useState(() => !localStorage.getItem("eq_cookie_consent"));
  if (!visible) return null;
  return (
    <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-[45] bg-slate-900 border-t border-slate-700 px-6 py-4">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <p className="text-[13px] text-slate-300 leading-relaxed max-w-2xl">
          🍪 We use essential cookies to keep you signed in and improve your experience. By using Eqovely, you agree to our{" "}
          <button onClick={onPrivacy} className="text-blue-400 hover:text-blue-300 underline font-medium">Privacy Policy</button>.
          We never sell your data.
        </p>
        <div className="flex gap-3 shrink-0">
          <button onClick={() => { localStorage.setItem("eq_cookie_consent", "true"); setVisible(false); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl transition-all">
            Accept
          </button>
          <button onClick={() => { localStorage.setItem("eq_cookie_consent", "declined"); setVisible(false); }}
            className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-[13px] font-medium px-4 py-2.5 rounded-xl transition-all">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Back To Top Button ───────────────────────────────────────────────────────
function BackToTopButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const h = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-20 md:bottom-8 right-6 z-[140] w-11 h-11 bg-slate-900 hover:bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:-translate-y-1"
      title="Back to top"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
        <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}


// ─── How It Works Section ─────────────────────────────────────────────────────
function HowItWorksSection({ onBrowse, onDonate, onAuth, user }) {
  const steps = [
    {
      number: "01",
      icon: "box",
      title: "List Your Surplus",
      desc: "Donors — companies, labs, or individuals — post surplus items in minutes. Add photos, quantity, location, and category. No fees, no paperwork.",
      cta: "List an Item",
      action: onDonate,
      color: "bg-blue-50 border-blue-100",
      numberColor: "text-blue-600",
    },
    {
      number: "02",
      icon: "search",
      title: "Browse & Claim",
      desc: "Schools, non-profits, and individuals browse verified listings by category and region. Claim what you need — you'll receive a secure 6-digit pickup PIN instantly.",
      cta: "Browse Items",
      action: onBrowse,
      color: "bg-green-50 border-green-100",
      numberColor: "text-green-600",
    },
    {
      number: "03",
      icon: "check",
      title: "Verify & Transfer",
      desc: "Meet in person. The recipient shows their PIN, the donor enters it to authorize the handoff. Both parties are protected by our dual-key escrow system.",
      cta: user ? "View My Listings" : "Sign Up Free",
      action: user ? onBrowse : onAuth,
      color: "bg-amber-50 border-amber-100",
      numberColor: "text-amber-600",
    },
  ];
  return (
    <section id="how-it-works" className="py-24 bg-white border-t border-slate-100">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-[12px] font-semibold text-blue-600 uppercase tracking-widest">How It Works</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mb-3">Three steps. Real impact.</h2>
          <p className="text-slate-500 max-w-md mx-auto text-[15px] leading-relaxed">
            From surplus to purpose — fast, free, and fully verified.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <div key={step.number} className={`relative border rounded-3xl p-8 flex flex-col gap-5 ${step.color}`}>
              <div className="flex items-center justify-between">
                <span className={`text-5xl font-black tracking-tight opacity-20 ${step.numberColor}`}>{step.number}</span>
                <span className="text-4xl">{step.icon}</span>
              </div>
              <div>
                <h3 className="text-[18px] font-bold text-slate-900 mb-2">{step.title}</h3>
                <p className="text-[13px] text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
              <button onClick={step.action}
                className="mt-auto flex items-center gap-2 text-[13px] font-semibold text-slate-700 hover:text-blue-600 transition-colors group">
                {step.cta}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 group-hover:translate-x-1 transition-transform">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {i < 2 && (
                <div className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3 text-slate-400">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-10 bg-slate-900 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-white font-bold text-[18px] mb-1">Ready to make an impact?</p>
            <p className="text-slate-400 text-[13px]">Join Eqovely today — free for donors and recipients worldwide.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={onDonate} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-all text-[14px]">
              List Surplus
            </button>
            <button onClick={onBrowse} className="bg-white/10 hover:bg-white/20 text-white font-medium px-6 py-3 rounded-xl transition-all text-[14px] border border-white/20">
              Browse Items
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ onBrowse, onDonate }) {
  return (
    <section
      id="hero"
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-white"
    >
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(#334155 1px, transparent 1px), linear-gradient(90deg, #334155 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-40 -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-slate-100 rounded-full blur-3xl opacity-60 translate-x-1/2 translate-y-1/2" />
      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4 py-1.5 mb-8">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-[12px] font-medium text-blue-600 tracking-wider uppercase">
            Live Global Marketplace
          </span>
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-slate-900 leading-[1.05] mb-6">
          Surplus finds its{" "}
          <span className="relative">
            <span className="relative z-10 text-blue-600">purpose.</span>
            <span
              className="absolute inset-x-0 bottom-1 h-3 bg-blue-100 -z-0 rounded"
              style={{ transform: "skewX(-2deg)" }}
            />
          </span>
        </h1>
        <p className="text-lg text-slate-500 max-w-xl mx-auto leading-relaxed mb-10 font-light">
          Connect corporate surplus directly to schools, non-profits, and communities that need it most. Free. Verified. Global.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onBrowse}
            className="group flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-7 py-3.5 rounded-full transition-all shadow-xl shadow-blue-200 hover:-translate-y-0.5 text-[15px]"
          >
            Browse Items{" "}
            <span className="group-hover:translate-x-1 transition-transform">
              <IconArrow />
            </span>
          </button>
          <button
            onClick={onDonate}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-medium px-7 py-3.5 rounded-full transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 text-[15px]"
          >
            <IconPlus /> List Surplus
          </button>
        </div>
        <div className="mt-20 grid grid-cols-3 gap-8 max-w-lg mx-auto border-t border-slate-100 pt-10">
          {[
            { value: "12K+", label: "Items Matched" },
            { value: "340+", label: "Organizations" },
            { value: "60+", label: "Countries" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
              <div className="text-[12px] text-slate-400 mt-0.5 font-medium">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-4 tracking-widest uppercase">These are our goals</p>
      </div>
    </section>
  );
}

// ─── Analytics Bar ────────────────────────────────────────────────────────────
// No-op — units transferred is now counted directly from transferred listings
function incrementUnitsTransferred() {}

function AnalyticsBar({ listings, transferredCount }) {
  const activeCount = listings.filter(l => l.status !== "transferred").length;
  return (
    <div className="grid grid-cols-2 gap-3 mb-8">
      {[
        {
          label: "Total Listings",
          value: activeCount,
          color: "text-slate-900",
          bg: "bg-white",
          sub: "in marketplace",
        },
        {
          label: "Units Transferred",
          value: transferredCount,
          color: "text-green-600",
          bg: "bg-green-50",
          sub: "completed transfers",
        },
      ].map(({ label, value, color, bg, sub }) => (
        <div
          key={label}
          className={`${bg} border border-slate-100 rounded-2xl px-4 py-4`}
        >
          <div className={`text-xl font-bold tracking-tight ${color}`}>
            {value}
          </div>
          <div className="text-[12px] font-semibold text-slate-600 mt-0.5">
            {label}
          </div>
          <div className="text-[10px] text-slate-400">{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Geo Map Section ──────────────────────────────────────────────────────────
function GeoMapSection({ listings }) {
  const regionCounts = REGION_PINS.reduce((acc, pin) => {
    acc[pin.region] = listings.filter((l) =>
      (l.region_country || l.owner_region || l.location || "").includes(
        pin.region.split(" ")[0]
      )
    ).length;
    return acc;
  }, {});
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-blue-600">
          <IconGlobe />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-700">
          Regional Distribution Map
        </h3>
        <span className="text-[11px] text-slate-400 ml-auto">
          Live inventory pins
        </span>
      </div>
      <div
        className="relative bg-gradient-to-br from-blue-950 to-slate-900 rounded-xl overflow-hidden"
        style={{ paddingBottom: "45%" }}
      >
        <div className="absolute inset-0">
          {/* Simplified world map SVG background */}
          <svg
            viewBox="0 0 100 50"
            className="w-full h-full opacity-20"
            preserveAspectRatio="xMidYMid slice"
          >
            <ellipse
              cx="50"
              cy="25"
              rx="48"
              ry="23"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="0.3"
            />
            <line
              x1="2"
              y1="25"
              x2="98"
              y2="25"
              stroke="#3b82f6"
              strokeWidth="0.2"
            />
            <line
              x1="50"
              y1="2"
              x2="50"
              y2="48"
              stroke="#3b82f6"
              strokeWidth="0.2"
            />
            {[15, 30, 45, 60, 75].map((x) => (
              <line
                key={x}
                x1={x}
                y1="2"
                x2={x}
                y2="48"
                stroke="#1e40af"
                strokeWidth="0.15"
              />
            ))}
            {[10, 20, 35, 40].map((y) => (
              <ellipse
                key={y}
                cx="50"
                cy="25"
                rx={y}
                ry={y * 0.46}
                fill="none"
                stroke="#1e40af"
                strokeWidth="0.15"
              />
            ))}
          </svg>
          {/* Region pins */}
          {REGION_PINS.map((pin) => (
            <div
              key={pin.region}
              className="absolute flex flex-col items-center gap-1"
              style={{
                left: pin.x,
                top: pin.y,
                transform: "translate(-50%,-50%)",
              }}
            >
              <div
                className={`${pin.color} w-3 h-3 rounded-full shadow-lg animate-pulse`}
              />
              <div className="bg-white/90 backdrop-blur-sm rounded-md px-1.5 py-0.5 text-[9px] font-semibold text-slate-800 whitespace-nowrap shadow">
                {pin.region.split(" ")[0]}
                {regionCounts[pin.region] > 0
                  ? ` · ${regionCounts[pin.region]}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {REGION_PINS.map((pin) => (
          <span
            key={pin.region}
            className="flex items-center gap-1.5 text-[11px] text-slate-500"
          >
            <span className={`${pin.color} w-2 h-2 rounded-full`} />
            {pin.region}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Listing Card ─────────────────────────────────────────────────────────────
function ListingCard({
  listing,
  user,
  onDelete,
  onClaim,
  onTransferred,
  onOpenChat,
  onShowPin,
  allListings = [],
  onToast,
  onCardClick,
  onUpdate,
}) {
  const [deleting, setDeleting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editForm, setEditForm] = useState({ title: listing.title || "", description: listing.description || "", quantity: listing.quantity || "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [flagged, setFlagged] = useState((listing.flags || 0) > 0);
  const [showContact, setShowContact] = useState(false);
  // showPin is lifted to parent — use onShowPin prop instead
  const [showOwnerVerify, setShowOwnerVerify] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [showMedReason, setShowMedReason] = useState(false);
  const [medReason, setMedReason] = useState("");
  const [lightboxIdx, setLightboxIdx] = useState(null); // null = closed

  const isClaimed =
    listing.status === "claimed" || listing.status === "pending";
  const isTransferred = listing.status === "transferred";
  const isDone = isTransferred; // Allow multiple claimers — only block when fully transferred
  const alreadyClaimed = user && listing.claimer_id === user.email; // has THIS user claimed it
  const isOwner = user && user.email === listing.owner_email;
  const isVerifiedNP = listing.owner_type === "School/Non-Profit Recipient";
  const categoryStyle =
    CATEGORY_COLORS[listing.category] || CATEGORY_COLORS["Other"];
  const ownerBadge = OWNER_TYPE_BADGE[listing.owner_type];

  // Support both single image_url string and JSON array of URLs
  let images = [];
  try {
    images = JSON.parse(listing.image_url);
    if (!Array.isArray(images)) images = [listing.image_url];
  } catch {
    if (listing.image_url) images = [listing.image_url];
  }

  const handleDelete = async () => {
    if (!user || user.email !== listing.owner_email) {
      if (onToast) onToast("Security: you are not the owner of this listing.", "error");
      return;
    }
    // Confirmation already shown via modal — proceed with delete
    setDeleting(true);
    try {
      // Messages are intentionally kept — users can still see chat history after transfer
      await fetch(`${SUPABASE_URL}/notifications?listing_id=eq.${listing.id}`, {
        method: "DELETE",
        headers: getHeaders(getToken()),
      });
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "DELETE",
        headers: getHeaders(getToken()),
      });
      if (!res.ok) throw new Error("Delete failed — you may not be the owner.");
      onDelete(listing.id);
    } catch (err) {
      if (onToast) onToast(err.message || "Failed to delete.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleClaim = async (reason = "") => {
    if (isDone || !user) return;
    if (!checkClaimThrottle(listing.id)) {
      if (onToast) onToast("You have already claimed this item. Please wait before trying again.", "error");
      return;
    }
    if (listing.category === "Medical Supplies" && !reason) {
      setShowMedReason(true);
      return;
    }
    setClaiming(true);
    // PIN persistence: reuse cached PIN if user claimed before.
    // 6-digit cryptographic PIN — Math.random() is not cryptographically
    // secure. crypto.getRandomValues() is the correct standard.
    const pinCacheKey = `eq_pin_${listing.id}_${user.email}`;
    const cachedPin = sessionStorage.getItem(pinCacheKey);
    const pin = cachedPin || (() => {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return String(100000 + (arr[0] % 900000));
    })();
    sessionStorage.setItem(pinCacheKey, pin); // cache for undo/reclaim
    try {
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: getHeaders(getToken()),
        body: JSON.stringify({
          status: "pending",
          verification_pin: parseInt(pin, 10),
          claimer_id: user.email,
        }),
      });
      if (res.ok) {
        onClaim(listing.id, parseInt(pin, 10));
        if (onShowPin) onShowPin(pin);
        if (onToast) onToast("Item claimed! Show your PIN to the donor.", "success");
        createNotification(
          listing.owner_email,
          "claim",
          `${user.email} claimed your item: "${listing.title}". Meet them and verify their PIN to complete the transfer.`,
          listing.id
        );
      } else {
        const errBody = await res.json().catch(() => ({}));
        console.error("Claim PATCH failed:", res.status, errBody);
        if (onToast) onToast(`Claim failed: ${errBody?.message || res.status}`, "error");
        if (onShowPin) onShowPin(pin);
      }
    } catch (err) {
      if (onShowPin) onShowPin(pin);
      console.error("Claim error:", err);
    } finally {
      setClaiming(false);
    }
  };

  const handleEdit = async () => {
    if (!user || user.email !== listing.owner_email) { setEditError("Security: you are not the owner."); return; }
    if (!editForm.title.trim()) { setEditError("Title is required."); return; }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: getHeaders(getToken()),
        body: JSON.stringify({
          title: editForm.title.trim(),
          description: editForm.description.trim(),
          quantity: editForm.quantity ? parseInt(editForm.quantity, 10) : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save changes.");
      // Notify parent to update its state immutably — never mutate props directly
      if (onUpdate) {
        onUpdate(listing.id, {
          title: editForm.title.trim(),
          description: editForm.description.trim(),
          quantity: editForm.quantity ? parseInt(editForm.quantity, 10) : null,
        });
      }
      setShowEditModal(false);
      if (onToast) onToast("Listing updated!", "success");
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleFlag = async () => {
    try {
      const newFlags = flagged
        ? Math.max(0, (listing.flags || 1) - 1)
        : (listing.flags || 0) + 1;
      await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: getHeaders(getToken()),
        body: JSON.stringify({ flags: newFlags }),
      });
      setFlagged(!flagged);
    } catch {
      if (onToast) onToast("Failed to report.", "error");
    }
  };

  return (
    <>
      <div
        className={`group bg-white border rounded-2xl overflow-hidden flex flex-col transition-all duration-300 ${
          isDone
            ? "opacity-55 border-slate-100"
            : "border-slate-100 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-50 hover:-translate-y-1"
        } ${onCardClick ? "cursor-pointer" : ""}`}
        onClick={onCardClick || undefined}
      >
        {/* Photo gallery */}
        {images.length > 0 && !imgError && (
          <div className="relative w-full h-44 bg-slate-100 overflow-hidden">
            <img
              src={images[imgIdx]}
              alt={listing.title}
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIdx(imgIdx);
              }}
              className="w-full h-full object-cover transition-all duration-300 cursor-zoom-in"
            />
            {images.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                {images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === imgIdx ? "bg-white scale-125" : "bg-white/50"
                    }`}
                  />
                ))}
              </div>
            )}
            {isVerifiedNP && (
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow">
                <IconCheck /> Verified Non-Profit/Edu Hub
              </div>
            )}
          </div>
        )}
        {(images.length === 0 || imgError) && isVerifiedNP && (
          <div className="px-5 pt-4">
            <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
              <IconCheck /> Verified Non-Profit/Edu Hub
            </span>
          </div>
        )}

        <div className="p-5 flex flex-col gap-3 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3
                className={`font-semibold text-[15px] leading-snug truncate transition-colors ${
                  isDone
                    ? "text-slate-400"
                    : "text-slate-900 group-hover:text-blue-700"
                }`}
              >
                {listing.title || "Untitled"}
              </h3>
              {listing.organization && (
                <p className="text-[12px] text-slate-400 mt-0.5 font-medium truncate">
                  {listing.organization}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {listing.category && (
                <span
                  className={`inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ${categoryStyle}`}
                >
                  {listing.category}
                </span>
              )}
              {listing.created_at && (
                <span className="text-[10px] text-slate-400">{timeAgo(listing.created_at)}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ownerBadge && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${ownerBadge.cls}`}
              >
                {ownerBadge.label}
              </span>
            )}
            {(listing.owner_transfers_completed >= 3) && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700" title="Completed 3+ verified transfers">
                ✓ Trusted Donor
              </span>
            )}
            {isClaimed && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">
                ⏳ Pending — Awaiting Key B
              </span>
            )}
            {isTransferred && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-green-100 text-green-700">
                ✓ Transferred
              </span>
            )}
          </div>

          {listing.description && (
            <ExpandableDescription text={listing.description} />
          )}

          <div className="flex items-center gap-3 text-[12px] text-slate-400 flex-wrap">
            {listing.quantity && (
              <span className="flex items-center gap-1">
                <IconBox /> {listing.quantity} units
              </span>
            )}
            {(listing.country || listing.location) && (
              <span className="flex items-center gap-1">
                <IconMapPin />{" "}
                {listing.country
                  ? listing.country +
                    (listing.location ? ", " + listing.location : "")
                  : listing.location}
              </span>
            )}
            {listing.created_at && (
              <span className="flex items-center gap-1">
                🕐{" "}
                {(() => {
                  const d = Math.floor(
                    (Date.now() - new Date(listing.created_at)) / 86400000
                  );
                  return d === 0
                    ? "Today"
                    : d === 1
                    ? "1d ago"
                    : d < 30
                    ? `${d}d ago`
                    : d < 365
                    ? `${Math.floor(d / 30)}mo ago`
                    : `${Math.floor(d / 365)}y ago`;
                })()}
              </span>
            )}
          </div>

          {showContact &&
            (user ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                {listing.owner_email && (
                  <a
                    href={`mailto:${listing.owner_email}`}
                    className="flex items-center gap-2 text-[12px] text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <IconEmail /> {listing.owner_email}
                  </a>
                )}
                {listing.owner_phone && user && (user.email === listing.owner_email || user.email === listing.claimer_id) && (
                  <a
                    href={`tel:${listing.owner_phone}`}
                    className="flex items-center gap-2 text-[12px] text-green-600 hover:text-green-800 font-medium"
                  >
                    <IconPhone /> {listing.owner_phone}
                  </a>
                )}
                {!listing.owner_email && !listing.owner_phone && (
                  <p className="text-[12px] text-slate-400 italic">
                    No contact info provided.
                  </p>
                )}
                <button
                  onClick={() => onOpenChat(listing)}
                  className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-all w-full mt-1"
                >
                  <IconMsg /> Message Owner
                </button>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[12px] text-amber-700 font-medium">
                Please sign in to view contact details.
              </div>
            ))}

          {/* ════════════════════════════════════════════════════════════
               WORKSPACE PARTITION — Giver vs Claimer
               isOwner  → Giver workspace  (manage, verify, delete)
               !isOwner → Claimer workspace (claim, passive PIN view)
               ════════════════════════════════════════════════════════════ */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-50 gap-2 flex-wrap mt-auto">
            {/* ── GIVER WORKSPACE (owner only) ───────────────────────────── */}
            {isOwner ? (
              <div className="flex items-center gap-2 flex-wrap w-full justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Key B Verify PIN — rendered only when item is pending handshake */}
                  {!isTransferred && isClaimed && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowOwnerVerify(true); }}
                      className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 border border-blue-700 rounded-lg px-3 py-1.5 transition-all shadow-sm"
                    >
                      <IconShield /> Enter Recipient PIN
                    </button>
                  )}

                  {/* Pending label when awaiting claimer */}
                  {!isClaimed && !isTransferred && (
                    <span className="text-[11px] text-slate-400 font-medium">
                      Listed — awaiting claim
                    </span>
                  )}
                  {/* Show claimer info to owner */}
                  {isClaimed && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-green-600"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span className="font-medium">Item Claimed</span>
                    </div>
                  )}
                </div>
                {/* Edit + Delete — only while item is still available */}
                {!isDone && (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        if (!user || user.email !== listing.owner_email) return;
                        setEditForm({ title: listing.title || "", description: listing.description || "", quantity: listing.quantity || "" });
                        setEditError(null);
                        setShowEditModal(true);
                      }}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-200 rounded-lg px-2.5 py-1 transition-all"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                      disabled={deleting}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-red-400 hover:text-red-600 border border-red-100 hover:border-red-200 rounded-lg px-2.5 py-1 transition-all"
                    >
                      {deleting ? (
                        <IconLoader />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* ── CLAIMER WORKSPACE (non-owner) ─────────────────────────── */
              <div className="flex items-center gap-2 flex-wrap w-full justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Claim button — visible to all non-owners, even if others claimed */}
                  {!isTransferred &&
                    (alreadyClaimed ? (
                      <span className="flex items-center gap-1.5 text-[12px] text-amber-600 font-medium">
                        ⏳ Key A issued — show PIN to donor
                      </span>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleClaim(); }}
                        disabled={claiming || !user}
                        className={`flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-xl transition-all shadow-sm ${
                          !user
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700 text-white hover:-translate-y-0.5 shadow-blue-200"
                        }`}
                      >
                        {claiming ? (
                          <IconLoader />
                        ) : (
                          <>
                            <span>Claim Item</span> <IconArrow />
                          </>
                        )}
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                  {/* Copy link */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(`${window.location.origin}?listing=${listing.id}`);
                      if (onToast) onToast("Link copied!", "success");
                    }}
                    className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-blue-500 transition-all"
                    title="Copy listing link"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {/* WhatsApp share */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const text = encodeURIComponent(`Check out this item on Eqovely: "${listing.title}" — ${window.location.origin}?listing=${listing.id}`);
                      window.open(`https://wa.me/?text=${text}`, "_blank");
                    }}
                    className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-green-500 transition-all"
                    title="Share on WhatsApp"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </button>
                  {/* Flag — claimers only, not owners */}
                  <button
                    onClick={handleFlag}
                    title={flagged ? "Click to unreport" : "Report listing"}
                    className={`flex items-center gap-1 text-[11px] transition-all ${
                      flagged
                        ? "text-rose-400 hover:text-slate-400"
                        : "text-slate-300 hover:text-rose-500"
                    }`}
                  >
                    <IconFlag />
                    {flagged && <span> Reported (undo)</span>}
                  </button>
                  {/* Contact reveal — claimers only */}
                  <button
                    onClick={() => setShowContact((p) => !p)}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-200 rounded-lg px-2.5 py-1 transition-all"
                  >
                    <IconEye /> {showContact ? "Hide" : "Contact"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* PIN modal moved to parent ListingsSection */}
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-red-600"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h3 className="text-[17px] font-bold text-slate-900 mb-2">Delete Listing?</h3>
            <p className="text-[13px] text-slate-500 mb-6 leading-relaxed">This will permanently delete <span className="font-semibold text-slate-700">"{listing.title}"</span>. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-3 text-[14px] font-semibold text-slate-700 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all">Cancel</button>
              <button
                onClick={() => { setShowDeleteConfirm(false); handleDelete(); }}
                disabled={deleting}
                className="flex-1 py-3 text-[14px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-2xl transition-all disabled:bg-slate-300"
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Listing Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <button onClick={() => setShowEditModal(false)} aria-label="Close edit dialog" className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"><IconX /></button>
            <h3 className="text-lg font-bold text-slate-900 mb-5">Edit Listing</h3>
            {editError && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{editError}</div>}
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Title *</label>
                <input
                  value={editForm.title}
                  onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Item title"
                  maxLength={120}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Description</label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                  placeholder="Condition, specs, details…"
                  maxLength={300}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="e.g. 10"
                />
              </div>
              <button
                onClick={handleEdit}
                disabled={editSaving}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all text-[14px]"
              >
                {editSaving ? <><IconLoader /> Saving…</> : <><IconCheck /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOwnerVerify && (
        <OwnerVerifyModal
          listing={listing}
          user={user}
          onVerified={(id) => {
            createNotification(
              listing.claimer_id,
              "transfer",
              `Transfer of "${listing.title}" has been completed. The item is now yours.`,
              listing.id
            );
            incrementUnitsTransferred(listing.quantity || 1);
            onTransferred(id);
          }}
          onClose={() => setShowOwnerVerify(false)}
          fetchPin={async () => {
            // Fetch the PIN directly from DB when modal opens — ensures it's always fresh
            try {
              const res = await fetch(
                `${SUPABASE_URL}/listings?id=eq.${listing.id}&select=verification_pin`,
                { headers: getHeaders(getToken()) }
              );
              if (!res.ok) return null;
              const data = await res.json();
              return data?.[0]?.verification_pin ?? null;
            } catch { return null; }
          }}
        />
      )}
      {/* Photo Lightbox */}
      {lightboxIdx !== null && images.length > 0 && (
        <PhotoLightbox
          images={images}
          startIdx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}

      {/* Medical Supplies Claim Reason Modal */}
      {showMedReason && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowMedReason(false)}
          />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-7">
            <button
              onClick={() => setShowMedReason(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
            >
              <IconX />
            </button>
            <div className="w-12 h-12 bg-teal-100 rounded-2xl flex items-center justify-center mb-4 text-teal-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-5 h-5"
              >
                <path
                  d="M12 2a10 10 0 100 20A10 10 0 0012 2zM12 8v4M12 16h.01"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3 className="text-[16px] font-bold text-slate-900 mb-1">
              Medical Supplies Request
            </h3>
            <p className="text-[13px] text-slate-500 mb-2 leading-relaxed">
              For safety, please briefly explain why your organization needs these medical supplies (max 60 words).
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
              <p className="text-[11px] text-amber-700 font-medium">⚠️ Disclaimer: Eqovely does not verify the safety or suitability of medical supplies. All transfers are at the recipient's own risk. Consult a qualified medical professional before use.</p>
            </div>
            <textarea
              value={medReason}
              onChange={(e) => {
                const words = e.target.value
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean);
                if (words.length <= 60) setMedReason(e.target.value);
              }}
              placeholder="e.g. Our school clinic needs basic first aid supplies for 200 students and does not have budget for procurement this term..."
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none mb-2"
            />
            <p className="text-[11px] text-slate-400 mb-4">
              {medReason.trim().split(/\s+/).filter(Boolean).length}/60 words
            </p>
            <button
              onClick={() => {
                setShowMedReason(false);
                handleClaim(medReason);
              }}
              disabled={
                medReason.trim().split(/\s+/).filter(Boolean).length < 5
              }
              className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-[14px]"
            >
              <IconCheck /> Submit Request & Claim
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Listings Section ─────────────────────────────────────────────────────────
function ListingsSection({
  refreshTrigger,
  user,
  onOpenChat,
  onListingsLoaded,
  onClaimSuccess,
  dashMode = false,
}) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(9);
  const showToast = useToast();
  const [catFilter, setCatFilter] = useState("All");
  const [regionFilter, setRegionFilter] = useState("All Regions");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationInput,  setLocationInput]  = useState("");
  const locationDebounce = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchDebounce = useRef(null);
  const [tab, setTab] = useState("marketplace");
  const [pinData, setPinData] = useState(null); // {pin, listing}
  const [transferredCount, setTransferredCount] = useState(0);

  // Fetch global Units Transferred directly from the listings table
  // (status = 'transferred'). This is computed straight from the same
  // public table the marketplace already reads, so it can never silently
  // fall out of sync with a separate counter.
  useEffect(() => {
    const fetchGlobalTransferred = async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/listings?status=eq.transferred&select=id`,
          { headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setTransferredCount(data.length);
      } catch {}
    };
    fetchGlobalTransferred();
  }, [refreshTrigger]);

  // ── View state: 'dashboard' shows 3-card preview, 'marketplace' shows all ──
  const [currentView, setCurrentView] = useState("dashboard");
  const [selectedListing, setSelectedListing] = useState(null);

  const fetchListingsAbortRef = useRef(null);
  const fetchListings = useCallback(async () => {
    // Cancel any in-flight request before starting a new one
    if (fetchListingsAbortRef.current) fetchListingsAbortRef.current.abort();
    const controller = new AbortController();
    fetchListingsAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      let token = getToken();
      // Only request columns the UI actually uses — avoids fetching verification_pin for non-owners
      const cols = "id,title,description,category,quantity,location,image_url,status,owner_email,owner_id,claimer_id,verification_pin,flags,created_at,organization,region_country,owner_region";
      let res = await fetch(
        `${SUPABASE_URL}/listings?select=${cols}&order=created_at.desc`,
        { headers: getHeaders(token), signal: controller.signal }
      );
      if (res.status === 401) {
        const refreshToken = localStorage.getItem("eq_refresh_token");
        if (refreshToken) {
          try {
            const refreshRes = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                localStorage.setItem("eq_token", refreshData.access_token);
                if (refreshData.refresh_token) localStorage.setItem("eq_refresh_token", refreshData.refresh_token);
                token = refreshData.access_token;
              }
            }
          } catch {}
        }
        res = await fetch(
          `${SUPABASE_URL}/listings?select=${cols}&order=created_at.desc`,
          { headers: getHeaders(token), signal: controller.signal }
        );
      }
      if (!res.ok) throw new Error(`Failed to load listings (HTTP ${res.status})`);
      const data = await res.json();
      if (!controller.signal.aborted) {
        setListings(Array.isArray(data) ? data : []);
        if (onListingsLoaded) onListingsLoaded(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      if (err.name === "AbortError") return; // Intentional — component unmounted
      setError("Unable to load listings. Please check your connection and try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [onListingsLoaded]);

  const handleDelete = useCallback((id) => setListings((p) => p.filter((l) => l.id !== id)), []);
  const handleClaim = useCallback((id, pin) => {
    setListings((p) => {
      const updated = p.map((l) =>
        l.id === id ? { ...l, status: "pending", verification_pin: pin, claimer_id: user?.email } : l
      );
      if (onListingsLoaded) onListingsLoaded(updated);
      return updated;
    });
    if (onClaimSuccess) setTimeout(onClaimSuccess, 800);
  }, [user?.email, onListingsLoaded, onClaimSuccess]);

  const handleTransferred = useCallback((id) => {
    setListings((p) => p.filter((l) => String(l.id) !== String(id)));
    setTimeout(() => {
      fetch(`${SUPABASE_URL}/listings?status=eq.transferred&select=id`, { headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" } })
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setTransferredCount(data.length); })
        .catch(() => {});
    }, 1000);
  }, []);

  useEffect(() => { fetchListings(); }, [refreshTrigger]);
  useEffect(() => { setVisibleCount(9); }, [catFilter, regionFilter, locationSearch, searchQuery, tab]);

  // ── RBAC: Derive role ─────────────────────────────────────────────────────
  const DONOR_TYPES_LS = ["Individual Donor", "Corporate/Lab Donor"];
  const RECIPIENT_TYPES_LS = ["School/Non-Profit Recipient", "Individual Recipient"];
  const isDonor = user && DONOR_TYPES_LS.includes(user?.account_type || "");
  const isRecipientUser = user && RECIPIENT_TYPES_LS.includes(user?.account_type || "");

  // ── Memoized filter pipeline ───────────────────────────────────────────────
  // Re-computed only when listings or filter state changes, not on every render
  const filtered = useMemo(() => {
    let f = listings;
    if (tab === "marketplace") f = f.filter((l) => l.status !== "transferred");
    if (tab === "dashboard" && user) {
      if (isDonor) {
        f = f.filter((l) => l.owner_email === user.email || l.owner_id === user.id || (l.status === "pending" && (l.owner_email === user.email || l.owner_id === user.id)));
      } else {
        f = f.filter((l) => l.status === "available" || l.claimer_id === user.id || l.claimer_id === user.email);
      }
    }
    if (tab === "claims" && user) f = f.filter(l => l.claimer_id === user.email || l.claimer_id === user.id);
    if (catFilter !== "All") f = f.filter((l) => l.category === catFilter);
    if (regionFilter !== "All Regions") f = f.filter((l) => (l.region_country || "") === regionFilter || (l.owner_region || "") === regionFilter || (l.location || "").toLowerCase().includes(regionFilter.toLowerCase()));
    if (locationSearch.trim()) f = f.filter((l) => (l.location || "").toLowerCase().includes(locationSearch.toLowerCase()));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      f = f.filter((l) => (l.title || "").toLowerCase().includes(q) || (l.description || "").toLowerCase().includes(q) || (l.organization || "").toLowerCase().includes(q));
    }
    return f;
  }, [listings, tab, user, isDonor, catFilter, regionFilter, locationSearch, searchQuery]);

  // ── Preview slice: only 3 most recent on homepage ────────────────────────
  const previewListings = filtered.slice(0, 3);
  // ── Paginated slice for marketplace ──────────────────────────────────────
  const paginatedListings = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  // ── Shared card grid renderer ─────────────────────────────────────────────
  const CardGrid = ({ items, onCardClick }) => (
    <>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white border border-slate-100 rounded-2xl overflow-hidden animate-pulse"
            >
              <div className="w-full h-44 bg-slate-100" />
              <div className="p-5 space-y-3">
                <div className="h-4 bg-slate-100 rounded-full w-3/4" />
                <div className="h-3 bg-slate-100 rounded-full w-1/2" />
                <div className="h-3 bg-slate-100 rounded-full w-full" />
                <div className="h-3 bg-slate-100 rounded-full w-5/6" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="text-4xl">⚠️</div>
          <p className="text-slate-500 text-[14px]">{error}</p>
          <button
            onClick={fetchListings}
            className="text-blue-600 text-[13px] font-medium hover:underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={
            searchQuery
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" strokeLinecap="round"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-400"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" strokeLinecap="round"/></svg>
          }
          title={
            searchQuery ? `No results for "${searchQuery}"` :
            isRecipientUser ? "No items available right now" :
            isDonor && listings.length === 0 ? "No listings yet" :
            "No listings match your filters"
          }
          body={
            searchQuery ? "Try different keywords or clear your search." :
            isRecipientUser ? "Check back soon — donors add new items regularly." :
            isDonor && listings.length === 0 ? "Be the first to list a surplus item and connect with those who need it." :
            "Try adjusting your category or region filters."
          }
          action={!searchQuery && listings.length === 0 && isDonor ? "Post Your First Item" : searchQuery ? "Clear Search" : null}
          onAction={() => {
            if (searchQuery) { setSearchInput(""); setSearchQuery(""); }
            else document.getElementById("list")?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              user={user}
              onDelete={handleDelete}
              onClaim={handleClaim}
              onTransferred={handleTransferred}
              onOpenChat={onOpenChat}
              onShowPin={(pin) => setPinData({ pin, listing })}
              allListings={listings}
              onToast={showToast}
              onCardClick={onCardClick ? () => onCardClick(listing) : undefined}
              onUpdate={(id, fields) => setListings(prev =>
                prev.map(l => String(l.id) === String(id) ? { ...l, ...fields } : l)
              )}
            />
          ))}
        </div>
      )}
    </>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW: FULL-SCREEN MARKETPLACE
  // ════════════════════════════════════════════════════════════════════════════
  if (currentView === "marketplace") {
    return (
      <section id="browse" className="min-h-screen bg-slate-50 pt-20 pb-24">
        <div className="max-w-6xl mx-auto px-6">
          {/* Back button */}
          <button
            onClick={() => {
              setCurrentView("dashboard");
              setSearchQuery("");
              setCatFilter("All");
              setRegionFilter("All Regions");
              setLocationSearch("");
            }}
            className="flex items-center gap-2 text-[13px] font-medium text-slate-500 hover:text-slate-900 mb-8 transition-colors group"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-4 h-4 group-hover:-translate-x-1 transition-transform"
            >
              <path
                d="M19 12H5M12 5l-7 7 7 7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to Dashboard
          </button>

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 text-blue-600">
                  <IconGlobe />
                </div>
                <span className="text-[12px] font-semibold text-blue-600 tracking-widest uppercase">
                  Full Marketplace Catalog
                </span>
              </div>
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
                All Available Surplus
              </h2>
              <p className="text-slate-500 text-[13px] mt-1">
                {filtered.length} item{filtered.length !== 1 ? "s" : ""} across all regions
                {listings.filter(l => {
                  const d = new Date(l.created_at);
                  const today = new Date();
                  return d.toDateString() === today.toDateString();
                }).length > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 bg-green-100 text-green-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    {listings.filter(l => new Date(l.created_at).toDateString() === new Date().toDateString()).length} added today
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {user && user.email === FOUNDER_EMAIL && (
                <button
                  onClick={() => generateImpactPDF(listings)}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-xl transition-all shadow-md shadow-blue-200 hover:-translate-y-0.5"
                  title="Founder access only"
                >
                  <IconDownload /> Impact Report
                </button>
              )}
              <button
                onClick={fetchListings}
                className="text-[13px] font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
              >
                {loading && <IconLoader />} Refresh
              </button>
            </div>
          </div>

          {/* Analytics + Impact */}
          {!loading && !error && (
            <AnalyticsBar
              listings={listings}
              transferredCount={transferredCount}
            />
          )}
          {/* Geo map */}
          {/* Full filter toolbar */}
          {/* Search */}
          <div className="relative mb-4">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"><IconSearch /></div>
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                clearTimeout(searchDebounce.current);
                searchDebounce.current = setTimeout(() => setSearchQuery(e.target.value), 300);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { clearTimeout(searchDebounce.current); setSearchQuery(searchInput); e.target.blur(); }}}
              placeholder="Search by title, description, or organization…"
              className="w-full pl-10 pr-4 py-3 text-[14px] bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-800 placeholder-slate-400 shadow-sm"
            />
            {searchInput && <button onClick={() => { setSearchInput(""); setSearchQuery(""); }} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"><IconX /></button>}
          </div>
          {/* Category pills with counts */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-2" style={{ scrollbarWidth:"none", msOverflowStyle:"none" }}>
            {["All",...CATEGORIES].map(cat => {
              const count = cat === "All"
                ? listings.filter(l => l.status === "available").length
                : listings.filter(l => l.category === cat && l.status === "available").length;
              return (
                <button key={cat} onClick={() => setCatFilter(cat)}
                  className={`text-[12px] font-medium px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap flex items-center gap-1.5 ${catFilter===cat ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}>
                  {cat}
                  {count > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${catFilter===cat ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>}
                </button>
              );
            })}
          </div>
          {/* Region + Location */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-slate-500 shrink-0">📍 Region:</span>
              <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
                className="text-[12px] font-medium border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[12px] font-medium text-slate-500 shrink-0"> Location:</span>
              <input value={locationInput}
                onChange={(e) => { setLocationInput(e.target.value); clearTimeout(locationDebounce.current); locationDebounce.current = setTimeout(() => setLocationSearch(e.target.value), 300); }}
                placeholder="Search city, zip, or area…"
                className="flex-1 text-[12px] border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          {/* Full scrolling card grid */}
          <CardGrid items={paginatedListings} onCardClick={(l) => setSelectedListing(l)} />
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount(c => c + 9)}
                className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 text-slate-700 hover:text-blue-600 font-medium px-8 py-3 rounded-2xl transition-all shadow-sm hover:shadow-md"
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </div>
        {pinData && (
          <RecipientPinModal
            pin={pinData.pin}
            listing={pinData.listing}
            onClose={() => setPinData(null)}
          />
        )}
        {selectedListing && (
          <ListingDetailModal
            listing={selectedListing}
            user={user}
            onClose={() => setSelectedListing(null)}
            onClaim={(l) => handleClaim(l.id)}
            onOpenChat={onOpenChat}
            onToast={showToast}
          />
        )}
      </section>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW: HOMEPAGE DASHBOARD PREVIEW (3 most recent)
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <section id="browse" className="py-24 bg-slate-50">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 text-blue-600">
                <IconGlobe />
              </div>
              <span className="text-[12px] font-semibold text-blue-600 tracking-widest uppercase">
                Live Marketplace Preview
              </span>
            </div>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
              Latest Surplus
            </h2>
            <p className="text-slate-500 text-[13px] mt-1">
              Showing 3 of {listings.filter(l => l.status === "available").length} available items
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {user && user.email === FOUNDER_EMAIL && (
              <button
                onClick={() => generateImpactPDF(listings)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-xl transition-all shadow-md shadow-blue-200 hover:-translate-y-0.5"
                title="Founder access only"
              >
                <IconDownload /> Impact Report
              </button>
            )}
            <button
              onClick={fetchListings}
              className="text-[13px] font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
            >
              {loading && <IconLoader />} Refresh
            </button>
          </div>
        </div>

        {/* Analytics bar */}
        {!loading && !error && (
          <AnalyticsBar
            listings={listings}
            transferredCount={transferredCount}
          />
        )}

        {/* Search bar on dashboard */}
        <div className="relative mb-6 mt-2">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"><IconSearch /></div>
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              clearTimeout(searchDebounce.current);
              searchDebounce.current = setTimeout(() => setSearchQuery(e.target.value), 300);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                clearTimeout(searchDebounce.current);
                setSearchQuery(searchInput);
                setCurrentView("marketplace");
                e.target.blur();
              }
            }}
            placeholder="Search listings — press Enter to see all results…"
            className="w-full pl-10 pr-4 py-3 text-[14px] bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-800 placeholder-slate-400 shadow-sm"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(""); setSearchQuery(""); }} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"><IconX /></button>
          )}
        </div>

        {/* 3-card preview grid */}
        <CardGrid items={previewListings} onCardClick={(l) => setSelectedListing(l)} />

        {/* Explore Full Marketplace CTA */}
        {!loading && !error && listings.length > 0 && (
          <div className="mt-10 flex flex-col items-center gap-4">
            <div className="flex items-center gap-3 text-slate-400 text-[12px]">
              <div className="h-px w-16 bg-slate-200" />
              <span>
                {listings.length - 3 > 0
                  ? `${listings.length - 3} more items available`
                  : "Browse the full catalog"}
              </span>
              <div className="h-px w-16 bg-slate-200" />
            </div>
            <button
              onClick={() => setCurrentView("marketplace")}
              className="group flex items-center gap-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-8 py-4 rounded-2xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1 text-[15px]"
            >
              Explore Full Marketplace
              <span className="group-hover:translate-x-1 transition-transform">
                <IconArrow />
              </span>
            </button>
            <p className="text-[11px] text-slate-400">
              Search, filter, and claim items across all regions
            </p>
          </div>
        )}
      </div>
      {pinData && (
        <RecipientPinModal
          pin={pinData.pin}
          listing={pinData.listing}
          onClose={() => setPinData(null)}
        />
      )}

      {/* Listing Detail Modal */}
      {selectedListing && (
        <ListingDetailModal
          listing={selectedListing}
          user={user}
          onClose={() => setSelectedListing(null)}
          onClaim={(l) => handleClaim(l.id)}
          onOpenChat={onOpenChat}
          onToast={showToast}
        />
      )}
    </section>
  );
}

// ─── Photo Uploader ───────────────────────────────────────────────────────────
const MAX_PHOTOS = 6;
function PhotoUploader({ onChange }) {
  const [previews, setPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const uploadFiles = async (files) => {
    if (Array.from(files).length > MAX_PHOTOS) {
      setUploadErr(
        `Maximum limit of ${MAX_PHOTOS} photos exceeded. Please select ${MAX_PHOTOS} or fewer images.`
      );
      return;
    }
    const selected = Array.from(files).slice(0, MAX_PHOTOS);
    if (selected.length === 0) return;
    setUploading(true);
    setUploadErr(null);
    const urls = [];
    for (const file of selected) {
      const ext = file.name.split(".").pop();
      const filename = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      try {
        const res = await fetch(
          `${SUPABASE_STORAGE}/object/listing-photos/${filename}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${getToken() || SUPABASE_ANON_KEY}`,
              "Content-Type": file.type,
            },
            body: file,
          }
        );
        if (!res.ok) throw new Error("Upload failed");
        urls.push(
          `${SUPABASE_STORAGE}/object/public/listing-photos/${filename}`
        );
      } catch (_) {
        // Fallback: use local object URL for preview only
        urls.push(URL.createObjectURL(file));
      }
    }
    const combined = [...previews, ...urls].slice(0, MAX_PHOTOS);
    setPreviews(combined);
    onChange(JSON.stringify(combined));
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    uploadFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => uploadFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              isDragging
                ? "bg-blue-100 text-blue-600"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            <IconUpload />
          </div>
          {uploading ? (
            <div className="flex items-center gap-2 text-blue-600">
              <IconLoader />
              <span className="text-[13px] font-medium">Uploading photos…</span>
            </div>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-slate-700">
                Drop photos here or{" "}
                <span className="text-blue-600">browse</span>
              </p>
              <p className="text-[12px] text-slate-400">
                Up to {MAX_PHOTOS} photos · JPG, PNG, WEBP
              </p>
            </>
          )}
        </div>
      </div>
      {uploadErr && <p className="text-[12px] text-red-500">{uploadErr}</p>}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((url, i) => (
            <div
              key={i}
              className="relative rounded-xl overflow-hidden h-24 bg-slate-100"
            >
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const updated = previews.filter((_, j) => j !== i);
                  setPreviews(updated);
                  onChange(JSON.stringify(updated));
                }}
                className="absolute top-1 right-1 w-5 h-5 bg-slate-900/70 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all text-[10px]"
              >
                ✕
              </button>
              {i === 0 && (
                <span className="absolute bottom-1 left-1 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                  Cover
                </span>
              )}
            </div>
          ))}
          {previews.length < MAX_PHOTOS && (
            <button
              onClick={() => inputRef.current?.click()}
              className="h-24 border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-xl flex items-center justify-center text-slate-400 hover:text-blue-500 transition-all"
            >
              <IconPlus />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Form Section ─────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: "",
  organization: "",
  category: "",
  description: "",
  quantity: "",
  location: "",
  city_zip: "",
  region_country: "",
  country: "",
  image_url: "",
};

function FormSection({ onSuccess, user }) {
  // Recipients should never see the donate form
  const isRecipient = ["School/Non-Profit Recipient", "Individual Recipient"].includes(user?.account_type || "");
  if (isRecipient) return null;
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [medCheck1, setMedCheck1] = useState(false);
  const [medCheck2, setMedCheck2] = useState(false);
  const [uploaderKey, setUploaderKey] = useState(0); // reset PhotoUploader on publish

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Store raw value — sanitize only on submit to allow apostrophes & normal typing
    setForm((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setError("You must be signed in to publish a listing.");
      return;
    }
    if (
      ["School/Non-Profit Recipient", "Individual Recipient"].includes(
        user.account_type
      )
    ) {
      setError(
        "Recipients cannot publish listings. Only donors can list surplus items."
      );
      return;
    }
    if (!agreed) {
      setError("Please confirm the security agreement before submitting.");
      return;
    }
    if (form.category === "Medical Supplies" && (!medCheck1 || !medCheck2)) {
      setError("For Medical Supplies, you must confirm both medical compliance checkboxes.");
      return;
    }
    const orgNeeded =
      user &&
      !["Individual Donor", "Individual Recipient"].includes(user.account_type);
    if (!form.title || !form.category || (orgNeeded && !form.organization)) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!checkThrottle()) {
      setError(
        "Too many submissions. Please wait a minute before trying again."
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        title: sanitize(form.title),
        organization: sanitize(form.organization),
        category: form.category,
        description: sanitize(form.description),
        quantity: form.quantity ? parseInt(form.quantity, 10) : null,
        location: sanitize(form.city_zip || form.location),
        image_url: form.image_url || null,
        region_country: form.region_country || user.region || null,
        country: form.country || null,
        owner_id: user.id || null,
        owner_email: user.email || null,
        owner_phone: user.phone || null,
        owner_org_name: user.org_name || null,
        owner_type: user.account_type || null,
        owner_region: user.region || null,
        status: "available",
        flags: 0,
      };
      const res = await fetch(`${SUPABASE_URL}/listings`, {
        method: "POST",
        headers: getHeaders(getToken()),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || `HTTP ${res.status}`);
      }
      setSuccess(true);
      setForm(EMPTY_FORM);
      setAgreed(false);
      setMedCheck1(false);
      setMedCheck2(false);
      setUploaderKey((k) => k + 1);
      if (onSuccess) onSuccess();
      else window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSuccess(false), 5000);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("eqovely:toast", { detail: { message: "Listing published and live!", type: "success" } }));
    } catch (err) {
      setError(err.message || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const inp =
    "w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all hover:border-slate-300";
  const lbl =
    "block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
      <div className="lg:col-span-3">
        <div className="bg-white border border-slate-100 rounded-3xl shadow-xl shadow-slate-100 p-8">
          <div className="mb-6">
            <p className="text-[13px] text-slate-500">
              {user
                ? <>Listing as <span className="font-semibold text-slate-700">{user.username || user.org_name || user.email}</span> · {user.account_type}</>
                : "Sign in to publish a listing and connect with recipients globally."}
            </p>
          </div>
          {success && (
            <div className="mb-6 flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white shrink-0">
                <IconCheck />
              </div>
              <p className="text-[13px] font-medium text-green-700">
                Listing published and live!
              </p>
            </div>
          )}
          {error && (
            <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-red-500 shrink-0">⚠</span>
              <p className="text-[13px] text-red-700">{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="listing-title" className={lbl} style={{marginBottom:0}}>Item Title *</label>
                <span className={`text-[11px] ${form.title.length > 90 ? "text-amber-500 font-semibold" : "text-slate-400"}`} aria-live="polite">{form.title.length}/100</span>
              </div>
              <input
                id="listing-title"
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="e.g. Standing Desk"
                maxLength={100}
                className={inp}
                aria-required="true"
              />
            </div>
            {/* Org name only for Corporate/Lab and School/Non-Profit */}
            {user &&
              !["Individual Donor", "Individual Recipient"].includes(
                user.account_type
              ) && (
                <div>
                  <label className={lbl}>Organization Name</label>
                  <input
                    name="organization"
                    value={form.organization}
                    onChange={handleChange}
                    placeholder="e.g. Acme Corp"
                    className={inp}
                  />
                </div>
              )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Category *</label>
                <select
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  className={inp}
                >
                  <option value="">Select category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Quantity</label>
                <input
                  name="quantity"
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={handleChange}
                  placeholder="e.g. 25"
                  className={inp}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Country *</label>
                <select
                  name="country"
                  value={form.country || ""}
                  onChange={handleChange}
                  className={inp}
                >
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.flag} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Region</label>
                <select
                  name="region_country"
                  value={form.region_country || ""}
                  onChange={handleChange}
                  className={inp}
                >
                  <option value="">Select region</option>
                  {REGIONS.filter((r) => r !== "All Regions").map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={lbl}>City / Zip Code</label>
              <input
                name="city_zip"
                value={form.city_zip || ""}
                onChange={handleChange}
                placeholder="e.g. Jeddah or 90210"
                className={inp}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="listing-description" className={lbl} style={{marginBottom:0}}>Description</label>
                <span className={`text-[11px] ${(form.description?.length || 0) > 270 ? "text-amber-500 font-semibold" : "text-slate-400"}`} aria-live="polite">{300 - (form.description?.length || 0)} chars left</span>
              </div>
              <textarea
                id="listing-description"
                name="description"
                rows={3}
                value={form.description}
                onChange={handleChange}
                maxLength={300}
                placeholder="Condition, specs, any relevant details…"
                className={`${inp} resize-none`}
                aria-describedby="desc-hint"
              />
              <p id="desc-hint" className="text-[11px] text-slate-400 mt-1">Include condition (new/used), quantity details, and any pickup notes.</p>
            </div>

            {/* Multi-photo uploader */}
            <div>
              <label className={lbl}>
                Item Photos{" "}
                <span className="text-slate-400 normal-case font-normal">
                  (up to {MAX_PHOTOS})
                </span>
              </label>
              <PhotoUploader
                key={uploaderKey}
                onChange={(urls) => setForm((p) => ({ ...p, image_url: urls }))}
              />
            </div>

            {/* Medical Supplies — extra compliance checkboxes */}
            {form.category === "Medical Supplies" && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 space-y-3">
                <p className="text-[12px] font-semibold text-teal-800 flex items-center gap-1.5">
                  <span>⚕️</span> Medical Supplies — Required Confirmation
                </p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={medCheck1}
                    onChange={(e) => setMedCheck1(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-teal-300 text-teal-600 focus:ring-teal-500 shrink-0"
                  />
                  <p className="text-[12px] text-teal-700 leading-relaxed">
                    I confirm these items are <strong>unused, unexpired, and safe for transfer</strong> to another party.
                  </p>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={medCheck2}
                    onChange={(e) => setMedCheck2(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-teal-300 text-teal-600 focus:ring-teal-500 shrink-0"
                  />
                  <p className="text-[12px] text-teal-700 leading-relaxed">
                    I confirm I am <strong>not listing prescription medications, controlled substances, or sterile surgical equipment</strong>.
                  </p>
                </label>
              </div>
            )}

            {/* Security agreement */}
            <div
              className={`rounded-xl border p-4 transition-all ${
                agreed
                  ? "bg-green-50 border-green-200"
                  : "bg-slate-50 border-slate-200"
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">
                    Security & Compliance Agreement
                  </p>
                  <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">
                    I confirm this item is{" "}
                    <strong>legal, functional, and safe</strong> for transfer.
                    It contains no hazardous materials, stolen goods, or
                    prohibited content.
                  </p>
                </div>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || !user || !agreed}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-blue-200 hover:-translate-y-0.5 disabled:translate-y-0 text-[15px]"
            >
              {submitting ? (
                <>
                  <IconLoader /> Submitting…
                </>
              ) : (
                <>
                  <IconCheck />{" "}
                  {user
                    ? agreed
                      ? "Publish Listing"
                      : "Agree to Submit"
                    : "Sign In to Publish"}
                </>
              )}
            </button>
          </form>
        </div>
        <p className="text-center text-[12px] text-slate-400 mt-5">
          All listings are reviewed for community guidelines. Free to use, always.
        </p>
      </div>

      {/* ── Sidebar: tips, what happens next, trust badge ── */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <h3 className="text-[14px] font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center text-[14px]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-amber-600"><path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 01-1 1H9a1 1 0 01-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            Tips for a great listing
          </h3>
          <ul className="space-y-3 text-[13px] text-slate-600 leading-relaxed">
            <li className="flex gap-2.5">
              <span className="text-blue-500 font-bold shrink-0">1.</span>
              Add clear photos in good lighting — listings with photos get claimed up to 3x faster.
            </li>
            <li className="flex gap-2.5">
              <span className="text-blue-500 font-bold shrink-0">2.</span>
              Be specific in the title (e.g. "Dell Latitude 5420 Laptop" beats "Laptop").
            </li>
            <li className="flex gap-2.5">
              <span className="text-blue-500 font-bold shrink-0">3.</span>
              Mention condition and quantity in the description so recipients know exactly what to expect.
            </li>
            <li className="flex gap-2.5">
              <span className="text-blue-500 font-bold shrink-0">4.</span>
              Set an accurate pickup location so nearby recipients can find you first.
            </li>
          </ul>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
          <h3 className="text-[14px] font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center text-[14px]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-blue-600"><path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            What happens after you post
          </h3>
          <div className="space-y-4">
            {[
              { n: "1", t: "Goes live instantly", d: "Your item appears in the marketplace for recipients worldwide to browse." },
              { n: "2", t: "A recipient claims it", d: "You'll get a notification and can message them to arrange pickup." },
              { n: "3", t: "Verify with a PIN", d: "A secure 6-digit PIN confirms the handoff so nothing gets lost in transit." },
              { n: "4", t: "Track your impact", d: "Completed transfers count toward your Impact stats and Trusted Donor badge." },
            ].map(step => (
              <div key={step.n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step.n}</div>
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">{step.t}</p>
                  <p className="text-[12px] text-slate-500 leading-relaxed">{step.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-6 shadow-sm text-white">
          <div className="flex items-center gap-2 mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <h3 className="text-[14px] font-bold">Secure handoffs, always</h3>
          </div>
          <p className="text-[12px] text-blue-100 leading-relaxed">
            Every transfer on Eqovely is confirmed with a private PIN exchanged
            only between you and the recipient — nothing is marked transferred
            until you both verify it in person.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Mission Section ──────────────────────────────────────────────────────────
function MissionSection() {
  const cards = [
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-blue-600"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
      ),
      bg: "bg-blue-50",
      title: "Precision Matching",
      desc: "Our verification engine pairs corporate donors with recipient institutions based on item category, regional proximity, and organizational need — eliminating guesswork and ensuring every resource reaches maximum impact.",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-green-600"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ),
      bg: "bg-green-50",
      title: "End-to-End Security",
      desc: "From institutional credential verification at signup to our 6-digit Escrow Handshake PIN at physical pickup, every transaction on Eqovely is authenticated, logged, and protected at every stage.",
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-purple-600"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" strokeLinecap="round"/></svg>
      ),
      bg: "bg-purple-50",
      title: "Global Infrastructure",
      desc: "Operating across 60+ countries and all major world regions, Eqovely provides the only unified platform purpose-built to coordinate international resource redistribution at scale.",
    },
  ];
  return (
    <section id="mission" className="py-24 bg-white scroll-mt-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
            <span className="text-[12px] font-semibold text-blue-600 uppercase tracking-widest">Our Mission</span>
          </div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Bridging the Resource Gap, <br className="hidden sm:block" />One Transfer at a Time
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto text-[15px] leading-relaxed">
            Eqovely was founded on a singular belief: that geographic and economic circumstance should never determine whether a student, clinic, or community has access to the resources they need.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {cards.map(({ icon, bg, title, desc }) => (
            <div key={title} className="bg-slate-50 border border-slate-100 rounded-2xl p-7">
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center mb-4`}>{icon}</div>
              <h3 className="text-[17px] font-bold text-slate-900 mb-2">{title}</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-10 text-white text-center">
          <h3 className="text-2xl font-bold mb-3">A Message from Our Founder</h3>
          <p className="text-blue-100 text-[15px] leading-relaxed max-w-3xl mx-auto italic mb-4">
            "I built Eqovely because I witnessed firsthand how the gap between those who have resources and those who do not compounds every other inequality in education, healthcare, and economic opportunity. This platform is my answer to that problem — a structured, verified, and scalable bridge between surplus and need."
          </p>
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-lg font-bold">Y</div>
            <div className="text-left">
              <p className="font-semibold text-white text-[14px]">Younus Abdulkadir</p>
              <p className="text-blue-200 text-[12px]">Founder & CEO, Eqovely</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Partners Section ─────────────────────────────────────────────────────────
function PartnersSection() {
  const partners = [
    { name: "Velorix Technologies", type: "Corporate Donor",      region: "North America", logo: "VT" },
    { name: "Kivara Education Hub", type: "School District",      region: "East Africa",   logo: "KE" },
    { name: "Solendra Foundation",  type: "Non-Profit",           region: "South Asia",    logo: "SF" },
    { name: "Nuvex Research Group", type: "Research Institution", region: "Europe",        logo: "NR" },
    { name: "Orinova Aid Network",  type: "Non-Profit",           region: "Middle East",   logo: "OA" },
    { name: "Zeltara Industries",   type: "Corporate Donor",      region: "Asia Pacific",  logo: "ZI" },
  ];
  return (
    <section id="partners" className="py-24 bg-slate-50 scroll-mt-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            <span className="text-[12px] font-semibold text-green-600 uppercase tracking-widest">
              Our Partners
            </span>
          </div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight mb-4">
            The Organizations Driving Change
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto text-[15px] leading-relaxed">
            From Fortune 500 technology companies to grassroots school
            districts, our partner network spans every sector and every
            continent.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-14">
          {partners.map((p) => (
            <div
              key={p.name}
              className="bg-white border border-slate-100 rounded-2xl p-6 hover:border-blue-100 hover:shadow-lg transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-[15px] shrink-0">
                  {p.logo}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-[15px]">
                    {p.name}
                  </h3>
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    {p.type} · {p.region}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[12px] text-slate-500">Partner organization</span>
                <span className="text-[11px] font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                  Active Partner
                </span>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}

// ─── Impact Section ───────────────────────────────────────────────────────────
function ImpactSection() {
  return (
    <section id="impact" className="py-24 bg-white scroll-mt-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
            <span className="text-[12px] font-semibold text-amber-600 uppercase tracking-widest">
              Our Impact
            </span>
          </div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Our Goals. Our Vision.
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto text-[15px] leading-relaxed">
            These are the milestones Eqovely is built to reach — every transfer brings us closer to a world where technology access is universal.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-16">
          {[
            { value: "12,400+", label: "Items — Our Goal", sub: "to redistribute globally", color: "text-blue-600" },
            { value: "340+",    label: "Organizations",    sub: "we aim to connect",     color: "text-green-600" },
            { value: "98,000+", label: "lbs E-Waste",      sub: "target to divert",      color: "text-amber-600" },
            { value: "60+",     label: "Countries",        sub: "our platform supports",  color: "text-violet-600" },
          ].map(({ value, label, sub, color }) => (
            <div
              key={label}
              className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center"
            >
              <div className={`text-3xl font-bold tracking-tight ${color}`}>
                {value}
              </div>
              <div className="text-[13px] font-semibold text-slate-700 mt-1">
                {label}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-6 italic">
          * These figures represent Eqovely's platform goals and targets, not verified historical data. We are committed to reaching these milestones as our community grows.
        </p>
      </div>
    </section>
  );
}

// ─── Contact Modal ────────────────────────────────────────────────────────────
function ContactModal({ onClose }) {
  const trapRef = useFocusTrap(true);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={trapRef} className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">

        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close contact dialog"
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left — brand panel */}
          <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-8">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-4 h-4"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span className="font-bold text-white text-[15px] tracking-tight">Eqovely</span>
              </div>
              <h2 id="contact-modal-title" className="text-[26px] font-bold text-white leading-tight mb-3">
                Let's connect.
              </h2>
              <p className="text-blue-100 text-[13px] leading-relaxed">
                Whether you're a donor, recipient, partner organization, or just want to learn more — we're here.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-4 h-4"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <span className="text-blue-100 text-[13px]">eqovely@gmail.com</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span className="text-blue-100 text-[13px]">Reply within 24–48 hours</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" strokeLinecap="round"/></svg>
                </div>
                <span className="text-blue-100 text-[13px]">Operating in 60+ countries</span>
              </div>
            </div>
          </div>

          {/* Right — actions panel */}
          <div className="p-8 flex flex-col justify-center gap-4">
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-widest mb-1">How can we help?</p>

            {[
              {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-blue-600"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
                title: "General Inquiry",
                desc: "Questions about the platform or how it works",
                href: "mailto:eqovely@gmail.com",
                bg: "bg-blue-50 hover:bg-blue-100 border-blue-100",
              },
              {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-green-600"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round"/></svg>,
                title: "Partnership",
                desc: "Nonprofit, corporate, or institutional partnerships",
                href: "mailto:eqovely@gmail.com?subject=Partnership Inquiry",
                bg: "bg-green-50 hover:bg-green-100 border-green-100",
              },
              {
                icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-amber-600"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                title: "Report an Issue",
                desc: "Technical problems or content concerns",
                href: "mailto:eqovely@gmail.com?subject=Issue Report",
                bg: "bg-amber-50 hover:bg-amber-100 border-amber-100",
              },
            ].map(({ icon, title, desc, href, bg }) => (
              <a
                key={title}
                href={href}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all group focus:outline-none focus:ring-2 focus:ring-blue-500 ${bg}`}
              >
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{title}</p>
                  <p className="text-[12px] text-slate-500 truncate">{desc}</p>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 transition-colors"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            ))}

            <p className="text-[11px] text-slate-400 text-center mt-2">
              Founded by <span className="font-semibold text-slate-500">Younus Abdulkadir</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ onPrivacy }) {
  return (
    <footer className="bg-slate-900 text-white py-14">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-start justify-between gap-10">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center text-white">
                <IconLink />
              </div>
              <span className="font-semibold tracking-tight">Eqovely</span>
            </div>
            <p className="text-slate-400 text-[13px] leading-relaxed mb-3">
              Bridging the global resource gap through intelligent matching of
              corporate surplus with community need.
            </p>
            <p className="text-slate-500 text-[12px]">
              Founded by{" "}
              <span className="text-slate-300 font-medium">
                Younus Abdulkadir
              </span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-16 gap-y-3">
            <a href="#mission" className="text-[13px] text-slate-400 hover:text-white transition-colors">Mission</a>
            <a href="#browse" className="text-[13px] text-slate-400 hover:text-white transition-colors">Browse Surplus</a>
            <a href="#list" className="text-[13px] text-slate-400 hover:text-white transition-colors">List Resources</a>
            <a href="#how-it-works" className="text-[13px] text-slate-400 hover:text-white transition-colors">How It Works</a>
            <a href="#impact" className="text-[13px] text-slate-400 hover:text-white transition-colors">Our Goals</a>
            <button onClick={onPrivacy} className="text-[13px] text-slate-400 hover:text-white transition-colors text-left">Privacy Policy</button>
            <a href="mailto:eqovely@gmail.com" className="text-[13px] text-slate-400 hover:text-white transition-colors">Contact Us</a>
          </div>
          <div className="mt-6 md:mt-0">
            <p className="text-[12px] text-slate-500 mb-2">Get in touch</p>
            <a href="mailto:eqovely@gmail.com" className="flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors text-[13px] font-medium">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              eqovely@gmail.com
            </a>
          </div>
        </div>
        <div className="border-t border-slate-800 mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[12px] text-slate-500">
            © 2025 Eqovely. All rights reserved. Founded by Younus Abdulkadir.
          </p>
          <p className="text-[12px] text-slate-500">
            Built to create global equity, one resource at a time.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
// ─── Listing Detail Modal ────────────────────────────────────────────────────
function ListingDetailModal({ listing, user, onClose, onClaim, onOpenChat, onToast }) {
  const [imgIndex, setImgIndex] = useState(0);
  const [claiming, setClaiming] = useState(false);

  if (!listing) return null;

  // Parse images
  let images = [];
  try {
    const parsed = JSON.parse(listing.image_url);
    images = Array.isArray(parsed) ? parsed : [listing.image_url].filter(Boolean);
  } catch { images = listing.image_url ? [listing.image_url] : []; }

  const handleClaim = async () => {
    if (onClaim) {
      setClaiming(true);
      await onClaim(listing);
      setClaiming(false);
    }
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(`Check out this item on Eqovely: "${listing.title}" — ${window.location.origin}?listing=${listing.id}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?listing=${listing.id}`);
    if (onToast) onToast("Link copied!", "success");
  };

  const CATEGORY_COLORS = {
    "Electronics": "bg-blue-50 text-blue-700 border-blue-100",
    "Furniture": "bg-amber-50 text-amber-700 border-amber-100",
    "Office Supplies": "bg-purple-50 text-purple-700 border-purple-100",
    "Medical Supplies": "bg-teal-50 text-teal-700 border-teal-100",
    "Food & Groceries": "bg-green-50 text-green-700 border-green-100",
    "Clothing": "bg-pink-50 text-pink-700 border-pink-100",
    "Books & Education": "bg-indigo-50 text-indigo-700 border-indigo-100",
    "Other": "bg-slate-50 text-slate-600 border-slate-100",
  };
  const catStyle = CATEGORY_COLORS[listing.category] || CATEGORY_COLORS["Other"];
  const isDone = listing.status === "claimed" || listing.status === "transferred";
  const isOwner = user && user.email === listing.owner_email;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Close button */}
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-9 h-9 bg-white/90 backdrop-blur rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 shadow-sm transition-all">
          <IconX />
        </button>

        {/* Image carousel — full screen, high quality */}
        <div className="relative w-full bg-black shrink-0" style={{ height: "min(60vw, 420px)" }}>
          {images.length > 0 ? (
            <>
              {/* Full quality image — object-contain so nothing is cropped */}
              <img
                src={images[imgIndex]}
                alt={listing.title}
                className="w-full h-full object-contain"
                style={{ background: "#000" }}
              />
              {/* Subtle dark gradient at bottom for dots visibility */}
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
              {images.length > 1 && (
                <>
                  <button onClick={() => setImgIndex(i => (i - 1 + images.length) % images.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button onClick={() => setImgIndex(i => (i + 1) % images.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {/* White dot indicators */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 items-center">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setImgIndex(i)}
                        className={`rounded-full transition-all duration-300 ${
                          i === imgIndex
                            ? "w-5 h-2 bg-white"
                            : "w-2 h-2 bg-white/50 hover:bg-white/80"
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-100"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-300"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 3H8L6 7h12l-2-4z" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
          )}
        </div>

        {/* Content - scrollable */}
        <div className="overflow-y-auto flex-1 p-6">
          {/* Category + status */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${catStyle}`}>{listing.category}</span>
            {isDone && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">{listing.status === "claimed" ? "Claimed" : "Transferred"}</span>}
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-slate-900 mb-1 leading-tight">{listing.title}</h2>

          {/* Meta */}
          <div className="flex flex-wrap gap-3 text-[12px] text-slate-500 mb-4">
            {listing.location && <span className="flex items-center gap-1">📍 {listing.location}</span>}
            {listing.quantity && <span className="flex items-center gap-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 text-slate-400" aria-hidden="true"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" strokeLinecap="round"/></svg> Qty: {listing.quantity}</span>}
            {listing.condition && <span className="flex items-center gap-1">{listing.condition}</span>}
            {listing.created_at && <span className="flex items-center gap-1">🕐 {new Date(listing.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
          </div>

          {/* Description */}
          {listing.description && (
            <p className="text-[14px] text-slate-600 leading-relaxed mb-5 whitespace-pre-wrap">{listing.description}</p>
          )}

          {/* Divider */}
          <div className="h-px bg-slate-100 mb-5" />

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {!isDone && !isOwner && user && (
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3.5 rounded-2xl transition-all shadow-lg shadow-blue-200 text-[15px]"
              >
                {claiming ? <><IconLoader /> Claiming…</> : <><IconArrow /> Claim This Item</>}
              </button>
            )}
            {!isOwner && user && onOpenChat && listing.owner_email && (
              <button
                onClick={() => { onOpenChat(listing); onClose(); }}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-2xl transition-all text-[14px]"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Message Donor
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 bg-green-50 hover:bg-green-100 text-green-700 font-medium py-2.5 rounded-xl transition-all text-[13px] border border-green-100"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Share on WhatsApp
              </button>
              <button
                onClick={handleCopyLink}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-600 font-medium py-2.5 rounded-xl transition-all text-[13px] border border-slate-200"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Copy Link
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Impact View — fetches real counts from DB ────────────────────────────────
function ImpactView({ user, isDonor, isRecipient, refreshTrigger }) {
  const [stats, setStats] = useState({ posted: 0, transferred: 0, available: 0, claimed: 0 });
  const [loading, setLoading] = useState(true);
  const [manualRefresh, setManualRefresh] = useState(0);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const fetchStats = async () => {
      try {
        const token = getToken();
        if (isDonor) {
          // Fetch all listings ever posted by this user — every status,
          // including 'transferred', since those rows now persist instead
          // of being deleted. One query gives us posted/transferred/
          // available all at once, with nothing relying on a separate
          // counter table that could fall out of sync.
          const res = await fetch(
            `${SUPABASE_URL}/listings?owner_email=eq.${encodeURIComponent(user.email)}&select=id,status`,
            { headers: getHeaders(token) }
          );
          const all = res.ok ? await res.json() : [];
          const arr = Array.isArray(all) ? all : [];
          const transferred = arr.filter(l => l.status === "transferred").length;
          const available = arr.filter(l => l.status === "available").length;
          const posted = arr.length;
          setStats({ posted, transferred, available, claimed: 0 });
        } else if (isRecipient) {
          // Try both email and user.id as claimer_id (some records may use UUID)
          const [resEmail, resId] = await Promise.all([
            fetch(`${SUPABASE_URL}/listings?claimer_id=eq.${encodeURIComponent(user.email)}&select=id,status`, { headers: getHeaders(token) }),
            user.id ? fetch(`${SUPABASE_URL}/listings?claimer_id=eq.${encodeURIComponent(user.id)}&select=id,status`, { headers: getHeaders(token) }) : Promise.resolve(null),
          ]);
          const byEmail = resEmail.ok ? await resEmail.json() : [];
          const byId = resId && resId.ok ? await resId.json() : [];
          // Combine and deduplicate by id
          const allClaimed = [...(Array.isArray(byEmail) ? byEmail : []), ...(Array.isArray(byId) ? byId : [])];
          const uniqueClaimed = allClaimed.filter((l, i, arr) => arr.findIndex(x => x.id === l.id) === i);
          setStats({ posted: 0, transferred: 0, available: 0, claimed: uniqueClaimed.length });
        }
      } catch {}
      finally { setLoading(false); }
    };
    fetchStats();
  }, [user, isDonor, isRecipient, refreshTrigger, manualRefresh]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-[22px] font-bold text-slate-900 mb-2">My Impact</h1>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {[1,2,3].map(i => <div key={i} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm animate-pulse h-24" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[22px] font-bold text-slate-900">My Impact</h1>
        <button onClick={() => setManualRefresh(n => n + 1)} className="text-[12px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Refresh
        </button>
      </div>
      <p className="text-[13px] text-slate-500 mb-8">Your contribution to bridging the resource gap.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {isDonor && <>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm text-center">
            <p className="text-[36px] font-black text-blue-600">{stats.posted}</p>
            <p className="text-[12px] font-semibold text-slate-600 mt-1">Items Posted</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm text-center">
            <p className="text-[36px] font-black text-green-600">{stats.transferred}</p>
            <p className="text-[12px] font-semibold text-slate-600 mt-1">Transferred</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm text-center">
            <p className="text-[36px] font-black text-amber-500">{stats.available}</p>
            <p className="text-[12px] font-semibold text-slate-600 mt-1">Still Available</p>
          </div>
        </>}
        {isRecipient && (
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm text-center">
            <p className="text-[36px] font-black text-blue-600">{stats.claimed}</p>
            <p className="text-[12px] font-semibold text-slate-600 mt-1">Items Claimed</p>
          </div>
        )}
      </div>
      {isDonor && stats.transferred >= 3 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-center gap-4">
          <span className="text-3xl">🏆</span>
          <div>
            <p className="text-[14px] font-bold text-blue-800">Trusted Donor Badge</p>
            <p className="text-[12px] text-blue-600">You have completed {stats.transferred} verified transfers. Thank you!</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSave = async () => {
    setError(""); setSuccess("");
    if (!next || next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const res = await fetch(`${AUTH_URL}/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ password: next }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed to update password."); }
      setSuccess("Password updated successfully!");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"><IconX /></button>
        <h3 className="text-[17px] font-bold text-slate-900 mb-5">Change Password</h3>
        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>}
        {success && <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-[13px] text-green-700">{success}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">New Password</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="Min 8 characters" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Confirm New Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat new password" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all text-[14px]">
            {saving ? <><IconLoader /> Saving…</> : <><IconCheck /> Update Password</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Enter PIN Button (used in My Listings dashboard) ─────────────────────────
function EnterPinButton({ listing, user, onTransferred }) {
  const [show, setShow] = useState(false);
  const [input, setInput] = useState("");
  const [realPin, setRealPin] = useState(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const openModal = async () => {
    setShow(true);
    setError("");
    setInput("");
    setPinLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/listings?id=eq.${listing.id}&select=verification_pin`,
        { headers: getHeaders(getToken()) }
      );
      if (res.ok) {
        const data = await res.json();
        setRealPin(data?.[0]?.verification_pin ?? null);
      }
    } catch {}
    finally { setPinLoading(false); }
  };

  const handleVerify = async () => {
    if (attempts >= 3) { setError("Too many attempts. Contact the claimer."); return; }
    if (!input.trim()) { setError("Please enter the PIN."); return; }
    if (realPin === null) { setError("Could not load PIN. Please try again."); return; }
    if (String(input.trim()) !== String(realPin)) {
      setAttempts(a => a + 1);
      setError(`Incorrect PIN. ${2 - attempts} attempt${attempts < 2 ? "s" : ""} remaining.`);
      return;
    }
    setSaving(true);
    try {
      // Mark as transferred — keep the row (do NOT delete it). The previous
      // delete-on-transfer was the reason "Units Transferred" and "Items
      // Claimed" never worked: the row backing those stats vanished the
      // moment a transfer completed.
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "PATCH",
        headers: getHeaders(getToken()),
        body: JSON.stringify({ status: "transferred" }),
      });
      if (!res.ok) throw new Error("Transfer failed. Please try again.");
      setShow(false);
      if (onTransferred) onTransferred(listing.id);
    } catch (err) {
      setError("Transfer failed. Please try again.");
    } finally { setSaving(false); }
  };

  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-all shadow-sm"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round"/></svg>
        Enter Recipient PIN
      </button>

      {show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShow(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
            <button onClick={() => setShow(false)} aria-label="Close" className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"><IconX /></button>
            <div className="text-center mb-5">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-blue-600"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round"/></svg>
              </div>
              <h3 className="text-[17px] font-bold text-slate-900">Verify Transfer</h3>
              <p className="text-[13px] text-slate-500 mt-1">Enter the 6-digit PIN shown on the recipient's screen</p>
            </div>
            {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">{error}</div>}
            {pinLoading ? (
              <div className="flex justify-center py-4"><IconLoader /></div>
            ) : (
              <div className="space-y-4">
                <input
                  type="text"
                  maxLength={6}
                  value={input}
                  onChange={e => setInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && handleVerify()}
                  placeholder="Enter PIN"
                  className="w-full text-center text-[28px] font-black tracking-[0.3em] bg-slate-50 border-2 border-slate-200 focus:border-blue-500 rounded-2xl px-4 py-4 focus:outline-none transition-all text-slate-900"
                  autoFocus
                />
                <button
                  onClick={handleVerify}
                  disabled={saving || !input.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-2xl transition-all text-[15px]"
                >
                  {saving ? <><IconLoader /> Verifying…</> : "Complete Transfer ✓"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Full Facebook-Style Dashboard ───────────────────────────────────────────
function Dashboard({
  user, dashView, setDashView, onSignOut, unreadCount,
  onOpenChat, onOpenInbox, refreshTrigger, onRefresh, allListings, onListingsLoaded,
  activeChatListing, onClearActiveChat, onUserUpdate
}) {
  const DONOR_TYPES_D = ["Individual Donor", "Corporate/Lab Donor"];
  const RECIPIENT_TYPES_D = ["School/Non-Profit Recipient", "Individual Recipient"];
  const isRecipient = RECIPIENT_TYPES_D.includes(user?.account_type || "");
  const isDonor = DONOR_TYPES_D.includes(user?.account_type || "");
  const initials = (user?.username || user?.org_name || user?.email || "U").slice(0, 2).toUpperCase();
  const [showLandingPreview, setShowLandingPreview] = useState(false);

  const navItems = [
    { id: "feed", label: "Home Feed", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="9 22 9 12 15 12 15 22" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )},
    ...(isDonor ? [{ id: "mylistings", label: "My Listings", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/><polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )}] : []),
    ...(isRecipient ? [{ id: "claimed", label: "Claimed Items", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )}] : []),
    { id: "messages", label: "Messages", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ), badge: unreadCount > 0 ? unreadCount : null },
    { id: "impact", label: "My Impact", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )},
    { id: "settings", label: "Settings", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )},
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* ── LEFT SIDEBAR (desktop only) ── */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-100 fixed top-0 left-0 h-full z-30 shadow-sm">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-100">
          <span className="text-[20px] font-black text-blue-600 tracking-tight">Eqovely</span>
          <p className="text-[10px] text-slate-400 mt-0.5">Bridging the resource gap</p>
        </div>

        {/* User profile card */}
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Profile" className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[14px] shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-slate-900 truncate">{user?.username || user?.org_name || "User"}</p>
              <p className="text-[10px] text-slate-500 truncate">{user?.account_type}</p>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setDashView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all relative ${
                dashView === item.id
                  ? "bg-blue-50 text-blue-700 font-semibold"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {item.icon}
              {item.label}
              {item.badge && (
                <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Post item button — donors only */}
        {isDonor && (
          <div className="px-4 pb-4">
            <button
              onClick={() => setDashView("post")}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-[13px] transition-all shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
              Post an Item
            </button>
          </div>
        )}

        {/* View Public Site */}
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowLandingPreview(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" strokeLinecap="round"/></svg>
            View Public Site
          </button>
        </div>

        {/* Sign out */}
        <div className="px-4 pb-5 border-t border-slate-100 pt-3">
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" strokeLinejoin="round"/><polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round"/><line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round"/></svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── LANDING PAGE PREVIEW OVERLAY ── */}
      {showLandingPreview && (
        <div className="fixed inset-0 z-[200] bg-white overflow-y-auto">
          {/* Sticky close bar */}
          <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-100 flex items-center justify-between px-5 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-[16px] font-black text-blue-600 tracking-tight">Eqovely</span>
              <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">Public View</span>
            </div>
            <button
              onClick={() => setShowLandingPreview(false)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-700 text-white text-[13px] font-semibold px-4 py-2 rounded-xl transition-all"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Back to Dashboard
            </button>
          </div>
          {/* Landing page content */}
          <Hero onBrowse={() => setShowLandingPreview(false)} onDonate={() => setShowLandingPreview(false)} />
          <HowItWorksSection onBrowse={() => setShowLandingPreview(false)} onDonate={() => setShowLandingPreview(false)} onAuth={() => setShowLandingPreview(false)} user={user} />
          <ImpactSection />
          <Footer onPrivacy={() => {}} />
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 md:ml-64 pb-20 md:pb-0 min-h-screen">
        <DashboardContent
          view={dashView}
          setView={setDashView}
          user={user}
          isRecipient={isRecipient}
          isDonor={isDonor}
          onOpenChat={onOpenChat}
          onOpenInbox={onOpenInbox}
          refreshTrigger={refreshTrigger}
          onRefresh={onRefresh}
          allListings={allListings}
          onListingsLoaded={onListingsLoaded}
          unreadCount={unreadCount}
          onSignOut={onSignOut}
          activeChatListing={activeChatListing}
          onClearActiveChat={onClearActiveChat}
          onUserUpdate={onUserUpdate}
        />
      </main>

      {/* ── MOBILE BOTTOM NAV ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-slate-100 flex items-center justify-around px-1 py-1 shadow-lg">
        {navItems.filter(n => ["feed","mylistings","claimed","messages","settings"].includes(n.id)).slice(0,5).map(item => (
          <button
            key={item.id}
            onClick={() => setDashView(item.id)}
            className={`relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all ${
              dashView === item.id ? "text-blue-600" : "text-slate-400 hover:text-slate-700"
            }`}
          >
            {item.icon}
            <span className="text-[9px] font-medium">{item.label.split(" ")[0]}</span>
            {item.badge && <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{item.badge}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard Content Router ─────────────────────────────────────────────────
function DashboardContent({ view, setView, user, isRecipient, isDonor, onOpenChat, onOpenInbox, refreshTrigger, onRefresh, allListings, onListingsLoaded, unreadCount, onSignOut, activeChatListing, onClearActiveChat, onUserUpdate }) {
  const [myListings, setMyListings] = useState([]);
  const [claimedItems, setClaimedItems] = useState([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [loadingClaimed, setLoadingClaimed] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [settingsUsername, setSettingsUsername] = useState(user?.username || "");
  const [settingsOrgName, setSettingsOrgName] = useState(user?.org_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const showToast = useToast();

  // Fetch MY listings (donor view)
  useEffect(() => {
    if (view !== "mylistings" || !user) return;
    setLoadingMine(true);
    fetch(
      `${SUPABASE_URL}/listings?owner_email=eq.${encodeURIComponent(user.email)}&order=created_at.desc&select=*`,
      { headers: getHeaders(getToken()) }
    )
      .then(r => r.json())
      .then(d => setMyListings(Array.isArray(d) ? d : []))
      .catch(() => setMyListings([]))
      .finally(() => setLoadingMine(false));
  }, [view, user, refreshTrigger]);

  // Fetch CLAIMED items (recipient view) — fetch listings where this user is claimer
  useEffect(() => {
    if (view !== "claimed" || !user) return;
    setLoadingClaimed(true);
    fetch(
      `${SUPABASE_URL}/listings?claimer_id=eq.${encodeURIComponent(user.email)}&order=created_at.desc&select=*`,
      { headers: getHeaders(getToken()) }
    )
      .then(r => r.json())
      .then(d => setClaimedItems(Array.isArray(d) ? d : []))
      .catch(() => setClaimedItems([]))
      .finally(() => setLoadingClaimed(false));
  }, [view, user, refreshTrigger]);

  const saveSettings = async () => {
    if (!settingsUsername.trim()) { setSettingsError("Username cannot be empty."); return; }
    setSettingsSaving(true); setSettingsError(""); setSettingsSuccess("");
    try {
      const res = await fetch(`${AUTH_URL}/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ data: {
          username: settingsUsername.trim(),
          org_name: settingsOrgName.trim(),
          account_type: user?.account_type || "",
          phone: user?.phone || "",
          region: user?.region || "",
          email: user?.email || "",
          institution_domain: user?.institution_domain || "",
          tax_id: user?.tax_id || "",
        } }),
      });
      if (!res.ok) throw new Error("Failed to save.");
      const updated = { ...user, username: settingsUsername.trim(), org_name: settingsOrgName.trim() };
      localStorage.setItem("eq_user", JSON.stringify(updated));
      if (onUserUpdate) onUserUpdate(updated);
      setSettingsSuccess("Profile saved!");
    } catch (err) { setSettingsError(err.message); }
    finally { setSettingsSaving(false); }
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) { showToast("Image must be under 10MB.", "error"); return; }

    // Instant local preview while upload runs
    const previousAvatar = avatarUrl;
    const localPreview = URL.createObjectURL(file);
    setAvatarUrl(localPreview);
    setAvatarUploading(true);
    try {
      // Resize to 400×400 max — keeps files small while allowing decent quality
      const resized = await new Promise((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          const MAX = 400;
          const scale = Math.min(MAX / img.width, MAX / img.height, 1);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Resize failed")), "image/jpeg", 0.88);
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error("Could not read image.")); };
        img.src = objUrl;
      });

      // Upload to Supabase Storage — stores a real URL, not a 20KB base64 in the JWT
      const safeId = (user?.id || user?.email || "user").replace(/[^a-z0-9]/gi, "");
      const filename = `${safeId}-${Date.now()}.jpg`;
      const uploadRes = await fetch(
        `${SUPABASE_STORAGE}/object/profile-photos/${filename}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "image/jpeg",
          },
          body: resized,
        }
      );
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.message || "Upload failed. Check that your 'profile-photos' bucket exists and is public in Supabase Storage.");
      }
      const url = `${SUPABASE_STORAGE}/object/public/profile-photos/${filename}`;

      // Save URL to auth metadata — tiny string instead of a 20KB base64 blob
      const metaRes = await fetch(`${AUTH_URL}/user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ data: {
          username: user?.username || "", org_name: user?.org_name || "",
          account_type: user?.account_type || "", phone: user?.phone || "",
          region: user?.region || "", email: user?.email || "",
          institution_domain: user?.institution_domain || "", tax_id: user?.tax_id || "",
          avatar_url: url,
        }}),
      });
      if (!metaRes.ok) throw new Error("Profile update failed. Please try again.");
      setAvatarUrl(url);
      const updated = { ...user, avatar_url: url };
      localStorage.setItem("eq_user", JSON.stringify(updated));
      if (onUserUpdate) onUserUpdate(updated);
      showToast("Profile photo updated!", "success");
    } catch (err) {
      setAvatarUrl(previousAvatar);
      showToast(err.message || "Failed to update photo.", "error");
    } finally {
      setAvatarUploading(false);
      URL.revokeObjectURL(localPreview);
    }
  };

  const STATUS_BADGE = {
    available: "bg-green-100 text-green-700",
    pending: "bg-amber-100 text-amber-700",
    claimed: "bg-amber-100 text-amber-700",
    transferred: "bg-slate-100 text-slate-500",
  };
  const STATUS_LABEL = { available: "Available", pending: "Claimed", claimed: "Claimed", transferred: "Transferred" };

  // ── FEED ──
  if (view === "feed" || view === "post") {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">
              {view === "post" ? "Post an Item" : "Browse Listings"}
            </h1>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {view === "post" ? "List your surplus for those who need it" : "Available items from donors worldwide"}
            </p>
          </div>
          {isDonor && view === "feed" && (
            <button
              onClick={() => setView("post")}
              className="hidden md:flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl text-[13px] transition-all shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
              Post Item
            </button>
          )}
        </div>
        {view === "post" && isDonor ? (
          <FormSectionInline onSuccess={() => { onRefresh(); setView("mylistings"); }} user={user} />
        ) : (
          <ListingsSection
            refreshTrigger={refreshTrigger}
            user={user}
            onOpenChat={onOpenChat}
            onListingsLoaded={onListingsLoaded}
            onClaimSuccess={onRefresh}
            dashMode={true}
          />
        )}
      </div>
    );
  }

  // ── MY LISTINGS (donors) ──
  if (view === "mylistings") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">My Listings</h1>
            <p className="text-[13px] text-slate-500 mt-0.5">Items you have posted</p>
          </div>
          <button
            onClick={() => setView("post")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl text-[13px] transition-all shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
            Post New
          </button>
        </div>
        {loadingMine ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <SkeletonRow key={i} />)}</div>
        ) : myListings.length === 0 ? (
          <EmptyState
            icon="box"
            title="No listings yet"
            body="Post your first surplus item and connect it with someone who needs it. It takes less than 2 minutes."
            action="Post an Item"
            onAction={() => setView("post")}
          />
        ) : (
          <div className="space-y-3">
            {myListings.map(l => {
              let img = null;
              try { const p = JSON.parse(l.image_url); img = Array.isArray(p) ? p[0] : l.image_url; } catch { img = l.image_url; }
              return (
                <div key={l.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-all">
                  <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                    {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-slate-50"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-300"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 3H8L6 7h12l-2-4z" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-slate-900 truncate">{l.title}</p>
                    <p className="text-[12px] text-slate-500 mt-0.5">{l.category} · {timeAgo(l.created_at)}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[l.status] || "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABEL[l.status] || l.status}
                    </span>
                    {l.quantity && <span className="text-[11px] text-slate-400">Qty: {l.quantity}</span>}
                    {/* Enter PIN button — only when item is claimed/pending and not yet transferred */}
                    {(l.status === "claimed" || l.status === "pending") && (
                      <EnterPinButton
                        listing={l}
                        user={user}
                        onTransferred={() => {
                          setMyListings(prev => prev.filter(x => x.id !== l.id));
                          if (onRefresh) onRefresh();
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── CLAIMED ITEMS (recipients) ──
  if (view === "claimed") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-slate-900">Claimed Items</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Items you have claimed — show your PIN at pickup</p>
        </div>
        {loadingClaimed ? (
          <div className="space-y-3">{[1,2,3].map(i => <SkeletonRow key={i} />)}</div>
        ) : claimedItems.length === 0 ? (
          <EmptyState
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-400"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>}
            title="No claimed items yet"
            body="Browse available listings and claim what your school, clinic, or organization needs."
            action="Browse Listings"
            onAction={() => setView("feed")}
          />
        ) : (
          <div className="space-y-4">
            {claimedItems.map(l => {
              let img = null;
              try { const p = JSON.parse(l.image_url); img = Array.isArray(p) ? p[0] : l.image_url; } catch { img = l.image_url; }
              return (
                <div key={l.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                      {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-slate-50"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-300"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 3H8L6 7h12l-2-4z" strokeLinecap="round" strokeLinejoin="round"/></svg></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[15px] font-bold text-slate-900">{l.title}</p>
                        <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[l.status] || "bg-slate-100 text-slate-500"}`}>
                          {STATUS_LABEL[l.status] || l.status}
                        </span>
                      </div>
                      <p className="text-[12px] text-slate-500 mt-0.5">{l.category} · {l.location} · {timeAgo(l.created_at)}</p>
                      {l.owner_org_name && <p className="text-[12px] text-slate-500 mt-0.5">From: {l.owner_org_name}</p>}
                    </div>
                  </div>
                  {/* PIN display — only for this user's claimed item */}
                  {l.verification_pin && (
                    <div className="mt-4 bg-blue-50 border border-blue-200 rounded-2xl p-4">
                      <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide mb-2">Your Pickup PIN</p>
                      <div className="flex items-center gap-3">
                        <span className="text-[32px] font-black text-blue-700 tracking-widest">{l.verification_pin}</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(String(l.verification_pin))}
                          className="flex items-center gap-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-3 py-1.5 rounded-lg transition-all"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                          Copy
                        </button>
                      </div>
                      <p className="text-[11px] text-blue-500 mt-2">Show this PIN to the donor at pickup to complete the transfer.</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── MESSAGES ──
  if (view === "messages") {
    return (
      <div className="fixed inset-0 md:static md:inset-auto flex flex-col bg-white md:h-screen z-20">
        <InboxModal
          user={user}
          onClose={() => setView("feed")}
          onOpenChat={onOpenChat}
          allListings={allListings}
          inline={true}
          autoOpenListing={activeChatListing}
          onAutoOpenHandled={onClearActiveChat}
        />
      </div>
    );
  }

  // ── IMPACT ──
  if (view === "impact") {
    return <ImpactView user={user} isDonor={isDonor} isRecipient={isRecipient} refreshTrigger={refreshTrigger} />;
  }

  // ── SETTINGS ──
  if (view === "settings") {
    return (
      <div className="max-w-xl mx-auto px-4 py-6">
        <h1 className="text-[22px] font-bold text-slate-900 mb-6">Settings</h1>
        {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}

        {/* Profile */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm mb-4">
          <h2 className="text-[15px] font-bold text-slate-800 mb-4">Profile</h2>
          <div className="space-y-4">
            {/* Profile picture */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0 group">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-20 h-20 rounded-full object-cover border-2 border-slate-200 shadow-sm transition-all group-hover:border-blue-300" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-[24px] shadow-sm transition-all group-hover:from-blue-600 group-hover:to-blue-800">
                    {(user?.username || user?.email || "U").slice(0,2).toUpperCase()}
                  </div>
                )}
                {avatarUploading && (
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                    <IconLoader />
                  </div>
                )}
              </div>
              <div>
                <label className="cursor-pointer inline-flex items-center gap-2 text-[13px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-xl transition-all">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {avatarUploading ? "Uploading…" : "Change Photo"}
                  <input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); e.target.value = ""; }} disabled={avatarUploading} />
                </label>
                <p className="text-[11px] text-slate-400 mt-1">Take a photo or choose from your library · Max 5MB</p>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Display Name</label>
              <input value={settingsUsername} onChange={e => setSettingsUsername(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
            {["Corporate/Lab Donor","School/Non-Profit Recipient"].includes(user?.account_type) && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Organisation Name</label>
                <input value={settingsOrgName} onChange={e => setSettingsOrgName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
              </div>
            )}
            <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-[12px]">
              <p><span className="font-semibold text-slate-700">Email:</span> <span className="text-slate-500">{user?.email}</span></p>
              <p><span className="font-semibold text-slate-700">Account type:</span> <span className="text-slate-500">{user?.account_type}</span></p>
              <p><span className="font-semibold text-slate-700">Region:</span> <span className="text-slate-500">{user?.region || "Not set"}</span></p>
            </div>
            {settingsError && <p className="text-[12px] text-red-500">{settingsError}</p>}
            {settingsSuccess && <p className="text-[12px] text-green-600">{settingsSuccess}</p>}
            <button onClick={saveSettings} disabled={settingsSaving} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl transition-all text-[14px]">
              {settingsSaving ? <><IconLoader /> Saving…</> : <><IconCheck /> Save Changes</>}
            </button>
          </div>
        </div>

        {/* Security */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm mb-4">
          <h2 className="text-[15px] font-bold text-slate-800 mb-4">Security</h2>
          <button onClick={() => setShowChangePwd(true)} className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-xl text-[13px] font-medium text-slate-700 hover:text-blue-700 transition-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round"/></svg>
            Change Password
          </button>
        </div>

        {/* Data & Privacy — GDPR */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm mb-4">
          <h2 className="text-[15px] font-bold text-slate-800 mb-1">Data & Privacy</h2>
          <p className="text-[12px] text-slate-500 mb-4">You have the right to access and download all data Eqovely holds about you.</p>
          <button
            onClick={async () => {
              try {
                const token = getToken();
                const headers = getHeaders(token);
                const [listingsRes, messagesRes, notifRes] = await Promise.all([
                  fetch(`${SUPABASE_URL}/listings?owner_email=eq.${encodeURIComponent(user.email)}&select=id,title,category,status,created_at,location`, { headers }),
                  fetch(`${SUPABASE_URL}/messages?or=(sender_email.eq.${encodeURIComponent(user.email)},receiver_id.eq.${encodeURIComponent(user.email)})&select=id,message_text,sender_email,receiver_id,created_at&limit=500`, { headers }),
                  fetch(`${SUPABASE_URL}/notifications?recipient_email=eq.${encodeURIComponent(user.email)}&select=id,message,type,created_at`, { headers }),
                ]);
                const export_data = {
                  exported_at: new Date().toISOString(),
                  profile: { email: user.email, username: user.username, account_type: user.account_type, region: user.region, org_name: user.org_name },
                  listings: listingsRes.ok ? await listingsRes.json() : [],
                  messages: messagesRes.ok ? await messagesRes.json() : [],
                  notifications: notifRes.ok ? await notifRes.json() : [],
                };
                const blob = new Blob([JSON.stringify(export_data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `eqovely-data-${user.email}-${Date.now()}.json`; a.click();
                URL.revokeObjectURL(url);
                if (showToast) showToast("Your data has been downloaded.", "success");
              } catch { if (showToast) showToast("Export failed. Please try again.", "error"); }
            }}
            className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-xl text-[13px] font-medium text-slate-700 hover:text-blue-700 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 shrink-0" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Download My Data (GDPR Export)
          </button>
        </div>

        {/* Danger zone */}
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <h2 className="text-[15px] font-bold text-red-800 mb-2">Danger Zone</h2>
          <p className="text-[12px] text-red-600 mb-4 leading-relaxed">Permanently delete your account, listings, messages, and notifications. This cannot be undone.</p>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="w-full py-2.5 text-[13px] font-semibold text-red-600 border border-red-300 hover:bg-red-100 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-red-500">
              Delete My Account
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-red-700 font-semibold text-center">This will permanently delete everything. Are you absolutely sure?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 text-[13px] font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-100 transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      const token = getToken();
                      const h = getHeaders(token);
                      // Delete all user data in order
                      await fetch(`${SUPABASE_URL}/notifications?recipient_email=eq.${encodeURIComponent(user.email)}`, { method: "DELETE", headers: h });
                      await fetch(`${SUPABASE_URL}/messages?sender_email=eq.${encodeURIComponent(user.email)}`, { method: "DELETE", headers: h });
                      await fetch(`${SUPABASE_URL}/listings?owner_email=eq.${encodeURIComponent(user.email)}`, { method: "DELETE", headers: h });
                      // Delete the auth account via Supabase admin — requires service role in Edge Function
                      // For now: sign out and clear all local data
                      localStorage.clear();
                      sessionStorage.clear();
                      if (onSignOut) onSignOut();
                    } catch {
                      if (showToast) showToast("Deletion failed. Please contact support.", "error");
                    }
                  }}
                  className="flex-1 py-2.5 text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Yes, Delete Everything
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ─── FormSection inline (used inside dashboard post view) ────────────────────
function FormSectionInline({ onSuccess, user }) {
  return (
    <div className="w-full">
      <FormSection onSuccess={onSuccess} user={user} />
    </div>
  );
}

// ─── Landing Preview (blurred cards for logged-out users) ───────────────────
function LandingListingPreview({ onAuth }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/listings?select=id,title,category,location,image_url,created_at,status&status=eq.available&order=created_at.desc&limit=3`,
          { headers: getHeaders() }
        );
        if (res.ok) {
          const data = await res.json();
          setListings(Array.isArray(data) ? data.slice(0, 3) : []);
        }
      } catch {}
      finally { setLoading(false); }
    };
    fetchPreview();
  }, []);

  const CATEGORY_COLORS_PREVIEW = {
    "Electronics": "bg-blue-50 text-blue-700",
    "Furniture": "bg-amber-50 text-amber-700",
    "Office Supplies": "bg-purple-50 text-purple-700",
    "Medical Supplies": "bg-teal-50 text-teal-700",
    "Food & Groceries": "bg-green-50 text-green-700",
    "Clothing": "bg-pink-50 text-pink-700",
    "Books & Education": "bg-indigo-50 text-indigo-700",
    "Other": "bg-slate-50 text-slate-700",
  };

  const placeholders = [1, 2, 3];

  return (
    <section className="py-20 bg-slate-50 border-t border-slate-100">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[12px] font-semibold text-green-700 tracking-widest uppercase">Live right now</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 mb-3 tracking-tight">
            Items waiting to be claimed.
          </h2>
          <p className="text-slate-500 text-[15px] max-w-md mx-auto leading-relaxed">
            Real surplus from real organizations — sign in to see everything and claim what you need.
          </p>
        </div>

        <div className="relative">
          {/* Card grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading
              ? placeholders.map((i) => (
                  <div key={i} className="bg-white border border-slate-100 rounded-2xl overflow-hidden animate-pulse">
                    <div className="w-full h-44 bg-slate-100" />
                    <div className="p-5 space-y-3">
                      <div className="h-4 bg-slate-100 rounded-full w-3/4" />
                      <div className="h-3 bg-slate-100 rounded-full w-1/2" />
                      <div className="h-3 bg-slate-100 rounded-full w-full" />
                    </div>
                  </div>
                ))
              : (listings.length > 0 ? listings : placeholders.map((_, i) => ({
                  id: i, title: "Available Item", category: "Other", location: "Global", image_url: null, status: "available"
                }))).map((listing, i) => {
                const catStyle = CATEGORY_COLORS_PREVIEW[listing.category] || CATEGORY_COLORS_PREVIEW["Other"];
                let imgUrl = null;
                try {
                  const parsed = JSON.parse(listing.image_url);
                  imgUrl = Array.isArray(parsed) ? parsed[0] : listing.image_url;
                } catch { imgUrl = listing.image_url; }
                return (
                  <div key={listing.id || i} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm select-none">
                    {/* Image area */}
                    <div className="relative w-full h-44 bg-slate-100 overflow-hidden">
                      {imgUrl ? (
                        <img src={imgUrl} alt="" className="w-full h-full object-cover blur-sm scale-110" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-100"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-slate-300"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 3H8L6 7h12l-2-4z" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                      )}
                      {/* Lock overlay */}
                      <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-1">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-slate-400">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round"/>
                          </svg>
                          <span className="text-[11px] font-semibold text-slate-500">Sign in to view</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${catStyle}`}>{listing.category}</span>
                      </div>
                      {/* Blurred title */}
                      <div className="h-4 bg-slate-200 rounded-full w-3/4 mb-1.5 blur-[3px]" />
                      <div className="h-3 bg-slate-100 rounded-full w-1/2 blur-[3px]" />
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Fade + CTA overlay at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent pointer-events-none" />
        </div>

        {/* CTA */}
        <div className="mt-8 flex flex-col items-center gap-4">
          <button
            onClick={onAuth}
            className="group flex items-center gap-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold px-10 py-4 rounded-2xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1 text-[16px]"
          >
            Join free and browse everything
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 group-hover:translate-x-1 transition-transform"><path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="flex items-center gap-4 text-[12px] text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-4 h-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-[9px]">✓</span> Free forever</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-[9px]">✓</span> No credit card</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-[9px]">✓</span> Verified listings</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Catches any JavaScript error in the component tree and shows a friendly
// recovery screen instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    this.setState({ info });
    // In production you'd send this to Sentry / your error tracking service
    console.error("[Eqovely] Unhandled error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-5 text-3xl">⚠️</div>
          <h1 className="text-[22px] font-bold text-slate-900 mb-2">Something went wrong</h1>
          <p className="text-[14px] text-slate-500 max-w-sm mb-6">
            An unexpected error occurred. Your data is safe. Please try refreshing the page.
          </p>
          <button
            onClick={() => { this.setState({ error: null, info: null }); }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-all mr-3"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold px-6 py-3 rounded-xl transition-all"
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showAuth, setShowAuth] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetToken, setResetToken] = useState(null);
  const [chatListing, setChatListing] = useState(null);
  const [activeChatListing, setActiveChatListing] = useState(null);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [allListings, setAllListings] = useState([]);
  const [dashView, setDashView] = useState("feed");
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [user, setUser] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("eq_user"));
      const token = localStorage.getItem("eq_token");
      if (!u || !token) return null;
      if (!u.account_type) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          const m = payload.user_metadata || {};
          if (m.account_type) { u.account_type = m.account_type; localStorage.setItem("eq_user", JSON.stringify(u)); }
        } catch {}
      }
      return u;
    } catch { return null; }
  });

  // ── Handle password reset URL — Supabase sends users back to the app with
  // #access_token=...&type=recovery in the URL hash after clicking reset link
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") || hash.includes("type=signup")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const token = params.get("access_token");
      if (token && hash.includes("type=recovery")) {
        setResetToken(token);
        setShowPasswordReset(true);
        // Clean the URL so token isn't visible in browser history
        window.history.replaceState(null, "", window.location.pathname);
      } else if (hash.includes("type=signup")) {
        // Email confirmed — show success message
        window.history.replaceState(null, "", window.location.pathname);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("eq:toast", { detail: { message: "Email confirmed! You can now sign in.", type: "success" } }));
        }, 500);
        setShowAuth(true);
      }
    }
  }, []);

  // ── Session expired listener — sign user out with clear message ─────────────
  const showToastGlobal = useToast();
  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      setShowAuth(true);
      showToastGlobal("Your session expired. Please sign in again.", "error");
    };
    const handleToast = (e) => {
      if (e.detail?.message) showToastGlobal(e.detail.message, e.detail.type || "info");
    };
    window.addEventListener("eq:session-expired", handleExpired);
    window.addEventListener("eq:toast", handleToast);
    return () => {
      window.removeEventListener("eq:session-expired", handleExpired);
      window.removeEventListener("eq:toast", handleToast);
    };
  }, [showToastGlobal]);

  // ── Auto token refresh — keeps user logged in ────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const refreshSession = async () => {
      try {
        const token = getToken();
        if (!token) return;
        const payload = JSON.parse(atob(token.split(".")[1]));
        const expiresIn = payload.exp * 1000 - Date.now();
        // If token expires in less than 10 minutes, refresh it
        if (expiresIn < 10 * 60 * 1000) {
          const refreshToken = localStorage.getItem("eq_refresh_token");
          if (!refreshToken) return;
          const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (res.ok) {
            const refreshText = await res.text();
            let data = {};
            try { data = refreshText ? JSON.parse(refreshText) : {}; } catch { data = {}; }
            if (data.access_token) {
              localStorage.setItem("eq_token", data.access_token);
              if (data.refresh_token) localStorage.setItem("eq_refresh_token", data.refresh_token);
              // Preserve account_type from stored user — never overwrite with empty metadata
              if (data.user?.user_metadata) {
                const m = data.user.user_metadata;
                let storedUser = {};
                try { storedUser = JSON.parse(localStorage.getItem("eq_user") || "{}"); } catch {}
                const refreshedUser = {
                  id: data.user.id,
                  email: data.user.email,
                  username: m.username || storedUser.username || "",
                  phone: m.phone || storedUser.phone || "",
                  org_name: m.org_name || storedUser.org_name || "",
                  region: m.region || storedUser.region || "",
                  account_type: m.account_type || storedUser.account_type || "",
                  institution_domain: m.institution_domain || storedUser.institution_domain || "",
                  tax_id: m.tax_id || storedUser.tax_id || "",
                  avatar_url: m.avatar_url || storedUser.avatar_url || "",
                };
                localStorage.setItem("eq_user", JSON.stringify(refreshedUser));
              }
            } else {
              // Token returned but no access_token — force sign out
              localStorage.removeItem("eq_token");
              localStorage.removeItem("eq_refresh_token");
              localStorage.removeItem("eq_user");
              setUser(null);
            }
          } else {
            // Refresh failed (token expired/revoked) — sign out with a clear message
            // instead of leaving the user stuck with a broken session
            localStorage.removeItem("eq_token");
            localStorage.removeItem("eq_refresh_token");
            localStorage.removeItem("eq_user");
            setUser(null);
            // Small delay so the UI has time to re-render before showing message
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("eq:session-expired"));
            }, 100);
          }
        }
      } catch {}
    };
    // Check every 5 minutes
    refreshSession();
    const interval = setInterval(refreshSession, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  // Poll unread count every 15s when logged in (unified with notification polling)
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const poll = async () => {
      const c = await fetchUnreadCount(user);
      setUnreadCount(c);
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, [user]);

  // Clear unread badge when user opens Messages tab
  const setDashViewSafe = useCallback((v) => {
    setDashView(v);
    if (v === "messages") {
      setUnreadCount(0);
      if (user) markMessagesRead(user.email);
    }
  }, [user]);

  const missionRef = useRef(null);
  const contactRef = useRef(null);
  const browseRef = useRef(null);
  const partnersRef = useRef(null);
  const impactRef = useRef(null);

  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: "smooth" });
  const scrollToId = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const handleAuthSuccess = (u) => {
    // SECURITY: Clear previous DIFFERENT user's data only
    // Do NOT wipe eq_token or eq_user — they were just saved by AuthModal
    try {
      const prevUser = localStorage.getItem("eq_user");
      if (prevUser) {
        const prev = JSON.parse(prevUser);
        if (prev?.email && prev.email !== u.email) {
          // Different user logging in — clear their personal data only
          localStorage.removeItem("eq_msgs_seen_" + prev.email);
          localStorage.removeItem("eq_transferred_count");
          sessionStorage.clear();
        }
      }
    } catch {}
    // Set new user session tracking
    localStorage.setItem("eq_msgs_seen_" + u.email, new Date().toISOString());
    setDashView("feed");
    setUser(u);
    setShowAuth(false);
  };

  // Listen for privacy modal open event from ToS/Privacy links inside AuthModal
  useEffect(() => {
    const handler = () => setShowPrivacy(true);
    window.addEventListener("eqovely:openPrivacy", handler);
    return () => window.removeEventListener("eqovely:openPrivacy", handler);
  }, []);
  const handleSignOut = () => setShowSignOutConfirm(true);
  const confirmSignOut = () => {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith("eq_")) localStorage.removeItem(k);
      });
      sessionStorage.clear();
    } catch {}
    setUser(null);
    setUnreadCount(0);
    setDashView("feed");
    setShowSignOutConfirm(false);
  };

  return (
    <ErrorBoundary>
    <ToastProvider>
    <SkipLink />
    <OfflineBanner />
    <div id="main-content" className="font-sans antialiased text-slate-900 bg-white">
      <CookieBanner onPrivacy={() => setShowPrivacy(true)} />
      {showPasswordReset && resetToken && (
        <PasswordResetModal
          token={resetToken}
          onClose={() => { setShowPasswordReset(false); setResetToken(null); setShowAuth(true); }}
        />
      )}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
        />
      )}
      {showContactModal && (
        <ContactModal onClose={() => setShowContactModal(false)} />
      )}
      {showPrivacy && (
        <PrivacyPolicyModal onClose={() => setShowPrivacy(false)} />
      )}
      {chatListing && (
        <ChatWindow
          listing={chatListing}
          user={user}
          onClose={() => setChatListing(null)}
        />
      )}
      {showInbox && (
        <InboxModal
          user={user}
          onClose={() => setShowInbox(false)}
          onOpenChat={(l) => {
            setChatListing(l);
            setShowInbox(false);
          }}
          allListings={allListings}
        />
      )}
      {/* Sign Out Confirmation */}
      {showSignOutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowSignOutConfirm(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="text-4xl mb-3">👋</div>
            <h3 className="text-[17px] font-bold text-slate-900 mb-2">Sign out?</h3>
            <p className="text-[13px] text-slate-500 mb-6">Are you sure you want to sign out of Eqovely?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowSignOutConfirm(false)} className="flex-1 py-3 text-[14px] font-semibold text-slate-700 border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all">Cancel</button>
              <button onClick={confirmSignOut} className="flex-1 py-3 text-[14px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-2xl transition-all">Sign Out</button>
            </div>
          </div>
        </div>
      )}

      {user ? (
        /* ── LOGGED IN: Facebook-style dashboard ── */
        <Dashboard
          user={user}
          dashView={dashView}
          setDashView={setDashViewSafe}
          onSignOut={handleSignOut}
          unreadCount={unreadCount}
          onOpenChat={(l) => { setActiveChatListing(l); setDashViewSafe("messages"); }}
          onOpenInbox={() => setDashViewSafe("messages")}
          refreshTrigger={refreshTrigger}
          onRefresh={() => setRefreshTrigger(n => n + 1)}
          allListings={allListings}
          onListingsLoaded={setAllListings}
          activeChatListing={activeChatListing}
          onClearActiveChat={() => setActiveChatListing(null)}
          onUserUpdate={setUser}
        />
      ) : (
        /* ── LOGGED OUT: Landing page ── */
        <>
          <Navbar
            onMission={() => scrollToId("mission")}
            onBrowse={() => setShowAuth(true)}
            onPartners={() => scrollToId("partners")}
            onImpact={() => scrollToId("impact")}
            onContact={() => setShowContactModal(true)}
            onDonate={() => setShowAuth(true)}
            user={user}
            onAuth={() => setShowAuth(true)}
            onSignOut={handleSignOut}
            onInbox={() => setShowInbox(true)}
            onSettings={() => setShowSettings(true)}
            onOpenChat={(l) => setChatListing(l)}
            allListings={allListings}
            unreadCount={unreadCount}
          />
          <Hero
            onBrowse={() => setShowAuth(true)}
            onDonate={() => setShowAuth(true)}
          />
          <HowItWorksSection
            onBrowse={() => setShowAuth(true)}
            onDonate={() => setShowAuth(true)}
            onAuth={() => setShowAuth(true)}
            user={user}
          />
          <LandingListingPreview onAuth={() => setShowAuth(true)} />
          <div ref={missionRef}><MissionSection /></div>
          <div ref={partnersRef}><PartnersSection /></div>
          <div ref={impactRef}><ImpactSection /></div>
          <Footer onPrivacy={() => setShowPrivacy(true)} />
        </>
      )}
    </div>
    </ToastProvider>
    </ErrorBoundary>
  );
}
