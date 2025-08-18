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

    // Use a simpler query that's more likely to work
    const logsQuery = `
      query ServiceInfo($serviceId: String!) {
        service(id: $serviceId) {
          id
          name
          status
          deployments(first: 1) {
            edges {
              node {
                id
                status
                logs(first: $limit) {
                  edges {
                    node {
                      timestamp
                      message
                    }
                  }
                }
              }
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
          serviceId: serviceId,
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
        {
          error: "Failed to fetch logs from Railway",
          details: errorText,
          status: response.status,
        },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Handle GraphQL errors
    if (data.errors) {
      console.error("[Railway Logs API] GraphQL errors:", data.errors);
      return NextResponse.json(
        {
          error: "GraphQL query failed",
          details: data.errors,
        },
        { status: 500 }
      );
    }

    // Extract logs from the nested structure
    const deployments = data.data?.service?.deployments?.edges || [];
    const logs: LogEntry[] = [];

    for (const deployment of deployments) {
      const deploymentLogs = deployment.node?.logs?.edges || [];
      for (const logEdge of deploymentLogs) {
        logs.push({
          timestamp: logEdge.node.timestamp,
          message: logEdge.node.message,
          level: "info",
        });
      }
    }

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

        let lastLogTimestamp: string | null = null;

        // Set up log polling
        const pollLogs = async () => {
          try {
            // Use a simpler query that's more likely to work
            const logsQuery = `
              query ServiceLogs($serviceId: String!, $limit: Int!) {
                service(id: $serviceId) {
                  deployments(first: 1) {
                    edges {
                      node {
                        id
                        logs(first: $limit) {
                          edges {
                            node {
                              timestamp
                              message
                            }
                          }
                        }
                      }
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
                  serviceId: serviceId,
                  limit: 20, // Get latest 20 logs
                },
              }),
            });

            if (response.ok) {
              const data = await response.json();

              if (data.errors) {
                console.error(
                  "[Railway Logs API] GraphQL errors during polling:",
                  data.errors
                );
                controller.enqueue(
                  encoder.encode(
                    `data: {"type":"error","message":"GraphQL query failed"}\n\n`
                  )
                );
                return;
              }

              const deployments = data.data?.service?.deployments?.edges || [];
              const logs: Array<{ timestamp: string; message: string }> = [];

              for (const deployment of deployments) {
                const deploymentLogs = deployment.node?.logs?.edges || [];
                for (const logEdge of deploymentLogs) {
                  logs.push(logEdge.node);
                }
              }

              console.log(
                `[Railway Logs API] Polled ${logs.length} logs from Railway`
              );

              // Send each log entry, but only new ones
              for (const log of logs) {
                if (!lastLogTimestamp || log.timestamp > lastLogTimestamp) {
                  const logEntry = {
                    type: "log",
                    timestamp: log.timestamp,
                    message: log.message,
                  };

                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(logEntry)}\n\n`)
                  );

                  if (!lastLogTimestamp || log.timestamp > lastLogTimestamp) {
                    lastLogTimestamp = log.timestamp;
                  }
                }
              }
            } else {
              const errorText = await response.text();
              console.error(
                `[Railway Logs API] Poll failed with status: ${response.status}, error: ${errorText}`
              );
              controller.enqueue(
                encoder.encode(
                  `data: {"type":"error","message":"Poll failed: ${response.status}"}\n\n`
                )
              );
            }
          } catch (error) {
            console.error("[Railway Logs API] Error polling logs:", error);
            controller.enqueue(
              encoder.encode(`data: {"type":"error","message":"${error}"}\n\n`)
            );
          }
        };

        // Poll for logs every 5 seconds (less frequent to avoid rate limiting)
        const interval = setInterval(pollLogs, 5000);

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
