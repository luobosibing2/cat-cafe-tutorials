# 关键教训总结

> CLI 工程化实战中的核心教训

---

## 📌 P0 级别教训（必须修复）

### 教训 1: stderr 也是活跃信号

**问题**:
CLI 在 thinking 和工具调用时输出到 stderr，不是 stdout。只监听 stdout 会误判超时。

**代码示例**:
```javascript
// ❌ 错误
child.stdout.on('data', refreshTimeout);

// ✅ 正确
child.stdout.on('data', refreshTimeout);
child.stderr.on('data', refreshTimeout);
```

**影响**:
- 进程在认真工作时被判定为"卡死"
- 可能被强制 kill，导致数据丢失
- 这就是第二课中缅因猫被暴力 kill 的原因

---

### 教训 2: 超时定时器必须清除

**问题**:
Promise resolve 后，超时定时器仍然运行，导致任务完成后才触发超时关机。

**代码示例**:
```javascript
// ❌ 错误：resolve 后定时器仍在运行
case 'result':
  if (event.subtype === 'success') {
    resolve();
  }

// ✅ 正确：resolve 前清除定时器
case 'result':
  if (event.subtype === 'success') {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    resolve();
  }
```

**影响**:
- 任务已成功完成，但仍触发超时关机
- 可能导致不必要的错误日志
- 资源浪费（定时器继续运行）

---

### 教训 3: 超时时间必须可配置

**问题**:
硬编码超时时间，无法适应不同任务复杂度。

**代码示例**:
```javascript
// ❌ 错误：硬编码
const TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

// ✅ 正确：可配置
const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 10 * 60 * 1000;
```

**影响**:
- 简单任务浪费资源（超时太长）
- 复杂任务被误杀（超时太短）
- 不同场景需要修改代码

---

## 📌 P1 级别教训（应该修复）

### 教训 4: 两阶段优雅关机

**问题**:
直接 SIGKILL 进程，没有给清理资源的机会。

**代码示例**:
```javascript
// ❌ 错误：直接 kill
child.kill('SIGKILL');

// ✅ 正确：两阶段关机
child.kill('SIGTERM');
setTimeout(() => {
  if (child && !child.killed) {
    child.kill('SIGKILL');
  }
}, 5000);
```

**影响**:
- 进程无法保存状态
- 可能导致数据不一致
- 资源泄漏（文件句柄、网络连接等）

---

### 教训 5: 处理所有退出信号

**问题**:
只处理部分信号，异常情况可能导致僵尸进程。

**代码示例**:
```javascript
// ❌ 错误：只处理部分信号
process.on('SIGINT', cleanup);

// ✅ 正确：处理所有退出情况
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', cleanup);
process.on('unhandledRejection', cleanup);
```

**影响**:
- 未捕获异常导致进程异常退出
- 子进程变成僵尸进程
- 资源泄漏

---

## 📌 P2 级别教训（建议修复）

### 教训 6: 重试机制提高可靠性

**问题**:
一次失败就退出，网络波动或临时错误导致无法恢复。

**代码示例**:
```javascript
// ❌ 错误：一次失败就退出
try {
  await execute();
} catch (err) {
  throw err;  // 直接退出
}

// ✅ 正确：重试机制
for (let i = 0; i < MAX_RETRIES; i++) {
  try {
    await execute();
    return;
  } catch (err) {
    if (i >= MAX_RETRIES - 1) throw err;
    await sleep(1000 * (i + 1));  // 指数退避
  }
}
```

**影响**:
- 临时错误导致任务失败
- 可靠性差
- 用户体验差

---

### 教训 7: 环境隔离防止误连生产

**问题**:
开发代码连接生产环境，导致数据污染或误删生产数据。

**代码示例**:
```javascript
// ❌ 错误：没有环境隔离
const env = { ...process.env };

// ✅ 正确：环境隔离 + 检测
const NODE_ENV = process.env.NODE_ENV || 'development';
const REDIS_PORT = process.env.REDIS_PORT || (NODE_ENV === 'production' ? '6399' : '6398');

if (NODE_ENV === 'development' && REDIS_PORT === '6399') {
  console.warn('⚠️ WARNING: 误连生产 Redis');
}

const env = { ...process.env, REDIS_PORT, NODE_ENV };
```

**影响**:
- 误删生产数据（第二课 Act 4 案例）
- 数据污染
- 生产事故

---

## 📌 实践教训

### 教训 8: Session 管理

**问题**:
Mock 模式生成的 session ID 不能用于真实 CLI。

**教训**:
- Mock 模式生成的 session ID 是假的
- Session 有时效性，过期后需要重新开始
- 测试 session 功能时，确保是同一个 CLI 实例

**操作**:
```bash
# 正确的测试流程
node minimal-claude.js --reset "开始新对话"  # 第一次
node minimal-claude.js "记得我吗？"          # 第二次，会记住

# 错误的测试流程
node minimal-claude.js --mock "测试"        # mock session
node minimal-claude.js "记得我吗？"          # 用 mock session 去恢复真实 CLI，不记得
```

---

### 教训 9: NDJSON 解析容错

**问题**:
解析失败直接崩溃，导致整个任务失败。

**代码示例**:
```javascript
// ❌ 错误：解析失败崩溃
rl.on('line', (line) => {
  const event = JSON.parse(line);
  // ... 处理事件
});

// ✅ 正确：解析容错
rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);
    // ... 处理事件
  } catch (err) {
    // 忽略无法解析的行（可能是空行、不完整行）
  }
});
```

**影响**:
- 单行解析失败导致整个任务失败
- 鲁棒性差
- 调试困难

---

### 教训 10: 进程生命周期管理

**问题**:
进程退出时没有清理资源，导致资源泄漏。

**代码示例**:
```javascript
// ❌ 错误：没有清理
process.on('exit', () => {
  // 直接退出，没有清理
});

// ✅ 正确：先清理再退出
function cleanup() {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (rl) rl.close();
  if (child) child.kill();
}

process.on('exit', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
```

**影响**:
- 资源泄漏
- 端口占用
- 文件句柄泄漏

---

## 📊 总结

| 级别 | 数量 | 关键点 |
|------|------|--------|
| P0 | 3 | stderr 监听、超时清除、配置化 |
| P1 | 2 | 优雅关机、信号处理 |
| P2 | 2 | 重试机制、环境隔离 |
| 实践 | 5 | Session、NDJSON 容错、生命周期等 |

**核心原则**:
1. **防御性编程**：假设所有可能出错的地方都会出错
2. **资源清理**：每个退出路径都要清理资源
3. **可配置性**：让用户能根据场景调整参数
4. **环境隔离**：开发/生产必须分开
5. **可观测性**：足够的日志和警告信息

---

*这些教训基于 cat-cafe-tutorials 第二课的实战经验总结。*
