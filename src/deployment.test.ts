import { describe, expect, it } from "vitest";
import { assertDeployBranch, clientDeploymentDefine, deploymentEnvironment, showsDeploymentNotice } from "./deployment";

describe("deployment environment", () => {
  it("comes from the hosting platform at build time, and a build anywhere else is local", () => {
    expect(deploymentEnvironment({})).toBe("local");
    expect(deploymentEnvironment({ VERCEL_ENV: "" })).toBe("local");
    for (const value of ["production", "preview", "development"] as const) {
      expect(deploymentEnvironment({ VERCEL_ENV: value })).toBe(value);
    }
    expect(() => deploymentEnvironment({ VERCEL_ENV: "staging" })).toThrow(/Unknown VERCEL_ENV "staging"/);
  });

  it("builds production only from main and the development deployment only from apex", () => {
    expect(() => assertDeployBranch({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" })).not.toThrow();
    expect(() => assertDeployBranch({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "apex" })).not.toThrow();
    expect(() => assertDeployBranch({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "apex" }))
      .toThrow('Production deployments build only from main; this build is from "apex".');
    expect(() => assertDeployBranch({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" })).toThrow(/Preview deployments build only from apex/);
    expect(() => assertDeployBranch({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix-reset-token-leak" })).toThrow(/only from apex/);
    expect(() => assertDeployBranch({ VERCEL_ENV: "preview" })).toThrow(/this build is from an unknown branch/);
    expect(() => assertDeployBranch({})).not.toThrow();
    expect(() => assertDeployBranch({ VERCEL_ENV: "development" })).not.toThrow();
  });

  it("shows the notice only on development deployments", () => {
    expect(showsDeploymentNotice("preview")).toBe(true);
    expect(showsDeploymentNotice("development")).toBe(true);
    for (const value of ["production", "local", "", undefined]) expect(showsDeploymentNotice(value)).toBe(false);
  });

  it("hands the client the build's environment, and nothing for a hosted build on the wrong branch", () => {
    const key = "import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT";
    expect(clientDeploymentDefine({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "apex" })).toEqual({ [key]: '"preview"' });
    expect(clientDeploymentDefine({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" })).toEqual({ [key]: '"production"' });
    expect(clientDeploymentDefine({})).toEqual({ [key]: '"local"' });
    expect(() => clientDeploymentDefine({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "apex" })).toThrow(/only from main/);
  });
});
