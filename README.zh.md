# dsh-telegram-duty（中文说明）

把 DeepSeek Harness（DSH）变成随身值班室：手机 Telegram 发消息 → 值班智能体干活 → 结果回复到手机。空闲时零 token（长轮询 `getUpdates`，消息到达才唤醒智能体）。

[English](README.md)

## 功能

- 📱 任务闭环：Telegram 消息 → 专属"值班会话"（带标准工具集）→ 最终回复回传手机；长回复自动分段。
- 🔐 白名单：只服务你自己的 chat id，其他人仅记日志。
- ✅ 全局审批转发：值守模式下，**所有会话**的审批都发到手机（带编号），回复 `3 同意 / 3 拒绝`；超时（默认 10 分钟）按拒绝处理（保守安全）。
- 🔀 值守/本地切换：手机发任意消息或 `/away` 进入值守；网页任意会话发消息或 `/back` 回到本地（本地模式审批走网页弹窗）。
- 🗂 持久化：消息游标与值守状态跨重启保持；仅首次运行跳过历史积压。
- 🌐 中英双语：所有手机消息跟随 `language` 配置（`zh` | `en`，默认 `en`）。

## 安装要点

1. 把本包放入 DSH checkout 的 `packages/interaction/telegram-duty`，`pnpm install` 后构建：
   ```powershell
   node_modules\.bin\tsc.cmd -b packages/interaction/telegram-duty/tsconfig.json
   ```
2. 在 profile 补丁（如 `C:\Users\<你>\.dsh\profiles\web\cordis.patch.yml`）挂载：
   ```yaml
   - insert:
       - id: telegram-duty
         name: '@luzhengyangtx/dsh-telegram-duty'
         config:
           token: '123456:你的机器人token'   # 或用 credentialsFile 指向 {token, chat_id, proxy} 文件
           chatId: 123456789
           language: zh
   ```
3. 重启 `pnpm dsh web`。

## 配置（telegram-duty 命名空间）

| 字段 | 默认 | 说明 |
|------|------|------|
| token | — | 机器人 token（secret，界面不展示）；也可用 credentialsFile 提供 |
| chatId | — | 白名单 chat id |
| proxy | http://127.0.0.1:7890 | Bot API 代理（留空直连） |
| sessionId | telegram-duty | 值班会话 id，首次消息自动创建 |
| dutyCwd | 进程 cwd | 值班会话工作目录 |
| approvalTimeoutMinutes | 10 | 审批超时（分钟），超时按拒绝 |
| watchMode | local | local / duty |
| language | en | 手机消息语言：en / zh |
| dataDir | <DSH_HOME>/storages/telegram-duty | 游标持久化目录 |
| credentialsFile | — | 可选凭据 JSON 文件 {token, chat_id, proxy} |
| replyChunkChars | 3800 | 长回复分段阈值 |

## 手机命令

`/help`、`/away`、`/back`；审批回复 `3 同意 / 3 拒绝`（仅一条待批时直接回"同意/拒绝"）。

## 开发

```powershell
pnpm --filter "@luzhengyangtx/dsh-telegram-duty" run typecheck
node_modules\.bin\vitest.cmd run packages/interaction/telegram-duty/tests
# 通道自检：$env:TG_CREDS='配置文件路径'; node --import tsx/esm packages/interaction/telegram-duty/scripts/check-telegram.ts
```

## 许可证

MIT。会话驱动模式（resume/create + summarize）参考 [@kriskwok/dsh-feishu-gateway](https://github.com/kriskwok/dsh-feishu-gateway)（MIT），见 LICENSE。
