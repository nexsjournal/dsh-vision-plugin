# dsh-vision-plugin

**给 DSH 的模型目录补上「图片输入」声明勾选框，并可选注册一条 BYO 视觉中继通道。**

两个能力，都是围绕"让 DSH 看懂图片"：

## 能力一（核心）：模型目录「图片输入」勾选框

DSH 的 host 端**原生支持**给自定义模型声明 `input` 模态（`dsh-llm-pi-ai` 会读取模型条目上的 `input: ["text","image"]`，并据此决定是否把原图直通给该模型）——但「设置 → 模型 → 模型目录」的 UI 一直没有暴露这个声明的入口。

本插件在**每次 DSH 启动时**幂等地给模型页装上这个入口：

- 模型目录里每行点 `>` 箭头展开后，「最大输出 token」下方多一个「**图片输入**」勾选框；
- 勾选 = 给该模型写 `input: ["text","image"]`（走模型页自身的保存流程，存进 DSH settings）；取消勾选 = 清除该字段；
- 勾选后，这个模型就能在对话框里直接收图（原图直通），不需要切模型、不需要任何工具。

> 实现方式：插件 host 端在启动时把一小段补丁（2 个字典键 + 1 个勾选框 JSX，共约 20 行）幂等地写入 DSH 核心模型页的编译产物（已打过的跳过；DSH 升级导致锚点变化时跳过并记日志，不会写坏文件）。补丁只动模型页这一个文件，不注册任何卡片。

## 能力二（可选）：BYO 视觉中继 provider

DSH 的主模型默认是纯文本模型，本身看不到图片。如果你的端点模型**不支持**图片直通，可以借一个**第三方多模态模型**让 DSH 具备识图能力：

- **切换发图**：在模型选择器里切到 `vision` 模型，直接发图，由你配置的 OpenAI 兼容端点识别（插件转发 `/chat/completions`，图片转 base64）。
- **按需识别**：不切模型，让助手用 `vision_analyze` 工具识别工作区里的图片文件（OCR / 界面布局 / 代码逐行 / 图表）。
- **自检 / 配置**：`vision_status` 看配置状态、`vision_test` 测端点连通、`vision_configure` 在对话里热配置。

> 能力二是 **BYO（自带端点）**：插件只注册一条 OpenAI 兼容的视觉通道，**不内置任何具体端点或密钥**，每个用户配自己的端点与 API Key。不用它也不影响能力一。

## 适用场景

**能力一**的适用面很宽：只要你在 DSH 里添加了自定义模型（任何 provider），就可能用到这个勾选框。

**能力二**的适用场景：

| 你的情况 | 建议 |
| --- | --- |
| 主模型是**纯文本**，但你有可用的多模态端点，想在对话框发图并识别 | ✅ 用能力二 |
| 手上**没有**多模态端点 / Key | 先准备一个 OpenAI 兼容的多模态端点（任意服务商的中转/官方都行） |

## 原理

**能力一**：

1. **启动时打补丁**：插件 host 端在 DSH 启动、插件树挂载时，给 `dsh-client-ui-settings-models`（模型页）的编译产物补上勾选框。幂等：已打过就跳过；锚点不匹配（DSH 升级改了页面结构）就跳过并记警告日志，不动文件。
2. **数据完全走 DSH 原生**：勾选只改模型条目上的 `input` 字段（settings 的 `llm-pi-ai` 命名空间，模型页自己的保存流程）。host 端 `dsh-llm-pi-ai` 原生读取该字段：`listModels/resolveModel` 把它暴露为 `inputModalities`，发图时若模型没声明 `image` 会直接报"不支持图片输入"。插件停用/卸载都不影响已保存的声明继续生效。

**能力二**：

