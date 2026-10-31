const port = process.env.E2E_PORT ?? "4173";

if (!/^[0-9]+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error("E2E_PORT must be an integer from 1024 to 65535");
}

export const E2E_PORT = Number(port);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
