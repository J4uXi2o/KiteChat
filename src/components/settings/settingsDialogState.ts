import { create } from 'zustand'
import { hasReadyProvider } from '../../services/providers/store.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'providers' | 'models' | 'prompt' | 'appearance' | 'general' | 'data' | 'about'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'providers' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有可用提供商时打开设置并选中「API 提供商」，返回是否已具备发送条件 */
export const ensureApiKey = () => {
  if (hasReadyProvider()) {
    return true
  }
  openSettings('providers')
  return false
}
