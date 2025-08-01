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

    const [, owner, repo] = match;
    const cleanRepoName = repo.replace('.git', '');

    // This is a WebContainer bridge request - we need to get git status from the client
    const requestId = crypto.randomUUID();
    
    // Store the git status request for the WebContainer to pick up
    const gitStatusRequest = {
      id: requestId,
      action: 'gitStatus',
      params: { githubToken, owner, repo: cleanRepoName }
    };

    // For now, return mock data since we don't have git integration in WebContainer yet
    // In a real implementation, this would communicate with the WebContainer
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