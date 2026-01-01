import { spawnSync } from "child_process";

export async function updateCommand() {
  console.log("🔍 Checking for rproxy updates...\n");

  // Get current version
  const currentVersion = getCurrentVersion();
  console.log(`📦 Current version: ${currentVersion}`);

  // Get latest version from GitHub
  const latestVersion = await getLatestVersion();

  if (!latestVersion) {
    console.error("❌ Failed to check for updates");
    console.error("Please check your internet connection or try again later");
    process.exit(1);
  }

  console.log(`📥 Latest version:  ${latestVersion}`);
  console.log("");

  // Compare versions
  if (currentVersion === latestVersion) {
    console.log("✅ You're running the latest version!");
    console.log("");
    console.log("💡 To reinstall:");
    console.log("  curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/main/install.sh | sudo bash");
    return;
  }

  // Update available
  console.log("🆕 Update available!");
  console.log("");
  console.log("📝 To update, run:");
  console.log("  curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/main/install.sh | sudo bash");
  console.log("");
  console.log("Or download manually:");
  console.log(`  https://github.com/LeetCraft/rproxy/releases/tag/${latestVersion}`);
  console.log("");
  console.log("🔗 Release notes:");
  console.log(`  https://github.com/LeetCraft/rproxy/releases/tag/${latestVersion}`);
}

function getCurrentVersion(): string {
  // Try to get version from package.json or help output
  try {
    const result = spawnSync("rproxy", ["help"], {
      encoding: "utf-8",
      timeout: 5000,
    });

    const output = result.stdout || result.stderr || "";
    const match = output.match(/v\d+\.\d+\.\d+/);

    if (match) {
      return match[0];
    }
  } catch (error) {
    // Ignore
  }

  return "unknown";
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/LeetCraft/rproxy/releases/latest",
      {
        headers: {
          "User-Agent": "rproxy-updater",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.tag_name || null;
  } catch (error) {
    return null;
  }
}
