import type { ButtonHTMLAttributes, ReactNode } from "react";

// Small design-system primitives. Flat surfaces, hairline borders, colour only for state.

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type Tone = "ok" | "warn" | "danger" | "info" | "idle";

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  idle: "bg-fg-faint",
};

const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  idle: "text-fg-subtle",
};

export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], pulse && "soft-pulse", className)} />;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-fg text-panel hover:bg-fg/85",
  secondary: "border border-line-strong bg-panel text-fg hover:bg-raised",
  ghost: "text-fg-muted hover:bg-raised hover:text-fg",
  danger: "border border-line-strong text-danger hover:border-danger/40 hover:bg-danger/10",
};

const SIZE = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-[13px]",
  icon: "size-8",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md font-normal transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    />
  );
}

/** Small uppercase section label. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("text-[11px] font-normal uppercase tracking-[0.08em] text-fg-subtle", className)}>{children}</h2>;
}

/** Compact mono tag for states and identifiers. */
export function Tag({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[4px] border px-1.5 font-mono text-[10px] uppercase tracking-[0.06em]",
        tone && tone !== "idle" ? `${TEXT[tone]} border-current/25` : "border-line-strong text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Panel header bar: label on the left, optional controls on the right. */
export function PanelHeader({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4", className)}>
      <div className="flex min-w-0 items-center gap-2">{typeof title === "string" ? <Label>{title}</Label> : title}</div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** Two-column key/value list. */
export function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="min-w-0 text-fg">{v || v === 0 ? v : <span className="text-fg-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Hover tooltip, positioned below the trigger. */
export function Tooltip({ content, children, align = "center" }: { content: ReactNode; children: ReactNode; align?: "center" | "end" }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute top-full z-50 mt-2 w-max max-w-72 rounded-md border border-line-strong bg-elevated px-2.5 py-1.5 shadow-[0_4px_16px_rgb(0_0_0/0.08)]",
          "text-xs leading-snug text-fg-muted opacity-0 transition-opacity group-hover/tip:visible group-hover/tip:opacity-100",
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {content}
      </span>
    </span>
  );
}

export const pad2 = (n: string | number) => String(n).padStart(2, "0");
export const fileName = (uri?: string) => uri?.split("/").pop() || "";
export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
