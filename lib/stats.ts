interface HostStats {
  requests: number;
  success: number;
  failed: number;
  lastRequest: number;
}

export class Stats {
  private static instance: Stats;
  private totalRequests = 0;
  private successRequests = 0;
  private failedRequests = 0;
  private hostStats = new Map<string, HostStats>();

  private constructor() {}

  static getInstance(): Stats {
    if (!Stats.instance) {
      Stats.instance = new Stats();
    }
    return Stats.instance;
  }

  incrementTotal(): void {
    this.totalRequests++;
  }

  incrementSuccess(): void {
    this.successRequests++;
  }

  incrementFailed(): void {
    this.failedRequests++;
  }

  incrementHost(host: string, success: boolean): void {
    const stats = this.hostStats.get(host) ?? {
      requests: 0,
      success: 0,
      failed: 0,
      lastRequest: 0,
    };

    stats.requests++;
    if (success) {
      stats.success++;
    } else {
      stats.failed++;
    }
    stats.lastRequest = Date.now();

    this.hostStats.set(host, stats);
  }

  getStats() {
    return {
      totalRequests: this.totalRequests,
      successRequests: this.successRequests,
      failedRequests: this.failedRequests,
      hostStats: Object.fromEntries(this.hostStats),
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.hostStats.clear();
  }
}
