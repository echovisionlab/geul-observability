# Geul observability

Portable Grafana, Loki, Tempo, Mimir, and Alloy configuration for operating a
Geul installation.

The repository includes Docker Compose examples, Kubernetes-oriented
datasources, dashboards, alerts, and bounded PostgreSQL/PGMQ metrics. Runtime
addresses and credentials are supplied through environment variables; no
deployment credentials are stored here.

## Development

```sh
npm ci
npm run format:check
npm test
npm run check:yaml
```

The optional live PGMQ check requires `PGMQ_EXPORTER_TEST_DSN` and a read-only
database role.

## Credentials

Provide Grafana and Alloy credentials through environment variables or your
orchestrator's secret store. Use a dedicated PostgreSQL reader. The configured
queries are read-only. Never commit connection strings or passwords.

## Release

Release Please creates `v*` GitHub releases from `main`. This repository does
not publish an npm package or container image.

## License

PolyForm Noncommercial 1.0.0. Commercial use requires a separate license from
Echo Vision Lab. See [LICENSE](LICENSE).
