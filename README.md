# 回声键盘 AI 原型

这是一个手机优先的 AI 聊天回复助手 PWA。它可以先作为网页 App 在 iPhone 上使用，后续再迁移成 iOS 键盘扩展。

## 本地预览

如果只想看界面，可以直接用浏览器打开 `index.html`。

如果要测试真实 AI 后端，需要用 Node 启动服务：

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-19\app\outputs\chat-assistant-app
$env:AI_PROVIDER="openai"
$env:AI_API_KEY="你的_API_Key"
$env:AI_MODEL="gpt-4.1-mini"
npm start
```

然后打开：

```text
http://127.0.0.1:8787
```

## 环境变量

通用环境变量：

```text
AI_PROVIDER=openai / qwen / deepseek
AI_API_KEY=对应平台的 API Key
AI_BASE_URL=可选，不填则使用供应商默认地址
AI_MODEL=模型名称
PORT=8787
```

默认值：

```text
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini
```

为了兼容旧版本，后端仍会读取 `OPENAI_API_KEY` 和 `OPENAI_MODEL`，但推荐使用新的 `AI_API_KEY` 和 `AI_MODEL`。

## OpenAI 配置

OpenAI 使用 Responses API。

```powershell
$env:AI_PROVIDER="openai"
$env:AI_API_KEY="sk-your_openai_key"
$env:AI_MODEL="gpt-4.1-mini"
npm start
```

默认接口地址：

```text
https://api.openai.com/v1/responses
```

如果需要自定义地址：

```powershell
$env:AI_BASE_URL="https://api.openai.com/v1/responses"
```

## 阿里千问 Qwen 配置

Qwen 使用 DashScope 的 OpenAI 兼容模式。

```powershell
$env:AI_PROVIDER="qwen"
$env:AI_API_KEY="sk-your_dashscope_key"
$env:AI_MODEL="qwen-plus"
npm start
```

默认接口地址：

```text
https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

如果你填写的是基础地址，后端会自动补 `/chat/completions`：

```powershell
$env:AI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
```

## DeepSeek 配置

DeepSeek 使用 OpenAI 兼容模式。

```powershell
$env:AI_PROVIDER="deepseek"
$env:AI_API_KEY="sk-your_deepseek_key"
$env:AI_MODEL="deepseek-chat"
npm start
```

默认接口地址：

```text
https://api.deepseek.com/chat/completions
```

如果你填写的是基础地址，后端会自动补 `/chat/completions`：

```powershell
$env:AI_BASE_URL="https://api.deepseek.com"
```

## 接口返回

前端仍然请求同一个接口：

```text
POST /api/reply
```

返回格式保持不变：

```json
{
  "replies": ["回复1", "回复2", "回复3"]
}
```

如果 AI 返回内容无法解析，后端会返回清晰错误，例如：

```json
{
  "error": "AI 返回内容不是有效 JSON：..."
}
```

## iPhone 使用方式

建议把这个文件夹部署到 HTTPS 网站，然后：

1. 用 iPhone Safari 打开网址
2. 点底部分享按钮
3. 选择“添加到主屏幕”
4. 从主屏幕打开“回声键盘”

注意：离线缓存和主屏幕安装在 HTTPS 网址下效果最好，直接打开本地文件只能用于桌面预览。

## 已有功能

- 粘贴对方消息后生成候选回复
- 通过环境变量切换 OpenAI、Qwen、DeepSeek
- 后端不可用时前端自动退回本地模拟回复
- 根据人设、关系、禁用表达、语气和聊天目的调整回复
- 候选回复必须先选择，再进入待确认区
- 支持复制回复，仍由用户手动发送
- 支持自主聊天模式，但每一句仍需要确认
- 自动保存人设、关系、语气、设置和深浅色模式
- 支持 PWA manifest、主屏幕图标和离线缓存

## 安全建议

不要把模型 API Key 放进前端、PWA 页面或 iOS 键盘扩展。当前实现把 API Key 放在 Node 后端环境变量 `AI_API_KEY` 中，手机端只请求自己的 `/api/reply` 接口。
