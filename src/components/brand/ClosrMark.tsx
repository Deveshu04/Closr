/** Closr's mark: a loop being closed. Stroke follows `currentColor`; the dot is always Paytm cyan. */
export function ClosrMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <path
        d="M16 4.5a11.5 11.5 0 1 1-10.6 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="5.4" cy="11.5" r="3.1" className="fill-sky" />
    </svg>
  );
}
