import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// 从环境变量读取配置
const API_URL = process.env.CAT_CAFE_API_URL || 'http://localhost:3200';
const INVOCATION_ID = process.env.CAT_CAFE_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.CAT_CAFE_CALLBACK_TOKEN;

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.log('❌ 缺少环境变量: CAT_CAFE_INVOCATION_ID 或 CAT_CAFE_CALLBACK_TOKEN');
  process.exit(1);
}

// 创建 MCP Server
const server = new Server(
  {
    name: 'cat-cafe-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'cat_cafe_post_message',
        description: '发送消息到聊天室（主动发言）',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '要发送的消息内容',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'cat_cafe_get_context',
        description: '获取对话上下文',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'cat_cafe_post_message': {
        const { content } = args;
        const response = await fetch(`${API_URL}/api/callbacks/post-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            invocationId: INVOCATION_ID,
            callbackToken: CALLBACK_TOKEN,
            content,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: `✅ 消息已发送到聊天室`,
            },
          ],
        };
      }

      case 'cat_cafe_get_context': {
        const url = new URL(`${API_URL}/api/callbacks/thread-context`);
        url.searchParams.append('invocationId', INVOCATION_ID);
        url.searchParams.append('callbackToken', CALLBACK_TOKEN);

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const context = await response.json();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(context, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `❌ 工具调用失败: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// 使用 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('✅ Cat Cafe MCP Server 已启动');
}

main().catch((error) => {
  console.log('❌ MCP Server 启动失败:', error);
  process.exit(1);
});
