import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { JournalEvent } from "../src/session/journal.ts";
import { chatHistoryFromEvents } from "../src/providers/chat.ts";
import { createProviderLayer, parseProviderFile } from "../src/providers/entry.ts";

const chatEntry = {
  id: "box",
  protocol: "chat",
  baseUrl: "https://example.com/v1",
  keyEnv: "BOX_API_KEY",
  defaultModel: "m",
};

test("provider layer registers the built-in connections from the given env", () => {
  const layer = createProviderLayer({});
  assert.equal(layer.defaultId, "ollama");
  assert.deepEqual(layer.registry.ids(), ["ollama", "openai", "deepseek"]);
  assert.throws(() => layer.registry.get("openai").createClient("gpt-6-astra"), /OPENAI_API_KEY/);
  assert.throws(() => layer.registry.get("deepseek").createClient("deepseek-chat"), /DEEPSEEK_API_KEY/);
  const keyed = createProviderLayer({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "demo", DEEPSEEK_MODEL: "deepseek-reasoner" });
  assert.equal(keyed.registry.get("openai").defaultModel, "demo");
  assert.equal(keyed.registry.get("deepseek").defaultModel, "deepseek-reasoner");
});

test("provider file adds a chat connection and refuses embedded secrets", () => {
  const secret = "sk-testsecretvalue";
  const embedded = parseFailure(JSON.stringify({ providers: [{ ...chatEntry, apiKey: secret }] }));
  assert.match(embedded, /keyEnv/);
  assert.equal(embedded.includes(secret), false);
  const valued = parseFailure(JSON.stringify({ providers: [{ ...chatEntry, defaultModel: secret }] }));
  assert.match(valued, /secret value/);
  assert.equal(valued.includes(secret), false);
  assert.throws(() => parseProviderFile(JSON.stringify({
    providers: [{ ...chatEntry, baseUrl: "http://example.com/v1" }],
  })), /HTTPS/);
  assert.throws(() => parseProviderFile("{"), /not valid JSON/);
  const parsed = parseProviderFile(JSON.stringify({ providers: [chatEntry] }));
  assert.equal(parsed[0]?.apiKey, undefined);
  assert.equal(parsed[0]?.keyEnv, "BOX_API_KEY");
});

test("an extra provider file is registered and still reads its key from the env", () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-providers-"));
  const path = join(dir, "providers.local.json");
  try {
    writeFileSync(path, JSON.stringify({ providers: [chatEntry] }));
    const missing = createProviderLayer({}, path);
    assert.deepEqual(missing.registry.ids(), ["ollama", "openai", "deepseek", "box"]);
    assert.throws(() => missing.registry.get("box").createClient("m"), /BOX_API_KEY/);
    assert.throws(() => createProviderLayer({}, join(dir, "missing.json")), /Cannot read provider file/);
    writeFileSync(path, JSON.stringify({ providers: [{ ...chatEntry, id: "ollama" }] }));
    assert.throws(() => createProviderLayer({}, path), /Duplicate provider: ollama/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("responses and chat clients send the caller notice and do not log the key", async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = [];
  try {
    globalThis.fetch = async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      requests.push({ url: String(url), authorization: headers.Authorization, body: JSON.parse(String(init?.body)) });
      if (String(url).endsWith("/responses")) {
        return new Response(JSON.stringify({ id: "r1", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }), { status: 200 });
      }
      const turn = requests.filter((request) => request.url.endsWith("/chat/completions")).length;
      const message = turn === 1
        ? { content: "", tool_calls: [{ id: "call-1", function: { name: "echo", arguments: { text: "hi" } } }] }
        : { content: "done" };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
    };
    const layer = createProviderLayer({ OPENAI_API_KEY: "test-key" });
    const responses = layer.registry.get("openai").createClient("gpt-6-astra", undefined, { notice: "domain policy" });
    assert.equal((await responses.generate("hi", { definitions: [], call: async () => "" })).text, "ok");
    assert.match(String(requests[0]?.body.instructions), /domain policy/);
    assert.equal(requests[0]?.authorization, "Bearer test-key");

    const dir = mkdtempSync(join(tmpdir(), "athena-providers-"));
    try {
      const path = join(dir, "providers.local.json");
      writeFileSync(path, JSON.stringify({ providers: [chatEntry] }));
      const chat = createProviderLayer({ BOX_API_KEY: "box-key" }, path).registry.get("box")
        .createClient("m", undefined, { notice: "chat policy" });
      const tools = { definitions: [{ name: "echo", parameters: { type: "object" } }], call: async () => "ok" };
      const first = await chat.generate("start", tools);
      assert.equal(first.calls[0]?.callId, "call-1");
      assert.equal(first.calls[0]?.arguments, JSON.stringify({ text: "hi" }));
      const second = await chat.generate([{ callId: "call-1", output: "ok" }], tools);
      assert.equal(second.text, "done");
      const chatRequests = requests.filter((request) => request.url === "https://example.com/v1/chat/completions");
      assert.equal(chatRequests[0]?.authorization, "Bearer box-key");
      assert.match(String(chatRequests[0]?.body.messages && (chatRequests[0].body.messages as Array<{ content: string }>)[0]?.content), /chat policy/);
      const followup = chatRequests[1]?.body.messages as Array<{ role: string; tool_call_id?: string; content?: string }>;
      assert.equal(followup.at(-1)?.role, "tool");
      assert.equal(followup.at(-1)?.tool_call_id, "call-1");
      assert.equal(JSON.stringify(chatRequests[0]?.body).includes("box-key"), false);
      assert.equal(JSON.stringify(chatRequests[1]?.body).includes("box-key"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("chat history keeps the user turn and drops an unfinished tool step", () => {
  const events: JournalEvent[] = [
    { type: "conversation_start", provider: "box", model: "m", ts: 1 },
    { type: "turn_start", turnId: "t", ts: 1 },
    { type: "user", turnId: "t", text: "hi" },
    { type: "assistant_step", turnId: "t", text: "", calls: [{ name: "echo", callId: "c1", arguments: "{}" }] },
  ];
  assert.deepEqual(chatHistoryFromEvents(events), [{ role: "user", content: "hi" }]);
});

function parseFailure(text: string): string {
  try {
    parseProviderFile(text);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the provider file to be rejected");
}
