import type { Server } from "bun";
import { Config } from "./config";
import { Stats } from "./stats";
import { SecurityManager } from "./security";
import { Logger } from "./logger";
import { CertbotManager } from "./certbot";
import { CircuitBreakerRegistry } from "./circuit-breaker";
import { HealthChecker } from "./health-check";
import { existsSync } from "fs";
import { join } from "path";

export class ReverseProxy {
  private config: Config;
  private stats: Stats;
  private security: SecurityManager;
  private logger: Logger;
  private certbot: CertbotManager;
  private circuitBreakers: CircuitBreakerRegistry;
  private healthChecker: HealthChecker;
  private httpServer?: Server;
  private httpsServer?: Server;
  private statsServer?: Server;

  constructor() {
    this.config = Config.getInstance();
    this.stats = Stats.getInstance();
    this.security = new SecurityManager();
    this.logger = Logger.getInstance();
    this.certbot = new CertbotManager();
    this.circuitBreakers = CircuitBreakerRegistry.getInstance();
    this.healthChecker = HealthChecker.getInstance();
  }

  private extractHost(request: Request): string {
    const hostHeader = request.headers.get("host") || "";
    return hostHeader.split(":")[0];
  }

  /**
   * Proxy request with circuit breaker, retry logic, and health checks
   * Senior engineer implementation with reliability features
   */
  private async proxyRequest(
    request: Request,
    backend: string,
    retryCount = 0
  ): Promise<Response> {
    const maxRetries = 2;
    const breaker = this.circuitBreakers.get(backend);

    try {
      // Execute through circuit breaker
      const response = await breaker.execute(async () => {
        return await this.executeProxyRequest(request, backend);
      });

      return response;
    } catch (error) {
      // Mark backend as unhealthy on error
      this.healthChecker.markUnhealthy(
        backend,
        error instanceof Error ? error.message : String(error)
      );

      // Retry logic for transient failures
      if (retryCount < maxRetries) {
        this.logger.warn("Retrying request", {
          backend,
          attempt: retryCount + 1,
          maxRetries,
        });

        // Exponential backoff: 100ms, 200ms
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, retryCount))
        );

