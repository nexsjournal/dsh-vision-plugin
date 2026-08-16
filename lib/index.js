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
 *   - tool `vision_configure`: save endpoint/model/key from chat (hot, no restart).
 *
 * This is a HOST-ONLY bundle: it ships no client half and no settings card.
 * Endpoint configuration happens via `vision_configure` or env vars; the
 * plugin still appears in Settings -> Plugins -> 插件列表 (plugin inventory).
 *
 * The plugin is BYO (bring your own endpoint). The three user-facing values are
 * stored through the DSH CREDENTIALS service — each under a named ref — so the
 * vision_configure tool can set them live (hot, no restart):
 *   - DSH_VISION_BASE_URL : the OpenAI-compatible endpoint (e.g. https://host/v1)
 *   - DSH_VISION_MODEL    : the multimodal model id
 *   - DSH_VISION_API_KEY  : the API key
 * Each falls back to a same-named env var, then to the row `config` in
 * cordis.yml. Advanced, rarely-changed values (providerId / displayName /
 * contextWindow / maxTokens / enabled) come from the row `config` + defaults.
 *
 * This file is the Cordis plugin module: it exports { name, inject, apply }.
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "dsh-vision-plugin";
const inject = ["llm", "attachments", "tools"];

// Named credential refs (managed via the vision_configure tool / env vars).
const REF_BASE = "DSH_VISION_BASE_URL";
const REF_MODEL = "DSH_VISION_MODEL";
const REF_KEY = "DSH_VISION_API_KEY";

const DEFAULT_PROMPT =
  "请详细描述这张图片，供一名 AI 编程助手使用：1) 整体内容与场景；2) 逐字转录图中所有可见文字（保留原始语言与格式，包括代码）；3) 若是界面截图，描述布局、控件与状态；4) 若是代码或终端截图，逐行转录代码；5) 若是图表，说明类型与关键数据。直接输出描述，不要寒暄。";

function baseOf(baseURL) {
  return String(baseURL || "").replace(/\/+$/, "");
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

  const rc = rowConfig && typeof rowConfig === "object" ? rowConfig : {};

  /** Static (row-config + defaults) values — rarely changed, read at boot. */
  function staticCfg() {
    const num = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
      enabled: rc.enabled !== false,
      providerId: String(rc.providerId || "vision"),
      displayName: String(rc.displayName || "Vision 视觉模型 (OpenAI 兼容)"),
      contextWindow: num(rc.contextWindow, 131072),
      maxTokens: num(rc.maxTokens, 8192),
      baseURLFallback: String(rc.baseURL || ""),
      modelFallback: String(rc.model || ""),
    };
  }

  /**
   * Resolve one credential ref, reporting which layer supplied it.
   * Order: credentials service -> same-named env var -> row-config fallback.
   * Resolved per call so vision_configure / env-var edits apply live.
   * @returns {{ value: string, source: "credentials"|"env"|"row-config"|"none" }}
   */
  async function resolveRef(ref, rowFallback) {
    try {
      if (credentials !== undefined) {
        const r = await credentials.resolve(credentialRef(ref));
        if (r && typeof r.value === "string" && r.value.trim()) return { value: r.value.trim(), source: "credentials" };
      }
    } catch (e) {
      /* fall through to env */
    }
    const envName = ref.replace(/[^A-Za-z0-9_]/g, "_");
    const envVal = process.env[envName];
    if (typeof envVal === "string" && envVal.trim()) return { value: envVal.trim(), source: "env" };
    if (rowFallback) return { value: rowFallback, source: "row-config" };
    return { value: "", source: "none" };
  }

  /** The live endpoint (baseURL + model) with sources — resolved per call. */
  async function endpoint() {
    const s = staticCfg();
    const [b, m] = await Promise.all([
      resolveRef(REF_BASE, s.baseURLFallback),
      resolveRef(REF_MODEL, s.modelFallback),
    ]);
    return { baseURL: b.value, model: m.value, sources: { baseURL: b.source, model: m.source } };
  }

  /** Resolve the API key value: credentials under REF_KEY, else env var. */
  async function resolveApiKey() {
    const r = await resolveRef(REF_KEY, "");
    return r.value;
  }

  function visionHeaders(apiKey, baseURL) {
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + apiKey };
    if (String(baseURL).includes("openrouter")) {
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

  async function chatComplete({ apiKey, messages, model, baseURL, maxTokens, temperature, stop, toolsList, signal, timeoutMs }) {
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
    return await httpJson("POST", baseOf(baseURL) + "/chat/completions", visionHeaders(apiKey, baseURL), JSON.stringify(payload), timeoutMs, signal);
  }

  /** The OpenAI-compatible vision adapter. Reads live config (credentials) on every call. */
  class VisionAdapter extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: staticCfg().displayName };
    }
    providerRetryPolicy() {
      return undefined;
    }
    async listModels(provider) {
      const s = staticCfg();
      if (!s.enabled) return [];
      const { model } = await endpoint();
      if (!model) return [];
      return [{ provider, id: model, name: model, inputModalities: ["text", "image"] }];
    }
    async resolveModel(provider, model) {
      const s = staticCfg();
      return {
        provider,
        id: model,
        name: model,
        inputModalities: ["text", "image"],
        context: { contextWindow: s.contextWindow },
        defaultMaxTokens: s.maxTokens,
      };
    }
    async *stream(options) {
      const s = staticCfg();
      if (!s.enabled) throw new Error("dsh-vision-plugin 已在配置中停用");
      const { baseURL, model } = await endpoint();
      if (!baseURL) throw new Error("未配置视觉模型 Base URL：用 vision_configure 工具配置，或设置环境变量 " + REF_BASE);
      if (!model) throw new Error("未配置视觉模型 model：用 vision_configure 工具配置，或设置环境变量 " + REF_MODEL);
      const signal = options.signal;
      const apiKey = await resolveApiKey();
      if (!apiKey) throw new Error("未配置视觉模型 API Key：用 vision_configure 工具配置，或设置环境变量 " + REF_KEY);
      const mapped = [];
      if (typeof options.system === "string" && options.system.length > 0) mapped.push({ role: "system", content: options.system });
      for (const m of options.messages || []) mapped.push(await mapMessage(m, signal));
      const maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : s.maxTokens;
      const parsed = await chatComplete({
        apiKey,
        messages: mapped,
        model,
        baseURL,
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
  let providerId = staticCfg().providerId;
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

  // ---- Tools -------------------------------------------------------------
  const renderJson = (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }];

  tools.register(
    defineTool({
      name: "vision_status",
      description:
        "查看 dsh-vision 视觉插件状态：provider/model 是否注册成功、Base URL / 模型 / API Key 是否就绪，以及每项配置来自哪一层（凭据/环境变量/行配置/未配）。用户询问识图能力、图片识别失败原因或视觉模型配置时，先调用本工具。",
      parameters: {},
      output: { schema: { type: "json" }, render: renderJson },
      async execute() {
        const s = staticCfg();
        const ep = await endpoint().catch(() => ({ baseURL: "", model: "", sources: { baseURL: "none", model: "none" } }));
        const keyInfo = await resolveRef(REF_KEY, "").catch(() => ({ value: "", source: "none" }));
        const ready = ep.baseURL && ep.model && keyInfo.value;
        const missing = [!ep.baseURL && "Base URL", !ep.model && "模型", !keyInfo.value && "API Key"].filter(Boolean);
        return {
          ok: true,
          enabled: s.enabled,
          providerRegistered: adapterOk,
          providerError: adapterOk ? null : adapterError,
          providerId,
          displayName: s.displayName,
          baseURL: ep.baseURL,
          model: ep.model,
          ready: !!ready,
          source: { baseURL: ep.sources.baseURL, model: ep.sources.model, apiKey: keyInfo.source },
          refs: { baseURL: REF_BASE, model: REF_MODEL, apiKey: REF_KEY },
          apiKeyReady: keyInfo.value.length > 0,
          configured: { baseURL: ep.baseURL.length > 0, model: ep.model.length > 0, apiKey: keyInfo.value.length > 0 },
          hint: adapterOk
            ? ready
              ? "已就绪。方式 A：在模型选择器切到 " + providerId + " 后直接发图；方式 B：不切模型，让助手用 vision_analyze 识别图片文件。"
              : "还缺 " + missing.join(" / ") + "。可用 vision_configure 工具在对话里配置，或设环境变量 " + REF_BASE + " / " + REF_MODEL + " / " + REF_KEY + "（服务环境里），再重启/重跑 vision_test。"
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
          const s = staticCfg();
          const ep = await endpoint();
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
          if (!apiKey) return { ok: false, error: "未配置 API Key（凭据 " + REF_KEY + " 或同名环境变量）" };
          if (!ep.baseURL || !ep.model) return { ok: false, error: "未配置 Base URL / model（凭据 " + REF_BASE + " / " + REF_MODEL + "，或同名环境变量；也可用 vision_configure 工具配置）" };
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
            model: ep.model,
            baseURL: ep.baseURL,
            maxTokens: s.maxTokens,
            timeoutMs: 180000,
          });
          if (parsed.error) return { ok: false, error: "视觉模型 API 错误：" + JSON.stringify(parsed.error).slice(0, 400) };
          const choice = parsed.choices && parsed.choices[0];
          const text = choice && choice.message ? choice.message.content : undefined;
          if (typeof text !== "string" || text.length === 0) return { ok: false, error: "视觉模型未返回内容：" + JSON.stringify(parsed).slice(0, 300) };
          return { ok: true, model: ep.model, description: text };
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
        const ep = await endpoint();
        const apiKey = await resolveApiKey();
        if (!apiKey) return { ok: false, error: "API Key 未配置（凭据 " + REF_KEY + " 或同名环境变量）" };
        if (!ep.baseURL) return { ok: false, error: "Base URL 未配置（凭据 " + REF_BASE + " 或同名环境变量）" };
        try {
          const parsed = await httpJson("GET", baseOf(ep.baseURL) + "/models", { Authorization: "Bearer " + apiKey }, undefined, 30000, undefined);
          const ids = Array.isArray(parsed.data) ? parsed.data.map((m) => m && m.id).filter(Boolean).slice(0, 40) : [];
          return {
            ok: true,
            message: "连接成功（认证通过）" + (ids.length > 0 ? "，端点提供 " + ids.length + " 个模型" : ""),
            modelInList: ep.model ? ids.indexOf(ep.model) >= 0 : false,
            model: ep.model,
            baseURL: ep.baseURL,
            models: ids,
          };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
    }),
  );

  tools.register(
    defineTool({
      name: "vision_configure",
      description:
        "配置 dsh-vision 视觉端点（保存即热生效，无需重启）。baseURL / model / apiKey 均可选，传哪一项就更新哪一项（不传或留空=不改）。三项存入 DSH 凭据服务。注意：apiKey 会出现在本次对话并写入凭据库，个人/本地 DSH 可用；共享部署建议改用环境变量 DSH_VISION_API_KEY。配置后建议跑 vision_test 验证连接。",
      parameters: {
        baseURL: { type: "string", description: "OpenAI 兼容端点（以 /v1 结尾），可选" },
        model: { type: "string", description: "能处理图片的模型 id，可选" },
        apiKey: { type: "string", description: "端点密钥，可选（会写入凭据库）" },
      },
      output: { schema: { type: "json" }, render: renderJson },
      async execute(args) {
        const a = args && typeof args === "object" ? args : {};
        if (credentials === undefined) return { ok: false, error: "credentials 服务不可用，无法保存（可改用环境变量）" };
        const updates = [];
        try {
          if (typeof a.baseURL === "string" && a.baseURL.trim()) {
            await credentials.set(credentialRef(REF_BASE), a.baseURL.trim());
            updates.push("baseURL");
          }
          if (typeof a.model === "string" && a.model.trim()) {
            await credentials.set(credentialRef(REF_MODEL), a.model.trim());
            updates.push("model");
          }
          if (typeof a.apiKey === "string" && a.apiKey.trim()) {
            await credentials.set(credentialRef(REF_KEY), a.apiKey.trim());
            updates.push("apiKey");
          }
          if (updates.length === 0) return { ok: false, error: "未提供要更新的项（baseURL / model / apiKey 至少给一项非空值）" };
          const ep = await endpoint();
          const keyInfo = await resolveRef(REF_KEY, "");
          const ready = ep.baseURL && ep.model && keyInfo.value;
          const missing = [!ep.baseURL && "baseURL", !ep.model && "model", !keyInfo.value && "apiKey"].filter(Boolean);
          return {
            ok: true,
            updated: updates,
            configured: { baseURL: ep.baseURL.length > 0, model: ep.model.length > 0, apiKey: keyInfo.value.length > 0 },
            ready: !!ready,
            next: ready
              ? "已就绪。跑 vision_test 验证；或在模型选择器切到 " + providerId + " 直接发图；或让助手用 vision_analyze 识别图片文件。"
              : "还缺 " + missing.join(" / ") + "。",
          };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
    }),
  );
}

export { name, inject, apply };
