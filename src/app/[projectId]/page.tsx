'use client';

import { AppShell, Button, Text, Group, ActionIcon, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { WebContainerManagerRef } from '@/components/WebContainerManager';
import TabbedWebContainer from '@/components/TabbedWebContainer';
import ChatInterface, { ChatInterfaceRef } from '@/components/ChatInterface';
import GitHubTokenModal from '@/components/GitHubTokenModal';
import CommitModal from '@/components/CommitModal';
import FileStatusIndicator from '@/components/FileStatusIndicator';
import { useFileTracking } from '@/hooks/useFileTracking';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const chatRef = useRef<ChatInterfaceRef>(null);
  const webContainerRef = useRef<WebContainerManagerRef>(null);
  const { resetTracking } = useFileTracking();
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [basebaseToken, setBasebaseToken] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [showTokenModal, setShowTokenModal] = useState<boolean>(false);
  const [showCommitModal, setShowCommitModal] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Debug logging for state changes
  useEffect(() => {
    console.log('State changed - repoUrl:', repoUrl);
  }, [repoUrl]);

  useEffect(() => {
    console.log('State changed - githubToken:', githubToken ? 'Set' : 'Empty');
  }, [githubToken]);

  useEffect(() => {
    console.log('Page component initializing...');
    console.log('Current URL:', window.location.href);
    console.log('Project ID:', projectId);
    
    // Get query params
    const urlParams = new URLSearchParams(window.location.search);
    const url = urlParams.get('repo');
    const token = urlParams.get('token');
    console.log('Query params:', Object.fromEntries(urlParams.entries()));
    console.log('Repo URL from params:', url);
    console.log('JWT token from params:', token ? 'Found' : 'Not found');
    
    // Handle repo URL
    if (url) {
      console.log('Setting repo URL:', url);
      setRepoUrl(url);
    } else {
      console.log('No repo URL found in query params');
    }

    // Handle JWT token from URL
    if (token) {
      console.log('Found JWT token in URL, saving to localStorage');
      localStorage.setItem('basebase_token', token);
      setBasebaseToken(token);
      
      // Remove token from URL for security
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('token');
      window.history.replaceState({}, '', newUrl.toString());
      console.log('Token removed from URL');
    } else {
      // Check if token exists in localStorage from previous session
      const storedToken = localStorage.getItem('basebase_token');
      if (storedToken) {
        console.log('Found stored JWT token in localStorage');
        setBasebaseToken(storedToken);
      } else {
        console.log('No JWT token found in URL or localStorage');
      }
    }

    // Get GitHub token from localStorage (separate from JWT token)
    const githubToken = localStorage.getItem('github_token');
    console.log('GitHub token from localStorage:', githubToken ? 'Found' : 'Not found');
    
    if (githubToken) {
      console.log('Setting GitHub token');
      setGithubToken(githubToken);
    } else {
      console.log('No GitHub token in localStorage - will show modal');
      setShowTokenModal(true);
    }

    // Mark as initialized after setting initial state
    setIsInitialized(true);
    console.log('Page component initialization complete');
  }, [projectId]);

  const handleTokenSubmit = (token: string) => {
    console.log('GitHub token submitted successfully');
    setGithubToken(token);
    setShowTokenModal(false);
  };

  const handleModalClose = () => {
    setShowTokenModal(false);
  };

  const handleDevServerReady = () => {
    console.log('Dev server is ready, adding welcome message to chat');
    chatRef.current?.addMessage('Hello. How can I help you to improve this app?', 'assistant');
  };

  const handleCommitSuccess = () => {
    console.log('Commit successful, resetting file change tracking');
    // Reset the file tracking cache
    resetTracking();
    // Reset the hasChanges state to hide the Publish button
    setHasChanges(false);
  };

  const handleRefresh = async () => {
    if (!webContainerRef.current) {
      console.error('WebContainer not available');
      return;
    }

    setIsRefreshing(true);
    
    try {
      await webContainerRef.current.restartDevServer();
      console.log('Dev server restart completed');
    } catch (error) {
      console.error('Error restarting dev server:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <AppShell
      header={{ height: 60 }}
      aside={{ width: 400, breakpoint: 'md' }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <div>
            <Text size="lg" fw={600}>BaseBase Editor</Text>
            <Text size="xs" c="dimmed">{projectId}</Text>
          </div>
          <Group gap="xs">
            <FileStatusIndicator />
            <Tooltip label="Restart dev server">
              <ActionIcon
                variant="light"
                color="gray"
                size="lg"
                onClick={handleRefresh}
                loading={isRefreshing}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <Button 
              variant={hasChanges ? 'filled' : 'light'} 
              disabled={!hasChanges}
              color="blue"
              onClick={() => setShowCommitModal(true)}
            >
              Publish
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Aside p={0}>
        <ChatInterface 
          ref={chatRef}
          onCodeChange={() => setHasChanges(true)}
          repoUrl={repoUrl}
          githubToken={githubToken}
        />
      </AppShell.Aside>

      <AppShell.Main h="calc(100vh - 60px)">
        {isInitialized && (
          <TabbedWebContainer 
            webContainerRef={webContainerRef}
            repoUrl={repoUrl}
            githubToken={githubToken}
            basebaseToken={basebaseToken}
            onDevServerReady={handleDevServerReady}
          />
        )}
      </AppShell.Main>

      <GitHubTokenModal
        opened={showTokenModal}
        onClose={handleModalClose}
        onTokenSubmit={handleTokenSubmit}
      />

      <CommitModal
        opened={showCommitModal}
        onClose={() => setShowCommitModal(false)}
        githubToken={githubToken}
        repoUrl={repoUrl}
        onCommitSuccess={handleCommitSuccess}
      />
    </AppShell>
  );
}
