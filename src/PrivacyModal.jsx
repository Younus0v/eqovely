// ─── PrivacyModal.jsx ─────────────────────────────────────────────────────────
// Drop-in privacy agreement modal for Eqovely.
// Usage:
//   import PrivacyModal from './PrivacyModal';
//   <PrivacyModal isOpen={showPrivacy} onClose={() => setShowPrivacy(false)} onAgree={() => { setShowPrivacy(false); /* continue flow */ }} />

export default function PrivacyModal({ isOpen, onClose, onAgree }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-8 pt-7 pb-5 border-b border-slate-700 shrink-0">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              {/* Shield icon */}
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-4 h-4 text-white"
                >
                  <path
                    d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="text-[18px] font-bold text-white tracking-tight">
                Privacy & Platform Agreement
              </h2>
            </div>
            <p className="text-[12px] text-slate-400">
              Eqovely Global Resource Marketplace · Last updated May 2025
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-2xl leading-none mt-1 ml-4 shrink-0"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-8 py-6 space-y-7 flex-1 text-slate-300 text-[14px] leading-relaxed">
          {/* Section 1 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-blue-600/20 border border-blue-500/40 rounded-lg flex items-center justify-center text-blue-400 text-[11px] font-bold shrink-0">
                1
              </span>
              <h3 className="text-[15px] font-semibold text-white">
                Global Data Protection
              </h3>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 space-y-3">
              <p>
                Eqovely collects and processes personal data solely to
                facilitate verified resource transfers between donors and
                recipient institutions. All credentials — including email
                addresses, international phone formats, and Tax Identification
                Numbers — are stored in an isolated PostgreSQL database hosted
                on Supabase infrastructure.
              </p>
              <p>
                Access to sensitive contact fields is governed by{" "}
                <strong className="text-white">
                  Row-Level Security (RLS) policies
                </strong>{" "}
                enforced at the database engine level. This means:
              </p>
              <ul className="list-none space-y-2 mt-1">
                {[
                  "Only the authenticated listing owner and the active claimer can read or modify contact data on a given record.",
                  "Private message threads are scoped strictly to participants — no third party can read, query, or enumerate another user's conversations.",
                  "The anonymous public role can only browse non-sensitive listing fields (title, category, location, status).",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-2 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-slate-400 text-[12px]">
                We do not sell, share, or transmit user data to any third-party
                advertising network or data broker. Platform analytics are
                aggregate-only and contain no personally identifiable
                information.
              </p>
            </div>
          </section>

          {/* Section 2 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-green-600/20 border border-green-500/40 rounded-lg flex items-center justify-center text-green-400 text-[11px] font-bold shrink-0">
                2
              </span>
              <h3 className="text-[15px] font-semibold text-white">
                Institutional Verification & Credential Policy
              </h3>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 space-y-3">
              <p>
                Accounts registered under the{" "}
                <strong className="text-white">
                  School / Non-Profit Recipient
                </strong>{" "}
                account type are subject to additional verification
                requirements. During registration, users in this category must
                provide:
              </p>
              <ul className="list-none space-y-2 mt-1">
                {[
                  "An Official Institutional Domain or Website (e.g. lincolnhigh.edu) confirming organizational legitimacy.",
                  "A Tax ID or Non-Profit Registration Number (e.g. EIN 12-3456789) issued by a recognized governmental authority.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="bg-amber-900/30 border border-amber-700/40 rounded-xl px-4 py-3 mt-2">
                <p className="text-amber-300 text-[13px] font-semibold">
                  ⚠ Misrepresentation Policy
                </p>
                <p className="text-amber-200/80 text-[12px] mt-1">
                  Any misrepresentation of school, university, or non-profit
                  credentials — including submission of fabricated Tax IDs,
                  unaffiliated domains, or impersonation of registered
                  institutions — will result in immediate account restriction,
                  permanent asset flagging, and referral to the appropriate
                  legal authority in the user's jurisdiction. Eqovely reserves
                  the right to revoke verified badges and deny platform access
                  without prior notice.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3 */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-violet-600/20 border border-violet-500/40 rounded-lg flex items-center justify-center text-violet-400 text-[11px] font-bold shrink-0">
                3
              </span>
              <h3 className="text-[15px] font-semibold text-white">
                Physical Escrow Agreement & Platform Liability
              </h3>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 space-y-3">
              <p>
                The Eqovely platform operates exclusively as a{" "}
                <strong className="text-white">
                  communication, verification, and coordination vehicle
                </strong>
                . Our infrastructure facilitates the introduction of donors and
                recipient organizations and provides a structured handoff
                protocol via the 6-digit Escrow Verification PIN system.
              </p>
              <p>
                By using this platform, all parties explicitly acknowledge and
                agree to the following terms:
              </p>
              <ul className="list-none space-y-2 mt-1">
                {[
                  "Eqovely bears no legal responsibility for the physical condition, safety, functionality, or regulatory compliance of any item transferred through the platform.",
                  "The physical exchange of hardware, supplies, or any tangible asset is conducted solely between the donor and recipient parties at their mutual discretion and risk.",
                  "Eqovely is not a logistics provider, warranty issuer, or insurance carrier. No claim may be made against the platform for damage, loss, theft, or injury occurring during or after physical handoff.",
                  "The 6-digit PIN handshake confirms mutual intent to transfer and serves as a digital record of agreement — it does not constitute a legally binding commercial contract under any jurisdiction.",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-2 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-slate-400 text-[12px]">
                Users are encouraged to conduct their own due diligence,
                including visual inspection of items before acceptance, and to
                comply with all applicable local laws governing the transfer of
                equipment and materials.
              </p>
            </div>
          </section>

          {/* Acceptance note */}
          <p className="text-[12px] text-slate-500 text-center pb-2">
            By clicking "I Acknowledge & Agree" below, you confirm you have
            read, understood, and accepted all terms outlined in this agreement.
            This acceptance is logged against your authenticated session.
          </p>
        </div>

        {/* Footer actions */}
        <div className="px-8 py-5 border-t border-slate-700 flex flex-col sm:flex-row gap-3 shrink-0 bg-slate-900">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-[14px] font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-xl transition-all"
          >
            Review Later
          </button>
          <button
            onClick={onAgree}
            className="flex-1 py-3 text-[14px] font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-900/40 hover:-translate-y-0.5"
          >
            I Acknowledge &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}
