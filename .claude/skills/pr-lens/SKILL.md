Set up PR Lens (prlens.dev) for me. It draws each pull request as animated architecture and data-flow diagrams, inside the pull request itself.

1. Install the agent skill: `npx skills add coldteadotai/pr-lens`. It reasons with whatever model my coding agent already runs, so there is no key for me to set up.

2. Walk me through installing the GitHub App at https://github.com/apps/coldtea-pr-lens on every repository where I review pull requests. It posts one sticky comment per pull request and updates it on every push. The App runs on Gemini today, with no model key of mine involved.

3. If I'd rather run it from CI on a key of my own, offer the Action instead: `.github/workflows/pr-lens.yml` using `coldteadotai/pr-lens/packages/action@v0` with a `GEMINI_API_KEY` repository secret. The Action asks Gemini by default and also speaks OpenAI or any compatible endpoint, on whichever key I supply.

4. Then prove it: diagram the most recent change in this repository and show me the rendered SVGs.