1. **注册 provider**：host 端注册一个名为 `vision` 的 LLM provider（出现在模型选择器）和四个工具（`vision_analyze` / `vision_status` / `vision_test` / `vision_configure`）。
2. **转发请求**：切到 `vision` 发图（或调 `vision_analyze`）时，插件把对话转成 OpenAI 的 `/chat/completions` 请求（图片转 base64 data URL），**非流式、单次**发往你配置的端点。
3. **返回结果**：第三方多模态模型返回文字描述，插件把它作为普通模型响应 / 工具结果交回对话，主模型据此继续回答。
4. **配置热加载**：Base URL / 模型 / API Key 三项存于 DSH **凭据服务**，通过 `vision_configure` 工具或环境变量修改、**保存即生效、无需重启**。

> 本插件是 **纯 host 插件**：不提供设置卡片（插件配置页不会出现它），只占用插件列表里的一行。

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
- 「设置 → 插件 → 插件列表」出现 `vision-plugin` 一行（已启用）；
- 「设置 → 模型 → 模型目录」：展开任意模型（点 `>` 箭头），「最大输出 token」下方出现「**图片输入**」勾选框（能力一）；
- 对话里可用 `vision_status` / `vision_configure` / `vision_test` / `vision_analyze` 四个工具（能力二）；
- 「设置 → 插件 → 插件配置」**不会**出现本插件的卡片——本插件是纯 host 插件。

> 桌面端与网页版共用 web profile，装到 web 即两端都生效。
> 依赖说明：本包把 `@deepseek-ai/*` 声明为 optional peerDependencies，安装时不额外拉取，运行时由 profile 依赖树解析（标准部署自带）。

## 启用 / 停用

「插件列表」本身是只读的（DSH 核心 UI，所有插件都一样），启用/停用通过 profile 的补丁文件 `~/.dsh/profiles/<profile>/cordis.patch.yml` 控制：

**停用**（在顶层数组里加一个条目，然后重启 DSH）：

```yaml
- id: dsh-vision-plugin
  disabled: true
```

**启用**：删掉这个条目（或把 `disabled` 改为 `false`），重启 DSH。

停用后：`vision` provider 和 4 个工具消失，模型页勾选框补丁不再维护（已装上的勾选框和已保存的 `input` 声明继续有效，因为数据走 DSH 原生）。

## 配置（仅能力二需要，约 1 分钟）

要配三项：**Base URL**（OpenAI 兼容端点，以 `/v1` 结尾）、**模型**（该端点能处理图片的模型 id）、**API Key**（端点密钥）。两种配法任选其一，都**热生效、无需重启**：

- **① 对话里让助手配（推荐）**：直接对助手说"把视觉端点配成 baseURL=`https://你的域名/v1`、模型=`xxx`、key=`sk-xxx`"，助手会调 `vision_configure` 工具写入凭据。
  > 注意：这样 API Key 会出现在对话里并写入凭据库；个人/本地 DSH 没问题，**共享部署建议用②环境变量**存 Key。
- **② 环境变量**：在 DSH 进程环境设 `DSH_VISION_BASE_URL` / `DSH_VISION_MODEL` / `DSH_VISION_API_KEY`（launchd 服务写进 plist 的 `EnvironmentVariables` 或启动脚本）。凭据未设置时生效。

通用规则：
- **热生效**：改完立即生效，无需重启（只有装/卸载插件才要重启）。
- **留空 = 不改**：只改某一项时，其余留空。
- **查配置来源**：让助手跑 `vision_status`，会报告每项来自 **凭据 / 环境变量 / 行配置 / 未配**，方便确认环境变量是否被读到。

> **如果你的主模型本身就支持图片**（在 DSH 里声明了 image 模态）：DSH 会把原图直通该模型，直接发图即可，本插件不参与。注意 DSH 判断依据是**模型声明**（`inputModalities` 是否含 `image`），而非模型真实能力——同一个模型在不同 provider 配置下声明可能不同。

## 验证

