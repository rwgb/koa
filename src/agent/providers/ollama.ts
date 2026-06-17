import { OpenAICompatibleProvider, stripCacheControl, toOpenAIMessages, fromOpenAIResponse as _fromOpenAIResponse, toOpenAITools } from './openai_compatible.js';
export { stripCacheControl, toOpenAIMessages, toOpenAITools };

// Preserve "Ollama" prefix in error messages for backward compat with existing imports.
export function fromOpenAIResponse(data: unknown, model: string): ReturnType<typeof _fromOpenAIResponse> {
  return _fromOpenAIResponse(data, model, 'Ollama');
}

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(baseUrl: string = 'http://localhost:11434') {
    super(baseUrl, undefined, 'Ollama');
  }
}
