import type { Server } from "bun";
import { Config } from "./config";
import { Stats } from "./stats";
import { SecurityManager } from "./security";
import { Logger } from "./logger";

export class ReverseProxy {
  private config: Config;
  private stats: Stats;
  private security: SecurityManager;
  private logger: Logger;
  private httpServer?: Server;
  private httpsServer?: Server;
  private statsServer?: Server;

  constructor() {
    this.config = Config.getInstance();
    this.stats = Stats.getInstance();
    this.security = new SecurityManager();
    this.logger = Logger.getInstance();
  }

  private extractHost(request: Request): string {
    const hostHeader = request.headers.get("host") || "";
    return hostHeader.split(":")[0];
  }

  private async proxyRequest(request: Request, backend: string): Promise<Response> {
    try {
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
        return this.security.addSecurityHeaders(response);
      } catch (fetchError) {
        clearTimeout(timeout);
        throw fetchError;
      }
    } catch (error) {
      this.logger.error("Proxy error", {
        error: error instanceof Error ? error.message : String(error),
        backend,
      });
      return new Response("Bad Gateway", { status: 502 });
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    this.stats.incrementTotal();

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

    // HTTP server on port 80
    this.httpServer = Bun.serve({
      port: 80,
      async fetch(request) {
        return this.handleRequest(request);
      }.bind(this),
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
          async fetch(request) {
            return this.handleRequest(request);
          }.bind(this),
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
    // SQLite-backed config is always up-to-date
  }
}
