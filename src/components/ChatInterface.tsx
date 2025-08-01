'use client';

import { useRef, useEffect, useState } from 'react';
import { 
  Stack, 
  ScrollArea, 
  TextInput, 
  ActionIcon, 
  Paper, 
  Text, 
  Box, 
  Loader,
  Group
} from '@mantine/core';
import { IconSend, IconPlayerStop } from '@tabler/icons-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatInterfaceProps {
  onCodeChange: () => void;
  repoUrl: string;
  githubToken: string;
}

export default function ChatInterface({ onCodeChange, repoUrl }: ChatInterfaceProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const stop = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || isLoading) return;
    
    const userInput = input;
    setInput('');
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userInput,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          const chunk = decoder.decode(value);
          
          // AI SDK sends raw text chunks, append directly to message
          if (chunk.trim()) {
            setMessages(prev => prev.map(msg => 
              msg.id === assistantMessage.id 
                ? { ...msg, content: msg.content + chunk }
                : msg
            ));
            
            // Scroll after each chunk to ensure we stay at bottom during streaming
            setTimeout(scrollToBottom, 0);
          }
        }
      }

      onCodeChange();
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  // Auto-scroll function
  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      if (viewport) {
        viewport.scrollTo({
          top: viewport.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  };

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-scroll when streaming content updates (content length changes)
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      scrollToBottom();
    }
  }, [messages]);

  const formatMessage = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i];
      
      // Handle code blocks
      if (line.startsWith('```')) {
        const language = line.slice(3).trim();
        const codeLines: string[] = [];
        i++; // Skip opening ```
        
        // Collect code lines until closing ```
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // Skip closing ```
        
        elements.push(
          <Box key={`code-${elements.length}`} mb="md">
            <Text size="xs" c="dimmed" mb={2}>
              {language || 'code'}
            </Text>
            <Box
              p="sm"
              style={{
                borderRadius: '6px',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                fontSize: '13px',
                border: '1px solid var(--mantine-color-gray-4)',
                overflow: 'auto',
                backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))',
                color: 'light-dark(var(--mantine-color-gray-9), var(--mantine-color-gray-0))'
              }}
            >
              <pre style={{ 
                margin: 0, 
                whiteSpace: 'pre-wrap',
                color: 'inherit'
              }}>
                {codeLines.join('\n')}
              </pre>
            </Box>
          </Box>
        );
        continue;
      }
      
      // Tool progress indicators (lines with emojis like 🔍, 📁, etc.)
      if (line.match(/^[🔍📁📝🔧🔎⚡🔄]\s/)) {
        elements.push(
          <Text key={`progress-${elements.length}`} size="sm" c="blue.6" fw={500} mb={1} style={{ fontStyle: 'italic' }}>
            {line}
          </Text>
        );
      }
      // Tool result summaries (lines starting with "Found", "Read", "Updated", etc.)
      else if (line.match(/^(Found|Read|Updated|Created|Searched|Listed|✓|Edited|Wrote)\s/) || line.includes(' matches for ') || line.includes(' lines from ')) {
        elements.push(
          <Text key={`result-${elements.length}`} size="sm" c="green.7" fw={500} mb={1}>
            {line.startsWith('✓') ? line : `${line}`}
          </Text>
        );
      }
      // Bold text
      else if (line.startsWith('**') && line.endsWith('**')) {
        elements.push(
          <Text key={`bold-${elements.length}`} fw={600} size="sm" mb={2}>
            {line.slice(2, -2)}
          </Text>
        );
      }
      // List items
      else if (line.startsWith('- ')) {
        elements.push(
          <Text key={`list-${elements.length}`} size="sm" c="dimmed" mb={1}>
            {line}
          </Text>
        );
      }
      // Regular text
      else {
        elements.push(
          <Text key={`text-${elements.length}`} size="sm" mb={1}>
            {line}
          </Text>
        );
      }
      
      i++;
    }
    
    return elements;
  };

  return (
    <Stack h="100vh" gap={0} style={{ overflow: 'hidden' }}>
      {/* Chat Header */}
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-4)', flexShrink: 0 }}>
        <Text size="sm" fw={500}>AI Assistant</Text>
        {repoUrl && (
          <Text size="xs" c="dimmed" truncate>
            {repoUrl}
          </Text>
        )}
      </Box>

      {/* Messages Area */}
      <ScrollArea 
        flex={1} 
        p="sm"
        ref={scrollAreaRef}
        type="hover"
        style={{ minHeight: 0 }}
      >
        <Stack gap="xs">
          {messages.map((message) => (
            message.role === 'user' ? (
              <Paper
                key={message.id}
                p="sm"
                radius="md"
                bg="transparent"
                style={{
                  border: '1px solid var(--mantine-color-blue-6)',
                }}
              >
                <Box>
                  {formatMessage(message.content)}
                </Box>
              </Paper>
            ) : (
              <Box key={message.id} py="xs" px="sm">
                <Box>
                  {formatMessage(message.content)}
                </Box>
              </Box>
            )
          ))}

          {isLoading && (
            <Box py="xs" px="sm">
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Thinking...
                </Text>
              </Group>
            </Box>
          )}
        </Stack>
      </ScrollArea>

      {/* Input Area */}
      <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-4)', flexShrink: 0 }}>
        <form onSubmit={handleSubmit}>
          <Group gap="xs">
            <TextInput
              flex={1}
              placeholder="Ask me to make changes..."
              value={input}
              onChange={handleInputChange}
              disabled={isLoading}
              radius="xl"
              size="sm"
            />
            {isLoading ? (
              <ActionIcon
                variant="filled"
                color="red"
                radius="xl"
                size="lg"
                onClick={stop}
              >
                <IconPlayerStop size={16} />
              </ActionIcon>
            ) : (
              <ActionIcon
                type="submit"
                variant="filled"
                color="blue"
                radius="xl"
                size="lg"
                disabled={!input.trim()}
              >
                <IconSend size={16} />
              </ActionIcon>
            )}
          </Group>
        </form>
      </Box>
    </Stack>
  );
}