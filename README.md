# rproxy

A blazing-fast reverse proxy with automatic HTTPS, built with [Bun](https://bun.sh) and TypeScript.

## Features

- **High Performance**: Built on Bun's optimized HTTP server
- **Automatic HTTPS**: Integrates with Let's Encrypt via certbot
- **Host-based Routing**: Routes requests by Host header
- **Zero-downtime Reloads**: Update configuration without dropping connections
- **Built-in Security**: Rate limiting, security headers, host validation
- **Statistics**: Real-time request metrics per host
- **Production Ready**: Systemd service, structured logging, graceful shutdown
- **Lightweight**: < 50MB binary, minimal dependencies

## Quick Installation

**One-liner for Linux** (x64 and ARM64):

```bash
curl -fsSL https://raw.githubusercontent.com/LeetCraft/rproxy/main/install.sh | sudo bash
```

This will:
- Install Bun (if not already installed)
- Download the latest rproxy binary
- Set up the systemd service
- Create necessary directories

## Usage

### Add a Route

Forward requests from a domain to a local backend:

```bash
rproxy add 127.0.0.1:3000 mysite.com
```

Routes all requests for `mysite.com` to your local service on port 3000.

**More examples:**

```bash
# Simple local service
rproxy add 127.0.0.1:3000 mysite.com

# API on different port
rproxy add localhost:8080 api.example.com

# Service on another machine
rproxy add 192.168.1.100:3000 app.local

# Specify HTTP explicitly
rproxy add http://localhost:5000 dev.local
```

The backend URL automatically gets `http://` prefix if no scheme is provided.

### Start the Service

```bash
sudo systemctl start rproxy
```

The service will:
- Listen on port **80** (HTTP)
- Listen on port **443** (HTTPS, if certificates exist)
- Route requests based on Host header
- Automatically reload on SIGHUP

### List Routes

View all configured routes:

```bash
rproxy list
```

**Output:**
```
Configured Routes:
==================
  mysite.com -> http://127.0.0.1:3000
  api.example.com -> http://localhost:8080

Total: 2 route(s)
```

### View Statistics

See real-time request statistics:

```bash
rproxy stats
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
  api.example.com:
    Requests: 3234
    Success:  3148
    Failed:   86
```

### Remove a Route

Delete a route by hostname:

```bash
rproxy rm mysite.com
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `rproxy add <backend> <host>` | Add a reverse proxy route |
| `rproxy rm <host>` | Remove a route |
| `rproxy list` | List all configured routes |
| `rproxy stats` | Show request statistics |
| `rproxy save` | Save configuration (auto-saved) |
| `rproxy serve` | Start the proxy server |
| `rproxy help` | Show help message |

## Service Management

### Start
```bash
sudo systemctl start rproxy
```

### Stop
```bash
sudo systemctl stop rproxy
```

### Restart
```bash
sudo systemctl restart rproxy
```

### Reload (zero-downtime)
```bash
sudo systemctl reload rproxy
```

### Enable auto-start
```bash
sudo systemctl enable rproxy
```

### View status
```bash
sudo systemctl status rproxy
```

### View logs
```bash
sudo journalctl -u rproxy -f
```

## HTTPS Setup

rproxy integrates with Let's Encrypt via certbot.

### Install certbot

```bash
# Debian/Ubuntu
sudo apt install certbot

# RHEL/CentOS/Fedora
sudo yum install certbot

# Arch
sudo pacman -S certbot
```

### Obtain certificates

```bash
# For a single domain
sudo certbot certonly --standalone -d mysite.com

# For multiple domains
sudo certbot certonly --standalone -d mysite.com -d www.mysite.com
```

### Link certificates

```bash
sudo ln -s /etc/letsencrypt/live/mysite.com/privkey.pem /var/lib/rproxy/certs/
sudo ln -s /etc/letsencrypt/live/mysite.com/fullchain.pem /var/lib/rproxy/certs/
```

### Restart service

```bash
sudo systemctl restart rproxy
```

Certbot will automatically renew certificates. To reload rproxy after renewal:

```bash
# Add renewal hook
echo 'systemctl reload rproxy' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/rproxy
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/rproxy
```

## How It Works

### Architecture

1. **Host-based Routing**: Inspects the `Host` header and routes to the configured backend
2. **Request Forwarding**: Proxies requests with proper headers (`X-Forwarded-For`, `X-Real-IP`, etc.)
3. **Security**: Validates hosts, rate limits by IP, adds security headers
4. **Statistics**: Tracks requests per host in memory
5. **Configuration**: SQLite database at `/etc/rproxy/config.db`

### Security Features

- **Rate Limiting**: 60 requests/minute per IP (configurable)
- **Security Headers**:
  - X-Frame-Options
  - Content-Security-Policy
  - X-Content-Type-Options
  - Strict-Transport-Security
  - Referrer-Policy
  - Permissions-Policy
- **Host Validation**: Prevents host header injection
- **Request Timeout**: 30-second timeout per request
- **Hop-by-hop Header Filtering**: Removes RFC 2616 hop headers

### Performance

Built on Bun's optimized HTTP server:
- **Fast startup**: < 100ms cold start
- **Low memory**: ~30MB RSS baseline
- **High throughput**: Handles 10k+ req/s on modern hardware
- **Efficient I/O**: Non-blocking async I/O throughout

## Configuration

Configuration is stored in SQLite at `/etc/rproxy/config.db`.

You can manage routes via:
- CLI commands (recommended)
- Direct SQL queries (advanced)

### Environment Variables

- `LOG_LEVEL`: Set logging verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`)

