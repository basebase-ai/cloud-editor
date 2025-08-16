'use client';

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Loader, Text, Stack, Alert, Button, Tabs, Group } from '@mantine/core';
import { IconAlertCircle, IconRefresh, IconEye, IconTerminal, IconFiles } from '@tabler/icons-react';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';
import { useFileTracking } from '@/hooks/useFileTracking';

interface RailwayContainerManagerProps {
  repoUrl: string;
  githubToken: string;
  userId?: string;
  onDevServerReady?: () => void;
}

export interface RailwayContainerManagerRef {
  restartDevServer: () => Promise<void>;
  getBuildErrors: () => string[];
  getContainerUrl: () => string | null;
}

interface DeploymentInfo {
  serviceId: string;
  deploymentId: string;
  projectId: string;
  repoUrl: string;
  status: string;
  url?: string;
  createdAt: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
  type?: string;
}

const RailwayContainerManager = forwardRef<RailwayContainerManagerRef, RailwayContainerManagerProps>(
  ({ repoUrl, githubToken, userId, onDevServerReady }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const selfRef = useRef<RailwayContainerManagerRef | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [status, setStatus] = useState<string>('Initializing container...');
    const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);
    const [isDeploying, setIsDeploying] = useState<boolean>(false); // Lock to prevent double deployment
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [buildErrors, setBuildErrors] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>('preview');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [iframeError, setIframeError] = useState<string | null>(null);
    const [iframeRetryCount, setIframeRetryCount] = useState(0);
    const { markFileAsChanged } = useFileTracking();
    const eventSourceRef = useRef<EventSource | null>(null);

    // Expose methods to parent component
    useImperativeHandle(ref, () => {
      const methods = {
        restartDevServer: async () => {
          if (!deployment?.url) {
            throw new Error('Container not available');
          }

          try {
            setStatus('Restarting development server...');
            const response = await fetch('/api/container', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'restartServer',
                params: {},
                containerUrl: deployment.url,
              }),
            });

            if (!response.ok) {
              throw new Error('Failed to restart server');
            }

            setStatus('Development server restarted');
          } catch (error) {
            console.error('Failed to restart dev server:', error);
            throw error;
          }
        },
        getBuildErrors: () => {
          return buildErrors;
        },
        getContainerUrl: () => {
          return deployment?.url || null;
        }
      };
      
      // Store reference to self for internal use
      selfRef.current = methods;
      return methods;
    });

  // Function to retry iframe loading
  const retryIframe = useCallback(() => {
    if (deployment?.url && iframeRetryCount < 3) {
      console.log(`Retrying iframe load (attempt ${iframeRetryCount + 1}/3)...`);
      setIframeError(null);
      setIframeRetryCount(prev => prev + 1);
      
      // Force iframe reload by changing key
      if (iframeRef.current) {
        iframeRef.current.src = deployment.url + `?_retry=${Date.now()}`;
      }
    }
  }, [deployment?.url, iframeRetryCount]);

  // Reset retry count when deployment changes
  useEffect(() => {
    setIframeRetryCount(0);
    setIframeError(null);
  }, [deployment?.url]);

  // Auto-retry after iframe error with delay
  useEffect(() => {
    if (iframeError && iframeRetryCount < 3) {
      const timer = setTimeout(() => {
        console.log('Auto-retrying iframe after error...');
        retryIframe();
      }, 5000); // Wait 5 seconds before auto-retry

      return () => clearTimeout(timer);
    }
  }, [iframeError, iframeRetryCount, retryIframe]);

  // No more polling needed - deployment API will block until ready

  const deployContainer = useCallback(async (): Promise<void> => {
    // Prevent double deployment from React StrictMode
    if (isDeploying) {
      console.log('[RailwayContainerManager] Deployment already in progress, skipping...');
      return;
    }

    try {
      setIsDeploying(true);
      setIsLoading(true);
      setError('');
                setStatus('Deploying container to Railway... This may take up to 2 minutes.');

      // Extract project ID from repo URL
      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!repoMatch) {
        throw new Error('Invalid GitHub repository URL');
      }

      const [, owner, repo] = repoMatch;
      const projectId = `${owner}-${repo.replace('.git', '')}`;

      console.log(`[RailwayContainerManager] Starting deployment for ${projectId}...`);

      // This call will block until container is ready or fails
      const response = await fetch('/api/railway/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl,
          projectId,
          userId,
          githubToken: githubToken || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deploy container');
      }

      const data = await response.json();
      console.log(`[RailwayContainerManager] Deployment successful:`, data.deployment);
      
      setDeployment(data.deployment);
      setStatus('Container is ready!');
      setIsLoading(false);

    } catch (err) {
      console.error('Container deployment failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy container');
      setIsLoading(false);
    } finally {
      setIsDeploying(false);
    }
  }, [repoUrl, githubToken, userId, isDeploying]);

  const startLogStreaming = useCallback(async (): Promise<void> => {
    if (!deployment) return;

    try {
      const response = await fetch('/api/railway/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: deployment.serviceId,
          deploymentId: deployment.deploymentId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start log streaming');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      const readStream = async (): Promise<void> => {
        if (!reader) return;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6)) as LogEntry;
                  
                  if (data.type === 'log') {
                    setLogs(prev => [...prev.slice(-99), data]); // Keep latest 100 logs
                    
                    // Check for build errors
                    if (data.message && (
                      data.message.includes('Error:') ||
                      data.message.includes('error:') ||
                      data.message.includes('Failed to compile') ||
                      data.message.includes('Module not found')
                    )) {
                      setBuildErrors(prev => [...prev.slice(-9), data.message]); // Keep latest 10 errors
                    }
                  }
                } catch (parseError) {
                  console.warn('Failed to parse log entry:', parseError);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error reading log stream:', error);
        }
      };

      readStream();

    } catch (error) {
      console.error('Failed to start log streaming:', error);
    }
  }, [deployment]);

  // Deploy container when component mounts (only once)
  useEffect(() => {
    if (!repoUrl || deployment || isDeploying) {
      return; // Don't deploy if already deployed, deploying, or no repo URL
    }

    console.log('[RailwayContainerManager] Starting initial deployment...');
    deployContainer();
  }, [repoUrl, deployment, isDeploying, deployContainer]);

    // Start log streaming when deployment is ready
    useEffect(() => {
      if (deployment && deployment.status === 'SUCCESS') {
        startLogStreaming();
        
        // Mark as ready after a short delay to allow server to start
        setTimeout(() => {
          setIsLoading(false);
          setStatus('Container ready');
          onDevServerReady?.();
        }, 5000);
      }

      return () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
          };
  }, [deployment, onDevServerReady, startLogStreaming]);

  const handleContainerRequest = useCallback(async (request: { id: string; action: string; params: Record<string, unknown>; containerUrl?: string }): Promise<void> => {
    if (!deployment?.url) {
      await sendResponse(request.id, null, 'Container not available');
      return;
    }

    try {
      const { action, params } = request;

      // Forward request to container API using new /_container/ endpoints
      const actionEndpointMap: Record<string, string> = {
        'readFile': '/_container/read_file',
        'writeFile': '/_container/write_file', 
        'listFiles': '/_container/list_files',
        'runCommand': '/_container/run_command',
        'restartServer': '/_container/restart_server',
        // 'checkStatus': '/_container/health', // This is a GET endpoint, incompatible with our POST approach
        'searchFiles': '/_container/search_files',
        'replaceLines': '/_container/replace_lines',
        'deleteFile': '/_container/delete_file',
      };

      const endpoint = actionEndpointMap[action];
      if (!endpoint) {
        throw new Error(`Unsupported action: ${action}`);
      }

      const containerResponse = await fetch(`${deployment.url}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!containerResponse.ok) {
        throw new Error(`Container API responded with ${containerResponse.status}`);
      }

      const result = await containerResponse.json();

      // Update file tracking for write operations
      if (action === 'writeFile' && result.success) {
        markFileAsChanged(params.path as string, params.content as string);
      } else if (action === 'replaceLines' && result.success) {
        // For replace operations, we'd need to fetch the updated content
        // This is a simplified approach
        markFileAsChanged(params.path as string, 'updated');
      }

      await sendResponse(request.id, result, null);
    } catch (error) {
      console.error(`Container ${request.action} failed:`, error);
      await sendResponse(request.id, null, error instanceof Error ? error.message : 'Unknown error');
    }
  }, [deployment, markFileAsChanged]);

  const sendResponse = async (responseId: string, result: Record<string, unknown> | null, error: string | null): Promise<void> => {
    try {
      await fetch('/api/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseId, result, error })
      });
    } catch (err) {
      console.error('Failed to send container response:', err);
    }
  };

  // Container bridge - poll for requests from server-side tools
  useEffect(() => {
      let pollInterval: NodeJS.Timeout;

      const pollForRequests = async () => {
        if (!deployment?.url) return;

        try {
          const response = await fetch('/api/container');
          if (response.ok) {
            const data = await response.json();
            
            for (const request of data.requests) {
              await handleContainerRequest(request);
            }
          }
        } catch (error) {
          console.error('Failed to poll for container requests:', error);
        }
      };

      if (deployment?.url && !isLoading) {
        console.log('[Container] Starting polling for tool requests');
        pollInterval = setInterval(pollForRequests, 1000);
      }

      return () => {
        if (pollInterval) {
                  clearInterval(pollInterval);
      }
    };
  }, [deployment, isLoading, handleContainerRequest]);









    const retry = useCallback((): void => {
      setError('');
      setIsLoading(true);
      setDeployment(null);
      setLogs([]);
      setBuildErrors([]);
      setStatus('Retrying container deployment...');
      deployContainer();
    }, [deployContainer]);

    if (error) {
      return (
        <Box h="100%" p="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
            <Text fw={500} mb="xs">Container Error</Text>
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

    return (
      <Box h="100%" style={{ minWidth: '320px' }}>
        <Tabs value={activeTab} onChange={setActiveTab} h="100%">
          <Tabs.List>
            <Tabs.Tab value="preview" leftSection={<IconEye size={16} />}>
              Preview
            </Tabs.Tab>
            <Tabs.Tab value="logs" leftSection={<IconTerminal size={16} />}>
              Logs {logs.length > 0 && `(${logs.length})`}
            </Tabs.Tab>
            <Tabs.Tab value="files" leftSection={<IconFiles size={16} />}>
              Files
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="preview" h="calc(100% - 40px)">
            <Box h="100%" w="100%">
              {isLoading ? (
                <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Stack align="center" gap="md">
                    <Loader size="lg" />
                    <Text size="sm" c="dimmed">{status}</Text>
                  </Stack>
                </Box>
              ) : deployment?.url ? (
                <Box h="100%" w="100%">
                  <Box p="xs" style={{ borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))' }}>
                    <Text size="xs" c="dimmed">
                      Container URL: {deployment.url}
                    </Text>
                    {iframeError && (
                      <Group gap="xs" mt="xs">
                        <Text size="xs" c="red">
                          {iframeError}
                        </Text>
                        {iframeRetryCount < 3 && (
                          <Button size="xs" variant="light" onClick={retryIframe}>
                            Retry ({iframeRetryCount + 1}/3)
                          </Button>
                        )}
                      </Group>
                    )}
                  </Box>
                  {iframeError && iframeRetryCount >= 3 ? (
                    <Box h="calc(100% - 60px)" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
                      <Stack align="center" gap="md">
                        <Text size="lg" fw={500} c="red">Connection Failed</Text>
                        <Text size="sm" c="dimmed" ta="center">
                          The container is deployed but not responding yet.<br/>
                          This can take 1-2 minutes for the service to start up.
                        </Text>
                        <Button variant="light" onClick={() => {
                          setIframeRetryCount(0);
                          setIframeError(null);
                          retryIframe();
                        }}>
                          Try Again
                        </Button>
                      </Stack>
                    </Box>
                  ) : (
                    <iframe
                      ref={iframeRef}
                      src={deployment.url}
                      key={`iframe-${deployment.url}-${iframeRetryCount}`}
                      style={{
                        width: '100%',
                        height: 'calc(100% - 60px)',
                        border: 'none',
                        backgroundColor: '#ffffff'
                      }}
                      title="Railway Container Preview"
                      onError={() => {
                        console.error('Iframe failed to load:', deployment.url);
                        setIframeError('Failed to connect to container. The service may still be starting up.');
                      }}
                      onLoad={() => {
                        console.log('Iframe loaded successfully for:', deployment.url);
                        setIframeError(null);
                      }}
                    />
                  )}
                </Box>
              ) : (
                <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Stack align="center" gap="md">
                    <Text size="lg" fw={500}>No Preview Available</Text>
                    <Text size="sm" c="dimmed">
                      Deploy a container to see the preview here
                    </Text>
                  </Stack>
                </Box>
              )}
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="logs" h="calc(100% - 40px)">
            <Box h="100%" p="md" style={{ overflow: 'auto', backgroundColor: '#1a1a1a', color: '#ffffff', fontFamily: 'monospace' }}>
              {logs.length === 0 ? (
                <Text c="dimmed">Waiting for logs...</Text>
              ) : (
                logs.map((log, index) => (
                  <Box key={index} mb="xs">
                    <Text size="xs" c="dimmed" span>
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </Text>
                    <Text size="sm" ml="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {log.message}
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="files" h="calc(100% - 40px)">
            <Group h="100%" gap={0} align="stretch">
              {/* File Explorer - Left Side */}
              <Box 
                w={300} 
                h="100%" 
                style={{ 
                  minWidth: '200px',
                  borderRight: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                  backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))'
                }}
              >
                <FileExplorer
                  onFileSelect={setSelectedFile}
                  selectedFile={selectedFile}
                  containerRef={selfRef}
                />
              </Box>

              {/* Code Editor - Right Side */}
              <Box style={{ flex: 1 }} h="100%">
                <CodeEditor
                  filePath={selectedFile}
                  containerRef={selfRef}
                />
              </Box>
            </Group>
          </Tabs.Panel>
        </Tabs>
      </Box>
    );
  }
);

RailwayContainerManager.displayName = 'RailwayContainerManager';

export default RailwayContainerManager;