        return this.proxyRequest(request, backend, retryCount + 1);
      }

      this.logger.error("Proxy error after retries", {
        error: error instanceof Error ? error.message : String(error),
        backend,
        retries: retryCount,
      });

      return new Response("Bad Gateway - Service Unavailable", { status: 502 });
    }
  }

  /**
   * Execute actual proxy request
   */
  private async executeProxyRequest(
    request: Request,
    backend: string
  ): Promise<Response> {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, backend);

    // Build forwarding headers
    const headers = new Headers(request.headers);
    const clientIp = this.security.getClientIp(request);

    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    headers.set("X-Forwarded-For", clientIp);
    headers.set("X-Real-IP", clientIp);

    // Remove hop-by-hop headers (RFC 2616)
    const hopByHopHeaders = [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ];

    hopByHopHeaders.forEach((header) => headers.delete(header));

    this.logger.debug("Proxying request", {
      host: url.host,
      backend: targetUrl.toString(),
      method: request.method,
    });

    // Forward with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers,
        body: request.body,
        signal: controller.signal,
        // @ts-ignore - Bun supports duplex
        duplex: "half",
      });

      clearTimeout(timeout);

      // Check for backend errors
      if (response.status >= 500) {
        throw new Error(`Backend error: ${response.status}`);
      }

      return this.security.addSecurityHeaders(response);
    } catch (fetchError) {
      clearTimeout(timeout);
      throw fetchError;
    }
  }

  /**
   * Handle ACME HTTP-01 challenge for Let's Encrypt
   * Serves challenges from /.well-known/acme-challenge/ directory
   */
  private async handleAcmeChallenge(request: Request): Promise<Response | null> {
    const url = new URL(request.url);

    // Check if this is an ACME challenge request
    if (!url.pathname.startsWith("/.well-known/acme-challenge/")) {
      return null;
    }

    const challengeDir = this.certbot.getAcmeChallengeDir();
    const challengePath = join(
      challengeDir,
      ".well-known/acme-challenge",
      url.pathname.replace("/.well-known/acme-challenge/", "")
    );

    this.logger.debug("ACME challenge request", { path: challengePath });

    // Serve the challenge file
    if (existsSync(challengePath)) {
      const file = Bun.file(challengePath);
      const content = await file.text();

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    this.logger.warn("ACME challenge file not found", { path: challengePath });
    return new Response("Not Found", { status: 404 });
  }

  private async handleRequest(request: Request): Promise<Response> {
    this.stats.incrementTotal();

    // Handle ACME challenge first (highest priority for zero-downtime cert issuance)
    const acmeResponse = await this.handleAcmeChallenge(request);
    if (acmeResponse) {
      this.stats.incrementSuccess();
      return acmeResponse;
    }

    const host = this.extractHost(request);

    // Validate host header to prevent host header injection
    if (!this.security.isValidHost(host)) {
      this.stats.incrementFailed();
      this.logger.warn("Invalid host header", { host });
      return new Response("Bad Request", { status: 400 });
    }

    // Rate limiting
    const clientIp = this.security.getClientIp(request);
    if (this.security.isRateLimited(clientIp)) {
      this.stats.incrementFailed();
      this.logger.warn("Rate limit exceeded", { ip: clientIp, host });
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }

    // Get backend
    const backend = this.config.getBackend(host);
    if (!backend) {
      this.stats.incrementFailed();
      this.stats.incrementHost(host, false);
      this.logger.warn("No backend configured", { host });
      return new Response(`No backend configured for host: ${host}`, {
        status: 502,
      });
    }

    try {
      const response = await this.proxyRequest(request, backend);

      if (response.ok) {
        this.stats.incrementSuccess();
        this.stats.incrementHost(host, true);
      } else {
        this.stats.incrementFailed();
        this.stats.incrementHost(host, false);
      }

      return response;
    } catch (error) {
      this.stats.incrementFailed();
      this.stats.incrementHost(host, false);
      this.logger.error("Request handling error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  async start(): Promise<void> {
    this.logger.info("Starting rproxy server");

    // Start health checking for all configured backends
    const routes = this.config.getAllRoutes();
    for (const route of routes) {
      this.healthChecker.startChecking(route.backend);
      this.logger.debug("Started health checks", { backend: route.backend });
    }

    // HTTP server on port 80
    this.httpServer = Bun.serve({
      port: 80,
      fetch: async (request) => {
        return this.handleRequest(request);
      },
      error: (error) => {
        this.logger.error("HTTP Server error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    this.logger.info(`HTTP server listening on port ${this.httpServer.port}`);

    // HTTPS server on port 443 (if certificates exist)
    try {
      const keyPath = "/var/lib/rproxy/certs/privkey.pem";
      const certPath = "/var/lib/rproxy/certs/fullchain.pem";

      const keyFile = Bun.file(keyPath);
      const certFile = Bun.file(certPath);

      if ((await keyFile.exists()) && (await certFile.exists())) {
        this.httpsServer = Bun.serve({
          port: 443,
          fetch: async (request) => {
            return this.handleRequest(request);
          },
          tls: {
            key: keyFile,
            cert: certFile,
          },
          error: (error) => {
            this.logger.error("HTTPS Server error", {
              error: error instanceof Error ? error.message : String(error),
            });
            return new Response("Internal Server Error", { status: 500 });
          },
        });

        this.logger.info(`HTTPS server listening on port ${this.httpsServer.port}`);
      } else {
        this.logger.warn("HTTPS certificates not found, running in HTTP-only mode");
        this.logger.info("Run certbot to obtain certificates for HTTPS support");
      }
    } catch (error) {
      this.logger.warn("HTTPS server not started", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Stats API (localhost:9090)
    this.statsServer = Bun.serve({
      port: 9090,
      hostname: "localhost",
      fetch: (request) => {
        const url = new URL(request.url);

        if (url.pathname === "/internal/stats") {
          return Response.json(this.stats.getStats());
        }

        if (url.pathname === "/internal/health") {
          return Response.json({
            status: "ok",
            uptime: process.uptime(),
            memory: process.memoryUsage(),
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    this.logger.info(`Stats API listening on localhost:${this.statsServer.port}`);
  }

  async stop(): Promise<void> {
    this.logger.info("Shutting down gracefully");

    // Stop health checking
    this.healthChecker.stopAll();

    const shutdownPromises: Promise<void>[] = [];

    if (this.httpServer) {
      shutdownPromises.push(
        new Promise((resolve) => {
          this.httpServer!.stop();
          resolve();
        })
      );
    }

    if (this.httpsServer) {
      shutdownPromises.push(
        new Promise((resolve) => {
          this.httpsServer!.stop();
          resolve();
        })
      );
    }

    if (this.statsServer) {
      shutdownPromises.push(
        new Promise((resolve) => {
          this.statsServer!.stop();
          resolve();
        })
      );
    }

    await Promise.all(shutdownPromises);
    this.config.close();
    this.logger.info("Shutdown complete");
  }

  reload(): void {
    this.logger.info("Configuration reloaded");

    // Update health checks for new/removed backends
    const routes = this.config.getAllRoutes();
    const currentBackends = new Set(routes.map((r) => r.backend));

    // Start health checks for new backends
    for (const route of routes) {
      this.healthChecker.startChecking(route.backend);
    }

    // Stop health checks for removed backends
    const allStatuses = this.healthChecker.getAllStatuses();
    for (const backend of allStatuses.keys()) {
      if (!currentBackends.has(backend)) {
        this.healthChecker.stopChecking(backend);
      }
    }

    this.logger.info("Health checks updated");
  }
}
