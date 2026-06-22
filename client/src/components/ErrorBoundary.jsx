import React from "react";

// Catches render-time errors anywhere in the tree and shows a recoverable
// fallback instead of an unrecoverable white screen.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // In production this is where you'd forward to Sentry/Datadog/etc.
    console.error("Unhandled UI error:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="glass-panel rounded-3xl p-8 max-w-md text-center animate-slide-up">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-danger/15 border border-danger/30 flex items-center justify-center text-2xl">
            !
          </div>
          <h1 className="mt-4 text-xl font-semibold text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-white/70">
            An unexpected error interrupted quickCHAT. Reloading usually fixes
            it and your conversations are safe.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="btn-gradient mt-6 rounded-xl px-6 py-3 text-sm font-medium"
          >
            Reload quickCHAT
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
