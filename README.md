# venice2api
仅作为学习交流使用！切勿用于其他用途！
# Deno Venice API 代理服务器

一个基于 Deno 的高性能 Venice API 代理服务器，支持 OpenAI 兼容格式、图片生成、Cloudflare 优选 IP 直连、以及多种部署方式。

## 🌟 主要功能

- **OpenAI 兼容**: 完全兼容 OpenAI 的 `/v1/chat/completions` 和 `/v1/models` API 格式。
- **图片生成**: 支持 stable-diffusion-3.5-rev2, qwen-image, hidream 等模型，并可将图片以 Base64 格式直接返回。
- **智能 IP 轮换**: 自动获取并轮换使用 Cloudflare 优选 IP，提升请求成功率和速度。
- **完整流量转发**: 使用 Cloudflare 优选 IP 作为透明代理，实现真正的流量转发和 IP 隐藏。
- **动态用户 ID**: 为每个请求生成唯一用户标识，有效避免速率限制。
- **灵活部署**: 同时支持本地 Deno 环境和 Deno Deploy 云平台部署。
- **CORS 支持**: 内置 CORS 处理，方便前端直接调用。
- **详细统计**: 提供 IP 使用情况和性能统计接口。

## 🚀 快速开始

### 本地运行

```bash
# 1. 克隆或下载代码
git clone <your-repo-url>
cd <your-repo-directory>

# 2. 设置环境变量 (详见下方配置说明)
export API_KEY="your-venice-api-key"

# 3. 启动服务器
deno run --allow-net --allow-read --allow-write server.ts
```

服务器将在 http://localhost:7860 启动。

## ⚙️ 详细配置说明

所有配置项均在代码顶部的 **配置区** 中定义，你可以直接修改代码文件，或通过环境变量进行覆盖（推荐）。

### 1. 服务器配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| API_KEY | string | "your-api-key-here" | **【必需】**用于验证客户端请求的密钥。请设置一个强密码。 |
| SERVER_HOST | string | "0.0.0.0" | 服务器绑定的地址。0.0.0.0 表示监听所有网络接口。 |
| SERVER_PORT | number | 7860 | 服务器监听的端口。 |

### 2. 图片服务配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| CUSTOM_IMAGE_BASE_URL | string | "" | 自定义图片访问的基础 URL。如果留空，将自动根据请求头构建。 |
| INCLUDE_PORT_IN_URL | boolean | false | 是否在生成的图片 URL 中包含端口号。Deno Deploy 通常不需要。 |
| CUSTOM_PORT | number | 7860 | 当 INCLUDE_PORT_IN_URL 为 true 时使用的自定义端口。 |
| IMAGE_DIR | string | "/tmp/public/images" | 本地图片存储目录。仅在 ENABLE_IMAGE_STORAGE 为 true 时有效。 |
| IMAGE_EXPIRE_HOURS | number | 1 | 图片在本地保存的小时数，超过此时间的图片会被清理任务删除。 |
| ENABLE_IMAGE_STORAGE | boolean | false | 是否启用图片文件存储。false 表示仅使用内存存储。 |
| RETURN_BASE64_IMAGES | boolean | true | **【推荐】**是否在 API 响应中直接返回 Base64 编码的图片。true 可避免图片 URL 访问问题。 |

### 3. Venice API 配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| VENICE_CHAT_URL | string | "https://outerface.venice.ai/api/inference/chat" | Venice 聊天 API 的端点。通常无需修改。 |
| VENICE_IMAGE_URL | string | "https://outerface.venice.ai/api/inference/image" | Venice 图片生成 API 的端点。通常无需修改。 |
| VENICE_VERSION | string | "interface@20251007.055834+464da4e" | Venice API 的版本标识，用于请求头。通常无需修改。 |

