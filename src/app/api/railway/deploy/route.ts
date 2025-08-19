import { NextRequest, NextResponse } from "next/server";

const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

interface DeploymentRequest {
  repoUrl: string;
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
  errors?: Array<{ message: string }>;
}

interface DeploymentStatus {
  status: "SUCCESS" | "FAILED" | "BUILDING" | "CRASHED";
  deploymentId?: string;
  error?: string;
}

async function waitForDeploymentReady(
  railwayProjectId: string,
  serviceId: string,
  railwayToken: string
): Promise<DeploymentStatus> {
  const maxAttempts = 60; // 10 minutes max (10 seconds * 60)
  let attempts = 0;

  const checkDeploymentQuery = `
    query Service($id: String!) {
      service(id: $id) {
        deployments {
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

  while (attempts < maxAttempts) {
    try {
      console.log(
        `⏳ Checking deployment status (attempt ${
          attempts + 1
        }/${maxAttempts})...`
      );

      const response = await fetch(RAILWAY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${railwayToken}`,
        },
        body: JSON.stringify({
          query: checkDeploymentQuery,
          variables: { id: serviceId },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to check deployment status: ${response.status}`
        );
      }

      const data = await response.json();
      const deployments = data.data?.service?.deployments?.edges || [];

      if (deployments.length === 0) {
        console.log("No deployments found yet, waiting...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
        attempts++;
        continue;
      }

      // Get the latest deployment
      const latestDeployment = deployments[0].node;
      console.log(`📊 Latest deployment status: ${latestDeployment.status}`);

      if (latestDeployment.status === "SUCCESS") {
        console.log("🎉 Deployment marked as SUCCESS!");

        return {
          status: "SUCCESS",
          deploymentId: latestDeployment.id,
        };
      } else if (
        latestDeployment.status === "FAILED" ||
        latestDeployment.status === "CRASHED"
      ) {
        return {
          status: "FAILED",
          deploymentId: latestDeployment.id,
          error: `Deployment ${latestDeployment.status.toLowerCase()}`,
        };
      }

      // Still building/deploying, wait before next check
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    } catch (error) {
      console.error(`Error checking deployment status:`, error);
      attempts++;
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  // Timeout reached
  return {
    status: "FAILED",
    error: "Deployment timeout - took longer than 10 minutes",
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = Math.random().toString(36).substring(2, 8);
  console.log(`[Deploy API] Request ${requestId} started`);

  try {
    const body = (await request.json()) as DeploymentRequest;
    const { repoUrl, userId, githubToken } = body;

    // Get Railway credentials from server environment
    const railwayProjectId = process.env.RAILWAY_DEV_PROJECT_ID;
    const railwayEnvironmentId = process.env.RAILWAY_DEV_ENVIRONMENT_ID;
    const railwayToken = process.env.RAILWAY_TOKEN;

    if (!repoUrl) {
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

    const [, , repo] = repoMatch;

    // Use just the repo name, not the full projectId which includes owner
    const cleanRepoName = repo.replace(/[^a-zA-Z0-9-]/g, "");

    // Create service name with userId prefix for multi-tenant support
    // Use clean format: userId-repoName (much cleaner!)
    const cleanUserId = userId
      ? userId.replace(/[^a-zA-Z0-9-]/g, "")
      : "anonymous";
    const serviceName = `${cleanUserId}-${cleanRepoName}`;

    console.log(`Service name: ${userId} -> ${serviceName}`);

    // Prepare environment variables for the container
    const environmentVariables: Record<string, string> = {
      GITHUB_REPO_URL: repoUrl,
      NODE_ENV: "development",
      PROJECT_ID: railwayProjectId,
      // Don't set PORT - let Railway set it automatically for public access

      // Configure iframe embedding compatibility
      IFRAME_EMBEDDING_ALLOWED: "true",
      X_FRAME_OPTIONS: "ALLOWALL",
      CONTENT_SECURITY_POLICY_FRAME_ANCESTORS: "*",
      // Allow embedding from any origin for development
      DISABLE_X_FRAME_OPTIONS: "true",
      // Additional headers for iframe compatibility
      ALLOW_IFRAME_EMBEDDING: "true",
      CSP_FRAME_ANCESTORS: "*",
      NEXT_PUBLIC_IFRAME_ALLOWED: "true",
    };

    // Add GitHub token if provided (for private repos)
    if (githubToken) {
      environmentVariables.GITHUB_TOKEN = githubToken;
    }

    // First, check if a service with this name already exists
    const existingServiceQuery = `
      query Project($id: String!) {
        project(id: $id) {
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const existingServiceResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify({
        query: existingServiceQuery,
        variables: {
          id: railwayProjectId,
        },
      }),
    });

    if (existingServiceResponse.ok) {
      const existingData = await existingServiceResponse.json();
      const services = existingData.data?.project?.services?.edges || [];
      const existingService = services.find(
        (service: { node: { name: string } }) =>
          service.node.name === serviceName
      );

      if (existingService) {
        const serviceId = existingService.node.id;
        console.log(
          `[Deploy API] Request ${requestId}: Found existing service: ${serviceName} (${serviceId})`
        );

        // Check if the existing service is already running successfully
        console.log(
          `[Deploy API] Request ${requestId}: Checking if existing service is already running...`
        );
        const existingDeploymentStatus = await waitForDeploymentReady(
          railwayProjectId,
          serviceId,
          railwayToken
        );

        if (existingDeploymentStatus.status === "SUCCESS") {
          console.log(
            `[Deploy API] Request ${requestId}: Existing service is already running successfully - no redeployment needed!`
          );

          // Get the service URL
          const serviceUrlQuery = `
            query Service($id: String!) {
              service(id: $id) {
                url
                deployments {
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

          const serviceUrlResponse = await fetch(RAILWAY_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${railwayToken}`,
            },
            body: JSON.stringify({
              query: serviceUrlQuery,
              variables: { id: serviceId },
            }),
          });

          if (serviceUrlResponse.ok) {
            const serviceData = await serviceUrlResponse.json();
            console.log(
              `[Deploy API] Request ${requestId}: Service URL response:`,
              serviceData
            );
            const serviceUrl = serviceData.data?.service?.url;
            const latestDeployment =
              serviceData.data?.service?.deployments?.edges?.[0]?.node;

            if (serviceUrl && latestDeployment) {
              console.log(
                `[Deploy API] Request ${requestId}: Using existing running service - RETURNING EARLY`
              );
              console.log(
                `[Deploy API] Request ${requestId}: Service URL:`,
                serviceUrl
              );
              console.log(
                `[Deploy API] Request ${requestId}: Deployment ID:`,
                latestDeployment.id
              );
              return NextResponse.json({
                success: true,
                deployment: {
                  serviceId: serviceId,
                  deploymentId: latestDeployment.id,
                  projectId: railwayProjectId,
                  repoUrl: repoUrl,
                  status: "SUCCESS",
                  url: serviceUrl,
                  createdAt: latestDeployment.createdAt,
                },
              });
            } else {
              console.log(
                `[Deploy API] Request ${requestId}: Service URL or deployment not found, proceeding with redeployment`
              );
              console.log(
                `[Deploy API] Request ${requestId}: Service URL:`,
                serviceUrl
              );
              console.log(
                `[Deploy API] Request ${requestId}: Latest deployment:`,
                latestDeployment
              );
            }
          } else {
            console.log(
              `[Deploy API] Request ${requestId}: Service URL response not ok:`,
              serviceUrlResponse.status,
              serviceUrlResponse.statusText
            );
            console.log(
              `[Deploy API] Request ${requestId}: Using default Railway URL format`
            );

            // Use default Railway URL format when service URL query fails
            const defaultUrl = `https://${serviceName}-dev.up.railway.app`;
            console.log(
              `[Deploy API] Request ${requestId}: Using existing running service with default URL - RETURNING EARLY`
            );
            console.log(
              `[Deploy API] Request ${requestId}: Service URL:`,
              defaultUrl
            );

            return NextResponse.json({
              success: true,
              deployment: {
                serviceId: serviceId,
                deploymentId: "existing",
                projectId: railwayProjectId,
                repoUrl: repoUrl,
                status: "SUCCESS",
                url: defaultUrl,
                createdAt: new Date().toISOString(),
              },
            });
          }
        }

        // If we get here, the service exists but is not running successfully, proceed with redeployment
        console.log(
          `[Deploy API] Request ${requestId}: Existing service needs redeployment - updating environment variables...`
        );

        // Update environment variables for existing service
        const variableCollectionMutation = `
          mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
          }
        `;

        const updateRequest = {
          query: variableCollectionMutation,
          variables: {
            input: {
              projectId: railwayProjectId,
              environmentId: railwayEnvironmentId,
              serviceId: serviceId,
              variables: environmentVariables,
              replace: false,
              skipDeploys: false,
            },
          },
        };

        const updateResponse = await fetch(RAILWAY_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${railwayToken}`,
          },
          body: JSON.stringify(updateRequest),
        });

        if (updateResponse.ok) {
          console.log("✅ Environment variables updated for existing service");

          // Deploy the existing service
          const redeployRequest = {
            query: `
              mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
                serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
              }
            `,
            variables: {
              serviceId: serviceId,
              environmentId: railwayEnvironmentId,
            },
          };

          const redeployResponse = await fetch(RAILWAY_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${railwayToken}`,
            },
            body: JSON.stringify(redeployRequest),
          });

          if (redeployResponse.ok) {
            console.log("✅ Existing service redeployed successfully");

            console.log("=== Waiting for Redeploy to Complete ===");

            // Wait for redeployment to be ready (blocking until success or failure)
            const finalDeploymentStatus = await waitForDeploymentReady(
              railwayProjectId,
              serviceId,
              railwayToken
            );

            if (finalDeploymentStatus.status === "FAILED") {
              return NextResponse.json(
                {
                  error: `Redeployment failed: ${
                    finalDeploymentStatus.error || "Unknown error"
                  }`,
                },
                { status: 500 }
              );
            }

            const deploymentInfo = {
              serviceId: serviceId,
              deploymentId: finalDeploymentStatus.deploymentId || "redeployed",
              projectId: railwayProjectId,
              repoUrl,
              status: finalDeploymentStatus.status,
              url: `https://${serviceName}-dev.up.railway.app`,
              createdAt: new Date().toISOString(),
            };

            console.log(
              "✅ Redeployment completed successfully:",
              deploymentInfo
            );

            return NextResponse.json({
              success: true,
              deployment: deploymentInfo,
            });
          }
        }
      }
    }

    // If no existing service found, create a new one
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

    // After successful deployment, create a public domain
    console.log("=== Creating Public Domain ===");

    const domainMutation = `
      mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          id
          domain
          serviceId
          environmentId
        }
      }
    `;

    const domainRequest = {
      query: domainMutation,
      variables: {
        input: {
          serviceId,
          environmentId: railwayEnvironmentId,
          // Railway will automatically detect the port our app is listening on
        },
      },
    };

    console.log("=== Railway GraphQL Request (Create Domain) ===");
    console.log("Request Body:", JSON.stringify(domainRequest, null, 2));

    const domainResponse = await fetch(RAILWAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify(domainRequest),
    });

    const domainData = await domainResponse.json();
    console.log("=== Railway GraphQL Response (Create Domain) ===");
    console.log("Status:", domainResponse.status);
    console.log("Response Body:", JSON.stringify(domainData, null, 2));

    const publicUrl = domainData.data?.serviceDomainCreate?.domain
      ? `https://${domainData.data.serviceDomainCreate.domain}`
      : `https://${serviceName}-dev.up.railway.app`; // Railway adds -dev suffix automatically

    console.log("=== Waiting for Deployment to Complete ===");

    // Wait for deployment to be ready (blocking until success or failure)
    const finalDeploymentStatus = await waitForDeploymentReady(
      railwayProjectId,
      serviceId,
      railwayToken
    );

    if (finalDeploymentStatus.status === "FAILED") {
      return NextResponse.json(
        {
          error: `Deployment failed: ${
            finalDeploymentStatus.error || "Unknown error"
          }`,
        },
        { status: 500 }
      );
    }

    // Store deployment info for later use
    const deploymentInfo = {
      serviceId,
      deploymentId: finalDeploymentStatus.deploymentId || "deployed",
      projectId: railwayProjectId,
      repoUrl,
      status: finalDeploymentStatus.status,
      url: publicUrl,
      domainCreated: !!domainData.data?.serviceDomainCreate,
      createdAt: new Date().toISOString(),
    };

    console.log("✅ Deployment completed successfully:", deploymentInfo);

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
    const railwayProjectId = process.env.RAILWAY_DEV_PROJECT_ID;
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
    // The creation logic uses: github.com/owner/repo -> serviceName = userId-repo
    // But we only have projectId (not the full GitHub URL) in the GET request
    // ProjectId should be in format "owner-repo" like "basebase-ai-nextjs-starter"
    // We need to extract just the repo part (everything after the first hyphen + username)
    let repoName = "";

    // For "basebase-ai-nextjs-starter", we want "nextjs-starter"
    // Based on the GitHub URL pattern, let's extract the repo name properly
    // The projectId might be malformed, so let's try different extraction methods
    if (queryProjectId.includes("-")) {
      // Try different patterns to extract repo name
      const parts = queryProjectId.split("-");

      // If it looks like "owner-repo-name", try taking last 2 parts
      if (parts.length >= 3 && parts.includes("nextjs")) {
        // Find where "nextjs" starts and take everything from there
        const nextjsIndex = parts.findIndex((part) => part.includes("nextjs"));
        if (nextjsIndex >= 0) {
          repoName = parts.slice(nextjsIndex).join("-");
        } else {
          repoName = parts.slice(-2).join("-"); // fallback
        }
      } else {
        // Simple case: take everything after first hyphen
        const firstHyphenIndex = queryProjectId.indexOf("-");
        repoName = queryProjectId.substring(firstHyphenIndex + 1);
      }
    } else {
      repoName = queryProjectId;
    }

    const cleanUserId = queryUserId
      ? queryUserId.replace(/[^a-zA-Z0-9-]/g, "")
      : "anonymous";
    const cleanRepoName = repoName.replace(/[^a-zA-Z0-9-]/g, "");
    const serviceName = `${cleanUserId}-${cleanRepoName}`;

    console.log(
      `GET: Looking for service: ${serviceName} (userId: ${queryUserId}, projectId: ${queryProjectId}, repoName: ${repoName})`
    );

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
