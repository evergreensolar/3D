export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold text-brand-700 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="#15803d" />
        <circle cx="16" cy="11" r="4.5" fill="#fde047" />
        <path d="M6 22 L16 15 L26 22 Z" fill="#dcfce7" />
        <path d="M9 24h14" stroke="#dcfce7" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="leading-none">Evergreen Solar</span>
    </span>
  );
}
