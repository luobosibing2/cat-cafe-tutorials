# 第五课实现踩坑总结

## 1. JSON 转义问题

### 问题
使用临时文件 + `mkdtempSync` 遇到导入错误：
```
SyntaxError: The requested module 'node:fs/promises' does not provide an export named 'mkdtempSync'
```

### 解决
放弃临时文件方案，改用直接 JSON 转义：
```javascript
// 错误做法（使用临时文件）
const tmpDir = mkdtempSync({ prefix: 'mcp-config-' });
await fs.writeFile(mcpConfigPath, json);

// 正确做法（直接转义）
const mcpConfigJson = JSON.stringify({...});
const commandStr = `claude -p "${prompt.replace(/"/g, '\\"')}" --mcp-config '${mcpConfigJson}'`;
```

### 教训
- Prompt 用双引号包裹：`"${prompt.replace(/"/g, '\\"')}"`
- MCP 配置用单引号包裹：`'${mcpConfigJson}'`
- 避免使用临时文件，减少复杂度

---

## 2. Shell 类型检测问题

### 问题
在 Windows 上使用 Git Bash 时，shell 检测错误导致命令执行失败。

### 解决
正确识别 Git Bash 环境：
```javascript
const isWindows = process.platform === 'win32';
const shell = (isWindows && !process.env.MSYSTEM && !process.env.SHELL?.includes('sh'))
  ? 'cmd.exe'
  : process.env.SHELL || 'sh';
```

### 教训
- Git Bash 设置了 `SHELL` 环境变量，可以通过 `SHELL?.includes('sh')` 检测
- `MSYSTEM` 环境变量也表明是 Git Bash/MSYS2 环境
- 不能简单用 `process.platform === 'win32'` 就判断用 cmd.exe

---

## 3. MCP 权限问题

### 问题
运行时遇到权限提示：
```
看起来这两个 MCP 工具都需要权限才能使用。你需要先授权...
```

### 尝试 1（失败）
使用 `--auto-approve` 参数：
```
error: unknown option '--auto-approve'
```

### 解决
使用正确的参数 `--dangerously-skip-permissions`：
```javascript
const commandStr = `claude -p "..." --dangerously-skip-permissions --mcp-config '...'`;
```

### 教训
- Claude CLI 没有 `--auto-approve` 参数
- 需要使用 `--dangerously-skip-permissions` 跳过权限检查
- 注意 `dangerously` 前缀表示有安全风险，仅在受控环境使用

---

## 4. NDJSON 事件处理问题

### 问题 1：工具调用事件不在预期位置
原以为 `tool_use` 和 `tool_result` 是独立的 NDJSON 事件类型，但实际上：

**正确的结构：**
```json
{
  "type": "assistant",
  "message": {
    "content": [
      { "type": "text", "text": "AI 的回答" },
      { "type": "tool_use", "name": "mcp__cat-cafe__cat_cafe_get_context" },
      { "type": "tool_result", "isError": false }
    ]
  }
}
```

### 解决
遍历 assistant 事件的 content 数组：
```javascript
case 'assistant':
  if (event.message?.content) {
    for (const item of event.message.content) {
      if (item.type === 'tool_use') {
        console.log(`🔧 [调用工具] ${item.name}`);
      } else if (item.type === 'tool_result') {
        console.log('✅ [工具结果] 成功');
      }
    }
  }
  break;
```

### 问题 2：`user` 事件类型
输出中出现 `[未知事件] user`，需要处理：
```javascript
case 'user':
  if (event.message?.content) {
    for (const item of event.message.content) {
      if (item.type === 'text') {
        console.log('👤 [用户]', item.text);
      }
    }
  }
  break;
```

### 教训
- `tool_use` 和 `tool_result` 嵌套在 `assistant` 事件的 `content` 数组中
- 不是独立的 NDJSON 事件类型
- 需要遍历 content 数组，按 type 区分处理
- `user` 事件也是有效的 NDJSON 事件类型

---

## 5. 工具结果显示问题

### 问题
输出显示 `✅ [工具结果] undefined: 成功`，`item.name` 是 `undefined`。

### 解决
tool_result 的结构没有 name 字段，直接显示状态：
```javascript
// 错误做法
console.log(`✅ [工具结果] ${item.name}: ${item.isError ? '失败' : '成功'}`);

// 正确做法
if (item.isError) {
  console.log('❌ [工具结果] 失败:', item.content?.[0]?.text);
} else {
  console.log('✅ [工具结果] 成功');
}
```

### 教训
- 不同事件类型的 item 结构不同，不能假设都有 name 字段
- tool_result 主要关注 isError 状态

---

## 6. stderr 输出问题

### 问题
第二课说 stderr 包含 thinking 过程，但实际运行时没有 `🧠 [思考]` 输出。

### 分析
在使用 `--output-format stream-json` 格式时：
- **thinking 过程不输出到 stderr**
- 所有内容（包括 thinking）都嵌入在 stdout 的 NDJSON 流中
- 第二课的教训适用于其他输出格式

