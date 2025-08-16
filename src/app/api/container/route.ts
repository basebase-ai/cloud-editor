import { NextRequest, NextResponse } from "next/server";

// In-memory store for pending requests (in production, use Redis or similar)
const pendingRequests = new Map<string, PendingRequest>();
const inFlightRequests = new Map<string, PendingRequest>();

interface PendingRequest {
  id: string;
  action: string;
  params: Record<string, unknown>;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timestamp: number;
  containerUrl?: string;
}

// Clean up old requests periodically
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  for (const [id, request] of pendingRequests.entries()) {
    if (request.timestamp < fiveMinutesAgo) {
      request.reject(new Error("Request timeout"));
      pendingRequests.delete(id);
    }
  }

  for (const [id, request] of inFlightRequests.entries()) {
    if (request.timestamp < fiveMinutesAgo) {
      request.reject(new Error("Request timeout"));
      inFlightRequests.delete(id);
    }
  }
}, 5000);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { action, params, responseId, result, error, containerUrl } =
      await request.json();

    // Handle response from container
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
      return NextResponse.json({ success: true });
    }

    // Handle new request from server-side tools
    const requestId = crypto.randomUUID();

    return new Promise<NextResponse>((resolve) => {
      const pendingRequest: PendingRequest = {
        id: requestId,
        action,
        params,
        containerUrl,
        resolve: (result) => {
          resolve(NextResponse.json(result));
        },
        reject: (error) => {
          resolve(NextResponse.json({ error: error.message }, { status: 500 }));
        },
        timestamp: Date.now(),
      };

      pendingRequests.set(requestId, pendingRequest);

      // If we have a container URL, try to forward the request directly
      if (containerUrl && action !== "runCommand") {
        forwardToContainer(pendingRequest);
      }
    });
  } catch (error) {
    console.error("Container API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  // Move pending requests to in-flight (proper queue semantics)
  const requests = Array.from(pendingRequests.values()).map((request) => ({
    id: request.id,
    action: request.action,
    params: request.params,
    containerUrl: request.containerUrl,
  }));

  // Move to in-flight
  for (const request of requests) {
    const pendingRequest = pendingRequests.get(request.id);
    if (pendingRequest) {
      inFlightRequests.set(request.id, pendingRequest);
      pendingRequests.delete(request.id);
    }
  }

  return NextResponse.json({ requests });
}

async function forwardToContainer(request: PendingRequest): Promise<void> {
  if (!request.containerUrl) {
    request.reject(new Error("No container URL provided"));
    return;
  }

  try {
    const containerApiUrl = `${request.containerUrl}/api/tools`;

    const response = await fetch(containerApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: request.action,
        params: request.params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Container API responded with ${response.status}`);
    }

    const result = await response.json();
    request.resolve(result);
  } catch (error) {
    console.error("Failed to forward request to container:", error);
    request.reject(error instanceof Error ? error : new Error("Unknown error"));
  }
}
