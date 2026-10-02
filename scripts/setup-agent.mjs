#!/usr/bin/env node
// Creates (or updates) the ElevenLabs agent and its client tools from agent/tools.json +
// agent/prompt.md. Idempotent: tools are matched by name, the agent by ELEVENLABS_AGENT_ID.
//
//   npm run agent:setup            # writes ELEVENLABS_AGENT_ID=... into .env.local on first run
//
// Reads ELEVENLABS_API_KEY (and optional ELEVENLABS_AGENT_ID / _LLM / _TTS_MODEL / _VOICE_ID) from the
// environment or .env.local.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
const LLM = process.env.ELEVENLABS_LLM || "qwen35-397b-a17b";
// Empty = the model's own default. Voice needs fast turn-taking: never go above "low".
const REASONING = process.env.ELEVENLABS_REASONING_EFFORT ?? "";
const VOICE = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_v4_turbo";
const FIRST_MESSAGE =
  "Raccoon online. I'm wired into every camera in the archive. What are we looking for?";

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
const buildConfig = (withReasoning) => ({
  agent: {
    first_message: FIRST_MESSAGE,
    language: "en",
    prompt: {
      prompt,
      llm: LLM,
      temperature: 0.3,
      tool_ids: toolIds,
      // PATCH merges, so an unset effort must be sent as null to clear a previous value.
      reasoning_effort: withReasoning && REASONING ? REASONING : null,
    },
  },
  tts: { voice_id: VOICE, model_id: TTS_MODEL, expressive_mode: true },
  turn: { speculative_turn: true },
});

// Some LLMs reject reasoning_effort; retry once without it.
async function upsertAgent(method, path) {
  try {
    return await call(method, path, { name: "Raccoon", conversation_config: buildConfig(true) });
  } catch (e) {
    if (!REASONING || !/reasoning/i.test(e.message)) throw e;
    console.warn(`  ${LLM} rejected reasoning_effort, retrying without it`);
    return call(method, path, { name: "Raccoon", conversation_config: buildConfig(false) });
  }
}

function saveAgentId(id) {
  const file = ".env.local";
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const line = /^[ \t]*ELEVENLABS_AGENT_ID[ \t]*=.*$/m;
  const next = line.test(text)
    ? text.replace(line, `ELEVENLABS_AGENT_ID=${id}`)
    : `${text}${text && !text.endsWith("\n") ? "\n" : ""}ELEVENLABS_AGENT_ID=${id}\n`;
  writeFileSync(file, next);
}

let agentId = process.env.ELEVENLABS_AGENT_ID;
if (agentId) {
  try {
    await upsertAgent("PATCH", `/agents/${agentId}`);
    console.log(`\nUpdated agent ${agentId}`);
  } catch (e) {
    if (!/→ 404/.test(e.message)) throw e;
    console.warn(`  agent ${agentId} no longer exists, creating a new one`);
    agentId = undefined;
  }
}
if (!agentId) {
  const created = await upsertAgent("POST", "/agents/create");
  agentId = created.agent_id;
  saveAgentId(agentId);
  console.log(`\nCreated agent ${agentId} and saved ELEVENLABS_AGENT_ID to .env.local`);
}
console.log(`LLM: ${LLM} (reasoning: ${REASONING || "default"}) · TTS: ${TTS_MODEL} · voice: ${VOICE} · tools: ${toolIds.length}`);
