# BaseBase Editor

A browser-based AI coding assistant that runs in a local WebContainer environment. This application allows you to clone GitHub repositories, edit code, and get AI assistance with development tasks.

## Features

- 🤖 **AI-Powered Code Assistant** - Chat with Gemini AI to make code changes
- 🐳 **WebContainer Integration** - Run code directly in the browser
- 📂 **GitHub Repository Cloning** - Clone and work with any public GitHub repo
- 🛠️ **Code Analysis Tools** - List files, search patterns, read/edit files, run linters
- 🎨 **Modern UI** - Built with Next.js, Mantine, and Tailwind CSS
- 🔄 **Multi-step Agent** - AI assistant can take multiple actions to complete tasks

## Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Create a `.env.local` file and add your Gemini API key:

   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run the development server**:

   ```bash
   npm run dev
   ```

4. **Open the application**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Cloning a Repository

To clone a GitHub repository, add query parameters to the URL:

```
http://localhost:3000?repo=https://github.com/owner/repository
```

Make sure you have a GitHub token stored in localStorage (key: `github_token`) for private repositories.

### AI Assistant Features

The AI assistant can help you with:

- **`list_files`** - Explore project structure
- **`read_file`** - View file contents
- **`edit_file`** - Make code changes
- **`grep_files`** - Search for patterns in code
- **`run_linter`** - Check code quality

### Example Prompts

- "Show me the project structure"
- "Find all React components in this project"
- "Add error handling to the main function"
- "Refactor this code to use TypeScript"
- "Fix any linting errors in the codebase"

## Architecture

- **Frontend**: Next.js 15 with App Router, Mantine UI components
- **AI Integration**: Vercel AI SDK with Google Gemini
- **Code Environment**: WebContainer API for in-browser development
- **Styling**: Tailwind CSS + Mantine component library

## Development

```bash
# Development server with hot reloading
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Lint code
npm run lint
```

## Environment Variables

- `GEMINI_API_KEY` - Your Google Gemini API key (required)

## Browser Compatibility

This application requires a modern browser with support for:

- WebContainer API
- ES2022 features
- SharedArrayBuffer (for some WebContainer features)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request
