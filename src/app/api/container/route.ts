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

    console.log(`[Container API] ===== NEW REQUEST =====`);
    console.log(`[Container API] Action: ${action}`);
    console.log(`[Container API] ResponseId: ${responseId || "none"}`);
    console.log(`[Container API] ContainerUrl: ${containerUrl || "none"}`);
    console.log(`[Container API] Params:`, params);

    // Handle response from container
    if (responseId) {
      console.log(
        `[Container API] Processing response for request ${responseId}`
      );
      const inFlightRequest = inFlightRequests.get(responseId);
      if (inFlightRequest) {
        console.log(`[Container API] Found in-flight request, resolving...`);
        inFlightRequests.delete(responseId);
        if (error) {
          console.error(`[Container API] Response contains error:`, error);
          inFlightRequest.reject(new Error(error));
        } else {
          console.log(`[Container API] Response successful:`, result);
          inFlightRequest.resolve(result);
        }
      } else {
        console.warn(
          `[Container API] No in-flight request found for responseId: ${responseId}`
        );
      }
      return NextResponse.json({ success: true });
    }

    // Handle new request from server-side tools
    const requestId = crypto.randomUUID();
    console.log(`[Container API] Creating new request with ID: ${requestId}`);

    return new Promise<NextResponse>((resolve) => {
      const pendingRequest: PendingRequest = {
        id: requestId,
        action,
        params,
        containerUrl,
        resolve: (result) => {
          console.log(
            `[Container API] Request ${requestId} resolved successfully:`,
            result
          );
          resolve(NextResponse.json(result));
        },
        reject: (error) => {
          console.error(
            `[Container API] Request ${requestId} rejected:`,
            error.message
          );
          resolve(NextResponse.json({ error: error.message }, { status: 500 }));
        },
        timestamp: Date.now(),
      };

      pendingRequests.set(requestId, pendingRequest);
      console.log(
        `[Container API] Request ${requestId} added to pending queue. Total pending: ${pendingRequests.size}`
      );

      console.log(
        `[Container API] Forwarding request ${requestId} directly to deployed container: ${containerUrl}`
      );

      // Update the request with the correct container URL
      pendingRequest.containerUrl = containerUrl;
      forwardToContainer(pendingRequest);
    });
  } catch (error) {
    console.error("[Container API] Top-level error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  console.log(`[Container API] ===== POLL REQUEST =====`);
  console.log(`[Container API] Pending requests: ${pendingRequests.size}`);
  console.log(`[Container API] In-flight requests: ${inFlightRequests.size}`);

  // Move pending requests to in-flight (proper queue semantics)
  const requests = Array.from(pendingRequests.values()).map((request) => ({
    id: request.id,
    action: request.action,
    params: request.params,
    containerUrl: request.containerUrl,
  }));

  console.log(
    `[Container API] Returning ${requests.length} requests to container`
  );

  // Move to in-flight
  for (const request of requests) {
    const pendingRequest = pendingRequests.get(request.id);
    if (pendingRequest) {
      inFlightRequests.set(request.id, pendingRequest);
      pendingRequests.delete(request.id);
      console.log(
        `[Container API] Moved request ${request.id} from pending to in-flight`
      );
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
      runLinter: "/_container/run_linter",
    };

    const endpoint = actionEndpointMap[request.action];
    if (!endpoint) {
      throw new Error(`Unsupported action: ${request.action}`);
    }

    const containerApiUrl = `${request.containerUrl}${endpoint}`;

    console.log(`[Container API] Forwarding request to: ${containerApiUrl}`);
    console.log(`[Container API] Request params:`, request.params);
    console.log(
      `[Container API] Request body being sent:`,
      JSON.stringify(request.params)
    );

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

    // If it's a timeout error, provide a more helpful message
    if (error instanceof Error && error.name === "AbortError") {
      request.reject(
        new Error(
          "Container API request timed out. The container may be overloaded or not responding."
        )
      );
    } else {
      request.reject(
        error instanceof Error ? error : new Error("Unknown error")
      );
    }
  }
}