- **能力一**：「设置 → 模型 → 模型目录」展开某个模型，能看到「图片输入」勾选框即已装好。勾选后给该模型发一张图，DSH 应把原图直通该模型（而不是报"不支持图片输入"）。
- **能力二**：在对话里让助手执行 **`vision_test`**：它会调用 `<Base URL>/models` 校验 Key + 可达性，并检查你填的模型是否在端点模型列表中。返回 `ok: true` 且 `modelInList: true` 即就绪。

## 使用

- **方式 A（勾选后直接发图，推荐）**：给某个支持图片的自定义模型勾上「图片输入」，模型选择器选到它 → 直接发图。DSH 原图直通该模型。
- **方式 B（切换发图，能力二）**：对话框模型选择器切到 `vision` 的模型 → 直接发图，由你配的第三方端点识别。（前提：已配好端点，`vision` 才会出现在选择器。）
- **方式 C（按需识别，不切模型，能力二）**：保持当前模型，对助手说"识别这张图 `<图片路径>`"，它会调 `vision_analyze`（支持工作区图片文件或 data URL，返回 OCR / 布局 / 代码逐行 / 图表描述）。**当前模型是否支持图片都不影响这条。**

## 常见问题

| 现象 | 处理 |
| --- | --- |
| **模型页展开后没有「图片输入」勾选框** | 跑 `vision_status` 看 `modelsImageInputCheckbox`：`skipped>0` 说明 DSH 升级改了模型页结构、锚点不匹配（插件不会写坏文件），等插件新版适配；页面需要**硬刷新**（Cmd/Ctrl+Shift+R） |
| **勾选了图片输入，发图还是报"不支持图片输入"** | 确认勾的是**当前选中**的那个模型；改完勾选要等模型页保存（离开/重进模型页会触发）；`vision_status` 确认插件在启用状态 |
| **停用插件后勾选框/声明还在** | 正常——数据走 DSH 原生（`input` 字段存在 settings），停用只停 `vision` provider 和 4 个工具，不影响已保存声明 |
| `vision_test` 报"API Key 未配置" | 对话里让助手 `vision_configure` / 设环境变量 `DSH_VISION_API_KEY` |
| `vision_test` 报连接失败（HTTP 401/403） | Key 错误，或该 Key 无此模型权限 |
| `vision_test` 报模型不在列表 | 填的模型 id 不在端点 `/models` 返回里，核对拼写 |
| **插件配置里没有本插件的卡片** | 正常——本插件是纯 host 插件，**不提供卡片**。端点配置走①对话里 `vision_configure` 或②环境变量；先用 `vision_status` 确认 host 侧工具在不在 |
| **模型选择器里没有 `vision`** | `vision` 只在端点配好后才出现（没配 model 时不显示空模型）。先配端点（两种方式任一），再看选择器 |
| 切到 vision 后发图没反应 | 确认三项都"已配置"（`vision_status` 的 `ready: true`）；Base URL 必须以 `/v1` 结尾 |
| 没切模型、发图也没识别 | 当前主模型若在 DSH 里声明了 image，DSH 会直通主模型、本插件不介入；没声明 image 时用 `vision_analyze`（方式 B，不切模型） |

## 限制

- 能力一：补丁针对 `dsh-client-ui-settings-models` 0.1.0-rc.6 的编译产物；DSH 大版本升级改了模型页后勾选框会消失（插件记警告日志、不写坏文件），需插件新版适配。
- 能力二：仅支持 **OpenAI 兼容** `/chat/completions`（非流式、单次请求、240s 超时）；图片仅发往你配置的端点；`vision_analyze` 单图文件 ≤ 20MB。

## 目录结构

```
dsh-vision-plugin/
├── package.json          # dsh.bundle 元数据（纯 host，无 dsh.client）+ optional peers
├── cordis.patch.yml      # 组合补丁：插入 dsh-vision-plugin 行
├── lib/
│   └── index.js          # Host 半：模型页勾选框补丁（核心）+ vision provider + 四个工具 + 凭据配置解析
├── README.md
└── LICENSE
```
