import { CertbotManager } from "../lib/certbot";
import { Config } from "../lib/config";
import { spawnSync } from "child_process";

export async function certCommand(args: string[]) {
  const subcommand = args[0];

  switch (subcommand) {
    case "install":
      await certInstall();
      break;

    case "issue":
    case "obtain":
      await certIssue(args.slice(1));
      break;

    case "list":
    case "ls":
      await certList();
      break;

    case "renew":
      await certRenew();
      break;

    case "auto-renew":
    case "setup":
      await certAutoRenew();
      break;

    default:
      certHelp();
  }
}

async function certInstall() {
  const certbot = new CertbotManager();

  console.log("🔍 Checking for certbot...");
  const status = await certbot.checkCertbot();

  if (status.installed) {
    console.log(`✅ Certbot is already installed`);
    console.log(`   Version: ${status.version}`);
    console.log(`   Path: ${status.path}`);
    return;
  }

  console.log("❌ Certbot is not installed");
  const success = await certbot.installCertbot();

  if (!success) {
    process.exit(1);
  }
}

async function certIssue(args: string[]) {
  const certbot = new CertbotManager();

  // Check if certbot is installed
  const status = await certbot.checkCertbot();
  if (!status.installed) {
    console.error("\n❌ Certbot is not installed");
    console.log("\nWould you like to install it now?");
    const success = await certbot.installCertbot();

    if (!success) {
      console.error("\n❌ Cannot issue certificate without certbot");
      process.exit(1);
    }
  }

  // Parse arguments
  let domain: string | undefined;
  let email: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-d" || args[i] === "--domain") {
      domain = args[i + 1];
      i++;
    } else if (args[i] === "-e" || args[i] === "--email") {
      email = args[i + 1];
      i++;
    } else if (!domain) {
      domain = args[i];
    }
  }

  if (!domain) {
    console.error("❌ Domain is required");
    console.log("\nUsage:");
    console.log("  rproxy cert issue <domain> [--email <email>]");
    console.log("\nExamples:");
    console.log("  rproxy cert issue mysite.com");
    console.log("  rproxy cert issue mysite.com --email admin@mysite.com");
    process.exit(1);
  }

  // Check if domain has a route configured
  const config = Config.getInstance();
  const backend = config.getBackend(domain);

  if (!backend) {
    console.warn(`\n⚠️  Warning: No route configured for ${domain}`);
    console.log("You should add a route first:");
    console.log(`  rproxy add <backend> ${domain}`);
    console.log();
  }

  // Check DNS before issuing
  console.log(`\n🔍 Checking DNS for ${domain}...`);
  const dnsValid = await checkDNS(domain);

  if (!dnsValid) {
    console.error(`\n❌ DNS check failed for ${domain}`);
    console.error("Ensure your domain points to this server before requesting a certificate");
    console.error("\nCheck your DNS settings:");
    console.error(`  dig ${domain}`);
    console.error(`  nslookup ${domain}`);
    process.exit(1);
  }

  console.log(`✅ DNS resolves correctly`);

  // Issue certificate
  const success = await certbot.issueCertificate(domain, email);

  if (success) {
    console.log("\n🎉 Certificate successfully obtained and configured!");
    console.log("\n📝 Next steps:");
    console.log("  1. Reload rproxy: sudo systemctl reload rproxy");
    console.log("  2. Test HTTPS: curl https://" + domain);
    console.log("\n💡 Tip: Certificates auto-renew. Setup auto-reload:");
    console.log("  rproxy cert auto-renew");
  } else {
    console.error("\n❌ Failed to obtain certificate");
    console.error("\nTroubleshooting:");
    console.error("  - Ensure ports 80 and 443 are open");
    console.error("  - Check DNS points to this server");
    console.error("  - Ensure rproxy is running");
    console.error("  - Check logs: sudo journalctl -u rproxy -n 50");
    process.exit(1);
  }
}

