#!/bin/bash
set -e

echo "🚀 rproxy installer"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        BINARY_ARCH="x64"
        ;;
    aarch64|arm64)
        BINARY_ARCH="arm64"
        ;;
    *)
        echo "❌ Unsupported architecture: $ARCH"
        echo "Supported: x86_64, aarch64, arm64"
        exit 1
        ;;
esac

# Check if rproxy is already installed
CURRENT_VERSION=""
if command -v rproxy &> /dev/null; then
    CURRENT_VERSION=$(rproxy help 2>&1 | head -1 | grep -o "v[0-9.]*" || echo "unknown")
    echo "📦 Current installation detected: $CURRENT_VERSION"
fi

# Get latest release
echo "🔍 Checking for latest release..."
LATEST_RELEASE=$(curl -s https://api.github.com/repos/LeetCraft/rproxy/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_RELEASE" ]; then
    echo "❌ Failed to get latest release from GitHub"
    exit 1
fi

echo "📥 Latest version: $LATEST_RELEASE"

# Check if already up to date
if [ "$CURRENT_VERSION" = "$LATEST_RELEASE" ]; then
    echo "✅ Already running latest version!"
    echo ""
    echo "To reinstall anyway, run:"
    echo "  rm /usr/local/bin/rproxy"
    echo "  curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/main/install.sh | sudo bash"
    exit 0
fi

# Download binary
echo "📥 Downloading rproxy $LATEST_RELEASE for Linux $BINARY_ARCH..."
DOWNLOAD_URL="https://github.com/LeetCraft/rproxy/releases/download/${LATEST_RELEASE}/rproxy-linux-${BINARY_ARCH}"

if ! curl -fL -o /tmp/rproxy "$DOWNLOAD_URL"; then
    echo "❌ Failed to download binary"
    exit 1
fi

chmod +x /tmp/rproxy

# Verify binary works
if ! /tmp/rproxy help &> /dev/null; then
    echo "❌ Downloaded binary is not working"
    rm /tmp/rproxy
    exit 1
fi

# Stop service if running
if systemctl is-active --quiet rproxy 2>/dev/null; then
    echo "🛑 Stopping rproxy service..."
    systemctl stop rproxy
    RESTART_NEEDED=true
fi

# Install binary
echo "📦 Installing binary to /usr/local/bin/rproxy..."
mv /tmp/rproxy /usr/local/bin/rproxy

# Create directories
echo "📁 Creating directories..."
mkdir -p /etc/rproxy
mkdir -p /var/lib/rproxy/certs
mkdir -p /var/lib/rproxy/acme-challenges/.well-known/acme-challenge

# Download and install systemd service
echo "⚙️  Installing systemd service..."
curl -fsSL -o /etc/systemd/system/rproxy.service \
    "https://raw.githubusercontent.com/LeetCraft/rproxy/${LATEST_RELEASE}/rproxy.service"

# Reload systemd
systemctl daemon-reload

# Enable service
if ! systemctl is-enabled --quiet rproxy 2>/dev/null; then
    systemctl enable rproxy
    echo "✅ Service enabled (auto-start on boot)"
fi

# Restart if it was running
if [ "$RESTART_NEEDED" = "true" ]; then
    echo "🔄 Restarting rproxy service..."
    systemctl start rproxy
    echo "✅ Service restarted"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ rproxy $LATEST_RELEASE installed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Quick Start:"
echo ""
echo "  # Add a route"
echo "  rproxy add 127.0.0.1:3000 mysite.com"
echo ""
echo "  # Start the service"
echo "  systemctl start rproxy"
echo ""
echo "  # Install certbot & get HTTPS (zero-downtime!)"
echo "  rproxy cert install"
echo "  rproxy cert issue mysite.com"
echo ""
echo "  # Check status"
echo "  rproxy list"
echo "  rproxy stats"
echo "  systemctl status rproxy"
echo ""
echo "📚 Documentation:"
echo "  https://github.com/LeetCraft/rproxy"
echo ""
echo "💡 Pro tip: Use 'rproxy update' to check for updates"
echo ""
