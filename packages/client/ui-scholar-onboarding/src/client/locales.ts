/** Copy dictionaries for Scholar mode Token onboarding. */

/** English strings. */
export const en = {
  title: 'Connect Scholar mode',
  description: 'Enter the Scholar Token issued by your Proxy Hub administrator. DSH validates it before saving it as a Managed Credential.',
  tokenLabel: 'Scholar Token',
  tokenPlaceholder: 'Paste your Token',
  save: 'Validate and save',
  saving: 'Validating…',
  later: 'Not now',
  required: 'Enter a Token to continue.',
  invalid: 'This Token is invalid, revoked, or not authorized.',
  unavailable: 'Proxy Hub is unavailable. The Managed Credential was not changed; retry when the service recovers.',
  malformed: 'Proxy Hub returned an invalid identity response. The Managed Credential was not changed.',
  saveFailed: 'DSH could not save the Managed Credential.',
  insecure: 'Development transport: HTTP sends the Token and research requests in plaintext. Use only a revocable test Token.',
}

/** Scholar onboarding translation key. */
export type ScholarOnboardingKey = keyof typeof en

/** Chinese strings. */
export const zh: { [Key in ScholarOnboardingKey]: string } = {
  title: '连接学者模式',
  description: '输入 Proxy Hub 管理员签发的 Scholar Token。DSH 会先验证，再将其保存为 Managed Credential。',
  tokenLabel: 'Scholar Token',
  tokenPlaceholder: '粘贴 Token',
  save: '验证并保存',
  saving: '正在验证…',
  later: '暂不设置',
  required: '请输入 Token。',
  invalid: 'Token 无效、已撤销或没有权限。',
  unavailable: 'Proxy Hub 暂时不可用。Managed Credential 未修改，请在服务恢复后重试。',
  malformed: 'Proxy Hub 返回了无效的身份响应。Managed Credential 未修改。',
  saveFailed: 'DSH 无法保存 Managed Credential。',
  insecure: '开发传输：HTTP 会明文发送 Token 和研究请求。请只使用可撤销的测试 Token。',
}
