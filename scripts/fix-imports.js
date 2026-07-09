// scripts/fix-imports.js
import fs from 'fs';
import path from 'path';

const pagesDir = './src/pages';

function fixPageFiles() {
  const files = fs.readdirSync(pagesDir);
  
  files.forEach(file => {
    if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      const filePath = path.join(pagesDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Convert named exports to default exports
      // From: export function ComponentName() { ... }
      // To:   export default function ComponentName() { ... }
      
      content = content.replace(
        /export function (\w+)/g,
        'export default function $1'
      );
      
      content = content.replace(
        /export const (\w+)/g,
        'export default function $1'
      );
      
      fs.writeFileSync(filePath, content);
      console.log(`✅ Fixed: ${file}`);
    }
  });
}

fixPageFiles();