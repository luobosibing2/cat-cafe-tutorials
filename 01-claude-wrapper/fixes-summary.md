# 代码修复总结

> 基于第二课课后作业检查清单，对 `minimal-claude.js` 进行了全面修复
>
> **修复日期**: 2026-02-20
> **修复版本**: v2.0

---

## 📊 修复概览

| 优先级 | 问题 | 状态 | 影响范围 |
|--------|------|------|----------|
| **P0** | 超时检测缺失 | ✅ 已修复 | 进程卡死风险 |
| **P0** | stderr 未监听 | ✅ 已修复 | 误判超时风险 |
| **P1** | 进程信号处理缺失 | ✅ 已修复 | 僵尸进程风险 |
| **P2** | 重试机制缺失 | ✅ 已修复 | 可靠性 |
| **P2** | 环境隔离缺失 | ✅ 已修复 | 误连生产环境 |

---

## 🔧 详细修复内容

### P0-1: 添加超时检测 + stderr 监听

**问题描述**:
代码没有超时检测机制，如果 CLI 进程卡死，程序会一直等待。而且即使添加超时检测，只监听 stdout 也会导致误判（CLI thinking 时输出到 stderr）。

**修复内容**:
```javascript
// 同时监听 stdout 和 stderr，刷新超时
claude.stdout.on('data', refreshTimeout);
claude.stderr.on('data', (data) => {
  process.stderr.write(`[stderr] ${data}`);
  refreshTimeout(); // stderr 也是活跃信号！
});

// 超时检测函数
function refreshTimeout() {
  lastActivity = Date.now();
  if (timeoutTimer) clearTimeout(timeoutTimer);

  timeoutTimer = setTimeout(() => {
    if (claude && !claude.killed && !isShuttingDown) {
      console.error(`\n⚠️  Process timeout after ${TIMEOUT_MS}ms`);
      gracefulShutdown();
    }
  }, TIMEOUT_MS);
}
```

**测试结果**:
✅ 超时后正确触发优雅关机
✅ stderr 输出能正确刷新超时

---

### P0-2: 配置化超时时间

**问题描述**:
超时时间硬编码，无法根据任务复杂度调整。

**修复内容**:
```javascript
// 从环境变量读取超时配置，默认 10 分钟
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 10 * 60 * 1000;
```

**使用方法**:
```bash
# 默认 10 分钟
node minimal-claude.js "简单任务"

# 自定义 30 秒
CLAUDE_TIMEOUT_MS=30000 node minimal-claude.js "测试任务"

# 复杂任务 30 分钟
CLAUDE_TIMEOUT_MS=1800000 node minimal-claude.js "代码分析"
```

**测试结果**:
✅ 默认值 600000ms (10分钟)
✅ 可通过环境变量 `CLAUDE_TIMEOUT_MS` 自定义

---

### P1: 添加进程信号处理 (SIGTERM/SIGINT)

**问题描述**:
只监听了 `close` 事件，没有处理 SIGTERM/SIGINT 信号，父进程退出时子进程可能变成僵尸进程。

**修复内容**:
```javascript
// 优雅关机函数（两阶段关机）
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

// 监听信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', gracefulShutdown);
process.on('unhandledRejection', gracefulShutdown);
```

**特性**:
- ✅ 两阶段关机（先 SIGTERM，5 秒后 SIGKILL）
- ✅ 防止重复关机（`isShuttingDown` 标志）
- ✅ 处理未捕获异常和未处理的 Promise 拒绝
- ✅ 清理超时定时器和 readline 接口

---

### P2: 添加重试机制

**问题描述**:
CLI 进程异常退出时直接退出程序，没有重试机会，可靠性差。

**修复内容**:
```javascript
// 重试配置
const MAX_RETRIES = parseInt(process.env.CLAUDE_MAX_RETRIES, 10) || 3;
const RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, 5s

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
```

**特性**:
- ✅ 默认重试 3 次
- ✅ 指数退避延迟（1s, 2s, 5s）
- ✅ 可通过 `CLAUDE_MAX_RETRIES` 环境变量配置
- ✅ 最大重试后重置 session
- ✅ 显示详细的重试信息

---

### P2: 添加环境隔离配置

**问题描述**:
没有环境隔离机制，可能误连生产环境导致数据污染。

