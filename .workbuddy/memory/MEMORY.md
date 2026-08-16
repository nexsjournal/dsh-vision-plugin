# dsh-visionplugin — 项目记忆

## 关键 API 约定（踩过的坑）
- `@deepseek-ai/schemastery` **不是 zod**：schema 是可调用函数，`schema(value)` → 归一化值（应用 defaults）或抛 `ValidationError`；没有 `.parse`。兼容写法见 lib/index.js 的 `parseConfig()`（callable → `.parse` → `~standard.validate` 三级回退）。
- `dsh-settings` 的 `register(ns, schema, { base })` 内部以 `schema(...)` 调用式消费 schema，`scope.get()` 返回合并 base+用户层后的完整配置。
- 插件 peer 依赖全部 optional，缺失时靠 `ctx.get()` / try-catch 降级，不要 import 即崩。

## 形态约定（重要）
- 自 f40f8f8 起插件是**纯 host 插件**：没有 lib/client.js、没有 dsh.client 段、**不提供设置卡片**（用户明确要求：插件配置页不能出现它的卡片；端点配置走 vision_configure 工具或 DSH_VISION_* 环境变量）。
- 「设置→插件→插件列表」里的 `vision-plugin` 行来自 host 侧 inventory（profile bundles 的 include 条目 + cordis.patch.yml insert），与 client 代码无关——**不要**为了列表行往插件里加 client。

## 核心功能：模型目录「图片输入」勾选框（4d84936 起，version 1.1.0）
- 用户定义的插件**核心**：模型目录（设置→模型→模型目录）展开某模型（`>` 箭头）后，"最大输出 token" 下方出现"图片输入"勾选框；勾选=给该模型写 `input:["text","image"]`，取消=清除该字段。
- **数据走 DSH 原生**：host `dsh-llm-pi-ai` 本来就按模型条目上的 `input` 字段决定 `inputModalities` 与图片放行（默认 `DEFAULT_INPUT=["text"]`，没声明 image 发图会报"不支持图片输入"）。插件只负责把缺的 UI 入口补上，停用/卸载插件不影响已保存的声明。
- **实现方式**：`apply()` 启动时**幂等自举补丁**核心包 `dsh-client-ui-settings-models/lib/client.js`（编译产物）：2 个 locale 键（en/zh `modelImageInput`）+ 1 个横排内联勾选框 JSX。已打过（marker `modelImageInput: "Image input"`）跳过；锚点不匹配（DSH 升级改页面）则**不动文件**+log 警告。
- **补丁文件定位**（modelsClientFileCandidates）：① `createRequire(import.meta.url).resolve(PKG/package.json)`（Node 父目录 walk 会命中 `~/.dsh/profiles/node_modules` 的扁平符号链接回退 → 指向 npx 缓存）；② Desktop app `/Applications/DeepSeek Harness.app/Contents/Resources/host/node_modules/...`；③ 全部 `~/.npm/_npx/<hash>/node_modules/...`。用 realpath 去重。
- **补丁字符串必须与手动参考文件字节级一致**：锚点/替换文本用 `\t` 精确拼写，改 DSH 版本后要重新对照（见下方测试）。
- webserver 每次请求从磁盘读 client.js（no-cache，rev=内容 sha1 前 12 位），所以打补丁后**硬刷新页面**即生效，不用重启；但插件自身的新代码要重启 DSH 才加载。
- `vision_status` 输出 `modelsImageInputCheckbox: {targets,patched,alreadyPatched,skipped}` 供诊断。
- **验证方法**（改补丁字符串或 DSH 升级后）：① 用当前打过补丁的文件做往返测试：反向替换 3 处 → 应无 marker；正向替换 → 应与原文件字节级一致（python `cmp`/`count==1` 校验锚点唯一）；② 把核心文件还原为未打补丁态 → 起临时实例 `npx @deepseek-ai/dsh web --port 319x`（profile 已装插件）→ 文件应被自动打上且与参考一致；③ 重启 → md5 不变（幂等）；④ 临时实例用完即杀，别动用户的 3080。

## 启用/停用机制
- 插件列表 UI（`dsh-client-ui-settings-plugin-inventory`）**只读**：host face 只有 `pluginInventory.list`，卡片上只有展开/收起 + 状态点，**没有**开关控件（DSH 核心如此，所有插件一样）。
- 启停走 profile 补丁 `~/.dsh/profiles/<profile>/cordis.patch.yml`：加 `- id: dsh-vision-plugin` + `disabled: true`（**id 不带 `include:` 前缀**——前缀是根 group，补丁层内用裸 id），重启生效。停用后 inventory 显示 `enabled=False phase=None`，provider+4 工具消失；已装勾选框/已存 `input` 声明继续有效（原生数据）。

## 部署链路
- 插件从 git 安装：`~/.dsh/profiles/web/package.json` 里 `dsh-vision-plugin: github:nexsjournal/dsh-vision-plugin`。
- 更新流程：改代码 → commit → `git push origin main` → `cd ~/.dsh/profiles/web && pnpm update dsh-vision-plugin`（lockfile 锁 commit，普通 install 不拉新）。
- Web 端和 Desktop 端（DeepSeek Harness.app）**共用同一个 profile** `~/.dsh/profiles/web` 的 node_modules，更新一处两端生效。
- 验证手段（host-only 后）：boot manifest 里**不会**再出现 dsh-vision-plugin（正常）。查列表行：`curl -X POST http://127.0.0.1:3080/api/pluginInventory/list -H 'Content-Type: application/json' -d '{"type":"client-request","rpcId":"x","method":"pluginInventory/list","payload":{"args":{}}}'`，找 `include:dsh-vision-plugin` 且 `phase: active`。

## 仓库
- 远程：git@github.com:nexsjournal/dsh-vision-plugin.git (main)
