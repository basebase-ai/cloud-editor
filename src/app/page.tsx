'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Text, Loader, Stack } from '@mantine/core';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    // Get query params from current URL
    const urlSearchParams = new URLSearchParams(window.location.search);
    const repo = urlSearchParams.get('repo');
    
    // Extract project name from repo URL if available
    let projectId = 'default-project';
    
    if (repo) {
      // Extract project name from GitHub URL
      const match = repo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (match) {
        const [, owner, repoName] = match;
        projectId = `${owner}-${repoName.replace('.git', '')}`;
      }
    }
    
    // Build new URL with query params
    const queryString = urlSearchParams.toString();
    const newPath = queryString ? `/${projectId}?${queryString}` : `/${projectId}`;
    
    console.log('Redirecting to:', newPath);
    router.push(newPath);
  }, [router]);

  return (
    <Box h="100vh" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Stack align="center" gap="md">
        <Loader size="lg" />
        <Text size="sm" c="dimmed">Setting up your project...</Text>
      </Stack>
    </Box>
  );
}