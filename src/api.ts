import Anthropic from '@anthropic-ai/sdk';

interface CSSGenerationRequest {
  fileId: string;
  prompt: string;
}

interface CSSGenerationResponse {
  css: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cost: number;
  };
}

interface FileUploadResponse {
  fileId: string;
}

interface Model {
  id: string;
  display_name: string;
  type: string;
}

interface ModelsResponse {
  data: Model[];
}

// Model pricing per million tokens
const MODEL_PRICING: Record<string, { 
  input: number; 
  output: number; 
  cache_5m: number; 
  cache_1h: number; 
  cache_hits: number; 
}> = {
  'claude-opus-4-20241022': { 
    input: 15, 
    output: 75, 
    cache_5m: 18.75, 
    cache_1h: 30, 
    cache_hits: 1.50 
  },
  'claude-sonnet-4-20250514': { 
    input: 3, 
    output: 15, 
    cache_5m: 3.75, 
    cache_1h: 6, 
    cache_hits: 0.30 
  },
  'claude-3-5-sonnet-20241022': { 
    input: 3, 
    output: 15, 
    cache_5m: 3.75, 
    cache_1h: 6, 
    cache_hits: 0.30 
  },
  'claude-3-5-haiku-20241022': { 
    input: 0.80, 
    output: 4, 
    cache_5m: 1, 
    cache_1h: 1.6, 
    cache_hits: 0.08 
  },
  'claude-3-opus-20240229': { 
    input: 15, 
    output: 75, 
    cache_5m: 18.75, 
    cache_1h: 30, 
    cache_hits: 1.50 
  },
  'claude-3-haiku-20240307': { 
    input: 0.25, 
    output: 1.25, 
    cache_5m: 0.30, 
    cache_1h: 0.50, 
    cache_hits: 0.03 
  },
  // Default fallback pricing (use Sonnet 3.5 rates)
  'default': { 
    input: 3, 
    output: 15, 
    cache_5m: 3.75, 
    cache_1h: 6, 
    cache_hits: 0.30 
  }
};

function calculateCost(
  model: string, 
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  }
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  
  let cacheCost = 0;
  
  // Cache creation costs
  if (usage.cache_creation) {
    if (usage.cache_creation.ephemeral_5m_input_tokens) {
      cacheCost += (usage.cache_creation.ephemeral_5m_input_tokens / 1_000_000) * pricing.cache_5m;
    }
    if (usage.cache_creation.ephemeral_1h_input_tokens) {
      cacheCost += (usage.cache_creation.ephemeral_1h_input_tokens / 1_000_000) * pricing.cache_1h;
    }
  }
  
  // Cache read costs (hits)
  if (usage.cache_read_input_tokens) {
    cacheCost += (usage.cache_read_input_tokens / 1_000_000) * pricing.cache_hits;
  }
  
  return inputCost + outputCost + cacheCost;
}

export class AnthropicService {
  private client: Anthropic | null = null;
  private apiKey: string | null = null;

  async initialize(): Promise<boolean> {
    try {
      const result = await chrome.storage.sync.get(['anthropicApiKey']);
      const apiKey = result.anthropicApiKey;
      
      if (!apiKey) {
        throw new Error('API key not found');
      }

      this.apiKey = apiKey;
      this.client = new Anthropic({
        apiKey: apiKey,
        dangerouslyAllowBrowser: true,
      });
      
      return true;
    } catch (error) {
      console.error('Failed to initialize Anthropic client:', error);
      return false;
    }
  }

  async uploadHTML(html: string): Promise<FileUploadResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    // Create a plaintext file from the HTML string (Files API only supports PDF and plaintext)
    const blob = new Blob([html], { type: 'text/plain' });
    const file = new File([blob], 'page.txt', { type: 'text/plain' });

    const uploadResponse = await this.client.beta.files.upload({
      file: file,
      betas: ['files-api-2025-04-14']
    });

