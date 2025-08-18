import { NextRequest, NextResponse } from "next/server";

const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get("serviceId") || "user-td2yj8-nextjs-starter-dev";

    console.log(`[Railway Test API] Testing connection for serviceId: ${serviceId}`);

    // Get Railway token from server environment
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!railwayToken) {
      console.error(`[Railway Test API] Missing RAILWAY_TOKEN environment variable`);
      return NextResponse.json(
        { 
          error: "Railway credentials not configured on server",
          status: "missing_token"
        },
        { status: 500 }
      );
    }

    // Test with a simple query to get service info
    const testQuery = `
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
                createdAt
              }
            }
          }
        }
      }
    `;

    console.log(`[Railway Test API] Testing Railway GraphQL API connection...`);

    const response = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify({
        query: testQuery,
        variables: {
          serviceId: serviceId,
        },
      }),
    });

    console.log(`[Railway Test API] Railway response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Railway Test API] Railway API test failed:", errorText);
      return NextResponse.json(
        { 
          error: "Failed to connect to Railway API",
          details: errorText,
          status: response.status,
          railwayToken: railwayToken ? "present" : "missing"
        },
        { status: 500 }
      );
    }

    const data = await response.json();
    
    // Handle GraphQL errors
    if (data.errors) {
      console.error("[Railway Test API] GraphQL errors:", data.errors);
      return NextResponse.json(
        { 
          error: "GraphQL query failed",
          details: data.errors,
          status: "graphql_error"
        },
        { status: 500 }
      );
    }

    const service = data.data?.service;
    
    if (!service) {
      return NextResponse.json(
        { 
          error: "Service not found",
          serviceId,
          status: "service_not_found"
        },
        { status: 404 }
      );
    }

    console.log(`[Railway Test API] Successfully connected to Railway API`);

    return NextResponse.json({
      success: true,
      service: {
        id: service.id,
        name: service.name,
        status: service.status,
        deployments: service.deployments?.edges?.length || 0
      },
      status: "connected"
    });
  } catch (error) {
    console.error("[Railway Test API] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
        status: "internal_error"
      },
      { status: 500 }
    );
  }
}
