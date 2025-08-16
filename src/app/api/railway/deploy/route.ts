import { NextRequest, NextResponse } from "next/server";

const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

interface DeploymentRequest {
  repoUrl: string;
  projectId: string;
  userId?: string;
  githubToken?: string;
}

interface ServiceCreateResponse {
  data: {
    serviceCreate: {
      id: string;
      name: string;
    };
  };
}

interface DeploymentResponse {
  data: {
    serviceInstanceDeploy: {
      id: string;
      status: string;
    };
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as DeploymentRequest;
    const { repoUrl, projectId, userId, githubToken } = body;

    // Get Railway credentials from server environment
    const railwayProjectId = process.env.RAILWAY_PROJECT_ID;
    const railwayEnvironmentId = process.env.RAILWAY_ENVIRONMENT_ID;
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!repoUrl || !projectId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!railwayProjectId || !railwayEnvironmentId || !railwayToken) {
      return NextResponse.json(
        { error: "Railway credentials not configured on server" },
        { status: 500 }
      );
    }

    // Extract repo info from URL
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      return NextResponse.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 }
      );
    }

    const [, ,] = repoMatch;

    // Create service name with userId prefix for multi-tenant support
    // Railway has strict service naming requirements - let's use a much simpler approach
    const userHash = userId ? userId.substring(userId.length - 4) : "anon";
    const repoHash = projectId.substring(projectId.length - 8);
    const serviceName = `${userHash}-${repoHash}`;

    console.log(`Service name: ${projectId} + ${userId} -> ${serviceName}`);

    // Create service in Railway project using universal container image
    const createServiceMutation = `
      mutation ServiceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }
    `;

    const createServiceRequest = {
      query: createServiceMutation,
      variables: {
        input: {
          projectId: railwayProjectId,
          name: serviceName,
          source: {
            image: "ghcr.io/basebase-ai/universal-dev-container:latest",
          },
        },
      },
    };

    console.log("=== Railway GraphQL Request (Service Create) ===");
    console.log("URL:", RAILWAY_API_URL);
    console.log("Headers:", {
      "Content-Type": "application/json",
      Authorization: `Bearer ${railwayToken?.substring(0, 10)}...`,
    });
    console.log("Request Body:", JSON.stringify(createServiceRequest, null, 2));

    const serviceResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify(createServiceRequest),
    });

    console.log("=== Railway GraphQL Response (Service Create) ===");
    console.log("Status:", serviceResponse.status);
    console.log("Status Text:", serviceResponse.statusText);

    if (!serviceResponse.ok) {
      const errorText = await serviceResponse.text();
      console.error("Railway service creation failed:", errorText);
      return NextResponse.json(
        { error: "Failed to create Railway service" },
        { status: 500 }
      );
    }

    const serviceData = (await serviceResponse.json()) as ServiceCreateResponse;
    console.log("Response Body:", JSON.stringify(serviceData, null, 2));

    if (!serviceData.data || !serviceData.data.serviceCreate) {
      console.error("Railway service creation failed:", serviceData);
      return NextResponse.json(
        {
          error: "Railway service creation failed",
          details: serviceData.errors || serviceData,
        },
        { status: 500 }
      );
    }

    const serviceId = serviceData.data.serviceCreate.id;

    // Set environment variables for the universal container
    const setVariablesMutation = `
      mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }
    `;

    // Prepare environment variables for the container
    const environmentVariables: Record<string, string> = {
      GITHUB_REPO_URL: repoUrl,
      NODE_ENV: "development",
      RAILWAY_CONTAINER_API_PORT: "3001",
      PROJECT_ID: projectId,
      PORT: "3000", // Ensure the main app runs on port 3000
    };

    // Add GitHub token if provided (for private repos)
    if (githubToken) {
      environmentVariables.GITHUB_TOKEN = githubToken;
    }

    // Set all environment variables in one request
    const setVariableRequest = {
      query: setVariablesMutation,
      variables: {
        input: {
          projectId: railwayProjectId,
          environmentId: railwayEnvironmentId,
          serviceId,
          variables: environmentVariables, // Pass all variables as an object
          replace: false, // Don't remove existing variables
          skipDeploys: false,
        },
      },
    };

    console.log("=== Railway GraphQL Request (Set Variables Collection) ===");
    console.log("Request Body:", JSON.stringify(setVariableRequest, null, 2));

    const varResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify(setVariableRequest),
    });

    console.log("=== Railway GraphQL Response (Set Variables Collection) ===");
    console.log("Status:", varResponse.status);
    const varData = await varResponse.json();
    console.log("Response Body:", JSON.stringify(varData, null, 2));

    if (!varResponse.ok) {
      console.warn(
        "Failed to set environment variables, but continuing with deployment"
      );
    }

    // Deploy the service
    const deployMutation = `
      mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
      }
    `;

    const deployRequest = {
      query: deployMutation,
      variables: {
        serviceId,
        environmentId: railwayEnvironmentId,
      },
    };

    console.log("=== Railway GraphQL Request (Deploy Service) ===");
    console.log("Request Body:", JSON.stringify(deployRequest, null, 2));

    const deployResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify(deployRequest),
    });

    console.log("=== Railway GraphQL Response (Deploy Service) ===");
    console.log("Status:", deployResponse.status);
    const deployData = (await deployResponse.json()) as {
      data?: { serviceInstanceDeploy?: boolean };
      errors?: Array<{ message: string }>;
    };
    console.log("Response Body:", JSON.stringify(deployData, null, 2));

    if (
      !deployResponse.ok ||
      deployData.errors ||
      !deployData.data?.serviceInstanceDeploy
    ) {
      console.error(
        "Railway deployment failed with status:",
        deployResponse.status
      );
      return NextResponse.json(
        {
          error: `Deploy failed: ${
            deployData.errors?.[0]?.message || "Unknown error"
          }`,
        },
        { status: 500 }
      );
    }

    // Store deployment info for later use
    // In a production app, you'd store this in a database
    const deploymentInfo = {
      serviceId,
      deploymentId: "deployed", // Railway now returns boolean, not deployment ID
      projectId,
      repoUrl,
      status: "deployed",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      deployment: deploymentInfo,
    });
  } catch (error) {
    console.error("Railway deployment error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    // Get Railway credentials from server environment
    const railwayProjectId = process.env.RAILWAY_PROJECT_ID;
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing required query parameters" },
        { status: 400 }
      );
    }

    if (!railwayProjectId || !railwayToken) {
      return NextResponse.json(
        { error: "Railway credentials not configured on server" },
        { status: 500 }
      );
    }

    // Query Railway for service status
    const statusQuery = `
      query Project($id: String!) {
        project(id: $id) {
          services {
            edges {
              node {
                id
                name
                deployments {
                  edges {
                    node {
                      id
                      status
                      url
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const statusResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify({
        query: statusQuery,
        variables: {
          id: railwayProjectId,
        },
      }),
    });

    if (!statusResponse.ok) {
      return NextResponse.json(
        { error: "Failed to get deployment status" },
        { status: 500 }
      );
    }

    const statusData = await statusResponse.json();
    const services = statusData.data?.project?.services?.edges || [];

    // Extract userId and projectId from query params for service lookup
    const url = new URL(request.url);
    const queryProjectId = url.searchParams.get("projectId") || "";
    const queryUserId = url.searchParams.get("userId");

    // Reconstruct service name for lookup using same logic as creation
    const userHash = queryUserId
      ? queryUserId.substring(queryUserId.length - 4)
      : "anon";
    const repoHash = queryProjectId.substring(queryProjectId.length - 8);
    const serviceName = `${userHash}-${repoHash}`;

    const ourService = services.find(
      (service: { node: { name: string } }) => service.node.name === serviceName
    );

    if (!ourService) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const latestDeployment = ourService.node.deployments.edges[0]?.node;

    return NextResponse.json({
      success: true,
      service: {
        id: ourService.node.id,
        name: ourService.node.name,
        deployment: latestDeployment
          ? {
              id: latestDeployment.id,
              status: latestDeployment.status,
              url: latestDeployment.url,
              createdAt: latestDeployment.createdAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Railway status error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
