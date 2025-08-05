'use client';

import { Badge, Tooltip, Text } from '@mantine/core';
import { IconFiles } from '@tabler/icons-react';
import { useFileTracking } from '@/hooks/useFileTracking';

interface FileStatusIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
}

export default function FileStatusIndicator({ size = 'sm' }: FileStatusIndicatorProps) {
  const { changedFilesCount, getChangedFiles } = useFileTracking();
  
  if (changedFilesCount === 0) {
    return (
      <Tooltip label="No files changed since clone">
        <Badge 
          variant="light" 
          color="gray" 
          size={size}
          leftSection={<IconFiles size={12} />}
        >
          0 changed
        </Badge>
      </Tooltip>
    );
  }

  const changedFiles = getChangedFiles();
  const tooltipContent = (
    <div>
      <Text size="sm" fw={500} mb={4}>
        Changed files ({changedFilesCount}):
      </Text>
      {changedFiles.slice(0, 10).map((file, index) => (
        <Text key={index} size="xs" c="dimmed">
          {file}
        </Text>
      ))}
      {changedFiles.length > 10 && (
        <Text size="xs" c="dimmed" fs="italic">
          ...and {changedFiles.length - 10} more
        </Text>
      )}
    </div>
  );

  return (
    <Tooltip label={tooltipContent} multiline>
      <Badge 
        variant="filled" 
        color="orange" 
        size={size}
        leftSection={<IconFiles size={12} />}
      >
        {changedFilesCount} changed
      </Badge>
    </Tooltip>
  );
}