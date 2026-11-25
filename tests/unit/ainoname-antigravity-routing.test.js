import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const base = new URL("../../ainoname-client/", import.meta.url);
const launcher = new URL("ainoname-agent.bundle.js", base);

function loadRouting(mapping = {}) {
  const mockProcess = Object.create(process);
  mockProcess.on = () => mockProcess;
  const context = {
    __dirname: "ainoname-client",
    require: createRequire(launcher),
    process: mockProcess,
    Buffer,
    mapping,
  };
  context.global = context;
  const source = readFileSync(launcher, "utf8").replace(/\bmain\(\);\s*$/, `
    config.modelMapping = { ...config.modelMapping, ...globalThis.mapping };
    globalThis.route = (url, body) => {
      const incoming = getRequestedModel(url, body);
      body.model = resolveMappedModel(normalizeIdeModel(incoming, body));
      applyMappedThinking(body, body.model);
      return { incoming, body };
    };
  `);
  runInNewContext(source, context);
  return context.route;
}

function ideBody(model, level) {
  return {
    model,
    userAgent: "antigravity",
    request: {
      contents: [{ role: "user", parts: [{ text: "Reply OK." }] }],
      generationConfig: {
        maxOutputTokens: 128,
        ...(level ? { thinkingConfig: { thinkingLevel: level, includeThoughts: false, thinkingBudget: 10 } } : {}),
      },
    },
  };
}

describe("AiNoName bat launcher bundle routing", () => {
  it.each([
    ["gemini-4-hydrogen-high", "EXTRA_HIGH", "gemini-4-hydrogen-xhigh", "xhigh"],
    ["gemini-4-hydrogen-xhigh", undefined, "gemini-4-hydrogen-xhigh", "xhigh"],
    ["gemini-4-hydrogen-extra-high", undefined, "gemini-4-hydrogen-xhigh", "xhigh"],
    ["gemini-4-hydrogen", "THINKING_LEVEL_XHIGH", "gemini-4-hydrogen-xhigh", "xhigh"],
    ["gemini-4-hydrogen", "MEDIUM", "gemini-4-hydrogen-medium", "medium"],
    ["gemini-4-hydrogen", "HIGH", "gemini-4-hydrogen-high", "high"],
    ["gemini-4-hydrogen-low", "LOW", "gemini-4-hydrogen-low", "low"],
    ["gemini-4-carbon", "XHIGH", "gemini-4-carbon-high", "high"],
    ["gemini-3.8-flash-high", "MINIMAL", "gemini-3.8-flash-low", "low"],
    ["gemini-4-hydrogen-sonar", "MINIMAL", "gemini-4-hydrogen-low", "low"],
  ])("routes %s with %s to %s and sends matching upstream effort", (incoming, level, model, expected) => {
    const route = loadRouting();
    const result = route("/v1internal:streamGenerateContent", ideBody(incoming, level));
    expect(result.incoming).toBe(incoming);
    expect(result.body.model).toBe(`ag/${model}`);
    const upstream = getModelUpstreamId("ag", model, result.body);
    expect(upstream).toBe(`${model}(${expected})`);
    const outgoing = new AntigravityExecutor().transformRequest(model, { ...result.body, model }, true, { projectId: "project", connectionId: "connection" });
    expect(outgoing.model).toBe(model);
    expect(outgoing.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: expected,
      ...(level ? { includeThoughts: false } : {}),
    });
  });

  it("respects a customer's exact custom mapping for Sonar", () => {
    const route = loadRouting({ "gemini-4-hydrogen-sonar": "ag/gemini-4-hydrogen-high" });
    const { body } = route("/v1internal:generateContent", ideBody("gemini-4-hydrogen-sonar", "MINIMAL"));
    expect(body.model).toBe("ag/gemini-4-hydrogen-high");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it("preserves non-Antigravity custom destinations and their original payload", () => {
    const route = loadRouting({ "gemini-4-hydrogen-high": "cc/claude-sonnet-4-6" });
    const { body } = route("/v1internal:generateContent", ideBody("gemini-4-hydrogen-high", "HIGH"));
    expect(body.model).toBe("cc/claude-sonnet-4-6");
    expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("HIGH");
  });
});
