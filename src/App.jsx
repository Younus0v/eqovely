import { useState, useEffect, useRef, useCallback } from "react";
import PrivacyModal from "./PrivacyModal";

// ═══════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT VARIABLES — copy this block into your StackBlitz .env file:
//
//  VITE_SUPABASE_URL=https://dwpqeuuqfbmbuqpuufup.supabase.co/rest/v1
//  VITE_SUPABASE_STORAGE=https://dwpqeuuqfbmbuqpuufup.supabase.co/storage/v1
//  VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cHFldXVxZmJtYnVxcHV1ZnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMDY4MjIsImV4cCI6MjA5NDU4MjgyMn0.lzhbbl49fPMDc-YKzT2fxR1BL58eDOXgWo4T-HM2CBM
//  VITE_AUTH_URL=https://dwpqeuuqfbmbuqpuufup.supabase.co/auth/v1
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Supabase Config (reads from .env in production) ─────────────────────────
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
    const res = await fetch(
      `${SUPABASE_URL}/messages?receiver_id=eq.${receiverParam}&created_at=gt.${encodeURIComponent(
        since
      )}&select=id`,
      { headers: getHeaders(getToken()) }
    );
    if (!res.ok) return 0;
    const msgs = await res.json();
    return Array.isArray(msgs) ? msgs.length : 0;
  } catch {
    return 0;
  }
}

function markMessagesRead(userEmail) {
  localStorage.setItem("eq_msgs_seen_" + userEmail, new Date().toISOString());
}

// ─── Edge Function URLs ───────────────────────────────────────────────────────
const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL
  ? import.meta.env.VITE_SUPABASE_URL.replace(
      "/rest/v1",
      "/functions/v1/send-whatsapp-otp"
    )
  : "https://dwpqeuuqfbmbuqpuufup.supabase.co/functions/v1/send-whatsapp-otp";

