/**
 * Backend health checking system
 * Proactively monitors backend health to detect failures early
 */

import { Logger } from "./logger";
import { CircuitBreakerRegistry } from "./circuit-breaker";

interface HealthStatus {
  healthy: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  responseTime?: number;
  error?: string;
}

export class HealthChecker {
  private static instance: HealthChecker;
  private healthStatus = new Map<string, HealthStatus>();
  private checkIntervals = new Map<string, Timer>();
  private logger: Logger;
  private circuitBreakers: CircuitBreakerRegistry;

  private readonly checkInterval = 30000; // 30 seconds
  private readonly timeout = 5000; // 5 seconds
  private readonly failureThreshold = 3;

  private constructor() {
    this.logger = Logger.getInstance();
    this.circuitBreakers = CircuitBreakerRegistry.getInstance();
  }

  static getInstance(): HealthChecker {
    if (!HealthChecker.instance) {
      HealthChecker.instance = new HealthChecker();
    }
    return HealthChecker.instance;
  }

  /**
   * Start health checking for a backend
   */
  startChecking(backend: string): void {
    // Don't start duplicate checks
    if (this.checkIntervals.has(backend)) {
      return;
    }

    this.logger.debug("Starting health checks", { backend });

    // Initialize status
    this.healthStatus.set(backend, {
      healthy: true,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    });

    // Perform immediate check
    this.checkHealth(backend);

    // Schedule periodic checks
    const interval = setInterval(() => {
      this.checkHealth(backend);
    }, this.checkInterval);

    this.checkIntervals.set(backend, interval);
  }

  /**
   * Stop health checking for a backend
   */
  stopChecking(backend: string): void {
    const interval = this.checkIntervals.get(backend);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(backend);
    }

    this.healthStatus.delete(backend);
    this.logger.debug("Stopped health checks", { backend });
  }

  /**
   * Perform health check on backend
   */
  private async checkHealth(backend: string): Promise<void> {
    const startTime = Date.now();

    try {
      const url = new URL(backend);
      const healthUrl = new URL("/health", backend);

      // Try health endpoint first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "User-Agent": "rproxy-health-check",
          },
        });

        clearTimeout(timeoutId);

        const responseTime = Date.now() - startTime;

        // Consider 2xx, 3xx, and 404 as healthy (404 = no health endpoint, but server responding)
        const healthy = response.status < 500 || response.status === 404;

        this.recordResult(backend, healthy, responseTime);
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // If /health fails, try root path as fallback
        const fallbackController = new AbortController();
        const fallbackTimeout = setTimeout(
          () => fallbackController.abort(),
          this.timeout
        );

        try {
          const fallbackResponse = await fetch(url, {
            method: "HEAD",
            signal: fallbackController.signal,
            headers: {
              "User-Agent": "rproxy-health-check",
            },
          });

          clearTimeout(fallbackTimeout);

          const responseTime = Date.now() - startTime;
          const healthy = fallbackResponse.status < 500;

          this.recordResult(backend, healthy, responseTime);
        } catch {
          clearTimeout(fallbackTimeout);
          throw fetchError; // Use original error
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.recordResult(backend, false, undefined, errorMessage);
    }
  }

  /**
   * Record health check result
   */
  private recordResult(
    backend: string,
    healthy: boolean,
    responseTime?: number,
    error?: string
  ): void {
    const status = this.healthStatus.get(backend) || {
      healthy: true,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };

    status.lastCheck = new Date();
    status.responseTime = responseTime;
    status.error = error;

    if (healthy) {
      status.consecutiveSuccesses++;
      status.consecutiveFailures = 0;

      // Transition to healthy if it was unhealthy
      if (!status.healthy) {
        status.healthy = true;
        this.logger.info("Backend recovered", {
          backend,
          responseTime,
          consecutiveSuccesses: status.consecutiveSuccesses,
        });
      }
    } else {
      status.consecutiveFailures++;
      status.consecutiveSuccesses = 0;

      // Transition to unhealthy if threshold exceeded
      if (
        status.healthy &&
        status.consecutiveFailures >= this.failureThreshold
      ) {
        status.healthy = false;
        this.logger.warn("Backend unhealthy", {
          backend,
          error,
          consecutiveFailures: status.consecutiveFailures,
        });

        // Open circuit breaker for this backend
        const breaker = this.circuitBreakers.get(backend);
        breaker.getStats(); // This will trigger the circuit logic on next request
      } else if (!status.healthy) {
        this.logger.debug("Backend still unhealthy", {
          backend,
          error,
          consecutiveFailures: status.consecutiveFailures,
        });
      }
    }

    this.healthStatus.set(backend, status);
  }

  /**
   * Get health status for a backend
   */
  getStatus(backend: string): HealthStatus | undefined {
    return this.healthStatus.get(backend);
  }

  /**
   * Get all health statuses
   */
  getAllStatuses(): Map<string, HealthStatus> {
    return new Map(this.healthStatus);
  }

  /**
   * Check if backend is healthy
   */
  isHealthy(backend: string): boolean {
    const status = this.healthStatus.get(backend);
    return status?.healthy ?? true; // Assume healthy if not monitored
  }

  /**
   * Manually mark backend as unhealthy
   */
  markUnhealthy(backend: string, error?: string): void {
    const status = this.healthStatus.get(backend);
    if (status) {
      status.healthy = false;
      status.consecutiveFailures++;
      status.consecutiveSuccesses = 0;
      status.error = error;
      status.lastCheck = new Date();

      this.logger.warn("Backend manually marked unhealthy", {
        backend,
        error,
      });
    }
  }

  /**
   * Stop all health checks
   */
  stopAll(): void {
    for (const backend of this.checkIntervals.keys()) {
      this.stopChecking(backend);
    }
  }
}
