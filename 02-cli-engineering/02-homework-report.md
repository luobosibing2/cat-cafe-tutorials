# CLI 调用代码自检总结报告

> 基于《第二课：从玩具到生产 — CLI 工程化》检查清单的代码审查结果
>
> **检查对象**: `minimal-claude.js` (Claude CLI Node.js 封装)
> **检查日期**: 2026-02-20
> **检查人**: Claude Code

---

## 📊 检查概览

| 检查项 | 状态 | 优先级 |
|--------|------|--------|
| stderr 和 stdout 都被监听 | ❌ 有潜在 bug | P0 |
| 超时时间可配置且合理 | ❌ 完全缺失 | P0 |
| 进程生命周期管理完善 | ⚠️ 部分实现 | P1 |
| NDJSON 解析有容错 | ✅ 实现正确 | - |
| 开发/生产环境隔离 | ❌ 缺失 | P2 |
| 错误处理完善 | ⚠️ 基本实现 | P2 |

---

## ❌ 问题详情

### 1. stderr 活跃信号 - P0 严重问题

**问题描述**:
代码只监听 stdout 用于 NDJSON 解析，stderr 只是直接透传输出，未参与超时检测。

**当前代码位置**: `minimal-claude.js:108-173`

```javascript
// 只监听 stdout
const rl = readline.createInterface({
  input: claude.stdout,  // ❌ 只监听 stdout
  crlfDelay: Infinity,
});

// stderr 只透传，不参与超时检测
claude.stderr.on('data', (data) => {
  process.stderr.write(`[stderr] ${data}`);  // ❌ 未用于超时检测
});
```

**风险**:
- CLI 在 thinking/工具调用时输出到 stderr
- 如果添加超时检测但只监听 stdout，会导致误判超时
- 可能像缅因猫一样被暴力 kill（第二课 Act 3 案例）

**修复建议**:
```javascript
const TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

let lastActivity = Date.now();
let timeoutTimer = null;

const refreshTimeout = () => {
  lastActivity = Date.now();
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    console.error(`⚠️  Process timeout after ${TIMEOUT_MS}ms`);
    // 优雅关机
    if (claude && !claude.killed) {
      claude.kill('SIGTERM');
      setTimeout(() => {
        if (claude && !claude.killed) {
          claude.kill('SIGKILL');
        }
      }, 5000);
    }
  }, TIMEOUT_MS);
};

// ✅ 同时监听两个流
claude.stdout.on('data', refreshTimeout);
claude.stderr.on('data', refreshTimeout);  // ✅ 不要忘了这个！

refreshTimeout(); // 初始化超时
```

---

### 2. 超时设置 - P0 缺失功能

**问题描述**:
代码中没有任何超时检测机制。如果 CLI 进程卡死，程序会一直等待。

**影响**:
- 简单测试场景影响不大
- 生产环境中可能导致进程挂起、资源泄漏
- 无限等待导致用户体验差

**当前状态**: 完全没有超时检测

**修复建议**:
见上文 "stderr 活跃信号" 中的修复代码，超时时间建议：
- 简单任务: 2-5 分钟
- 中等任务: 10 分钟
- 复杂任务: 30 分钟
- 最佳实践: 根据任务复杂度动态调整，或配置化

**配置化示例**:
```javascript
// 从环境变量读取超时配置
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 10 * 60 * 1000;
```

---

### 3. 进程生命周期管理 - P1 不完整

**问题描述**:
- 只监听了 `close` 事件
- 没有处理 SIGTERM/SIGINT 信号
- 父进程退出时，子进程可能不会被正确清理

**当前代码**: `minimal-claude.js:176-182`

```javascript
claude.on('close', (code) => {
  if (code !== 0 && !useMock) {
    console.error(`Claude CLI exited with code ${code}`);
    process.exit(code);
  }
  rl.close();
});
```

**风险**:
- 父进程被 Ctrl+C 终止时，子进程可能变成僵尸进程
- 资源无法释放，端口可能被占用

**修复建议**:
```javascript
// 优雅关机函数
const shutdown = () => {
  console.log('\n🛑 Shutting down...');
  if (claude && !claude.killed) {
    console.log('📤 Sending SIGTERM to child process...');
    claude.kill('SIGTERM');
    rl.close();

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
};

// 监听信号
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 监听未捕获异常
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});
```

---

### 4. 错误处理 - P2 不完整

**问题描述**:
- 有基本的 spawn 错误处理
- 有 JSON 解析的容错
- **但没有重试机制**

**当前代码**:

```javascript
// basic error handling
claude.on('error', (err) => {
  console.error(`\n❌ Failed to spawn claude process:`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Code: ${err.code}`);
  process.exit(1);  // ❌ 直接退出，没有重试
});

// JSON parse error handling
rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);
    // ... 处理事件
  } catch (err) {
    // ✅ 有容错，忽略无法解析的行
    // console.error(`Failed to parse line: ${line}`);
  }
});
```

**修复建议**:
```javascript
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s

