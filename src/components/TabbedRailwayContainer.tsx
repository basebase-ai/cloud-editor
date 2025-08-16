'use client';

import React, { useState } from 'react';
import { Box, Tabs, Group } from '@mantine/core';
import { IconEye, IconFiles } from '@tabler/icons-react';
import RailwayContainerManager, { RailwayContainerManagerRef } from './RailwayContainerManager';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';

interface TabbedRailwayContainerProps {
  repoUrl: string;
  githubToken: string;
  userId?: string;
  onDevServerReady?: () => void;
  containerRef: React.RefObject<RailwayContainerManagerRef | null>;
}

export default function TabbedRailwayContainer({ 
  repoUrl, 
  githubToken,
  userId,
  onDevServerReady,
  containerRef
}: TabbedRailwayContainerProps) {
  const [activeTab, setActiveTab] = useState<string | null>('preview');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <Box h="100%">
      <Tabs value={activeTab} onChange={setActiveTab} h="100%">
        <Tabs.List>
          <Tabs.Tab value="preview" leftSection={<IconEye size={16} />}>
            Preview
          </Tabs.Tab>
          <Tabs.Tab value="files" leftSection={<IconFiles size={16} />}>
            Files
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="preview" h="calc(100% - 40px)">
          <RailwayContainerManager
            ref={containerRef}
            repoUrl={repoUrl}
            githubToken={githubToken}
            userId={userId}
            onDevServerReady={onDevServerReady}
          />
        </Tabs.Panel>

        <Tabs.Panel value="files" h="calc(100% - 40px)">
          <Group h="100%" gap={0} align="stretch">
            {/* File Explorer - Left Side */}
            <Box 
              w={300} 
              h="100%" 
              style={{ 
                borderRight: '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-7))'
              }}
            >
              <FileExplorer
                onFileSelect={setSelectedFile}
                selectedFile={selectedFile}
                containerRef={containerRef}
              />
            </Box>

            {/* Code Editor - Right Side */}
            <Box style={{ flex: 1 }} h="100%">
              <CodeEditor
                filePath={selectedFile}
                containerRef={containerRef}
              />
            </Box>
          </Group>
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
