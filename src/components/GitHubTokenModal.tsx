'use client';

import { useState } from 'react';
import {
  Modal,
  Text,
  TextInput,
  Button,
  Group,
  Stack,
  Alert,
  Anchor,
  Card
} from '@mantine/core';
import { IconKey, IconBrandGithub, IconExternalLink, IconInfoCircle } from '@tabler/icons-react';

interface GitHubTokenModalProps {
  opened: boolean;
  onClose: () => void;
  onTokenSubmit: (token: string) => void;
}

export default function GitHubTokenModal({ opened, onClose, onTokenSubmit }: GitHubTokenModalProps) {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!token.trim()) {
      setError('Please enter a valid GitHub token');
      return;
    }

    // Basic validation - GitHub tokens typically start with 'ghp_' for personal access tokens
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
      setError('Invalid token format. GitHub personal access tokens usually start with "ghp_" or "github_pat_"');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Test the token by making a simple API call
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.ok) {
        // Token is valid
        localStorage.setItem('github_token', token);
        onTokenSubmit(token);
        onClose();
        setToken('');
      } else {
        setError('Invalid GitHub token. Please check your token and try again.');
      }
    } catch {
      setError('Failed to validate token. Please check your internet connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkip = () => {
    // Allow users to continue without a token (read-only mode)
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <IconBrandGithub size={24} />
          <Text size="lg" fw={600}>GitHub Access Required</Text>
        </Group>
      }
      size="md"
      centered
      closeOnClickOutside={false}
      withCloseButton={false}
    >
      <Stack gap="md">
        <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
          <Text size="sm">
            To modify and save changes to your repository, we need a GitHub Personal Access Token.
            This token allows us to push changes back to your GitHub repository.
          </Text>
        </Alert>

        <Card withBorder p="md" bg="var(--mantine-color-gray-0)">
          <Stack gap="xs">
            <Text size="sm" fw={500}>What we need:</Text>
            <Text size="sm" c="dimmed">• A GitHub Personal Access Token</Text>
            <Text size="sm" c="dimmed">• Permissions: <code>repo</code> (Full control of private repositories)</Text>
            <Text size="sm" c="dimmed">• Your token is stored locally and never shared</Text>
          </Stack>
        </Card>

        <TextInput
          label="GitHub Personal Access Token"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          value={token}
          onChange={(event) => {
            setToken(event.currentTarget.value);
            if (error) setError('');
          }}
          leftSection={<IconKey size={16} />}
          error={error}
          disabled={isLoading}
          type="password"
          autoComplete="off"
        />

        <Group justify="space-between" mt="md">
          <Anchor
            href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token"
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
          >
            <Group gap="xs">
              <IconExternalLink size={14} />
              How to create a GitHub token
            </Group>
          </Anchor>
        </Group>

        <Group justify="flex-end" mt="lg">
          <Button 
            variant="subtle" 
            onClick={handleSkip}
            disabled={isLoading}
          >
            Skip (Read-only mode)
          </Button>
          <Button 
            onClick={handleSubmit}
            loading={isLoading}
            leftSection={<IconBrandGithub size={16} />}
          >
            Save Token
          </Button>
        </Group>

        <Text size="xs" c="dimmed" ta="center">
          Your token is stored securely in your browser and is never transmitted to our servers.
        </Text>
      </Stack>
    </Modal>
  );
}