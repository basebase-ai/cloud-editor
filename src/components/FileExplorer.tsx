'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Group,
  ScrollArea,
  Text,
  ActionIcon,
  Loader,
  Alert,
  Stack,
  UnstyledButton,
  Collapse
} from '@mantine/core';
import {
  IconFolder,
  IconFolderOpen,
  IconFile,
  IconFileText,
  IconFileCode,
  IconPhoto,
  IconRefresh
} from '@tabler/icons-react';
import { RailwayContainerManagerRef } from './RailwayContainerManager';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
}

interface FileExplorerProps {
  onFileSelect: (filePath: string) => void;
  selectedFile: string | null;
  containerRef: React.RefObject<RailwayContainerManagerRef | null>;
}

export default function FileExplorer({ onFileSelect, selectedFile, containerRef }: FileExplorerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getFileIcon = (fileName: string, isDirectory: boolean) => {
    if (isDirectory) {
      return <IconFolder size={16} />;
    }

    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
      case 'json':
      case 'html':
      case 'css':
      case 'scss':
      case 'md':
        return <IconFileCode size={16} />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'ico':
        return <IconPhoto size={16} />;
      case 'txt':
      case 'log':
        return <IconFileText size={16} />;
      default:
        return <IconFile size={16} />;
    }
  };

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const buildFileStructure = useCallback(async (currentPath: string): Promise<FileNode[]> => {
    const nodes: FileNode[] = [];
    
    try {
      console.log(`[FileExplorer] Reading directory: ${currentPath}`);
      
      // Use container API to list files
      const response = await fetch('/api/container', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'listFiles',
          params: { path: currentPath },
          containerUrl: containerRef.current?.getContainerUrl(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      const files = data.files || [];
      
      for (const file of files) {
        const filePath = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
        
        if (file.type === 'directory') {
          // Recursively load directory contents
          let children: FileNode[] = [];
          try {
            children = await buildFileStructure(filePath);
          } catch (err) {
            console.warn(`[FileExplorer] Could not read directory ${filePath}:`, err);
            // Add directory without children if we can't read it
          }

          nodes.push({
            name: file.name,
            type: 'directory',
            path: filePath,
            children: children
          });
        } else {
          nodes.push({
            name: file.name,
            type: 'file',
            path: filePath
          });
        }
      }
    } catch (err) {
      console.error(`[FileExplorer] Failed to read directory ${currentPath}:`, err);
      throw err;
    }

    // Sort: directories first, then files, both alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [containerRef]);

  const loadFileTree = useCallback(async () => {
    if (!containerRef.current) {
      setError('Container not available');
      setLoading(false);
      return;
    }

    const containerUrl = containerRef.current.getContainerUrl();
    if (!containerUrl) {
      setError('Container not ready');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('[FileExplorer] Loading file tree...');
      
      // Build nested file structure using container API
      const fileNodes = await buildFileStructure('.');
      
      setFileTree(fileNodes);
      console.log('[FileExplorer] File tree loaded successfully');
    } catch (err) {
      console.error('Failed to load file tree:', err);
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [containerRef, buildFileStructure]);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const TreeNode = ({ node, depth = 0 }: { node: FileNode; depth?: number }) => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedFile === node.path;
    
    return (
      <Box key={node.path}>
        <UnstyledButton
          onClick={() => {
            if (node.type === 'directory') {
              toggleFolder(node.path);
            } else {
              onFileSelect(node.path);
            }
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '4px 8px',
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'var(--mantine-color-gray-0)';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <Group gap={6}>
            {node.type === 'directory' ? (
              isExpanded ? <IconFolderOpen size={16} /> : <IconFolder size={16} />
            ) : (
              getFileIcon(node.name, false)
            )}
            <Text size="sm">{node.name}</Text>
          </Group>
        </UnstyledButton>
        
        {node.type === 'directory' && node.children && (
          <Collapse in={isExpanded}>
            <Stack gap={0}>
              {node.children.map(child => (
                <TreeNode key={child.path} node={child} depth={depth + 1} />
              ))}
            </Stack>
          </Collapse>
        )}
      </Box>
    );
  };

  useEffect(() => {
    // Poll until Container is available
    const checkAndLoad = () => {
      if (containerRef.current?.getContainerUrl()) {
        loadFileTree();
      } else {
        // Check again in 500ms
        setTimeout(checkAndLoad, 500);
      }
    };
    
    checkAndLoad();
  }, [containerRef, loadFileTree]);

  if (loading) {
    return (
      <Box p="md" display="flex" style={{ alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <Group>
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading files...</Text>
        </Group>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p="md">
        <Alert color="red" mb="md">
          {error}
        </Alert>
        <ActionIcon onClick={loadFileTree} variant="light">
          <IconRefresh size={16} />
        </ActionIcon>
      </Box>
    );
  }

  return (
    <ScrollArea h="100%">
      <Box p="md">
        <Group justify="space-between" mb="md">
          <Text fw={600} size="sm">Files</Text>
          <ActionIcon onClick={loadFileTree} variant="light" size="sm">
            <IconRefresh size={14} />
          </ActionIcon>
        </Group>
        
        <Stack gap={0}>
          {fileTree.map(node => (
            <TreeNode key={node.path} node={node} />
          ))}
        </Stack>
      </Box>
    </ScrollArea>
  );
}