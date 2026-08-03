/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the engine sidecar. Defaults to ws://localhost:4517. */
  readonly VITE_ENGINE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
