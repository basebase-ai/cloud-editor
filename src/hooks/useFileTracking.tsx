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
  onFileChange: (callback: (filePath: string) => void) => void;
  removeFileChangeListener: (callback: (filePath: string) => void) => void;
}

const FileTrackingContext = createContext<FileTrackingContextType | undefined>(undefined);

interface FileTrackingProviderProps {
  children: ReactNode;
}

export function FileTrackingProvider({ children }: FileTrackingProviderProps) {
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const [fileChangeCallbacks, setFileChangeCallbacks] = useState<Set<(filePath: string) => void>>(new Set());

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
      const newState = {
        original: currentState?.original ?? null,
        current: newContent
      };
      
      // Notify all listeners about the file change
      fileChangeCallbacks.forEach(callback => {
        try {
          callback(path);
        } catch (error) {
          console.error('Error in file change callback:', error);
        }
      });
      
      return {
        ...prev,
        [path]: newState
      };
    });
  }, [fileChangeCallbacks]);

  const resetTracking = useCallback(() => {
    setFileStates({});
  }, []);

  const onFileChange = useCallback((callback: (filePath: string) => void) => {
    setFileChangeCallbacks(prev => new Set(prev).add(callback));
  }, []);

  const removeFileChangeListener = useCallback((callback: (filePath: string) => void) => {
    setFileChangeCallbacks(prev => {
      const newSet = new Set(prev);
      newSet.delete(callback);
      return newSet;
    });
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
    getChangedFiles,
    onFileChange,
    removeFileChangeListener
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