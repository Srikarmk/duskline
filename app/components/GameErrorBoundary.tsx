"use client";

import React from "react";
import { reportError } from "@/src/ui/report";

interface Props {
  children: React.ReactNode;
  onQuit: () => void;
  /** Race context, so a report says WHICH realm and mode died. */
  context?: Record<string, string>;
}
interface State {
  error: Error | null;
}

/**
 * Catches anything the 3D engine throws and shows a way out.
 *
 * Without this, a failure inside Game — a model that will not parse, a WebGL
 * context lost on a laptop switching GPUs, an out-of-memory on a weak card —
 * leaves a black canvas and a frozen page. React unmounts the subtree on an
 * error and renders nothing, so the player is left with no signal and no
 * route back to the menu. That is the single worst thing that can happen on a
 * public launch, because it looks like the whole site is broken.
 *
 * Errors thrown from inside requestAnimationFrame do NOT reach this — React
 * only catches errors during render/lifecycle. The window-level handler in
 * GameCanvas covers that case.
 */
export default class GameErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, {
      source: "boundary",
      tags: this.props.context,
      extra: { componentStack: info.componentStack },
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal">
        <h2>The race stopped.</h2>
        <p>
          Something in the 3D engine failed. This is a bug, not something you
          did — the details are in the browser console if you want to send them
          on.
        </p>
        <pre className="fatal-detail">{String(this.state.error.message || this.state.error)}</pre>
        <div className="fatal-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>
            ▸ TRY AGAIN
          </button>
          <button type="button" className="ghost" onClick={this.props.onQuit}>
            ◂ BACK TO MENU
          </button>
        </div>
      </div>
    );
  }
}
