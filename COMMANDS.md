# rproxy Command Reference

Complete guide to all rproxy commands with examples.

## Installation

### One-liner Install

```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/v1.0.0/install.sh | sudo bash
```

**What it does:**
1. Checks if Bun is installed (installs if needed)
2. Downloads the latest rproxy binary for your architecture
3. Installs to `/usr/local/bin/rproxy`
4. Creates systemd service
5. Sets up directories (`/etc/rproxy`, `/var/lib/rproxy`)

---

## Route Management

### `rproxy add <backend> <host>`

Add a new reverse proxy route.

**Syntax:**
```bash
rproxy add <backend-url> <hostname>
```

**Examples:**

```bash
# Basic local service
rproxy add 127.0.0.1:3000 mysite.com

# API service
rproxy add localhost:8080 api.mysite.com

# Service on another machine
rproxy add 192.168.1.100:3000 internal.mysite.com

# Explicit HTTP
rproxy add http://localhost:5000 dev.local

# Explicit HTTPS backend
rproxy add https://backend.internal:8443 secure.mysite.com
```

**What it does:**
- Adds route to SQLite database (`/etc/rproxy/config.db`)
- Auto-prefixes with `http://` if no scheme provided
- Overwrites existing route if host already exists
- Shows reminder to reload service

**Output:**
```
✓ Route added: mysite.com -> http://127.0.0.1:3000

To apply changes:
  sudo systemctl reload rproxy
Or if running directly:
  pkill -HUP -f 'bun.*server.ts'
```

---

### `rproxy rm <host>`

Remove a reverse proxy route.

**Syntax:**
```bash
rproxy rm <hostname>
```

**Aliases:** `remove`

**Examples:**

```bash
# Remove a route
rproxy rm mysite.com

# Remove multiple (run separately)
rproxy rm api.mysite.com
rproxy rm dev.local
```

**What it does:**
- Removes route from database
- Returns error if route doesn't exist
- Shows reminder to reload service

**Output:**
```
✓ Route removed: mysite.com

To apply changes:
  sudo systemctl reload rproxy
```

**Error cases:**
```
Error: Route not found: nonexistent.com
```

---

### `rproxy list`

List all configured routes.

**Syntax:**
```bash
rproxy list
```

**Aliases:** `ls`

**Examples:**

```bash
# List all routes
rproxy list

# Pipe to grep for filtering
rproxy list | grep mysite
```

**Output:**
```
Configured Routes:
==================
  mysite.com -> http://127.0.0.1:3000
  api.mysite.com -> http://localhost:8080
  dev.local -> http://localhost:5000

Total: 3 route(s)
```

**Empty output:**
```
No routes configured.
```

---

## Statistics

### `rproxy stats`

Show request statistics from running server.

**Syntax:**
```bash
rproxy stats
```

**Aliases:** `status`

**Examples:**

```bash
# View current stats
rproxy stats

# Monitor stats continuously
watch -n 1 rproxy stats
```

**Output:**
```
Reverse Proxy Statistics
========================
Total Requests:   15234
Success:          14998
Failed:           236

Per-Host Statistics:
--------------------
  mysite.com:
    Requests: 12000
    Success:  11850
    Failed:   150
  api.mysite.com:
    Requests: 3234
    Success:  3148
    Failed:   86
```

**What it does:**
- Connects to internal stats API (localhost:9090)
- Displays aggregate and per-host metrics
- Shows real-time data (since last restart)

**Error cases:**
```
Error: Unable to connect to rproxy service. Is it running?
Start the service with: sudo systemctl start rproxy
```

---

## Server Control

### `rproxy serve`

Start the reverse proxy server.

**Syntax:**
```bash
rproxy serve
```

**Aliases:** `start`

**Examples:**

```bash
# Start in foreground (for testing)
sudo rproxy serve

# Start with debug logging
sudo LOG_LEVEL=DEBUG rproxy serve

# Start in background
sudo rproxy serve &
```

