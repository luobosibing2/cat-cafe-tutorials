#!/usr/bin/env node

/**
 * 测试脚本：检查 claude 命令是否可用
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

console.log('🔍 Diagnosing claude CLI availability...\n');

// 1. 检查 PATH 环境变量
console.log('1. PATH environment variable:');
console.log(process.env.PATH ? process.env.PATH.split(path.delimiter).slice(0, 5).join(path.delimiter) + '...' : 'PATH not set');
console.log('');

// 2. 尝试使用 execSync 运行 claude --version
console.log('2. Testing claude --version with execSync:');
try {
  const version = execSync('claude --version', { encoding: 'utf8', timeout: 5000 });
  console.log(`✅ Success: ${version.trim()}`);
} catch (err) {
  console.log(`❌ Failed: ${err.message}`);
}
console.log('');

// 3. 尝试使用 spawn with shell: true
console.log('3. Testing claude --version with spawn (shell: true):');
try {
  const proc = spawn('claude --version', [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', (data) => { output += data.toString(); });
  proc.stderr.on('data', (data) => { output += data.toString(); });
  proc.on('close', (code) => {
    console.log(`✅ Exit code: ${code}`);
    console.log(`Output: ${output.trim()}`);
    console.log('');

    // 4. 尝试带参数的完整命令
    console.log('4. Testing full claude command with prompt:');
    const proc2 = spawn('claude -p "test" --output-format stream-json', [], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc2.stdout.on('data', (data) => {
      console.log('📦 Output:', data.toString().trim().slice(0, 100) + '...');
    });
    proc2.stderr.on('data', (data) => {
      console.log('📦 Error:', data.toString().trim());
    });
    proc2.on('error', (err) => {
      console.log('❌ Error:', err.message);
    });
    proc2.on('close', (code) => {
      console.log(`✅ Exit code: ${code}`);
    });
  });

  proc.on('error', (err) => {
    console.log(`❌ Error: ${err.message}`);
  });

} catch (err) {
  console.log(`❌ Failed: ${err.message}`);
}
