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
    // Map actions to the new /_container/ endpoints
    const actionEndpointMap: Record<string, string> = {
      readFile: "/_container/read_file",
      writeFile: "/_container/write_file",
      listFiles: "/_container/list_files",
      runCommand: "/_container/run_command",
      restartServer: "/_container/restart_server",
      // checkStatus: "/_container/health", // This is a GET endpoint, incompatible with our POST approach
      searchFiles: "/_container/search_files",
      replaceLines: "/_container/replace_lines",
      deleteFile: "/_container/delete_file",
    };

    const endpoint = actionEndpointMap[request.action];
    if (!endpoint) {
      throw new Error(`Unsupported action: ${request.action}`);
    }

    const containerApiUrl = `${request.containerUrl}${endpoint}`;

    console.log(`[Container API] Forwarding request to: ${containerApiUrl}`);
    console.log(`[Container API] Request params:`, request.params);

    const response = await fetch(containerApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.params),
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    console.log(`[Container API] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Container API] Error response:`, errorText);

      // Handle common container not ready scenarios
      if (response.status === 503 || response.status === 502) {
        throw new Error(
          `Container is still starting up. Please wait a few more seconds.`
        );
      } else if (response.status === 404) {
        throw new Error(
          `Container API endpoint not found. The container may still be deploying.`
        );
      } else {
        throw new Error(
          `Container API responded with ${response.status}: ${errorText}`
        );
      }
    }

    const result = await response.json();
    console.log(`[Container API] Success response:`, result);
    request.resolve(result);
  } catch (error) {
    console.error("Failed to forward request to container:", error);
    request.reject(error instanceof Error ? error : new Error("Unknown error"));
  }
}
