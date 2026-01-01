# Deployment Guide

## Creating the GitHub Repository

1. Go to https://github.com/new
2. Set:
   - Owner: `LeetCraft`
   - Repository name: `rproxy`
   - Description: "A blazing-fast reverse proxy with automatic HTTPS"
   - Visibility: Public
   - **DO NOT** initialize with README, .gitignore, or license
3. Click "Create repository"

## Push to GitHub

```bash
cd /Users/hybris/Desktop/reverse-proxy-https

# Push to GitHub
git push -u origin main
```

## Create First Release

After pushing to GitHub:

```bash
# Tag the first release
git tag -a v1.0.0 -m "First release: Production-ready reverse proxy"

# Push the tag to trigger GitHub Actions
git push origin v1.0.0
```

GitHub Actions will automatically:
- Build binaries for Linux x64 and ARM64
- Create checksums
- Create a GitHub release
- Upload all artifacts

## What Happens Next

1. GitHub Actions builds the binaries (~2-3 minutes)
2. Release is published at: https://github.com/LeetCraft/rproxy/releases
3. Users can install with the one-liner:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/v1.0.0/install.sh | sudo bash
   ```

## Testing the Installation

On a Linux server:

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/v1.0.0/install.sh | sudo bash

# Add a route
sudo rproxy add localhost:3000 test.local

# List routes
rproxy list

# Start the service
sudo systemctl start rproxy

# Check status
sudo systemctl status rproxy

# View logs
sudo journalctl -u rproxy -f
```

## Updating the One-liner in README

After the first release is published, update the README one-liner from:
```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/main/install.sh | sudo bash
```

To:
```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/v1.0.0/install.sh | sudo bash
```

Or keep it pointing to `main` for always-latest installs.
