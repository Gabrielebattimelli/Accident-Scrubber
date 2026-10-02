"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useEffect, useRef, useState } from "react";
import { BASE, TRANSPORT } from "@/lib/client";
import { AgentPanel } from "./AgentPanel";
import { Inspector } from "./Inspector";
import { Stage } from "./Stage";
import { nextId, store, useStore, type Line } from "./store";
import { TopBar, type Health } from "./TopBar";
import { setContextSink, setNotifier, useAgentTools } from "./useAgentTools";
import type { AgentState } from "./Raccoon";

const appendLine = (role: Line["role"], text: string) =>
  store.set((s) => ({ transcript: [...s.transcript, { id: nextId(), at: Date.now(), role, text }].slice(-60) }));

// Expressive TTS voices inline audio tags like "[laughs]"; they are spoken cues, not transcript text.
const stripAudioTags = (text: string) => text.replace(/\s*\[[a-z][a-z' -]{0,30}\]/gi, "").trim();

function Console() {
  useAgentTools();
  const [error, setError] = useState<string>();
  const [health, setHealth] = useState<Health>();
  const [startedAt, setStartedAt] = useState<number>();
  const busy = useStore((s) => s.activity.some((a) => a.status === "running"));

  const conv = useConversation({
    onMessage: ({ message, role }) => {
      if (message.startsWith("[system notice]")) return;
      const text = role === "agent" ? stripAudioTags(message) : message;
      // Silence arrives as a user turn of just "..."
      if (/[\p{L}\p{N}]/u.test(text)) appendLine(role, text);
    },
    onError: (message) => setError(String(message)),
    onConnect: () => {
      setStartedAt(Date.now());
      const queued = pending.current;
      pending.current = undefined;
      if (queued) setTimeout(() => convRef.current.sendUserMessage(queued), 300);
    },
    onDisconnect: () => {
      setStartedAt(undefined);
      pending.current = undefined;
    },
  });
  const pending = useRef<string>(undefined);

  // Edit-ready notices are pushed into the conversation from outside React.
  const convRef = useRef(conv);
  useEffect(() => {
    convRef.current = conv;
  });
  useEffect(() => {
    setNotifier((t) => {
      if (convRef.current.status === "connected") convRef.current.sendUserMessage(t);
    });
    // What the user changes by hand reaches the agent silently, so "this one" stays meaningful.
    setContextSink((t) => {
      if (convRef.current.status === "connected") convRef.current.sendContextualUpdate(t);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(`${BASE}/api/health`)
        .then((r) => r.json())
        .then((h: Health) => alive && setHealth(h))
        .catch(() => {});
    check();
    const t = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const connected = conv.status === "connected";
  const state: AgentState =
    conv.status === "connecting"
      ? "connecting"
      : !connected
        ? "idle"
        : conv.isSpeaking
          ? "speaking"
          : busy
            ? "thinking"
            : "listening";

  const starting = useRef(false);
  async function start() {
    if (starting.current || conv.status === "connecting" || connected) return;
    starting.current = true;
    setError(undefined);
    const fail = (msg: string) => {
      pending.current = undefined;
      setError(msg);
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia) return fail("Microphone unavailable. Open this page over https or on localhost.");
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => t.stop());
      } catch {
        return fail("Microphone permission was denied. Allow it in your browser's site settings and try again.");
      }
      let cred: { token?: string; signedUrl?: string; error?: string };
      try {
        const res = await fetch(`${BASE}/api/voice/token?transport=${TRANSPORT}`);
        cred = await res.json().catch(() => ({ error: `Voice token request failed (${res.status}).` }));
        if (!res.ok || !(cred.token || cred.signedUrl)) return fail(cred.error || "Could not get a voice session token.");
      } catch {
        return fail("Could not reach the server for a voice session token.");
      }
      if (TRANSPORT === "webrtc") conv.startSession({ conversationToken: cred.token!, connectionType: "webrtc" });
      else conv.startSession({ signedUrl: cred.signedUrl!, connectionType: "websocket" });
    } finally {
      starting.current = false;
    }
  }

  function send(text: string) {
    appendLine("user", text);
    if (connected) return conv.sendUserMessage(text);
    pending.current = pending.current ? `${pending.current}\n${text}` : text;
    void start();
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <TopBar health={health} state={state} startedAt={startedAt} />
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)_320px] xl:grid-cols-[380px_minmax(0,1fr)_340px]">
        <AgentPanel
          state={state}
          conv={conv}
          error={error}
          onDismissError={() => setError(undefined)}
          onStart={start}
          onSend={send}
        />
        <Stage />
        <Inspector />
      </main>
    </div>
  );
}

export function Studio() {
  return (
    <ConversationProvider>
      <Console />
    </ConversationProvider>
  );
}
