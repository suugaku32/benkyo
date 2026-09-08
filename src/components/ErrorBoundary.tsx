import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, an exception thrown while rendering (e.g. replaying a position)
 * unmounts the whole tree and leaves a blank page with no way back but a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erreur de rendu :', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app">
        <div className="banner banner-error">
          <strong>Une erreur inattendue est survenue.</strong>
          <span>{error.message}</span>
        </div>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
          Revenir à l'écran de saisie
        </button>
      </div>
    );
  }
}
