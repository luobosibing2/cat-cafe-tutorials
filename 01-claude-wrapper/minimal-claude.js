#!/usr/bin/env node

/**
 * Minimal Claude CLI invoker
 * 调用 Claude CLI 并解析 NDJSON 流式输出
 * 支持 Session 恢复
 */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Session 文件路径
const SESSION_FILE = path.join(__dirname, '.claude-session.json');

// 检查是否使用 mock 模式
const useMock = process.argv.includes('--mock');

// 从命令行参数获取 prompt（跳过 --mock 和 --reset 标志）
const args = process.argv.slice(2).filter(arg => arg !== '--mock' && arg !== '--reset');
const prompt = args.join(' ');

// 检查是否重置 session
const resetSession = process.argv.includes('--reset');

if (!prompt) {
  console.error('Usage: node minimal-claude.js [--mock] [--reset] "your prompt"');
  console.error('  --mock    使用模拟模式（不需要安装 claude CLI）');
  console.error('  --reset   重置 session，开始新对话');
  process.exit(1);
}

// 读取或重置 session
let sessionId = null;

if (resetSession) {
  // 删除 session 文件
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log('🔄 Session reset');
  }
} else if (fs.existsSync(SESSION_FILE)) {
  // 读取现有 session
  try {
    const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    sessionId = sessionData.sessionId;
    console.log(`📚 Resuming session: ${sessionId}`);
  } catch (err) {
    console.warn('⚠️  Failed to read session file, starting new session');
  }
}

console.log(`🤖 Calling Claude with: "${prompt}"`);

// 调试：显示 shell 类型
const isWindows = process.platform === 'win32';
console.log(`🔧 Platform: ${process.platform}, Shell: ${isWindows ? 'cmd.exe' : 'sh'}`);

// 构建 shell 命令字符串，正确转义参数
// 在 Windows 上使用 cmd.exe，需要用双引号包裹包含空格的参数
const escapeShellArg = (arg) => {
  // 在 Windows cmd 中，用双引号包裹参数，并转义内部的双引号
  return `"${arg.replace(/"/g, '\\"')}"`;
};

const claudeArgs = [];
claudeArgs.push('-p', escapeShellArg(prompt));
claudeArgs.push('--output-format', 'stream-json', '--verbose');

// 如果有 session ID，添加 --resume 参数
if (sessionId) {
  claudeArgs.push('--resume', escapeShellArg(sessionId));
}

// 打印实际执行的命令
const fullCommand = `claude ${claudeArgs.join(' ')}`;
console.log(`🔧 Executing: ${fullCommand}`);

// 使用 spawn 执行命令
// 在 Windows 上指定 cmd.exe 作为 shell
const shell = isWindows ? 'cmd.exe' : '/bin/sh';
const shellArgs = isWindows ? ['/c', fullCommand] : ['-c', fullCommand];

const claude = useMock ? createMockClaude(sessionId) : spawn(shell, shellArgs, {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});

// 监听 spawn 错误
claude.on('error', (err) => {
  console.error(`\n❌ Failed to spawn claude process:`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Code: ${err.code}`);
  console.error(`\n💡 Troubleshooting tips:`);
  console.error(`   1. Make sure claude CLI is installed: npm install -g @anthropic-ai/claude`);
  console.error(`   2. Try running 'claude --version' in your terminal`);
  console.error(`   3. Check if PATH is set correctly`);
  process.exit(1);
});

// 使用 readline 逐行读取 stdout
const rl = readline.createInterface({
  input: claude.stdout,
  crlfDelay: Infinity,
});

let responseText = '';
let currentSessionId = null;

// 监听每一行输出
rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);

    // 处理不同类型的事件
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          currentSessionId = event.session_id;
          console.log(`  [Session started: ${currentSessionId}]`);
        }
        break;

      case 'assistant':
        // 提取文本内容
        if (event.message && event.message.content) {
          for (const item of event.message.content) {
            if (item.type === 'text' && item.text) {
              process.stdout.write(item.text);
              responseText += item.text;
            }
          }
        }
        break;

      case 'result':
        if (event.subtype === 'success') {
          console.log('\n  [Done]');

          // 保存 session ID 到文件
          if (currentSessionId || event.session_id) {
            const sid = currentSessionId || event.session_id;
            try {
              fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: sid }, null, 2));
              console.log(`  [Session saved: ${sid}]`);
            } catch (err) {
              console.error('  [Failed to save session]');
            }
          }
        } else if (event.subtype === 'error') {
          console.error(`\n  [Error: ${event.error?.message || 'Unknown error'}]`);
        }
        break;
    }
  } catch (err) {
    // 忽略无法解析的行（可能是空行或其他输出）
    // console.error(`Failed to parse line: ${line}`);
  }
});

// 监听 stderr（错误信息）
claude.stderr.on('data', (data) => {
  process.stderr.write(`[stderr] ${data}`);
});

// 监听进程退出
claude.on('close', (code) => {
  if (code !== 0 && !useMock) {
    console.error(`Claude CLI exited with code ${code}`);
    process.exit(code);
  }
  rl.close();
});

/**
 * 创建模拟的 Claude CLI 子进程
 * 用于演示和测试，不需要安装真实的 claude CLI
 */
function createMockClaude(resumeSessionId) {
  const sessionId = resumeSessionId || 'mock-session-' + Date.now();

  const mockEvents = [
    { type: 'system', subtype: 'init', session_id: sessionId, cwd: '/mock/project' },
    { type: 'assistant', message: { content: [{ type: 'text', text: `你好！我是 Claude，当前 session ID 是 ${sessionId}。` }] } },
    { type: 'result', subtype: 'success', session_id: sessionId }
  ];

  const { PassThrough } = require('stream');
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let index = 0;

  // 模拟流式输出
  const interval = setInterval(() => {
    if (index < mockEvents.length) {
      stdout.write(JSON.stringify(mockEvents[index]) + '\n');
      index++;
    } else {
      clearInterval(interval);
      stdout.end();
    }
  }, 100);

  return {
    stdout,
    stderr,
    on: (event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 500);
      }
    }
  };
}
