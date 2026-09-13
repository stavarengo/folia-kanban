# Security

Report a vulnerability privately from this repository's **Security** tab, with **Report a vulnerability**. That opens an advisory only the maintainer can read, and it is the right place for anything exploitable — please do not open a public issue for one.

There is one maintainer and no rota behind them, so a first reply can take a few days.

The plugin bundles its runtime dependencies into `main.js`, so an advisory against one of them is an advisory against a shipped release. Published advisories already arrive as Dependabot alerts and need no report. Anything Dependabot cannot see is worth reporting: an unpublished flaw in a bundled dependency, or one that only bites through the way this plugin calls it.
