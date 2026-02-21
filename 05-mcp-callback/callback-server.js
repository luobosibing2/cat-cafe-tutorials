import http from 'http';

// 固定凭证（方便运行，无需每次复制）
const INVOCATION_ID = 'demo-invocation-12345';
const CALLBACK_TOKEN = 'demo-token-67890';

const PORT = 3200;

// 解析 URL 查询参数
function parseQuery(url) {
  const queryStr = url.split('?')[1];
  if (!queryStr) return {};
  const params = new URLSearchParams(queryStr);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

// 验证凭证
function validateAuth(invocationId, callbackToken) {
  return invocationId === INVOCATION_ID && callbackToken === CALLBACK_TOKEN;
}

// 模拟对话历史
const MOCK_THREAD_CONTEXT = {
  messages: [
    {
      role: 'user',
      content: '请写一首关于猫的诗，第一句必须是"猫猫天下无敌"'
    }
  ]
};

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url;
  const method = req.method;

  // POST /api/callbacks/post-message
  if (method === 'POST' && url === '/api/callbacks/post-message') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { invocationId, callbackToken, content } = JSON.parse(body);

        if (!validateAuth(invocationId, callbackToken)) {
          console.log('❌ 认证失败: post-message');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        console.log('\n📬 收到主动发言:');
        console.log('─'.repeat(50));
        console.log(content);
        console.log('─'.repeat(50) + '\n');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        console.error('❌ 解析请求失败:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /api/callbacks/thread-context
  if (method === 'GET' && url.startsWith('/api/callbacks/thread-context')) {
    const query = parseQuery(url);
    const { invocationId, callbackToken } = query;

    if (!validateAuth(invocationId, callbackToken)) {
      console.log('❌ 认证失败: thread-context');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    console.log('✅ 提供 thread-context');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MOCK_THREAD_CONTEXT));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🐱 Cat Cafe Callback Server 启动成功!');
  console.log('='.repeat(50));
  console.log(`📍 监听端口: ${PORT}`);
  console.log(`🔑 invocationId: ${INVOCATION_ID}`);
  console.log(`🔑 callbackToken: ${CALLBACK_TOKEN}`);
  console.log('='.repeat(50));
  console.log('💡 等待猫猫主动发言...\n');
});
