---
"@askif/anthropic": minor
---

Initial release of `@askif/anthropic`: a backend for Anthropic's Messages API (Claude). Probabilities come back as JSON through structured outputs (`output_config.format`, the default) or, with `structuredOutput: "tool"`, as the input of one strict tool. Images are sent as image blocks, and `imageUrl()` images are passed as URLs when talking to Anthropic itself. Not yet verified against the live API.
