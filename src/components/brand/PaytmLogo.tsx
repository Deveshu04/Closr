interface Props {
  /** Rendered height in px; the width follows the wordmark. */
  height?: number;
  className?: string;
}

/** The official Paytm wordmark from public/, shown as-is so its colours are never altered. */
export function PaytmLogo({ height = 24, className = "" }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here
    <img src="/paytm-logo.svg" alt="Paytm" height={height} className={`w-auto shrink-0 ${className}`} style={{ height }} />
  );
}
