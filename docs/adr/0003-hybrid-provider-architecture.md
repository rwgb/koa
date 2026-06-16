# ADR-0003: Hybrid Provider Architecture (Named + Generic OpenAI-Compatible)

## Status
Accepted

## Context
Koa supports four provider values: `anthropic`, `ollama`, `claude-code`, and `auto`. Users wanted support for additional LLM providers (OpenAI, Groq, OpenRouter, Google Gemini, Together AI, etc.) configurable via the web UI.

Two approaches were considered:
1. Named providers — each provider gets its own config block and class
2. Hybrid — named providers only for genuinely different backends; a generic `openai-compatible` class for everything else

The existing `OllamaProvider` already implements a full OpenAI-compatible translation layer (`toOpenAIMessages`, `toOpenAITools`, `fromOpenAIResponse`). This layer is reusable for any provider that speaks the OpenAI `/v1/chat/completions` API.

## Decision
Four provider types:

| Type | Implementation | Covers |
|------|---------------|--------|
| `anthropic` | `AnthropicProvider` | Claude models via Anthropic API; caching, extended thinking |
| `claude-code` | `ClaudeCodeProvider` | Subscription auth via CLI subprocess |
| `google` | new `GoogleProvider` | Gemini models; requires separate SDK (not OpenAI-compatible) |
| `openai-compatible` | generalized `OllamaProvider` | Ollama, OpenRouter, Groq, Together, Fireworks, vLLM, OpenAI direct |

`OllamaProvider` is renamed `OpenAICompatibleProvider` and accepts `baseUrl`, `apiKey`, and `modelList` as constructor parameters. Ollama becomes a preset (baseUrl: `http://localhost:11434`, no apiKey) rather than a separate provider type.

The web UI for `openai-compatible` offers presets (OpenRouter, Groq, Together, OpenAI, Ollama, custom) that pre-fill the base URL.

## Consequences
- Adding new OpenAI-compatible providers requires no code changes — only a new preset entry in the web UI.
- Google Gemini requires a new SDK dependency and a dedicated provider class.
- The smart router's Haiku classifier only works with the `anthropic` provider. Other providers fall back to regex-based classification.
- Model tier mapping (fast/standard/powerful) is per-provider config, not global, since tier-to-model mappings differ across providers.
- `auto` and `claude-code` are now first-class options in the web UI; the previous type mismatch between `KoaConfig` and `AdminConfig` is resolved.
