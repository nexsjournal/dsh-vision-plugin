# dsh-visionplugin — 项目记忆

## 关键 API 约定（踩过的坑）
- `@deepseek-ai/schemastery` **不是 zod**：schema 是可调用函数，`schema(value)` → 归一化值（应用 defaults）或抛 `ValidationError`；没有 `.parse`。兼容写法见 lib/index.js 的 `parseConfig()`（callable → `.parse` → `~standard.validate` 三级回退）。
- `dsh-settings` 的 `register(ns, schema, { base })` 内部以 `schema(...)` 调用式消费 schema，`scope.get()` 返回合并 base+用户层后的完整配置。
- 插件 peer 依赖全部 optional，缺失时靠 `ctx.get()` / try-catch 降级，不要 import 即崩。

## 形态约定（重要）
- 自 f40f8f8 起插件是**纯 host 插件**：没有 lib/client.js、没有 dsh.client 段、**不提供设置卡片**（用户明确要求：插件配置页不能出现它的卡片；端点配置走 vision_configure 工具或 DSH_VISION_* 环境变量）。
- 「设置→插件→插件列表」里的 `vision-plugin` 行来自 host 侧 inventory（profile bundles 的 include 条目 + cordis.patch.yml insert），与 client 代码无关——**不要**为了列表行往插件里加 client。

## 部署链路
- 插件从 git 安装：`~/.dsh/profiles/web/package.json` 里 `dsh-vision-plugin: github:nexsjournal/dsh-vision-plugin`。
- 更新流程：改代码 → commit → `git push origin main` → `cd ~/.dsh/profiles/web && pnpm update dsh-vision-plugin`（lockfile 锁 commit，普通 install 不拉新）。
- Web 端和 Desktop 端（DeepSeek Harness.app）**共用同一个 profile** `~/.dsh/profiles/web` 的 node_modules，更新一处两端生效。
- 验证手段（host-only 后）：boot manifest 里**不会**再出现 dsh-vision-plugin（正常）。查列表行：`curl -X POST http://127.0.0.1:3080/api/pluginInventory/list -H 'Content-Type: application/json' -d '{"type":"client-request","rpcId":"x","method":"pluginInventory/list","payload":{"args":{}}}'`，找 `include:dsh-vision-plugin` 且 `phase: active`。

## 仓库
- 远程：git@github.com:nexsjournal/dsh-vision-plugin.git (main)
