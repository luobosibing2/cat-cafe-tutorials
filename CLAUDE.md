# 代码开发标准

> 基于《第二课：从玩具到生产 - CLI 工程化》的代码开发规范
>
> **版本**: v1.0
> **更新日期**: 2026-02-20

---

## 📋 概述

本文档定义了项目中所有 CLI 子进程调用代码必须遵循的开发标准，确保代码达到生产级别的可靠性和稳定性。

**适用范围**：
- 所有使用 child_process/spawn 调用 CLI 工具的代码
- 涉及流式输出（stdout/stderr）处理的代码
- 需要长时间运行的子进程管理代码

**语言无关性**：
本标准基于通用的 CLI 调用原理，适用于 Node.js、Python、Go、Rust 等所有语言。

---

## ✅ 必须满足的标准

### 1. stderr 活跃信号

**标准**：
超时检测必须同时监听 stdout 和 stderr，将两个流都视为活跃信号。

**原因**：
CLI 工具在 thinking、工具调用、进度汇报时，通常输出到 stderr，不是 stdout。

**错误示例**：
```javascript
// ❌ 只监听 stdout - 会误判超时
child.stdout.on('data', () => { lastActivity = Date.now(); });
```

**正确示例**：
```javascript
// ✅ 同时监听 stdout 和 stderr
child.stdout.on('data', () => { lastActivity = Date.now(); });
child.stderr.on('data', () => { lastActivity = Date.now(); });
```

**验收标准**：
- [ ] 超时检测同时监听 stdout 和 stderr
- [ ] stderr 数据到达时也刷新超时计时器

---

### 2. 超时设置

**标准**：
超时时间必须可配置，并且能够适应不同复杂度的任务。

**默认值**：
- 简单聊天任务：2-5 分钟
- 中等任务：10 分钟
- 复杂任务（代码分析、长篇写作）：30 分钟

**错误示例**：
```javascript
// ❌ 硬编码超时时间
const TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟，无法调整
```

**正确示例**：
```javascript
// ✅ 通过环境变量配置
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 10 * 60 * 1000;
```

**验收标准**：
- [ ] 超时时间可以通过环境变量配置
- [ ] 有合理的默认值（建议 10 分钟）
- [ ] 文档中说明如何配置超时时间

**优雅关机**：
超时后必须先发送 SIGTERM，等待 5 秒后再发送 SIGKILL：

```javascript
child.kill('SIGTERM');
setTimeout(() => {
  if (child && !child.killed) {
    child.kill('SIGKILL');
  }
}, 5000);
```

---

### 3. 进程生命周期管理

**标准**：
必须正确处理进程启动、运行、退出的完整生命周期，防止僵尸进程。

**必须处理的信号**：
- `SIGTERM` - 终止信号
- `SIGINT` - 中断信号（Ctrl+C）
- `uncaughtException` - 未捕获异常
- `unhandledRejection` - 未处理的 Promise 拒绝

**正确示例**：
```javascript
function gracefulShutdown() {
  console.log('\n🛑 Shutting down...');
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (rl) rl.close();
  if (child && !child.killed) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
    }, 5000);
  }
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', gracefulShutdown);
process.on('unhandledRejection', gracefulShutdown);
```

**验收标准**：
- [ ] 处理 SIGTERM 信号
- [ ] 处理 SIGINT 信号
- [ ] 处理未捕获异常
- [ ] 处理未处理的 Promise 拒绝
- [ ] 两阶段关机（先 SIGTERM，后 SIGKILL）
- [ ] 清理所有资源（定时器、事件监听器、流等）

---

### 4. 流式解析容错

**标准**：
NDJSON 流式解析必须有容错机制，不能因为单行解析失败导致整个任务失败。

**正确示例**：
```javascript
rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);
    // ... 处理事件
  } catch (err) {
    // ✅ 忽略无法解析的行（可能是空行、不完整行）
    // console.error(`Failed to parse line: ${line}`);
  }
});
```

**验收标准**：
- [ ] 使用 readline 等工具逐行读取（自动处理换行符）
- [ ] JSON 解析有 try-catch 容错
- [ ] 不忽略 stderr 输出（可能包含重要信息）
- [ ] 处理粘包情况（readline 自动处理）

---

### 5. 环境隔离

**标准**：
开发和生产环境必须完全隔离，防止开发代码连接生产资源。

**隔离要求**：
1. 数据库隔离：开发用开发数据库，生产用生产数据库
2. Redis 隔离：开发用 6398，生产用 6399
3. 配置检查：开发环境连接生产资源时发出警告

