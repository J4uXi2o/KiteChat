# KiteChat

完全本地化的多提供商 AI 聊天盒子（Android）。基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）重构，Capacitor 7 + React 18 + TypeScript。

[English](README.md) · [官网下载](https://j4uxi2o.github.io/KiteChat/) · [Releases](https://github.com/J4uXi2o/KiteChat/releases)

## 特性

- **多提供商**：聊天 / 识图 / 生图 / 标题 / 联网搜索 / 语音（ASR+TTS）按功能槽位独立绑定模型；内置 DeepSeek、OpenAI、硅基流动、基元律动、Ollama 等预设，也可自定义任意 OpenAI/Anthropic 兼容端点。
- **完全本地**：对话、附件、API Key 全部存本机（localStorage + IndexedDB），网络只直连你配置的 API；无账号、无遥测、无云同步。
- **一键引导**：首次启动粘贴一个 DeepSeek Key，自动配齐聊天、识图、标题、联网搜索、语音输入与朗读。
- **微信式语音**：按住说话、上滑取消、松手自动转写发送；音色按各厂商官方文档内置并支持自定义。
- **附件与链接**：图片 / PDF / Word 解析提问；粘贴网址自动读取正文作为上下文（仅用户消息链接、拒绝内网地址）。
- **生图**：尺寸/张数由语言模型按你的话推断（不改原文），支持参考图图生图（多厂商）。
- **体验**：深浅色主题与自定义调色板、系统级文本划选复制、长按菜单、生成完成通知、安卓系统分享接入、停止即真取消请求。
- **安全**：密钥不进日志/导出包；重定向跨主机自动剥离 Authorization；保存文件名防穿越；渲染管线消毒（mermaid strict / KaTeX 不信任原始 HTML）。

## 下载

- 官网：<https://j4uxi2o.github.io/KiteChat/>
- GitHub Releases：APK 直接下载，覆盖安装保留数据（同一签名证书）。

## 构建

需要 Node 20+、JDK 17、Android SDK 35。

```bash
npm install
npm run build          # Web 产物 → dist/
npx cap sync android   # 同步到安卓工程
cd android && ./gradlew assembleRelease
```

签名材料**不入库**：本地放 `android/signing.properties`（见 `signing.properties.example`）与 keystore；CI 从仓库 Secrets 还原（`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`）。无签名材料时产出未签名 APK。

## 发布

打 tag 即发布：`git tag v1.14 && git push origin v1.14`。CI 构建签名 APK 并创建 GitHub Release；应用内「设置 → 关于 → 检查更新」读取最新 Release。

## 反馈

- 邮箱：58468680@qq.com
- QQ 群：195425971
- Issues：本仓库

## 许可证

[AGPL-3.0](LICENSE) —— 最强 copyleft：任何分发或网络服务形式的衍生作品都必须以相同协议公开完整源码。上游 chat-demo 的 MIT 声明保留于文件头与 LICENSE 附注。