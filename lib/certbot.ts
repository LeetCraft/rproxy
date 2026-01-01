/**
 * Certbot integration for automatic HTTPS certificate management
 * Implements zero-downtime certificate issuance via ACME HTTP-01 challenge
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { Logger } from "./logger";

export interface CertbotStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface Certificate {
  domain: string;
  path: string;
  privkeyPath: string;
  fullchainPath: string;
  expiryDate: Date;
  daysUntilExpiry: number;
}

export class CertbotManager {
  private logger: Logger;
  private certDir: string;
  private acmeChallengeDir: string;

  constructor() {
    this.logger = Logger.getInstance();
    // Allow override via environment variable
    const baseDir = process.env.RPROXY_DATA_DIR || "/var/lib/rproxy";
    this.certDir = `${baseDir}/certs`;
    this.acmeChallengeDir = `${baseDir}/acme-challenges`;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!existsSync(this.certDir)) {
      mkdirSync(this.certDir, { recursive: true, mode: 0o755 });
    }
    if (!existsSync(this.acmeChallengeDir)) {
      mkdirSync(this.acmeChallengeDir, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Check if certbot is installed
   */
  async checkCertbot(): Promise<CertbotStatus> {
    try {
      const result = await $`which certbot`.quiet();
      const path = result.stdout.toString().trim();

      if (!path) {
        return { installed: false };
      }

      const versionResult = await $`certbot --version`.quiet();
      const version = versionResult.stderr.toString().trim();

      return {
        installed: true,
        version,
        path,
      };
    } catch {
      return { installed: false };
    }
  }

  /**
   * Install certbot with user confirmation
   */
  async installCertbot(): Promise<boolean> {
    this.logger.info("Certbot installation requested");

    // Detect package manager
    const packageManager = await this.detectPackageManager();
    if (!packageManager) {
      console.error("❌ Could not detect package manager");
      console.error("Please install certbot manually:");
      console.error("  Debian/Ubuntu: sudo apt install certbot");
      console.error("  RHEL/CentOS:   sudo yum install certbot");
      console.error("  Fedora:        sudo dnf install certbot");
      console.error("  Arch:          sudo pacman -S certbot");
      return false;
    }

    console.log("\n🔒 rproxy needs certbot to manage HTTPS certificates");
    console.log(`📦 Detected package manager: ${packageManager.name}`);
    console.log(`📝 Install command: ${packageManager.installCmd}`);
    console.log();

    // Prompt user
    const response = await this.promptUser(
      "Would you like to install certbot now? [y/N]: "
    );

    if (response.toLowerCase() !== "y" && response.toLowerCase() !== "yes") {
      console.log("\n⚠️  Certbot installation cancelled");
      console.log("To install manually, run:");
      console.log(`  ${packageManager.installCmd}`);
      return false;
    }

    console.log("\n📥 Installing certbot...");

    try {
      await packageManager.install();
      console.log("✅ Certbot installed successfully");

      // Verify installation
      const status = await this.checkCertbot();
      if (status.installed) {
        console.log(`✅ Certbot version: ${status.version}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("❌ Failed to install certbot");
      this.logger.error("Certbot installation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Detect system package manager
   */
  private async detectPackageManager(): Promise<{
    name: string;
    installCmd: string;
    install: () => Promise<void>;
  } | null> {
    // Check for apt (Debian/Ubuntu)
    try {
      await $`which apt-get`.quiet();
      return {
        name: "apt",
        installCmd: "sudo apt update && sudo apt install -y certbot",
        install: async () => {
          await $`apt-get update`;
          await $`apt-get install -y certbot`;
        },
      };
    } catch {}

    // Check for yum (RHEL/CentOS)
    try {
      await $`which yum`.quiet();
      return {
        name: "yum",
        installCmd: "sudo yum install -y certbot",
        install: async () => {
          await $`yum install -y certbot`;
        },
      };
    } catch {}

    // Check for dnf (Fedora)
    try {
      await $`which dnf`.quiet();
      return {
        name: "dnf",
        installCmd: "sudo dnf install -y certbot",
        install: async () => {
          await $`dnf install -y certbot`;
        },
      };
    } catch {}

    // Check for pacman (Arch)
    try {
      await $`which pacman`.quiet();
      return {
        name: "pacman",
        installCmd: "sudo pacman -S --noconfirm certbot",
        install: async () => {
          await $`pacman -S --noconfirm certbot`;
        },
      };
    } catch {}

    return null;
  }

  /**
   * Prompt user for input
   */
  private async promptUser(question: string): Promise<string> {
    process.stdout.write(question);

    const decoder = new TextDecoder();
    const reader = Bun.stdin.stream().getReader();

    try {
      const { value } = await reader.read();
      if (value) {
        return decoder.decode(value).trim();
      }
    } finally {
      reader.releaseLock();
    }

    return "";
  }

  /**
   * Issue certificate for domain using HTTP-01 challenge
   * Zero-downtime: Uses webroot authentication with rproxy serving challenges
   */
  async issueCertificate(domain: string, email?: string): Promise<boolean> {
    this.logger.info("Issuing certificate", { domain });

    // Build certbot command
    const args = [
      "certonly",
      "--webroot",
      "--webroot-path",
      this.acmeChallengeDir,
      "-d",
      domain,
      "--non-interactive",
      "--agree-tos",
      "--keep-until-expiring",
    ];

    if (email) {
      args.push("--email", email);
    } else {
      args.push("--register-unsafely-without-email");
    }

    console.log(`\n🔒 Requesting certificate for ${domain}...`);
    console.log("📝 Using HTTP-01 challenge (zero-downtime)");

    try {
      const result = await $`certbot ${args}`;

      if (result.exitCode !== 0) {
        throw new Error("Certbot failed");
      }

      console.log("✅ Certificate obtained successfully");

      // Link certificate to rproxy cert directory
      await this.linkCertificate(domain);

      return true;
    } catch (error) {
      this.logger.error("Certificate issuance failed", {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`❌ Failed to obtain certificate for ${domain}`);
      return false;
    }
  }

  /**
   * Link Let's Encrypt certificate to rproxy cert directory
   */
  private async linkCertificate(domain: string): Promise<void> {
    const letsencryptPath = `/etc/letsencrypt/live/${domain}`;
    const privkeySource = `${letsencryptPath}/privkey.pem`;
    const fullchainSource = `${letsencryptPath}/fullchain.pem`;

    const privkeyDest = `${this.certDir}/privkey.pem`;
    const fullchainDest = `${this.certDir}/fullchain.pem`;

    try {
      // Remove old symlinks if they exist
      if (existsSync(privkeyDest)) {
        await $`rm -f ${privkeyDest}`;
      }
      if (existsSync(fullchainDest)) {
        await $`rm -f ${fullchainDest}`;
      }

      // Create new symlinks
      await $`ln -s ${privkeySource} ${privkeyDest}`;
      await $`ln -s ${fullchainSource} ${fullchainDest}`;

      console.log(`✅ Certificate linked to ${this.certDir}`);
    } catch (error) {
      this.logger.error("Failed to link certificate", {
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List all certificates
   */
  async listCertificates(): Promise<Certificate[]> {
    try {
      const result = await $`certbot certificates`.quiet();
      const output = result.stdout.toString();

      // Parse certbot output
      const certificates: Certificate[] = [];
      const certBlocks = output.split("Certificate Name:");

      for (const block of certBlocks.slice(1)) {
        const domainMatch = block.match(/Certificate Name:\s*(\S+)/);
        const pathMatch = block.match(/Certificate Path:\s*(\S+)/);
        const expiryMatch = block.match(/Expiry Date:\s*([^\n]+)/);

        if (domainMatch && pathMatch && expiryMatch) {
          const domain = domainMatch[1];
          const certPath = pathMatch[1];
          const expiryStr = expiryMatch[1];
          const expiryDate = new Date(expiryStr);
          const now = new Date();
          const daysUntilExpiry = Math.floor(
            (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          const certDir = certPath.substring(0, certPath.lastIndexOf("/"));

          certificates.push({
            domain,
            path: certDir,
            privkeyPath: `${certDir}/privkey.pem`,
            fullchainPath: `${certDir}/fullchain.pem`,
            expiryDate,
            daysUntilExpiry,
          });
        }
      }

      return certificates;
    } catch (error) {
      this.logger.error("Failed to list certificates", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Renew all certificates
   */
  async renewCertificates(): Promise<boolean> {
    console.log("🔄 Checking for certificate renewals...");

    try {
      const result = await $`certbot renew --quiet`;

      if (result.exitCode === 0) {
        console.log("✅ Certificate renewal check complete");
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error("Certificate renewal failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("❌ Certificate renewal failed");
      return false;
    }
  }

  /**
   * Setup automatic renewal cron job
   */
  async setupAutoRenewal(): Promise<void> {
    console.log("\n⚙️  Setting up automatic certificate renewal...");

    try {
      // Create renewal hook script
      const hookScript = `/etc/letsencrypt/renewal-hooks/deploy/rproxy-reload.sh`;
      const hookContent = `#!/bin/bash
# Reload rproxy after certificate renewal
systemctl reload rproxy || pkill -HUP -f 'rproxy serve'
`;

      await Bun.write(hookScript, hookContent);
      await $`chmod +x ${hookScript}`;

      console.log("✅ Renewal hook installed");
      console.log("📝 Certificates will auto-renew via systemd timer (if certbot installed via package)");
    } catch (error) {
      this.logger.warn("Failed to setup auto-renewal hook", {
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn("⚠️  Auto-renewal hook setup failed (manual setup may be needed)");
    }
  }

  /**
   * Get ACME challenge directory for webroot authentication
   */
  getAcmeChallengeDir(): string {
    return this.acmeChallengeDir;
  }
}
