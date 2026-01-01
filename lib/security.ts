/**
 * Security utilities for the reverse proxy
 * Implements industry-standard security headers and rate limiting
 */

import { LRUCache } from "./lru-cache";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class SecurityManager {
  private rateLimitCache: LRUCache<string, RateLimitEntry>;
  private readonly maxRequestsPerMinute = 60;
  private readonly windowMs = 60_000; // 1 minute

  constructor() {
    this.rateLimitCache = new LRUCache<string, RateLimitEntry>(10000);
  }

  /**
   * Check if request should be rate limited
   */
  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitCache.get(ip);

    if (!entry || now > entry.resetTime) {
      this.rateLimitCache.set(ip, {
        count: 1,
        resetTime: now + this.windowMs,
      });
      return false;
    }

    if (entry.count >= this.maxRequestsPerMinute) {
      return true;
    }

    entry.count++;
    return false;
  }

  /**
   * Add security headers to response
   */
  addSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);

    // Prevent clickjacking
    headers.set("X-Frame-Options", "DENY");
    headers.set("Content-Security-Policy", "frame-ancestors 'none'");

    // XSS protection
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-XSS-Protection", "1; mode=block");

    // HTTPS enforcement (when applicable)
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

    // Referrer policy
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions policy
    headers.set(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
    );

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  /**
   * Extract client IP from request
   */
  getClientIp(request: Request): string {
    // Check X-Forwarded-For header (if behind another proxy)
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }

    // Check X-Real-IP header
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      return realIp;
    }

    // Fallback (Bun doesn't expose socket directly, so this is a placeholder)
    return "unknown";
  }

  /**
   * Validate host header to prevent host header injection
   */
  isValidHost(host: string): boolean {
    // Basic validation: alphanumeric, dots, hyphens only
    const hostRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    return hostRegex.test(host) && host.length <= 253;
  }

  /**
   * Sanitize request URL to prevent SSRF
   */
  isAllowedBackend(backend: string): boolean {
    try {
      const url = new URL(backend);

      // Block private IP ranges and localhost
      const privateRanges = [
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^::1$/,
        /^fc00:/,
        /^fe80:/,
      ];

      const hostname = url.hostname;

      // Allow localhost explicitly (since we use it for local services)
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return true;
      }

      // Block other private IPs
      for (const range of privateRanges) {
        if (range.test(hostname)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
