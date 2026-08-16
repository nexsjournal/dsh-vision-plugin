# dsh-vision-plugin

**让你的 DeepSeek Harness（DSH）在对话框里直接发图、并且能被"看懂"。**

DSH 的主模型默认是文本模型，本身看不到图片。这个插件借一个**第三方多模态模型**让 DSH 具备识图能力，无需换账号、无需重装：

- **切换发图**：在对话框模型选择器里切到 `vision` 模型，直接发图，由第三方视觉模型识别。
- **按需识别**：不切模型，让助手用 `vision_analyze` 工具识别工作区里的图片文件（OCR / 界面布局 / 代码逐行 / 图表）。
- **自检**：`vision_status` 看配置状态、`vision_test` 测端点连通。

## 适用场景

| 你的情况 | 建议 |
| --- | --- |
| 当前主模型**原生支持图片**（如 qwen-vl、gpt-4o 等多模态模型） | 不需要本插件——DSH 会把原图直通主模型 |
| 主模型是**纯文本**，想在对话框发图并识别 | ✅ 用本插件 |
| 手上**没有**多模态端点 / Key | 先准备一个 OpenAI 兼容的多模态端点（任意服务商的中转/官方都行） |

> 本插件是 **BYO（自带端点）**：它只注册一条 OpenAI 兼容的视觉通道，**不内置任何具体端点或密钥**。每个用户配置自己的端点与 API Key，互不共享。

## 原理

1. **注册 provider**：host 端在 DSH 里注册一个名为 `vision` 的 LLM provider（出现在模型选择器）和三个模型工具（`vision_analyze` / `vision_status` / `vision_test`）。
2. **转发请求**：当你切到 `vision` 发图（或调用 `vision_analyze`）时，插件把当前对话转成 OpenAI 的 `/chat/completions` 请求格式（图片转成 base64 data URL），**非流式、单次**发往你配置的端点。
3. **返回结果**：第三方多模态模型返回文字描述，插件把它作为普通模型响应 / 工具结果交回对话，主模型据此继续回答。
4. **配置热加载**：Base URL / 模型 / API Key 三项存于 DSH **凭据服务**，配置卡片可改、**保存即生效、无需重启**。

数据流向：

```
你在对话框发图
      │
      ▼
 DSH（切到 vision provider）
      │  转成 OpenAI /chat/completions 请求（图片 = base64 data URL）
      ▼
 你配置的 OpenAI 兼容端点 ──► 第三方多模态模型识别
      ▲
      │  返回文字描述
 DSH 把描述交回对话框（主模型继续处理）
```

- **不切模型时**：若当前主模型本身支持图片，DSH 原图直通主模型，本插件不介入；若主模型不支持，用 `vision_analyze` 按需识别。
- **隐私**：图片只发往你自己配置的端点；API Key 单向存凭据服务，界面不读回明文。

## 安装

前提：DSH 已部署（web profile）、`pnpm` 可用（`dsh plugin` 会转发 pnpm）。

```bash
npx @deepseek-ai/dsh plugin --profile web add github:nexsjournal/dsh-vision-plugin
```

**完全退出并重开 DSH**。重启后：
- 模型选择器出现 `vision`；
- 「设置 → 插件 → 插件配置」出现「视觉识别 (dsh-vision)」卡片。

> 桌面端与网页版共用 web profile，装到 web 即两端都生效。
> 依赖说明：本包把 `@deepseek-ai/*` 与 `react` 声明为 optional peerDependencies，安装时不额外拉取，运行时由 profile 依赖树解析（标准部署自带）。

## 配置（必做，约 1 分钟）

1. 打开 **「设置 → 插件 → 插件配置」→「视觉识别 (dsh-vision)」**。
2. 填三项：
   - **Base URL**：你的 OpenAI 兼容端点（以 `/v1` 结尾），例如 `https://你的域名/v1`；
   - **模型**：该端点能处理图片的模型 id；
   - **API Key**：该端点的密钥。
3. 点 **保存**。每项旁的徽标变"已配置"，卡片头变"已就绪"。

- **热生效**：配置改动立即生效，**无需重启**（只有装/卸载插件才需要重启）。
- **留空 = 不改**：只改某一项时，其余留空即可。
- **环境变量**（可选回退）：`DSH_VISION_BASE_URL` / `DSH_VISION_MODEL` / `DSH_VISION_API_KEY`（凭据未设置时生效）。
- API Key 单向存凭据服务，界面只显示"已配置"，不读回明文。

## 验证

在对话里让助手执行 **`vision_test`**：它会调用 `<Base URL>/models` 校验 Key + 可达性，并检查你填的模型是否在端点模型列表中。返回 `ok: true` 且 `modelInList: true` 即就绪。

## 使用

- **方式 A（切换发图）**：对话框模型选择器切到 `vision` 的模型 → 直接发图。
- **方式 B（按需识别）**：保持当前模型，对助手说"识别这张图 `<图片路径>`"，它会调 `vision_analyze`（支持工作区图片文件或 data URL，返回 OCR / 布局 / 代码逐行 / 图表描述）。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `vision_test` 报"API Key 未配置" | 在卡片填 API Key 并保存；或设环境变量 `DSH_VISION_API_KEY` |
| `vision_test` 报连接失败（HTTP 401/403） | Key 错误，或该 Key 无此模型权限 |
| `vision_test` 报模型不在列表 | 填的模型 id 不在端点 `/models` 返回里，核对拼写 |
| 切到 vision 后发图没反应 | 确认三项都"已配置"（卡片头"已就绪"）；Base URL 必须以 `/v1` 结尾 |
| 没切模型、发图也没识别 | 当前主模型若原生支持图片，DSH 会直通主模型、本插件不介入；主模型不支持时用 `vision_analyze` |

## 限制

- 仅支持 **OpenAI 兼容** `/chat/completions`（非流式、单次请求、240s 超时）。
- 图片仅发往你配置的端点。
- `vision_analyze` 单图文件 ≤ 20MB。

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
