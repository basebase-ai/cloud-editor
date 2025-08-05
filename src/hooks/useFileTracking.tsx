'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface FileState {
  original: string | null;
  current: string | null;
}

interface FileTrackingContextType {
  fileStates: Record<string, FileState>;
  changedFilesCount: number;
  setOriginalFile: (path: string, content: string) => void;
  setCurrentFile: (path: string, content: string) => void;
  markFileAsChanged: (path: string, newContent: string) => void;
  resetTracking: () => void;
  getChangedFiles: () => string[];
}

const FileTrackingContext = createContext<FileTrackingContextType | undefined>(undefined);

interface FileTrackingProviderProps {
  children: ReactNode;
}

export function FileTrackingProvider({ children }: FileTrackingProviderProps) {
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});

  const setOriginalFile = useCallback((path: string, content: string) => {
    setFileStates(prev => ({
      ...prev,
      [path]: {
        original: content,
        current: prev[path]?.current ?? content
      }
    }));
  }, []);

  const setCurrentFile = useCallback((path: string, content: string) => {
    setFileStates(prev => ({
      ...prev,
      [path]: {
        original: prev[path]?.original ?? null,
        current: content
      }
    }));
  }, []);

  const markFileAsChanged = useCallback((path: string, newContent: string) => {
    setFileStates(prev => {
      const currentState = prev[path];
      return {
        ...prev,
        [path]: {
          original: currentState?.original ?? null,
          current: newContent
        }
      };
    });
  }, []);

  const resetTracking = useCallback(() => {
    setFileStates({});
  }, []);

  const getChangedFiles = useCallback((): string[] => {
    return Object.entries(fileStates)
      .filter(([, state]) => {
        if (state.original === null && state.current !== null) {
          // New file created
          return true;
        }
        if (state.original !== null && state.current === null) {
          // File deleted
          return true;
        }
        if (state.original !== null && state.current !== null) {
          // File modified
          return state.original !== state.current;
        }
        return false;
      })
      .map(([path]) => path);
  }, [fileStates]);

  const changedFilesCount = getChangedFiles().length;

  const value: FileTrackingContextType = {
    fileStates,
    changedFilesCount,
    setOriginalFile,
    setCurrentFile,
    markFileAsChanged,
    resetTracking,
    getChangedFiles
  };

  return (
    <FileTrackingContext.Provider value={value}>
      {children}
    </FileTrackingContext.Provider>
  );
}

export function useFileTracking(): FileTrackingContextType {
  const context = useContext(FileTrackingContext);
  if (context === undefined) {
    throw new Error('useFileTracking must be used within a FileTrackingProvider');
  }
  return context;
}