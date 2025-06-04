// pagemagic-main/src/api.ts

// Supprimer: import Anthropic from '@anthropic-ai/sdk';

interface CSSGenerationRequest {
  htmlContent: string; // Modifié: plus de fileId, on envoie le HTML directement
  prompt: string;
}

interface CSSGenerationResponse {
  css: string;
  usage?: {
    prompt_tokens: number;     // Modifié
    completion_tokens: number; // Modifié
    total_tokens: number;      // Modifié
    cost: number;              // Calculé par nous si nécessaire, OpenRouter le donne souvent
  };
}

// FileUploadResponse n'est plus nécessaire
// interface FileUploadResponse {
//   fileId: string;
// }

interface Model {
  id: string;           // L'ID du modèle OpenRouter (ex: "anthropic/claude-3-haiku")
  display_name: string; // Le nom lisible (ex: "Anthropic: Claude 3 Haiku")
  // type: string; // Moins pertinent pour OpenRouter de cette manière
}

// ModelsResponse est ce que OpenRouter renvoie directement
// interface ModelsResponse {
//   data: Model[];
// }

const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
// Mettez une URL de référence pour votre extension, ou laissez vide si ce n'est pas strict.
const YOUR_SITE_URL = "chrome-extension://" + chrome.runtime.id;
const YOUR_APP_NAME = "PageMagic Chrome Extension";


// MODEL_PRICING et calculateCost ne sont plus nécessaires comme avant,
// car les modèles gratuits auront un coût de 0.
// Si vous décidez d'inclure des modèles payants, vous pourrez récupérer
// les infos de pricing de l'API /models d'OpenRouter.

export class OpenRouterService {
  private apiKey: string | null = null;

  async initialize(): Promise<boolean> {
    try {
      // Modifié: anthropicApiKey -> openRouterApiKey
      const result = await chrome.storage.sync.get(['openRouterApiKey']);
      const apiKey = result.openRouterApiKey;
      
      if (!apiKey) {
        console.warn('OpenRouter API key not found in storage.');
        this.apiKey = null;
        return false; // Indiquer que l'initialisation a échoué ou est partielle
      }

      this.apiKey = apiKey;
      return true;
    } catch (error) {
      console.error('Failed to initialize OpenRouter service:', error);
      this.apiKey = null;
      return false;
    }
  }

  // uploadHTML n'est plus nécessaire, le HTML sera inclus dans le prompt
  // async uploadHTML(html: string): Promise<FileUploadResponse> { ... }

