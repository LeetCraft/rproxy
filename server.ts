#!/usr/bin/env bun

/**
 * rproxy server entry point
 * Starts the reverse proxy with signal handling
 */

import { ReverseProxy } from "./lib/proxy";

const proxy = new ReverseProxy();

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await proxy.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await proxy.stop();
  process.exit(0);
});

// Handle config reload
process.on("SIGHUP", () => {
  proxy.reload();
});

// Start the server
await proxy.start();
