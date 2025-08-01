# Tool Status Messages Architecture

## Problem
Tool calls are happening in the browser console, but status messages like "Searching..." and "Found 3 results" are not appearing in the chat UI.

## Current Implementation
- **Backend**: System prompt asks AI to add emoji status messages
- **Frontend**: UI formats emoji patterns (🔍, 📁, etc.) and result summaries  
- **Issue**: AI model inconsistently follows instructions to add status messages

## Recommended Solution: Custom Stream Wrapper

### Implementation Strategy
1. **Intercept Tool Calls**: Wrap streamText to capture tool execution
2. **Inject Status Messages**: Add messages to stream before/after tool calls
3. **Maintain Stream Integrity**: Preserve AI response while adding status updates

### Code Architecture

```typescript
// Enhanced streaming with tool status injection
export async function POST(req: Request) {
  const result = await streamText({
    model: google("gemini-1.5-pro"),
    messages,
    tools: enhancedTools, // Wrapped tools with status injection
  });

  // Custom stream that intercepts and injects tool status
  return createEnhancedStream(result);
}

// Tool wrapper that captures execution for status messages
function wrapToolWithStatus(tool, toolName) {
  return {
    ...tool,
    execute: async (args) => {
      // Emit start status
      statusEmitter.emit('toolStart', { toolName, args });
      
      const result = await tool.execute(args);
      
      // Emit completion status  
      statusEmitter.emit('toolComplete', { toolName, result });
      
      return result;
    }
  };
}
```

### Frontend Integration
The existing ChatInterface.tsx already handles the status message formatting:
- Lines 191-205: Special formatting for emoji announcements and result summaries
- Pattern matching for tool progress indicators
- Styled display for status vs regular messages

### Benefits
- **Reliable Status Updates**: Not dependent on AI model following instructions
- **Real-time Feedback**: Users see tool execution progress immediately  
- **Maintains Existing UI**: Leverages current formatting patterns
- **Backwards Compatible**: Works with existing system prompt approach

### Alternative: Server-Sent Events
For more complex scenarios, consider SSE:
```typescript
// Separate SSE endpoint for tool status
GET /api/chat/status -> Server-Sent Events stream
POST /api/chat -> Main chat response

// Frontend subscribes to both streams
const statusStream = new EventSource('/api/chat/status');
const chatResponse = await fetch('/api/chat');
```

## Implementation Priority
1. **Phase 1**: Custom stream wrapper (recommended first step)
2. **Phase 2**: Enhanced error handling and retry logic
3. **Phase 3**: Consider SSE if real-time requirements grow