const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const testDir = path.join(root, 'testclass');
const tests = fs.readdirSync(testDir)
  .filter(function(file){
    return /^run_.*\.js$/.test(file);
  })
  .sort();

const failed = [];
const startedAt = Date.now();

console.log('Running cache-bust check...');
const cacheCheck = spawnSync(process.execPath, [path.join(root, 'check_cache_bust.js')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if(cacheCheck.error || cacheCheck.status !== 0){
  if(cacheCheck.error) console.error(cacheCheck.error.message);
  console.error('Cache-bust check failed; tests were not started.');
  process.exit(1);
}

console.log('Running ' + tests.length + ' test files...');
tests.forEach(function(test, index){
  console.log('\n[' + (index + 1) + '/' + tests.length + '] ' + test);
  const result = spawnSync(process.execPath, [path.join(testDir, test)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if(result.error){
    console.error(result.error.message);
  }
  if(result.error || result.status !== 0){
    failed.push({ file: test, status: result.status });
  }
});

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('\nTest summary: ' + (tests.length - failed.length) + ' passed, ' + failed.length + ' failed (' + elapsed + 's)');

if(failed.length){
  console.error('Failed test files:');
  failed.forEach(function(item){
    console.error('- ' + item.file + ' (exit ' + (item.status === null ? 'unknown' : item.status) + ')');
  });
  process.exit(1);
}
