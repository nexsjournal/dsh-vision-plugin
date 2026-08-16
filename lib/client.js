/**
 * dsh-vision-plugin — Client half (persistent bundle plugin).
 *
 * Registers a card in Settings -> Plugins -> 插件配置 for configuring the
 * vision backend: baseURL / model / provider id / key (via the one-way
 * credentials service) / context & token limits. Changes hot-reload on the host.
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

    const NS = "dsh-vision";
    const LOCALE_NAMESPACE = "settings.dshVisionPlugin";
    const DEFAULT_REF = "DSH_VISION_API_KEY";

    const zh = {
      title: "视觉识别 (dsh-vision)",
      hint: "配置第三方 OpenAI 兼容视觉模型。当前模型本身支持图片时原图直通；否则由该模型观察图片后交给主模型回答。",
      enabled: "启用",
      providerId: "Provider ID",
      displayName: "显示名称",
      baseURL: "Base URL（OpenAI 兼容）",
      model: "视觉模型",
      apiKeyRef: "Key 凭据名",
      contextWindow: "Context Window",
      maxTokens: "Max Tokens",
      apiKey: "API Key",
      keyConfigured: "已配置",
      keyMissing: "未配置",
      keyLoading: "加载中…",
      keyReadOnly: "只读",
      keyPlaceholder: "填写以保存（留空不改）",
      save: "保存",
      discard: "放弃修改",
      saved: "已保存",
      saveFailed: "保存失败",
      keySaveFailed: "API Key 保存失败",
      conflict: "设置已在别处更改，请放弃当前修改后重试。",
      writableOnly: "当前设置不可写。",
      notWritable: "只读",
      testHint: "测试连接：在对话中让助手执行 vision_test 工具。",
      status: "状态",
    };
    const en = {
      title: "Vision (dsh-vision)",
      hint: "Configure a third-party OpenAI-compatible vision model.",
      enabled: "Enabled",
      providerId: "Provider ID",
      displayName: "Display name",
      baseURL: "Base URL (OpenAI-compatible)",
      model: "Vision model",
      apiKeyRef: "Key credential ref",
      contextWindow: "Context window",
      maxTokens: "Max tokens",
      apiKey: "API key",
      keyConfigured: "configured",
      keyMissing: "missing",
      keyLoading: "loading…",
      keyReadOnly: "read-only",
      keyPlaceholder: "enter to save (blank = keep)",
      save: "Save",
      discard: "Discard",
      saved: "saved",
      saveFailed: "save failed",
      keySaveFailed: "API key save failed",
      conflict: "Settings changed elsewhere. Discard and retry.",
      writableOnly: "Settings are not writable.",
      notWritable: "read-only",
      testHint: "To test: ask the assistant to run the vision_test tool.",
      status: "Status",
    };

    const CSS = [
      ".dsvp-card{display:flex;flex-direction:column;gap:10px;font-size:13px}",
      ".dsvp-card .dsvp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}",
      ".dsvp-card label{display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px}",
      ".dsvp-card label.check{flex-direction:row;align-items:center;gap:6px;min-width:auto}",
      ".dsvp-card input{font:inherit;padding:5px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;width:100%;box-sizing:border-box}",
      ".dsvp-card button{font:inherit;padding:5px 14px;border-radius:6px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer}",
      ".dsvp-card button:disabled{opacity:.5;cursor:default}",
      ".dsvp-card .dsvp-note{padding:6px 9px;border-radius:6px;background:rgba(128,128,128,.1);line-height:1.55;white-space:pre-wrap;word-break:break-all;font-size:12px}",
      ".dsvp-card .dsvp-ok{color:#4caf50}",
      ".dsvp-card .dsvp-err{color:#f44336}",
    ].join("\n");

    function nonEmptyString(v) {
      return typeof v === "string" && v.trim() !== "" ? v : undefined;
    }

    function draftOf(settings) {
      const s = settings && typeof settings === "object" ? settings : {};
      return {
        enabled: s.enabled !== false,
        providerId: nonEmptyString(s.providerId) ?? "vision",
        displayName: nonEmptyString(s.displayName) ?? "Vision 视觉模型 (OpenAI 兼容)",
        baseURL: nonEmptyString(s.baseURL) ?? "",
        model: nonEmptyString(s.model) ?? "qwen3.8-flash",
        apiKeyRef: nonEmptyString(s.apiKeyRef) ?? DEFAULT_REF,
        contextWindow: Number.isFinite(Number(s.contextWindow)) && Number(s.contextWindow) > 0 ? Number(s.contextWindow) : 131072,
        maxTokens: Number.isFinite(Number(s.maxTokens)) && Number(s.maxTokens) > 0 ? Number(s.maxTokens) : 8192,
      };
    }

    function settingsOps(before, after) {
      const ops = [];
      const keys = ["enabled", "providerId", "displayName", "baseURL", "model", "apiKeyRef", "contextWindow", "maxTokens"];
      for (const key of keys) {
        if (before[key] !== after[key]) ops.push({ op: "set", path: [key], value: after[key] });
      }
      return ops;
    }

    function sameDraft(a, b) {
      const keys = ["enabled", "providerId", "displayName", "baseURL", "model", "apiKeyRef", "contextWindow", "maxTokens"];
      return keys.every((k) => a[k] === b[k]);
    }

    function Loaded({ scope, api, t }) {
      const snapshot = react.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
        () => scope.getSnapshot(),
      );
      const initial = draftOf(snapshot.value);
      const [open, setOpen] = react.useState(false);
      const [baseline, setBaseline] = react.useState(initial);
      const [draft, setDraft] = react.useState(initial);
      const [revision, setRevision] = react.useState(snapshot.revision);
      const [credential, setCredential] = react.useState({ kind: "idle" });
      const [keyDraft, setKeyDraft] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      const [failure, setFailure] = react.useState(undefined);
      const [saved, setSaved] = react.useState(false);
      const [externalChange, setExternalChange] = react.useState(false);

      const settingsDirty = !sameDraft(baseline, draft);
      const keyDirty = keyDraft.trim() !== "";
      const dirty = settingsDirty || keyDirty;
      const writable = snapshot.status === "ready" && snapshot.writable;

      // Track external changes to the settings.
      react.useEffect(() => {
        if (snapshot.status !== "ready" || snapshot.revision === revision) return;
        if (settingsDirty) {
          setExternalChange(true);
          return;
        }
        const next = draftOf(snapshot.value);
        setBaseline(next);
        setDraft(next);
        setRevision(snapshot.revision);
        setFailure(undefined);
        setExternalChange(false);
      }, [revision, settingsDirty, snapshot.revision, snapshot.status, snapshot.value]);

      // Load credential facts for the current apiKeyRef.
      react.useEffect(() => {
        const ref = draft.apiKeyRef;
        if (!open || !ref) {
          setCredential({ kind: "idle" });
          return;
        }
        let active = true;
        setCredential({ kind: "loading" });
        api.credentials
          .describe({ refs: [ref] })
          .then((response) => {
            if (!active) return;
            setCredential(response.result.ok ? { kind: "ready", credentials: response.result.value.credentials } : { kind: "error" });
          }, () => {
            if (active) setCredential({ kind: "error" });
          });
        return () => {
          active = false;
        };
      }, [api.credentials, draft.apiKeyRef, open]);

      function bind(key, transform) {
        return (e) => {
          const value = transform ? transform(e.target.value) : e.target.value;
          setDraft((d) => ({ ...d, [key]: value }));
        };
      }

      const credentialFacts = () => {
        if (credential.kind !== "ready") return { configured: false, writable: true, primaryRef: draft.apiKeyRef };
        const info = credential.credentials[draft.apiKeyRef];
        return { configured: !!(info && info.configured), writable: !info || info.writable !== false, primaryRef: draft.apiKeyRef };
      };
      const facts = credentialFacts();
      const credentialPending = draft.apiKeyRef && (credential.kind === "idle" || credential.kind === "loading");
      const keyRequired = false; // key is optional; env fallback exists

      function discard() {
        const next = draftOf(snapshot.status === "ready" ? snapshot.value : undefined);
        setBaseline(next);
        setDraft(next);
        setRevision(snapshot.revision);
        setKeyDraft("");
        setFailure(undefined);
        setSaved(false);
        setExternalChange(false);
      }

      async function save() {
        if (!dirty || saving || !writable || externalChange) return;
        setSaving(true);
        setFailure(undefined);
        setSaved(false);
        try {
          if (keyDirty && facts.primaryRef) {
            const r = await api.credentials.set({ ref: facts.primaryRef, value: keyDraft.trim() });
            if (!r.result.ok) {
              setFailure(t("keySaveFailed"));
              return;
            }
            setCredential({ kind: "ready", credentials: { [facts.primaryRef]: { configured: true, writable: true, source: "file" } } });
            setKeyDraft("");
          }
          const ops = settingsOps(baseline, draft);
          if (ops.length > 0) {
            const response = await api.settings.mutate({
              ns: NS,
              ops: ops.map((op) => ({ ...op, path: [...op.path] })),
              ...(revision === undefined ? {} : { expectedRevision: revision }),
            });
            if (!response.result.ok) {
              if (response.result.error && response.result.error.code === "settings-conflict") {
                setExternalChange(true);
                setFailure(t("conflict"));
              } else {
                setFailure(t("saveFailed"));
              }
              return;
            }
            const next = draftOf(response.result.value.value);
            setBaseline(next);
            setDraft(next);
            setRevision(response.result.value.revision);
            setExternalChange(false);
          }
          setSaved(true);
        } catch (e) {
          setFailure(t("saveFailed"));
        } finally {
          setSaving(false);
        }
      }

      const e = react.createElement;
      const keyLabel =
        credential.kind === "loading" ? t("keyLoading") : credential.kind === "error" ? "—" : facts.configured ? t("keyConfigured") : t("keyMissing");

      return e("div", { className: "dsvp-card" },
        e("button", {
          type: "button",
          className: "dsvp-card-header",
          "aria-expanded": open,
          onClick: () => setOpen((v) => !v),
        }, e("span", { style: { fontWeight: 600 } }, t("title")),
          e("span", { style: { marginLeft: "auto", opacity: 0.6 } }, open ? "−" : "+")),
        open
          ? e("div", null,
              e("div", { className: "dsvp-note" }, t("hint")),
              e("div", { className: "dsvp-row" },
                e("label", { className: "check" }, e("input", { type: "checkbox", checked: draft.enabled, onChange: (ev) => setDraft((d) => ({ ...d, enabled: ev.target.checked })) }), t("enabled")),
                e("label", null, t("providerId"), e("input", { value: draft.providerId, onChange: bind("providerId") })),
                e("label", null, t("displayName"), e("input", { value: draft.displayName, onChange: bind("displayName") })),
              ),
              e("div", { className: "dsvp-row" },
                e("label", { style: { flex: 2 } }, t("baseURL"), e("input", { value: draft.baseURL, onChange: bind("baseURL"), placeholder: "https://…/v1" })),
                e("label", null, t("model"), e("input", { value: draft.model, onChange: bind("model") })),
              ),
              e("div", { className: "dsvp-row" },
                e("label", { style: { flex: 2 } }, t("apiKey"), e("input", { type: "password", value: keyDraft, onChange: (ev) => setKeyDraft(ev.target.value), placeholder: t("keyPlaceholder") })),
                e("label", null, t("apiKeyRef"), e("input", { value: draft.apiKeyRef, onChange: bind("apiKeyRef") })),
                e("label", null, t("contextWindow"), e("input", { type: "number", value: String(draft.contextWindow), onChange: bind("contextWindow", (v) => Number(v)) })),
                e("label", null, t("maxTokens"), e("input", { type: "number", value: String(draft.maxTokens), onChange: bind("maxTokens", (v) => Number(v)) })),
              ),
              e("div", { className: "dsvp-row" },
                e("span", null, t("status") + "：", e("span", { className: facts.configured ? "dsvp-ok" : "dsvp-err" }, keyLabel)),
              ),
              failure ? e("div", { className: "dsvp-err" }, failure) : null,
              e("div", { className: "dsvp-row" },
                e("button", { onClick: save, disabled: !dirty || saving || !writable || externalChange }, t("save")),
                e("button", { onClick: discard, disabled: !dirty || saving }, t("discard")),
                saved ? e("span", { className: "dsvp-ok" }, t("saved")) : null,
              ),
              e("div", { className: "dsvp-note" }, t("testHint")),
            )
          : null,
      );
    }

    function Card(props) {
      const { scope, api, t } = props;
      if (scope === undefined || api === undefined || t === undefined) return null;
      return react.createElement(Loaded, { scope, api, t });
    }

    const inject = ["slots", "locale", "connection", "settingsScope"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), "dsh-vision-plugin: settings dictionaries");
      ctx.effect(() => {
        if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-vision-plugin/settings"]') !== null) return () => {};
        if (typeof document === "undefined") return () => {};
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-vision-plugin";
        tag.dataset.pluginCss = "dsh-vision-plugin/settings";
        tag.textContent = CSS;
        document.head.append(tag);
        return () => tag.remove();
      }, "dsh-vision-plugin: settings styles");
      const connection = ctx.get("connection");
      const scope = ctx.settingsScope.bind({ namespace: NS, decode: (v) => (v && typeof v === "object" ? v : undefined) });
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          { name: "settings.plugin.item", id: "dsh-vision-plugin", order: 30, locale: LOCALE_NAMESPACE, inject: () => ({ scope, api: connection.api }) },
          Card,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
