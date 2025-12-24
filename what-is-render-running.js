//  what-is-render-running.js  — proves what code Render is actually executing
console.log('🔥 THIS IS THE DEBUG FILE - IF YOU SEE THIS, RENDER IS RUNNING IT!');
console.log('🔥 Timestamp:', new Date().toISOString());
console.log('🔥 File:', __filename);
console.log('🔥 Directory:', __dirname);
console.log('🔥 Process ID:', process.pid);
console.log('🔥 Arguments:', process.argv);
console.log('🔥 Environment variables found:', Object.keys(process.env).length);

// Force an obvious error that can't be missed
throw new Error('🎯 IF YOU SEE THIS MESSAGE, RENDER IS RUNNING THE DEBUG FILE!');
