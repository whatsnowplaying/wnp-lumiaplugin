# Contributing

## Architecture

The plugin connects to What's Now Playing via the `/wsstream` WebSocket endpoint
(available since WNP 3.0.0). WNP pushes full metadata JSON on connect and on every
track change, and sends `{"last": true}` on shutdown.

### Connection lifecycle

* `onload()` — discover WNP via mDNS (or use manual host/port), version handshake, connect
* `onunload()` — disconnect cleanly, cancel any pending reconnect timer
* `onupdate()` — log only
* `onsettingsupdate()` — disconnect and reconnect if host or port changed

Reconnection uses exponential backoff starting at `RECONNECT_BASE_MS`, doubling up to
`RECONNECT_MAX_MS`, then retries indefinitely at that interval. The retry counter resets
on a successful WebSocket `onopen`.

### Adding a variable

Variables must be declared in three places:

1. The `VARS` array in `main.js`
2. The `_extractVars()` return object in `main.js`
3. `manifest.json` — both `config.variables` and `config.alerts[0].acceptedVariables`

Variable names match WNP metadb field names exactly. See the
[WNP template variable reference](https://whatsnowplaying.github.io/whats-now-playing/latest/reference/templatevariables/)
for the full field list.

## Local validation and build

These require Node.js and the [Lumia Plugin SDK](https://github.com/lumiastream/Plugin-SDK).

```bash
# clone the SDK alongside this repo
git clone https://github.com/lumiastream/Plugin-SDK lumia-plugin-sdk
npm install --prefix lumia-plugin-sdk/cli

# validate manifest and hook coverage
node lumia-plugin-sdk/cli/scripts/cli.js validate .
node lumia-plugin-sdk/scripts/plugin-audit.js .

# build the .lumiaplugin archive
node lumia-plugin-sdk/cli/scripts/cli.js build .
```

CI runs validate and audit on every push and pull request, and runs build on release tags.

## Release process

Push a tag in the form `vX.Y.Z`. The release workflow validates, audits, stamps the version
into `manifest.json`, builds the `.lumiaplugin` archive, and attaches it to the GitHub release.
