# Tools

Each directory in `tools/` is a standalone or near-standalone CLI utility.

This repository is expected to keep growing over time. New tools should be
small, practical, documented, and easy to run locally.

## Current Tools

- [`tokkit/`](tokkit/README.md): local-first usage ledger for AI coding tools,
  with token/cost tracking, CLI reports, HTML reports, client coverage views,
  budgets, pricing overrides, and scan adapters for multiple coding assistants.
- [`tokscr/`](tokscr/README.md): Chrome MV3 webpage screenshot extension with
  full-page, visible-area, selected-area, and main-content capture modes.
- [`yao-scai-cli/`](yao-scai-cli/README.md): AI-native disk space scanner and
  advisor with CLI/TUI workflows.

## Suggested Tool Structure

```text
tools/<tool-name>/
  README.md
  pyproject.toml, package.json, manifest.json, or equivalent project metadata
  src/ or bin/
  tests/
  docs/
```

## Tool Standards

- Each tool should have a clear problem statement.
- Each tool should document installation, quick start, and common commands.
- Dependencies should be explicit and minimal.
- Local-first behavior is preferred when the tool handles private data.
- Examples and screenshots should be stored under that tool's `docs/assets/`
  directory when useful.
