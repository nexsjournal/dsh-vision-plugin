# dsh-visionplugin — 项目记忆

## 关键 API 约定（踩过的坑）
- `@deepseek-ai/schemastery` **不是 zod**：schema 是可调用函数，`schema(value)` → 归一化值（应用 defaults）或抛 `ValidationError`；没有 `.parse`。兼容写法见 lib/index.js 的 `parseConfig()`（callable → `.parse` → `~standard.validate` 三级回退）。
- `dsh-settings` 的 `register(ns, schema, { base })` 内部以 `schema(...)` 调用式消费 schema，`scope.get()` 返回合并 base+用户层后的完整配置。
- 插件 peer 依赖全部 optional，缺失时靠 `ctx.get()` / try-catch 降级，不要 import 即崩。

## 部署链路
- 插件从 git 安装：`~/.dsh/profiles/web/package.json` 里 `dsh-vision-plugin: github:nexsjournal/dsh-vision-plugin`。
- 更新流程：改代码 → commit → `git push origin main` → `cd ~/.dsh/profiles/web && pnpm update dsh-vision-plugin`（lockfile 锁 commit，普通 install 不拉新）。
- Web 端和 Desktop 端（DeepSeek Harness.app）**共用同一个 profile** `~/.dsh/profiles/web` 的 node_modules，更新一处两端生效。
- 验证手段：`npx @deepseek-ai/dsh web` 启动后 `curl http://127.0.0.1:3080/` 查 `window.__DSH_BOOT__` manifest 里是否有插件条目。

## 仓库
- 远程：git@github.com:nexsjournal/dsh-vision-plugin.git (main)
