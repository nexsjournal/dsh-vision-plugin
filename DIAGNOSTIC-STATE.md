# dsh-vision 设置卡片消失 — 诊断进行中

## 现象
- 9e3adb8（扁平卡片版）：卡片**能渲染**（说明 client scope 是 ready，host 的 dsh-vision namespace 在 settings.describe 里）。
- 8c761ba（对齐内置卡片样式版）：卡片**整个消失**（其他内置卡片正常）。

## 已确认（排除项）
- host 正常：`vision_status` 可用，providerRegistered=true。
- 新 client 确实被加载：`http://127.0.0.1:56273/plugins/dsh-vision-plugin/client.js?rev=...` 返回的是新版（dsvp-card/dsvp-chevron/e("li")，无旧特征）。
- 组件能渲染：用真实 React `renderToString` 跑通（scope ready 时输出正确的 `<li>` 结构）。
- client 插件在 boot manifest 里（会被加载）。
- namespace 名称一致：host `settingsNamespace("dsh-vision")` === client bind `"dsh-vision"`（settingsNamespace 原样返回字符串）。
- host 注册机制正确：与内置 dsh-agent-presets 完全相同（`ctx.inject(["settings"], cb)` + `settings.register`）。
- 内置卡片正常 → `settings.register` 机制本身没坏。

## 结论（当前最强假设）
真实运行时 client scope 没变 `ready` → 卡片 `if (!available) return null`。
即 host 的 dsh-vision namespace **没进 client 的 settings.describe**（host→client 握手断掉）。
但 host 代码与 9e3adb8 完全相同，疑点指向**重装时 pnpm 重新解析改变了 @deepseek-ai/* 依赖版本或 node_modules 布局**，影响了 host 的 settings 注册。

## 已部署的诊断（commit 871953e，已重装）
`vision_status` 现在多返回 `diag` 字段：
- `settingsInjected`：`ctx.inject(["settings"], cb)` 回调是否执行。
- `settingsRegistered`：`settings.register` 是否成功。
- `settingsRegisterError`：register 抛的错（若有）。
- `describe`：`{available, nsCount, nsNames[], visionInDescribe}` —— host 端 describe 里有哪些 namespace、有没有 dsh-vision。

## 下一步（等用户重启 DSH 后）
1. 调 `vision_status`，读 `diag`：
   - `settingsInjected=false` → settings 服务不可用 / inject 没跑。
   - `settingsInjected=true, settingsRegistered=false` → register 抛错（看 settingsRegisterError）。
   - `settingsRegistered=true, visionInDescribe=false` → 注册了但 describe 没返回（奇怪，需查 dsh-settings）。
   - `visionInDescribe=true` → host 正常，问题在 client 侧（scope/t/slot 注入），改查 client。
2. 据结果修对应一侧，再重装 + 重启验证卡片出现且样式对齐内置卡片。

## 环境
- 仓库：/Users/lex/Code/ProjStudy/dsh-plugins/dsh-visionplugin（origin git@github.com:nexsjournal/dsh-vision-plugin.git, main）
- 重装命令：`cd ~/.dsh/profiles/web && export PATH=/opt/homebrew/bin:$PATH && node "/Applications/DeepSeek Harness.app/Contents/Resources/host/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web add -w github:nexsjournal/dsh-vision-plugin`
- 验证已装 commit：`readlink -f ~/.dsh/profiles/web/node_modules/dsh-vision-plugin` 里含 commit 短 hash。
- client 改动需重启 DSH 生效（非 dev:web）。
- 当前 HEAD/remote：871953e。