const executeWithRetry = async () => {
  try {
    // ... 执行 CLI 调用逻辑
    await new Promise((resolve, reject) => {
      claude.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI exited with code ${code}`));
        }
      });
    });
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      const delay = RETRY_DELAYS[retryCount - 1] || 5000;
      console.log(`🔄 Retrying (${retryCount}/${MAX_RETRIES}) in ${delay}ms...`);
      console.log(`   Error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return executeWithRetry();
    }
    console.error(`❌ Max retries (${MAX_RETRIES}) exceeded`);
    throw err;
  }
};
```

---

### 5. 环境隔离 - P2 缺失

**问题描述**:
- 代码本身不涉及数据库连接
- 但作为最佳实践，应该支持通过环境变量配置不同的实例
- 当前代码移除了 `CLAUDECODE` 环境变量，但没有其他环境隔离机制

**当前代码**: `minimal-claude.js:86-88`

```javascript
const envWithoutClaudeCode = { ...process.env };
delete envWithoutClaudeCode['CLAUDECODE'];
```

**风险**:
- 如果后续添加数据库连接，可能误连生产环境
- 开发/生产配置混用导致数据污染（第二课 Act 4 案例）

**修复建议**:

```javascript
// 环境配置
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_PORT = process.env.REDIS_PORT || (NODE_ENV === 'production' ? '6399' : '6398');
const DB_URL = process.env.DATABASE_URL;

// 环境隔离检查
if (process.env.NODE_ENV === 'development') {
  // 检查是否误连生产资源
  if (REDIS_PORT === '6399') {
    console.warn('⚠️  WARNING: Development environment connecting to production Redis (port 6399)');
    console.warn('   Please use REDIS_PORT=6398 for development');
  }

  if (DB_URL && DB_URL.includes('production')) {
    console.warn('⚠️  WARNING: Development environment connecting to production database');
    console.warn('   DATABASE_URL should point to dev instance');
  }
}

// 使用隔离的环境变量
const isolatedEnv = { ...process.env };
delete isolatedEnv['CLAUDECODE'];
isolatedEnv.REDIS_PORT = REDIS_PORT;  // 使用隔离的端口
isolatedEnv.NODE_ENV = NODE_ENV;

const claude = spawn(shell, shellArgs, {
  env: isolatedEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

**环境变量配置示例** (`.env.local`):
```bash
# 开发环境
NODE_ENV=development
REDIS_URL=redis://localhost:6398
REDIS_PORT=6398
DATABASE_URL=postgresql://localhost:5432/cat_cafe_dev

# 生产环境
NODE_ENV=production
REDIS_URL=redis://production-redis:6399
REDIS_PORT=6399
DATABASE_URL=postgresql://production-db:5432/cat_cafe_prod
```

---

## ✅ 通过的检查项

### NDJSON 解析 - 实现正确

**代码位置**: `minimal-claude.js:108-168`

```javascript
const rl = readline.createInterface({
  input: claude.stdout,
  crlfDelay: Infinity,  // ✅ 正确处理不同平台的换行符
});

rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);
    // ... 处理事件
  } catch (err) {
    // ✅ 有容错，忽略无法解析的行
  }
});
```

**优点**:
- 使用 `readline` 逐行读取，自动处理换行符
- `crlfDelay: Infinity` 防止过早结束行读取（解决跨平台换行符问题）
- 有 try-catch 容错，不会因为单行解析失败导致整个程序崩溃

---

## 📋 完整修复建议优先级

### P0 - 必须立即修复

| 问题 | 影响 | 修复难度 |
|------|------|----------|
| 添加超时检测 + stderr 监听 | 防止进程卡死、误杀 | 中 |
| 配置化超时时间 | 适应不同任务复杂度 | 低 |

### P1 - 应该尽快修复

| 问题 | 影响 | 修复难度 |
|------|------|----------|
| 添加进程信号处理 (SIGTERM/SIGINT) | 防止僵尸进程、资源泄漏 | 中 |

### P2 - 建议修复

| 问题 | 影响 | 修复难度 |
|------|------|----------|
| 添加重试机制 | 提高可靠性、容错能力 | 低 |
| 添加环境隔离配置 | 防止误连生产环境、数据污染 | 低 |

---

## 🛠️ 最佳实践清单

在后续开发中，确保每个 CLI 调用都包含以下特性：

```javascript
// ✅ 最佳实践模板
async function invokeCliSafe(prompt, options = {}) {
  const {
    timeout = 10 * 60 * 1000,  // 默认 10 分钟
    maxRetries = 3,
    env = {}
  } = options;

  // 1. ✅ 超时检测（同时监听 stdout 和 stderr）
  let lastActivity = Date.now();
  let timeoutTimer = null;

  const refreshTimeout = () => {
    lastActivity = Date.now();
    clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => gracefulShutdown(), timeout);
  };

  // 2. ✅ 优雅关机（两阶段）
  const gracefulShutdown = () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
      }, 5000);
    }
  };

  // 3. ✅ 信号处理
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // 4. ✅ 重试机制
  for (let i = 0; i < maxRetries; i++) {
    try {
      // ... 执行逻辑
      break;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }

  // 5. ✅ 环境隔离
  const isolatedEnv = { ...process.env, ...env };
  if (process.env.NODE_ENV === 'development') {
    // 防止误连生产环境
  }
}
```

---

## 📚 参考资料

- **课程来源**: [第二课：从玩具到生产 — CLI 工程化](./02-cli-engineering.md)
- **作业清单**: [第二课课后作业](./02-homework.md)
- **相关代码**: [01-claude-wrapper/minimal-claude.js](../../01-claude-wrapper/minimal-claude.js)

---

## 📝 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-02-20 | 1.0 | 初始版本，基于第二课检查清单进行代码审查 |

---

*本报告由 Claude Code 生成，基于 cat-cafe-tutorials 项目的真实代码审查。*
