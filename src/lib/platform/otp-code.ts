export const authCodeLength = 8
export const authCodePattern = `[0-9]{${authCodeLength}}`
export const authCodeRegex = new RegExp(`^${authCodePattern}$`)
