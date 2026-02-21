import { spawn } from 'child_process';
import { createInterface } from 'readline';

// 从环境变量读取配置
const API_URL = process.env.CAT_CAFE_API_URL || 'http://localhost:3200';
const INVOCATION_ID = process.env.CAT_CAFE_INVOCATION_ID || 'demo-invocation-12345';
const CALLBACK_TOKEN = process.env.CAT_CAFE_CALLBACK_TOKEN || 'demo-token-67890';

// Claude CLI 提示词
const prompt = `你的任务是写一首关于猫的诗。
在开始写之前，先用 cat_cafe_get_context 获取上下文。
写完后，用 cat_cafe_post_message 把诗发到聊天室。
注意：你的思考过程不需要发送，只把最终的诗发到聊天室即可。`;

// 判断平台和 shell 类型
const isWindows = process.platform === 'win32';
const shell = (isWindows && !process.env.MSYSTEM && !process.env.SHELL?.includes('sh')) ? 'cmd.exe' : process.env.SHELL || 'sh';

// 确认环境变量
console.log('='.repeat(50));
console.log('🐱 启动 Claude CLI (with MCP Callback)');
console.log('='.repeat(50));
console.log(`📍 Platform: ${process.platform}, Shell: ${shell}`);
console.log(`📍 API URL: ${API_URL}`);
console.log(`🔑 invocationId: ${INVOCATION_ID}`);
console.log(`🔑 callbackToken: ${CALLBACK_TOKEN}`);
console.log('='.repeat(50));
console.log('📝 终端 2 (run-cat.js) 输出说明：');
console.log('   💬 [响应] - AI 的回答和思考（stdout, assistant 消息）');
console.log('   🔧 [调用工具] - MCP 工具调用（stdout 中的 tool_use）');
console.log('   ✅ [工具结果] - 工具调用结果（stdout 中的 tool_result）');
console.log('   👤 [用户] - 用户事件（可能包含工具确认）');
console.log('   🧠 [思考] - AI 的内心独白（stderr, 如有）');
console.log('💬 终端 1 (callback-server) 显示：AI 的主动发言（仅最终结果）');
console.log('='.repeat(50));

// 构建 MCP 配置 JSON（双引号转义）
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

// 构建 claude 命令字符串（添加 --dangerously-skip-permissions 跳过权限检查）
const commandStr = `claude -p "${prompt.replace(/"/g, '\\"')}" --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config '${mcpConfigJson}'`;

// 根据 shell 类型决定参数：cmd.exe 用 /c，bash/sh 用 -c
const shellArgs = shell?.toLowerCase().includes('cmd') ? ['/c', commandStr] : ['-c', commandStr];

console.log(`🔧 Executing: ${commandStr}`);
console.log('='.repeat(50) + '\n');

// 启动 Claude CLI（通过 shell）
const claude = spawn(shell, shellArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    CAT_CAFE_API_URL: API_URL,
    CAT_CAFE_INVOCATION_ID: INVOCATION_ID,
    CAT_CAFE_CALLBACK_TOKEN: CALLBACK_TOKEN,
  },
});

// 处理 stdout (NDJSON 流)
const rl = createInterface({
  input: claude.stdout,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  try {
    const event = JSON.parse(line);

    // 打印不同类型的事件
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          console.log('🔵 Session ID:', event.session_id);
        }
        break;

      case 'assistant':
        if (event.message?.content) {
          for (const item of event.message.content) {
            if (item.type === 'text') {
              console.log('💬 [响应]', item.text);
            } else if (item.type === 'tool_use') {
              console.log(`🔧 [调用工具] ${item.name}`);
            } else if (item.type === 'tool_result') {
              // tool_result 的内容，直接显示状态
              if (item.isError) {
                console.log('❌ [工具结果] 失败:', item.content?.[0]?.text);
              } else {
                console.log('✅ [工具结果] 成功');
              }
            } else {
              // 打印未知 item 类型以便调试
              console.log(`[未知 item 类型] ${item.type}`, JSON.stringify(item).substring(0, 200));
            }
          }
        }
        break;

      case 'user':
        // 用户事件，可能是工具调用的中间状态或确认
        if (event.message?.content) {
          for (const item of event.message.content) {
            if (item.type === 'text') {
              console.log('👤 [用户]', item.text);
            } else if (item.type === 'tool_result') {
              console.log(`✅ [工具结果] ${item.name}: ${item.isError ? '失败' : '成功'}`);
            }
          }
        }
        break;

      case 'tool_use':
        console.log('🔧 调用工具:', event.name);
        break;

      case 'tool_result':
        if (event.result?.isError) {
          console.log('❌ 工具调用失败:', event.result.content?.[0]?.text);
        } else {
          console.log('✅ 工具调用成功');
        }
        break;

      case 'result':
        console.log('\n', '─'.repeat(50));
        console.log('🏁 任务完成:', event.subtype);
        console.log('─'.repeat(50), '\n');
        break;

      case 'error':
        console.error('❌ 错误:', event.message);
        break;

      default:
        // 打印未知事件类型以便调试
        console.log(`[未知事件] ${event.type}`);
    }
  } catch (err) {
    // 忽略解析失败的行（可能是非 JSON 输出）
    if (line.trim()) {
      console.log('📄', line);
    }
  }
});

// 处理 stderr（thinking 过程、工具调用状态、进度信息）- 这是 AI 的内心独白
// 重要：stderr 包含 thinking 内容，输出到 stderr 而不是 stdout
let stderrCount = 0;
claude.stderr.on('data', (data) => {
  stderrCount++;
  const content = data.toString();
  if (content.trim()) {
    // 同时输出到 stderr 和 stdout 以确保可见
    process.stderr.write(`🧠 [思考 #${stderrCount}] ${content}`);
    console.log('🧠 [思考 #${stderrCount}]', content.trim());
  } else {
    console.log('🧠 [思考 #${stderrCount}] <空数据>');
  }
});

// 处理退出
claude.on('close', (code) => {
  console.log(`\n🐱 Claude CLI 退出，退出码: ${code}`);
  // 关闭 readline 接口
  rl.close();
  // 让脚本也退出
  process.exit(code || 0);
});

claude.on('error', (err) => {
  console.error('❌ 启动 Claude CLI 失败:', err.message);
  console.error('💡 请确认已安装并登录 Claude CLI: https://github.com/anthropics/claude-code');
  process.exit(1);
});
