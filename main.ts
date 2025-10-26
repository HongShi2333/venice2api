// deno run --allow-net --allow-read --allow-write server.ts

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

// =============================================================================
// 配置区 (请根据你的需求修改)
// =============================================================================

// --- 服务器配置 ---
const API_KEY = "your-api-key-here"; // 设置你的API密钥
const SERVER_HOST = "0.0.0.0";       // 服务器地址（Deno Deploy使用0.0.0.0）
const SERVER_PORT = 8000;              // 服务器监听端口

// --- 图片链接配置 ---
const CUSTOM_IMAGE_BASE_URL = "";      // 自定义图片基础URL，留空则使用自动检测
const INCLUDE_PORT_IN_URL = false;     // 是否在URL中包含端口号（Deno Deploy通常不需要）
const CUSTOM_PORT = 8000;              // 自定义端口号（当INCLUDE_PORT_IN_URL为true时使用）

// --- 图片服务配置 ---
const IMAGE_DIR = "/tmp/public/images"; // 图片存储目录（使用/tmp目录）
const IMAGE_EXPIRE_HOURS = 1;          // 图片在本地保存的小时数
const ENABLE_IMAGE_STORAGE = true;     // 是否启用图片存储（Deno Deploy设为false）
const RETURN_BASE64_IMAGES = true;     // 是否返回base64格式的图片（false为链接返回，需开启缓存）

// --- Venice API 配置 ---
const VENICE_CHAT_URL = "https://outerface.venice.ai/api/inference/chat";
const VENICE_IMAGE_URL = "https://outerface.venice.ai/api/inference/image";
const VENICE_VERSION = "interface@20251007.055834+464da4e";

// --- Cloudflare 代理配置 ---
const CF_IP_API_URL = "https://ipdb.api.030101.xyz/?type=cfv4;proxy";
const CF_HTTPS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
const CF_HTTP_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const USE_CF_AS_PROXY = true; // 是否使用Cloudflare IP作为代理
const PROXY_ROTATION_ENABLED = true; // 是否启用代理轮换
const MAX_REQUESTS_PER_PROXY = 1; // 每个代理最大请求数

// --- 模型配置 ---
const IMAGE_MODELS = ["stable-diffusion-3.5-rev2", "qwen-image", "hidream"]; // 画图模型列表

// =============================================================================
// 核心逻辑区 (通常无需修改)
// =============================================================================

// --- 全局状态 ---
let cfProxies: Array<{ip: string, port: number, lastUsed: number}> = [];
let currentProxyIndex = 0;

// --- 内存存储（用于Deno Deploy） ---
const imageStore = new Map<string, Uint8Array>();

// --- 随机 User-Agent ---
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
];

// --- 工具函数 ---

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function validateApiKey(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  return match[1] === API_KEY;
}

// CORS处理函数
function addCorsHeaders(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

// 简单的字符串哈希函数
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash).toString(16);
}

// 生成动态用户ID
function generateDynamicUserId(req?: Request): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const randomId = crypto.randomUUID().slice(0, 8);
  
  if (req) {
    const ip = req.headers.get("x-forwarded-for") || 
               req.headers.get("x-real-ip") || 
               "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";
    
    const hashInput = `${ip}-${userAgent}-${timestamp}-${random}`;
    const hashHex = simpleHash(hashInput);
    
    return `user_${hashHex.slice(0, 6)}_${randomId}_${random}`;
  }
  
  return `user_anon_${randomId}_${random}`;
}

// 生成图片URL的函数
function generateImageUrl(filename: string, req?: Request): string {
  if (CUSTOM_IMAGE_BASE_URL.trim()) {
    let baseUrl = CUSTOM_IMAGE_BASE_URL.trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    if (INCLUDE_PORT_IN_URL && CUSTOM_PORT) {
      const hasPort = baseUrl.match(/:(\d+)$/);
      if (!hasPort) {
        baseUrl += `:${CUSTOM_PORT}`;
      }
    }
    
    return `${baseUrl}/images/${filename}`;
  }
  
  const protocol = "https";
  let host = "your-domain.deno.dev";
  
  if (req) {
    const reqHost = req.headers.get("host");
    if (reqHost) {
      host = reqHost;
    }
  }
  
  let url = `${protocol}://${host}`;
  
  if (INCLUDE_PORT_IN_URL && CUSTOM_PORT) {
    if ((protocol === 'http' && CUSTOM_PORT !== 80) || 
        (protocol === 'https' && CUSTOM_PORT !== 443)) {
      url += `:${CUSTOM_PORT}`;
    }
  }
  
  return `${url}/images/${filename}`;
}

