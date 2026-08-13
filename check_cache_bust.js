const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;
const indexPath = path.join(root, 'index.html');

function git(args){
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function localScriptVersions(source){
  const versions = new Map();
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi;
  let match;
  while((match = scriptPattern.exec(source))){
    const src = match[1];
    if(/^(?:https?:)?\/\//i.test(src)) continue;
    const parsed = /^([^?#]+\.js)\?v=(\d+)$/.exec(src);
    if(!parsed){
      throw new Error('本地脚本缺少数字 cache-bust 版本号: ' + src);
    }
    const file = parsed[1].replace(/\\/g, '/');
    if(versions.has(file)) throw new Error('index.html 重复引用脚本: ' + file);
    versions.set(file, Number(parsed[2]));
  }
  return versions;
}

function resolveComparison(){
  const explicitBase = process.env.CACHE_BUST_BASE || process.argv[2];
  if(explicitBase && !/^0+$/.test(explicitBase)){
    return { base: explicitBase, target: 'HEAD', label: explicitBase + '..HEAD' };
  }

  const worktreeChanges = git(['status', '--porcelain', '--untracked-files=all']);
  if(worktreeChanges){
    return { base: 'HEAD', target: null, label: 'HEAD..working tree' };
  }

  try{
    git(['rev-parse', '--verify', 'HEAD^']);
    return { base: 'HEAD^', target: 'HEAD', label: 'HEAD^..HEAD' };
  }catch(error){
    return null;
  }
}

function sourceAt(ref){
  if(!ref) return fs.readFileSync(indexPath, 'utf8');
  return git(['show', ref + ':index.html']);
}

function changedFiles(comparison){
  const args = ['diff', '--name-only', '--diff-filter=ACMR', comparison.base];
  if(comparison.target) args.push(comparison.target);
  return git(args).split(/\r?\n/).filter(Boolean).map(function(file){
    return file.replace(/\\/g, '/');
  });
}

try{
  const current = localScriptVersions(fs.readFileSync(indexPath, 'utf8'));
  const comparison = resolveComparison();
  if(!comparison){
    console.log('cache-bust check: no parent commit; syntax only (' + current.size + ' scripts)');
    process.exit(0);
  }

  const previous = localScriptVersions(sourceAt(comparison.base));
  const changed = new Set(changedFiles(comparison));
  const failures = [];

  current.forEach(function(version, file){
    if(!changed.has(file) || !previous.has(file)) return;
    const oldVersion = previous.get(file);
    if(version <= oldVersion){
      failures.push(file + ': v=' + oldVersion + ' → v=' + version);
    }
  });

  if(failures.length){
    console.error('cache-bust check failed (' + comparison.label + '):');
    failures.forEach(function(failure){ console.error('- ' + failure); });
    console.error('修改 index.html，把对应脚本的 ?v=N 递增后再提交。');
    process.exit(1);
  }

  console.log('cache-bust check passed: ' + comparison.label + ' (' + current.size + ' scripts)');
}catch(error){
  console.error('cache-bust check failed: ' + error.message);
  process.exit(1);
}
