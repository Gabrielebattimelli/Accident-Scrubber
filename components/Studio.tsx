"use client";

import { Button, Chip, Input, TextField } from "@heroui/react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BASE, TRANSPORT } from "@/lib/client";
import { ActivityFeed } from "./ActivityFeed";
import { ClipReel } from "./ClipReel";
import { Orb, type OrbMode } from "./Orb";
import { Stage } from "./Stage";
import { nextId, store, useStore } from "./store";
import { setNotifier, useAgentTools } from "./useAgentTools";

const EXAMPLES = [
  "Find a truck changing lanes on the highway",
  "Show me a forklift close to a person in the warehouse",
  "Edit clip one: remove the truck",
  "Is that clip real?",
];

type Health = Record<string, string>;

function HealthChips({ health }: { health?: Health }) {
  if (!health) return null;
  const items: [string, string][] = [
    ["VSS", health.vss],
    ["Voice", health.voice],
    ["Edit", health.edit],
    ["Cosmos", health.cosmos],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([k, v]) => {
        const ok = v === "ok" || v === "configured" || v?.startsWith("ok");
        return (
          <Chip key={k} size="sm" variant="soft" color={ok ? "success" : "danger"}>
            <span title={v}>{k}</span>
          </Chip>
        );
      })}
    </div>
  );
}

function Console() {
  useAgentTools();
  const [error, setError] = useState<string>();
  const [text, setText] = useState("");
  const [health, setHealth] = useState<Health>();
  const transcript = useStore((s) => s.transcript);
  const busy = useStore((s) => s.activity.some((a) => a.status === "running"));

  const conv = useConversation({
    onMessage: ({ message, role }) => {
      if (message.startsWith("[system notice]")) return;
      store.set((s) => ({ transcript: [...s.transcript, { id: nextId(), role, text: message }].slice(-40) }));
    },
    onError: (message) => setError(String(message)),
  });

  // Edit-ready notices are pushed into the conversation from outside React.
  const convRef = useRef(conv);
  useEffect(() => {
    convRef.current = conv;
  });
  useEffect(() => {
    setNotifier((t) => {
      if (convRef.current.status === "connected") convRef.current.sendUserMessage(t);
    });
    fetch(`${BASE}/api/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  const connected = conv.status === "connected";
  const connecting = conv.status === "connecting";
  const mode: OrbMode = connecting
    ? "connecting"
    : !connected
      ? "idle"
      : busy
        ? "thinking"
        : conv.isSpeaking
          ? "speaking"
          : "listening";

  async function start() {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone unavailable: open this page over https or on localhost (README → Microphone).");
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone permission was denied.");
      return;
    }
    const res = await fetch(`${BASE}/api/voice/token?transport=${TRANSPORT}`);
    const cred = (await res.json()) as { token?: string; signedUrl?: string; error?: string };
    if (!res.ok) {
      setError(cred.error || "Could not get a voice session token.");
      return;
    }
    if (TRANSPORT === "webrtc") conv.startSession({ conversationToken: cred.token!, connectionType: "webrtc" });
    else conv.startSession({ signedUrl: cred.signedUrl!, connectionType: "websocket" });
  }

  function send() {
    const t = text.trim();
    if (!t || !connected) return;
    conv.sendUserMessage(t);
    store.set((s) => ({ transcript: [...s.transcript, { id: nextId(), role: "user" as const, text: t }].slice(-40) }));
    setText("");
  }

  const lastAgent = [...transcript].reverse().find((l) => l.role === "agent");
  const lastUser = [...transcript].reverse().find((l) => l.role === "user");
  const live = connected || connecting;

  return (
    <main className="grid-bg min-h-screen">
      <AnimatePresence mode="popLayout">
        {!live ? (
          <motion.section
            key="hero"
            exit={{ opacity: 0 }}
            className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center"
          >
            <span className="font-mono text-xs uppercase tracking-[0.45em] text-scrub">Accident Scrubber</span>
            <motion.div layoutId="orb">
              <Orb mode={mode} size={360} />
            </motion.div>
            <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-6xl">Talk to your footage.</h1>
            <p className="max-w-xl text-balance text-lg text-foreground/70">
              Find any moment across every camera, rewrite it with one sentence, and prove what really happened.
            </p>
            <Button size="lg" onPress={start} className="px-10">
              ● Start talking
            </Button>
            {error && <p className="max-w-lg text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((e) => (
                <Chip key={e} size="sm" variant="soft">
                  “{e}”
                </Chip>
              ))}
            </div>
            <HealthChips health={health} />
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted">
              VAST · NVIDIA Cosmos · YOLO11 · W&amp;B Inference · ElevenLabs · fal
            </p>
          </motion.section>
        ) : (
          <motion.section
            key="console"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mx-auto grid max-w-[1600px] gap-5 p-5 lg:grid-cols-[340px_1fr]"
          >
            <header className="flex items-center justify-between lg:col-span-2">
              <div className="flex items-center gap-3">
                <span className="rec-dot inline-block h-2.5 w-2.5 rounded-full bg-scrub" />
                <span className="font-mono text-sm uppercase tracking-[0.35em]">Accident Scrubber</span>
              </div>
              <HealthChips health={health} />
            </header>

            <aside className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface/50 p-4 backdrop-blur">
                <motion.div layoutId="orb">
                  <Orb mode={mode} size={220} getInput={conv.getInputVolume} getOutput={conv.getOutputVolume} />
                </motion.div>
                <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
                  {mode === "thinking" ? "working" : mode}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onPress={() => conv.setMuted(!conv.isMuted)}>
                    {conv.isMuted ? "Unmute mic" : "Mute mic"}
                  </Button>
                  <Button size="sm" variant="danger" onPress={() => conv.endSession()}>
                    End
                  </Button>
                </div>
                <div className="min-h-24 w-full space-y-2 pt-2">
                  <AnimatePresence mode="wait">
                    {lastAgent && (
                      <motion.p
                        key={lastAgent.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-[15px] leading-snug"
                      >
                        {lastAgent.text}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  {lastUser && <p className="font-mono text-xs text-listen">you › {lastUser.text}</p>}
                </div>
                <TextField aria-label="Type to the agent" value={text} onChange={setText} fullWidth>
                  <Input
                    placeholder="…or type a request and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") send();
                    }}
                  />
                </TextField>
                {error && <p className="text-xs text-danger">{error}</p>}
              </div>
              <ActivityFeed />
            </aside>

            <div className="flex min-w-0 flex-col gap-5">
              <Stage />
              <ClipReel />
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}

export function Studio() {
  return (
    <ConversationProvider>
      <Console />
    </ConversationProvider>
  );
}
