import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PublicStorefront from './PublicStorefront.jsx'

const pathname = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '/'
const RootComponent = pathname.startsWith('/store') ? PublicStorefront : App

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra lỗi render không mong muốn.',
    }
  }

  componentDidCatch(error, info) {
    console.error('Root render crashed', error, info)
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-4 text-slate-100"
          style={{ backgroundColor: '#0f172a' }}
        >
          <div className="w-full max-w-xl rounded-3xl border border-red-500/30 bg-slate-900/90 p-8 shadow-2xl">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-red-300">
              Lỗi giao diện
            </div>
            <h1 className="mt-3 text-3xl font-black text-white">
              Trang vừa bị lỗi render
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              App đã chặn lỗi để không hiện màn hình trắng. Bạn thử tải lại trang.
              Nếu lỗi còn lặp lại, hãy gửi lại ảnh chụp màn hình này cho mình.
            </p>
            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-300 break-all">
              {this.state.message || 'Không có thông điệp lỗi chi tiết.'}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-2xl bg-cyan-600 px-5 py-3 font-bold text-white hover:bg-cyan-500 transition-colors"
              >
                Tải lại trang
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <RootComponent />
    </RootErrorBoundary>
  </StrictMode>,
)
