/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fixed at build time from the hosting platform (vite.config.ts): production, preview, development or local. */
  readonly VITE_DEPLOYMENT_ENVIRONMENT?: string;
}