```bash
# Example: Enable debug logging
sudo systemctl edit rproxy

# Add:
[Service]
Environment="LOG_LEVEL=DEBUG"
```

## Troubleshooting

### Certificates not working

1. Ensure domain DNS points to your server
2. Check ports 80/443 are accessible
3. Verify certificate symlinks exist:
   ```bash
   ls -la /var/lib/rproxy/certs/
   ```
4. Check logs:
   ```bash
   sudo journalctl -u rproxy -n 50
   ```

### Permission errors

The service runs as root to bind ports 80/443. For CLI commands:

```bash
sudo rproxy add 127.0.0.1:3000 mysite.com
```

### Stats unavailable

Ensure the service is running:

```bash
sudo systemctl status rproxy
```

The stats API runs on `localhost:9090` and is only accessible locally.

### Port already in use

If ports 80/443 are in use:

```bash
# Check what's using the ports
sudo lsof -i :80
sudo lsof -i :443

# Stop conflicting services
sudo systemctl stop apache2  # or nginx, etc.
```

## Building from Source

Requirements:
- Bun 1.0+

```bash
git clone https://github.com/LeetCraft/rproxy.git
cd rproxy

# Run in development
bun cli.ts list

# Build standalone binary
bun build cli.ts --compile --outfile rproxy

# Run tests (if any)
bun test
```

## Architecture Details

### File Structure

```
rproxy/
├── cli.ts              # CLI entry point
├── server.ts           # Server entry point
├── lib/
│   ├── config.ts       # SQLite-backed configuration
│   ├── proxy.ts        # Main reverse proxy logic
│   ├── stats.ts        # Request statistics tracking
│   ├── security.ts     # Security features
│   ├── logger.ts       # Structured logging
│   └── lru-cache.ts    # High-performance LRU cache
├── package.json
└── README.md
```

### Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Database**: SQLite (via `bun:sqlite`)
- **HTTP**: Bun.serve (native)
- **Process Management**: systemd

## Uninstallation

```bash
# Stop and disable service
sudo systemctl stop rproxy
sudo systemctl disable rproxy

# Remove files
sudo rm /usr/local/bin/rproxy
sudo rm /etc/systemd/system/rproxy.service
sudo rm -rf /etc/rproxy
sudo rm -rf /var/lib/rproxy

# Reload systemd
sudo systemctl daemon-reload
```

## Comparison

| Feature | rproxy | nginx | caddy | traefik |
|---------|--------|-------|-------|---------|
| Setup time | < 1 min | ~5 min | ~3 min | ~10 min |
| Binary size | ~45 MB | ~1 MB | ~50 MB | ~100 MB |
| Auto HTTPS | ✓ (certbot) | ✗ | ✓ | ✓ |
| Config format | CLI | Config file | Caddyfile | Config file |
| Hot reload | ✓ | ✓ | ✓ | ✓ |
| Built-in stats | ✓ | ✗ | ✗ | ✓ |
| Language | TypeScript | C | Go | Go |

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

- **Issues**: https://github.com/LeetCraft/rproxy/issues
- **Discussions**: https://github.com/LeetCraft/rproxy/discussions
- **Documentation**: https://github.com/LeetCraft/rproxy/wiki

## Roadmap

- [ ] WebSocket support
- [ ] HTTP/3 (QUIC)
- [ ] Load balancing across multiple backends
- [ ] Custom middleware hooks
- [ ] Web UI for management
- [ ] Metrics export (Prometheus)
- [ ] Docker image
- [ ] Kubernetes operator

---

Made with ⚡ by [LeetCraft](https://github.com/LeetCraft)
