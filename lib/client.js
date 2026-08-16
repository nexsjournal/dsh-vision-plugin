/**
 * dsh-vision-plugin — Client half (persistent bundle plugin).
 *
 * Registers a card in Settings -> Plugins -> 插件配置, styled to match the
 * built-in cards (Terminal / Agent 循环 / 网页搜索): a bordered <li> whose
 * header stacks a bold name over a muted description with a rotating chevron,
 * disclosing the form (Base URL / model / API key / limits) plus save/discard.
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

    const NS = "dsh-vision";
    const LOCALE_NAMESPACE = "settings.dshVisionPlugin";
    const DEFAULT_REF = "DSH_VISION_API_KEY";

    const zh = {
      title: "视觉识别 (dsh-vision)",
      description: "配置第三方 OpenAI 兼容视觉模型，切换 API / 模型 / Key。",
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
      keyLoading: "读取中…",
      keyPlaceholder: "填写以保存（留空不改）",
      keyHint: "经凭据服务单向保存，界面不读回；也可用同名环境变量。",
      save: "保存",
      saving: "保存中…",
      discard: "放弃",
      unsaved: "未保存",
      readOnly: "当前设置不可写。",
      conflict: "设置已在别处更改，请放弃当前修改后重试。",
      saveFailed: "保存失败。",
      keySaveFailed: "API Key 保存失败。",
      testHint: "测试连接：在对话里让助手执行 vision_test 工具。",
      expand: "展开",
      collapse: "收起",
    };
    const en = {
      title: "Vision (dsh-vision)",
      description: "Configure a third-party OpenAI-compatible vision model (API / model / key).",
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
      keyPlaceholder: "enter to save (blank = keep)",
      keyHint: "Stored one-way via the credentials service; not read back. Env var of the same name also works.",
      save: "Save",
      saving: "Saving…",
      discard: "Discard",
      unsaved: "unsaved",
      readOnly: "Settings are not writable.",
      conflict: "Settings changed elsewhere. Discard and retry.",
      saveFailed: "Save failed.",
      keySaveFailed: "API key save failed.",
      testHint: "To test: ask the assistant to run the vision_test tool.",
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
      ".dsvp-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
      ".dsvp-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".dsvp-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;margin-top:12px;display:flex}",
      ".dsvp-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
      ".dsvp-discard,.dsvp-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
      ".dsvp-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
      ".dsvp-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
      ".dsvp-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".dsvp-discard:disabled,.dsvp-save:disabled{opacity:.4;cursor:default}",
      ".dsvp-discard:focus-visible,.dsvp-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
      // form fields (mirror the built-in ValueField input styling)
      ".dsvp-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
      ".dsvp-field+.dsvp-field{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".dsvp-row{display:flex;gap:12px;flex-wrap:wrap}",
      ".dsvp-field label{display:flex;flex-direction:column;gap:6px;flex:1;min-width:180px}",
      ".dsvp-field label.check{flex-direction:row;align-items:center;gap:8px;min-width:auto}",
      ".dsvp-head{align-items:center;gap:8px;display:flex}",
      ".dsvp-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
      ".dsvp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".dsvp-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
      ".dsvp-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}",
      ".dsvp-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
      ".dsvp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
      ".dsvp-test{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
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

    function nonEmptyString(v) {
      return typeof v === "string" && v.trim() !== "" ? v : undefined;
    }
    function numOf(v, fallback) {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    }
    function draftOf(settings) {
      const s = settings && typeof settings === "object" ? settings : {};
      return {
        enabled: s.enabled !== false,
        providerId: nonEmptyString(s.providerId) ?? "vision",
        displayName: nonEmptyString(s.displayName) ?? "Vision 视觉模型 (OpenAI 兼容)",
        baseURL: nonEmptyString(s.baseURL) ?? "",
        model: nonEmptyString(s.model) ?? "",
        apiKeyRef: nonEmptyString(s.apiKeyRef) ?? DEFAULT_REF,
        contextWindow: numOf(s.contextWindow, 131072),
        maxTokens: numOf(s.maxTokens, 8192),
      };
    }
    const FIELD_KEYS = ["enabled", "providerId", "displayName", "baseURL", "model", "apiKeyRef", "contextWindow", "maxTokens"];
    function settingsOps(before, after) {
      const ops = [];
      for (const key of FIELD_KEYS) if (before[key] !== after[key]) ops.push({ op: "set", path: [key], value: after[key] });
      return ops;
    }
    function sameDraft(a, b) {
      return FIELD_KEYS.every((k) => a[k] === b[k]);
    }

    function VisionCard(props) {
      const { scope, api, t } = props;
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
      const [failed, setFailed] = react.useState(false);

      const settingsDirty = !sameDraft(baseline, draft);
      const keyDirty = keyDraft.trim() !== "";
      const dirty = settingsDirty || keyDirty;
      const writable = snapshot.status === "ready" && snapshot.writable;
      const available = snapshot.status === "ready";

      // Track external settings changes.
      react.useEffect(() => {
        if (snapshot.status !== "ready" || snapshot.revision === revision) return;
        if (settingsDirty) return; // local unsaved edits: don't clobber
        const next = draftOf(snapshot.value);
        setBaseline(next);
        setDraft(next);
        setRevision(snapshot.revision);
        setFailed(false);
      }, [revision, settingsDirty, snapshot.revision, snapshot.status, snapshot.value]);

      // Load credential facts for the current apiKeyRef (only when open).
      react.useEffect(() => {
        const ref = draft.apiKeyRef;
        if (!open || !ref) { setCredential({ kind: "idle" }); return; }
        let active = true;
        setCredential({ kind: "loading" });
        api.credentials
          .describe({ refs: [ref] })
          .then((response) => {
            if (!active) return;
            setCredential(response.result.ok ? { kind: "ready", credentials: response.result.value.credentials } : { kind: "error" });
          }, () => { if (active) setCredential({ kind: "error" }); });
        return () => { active = false; };
      }, [api.credentials, draft.apiKeyRef, open]);

      const facts = (() => {
        if (credential.kind !== "ready") return { configured: false, writable: true };
        const info = credential.credentials[draft.apiKeyRef];
        return { configured: !!(info && info.configured), writable: !info || info.writable !== false };
      })();
      const keyLabel = credential.kind === "loading" ? t("keyLoading") : credential.kind === "error" ? "—" : facts.configured ? t("keyConfigured") : t("keyMissing");

      function bind(key, transform) {
        return (ev) => setDraft((d) => ({ ...d, [key]: transform ? transform(ev.target.value) : ev.target.value }));
      }
      function discard() {
        const next = draftOf(snapshot.status === "ready" ? snapshot.value : undefined);
        setBaseline(next);
        setDraft(next);
        setRevision(snapshot.revision);
        setKeyDraft("");
        setFailed(false);
      }
      async function save() {
        if (!dirty || saving || !writable) return;
        setSaving(true);
        setFailed(false);
        try {
          if (keyDirty && draft.apiKeyRef) {
            const r = await api.credentials.set({ ref: draft.apiKeyRef, value: keyDraft.trim() });
            if (!r.result.ok) { setFailed(true); setCredential({ kind: "error" }); return; }
            setCredential({ kind: "ready", credentials: { [draft.apiKeyRef]: { configured: true, writable: true } } });
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
              setFailed(true);
              return;
            }
            const next = draftOf(response.result.value.value);
            setBaseline(next);
            setDraft(next);
            setRevision(response.result.value.revision);
          }
        } catch (err) {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      }

      // Diagnostic: always render the card. When the settings scope is not
      // "ready", show its status in the description so the cause is visible.
      const descriptionText = available
        ? t("description")
        : "配置未就绪（scope 状态: " + String(snapshot.status) + (snapshot.error ? " / " + String(snapshot.error) : "") + "）";

      const disabled = !writable;
      const field = (labelText, inputEl, hintEl, badgeEl) =>
        e("label", { key: labelText },
          e("span", { className: "dsvp-head" },
            e("span", { className: "dsvp-label" }, labelText),
            badgeEl || null,
          ),
          inputEl,
          hintEl || null,
        );

      return e("li", { className: cx("dsvp-card", open && "dsvp-cardOpen") },
        e("button", {
          type: "button", className: "dsvp-header", "aria-expanded": open,
          "aria-label": (available ? t(open ? "collapse" : "expand") : "dsh-vision") + ": " + t("title"),
          onClick: () => setOpen(!open),
        },
          e("span", { className: "dsvp-headText" },
            e("span", { className: "dsvp-name" }, t("title")),
            e("span", { className: "dsvp-description" }, descriptionText),
          ),
          dirty ? e("span", { className: "dsvp-pending" }, t("unsaved")) : null,
          e(Chevron, { className: cx("dsvp-chevron", open && "dsvp-chevronOpen") }),
        ),
        open && available
          ? e("div", { className: "dsvp-body" },
            !writable ? e("p", { className: "dsvp-readOnly", role: "status" }, t("readOnly")) : null,
            e("div", { className: "dsvp-field" },
              e("label", { className: "check" },
                e("input", { type: "checkbox", checked: draft.enabled, disabled, onChange: (ev) => setDraft((d) => ({ ...d, enabled: ev.target.checked })) }),
                e("span", { className: "dsvp-label" }, t("enabled")),
              ),
            ),
            e("div", { className: "dsvp-field" },
              e("div", { className: "dsvp-row" },
                field(t("providerId"), e("input", { className: "dsvp-input", value: draft.providerId, disabled, onChange: bind("providerId") })),
                field(t("displayName"), e("input", { className: "dsvp-input", value: draft.displayName, disabled, onChange: bind("displayName") })),
              ),
            ),
            e("div", { className: "dsvp-field" },
              e("div", { className: "dsvp-row" },
                field(t("baseURL"), e("input", { className: "dsvp-input", value: draft.baseURL, disabled, onChange: bind("baseURL"), placeholder: "https://…/v1" })),
                field(t("model"), e("input", { className: "dsvp-input", value: draft.model, disabled, onChange: bind("model") })),
              ),
            ),
            e("div", { className: "dsvp-field" },
              e("div", { className: "dsvp-row" },
                field(t("apiKey"), e("input", { type: "password", className: "dsvp-input", value: keyDraft, disabled, onChange: (ev) => setKeyDraft(ev.target.value), placeholder: t("keyPlaceholder") }),
                  e("p", { className: "dsvp-hint" }, t("keyHint")),
                  e("span", { className: "dsvp-badge" }, keyLabel)),
                field(t("apiKeyRef"), e("input", { className: "dsvp-input", value: draft.apiKeyRef, disabled, onChange: bind("apiKeyRef") })),
              ),
            ),
            e("div", { className: "dsvp-field" },
              e("div", { className: "dsvp-row" },
                field(t("contextWindow"), e("input", { className: "dsvp-input", type: "number", value: String(draft.contextWindow), disabled, onChange: bind("contextWindow", (v) => Number(v)) })),
                field(t("maxTokens"), e("input", { className: "dsvp-input", type: "number", value: String(draft.maxTokens), disabled, onChange: bind("maxTokens", (v) => Number(v)) })),
              ),
            ),
            e("p", { className: "dsvp-test" }, t("testHint")),
            e("div", { className: "dsvp-footer" },
              failed ? e("p", { className: "dsvp-failed", role: "status" }, t("saveFailed")) : null,
              e("button", { type: "button", className: "dsvp-discard", disabled: !dirty || saving, onClick: discard }, t("discard")),
              e("button", { type: "button", className: "dsvp-save", disabled: !dirty || !writable || saving, onClick: save }, t(saving ? "saving" : "save")),
            ),
          )
          : null,
      );
    }

    function Card(props) {
      const { scope, api, t } = props;
      const missing = [
        scope === undefined ? "scope" : "",
        api === undefined ? "api" : "",
        t === undefined ? "t" : "",
      ].filter(Boolean);
      if (missing.length > 0) {
        const head = e("span", { className: "dsvp-headText" },
          e("span", { className: "dsvp-name" }, "视觉识别 (dsh-vision) — 诊断"),
          e("span", { className: "dsvp-description" }, "slot 注入 props 缺失: " + missing.join(", ")),
        );
        const btn = e("button", { type: "button", className: "dsvp-header" }, head);
        return e("li", { className: "dsvp-card" }, btn);
      }
      return e(VisionCard, { scope, api, t });
    }

    const inject = ["slots", "locale", "connection", "settingsScope"];

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
