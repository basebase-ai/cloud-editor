'use client';

import React from 'react';
import { Box } from '@mantine/core';
import RailwayContainerManager, { RailwayContainerManagerRef } from './RailwayContainerManager';

interface TabbedRailwayContainerProps {
  repoUrl: string;
  githubToken: string;
  userId?: string;
  onDevServerReady?: (deploymentUrl?: string) => void;
  containerRef: React.RefObject<RailwayContainerManagerRef | null>;
}

export default function TabbedRailwayContainer({ 
  repoUrl, 
  githubToken,
  userId,
  onDevServerReady,
  containerRef
}: TabbedRailwayContainerProps) {
  // Remove the outer tabs and just show RailwayContainerManager directly
  // This eliminates the nested tabs issue
  
  return (
    <Box h="100%">
      <RailwayContainerManager
        ref={containerRef}
        repoUrl={repoUrl}
        githubToken={githubToken}
        userId={userId}
        onDevServerReady={onDevServerReady}
      />
    </Box>
  );
}
