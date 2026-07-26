/**
 * Typed bridge to the VS Code webview host.
 *
 * `acquireVsCodeApi` may only be called once per webview, so the handle
 * is captured here at module load and shared. When the bundle is loaded
 * outside VS Code (isolated webview dev) the API is absent and messages
 * are no-ops.
 */
import type { InboundMessage, OutboundMessage } from "../../src/diagram/protocol";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi | null = typeof acquireVsCodeApi === "function"
  ? acquireVsCodeApi()
  : null;

/** Send a typed message to the extension host. */
export function postMessage(message: OutboundMessage): void {
  api?.postMessage(message);
}

/** UI preferences persisted across webview reloads (Phase 4). */
export interface PersistedUiState {
  readonly density?: "comfortable" | "compact";
}

/** Read the persisted UI state (empty outside VS Code). */
export function getPersistedState(): PersistedUiState {
  const state = api?.getState();
  return typeof state === "object" && state !== null ? (state as PersistedUiState) : {};
}

/** Merge and persist UI state. */
export function persistState(patch: PersistedUiState): void {
  api?.setState({ ...getPersistedState(), ...patch });
}

/**
 * Subscribe to typed messages from the extension host. Returns an
 * unsubscribe function.
 */
export function onMessage(handler: (message: InboundMessage) => void): () => void {
  const listener = (event: MessageEvent): void => {
    handler(event.data as InboundMessage);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
