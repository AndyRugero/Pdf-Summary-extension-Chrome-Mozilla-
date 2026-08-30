import { StrictMode, Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Dashboard Error Caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 max-w-md w-full shadow-lg text-center space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Dashboard Recovery</h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              A session state notice occurred. Click below to clear stored caches and reload your dashboard.
            </p>
            <p className="text-[10px] text-red-500 font-mono bg-red-50 p-2.5 rounded-lg text-left break-all max-h-32 overflow-y-auto">
              {String(this.state.error?.message || this.state.error)}
            </p>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.href = window.location.pathname;
              }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Reset Session & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App title="Dashboard View" />
    </ErrorBoundary>
  </StrictMode>,
);