**What it does:**
- Starts HTTP server on port 80
- Starts HTTPS server on port 443 (if certs exist)
- Starts stats API on localhost:9090
- Handles graceful shutdown on SIGTERM/SIGINT
- Reloads config on SIGHUP

**Requirements:**
- Must run as root (ports 80/443)
- Routes must be configured
- For HTTPS: certificates in `/var/lib/rproxy/certs/`

**Output:**
```json
{"timestamp":"2026-01-01T14:54:00.000Z","level":"INFO","message":"Starting rproxy server"}
{"timestamp":"2026-01-01T14:54:00.100Z","level":"INFO","message":"HTTP server listening on port 80"}
{"timestamp":"2026-01-01T14:54:00.150Z","level":"INFO","message":"HTTPS server listening on port 443"}
{"timestamp":"2026-01-01T14:54:00.200Z","level":"INFO","message":"Stats API listening on localhost:9090"}
```

---

### `rproxy save`

Save configuration (informational command).

**Syntax:**
```bash
rproxy save
```

**Output:**
```
✓ Configuration is automatically saved
(using SQLite, no manual save needed)
```

**What it does:**
- Informational only
- Config is auto-saved by `add` and `rm` commands
- SQLite provides ACID guarantees

---

### `rproxy help`

Show help message.

**Syntax:**
```bash
rproxy help
```

**Aliases:** `--help`, `-h`

**Output:**
```
rproxy - A fast reverse proxy with automatic HTTPS

Usage:
  rproxy add <backend> <host>    Add a reverse proxy route
  rproxy rm <host>               Remove a route
  rproxy list                    List all routes
  rproxy stats                   Show statistics
  rproxy save                    Save configuration
  rproxy serve                   Start the proxy server
  rproxy help                    Show this help

Examples:
  rproxy add 127.0.0.1:3000 mysite.com
  rproxy add localhost:8080 api.example.com
  rproxy rm mysite.com
  rproxy list
  rproxy stats
```

---

## Systemd Service Commands

### Start Service

```bash
sudo systemctl start rproxy
```

Starts the rproxy service.

### Stop Service

```bash
sudo systemctl stop rproxy
```

Stops the rproxy service gracefully.

### Restart Service

```bash
sudo systemctl restart rproxy
```

Stops and starts the service (brief downtime).

### Reload Service (Zero-downtime)

```bash
sudo systemctl reload rproxy
```

Sends SIGHUP signal to reload configuration without dropping connections.

### Service Status

```bash
sudo systemctl status rproxy
```

**Output:**
```
● rproxy.service - RProxy - High-performance reverse proxy with automatic HTTPS
     Loaded: loaded (/etc/systemd/system/rproxy.service; enabled)
     Active: active (running) since Wed 2026-01-01 14:54:00 UTC; 5min ago
   Main PID: 12345 (rproxy)
      Tasks: 4 (limit: 4915)
     Memory: 32.5M
        CPU: 125ms
     CGroup: /system.slice/rproxy.service
             └─12345 /usr/local/bin/rproxy serve
```

### Enable Auto-start

```bash
sudo systemctl enable rproxy
```

Starts rproxy automatically on boot.

### Disable Auto-start

```bash
sudo systemctl disable rproxy
```

Prevents auto-start on boot.

### View Logs

```bash
# Follow logs in real-time
sudo journalctl -u rproxy -f

# View last 100 lines
sudo journalctl -u rproxy -n 100

# View logs since boot
sudo journalctl -u rproxy -b

# View logs for specific time
sudo journalctl -u rproxy --since "1 hour ago"
```

---

## HTTPS Setup

### Install Certbot

```bash
# Debian/Ubuntu
sudo apt install certbot

# RHEL/CentOS
sudo yum install certbot

# Arch
sudo pacman -S certbot
```

### Obtain Certificate

```bash
# Single domain
sudo certbot certonly --standalone -d mysite.com

# Multiple domains
sudo certbot certonly --standalone -d mysite.com -d www.mysite.com

# Wildcard (requires DNS challenge)
sudo certbot certonly --manual --preferred-challenges dns -d "*.mysite.com"
```

