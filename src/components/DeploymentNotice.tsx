import { showsDeploymentNotice } from "../deployment";

/**
 * The strip above the header on every page of a development deployment, the staff area included. The environment
 * is fixed at build time (vite.config.ts), so production and local builds never render it.
 */
export function DeploymentNotice() {
  if (!showsDeploymentNotice(import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT)) return null;
  return (
    <section
      aria-label="Deployment"
      className="border-b border-warning/40 bg-warning-tint px-4 py-2 text-center text-sm font-semibold text-navy-900 [overflow-wrap:anywhere]"
    >
      Development preview: use test accounts and test data only.
    </section>
  );
}
