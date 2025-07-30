interface Env {
  DB: D1Database;
  NODE_ENV?: string;
  MY_SECRET: KVNamespace; // 新增密钥存储声明
}

interface User {
  id?: number;
  ip?: string;
  device_uuid?: string;
  device_fingerprint?: string;
  signature?: string;
  room_number?: string;
  signature_image?: string;
  created_at?: string;
}

interface SignatureData {
  signature_data: string;
  signature_name: string;
  room_number: string;
  device_uuid: string;
  device_fingerprint: string;
  signature_time?: string;
}

interface DeviceInfo {
  uuid: string;
  fingerprint: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 设置CORS头
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // 处理预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // 获取 secret token
    const secretToken = await env.MY_SECRET.get('token');
    console.log(secretToken);
    // 只允许 /health 和 /version 端点不校验 token
    if (!(path === '/health' || path === '/version')) {


      const authHeader = request.headers.get('Authorization');
      // 检查是否存在 Authorization 头
      if (!authHeader) {
        return new Response(JSON.stringify({ error: '未授权，缺少 Authorization 头' }), {
          status: 401,
          headers
        });
      }

      // 检查 Authorization 头格式是否正确（是否以 Bearer 开头）
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: '未授权，Authorization 头格式错误，应以 Bearer 开头' }), {
          status: 401,
          headers
        });
      }

      // 提取并检查 token 是否正确
      const token = authHeader.slice(7);
      if (token !== secretToken) {
        return new Response(JSON.stringify({ error: '未授权，token 不正确' }), {
          status: 401,
          headers
        });
      }
    }

    try {
      // 初始化数据库表（首次运行时创建）
      await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS user (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            device_uuid TEXT,
            device_fingerprint TEXT,
            signature TEXT,
            room_number TEXT,
            signature_image TEXT,
            created_at TEXT
          )
        `).run();

      // 健康检查端点
      if (path === '/health' && method === 'GET') {
        try {
          // 简单查询验证数据库连接
          await env.DB.prepare('SELECT 1').all();
          return new Response(JSON.stringify({
            status: 'healthy',
            database: 'connected',
            environment: env.NODE_ENV || 'development'
          }), { headers });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return new Response(JSON.stringify({
            status: 'unhealthy',
            error: message
          }), { status: 503, headers });
        }
      }

      // 版本信息端点
      if (path === '/version' && method === 'GET') {
        return new Response(JSON.stringify({
          application: 'SingVote API',
          version: '2.0.0',
          environment: env.NODE_ENV || 'development'
        }), { headers });
      }

      // 检查用户是否已签字
      if (path === '/user-status' && method === 'POST') {
        const deviceInfo: DeviceInfo = await request.json();

        if (!deviceInfo.uuid || !deviceInfo.fingerprint) {
          return new Response(JSON.stringify({ error: '设备信息不完整' }), {
            status: 400,
            headers
          });
        }

        // 先通过UUID查找
        let { results } = await env.DB.prepare(
          'SELECT * FROM user WHERE device_uuid = ?'
        ).bind(deviceInfo.uuid).all<User>();

        let user = results[0];

        // 没找到则通过设备指纹查找
        if (!user) {
          ({ results } = await env.DB.prepare(
            'SELECT * FROM user WHERE device_fingerprint = ?'
          ).bind(deviceInfo.fingerprint).all<User>());
          user = results[0];
        }

        return new Response(JSON.stringify({
          hasSigned: !!user,
          signature: user ? user.signature : null
        }), { headers });
      }

      // 提交签字
      if (path === '/sign' && method === 'POST') {
        const signatureData: SignatureData = await request.json();

        const user_ip = request.headers.get('CF-Connecting-IP') || request.ip;

        // 验证必要字段
        if (!signatureData.signature_data || !signatureData.signature_name) {
          return new Response(JSON.stringify({ error: '请完成签字并输入姓名' }), {
            status: 400,
            headers
          });
        }
        if (!signatureData.room_number) {
          return new Response(JSON.stringify({ error: '请填写门牌号' }), {
            status: 400,
            headers
          });
        }
        if (!signatureData.device_uuid || !signatureData.device_fingerprint) {
          return new Response(JSON.stringify({ error: '设备信息不完整，请刷新页面重试' }), {
            status: 400,
            headers
          });
        }

        // 检查是否已签字
        const { results: existingUsers } = await env.DB.prepare(`
            SELECT * FROM user WHERE device_uuid = ? OR device_fingerprint = ?
          `).bind(signatureData.device_uuid, signatureData.device_fingerprint).all<User>();

        if (existingUsers.length > 0) {
          return new Response(JSON.stringify({ error: '您已经签过字了' }), {
            status: 400,
            headers
          });
        }

        // 处理签名数据
        let base64Data: string;
        if (signatureData.signature_data.startsWith('data:image/')) {
          try {
            base64Data = signatureData.signature_data.split(',')[1] || signatureData.signature_data;
          } catch (err) {
            return new Response(JSON.stringify({ error: '签字数据格式错误，请重新签字' }), {
              status: 400,
              headers
            });
          }
        } else {
          base64Data = signatureData.signature_data;
        }

        // 保存签字
        const result = await env.DB.prepare(`
            INSERT INTO user (
              ip, device_uuid, device_fingerprint, signature, 
              room_number, signature_image, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(
          user_ip,
          signatureData.device_uuid,
          signatureData.device_fingerprint,
          signatureData.signature_name.trim(),
          signatureData.room_number.trim(),
          base64Data,
          signatureData.signature_time || new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({
          message: '感谢您的签字！'
        }), { headers });
      }

      // 获取当前用户的签字
      if (path === '/user-signature' && method === 'POST') {
        const deviceInfo: DeviceInfo = await request.json();

        if (!deviceInfo.uuid || !deviceInfo.fingerprint) {
          return new Response(JSON.stringify({ signature: null }), { headers });
        }

        // 先通过UUID查找
        let { results } = await env.DB.prepare(
          'SELECT * FROM user WHERE device_uuid = ?'
        ).bind(deviceInfo.uuid).all<User>();

        let user = results[0];

        // 没找到则通过设备指纹查找
        if (!user) {
          ({ results } = await env.DB.prepare(
            'SELECT * FROM user WHERE device_fingerprint = ?'
          ).bind(deviceInfo.fingerprint).all<User>());
          user = results[0];
        }

        if (user) {
          return new Response(JSON.stringify({
            signature: {
              signature: user.signature,
              signature_image: user.signature_image,
              created_at: user.created_at,
              room_number: user.room_number
            }
          }), { headers });
        } else {
          return new Response(JSON.stringify({ signature: null }), { headers });
        }
      }

      // 获取所有签字信息（不含敏感数据）
      if (path === '/all-signatures' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, signature, room_number, created_at FROM user ORDER BY created_at DESC'
        ).all<User>();

        return new Response(JSON.stringify({
          signatures: results,
          total: results.length
        }), { headers });
      }

      // 获取签字统计
      if (path === '/statistics' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT COUNT(*) as count FROM user').all();
        const totalSignatures = results[0]?.count || 0;
        const targetSignatures = 667;
        // 确保参与运算的变量是数字类型
        const totalSignaturesNum = Number(totalSignatures);
        const targetSignaturesNum = Number(targetSignatures);

        const progress = Math.min(
          Math.round((totalSignaturesNum / targetSignaturesNum) * 100 * 10) / 10,
          100
        );
        return new Response(JSON.stringify({
          total_signatures: totalSignatures,
          target_signatures: targetSignatures,
          progress: progress
        }), { headers });
      }

      // 管理员查看所有记录
      if (path === '/admin/signatures' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM user').all<User>();

        return new Response(JSON.stringify({
          signatures: results,
          total: results.length
        }), { headers });
      }

      // 下载签字图片
      if (path.match(/^\/signature\/download\/(\d+)$/) && method === 'GET') {
        const match = path.match(/^\/signature\/download\/(\d+)$/);
        if (!match) {
          return new Response(JSON.stringify({ message: '无效的URL格式' }), {
            status: 400,
            headers
          });
        }

        const userId = match[1];
        const { results } = await env.DB.prepare(
          'SELECT * FROM user WHERE id = ?'
        ).bind(userId).all<User>();

        if (results.length === 0) {
          return new Response(JSON.stringify({ message: '用户不存在' }), {
            status: 404,
            headers
          });
        }

        const user = results[0];
        if (!user.signature_image) {
          return new Response(JSON.stringify({ message: '该用户没有签字图片' }), {
            status: 404,
            headers
          });
        }

        return new Response(JSON.stringify({
          user_id: userId,
          signature_name: user.signature,
          signature_data: user.signature_image
        }), { headers });
      }

      // 未找到的端点
      return new Response(JSON.stringify({ error: '端点不存在' }), {
        status: 404,
        headers
      });

    } catch (error) {
      console.error('Error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({
        error: '服务器内部错误',
        details: message
      }), {
        status: 500,
        headers
      });
    }
  },
};
