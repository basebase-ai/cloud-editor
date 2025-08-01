'use client';

import { AppShell, Button, Text, Group } from '@mantine/core';
import { useState, useEffect } from 'react';
import WebContainerManager from '@/components/WebContainerManager';
import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

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
    
    // Get GitHub repo URL from query params
    const params = new URLSearchParams(window.location.search);
    const url = params.get('repo');
    console.log('Query params:', Object.fromEntries(params.entries()));
    console.log('Repo URL from params:', url);
    
    if (url) {
      console.log('Setting repo URL:', url);
      setRepoUrl(url);
    } else {
      console.log('No repo URL found in query params');
    }

    // Get GitHub token from localStorage
    const token = localStorage.getItem('github_token');
    console.log('GitHub token from localStorage:', token ? 'Found' : 'Not found');
    
    if (token) {
      console.log('Setting GitHub token');
      setGithubToken(token);
    } else {
      console.log('No GitHub token in localStorage');
    }

    // Mark as initialized after setting initial state
    setIsInitialized(true);
    console.log('Page component initialization complete');
  }, []);

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
          />
        )}
      </AppShell.Main>
    </AppShell>
  );
}
