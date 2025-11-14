# AI-Powered Tooltip Chrome Extension

This project injects intelligent tooltips into any page, providing OCR summaries, AI-powered text processing, and a simple popup for managing usage limits.

## Getting Started

- Clone the repo and install as an unpacked Chrome extension from the `ai-tooltip-extension` directory.
- Copy `config.sample.js` to `config.js` (gitignored) and fill in your test OpenAI key and Google OAuth client ID.
- Reload the extension and run the image-hover and context-menu summarize flows as a smoke test.

## Planned Upgrades

- **Tooltip engine**: add unified hover handling for text, image, and code elements with debouncing, caching, and cancellation.
- **Text processing**: implement automatic paragraph summarization, language detection, and translation tooltips.
- **Code features**: detect code blocks and screenshots, format extracted code, and enable optional code explanations via LLM.
- **Q&A interactions**: add an “Ask” action within tooltips for contextual follow-up questions.
- **OCR pipeline**: replace the mock implementation with PaddleOCR WebAssembly and tune performance targets.
- **Settings & privacy**: extend the popup with toggles for local-only mode, target language, and API usage indicators.

## Contributing

Open issues or pull requests with clear descriptions and repro steps. Keep secrets out of version control and follow Chrome extension best practices for security and performance.
