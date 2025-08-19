'use client';

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Box, Loader, Text, Stack, Alert, Button, Tabs, Group } from '@mantine/core';
import { IconAlertCircle, IconRefresh, IconEye, IconTerminal, IconFiles } from '@tabler/icons-react';
import { TextInput } from '@mantine/core';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';
import { useFileTracking } from '@/hooks/useFileTracking';

interface RailwayContainerManagerProps {
  repoUrl: string;
  githubToken: string;
  userId?: string;
  onDevServerReady?: (deploymentUrl?: string) => void;
}

export interface RailwayContainerManagerRef {
  restartDevServer: () => Promise<void>;
  getBuildErrors: () => string[];
  getContainerUrl: () => string | null;
  checkForAIChanges: () => Promise<void>;
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
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [shouldShowIframe, setShouldShowIframe] = useState(false);
  const [isContainerHealthy, setIsContainerHealthy] = useState(false);
  const { markFileAsChanged, onFileChange, removeFileChangeListener } = useFileTracking();
  const eventSourceRef = useRef<EventSource | null>(null);
  const deploymentInProgressRef = useRef<boolean>(false); // Additional lock to prevent race conditions

  // Expose methods to parent component
  useImperativeHandle(ref, () => {
    const methods = {
      getContainerUrl: () => deployment?.url || null,
      restartDevServer: async (): Promise<void> => {
        if (!deployment?.url) {
          throw new Error('Container not ready');
        }
        
        try {
          const response = await fetch('/api/container', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'restartServer',
              containerUrl: deployment.url,
            }),
          });
          
          if (!response.ok) {
            throw new Error('Failed to restart dev server');
          }
          
          console.log('Dev server restart initiated');
        } catch (error) {
          console.error('Error restarting dev server:', error);
          throw error;
        }
             },
       getBuildErrors: () => {
         return buildErrors;
       },
              checkForAIChanges: async (): Promise<void> => {
         if (!deployment?.url || !isContainerHealthy) return;
        
        try {
          const response = await fetch('/api/chat?action=getFileChanges');
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.changedFiles && data.changedFiles.length > 0) {
              console.log(`[RailwayContainerManager] Immediate AI changed files:`, data.changedFiles);
              
              // Update file tracking for each changed file
              for (const filePath of data.changedFiles) {
                try {
                  // Read the updated file content
                  const fileResponse = await fetch('/api/container', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'readFile',
                      params: { path: filePath },
                      containerUrl: deployment.url,
                    }),
                  });

                  if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    if (fileData.success && fileData.content) {
                      // Mark the file as changed in the tracking system
                      markFileAsChanged(filePath, fileData.content);
                    }
                  }
                } catch (error) {
                  console.error(`[RailwayContainerManager] Failed to read AI-changed file ${filePath}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error('[RailwayContainerManager] Failed to check for AI file changes:', error);
        }
      }
    };
    
    // Store reference to self for internal use
    selfRef.current = methods;
    return methods;
  });

  // Function to retry iframe loading
  const retryIframe = useCallback(() => {
    if (deployment?.url && iframeRetryCount < 5) {
      console.log(`Retrying iframe load (attempt ${iframeRetryCount + 1}/5)...`);
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
    setIframeLoaded(false);
  }, [deployment?.url]);

  // Auto-retry after iframe error with delay
  useEffect(() => {
    if (iframeError && iframeRetryCount < 5) {
      const timer = setTimeout(() => {
        console.log('Auto-retrying iframe after error...');
        retryIframe();
      }, 5000); // Wait 5 seconds before auto-retry

      return () => clearTimeout(timer);
    }
  }, [iframeError, iframeRetryCount, retryIframe]);

  // Show iframe when container is healthy
  useEffect(() => {
    if (isContainerHealthy && !iframeLoaded) {
      console.log('Container is healthy, waiting 2 seconds before showing iframe...');
      // Add a small delay to ensure Next.js app is fully stable
      const timer = setTimeout(() => {
        console.log('Showing iframe after health check delay');
        setShouldShowIframe(true);
        setIframeRetryCount(prev => prev + 1);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [isContainerHealthy, iframeLoaded]);

  // Update currentUrl when deployment URL changes
  useEffect(() => {
    if (deployment?.url && currentUrl !== deployment.url) {
      setCurrentUrl(deployment.url);
      // Reset iframe visibility when URL changes (new deployment)
      setShouldShowIframe(false);
      // Reset health state for new deployment
      setIsContainerHealthy(false);
    }
  }, [deployment?.url, currentUrl]);

  // Handle URL changes and iframe navigation
  const handleUrlChange = useCallback((newUrl: string) => {
    setCurrentUrl(newUrl);
    setIframeError(null);
    setIframeLoaded(false);
    setIframeRetryCount(0);
    
    // Update iframe src if iframe exists
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = newUrl;
    }
  }, []);

  const handleUrlSubmit = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const target = event.target as HTMLInputElement;
      handleUrlChange(target.value);
    }
  }, [handleUrlChange]);

  const handleReload = useCallback(() => {
    console.log('Manual iframe reload requested for:', currentUrl);
    setIframeRetryCount(prev => prev + 1);
    setIframeError(null);
    setIframeLoaded(false);
    // Force show iframe immediately for manual reloads
    setShouldShowIframe(true);
    
    // Force iframe reload by changing src with timestamp
    const iframe = iframeRef.current;
    if (iframe && currentUrl) {
      const urlWithTimestamp = currentUrl.includes('?') 
        ? `${currentUrl}&_reload=${Date.now()}`
        : `${currentUrl}?_reload=${Date.now()}`;
      iframe.src = urlWithTimestamp;
    }
  }, [currentUrl]);

  // File change listener for automatic iframe reloading
  const handleFileChange = useCallback((filePath: string) => {
    console.log(`[RailwayContainerManager] File changed: ${filePath}, triggering iframe reload`);
    
    // Only reload if we're on the preview tab and iframe is loaded
    if (activeTab === 'preview' && iframeLoaded && shouldShowIframe) {
      // Add a small delay to allow the file system to settle
      setTimeout(() => {
        handleReload();
      }, 500);
    }
  }, [activeTab, iframeLoaded, shouldShowIframe, handleReload]);

  // Register file change listener
  useEffect(() => {
    onFileChange(handleFileChange);
    
    return () => {
      removeFileChangeListener(handleFileChange);
    };
  }, [onFileChange, removeFileChangeListener, handleFileChange]);

  // Poll for AI file changes
  useEffect(() => {
    if (!deployment?.url || !isContainerHealthy) return;

    const pollForAIChanges = async () => {
      try {
        const response = await fetch('/api/chat?action=getFileChanges');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.changedFiles && data.changedFiles.length > 0) {
            console.log(`[RailwayContainerManager] AI changed files:`, data.changedFiles);
            
            // Update file tracking for each changed file
            for (const filePath of data.changedFiles) {
              try {
                // Read the updated file content
                const fileResponse = await fetch('/api/container', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'readFile',
                    params: { path: filePath },
                    containerUrl: deployment.url,
                  }),
                });

                if (fileResponse.ok) {
                  const fileData = await fileResponse.json();
                  if (fileData.success && fileData.content) {
                    // Mark the file as changed in the tracking system
                    markFileAsChanged(filePath, fileData.content);
                  }
                }
              } catch (error) {
                console.error(`[RailwayContainerManager] Failed to read AI-changed file ${filePath}:`, error);
              }
            }
          }
        }
      } catch (error) {
        console.error('[RailwayContainerManager] Failed to poll for AI file changes:', error);
      }
    };

    // Poll every 5 seconds for AI file changes, but only when container is healthy
    const interval = setInterval(pollForAIChanges, 5000);
    
    return () => clearInterval(interval);
  }, [deployment?.url, isContainerHealthy, markFileAsChanged]);

  // No more polling needed - deployment API will block until ready

  const deployContainer = useCallback(async (): Promise<void> => {
    // Prevent double deployment from React StrictMode and race conditions
    if (isDeploying || deploymentInProgressRef.current) {
      console.log('[RailwayContainerManager] Deployment already in progress, skipping...');
      return;
    }

    // Set the deployment lock
    deploymentInProgressRef.current = true;

    try {
      setIsDeploying(true);
      setIsLoading(true);
      setError('');
                setStatus('Setting up a workspace in the cloud (this can take up to 30 seconds)...');

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
      setStatus('Your workspace is ready!');
      setIsLoading(false);

    } catch (err) {
      console.error('Container deployment failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy container');
      setIsLoading(false);
    } finally {
      setIsDeploying(false);
      deploymentInProgressRef.current = false; // Release the deployment lock
    }
  }, [repoUrl, githubToken, userId, isDeploying]);

  const startLogStreaming = useCallback(async (): Promise<void> => {
    if (!deployment) return;

    console.log('[RailwayContainerManager] Starting log streaming for deployment:', deployment);

    try {
      // First try Railway logs API
      const response = await fetch('/api/railway/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: deployment.serviceId || 'user-td2yj8-nextjs-starter-dev',
          deploymentId: deployment.deploymentId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[RailwayContainerManager] Railway logs API failed:', response.status, errorText);
        throw new Error(`Failed to start Railway log streaming: ${response.status}`);
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
                  } else if (data.type === 'error') {
                    console.error('[RailwayContainerManager] Log stream error:', data.message);
                    // Don't immediately fallback on GraphQL errors, let it retry
                  } else if (data.type === 'connected') {
                    console.log('[RailwayContainerManager] Railway log stream connected');
                  }
                } catch (parseError) {
                  console.warn('Failed to parse log entry:', parseError);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error reading Railway log stream:', error);
          // Fallback to container direct logs
          startContainerDirectLogStreaming();
        }
      };

      readStream();

    } catch (error) {
      console.error('Failed to start Railway log streaming:', error);
      // Fallback to container direct logs
      startContainerDirectLogStreaming();
    }
  }, [deployment]);

  // Fallback: Direct container log streaming
  const startContainerDirectLogStreaming = useCallback(async (): Promise<void> => {
    if (!deployment?.url) return;

    console.log('[RailwayContainerManager] Starting direct container log streaming...');

    try {
      const containerLogsUrl = `${deployment.url}/_container/logs/stream`;
      const eventSource = new EventSource(containerLogsUrl);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LogEntry;
          
          if (data.type === 'log' || data.type === 'app_log') {
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
          console.warn('Failed to parse container log entry:', parseError);
        }
      };

      eventSource.onerror = (error) => {
        console.error('Container log stream error:', error);
        eventSource.close();
        eventSourceRef.current = null;
      };

      eventSource.onopen = () => {
        console.log('[RailwayContainerManager] Container log stream connected');
      };

    } catch (error) {
      console.error('Failed to start container direct log streaming:', error);
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

      // Health check function
  const checkContainerHealth = useCallback(async (containerUrl: string): Promise<{ healthy: boolean; details?: Record<string, unknown> }> => {
    try {
      const healthResponse = await fetch('/api/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkHealth',
          containerUrl,
        }),
      });
      
      if (!healthResponse.ok) {
        return { healthy: false };
      }
      
      const healthData = await healthResponse.json();
      
      if (!healthData.success) {
        return { healthy: false, details: healthData };
      }
      
      return { 
        healthy: healthData.healthy,
        details: healthData.details 
      };
    } catch (error) {
      return { healthy: false };
    }
  }, []);

  // Start health check and log streaming when deployment is ready
  useEffect(() => {
    if (deployment && deployment.status === 'SUCCESS' && deployment.url) {
      console.log('Deployment successful, starting health check...');
      setStatus('Checking container health...');
      
      const performHealthCheck = async () => {
        let attempts = 0;
        const maxAttempts = 30; // 60 seconds total (30 * 2 second intervals)
        
        while (attempts < maxAttempts) {
          attempts++;
          console.log(`Health check attempt ${attempts}/${maxAttempts}...`);
          
          const healthResult = await checkContainerHealth(deployment.url!);
          console.log(`Health check result:`, healthResult);
          
          if (healthResult.healthy) {
            console.log('Container is healthy!', healthResult.details);
            setIsContainerHealthy(true);
            setStatus('Container ready');
            setIsLoading(false);
            startLogStreaming();
            onDevServerReady?.(deployment?.url);
            return;
          } else {
            console.log('Container not ready:', healthResult.details);
          }
          
          if (attempts < maxAttempts) {
            const details = healthResult.details as Record<string, unknown>;
            const services = details?.services as Record<string, unknown>;
            const userApp = services?.userApp as Record<string, unknown>;
            const userAppResponding = userApp?.responding as boolean;
            const userAppStatusCode = userApp?.statusCode as number;
            
            let statusMessage: string;
            if (userAppResponding && userAppStatusCode === 200) {
              statusMessage = `Container ready! (attempt ${attempts}/${maxAttempts})`;
            } else if (userAppResponding) {
              statusMessage = `Next.js app responding but not ready... (attempt ${attempts}/${maxAttempts})`;
            } else {
              statusMessage = `Container API starting... (attempt ${attempts}/${maxAttempts})`;
            }
            
            console.log('Container not ready yet, retrying in 2 seconds...');
            setStatus(statusMessage);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // If we get here, health check failed
        console.error('Container health check failed after maximum attempts');
        setStatus('Container health check failed');
        setError('Container failed to start properly');
        setIsLoading(false);
      };
      
      performHealthCheck();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [deployment, onDevServerReady, startLogStreaming, checkContainerHealth]);

  // Direct API calls are used instead of polling

  // Direct API calls are used instead of polling

    // No polling needed - direct API calls are used instead









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
                    {deployment?.url && (
                      <Text size="xs" c="dimmed">
                        Container: {isContainerHealthy ? 'Healthy' : 'Starting...'}
                      </Text>
                    )}
                  </Stack>
                </Box>
              ) : deployment?.url && shouldShowIframe ? (
                <Box h="100%" w="100%">
                  <Box p="xs" style={{ borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))' }}>
                    <Group gap="xs" align="center">
                      <TextInput
                        value={currentUrl}
                        onChange={(event) => setCurrentUrl(event.currentTarget.value)}
                        onKeyDown={handleUrlSubmit}
                        placeholder="Enter URL..."
                        size="xs"
                        style={{ flex: 1 }}
                        rightSection={
                          <Group gap="xs" wrap="nowrap">
                            {!iframeLoaded && !iframeError && (
                              <Text size="xs" c="yellow">●</Text>
                            )}
                            {iframeLoaded && !iframeError && (
                              <Text size="xs" c="green">●</Text>
                            )}
                            {iframeError && (
                              <Text size="xs" c="red">●</Text>
                            )}
                          </Group>
                        }
                      />
                      <Button 
                        size="xs" 
                        variant="light"
                        p={4}
                        onClick={handleReload}
                      >
                        <IconRefresh size={14} />
                      </Button>
                    </Group>
                    {iframeError && (
                      <Group gap="xs" mt="xs">
                        <Text size="xs" c="red">
                          {iframeError}
                        </Text>
                        {iframeRetryCount < 5 && (
                          <Button size="xs" variant="light" onClick={retryIframe}>
                            Retry ({iframeRetryCount + 1}/5)
                          </Button>
                        )}
                      </Group>
                    )}
                  </Box>
                  {iframeError ? (
                    <Box h="calc(100% - 60px)" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
                      <Stack align="center" gap="md">
                        <Text size="lg" fw={500} c="red">Preview Not Available</Text>
                        <Text size="sm" c="dimmed" ta="center" maw={400}>
                          {iframeError || 'The container may still be starting up or experiencing issues.'}
                        </Text>
                        <Text size="xs" c="dimmed" ta="center" maw={400}>
                          URL: {currentUrl}
                        </Text>
                        <Text size="xs" c="dimmed" ta="center" maw={400}>
                          Retry attempts: {iframeRetryCount}
                        </Text>
                        <Group gap="md">
                          <Button 
                            variant="filled" 
                            onClick={() => window.open(currentUrl, '_blank')}
                          >
                            Open in New Tab
                          </Button>
                          {iframeRetryCount < 5 && (
                            <Button variant="light" onClick={() => {
                              setIframeRetryCount(0);
                              setIframeError(null);
                              setIframeLoaded(false);
                              retryIframe();
                            }}>
                              Try Again
                            </Button>
                          )}
                        </Group>
                      </Stack>
                    </Box>
                  ) : (
                    <iframe
                      ref={iframeRef}
                      src={currentUrl}
                      key={`iframe-${currentUrl}-${iframeRetryCount}`}
                      style={{
                        width: '100%',
                        height: 'calc(100% - 60px)',
                        border: 'none',
                        backgroundColor: '#ffffff'
                      }}
                      title="Railway Container Preview"
                      onError={() => {
                        console.error('Iframe failed to load:', currentUrl);
                        console.error('Iframe error details:', {
                          url: currentUrl,
                          retryCount: iframeRetryCount,
                          timestamp: new Date().toISOString()
                        });
                        setIframeLoaded(false);
                        setIframeError('Next.js app is still starting up (503 error). Retrying automatically...');
                        
                        // Auto-retry after 3 seconds if we haven't exceeded max retries
                        if (iframeRetryCount < 5) {
                          setTimeout(() => {
                            console.log('Auto-retrying iframe after 503 error...');
                            setIframeRetryCount(prev => prev + 1);
                            setIframeError(null);
                            setIframeLoaded(false);
                          }, 3000);
                        }
                      }}
                      onLoad={() => {
                        console.log('Iframe loaded successfully for:', currentUrl);
                        setIframeLoaded(true);
                        setIframeError(null);
                      }}
                    />
                  )}
                </Box>
              ) : deployment?.url && !shouldShowIframe ? (
                <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Stack align="center" gap="md">
                    <Loader size="lg" />
                    <Text size="sm" c="dimmed">Your workspace is ready! Starting the app now...</Text>
                  </Stack>
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
                  <Box key={index} mb={1}>
                    <Text size="xs" c="dimmed" span>
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </Text>
                    <Text size="sm" ml="sm" span style={{ whiteSpace: 'pre-wrap' }}>
                      {log.message}
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="files" h="calc(100% - 40px)" style={{ overflow: 'hidden' }}>
            <Group h="100%" gap={0} align="stretch" style={{ overflow: 'hidden' }}>
              {/* File Explorer - Left Side */}
              <Box 
                w={300} 
                h="100%" 
                style={{ 
                  minWidth: '200px',
                  maxWidth: '300px',
                  borderRight: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                  backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))',
                  overflow: 'hidden'
                }}
              >
                <FileExplorer
                  onFileSelect={setSelectedFile}
                  selectedFile={selectedFile}
                  containerRef={selfRef}
                />
              </Box>

              {/* Code Editor - Right Side */}
              <Box style={{ flex: 1, overflow: 'hidden' }} h="100%">
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
