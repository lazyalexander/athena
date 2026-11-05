import type { ToolRegistry } from "./tools.ts";

const WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** Pure time arithmetic. Eligibility rules remain with the application. */
export function registerTimeTools(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: "elapsed_time",
      description: "Calculate the exact elapsed seconds and hours between two ISO 8601 timestamps with explicit UTC offsets. This tool does not decide policy eligibility.",
      parameters: {
        type: "object",
        properties: { start: { type: "string" }, end: { type: "string" } },
        required: ["start", "end"],
      },
    },
    execute: async ({ start, end }) => {
      if (typeof start !== "string" || typeof end !== "string" || !WITH_ZONE.test(start) || !WITH_ZONE.test(end)) {
        throw new Error("Both timestamps need explicit UTC offsets");
      }
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("Invalid timestamp");
      const seconds = (endMs - startMs) / 1000;
      return JSON.stringify({ elapsedSeconds: seconds, elapsedHours: seconds / 3600 });
    },
  });
}