### 解决
更新输出说明，明确 stream-json 模式下的行为：
```javascript
console.log('💬 [响应] - AI 的回答和思考（stdout, assistant 消息）');
console.log('🧠 [思考] - AI 的内心独白（stderr, 如有）');
```

### 教训
- `stream-json` 格式下，所有结构化输出都在 stdout 的 NDJSON 流中
- stderr 主要用于非结构化的进度/错误信息
- "内心独白" 概念在 stream-json 模式下体现在完整的 stdout 输出
- 终端 1 (callback-server) 的输出才是"主动发言"（AI 主动选择发送的内容）

---

## 7. 核心概念验证

### 预期 vs 实际

| 项目 | 预期 | 实际 |
|------|--------|--------|
| 内心独白 | stderr (thinking) | stdout 完整 NDJSON 流 |
| 主动发言 | callback-server | callback-server ✓ |

### 结论
在 `stream-json` 格式下：
- **终端 2 (run-cat.js)** 的所有输出 = AI 的"内心独白"
  - AI 的思考和叙述
  - 工具调用决策
  - 工具执行结果
- **终端 1 (callback-server)** 的输出 = AI 的"主动发言"
  - 通过 MCP 工具 `cat_cafe_post_message` 发送的内容

---

## 8. 完整命令示例

### 终端 1：启动 callback-server
```bash
cd 05-mcp-callback
node callback-server.js
```

### 终端 2：运行 run-cat
```bash
cd 05-mcp-callback
CAT_CAFE_API_URL=http://localhost:3200 \
CAT_CAFE_INVOCATION_ID=demo-invocation-12345 \
CAT_CAFE_CALLBACK_TOKEN=demo-token-67890 \
node run-cat.js
```

---

## 9. 关键代码片段

### Shell 检测
```javascript
const isWindows = process.platform === 'win32';
const shell = (isWindows && !process.env.MSYSTEM && !process.env.SHELL?.includes('sh'))
  ? 'cmd.exe'
  : process.env.SHELL || 'sh';

const shellArgs = shell?.toLowerCase().includes('cmd')
  ? ['/c', commandStr]
  : ['-c', commandStr];
```

### JSON 转义
```javascript
const mcpConfigJson = JSON.stringify({
  mcpServers: {
    'cat-cafe': {
      command: 'node',
      args: ['./cat-cafe-mcp.js'],
      env: {
        CAT_CAFE_API_URL: API_URL,
        CAT_CAFE_INVOCATION_ID: INVOCATION_ID,
        CAT_CAFE_CALLBACK_TOKEN: CALLBACK_TOKEN,
      },
    },
  },
});

const escapedPrompt = prompt.replace(/"/g, '\\"');
const commandStr = `claude -p "${escapedPrompt}" --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config '${mcpConfigJson}'`;
```

### NDJSON 事件处理
```javascript
case 'assistant':
  if (event.message?.content) {
    for (const item of event.message.content) {
      if (item.type === 'text') {
        console.log('💬 [响应]', item.text);
      } else if (item.type === 'tool_use') {
        console.log(`🔧 [调用工具] ${item.name}`);
      } else if (item.type === 'tool_result') {
        if (item.isError) {
          console.log('❌ [工具结果] 失败:', item.content?.[0]?.text);
        } else {
          console.log('✅ [工具结果] 成功');
        }
      }
    }
  }
  break;
```

---

## 10. 文件清单

| 文件 | 说明 |
|------|------|
| callback-server.js | HTTP 回调服务器（端口 3200） |
| cat-cafe-mcp.js | MCP Server（提供 2 个工具） |
| run-cat.js | Claude CLI 调用脚本 |
| package.json | 项目配置 |
| IMPLEMENTATION-LESSONS.md | 本文档（踩坑总结） |

---

## 11. 进程退出问题

### 问题
run-cat.js 在 Claude CLI 子进程结束后不会自动退出，需要手动 Ctrl+C。

### 原因
readline 接口还在等待输入，即使子进程已退出。

### 解决
在 close 事件中关闭 readline 接口：
```javascript
// 错误做法
claude.on('close', (code) => {
  console.log(`\n🐱 Claude CLI 退出，退出码: ${code}`);
  process.exit(code || 0);
});

// 正确做法
claude.on('close', (code) => {
  console.log(`\n🐱 Claude CLI 退出，退出码: ${code}`);
  rl.close();  // 关闭 readline 接口
  process.exit(code || 0);
});
```

### 教训
- 子进程退出后，readline 接口仍会阻塞脚本
- 需要显式调用 `rl.close()` 来释放资源
- 否则 `process.exit()` 可能被 readline 阻塞

---

## 12. 总结

1. **JSON 转义**：直接转义，避免临时文件
2. **Shell 检测**：考虑 Git Bash 环境
3. **权限处理**：使用 `--dangerously-skip-permissions`
4. **事件结构**：tool_use/tool_result 嵌套在 assistant content 中
5. **stderr 输出**：stream-json 格式下 thinking 在 stdout 中
6. **进程退出**：子进程退出后需要关闭 readline 接口
7. **核心概念**：
   - 内心独白 = run-cat.js 的完整输出
   - 主动发言 = callback-server 收到的内容
