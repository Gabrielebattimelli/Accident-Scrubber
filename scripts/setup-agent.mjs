#!/usr/bin/env node
// Creates (or updates) the ElevenLabs agent and its client tools from agent/tools.json +
// agent/prompt.md. Idempotent: tools are matched by name, the agent by ELEVENLABS_AGENT_ID.
//
//   npm run agent:setup            # prints ELEVENLABS_AGENT_ID=... on first run
//
// Reads ELEVENLABS_API_KEY (and optional ELEVENLABS_AGENT_ID / _LLM / _VOICE_ID) from the
// environment or .env.local.

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set (export it or put it in .env.local)");
  process.exit(1);
}
const API = "https://api.elevenlabs.io/v1/convai";
const LLM = process.env.ELEVENLABS_LLM || "gemini-2.5-flash";
const VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const FIRST_MESSAGE =
  "Scrubber online. I'm wired into every camera in the archive. What are we looking for?";

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

const tools = JSON.parse(readFileSync("agent/tools.json", "utf8"));
const prompt = readFileSync("agent/prompt.md", "utf8");

// 1. Upsert client tools by name.
const existing = new Map();
try {
  const list = await call("GET", "/tools");
  for (const t of list.tools || []) existing.set(t.tool_config?.name, t.id);
} catch (e) {
  console.warn("Could not list existing tools, creating fresh ones:", e.message);
}

const toolIds = [];
for (const tool of tools) {
  const id = existing.get(tool.name);
  if (id) {
    await call("PATCH", `/tools/${id}`, { tool_config: tool });
    toolIds.push(id);
    console.log(`  updated tool ${tool.name}`);
  } else {
    const created = await call("POST", "/tools", { tool_config: tool });
    toolIds.push(created.id);
    console.log(`  created tool ${tool.name}`);
  }
}

// 2. Create or update the agent.
const conversation_config = {
  agent: {
    first_message: FIRST_MESSAGE,
    language: "en",
    prompt: { prompt, llm: LLM, temperature: 0.3, tool_ids: toolIds },
  },
  tts: { voice_id: VOICE, model_id: "eleven_flash_v2" },
};

let agentId = process.env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await call("PATCH", `/agents/${agentId}`, { name: "Accident Scrubber", conversation_config });
  console.log(`\nUpdated agent ${agentId}`);
} else {
  const created = await call("POST", "/agents/create", { name: "Accident Scrubber", conversation_config });
  agentId = created.agent_id;
  console.log(`\nCreated agent. Add this to .env.local (or export it):\n\nELEVENLABS_AGENT_ID=${agentId}\n`);
}
console.log(`LLM: ${LLM} · voice: ${VOICE} · tools: ${toolIds.length}`);
