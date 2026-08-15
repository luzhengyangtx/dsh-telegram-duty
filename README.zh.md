# dsh-telegram-duty（中文说明）

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![npm](https://img.shields.io/npm/v/@luzhengyangtx/dsh-telegram-duty)](https://www.npmjs.com/package/@luzhengyangtx/dsh-telegram-duty)

把 DeepSeek Harness（DSH）变成随身值班室：手机 Telegram 发消息 → 值班智能体干活 → 结果回复到手机。空闲时零 token（长轮询 `getUpdates`，消息到达才唤醒智能体）。

[English](README.md)

## 快速开始（约 10 分钟）

1. **创建机器人**：在 Telegram 里找 [@BotFather](https://t.me/BotFather)，发送 `/newbot`，按提示取名，拿到 token（形如 `123456:ABC...`）。
2. **查自己的 chat id**：给 [@userinfobot](https://t.me/userinfobot)（或你刚建的机器人）发任意消息，它会回复你的数字 id。
3. **安装插件**：在 DeepSeek Harness checkout 目录里执行：

   ```powershell
   dsh plugin --profile web add @luzhengyangtx/dsh-telegram-duty
   ```

4. **填写配置**：在 `C:\Users\<你>\.dsh\profiles\web\cordis.patch.yml` 中加上：

   ```yaml
   - id: telegram-duty
     config:
       token: '123456:你的机器人token'   # 第 1 步
       chatId: 123456789                # 第 2 步（白名单）
       language: zh                     # 或 en
   ```

5. **重启** `dsh web`，用手机给你的机器人发条消息——搞定，值班智能体开始回话。

> 进入值守后，网页顶部会出现横幅提示"审批已转到手机"，点一下即可切回本地。

## 功能

- 📱 任务闭环：Telegram 消息 → 专属"值班会话"（带标准工具集）→ 最终回复回传手机；长回复自动分段。
- ⏳ 即时反馈：任务消息立即收到"📨 收到，正在生成…"，处理期间手机持续显示"正在输入…"动画，出结果自动消失；出错补发"⚠️ 处理出错"。
- 🎯 定向会话：`/sessions` 列出你工作区的会话（在线 + 离线，与网页侧边栏一致，空壳草稿不显示）并带编号按钮——点编号后后续消息都发给该会话；消息前加 `#编号` 只单发这一条；`/duty` 回默认值班路由；离线会话在第一条定向消息时自动唤醒。
- 🔐 白名单：只服务你自己的 chat id，其他人仅记日志。
- ✅ 全局审批转发：值守模式下，**所有会话**的审批都发到手机，**带 [✅ 同意] [⛔ 拒绝] 按钮**（点按钮即答，打字 `3 同意 / 3 拒绝` 仍兼容）；超时（默认 10 分钟）按拒绝处理（保守安全）。`/away` 会提醒网页上还挂着的审批，`/unblock` 可取消被审批卡住的回合。
- ❓ telegram_ask 提问工具：智能体需要您选择方案、确认事项或补充信息时，把问题推送到手机（**每个选项一个按钮**，点选即答）；值班智能体已被提示优先使用它。
- 📣 telegram_notify 推送工具：任何会话的智能体都能**主动**把消息推到你手机（汇报、提醒、通知），不用你发消息。
- 🔀 值守/本地切换：手机发任意消息或 `/away` 进入值守；网页任意会话发消息或 `/back` 回到本地（本地模式审批走网页弹窗）。
- 🚩 值守横幅：值守期间网页顶部显示"审批已转到手机"横幅，一键切回本地（v0.4.0 起加大一档）。
- 📱 侧边栏"值班"按钮：网页左下角 Settings 旁一键打开值班会话（不存在时自动创建/唤醒），并带实时状态点（值守=橙色，本地=灰色）。
- 🗂 持久化：消息游标与值守状态跨重启保持；仅首次运行跳过历史积压。
- 🌐 中英双语：所有手机消息跟随 `language` 配置（`zh` | `en`，默认 `en`）。
- 🌍 直连友好：默认**直连** Telegram；仅当网络封锁 Telegram（如中国大陆）时才需配置 `proxy`。

## 配置（telegram-duty 命名空间）

网页设置页可见可改，也可写在补丁行的 `config:` 下。

| 字段 | 默认 | 说明 |
|------|------|------|
| token | — | 机器人 token（secret，界面不展示）；也可用 credentialsFile 提供 |
| chatId | — | 白名单 chat id |
| proxy | （空） | Bot API 代理地址。**⚠ Telegram 可直连的网络请保持留空（默认直连）；仅当网络封锁 Telegram（如中国大陆）时才填本地代理（如 Clash 的 http://127.0.0.1:7890），并保持代理软件开着** |
| sessionId | telegram-duty | 值班会话 id，首次消息自动创建 |
| dutyCwd | 进程 cwd | 值班会话工作目录 |
| approvalTimeoutMinutes | 10 | 审批超时（分钟），超时按拒绝 |
| watchMode | local | local / duty |
| language | en | 手机消息语言：en / zh |
| dataDir | <DSH_HOME>/storages/telegram-duty | 游标持久化目录 |
| credentialsFile | — | 可选凭据 JSON 文件 {token, chat_id, proxy} |
| replyChunkChars | 3800 | 长回复分段阈值 |

## 手机命令

- `/help` — 使用说明
- `/sessions` — 列出工作区会话（在线 + 离线）带编号按钮，点编号后消息定向到该会话
- `#编号 消息` — 只把这一条消息发给指定会话（编号以最近一次 /sessions 为准，30 分钟有效）
- `/duty` — 回到默认值班会话路由
- `/away` — 进入值守模式（审批转到手机）；若网页还挂着未处理审批会提醒你
- `/unblock` — 取消被审批卡住的回合（之后重发任务即可，审批会正确推到手机）
- `/back` — 回到本地模式
- `3 同意 / 3 拒绝` — 回答第 3 条审批；仅一条待批时直接回"同意/拒绝"；提问点选项按钮或直接回复选项文字。

## 常见问题（FAQ）

- **机器人不回消息？** 按顺序排查：① token、chatId 是否填对；② 是否给机器人发过 `/start`（机器人不能主动发起对话）；③ DSH 日志里有没有 telegram-duty 报错；④ 消息是否被当作命令（`/away` 等不产生回复）。
- **chat id 怎么查？** 给 [@userinfobot](https://t.me/userinfobot) 发任意消息，它会回复你的数字 id。
- **需要代理吗？** 默认不需要，直连 Telegram。国内网络才填 `proxy`（如 Clash 的 `http://127.0.0.1:7890`），并且 DSH 运行期间代理软件要一直开着。
- **空闲时耗 token 吗？** 不耗。插件只做长轮询，消息到达才唤醒智能体。
- **电脑关机还能用吗？** 不能，插件随 DSH 一起运行；但重启不丢消息（游标持久化到磁盘）。
- **手机上能收到什么？** 任务结果（含即时"收到"提示与输入中动画）、任意会话的审批请求（值守模式下）、智能体的提问（telegram_ask）、智能体主动推送的消息（telegram_notify）。
- **为什么 /sessions 没列出我所有会话？** 它只列你**工作区**的会话（和网页侧边栏一致）：空壳草稿隐藏；在线显示空闲/忙碌，离线显示"💤 离线"（首条定向消息自动唤醒）。内部值班会话永不出现——默认路由本来就是它。
- **机器人在群里会回话吗？** 不会，白名单只服务你自己的 chat id，群消息一律忽略。
- **怎么更新插件？** 执行 `dsh plugin --profile web add @luzhengyangtx/dsh-telegram-duty@<版本号>`，或在 profile 的 `package.json` 里改依赖版本。

## 路线图（Roadmap）

| 状态 | 内容 | 版本性质 |
|------|------|---------|
| ✅ 已发布（v0.4.0） | 定向会话（/sessions、#编号、/duty）· 即时收到提示 + 输入中动画 · telegram_notify 主动推送 · /unblock 审批自救 · 侧边栏值班按钮 · 横幅加大 · 中英双语 | 免费 |
| 🚧 计划中（v1.x） | 语音消息笔记、更多实用小功能 | 免费 |
| 🔭 仅预告 | 多平台接入（飞书/WhatsApp 等）、团队/多用户模式、云托管、优先支持 | **专业版（未来）** |

永远免费：Telegram 值班、全局审批转发、值守/本地切换、网页横幅、中英双语。**专业版一行只是预告**，目前没有任何专业版代码——它标记的是未来商业版的方向。

## 定制服务

需要接入帮助、配置指导、接入其它平台或定制功能？发邮件到 **dsh-telegram-duty@outlook.com**。常规接入起步价 **500 元/单**（接入 + 配置 + 答疑），复杂功能按工作量单独报价；开工前会先明确交付范围（跑通 + 文档 + 基础答疑）。

## 社区与支持

- 💬 Telegram 用户群：https://t.me/+w8w7kAnGniRhZTJk
- 💝 Ko-fi 打赏：https://ko-fi.com/luzhengyangtx
- 💝 爱发电打赏：https://afdian.com/a/luzhengyangtx
- ⭐ GitHub 仓库：https://github.com/luzhengyangtx/dsh-telegram-duty

## 开发

```powershell
pnpm --filter "@luzhengyangtx/dsh-telegram-duty" run typecheck
node_modules\.bin\vitest.cmd run packages/interaction/telegram-duty/tests
# 通道自检：$env:TG_CREDS='配置文件路径'; node --import tsx/esm packages/interaction/telegram-duty/scripts/check-telegram.ts
```

## 许可证

MIT。会话驱动模式（resume/create + summarize）参考 [@kriskwok/dsh-feishu-gateway](https://github.com/kriskwok/dsh-feishu-gateway)（MIT），见 LICENSE。
