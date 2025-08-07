'use client';

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Loader, Text, Stack, Alert, Button } from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { WebContainer } from '@webcontainer/api';
import { useFileTracking } from '@/hooks/useFileTracking';

// Global WebContainer instance to prevent multiple boots
let globalWebContainer: WebContainer | null = null;

interface WebContainerManagerProps {
  repoUrl: string;
  githubToken: string;
  basebaseToken: string;
  onDevServerReady?: () => void;
}

export interface WebContainerManagerRef {
  restartDevServer: () => Promise<void>;
  getBuildErrors: () => string[];
  getWebContainer: () => WebContainer | null;
}

const WebContainerManager = forwardRef<WebContainerManagerRef, WebContainerManagerProps>(
  ({ repoUrl, githubToken, basebaseToken, onDevServerReady }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const webcontainerRef = useRef<WebContainer | null>(null);
    const isBootingRef = useRef<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [status, setStatus] = useState<string>('Initializing WebContainer...');
    const [url, setUrl] = useState<string>('');
    const [buildErrors, setBuildErrors] = useState<string[]>([]);
    const { setOriginalFile, markFileAsChanged, resetTracking } = useFileTracking();

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      restartDevServer: async () => {
        if (!webcontainerRef.current) {
          throw new Error('WebContainer not available');
        }

        console.log('Restarting dev server directly...');
        
        try {
          // Kill existing npm processes
          console.log('Killing existing npm processes...');
          try {
            const killProcess = await webcontainerRef.current.spawn('pkill', ['-f', 'npm']);
            const killExitCode = await killProcess.exit;
            
            if (killExitCode === 0) {
              console.log('Successfully killed npm processes');
            } else if (killExitCode === 1) {
              console.log('No npm processes were running (this is fine)');
            } else {
              console.warn('pkill command failed with exit code:', killExitCode);
            }
          } catch (killError) {
            console.warn('pkill command failed:', killError);
            // Continue anyway - maybe no processes were running
          }

          // Wait a moment for processes to stop
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Start the dev server again
          console.log('Starting dev server...');
          const devProcess = await webcontainerRef.current.spawn('npm', ['run', 'dev']);

          // Log dev server output
          devProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                console.log('[Dev Server Restart]:', data);
              }
            })
          );

          // Don't wait for the dev process to exit - it should keep running
          devProcess.exit.then((exitCode) => {
            console.log(`[Dev Server Restart] Process exited with code: ${exitCode}`);
          });

          console.log('Dev server restart initiated successfully');
        } catch (error) {
          console.error('Failed to restart dev server:', error);
          throw error;
        }
      },
      getBuildErrors: () => {
        return buildErrors;
      },
      getWebContainer: () => {
        return webcontainerRef.current;
      }
    }));

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

    const handleWebContainerRequest = async (request: { id: string; action: string; params: Record<string, unknown> }) => {
      if (!webcontainerRef.current) {
        await sendResponse(request.id, null, 'WebContainer not available');
        return;
      }

      try {
        let result;
        const { action, params } = request;

        switch (action) {
          case 'listFiles':
            const pathParam = params.path as string | undefined;
            console.log(`[WebContainer] Listing files in: ${pathParam || '.'}`);
            try {
              const dirEntries = await webcontainerRef.current.fs.readdir(pathParam || '.', { withFileTypes: true });
              const files = dirEntries.map((item: { name: string; isDirectory: () => boolean }) => ({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file'
              }));
              console.log(`[WebContainer] Found ${files.length} items in ${pathParam || '.'}:`, 
                files.map(f => `${f.name}${f.type === 'directory' ? '/' : ''}`).join(', '));
              result = { files, path: pathParam || '.' };
            } catch (listError) {
              console.error(`[WebContainer] Failed to list directory ${pathParam || '.'}:`, listError);
              // Return error result instead of throwing
              const errorMessage = listError instanceof Error ? listError.message : 'Unknown error';
              result = {
                files: [],
                path: pathParam || '.',
                error: errorMessage,
                success: false,
                message: `❌ Could not list directory ${pathParam || '.'}: ${errorMessage}`
              };
            }
            break;

          case 'readFile':
            const readPath = params.path as string;
            console.log(`[WebContainer] Reading file: ${readPath}`);
            try {
              const content = await webcontainerRef.current.fs.readFile(readPath, 'utf-8');
              console.log(`[WebContainer] Successfully read ${readPath} (${content.length} characters)`);
              result = { content, path: readPath };
            } catch (fileError) {
              console.error(`[WebContainer] Failed to read file ${readPath}:`, fileError);
              // Return error result instead of throwing to avoid 500 responses
              const errorMessage = fileError instanceof Error ? fileError.message : 'Unknown error';
              result = {
                content: null,
                path: readPath,
                error: errorMessage,
                success: false,
                message: `❌ Could not read file ${readPath}: ${errorMessage}`
              };
            }
            break;

          case 'writeFile':
            const writePath = params.path as string;
            const writeContent = params.content as string;
            console.log(`[WebContainer] Writing file: ${writePath} (${writeContent.length} characters)`);
            try {
              // Create parent directories if they don't exist
              const pathParts = writePath.split('/');
              if (pathParts.length > 1) {
                const dirPath = pathParts.slice(0, -1).join('/');
                try {
                  await webcontainerRef.current.fs.mkdir(dirPath, { recursive: true });
                  console.log(`[WebContainer] Created directory: ${dirPath}`);
                } catch (mkdirError) {
                  // Directory might already exist, that's okay
                  console.log(`[WebContainer] Directory creation for ${dirPath}:`, mkdirError);
                }
              }
              
              await webcontainerRef.current.fs.writeFile(writePath, writeContent);
              console.log(`[WebContainer] Successfully wrote ${writePath}`);
              
              // Update file tracking
              markFileAsChanged(writePath, writeContent);
              
              result = { success: true, path: writePath };
              
              // Verify the file was written by reading it back
              try {
                const verification = await webcontainerRef.current.fs.readFile(writePath, 'utf-8');
                console.log(`[WebContainer] Verification: File ${writePath} now contains ${verification.length} characters`);
              } catch (verifyError) {
                console.warn(`[WebContainer] Could not verify file write for ${writePath}:`, verifyError);
              }
            } catch (writeError) {
              console.error(`[WebContainer] Failed to write file ${writePath}:`, writeError);
              // Return error result instead of throwing
              const errorMessage = writeError instanceof Error ? writeError.message : 'Unknown error';
              result = {
                success: false,
                path: writePath,
                error: errorMessage,
                message: `❌ Failed to write file ${writePath}: ${errorMessage}`
              };
            }
            break;

          case 'searchFiles':
            // Simple grep implementation
            const searchPattern = params.pattern as string;
            const searchFiles = params.files as string;
            result = await searchInFiles(webcontainerRef.current, searchPattern, searchFiles);
            break;

          case 'deleteFile':
            const deletePath = params.path as string;
            console.log(`[WebContainer] Deleting file: ${deletePath}`);
            try {
              // Delete the file directly (WebContainer fs doesn't have access/unlink)
              await webcontainerRef.current.fs.rm(deletePath);
              console.log(`[WebContainer] Successfully deleted ${deletePath}`);
              result = { success: true, path: deletePath };
            } catch (deleteError) {
              console.error(`[WebContainer] Failed to delete file ${deletePath}:`, deleteError);
              // Return error result instead of throwing
              const errorMessage = deleteError instanceof Error ? deleteError.message : 'Unknown error';
              result = {
                success: false,
                path: deletePath,
                error: errorMessage,
                message: `❌ Failed to delete file ${deletePath}: ${errorMessage}`
              };
            }
            break;

          case 'replaceLines':
            const replacePath = params.path as string;
            const queryText = params.query as string;
            const replacementText = params.replacement as string;
            console.log(`[WebContainer] Replacing lines in: ${replacePath}`);
            try {
              // Read the current file content
              const currentContent = await webcontainerRef.current.fs.readFile(replacePath, 'utf-8');
              
              // Check if query text exists in the file
              if (!currentContent.includes(queryText)) {
                console.error(`[WebContainer] Query text not found in ${replacePath}`);
                result = {
                  success: false,
                  path: replacePath,
                  error: `Query text not found in file: ${replacePath}`,
                  message: `❌ Query text not found in ${replacePath}. The file may have been modified or the text doesn't exist.`
                };
                break;
              }
              
              // Perform the replacement
              const newContent = currentContent.replace(queryText, replacementText);
              
              // Verify the replacement actually changed something
              if (newContent === currentContent) {
                console.warn(`[WebContainer] No changes made to ${replacePath} - content identical after replacement`);
                result = { success: false, path: replacePath, message: 'No changes made - replacement text identical to original' };
              } else {
                // Write the updated content back to the file
                await webcontainerRef.current.fs.writeFile(replacePath, newContent);
                console.log(`[WebContainer] Successfully replaced lines in ${replacePath}`);
                
                // Update file tracking
                markFileAsChanged(replacePath, newContent);
                
                // Verify the file was written by reading it back
                try {
                  const verification = await webcontainerRef.current.fs.readFile(replacePath, 'utf-8');
                  console.log(`[WebContainer] Verification: File ${replacePath} now contains ${verification.length} characters`);
                } catch (verifyError) {
                  console.warn(`[WebContainer] Could not verify file write for ${replacePath}:`, verifyError);
                }
                
                result = { 
                  success: true, 
                  path: replacePath,
                  originalLength: currentContent.length,
                  newLength: newContent.length,
                  message: `Successfully replaced lines in ${replacePath}`
                };
              }
            } catch (replaceError) {
              console.error(`[WebContainer] Failed to replace lines in ${replacePath}:`, replaceError);
              // Return error result instead of throwing to avoid 500 responses
              const errorMessage = replaceError instanceof Error ? replaceError.message : 'Unknown error';
              result = {
                success: false,
                path: replacePath,
                error: errorMessage,
                message: `❌ Failed to replace lines in ${replacePath}: ${errorMessage}`
              };
            }
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
              } catch {
                packageInfo = 'Could not read package.json';
              }
              
              // List root directory
              const rootFiles = await webcontainerRef.current.fs.readdir('.', { withFileTypes: true });
              const fileList = rootFiles.map((item: { name: string; isDirectory: () => boolean }) => 
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
              // Return error result instead of throwing
              const errorMessage = statusError instanceof Error ? statusError.message : 'Unknown error';
              result = {
                error: errorMessage,
                success: false,
                message: `❌ Failed to get status: ${errorMessage}`
              };
            }
            break;

          case 'getBuildErrors':
            console.log(`[WebContainer] Getting build errors...`);
            result = {
              errors: buildErrors,
              hasErrors: buildErrors.length > 0,
              message: buildErrors.length > 0 
                ? `Found ${buildErrors.length} build error(s)`
                : 'No build errors found'
            };
            break;

          case 'runCommand':
            const command = params.command as string;
            const args = (params.args as string[]) || [];
            console.log(`[WebContainer] Running command: ${command} ${args.join(' ')}`);
            try {
              const process = await webcontainerRef.current.spawn(command, args);
              
              // Collect output
              let output = '';
              
              // Stream stdout
              const outputReader = process.output.getReader();
              const decoder = new TextDecoder();
              
              // Read output until process completes
              const readOutput = async () => {
                try {
                  while (true) {
                    const { done, value } = await outputReader.read();
                    if (done) break;
                    if (value && typeof value === 'object') {
                      const chunk = decoder.decode(value as Uint8Array);
                      output += chunk;
                      console.log(`[WebContainer Command Output]: ${chunk}`);
                    }
                  }
                } catch (err) {
                  console.error('[WebContainer] Error reading output:', err);
                }
              };
              
              // Start reading output
              const outputPromise = readOutput();
              
              // Wait for process to complete
              const exitCode = await process.exit;
              
              // Wait for all output to be read
              await outputPromise;
              
              console.log(`[WebContainer] Command completed with exit code: ${exitCode}`);
              
              result = {
                success: exitCode === 0,
                exitCode,
                output: output.trim(),
                command: `${command} ${args.join(' ')}`,
                message: exitCode === 0 ? 'Command executed successfully' : `Command failed with exit code ${exitCode}`
              };
            } catch (commandError) {
              console.error(`[WebContainer] Failed to run command ${command}:`, commandError);
              result = {
                success: false,
                exitCode: -1,
                output: '',
                error: commandError instanceof Error ? commandError.message : 'Unknown error',
                command: `${command} ${args.join(' ')}`,
                message: `Failed to execute command: ${commandError instanceof Error ? commandError.message : 'Unknown error'}`
              };
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

    const sendResponse = async (responseId: string, result: Record<string, unknown> | null, error: string | null) => {
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
                } catch {
                  // Skip files that can't be read (binary, permissions, etc.)
                  console.log(`[WebContainer] Skipping unreadable file: ${fullPath}`);
                }
              }
            }
          }
        } catch {
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
      console.log('[WebContainer] Starting polling for tool requests');
      pollInterval = setInterval(pollForRequests, 1000); // Poll every second
    } else {
      console.log('[WebContainer] Polling condition not met:', { 
        hasWebContainer: !!webcontainerRef.current, 
        isLoading 
      });
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isLoading, url, markFileAsChanged, buildErrors]);

  // Start polling as soon as WebContainer is available
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | undefined;

    if (webcontainerRef.current) {
      console.log('[WebContainer] WebContainer available, starting polling immediately');
      pollInterval = setInterval(async () => {
        if (!webcontainerRef.current) return;

        try {
          const response = await fetch('/api/webcontainer');
          if (response.ok) {
            const data = await response.json();
            
            if (data.requests && data.requests.length > 0) {
              console.log(`[WebContainer] Processing ${data.requests.length} pending requests`);
              for (const request of data.requests) {
                // Process each request directly
                if (!webcontainerRef.current) {
                  await fetch('/api/webcontainer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ responseId: request.id, result: null, error: 'WebContainer not available' })
                  });
                  continue;
                }

                try {
                  let result;
                  const { action, params } = request;

                  switch (action) {
                    case 'runCommand':
                      const command = params.command as string;
                      const args = (params.args as string[]) || [];
                      console.log(`[WebContainer] Running command: ${command} ${args.join(' ')}`);
                      try {
                        const process = await webcontainerRef.current.spawn(command, args);
                        let output = '';
                        const outputReader = process.output.getReader();
                        const decoder = new TextDecoder();
                        
                        const readOutput = async () => {
                          try {
                            while (true) {
                              const { done, value } = await outputReader.read();
                              if (done) break;
                              if (value && typeof value === 'object') {
                                const chunk = decoder.decode(value as Uint8Array);
                                output += chunk;
                                console.log(`[WebContainer Command Output]: ${chunk}`);
                              }
                            }
                          } catch (err) {
                            console.error('[WebContainer] Error reading output:', err);
                          }
                        };
                        
                        const outputPromise = readOutput();
                        const exitCode = await process.exit;
                        await outputPromise;
                        
                        console.log(`[WebContainer] Command completed with exit code: ${exitCode}`);
                        
                        result = {
                          success: exitCode === 0,
                          exitCode,
                          output: output.trim(),
                          command: `${command} ${args.join(' ')}`,
                          message: exitCode === 0 ? 'Command executed successfully' : `Command failed with exit code ${exitCode}`
                        };
                      } catch (commandError) {
                        console.error(`[WebContainer] Failed to run command ${command}:`, commandError);
                        result = {
                          success: false,
                          exitCode: -1,
                          output: '',
                          error: commandError instanceof Error ? commandError.message : 'Unknown error',
                          command: `${command} ${args.join(' ')}`,
                          message: `Failed to execute command: ${commandError instanceof Error ? commandError.message : 'Unknown error'}`
                        };
                      }
                      break;
                    default:
                      result = { error: `Unknown action: ${action}` };
                  }

                  await fetch('/api/webcontainer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ responseId: request.id, result, error: null })
                  });
                } catch (error) {
                  console.error(`WebContainer ${request.action} failed:`, error);
                  await fetch('/api/webcontainer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ responseId: request.id, result: null, error: error instanceof Error ? error.message : 'Unknown error' })
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error('Failed to poll for WebContainer requests:', error);
        }
      }, 1000); // Poll every second
    }

    return () => {
      if (pollInterval) {
        console.log('[WebContainer] Stopping immediate polling');
        clearInterval(pollInterval);
      }
    };
  }, []);

  // Monitor repoUrl changes to trigger re-initialization if needed
  useEffect(() => {
    // RepoUrl changed, will trigger re-boot if needed
  }, [repoUrl]);

  useEffect(() => {
    // Token changed, will trigger re-boot if needed
  }, [githubToken, basebaseToken]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, githubToken, basebaseToken]);

  const cloneRepository = async (webcontainer: WebContainer, repoUrl: string, token: string): Promise<void> => {
    console.log('=== Starting repository download process ===');
    console.log('Repository URL:', repoUrl);
    console.log('Token provided:', token ? `Yes (length: ${token.length})` : 'No');
    
    // Reset file tracking for new repository
    resetTracking();

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

  interface FileStructure {
    [key: string]: {
      file?: {
        contents: string | Uint8Array;
      };
      directory?: FileStructure;
    };
  }

  const rewriteBinaryImageFiles = async (
    webcontainer: WebContainer,
    fileStructure: FileStructure,
    currentPath: string = ''
  ): Promise<void> => {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif'];
    
    for (const [name, node] of Object.entries(fileStructure)) {
      const fullPath = currentPath ? `${currentPath}/${name}` : name;
      
      if (node.directory) {
        // Recursively process directories
        await rewriteBinaryImageFiles(webcontainer, node.directory, fullPath);
      } else if (node.file) {
        // Check if this is a binary image file
        const content = node.file.contents;
        const fileExtension = name.toLowerCase().substring(name.lastIndexOf('.'));
        
        if (content instanceof Uint8Array && imageExtensions.includes(fileExtension)) {
          try {
            console.log(`Rewriting binary image file: ${fullPath}`);
            await webcontainer.fs.writeFile(fullPath, content);
          } catch (err) {
            console.warn(`Failed to rewrite binary file ${fullPath}:`, err);
          }
        }
      }
    }
  };

  const downloadAndMountFiles = async (
    webcontainer: WebContainer, 
    owner: string, 
    repo: string, 
    tree: { path: string; type: string; size: number }[], 
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

    const fileStructure: FileStructure = {};
    
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
                // Text file - decode base64 content to UTF-8 string
                console.log(`Processing text file: ${file.path}`);
                try {
                  if (fileData.content) {
                    // GitHub API returns all files as base64, decode properly to UTF-8
                    const base64Content = fileData.content.replace(/\s/g, '');
                    
                    // Use fetch with data URL to properly decode base64 to UTF-8
                    const dataUrl = `data:text/plain;base64,${base64Content}`;
                    const response = await fetch(dataUrl);
                    content = await response.text();
                  } else {
                    content = '';
                  }
                } catch (decodeErr) {
                  console.warn(`Failed to decode text file ${file.path}:`, decodeErr);
                  // Fallback to atob if fetch method fails
                  try {
                    content = atob(fileData.content.replace(/\s/g, ''));
                  } catch {
                    content = fileData.content || '';
                  }
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
                current = current[part].directory!;
              }
              
              const fileName = pathParts[pathParts.length - 1];
              current[fileName] = {
                file: {
                  contents: content
                }
              };
              
              // Track original file content for change detection
              if (typeof content === 'string') {
                setOriginalFile(file.path, content);
              }
              
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
      await webcontainer.mount(fileStructure as unknown as Parameters<typeof webcontainer.mount>[0]);
      console.log('Files mounted successfully');
      
      // Binary file rewrite: Fix corruption issue for binary files
      console.log('Rewriting binary image files to fix corruption...');
      await rewriteBinaryImageFiles(webcontainer, fileStructure);
      console.log('Binary image files rewritten successfully');
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

    // Start the dev server with environment variables
    setStatus('Starting development server...');
    console.log('[Dev Server] Starting npm run dev...');
    
    // Set up environment variables for the dev process
    const env: Record<string, string> = {};
    
    // Add BASEBASE_TOKEN if available
    if (basebaseToken) {
      env.BASEBASE_TOKEN = basebaseToken;
      console.log('[Dev Server] Setting BASEBASE_TOKEN environment variable');
    }
    
    const devProcess = await webcontainer.spawn('npm', ['run', 'dev'], {
      env: env
    });

    // Wait for server to be ready
    webcontainer.on('server-ready', (_port, url) => {
      setUrl(url);
      setIsLoading(false);
      setStatus('Development server ready');
      onDevServerReady?.();
    });

    // Log all dev server output and capture build errors
    devProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log('[Dev Server]:', data);
          
          // Capture build errors for AI agent
          const output = data?.toString() || '';
          if (output.includes('⨯') || 
              output.includes('Error:') || 
              output.includes('error:') ||  // TypeScript errors
              output.includes('Attempted import error:') ||
              output.includes('Failed to compile') ||
              output.includes('Module not found') ||
              output.includes('has no exported member') ||
              output.includes('Property') && output.includes('does not exist') ||
              output.includes('Type') && output.includes('is not assignable') ||
              output.includes('ReferenceError:') ||
              output.includes('Cannot resolve')) {
            setBuildErrors(prev => {
              const newErrors = [...prev, output.trim()];
              // Keep only last 10 errors to prevent memory bloat
              return newErrors.slice(-10);
            });
          }
          
          // Clear errors on successful rebuild
          if (output.includes('✓ Compiled') || 
              output.includes('[Fast Refresh] done')) {
            setBuildErrors([]);
          }
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
      githubToken: githubToken ? 'provided' : 'not provided',
      basebaseToken: basebaseToken ? 'provided' : 'not provided'
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
  }, [bootWebContainer, repoUrl, githubToken, basebaseToken]); // Re-runs when bootWebContainer changes (due to prop changes)

  if (error) {
    return (
      <Box h="100%" p="md">
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
      <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text size="sm" c="dimmed">{status}</Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Box h="100%" w="100%">
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
});

WebContainerManager.displayName = 'WebContainerManager';

export default WebContainerManager;