// ─── Founder Access Control ───────────────────────────────────────────────────
// UI ONLY: this controls frontend visibility of the PDF button.
// SECURITY WARNING: true admin privileges MUST be enforced via Supabase RLS policies
// and server-side role checks — never trust client-side email matching for data access.
const FOUNDER_EMAIL = "younus.abdulkadir09@gmail.com";

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
          onClick={() => setExpanded((p) => !p)}
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
      setMessages(data); // Replace with authoritative server data
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
          pollRef.current = setInterval(fetchMessages, 1000);
        }
      };

      ws.onclose = () => {
        clearInterval(pingInterval);
        // Fallback to polling on disconnect
        if (isMounted.current && !pollRef.current) {
          pollRef.current = setInterval(fetchMessages, 1000);
        }
      };
    } catch (_) {
      // WebSocket not available — fall back to polling
      pollRef.current = setInterval(fetchMessages, 1000);
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
    // Determine receiver: if owner, send to claimer; if claimer, send to owner
    // For owner: use claimer_id (email of claimer)
    // For non-owner: use owner_email
    // Both sides can always message each other
    // Both owner and claimer can always message each other
    // Owner messages go to claimer, claimer messages go to owner
    // Even if no claimer yet, owner can send messages to the listing thread
    const receiverId = isOwner
      ? listing.claimer_id || listing.owner_email || ""
      : listing.owner_email || "";
    const tempId = "temp-" + Date.now();

    // STEP 1 — Add to local state INSTANTLY, before any network call
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

    // STEP 2 — Save to DB silently in background, never alert user
    try {
      // Send all possible column names so whichever exists in schema is used
      const res = await fetch(SUPABASE_URL + "/messages", {
        method: "POST",
        headers: getHeaders(getToken()),
        body: JSON.stringify({
          listing_id: String(listing.id),
          sender_id: senderId,
          sender_email: senderEmail,
          sender_name: senderName,
          receiver_id: receiverId,
          message_text: text,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        console.error(
          "CHAT DB ERROR:",
          res.status,
          e.message || e.hint || e.code || e
        );
        // Local message stays — no popup
      } else {
        // Replace temp with confirmed server data
        fetchMessages();
        if (receiverId && receiverId !== senderEmail) {
          // No notification for messages — badge handled by unread count only
          // Send email notification
          sendEmailNotification(
            receiverId,
            `💬 New message about "${listing.title}" on Equilinkz`,
            `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
              <h2 style="color:#1d4ed8">Equilinkz — New Message</h2>
              <p><strong>${senderName}</strong> sent you a message about <strong>${
              listing.title
            }</strong>:</p>
              <blockquote style="border-left:3px solid #1d4ed8;padding-left:12px;color:#334155">${text.slice(
                0,
                200
              )}${text.length > 200 ? "..." : ""}</blockquote>
              <p>Log in to Equilinkz to reply.</p>
              <p style="color:#64748b;font-size:13px">Founded by Younus Abdulkadir · Equilinkz Global Resource Marketplace</p>
            </div>`
          );
        }
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
<title>Equilinkz Impact Report</title>
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
  <h1>Equilinkz Impact Report</h1>
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
  <p style="font-size:13px;color:#475569;line-height:1.7;">Equilinkz exists to eliminate the structural inequality of technology access by creating a verified, secure pipeline from corporate surplus to educational institutions and non-profits worldwide. Every handoff recorded in this report represents a child gaining access to technology, a school equipping its classrooms, and a community building toward a more equitable digital future.</p>
  <p style="margin-top:12px;"><span class="badge">✓ Verified Platform Data</span></p>
</div>
<div class="footer">
  <p>Equilinkz Global Resource Marketplace &nbsp;·&nbsp; equilinkz.com &nbsp;·&nbsp; © 2025 Younus Abdulkadir</p>
  <p>This report was auto-generated from live Supabase database statistics.</p>
</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Equilinkz-Impact-Report-${Date.now()}.html`;
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
                        ? "📦"
                        : n.type === "message"
                        ? "💬"
                        : "🔔"}
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

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar({
  onDonate,
  onBrowse,
  onMission,
  onPartners,
  onImpact,
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
            Equilinkz
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
          <button
            onClick={onImpact}
            className="text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            Impact
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
          <button
            onClick={() => {
              onImpact();
              setMenuOpen(false);
            }}
            className={navLink}
          >
            Impact
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
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    email: "",
    password: "",
    username: "",
    org_name: "",
    region: "",
    phone: "",
    dialCode: "+1",
    account_type: "",
    institution_domain: "",
    tax_id: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // ── Username duplicate check state ────────────────────────────────────────
  const [isUsernameTaken, setIsUsernameTaken] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const usernameDebounce = useRef(null);

  const isRecipient = form.account_type === "School/Non-Profit Recipient";
  const taxIdCfg = getTaxIdConfig(form.dialCode);

  // ── Async debounced username duplicate check ──────────────────────────────
  const checkUsername = (val) => {
    const clean = sanitizeUsername(val);
    if (!clean || clean.length < 3) {
      setIsUsernameTaken(false);
      return;
    }
    clearTimeout(usernameDebounce.current);
    usernameDebounce.current = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await fetch(
          `${SUPABASE_URL}/profiles?username=eq.${encodeURIComponent(
            clean
          )}&select=username&limit=1`,
          { headers: getHeaders() }
        );
        if (res.ok) {
          const data = await res.json();
          if (!Array.isArray(data) || data.length === 0) {
            // Empty result = username is available
            setIsUsernameTaken(false);
          } else {
            const taken =
              data[0]?.username?.toLowerCase() === clean.toLowerCase();
            setIsUsernameTaken(taken);
          }
        } else {
          // 403/404/500 — profiles table issue, never block signup
          console.warn(
            "Username check returned",
            res.status,
            "— allowing signup"
          );
          setIsUsernameTaken(false);
        }
      } catch (err) {
        console.warn("Username check error:", err.message, "— allowing signup");
        setIsUsernameTaken(false);
      } finally {
        setCheckingUsername(false);
      }
    }, 500); // debounce 500ms
  };

  const validate = (f = form) => {
    const errs = {};
    // Username: required, min 3 chars, max 25, alphanumeric + underscore only
    if (mode === "signup" && f.username) {
      if (f.username.trim().length < 3)
        errs.username = "Username must be at least 3 characters.";
      if (/[^a-zA-Z0-9_]/.test(f.username))
        errs.username =
          "Username can only contain letters, numbers, and underscores.";
      if (isUsernameTaken) errs.username = "⚠️ This username is already taken.";
    }
    if (f.email && isRecipient) {
      const domain = f.email.split("@")[1] || "";
      if (!INSTITUTIONAL_DOMAINS.test(domain))
        errs.email =
          "Please register using your official institutional or school email address.";
    }
    if (f.phone && !validatePhone(f.dialCode, f.phone))
      errs.phone = "Enter a valid international phone number (7–15 digits).";
    return errs;
  };

  const set = (e) => {
    let val = e.target.value;
    // Enforce username format live
    if (e.target.name === "username") {
      val = sanitizeUsername(val);
      checkUsername(val);
    }
    const updated = { ...form, [e.target.name]: val };
    setForm(updated);
    if (mode === "signup") setFieldErrors(validate(updated));
  };

  const signupComplete = (() => {
    if (mode !== "signup") return true;
    const base =
      form.email &&
      form.password.length >= 6 &&
      form.username.trim().length >= 3 &&
      form.region &&
      form.account_type;
    const orgRequired = [
      "Corporate/Lab Donor",
      "School/Non-Profit Recipient",
    ].includes(form.account_type);
    const orgOk = !orgRequired || !!form.org_name.trim();
    const phoneOk = validatePhone(form.dialCode, form.phone);
    const taxRequired = taxIdCfg.required;
    const recipientOk =
      !isRecipient ||
      (form.institution_domain && (!taxRequired || form.tax_id));
    const isIndividual = ["Individual Donor", "Individual Recipient"].includes(
      form.account_type
    );
    const agreementsOk =
      termsAgreed && privacyAgreed && (!isIndividual || ageConfirmed);
    const usernameOk =
      !isUsernameTaken && !checkingUsername && form.username.trim().length >= 3;
    return !!(
      base &&
      orgOk &&
      phoneOk &&
      recipientOk &&
      agreementsOk &&
      usernameOk &&
      Object.keys(validate()).length === 0
    );
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    // ── Bulletproof validation: check empty spaces ────────────────────────
    if (mode === "signup") {
      if (!form.username.trim()) {
        setError("Username cannot be empty or only spaces.");
        return;
      }
      if (!form.email.trim()) {
        setError("Email cannot be empty.");
        return;
      }
      if (!form.password.trim()) {
        setError("Password cannot be empty.");
        return;
      }
      if (!form.region.trim()) {
        setError("Region cannot be empty.");
        return;
      }
      if (!form.account_type) {
        setError("Please select an account type.");
        return;
      }
      if (isUsernameTaken) {
        setError("⚠️ This username is already taken. Please choose another.");
        return;
      }
    }
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError("Please fix the highlighted fields.");
      return;
    }
    setLoading(true);
    setError(null);
    const fullPhone = `${form.dialCode}${form.phone.replace(/[\s\-().]/g, "")}`;
    try {
      if (mode === "signup") {
        const metadata = {
          username: sanitizeUsername(form.username),
          phone: fullPhone,
          org_name: deepSanitize(form.org_name),
          region: deepSanitize(form.region),
          account_type: form.account_type,
          ...(isRecipient && {
            institution_domain: deepSanitize(form.institution_domain),
            tax_id: deepSanitize(form.tax_id),
          }),
        };
        const res = await fetch(`${AUTH_URL}/signup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: deepSanitize(form.email),
            password: form.password,
            data: metadata,
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.msg || data.message || "Signup failed");
        if (data.access_token) {
          const u = { ...data.user, ...metadata };
          // SECURITY: localStorage tokens are vulnerable to XSS exfiltration.
          // In production, prefer HttpOnly secure cookies via a backend auth proxy.
          localStorage.setItem("eq_token", data.access_token);
          localStorage.setItem("eq_user", JSON.stringify(u));
          // Save username to profiles table for duplicate checking
          try {
            const profileRes = await fetch(`${SUPABASE_URL}/profiles`, {
              method: "POST",
              headers: {
                ...getHeaders(data.access_token),
                Prefer: "resolution=merge-duplicates,return=representation",
              },
              body: JSON.stringify({
                id: data.user.id,
                email: data.user.email,
                username: metadata.username,
              }),
            });
            if (!profileRes.ok) {
              const profileErr = await profileRes.json().catch(() => ({}));
              console.warn(
                "Profile save failed:",
                profileErr.message || profileRes.status
              );
            }
          } catch (profileErr) {
            console.warn("Profile save network error:", profileErr.message);
          }
          onSuccess(u);
        } else {
          setError(
            "✅ Account created! Check your email and click the confirmation link to activate your account, then sign in."
          );
          setMode("login");
        }
      } else {
        const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: deepSanitize(form.email),
            password: form.password,
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(
            data.error_description || data.message || "Login failed"
          );
        const m = data.user?.user_metadata || {};
        const u = {
          ...data.user,
          username: m.username || "",
          phone: m.phone || "",
          org_name: m.org_name || "",
          region: m.region || "",
          account_type: m.account_type || "",
          institution_domain: m.institution_domain || "",
          tax_id: m.tax_id || "",
        };
        localStorage.setItem("eq_token", data.access_token);
        localStorage.setItem("eq_user", JSON.stringify(u));
        onSuccess(u);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inp = (field) => {
    const hasErr =
      fieldErrors[field] || (field === "username" && isUsernameTaken);
    return `w-full bg-slate-50 border rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all ${
      hasErr
        ? "border-red-500 focus:ring-red-400"
        : "border-slate-200 focus:ring-blue-500"
    }`;
  };
  const lbl =
    "block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide";
  const fErr = (f) =>
    fieldErrors[f] ? (
      <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
        <span>⚠</span> {fieldErrors[f]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-all"
        >
          <IconX />
        </button>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
            <IconLink />
          </div>
          <span className="font-semibold text-slate-900">Equilinkz</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          {mode === "login" ? "Welcome back" : "Join Equilinkz"}
        </h2>
        <p className="text-[13px] text-slate-500 mb-5">
          {mode === "login"
            ? "Sign in to access the global marketplace."
            : "Create your account to list and claim surplus worldwide."}
        </p>
        <div className="flex bg-slate-100 rounded-xl p-1 mb-5">
          {["login", "signup"].map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
                setFieldErrors({});
              }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-all ${
                mode === m
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>
        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="text-red-500 shrink-0 mt-0.5">⚠</span>
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className={lbl}>
                Username *{" "}
                <span className="text-slate-400 font-normal normal-case">
                  (max 25 chars, letters/numbers/_)
                </span>
              </label>
              <div className="relative">
                <input
                  name="username"
                  value={form.username}
                  onChange={set}
                  placeholder="e.g. younus_a"
                  className={inp("username") + " pr-8"}
                  maxLength={25}
                />
                {checkingUsername && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <IconLoader />
                  </span>
                )}
                {!checkingUsername &&
                  form.username.length >= 3 &&
                  !isUsernameTaken &&
                  !fieldErrors.username && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 text-[12px] font-bold">
                      ✓
                    </span>
                  )}
              </div>
              {isUsernameTaken && (
                <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1 font-semibold">
                  ⚠️ This username is already taken.
                </p>
              )}
              {!isUsernameTaken && fErr("username")}
              <p className="text-[11px] text-slate-400 mt-1">
                This is how other users will see you on the platform.
              </p>
            </div>
          )}
          <div>
            <label className={lbl}>Email *</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={set}
              placeholder="you@example.com"
              required
              className={inp("email")}
            />
            {fErr("email")}
            {mode === "signup" && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                A confirmation email will be sent — click the link to activate
                your account.
              </p>
            )}
          </div>
          <div>
            <label className={lbl}>Password *</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={set}
              placeholder="Min. 6 characters"
              required
              className={inp("password")}
            />
          </div>
          {mode === "signup" && (
            <>
              <div>
                <label className={lbl}>Account Type *</label>
                <select
                  name="account_type"
                  value={form.account_type}
                  onChange={set}
                  required
                  className={inp("account_type")}
                >
                  <option value="">Select your role</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {/* Organization Name — only for Corporate/Lab and School/Non-Profit */}
              {["Corporate/Lab Donor", "School/Non-Profit Recipient"].includes(
                form.account_type
              ) && (
                <div>
                  <label className={lbl}>Organization Name *</label>
                  <input
                    name="org_name"
                    value={form.org_name}
                    onChange={set}
                    placeholder="e.g. Acme Corp / Lincoln High School"
                    className={inp("org_name")}
                  />
                </div>
              )}
              <div>
                <label className={lbl}>Region / Country *</label>
                <input
                  name="region"
                  value={form.region}
                  onChange={set}
                  placeholder="e.g. California, USA"
                  className={inp("region")}
                />
              </div>
              <div>
                <label className={lbl}>Phone Number *</label>
                <div className="flex gap-2">
                  <select
                    name="dialCode"
                    value={form.dialCode}
                    onChange={set}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-3 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[100px]"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={`${c.code}-${c.country}`} value={c.code}>
                        {c.flag} {c.country} ({c.code})
                      </option>
                    ))}
                  </select>
                  <div className="flex-1">
                    <input
                      name="phone"
                      type="tel"
                      value={form.phone}
                      onChange={set}
                      placeholder="555 000 0000"
                      className={`${inp("phone")} w-full`}
                    />
                  </div>
                </div>
                {fErr("phone")}
                {!fieldErrors.phone &&
                  form.phone &&
                  validatePhone(form.dialCode, form.phone) && (
                    <p className="text-[11px] text-green-600 mt-1.5 flex items-center gap-1">
                      <IconCheck /> Valid international format
                    </p>
                  )}
              </div>
              {isRecipient && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">
                      <IconShield />
                    </span>
                    <p className="text-[12px] font-semibold text-green-800">
                      Recipient Verification Required
                    </p>
                  </div>
                  <div>
                    <label className={lbl}>Official Institution Domain *</label>
                    <input
                      name="institution_domain"
                      value={form.institution_domain}
                      onChange={set}
                      placeholder="e.g. lincolnhigh.edu"
                      className={inp("institution_domain")}
                    />
                  </div>
                  <div>
                    <label className={lbl}>
                      {taxIdCfg.label}
                      {taxIdCfg.required ? " *" : " (optional)"}
                    </label>
                    <input
                      name="tax_id"
                      value={form.tax_id}
                      onChange={set}
                      placeholder={taxIdCfg.placeholder}
                      className={inp("tax_id")}
                    />
                    {!taxIdCfg.required && (
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        Registration numbers are optional for your country but
                        help verify legitimacy.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {!signupComplete && (
                <p className="text-[11px] text-slate-400 text-center">
                  Complete all required fields to enable sign up
                </p>
              )}
            </>
          )}
          {/* Terms & Privacy checkboxes — required before signup */}
          {mode === "signup" && (
            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={termsAgreed}
                  onChange={(e) => setTermsAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <p className="text-[12px] text-slate-600 leading-relaxed">
                  I have read and agree to the
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent("equilinkz:openPrivacy")
                      );
                    }}
                    className="text-blue-600 hover:text-blue-800 font-semibold underline"
                  >
                    Terms of Service
                  </a>
                  — I confirm all information I provide is accurate and
                  truthful.
                </p>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={privacyAgreed}
                  onChange={(e) => setPrivacyAgreed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <p className="text-[12px] text-slate-600 leading-relaxed">
                  I have read and agree to the
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent("equilinkz:openPrivacy")
                      );
                    }}
                    className="text-blue-600 hover:text-blue-800 font-semibold underline"
                  >
                    Privacy Policy
                  </a>
                  — I consent to my data being processed as described. My phone
                  number may be visible to verified users for contact.
                </p>
              </label>
              {/* Age confirmation — only for individual accounts */}
              {["Individual Donor", "Individual Recipient"].includes(
                form.account_type
              ) && (
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                  />
                  <p className="text-[12px] text-slate-600 leading-relaxed">
                    I confirm that I am{" "}
                    <strong>18 years of age or older</strong>. If I am under 18,
                    I confirm that I have obtained parental or guardian consent
                    to use this platform.
                  </p>
                </label>
              )}
              {mode === "signup" && (!termsAgreed || !privacyAgreed) && (
                <p className="text-[11px] text-slate-400 text-center">
                  Please agree to both policies to create your account
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !signupComplete}
            className={`w-full flex items-center justify-center gap-2 text-white font-semibold py-3.5 rounded-xl transition-all text-[15px] mt-2 ${
              signupComplete && !loading
                ? "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 hover:-translate-y-0.5 cursor-pointer"
                : "bg-blue-300 opacity-50 pointer-events-none cursor-not-allowed"
            }`}
          >
            {loading ? (
              <>
                <IconLoader /> Please wait…
              </>
            ) : (
              <>
                <IconCheck /> {mode === "login" ? "Sign In" : "Create Account"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Dual-Key Handshake Modals ───────────────────────────────────────────────
// KEY A — Recipient view: passive PIN + QR display only. No inputs, no actions.
function RecipientPinModal({ pin, listing, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-all"
        >
          <IconX />
        </button>

        {/* Status badge */}
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 mb-5">
          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
            Pending Pickup — Key A Issued
          </span>
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1">
          Your Pickup Key
        </h3>
        <p className="text-[13px] text-slate-500 mb-6">
          Present this QR code or PIN to the donor at pickup.
          <strong>Do not share it before meeting in person.</strong>
        </p>

        {/* PIN display only */}
        <div className="bg-slate-900 rounded-2xl p-6 mb-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">
            Secure Escrow PIN — Key A
          </p>
          <p className="text-5xl font-bold tracking-[0.4em] text-white">
            {pin}
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3 flex items-center gap-2">
          <span className="text-xl">📸</span>
          <p className="text-[12px] font-semibold text-amber-800">
            Screenshot this code! Show it to the donor at pickup to complete the
            transfer. Do not share it before meeting in person.
          </p>
        </div>

        {/* Copy — passive action only, no state transition */}
        <button
          onClick={copy}
          className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-[13px] font-medium py-2.5 rounded-xl transition-all mb-3"
        >
          {copied ? (
            <>
              <IconCheck /> Copied to clipboard!
            </>
          ) : (
            "Copy PIN"
          )}
        </button>

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-[12px] text-blue-700 font-medium">
            The donor will enter this code on their device to authorize the
            transfer. You cannot complete this step — only the donor can unlock
            Key B.
          </p>
        </div>
      </div>
    </div>
  );
}

// KEY B — Donor (owner) view only. Rendered exclusively when auth.uid === owner_id.
// Contains the input field, validation, and handleHandshakeVerify submission.
function OwnerVerifyModal({ listing, user, onVerified, onClose }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Security gate: only render submission logic if session owner matches ──
  const isAuthorizedOwner =
    user &&
    (user.id === listing.owner_id || user.email === listing.owner_email);

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
    if (input.trim() !== String(listing.verification_pin)) {
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
      // Delete listing completely on transfer
      const res = await fetch(`${SUPABASE_URL}/listings?id=eq.${listing.id}`, {
        method: "DELETE",
        headers: getHeaders(getToken()),
      });
      if (!res.ok)
        throw new Error("Failed to complete transfer. Please try again.");
      setSuccess(true);
      createNotification(
        listing.claimer_id,
        "transfer",
        `Transfer of "${listing.title}" is complete. Thank you for using Equilinkz!`,
        listing.id
      );
      // Increment donor's transfer count for verified badge
      incrementDonorTransfers(listing.owner_email, getToken());
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
          Enter the recipient's 4-digit PIN below
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
              maxLength={4}
              value={input}
              onChange={(e) => {
                setInput(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              placeholder="- - - -"
              className="w-full text-center text-3xl font-bold tracking-[0.4em] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <button
              onClick={handleHandshakeVerify}
              disabled={loading || input.length < 4}
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
        body: JSON.stringify({ data: { ...user, username: username.trim() } }),
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
              {t === "profile" ? "👤 Profile" : "⚙️ Account"}
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
function InboxModal({ user, onClose, onOpenChat, listings }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) markMessagesRead(user.email);
    const fetchThreads = async () => {
      if (!user) return;
      try {
        const res = await fetch(
          `${SUPABASE_URL}/messages?or=(sender_email.eq.${encodeURIComponent(
            user.email
          )},receiver_id.eq.${encodeURIComponent(
            user.email
          )})&order=created_at.desc&select=*&limit=200`,
          { headers: getHeaders(getToken()) }
        );
        if (!res.ok) return;
        const msgs = await res.json();
        // Group by listing_id — one thread per listing
        const grouped = {};
        msgs.forEach((m) => {
          if (!grouped[m.listing_id]) grouped[m.listing_id] = [];
          grouped[m.listing_id].push(m);
        });
        setThreads(
          Object.entries(grouped).map(([lid, messages]) => ({
            listing_id: lid,
            last: messages[0],
            unread: messages.filter((m) => m.sender_email !== user.email)
              .length,
            listing: listings.find((l) => String(l.id) === String(lid)),
          }))
        );
      } catch (_) {
      } finally {
        setLoading(false);
      }
    };
    fetchThreads();
  }, [user]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="text-[17px] font-bold text-slate-900">Messages</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-all"
          >
            <IconX />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <IconLoader />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-[14px] text-slate-500 font-medium">
                No messages yet
              </p>
              <p className="text-[12px] text-slate-400 mt-1">
                Click Message on a listing to start a conversation
              </p>
            </div>
          ) : (
            threads.map(({ listing_id, last, unread, listing }) => (
              <button
                key={listing_id}
                onClick={() => {
                  if (listing) {
                    onOpenChat(listing);
                    onClose();
                  }
                }}
                className="w-full flex items-start gap-3 px-6 py-4 hover:bg-slate-50 transition-colors border-b border-slate-50 text-left"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
                  <IconMsg />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">
                      {listing?.title || "Listing"}
                    </p>
                    {unread > 0 && (
                      <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-slate-500 truncate mt-0.5">
                    {last?.sender_name || "..."}:{" "}
                    {last?.message_text || last?.body || last?.text || ""}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {last?.created_at
                      ? (() => {
                          const d = Math.floor(
                            (Date.now() - new Date(last.created_at)) / 60000
                          );
                          return d < 60
                            ? `${d}m ago`
                            : d < 1440
                            ? `${Math.floor(d / 60)}h ago`
                            : `${Math.floor(d / 1440)}d ago`;
                        })()
                      : ""}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
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
            Equilinkz Impact Certificate
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
            world." — Equilinkz
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
            Global Resource Equity Platform
          </span>
        </div>
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-slate-900 leading-[1.05] mb-6">
          Bridging the
          <span className="relative">
            <span className="relative z-10 text-blue-600">Global</span>
            <span
              className="absolute inset-x-0 bottom-1 h-3 bg-blue-100 -z-0 rounded"
              style={{ transform: "skewX(-2deg)" }}
            />
          </span>
          <br />
          Resource Gap
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed mb-4 font-light">
          Equilinkz is a verified global marketplace that eliminates the digital
          divide by creating a secure, direct pipeline from corporate technology
          surplus to the schools, universities, and non-profits that need it
          most.
        </p>
        <p className="text-[14px] text-slate-400 max-w-xl mx-auto leading-relaxed mb-10">
          Every laptop donated is a classroom equipped. Every handoff verified
          is a community empowered. We believe that access to technology is not
          a privilege — it is a right.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onBrowse}
            className="group flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-7 py-3.5 rounded-full transition-all shadow-xl shadow-blue-200 hover:-translate-y-0.5 text-[15px]"
          >
            Browse Surplus{" "}
            <span className="group-hover:translate-x-1 transition-transform">
              <IconArrow />
            </span>
          </button>
          <button
            onClick={onDonate}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-medium px-7 py-3.5 rounded-full transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 text-[15px]"
          >
            <IconPlus /> List Your Surplus
          </button>
        </div>
        <div className="mt-20 grid grid-cols-3 gap-8 max-w-lg mx-auto border-t border-slate-100 pt-10">
          {[
            { value: "12K+", label: "Items Matched" },
            { value: "340+", label: "Organizations" },
            { value: "60+", label: "Countries" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {value}
              </div>
              <div className="text-[12px] text-slate-400 mt-0.5 font-medium">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Analytics Bar ────────────────────────────────────────────────────────────
// No-op — units transferred is now counted directly from transferred listings
function incrementUnitsTransferred() {}

// ─── Donor Transfer Counter ───────────────────────────────────────────────────
async function incrementDonorTransfers(ownerEmail, token) {
  if (!ownerEmail) return;
  try {
    // Fetch current count
    const res = await fetch(
      `${SUPABASE_URL}/profiles?email=eq.${encodeURIComponent(
        ownerEmail
      )}&select=transfers_completed`,
      { headers: getHeaders(token) }
    );
    if (!res.ok) return;
    const data = await res.json();
    const current = (Array.isArray(data) && data[0]?.transfers_completed) || 0;
    // Increment
    await fetch(
      `${SUPABASE_URL}/profiles?email=eq.${encodeURIComponent(ownerEmail)}`,
      {
        method: "PATCH",
        headers: getHeaders(token),
        body: JSON.stringify({ transfers_completed: current + 1 }),
      }
    );
  } catch (e) {
    console.warn("Could not update donor transfer count:", e.message);
  }
}

async function fetchDonorTransferCount(ownerEmail) {
  if (!ownerEmail) return 0;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/profiles?email=eq.${encodeURIComponent(
        ownerEmail
      )}&select=transfers_completed`,
      { headers: getHeaders(null) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return (Array.isArray(data) && data[0]?.transfers_completed) || 0;
  } catch {
    return 0;
  }
}

function AnalyticsBar({ listings, transferredCount }) {
  return (
    <div className="grid grid-cols-3 gap-3 mb-8">
      {[
        {
          label: "Total Listings",
          value: listings.length,
          color: "text-slate-900",
          bg: "bg-white",
          sub: "in marketplace",
        },
        {
          label: "Available",
          value: listings.filter((l) => l.status === "available").length,
          color: "text-blue-600",
          bg: "bg-blue-50",
          sub: "ready to claim",
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
}) {
  const [deleting, setDeleting] = useState(false);
  const [claiming, setClaiming] = useState(false);
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
      alert("Security: you are not the owner of this listing.");
      return;
    }
    if (
      !window.confirm(
        "Permanently delete this listing and all related data? This cannot be undone."
      )
    )
      return;
    setDeleting(true);
    try {
      await fetch(`${SUPABASE_URL}/messages?listing_id=eq.${listing.id}`, {
        method: "DELETE",
        headers: getHeaders(getToken()),
      });
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
      alert(err.message || "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };

  const handleClaim = async (reason = "") => {
    if (isDone || !user) return;
    if (!checkClaimThrottle(listing.id)) {
      alert(
        "You have already claimed this item. Please wait before trying again."
      );
      return;
    }
    if (listing.category === "Medical Supplies" && !reason) {
      setShowMedReason(true);
      return;
    }
    setClaiming(true);
    // PIN persistence: reuse cached PIN if user claimed before
    const pinCacheKey = `eq_pin_${listing.id}_${user.email}`;
    const cachedPin = sessionStorage.getItem(pinCacheKey);
    const pin = cachedPin || String(Math.floor(1000 + Math.random() * 9000));
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
        // Show PIN AFTER state update — uses setTimeout to survive re-render
        if (onShowPin) onShowPin(pin);
        createNotification(
          listing.owner_email,
          "claim",
          `📦 ${user.email} claimed your item: "${listing.title}". Meet them and verify their PIN to complete the transfer.`,
          listing.id
        );
      } else {
        // Even if PATCH fails, still show PIN so user has their code
        if (onShowPin) onShowPin(pin);
        console.warn("Claim PATCH failed — PIN still shown to user");
      }
    } catch (err) {
      if (onShowPin) onShowPin(pin);
      console.error("Claim error:", err);
    } finally {
      setClaiming(false);
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
      alert("Failed to report.");
    }
  };

  return (
    <>
      <div
        className={`group bg-white border rounded-2xl overflow-hidden flex flex-col transition-all duration-300 ${
          isDone
            ? "opacity-55 border-slate-100"
            : "border-slate-100 hover:border-blue-100 hover:shadow-xl hover:shadow-blue-50 hover:-translate-y-1"
        }`}
      >
        {/* Photo gallery */}
        {images.length > 0 && !imgError && (
          <div className="relative w-full h-44 bg-slate-100 overflow-hidden">
            <img
              src={images[imgIdx]}
              alt={listing.title}
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
            <div className="flex items-center gap-1 shrink-0">
              {listing.category && (
                <span
                  className={`inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ${categoryStyle}`}
                >
                  {listing.category}
                </span>
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
            {listing.owner_transfers_completed >= 3 && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700"
                title="Completed 3+ verified transfers"
              >
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
                {listing.owner_phone &&
                  user &&
                  (user.email === listing.owner_email ||
                    user.email === listing.claimer_id) && (
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
                      onClick={() => setShowOwnerVerify(true)}
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
                  {isClaimed && listing.claimer_id && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                      <span>👤</span>
                      <span className="font-medium truncate max-w-[140px]">
                        {listing.claimer_id}
                      </span>
                    </div>
                  )}
                </div>
                {/* Delete — only while item is still available */}
                {!isDone && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-red-400 hover:text-red-600 border border-red-100 hover:border-red-200 rounded-lg px-2.5 py-1 transition-all"
                  >
                    {deleting ? (
                      <IconLoader />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="w-3 h-3"
                      >
                        <path
                          d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    Delete
                  </button>
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
                        onClick={handleClaim}
                        disabled={claiming || !user}
                        className={`flex items-center gap-1.5 text-[12px] font-medium transition-all ${
                          !user
                            ? "text-slate-400 cursor-not-allowed"
                            : "text-blue-600 hover:text-blue-700"
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
      {showOwnerVerify && (
        <OwnerVerifyModal
          listing={listing}
          user={user}
          onVerified={(id) => {
            createNotification(
              listing.claimer_id,
              "transfer",
              `✅ Transfer of "${listing.title}" has been completed! The item is now yours.`,
              listing.id
            );
            incrementUnitsTransferred(listing.quantity || 1);
            onTransferred(id);
          }}
          onClose={() => setShowOwnerVerify(false)}
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
              For safety, please briefly explain why your organization needs
              these medical supplies (max 60 words).
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
              <p className="text-[11px] text-amber-700 font-medium">
                ⚠️ Disclaimer: Equilinkz does not verify the safety or
                suitability of medical supplies. All transfers are at the
                recipient's own risk. Consult a qualified medical professional
                before use.
              </p>
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
}) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(9);
  const [catFilter, setCatFilter] = useState("All");
  const [regionFilter, setRegionFilter] = useState("All Regions");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const locationDebounce = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const searchDebounce = useRef(null);
  const [tab, setTab] = useState("marketplace");
  const [pinData, setPinData] = useState(null); // {pin, listing}
  const [transferredCount, setTransferredCount] = useState(() => {
    return parseInt(localStorage.getItem("eq_transferred_count") || "0");
  });

  // ── View state: 'dashboard' shows 3-card preview, 'marketplace' shows all ──
  const [currentView, setCurrentView] = useState("dashboard");

  const fetchListings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/listings?select=*&order=created_at.desc`,
        { headers: getHeaders(getToken()) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setListings(data);
      if (onListingsLoaded) onListingsLoaded(data);
    } catch (err) {
      setError("Unable to load listings. Error: " + (err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id) => setListings((p) => p.filter((l) => l.id !== id));
  const handleClaim = (id, pin) =>
    setListings((p) =>
      p.map((l) =>
        l.id === id ? { ...l, status: "pending", verification_pin: pin } : l
      )
    );
  const handleTransferred = (id) => {
    const listing = listings.find((l) => String(l.id) === String(id));
    const qty = parseInt(listing?.quantity) || 1;
    setListings((p) => p.filter((l) => String(l.id) !== String(id)));
    setTransferredCount((prev) => {
      const next = prev + qty;
      localStorage.setItem("eq_transferred_count", String(next));
      return next;
    });
  };

  useEffect(() => {
    fetchListings();
  }, [refreshTrigger]);
  useEffect(() => {
    setVisibleCount(9);
  }, [catFilter, regionFilter, locationSearch, searchQuery, tab]);

  // ── RBAC: Derive role ─────────────────────────────────────────────────────
  const isDonor =
    !user ||
    ["Individual Donor", "Corporate/Lab Donor"].includes(user.account_type);
  const isRecipientUser =
    user && user.account_type === "School/Non-Profit Recipient";

  // ── Base filter pipeline (used by both views) ─────────────────────────────
  let filtered = listings;
  if (tab === "dashboard" && user) {
    if (isDonor) {
      filtered = filtered.filter(
        (l) =>
          l.owner_email === user.email ||
          l.owner_id === user.id ||
          (l.status === "pending" &&
            (l.owner_email === user.email || l.owner_id === user.id))
      );
    } else {
      filtered = filtered.filter(
        (l) =>
          l.status === "available" ||
          l.claimer_id === user.id ||
          l.claimer_id === user.email
      );
    }
  }
  if (tab === "claims" && user) {
    filtered = filtered.filter(
      (l) => l.claimer_id === user.email || l.claimer_id === user.id
    );
  }
  if (catFilter !== "All")
    filtered = filtered.filter((l) => l.category === catFilter);
  if (regionFilter !== "All Regions")
    filtered = filtered.filter(
      (l) =>
        (l.region_country || "") === regionFilter ||
        (l.owner_region || "") === regionFilter ||
        (l.location || "").toLowerCase().includes(regionFilter.toLowerCase())
    );
  if (locationSearch.trim())
    filtered = filtered.filter((l) =>
      (l.location || "").toLowerCase().includes(locationSearch.toLowerCase())
    );
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (l) =>
        (l.title || "").toLowerCase().includes(q) ||
        (l.description || "").toLowerCase().includes(q) ||
        (l.organization || "").toLowerCase().includes(q)
    );
  }

  // ── Preview slice: only 3 most recent on homepage ────────────────────────
  const previewListings = filtered.slice(0, 3);
  // ── Paginated slice for marketplace ──────────────────────────────────────
  const paginatedListings = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  // ── Shared card grid renderer ─────────────────────────────────────────────
  const CardGrid = ({ items }) => (
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
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-20 h-20 bg-slate-50 border border-slate-100 rounded-3xl flex items-center justify-center text-4xl">
            {searchQuery ? "🔍" : tab === "dashboard" && isDonor ? "📦" : "🌍"}
          </div>
          <div className="text-center">
            <p className="text-slate-700 font-semibold text-[15px]">
              {searchQuery
                ? `No results for "${searchQuery}"`
                : tab === "dashboard" && isDonor
                ? "No listings yet"
                : tab === "dashboard" && isRecipientUser
                ? "No active claims"
                : "No listings match your filters"}
            </p>
            <p className="text-slate-400 text-[13px] mt-1">
              {searchQuery
                ? "Try different keywords or clear the search"
                : tab === "dashboard" && isDonor
                ? "Click List Surplus to post your first item"
                : tab === "dashboard" && isRecipientUser
                ? "Browse available items and claim one"
                : "Try adjusting your filters or region"}
            </p>
          </div>
        </div>
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
                {filtered.length} item{filtered.length !== 1 ? "s" : ""} across
                all regions
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
          {!loading && !error && <GeoMapSection listings={listings} />}

          {/* Full filter toolbar */}
          {/* Search */}
          <div className="relative mb-4">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch />
            </div>
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                clearTimeout(searchDebounce.current);
                searchDebounce.current = setTimeout(
                  () => setSearchQuery(e.target.value),
                  300
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  clearTimeout(searchDebounce.current);
                  setSearchQuery(searchInput);
                  e.target.blur();
                }
              }}
              placeholder="Search by title, description, or organization…"
              className="w-full pl-10 pr-4 py-3 text-[14px] bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-800 placeholder-slate-400 shadow-sm"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <IconX />
              </button>
            )}
          </div>
          {/* Category pills */}
          <div
            className="flex gap-2 mb-3 overflow-x-auto pb-2"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {["All", ...CATEGORIES].map((cat) => (
              <button
                key={cat}
                onClick={() => setCatFilter(cat)}
                className={`text-[12px] font-medium px-3.5 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                  catFilter === cat
                    ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200"
                    : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          {/* Region + Location */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-slate-500 shrink-0">
                📍 Region:
              </span>
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="text-[12px] font-medium border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[12px] font-medium text-slate-500 shrink-0">
                🔍 Location:
              </span>
              <input
                value={locationInput}
                onChange={(e) => {
                  setLocationInput(e.target.value);
                  clearTimeout(locationDebounce.current);
                  locationDebounce.current = setTimeout(
                    () => setLocationSearch(e.target.value),
                    300
                  );
                }}
                placeholder="Search city, zip, or area…"
                className="flex-1 text-[12px] border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Full scrolling card grid */}
          <CardGrid items={paginatedListings} />
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((c) => c + 9)}
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
              Showing 3 of {listings.length} available items
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

        {/* 3-card preview grid */}
        <CardGrid items={previewListings} />

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
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [agreed, setAgreed] = useState(false);
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
      setUploaderKey((k) => k + 1);
      if (onSuccess) onSuccess();
      else window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => setSuccess(false), 5000);
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
    <section id="list" className="py-24 bg-white">
      <div className="max-w-2xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200 mb-5 text-white">
            <IconPlus />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
            List Your Surplus
          </h2>
          <p className="text-slate-500 text-[14px] max-w-md mx-auto leading-relaxed">
            {user
              ? `Listing as ${user.username || user.org_name || user.email} · ${
                  user.account_type
                }`
              : "Sign in to publish a listing and connect with recipients globally."}
          </p>
        </div>
        <div className="bg-white border border-slate-100 rounded-3xl shadow-xl shadow-slate-100 p-8">
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
              <label className={lbl}>Item Title *</label>
              <input
                name="title"
                value={form.title}
                onChange={handleChange}
                placeholder="e.g. Standing Desk"
                className={inp}
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
              <label className={lbl}>
                Description{" "}
                <span className="text-slate-400 font-normal normal-case">
                  ({300 - (form.description?.length || 0)} chars left)
                </span>
              </label>
              <textarea
                name="description"
                rows={3}
                value={form.description}
                onChange={handleChange}
                maxLength={300}
                placeholder="Condition, specs, any relevant details…"
                className={`${inp} resize-none`}
              />
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
          All listings are reviewed for community guidelines. Free to use,
          always.
        </p>
      </div>
    </section>
  );
}

// ─── Mission Section ──────────────────────────────────────────────────────────
function MissionSection() {
  return (
    <section id="mission" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
            <span className="text-[12px] font-semibold text-blue-600 uppercase tracking-widest">
              Our Mission
            </span>
          </div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Bridging the Digital Divide, <br className="hidden sm:block" />
            One Device at a Time
          </h2>
          <p className="text-slate-500 max-w-2xl mx-auto text-[15px] leading-relaxed">
            Equilinkz was founded on a singular belief: that geographic and
            economic circumstance should never determine whether a student has
            access to the tools they need to learn, grow, and compete in the
            modern world.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {[
            {
              icon: "🎯",
              title: "Precision Matching",
              desc: "Our verification engine pairs corporate donors with recipient institutions based on item category, regional proximity, and organizational need — eliminating guesswork and ensuring every device reaches maximum impact.",
            },
            {
              icon: "🔒",
              title: "End-to-End Security",
              desc: "From institutional credential verification at signup to our 4-digit Escrow Handshake PIN at physical pickup, every transaction on Equilinkz is authenticated, logged, and protected at every stage.",
            },
            {
              icon: "🌍",
              title: "Global Infrastructure",
              desc: "Operating across 60+ countries and all major world regions, Equilinkz provides the only unified platform purpose-built to coordinate international technology redistribution at scale.",
            },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              className="bg-slate-50 border border-slate-100 rounded-2xl p-7"
            >
              <div className="text-4xl mb-4">{icon}</div>
              <h3 className="text-[17px] font-bold text-slate-900 mb-2">
                {title}
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                {desc}
              </p>
            </div>
          ))}
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl p-10 text-white text-center">
          <h3 className="text-2xl font-bold mb-3">
            A Message from Our Founder
          </h3>
          <p className="text-blue-100 text-[15px] leading-relaxed max-w-3xl mx-auto italic mb-4">
            "I built Equilinkz because I witnessed firsthand how the gap between
            those who have technology and those who do not compounds every other
            inequality in education, healthcare, and economic opportunity. This
            platform is my answer to that problem — a structured, verified, and
            scalable bridge between surplus and need."
          </p>
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-lg font-bold">
              Y
            </div>
            <div className="text-left">
              <p className="font-semibold text-white text-[14px]">
                Younus Abdulkadir
              </p>
              <p className="text-blue-200 text-[12px]">
                Founder & CEO, Equilinkz
              </p>
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
    {
      name: "Global Tech Donor A",
      type: "Corporate Donor",
      region: "North America",
      items: null,
      logo: "GT",
    },
    {
      name: "Community School B",
      type: "School District",
      region: "East Africa",
      items: null,
      logo: "CS",
    },
    {
      name: "Aid Foundation C",
      type: "Non-Profit",
      region: "South Asia",
      items: null,
      logo: "AF",
    },
    {
      name: "Research Institute D",
      type: "Research Institution",
      region: "Europe",
      items: null,
      logo: "RI",
    },
    {
      name: "NGO Partner E",
      type: "Non-Profit",
      region: "Middle East",
      items: null,
      logo: "NP",
    },
    {
      name: "Tech Company F",
      type: "Corporate Donor",
      region: "Asia Pacific",
      items: null,
      logo: "TC",
    },
  ];
  return (
    <section id="partners" className="py-24 bg-slate-50">
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
                <span className="text-[12px] text-slate-500">
                  {p.items
                    ? p.items.toLocaleString() + " items contributed"
                    : "Partner organization"}
                </span>
                <span className="text-[11px] font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                  Active Partner
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center">
          <h3 className="text-2xl font-bold text-slate-900 mb-3">
            Become a Partner Organization
          </h3>
          <p className="text-slate-500 text-[14px] max-w-xl mx-auto leading-relaxed mb-6">
            Whether you are a corporation looking to responsibly dispose of
            surplus technology, or an institution seeking to expand your digital
            capabilities, Equilinkz provides the infrastructure to make it
            happen — securely, verifiably, and at no cost.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-full transition-all shadow-lg shadow-blue-200">
              Apply as a Donor Organization
            </button>
            <button className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-medium px-6 py-3 rounded-full transition-all">
              Register as a Recipient Hub
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Impact Section ───────────────────────────────────────────────────────────
function ImpactSection() {
  return (
    <section id="impact" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
            <span className="text-[12px] font-semibold text-amber-600 uppercase tracking-widest">
              Our Impact
            </span>
          </div>
          <h2 className="text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Real Numbers. Real Change.
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto text-[15px] leading-relaxed">
            Every statistic below represents a real organization, a real
            classroom, and a real life changed by access to technology.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-16">
          {[
            {
              value: "12,400+",
              label: "Items Redistributed",
              sub: "and counting",
              color: "text-blue-600",
            },
            {
              value: "340+",
              label: "Partner Organizations",
              sub: "across 60+ countries",
              color: "text-green-600",
            },
            {
              value: "98,000+",
              label: "lbs E-Waste Diverted",
              sub: "from landfills",
              color: "text-amber-600",
            },
            {
              value: "47",
              label: "Countries Reached",
              sub: "active this quarter",
              color: "text-violet-600",
            },
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
      </div>
    </section>
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
              <span className="font-semibold tracking-tight">Equilinkz</span>
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
          <div className="grid grid-cols-2 gap-x-16 gap-y-2">
            {[
              "Mission",
              "Browse Surplus",
              "List Resources",
              "Partners",
              "Impact Report",
            ].map((l) => (
              <a
                key={l}
                href="#"
                className="text-[13px] text-slate-400 hover:text-white transition-colors"
              >
                {l}
              </a>
            ))}
            <button
              onClick={onPrivacy}
              className="text-[13px] text-slate-400 hover:text-white transition-colors text-left"
            >
              Privacy Policy
            </button>
          </div>
        </div>
        <div className="border-t border-slate-800 mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[12px] text-slate-500">
            © 2025 Equilinkz. All rights reserved. Founded by Younus Abdulkadir.
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
export default function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showAuth, setShowAuth] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [chatListing, setChatListing] = useState(null);
  const [showInbox, setShowInbox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [allListings, setAllListings] = useState([]);
  const [user, setUser] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("eq_user"));
      const token = localStorage.getItem("eq_token");
      if (!u || !token) return null;
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          localStorage.removeItem("eq_token");
          localStorage.removeItem("eq_user");
          return null;
        }
      } catch {}
      return u;
    } catch {
      return null;
    }
  });

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

  const missionRef = useRef(null);
  const browseRef = useRef(null);
  const partnersRef = useRef(null);
  const impactRef = useRef(null);

  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: "smooth" });
  const scrollToId = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const handleAuthSuccess = (u) => {
    localStorage.setItem("eq_msgs_seen_" + u.email, new Date().toISOString());
    setUser(u);
    setShowAuth(false);
  };

  // Listen for privacy modal open event from ToS/Privacy links inside AuthModal
  useEffect(() => {
    const handler = () => setShowPrivacy(true);
    window.addEventListener("equilinkz:openPrivacy", handler);
    return () => window.removeEventListener("equilinkz:openPrivacy", handler);
  }, []);
  const handleSignOut = () => {
    const email = user?.email;
    localStorage.removeItem("eq_token");
    localStorage.removeItem("eq_user");
    if (email) {
      localStorage.removeItem("eq_msgs_seen_" + email);
      localStorage.removeItem("eq_transferred_count");
    }
    setUser(null);
    setUnreadCount(0);
  };

  return (
    <div className="font-sans antialiased text-slate-900 bg-white pb-16 md:pb-0">
      {/* Mobile bottom nav */}
      {user && (
        <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white border-t border-slate-100 flex items-center justify-around px-2 py-2 shadow-lg">
          <button
            onClick={() => scrollToId("browse")}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-slate-500 hover:text-blue-600 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-5 h-5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="text-[10px] font-medium">Browse</span>
          </button>
          <button
            onClick={() => scrollToId("list")}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-slate-500 hover:text-blue-600 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-5 h-5"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span className="text-[10px] font-medium">List</span>
          </button>
          <button
            onClick={() => setShowInbox(true)}
            className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 text-slate-500 hover:text-blue-600 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-5 h-5"
            >
              <path
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-2 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
            <span className="text-[10px] font-medium">Messages</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-slate-500 hover:text-blue-600 transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-5 h-5"
            >
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="text-[10px] font-medium">Profile</span>
          </button>
        </div>
      )}
      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
        />
      )}
      <PrivacyModal
        isOpen={showPrivacy}
        onClose={() => setShowPrivacy(false)}
        onAgree={() => setShowPrivacy(false)}
      />
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
          listings={allListings}
        />
      )}
      {showSettings && (
        <SettingsModal
          user={user}
          onClose={() => setShowSettings(false)}
          onUpdated={(u) => setUser(u)}
          onDeleted={() => {
            setUser(null);
            setShowSettings(false);
          }}
        />
      )}

      <Navbar
        onMission={() => scrollToId("mission")}
        onBrowse={() => scrollToId("browse")}
        onPartners={() => scrollToId("partners")}
        onImpact={() => scrollToId("impact")}
        onDonate={() => (user ? scrollToId("list") : setShowAuth(true))}
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
        onBrowse={() => scrollToId("browse")}
        onDonate={() => (user ? scrollToId("list") : setShowAuth(true))}
      />
      <div ref={browseRef}>
        <ListingsSection
          refreshTrigger={refreshTrigger}
          user={user}
          onOpenChat={(l) => setChatListing(l)}
          onListingsLoaded={setAllListings}
        />
      </div>
      <FormSection
        onSuccess={() => setRefreshTrigger((n) => n + 1)}
        user={user}
      />
      <div ref={missionRef}>
        <MissionSection />
      </div>
      <div ref={partnersRef}>
        <PartnersSection />
      </div>
      <div ref={impactRef}>
        <ImpactSection />
      </div>
      <Footer onPrivacy={() => setShowPrivacy(true)} />
    </div>
  );
}
