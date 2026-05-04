const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace rounded-b-[3rem] -> rounded-b-[2.5rem]
content = content.replace(/rounded-b-\[3rem\]/g, 'rounded-b-[2.5rem]');

// Protect existing rounded-[2rem] from being overwritten by rounded-[2.5rem]
content = content.replace(/rounded-\[2rem\]/g, 'TMP_2REM');

// rounded-[2.5rem] -> rounded-[2rem]
content = content.replace(/rounded-\[2\.5rem\]/g, 'rounded-[2rem]');

// restore and change: TMP_2REM -> rounded-[1.5rem]
content = content.replace(/TMP_2REM/g, 'rounded-[1.5rem]');

// rounded-3xl -> rounded-2xl
content = content.replace(/rounded-3xl/g, 'rounded-2xl');

fs.writeFileSync('src/App.tsx', content);
console.log('Done!');
