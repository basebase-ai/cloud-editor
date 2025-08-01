// WebContainer bridge API - communicates with client-side WebContainer
// This stores pending requests that the client will fulfill

interface PendingRequest {
  id: string;
  action: string;
  params: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

// In-memory store for pending requests (in production, use Redis or similar)
const pendingRequests = new Map<string, PendingRequest>();
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Clean up expired requests
setInterval(() => {
  const now = Date.now();
  for (const [id, request] of pendingRequests.entries()) {
    if (now - request.timestamp > REQUEST_TIMEOUT) {
      request.reject(new Error("Request timeout"));
      pendingRequests.delete(id);
    }
  }
}, 5000);

export async function POST(request: Request) {
  try {
    const { action, params, responseId, result, error } = await request.json();

    // Handle response from client
    if (responseId) {
      const pendingRequest = pendingRequests.get(responseId);
      if (pendingRequest) {
        pendingRequests.delete(responseId);
        if (error) {
          pendingRequest.reject(new Error(error));
        } else {
          pendingRequest.resolve(result);
        }
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    // Handle new request from server-side tools
    const requestId = crypto.randomUUID();

    return new Promise<Response>((resolve, reject) => {
      const pendingRequest: PendingRequest = {
        id: requestId,
        action,
        params,
        resolve: (result) => {
          resolve(new Response(JSON.stringify(result), { status: 200 }));
        },
        reject: (error) => {
          resolve(
            new Response(JSON.stringify({ error: error.message }), {
              status: 500,
            })
          );
        },
        timestamp: Date.now(),
      };

      pendingRequests.set(requestId, pendingRequest);

      // The client will poll for pending requests
    });
  } catch (error) {
    console.error("WebContainer API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
    });
  }
}

export async function GET() {
  // Return pending requests for client to process
  const requests = Array.from(pendingRequests.values()).map((req) => ({
    id: req.id,
    action: req.action,
    params: req.params,
  }));

  return new Response(JSON.stringify({ requests }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
