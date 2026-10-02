"use client";

import {
  Cctv,
  CircleAlert,
  Crosshair,
  ListVideo,
  LoaderCircle,
  MessageSquareText,
  MonitorPlay,
  RefreshCw,
  ScanEye,
  ScanSearch,
  Search,
  ShieldCheck,
  SkipForward,
  Wand,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "./store";
import { clockTime, cx } from "./ui";

const ICON: Record<string, LucideIcon> = {
  search_archive: Search,
  ask_archive: MessageSquareText,
  list_cameras: Cctv,
  show_clip: MonitorPlay,
  look_closer: ScanEye,
  detect_objects: ScanSearch,
  show_detections: ScanSearch,
  focus_object: Crosshair,
  seek_clip: SkipForward,
  summarize_video: ListVideo,
  edit_clip: Wand,
  check_edit: RefreshCw,
  verify_clip: ShieldCheck,
};

const STACK: Record<string, string> = {
  search_archive: "VSS · Cosmos Embed · VastDB",
  ask_archive: "VSS agent",
  list_cameras: "VSS metadata",
  show_clip: "Viewer",
  look_closer: "Cosmos3-Reason",
  detect_objects: "YOLO11 · IoU tracker",
  show_detections: "Viewer · YOLO11 boxes",
  focus_object: "Viewer · track highlight",
  seek_clip: "Viewer",
  summarize_video: "VSS synthesize",
  edit_clip: "W&B Inference → fal",
  check_edit: "Edit ledger",
  verify_clip: "SHA-256 · Cosmos3-Reason",
};

export function ActivityFeed() {
  const activity = useStore((s) => s.activity);
  if (!activity.length) return <p className="py-2 text-xs text-fg-subtle">Tool calls appear here as the agent works.</p>;

  return (
    <ol>
      <AnimatePresence initial={false}>
        {activity.map((a) => {
          const Icon = ICON[a.tool] || Search;
          return (
            <motion.li
              key={a.id}
              layout="position"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 border-b py-3 last:border-0"
            >
              <span className="pt-px">
                {a.status === "running" ? (
                  <LoaderCircle size={14} strokeWidth={1.5} className="animate-spin text-info" />
                ) : a.status === "error" ? (
                  <CircleAlert size={14} strokeWidth={1.5} className="text-danger" />
                ) : (
                  <Icon size={14} strokeWidth={1.5} className="text-fg-subtle" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] text-fg">{a.label}</p>
                <p className="truncate font-mono text-[10px] text-fg-subtle">{STACK[a.tool] || a.tool}</p>
                {a.detail && (
                  <p className={cx("mt-1.5 line-clamp-2 text-xs leading-snug", a.status === "error" ? "text-danger/90" : "text-fg-muted")}>
                    {a.detail}
                  </p>
                )}
              </div>
              <div className="text-right font-mono text-[10px] leading-[18px] text-fg-faint">
                <div>{clockTime(a.at)}</div>
                <div className={a.status === "running" ? "text-info" : undefined}>
                  {a.ms !== undefined ? `${(a.ms / 1000).toFixed(1)}s` : "running"}
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
