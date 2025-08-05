// WebContainer bridge API - communicates with client-side WebContainer
// This stores pending requests that the client will fulfill

interface PendingRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

// In-memory stores for requests (in production, use Redis or similar)
const pendingRequests = new Map<string, PendingRequest>();
const inFlightRequests = new Map<string, PendingRequest>();
const REQUEST_TIMEOUT = 30000; // 30 seconds

// Clean up expired requests
setInterval(() => {
  const now = Date.now();

  // Clean up pending requests
  for (const [id, request] of pendingRequests.entries()) {
    if (now - request.timestamp > REQUEST_TIMEOUT) {
      request.reject(new Error("Request timeout"));
      pendingRequests.delete(id);
    }
  }

  // Clean up in-flight requests
  for (const [id, request] of inFlightRequests.entries()) {
    if (now - request.timestamp > REQUEST_TIMEOUT) {
      request.reject(new Error("Request timeout"));
      inFlightRequests.delete(id);
    }
  }
}, 5000);

export async function POST(request: Request) {
  try {
    const { action, params, responseId, result, error } = await request.json();

    // Handle response from client
    if (responseId) {
      const inFlightRequest = inFlightRequests.get(responseId);
      if (inFlightRequest) {
        inFlightRequests.delete(responseId);
        if (error) {
          inFlightRequest.reject(new Error(error));
        } else {
          inFlightRequest.resolve(result);
        }
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    // Handle new request from server-side tools
    const requestId = crypto.randomUUID();

    return new Promise<Response>((resolve) => {
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
  // Move pending requests to in-flight (proper queue semantics)
  const requests = Array.from(pendingRequests.values()).map((req) => {
    // Move from pending to in-flight
    inFlightRequests.set(req.id, req);
    pendingRequests.delete(req.id);

    return {
      id: req.id,
      action: req.action,
      params: req.params,
    };
  });

  return new Response(JSON.stringify({ requests }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
