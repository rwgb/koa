import { OpenAICompatibleProvider } from './openai_compatible.js';

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export class GoogleProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string) {
    super(GOOGLE_BASE_URL, apiKey);
  }
}
