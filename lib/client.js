/**
 * dsh-vision-plugin — Client half (persistent bundle plugin).
 *
 * Registers a card in Settings -> Plugins -> 插件配置, styled to match the
 * built-in cards (Terminal / Agent 循环 / 网页搜索): a bordered <li> whose
 * header stacks a bold name over a muted description with a rotating chevron,
 * disclosing a credentials form (Base URL / model / API key) + save.
 *
 * The three values are stored through the DSH CREDENTIALS service (one-way,
 * not read back), so saving them applies live (hot, no restart). Each also
 * falls back to a same-named env var / the row config in cordis.yml.
 *
 * This file is the Cordis client plugin module in the DSH client loader format:
 * window.__ModuleLoader__.load({ id, factory(require) }).
 */
window.__ModuleLoader__.load({
  id: "dsh-vision-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const e = react.createElement;
    const cx = (...parts) => parts.filter(Boolean).join(" ");

    const REF_BASE = "DSH_VISION_BASE_URL";
    const REF_MODEL = "DSH_VISION_MODEL";
    const REF_KEY = "DSH_VISION_API_KEY";
    const LOCALE_NAMESPACE = "settings.dshVisionPlugin";

    const zh = {
      title: "视觉识别 (dsh-vision)",
      description: "配置第三方 OpenAI 兼容视觉模型：Base URL / 模型 / API Key，保存即热生效。",
      baseURL: "Base URL",
      baseURLPlaceholder: "https://你的域名/v1（留空表示不修改）",
      model: "视觉模型",
      modelPlaceholder: "多模态模型 id（留空表示不修改）",
      apiKey: "API Key",
      apiKeyPlaceholder: "留空表示不修改",
      configured: "已配置",
      missing: "未配置",
      loading: "读取中…",
      ready: "已就绪",
      pending: "待配置",
      save: "保存",
      saving: "保存中…",
      testHint: "保存后在对话里让助手执行 vision_test 工具验证连接。",
      note: "三项均经 DSH 凭据服务按名保存（DSH_VISION_BASE_URL / DSH_VISION_MODEL / DSH_VISION_API_KEY），界面不读回明文；也可用同名环境变量。本插件不内置任何端点或密钥。",
      expand: "展开",
      collapse: "收起",
    };
    const en = {
      title: "Vision (dsh-vision)",
      description: "Configure a third-party OpenAI-compatible vision model: Base URL / model / API key. Saves apply live.",
      baseURL: "Base URL",
      baseURLPlaceholder: "https://your-host/v1 (blank = keep)",
      model: "Vision model",
      modelPlaceholder: "multimodal model id (blank = keep)",
      apiKey: "API key",
      apiKeyPlaceholder: "blank = keep",
      configured: "configured",
      missing: "missing",
      loading: "loading…",
      ready: "ready",
      pending: "incomplete",
      save: "Save",
      saving: "Saving…",
      testHint: "After saving, ask the assistant to run the vision_test tool to verify the connection.",
      note: "The three values are stored one-way via the DSH credentials service (DSH_VISION_BASE_URL / DSH_VISION_MODEL / DSH_VISION_API_KEY); they are not read back. A same-named env var also works. This plugin ships no endpoint or key.",
      expand: "Expand",
      collapse: "Collapse",
    };

    // Replicates the built-in PluginCard chrome using the DSH theme variables,
    // plus form field styles matching the built-in ValueField inputs.
    const CSS = [
      ".dsvp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
      ".dsvp-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
      ".dsvp-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
      ".dsvp-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
      ".dsvp-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
      ".dsvp-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".dsvp-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
      ".dsvp-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
      ".dsvp-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;display:inline-flex}",
      ".dsvp-chevronOpen{transform:rotate(180deg)}",
      ".dsvp-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 8px}",
      ".dsvp-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".dsvp-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;margin-top:12px;display:flex}",
      ".dsvp-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
      ".dsvp-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
      ".dsvp-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".dsvp-save:disabled{opacity:.4;cursor:default}",
      ".dsvp-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
      // form fields (mirror the built-in ValueField input styling)
      ".dsvp-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
      ".dsvp-field+.dsvp-field{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".dsvp-field label{display:flex;flex-direction:column;gap:6px;flex:1;min-width:180px}",
      ".dsvp-head{align-items:center;gap:8px;display:flex}",
      ".dsvp-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
      ".dsvp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".dsvp-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
      ".dsvp-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}",
      ".dsvp-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
      ".dsvp-note{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
      ".dsvp-test{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:12px;line-height:1.5}",
    ].join("\n");

    // 14px down-chevron (mirrors IconChevronDownOutline14) — inline, no dependency.
    function Chevron(props) {
      return e("svg", {
        className: props.className, width: 14, height: 14, viewBox: "0 0 14 14",
        fill: "none", "aria-hidden": true, focusable: false,
      }, e("path", {
        d: "M3.4 5.4 7 9l3.6-3.6", stroke: "currentColor", strokeWidth: 1.4,
        strokeLinecap: "round", strokeLinejoin: "round",
      }));
    }

    function VisionCard(props) {
      const { api, t } = props;
      const [open, setOpen] = react.useState(true);
      // null = loading, true = configured, false = missing
      const [status, setStatus] = react.useState({ base: null, model: null, key: null });
      const [base, setBase] = react.useState("");
      const [model, setModel] = react.useState("");
      const [key, setKey] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      const [error, setError] = react.useState("");

      function loadStatus() {
        if (!api || !api.credentials || typeof api.credentials.describe !== "function") return;
        api.credentials
          .describe({ refs: [REF_BASE, REF_MODEL, REF_KEY] })
          .then((response) => {
            const creds = response && response.result && response.result.ok ? response.result.value && response.result.value.credentials : null;
            const get = (ref) => (creds && creds[ref] !== undefined ? !!creds[ref].configured : null);
            setStatus({ base: get(REF_BASE), model: get(REF_MODEL), key: get(REF_KEY) });
          })
          .catch(() => setStatus({ base: null, model: null, key: null }));
      }
      react.useEffect(() => { loadStatus(); }, [api]);
      react.useEffect(() => { if (open) loadStatus(); }, [open]);

      async function save() {
        if (saving) return;
        const ops = [];
        if (base.trim()) ops.push({ ref: REF_BASE, value: base.trim() });
        if (model.trim()) ops.push({ ref: REF_MODEL, value: model.trim() });
        if (key.trim()) ops.push({ ref: REF_KEY, value: key.trim() });
        if (ops.length === 0) return;
        setSaving(true);
        setError("");
        try {
          for (const op of ops) {
            const r = await api.credentials.set({ ref: op.ref, value: op.value });
            if (!r || !r.result || !r.result.ok) {
              throw new Error((r && r.result && (r.result.error || r.result.code)) || "save failed");
            }
          }
          setBase("");
          setModel("");
          setKey("");
          loadStatus();
        } catch (err) {
          setError(String((err && err.message) || err));
        } finally {
          setSaving(false);
        }
      }

      const badge = (v) =>
        v === null
          ? e("span", { className: "dsvp-badgeMuted" }, t("loading"))
          : e("span", { className: v ? "dsvp-badge" : "dsvp-badgeMuted" }, v ? t("configured") : t("missing"));

      const ready = status.base === true && status.model === true && status.key === true;
      const statusText = ready ? t("ready") : t("pending");
      const dirty = base.trim() !== "" || model.trim() !== "" || key.trim() !== "";
      const field = (labelKey, placeholderKey, statusValue, draftValue, setState, type) =>
        e("label", {},
          e("span", { className: "dsvp-head" },
            e("span", { className: "dsvp-label" }, t(labelKey)),
            badge(statusValue),
          ),
          e("input", { className: "dsvp-input", type: type || "text", value: draftValue, placeholder: t(placeholderKey), onChange: (ev) => setState(ev.target.value) }),
        );

      return e("li", { className: cx("dsvp-card", open && "dsvp-cardOpen") },
        e("button", {
          type: "button", className: "dsvp-header", "aria-expanded": open,
          "aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
          onClick: () => setOpen(!open),
        },
          e("span", { className: "dsvp-headText" },
            e("span", { className: "dsvp-name" }, t("title")),
            e("span", { className: "dsvp-description" }, t("description")),
          ),
          e("span", { className: "dsvp-pending" }, statusText),
          e(Chevron, { className: cx("dsvp-chevron", open && "dsvp-chevronOpen") }),
        ),
        open
          ? e("div", { className: "dsvp-body" },
            e("div", { className: "dsvp-field" }, field("baseURL", "baseURLPlaceholder", status.base, base, setBase, "text")),
            e("div", { className: "dsvp-field" }, field("model", "modelPlaceholder", status.model, model, setModel, "text")),
            e("div", { className: "dsvp-field" }, field("apiKey", "apiKeyPlaceholder", status.key, key, setKey, "password")),
            e("p", { className: "dsvp-note" }, t("note")),
            e("p", { className: "dsvp-test" }, t("testHint")),
            e("div", { className: "dsvp-footer" },
              error ? e("p", { className: "dsvp-failed", role: "status" }, error) : null,
              e("button", { type: "button", className: "dsvp-save", disabled: !dirty || saving, onClick: save }, t(saving ? "saving" : "save")),
            ),
          )
          : null,
      );
    }

    function Card(props) {
      const { api, t } = props;
      const missing = [api === undefined ? "api" : "", t === undefined ? "t" : ""].filter(Boolean);
      if (missing.length > 0) {
        const head = e("span", { className: "dsvp-headText" },
          e("span", { className: "dsvp-name" }, "视觉识别 (dsh-vision) — 诊断"),
          e("span", { className: "dsvp-description" }, "slot 注入 props 缺失: " + missing.join(", ")),
        );
        const btn = e("button", { type: "button", className: "dsvp-header" }, head);
        return e("li", { className: "dsvp-card" }, btn);
      }
      return e(VisionCard, { api, t });
    }

    const inject = ["slots", "locale", "connection"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "dsh-vision-plugin: settings dictionaries");
      ctx.effect(() => {
        if (typeof document === "undefined") return () => {};
        if (document.querySelector('style[data-plugin-css="dsh-vision-plugin/settings"]') !== null) return () => {};
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-vision-plugin";
        tag.dataset.pluginCss = "dsh-vision-plugin/settings";
        tag.textContent = CSS;
        document.head.append(tag);
        return () => tag.remove();
      }, "dsh-vision-plugin: settings styles");
      const connection = ctx.get("connection");
      const api = connection && connection.api;
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          { name: "settings.plugin.item", id: "dsh-vision-plugin", order: 30, locale: LOCALE_NAMESPACE, inject: () => ({ api }) },
          Card,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
