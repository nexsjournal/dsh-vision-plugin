/**
 * dsh-vision-plugin — Host half (persistent bundle plugin).
 *
 * Registers an OpenAI-compatible third-party VISION model provider so a
 * text-only main model can understand images:
 *   - provider `vision` (switchable in the model picker) -> relayed to the
 *     configured OpenAI-compatible endpoint (/chat/completions, non-streamed).
 *   - tool `vision_analyze` : describe an image file / data URL on demand.
 *   - tool `vision_status`  : report plugin/config status.
 *   - tool `vision_test`    : ping the endpoint's /models and check the model.
 *
 * Non-secret config lives in the `dsh-vision` settings namespace (editable from
 * the Settings -> Plugins card, hot-reloaded). The API key is stored through the
 * DSH credentials service under a named ref (one-way), with an env-var fallback.
 *
 * This file is the Cordis plugin module: it exports { name, inject, apply }.
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

const name = "dsh-vision-plugin";
const inject = ["llm", "attachments", "tools"];

const NS = settingsNamespace("dsh-vision");
const DEFAULT_REF = "DSH_VISION_API_KEY";

const Config = z.object({
  enabled: z.boolean().default(true),
  providerId: z.string().default("vision"),
  displayName: z.string().default("Vision 视觉模型 (OpenAI 兼容)"),
  baseURL: z.string().default(""),
  model: z.string().default("qwen3.8-flash"),
  apiKeyRef: z.string().default(DEFAULT_REF),
  contextWindow: z.number().default(131072),
  maxTokens: z.number().default(8192),
});

/**
 * Normalize raw config through the schema.
 *
 * NOTE: @deepseek-ai/schemastery schemas are *callable* validators — the
 * schema function itself is the parser: `schema(value)` returns the
 * normalized value (defaults applied) or throws ValidationError. They do NOT
 * expose zod's `.parse` method, so calling `Config.parse(...)` crashes the
 * whole plugin tree at boot. Fall back to `.parse` / standard-schema
 * `~standard.validate` so the plugin also works against zod-style builds.
 */
function parseConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const parse = (v) => {
    if (typeof Config === "function") return Config(v);
    if (Config && typeof Config.parse === "function") return Config.parse(v);
    const std = Config && Config["~standard"];
    if (std && typeof std.validate === "function") {
      const r = std.validate(v);
      return r && typeof r === "object" && "value" in r ? r.value : r;
    }
    return v;
  };
  try {
    return parse(input);
  } catch (e) {
    // Never take the whole plugin tree down because of a stale/invalid
    // stored config: warn and fall back to pure defaults.
    console.warn("[dsh-vision-plugin] config parse failed, using defaults: " + String((e && e.message) || e));
    return parse({});
  }
}

const DEFAULT_PROMPT =
  "请详细描述这张图片，供一名 AI 编程助手使用：1) 整体内容与场景；2) 逐字转录图中所有可见文字（保留原始语言与格式，包括代码）；3) 若是界面截图，描述布局、控件与状态；4) 若是代码或终端截图，逐行转录代码；5) 若是图表，说明类型与关键数据。直接输出描述，不要寒暄。";

function baseOf(c) {
  return String(c.baseURL || "").replace(/\/+$/, "");
}

function contextWindowOf(c) {
  const n = Number(c.contextWindow);
  return Number.isFinite(n) && n > 0 ? n : 131072;
}

