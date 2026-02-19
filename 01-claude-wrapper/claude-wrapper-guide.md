# Claude CLI Node.js 封装指南

## 概述

本指南记录了如何在 Node.js 中封装 Claude CLI 进行调用，以及开发过程中遇到的问题和解决方案。

## 文件说明

- `minimal-claude.js` - Claude CLI 的 Node.js 封装脚本
- `.claude-session.json` - Session 持久化存储文件（自动生成）
- `claude-wrapper-guide.md` - 本文档

## 功能特性

- ✅ 调用 Claude CLI 并解析 NDJSON 流式输出
- ✅ 支持 Session 持久化和恢复
- ✅ Mock 模式（用于测试，无需安装 Claude CLI）
- ✅ 跨平台支持（Windows 和 Unix-like 系统）

## 使用方法

### 基本用法

```bash
# 开始新对话
node minimal-claude.js --reset "你好"

# 继续之前的对话
node minimal-claude.js "讲个笑话"

# 使用 mock 模式（无需安装 Claude CLI）
node minimal-claude.js --mock "测试"
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--mock` | 使用模拟模式，不调用真实 CLI |
| `--reset` | 重置 session，开始新对话 |
| `"prompt"` | 要发送给 Claude 的提示词 |

## 开发过程与坑点记录

### 问题 1: 弃用警告 DEP0190

**现象：**
```javascript
const claude = spawn('claude', args, { shell: true });
```

运行时出现警告：
```
(node:63996) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
```

**原因：**
使用 `shell: true` 时传递参数数组，Node.js 不会转义参数，存在命令注入安全风险。

**解决思路：**
需要正确转义参数，或者避免使用 `shell: true`。

---

### 问题 2: ENOENT 错误

**现象：**
```javascript
const claude = spawn('claude', args);  // 不使用 shell: true
```

运行时报错：
```
Error: spawn claude ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:286:19)
    errno: -4058,
    code: 'ENOENT'
```

**原因：**
在 Windows 上，`claude` CLI 是通过 npm 全局安装的，其可执行文件通常通过 shell 才能被找到。不使用 shell 时，Node.js 无法在 PATH 中定位到命令。

---

### 问题 3: 嵌套会话检测

**现象：**
在 Claude Code 内部终端运行时：
```
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

**原因：**
Claude CLI 检测到 `CLAUDECODE` 环境变量，拒绝在嵌套会话中运行。

**解决：**
需要在 VSCode 外部的独立终端中测试。

---

## 最终解决方案

### 核心代码

```javascript
// 1. 正确转义参数（Windows cmd 语法）
const escapeShellArg = (arg) => {
  return `"${arg.replace(/"/g, '\\"')}"`;
};

// 2. 构建完整命令字符串
const claudeArgs = [];
claudeArgs.push('-p', escapeShellArg(prompt));
claudeArgs.push('--output-format', 'stream-json', '--verbose');

const fullCommand = `claude ${claudeArgs.join(' ')}`;

// 3. 明确指定 shell 执行
const isWindows = process.platform === 'win32';
const shell = isWindows ? 'cmd.exe' : '/bin/sh';
const shellArgs = isWindows ? ['/c', fullCommand] : ['-c', fullCommand];

// 4. 继承环境变量，确保 PATH 正确
const claude = spawn(shell, shellArgs, {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

### 关键点解析

| 要点 | 说明 |
|------|------|
| **参数转义** | 用双引号包裹含空格的参数，内部双引号用 `\"` 转义 |
| **构建字符串** | 将所有参数拼接成单个命令字符串 |
| **明确 shell** | 使用 `cmd.exe /c` 而非 `shell: true` 选项 |
| **继承环境** | 传递 `env: process.env` 确保 PATH 可用 |

## 方法对比

| 方法 | 代码 | 结果 | 问题 |
|------|------|------|------|
| 方法 1 | `spawn('claude', args, { shell: true })` | ⚠️ 弃用警告 | 参数数组 + shell: true 不安全 |
| 方法 2 | `spawn('claude', args)` | ❌ ENOENT | Windows 上找不到命令 |
| 方法 3 | `spawn(fullCommand, [], { shell: true })` | ⚠️ 仍有警告 | 传递字符串仍用 shell: true |
| **方法 4** | `spawn('cmd.exe', ['/c', fullCommand])` | ✅ 正常 | 明确调用 shell，命令正确转义 |

## Windows + Node.js 子进程最佳实践

### 调用系统命令

```javascript
// ✅ 推荐：明确指定 shell
spawn('cmd.exe', ['/c', 'dir'], { shell: false });

// ✅ 推荐：使用 execSync（简单场景）
execSync('dir', { encoding: 'utf8' });

// ⚠️ 警告：shell: true + 参数数组
spawn('dir', ['C:\\'], { shell: true });  // 不安全
```

### 调用 npm 全局包

```javascript
// ✅ 推荐
spawn('cmd.exe', ['/c', 'claude -p "hello"'], {
  env: process.env  // 继承 PATH
});

// ❌ 不推荐
spawn('claude', ['-p', 'hello']);  // ENOENT
```

## 调试技巧

### 检查命令是否可用

```javascript
const { execSync } = require('child_process');

try {
  execSync('claude --version');
  console.log('✅ Claude CLI is available');
} catch (err) {
  console.log('❌ Claude CLI not found');
}
```

### 测试 spawn 调用

```javascript
const { spawn } = require('child_process');

const proc = spawn('cmd.exe', ['/c', 'claude --version'], {
  env: process.env
});

proc.stdout.on('data', (data) => console.log(data.toString()));
proc.stderr.on('data', (data) => console.error(data.toString()));
proc.on('error', (err) => console.error('Spawn error:', err));
```

## 参考资料

- [Node.js child_process 文档](https://nodejs.org/api/child_process.html)
- [Claude CLI 文档](https://docs.anthropic.com/claude/reference/claude-cli)
- [Windows 命令行转义规则](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/)

## 许可证

MIT