**修复内容**:
```javascript
// 环境隔离配置
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_PORT = process.env.REDIS_PORT || (NODE_ENV === 'production' ? '6399' : '6398');

// 环境隔离检查
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

// 使用隔离的环境变量
const isolatedEnv = { ...process.env };
delete isolatedEnv['CLAUDECODE'];
isolatedEnv.REDIS_PORT = REDIS_PORT;
isolatedEnv.NODE_ENV = NODE_ENV;

const claude = spawn(shell, shellArgs, {
  env: isolatedEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

**特性**:
- ✅ 开发环境默认使用 Redis 6398，生产环境 6399
- ✅ 开发环境误连生产 Redis 时发出警告
- ✅ 检查 DATABASE_URL 是否包含 production
- ✅ 隔离的环境变量传递给子进程

**测试结果**:
```
⚠️  WARNING: Development environment connecting to production Redis (port 6399)
   Please use REDIS_PORT=6398 for development
```

---

## 📋 新增配置选项

### 环境变量

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `CLAUDE_TIMEOUT_MS` | `600000` (10分钟) | 超时时间（毫秒） |
| `CLAUDE_MAX_RETRIES` | `3` | 最大重试次数 |
| `NODE_ENV` | `development` | 环境标识 |
| `REDIS_PORT` | `6398` (开发) / `6399` (生产) | Redis 端口 |
| `DATABASE_URL` | - | 数据库连接 URL |

### 命令行参数

| 参数 | 说明 |
|------|------|
| `--mock` | 使用模拟模式，不调用真实 CLI |
| `--reset` | 重置 session，开始新对话 |

---

## 🧪 测试结果

### 测试 1: 基本功能（Mock 模式）

```bash
$ node minimal-claude.js --mock "测试修复后的代码"
```

**结果**: ✅ 成功执行，显示超时和重试配置

---

### 测试 2: Session 重置

```bash
$ node minimal-claude.js --reset --mock "开始新会话测试"
```

**结果**: ✅ Session 成功重置，开始新会话

---

### 测试 3: 自定义配置

```bash
$ CLAUDE_TIMEOUT_MS=30000 CLAUDE_MAX_RETRIES=5 node minimal-claude.js --mock "测试自定义配置"
```

**结果**: ✅ 配置生效（超时 30s，重试 5 次），超时后正确触发关机

---

### 测试 4: 环境隔离警告

```bash
$ NODE_ENV=development REDIS_PORT=6399 node minimal-claude.js --mock "测试环境隔离警告"
```

**结果**: ✅ 正确显示警告信息

---

## 📝 代码变更统计

| 指标 | 数值 |
|------|------|
| 新增代码行 | ~200 行 |
| 新增函数 | 5 个（`refreshTimeout`, `gracefulShutdown`, `executeWithRetry`, `executeSingle`） |
| 新增配置项 | 5 个环境变量 |
| 修复的问题 | 5 个 |

---

## 🎯 使用建议

### 开发环境

```bash
# 使用开发 Redis（6398）
REDIS_PORT=6398 node minimal-claude.js "开发任务"

# 或者设置 NODE_ENV 自动选择端口
NODE_ENV=development node minimal-claude.js "开发任务"
```

### 生产环境

```bash
# 使用生产 Redis（6399）
NODE_ENV=production node minimal-claude.js "生产任务"

# 或者显式指定
REDIS_PORT=6399 NODE_ENV=production node minimal-claude.js "生产任务"
```

### 测试环境

```bash
# 使用 mock 模式，无需安装 CLI
node minimal-claude.js --mock "测试功能"

# 快速失败（短超时）
CLAUDE_TIMEOUT_MS=5000 node minimal-claude.js "快速测试"

# 多次重试（不稳定网络）
CLAUDE_MAX_RETRIES=5 node minimal-claude.js "网络测试"
```

---

## 🚀 后续优化建议

虽然已经修复了所有 P0-P2 问题，但还有一些优化空间：

1. **心跳机制** - 用心跳替代固定超时，更适应复杂任务
2. **日志系统** - 添加结构化日志，便于调试和监控
3. **指标收集** - 收集执行时间、成功率等指标
4. **配置文件** - 支持 `.env` 文件配置，无需每次设置环境变量
5. **健康检查** - 定期检查 CLI 进程状态
6. **资源限制** - 限制内存、CPU 使用，防止资源耗尽

---

## 📚 相关文档

- **检查清单**: [02-homework-report.md](../docs/lessons/02-homework-report.md)
- **课程来源**: [第二课：从玩具到生产](../docs/lessons/02-cli-engineering.md)
- **作业清单**: [第二课课后作业](../docs/lessons/02-homework.md)

---

## 📝 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-02-20 | 1.0 | 初始版本（minimal 实现） |
| 2026-02-20 | 2.0 | 基于 P0-P2 检查清单进行全面修复 |

---

*本修复由 Claude Code 完成，基于 cat-cafe-tutorials 项目的第二课课后作业。*
