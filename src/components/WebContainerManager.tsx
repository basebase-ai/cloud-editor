'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Loader, Text, Stack, Alert, Button } from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { WebContainer } from '@webcontainer/api';

// Global WebContainer instance to prevent multiple boots
let globalWebContainer: WebContainer | null = null;

interface WebContainerManagerProps {
  repoUrl: string;
  githubToken: string;
}

export default function WebContainerManager({ repoUrl, githubToken }: WebContainerManagerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const isBootingRef = useRef<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing WebContainer...');
  const [url, setUrl] = useState<string>('');

  // WebContainer bridge - poll for requests from server-side tools
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const pollForRequests = async () => {
      if (!webcontainerRef.current) return;

      try {
        const response = await fetch('/api/webcontainer');
        if (response.ok) {
          const data = await response.json();
          
          for (const request of data.requests) {
            await handleWebContainerRequest(request);
          }
        }
      } catch (error) {
        console.error('Failed to poll for WebContainer requests:', error);
      }
    };

    const handleWebContainerRequest = async (request: { id: string; action: string; params: any }) => {
      if (!webcontainerRef.current) {
        await sendResponse(request.id, null, 'WebContainer not available');
        return;
      }

      try {
        let result;
        const { action, params } = request;

        switch (action) {
          case 'listFiles':
            console.log(`[WebContainer] Listing files in: ${params.path || '.'}`);
            try {
              const dirEntries = await webcontainerRef.current.fs.readdir(params.path || '.', { withFileTypes: true });
              const files = dirEntries.map((item: any) => ({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file'
              }));
              console.log(`[WebContainer] Found ${files.length} items in ${params.path || '.'}:`, 
                files.map(f => `${f.name}${f.type === 'directory' ? '/' : ''}`).join(', '));
              result = { files, path: params.path || '.' };
            } catch (listError) {
              console.error(`[WebContainer] Failed to list directory ${params.path || '.'}:`, listError);
              throw listError;
            }
            break;

          case 'readFile':
            console.log(`[WebContainer] Reading file: ${params.path}`);
            try {
              const content = await webcontainerRef.current.fs.readFile(params.path, 'utf-8');
              console.log(`[WebContainer] Successfully read ${params.path} (${content.length} characters)`);
              result = { content, path: params.path };
            } catch (fileError) {
              console.error(`[WebContainer] Failed to read file ${params.path}:`, fileError);
              throw fileError;
            }
            break;

          case 'writeFile':
            console.log(`[WebContainer] Writing file: ${params.path} (${params.content.length} characters)`);
            try {
              await webcontainerRef.current.fs.writeFile(params.path, params.content);
              console.log(`[WebContainer] Successfully wrote ${params.path}`);
              result = { success: true, path: params.path };
              
              // Verify the file was written by reading it back
              try {
                const verification = await webcontainerRef.current.fs.readFile(params.path, 'utf-8');
                console.log(`[WebContainer] Verification: File ${params.path} now contains ${verification.length} characters`);
              } catch (verifyError) {
                console.warn(`[WebContainer] Could not verify file write for ${params.path}:`, verifyError);
              }
            } catch (writeError) {
              console.error(`[WebContainer] Failed to write file ${params.path}:`, writeError);
              throw writeError;
            }
            break;

          case 'searchFiles':
            // Simple grep implementation
            result = await searchInFiles(webcontainerRef.current, params.pattern, params.files);
            break;

          case 'checkStatus':
            console.log(`[WebContainer] Checking system status...`);
            try {
              // Get basic project info
              const cwd = webcontainerRef.current.workdir;
              
              // Check if package.json exists
              let packageInfo = 'No package.json found';
              try {
                const packageJson = await webcontainerRef.current.fs.readFile('package.json', 'utf-8');
                const pkg = JSON.parse(packageJson);
                packageInfo = `Package: ${pkg.name || 'unnamed'} v${pkg.version || 'unknown'}`;
              } catch (e) {
                packageInfo = 'Could not read package.json';
              }
              
              // List root directory
              const rootFiles = await webcontainerRef.current.fs.readdir('.', { withFileTypes: true });
              const fileList = rootFiles.map((item: any) => 
                `${item.name}${item.isDirectory() ? '/' : ''}`
              ).join(', ');
              
              result = {
                workdir: cwd,
                packageInfo,
                rootFiles: fileList,
                serverUrl: url || 'No server running',
                serverStatus: url ? 'Running' : 'Not running',
                message: `📊 WebContainer Status:\n• Working directory: ${cwd}\n• ${packageInfo}\n• Root files: ${fileList}\n• Server: ${url ? `Running at ${url}` : 'Not running'}`
              };
            } catch (statusError) {
              console.error(`[WebContainer] Failed to get status:`, statusError);
              throw statusError;
            }
            break;

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        await sendResponse(request.id, result, null);
      } catch (error) {
        console.error(`WebContainer ${request.action} failed:`, error);
        await sendResponse(request.id, null, error instanceof Error ? error.message : 'Unknown error');
      }
    };

    const sendResponse = async (responseId: string, result: any, error: string | null) => {
      try {
        await fetch('/api/webcontainer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responseId, result, error })
        });
      } catch (err) {
        console.error('Failed to send WebContainer response:', err);
      }
    };

    const searchInFiles = async (webcontainer: WebContainer, pattern: string, filePattern: string = '*') => {
      const results: Array<{ file: string; line: number; content: string; match: string }> = [];
      console.log(`[WebContainer] Searching for pattern: "${pattern}" in files: ${filePattern}`);
      
      // Create case-insensitive regex
      const regex = new RegExp(pattern, 'gi');
      
      // Recursive search function
      const searchDirectory = async (dirPath: string) => {
        try {
          const entries = await webcontainer.fs.readdir(dirPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;
            
            if (entry.isDirectory()) {
              // Skip node_modules and .git directories
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await searchDirectory(fullPath);
              }
            } else if (entry.isFile()) {
              // Search in text files (expanded list)
              const isTextFile = [
                '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.htm', '.css', '.scss', '.sass',
                '.md', '.txt', '.xml', '.svg', '.vue', '.yaml', '.yml', '.toml', '.ini', '.env'
              ].some(ext => entry.name.toLowerCase().endsWith(ext));
              
              if (isTextFile) {
                try {
                  const content = await webcontainer.fs.readFile(fullPath, 'utf-8');
                  const lines = content.split('\n');
                  
                  lines.forEach((line, index) => {
                    const matches = line.match(regex);
                    if (matches) {
                      results.push({
                        file: fullPath,
                        line: index + 1,
                        content: line.trim(),
                        match: matches[0] // First match found
                      });
                    }
                  });
                } catch (fileError) {
                  // Skip files that can't be read (binary, permissions, etc.)
                  console.log(`[WebContainer] Skipping unreadable file: ${fullPath}`);
                }
              }
            }
          }
        } catch (dirError) {
          console.log(`[WebContainer] Skipping unreadable directory: ${dirPath}`);
        }
      };
      
      try {
        await searchDirectory('.');
        console.log(`[WebContainer] Search completed. Found ${results.length} matches for "${pattern}"`);
      } catch (error) {
        console.error('[WebContainer] Search failed:', error);
      }
      
      return { results, pattern, filesSearched: filePattern };
    };

    // Start polling when WebContainer is ready
    if (webcontainerRef.current && !isLoading) {
      pollInterval = setInterval(pollForRequests, 1000); // Poll every second
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isLoading]);

  // Monitor repoUrl changes to trigger re-initialization if needed
  useEffect(() => {
    // RepoUrl changed, will trigger re-boot if needed
  }, [repoUrl]);

  useEffect(() => {
    // Token changed, will trigger re-boot if needed
  }, [githubToken]);

  const bootWebContainer = useCallback(async (): Promise<void> => {
    
    // Prevent multiple concurrent boots
    if (isBootingRef.current || webcontainerRef.current) {
      console.log('Skipping boot - already booting or container exists');
      return;
    }
    isBootingRef.current = true;
    try {
      setIsLoading(true);
      setError('');
      setStatus('Booting WebContainer...');

      // Boot WebContainer with global singleton pattern
      let webcontainer: WebContainer;
      if (globalWebContainer) {
        console.log('Reusing existing WebContainer instance');
        webcontainer = globalWebContainer;
        setStatus('Using existing WebContainer...');
      } else {
        try {
          webcontainer = await WebContainer.boot();
          globalWebContainer = webcontainer;
        } catch (err) {
          // If WebContainer already exists, this shouldn't happen with our global check
          if (err instanceof Error && err.message.includes('single WebContainer instance')) {
            console.warn('WebContainer already exists globally, this should not happen');
            setError('WebContainer instance conflict. Please refresh the page.');
            return;
          }
          throw err;
        }
      }
      webcontainerRef.current = webcontainer;

      if (repoUrl && githubToken) {
        setStatus('Cloning repository...');
        setStatus('Cloning repository...');
        await cloneRepository(webcontainer, repoUrl, githubToken);
      } else if (repoUrl) {
        setStatus('Cloning public repository...');
        setStatus('Cloning repository...');
        await cloneRepository(webcontainer, repoUrl, '');
      } else {
        console.log('No repository URL provided, creating default project');
        setStatus('Creating default project...');
        await createDefaultProject(webcontainer);
      }

      setStatus('Starting development server...');
      await startDevServer(webcontainer);

    } catch (err) {
      console.error('WebContainer setup failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to setup WebContainer');
      setIsLoading(false);
    } finally {
      isBootingRef.current = false;
    }
  }, [repoUrl, githubToken]);

  const cloneRepository = async (webcontainer: WebContainer, repoUrl: string, token: string): Promise<void> => {
    console.log('=== Starting repository download process ===');
    console.log('Repository URL:', repoUrl);
    console.log('Token provided:', token ? `Yes (length: ${token.length})` : 'No');

    // Extract repo info from URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      console.error('Invalid GitHub repository URL format:', repoUrl);
      throw new Error('Invalid GitHub repository URL');
    }

    const [, owner, repo] = match;
    const cleanRepoName = repo.replace('.git', '');
    console.log('Parsed repository info:', { owner, repo: cleanRepoName });

    try {
      // Fetch repository contents from GitHub API
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'BaseBase-Editor'
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

              setStatus('Fetching repository structure...');
      
      // Try to get the default branch first
      let treeData;
      const branches = ['main', 'master'];
      let success = false;
      
      for (const branch of branches) {
        console.log(`Trying branch: ${branch}`);
        const treeUrl = `https://api.github.com/repos/${owner}/${cleanRepoName}/git/trees/${branch}?recursive=1`;
        const treeResponse = await fetch(treeUrl, { headers });
        
        if (treeResponse.ok) {
          console.log(`Successfully found branch: ${branch}`);
          treeData = await treeResponse.json();
          success = true;
          break;
        } else {
          console.log(`Branch ${branch} not found (${treeResponse.status})`);
        }
      }
      
      if (!success) {
        throw new Error(`Repository not found or no accessible branches. Check repository URL and permissions.`);
      }
      
      await downloadAndMountFiles(webcontainer, owner, cleanRepoName, treeData.tree, token);

      console.log('Repository downloaded and mounted successfully');
      setStatus('Repository downloaded successfully');
    } catch (err) {
      console.error('Failed to download repository:', err);
      throw new Error(`Failed to download repository: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const downloadAndMountFiles = async (
    webcontainer: WebContainer, 
    owner: string, 
    repo: string, 
    tree: any[], 
    token: string
  ): Promise<void> => {
    console.log(`Downloading ${tree.length} files...`);
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'BaseBase-Editor'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fileStructure: any = {};
    
    // Filter only files (not directories) and exclude very large files
    const files = tree.filter(item => item.type === 'blob' && item.size < 1000000); // Skip files > 1MB
    console.log(`Found ${files.length} files to download (excluding large files)`);
    
    // Process files in batches to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)}`);
      
      await Promise.all(
        batch.map(async (file) => {
          try {
            console.log(`Downloading: ${file.path} (${file.size} bytes)`);
            const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`;
            const fileResponse = await fetch(fileUrl, { headers });
            
            if (fileResponse.ok) {
              const fileData = await fileResponse.json();
              
              let content: string | Uint8Array;
              
              // Determine if file is binary based on extension
              const isBinaryFile = (filePath: string): boolean => {
                const binaryExtensions = [
                  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tga',
                  '.woff', '.woff2', '.ttf', '.otf', '.eot',
                  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
                  '.exe', '.dll', '.so', '.dylib',
                  '.mp3', '.wav', '.mp4', '.avi', '.mov', '.mkv',
                  '.bin', '.dat', '.db', '.sqlite'
                ];
                
                const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
                return binaryExtensions.includes(ext);
              };
              
              // Handle different file types based on file extension
              if (isBinaryFile(file.path)) {
                // Binary file - decode base64 to Uint8Array
                console.log(`Decoding binary file: ${file.path}`);
                try {
                  // Remove any whitespace and decode base64
                  const base64Content = fileData.content.replace(/\s/g, '');
                  const binaryString = atob(base64Content);
                  const bytes = new Uint8Array(binaryString.length);
                  
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  content = bytes;
                } catch (decodeErr) {
                  console.error(`Failed to decode binary file ${file.path}:`, decodeErr);
                  return; // Skip this file
                }
              } else {
                // Text file - decode base64 content to string
                console.log(`Processing text file: ${file.path}`);
                try {
                  if (fileData.content) {
                    // GitHub API returns all files as base64, so decode to text
                    content = atob(fileData.content.replace(/\s/g, ''));
                  } else {
                    content = '';
                  }
                } catch (decodeErr) {
                  console.warn(`Failed to decode text file ${file.path}:`, decodeErr);
                  content = fileData.content || '';
                }
              }
              
              // Build nested file structure
              const pathParts = file.path.split('/');
              let current = fileStructure;
              
              for (let i = 0; i < pathParts.length - 1; i++) {
                const part = pathParts[i];
                if (!current[part]) {
                  current[part] = { directory: {} };
                }
                current = current[part].directory;
              }
              
              const fileName = pathParts[pathParts.length - 1];
              current[fileName] = {
                file: {
                  contents: content
                }
              };
              
              console.log(`✓ Downloaded: ${file.path}`);
            } else {
              console.warn(`Failed to download file ${file.path}: ${fileResponse.status}`);
            }
          } catch (err) {
            console.warn(`Error downloading file ${file.path}:`, err);
          }
        })
      );
      
      // Small delay between batches to be nice to GitHub's API
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('Mounting files to WebContainer...');
    console.log('File structure to mount:', Object.keys(fileStructure));
    
    try {
      await webcontainer.mount(fileStructure);
      console.log('Files mounted successfully');
    } catch (mountErr) {
      console.error('Failed to mount files:', mountErr);
      throw new Error(`Failed to mount repository files: ${mountErr instanceof Error ? mountErr.message : 'Unknown error'}`);
    }
    
    // Log the mounted structure for debugging (use ls since find may not be available)
    try {
      const lsProcess = await webcontainer.spawn('ls', ['-la']);
      lsProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            console.log('[Mounted Files]:', data);
          }
        })
      );
      await lsProcess.exit;
    } catch (err) {
      console.log('Could not list mounted files:', err);
    }
  };

  const createDefaultProject = async (webcontainer: WebContainer): Promise<void> => {
    // Create a simple default project structure
    await webcontainer.mount({
      'package.json': {
        file: {
          contents: JSON.stringify({
            name: 'webcontainer-project',
            version: '1.0.0',
            scripts: {
              dev: 'vite',
              build: 'vite build',
              preview: 'vite preview'
            },
            dependencies: {
              vite: '^5.0.0'
            }
          }, null, 2)
        }
      },
      'index.html': {
        file: {
          contents: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebContainer Project</title>
</head>
<body>
    <div id="app">
        <h1>Welcome to your WebContainer!</h1>
        <p>This is a default project. Clone a repository to get started.</p>
    </div>
</body>
</html>`
        }
      },
      'vite.config.js': {
        file: {
          contents: `import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000
  }
})`
        }
      }
    });

    setStatus('Default project created');
  };

  const startDevServer = async (webcontainer: WebContainer): Promise<void> => {
    // First, let's see what's in the project
    try {
      const packageJson = await webcontainer.fs.readFile('package.json', 'utf-8');
      console.log('[Dev Server] package.json contents:', packageJson);
      
      const pkg = JSON.parse(packageJson);
      console.log('[Dev Server] Available scripts:', Object.keys(pkg.scripts || {}));
      
      if (!pkg.scripts?.dev) {
        console.warn('[Dev Server] No "dev" script found in package.json');
      }
    } catch (err) {
      console.error('[Dev Server] Could not read package.json:', err);
    }

    // Install dependencies first
    setStatus('Installing dependencies...');
    console.log('[Dev Server] Starting npm install...');
    const installProcess = await webcontainer.spawn('npm', ['install']);
        
    const installExitCode = await installProcess.exit;
    console.log(`[Dev Server] npm install exited with code: ${installExitCode}`);
    
    if (installExitCode !== 0) {
      throw new Error('Failed to install dependencies');
    }

    // Start the dev server
    setStatus('Starting development server...');
    console.log('[Dev Server] Starting npm run dev...');
    const devProcess = await webcontainer.spawn('npm', ['run', 'dev']);

    // Wait for server to be ready
    webcontainer.on('server-ready', (port, url) => {
      setUrl(url);
      setIsLoading(false);
      setStatus('Development server ready');
    });

    // Log all dev server output
    devProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log('[Dev Server]:', data);
        }
      })
    );

    // Log when dev process exits
    devProcess.exit.then((exitCode) => {
      console.log(`[Dev Server] Process exited with code: ${exitCode}`);
      if (exitCode !== 0) {
        setError(`Development server exited with code ${exitCode}`);
      }
    });
  };

  const retry = useCallback((): void => {
    if (webcontainerRef.current) {
      webcontainerRef.current.teardown();
      webcontainerRef.current = null;
    }
    if (globalWebContainer) {
      globalWebContainer.teardown();
      globalWebContainer = null;
    }
    isBootingRef.current = false;
    setError('');
    setIsLoading(true);
    setUrl('');
    setStatus('Retrying WebContainer setup...');
    bootWebContainer();
  }, [bootWebContainer]);

  // Reset global container on mount to ensure clean state
  useEffect(() => {
    console.log('WebContainerManager mounted, resetting global container if exists');
    if (globalWebContainer) {
      console.log('Tearing down existing global WebContainer for fresh start');
      globalWebContainer.teardown();
      globalWebContainer = null;
    }
  }, []);

  // Prevent React Strict Mode double execution
  const hasInitialized = useRef(false);

  useEffect(() => {
    console.log('Main useEffect triggered. Current state:', { 
      hasContainer: !!webcontainerRef.current, 
      isBooting: isBootingRef.current,
      hasInitialized: hasInitialized.current,
      repoUrl, 
      githubToken: githubToken ? 'provided' : 'not provided'
    });

    // Prevent React Strict Mode double execution
    if (hasInitialized.current) {
      console.log('Already initialized, skipping...');
      return;
    }

    // Only boot once we have finished loading the initial props
    if (!webcontainerRef.current && !isBootingRef.current) {
      console.log('Booting WebContainer...');
      hasInitialized.current = true;
      bootWebContainer();
    }

    return () => {
      // Don't teardown the global instance on unmount, just clear local ref
      webcontainerRef.current = null;
      isBootingRef.current = false;
    };
  }, [bootWebContainer]); // Re-runs when bootWebContainer changes (due to prop changes)

  if (error) {
    return (
      <Box h="100vh" p="md">
        <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
          <Text fw={500} mb="xs">WebContainer Error</Text>
          <Text size="sm" mb="md">{error}</Text>
          <Button 
            size="sm" 
            variant="light" 
            leftSection={<IconRefresh size={14} />}
            onClick={retry}
          >
            Retry
          </Button>
        </Alert>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box h="100vh" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text size="sm" c="dimmed">{status}</Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box h="100vh">
      {url ? (
        <iframe
          ref={iframeRef}
          src={url}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            backgroundColor: '#ffffff'
          }}
          title="WebContainer Preview"
        />
      ) : (
        <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="md">
            <Text size="lg" fw={500}>No Preview Available</Text>
            <Text size="sm" c="dimmed">
              The development server is starting...
            </Text>
          </Stack>
        </Box>
      )}
    </Box>
  );
}