### 4. Cloudflare 代理配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| CF_IP_API_URL | string | "https://ipdb.api.030101.xyz/?type=cfv4;proxy" | 获取 Cloudflare 优选 IP 列表的 API 地址。 |
| CF_HTTPS_PORTS | number[] | [443, 2053, 2083, 2087, 2096, 8443] | 用于 HTTPS 请求的 Cloudflare 端口列表。 |
| CF_HTTP_PORTS | number[] | [80, 8080, 8880, 2052, 2082, 2086, 2095] | 用于 HTTP 请求的 Cloudflare 端口列表。 |
| USE_CF_AS_PROXY | boolean | true | **【关键】**是否使用 Cloudflare IP 作为透明代理。 |
| PROXY_ROTATION_ENABLED | boolean | true | 是否启用代理轮换。 |
| MAX_REQUESTS_PER_PROXY | number | 1 | 单个代理最大连续请求数，超过后自动切换到下一个代理。 |

### 5. 模型配置

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| IMAGE_MODELS | string[] | ["stable-diffusion-3.5-rev2", "qwen-image", "hidream"] | 被识别为图片生成模型的列表。当请求使用这些模型时，会调用图片生成接口。 |

## 🌐 部署指南

### 方式一：本地 Deno 环境部署

这种方式适合拥有自己的服务器或 VPS 的用户，可以充分利用所有功能。

#### 如何填写环境变量

在终端中直接使用 export 命令设置，或在启动脚本中配置。

```bash
# 核心配置
export API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxx" # 替换为你的真实 API Key
export SERVER_HOST="0.0.0.0"
export SERVER_PORT=7860

# 图片配置
export RETURN_BASE64_IMAGES=true # 推荐，直接返回Base64图片
export ENABLE_IMAGE_STORAGE=true   # 本地环境可以启用文件存储
export IMAGE_DIR="./public/images" # 使用项目相对路径

# 代理配置 (本地环境的核心优势)
export USE_CF_AS_PROXY=true       # 【必须】启用Cloudflare代理
export MAX_REQUESTS_PER_PROXY=5    # 可以适当增加
```

**原因**

- **完全控制**: 你拥有服务器的完全控制权，可以自由配置网络和文件系统。
- **完整流量转发**: 本地 Deno 支持 Deno.createHttpClient，这是实现 Cloudflare IP 透明代理的关键。通过代理，可以有效绕过某些网络限制，提高访问速度和稳定性。
- **文件系统访问**: 可以将生成的图片保存到本地磁盘，实现持久化存储。
- **无限制**: 没有 Deno Deploy 的执行时间、内存等限制。

**缺点**

- **维护成本**: 需要自己维护服务器的运行，包括更新、安全、监控等。
- **可用性**: 如果你的服务器关机或出现故障，服务就会中断。需要自己配置高可用方案。
- **网络环境**: 服务器的网络质量直接影响代理服务的质量。如果服务器本身网络不佳，代理的效果也会打折扣。
- **IP 风险**: 你的服务器 IP 可能会因为频繁请求而被目标网站封锁。

### 方式二：Deno Deploy 云平台部署

Deno Deploy 是一个无服务器云平台，非常适合快速部署和全球分发。

#### 如何填写环境变量

访问 Deno Deploy 并登录。
创建一个新项目，并链接你的 GitHub 仓库或直接粘贴代码。
在项目设置页面的 "Environment Variables" 部分添加以下键值对：

| Key | Value | 说明 |
|-----|-------|------|
| API_KEY | sk-xxxxxxxxxxxxxxxxxxxxxxxx | 你的 API Key |
| USE_CF_AS_PROXY | false | 【必须】 Deno Deploy 不支持完整流量转发 |
| ENABLE_IMAGE_STORAGE | false | 【必须】 Deno Deploy 文件系统只读 |
| RETURN_BASE64_IMAGES | true | 【必须】 只能通过 Base64 返回图片 |
| SERVER_HOST | 0.0.0.0 | 保持默认 |
| SERVER_PORT | 7860 | 保持默认 |

**原因**

- **零维护**: 无需关心服务器运维，平台会自动处理扩缩容、更新和安全。
- **全球 CDN**: Deno Deploy 在全球有边缘节点，用户会被自动路由到最近的节点，延迟低。
- **免费额度**: 提供慷慨的免费额度，适合个人项目和小型应用。
- **一键部署**: 与 GitHub 集成，代码推送后可自动部署。

