'use client';

import { AppShell, Button, Text, Group, ActionIcon, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { RailwayContainerManagerRef } from '@/components/RailwayContainerManager';
import TabbedRailwayContainer from '@/components/TabbedRailwayContainer';
import ChatInterface, { ChatInterfaceRef } from '@/components/ChatInterface';
import GitHubTokenModal from '@/components/GitHubTokenModal';
import CommitModal from '@/components/CommitModal';
import FileStatusIndicator from '@/components/FileStatusIndicator';
import { useFileTracking } from '@/hooks/useFileTracking';

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const chatRef = useRef<ChatInterfaceRef>(null);
  const containerRef = useRef<RailwayContainerManagerRef>(null);
  const { resetTracking } = useFileTracking();
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [userId, setUserId] = useState<string>('');


  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [showTokenModal, setShowTokenModal] = useState<boolean>(false);
  const [showCommitModal, setShowCommitModal] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [containerUrl, setContainerUrl] = useState<string | null>(null);
  const hasShownWelcomeMessageRef = useRef<boolean>(false);

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

    // JWT token handling removed as it's not needed for Railway containers

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

    // Get or generate userId for multi-tenant Railway services
    let userId = localStorage.getItem('user_id');
    if (!userId) {
      // Generate a simple userId if none exists (could be replaced with actual auth)
      userId = `user-${Math.random().toString(36).substring(2, 8)}`;
      localStorage.setItem('user_id', userId);
      console.log('Generated new userId:', userId);
    } else {
      console.log('Found existing userId:', userId);
    }
    setUserId(userId);

    // Railway credentials are server-side only for security

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

  const handleDevServerReady = (deploymentUrl?: string) => {
    console.log('Dev server is ready');
    if (deploymentUrl) {
      setContainerUrl(deploymentUrl);
    }
    if (!hasShownWelcomeMessageRef.current) {
      console.log('Adding welcome message to chat');
      chatRef.current?.addMessage('Hello. How can I help you to improve this app?', 'assistant');
      hasShownWelcomeMessageRef.current = true;
    }
  };

  const handleCommitSuccess = () => {
    console.log('Commit successful, resetting file change tracking');
    // Reset the file tracking cache
    resetTracking();
    // Reset the hasChanges state to hide the Publish button
    setHasChanges(false);
  };

  const handleRefresh = async () => {
    if (!containerRef.current) {
      console.error('Container not available');
      return;
    }

    setIsRefreshing(true);
    
    try {
      await containerRef.current.restartDevServer();
      console.log('Dev server restart completed');
    } catch (error) {
      console.error('Error restarting dev server:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAIResponseComplete = () => {
    // Trigger immediate check for AI file changes
    if (containerRef.current) {
      console.log('[ProjectPage] AI response complete, checking for file changes...');
      containerRef.current.checkForAIChanges();
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
                containerUrl={containerUrl}
                onAIResponseComplete={handleAIResponseComplete}
              />
      </AppShell.Aside>

      <AppShell.Main h="calc(100vh - 60px)">
        {isInitialized && (
          <TabbedRailwayContainer 
            containerRef={containerRef}
            repoUrl={repoUrl}
            githubToken={githubToken}
            userId={userId}
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