  async generateCSS(request: CSSGenerationRequest): Promise<CSSGenerationResponse> {
    if (!this.apiKey) {
      // Essayer de réinitialiser si la clé n'est pas là (par exemple, si elle a été définie après le premier chargement)
      const initialized = await this.initialize();
      if(!initialized || !this.apiKey) {
          throw new Error('OpenRouter API key not configured. Please check settings.');
      }
    }

    const systemPromptText = `You are an expert CSS generator. Given the HTML content of a web page and a user's request, you must generate ONLY the CSS code that implements the requested changes.

    CRITICAL INSTRUCTIONS:
    1.  Respond with VALID CSS rules ONLY.
    2.  Do NOT include any explanations, descriptions, or any text outside of the CSS rules.
    3.  Do NOT wrap your response in \`\`\`css, \`\`\`, or any other markdown formatting or code fences.
    4.  Use highly specific selectors to ensure styles override existing page styles (e.g., \`html body .some-class > .another-class\`).
    5.  ALWAYS use \`!important\` on every CSS declaration to maximize the chance of overriding existing styles.
    6.  Consider the provided HTML structure carefully when choosing selectors.
    7.  Keep changes minimal and strictly focused on fulfilling the user's prompt.
    8.  For elements like \`code\` or \`pre\`, use selectors like "html body code, html body pre" for higher specificity.
    9.  When changing \`background-color\`, ALWAYS include \`background-image: none !important;\` to remove any existing background images that might interfere.
    10. When asked to change the main content width or text width, typically target the \`body\` element or a primary wrapper div, overriding its \`width\` and/or \`max-width\`.

    The user will provide the HTML content and their specific request. Your entire output must be CSS code and nothing else.`;

    // Get the selected model from storage
    const modelResult = await chrome.storage.sync.get(['selectedModel']);
    const selectedModel = modelResult.selectedModel;
    if (!selectedModel) {
        throw new Error('No model selected. Please select a model in settings.');
    }

    const userMessageContent = `Here is the HTML of the page:\n\n\`\`\`html\n${request.htmlContent}\n\`\`\`\n\nMy request is: ${request.prompt}`;

    const response = await fetch(`${OPENROUTER_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': YOUR_SITE_URL, // Optionnel mais recommandé
        'X-Title': YOUR_APP_NAME,      // Optionnel mais recommandé
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPromptText },
          { role: 'user', content: userMessageContent }
        ],
        max_tokens: 2048, // Augmenté un peu, car le HTML est dans le prompt
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("OpenRouter API Error:", response.status, errorData);
      const detail = errorData.error?.message || response.statusText || "Unknown API error";
      if (response.status === 401) {
        throw new Error(`Authentication failed (401). Check your OpenRouter API key. Details: ${detail}`);
      }
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded (429) for model ${selectedModel}. Details: ${detail}`);
      }
      throw new Error(`API request failed with status ${response.status}: ${detail}`);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0 || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response structure from OpenRouter API');
    }

    let cleanCSS = data.choices[0].message.content.trim();
    
    // Nettoyage du CSS (similaire à avant)
    cleanCSS = cleanCSS.replace(/^```css\s*/gm, '');
    cleanCSS = cleanCSS.replace(/^```\s*/gm, '');
    cleanCSS = cleanCSS.replace(/```$/gm, '');
    
    const lines = cleanCSS.split('\n');
    let startIndex = -1;
    let endIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('{') || line.match(/^[a-zA-Z0-9\s\-_#.,>+~\[\]:()@]+\s*{?/) && (line.includes(':') || line.includes('{'))) {
        startIndex = i;
        break;
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().includes('}')) {
        endIndex = i;
        break;
      }
    }
    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
      cleanCSS = lines.slice(startIndex, endIndex + 1).join('\n').trim();
    }
    
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    
    // Pour les modèles gratuits, le coût est 0.
    // Si vous ajoutez des modèles payants, vous devrez chercher le prix du modèle
    // dans les données de /models et le multiplier par usage.total_tokens / 1_000_000 (ou par 1k tokens)
    const cost = data.usage?.total_tokens && data.choices[0].model_info?.pricing?.completion // Exemple très simplifié
                 ? (parseFloat(data.choices[0].model_info.pricing.completion) / 1000 * data.usage.completion_tokens) +
                   (parseFloat(data.choices[0].model_info.pricing.prompt) / 1000 * data.usage.prompt_tokens)
                 : 0;


    await this.trackUsage(selectedModel, usage, cost);
    
    return {
      css: cleanCSS.trim(),
      usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cost: cost
      }
    };
  }

  async getAvailableModels(): Promise<Model[]> {
    if (!this.apiKey) {
      // Essayer de réinitialiser si la clé n'est pas là
      const initialized = await this.initialize();
      if(!initialized || !this.apiKey) {
          console.warn('Cannot fetch models without API key.');
          return []; // Retourner un tableau vide si la clé n'est pas disponible
      }
    }

    try {
      const response = await fetch(`${OPENROUTER_API_BASE_URL}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("OpenRouter /models API Error:", response.status, errorData);
        throw new Error(`Failed to fetch models (${response.status}): ${errorData.error?.message || response.statusText}`);
      }

      const modelsResponse = await response.json();
      
      if (!modelsResponse.data || !Array.isArray(modelsResponse.data)) {
        throw new Error('Invalid response structure from OpenRouter /models API');
      }
      
      return modelsResponse.data
        .filter((model: any) => model.name && model.name.toLowerCase().includes('(free)')) // Filtrer par nom contenant "(free)"
        .map((model: any) => ({
          id: model.id, // ex: "anthropic/claude-3-haiku"
          display_name: model.name, // ex: "Anthropic: Claude 3 Haiku (free)"
        }))
        .sort((a: Model, b: Model) => a.display_name.localeCompare(b.display_name)); // Trier par nom
    } catch (error) {
      console.error('Failed to fetch models from OpenRouter:', error);
      throw error; // Propager l'erreur pour que l'appelant puisse la gérer
    }
  }

  // deleteFile n'est plus nécessaire
  // async deleteFile(fileId: string): Promise<void> { ... }

  async trackUsage(model: string, usage: any, cost: number): Promise<void> {
    // Cette fonction peut rester similaire, mais les tokens sont nommés différemment
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const storageKey = `pagemagic_usage_${today}`;
      
      const result = await chrome.storage.local.get([storageKey, 'pagemagic_total_usage']);
      const dailyUsage = result[storageKey] || { requests: 0, totalCost: 0, models: {} };
      const totalUsage = result.pagemagic_total_usage || { totalCost: 0, totalRequests: 0, models: {} };
      
      dailyUsage.requests += 1;
      dailyUsage.totalCost += cost;
      
      if (!dailyUsage.models[model]) {
        dailyUsage.models[model] = { requests: 0, cost: 0, tokens: { prompt: 0, completion: 0 } };
      }
      dailyUsage.models[model].requests += 1;
      dailyUsage.models[model].cost += cost;
      dailyUsage.models[model].tokens.prompt += usage.prompt_tokens || 0;
      dailyUsage.models[model].tokens.completion += usage.completion_tokens || 0;
      
      totalUsage.totalCost += cost;
      totalUsage.totalRequests += 1;
      
      if (!totalUsage.models[model]) {
        totalUsage.models[model] = { requests: 0, cost: 0, tokens: { prompt: 0, completion: 0 } };
      }
      totalUsage.models[model].requests += 1;
      totalUsage.models[model].cost += cost;
      totalUsage.models[model].tokens.prompt += usage.prompt_tokens || 0;
      totalUsage.models[model].tokens.completion += usage.completion_tokens || 0;
      
      await chrome.storage.local.set({
        [storageKey]: dailyUsage,
        pagemagic_total_usage: totalUsage
      });
    } catch (error) {
      console.warn('Failed to track usage:', error);
    }
  }

  // getTotalUsage et getDailyUsage peuvent rester les mêmes structurellement.
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

// Modifié: anthropicService -> openRouterService
export const openRouterService = new OpenRouterService();
