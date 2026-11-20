/** Where a build runs, from the hosting platform's own setting (`VERCEL_ENV`); a build anywhere else is local. */
export type DeploymentEnvironment = "production" | "preview" | "development" | "local";

/** The one branch each hosted environment builds from: production from main, the development deployment from apex. */
export const DEPLOY_BRANCHES = { production: "main", preview: "apex" } as const;

type BuildVariables = Record<string, string | undefined>;

export function deploymentEnvironment(variables: BuildVariables): DeploymentEnvironment {
  const value = variables.VERCEL_ENV;
  if (!value) return "local";
  if (value === "production" || value === "preview" || value === "development") return value;
  throw new Error(`Unknown VERCEL_ENV "${value}"`);
}

/** Stops a hosted build from any other branch, so only main reaches production and only apex the development deployment. */
export function assertDeployBranch(variables: BuildVariables): void {
  const environment = deploymentEnvironment(variables);
  if (environment !== "production" && environment !== "preview") return;
  const expected = DEPLOY_BRANCHES[environment];
  const branch = variables.VERCEL_GIT_COMMIT_REF;
  if (branch !== expected) {
    const name = environment === "production" ? "Production" : "Preview";
    throw new Error(`${name} deployments build only from ${expected}; this build is from ${branch ? `"${branch}"` : "an unknown branch"}.`);
  }
}

/** Development deployments say so on every page, so they are never mistaken for the store itself. */
export function showsDeploymentNotice(environment: string | undefined): boolean {
  return environment === "preview" || environment === "development";
}

/** What vite.config.ts hands the client: the build's environment, once a hosted build is known to be on its branch. */
export function clientDeploymentDefine(variables: BuildVariables): Record<string, string> {
  assertDeployBranch(variables);
  return { "import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT": JSON.stringify(deploymentEnvironment(variables)) };
}
