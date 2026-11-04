import assert from "node:assert/strict";
import { test } from "node:test";
import type { JournalEvent } from "../src/session/journal.ts";
import { ModelManager } from "../src/providers/model-manager.ts";
import { createOllamaProvider, ollamaHistoryFromEvents } from "../src/providers/ollama.ts";
import { createOpenAIProvider } from "../src/providers/openai.ts";
import { ProviderRegistry } from "../src/providers/providers.ts";
import { ToolRegistry } from "../src/agent/tools.ts";

const NOTICE = '<turn_aborted reason="process_exit">interrupted</turn_aborted>';

const crashedEvents: JournalEvent[] = [
  { type: "conversation_start", provider: "ollama", model: "qwen3:1.7b", ts: 1 },
  { type: "turn_start", turnId: "t1", ts: 2 },
  { type: "user", turnId: "t1", text: "read the file" },
  { type: "assistant_step", turnId: "t1", text: "", calls: [{ name: "read_file", callId: "c1", arguments: "{\"path\":\"a.txt\"}" }] },
  { type: "tool_result", turnId: "t1", callId: "c1", ok: true, output: "file content" },
  { type: "assistant_step", turnId: "t1", text: "done reading", calls: [] },
  { type: "turn_end", turnId: "t1", answer: "done reading", ts: 3 },
  { type: "turn_start", turnId: "t2", ts: 4 },
  { type: "user", turnId: "t2", text: "now write it" },
  { type: "assistant_step", turnId: "t2", text: "", calls: [{ name: "write_file", callId: "c2", arguments: "{\"path\":\"b.txt\"}" }] },
];

test("ollamaHistoryFromEvents replays complete steps and drops the incomplete tail", () => {
  const { messages, pending } = ollamaHistoryFromEvents(crashedEvents);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "tool", "assistant", "user"]);
  assert.equal(messages[0].content, "read the file");
  assert.equal(messages[2].tool_name, "read_file");
  assert.equal(messages[2].content, "file content");
  assert.equal(messages[4].content, "now write it");
  assert.equal(pending.size, 0);
});

test("ollama provider restore replays history and appends the notice to the system prompt", async () => {
  const original = globalThis.fetch;
  try {
    let captured: { messages: Array<{ role: string; content: string }> } | undefined;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    };
    const provider = createOllamaProvider();
    const client = provider.restore!("qwen3:1.7b", crashedEvents, NOTICE);
    await client.generate("继续", new ToolRegistry());
    assert.ok(captured);
    assert.equal(captured!.messages[0].role, "system");
    assert.match(captured!.messages[0].content, /<turn_aborted/);
    assert.deepEqual(captured!.messages.slice(1).map((m) => m.role), ["user", "assistant", "tool", "assistant", "user", "user"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("ollama restored session allocates new tool call IDs", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: { content: "", tool_calls: [
      { function: { name: "read_file", arguments: { path: "next.txt" } } },
    ] } }), { status: 200 });
    const events: JournalEvent[] = [
      { type: "conversation_start", provider: "ollama", model: "m", ts: 1 },
      { type: "assistant_step", turnId: "t1", text: "", calls: [{ name: "read_file", callId: "ollama-4-0", arguments: '{"path":"old.txt"}' }] },
      { type: "tool_result", turnId: "t1", callId: "ollama-4-0", ok: true, output: "old" },
    ];
    const step = await createOllamaProvider().restore!("m", events, "").generate("next", new ToolRegistry());
    assert.equal(step.calls[0]?.callId, "ollama-5-0");
  } finally { globalThis.fetch = original; }
});

