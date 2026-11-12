import { Component, type ReactNode } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

/** Shows an error message when a page crashes, so the user never sees a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // Moving to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box padding="xxl">
        <Alert
          type="error"
          header="This page could not be displayed"
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        >
          {this.state.error.message}
          <Box variant="p" color="inherit">
            <a href="/">Go to Console Home</a>
          </Box>
        </Alert>
      </Box>
    );
  }
}
