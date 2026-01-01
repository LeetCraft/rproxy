/**
 * Circuit Breaker pattern implementation
 * Prevents cascading failures by failing fast when backend is unhealthy
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Too many failures, requests fail immediately
 * - HALF_OPEN: Testing if backend has recovered
 */

import { Logger } from "./logger";

enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes in HALF_OPEN to close
  timeout: number; // Time in ms before trying HALF_OPEN
  monitoringPeriod: number; // Window for counting failures (ms)
}

interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;
  private failureTimestamps: number[] = [];
  private logger: Logger;

  private readonly config: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000, // 1 minute
    monitoringPeriod: 10000, // 10 seconds
  };

  constructor(private readonly name: string) {
    this.logger = Logger.getInstance();
  }

  /**
   * Execute request through circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < (this.nextAttemptTime || 0)) {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }

      // Try transitioning to HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      this.consecutiveSuccesses = 0;
      this.logger.info("Circuit breaker transitioning to HALF_OPEN", {
        backend: this.name,
      });
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record successful execution
   */
  private onSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        // Close the circuit
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.failureTimestamps = [];
        this.logger.info("Circuit breaker CLOSED", { backend: this.name });
      }
    }
  }

  /**
   * Record failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.failures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = now;
    this.failureTimestamps.push(now);

    // Remove old failure timestamps outside monitoring period
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp <= this.config.monitoringPeriod
    );

    // Check if we should open the circuit
    if (this.state === CircuitState.HALF_OPEN) {
      // Single failure in HALF_OPEN reopens circuit
      this.openCircuit();
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureTimestamps.length >= this.config.failureThreshold
    ) {
      // Too many failures in monitoring period
      this.openCircuit();
    }
  }

  /**
   * Open the circuit breaker
   */
  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.timeout;

    this.logger.warn("Circuit breaker OPENED", {
      backend: this.name,
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      nextAttempt: new Date(this.nextAttemptTime).toISOString(),
    });
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Manually reset circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.failureTimestamps = [];
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;

    this.logger.info("Circuit breaker manually reset", { backend: this.name });
  }
}

/**
 * Circuit breaker registry for managing multiple backends
 */
export class CircuitBreakerRegistry {
  private static instance: CircuitBreakerRegistry;
  private breakers = new Map<string, CircuitBreaker>();

  private constructor() {}

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  /**
   * Get or create circuit breaker for backend
   */
  get(backend: string): CircuitBreaker {
    if (!this.breakers.has(backend)) {
      this.breakers.set(backend, new CircuitBreaker(backend));
    }
    return this.breakers.get(backend)!;
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return this.breakers;
  }

  /**
   * Remove circuit breaker
   */
  remove(backend: string): void {
    this.breakers.delete(backend);
  }
}
