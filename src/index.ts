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

const AVAILABLE_MODELS = [
  { id: 'google/gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image Preview', description: 'Google Gemini image generation model' }
];

const IMAGE_SIZES = [
  '256x256',
  '512x512',
  '1024x1024',
  '1536x1536',
  '1792x1024',
  '1024x1792'
];

interface ImageGenerationArgs {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  save_to_file?: boolean;
  filename?: string;
}

interface ImageAnalysisArgs {
  model: string;
  image_url?: string;
  image_path?: string;
  prompt: string;
  max_tokens?: number;
}

class OpenRouterImageServer {
  private server: Server;
  private apiKey: string | undefined;

  constructor() {
    this.server = new Server(
      {
        name: 'openrouter-image-gen-mcp',
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
          description: 'Generate images using OpenRouter API (Gemini 2.5 Flash, DALL-E 3, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'Model ID for image generation',
                enum: AVAILABLE_MODELS.filter(m => m.id.includes('gemini') || m.id.includes('dall-e')).map(m => m.id),
                default: 'google/gemini-2.5-flash-image-preview:free',
              },
              prompt: {
                type: 'string',
                description: 'Text description of the image to generate',
              },
              n: {
                type: 'number',
                description: 'Number of images to generate (1-4)',
                default: 1,
                minimum: 1,
                maximum: 4,
              },
              size: {
                type: 'string',
                description: 'Size of the generated image',
                enum: IMAGE_SIZES,
                default: '1024x1024',
              },
              quality: {
                type: 'string',
                description: 'Quality of the image (DALL-E 3 only)',
                enum: ['standard', 'hd'],
                default: 'standard',
              },
              style: {
                type: 'string',
                description: 'Style of the image (DALL-E 3 only)',
                enum: ['vivid', 'natural'],
                default: 'vivid',
              },
              save_to_file: {
                type: 'boolean',
                description: 'Save generated images to local files',
                default: false,
              },
              filename: {
                type: 'string',
                description: 'Base filename for saved images (without extension)',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'analyze_image',
          description: 'Analyze images using vision models through OpenRouter API',
          inputSchema: {
            type: 'object',
            properties: {
              model: {
                type: 'string',
                description: 'Model ID for image analysis',
                enum: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4-vision-preview'],
                default: 'anthropic/claude-3.5-sonnet',
              },
              image_url: {
                type: 'string',
                description: 'URL of the image to analyze',
              },
              image_path: {
                type: 'string',
                description: 'Local file path of the image to analyze',
              },
              prompt: {
                type: 'string',
                description: 'Question or prompt about the image',
                default: 'What is in this image?',
              },
              max_tokens: {
                type: 'number',
                description: 'Maximum tokens in response',
                default: 1000,
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'list_models',
          description: 'List available image generation and vision models',
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
        case 'analyze_image':
          return await this.handleAnalyzeImage(args as unknown as ImageAnalysisArgs);
        case 'list_models':
          return await this.handleListModels();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleGenerateImage(args: ImageGenerationArgs) {
    const { 
      model = 'google/gemini-2.5-flash-image-preview:free', 
      prompt, 
      n = 1, 
      size = '1024x1024',
      quality = 'standard',
      style = 'vivid',
      save_to_file = false,
      filename
    } = args;

    try {
      // For Gemini models, use chat completions endpoint with image generation prompt
      if (model.includes('gemini')) {
        const imagePrompt = `Generate an ultra-realistic 4K photo: ${prompt}`;
        
        const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/openrouter-image-gen-mcp',
            'X-Title': 'OpenRouter Image Generation MCP Server',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: imagePrompt
              }
            ],
            temperature: 0.7,
            max_tokens: 4096
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
        const content = data.choices[0].message.content;
        
        // Extract image URL from the response if it contains one
        // The response might be a URL or base64 data
        let imageUrl: string | null = null;
        
        // Check if content is a URL
        if (content.startsWith('http')) {
          imageUrl = content;
        } else if (content.startsWith('data:image')) {
          // It's base64 data
          imageUrl = content;
        } else {
          // Try to extract URL from markdown or text
          const urlMatch = content.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            imageUrl = urlMatch[0];
          }
        }
        
        let savedFile: string | null = null;
        if (save_to_file && imageUrl) {
          const savedFiles = await this.saveImages([{ url: imageUrl }], filename || 'generated_image');
          savedFile = savedFiles[0] || null;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                model: model,
                prompt: prompt,
                image_url: imageUrl,
                saved_file: savedFile,
                raw_response: content,
                metadata: {
                  usage: data.usage,
                  model: data.model,
                  id: data.id,
                },
              }, null, 2),
            },
          ],
        };
      } 
      // For DALL-E models, use the images/generations endpoint
      else if (model.includes('dall-e')) {
        const requestBody: any = {
          model,
          prompt,
          n,
          size,
          quality,
          style,
        };

        const response = await fetch(`${OPENROUTER_API_URL}/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/openrouter-image-gen-mcp',
            'X-Title': 'OpenRouter Image Generation MCP Server',
          },
          body: JSON.stringify(requestBody),
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
        
        let savedFiles: string[] = [];
        if (save_to_file && data.data) {
          savedFiles = await this.saveImages(data.data, filename || 'generated_image');
        }

        const images = data.data.map((img: any, index: number) => ({
          url: img.url,
          revised_prompt: img.revised_prompt,
          saved_file: savedFiles[index] || null,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                model: model,
                images: images,
                metadata: {
                  created: data.created,
                  usage: data.usage,
                },
              }, null, 2),
            },
          ],
        };
      } else {
        throw new Error(`Unsupported model for image generation: ${model}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to generate image: ${error.message}`);
    }
  }

  private async handleAnalyzeImage(args: ImageAnalysisArgs) {
    const { model = 'anthropic/claude-3.5-sonnet', image_url, image_path, prompt, max_tokens = 1000 } = args;

    let imageData: string;
    let mimeType: string = 'image/jpeg';

    if (image_path) {
      const buffer = await fs.readFile(image_path);
      imageData = buffer.toString('base64');
      const ext = path.extname(image_path).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
    } else if (image_url) {
      imageData = image_url;
    } else {
      throw new Error('Either image_url or image_path must be provided');
    }

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: image_path ? `data:${mimeType};base64,${imageData}` : imageData,
            },
          },
        ],
      },
    ];

    try {
      const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/openrouter-image-gen-mcp',
          'X-Title': 'OpenRouter Image Generation MCP Server',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as any;
      
      return {
        content: [
          {
            type: 'text',
            text: data.choices[0].message.content,
          },
        ],
        metadata: {
          usage: data.usage,
          model: data.model,
          id: data.id,
        },
      };
    } catch (error: any) {
      throw new Error(`Failed to analyze image: ${error.message}`);
    }
  }

  private async handleListModels() {
    const modelList = AVAILABLE_MODELS.map(m => 
      `• ${m.id}\n  ${m.name} - ${m.description}`
    ).join('\n\n');

    const sizeList = IMAGE_SIZES.join(', ');

    return {
      content: [
        {
          type: 'text',
          text: `Available Image Generation Models:\n${modelList}\n\nSupported Image Sizes:\n${sizeList}`,
        },
      ],
    };
  }

  private async saveImages(images: any[], baseFilename: string): Promise<string[]> {
    const savedFiles: string[] = [];
    const outputDir = path.join(process.cwd(), 'generated_images');
    
    await fs.mkdir(outputDir, { recursive: true });

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (image.url) {
        const response = await fetch(image.url);
        const buffer = await response.arrayBuffer();
        
        const timestamp = Date.now();
        const filename = `${baseFilename}_${timestamp}_${i + 1}.png`;
        const filepath = path.join(outputDir, filename);
        
        await fs.writeFile(filepath, Buffer.from(buffer));
        savedFiles.push(filepath);
      }
    }

    return savedFiles;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('OpenRouter Image Generation MCP Server running on stdio');
  }
}

const server = new OpenRouterImageServer();
server.run().catch(console.error);