**正确示例**：
```javascript
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_PORT = process.env.REDIS_PORT || (NODE_ENV === 'production' ? '6399' : '6398');

// 环境隔离检查
if (process.env.NODE_ENV === 'development') {
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
delete isolatedEnv['CLAUDECODE'];  // 移除可能干扰的变量
isolatedEnv.REDIS_PORT = REDIS_PORT;
isolatedEnv.NODE_ENV = NODE_ENV;

const child = spawn(command, args, {
  env: isolatedEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

**验收标准**：
- [ ] 开发环境和生产环境使用不同的数据库
- [ ] 开发环境连接生产资源时发出警告
- [ ] 环境变量配置清晰（有文档说明）
- [ ] Worktree 开发使用独立的开发数据库

**端口约定**：
- 生产 Redis：6399
- 开发 Redis：6398

---

### 6. 错误处理

**标准**：
必须有完善的错误处理机制，包括重试、日志和用户友好的错误信息。

**错误处理要求**：
1. **重试机制**：临时错误自动重试
2. **指数退避**：重试延迟逐渐增加（1s, 2s, 5s）
3. **错误日志**：输出足够的调试信息
4. **用户友好**：错误信息清晰，包含解决建议

**正确示例**：
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

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// spawn 错误处理
child.on('error', (err) => {
  console.error(`\n❌ Failed to spawn process:`);
  console.error(`   Error: ${err.message}`);
  console.error(`   Code: ${err.code}`);
  console.error(`\n💡 Troubleshooting tips:`);
  console.error(`   1. Make sure the CLI is installed`);
  console.error(`   2. Try running 'cli --version'`);
  console.error(`   3. Check if PATH is set correctly`);
  process.exit(1);
});
```

**验收标准**：
- [ ] 有重试机制（默认至少 3 次）
- [ ] 重试延迟使用指数退避
- [ ] spawn 错误有清晰的错误信息和解决建议
- [ ] 进程异常退出有适当的处理
- [ ] 错误信息包含足够调试信息

---

## 🧪 自检清单

任何新的 CLI 调用代码在合并前必须通过以下检查：

### 基础检查
- [ ] 同时监听 stdout 和 stderr
- [ ] 超时检测功能完善
- [ ] 超时时间可配置
- [ ] 有两阶段关机（SIGTERM + SIGKILL）

### 生命周期检查
- [ ] 处理 SIGTERM 信号
- [ ] 处理 SIGINT 信号
- [ ] 处理未捕获异常
- [ ] 处理未处理的 Promise 拒绝
- [ ] 清理所有资源（定时器、流等）

### 解析检查
- [ ] NDJSON 解析有容错
- [ ] 使用 readline 逐行读取
- [ ] 不忽略 stderr 输出

### 环境检查
- [ ] 开发/生产环境隔离
- [ ] 误连生产资源有警告
- [ ] 环境变量配置清晰

### 错误处理检查
- [ ] 有重试机制
- [ ] 重试使用指数退避
- [ ] 错误信息清晰友好
- [ ] 包含调试建议

---

## 📊 验收标准

| 检查项 | 状态 |
|--------|------|
| stderr 和 stdout 都被监听 | ✅ |
| 超时时间可配置且合理 | ✅ |
| 进程生命周期管理完善 | ✅ |
| NDJSON 解析有容错 | ✅ |
| 开发/生产环境隔离 | ✅ |
| 错误处理完善 | ✅ |

**代码只有全部通过以上检查才能合并到主分支。**

---

## 🚀 进阶优化（可选）

### 1. 心跳机制

不用固定超时，改用心跳机制：
- CLI 定期输出心跳信号
- 超过 N 秒没收到心跳才判定超时
- 这样复杂任务也不会被误杀

### 2. 动态超时

根据任务复杂度动态调整超时：
- 简单任务：短超时
- 复杂任务：长超时
- 可以基于输入长度、任务类型等判断

### 3. 监控和指标

收集执行指标：
- 平均执行时间
- 成功率
- 重试次数
- 资源使用情况

---

## 📚 参考资料

- **课程来源**: [第二课：从玩具到生产 - CLI 工程化](./docs/lessons/02-cli-engineering.md)
- **作业清单**: [第二课课后作业](./docs/lessons/02-homework.md)
- **检查报告**: [02-homework-report.md](./docs/lessons/02-homework-report.md)
- **修复实践**: [02-cli-engineering/](./02-cli-engineering/)

---

## 📝 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-02-20 | 1.0 | 基于第二课课后作业创建代码开发标准 |

---

*本标准由 cat-cafe-tutorials 项目维护，基于实际生产经验和最佳实践制定。*
