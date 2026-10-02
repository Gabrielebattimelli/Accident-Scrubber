// Raccoon brand: a bandit mask (the mark) and the wordmark set in Geist.

/** Mask with two eye holes, drawn in a 24×24 box. Shared with app/icon.svg and the OG image. */
export const MASK =
  "M1.5 11C4 7.5 9 6.5 12 9C15 6.5 20 7.5 22.5 11C20.5 15.5 15.5 17.5 12 14.5C8.5 17.5 3.5 15.5 1.5 11Z" +
  "M5.4 11.8a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0Z" +
  "M14.4 11.8a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0Z";

/** The mark alone. Sized by className (square). */
export function RaccoonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Raccoon">
      <path d={MASK} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Mark + wordmark lockup. Size it with the text size; the mark follows. */
export function RaccoonLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.35em] ${className ?? ""}`} aria-label="Raccoon">
      <RaccoonMark className="h-[1.25em] w-auto" />
      <span className="font-normal leading-none tracking-[-0.025em]">Raccoon</span>
    </span>
  );
}
