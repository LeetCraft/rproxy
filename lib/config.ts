import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface Route {
  host: string;
  backend: string;
}

export class Config {
  private db: Database;
  private static instance: Config;

  private constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initDatabase();
  }

  static getInstance(dbPath = "/etc/rproxy/config.db"): Config {
    if (!Config.instance) {
      Config.instance = new Config(dbPath);
    }
    return Config.instance;
  }

  private initDatabase(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS routes (
        host TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_host ON routes(host)
    `);
  }

  addRoute(host: string, backend: string): void {
    this.db.run(
      `INSERT INTO routes (host, backend) VALUES (?, ?)
       ON CONFLICT(host) DO UPDATE SET backend = ?, updated_at = strftime('%s', 'now')`,
      [host, backend, backend]
    );
  }

  removeRoute(host: string): boolean {
    const result = this.db.run("DELETE FROM routes WHERE host = ?", [host]);
    return result.changes > 0;
  }

  getBackend(host: string): string | null {
    const result = this.db
      .query<{ backend: string }, [string]>("SELECT backend FROM routes WHERE host = ?")
      .get(host);
    return result?.backend ?? null;
  }

  getAllRoutes(): Route[] {
    return this.db
      .query<Route, []>("SELECT host, backend FROM routes ORDER BY host")
      .all();
  }

  close(): void {
    this.db.close();
  }
}
