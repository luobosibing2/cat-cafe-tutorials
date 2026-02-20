#!/usr/bin/env node

/**
 * Minimal Claude CLI invoker
 * 调用 Claude CLI 并解析 NDJSON 流式输出
 * 支持 Session 恢复
 *
 * 修复内容（基于第二课课后作业检查清单）:
 * ✅ P0: 添加超时检测 + stderr 监听
 * ✅ P0: 配置化超时时间
 * ✅ P1: 添加进程信号处理 (SIGTERM/SIGINT)
 * ✅ P2: 添加重试机制
 * ✅ P2: 添加环境隔离配置
 */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

// Session 文件路径
const SESSION_FILE = path.join(__dirname, '.claude-session.json');

// 超时配置（从环境变量读取，默认 10 分钟）
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 10 * 60 * 1000;

// 重试配置
const MAX_RETRIES = parseInt(process.env.CLAUDE_MAX_RETRIES, 10) || 3;
const RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s

// 环境隔离配置
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_PORT = process.env.REDIS_PORT || (NODE_ENV === 'production' ? '6399' : '6398');

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
  console.error('');
  console.error('环境变量:');
  console.error('  CLAUDE_TIMEOUT_MS    超时时间（毫秒），默认 600000（10分钟）');
  console.error('  CLAUDE_MAX_RETRIES   最大重试次数，默认 3');
  console.error('  NODE_ENV             环境标识，默认 development');
  console.error('  REDIS_PORT           Redis 端口，开发环境默认 6398，生产环境 6399');
  process.exit(1);
}

// ==================== 环境隔离检查 ====================

if (process.env.NODE_ENV === 'development') {
  // 检查是否误连生产资源
  if (REDIS_PORT === '6399') {
    console.warn('⚠️  WARNING: Development environment connecting to production Redis (port 6399)');
    console.warn('   Please use REDIS_PORT=6398 for development');
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('production')) {
    console.warn('⚠️  WARNING: Development environment connecting to production database');
    console.warn('   DATABASE_URL should point to dev instance');
  }
}

// ==================== Session 管理 ====================

let sessionId = null;

function resetSessionFile() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log('🔄 Session reset');
  }
}

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      sessionId = sessionData.sessionId;
      console.log(`📚 Resuming session: ${sessionId}`);
      return true;
    } catch (err) {
      console.warn('⚠️  Failed to read session file, starting new session');
    }
  }
  return false;
}

function saveSession(sid) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: sid }, null, 2));
    console.log(`  [Session saved: ${sid}]`);
  } catch (err) {
    console.error('  [Failed to save session]');
  }
}

if (resetSession) {
  resetSessionFile();
} else {
  loadSession();
}

console.log(`🤖 Calling Claude with: "${prompt}"`);

// ==================== 命令构建 ====================

// 调试：显示 shell 类型
const isWindows = process.platform === 'win32';
console.log(`🔧 Platform: ${process.platform}, Shell: ${isWindows ? 'cmd.exe' : 'sh'}`);
console.log(`🔧 Timeout: ${TIMEOUT_MS}ms (${TIMEOUT_MS / 1000}s)`);
console.log(`🔧 Max retries: ${MAX_RETRIES}`);

// 构建 shell 命令字符串，正确转义参数
const escapeShellArg = (arg) => {
  return `"${arg.replace(/"/g, '\\"')}"`;
};

function buildClaudeCommand(sid) {
  const claudeArgs = [];
  claudeArgs.push('-p', escapeShellArg(prompt));
  claudeArgs.push('--output-format', 'stream-json', '--verbose');

  if (sid) {
    claudeArgs.push('--resume', sid);
  }

  return `claude ${claudeArgs.join(' ')}`;
}

// ==================== 进程管理 ====================

let claude = null;
let rl = null;
let timeoutTimer = null;
let lastActivity = Date.now();
let isShuttingDown = false;

// 超时检测（P0 修复：同时监听 stdout 和 stderr）
function refreshTimeout() {
  lastActivity = Date.now();
  if (timeoutTimer) clearTimeout(timeoutTimer);

  timeoutTimer = setTimeout(() => {
    if (claude && !claude.killed && !isShuttingDown) {
      console.error(`\n⚠️  Process timeout after ${TIMEOUT_MS}ms (last activity: ${Date.now() - lastActivity}ms ago)`);
      gracefulShutdown();
    }
  }, TIMEOUT_MS);
}

