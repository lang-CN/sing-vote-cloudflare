# Worker + D1 Database

[参考](https://hono.nodejs.cn/docs/getting-started/cloudflare-workers)


https://segmentfault.com/a/1190000045256199

下面是使用 Cloudflare D1 数据库替代原有数据库的 Node.js API 实现，适配 Cloudflare Workers 环境：

### 本地启动

#### D1 初始化本地数据库

```bash
npx wrangler d1 execute sing-vote --local --file=./d1-sing-vote/schema.sql
```
验证数据库是否初始化成功
```bash
npx wrangler d1 execute sing-vote --local --command="SELECT * FROM user"
```

### 部署线上数据库

```bash
npx wrangler d1 execute sing-vote --remote --file=./d1-sing-vote/schema.sql
```
验证数据库是否初始化成功
```bash
npx wrangler d1 execute prod-d1-tutorial --remote --command="SELECT * FROM Customers"
```

#### Secrets Store

#### 初始化
```bash

wrangler secrets-store store list --remote

本地创建-测试使用
npx wrangler secrets-store secret create c67f0e13ddbf4259809c6d652766b9e5 --name sing-vote-token --scopes workers

npx wrangler secrets-store secret create c67f0e13ddbf4259809c6d652766b9e5 --name MY_SECRET_NAME --scopes workers --remote

```

### 本地启动
```bash
wrangler dev
```

### 部署步骤

1. 安装Cloudflare Wrangler CLI：
   ```bash
   npm install -g wrangler
   ```

2. 登录Cloudflare账号：
   ```bash
   wrangler login
   ```

3. 创建D1数据库：
   ```bash
   wrangler d1 create signature-db
   ```

4. 替换`wrangler.toml`中的`database_id`为实际ID

5. 部署Worker：
   ```bash
   wrangler deploy
   ```

这个实现完全利用了Cloudflare D1的边缘数据库特性，提供低延迟的签字API服务，同时保持了与原Python版本相同的功能和接口。