import Anthropic from '@anthropic-ai/sdk';

interface CSSGenerationRequest {
  fileId: string;
  prompt: string;
}

interface CSSGenerationResponse {
  css: string;
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

    const systemPrompt = `You are a CSS expert. Given an HTML page and a user request, generate CSS rules that will apply the requested changes to the page. 

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

    const messageContent: any[] = [
      { type: 'text', text: `User request: ${request.prompt}\n\nGenerate CSS rules to fulfill this request based on the HTML file:` },
      { 
        type: 'document', 
        source: { 
          type: 'file', 
          file_id: request.fileId 
        }
      }
    ];

    // Get the selected model from storage, default to haiku
    const modelResult = await chrome.storage.sync.get(['selectedModel']);
    const selectedModel = modelResult.selectedModel;

    const response = await this.client.beta.messages.create({
      model: selectedModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: messageContent
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
    
    return {
      css: cleanCSS.trim()
    };
  }

  async getAvailableModels(): Promise<Model[]> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const response = await this.client.models.list();

      // Filter for models that can be used for messages (type 'model')
      return response.data
        .filter(model => model.type === 'model')
        .map(model => ({
          id: model.id,
          display_name: model.display_name,
          type: 'message' // Convert to our expected type
        }));
    } catch (error) {
      console.error('Failed to fetch models:', error);
      // Return default models if API call fails
      return [
        { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet', type: 'message' },
        { id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku', type: 'message' },
        { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus', type: 'message' }
      ];
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
}

export const anthropicService = new AnthropicService();