// 将图片数据转换为base64格式
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- Cloudflare 代理管理 ---

async function fetchAndUpdateCfProxies() {
  try {
    console.log("正在从API获取最新的Cloudflare代理列表...");
    
    const response = await fetch(CF_IP_API_URL, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/plain",
      }
    });
    
    if (!response.ok) throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
    const text = await response.text();
    const ips = text.split('\n').filter(ip => ip.trim() !== '');
    
    // 创建代理列表，每个IP配对多个端口
    cfProxies = [];
    const httpsPorts = CF_HTTPS_PORTS;
    
    for (const ip of ips) {
      for (const port of httpsPorts) {
        cfProxies.push({
          ip: ip.trim(),
          port: port,
          lastUsed: 0
        });
      }
    }
    
    console.log(`成功创建 ${cfProxies.length} 个Cloudflare代理端点。`);
    if (cfProxies.length === 0) {
      console.error("警告：没有可用的代理端点。");
    }
  } catch (error) {
    console.error("获取Cloudflare代理列表时出错:", error);
  }
}

// 获取下一个可用的代理
function getNextProxy(): {ip: string, port: number} | null {
  if (cfProxies.length === 0) {
    console.error("代理列表为空，无法获取代理。");
    return null;
  }
  
  // 查找最少使用的代理
  let bestProxy = cfProxies[0];
  let bestIndex = 0;
  
  for (let i = 0; i < cfProxies.length; i++) {
    const proxy = cfProxies[i];
    if (proxy.lastUsed < bestProxy.lastUsed) {
      bestProxy = proxy;
      bestIndex = i;
    }
  }
  
  // 更新使用时间
  bestProxy.lastUsed = Date.now();
  cfProxies[bestIndex] = bestProxy;
  
  console.log(`[代理轮换] 使用代理: ${bestProxy.ip}:${bestProxy.port}`);
  return { ip: bestProxy.ip, port: bestProxy.port };
}

// 通过Cloudflare代理发起请求
async function fetchThroughCloudflareProxy(url: string, options: RequestInit = {}): Promise<Response> {
  const proxy = getNextProxy();
  if (!proxy) {
    throw new Error("没有可用的代理");
  }
  
  console.log(`[代理请求] 通过 ${proxy.ip}:${proxy.port} 请求: ${url}`);
  
  // 创建HTTP客户端，通过Cloudflare IP连接
  const client = Deno.createHttpClient({
    connect: {
      hostname: proxy.ip,
      port: proxy.port,
    }
  });
  
  try {
    // 构建请求头，模拟真实浏览器
    const defaultHeaders = {
      "User-Agent": getRandomUserAgent(),
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      // 添加伪造的IP头
      "X-Forwarded-For": `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
      "X-Real-IP": `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
      ...options.headers,
    };
    
    const response = await fetch(url, {
      ...options,
      client,
      headers: defaultHeaders,
    });
    
    console.log(`[代理响应] 状态: ${response.status} ${response.statusText}`);
    
    // 记录速率限制信息
    const remainingRequests = response.headers.get('x-ratelimit-remaining-requests');
    const resetRequests = response.headers.get('x-ratelimit-reset-requests');
    if (remainingRequests || resetRequests) {
      console.log(`[速率限制] 剩余: ${remainingRequests}, 重置: ${resetRequests}`);
    }
    
    return response;
  } finally {
    client.close();
  }
}

