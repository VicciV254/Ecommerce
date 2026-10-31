import '../src/config/environment.js';
import { initializeDemo } from '../src/services/demoInitializer.js';

try {
  if (process.argv.slice(2).some((value) => value !== '--dry-run')) {
    throw new Error('Unsupported option. Only --dry-run is accepted; staff credentials must come from the environment.');
  }
  const result = await initializeDemo({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Demo initialization refused or failed: ${error.message}`);
  process.exitCode = 1;
}
