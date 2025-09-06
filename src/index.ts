#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

const GEMINI_MODEL = 'google/gemini-2.5-flash-image-preview';

interface ImageGenerationArgs {
  prompt: string;
  save_to_file?: boolean;
  filename?: string;
  show_full_response?: boolean;
}

type ImageInput = {
  url?: string; // http(s) URL or data URL
  b64_json?: string; // DALL-E style base64 (no data: prefix)
  base64?: string; // generic base64 (optionally with data: prefix)
  bytes?: ArrayBuffer | Uint8Array | Buffer;
  mimeType?: string; // optional hint
  contentType?: string; // optional hint
};

class GeminiImageServer {
  private server: Server;
  private apiKey: string | undefined;

  constructor() {
    this.server = new Server(
      {
        name: 'gemini-image-gen-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.apiKey = process.env.OPENROUTER_API_KEY;
    
    // Log API key status for debugging (without exposing the actual key)
    if (!this.apiKey) {
      console.error('WARNING: OPENROUTER_API_KEY environment variable is not set');
    } else {
      console.error(`API Key loaded: ${this.apiKey.substring(0, 10)}...${this.apiKey.substring(this.apiKey.length - 4)}`);
    }
    
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_image',
          description: 'Generate images using Google Gemini API. Control image style, aspect ratio, and composition through descriptive text in your prompt.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'Text description of the image to generate. Include style details (e.g., "photorealistic", "oil painting"), aspect ratio (e.g., "square image", "landscape"), and composition details directly in the prompt.',
              },
              save_to_file: {
                type: 'boolean',
                description: 'Save generated image to local file',
                default: false,
              },
              filename: {
                type: 'string',
                description: 'Base filename for saved image (without extension)',
              },
              show_full_response: {
                type: 'boolean',
                description: 'Show full response including base64 data (default: false)',
                default: false,
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'list_models',
          description: 'Show information about the Gemini image generation model',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.apiKey) {
        throw new Error('OPENROUTER_API_KEY environment variable is not set. Please set it in your Claude Desktop config or environment.');
      }

      if (this.apiKey.length < 20) {
        throw new Error('OPENROUTER_API_KEY appears to be invalid (too short). Please check your API key.');
      }

      if (!this.apiKey.startsWith('sk-or-')) {
        console.error('Warning: OpenRouter API keys typically start with "sk-or-". Your key may be invalid.');
      }

      const { name, arguments: args } = request.params;

      switch (name) {
        case 'generate_image':
          return await this.handleGenerateImage(args as unknown as ImageGenerationArgs);
        case 'list_models':
          return await this.handleListModels();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleGenerateImage(args: ImageGenerationArgs) {
    const { 
      prompt, 
      save_to_file = false,
      filename,
      show_full_response = false
    } = args;

    try {
      // Use Gemini's generateContent endpoint for image generation
      const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/gemini-image-gen-mcp',
          'X-Title': 'Gemini Image Generation MCP Server',
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
          throw new Error(`Authentication failed (401): Invalid API key. Please check your OPENROUTER_API_KEY. Error: ${errorText}`);
        } else if (response.status === 403) {
          throw new Error(`Access denied (403): Your API key may not have access to this model. Error: ${errorText}`);
        }
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const message = data.choices[0].message;
      const content = message.content || '';
      
      // Extract image URL from the response
      let imageUrl: string | null = null;
      
      // Check if the message has images array (Gemini format)
      if (message.images && message.images.length > 0) {
        const firstImage = message.images[0];
        if (firstImage.image_url && firstImage.image_url.url) {
          imageUrl = firstImage.image_url.url;
        }
      }
      // Fallback: Check if content is a URL
      else if (content.startsWith('http')) {
        imageUrl = content;
      } else if (content.startsWith('data:image')) {
        // It's base64 data
        imageUrl = content;
      } else if (content.includes('http') || content.includes('![')) {
        // Try to extract URL from markdown
        const markdownMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
        if (markdownMatch) {
          imageUrl = markdownMatch[1];
        } else {
          const urlMatch = content.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            imageUrl = urlMatch[0];
          }
        }
      }
      
      let savedFile: string | null = null;
      if (save_to_file && imageUrl) {
        // Handle both regular URLs and base64 data
        const imageInput: ImageInput = imageUrl.startsWith('data:') || imageUrl.startsWith('http') 
          ? { url: imageUrl }
          : { base64: imageUrl }; // Assume it's raw base64 if not a URL
        const savedFiles = await this.saveImages([imageInput], filename || 'generated_image');
        savedFile = savedFiles[0] || null;
      }

      // Prepare response based on show_full_response option
      const responseData: any = {
        success: true,
        model: GEMINI_MODEL,
        prompt: prompt,
        message: content || 'Image generated successfully',
      };

      // Add image info
      if (imageUrl) {
        if (imageUrl.startsWith('data:image')) {
          if (show_full_response) {
            // Include full base64 data when requested
            responseData.image = {
              type: 'base64',
              data: imageUrl,
              size: `${Math.round(imageUrl.length / 1024)}KB`,
              format: imageUrl.substring(11, imageUrl.indexOf(';')) || 'unknown'
            };
          } else {
            // Default: concise info without the actual data
            responseData.image = {
              type: 'base64',
              size: `${Math.round(imageUrl.length / 1024)}KB`,
              format: imageUrl.substring(11, imageUrl.indexOf(';')) || 'unknown'
            };
          }
        } else {
          responseData.image = {
            type: 'url',
            url: imageUrl
          };
        }
      }

      if (savedFile) {
        responseData.saved_to = savedFile;
      }

      if (data.usage) {
        responseData.usage = {
          tokens: data.usage?.total_tokens || 0
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    } catch (error: any) {
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  }

  private async handleListModels() {
    return {
      content: [
        {
          type: 'text',
          text: `Available Gemini Image Generation Model:
• ${GEMINI_MODEL}
  Google Gemini 2.5 Flash Image Preview - Latest image generation model

Note: Image style, aspect ratio, and composition are controlled through descriptive text in your prompt.

Examples:
• For multiple images: "Generate 3 variations of..." (note: model may not always follow exact count)
• For square images: Include "square image" in your prompt
• For landscape: Include "landscape orientation" or "16:9 aspect ratio"
• For portrait: Include "portrait orientation" or "9:16 aspect ratio"
• For specific styles: "photorealistic", "oil painting", "watercolor", "digital art", etc.
• For quality: "ultra HD", "4K", "highly detailed", etc.

The model interprets your natural language description to generate images matching your requirements.`,
        },
      ],
    };
  }

  private async saveImages(images: ImageInput[], baseFilename: string): Promise<string[]> {
    const savedFiles: string[] = [];
    const outputDir = path.join(process.cwd(), 'generated_images');
    await fs.mkdir(outputDir, { recursive: true });

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      try {
        const { buffer, ext } = await this.resolveImageBufferAndExt(image);

        const safeBase = this.sanitizeFilePart(baseFilename || 'generated_image');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${safeBase}_${timestamp}_${i + 1}.${ext}`;
        const filepath = path.join(outputDir, filename);

        await fs.writeFile(filepath, buffer);
        savedFiles.push(filepath);
        console.error(`Saved image to: ${filepath}`);
      } catch (err) {
        console.error(`Failed to save image #${i + 1}:`, err);
      }
    }

    return savedFiles;
  }

  private async resolveImageBufferAndExt(image: ImageInput): Promise<{ buffer: Buffer; ext: string }> {
    let buffer: Buffer | undefined;
    let mime: string | undefined;
    let ext: string | undefined;

    if (image.url) {
      if (image.url.startsWith('data:')) {
        const parsed = this.parseDataUrl(image.url);
        buffer = parsed.buffer;
        mime = parsed.mime;
      } else {
        const res = await fetch(image.url);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${image.url}: ${res.status} ${res.statusText}`);
        }
        const arr = await res.arrayBuffer();
        buffer = Buffer.from(arr);
        mime = res.headers.get('content-type') ?? undefined;
        // Try to infer extension from URL if content-type is missing
        ext = this.extFromUrl(image.url) ?? undefined;
      }
    } else if (image.b64_json || image.base64) {
      const b64 = (image.b64_json ?? image.base64)!.replace(/^data:.*;base64,/, '');
      buffer = Buffer.from(b64, 'base64');
      mime = image.mimeType ?? image.contentType;
    } else if (image.bytes) {
      if (Buffer.isBuffer(image.bytes)) {
        buffer = image.bytes;
      } else if (image.bytes instanceof ArrayBuffer) {
        buffer = Buffer.from(image.bytes);
      } else if (image.bytes instanceof Uint8Array) {
        buffer = Buffer.from(image.bytes);
      }
      mime = image.mimeType ?? image.contentType;
    }

    if (!buffer) throw new Error('No image data found');

    const resolvedExt = this.mimeToExt(mime) ?? ext ?? 'png';
    return { buffer, ext: resolvedExt };
  }

  private parseDataUrl(dataUrl: string): { buffer: Buffer; mime?: string } {
    const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
    if (!m) throw new Error('Invalid data URL');
    const mime = m[1];
    const isBase64 = !!m[2];
    const data = m[3];
    const buffer = isBase64
      ? Buffer.from(data, 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8');
    return { buffer, mime };
  }

  private mimeToExt(m?: string | null): string | undefined {
    if (!m) return undefined;
    const clean = m.split(';')[0].trim().toLowerCase();
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
      'image/avif': 'avif',
      'image/svg+xml': 'svg'
    };
    return map[clean];
  }

  private extFromUrl(u: string): string | undefined {
    try {
      const ext = path.extname(new URL(u).pathname).slice(1).toLowerCase();
      const allowed = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'ico', 'avif'];
      if (!ext || !allowed.includes(ext)) return undefined;
      return ext === 'jpeg' ? 'jpg' : ext;
    } catch {
      return undefined;
    }
  }

  private sanitizeFilePart(s: string): string {
    return s.replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 64);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Gemini Image Generation MCP Server running on stdio');
  }
}

const server = new GeminiImageServer();
server.run().catch(console.error);