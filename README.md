# dsh-vision-plugin

DeepSeek Harness（DSH）的**持久化**第三方视觉模型插件。让文本主模型也能"看懂"图片：

- 注册一个 **OpenAI 兼容的视觉 provider**（默认 `vision`），在会话模型选择器里可切换；切换后聊天里直接发图，由你配置的第三方多模态模型识别。
- 提供三个模型工具：`vision_analyze`（按需识别工作区图片文件 / data URL）、`vision_status`（查状态）、`vision_test`（测连接）。
- 在 **「设置 → 插件 → 插件配置」** 里提供一张配置卡片，随时切换 **Base URL / 模型 / API Key**，热生效、无需重启。

这是一个 **bundle 插件**（随部署常驻、重启不丢），区别于进程内的动态 Cordis 插件（见 `dynamic/` 目录）。

## 工作原理

| 场景 | 行为 |
| --- | --- |
| 当前主模型本身声明支持 image | 原图直通主模型（本插件不介入） |
| 切到本插件的 `vision` provider | 图片经你的 OpenAI 兼容端点 `/chat/completions`（非流式单次请求）识别 |
| 用 `vision_analyze` 工具 | 把图片文件/data URL 交给视觉模型，返回详细文字描述（OCR、布局、代码逐行、图表） |

配置分两部分：
- **非敏感字段**（baseURL / model / providerId / contextWindow / maxTokens 等）存于 DSH 设置命名空间 `dsh-vision`，卡片改动热加载。
- **API Key** 通过 DSH **凭据服务**按命名引用（默认 `DSH_VISION_API_KEY`）单向保存，界面只知道"是否已配置"，不会读回；也可用同名环境变量回退。

## 安装

前提：DSH 已部署、`pnpm` 可用（`dsh plugin` 命令会转发 pnpm）。

```bash
# 1) 安装你的插件（从 GitHub）
npx @deepseek-ai/dsh plugin --profile web add github:<你的用户名>/dsh-vision-plugin

# 2)（可选）移除第三方视觉插件
npx @deepseek-ai/dsh plugin --profile web remove @oil-oil/dsh-vision
```

`dsh plugin` 会自动把新依赖对齐进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`。**重启 DSH** 后生效：模型选择器出现 `vision` provider，设置面板出现「视觉识别 (dsh-vision)」卡片。

> 依赖说明：本包把 `@deepseek-ai/*` 与 `react` 声明为 **optional peerDependencies**，安装时不额外拉取，运行时由 profile 的依赖树解析——因此要求 DSH 部署自带这些包（标准部署均有）。

## 使用

1. **配置**：设置 → 插件 → 插件配置 → 「视觉识别 (dsh-vision)」，填 Base URL / 模型 / API Key，保存。
   - Base URL 示例：`https://openrouter.ai/api/v1`、`https://api.openai.com/v1`、`https://dashscope.aliyuncs.com/compatible-mode/v1`、或你的中转 ``。
   - 模型示例：`qwen/qwen3.7-plus`、`gpt-4o`、`qwen-vl-max`、`qwen3.8-flash`（若你的中转该模型本身支持图片）。
2. **验证**：在对话里让助手执行 `vision_test`（校验 Key + 可达性 + 模型是否在端点列表）。
3. **用图**：
   - 方式 A：模型选择器切到 `vision` 的模型 → 直接发图。
   - 方式 B：不切模型，让助手用 `vision_analyze` 分析工作区图片文件。

## 目录结构

```
dsh-vision-plugin/
├── package.json          # dsh.bundle 元数据 + dsh.client.inject + optional peers
├── cordis.patch.yml      # 组合补丁：插入 dsh-vision-plugin 行
├── lib/
│   ├── index.js          # Host 半：注册 vision provider + 三个工具 + 设置命名空间
│   └── client.js         # Client 半：设置卡片（__ModuleLoader__ 格式）
├── dynamic/              # 进程内动态 Cordis 插件版本（host.js / client.js / config.json）
├── README.md
└── LICENSE
```

## 动态版（dynamic/）

`dynamic/` 里是**进程内动态 Cordis 插件**版本（`host.js` / `client.js` 为 `cordis_define` 的 `code.host` / `code.client` 函数体，`config.json` 为其配置）。特点：当前进程内生效、重启即消失、需 `cordis_define` + `cordis_run` 注册。适合临时实验；要长期常驻请用本仓库的 bundle 版。

## 限制

- 仅支持 **OpenAI 兼容** `/chat/completions`（非流式，单次请求，240s 上限）。
- 视觉结果作为普通文本/工具结果参与当前请求；图片仅发往你配置的端点。
- API Key 建议用凭据服务保存（卡片里填），避免写入明文文件。
