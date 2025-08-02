export async function POST(request: Request) {
  try {
    const { githubToken, repoUrl } = await request.json();

    if (!githubToken || !repoUrl) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract repo info from URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Invalid GitHub repository URL' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For now, return mock data since we don't have git integration in WebContainer yet
    // In a real implementation, this would parse the repo URL and communicate with the WebContainer to get actual git status
    const mockFiles = [
      { path: 'src/components/ChatInterface.tsx', status: 'modified' as const },
      { path: 'src/components/WebContainerManager.tsx', status: 'modified' as const },
      { path: 'src/components/CommitModal.tsx', status: 'added' as const }
    ];

    return new Response(JSON.stringify({ files: mockFiles }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Git status error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}