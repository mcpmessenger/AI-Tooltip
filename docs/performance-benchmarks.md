# Performance Benchmarks

These targets help us validate the responsiveness and resource profile of the extension as we iterate.

## Latency Goals

- **Text hover pipeline**: render pre-processed tooltip content in under **300 ms** on a modern laptop.
- **Image/OCR pipeline**: deliver initial OCR text in under **700 ms** for 720p images; surface loading state within 100 ms.
- **Contextual Q&A**: acknowledge button press instantly and return the first answer chunk within **2 s** (network permitting).

## Resource Budgets

- **Memory**: keep loaded PaddleOCR models under **50 MB**; unload when idle for more than 60 s.
- **CPU**: avoid sustained usage above **50 %** for more than 500 ms per interaction.

## Operational Controls

- Cache hover results for 30 s to avoid repeated OCR/LLM calls on the same element.
- Throttle hover processing to one active pipeline per pointer; queue or cancel redundant requests.

## Measurement Plan

- Automate latency capture via Puppeteer smoke tests and `performance.now()` markers.
- Run manual spot-checks on Chrome stable (Windows + macOS) and collect metrics before each release.