### Link Certificates

```bash
# Create certificate symlinks
sudo ln -s /etc/letsencrypt/live/mysite.com/privkey.pem /var/lib/rproxy/certs/
sudo ln -s /etc/letsencrypt/live/mysite.com/fullchain.pem /var/lib/rproxy/certs/

# Restart rproxy to load certs
sudo systemctl restart rproxy
```

### Auto-renewal Hook

```bash
# Create renewal hook
echo 'systemctl reload rproxy' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/rproxy
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/rproxy

# Test renewal (dry run)
sudo certbot renew --dry-run
```

---

## Configuration Files

### SQLite Database

**Location:** `/etc/rproxy/config.db`

**Schema:**
```sql
CREATE TABLE routes (
  host TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

**Query directly:**
```bash
sudo sqlite3 /etc/rproxy/config.db "SELECT * FROM routes;"
```

### Systemd Service

**Location:** `/etc/systemd/system/rproxy.service`

**Edit service:**
```bash
sudo systemctl edit rproxy
```

**Override example (change log level):**
```ini
[Service]
Environment="LOG_LEVEL=DEBUG"
```

### Certificates

**Expected locations:**
- Private key: `/var/lib/rproxy/certs/privkey.pem`
- Full chain: `/var/lib/rproxy/certs/fullchain.pem`

---

## Environment Variables

### LOG_LEVEL

Set logging verbosity.

**Values:** `DEBUG`, `INFO`, `WARN`, `ERROR`

**Example:**
```bash
# Temporary
sudo LOG_LEVEL=DEBUG rproxy serve

# Permanent (systemd)
sudo systemctl edit rproxy
# Add: Environment="LOG_LEVEL=DEBUG"
```

---

## Troubleshooting Commands

### Check if ports are in use

```bash
sudo lsof -i :80
sudo lsof -i :443
```

### Test route

```bash
# Add a test route
rproxy add localhost:3000 test.local

# Add to /etc/hosts
echo "127.0.0.1 test.local" | sudo tee -a /etc/hosts

# Test with curl
curl http://test.local
```

### Check certificate status

```bash
# List certificates
sudo certbot certificates

# Check expiry
sudo openssl x509 -in /var/lib/rproxy/certs/fullchain.pem -text -noout | grep "Not After"
```

### Monitor resources

```bash
# CPU and memory
sudo systemctl status rproxy

# Detailed metrics
sudo top -p $(pgrep -f rproxy)
```

### Debug requests

```bash
# Enable debug logging
sudo LOG_LEVEL=DEBUG systemctl restart rproxy

# Watch logs
sudo journalctl -u rproxy -f
```

---

## Advanced Usage

### Multiple Backends (Future)

```bash
# Current: Last one wins
rproxy add localhost:3000 mysite.com
rproxy add localhost:4000 mysite.com  # Overwrites previous

# Future: Load balancing
rproxy add --load-balance localhost:3000,localhost:4000 mysite.com
```

### Custom Rate Limits (Future)

```bash
# Future feature
rproxy config set rate-limit 100  # requests per minute
```

### Export/Import Routes

```bash
# Export routes to JSON
sudo sqlite3 /etc/rproxy/config.db \
  "SELECT json_object('host', host, 'backend', backend) FROM routes;" \
  > routes.json

# Import (reconstruct with add commands)
cat routes.json | jq -r '"rproxy add \(.backend) \(.host)"' | sudo bash
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Install | `curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/v1.0.0/install.sh \| sudo bash` |
| Add route | `rproxy add 127.0.0.1:3000 mysite.com` |
| Remove route | `rproxy rm mysite.com` |
| List routes | `rproxy list` |
| View stats | `rproxy stats` |
| Start service | `sudo systemctl start rproxy` |
| Stop service | `sudo systemctl stop rproxy` |
| Reload config | `sudo systemctl reload rproxy` |
| View logs | `sudo journalctl -u rproxy -f` |
| Check status | `sudo systemctl status rproxy` |
| Enable auto-start | `sudo systemctl enable rproxy` |
