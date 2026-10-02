"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ACCENT } from "./DetectionOverlay";
import { store, useStore, type Card } from "./store";
import { tellAgent } from "./useAgentTools";
import { Label, cx, pad2 } from "./ui";

// The agent's board: generated UI cards (show_card). Each section is optional, so the agent can
// compose a finding, a stat panel, a chart, a checklist, a clip shortlist or a clickable timeline.

const TONE: Record<Card["tone"], { bar: string; label: string }> = {
  note: { bar: "bg-fg-faint", label: "Note" },
  finding: { bar: "bg-[#ff5a1f]", label: "Finding" },
  warning: { bar: "bg-danger", label: "Warning" },
  ok: { bar: "bg-ok", label: "Confirmed" },
};

const open = (id: string) => {
  store.set({ activeClipId: id, activeEditId: undefined, verify: undefined, layout: { mode: "single" } });
  tellAgent(`user opened clip ${id} from a card`);
};

function CardView({ card }: { card: Card }) {
  const max = Math.max(1, ...(card.bars || []).map(([, v]) => v));
  const tone = TONE[card.tone];
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="relative overflow-hidden rounded-lg border bg-panel"
    >
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", tone.bar)} />
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">
            {tone.label} · {card.id}
          </p>
          <h3 className="text-[15px] font-normal leading-snug text-fg">{card.title}</h3>
        </div>
        <button
          type="button"
          aria-label="Dismiss card"
          onClick={() => store.set((s) => ({ cards: s.cards.filter((c) => c.id !== card.id) }))}
          className="rounded-md p-1 text-fg-faint hover:bg-raised hover:text-fg"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>
      <div className="space-y-3 px-4 pb-4">
        {card.body && <p className="text-[13px] leading-relaxed text-fg-muted">{card.body}</p>}
        {!!card.stats?.length && (
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-px overflow-hidden rounded-md border bg-line">
            {card.stats.map(([k, v]) => (
              <div key={k} className="bg-panel px-3 py-2">
                <dt className="truncate text-[11px] text-fg-subtle">{k}</dt>
                <dd className="truncate text-[20px] font-light leading-tight tracking-tight text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {!!card.bars?.length && (
          <ul className="space-y-1.5">
            {card.bars.map(([k, v]) => (
              <li key={k} className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-3 text-xs">
                <span className="truncate capitalize text-fg-muted">{k}</span>
                <span className="h-1.5 rounded-full bg-raised">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ background: ACCENT }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(Math.max(0, v) / max) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </span>
                <span className="text-right font-mono text-fg">{v}</span>
              </li>
            ))}
          </ul>
        )}
        {!!card.bullets?.length && (
          <ul className="space-y-1">
            {card.bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-fg-muted">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-subtle" />
                {b}
              </li>
            ))}
          </ul>
        )}
        {!!card.moments?.length && card.clipId && (
          <ol className="divide-y overflow-hidden rounded-md border">
            {card.moments.map(([t, label]) => (
              <li key={`${t}${label}`}>
                <button
                  type="button"
                  onClick={() => {
                    store.set({
                      activeClipId: card.clipId,
                      activeEditId: undefined,
                      layout: { mode: "single" },
                      seek: { clipId: card.clipId!, t, pause: true, n: Date.now() },
                    });
                    tellAgent(`user jumped clip ${card.clipId} to ${t}s ("${label}")`);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs hover:bg-raised"
                >
                  <span className="w-10 font-mono text-fg-subtle">{t.toFixed(1)}s</span>
                  <span className="text-fg">{label}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {!!card.clips?.length && (
          <div className="flex flex-wrap gap-1.5">
            {card.clips.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => open(id)}
                className="rounded-md border px-2 py-1 font-mono text-[11px] text-fg-muted hover:border-line-strong hover:bg-raised hover:text-fg"
              >
                Clip {pad2(id)} →
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.article>
  );
}

export function Board() {
  const cards = useStore((s) => s.cards);
  if (!cards.length) return null;
  return (
    <section className="px-4 pb-4">
      <div className="mb-2.5 flex items-center justify-between">
        <Label>Board · from Hailmary</Label>
        <button type="button" onClick={() => store.set({ cards: [], spotlight: [] })} className="text-xs text-fg-subtle hover:text-fg">
          Clear
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {cards.map((c) => (
            <CardView key={c.id} card={c} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