function maxTokensOf(c) {
  const n = Number(c.maxTokens);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

/** One non-streamed JSON HTTP call via the host's native fetch. */
async function httpJson(method, url, headers, body, timeoutMs, signal) {
  const controller = new AbortController();
  const timeout = timeoutMs || 120000;
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeout);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error("HTTP " + res.status + " " + res.statusText + ": " + text.slice(0, 400));
    return JSON.parse(text);
  } catch (err) {
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error("请求超时（" + timeout + "ms）: " + url);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function apply(ctx, rowConfig) {
  const llm = ctx.llm;
  const attachments = ctx.attachments;
  const tools = ctx.tools;
  const fs = ctx.get("fs");
  const credentials = ctx.get("credentials");

  // Live config: seeded from the row config, then driven by the settings scope.
  let current = parseConfig(rowConfig);
  const cfg = () => current;

  // ---- Diagnostics (surfaced by vision_status) ----------------------------
  let settingsInjected = false;
  let settingsRegistered = false;
  let settingsRegisterError = "";
  let settingsService = null;

  /** Resolve the API key: credentials service under the named ref, else env var. */
  async function resolveApiKey() {
    const c = cfg();
    const ref = String(c.apiKeyRef || DEFAULT_REF).trim();
    if (!ref) return "";
    try {
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(credentialRef(ref));
        if (resolved && typeof resolved.value === "string" && resolved.value.trim()) return resolved.value.trim();
      }
    } catch (e) {
      /* fall through to env */
    }
    const envName = ref.replace(/[^A-Za-z0-9_]/g, "_");
    const envVal = process.env[envName];
    return typeof envVal === "string" && envVal.trim() ? envVal.trim() : "";
  }

  function visionHeaders(apiKey) {
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + apiKey };
    if (String(cfg().baseURL).includes("openrouter")) {
      h["HTTP-Referer"] = "http://localhost";
      h["X-Title"] = "DeepSeek Harness Vision";
    }
    return h;
  }

  /** Convert one harness message to an OpenAI-compatible wire message. */
  async function mapMessage(msg, signal) {
    const blocks = msg && Array.isArray(msg.content) ? msg.content : [];
    if (msg.role === "system") {
      const parts = blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text);
      return { role: "system", content: parts.join("\n") };
    }
    if (msg.role === "assistant") {
      const textParts = [];
      const toolCalls = [];
      for (const b of blocks) {
        if (!b) continue;
        if (b.type === "text" && typeof b.text === "string") textParts.push(b.text);
        else if (b.type === "tool-call") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: typeof b.arguments === "string" ? b.arguments : "{}" },
          });
        }
      }
      const out = { role: "assistant" };
      if (toolCalls.length > 0) {
        out.content = textParts.length > 0 ? textParts.join("\n") : null;
        out.tool_calls = toolCalls;
      } else {
        out.content = textParts.join("\n");
      }
      return out;
    }
    for (const b of blocks) {
      if (b && b.type === "tool-result") {
        const inner = Array.isArray(b.content)
          ? b.content.filter((x) => x && x.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n")
          : "";
        return { role: "tool", tool_call_id: b.toolCallId, content: inner };
      }
    }
    const parts = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
        parts.push({ type: "text", text: b.text });
      } else if (b.type === "image" && b.attachment && b.attachment.attachmentId) {
        const stored = await attachments.readImage(b.attachment, signal);
        const b64 = Buffer.from(stored.data).toString("base64");
        parts.push({ type: "image_url", image_url: { url: "data:" + b.attachment.mediaType + ";base64," + b64 } });
      }
    }
    if (parts.length === 0) return { role: "user", content: "" };
    if (parts.length === 1 && parts[0].type === "text") return { role: "user", content: parts[0].text };
    return { role: "user", content: parts };
  }

  async function chatComplete({ apiKey, messages, model, maxTokens, temperature, stop, toolsList, signal, timeoutMs }) {
    const payload = { model, messages, max_tokens: maxTokens, stream: false };
    if (typeof temperature === "number") payload.temperature = temperature;
    if (Array.isArray(stop) && stop.length > 0) payload.stop = stop;
    if (Array.isArray(toolsList) && toolsList.length > 0) {
      payload.tools = toolsList.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: typeof t.description === "string" ? t.description : "",
          parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
        },
      }));
      payload.tool_choice = "auto";
    }
    return await httpJson("POST", baseOf(cfg()) + "/chat/completions", visionHeaders(apiKey), JSON.stringify(payload), timeoutMs, signal);
  }

  /** The OpenAI-compatible vision adapter. Reads live config on every call. */
  class VisionAdapter extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: String(cfg().displayName || "Vision") };
    }
    providerRetryPolicy() {
      return undefined;
    }
    async listModels(provider) {
      const c = cfg();
      if (c.enabled === false) return [];
      return [{ provider, id: c.model, name: c.model, inputModalities: ["text", "image"] }];
    }
    async resolveModel(provider, model) {
      const c = cfg();
      return {
        provider,
        id: model,
        name: model,
        inputModalities: ["text", "image"],
        context: { contextWindow: contextWindowOf(c) },
        defaultMaxTokens: maxTokensOf(c),
      };
    }
    async *stream(options) {
      const c = cfg();
      if (c.enabled === false) throw new Error("dsh-vision-plugin 已在设置中停用");
      const signal = options.signal;
      const apiKey = await resolveApiKey();
      if (!apiKey) {
        throw new Error("未配置视觉模型 API Key：在「设置 → 插件 → dsh-vision」填写，或设置环境变量 " + String(c.apiKeyRef || DEFAULT_REF));
      }
      const mapped = [];
      if (typeof options.system === "string" && options.system.length > 0) mapped.push({ role: "system", content: options.system });
      for (const m of options.messages || []) mapped.push(await mapMessage(m, signal));
      const maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : maxTokensOf(c);
      const parsed = await chatComplete({
        apiKey,
        messages: mapped,
        model: c.model,
        maxTokens,
        temperature: options.temperature,
        stop: options.stop,
        toolsList: options.tools,
        signal,
        timeoutMs: 240000,
      });
      if (parsed.error) throw new Error("视觉模型 API 错误：" + JSON.stringify(parsed.error).slice(0, 500));
      const choice = parsed.choices && parsed.choices[0];
      if (!choice || !choice.message) throw new Error("视觉模型响应缺少 choices[0].message：" + JSON.stringify(parsed).slice(0, 300));
      const message = choice.message;
      let index = 0;
      if (Array.isArray(message.tool_calls)) {
        for (const tc of message.tool_calls) {
          const fn = tc.function || {};
          const argsStr = typeof fn.arguments === "string" && fn.arguments.length > 0 ? fn.arguments : "{}";
          const callId = typeof tc.id === "string" && tc.id.length > 0 ? tc.id : "call_" + index;
          const fnName = typeof fn.name === "string" && fn.name.length > 0 ? fn.name : "unknown";
          yield { type: "block-start", index, blockType: "tool-call" };
          yield { type: "tool-call-delta", index, id: callId, name: fnName, argumentsDelta: argsStr };
          yield { type: "block-end", index, block: { type: "tool-call", id: callId, name: fnName, arguments: argsStr } };
          index += 1;
        }
      }
      const content = typeof message.content === "string" ? message.content : "";
      if (content.length > 0) {
        yield { type: "block-start", index, blockType: "text" };
        yield { type: "text-delta", index, text: content };
        yield { type: "block-end", index, block: { type: "text", text: content } };
        index += 1;
      }
      if (parsed.usage && typeof parsed.usage === "object") {
        yield { type: "usage", usage: { inputTokens: Number(parsed.usage.prompt_tokens) || 0, outputTokens: Number(parsed.usage.completion_tokens) || 0 } };
      }
      const reason =
        Array.isArray(message.tool_calls) && message.tool_calls.length > 0
          ? { kind: "tool-calls" }
          : choice.finish_reason === "length"
            ? { kind: "max-tokens" }
            : { kind: "stop" };
      yield { type: "finish", reason };
    }
  }

  // Register the vision provider (fall back to <id>-dsh if the id is taken).
  const adapter = new VisionAdapter();
  let providerId = String(cfg().providerId || "vision");
  let adapterOk = false;
  let adapterError = "";
  let registration = null;
  try {
    registration = llm.registerAdapter([providerId], adapter);
    ctx.effect(() => registration, name + ": llm adapter " + providerId);
    adapterOk = true;
  } catch (e) {
    providerId = providerId + "-dsh";
    try {
      registration = llm.registerAdapter([providerId], adapter);
      ctx.effect(() => registration, name + ": llm adapter " + providerId);
      adapterOk = true;
    } catch (e2) {
      adapterError = String((e2 && e2.message) || e2);
    }
  }

  // Re-point the adapter's route if the configured provider id changes.
  function syncProviderId() {
    const wanted = String(cfg().providerId || "vision");
    if (!adapterOk || !registration || wanted === providerId) return;
    try {
      registration.replace([wanted]);
      providerId = wanted;
    } catch (e) {
      /* keep the previous route */
    }
  }

  // ---- Tools -------------------------------------------------------------
  const renderJson = (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }];

  tools.register(
    defineTool({
      name: "vision_status",
      description:
        "查看 dsh-vision 视觉插件状态：第三方视觉模型 provider/model 是否注册成功、API Key 是否就绪、当前端点配置。用户询问识图能力、图片识别失败原因或视觉模型配置时，先调用本工具。",
      parameters: {},
      output: { schema: { type: "json" }, render: renderJson },
      async execute() {
        const c = cfg();
        const key = await resolveApiKey().catch(() => "");
        let describeDiag = { available: false };
        if (settingsService) {
          try {
            const resp = await settingsService.describe();
            const list = Array.isArray(resp) ? resp : (resp && resp.value) || [];
            const names = list.map((n) => (n && (n.ns || n.id)) || "?");
            describeDiag = {
              available: true,
              nsCount: list.length,
              nsNames: names,
              visionInDescribe: names.indexOf(NS) >= 0,
            };
          } catch (e) {
            describeDiag = { available: true, error: String((e && e.message) || e) };
          }
        }
        return {
          ok: true,
          enabled: c.enabled !== false,
          providerRegistered: adapterOk,
          providerError: adapterOk ? null : adapterError,
          providerId,
          displayName: c.displayName,
          baseURL: c.baseURL,
          model: c.model,
          apiKeyRef: c.apiKeyRef,
          apiKeyReady: key.length > 0,
          settingsNamespace: NS,
          diag: {
            settingsInjected,
            settingsRegistered,
            settingsRegisterError: settingsRegisterError || null,
            describe: describeDiag,
          },
          hint: adapterOk
            ? "在会话模型选择器中切换到 " + providerId + " 的模型后，直接发送图片即可由第三方视觉模型识别。"
            : "provider 注册失败（见 providerError）；仍可用 vision_analyze 工具分析工作区图片文件。",
        };
      },
    }),
  );

  tools.register(
    defineTool({
      name: "vision_analyze",
      description:
        "用第三方多模态视觉模型识别一张图片并返回详细文字描述（内容概述、逐字 OCR、界面布局、代码逐行转录、图表数据）。image 参数：图片文件路径（绝对路径或相对会话工作区）或 data:image/...;base64 数据 URL。适用场景：当前会话模型不支持识图、但需要理解以文件形式存在的图片（工作区图片、用户上传保存的图片）时。",
      parameters: {
        image: { type: "string", required: true, description: "图片文件路径或 data:image/...;base64 数据 URL" },
        prompt: { type: "string", description: "可选的额外识别要求，例如“重点逐行转录代码”" },
      },
      output: { schema: { type: "json" }, render: renderJson },
      async execute(args) {
        const image = args && typeof args.image === "string" ? args.image.trim() : "";
        if (!image) return { ok: false, error: "image 参数为空" };
        try {
          const c = cfg();
          let dataUrl;
          if (image.indexOf("data:image/") === 0) {
            dataUrl = image;
          } else {
            if (fs === undefined) return { ok: false, error: "fs 服务不可用，无法读取文件（可改用 data: URL）" };
            const target = await fs.resolve(image, {});
            const info = await fs.stat(target);
            if (!info) return { ok: false, error: "找不到文件：" + image };
            const size = typeof info.size === "number" ? info.size : 0;
            if (size > 20 * 1024 * 1024) return { ok: false, error: "文件超过 20MB（" + size + " 字节）" };
            const bytes = await fs.readBytes(target, undefined, 20 * 1024 * 1024);
            const lower = image.toLowerCase();
            let mediaType = "image/png";
            if (lower.slice(-4) === ".jpg" || lower.slice(-5) === ".jpeg") mediaType = "image/jpeg";
            else if (lower.slice(-5) === ".webp") mediaType = "image/webp";
            else if (lower.slice(-4) === ".gif") mediaType = "image/gif";
            dataUrl = "data:" + mediaType + ";base64," + Buffer.from(bytes).toString("base64");
          }
          const apiKey = await resolveApiKey();
          if (!apiKey) return { ok: false, error: "未配置 API Key（凭据 " + String(c.apiKeyRef || DEFAULT_REF) + " 或同名环境变量）" };
          const extra = args && typeof args.prompt === "string" ? args.prompt.trim() : "";
          const prompt = extra.length > 0 ? DEFAULT_PROMPT + " 额外要求：" + extra : DEFAULT_PROMPT;
          const parsed = await chatComplete({
            apiKey,
            messages: [
              {
                role: "user",
                content: [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: prompt }],
              },
            ],
            model: c.model,
            maxTokens: maxTokensOf(c),
            timeoutMs: 180000,
          });
          if (parsed.error) return { ok: false, error: "视觉模型 API 错误：" + JSON.stringify(parsed.error).slice(0, 400) };
          const choice = parsed.choices && parsed.choices[0];
          const text = choice && choice.message ? choice.message.content : undefined;
          if (typeof text !== "string" || text.length === 0) return { ok: false, error: "视觉模型未返回内容：" + JSON.stringify(parsed).slice(0, 300) };
          return { ok: true, model: c.model, description: text };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
    }),
  );

  tools.register(
    defineTool({
      name: "vision_test",
      description: "测试 dsh-vision 视觉端点连接：调用 <baseURL>/models 校验 API Key 与可达性，并检查当前模型是否在端点模型列表中。用户更换 API/模型后用它验证。",
      parameters: {},
      output: { schema: { type: "json" }, render: renderJson },
      async execute() {
        const c = cfg();
        const apiKey = await resolveApiKey();
        if (!apiKey) return { ok: false, error: "API Key 未配置（凭据 " + String(c.apiKeyRef || DEFAULT_REF) + " 或同名环境变量）" };
        try {
          const parsed = await httpJson("GET", baseOf(c) + "/models", { Authorization: "Bearer " + apiKey }, undefined, 30000, undefined);
          const ids = Array.isArray(parsed.data) ? parsed.data.map((m) => m && m.id).filter(Boolean).slice(0, 40) : [];
          return {
            ok: true,
            message: "连接成功（认证通过）" + (ids.length > 0 ? "，端点提供 " + ids.length + " 个模型" : ""),
            modelInList: ids.indexOf(c.model) >= 0,
            model: c.model,
            baseURL: c.baseURL,
            models: ids,
          };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
    }),
  );

  // Settings scope: persist + hot-reload the config (Settings -> Plugins card).
  ctx.inject(["settings"], (settingsCtx) => {
    settingsInjected = true;
    settingsService = settingsCtx.settings;
    try {
      const scope = settingsCtx.settings.register(NS, Config, { base: rowConfig });
      settingsRegistered = true;
      current = scope.get();
      syncProviderId();
      scope.watch(() => {
        current = scope.get();
        syncProviderId();
      });
    } catch (e) {
      settingsRegisterError = String((e && e.message) || e);
    }
  });
}

export { name, inject, apply };
