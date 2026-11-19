import { Component, type ReactNode } from 'react'

/** 渲染崩溃兜底：显示重试按钮，避免整页白屏 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--dsw-alias-label-secondary)' }}>
          <p style={{ margin: '0 0 12px' }}>页面渲染出错</p>
          <button
            type="button"
            style={{
              padding: '8px 16px',
              borderRadius: 12,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
            }}
            onClick={() => this.setState({ failed: false })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
