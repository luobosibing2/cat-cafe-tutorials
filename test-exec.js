#!/usr/bin/env node

/**
 * 使用 execSync 测试 claude 命令
 */

const { execSync } = require('child_process');

const prompt = process.argv[2] || '你好';
const fullCommand = `claude -p "${prompt}" --output-format stream-json --verbose`;

console.log(`🔧 Executing: ${fullCommand}\n`);

try {
  const output = execSync(fullCommand, { encoding: 'utf8', timeout: 60000 });

  // 解析 NDJSON 输出
  const lines = output.trim().split('\n');
  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            console.log(`  [Session started: ${event.session_id}]`);
          }
          break;

        case 'assistant':
          if (event.message && event.message.content) {
            for (const item of event.message.content) {
              if (item.type === 'text' && item.text) {
                process.stdout.write(item.text);
              }
            }
          }
          break;

        case 'result':
          if (event.subtype === 'success') {
            console.log('\n  [Done]');
          }
          break;
      }
    } catch (err) {
      // 忽略解析错误
    }
  }

  console.log('\n✅ Success!');
} catch (err) {
  console.error('❌ Error:', err.message);
  console.error('stderr:', err.stderr);
  process.exit(1);
}
