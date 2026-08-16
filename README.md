# dsh-vision-plugin

DeepSeek Harness（DSH）的**持久化**第三方视觉模型插件。让文本主模型也能"看懂"图片：

- 注册一个 **OpenAI 兼容的视觉 provider**（默认 id `vision`），在会话模型选择器里可切换；切换后聊天里直接发图，由你配置的第三方多模态模型识别。
- 提供三个模型工具：`vision_analyze`（按需识别工作区图片文件 / data URL）、`vision_status`（查状态）、`vision_test`（测连接）。
- 在 **「设置 → 插件 → 插件配置」** 里提供一张配置卡片，随时填写 **Base URL / 模型 / API Key**，保存后热生效、无需重启。

这是一个 **bundle 插件**：随部署常驻、重启不丢。所有端点与凭据默认**为空**，由你在配置卡片里填写，仓库不内置任何具体 API 地址或密钥。

## 工作原理

| 场景 | 行为 |
| --- | --- |
| 当前主模型本身声明支持 image | 原图直通主模型（本插件不介入） |
| 切到本插件的 `vision` provider | 图片经你配置的 OpenAI 兼容端点 `/chat/completions`（非流式单次请求）识别 |
| 用 `vision_analyze` 工具 | 把图片文件 / data URL 交给视觉模型，返回详细文字描述（OCR、布局、代码逐行、图表） |

配置通过 DSH **凭据服务**按命名引用保存，配置卡片可热改（保存即生效、无需重启）：

| 项 | 凭据名 | 说明 |
| --- | --- | --- |
| Base URL | `DSH_VISION_BASE_URL` | OpenAI 兼容端点（以 `/v1` 结尾） |
| 模型 | `DSH_VISION_MODEL` | 该端点支持图片的模型 id |
| API Key | `DSH_VISION_API_KEY` | 端点的密钥 |

- 三项均**单向保存**，界面只显示"已配置 / 未配置"，不会读回明文；留空即不修改。
- 每项也可用**同名环境变量**回退（如 `DSH_VISION_BASE_URL`），便于无界面场景。
- 高级项（`providerId` / `displayName` / `contextWindow` / `maxTokens` / `enabled`）走 cordis.yml 里本插件行的 `config`（很少改，改动需重启）。
- 本插件是 **BYO（自带端点）**：每个用户配置自己的端点与 Key，仓库不内置任何具体地址或密钥，也不共享他人配置。

## 安装

前提：DSH 已部署、`pnpm` 可用（`dsh plugin` 命令会转发 pnpm）。

```bash
# 把插件加入 web profile（从 GitHub 安装）
npx @deepseek-ai/dsh plugin --profile web add github:<你的用户名>/dsh-vision-plugin
```

`dsh plugin` 会自动把新依赖对齐进 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`。**重启 DSH** 后生效：模型选择器出现 `vision` provider，「设置 → 插件 → 插件配置」出现「视觉识别 (dsh-vision)」卡片。

> 依赖说明：本包把 `@deepseek-ai/*` 与 `react` 声明为 **optional peerDependencies**，安装时不额外拉取，运行时由 profile 的依赖树解析——因此要求 DSH 部署自带这些包（标准部署均有）。

## 使用

1. **配置**：设置 → 插件 → 插件配置 → 「视觉识别 (dsh-vision)」，填写 **Base URL / 模型 / API Key**，点保存（热生效，无需重启）。
   - 每项旁有"已配置 / 未配置"徽标；留空表示不修改该项。三项齐全后卡片头显示"已就绪"。
   - Base URL 指向任意 OpenAI 兼容端点（以 `/v1` 结尾），模型填该端点支持的、能处理图片的模型 id。
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
│   ├── index.js          # Host 半：注册 vision provider + 三个工具 + 凭据配置解析
│   └── client.js         # Client 半：配置卡片（__ModuleLoader__ 格式）
├── README.md
└── LICENSE
```

## 限制

- 仅支持 **OpenAI 兼容** `/chat/completions`（非流式，单次请求，240s 上限）。
- Base URL / 模型 / Key 默认均为空，需先在配置卡片里填写并保存。
- 视觉结果作为普通文本 / 工具结果参与当前请求；图片仅发往你配置的端点。
