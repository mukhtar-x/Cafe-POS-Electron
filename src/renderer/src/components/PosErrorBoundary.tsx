import React from 'react';

interface State { hasError: boolean; }

export class PosErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[POS] Unhandled renderer error:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <main className="flex min-h-screen items-center justify-center bg-[#FDFBF7] dark:bg-slate-950 p-6 text-center text-coffee-800 dark:text-slate-100">
        <section className="max-w-md rounded-3xl border border-cream-200 dark:border-slate-700 bg-white p-8 shadow-warm-sm">
          <h1 className="text-xl font-black">This screen needs to reload</h1>
          <p className="mt-2 text-sm text-coffee-500">Your local records are safe. Restart this screen to continue using the POS.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-11 rounded-xl bg-coffee-700 px-5 font-bold text-white">Reload POS</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}