    return {
      fileId: uploadResponse.id
    };
  }

  async generateCSS(request: CSSGenerationRequest): Promise<CSSGenerationResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    const systemPromptText = `You are a CSS expert. Given an HTML page and a user request, generate CSS rules that will apply the requested changes to the page. 

CRITICAL: Respond with CSS rules ONLY. Do not include any explanations, descriptions, or text outside of CSS rules.

Guidelines:
- Return ONLY CSS rules - no explanations, no descriptions, no markdown formatting, no code fences
- DO NOT include any text before or after the CSS rules
- DO NOT explain what the CSS does
- DO NOT wrap your response in \`\`\`css or any other markdown formatting
- Use highly specific selectors to override existing styles (e.g., html body element, or multiple class selectors)
- ALWAYS use !important to ensure styles override existing CSS
- Consider the page structure when choosing selectors
- Use maximum specificity to ensure your styles take precedence
- Keep changes minimal and focused on the request
- For elements like code, pre, use selectors like "html body code, html body pre" for higher specificity
- When changing background-color, ALWAYS include background-image: none !important to remove any existing background images
- When changing the main content/text width, always override the width/max-width of the body element

Your response must contain ONLY valid CSS rules and nothing else.`;

    if (!request.fileId) {
      throw new Error('File ID is required - HTML must be uploaded first');
    }

    const message = request.prompt;

    // Get the selected model from storage, default to haiku
    const modelResult = await chrome.storage.sync.get(['selectedModel']);
    const selectedModel = modelResult.selectedModel;

    const response = await this.client.beta.messages.create({
      model: selectedModel,
      max_tokens: 1024,
      system: systemPromptText,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'file',
                file_id: request.fileId
              },
              cache_control: {
                type: 'ephemeral'
              }
            },
            {
              type: 'text',
              text: message
            }
          ]
        }
      ],
      betas: ['files-api-2025-04-14']
    });

    const cssContent = response.content[0];
    if (cssContent.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Clean up the CSS response - remove explanations and extract only CSS rules
    let cleanCSS = cssContent.text.trim();
    
    // Remove code fences if they exist
    cleanCSS = cleanCSS.replace(/^```css\s*/gm, '');
    cleanCSS = cleanCSS.replace(/^```\s*/gm, '');
    cleanCSS = cleanCSS.replace(/```$/gm, '');
    
    // Extract CSS rules by finding the first CSS selector and the last closing brace
    const lines = cleanCSS.split('\n');
    let startIndex = -1;
    let endIndex = -1;
    
    // Find the first line that looks like a CSS selector or rule
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Look for CSS selectors or at-rules
      if (line.includes('{') || line.match(/^[a-zA-Z0-9\s\-_#.,>+~\[\]:()@]+\s*{?/) && (line.includes(':') || line.includes('{'))) {
        startIndex = i;
        break;
      }
    }
    
    // Find the last closing brace
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.includes('}')) {
        endIndex = i;
        break;
      }
    }
    
    // Extract only the CSS portion
    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
      const cssLines = lines.slice(startIndex, endIndex + 1);
      cleanCSS = cssLines.join('\n').trim();
    }
    
    // Calculate cost
    const cost = calculateCost(selectedModel, response.usage);
    
    // Track usage for this request
    await this.trackUsage(selectedModel, response.usage, cost);
    
    return {
      css: cleanCSS.trim(),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
        cost: cost
      }
    };
  }

  async getAvailableModels(): Promise<Model[]> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const response = await this.client.models.list({ limit: 1000 });

      // Filter for models that can be used for messages (type 'model')
      return response.data
        .filter(model => model.type === 'model')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map(model => ({
          id: model.id,
          display_name: model.display_name,
          type: 'message' // Convert to our expected type
        }));
    } catch (error) {
      console.error('Failed to fetch models:', error);
      throw error;
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      await this.client.beta.files.delete(fileId, {
        betas: ['files-api-2025-04-14']
      });
    } catch (error) {
      console.warn('Failed to delete file:', error);
    }
  }

  async trackUsage(model: string, usage: any, cost: number): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const storageKey = `pagemagic_usage_${today}`;
      
      const result = await chrome.storage.local.get([storageKey, 'pagemagic_total_usage']);
      const dailyUsage = result[storageKey] || { requests: 0, totalCost: 0, models: {} };
      const totalUsage = result.pagemagic_total_usage || { totalCost: 0, totalRequests: 0, models: {} };
      
      // Update daily usage
      dailyUsage.requests += 1;
      dailyUsage.totalCost += cost;
      
      if (!dailyUsage.models[model]) {
        dailyUsage.models[model] = { requests: 0, cost: 0, tokens: { input: 0, output: 0 } };
      }
      dailyUsage.models[model].requests += 1;
      dailyUsage.models[model].cost += cost;
      dailyUsage.models[model].tokens.input += usage.input_tokens;
      dailyUsage.models[model].tokens.output += usage.output_tokens;
      
      // Update total usage
      totalUsage.totalCost += cost;
      totalUsage.totalRequests += 1;
      
      // Update total usage by model
      if (!totalUsage.models[model]) {
        totalUsage.models[model] = { requests: 0, cost: 0, tokens: { input: 0, output: 0 } };
      }
      totalUsage.models[model].requests += 1;
      totalUsage.models[model].cost += cost;
      totalUsage.models[model].tokens.input += usage.input_tokens;
      totalUsage.models[model].tokens.output += usage.output_tokens;
      
      await chrome.storage.local.set({
        [storageKey]: dailyUsage,
        pagemagic_total_usage: totalUsage
      });
    } catch (error) {
      console.warn('Failed to track usage:', error);
    }
  }

  async getTotalUsage(): Promise<{ totalCost: number; totalRequests: number; models: any }> {
    try {
      const result = await chrome.storage.local.get(['pagemagic_total_usage']);
      return result.pagemagic_total_usage || { totalCost: 0, totalRequests: 0, models: {} };
    } catch (error) {
      console.warn('Failed to get total usage:', error);
      return { totalCost: 0, totalRequests: 0, models: {} };
    }
  }

  async getDailyUsage(date?: string): Promise<any> {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      const storageKey = `pagemagic_usage_${targetDate}`;
      const result = await chrome.storage.local.get([storageKey]);
      return result[storageKey] || { requests: 0, totalCost: 0, models: {} };
    } catch (error) {
      console.warn('Failed to get daily usage:', error);
      return { requests: 0, totalCost: 0, models: {} };
    }
  }
}

export const anthropicService = new AnthropicService();