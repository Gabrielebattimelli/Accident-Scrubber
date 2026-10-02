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
    onConnect: () => setStartedAt(Date.now()),
    onDisconnect: () => setStartedAt(undefined),
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

  async function start() {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone unavailable. Open this page over https or on localhost.");
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone permission was denied. Allow it in your browser's site settings and try again.");
      return;
    }
    let cred: { token?: string; signedUrl?: string; error?: string };
    try {
      const res = await fetch(`${BASE}/api/voice/token?transport=${TRANSPORT}`);
      cred = await res.json().catch(() => ({ error: `Voice token request failed (${res.status}).` }));
      if (!res.ok || !(cred.token || cred.signedUrl)) {
        setError(cred.error || "Could not get a voice session token.");
        return;
      }
    } catch {
      setError("Could not reach the server for a voice session token.");
      return;
    }
    if (TRANSPORT === "webrtc") conv.startSession({ conversationToken: cred.token!, connectionType: "webrtc" });
    else conv.startSession({ signedUrl: cred.signedUrl!, connectionType: "websocket" });
  }

  function send(text: string) {
    if (!connected) return;
    conv.sendUserMessage(text);
    appendLine("user", text);
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <TopBar health={health} state={state} startedAt={startedAt} />
      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_380px]">
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
