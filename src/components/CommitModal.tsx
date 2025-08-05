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
  Alert,
  ScrollArea,
  Badge,
  Checkbox,
  Collapse,
  Code,
  Divider
} from '@mantine/core';
import { IconGitCommit, IconAlertCircle, IconCheck, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useFileTracking } from '@/hooks/useFileTracking';

interface TrackedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  originalContent: string | null;
  currentContent: string | null;
  selected: boolean;
}

interface CommitModalProps {
  opened: boolean;
  onClose: () => void;
  githubToken: string;
  repoUrl: string;
}

export default function CommitModal({ opened, onClose, githubToken, repoUrl }: CommitModalProps) {
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([]);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const { fileStates, getChangedFiles } = useFileTracking();

  const loadTrackedFiles = useCallback(() => {
    const changedFilePaths = getChangedFiles();
    const files: TrackedFile[] = changedFilePaths.map(path => {
      const state = fileStates[path];
      let status: TrackedFile['status'];
      
      if (state.original === null && state.current !== null) {
        status = 'added';
      } else if (state.original !== null && state.current === null) {
        status = 'deleted';
      } else {
        status = 'modified';
      }
      
      return {
        path,
        status,
        originalContent: state.original,
        currentContent: state.current,
        selected: true // Default to selected
      };
    });
    
    setTrackedFiles(files);
  }, [fileStates, getChangedFiles]);

  // Load tracked files when modal opens
  useEffect(() => {
    if (opened) {
      loadTrackedFiles();
      setCommitMessage('');
      setError('');
      setSuccess(false);
      setExpandedFiles(new Set());
    }
  }, [opened, loadTrackedFiles]);

  const toggleFileSelection = (filePath: string) => {
    setTrackedFiles(prev => prev.map(file => 
      file.path === filePath 
        ? { ...file, selected: !file.selected }
        : file
    ));
  };

  const toggleFileExpansion = (filePath: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const selectAllFiles = () => {
    setTrackedFiles(prev => prev.map(file => ({ ...file, selected: true })));
  };

  const deselectAllFiles = () => {
    setTrackedFiles(prev => prev.map(file => ({ ...file, selected: false })));
  };

  const getSelectedFiles = () => trackedFiles.filter(file => file.selected);

  const createSimpleDiff = (original: string | null, current: string | null): string => {
    if (original === null && current !== null) {
      return `+++ New file +++\n${current}`;
    }
    if (original !== null && current === null) {
      return `--- Deleted file ---\n${original}`;
    }
    if (original !== null && current !== null) {
      const originalLines = original.split('\n');
      const currentLines = current.split('\n');
      const maxLines = Math.max(originalLines.length, currentLines.length);
      
      let diff = '';
      for (let i = 0; i < Math.min(maxLines, 10); i++) { // Show first 10 lines
        const origLine = originalLines[i] || '';
        const currLine = currentLines[i] || '';
        if (origLine !== currLine) {
          if (origLine) diff += `- ${origLine}\n`;
          if (currLine) diff += `+ ${currLine}\n`;
        }
      }
      if (maxLines > 10) {
        diff += `... (${maxLines - 10} more lines)`;
      }
      return diff || 'No visible changes';
    }
    return 'No changes';
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    
    const selectedFiles = getSelectedFiles();
    if (selectedFiles.length === 0) return;
    
    setIsCommitting(true);
    setError('');
    
    try {
      // Prepare file changes for the commit
      const fileChanges = selectedFiles.map(file => ({
        path: file.path,
        content: file.currentContent,
        status: file.status
      }));

      const response = await fetch('/api/git/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          githubToken,
          repoUrl,
          message: commitMessage.trim(),
          files: fileChanges
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

  const getStatusBadgeProps = (status: TrackedFile['status']) => {
    switch (status) {
      case 'modified':
        return { color: 'yellow', children: 'M' };
      case 'added':
        return { color: 'green', children: 'A' };
      case 'deleted':
        return { color: 'red', children: 'D' };
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
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={500}>
              Changed Files {trackedFiles.length > 0 && `(${trackedFiles.length})`}
            </Text>
            {trackedFiles.length > 0 && (
              <Group gap="xs">
                <Button variant="subtle" size="xs" onClick={selectAllFiles}>
                  Select All
                </Button>
                <Button variant="subtle" size="xs" onClick={deselectAllFiles}>
                  None
                </Button>
              </Group>
            )}
          </Group>
          
          {trackedFiles.length === 0 ? (
            <Text size="sm" c="dimmed">No changes to commit</Text>
          ) : (
            <ScrollArea h={300}>
              <Stack gap="xs">
                {trackedFiles.map((file, index) => (
                  <Box key={index}>
                    <Group gap="xs" justify="space-between">
                      <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                        <Checkbox
                          checked={file.selected}
                          onChange={() => toggleFileSelection(file.path)}
                          size="sm"
                        />
                        <Badge size="sm" {...getStatusBadgeProps(file.status)} />
                        <Text size="sm" truncate style={{ flex: 1 }}>
                          {file.path}
                        </Text>
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => toggleFileExpansion(file.path)}
                          leftSection={
                            expandedFiles.has(file.path) ? 
                              <IconChevronDown size={12} /> : 
                              <IconChevronRight size={12} />
                          }
                        >
                          {expandedFiles.has(file.path) ? 'Hide' : 'Show'} Changes
                        </Button>
                      </Group>
                    </Group>
                    
                    <Collapse in={expandedFiles.has(file.path)}>
                      <Box mt="xs" p="xs" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                        <Text size="xs" c="dimmed" mb="xs">Changes:</Text>
                        <Code block style={{ fontSize: '11px', maxHeight: '200px', overflow: 'auto' }}>
                          {createSimpleDiff(file.originalContent, file.currentContent)}
                        </Code>
                      </Box>
                    </Collapse>
                    
                    {index < trackedFiles.length - 1 && <Divider my="xs" />}
                  </Box>
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
            disabled={!commitMessage.trim() || isCommitting || getSelectedFiles().length === 0}
            loading={isCommitting}
            leftSection={<IconGitCommit size={16} />}
          >
            Commit {getSelectedFiles().length > 0 && `(${getSelectedFiles().length} files)`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}