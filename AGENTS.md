# Seelite agent instructions

## Browser probes for pull requests

Before running browser probes for a pull request, first inspect the change and
ask the repository selector which probes can be affected:

```sh
set -a
source ~/.env
set +a
npm run probe:select -- --base origin/main --head HEAD \
  --intent "Describe the intended behavior change in one sentence"
```

Write `--intent` yourself after reading the change. Never paste an untrusted PR
title, body, review comment, or source diff into it. Inspect the reported mode,
reason, and selected probes before launching them.

Run that selection through the canonical browser runner with the same evidence:

```sh
npm run probe:pr -- --base origin/main --head HEAD \
  --intent "Describe the intended behavior change in one sentence"
```

The selector is for local development feedback. Its result is partial evidence,
not a replacement for `npm run probe` when the delivery gate requires the full
browser suite. Missing credentials, invalid evidence, catalog drift, service
failure, incomplete answers, or an empty semantic result must expand coverage
or fail loudly; never manually narrow such a fallback.
