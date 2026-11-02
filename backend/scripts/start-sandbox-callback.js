import { startSandboxCallback } from '../src/sandboxCallbackServer.js';

startSandboxCallback().catch((error) => {
  console.error('Sandbox callback listener refused or failed:', error.message);
  process.exitCode = 1;
});