test("openai provider restore resumes the response chain and appends the notice", async () => {
  const original = globalThis.fetch;
  try {
    let captured: { previous_response_id?: string; instructions?: string } | undefined;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "resp_456", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }), { status: 200 });
    };
    const events: JournalEvent[] = [
      { type: "conversation_start", provider: "openai", model: "gpt-6-astra", ts: 1 },
      { type: "assistant_step", turnId: "t1", text: "partial", calls: [], responseId: "resp_123" },
    ];
    const provider = createOpenAIProvider({ apiKey: "test-key" });
    const client = provider.restore!("gpt-6-astra", events, NOTICE);
    await client.generate("继续", new ToolRegistry());
    assert.equal(captured?.previous_response_id, "resp_123");
    assert.match(captured?.instructions ?? "", /<turn_aborted/);
  } finally {
    globalThis.fetch = original;
  }
});

test("openai restore without any responseId in the journal throws", () => {
  const provider = createOpenAIProvider({ apiKey: "test-key" });
  const events: JournalEvent[] = [
    { type: "conversation_start", provider: "openai", model: "gpt-6-astra", ts: 1 },
    { type: "user", turnId: "t1", text: "hi" },
  ];
  assert.throws(() => provider.restore!("gpt-6-astra", events, NOTICE), /no response/i);
});

test("openai restore resumes from the last step with no calls, not a broken tail", async () => {
  const original = globalThis.fetch;
  try {
    let captured: { previous_response_id?: string } | undefined;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "resp_new", output: [] }), { status: 200 });
    };
    const events: JournalEvent[] = [
      { type: "conversation_start", provider: "openai", model: "gpt-6-astra", ts: 1 },
      { type: "assistant_step", turnId: "t1", text: "fine", calls: [], responseId: "resp_safe" },
      { type: "assistant_step", turnId: "t2", text: "", calls: [{ name: "write_file", callId: "c1", arguments: "{}" }], responseId: "resp_broken" },
    ];
    const provider = createOpenAIProvider({ apiKey: "test-key" });
    const client = provider.restore!("gpt-6-astra", events, NOTICE);
    await client.generate("next", new ToolRegistry());
    assert.equal(captured?.previous_response_id, "resp_safe");
  } finally {
    globalThis.fetch = original;
  }
});

test("openai restore throws when the only response ids have unanswered calls", () => {
  const provider = createOpenAIProvider({ apiKey: "test-key" });
  const events: JournalEvent[] = [
    { type: "conversation_start", provider: "openai", model: "gpt-6-astra", ts: 1 },
    { type: "assistant_step", turnId: "t1", text: "", calls: [{ name: "write_file", callId: "c1", arguments: "{}" }], responseId: "resp_broken" },
  ];
  assert.throws(() => provider.restore!("gpt-6-astra", events, NOTICE), /no response/i);
});

test("ollamaHistoryFromEvents ignores events before the last conversation_start", () => {
  const events: JournalEvent[] = [
    { type: "user", turnId: "t0", text: "stale from an older conversation" },
    { type: "conversation_start", provider: "ollama", model: "qwen3:1.7b", ts: 1 },
    { type: "user", turnId: "t1", text: "hello" },
    { type: "assistant_step", turnId: "t1", text: "hi", calls: [] },
  ];
  const { messages } = ollamaHistoryFromEvents(events);
  assert.deepEqual(messages.map((m) => m.content), ["hello", "hi"]);
});

test("ModelManager.restore switches to the journaled provider and reset clears the flag", async () => {
  const registry = new ProviderRegistry();
  registry.register(createOllamaProvider());
  registry.register(createOpenAIProvider({ apiKey: "test-key" }));
  const manager = new ModelManager(registry);
  assert.equal(manager.restoredAborted, false);
  const events: JournalEvent[] = [
    { type: "conversation_start", provider: "openai", model: "gpt-6-astra", ts: 1 },
    { type: "assistant_step", turnId: "t1", text: "partial", calls: [], responseId: "resp_9" },
  ];
  await manager.restore(events, NOTICE);
  assert.equal(manager.current, "openai: gpt-6-astra");
  assert.equal(manager.restoredAborted, true);
  manager.reset();
  assert.equal(manager.restoredAborted, false);
  assert.equal(manager.current, "openai: gpt-6-astra");
});