**缺点**

- **无法完整流量转发**: 这是最大的限制。Deno Deploy 出于安全考虑，不支持 Deno.createHttpClient。因此，USE_CF_AS_PROXY 必须设置为 false，所有请求都将通过标准的网络进行，可能无法绕过某些网络限制。
- **文件系统只读**: Deno Deploy 的文件系统是只读的。因此 ENABLE_IMAGE_STORAGE 必须为 false，图片只能临时存储在内存中，实例重启后会丢失。
- **无持久化**: 内存存储在每次部署或实例休眠后都会被清空。
- **执行限制**: 存在请求超时（如 30 秒）和内存限制，对于生成大图或处理复杂请求可能失败。
- **环境变量数量限制**: 免费版对环境变量数量可能有上限。

## 📡 API 使用方法

部署成功后，你可以像使用 OpenAI API 一样调用它。

### 1. 获取可用模型

```bash
curl -X GET "https://your-domain.deno.dev/v1/models" \
  -H "Authorization: Bearer your-api-key"
```

### 2. 文本聊天 (非流式)

```bash
curl -X POST "https://your-domain.deno.dev/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "dolphin-3.0-mistral-24b-1dot1",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己。"}
    ]
  }'
```

### 3. 生成图片

当 model 为 IMAGE_MODELS 中的任一模型时，会触发图片生成。

```bash
curl -X POST "https://your-domain.deno.dev/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "stable-diffusion-3.5-rev2",
    "messages": [
      {"role": "user", "content": "一只在太空中的猫，宇航服，科幻风格"}
    ],
    "size": "1024x1024",
    "negative_prompt": "模糊, 低质量"
  }'
```

响应示例 (Base64 格式):

```json
{
  "choices": [
    {
      "message": {
        "content": "![一只在太空中的猫，宇航服，科幻风格](data:image/webp;base64,UklGRiQAAABXRUJQVlA4...)",
        "role": "assistant"
      }
    }
  ]
}
```

### 4. 流式聊天

```bash
curl -X POST "https://your-domain.deno.dev/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "dolphin-3.0-mistral-24b-1dot1",
    "messages": [
      {"role": "user", "content": "写一首关于春天的诗"}
    ],
    "stream": true
  }'
```

### 5. 测试代理 IP

访问 `/test-ip` 端点可以查看当前使用的出口 IP：

```bash
curl -X GET "https://your-domain.deno.dev/test-ip"
```

响应示例:

```json
{
  "proxyIP": "104.21.8.9",
  "proxyEnabled": true,
  "totalProxies": 500,
  "timestamp": 1699123456789
}
```

## 📊 监控和统计

### IP 使用统计 (仅本地部署)

当 USE_CF_AS_PROXY 为 true 时，可以通过以下接口查看 IP 使用情况：

```bash
curl -X GET "http://localhost:7860/stats"
```

响应示例:

```json
{
  "totalProxies": 500,
  "proxyStats": [
    {
      "ip": "104.21.8.9",
      "port": 443,
      "usageCount": 15,
      "lastUsed": 1699123456789,
      "successCount": 14,
      "failureCount": 1,
      "avgResponseTime": 234.5
    }
  ]
}
```

### 日志查看

服务器会输出详细的运行日志，包括：

- 代理轮换情况
- 请求成功/失败状态
- 响应时间统计
- 错误详情
- 动态用户 ID 生成情况

## ❓ 常见问题 (FAQ)

**Q1: 为什么在 Deno Deploy 上图片生成失败？**

A: Deno Deploy 有 30 秒的执行超时限制。如果图片生成时间过长，可能会超时失败。可以尝试：

- 减少图片尺寸
- 降低生成步数（代码中已针对不同模型优化）
- 使用本地部署以避免超时限制

**Q2: 代理功能不生效怎么办？**

A: 请检查以下几点：

- 确保你是在本地 Deno 环境运行，而不是 Deno Deploy
- 确保 USE_CF_AS_PROXY 设置为 true
- 检查你的服务器防火墙是否允许出站连接
- 查看控制台日志，确认是否成功获取到 IP 列表
- 访问 `/test-ip` 端点验证代理是否工作

