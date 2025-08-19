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

export async function POST(req: Request) {
  try {
    const { action, params, containerUrl } = await req.json();

    console.log(`[Container API] ===== NEW REQUEST =====`);
    console.log(`[Container API] Action: ${action}`);
    console.log(`[Container API] ResponseId: none`);
    console.log(`[Container API] ContainerUrl: ${containerUrl}`);
    console.log(`[Container API] Params:`, params);

    if (!containerUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Container URL is required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Handle health check directly
    if (action === "checkHealth") {
      try {
        const healthResponse = await fetch(
          `${containerUrl}/_container/health`,
          {
            signal: AbortSignal.timeout(10000), // 10 second timeout
          }
        );
        if (!healthResponse.ok) {
          return new Response(
            JSON.stringify({
              success: false,
              healthy: false,
              error: `Health check failed: ${healthResponse.status}`,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const healthData = await healthResponse.json();
        console.log(`[Container API] Health check response:`, healthData);

        const isHealthy = healthData.overall?.healthy === true;
        console.log(`[Container API] Container healthy: ${isHealthy}`);

        return new Response(
          JSON.stringify({
            success: true,
            healthy: isHealthy,
            details: healthData,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            healthy: false,
            error:
              error instanceof Error ? error.message : "Health check failed",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Create a unique request ID
    const requestId = crypto.randomUUID();
    console.log(`[Container API] Creating new request with ID: ${requestId}`);

    // Store the request in the pending queue (for tracking purposes)
    const request: PendingRequest = {
      id: requestId,
      action,
      params: params || {},
      timestamp: Date.now(),
      resolve: () => {}, // Not used in direct forwarding
      reject: () => {}, // Not used in direct forwarding
    };

    pendingRequests.set(requestId, request);
    console.log(
      `[Container API] Request ${requestId} added to pending queue. Total pending: ${pendingRequests.size}`
    );

    // Try to forward the request directly to the deployed container
    try {
      console.log(
        `[Container API] Forwarding request ${requestId} directly to deployed container: ${containerUrl}`
      );

      // Convert camelCase action names to snake_case for container endpoints
      const actionToEndpoint = (action: string): string => {
        const mappings: Record<string, string> = {
          listFiles: "list_files",
          readFile: "read_file",
          writeFile: "write_file",
          runCommand: "run_command",
          restartServer: "restart_server",
          searchFiles: "search_files",
          runLinter: "run_linter",
          replaceLines: "replace_lines",
          deleteFile: "delete_file",
        };
        return mappings[action] || action;
      };

      const endpoint = actionToEndpoint(action);
      const containerEndpoint = `${containerUrl}/_container/${endpoint}`;
      console.log(
        `[Container API] Forwarding request to: ${containerEndpoint}`
      );
      console.log(`[Container API] Request params:`, params);

      const requestBody = params || {};
      console.log(
        `[Container API] Request body being sent:`,
        JSON.stringify(requestBody)
      );

      const response = await fetch(containerEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      console.log(`[Container API] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Container API] Error response:`, errorText);

        // Handle common container not ready scenarios
        if (response.status === 503 || response.status === 502) {
          throw new Error(
            `Container is still starting up. Please wait a few more seconds.`
          );
        } else if (response.status === 404) {
          throw new Error(
            `Container endpoint not found. The container may not be properly configured.`
          );
        } else {
          throw new Error(
            `Container request failed: ${response.status} - ${errorText}`
          );
        }
      }

      const result = await response.json();
      console.log(`[Container API] Success response for ${action}:`, result);

      // Remove the request from pending queue
      pendingRequests.delete(requestId);
      console.log(
        `[Container API] Request ${requestId} completed successfully. Remaining pending: ${pendingRequests.size}`
      );

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.log(
        `[Container API] Failed to forward request to container:`,
        error
      );

      // Remove the request from pending queue
      pendingRequests.delete(requestId);
      console.log(
        `[Container API] Request ${requestId} rejected: ${
          error instanceof Error ? error.message : "Unknown error"
        }. Remaining pending: ${pendingRequests.size}`
      );

      return new Response(
        JSON.stringify({
          success: false,
          error:
            error instanceof Error ? error.message : "Container request failed",
          action,
          message: `❌ ${
            error instanceof Error ? error.message : "Container request failed"
          }`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("[Container API] Error processing request:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        message: "❌ Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
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
