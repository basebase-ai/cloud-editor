'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Group,
  Text,
  ActionIcon,
  Button,
  Textarea,
  Alert,
  Loader,
  Notification
} from '@mantine/core';
import {
  IconDeviceFloppy,
  IconRefresh,
  IconFileText,
  IconAlertCircle
} from '@tabler/icons-react';
import { RailwayContainerManagerRef } from './RailwayContainerManager';

interface CodeEditorProps {
  filePath: string | null;
  containerRef: React.RefObject<RailwayContainerManagerRef | null>;
}

export default function CodeEditor({ filePath, containerRef }: CodeEditorProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalContent, setOriginalContent] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const loadFile = useCallback(async (path: string) => {
    if (!containerRef.current) {
      setError('Container not available');
      return;
    }

    const containerUrl = containerRef.current.getContainerUrl();
    if (!containerUrl) {
      setError('Container not ready');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log(`[CodeEditor] Loading file: ${path}`);
      
      const response = await fetch('/api/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'readFile',
          params: { path },
          containerUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      const fileContent = data.content;
      
      setContent(fileContent);
      setOriginalContent(fileContent);
      setHasChanges(false);
      console.log(`[CodeEditor] File loaded: ${path} (${fileContent.length} characters)`);
    } catch (err) {
      console.error('Failed to load file:', err);
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setContent('');
      setOriginalContent('');
    } finally {
      setLoading(false);
    }
  }, [containerRef]);

  const saveFile = async () => {
    if (!containerRef.current || !filePath) {
      return;
    }

    const containerUrl = containerRef.current.getContainerUrl();
    if (!containerUrl) {
      setError('Container not ready');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      
      console.log(`[CodeEditor] Saving file: ${filePath} (${content.length} characters)`);
      
      const response = await fetch('/api/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'writeFile',
          params: { path: filePath, content },
          containerUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save file: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setOriginalContent(content);
      setHasChanges(false);
      setSaveSuccess(true);
      
      console.log(`[CodeEditor] File saved: ${filePath}`);
      
      // Hide success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save file:', err);
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== originalContent);
  };

  const getLanguageFromPath = (path: string): string => {
    const ext = path.toLowerCase().split('.').pop();
    switch (ext) {
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'scss':
        return 'scss';
      case 'md':
        return 'markdown';
      case 'py':
        return 'python';
      default:
        return 'text';
    }
  };

  useEffect(() => {
    if (filePath) {
      // Poll until Container is available, then load file
      const checkAndLoad = () => {
        if (containerRef.current?.getContainerUrl()) {
          loadFile(filePath);
        } else {
          console.log('[CodeEditor] Container not ready, waiting...');
          // Check again in 500ms
          setTimeout(checkAndLoad, 500);
        }
      };
      
      checkAndLoad();
    } else {
      setContent('');
      setOriginalContent('');
      setHasChanges(false);
      setError(null);
    }
  }, [filePath, loadFile, containerRef]);

  if (!filePath) {
    return (
      <Box p="xl" display="flex" style={{ alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column' }}>
        <IconFileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
        <Text c="dimmed" ta="center">
          Select a file from the explorer to edit
        </Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box p="md" display="flex" style={{ alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <Group>
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading {filePath}...</Text>
        </Group>
      </Box>
    );
  }

  return (
    <Box h="100%" display="flex" style={{ flexDirection: 'column' }}>
      {/* Header */}
      <Box p="md" style={{ borderBottom: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))' }}>
        <Group justify="space-between">
          <Group>
            <IconFileText size={16} />
            <Text size="sm" fw={500}>{filePath}</Text>
            {hasChanges && (
              <Text size="xs" c="orange">• Modified</Text>
            )}
          </Group>
          
          <Group gap="xs">
            <ActionIcon 
              onClick={() => loadFile(filePath)} 
              variant="light" 
              size="sm"
              disabled={loading}
            >
              <IconRefresh size={14} />
            </ActionIcon>
            
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={saveFile}
              disabled={!hasChanges || saving}
              loading={saving}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert color="red" m="md" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      {/* Success Notification */}
      {saveSuccess && (
        <Notification
          color="green"
          title="File saved"
          m="md"
          onClose={() => setSaveSuccess(false)}
        >
          {filePath} has been saved successfully
        </Notification>
      )}

      {/* Editor */}
      <Box style={{ flex: 1, overflow: 'hidden' }} p="md">
        <Textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder={`Edit ${filePath}...`}
          minRows={20}
          autosize
          styles={{
            input: {
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
              fontSize: '14px',
              lineHeight: '1.5',
              maxHeight: '100%',
              overflow: 'auto'
            },
            wrapper: {
              height: '100%',
              display: 'flex',
              flexDirection: 'column'
            }
          }}
        />
      </Box>

      {/* Footer info */}
      <Box 
        p="xs" 
        px="md"
        style={{ 
          borderTop: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
          backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))'
        }}
      >
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {getLanguageFromPath(filePath)} • {content.split('\n').length} lines
          </Text>
          <Text size="xs" c="dimmed">
            {content.length} characters
          </Text>
        </Group>
      </Box>
    </Box>
  );
}