/**
 * User-facing string table for the Telegram channel. Every text the user can
 * see on their phone lives here; `language` selects the table ('zh' | 'en').
 * @module @luzhengyangtx/dsh-telegram-duty/i18n
 */

export type PluginLanguage = 'zh' | 'en'

export interface Strings {
  dutyOn: string
  dutyOff: string
  alreadyDuty: string
  alreadyLocal: string
  help: string
  dutyPersona: string
  approvalQuestion: (id: number, toolName: string, reason: string, minutes: number) => string
  approvalTimeout: (id: number, minutes: number) => string
  approvalAccepted: (id: number) => string
  approvalRejected: (id: number) => string
  approvalUnknown: (id: number) => string
  approvalAmbiguous: (count: number, first: number) => string
  dutyError: (error: string) => string
  dutyEmpty: string
}

const zh: Strings = {
  dutyOn: '🔔 已进入值守模式：审批将转发到手机，网页弹窗暂停。回复 /back 或回电脑后在网页发条消息即可切回。',
  dutyOff: '🖥 已回到本地模式：审批恢复网页弹窗。',
  alreadyDuty: '🔔 已在值守模式中。',
  alreadyLocal: '🖥 当前就是本地模式，审批在网页弹窗。',
  help: [
    '🤖 DSH 值班机器人',
    '',
    '· 直接发消息 → 值班智能体开始干活，完成后回复你',
    '· /away → 进入值守模式（审批转到手机）',
    '· /back → 回到本地模式（审批恢复网页弹窗）',
    '· 发消息即自动进入值守；回电脑在网页发条消息即自动切回本地',
    '· 审批回复格式：3 同意 / 3 拒绝',
  ].join('\n'),
  approvalQuestion: (id, toolName, reason, minutes) =>
    `【审批 #${id}】工具「${toolName}」请求批准${reason !== '' ? `：${reason}` : ''}\n回复 ${id} 同意 / ${id} 拒绝（${minutes} 分钟内有效）`,
  approvalTimeout: (id, minutes) => `【审批 #${id}】已超时（${minutes} 分钟），按拒绝处理。`,
  approvalAccepted: (id) => `【审批 #${id}】✅ 已同意。`,
  approvalRejected: (id) => `【审批 #${id}】⛔ 已拒绝。`,
  approvalUnknown: (id) => `【审批 #${id}】不存在或已超时。`,
  approvalAmbiguous: (count, first) => `有 ${count} 条审批待处理，请带编号回复，例如：${first} 同意`,
  dutyError: (error) => `😵 值班会话处理失败：${error}`,
  dutyEmpty: '😶 值班会话没有返回内容，请再试一次。',
  dutyPersona: [
    '你是用户的 Telegram 值班助手，通过手机消息与用户联系。',
    '要求：用简体中文回复，简洁务实；回答前先查看相关项目的进度文件（如工作区下的 task_plan.md、progress.md、HANDOFF.md、CLAUDE.md）再作答；',
    '执行任务时遵循工作区 CLAUDE.md 的用户规则；',
    '拿不准意图先问清楚再动手；重要操作完成后简短汇报结果。',
  ].join(''),
}

const en: Strings = {
  dutyOn: '🔔 Duty mode on: approvals are forwarded to your phone and web popups are paused. Reply /back or send a message in the web UI to switch back.',
  dutyOff: '🖥 Local mode: approvals show in the web UI again.',
  alreadyDuty: '🔔 Already in duty mode.',
  alreadyLocal: '🖥 Already in local mode; approvals appear in the web UI.',
  help: [
    '🤖 DSH Duty Bot',
    '',
    '· Send a message → the duty agent works on it and replies',
    '· /away → enter duty mode (approvals go to your phone)',
    '· /back → return to local mode (approvals stay in the web UI)',
    '· Any phone message switches to duty automatically; any web message switches back',
    '· Approval replies: 3 approve / 3 reject',
  ].join('\n'),
  approvalQuestion: (id, toolName, reason, minutes) =>
    `[Approval #${id}] Tool "${toolName}" requests approval${reason !== '' ? `: ${reason}` : ''}\nReply ${id} approve / ${id} reject (valid ${minutes} min)`,
  approvalTimeout: (id, minutes) => `[Approval #${id}] timed out (${minutes} min), treated as rejected.`,
  approvalAccepted: (id) => `[Approval #${id}] ✅ approved.`,
  approvalRejected: (id) => `[Approval #${id}] ⛔ rejected.`,
  approvalUnknown: (id) => `[Approval #${id}] does not exist or has timed out.`,
  approvalAmbiguous: (count, first) => `${count} approvals are pending; include the number, e.g. ${first} approve`,
  dutyError: (error) => `😵 Duty session failed: ${error}`,
  dutyEmpty: '😶 The duty session returned no content, please try again.',
  dutyPersona: [
    'You are the user\'s Telegram duty assistant, reached through phone messages.',
    'Reply in the user\'s language, concisely and practically; before answering, inspect the relevant project progress files (task_plan.md, progress.md, HANDOFF.md, CLAUDE.md) in the workspace;',
    'follow the workspace CLAUDE.md user rules when acting;',
    'when unsure of intent, ask before acting; briefly report after important work completes.',
  ].join(' '),
}

/** Resolve the message table for one language. */
export function stringsFor(language: PluginLanguage): Strings {
  return language === 'zh' ? zh : en
}
