import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(/const NavMeshWidget = \(\) => \([\s\S]*?<\/svg>\n\);\n/g, '');
content = content.replace(/<NavMeshWidget \/>\n/g, '');

content = content.replace(/const RaycastWidget = \(\) => \([\s\S]*?<\/svg>\n\);\n/g, '');
content = content.replace(/<RaycastWidget \/>\n/g, '');

fs.writeFileSync('src/App.tsx', content);
