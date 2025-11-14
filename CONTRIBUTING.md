# Contributing Guide

Thanks for helping build the AI Tooltip extension! This guide outlines the workflow we follow to keep the project healthy.

## Getting Set Up

1. Clone the repository and run `npm install`.
2. Copy `config.sample.js` to `config.js` and add your development API key/OAuth client ID (file is gitignored).
3. Load the unpacked extension from the `dist/` directory after running `npm run build`.

## Development Workflow

- Use feature branches named `feature/<topic>` or `chore/<topic>`.
- Run `npm run typecheck`, `npm run lint`, and `npm run build` before opening a pull request.
- Keep pull requests focused; open follow-ups for backlog items rather than mixing concerns.

## Code Style

- TypeScript lives in `src/` (scaffolding is in progress). Avoid adding new logic to the legacy plain-JS files.
- Follow ESLint/Prettier output for formatting. Configure your editor to format on save when possible.
- Add inline documentation when logic is non-trivial or when handling browser quirks.

## Testing

- Smoke test the Chrome extension flows you touch (image hover, context menu summarization, popup settings).
- When automated tests land, include or update coverage for new behavior.

## Security & Privacy

- Never commit real API keys or OAuth credentials. Use `.env`-style local overrides or the provided `config.js`.
- Call out any data-handling changes in your PR description and update the privacy documentation if needed.

## Communication

- Use GitHub issues to discuss roadmap items and link them in PR descriptions.
- If you hit blockers, open a draft PR or discussion thread early so we can resolve them together.
