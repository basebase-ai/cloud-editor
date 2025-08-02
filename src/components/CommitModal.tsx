'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Text,
  Textarea,
  Button,
  Group,
  Box,
  Loader,
  Alert,
  ScrollArea,
  Badge
} from '@mantine/core';
import { IconGitCommit, IconAlertCircle, IconCheck } from '@tabler/icons-react';

interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
}

interface CommitModalProps {
  opened: boolean;
  onClose: () => void;
  githubToken: string;
  repoUrl: string;
}

export default function CommitModal({ opened, onClose, githubToken, repoUrl }: CommitModalProps) {
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);

  const loadGitStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    setError('');
    
    try {
      const response = await fetch('/api/git/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          githubToken,
          repoUrl
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get git status');
      }

      const data = await response.json();
      setChangedFiles(data.files || []);
    } catch (err) {
      console.error('Failed to load git status:', err);
      setError(err instanceof Error ? err.message : 'Failed to load git status');
    } finally {
      setIsLoadingStatus(false);
    }
  }, [githubToken, repoUrl]);

  // Load git status when modal opens
  useEffect(() => {
    if (opened) {
      loadGitStatus();
      setCommitMessage('');
      setError('');
      setSuccess(false);
    }
  }, [opened, loadGitStatus]);

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    
    setIsCommitting(true);
    setError('');
    
    try {
      const response = await fetch('/api/git/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          githubToken,
          repoUrl,
          message: commitMessage.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to commit changes');
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Failed to commit:', err);
      setError(err instanceof Error ? err.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  const getStatusBadgeProps = (status: GitFileStatus['status']) => {
    switch (status) {
      case 'modified':
        return { color: 'yellow', children: 'M' };
      case 'added':
        return { color: 'green', children: 'A' };
      case 'deleted':
        return { color: 'red', children: 'D' };
      case 'renamed':
        return { color: 'blue', children: 'R' };
      default:
        return { color: 'gray', children: '?' };
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconGitCommit size={20} />
          <Text fw={600}>Commit Changes</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red">
            {error}
          </Alert>
        )}

        {success && (
          <Alert icon={<IconCheck size={16} />} color="green">
            Changes committed successfully!
          </Alert>
        )}

        {/* Changed Files Section */}
        <Box>
          <Text size="sm" fw={500} mb="xs">
            Changed Files {changedFiles.length > 0 && `(${changedFiles.length})`}
          </Text>
          
          {isLoadingStatus ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">Loading git status...</Text>
            </Group>
          ) : changedFiles.length === 0 ? (
            <Text size="sm" c="dimmed">No changes to commit</Text>
          ) : (
            <ScrollArea h={200}>
              <Stack gap="xs">
                {changedFiles.map((file, index) => (
                  <Group key={index} gap="xs" justify="space-between">
                    <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                      <Badge size="sm" {...getStatusBadgeProps(file.status)} />
                      <Text size="sm" truncate style={{ flex: 1 }}>
                        {file.path}
                      </Text>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </ScrollArea>
          )}
        </Box>

        {/* Commit Message Section */}
        <Box>
          <Text size="sm" fw={500} mb="xs">
            Commit Message
          </Text>
          <Textarea
            placeholder="Describe your changes..."
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.currentTarget.value)}
            rows={4}
            disabled={isCommitting || success}
          />
        </Box>

        {/* Action Buttons */}
        <Group justify="flex-end" gap="xs">
          <Button
            variant="light"
            onClick={onClose}
            disabled={isCommitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCommit}
            disabled={!commitMessage.trim() || isCommitting || changedFiles.length === 0}
            loading={isCommitting}
            leftSection={<IconGitCommit size={16} />}
          >
            Commit
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}