**Q3: 如何更新 Cloudflare 优选 IP 列表？**

A: 服务器会每 5 分钟自动更新一次 IP 列表。你也可以：

- 重启服务器强制更新
- 访问 CF_IP_API_URL 检查 IP 源是否可用
- 更换其他 IP 源 API

**Q4: 图片返回的是 URL 而不是 Base64？**

A: 检查 RETURN_BASE64_IMAGES 配置项：

- 设置为 true 返回 Base64 格式
- 设置为 false 返回 URL 格式
- 如果使用 URL 格式，确保你的域名或 IP 可以被访问

**Q5: 如何提高请求成功率？**

A:

- **本地部署**: 启用代理功能
- **调整轮换策略**: 使用最少使用策略
- **增加代理池**: 定期更新代理列表
- **降低请求频率**: 避免单个代理过度使用
- **使用动态用户ID**: 确保每个请求有唯一标识

**Q6: Deno Deploy 和本地部署如何选择？**

A:

- **选择 Deno Deploy**: 如果你需要快速部署、全球访问、零维护
- **选择本地部署**: 如果你需要最高性能、完整流量转发、持久化存储

**Q7: 什么是动态用户 ID？为什么需要它？**

A: 动态用户 ID 是为每个请求生成的唯一标识符，用于避免 Venice API 的速率限制。即使所有请求来自同一个 IP，不同的用户 ID 也会被视为不同的用户，从而分散请求负载。

## 🔧 高级配置

### 自定义 IP 源

你可以使用其他 Cloudflare 优选 IP 源，只需修改 CF_IP_API_URL：

```typescript
// 使用其他 IP 源
const CF_IP_API_URL = "https://your-ip-source.com/api/ips";
```

### 添加自定义请求头

在 fetchThroughCloudflareProxy 函数中可以添加更多请求头：

```typescript
const defaultHeaders = {
  "User-Agent": getRandomUserAgent(),
  "Accept": "application/json, text/plain, */*",
  "X-Custom-Header": "your-value", // 添加自定义头
  ...options.headers,
};
```

### 健康检查端点

可以添加一个健康检查端点用于监控：

```typescript
if (url.pathname === "/health") {
  return new Response(JSON.stringify({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Date.now() - startTime,
    proxyCount: cfProxies.length,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
```

## 📝 更新日志

### v2.0.0 (2025-01-20)

- **新增**: 完整流量转发功能，使用 Cloudflare 优选 IP 作为透明代理
- **新增**: 动态用户 ID 生成，有效避免速率限制
- **新增**: 智能代理轮换策略，自动选择最少使用的代理
- **新增**: 代理测试端点 `/test-ip`，便于验证代理功能
- **改进**: 重构请求处理逻辑，提高稳定性和成功率
- **改进**: 增强错误处理和重试机制
- **改进**: 更详细的日志记录和统计信息

### v1.0.0 (2024-01-01)

- 初始版本发布
- 支持 OpenAI 兼容 API
- 支持图片生成和 Base64 返回
- 支持 Cloudflare 优选 IP 直连
- 支持本地和 Deno Deploy 部署

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 开发环境设置

```bash
# 克隆仓库
git clone <your-repo-url>
cd <your-repo-directory>

# 安装 Deno (如果尚未安装)
curl -fsSL https://deno.land/x/install/install.sh | sh

# 运行开发服务器
deno run --allow-net --allow-read --allow-write server.ts
```

## 📄 许可证

MIT License

## 🙏 致谢

- Deno - 现代化的 JavaScript/TypeScript 运行时
- Venice AI - 提供强大的 AI 模型服务
- Cloudflare - 提供优质的 CDN 和网络服务

## 📞 联系方式

如果你有任何问题或建议，欢迎通过以下方式联系：

- 提交 GitHub Issue
- 在 https://linux.do/t/topic/1015699 提交帖子

## ⚠️ 免责声明

本项目仅用于学习和研究目的。请遵守相关服务条款和法律法规。
