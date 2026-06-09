# VPS 部署说明

## 1. 上传项目

把整个 `v1` 文件夹上传到 VPS，例如放到：

```bash
/opt/emby-probe
```

如果用 `scp`：

```bash
scp -r v1 root@你的VPS_IP:/opt/emby-probe
```

## 2. 安装 Node.js

需要 Node.js 20 或更高版本。

Ubuntu/Debian 可用：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
```

## 3. 配置后端

进入后端目录：

```bash
cd /opt/emby-probe/backend
cp .env.example .env
nano .env
```

推荐配置：

```env
HOST=127.0.0.1
PORT=8787
PUBLIC_WRITE_API=true
REFRESH_INTERVAL_MS=300000
PROBE_TIMEOUT_MS=8000
APP_SECRET=请改成随机长字符串
ADMIN_TOKEN=请改成随机长字符串
ADMIN_PASSWORD=请改成强密码
```

## 4. 启动测试

```bash
cd /opt/emby-probe/backend
npm start
```

本机测试：

```bash
curl http://127.0.0.1:8787/api/health
```

浏览器访问时，如果没有配置域名反代，临时可以把 `.env` 里的 `HOST` 改为：

```env
HOST=0.0.0.0
```

然后访问：

```text
http://你的VPS_IP:8787/
```

## 5. 用 PM2 常驻运行

```bash
npm install -g pm2
cd /opt/emby-probe/backend
pm2 start src/server.js --name emby-probe
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs emby-probe
```

## 6. Nginx 反代到域名

安装 Nginx：

```bash
apt install -y nginx
```

创建配置：

```bash
nano /etc/nginx/sites-available/emby-probe
```

写入：

```nginx
server {
    listen 80;
    server_name 你的域名;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/emby-probe /etc/nginx/sites-enabled/emby-probe
nginx -t
systemctl reload nginx
```

之后访问：

```text
http://你的域名/
```

## Docker 部署

如果 VPS 已安装 Docker，可以直接用 Docker Compose 启动：

```bash
cd /opt/emby-probe
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f
```

访问：

```text
http://你的VPS_IP:8787/
```

数据会保存在宿主机：

```text
/opt/emby-probe/backend/data
```

修改配置时，编辑 `docker-compose.yml` 里的 `environment`，然后重启：

```bash
docker compose up -d
```
