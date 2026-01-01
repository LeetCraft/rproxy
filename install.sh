#!/bin/bash
set -e

echo "Installing rproxy..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Bun is not installed. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash

    # Add bun to PATH for this script
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    # Make it available system-wide
    ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun || true
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
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

# Download latest release
LATEST_RELEASE=$(curl -s https://api.github.com/repos/LeetCraft/rproxy/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_RELEASE" ]; then
    echo "Failed to get latest release"
    exit 1
fi

echo "Downloading rproxy $LATEST_RELEASE for $BINARY_ARCH..."
DOWNLOAD_URL="https://github.com/LeetCraft/rproxy/releases/download/${LATEST_RELEASE}/rproxy-linux-${BINARY_ARCH}"

curl -L -o /tmp/rproxy "$DOWNLOAD_URL"
chmod +x /tmp/rproxy

# Install binary
mv /tmp/rproxy /usr/local/bin/rproxy

# Create directories
mkdir -p /etc/rproxy
mkdir -p /var/lib/rproxy/certs

# Download and install systemd service
curl -L -o /etc/systemd/system/rproxy.service \
    "https://raw.githubusercontent.com/LeetCraft/rproxy/${LATEST_RELEASE}/rproxy.service"

# Reload systemd
systemctl daemon-reload

# Enable service
systemctl enable rproxy

echo ""
echo "✓ rproxy installed successfully!"
echo ""
echo "Quick start:"
echo "  1. Add a route:    rproxy add 127.0.0.1:3000 mysite.com"
echo "  2. Start service:  systemctl start rproxy"
echo "  3. View routes:    rproxy list"
echo "  4. View stats:     rproxy stats"
echo ""
echo "For HTTPS support, install certbot:"
echo "  apt install certbot  # Debian/Ubuntu"
echo "  yum install certbot  # RHEL/CentOS"
echo ""
echo "Then obtain certificates:"
echo "  certbot certonly --standalone -d mysite.com"
echo "  ln -s /etc/letsencrypt/live/mysite.com/privkey.pem /var/lib/rproxy/certs/"
echo "  ln -s /etc/letsencrypt/live/mysite.com/fullchain.pem /var/lib/rproxy/certs/"
