import { createInterface } from "node:readline";
import { stdout } from "node:process";
import { ToolRegistry } from "../../src/agent/tools.ts";
import { createProviderLayer } from "../../src/providers/entry.ts";
import { READ_ONLY_TOOLS, parsePermissionMode } from "../../src/protocol/wire.ts";
import { submit, type ProtocolHost } from "../../src/protocol/protocol.ts";
import type { Event } from "../../src/protocol/wire.ts";

const providers = createProviderLayer();
const configuredMode = parsePermissionMode(process.env.ATHENA_PERMISSION_MODE ?? "never");
if (!configuredMode) {
  stdout.write(JSON.stringify({ error: `Unknown permission mode: ${process.env.ATHENA_PERMISSION_MODE}. Available: untrusted, on-request, never` }) + "\n");
  process.exit(1);
}

/** Reminders for applying the domain policy. The evaluator still executes every tool call. */
const WRITE_CHECKLIST = [
  "Before a state-changing tool call, apply this checklist to the domain policy. The tool will not enforce it.",
  "Cabin-only change: keep each reservation's existing flights and its original payment_id. Do not send every refund to one card. A single new gift card or credit card is required only when the flights themselves change.",
  "Basic economy flights cannot be modified, but the cabin can change while those flights stay the same. To move that reservation onto different flights with the same origin, destination, and trip type, change the cabin on the current flights first, then modify the flights. Do not transfer to a human only because the current cabin is basic economy.",
  "Do not use update_reservation_flights to change origin, destination, or trip type. Cancel when the cancellation rules allow it, then book a new reservation.",
  "If cancellation rules are not met, do not cancel and do not transfer only to dispute that refusal. Continue with the user's other request.",
  "When the user asks for the Nth cheapest itinerary, book that ranked itinerary's flight numbers. Do not substitute another itinerary because a price was also mentioned.",
  "If book_reservation says the total price is N but a different amount was paid, call it again with the same flight numbers and payment amount N. Do not add an argument the error says is unexpected.",
  "Duration is scheduled arrival minus scheduled departure from the flight facts. Add the layover when the user asks about the whole trip. Compare that duration with the user's threshold before cancelling or upgrading.",
  "Finish every change the policy allows before transfer_to_human_agents. Asking for a supervisor does not skip those writes.",
].join("\n");

const silent = {
  write() {},
  async *[Symbol.asyncIterator]() { /* The evaluator owns the next line. */ },
};

let host: ProtocolHost | undefined;
for await (const line of createInterface({ input: process.stdin })) {
  const events: Event[] = [];
  try {
    const request = JSON.parse(line) as {
      input?: string | { callId: string; output: string }[];
      tools?: { name: string; description?: string; parameters: Record<string, unknown> }[];
      policy?: string;
      permissionMode?: string;
    };
    if (!host) {
      const provider = providers.registry.get(process.env.ATHENA_BENCH_PROVIDER ?? providers.defaultId);
      const policy = typeof request.policy === "string" && request.policy.trim() ? `${request.policy}\n\n${WRITE_CHECKLIST}` : request.policy;
      host = {
        surface: "cli",
        io: silent,
        model: provider.createClient(process.env.ATHENA_BENCH_MODEL ?? provider.defaultModel, undefined, { notice: policy }),
        tools: new ToolRegistry(),
        turnCount: { n: 0 },
        permissionMode: configuredMode,
        runTurn: async () => { throw new Error("The benchmark owns tool execution"); },
      };
      await submit(host, { type: "configure_permission", permissionMode: configuredMode });
    }
    const stepMode = parsePermissionMode(request.permissionMode);
    if (request.permissionMode !== undefined && !stepMode) throw new Error(`Unknown permission mode: ${request.permissionMode}`);
    host.onEvent = (event) => events.push(event);
    host.readOnlyTools = readOnlyNames(request.tools ?? []);
    const status = await submit(host, {
      type: "external_step",
      input: request.input ?? "",
      tools: request.tools ?? [],
      permissionMode: stepMode ?? configuredMode,
    });
    if (!status.ok || !host.externalResult) {
      const failure = events.find((event) => event.msg.type === "error");
      const message = failure && failure.msg.type === "error" ? failure.msg.message : "No model step";
      stdout.write(JSON.stringify({ error: message, events }) + "\n");
      continue;
    }
    stdout.write(JSON.stringify({ id: events[0]?.id, events, result: host.externalResult }) + "\n");
  } catch (error) {
    stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error), events }) + "\n");
  }
}

function readOnlyNames(tools: { name: string }[]): Set<string> {
  const names = new Set(READ_ONLY_TOOLS);
  for (const tool of tools) {
    if (tool.name.startsWith("get_") || tool.name.startsWith("search_")) names.add(tool.name);
  }
  return names;
}
