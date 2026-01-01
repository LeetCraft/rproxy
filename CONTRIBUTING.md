# Contributing to rproxy

Thank you for your interest in contributing to rproxy!

## Development Setup

1. Install Bun:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. Clone the repository:
   ```bash
   git clone https://github.com/LeetCraft/rproxy.git
   cd rproxy
   ```

3. Run in development:
   ```bash
   # Test CLI
   bun cli.ts help

   # Run server (needs sudo for ports 80/443)
   sudo bun server.ts
   ```

## Project Structure

```
lib/
├── config.ts       # SQLite configuration management
├── proxy.ts        # Main reverse proxy logic
├── stats.ts        # Request statistics
├── security.ts     # Security features (rate limiting, headers)
├── logger.ts       # Structured logging
└── lru-cache.ts    # High-performance LRU cache

cli.ts              # CLI entry point
server.ts           # Server entry point
```

## Code Style

- Use TypeScript with strict mode
- Follow existing patterns and naming conventions
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Prefer composition over inheritance

## Testing

```bash
# Run tests
bun test

# Test CLI locally
bun cli.ts add localhost:3000 test.local
bun cli.ts list
bun cli.ts rm test.local
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Commit with descriptive message
5. Push to your fork
6. Create a Pull Request

## Guidelines

- One feature/fix per PR
- Update README if adding new features
- Ensure no breaking changes (or clearly document them)
- Add comments for complex logic

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
