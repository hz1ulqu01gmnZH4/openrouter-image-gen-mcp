# OpenRouter Image Generation MCP Server

An MCP (Model Context Protocol) server that provides image generation capabilities through the OpenRouter API, supporting models like Gemini 2.5 Flash Image Preview.

## Features

- **Image Generation**: Generate images using Google Gemini 2.5 Flash Image Preview

- **Flexible Options**: 
  - Save generated images to local files

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/openrouter-image-gen-mcp.git
cd openrouter-image-gen-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

4. Set up your OpenRouter API key:
```bash
export OPENROUTER_API_KEY="your-api-key-here"
```

You can get an API key from [OpenRouter](https://openrouter.ai/).

## Configuration for Claude Desktop

Add the following to your Claude Desktop configuration file:

### macOS/Linux
Location: `~/.config/claude/claude_desktop_config.json`

### Windows
Location: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openrouter-image-gen": {
      "command": "node",
      "args": ["/path/to/openrouter-image-gen-mcp/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Replace `/path/to/openrouter-image-gen-mcp` with the actual path to your installation directory.

## Available Tools

### 1. `generate_image`
Generate images using AI models.

**Parameters:**
- `prompt` (required): Text description of the image to generate
- `model`: Model to use (default: `google/gemini-2.5-flash-image-preview:free`)
- `n`: Number of images to generate (1-4, default: 1)
- `size`: Image dimensions (default: `1024x1024`)
- `save_to_file`: Save images locally (default: false)
- `filename`: Base filename for saved images
- `show_full_response`: Include full base64 data in response (default: false, returns concise info only)

**Example:**
```json
{
  "prompt": "A serene Japanese garden with cherry blossoms",
  "model": "google/gemini-2.5-flash-image-preview:free",
  "save_to_file": true,
  "filename": "japanese_garden"
}
```

**Note:** Gemini image generation works through the chat completions API. The model will generate an image based on your prompt and return it as a URL or base64 data in the response. The size parameter is not used for Gemini models.

### 2. `list_models`
List all available image generation models.


## Development

### Build
```bash
npm run build
```

### Run in development mode
```bash
npm run dev
```

### Start the server
```bash
npm start
```

## API Documentation

- [Gemini Image Generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [OpenRouter API](https://openrouter.ai/docs)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## Troubleshooting

### 401 Authentication Error
If you get a 401 error, check:
1. Your API key is correctly set in the environment or Claude Desktop config
2. The API key starts with `sk-or-` (OpenRouter format)
3. The API key is valid and has not expired
4. You have credits available in your OpenRouter account

Test your API key loading:
```bash
node test-api-key.js
```

### Common Issues
- **API Key not loading**: Make sure the `OPENROUTER_API_KEY` is set in your Claude Desktop config's `env` section
- **Model access denied**: Some models require specific permissions or higher tier accounts
- **Image not generating for Gemini**: Gemini uses the chat completions endpoint, not the images endpoint

## License

WTFPL - Do What The Fuck You Want To Public License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.