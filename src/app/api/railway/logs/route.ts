import { NextRequest, NextResponse } from "next/server";

const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get("serviceId");
    const deploymentId = searchParams.get("deploymentId");
    const limit = searchParams.get("limit") || "100";

    console.log(`[Railway Logs API] GET request:`, {
      serviceId,
      deploymentId,
      limit,
    });

    // Get Railway token from server environment
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!serviceId) {
      console.error(`[Railway Logs API] Missing serviceId parameter`);
      return NextResponse.json(
        { error: "Missing required query parameters" },
        { status: 400 }
      );
    }

    if (!railwayToken) {
      console.error(
        `[Railway Logs API] Missing RAILWAY_TOKEN environment variable`
      );
      return NextResponse.json(
        { error: "Railway credentials not configured on server" },
        { status: 500 }
      );
    }

    const logsQuery = `
      query DeploymentLogs($deploymentId: String!, $limit: Int!) {
        logs(deploymentId: $deploymentId, limit: $limit) {
          edges {
            node {
              timestamp
              message
            }
          }
        }
      }
    `;

    console.log(`[Railway Logs API] Fetching logs from Railway GraphQL API...`);

    const response = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify({
        query: logsQuery,
        variables: {
          deploymentId: deploymentId || serviceId,
          limit: parseInt(limit, 10),
        },
      }),
    });

    console.log(
      `[Railway Logs API] Railway response status: ${response.status}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Railway Logs API] Railway logs fetch failed:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch logs from Railway" },
        { status: 500 }
      );
    }

    const data = await response.json();
    const logs: LogEntry[] =
      data.data?.logs?.edges?.map(
        (edge: { node: { timestamp: string; message: string } }) => ({
          timestamp: edge.node.timestamp,
          message: edge.node.message,
          level: "info", // Railway doesn't provide log levels in this format
        })
      ) || [];

    console.log(
      `[Railway Logs API] Retrieved ${logs.length} logs from Railway`
    );

    return NextResponse.json({
      success: true,
      logs,
      total: logs.length,
    });
  } catch (error) {
    console.error("[Railway Logs API] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Server-Sent Events endpoint for real-time log streaming
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const { serviceId, deploymentId } = body;

    console.log(`[Railway Logs API] POST request for streaming:`, {
      serviceId,
      deploymentId,
    });

    // Get Railway token from server environment
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!serviceId) {
      console.error(`[Railway Logs API] Missing serviceId in POST request`);
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (!railwayToken) {
      console.error(`[Railway Logs API] Missing RAILWAY_TOKEN for streaming`);
      return new Response(
        JSON.stringify({
          error: "Railway credentials not configured on server",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `[Railway Logs API] Starting log stream for serviceId: ${serviceId}`
    );

    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
        console.log(
          `[Railway Logs API] Stream connected, starting log polling...`
        );

        // Set up log polling
        const pollLogs = async () => {
          try {
            const logsQuery = `
              query DeploymentLogs($deploymentId: String!, $limit: Int!) {
                logs(deploymentId: $deploymentId, limit: $limit) {
                  edges {
                    node {
                      timestamp
                      message
                    }
                  }
                }
              }
            `;

            console.log(`[Railway Logs API] Polling logs from Railway...`);

            const response = await fetch(RAILWAY_API_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${railwayToken}`,
              },
              body: JSON.stringify({
                query: logsQuery,
                variables: {
                  deploymentId: deploymentId || serviceId,
                  limit: 50, // Get latest 50 logs
                },
              }),
            });

            if (response.ok) {
              const data = await response.json();
              const logs = data.data?.logs?.edges || [];

              console.log(
                `[Railway Logs API] Polled ${logs.length} logs from Railway`
              );

              // Send each log entry
              for (const edge of logs) {
                const logEntry = {
                  type: "log",
                  timestamp: edge.node.timestamp,
                  message: edge.node.message,
                };

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(logEntry)}\n\n`)
                );
              }
            } else {
              console.error(
                `[Railway Logs API] Poll failed with status: ${response.status}`
              );
            }
          } catch (error) {
            console.error("[Railway Logs API] Error polling logs:", error);
            controller.enqueue(
              encoder.encode(`data: {"type":"error","message":"${error}"}\n\n`)
            );
          }
        };

        // Poll for logs every 2 seconds
        const interval = setInterval(pollLogs, 2000);

        // Initial poll
        pollLogs();

        // Clean up on close
        setTimeout(() => {
          console.log(
            `[Railway Logs API] Stream timeout, closing after 5 minutes`
          );
          clearInterval(interval);
          controller.close();
        }, 5 * 60 * 1000); // Close after 5 minutes
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("[Railway Logs API] Stream error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
