#!/usr/bin/env bun

/**
 * rproxy CLI
 * Command-line interface for managing reverse proxy routes
 */

import { Config } from "./lib/config";
import { certCommand } from "./cmd/cert";
import { updateCommand } from "./cmd/update";

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`rproxy - A fast reverse proxy with automatic HTTPS

Usage:
  rproxy <command> [options]

Commands:
  add <backend> <host>           Add a reverse proxy route
  rm <host>                      Remove a route
  list                           List all routes
  stats                          Show statistics
  cert <subcommand>              Certificate management
  update                         Check for updates
  save                           Save configuration
  serve                          Start the proxy server
  help                           Show this help

Certificate Commands:
  cert install                   Install certbot (automatic)
  cert issue <domain>            Issue HTTPS certificate (zero-downtime)
  cert list                      List all certificates
  cert renew                     Renew certificates
  cert auto-renew                Setup automatic renewal

Examples:
  # Route management
  rproxy add 127.0.0.1:3000 mysite.com
  rproxy add localhost:8080 api.example.com
  rproxy rm mysite.com
  rproxy list

  # Certificate management
  rproxy cert install
  rproxy cert issue mysite.com
  rproxy cert list

  # Statistics
  rproxy stats
`);
}

async function addRoute(backend: string, host: string) {
  if (!backend || !host) {
    console.error("Error: Both backend and host are required");
    console.log("Usage: rproxy add <backend> <host>");
    process.exit(1);
  }

  // Normalize backend URL
  let normalizedBackend = backend;
  if (!backend.startsWith("http://") && !backend.startsWith("https://")) {
    normalizedBackend = `http://${backend}`;
  }

  const config = Config.getInstance();
  config.addRoute(host, normalizedBackend);

  console.log(`✓ Route added: ${host} -> ${normalizedBackend}`);
  console.log("\nTo apply changes:");
  console.log("  sudo systemctl reload rproxy");
  console.log("Or if running directly:");
  console.log("  pkill -HUP -f 'bun.*server.ts'");
}

async function removeRoute(host: string) {
  if (!host) {
    console.error("Error: Host is required");
    console.log("Usage: rproxy rm <host>");
    process.exit(1);
  }

  const config = Config.getInstance();
  const removed = config.removeRoute(host);

  if (removed) {
    console.log(`✓ Route removed: ${host}`);
    console.log("\nTo apply changes:");
    console.log("  sudo systemctl reload rproxy");
  } else {
    console.error(`Error: Route not found: ${host}`);
    process.exit(1);
  }
}

async function listRoutes() {
  const config = Config.getInstance();
  const routes = config.getAllRoutes();

  if (routes.length === 0) {
    console.log("No routes configured.");
    return;
  }

  console.log("Configured Routes:");
  console.log("==================");
  routes.forEach((route) => {
    console.log(`  ${route.host} -> ${route.backend}`);
  });
  console.log(`\nTotal: ${routes.length} route(s)`);
}

async function showStats() {
  try {
    const response = await fetch("http://localhost:9090/internal/stats");

    if (!response.ok) {
      throw new Error("Failed to fetch stats");
    }

    const stats = await response.json();

    console.log("Reverse Proxy Statistics");
    console.log("========================");
    console.log(`Total Requests:   ${stats.totalRequests}`);
    console.log(`Success:          ${stats.successRequests}`);
    console.log(`Failed:           ${stats.failedRequests}`);

    const hostStats = stats.hostStats;
    if (hostStats && Object.keys(hostStats).length > 0) {
      console.log("\nPer-Host Statistics:");
      console.log("--------------------");
      for (const [host, data] of Object.entries(hostStats)) {
        const s = data as any;
        console.log(`  ${host}:`);
        console.log(`    Requests: ${s.requests}`);
        console.log(`    Success:  ${s.success}`);
        console.log(`    Failed:   ${s.failed}`);
      }
    }
  } catch (error) {
    console.error("Error: Unable to connect to rproxy service. Is it running?");
    console.log("Start the service with: sudo systemctl start rproxy");
    process.exit(1);
  }
}

async function saveConfig() {
  console.log("✓ Configuration is automatically saved");
  console.log("(using SQLite, no manual save needed)");
}

async function serve() {
  // Import and start server
  await import("./server");
}

// Route commands
switch (command) {
  case "add":
    await addRoute(args[1], args[2]);
    break;

  case "rm":
  case "remove":
    await removeRoute(args[1]);
    break;

  case "list":
  case "ls":
    await listRoutes();
    break;

  case "stats":
  case "status":
    await showStats();
    break;

  case "save":
    await saveConfig();
    break;

  case "serve":
  case "start":
    await serve();
    break;

  case "cert":
  case "certificate":
  case "ssl":
  case "https":
    await certCommand(args.slice(1));
    break;

  case "update":
  case "upgrade":
    await updateCommand();
    break;

  case "help":
  case "--help":
  case "-h":
    printUsage();
    break;

  default:
    if (!command) {
      printUsage();
    } else {
      console.error(`Unknown command: ${command}`);
      console.log("Run 'rproxy help' for usage information");
      process.exit(1);
    }
}
