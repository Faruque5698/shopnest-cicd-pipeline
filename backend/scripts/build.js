import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

// Clean and recreate dist directory
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// Copy production source files (excluding __tests__)
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of entries) {
    if (entry.name === '__tests__') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(path.join(rootDir, 'src'), path.join(distDir, 'src'));
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(distDir, 'package.json'));

const lockfile = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(lockfile)) {
  fs.copyFileSync(lockfile, path.join(distDir, 'package-lock.json'));
}

// Record build metadata for exact commit traceability
const buildInfo = {
  service: 'shopnest-api',
  version: JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,
  commitSha: process.env.GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local-dev',
  builtAt: new Date().toISOString(),
  nodeVersion: process.version
};

fs.writeFileSync(
  path.join(distDir, 'build-info.json'),
  JSON.stringify(buildInfo, null, 2)
);

console.log(`Backend built successfully into ${distDir} (commit: ${buildInfo.commitSha})`);
