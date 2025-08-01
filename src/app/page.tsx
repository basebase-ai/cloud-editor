'use client';

import { AppShell, Button, Text, Group } from '@mantine/core';
import { useState, useEffect } from 'react';
import WebContainerManager from '@/components/WebContainerManager';
import ChatInterface from '@/components/ChatInterface';
import GitHubTokenModal from '@/components/GitHubTokenModal';

export default function Home() {
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [basebaseToken, setBasebaseToken] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [showTokenModal, setShowTokenModal] = useState<boolean>(false);

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
    
    // Get query params
    const params = new URLSearchParams(window.location.search);
    const url = params.get('repo');
    const token = params.get('token');
    console.log('Query params:', Object.fromEntries(params.entries()));
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
  }, []);

  const handleTokenSubmit = (token: string) => {
    console.log('GitHub token submitted successfully');
    setGithubToken(token);
    setShowTokenModal(false);
  };

  const handleModalClose = () => {
    setShowTokenModal(false);
  };

  return (
    <AppShell
      header={{ height: 60 }}
      aside={{ width: 400, breakpoint: 'md' }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text size="lg" fw={600}>BaseBase Editor</Text>
          <Button 
            variant={hasChanges ? 'filled' : 'light'} 
            disabled={!hasChanges}
            color="blue"
          >
            Publish
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Aside p={0}>
        <ChatInterface 
          onCodeChange={() => setHasChanges(true)}
          repoUrl={repoUrl}
          githubToken={githubToken}
        />
      </AppShell.Aside>

      <AppShell.Main>
        {isInitialized && (
          <WebContainerManager 
            repoUrl={repoUrl}
            githubToken={githubToken}
            basebaseToken={basebaseToken}
          />
        )}
      </AppShell.Main>

      <GitHubTokenModal
        opened={showTokenModal}
        onClose={handleModalClose}
        onTokenSubmit={handleTokenSubmit}
      />
    </AppShell>
  );
}