// 优雅关机（P1 修复：两阶段关机）
function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n🛑 Shutting down...');

  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
  }

  if (rl) {
    rl.close();
  }

  if (claude && !claude.killed) {
    console.log('📤 Sending SIGTERM to child process...');
    claude.kill('SIGTERM');

    // 等待 5 秒后强制关闭
    setTimeout(() => {
      if (claude && !claude.killed) {
        console.log('💥 Force killing child process...');
        claude.kill('SIGKILL');
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

// 监听信号（P1 修复）
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// 监听未捕获异常
process.on('uncaughtException', (err) => {
  console.error('\n❌ Uncaught Exception:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// ==================== 主执行函数（P2 修复：重试机制） ====================

async function executeWithRetry() {
  let retryCount = 0;

  while (retryCount <= MAX_RETRIES) {
    try {
      await executeSingle();
      return; // 成功则返回
    } catch (err) {
      if (retryCount >= MAX_RETRIES) {
        console.error(`\n❌ Max retries (${MAX_RETRIES}) exceeded`);
        throw err;
      }

      retryCount++;
      const delay = RETRY_DELAYS[Math.min(retryCount - 1, RETRY_DELAYS.length - 1)];
      console.log(`\n🔄 Retrying (${retryCount}/${MAX_RETRIES}) in ${delay}ms...`);
      console.log(`   Error: ${err.message}`);

      // 重置 session
      if (retryCount >= MAX_RETRIES) {
        resetSessionFile();
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function executeSingle() {
  return new Promise((resolve, reject) => {
    // 调试：显示 shell 类型
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', buildClaudeCommand(sessionId)] : ['-c', buildClaudeCommand(sessionId)];

    console.log(`🔧 Executing: ${buildClaudeCommand(sessionId)}`);

    // 创建隔离的环境变量（P2 修复）
    const isolatedEnv = { ...process.env };
    delete isolatedEnv['CLAUDECODE'];
    isolatedEnv.REDIS_PORT = REDIS_PORT;
    isolatedEnv.NODE_ENV = NODE_ENV;

    claude = useMock ? createMockClaude(sessionId) : spawn(shell, shellArgs, {
      env: isolatedEnv,
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
      reject(new Error(`Spawn failed: ${err.message}`));
    });

    // 使用 readline 逐行读取 stdout
    rl = readline.createInterface({
      input: claude.stdout,
      crlfDelay: Infinity,
    });

    let responseText = '';
    let currentSessionId = null;

    // P0 修复：stdout 数据到达时刷新超时
    claude.stdout.on('data', refreshTimeout);

    // P0 修复：stderr 数据到达时也刷新超时（关键！）
    claude.stderr.on('data', (data) => {
      process.stderr.write(`[stderr] ${data}`);
      refreshTimeout(); // stderr 也是活跃信号！
    });

    // 初始化超时
    refreshTimeout();

    // 监听每一行输出
    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);

        // 处理不同类型的事件
        switch (event.type) {
          case 'system':
            if (event.subtype === 'init') {
              currentSessionId = event.session_id;
              sessionId = currentSessionId;
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
                saveSession(sid);
              }

              // 清除超时定时器
              if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
              }

              resolve(); // 成功完成
            } else if (event.subtype === 'error') {
              console.error(`\n  [Error: ${event.error?.message || 'Unknown error'}]`);
              if (event.errors && event.errors.length > 0) {
                console.error(`  [Details: ${event.errors.join(', ')}]`);
              }
              reject(new Error(`CLI error: ${event.error?.message || 'Unknown error'}`));
            }
            break;
        }
      } catch (err) {
        // 忽略无法解析的行（可能是空行或其他输出）
        // console.error(`Failed to parse line: ${line}`);
      }
    });

    // 监听进程退出
    claude.on('close', (code) => {
      // 清除超时定时器
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      if (code !== 0 && !useMock && !isShuttingDown) {
        reject(new Error(`Claude CLI exited with code ${code}`));
      } else if (!isShuttingDown) {
        resolve();
      }
    });
  });
}

// ==================== 执行 ====================

(async () => {
  try {
    await executeWithRetry();
    console.log('\n✅ Execution completed successfully');
  } catch (err) {
    console.error(`\n❌ Execution failed: ${err.message}`);
    if (!isShuttingDown) {
      process.exit(1);
    }
  }
})();

// ==================== Mock Claude ====================

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
    killed: false,
    kill: (_signal) => {
      clearInterval(interval);
      stdout.end();
      stderr.end();
      return true;
    },
    on: (event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 500);
      } else if (event === 'data') {
        stderr.on('data', callback);
      }
    }
  };
}