// 带重试机制的请求函数
async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries: number = 3): Promise<Response> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await fetchThroughCloudflareProxy(url, options);
      
      if (response.status !== 429) {
        return response;
      }

      console.warn(`[429错误] 第${attempt + 1}次尝试收到429错误`);
      
      const resetTimeHeader = response.headers.get('x-ratelimit-reset-requests');
      let waitTime = 5000;
      
      if (resetTimeHeader) {
        const resetTime = parseInt(resetTimeHeader, 10) * 1000;
        waitTime = Math.max(resetTime - Date.now(), 2000);
      }
      
      console.log(`[重试] 等待 ${waitTime}ms 后重试...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // 强制更换代理
      const nextProxy = getNextProxy();
      if (nextProxy) {
        console.log(`[强制换代理] 切换到: ${nextProxy.ip}:${nextProxy.port}`);
      }

    } catch (error) {
      console.error(`请求失败 (尝试 ${attempt + 1}/${maxRetries}):`, error);
      if (attempt === maxRetries - 1) throw error;
      
      const backoffTime = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
    attempt++;
  }
  
  throw new Error('达到最大重试次数');
}

// --- 图片管理 ---

async function ensureImageDir() {
  if (!ENABLE_IMAGE_STORAGE) {
    console.log("图片存储已禁用，使用内存存储");
    return;
  }
  
  try {
    await Deno.mkdir(IMAGE_DIR, { recursive: true });
    console.log(`图片目录已准备就绪: ${IMAGE_DIR}`);
  } catch (error) {
    console.error(`创建图片目录失败: ${error}`);
    console.log("将使用内存存储替代文件存储");
  }
}

async function cleanOldImages() {
  if (!ENABLE_IMAGE_STORAGE) {
    return;
  }
  
  try {
    console.log("[清理任务] 开始清理旧图片...");
    const expireTime = Date.now() - IMAGE_EXPIRE_HOURS * 60 * 60 * 1000;
    let deletedCount = 0;
    for await (const entry of Deno.readDir(IMAGE_DIR)) {
      if (entry.isFile) {
        const filePath = `${IMAGE_DIR}/${entry.name}`;
        const fileInfo = await Deno.stat(filePath);
        if (fileInfo.mtime?.getTime() && fileInfo.mtime.getTime() < expireTime) {
          await Deno.remove(filePath);
          deletedCount++;
        }
      }
    }
    console.log(`[清理任务] 完成，删除了 ${deletedCount} 个旧图片文件。`);
  } catch (error) {
    console.error("[清理任务] 清理失败:", error);
  }
}

// --- API 响应格式 ---

function openaiModels() {
  return {
    object: "list",
    data: [
      { id: "dolphin-3.0-mistral-24b-1dot1", object: "model", created: 1690000000, owned_by: "venice.ai" },
      { id: "mistral-31-24b", object: "model", created: 1690000001, owned_by: "venice.ai" },
      { id: "stable-diffusion-3.5-rev2", object: "model", created: 1690000002, owned_by: "venice.ai" },
      { id: "qwen-image", object: "model", created: 1690000003, owned_by: "venice.ai" },
      { id: "hidream", object: "model", created: 1690000004, owned_by: "venice.ai" },
    ],
  };
}

// --- 请求处理函数 ---

async function handleImageGeneration(model: string, prompt: string, size: string, negativePrompt: string, req: Request): Promise<Response> {
  try {
    const userId = generateDynamicUserId(req);
    console.log(`[图片生成] 使用动态用户ID: ${userId}`);
    
    const [width, height] = size.split('x').map(Number);
    const venicePayload = {
      aspectRatio: `${width}:${height}`, embedExifMetadata: true, format: "webp", height, hideWatermark: false,
      imageToImageCfgScale: 15, imageToImageStrength: 33, loraStrength: 75, matureFilter: true,
      messageId: crypto.randomUUID().slice(0, 8), modelId: model, negativePrompt, parentMessageId: null, prompt,
      requestId: crypto.randomUUID().slice(0, 8), seed: Math.floor(Math.random() * 2**31),
      steps: model === "hidream" || model === "qwen-image" ? 20 : 25, stylePreset: "None", type: "image",
      userId: userId,
      variants: 1, width,
    };
    const headers = { 
      "Content-Type": "application/json", 
      "Origin": "https://venice.ai", 
      "Referer": "https://venice.ai/", 
      "User-Agent": getRandomUserAgent(),
      "Accept": "application/json, image/*",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "x-venice-timestamp": new Date().toISOString(), 
      "x-venice-version": VENICE_VERSION 
    };
    
    console.log(`[图片生成] 请求Venice API: ${VENICE_IMAGE_URL}`);
    
    const veniceResp = await fetchWithRetry(VENICE_IMAGE_URL, { 
      method: "POST", 
      headers, 
      body: JSON.stringify(venicePayload) 
    });
    
    console.log(`[图片生成] Venice API响应状态: ${veniceResp.status} ${veniceResp.statusText}`);
    
    if (!veniceResp.ok) {
      const errorText = await veniceResp.text();
      console.error(`[错误] Venice API返回错误 (${veniceResp.status}): ${errorText}`);
      const errorMarkdown = `# 图片生成失败

**错误信息：**
- 状态码：${veniceResp.status}
- 详情：${errorText}

请检查请求参数后重试。`;
      return addCorsHeaders(new Response(errorMarkdown, { 
        status: veniceResp.status, 
        headers: { "Content-Type": "text/markdown; charset=utf-8" } 
      }));
    }
    
    const imageBuffer = await veniceResp.arrayBuffer();
    if (imageBuffer.byteLength === 0) {
      const errorMarkdown = `# 图片生成失败

**错误信息：**
- 原因：接收到空的图片数据

请稍后重试。`;
      return addCorsHeaders(new Response(errorMarkdown, { 
        status: 500, 
        headers: { "Content-Type": "text/markdown; charset=utf-8" } 
      }));
    }

    const filename = `${crypto.randomUUID()}.webp`;
    const imageData = new Uint8Array(imageBuffer);
    
    if (ENABLE_IMAGE_STORAGE) {
      try {
        const filePath = `${IMAGE_DIR}/${filename}`;
        await Deno.writeFile(filePath, imageData);
        console.log(`[成功] 图片已保存: ${filename}`);
      } catch (error) {
        console.error(`保存图片失败: ${error}，使用内存存储`);
        imageStore.set(filename, imageData);
      }
    } else {
      imageStore.set(filename, imageData);
      console.log(`[成功] 图片已保存到内存: ${filename}`);
    }

    if (RETURN_BASE64_IMAGES) {
      const base64Image = arrayBufferToBase64(imageBuffer);
      const dataUrl = `data:image/webp;base64,${base64Image}`;
      
      const readmeResponse = `![${prompt}](${dataUrl})

## 图片信息

- **模型**：${model}
- **提示词**：${prompt}
- **尺寸**：${size}
- **负面提示词**：${negativePrompt || '无'}

## 图片数据

Base64编码的图片数据已包含在上方图片中。`;

      return addCorsHeaders(new Response(readmeResponse, { 
        headers: { "Content-Type": "text/markdown; charset=utf-8" } 
      }));
    } else {
      const imageUrl = generateImageUrl(filename, req);
      
      const readmeResponse = `![${prompt}](${imageUrl})

## 图片信息

- **模型**：${model}
- **提示词**：${prompt}
- **尺寸**：${size}
- **负面提示词**：${negativePrompt || '无'}

## 图片链接

 ${imageUrl}`;

      return addCorsHeaders(new Response(readmeResponse, { 
        headers: { "Content-Type": "text/markdown; charset=utf-8" } 
      }));
    }
  } catch (error) {
    console.error("Image generation request failed:", error);
    const errorMarkdown = `# 图片生成失败

**错误信息：**
- 原因：${error.message || '未知错误'}

请稍后重试。`;
    return addCorsHeaders(new Response(errorMarkdown, { 
      status: 500, 
      headers: { "Content-Type": "text/markdown; charset=utf-8" } 
    }));
  }
}

async function handleChatCompletion(model: string, messages: any[], temperature: number, topP: number, stream: boolean, req: Request): Promise<Response> {
  try {
    const userId = generateDynamicUserId(req);
    console.log(`[聊天] 使用动态用户ID: ${userId}`);
    
    const venicePayload = { 
      characterId: "", 
      clientProcessingTime: 2, 
      conversationType: "text", 
      includeVeniceSystemPrompt: true, 
      isCharacter: false, 
      modelId: model, 
      prompt: messages, 
      reasoning: true, 
      requestId: crypto.randomUUID().slice(0, 8), 
      systemPrompt: "", 
      temperature, 
      topP, 
      userId: userId,
      webEnabled: true 
    };
    const headers = { 
      "Content-Type": "application/json", 
      "Origin": "https://venice.ai", 
      "Referer": "https://venice.ai/", 
      "User-Agent": getRandomUserAgent(),
      "Accept": "text/event-stream, application/json, text/plain",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
    };
    
    console.log(`[聊天] 请求Venice API: ${VENICE_CHAT_URL}`);
    
    const veniceResp = await fetchWithRetry(VENICE_CHAT_URL, { 
      method: "POST", 
      headers, 
      body: JSON.stringify(venicePayload) 
    });
    
    console.log(`[聊天] Venice API响应状态: ${veniceResp.status} ${veniceResp.statusText}`);
    
    if (!veniceResp.ok) {
      const errorText = await veniceResp.text();
      console.error(`[错误] Venice API返回错误:`, errorText);
      return addCorsHeaders(new Response(JSON.stringify({ 
        error: { 
          message: `Venice API error: ${veniceResp.status}`, 
          details: errorText, 
          type: "venice_api_error" 
        } 
      }), { 
        status: veniceResp.status, 
        headers: { "Content-Type": "application/json" } 
      }));
    }

    if (stream) {
      const reader = veniceResp.body?.getReader(); 
      const encoder = new TextEncoder(); 
      const decoder = new TextDecoder(); 
      let buffer = ""; 
      let isFinished = false;
      
      const streamResp = new ReadableStream({ 
        async start(controller) {
          const timeoutId = setTimeout(() => {
            if (!isFinished) {
              console.error("Stream timeout, closing connection");
              controller.close();
            }
          }, 60000);
          
          try { 
            while (!isFinished) {
              if (!reader) { 
                controller.enqueue(encoder.encode("data: [DONE]\n\n")); 
                controller.close(); 
                isFinished = true; 
                break; 
              }
              const { done, value } = await reader.read(); 
              if (done) { 
                controller.enqueue(encoder.encode("data: [DONE]\n\n")); 
                controller.close(); 
                isFinished = true; 
                break; 
              }
              const chunk = decoder.decode(value, { stream: true }); 
              buffer += chunk; 
              let idx;
              while ((idx = buffer.indexOf("\n")) >= 0) { 
                const line = buffer.slice(0, idx).trim(); 
                buffer = buffer.slice(idx + 1); 
                if (!line) continue;
                try { 
                  const data = JSON.parse(line); 
                  const content = data.content; 
                  if (content) {
                    const chunk = { 
                      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`, 
                      object: "chat.completion.chunk", 
                      created: Math.floor(Date.now() / 1000), 
                      model, 
                      choices: [{ 
                        delta: { content }, 
                        index: 0, 
                        finish_reason: null, 
                      }], 
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  } 
                } catch (parseError) { 
                  console.error("JSON parse error:", parseError, "Line:", line); 
                } 
              }
            } 
          } catch (error) { 
            console.error("Stream processing error:", error); 
            const errorChunk = {
              id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  delta: { content: "\n\n[Stream interrupted due to error]" },
                  index: 0,
                  finish_reason: "error",
                },
              ],
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } finally { 
            clearTimeout(timeoutId);
            isFinished = true; 
          } 
        } 
      });
      
      const response = new Response(streamResp, { 
        headers: { 
          "Content-Type": "text/event-stream", 
          "Cache-Control": "no-cache", 
          "Connection": "keep-alive", 
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }, 
      });
      return response;
    } else {
      const text = await veniceResp.text(); 
      console.log(`[聊天] Venice API响应内容:`, text);
      const contents = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l).content).join("");
      const resp = { 
        id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`, 
        object: "chat.completion", 
        created: Math.floor(Date.now() / 1000), 
        model, 
        choices: [{ 
          index: 0, 
          message: { role: "assistant", content: contents }, 
          finish_reason: "stop", 
        }], 
      };
      return addCorsHeaders(new Response(JSON.stringify(resp), { headers: { "Content-Type": "application/json" }, }));
    }
  } catch (error) {
    console.error("Chat completion request failed:", error);
    return addCorsHeaders(new Response(JSON.stringify({ 
      error: { 
        message: "Failed to process chat completion", 
        type: "request_error",
        details: error.message 
      } 
    }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    }));
  }
}

// --- 服务器启动 ---

async function initializeServer() {
  await ensureImageDir();
  await fetchAndUpdateCfProxies();
  if (cfProxies.length === 0) console.error("无法获取任何Cloudflare代理，服务将启动但可能无法正常工作。");
  
  if (ENABLE_IMAGE_STORAGE) {
    setInterval(fetchAndUpdateCfProxies, 5 * 60 * 1000);
    setInterval(cleanOldImages, IMAGE_EXPIRE_HOURS * 60 * 60 * 1000);
  }

  console.log(`服务器已启动，监听端口 ${SERVER_PORT}...`);
  
  if (CUSTOM_IMAGE_BASE_URL.trim()) {
    console.log(`使用自定义图片基础URL: ${CUSTOM_IMAGE_BASE_URL}`);
    if (INCLUDE_PORT_IN_URL && CUSTOM_PORT) {
      console.log(`端口配置: 包含端口 ${CUSTOM_PORT}`);
    } else {
      console.log(`端口配置: 不包含端口`);
    }
  } else {
    console.log(`图片将通过自动检测的URL访问`);
    console.log(`当前配置: ${SERVER_HOST}:${SERVER_PORT}`);
  }
  
  console.log(`Cloudflare代理: ${USE_CF_AS_PROXY ? '启用' : '禁用'}`);
  if (USE_CF_AS_PROXY) {
    console.log(`可用代理数量: ${cfProxies.length}`);
  }
  console.log(`图片存储: ${ENABLE_IMAGE_STORAGE ? '文件存储' : '内存存储'}`);
  console.log(`图片返回格式: ${RETURN_BASE64_IMAGES ? 'Base64' : 'URL'}`);
  
  serve(async (req: Request) => {
    const url = new URL(req.url);
    
    if (req.method === "OPTIONS") {
      return addCorsHeaders(new Response(null, { status: 200 }));
    }
    
    // 添加IP测试端点
    if (url.pathname === "/test-ip" && req.method === "GET") {
      try {
        const testUrl = "https://httpbin.org/ip";
        const response = await fetchThroughCloudflareProxy(testUrl);
        const result = await response.json();
        return addCorsHeaders(new Response(JSON.stringify({
          proxyIP: result.origin,
          proxyEnabled: USE_CF_AS_PROXY,
          totalProxies: cfProxies.length,
          timestamp: Date.now()
        }), { headers: { "Content-Type": "application/json" } }));
      } catch (error) {
        return addCorsHeaders(new Response(JSON.stringify({
          error: error.message
        }), { status: 500 }));
      }
    }
    
    // --- 静态图片服务 ---
    if (url.pathname.startsWith("/images/")) {
      const filename = url.pathname.substring("/images/".length);
      
      if (imageStore.has(filename)) {
        const imageData = imageStore.get(filename);
        
        if (url.searchParams.get('format') === 'base64') {
          const base64Image = arrayBufferToBase64(imageData.buffer);
          const dataUrl = `data:image/webp;base64,${base64Image}`;
          return addCorsHeaders(new Response(JSON.stringify({ 
            dataUrl,
            filename
          }), { 
            headers: { 
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${IMAGE_EXPIRE_HOURS * 3600}` 
            } 
          }));
        }
        
        return addCorsHeaders(new Response(imageData, { 
          headers: { 
            "Content-Type": "image/webp", 
            "Cache-Control": `public, max-age=${IMAGE_EXPIRE_HOURS * 3600}` 
          } 
        }));
      }
      
      if (ENABLE_IMAGE_STORAGE) {
        try {
          const filePath = `${IMAGE_DIR}/${filename}`;
          const imageFile = await Deno.readFile(filePath);
          
          if (url.searchParams.get('format') === 'base64') {
            const base64Image = arrayBufferToBase64(imageFile.buffer);
            const dataUrl = `data:image/webp;base64,${base64Image}`;
            return addCorsHeaders(new Response(JSON.stringify({ 
              dataUrl,
              filename
            }), { 
              headers: { 
                "Content-Type": "application/json",
                "Cache-Control": `public, max-age=${IMAGE_EXPIRE_HOURS * 3600}` 
              } 
            }));
          }
          
          return addCorsHeaders(new Response(imageFile, { 
            headers: { 
              "Content-Type": "image/webp", 
              "Cache-Control": `public, max-age=${IMAGE_EXPIRE_HOURS * 3600}` 
            } 
          }));
        } catch (error) {
          console.error(`读取图片文件失败: ${error}`);
        }
      }
      
      return addCorsHeaders(new Response("Image Not Found", { status: 404 }));
    }

    // --- API 密钥验证 ---
    if (url.pathname === "/v1/models" || url.pathname === "/v1/chat/completions") {
      if (!validateApiKey(req)) {
        return addCorsHeaders(new Response(JSON.stringify({ 
          error: { 
            message: "Invalid API key", 
            type: "invalid_request_error", 
            code: "invalid_api_key" 
          } 
        }), { 
          status: 401, 
          headers: { "Content-Type": "application/json" } 
        }));
      }
    }

    // --- 路由分发 ---
    if (url.pathname === "/v1/models") {
      return addCorsHeaders(new Response(JSON.stringify(openaiModels()), { headers: { "Content-Type": "application/json" } }));
    }

    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      try {
        const body = await req.json();
        const model = body.model ?? "dolphin-3.0-mistral-24b-1dot1";
        const messages = body.messages ?? [];
        const temperature = body.temperature ?? 0.7;
        const topP = body.top_p ?? 0.9;
        const stream = body.stream ?? false;
        
        if (IMAGE_MODELS.includes(model)) {
          console.log(`[请求类型] 画图 - 模型: ${model}`);
          const lastUserMessage = messages.filter(m => m.role === 'user').pop();
          const prompt = lastUserMessage?.content;
          if (!prompt || typeof prompt !== 'string') {
            const errorMarkdown = `# 请求错误

**错误信息：**
- 原因：图片生成需要文本提示词
- 要求：请在最后一条用户消息中提供提示词

示例：
\`\`\`json
{
  "model": "stable-diffusion-3.5-rev2",
  "messages": [
    {"role": "user", "content": "a beautiful sunset"}
  ]
}
\`\`\``;
            return addCorsHeaders(new Response(errorMarkdown, { 
              status: 400, 
              headers: { "Content-Type": "text/markdown; charset=utf-8" } 
            }));
          }
          const size = body.size ?? "1024x1024";
          const negativePrompt = body.negative_prompt ?? "";
          return await handleImageGeneration(model, prompt, size, negativePrompt, req);
        } else {
          console.log(`[请求类型] 聊天 - 模型: ${model}`);
          return await handleChatCompletion(model, messages, temperature, topP, stream, req);
        }
      } catch (error) {
        console.error("Request processing error:", error);
        const errorMarkdown = `# 请求处理失败

**错误信息：**
- 原因：${error.message || '未知错误'}

请检查请求格式后重试。`;
        return addCorsHeaders(new Response(errorMarkdown, { 
          status: 500, 
          headers: { "Content-Type": "text/markdown; charset=utf-8" } 
        }));
      }
    }

    return addCorsHeaders(new Response("Not Found", { status: 404 }));
  }, { port: SERVER_PORT });
}

// 启动
initializeServer();