async function certList() {
  const certbot = new CertbotManager();

  // Check if certbot is installed
  const status = await certbot.checkCertbot();
  if (!status.installed) {
    console.error("❌ Certbot is not installed");
    console.log("\nInstall certbot first:");
    console.log("  rproxy cert install");
    process.exit(1);
  }

  console.log("📜 Listing certificates...\n");

  const certificates = await certbot.listCertificates();

  if (certificates.length === 0) {
    console.log("No certificates found.");
    console.log("\nIssue a certificate:");
    console.log("  rproxy cert issue <domain>");
    return;
  }

  console.log("Certificates:");
  console.log("=============\n");

  for (const cert of certificates) {
    const expiryStatus =
      cert.daysUntilExpiry < 30
        ? `⚠️  ${cert.daysUntilExpiry} days (RENEWAL NEEDED)`
        : cert.daysUntilExpiry < 60
        ? `⚡ ${cert.daysUntilExpiry} days`
        : `✅ ${cert.daysUntilExpiry} days`;

    console.log(`📄 ${cert.domain}`);
    console.log(`   Expires: ${cert.expiryDate.toISOString()} (${expiryStatus})`);
    console.log(`   Path: ${cert.path}`);
    console.log();
  }

  console.log(`Total: ${certificates.length} certificate(s)`);

  // Check if any need renewal
  const needsRenewal = certificates.filter((c) => c.daysUntilExpiry < 30);
  if (needsRenewal.length > 0) {
    console.log(`\n⚠️  ${needsRenewal.length} certificate(s) need renewal`);
    console.log("Run: rproxy cert renew");
  }
}

async function certRenew() {
  const certbot = new CertbotManager();

  // Check if certbot is installed
  const status = await certbot.checkCertbot();
  if (!status.installed) {
    console.error("❌ Certbot is not installed");
    process.exit(1);
  }

  const success = await certbot.renewCertificates();

  if (success) {
    console.log("\n🎉 Certificate renewal complete");
    console.log("\n📝 Reload rproxy to use updated certificates:");
    console.log("  sudo systemctl reload rproxy");

    // Try to reload automatically
    try {
      const result = spawnSync("systemctl", ["reload", "rproxy"]);
      if (result.status === 0) {
        console.log("\n✅ rproxy reloaded automatically");
      }
    } catch {
      // Silent fail - user can reload manually
    }
  } else {
    process.exit(1);
  }
}

async function certAutoRenew() {
  const certbot = new CertbotManager();

  // Check if certbot is installed
  const status = await certbot.checkCertbot();
  if (!status.installed) {
    console.error("❌ Certbot is not installed");
    console.log("\nInstall certbot first:");
    console.log("  rproxy cert install");
    process.exit(1);
  }

  await certbot.setupAutoRenewal();

  console.log("\n✅ Automatic renewal configured");
  console.log("\n📝 How it works:");
  console.log("  - Certbot checks for renewals twice daily (via systemd timer)");
  console.log("  - Certificates renew automatically 30 days before expiry");
  console.log("  - rproxy reloads automatically after renewal");
  console.log("\n💡 Test renewal:");
  console.log("  sudo certbot renew --dry-run");
}

async function checkDNS(domain: string): Promise<boolean> {
  try {
    // Simple DNS check using dig or nslookup
    const result = spawnSync("dig", ["+short", domain], {
      encoding: "utf-8",
      timeout: 5000,
    });

    if (result.status === 0 && result.stdout.trim()) {
      const ips = result.stdout.trim().split("\n");
      console.log(`   DNS records: ${ips.join(", ")}`);
      return true;
    }

    // Fallback to nslookup
    const nslookup = spawnSync("nslookup", [domain], {
      encoding: "utf-8",
      timeout: 5000,
    });

    return nslookup.status === 0;
  } catch {
    // DNS check failed, but we'll let certbot handle it
    return true; // Don't block on DNS check failure
  }
}

function certHelp() {
  console.log(`rproxy cert - Certificate management

Usage:
  rproxy cert <command> [options]

Commands:
  install                Install certbot (with confirmation)
  issue <domain>         Issue a new certificate
  list                   List all certificates
  renew                  Renew certificates
  auto-renew             Setup automatic renewal

Options:
  -d, --domain <domain>  Domain name
  -e, --email <email>    Email for important notifications

Examples:
  # Install certbot
  rproxy cert install

  # Issue certificate (interactive)
  rproxy cert issue mysite.com

  # Issue with email
  rproxy cert issue mysite.com --email admin@mysite.com

  # List all certificates
  rproxy cert list

  # Manually renew
  rproxy cert renew

  # Setup auto-renewal
  rproxy cert auto-renew

Features:
  ✅ Zero-downtime certificate issuance
  ✅ Automatic certbot installation
  ✅ DNS validation before issuance
  ✅ Auto-renewal with rproxy reload
  ✅ Certificate expiry monitoring
`);
}
