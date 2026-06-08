import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = (): void => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-3xl">
          <h2 className="text-lg font-bold text-destructive">렌더링 에러</h2>
          <p className="text-sm text-muted-foreground mt-1">
            아래 메시지를 복사해 알려주세요. 사이드바로 돌아갈 수 있도록 [돌아가기]를 누르세요.
          </p>
          <pre className="mt-4 text-xs whitespace-pre-wrap rounded-md border bg-muted/40 p-3 overflow-auto max-h-96">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={this.reset}
            className="mt-3 inline-flex items-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90"
          >
            돌아가기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
